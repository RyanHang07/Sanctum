//! Sharing a note as a live, read-only link (v0.2; supabase/migrations/*_note_shares.sql).
//! END-TO-END ENCRYPTED: the window encrypts the note and its images (src/lib/shareCrypto.ts)
//! with a key that only ever appears in the link's #fragment; this module just moves the
//! ciphertext. Sharing picks how long (1 hour, 1 day, 7 days). The account's `note_shares` row
//! holds the ciphertext and each image's signed URL (encrypted blobs in the private
//! `note-shares` bucket, URLs that expire with the link); each push is announced on the
//! Realtime topic `note-share:<token>` so an open page reloads. Stop (or expiry) removes it all.
//! Locally a note keeps its token, expiry, key (so pushes continue after a restart), and the
//! signed URL of each image already uploaded.

use crate::{cloud, session::now_ms, Shared};
use base64::Engine;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use tauri::{AppHandle, Manager};

pub const HOURS: &[i64] = &[1, 24, 168];
const BUCKET: &str = "note-shares";
const MAX_CIPHER: usize = 3_000_000;
const MAX_IMAGE: usize = 12 * 1024 * 1024;

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ShareInfo {
    pub url: String,
    pub expires_at: i64,
}

/// One image's encrypted bytes, base64.
#[derive(Deserialize, Clone, Debug)]
pub struct SharedImage {
    pub id: i64,
    pub data: String,
}

/// The link: the page's address, then the key in the #fragment (never sent to a server).
pub fn share_url(token: &str, key: &str) -> String {
    format!("{}/n/{token}#{key}", cloud::PARTNER_URL)
}

fn new_token() -> String {
    rand::random::<[u8; 32]>().iter().map(|b| format!("{b:02x}")).collect()
}

/// A key the window made: base64url of 32 bytes.
pub fn valid_key(key: &str) -> bool {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(key).is_ok_and(|k| k.len() == 32)
}

pub struct Local {
    pub token: String,
    pub expires_at: i64,
    pub key: String,
    pub images: BTreeMap<i64, String>,
}

pub fn local(conn: &Connection, note: i64) -> rusqlite::Result<Option<Local>> {
    conn.query_row(
        "SELECT share_token, share_expires_at, share_key, share_images FROM notes WHERE id = ?1 AND share_token IS NOT NULL",
        [note],
        |r| {
            let images: String = r.get::<_, Option<String>>(3)?.unwrap_or_default();
            Ok(Local { token: r.get(0)?, expires_at: r.get(1)?, key: r.get::<_, Option<String>>(2)?.unwrap_or_default(), images: serde_json::from_str(&images).unwrap_or_default() })
        },
    )
    .optional()
}

fn save_local(conn: &Connection, note: i64, l: Option<&Local>) -> rusqlite::Result<()> {
    match l {
        Some(l) => conn.execute(
            "UPDATE notes SET share_token = ?1, share_expires_at = ?2, share_key = ?3, share_images = ?4 WHERE id = ?5",
            params![l.token, l.expires_at, l.key, serde_json::to_string(&l.images).unwrap_or_default(), note],
        ),
        None => conn.execute("UPDATE notes SET share_token = NULL, share_expires_at = NULL, share_key = NULL, share_images = NULL WHERE id = ?1", [note]),
    }
    .map(|_| ())
}

fn rfc3339(ms: i64) -> String {
    chrono::DateTime::from_timestamp_millis(ms).map(|t| t.to_rfc3339()).unwrap_or_default()
}

fn with_local<T>(app: &AppHandle, f: impl FnOnce(&Connection) -> rusqlite::Result<T>) -> Result<T, String> {
    let shared = app.state::<Shared>();
    let conn = shared.db.lock().map_err(|e| e.to_string())?;
    f(&conn).map_err(|e| e.to_string())
}

