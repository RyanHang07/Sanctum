//! Notes (decided 2026-09-30): titled notes, unrelated to the day's plan. Autosaved as you type,
//! pinned notes first, then the most recently edited. Stored locally only.
//! v0.2: a note is a block document (`doc`, the editor's JSON) plus `body`, its plain text,
//! which search, previews, and exports read. Notes from before have only a body.

use crate::{session::now_ms, Shared};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::State;

const MAX_TITLE: usize = 200;
const MAX_BODY: usize = 100_000;
/// The document carries structure on top of the text, so it gets more room.
const MAX_DOC: usize = 2_000_000;

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub id: i64,
    pub title: String,
    pub body: String,
    /// The block document (JSON), or None for a note that's only ever been plain text.
    pub doc: Option<String>,
    pub pinned: bool,
    pub created_at: i64,
    pub updated_at: i64,
    /// The live link while the note is shared (v0.2): its URL (key in the #fragment), when it
    /// expires, the key the window encrypts with, and the images already uploaded.
    pub share: Option<NoteShare>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NoteShare {
    pub url: String,
    pub expires_at: i64,
    pub key: String,
    pub image_ids: Vec<i64>,
}

#[derive(Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct NoteDraft {
    #[serde(default)]
    pub id: Option<i64>,
    pub title: String,
    pub body: String,
    /// Left out: the document is kept as it was.
    #[serde(default)]
    pub doc: Option<String>,
}

fn row(r: &rusqlite::Row) -> rusqlite::Result<Note> {
    let share = match (r.get::<_, Option<String>>(7)?, r.get::<_, Option<i64>>(8)?, r.get::<_, Option<String>>(9)?) {
        (Some(token), Some(expires_at), Some(key)) => {
            let images: std::collections::BTreeMap<i64, String> = serde_json::from_str(&r.get::<_, Option<String>>(10)?.unwrap_or_default()).unwrap_or_default();
            Some(NoteShare { url: crate::note_share::share_url(&token, &key), expires_at, key, image_ids: images.into_keys().collect() })
        }
        _ => None,
    };
    Ok(Note { id: r.get(0)?, title: r.get(1)?, body: r.get(2)?, pinned: r.get::<_, i64>(3)? != 0, created_at: r.get(4)?, updated_at: r.get(5)?, doc: r.get(6)?, share })
}

const COLS: &str = "id, title, body, pinned, created_at, updated_at, doc, share_token, share_expires_at, share_key, share_images";

pub fn list(conn: &Connection) -> rusqlite::Result<Vec<Note>> {
    let mut stmt = conn.prepare(&format!("SELECT {COLS} FROM notes ORDER BY pinned DESC, updated_at DESC, id DESC"))?;
    let rows = stmt.query_map([], row)?;
    rows.collect()
}

fn get(conn: &Connection, id: i64) -> Result<Note, String> {
    conn.query_row(&format!("SELECT {COLS} FROM notes WHERE id = ?1"), [id], row)
        .optional()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "That note no longer exists.".into())
}

/// Creates or updates a note. Text is kept as typed, only trimmed to the limits.
pub fn save(conn: &Connection, d: NoteDraft, now: i64) -> Result<Note, String> {
    let title: String = d.title.chars().take(MAX_TITLE).collect();
    if d.body.chars().count() > MAX_BODY || d.doc.as_ref().is_some_and(|x| x.len() > MAX_DOC) {
        return Err("That note is too long. Split it into two.".into());
    }
    if let Some(doc) = &d.doc {
        serde_json::from_str::<serde_json::Value>(doc).map_err(|_| "That note couldn't be saved (its document is damaged).".to_string())?;
    }
    let id = match d.id {
        Some(id) => {
            let n = conn
                .execute(
                    "UPDATE notes SET title = ?1, body = ?2, updated_at = ?3, doc = COALESCE(?4, doc) WHERE id = ?5",
                    params![title, d.body, now, d.doc, id],
                )
                .map_err(|e| e.to_string())?;
            if n == 0 {
                return Err("That note no longer exists.".into());
            }
            id
        }
        None => {
            conn.execute("INSERT INTO notes (title, body, doc, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)", params![title, d.body, d.doc, now])
                .map_err(|e| e.to_string())?;
            conn.last_insert_rowid()
        }
    };
    get(conn, id)
}

