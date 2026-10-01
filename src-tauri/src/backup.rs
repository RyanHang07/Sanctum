//! Export and backup (v0.1). Exports are for reading elsewhere: one JSON file, or a folder of CSVs
//! (sessions, planner, trackers, notes, and the rest of your own data). Backups are the whole
//! database, restorable here. Both go under Documents\Sanctum. Sign-ins aren't in either: the
//! refresh tokens live in Windows Credential Manager, not the database.

use crate::{classify, db, engine, Shared};
use rusqlite::types::ValueRef;
use rusqlite::{Connection, OpenFlags};
use serde::Serialize;
use serde_json::{json, Map, Value};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

/// Your data, in export order. Calendar mirrors, caches, and settings stay out.
pub const TABLES: &[&str] = &[
    "sessions",
    "unlock_attempts",
    "blocked_attempts",
    "profiles",
    "profile_rules",
    "distractions",
    "distraction_allows",
    "daily_goals",
    "daily_goal_checks",
    "todos",
    "trackers",
    "tracker_entries",
    "checkin_log",
    "notes",
    "quiet_pauses",
    "tamper_events",
    "activity",
    "idle_periods",
];

const BACKUP_PREFIX: &str = "Sanctum backup ";
const BACKUP_EXT: &str = "sanctum";

fn present(conn: &Connection, table: &str) -> bool {
    conn.query_row("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1", [table], |_| Ok(())).is_ok()
}