/// Uploads encrypted images not up yet; each gets a signed URL that lasts as long as the link.
fn upload_images(app: &AppHandle, owner: &str, l: &mut Local, images: &[SharedImage]) -> Result<(), String> {
    let state = &app.state::<Shared>().cloud;
    let new: Vec<&SharedImage> = images.iter().filter(|i| !l.images.contains_key(&i.id)).collect();
    for img in new {
        let bytes = base64::engine::general_purpose::STANDARD.decode(img.data.as_bytes()).map_err(|_| "An image couldn't be read.".to_string())?;
        if bytes.len() > MAX_IMAGE {
            return Err("An image is too large to share.".into());
        }
        let path = format!("{owner}/{}/{}", l.token, img.id);
        let (req, _) = cloud::authed(state, state.http.post(format!("{}/storage/v1/object/{BUCKET}/{path}", cloud::URL)))?;
        cloud::send(req.header("Content-Type", "application/octet-stream").header("x-upsert", "true").body(bytes))?;
        let secs = ((l.expires_at - now_ms()) / 1000).max(60);
        let (req, _) = cloud::authed(state, state.http.post(format!("{}/storage/v1/object/sign/{BUCKET}/{path}", cloud::URL)))?;
        let signed = cloud::send(req.json(&json!({ "expiresIn": secs })))?;
        let tail = signed["signedURL"].as_str().ok_or("The image link didn't come back.")?;
        l.images.insert(img.id, format!("{}/storage/v1{tail}", cloud::URL));
    }
    Ok(())
}

/// Takes the share down: the row, its images, then the note's memory of it. If the server
/// can't be reached the note keeps remembering it (the link is still live until it expires),
/// so Stop can say so and start-up retries.
fn unpublish(app: &AppHandle, note: i64, l: &Local) -> Result<(), String> {
    let state = &app.state::<Shared>().cloud;
    let (req, owner) = cloud::authed(state, state.http.delete(format!("{}/rest/v1/note_shares?token=eq.{}", cloud::URL, l.token)))?;
    cloud::send(req)?;
    let names: Vec<Value> = l.images.keys().map(|id| json!(format!("{owner}/{}/{id}", l.token))).collect();
    if !names.is_empty() {
        // The row is gone, so the images are unreachable anyway; removing them is tidying.
        if let Ok((req, _)) = cloud::authed(state, state.http.delete(format!("{}/storage/v1/object/{BUCKET}", cloud::URL))) {
            let _ = cloud::send(req.json(&json!({ "prefixes": names })));
        }
    }
    with_local(app, |c| save_local(c, note, None))
}

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())?
}

/// Starts sharing a note for `hours` (1, 24, or 168) with the window's key. Sharing again
/// replaces the old link. The content follows with update_note_share.
#[tauri::command]
pub async fn share_note(app: AppHandle, id: i64, hours: i64, key: String) -> Result<ShareInfo, String> {
    if !cloud::configured() {
        return Err("Sharing needs Sanctum's account service, which this build doesn't have.".into());
    }
    if !HOURS.contains(&hours) {
        return Err("Share for 1 hour, 1 day, or 7 days.".into());
    }
    if !valid_key(&key) {
        return Err("The share key is damaged. Try again.".into());
    }
    blocking(move || {
        with_local(&app, |c| c.query_row("SELECT 1 FROM notes WHERE id = ?1", [id], |_| Ok(()))).map_err(|_| "That note no longer exists.".to_string())?;
        if let Some(old) = with_local(&app, |c| local(c, id))? {
            unpublish(&app, id, &old)?;
        }
        let l = Local { token: new_token(), expires_at: now_ms() + hours * 3_600_000, key, images: BTreeMap::new() };
        let state = &app.state::<Shared>().cloud;
        let (req, owner) = cloud::authed(state, state.http.post(format!("{}/rest/v1/note_shares", cloud::URL)))?;
        cloud::send(req.json(&json!({ "token": l.token, "owner": owner, "expires_at": rfc3339(l.expires_at) })))?;
        with_local(&app, |c| save_local(c, id, Some(&l)))?;
        Ok(ShareInfo { url: share_url(&l.token, &l.key), expires_at: l.expires_at })
    })
    .await
}