pub fn set_pinned(conn: &Connection, id: i64, pinned: bool) -> Result<Note, String> {
    conn.execute("UPDATE notes SET pinned = ?1 WHERE id = ?2", params![pinned as i64, id]).map_err(|e| e.to_string())?;
    get(conn, id)
}

pub fn delete(conn: &Connection, id: i64) -> Result<(), String> {
    conn.execute("DELETE FROM notes WHERE id = ?1", [id]).map(|_| ()).map_err(|e| e.to_string())
}

fn with<T>(shared: &Shared, f: impl FnOnce(&Connection) -> Result<T, String>) -> Result<T, String> {
    let conn = shared.db.lock().map_err(|e| e.to_string())?;
    f(&conn)
}

#[tauri::command]
pub fn list_notes(shared: State<Shared>) -> Result<Vec<Note>, String> {
    with(&shared, |c| list(c).map_err(|e| e.to_string()))
}

#[tauri::command]
pub fn save_note(shared: State<Shared>, draft: NoteDraft) -> Result<Note, String> {
    with(&shared, |c| save(c, draft, now_ms()))
}

#[tauri::command]
pub fn pin_note(shared: State<Shared>, id: i64, pinned: bool) -> Result<Note, String> {
    with(&shared, |c| set_pinned(c, id, pinned))
}

#[tauri::command]
pub fn delete_note(shared: State<Shared>, id: i64) -> Result<(), String> {
    with(&shared, |c| delete(c, id))
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
    fn saves_pins_orders_and_deletes() {
        let conn = fresh();
        let a = save(&conn, NoteDraft { id: None, title: "Books".into(), body: "- Dune".into(), doc: None }, 1).unwrap();
        let b = save(&conn, NoteDraft { id: None, title: "".into(), body: "".into(), doc: None }, 2).unwrap();
        // Most recently edited first.
        assert_eq!(list(&conn).unwrap().iter().map(|n| n.id).collect::<Vec<_>>(), vec![b.id, a.id]);
        let a2 = save(&conn, NoteDraft { id: Some(a.id), title: "Books to read".into(), body: "- Dune\n- Piranesi".into(), doc: None }, 3).unwrap();
        assert_eq!((a2.title.as_str(), a2.created_at, a2.updated_at), ("Books to read", 1, 3));
        set_pinned(&conn, b.id, true).unwrap();
        // Pinned first, even when older.
        assert_eq!(list(&conn).unwrap()[0].id, b.id);
        delete(&conn, b.id).unwrap();
        assert_eq!(list(&conn).unwrap().len(), 1);
        assert!(save(&conn, NoteDraft { id: Some(99), title: "x".into(), body: "".into(), doc: None }, 4).is_err());
        assert!(save(&conn, NoteDraft { id: None, title: "".into(), body: "x".repeat(MAX_BODY + 1), doc: None }, 4).is_err());
    }

    #[test]
    fn keeps_the_document_and_leaves_it_alone_when_not_sent() {
        let conn = fresh();
        let doc = r#"{"type":"doc","content":[{"type":"taskList"}]}"#;
        let n = save(&conn, NoteDraft { id: None, title: "Groceries".into(), body: "eggs".into(), doc: Some(doc.into()) }, 1).unwrap();
        assert_eq!(n.doc.as_deref(), Some(doc));
        // A title-only edit (no doc) keeps the document.
        let n = save(&conn, NoteDraft { id: Some(n.id), title: "Shopping".into(), body: "eggs".into(), doc: None }, 2).unwrap();
        assert_eq!(n.doc.as_deref(), Some(doc));
        assert!(save(&conn, NoteDraft { id: Some(n.id), title: "x".into(), body: "".into(), doc: Some("{not json".into()) }, 3).is_err());
    }
}