fn rows(conn: &Connection, table: &str) -> rusqlite::Result<(Vec<String>, Vec<Vec<Value>>)> {
    // Table names come from TABLES, never from input.
    let mut stmt = conn.prepare(&format!("SELECT * FROM \"{table}\" ORDER BY rowid"))?;
    let cols: Vec<String> = stmt.column_names().iter().map(|c| c.to_string()).collect();
    let n = cols.len();
    let out = stmt
        .query_map([], |r| {
            (0..n)
                .map(|i| {
                    Ok(match r.get_ref(i)? {
                        ValueRef::Null => Value::Null,
                        ValueRef::Integer(v) => json!(v),
                        ValueRef::Real(v) => json!(v),
                        ValueRef::Text(t) => Value::String(String::from_utf8_lossy(t).into_owned()),
                        ValueRef::Blob(b) => Value::String(base64::Engine::encode(&base64::engine::general_purpose::STANDARD, b)),
                    })
                })
                .collect::<rusqlite::Result<Vec<Value>>>()
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok((cols, out))
}

/// Everything in one JSON document: { exportedAt, schema, tables: { name: [ {col: value} ] } }.
pub fn export_json(conn: &Connection, now: i64) -> rusqlite::Result<Value> {
    let mut tables = Map::new();
    for &t in TABLES.iter().filter(|t| present(conn, t)) {
        let (cols, data) = rows(conn, t)?;
        let list: Vec<Value> = data
            .into_iter()
            .map(|r| Value::Object(cols.iter().cloned().zip(r).collect()))
            .collect();
        tables.insert(t.to_string(), Value::Array(list));
    }
    Ok(json!({ "exportedAt": now, "app": "Sanctum", "schema": db::schema_version(conn)?, "tables": tables }))
}

fn csv_field(v: &Value) -> String {
    let s = match v {
        Value::Null => return String::new(),
        Value::String(s) => s.clone(),
        other => other.to_string(),
    };
    if s.contains([',', '"', '\n', '\r']) {
        format!("\"{}\"", s.replace('"', "\"\""))
    } else {
        s
    }
}

/// One CSV per table: (file name, contents). Header row, then rows; RFC 4180 quoting.
pub fn export_csv(conn: &Connection) -> rusqlite::Result<Vec<(String, String)>> {
    let mut files = Vec::new();
    for &t in TABLES.iter().filter(|t| present(conn, t)) {
        let (cols, data) = rows(conn, t)?;
        let mut out = cols.iter().map(|c| csv_field(&Value::String(c.clone()))).collect::<Vec<_>>().join(",");
        out.push_str("\r\n");
        for r in data {
            out.push_str(&r.iter().map(csv_field).collect::<Vec<_>>().join(","));
            out.push_str("\r\n");
        }
        files.push((format!("{t}.csv"), out));
    }
    Ok(files)
}

/// Writes a consistent copy of the live database (safe while it's in use).
pub fn snapshot(conn: &Connection, dest: &Path) -> rusqlite::Result<()> {
    conn.execute("VACUUM INTO ?1", [dest.to_string_lossy().as_ref()])?;
    Ok(())
}

/// A file is restorable when it's a Sanctum database this version can open. Returns its schema.
pub fn check_backup(path: &Path) -> Result<usize, String> {
    let bad = || "That file isn't a Sanctum backup.".to_string();
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX).map_err(|_| bad())?;
    let version = db::schema_version(&conn).map_err(|_| bad())?;
    if version == 0 || !["settings", "sessions", "profiles"].iter().all(|t| present(&conn, t)) {
        return Err(bad());
    }
    if version > db::latest_version() {
        return Err("That backup is from a newer Sanctum. Update first, then restore it.".into());
    }
    Ok(version)
}

fn stamp(now: chrono::DateTime<chrono::Local>) -> String {
    now.format("%Y-%m-%d %H%M%S").to_string()
}

fn folder(app: &AppHandle, sub: &str) -> Result<PathBuf, String> {
    let docs = app.path().document_dir().map_err(|e| e.to_string())?;
    let dir = docs.join("Sanctum").join(sub);
    std::fs::create_dir_all(&dir).map_err(|e| format!("Couldn't create {}: {e}", dir.display()))?;
    Ok(dir)
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FileInfo {
    pub name: String,
    pub path: String,
    pub bytes: u64,
    pub modified_at: i64,
}

fn info(path: &Path) -> Option<FileInfo> {
    let meta = std::fs::metadata(path).ok()?;
    let modified_at = meta.modified().ok()?.duration_since(std::time::UNIX_EPOCH).ok()?.as_millis() as i64;
    Some(FileInfo {
        name: path.file_name()?.to_string_lossy().into_owned(),
        path: path.to_string_lossy().into_owned(),
        bytes: if meta.is_dir() { 0 } else { meta.len() },
        modified_at,
    })
}

#[tauri::command]
pub async fn export_data(app: AppHandle, format: String) -> Result<FileInfo, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dir = folder(&app, "Exports")?;
        let name = format!("Sanctum export {}", stamp(chrono::Local::now()));
        let shared = app.state::<Shared>();
        let conn = shared.db.lock().map_err(|e| e.to_string())?;
        let path = match format.as_str() {
            "json" => {
                let doc = export_json(&conn, crate::session::now_ms()).map_err(|e| e.to_string())?;
                let path = dir.join(format!("{name}.json"));
                std::fs::write(&path, serde_json::to_string_pretty(&doc).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
                path
            }
            "csv" => {
                let path = dir.join(&name);
                std::fs::create_dir_all(&path).map_err(|e| e.to_string())?;
                for (file, body) in export_csv(&conn).map_err(|e| e.to_string())? {
                    std::fs::write(path.join(file), body).map_err(|e| e.to_string())?;
                }
                path
            }
            _ => return Err("Export as JSON or CSV.".into()),
        };
        info(&path).ok_or_else(|| "The export didn't land.".into())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn backup_create(app: AppHandle) -> Result<FileInfo, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dir = folder(&app, "Backups")?;
        let path = dir.join(format!("{BACKUP_PREFIX}{}.{BACKUP_EXT}", stamp(chrono::Local::now())));
        let shared = app.state::<Shared>();
        let conn = shared.db.lock().map_err(|e| e.to_string())?;
        snapshot(&conn, &path).map_err(|e| format!("Couldn't write the backup: {e}"))?;
        info(&path).ok_or_else(|| "The backup didn't land.".into())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Backups in Documents\Sanctum\Backups, newest first. Drop a backup file there to restore it.
#[tauri::command]
pub fn backup_list(app: AppHandle) -> Result<Vec<FileInfo>, String> {
    let dir = folder(&app, "Backups")?;
    let mut list: Vec<FileInfo> = std::fs::read_dir(&dir)
        .map_err(|e| e.to_string())?
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|x| x == BACKUP_EXT))
        .filter_map(|p| info(&p))
        .collect();
    list.sort_by(|a, b| b.modified_at.cmp(&a.modified_at));
    Ok(list)
}

/// Replaces everything on this PC with a backup. The current data is backed up first, so a
/// restore can itself be undone. Never while sealed.
#[tauri::command]
pub async fn backup_restore(app: AppHandle, path: String) -> Result<(), String> {
    {
        let shared = app.state::<Shared>();
        if shared.sealed() || shared.engine.is_active() {
            return Err("Restoring waits until the seal ends.".into());
        }
    }
    tauri::async_runtime::spawn_blocking(move || {
        let dir = folder(&app, "Backups")?;
        let source = PathBuf::from(&path);
        // Only files in the backups folder: nothing else on disk is read in as data.
        if source.parent().map(|p| p != dir.as_path()).unwrap_or(true) {
            return Err("Restore from a file in Documents\\Sanctum\\Backups.".into());
        }
        check_backup(&source)?;
        let shared = app.state::<Shared>();
        let mut conn = shared.db.lock().map_err(|e| e.to_string())?;
        let safety = dir.join(format!("{BACKUP_PREFIX}{} before restore.{BACKUP_EXT}", stamp(chrono::Local::now())));
        snapshot(&conn, &safety).map_err(|e| format!("Couldn't back up the current data first: {e}"))?;
        // Swap in a throwaway connection so the live files can be replaced.
        *conn = Connection::open_in_memory().map_err(|e| e.to_string())?;
        let replace = |from: &Path| -> Result<Connection, String> {
            for ext in ["-wal", "-shm"] {
                let p = PathBuf::from(format!("{}{ext}", shared.db_path.display()));
                if p.exists() {
                    std::fs::remove_file(&p).map_err(|e| e.to_string())?;
                }
            }
            std::fs::copy(from, &shared.db_path).map_err(|e| e.to_string())?;
            let c = db::open(&shared.db_path).map_err(|e| e.to_string())?;
            classify::seed_from_catalog(&c).map_err(|e| e.to_string())?;
            Ok(c)
        };
        match replace(&source) {
            Ok(c) => *conn = c,
            Err(e) => {
                // Put the data back the way it was.
                *conn = replace(&safety)?;
                return Err(format!("Couldn't restore that backup: {e}"));
            }
        }
        drop(conn);
        engine::load_quiet(&app);
        shared.unlock.clear();
        shared.activity.mark_dirty();
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Shows an export or backup in Explorer. Only paths under Documents\Sanctum.
#[tauri::command]
pub fn data_reveal(app: AppHandle, path: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let root = app.path().document_dir().map_err(|e| e.to_string())?.join("Sanctum");
    let p = PathBuf::from(&path);
    let target = if path.is_empty() { folder(&app, "Backups")? } else { p };
    if !target.starts_with(&root) {
        return Err("Only Sanctum's own folders open from here.".into());
    }
    app.opener().reveal_item_in_dir(&target).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fresh() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        db::prepare(&mut conn).unwrap();
        conn.execute("INSERT INTO profiles (id, name, created_at) VALUES (1, 'Deep Work', 0)", []).unwrap();
        conn.execute("INSERT INTO notes (title, body, created_at, updated_at) VALUES ('Ideas', 'one, \"two\"\nthree', 1, 2)", []).unwrap();
        conn
    }

    #[test]
    fn exports_your_tables_as_json_and_csv() {
        let conn = fresh();
        let doc = export_json(&conn, 99).unwrap();
        assert_eq!(doc["schema"], json!(db::latest_version()));
        assert_eq!(doc["tables"]["profiles"][0]["name"], "Deep Work");
        assert_eq!(doc["tables"]["notes"][0]["body"], "one, \"two\"\nthree");
        assert!(doc["tables"].get("settings").is_none());
        let csv = export_csv(&conn).unwrap();
        let notes = &csv.iter().find(|(n, _)| n == "notes.csv").unwrap().1;
        assert!(notes.contains("\"one, \"\"two\"\"\nthree\""));
        assert!(notes.starts_with("id,"));
    }

    #[test]
    fn a_backup_round_trips_and_strangers_are_refused() {
        let conn = fresh();
        let dir = std::env::temp_dir().join(format!("sanctum-backup-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("b.sanctum");
        let _ = std::fs::remove_file(&path);
        snapshot(&conn, &path).unwrap();
        assert_eq!(check_backup(&path).unwrap(), db::latest_version());
        let restored = Connection::open(&path).unwrap();
        let name: String = restored.query_row("SELECT name FROM profiles", [], |r| r.get(0)).unwrap();
        assert_eq!(name, "Deep Work");
        let junk = dir.join("junk.sanctum");
        std::fs::write(&junk, "not a database").unwrap();
        assert!(check_backup(&junk).is_err());
        let empty = dir.join("empty.sanctum");
        let _ = std::fs::remove_file(&empty);
        Connection::open(&empty).unwrap().execute_batch("CREATE TABLE x (a)").unwrap();
        assert!(check_backup(&empty).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