/// Pushes the note's latest ciphertext (and any new encrypted images) to its open link.
/// Returns the ids of every image now uploaded, so the window sends each one once.
#[tauri::command]
pub async fn update_note_share(app: AppHandle, id: i64, cipher: String, images: Vec<SharedImage>) -> Result<Vec<i64>, String> {
    if cipher.len() > MAX_CIPHER {
        return Err("This note is too long to share.".into());
    }
    blocking(move || {
        let Some(mut l) = with_local(&app, |c| local(c, id))? else { return Err("This note isn't shared.".into()) };
        if l.expires_at <= now_ms() {
            let _ = unpublish(&app, id, &l);
            return Err("The link expired.".into());
        }
        let state = &app.state::<Shared>().cloud;
        let (_, owner) = cloud::authed(state, state.http.get(cloud::URL))?;
        let before = l.images.len();
        let uploaded = upload_images(&app, &owner, &mut l, &images);
        if l.images.len() != before {
            with_local(&app, |c| save_local(c, id, Some(&l)))?;
        }
        uploaded?;
        let (req, _) = cloud::authed(state, state.http.patch(format!("{}/rest/v1/note_shares?token=eq.{}", cloud::URL, l.token)))?;
        let rows = cloud::send(req.header("Prefer", "return=representation").json(&json!({ "cipher": cipher, "images": l.images, "updated_at": rfc3339(now_ms()) })))?;
        if rows.as_array().is_some_and(Vec::is_empty) {
            // Gone on the server (expired and pruned): forget it here too.
            let _ = with_local(&app, |c| save_local(c, id, None));
            return Err("This note isn't shared anymore.".into());
        }
        // Best effort: the page also checks now and then on its own.
        if let Ok((req, _)) = cloud::authed(state, state.http.post(format!("{}/realtime/v1/api/broadcast", cloud::URL))) {
            let _ = cloud::send(req.json(&json!({ "messages": [{ "topic": format!("note-share:{}", l.token), "event": "changed", "payload": {} }] })));
        }
        Ok(l.images.keys().copied().collect())
    })
    .await
}

#[tauri::command]
pub async fn stop_note_share(app: AppHandle, id: i64) -> Result<(), String> {
    blocking(move || {
        match with_local(&app, |c| local(c, id))? {
            Some(l) => unpublish(&app, id, &l).map_err(|e| format!("Couldn't stop sharing ({e}). The link stays open until it expires; try again online.")),
            None => Ok(()),
        }
    })
    .await
}

/// On start: links that expired while Sanctum was closed are taken down (best effort; the
/// server stops serving them at expiry either way).
pub fn sweep_expired(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        let expired: Vec<(i64, Local)> = with_local(&app, |conn| {
            let ids: Vec<i64> = conn
                .prepare("SELECT id FROM notes WHERE share_token IS NOT NULL AND share_expires_at <= ?1")?
                .query_map([now_ms()], |r| r.get(0))?
                .collect::<rusqlite::Result<_>>()?;
            Ok(ids.into_iter().filter_map(|id| local(conn, id).ok().flatten().map(|l| (id, l))).collect())
        })
        .unwrap_or_default();
        for (id, l) in expired {
            let _ = unpublish(&app, id, &l);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn links_carry_the_key_only_in_the_fragment() {
        let key = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode([7u8; 32]);
        assert!(valid_key(&key));
        assert!(!valid_key("short"));
        let url = share_url("abc", &key);
        assert!(url.ends_with(&format!("/n/abc#{key}")));
        assert_eq!(new_token().len(), 64);
    }

    #[test]
    fn remembers_a_share_locally_and_forgets_it() {
        let mut conn = Connection::open_in_memory().unwrap();
        crate::db::prepare(&mut conn).unwrap();
        conn.execute("INSERT INTO notes (id, title, body, created_at, updated_at) VALUES (1, 't', '', 0, 0)", []).unwrap();
        assert!(local(&conn, 1).unwrap().is_none());
        let l = Local { token: "tok".into(), expires_at: 99, key: "k".into(), images: BTreeMap::from([(3, "https://u".to_string())]) };
        save_local(&conn, 1, Some(&l)).unwrap();
        let back = local(&conn, 1).unwrap().unwrap();
        assert_eq!((back.token.as_str(), back.expires_at, back.key.as_str(), back.images.get(&3).map(String::as_str)), ("tok", 99, "k", Some("https://u")));
        save_local(&conn, 1, None).unwrap();
        assert!(local(&conn, 1).unwrap().is_none());
    }
}
