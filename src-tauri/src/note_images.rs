//! Images in notes (v0.2). Kept in the database (so a backup or restore carries them) and
//! served to the window on a private scheme: a note's document says `noteimg:12`, the window
//! loads `http://noteimg.localhost/12` (`noteimg://localhost/12` off Windows). Same image
//! pasted twice is stored once. Images no note uses any more are cleared after a day.

use crate::{session::now_ms, Shared};
use base64::Engine;
use rusqlite::{params, Connection, OptionalExtension};
use sha2::{Digest, Sha256};
use std::borrow::Cow;
use tauri::{http, Manager, State};

pub const SCHEME: &str = "noteimg";
const MAX_BYTES: usize = 10 * 1024 * 1024;
const TYPES: &[&str] = &["image/png", "image/jpeg", "image/gif", "image/webp"];
/// An image goes unused for this long (deleted, or the note undone) before it's cleared.
const KEEP_MS: i64 = 24 * 3_600_000;

/// Stores an image, or finds the identical one already stored. Returns its id.
pub fn save(conn: &Connection, mime: &str, bytes: &[u8], now: i64) -> Result<i64, String> {
    if !TYPES.contains(&mime) {
        return Err("Use a PNG, JPEG, GIF, or WebP image.".into());
    }
    if bytes.is_empty() || bytes.len() > MAX_BYTES {
        return Err("Images can be up to 10 MB.".into());
    }
    let sha = format!("{:x}", Sha256::digest(bytes));
    if let Some(id) = conn.query_row("SELECT id FROM note_images WHERE sha = ?1", [&sha], |r| r.get(0)).optional().map_err(|e| e.to_string())? {
        return Ok(id);
    }
    conn.execute("INSERT INTO note_images (sha, mime, bytes, created_at) VALUES (?1, ?2, ?3, ?4)", params![sha, mime, bytes, now])
        .map_err(|e| e.to_string())?;
    Ok(conn.last_insert_rowid())
}

pub fn get(conn: &Connection, id: i64) -> rusqlite::Result<Option<(String, Vec<u8>)>> {
    conn.query_row("SELECT mime, bytes FROM note_images WHERE id = ?1", [id], |r| Ok((r.get(0)?, r.get(1)?))).optional()
}

/// Clears images older than a day that no note's document mentions.
pub fn sweep(conn: &Connection, now: i64) -> rusqlite::Result<usize> {
    conn.execute(
        "DELETE FROM note_images WHERE created_at < ?1 AND NOT EXISTS (
           SELECT 1 FROM notes WHERE notes.doc LIKE '%\"noteimg:' || note_images.id || '\"%')",
        [now - KEEP_MS],
    )
}

#[tauri::command]
pub fn save_note_image(shared: State<Shared>, data: String, mime: String) -> Result<i64, String> {
    let bytes = base64::engine::general_purpose::STANDARD.decode(data.as_bytes()).map_err(|_| "That image couldn't be read.".to_string())?;
    let conn = shared.db.lock().map_err(|e| e.to_string())?;
    save(&conn, &mime, &bytes, now_ms())
}

/// The `noteimg` scheme: `/12` is image 12.
pub fn serve<R: tauri::Runtime>(app: &tauri::AppHandle<R>, request: &http::Request<Vec<u8>>) -> http::Response<Cow<'static, [u8]>> {
    let not_found = || http::Response::builder().status(404).body(Cow::Borrowed(&[][..])).unwrap();
    let Some(id) = request.uri().path().trim_start_matches('/').parse::<i64>().ok() else { return not_found() };
    let Some(shared) = app.try_state::<Shared>() else { return not_found() };
    let found = shared.db.lock().ok().and_then(|c| get(&c, id).ok().flatten());
    match found {
        Some((mime, bytes)) => http::Response::builder()
            .header("Content-Type", mime)
            // Always an image, never sniffed into something that runs.
            .header("X-Content-Type-Options", "nosniff")
            // An id never changes what it points to.
            .header("Cache-Control", "private, max-age=31536000, immutable")
            .body(Cow::Owned(bytes))
            .unwrap(),
        None => not_found(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fresh() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        crate::db::prepare(&mut conn).unwrap();
        conn
    }

    #[test]
    fn stores_once_checks_type_and_size_and_sweeps_unused() {
        let conn = fresh();
        let png = b"\x89PNG fake";
        let a = save(&conn, "image/png", png, 0).unwrap();
        assert_eq!(save(&conn, "image/png", png, 5).unwrap(), a, "same bytes, same image");
        assert!(save(&conn, "image/svg+xml", b"<svg/>", 0).is_err(), "no SVG (it can carry script)");
        assert!(save(&conn, "image/png", &vec![0u8; MAX_BYTES + 1], 0).is_err());
        assert_eq!(get(&conn, a).unwrap().unwrap().0, "image/png");

        let b = save(&conn, "image/jpeg", b"jpeg bytes", 0).unwrap();
        let doc = format!(r#"{{"type":"doc","content":[{{"type":"image","attrs":{{"src":"noteimg:{a}"}}}}]}}"#);
        conn.execute("INSERT INTO notes (title, body, doc, created_at, updated_at) VALUES ('x', '', ?1, 0, 0)", [doc]).unwrap();
        // Too new to sweep yet; a day later the unused one goes, the used one stays.
        assert_eq!(sweep(&conn, 1_000).unwrap(), 0);
        assert_eq!(sweep(&conn, KEEP_MS + 1).unwrap(), 1);
        assert!(get(&conn, a).unwrap().is_some());
        assert!(get(&conn, b).unwrap().is_none());
    }
}
