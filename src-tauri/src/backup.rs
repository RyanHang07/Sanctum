//! Export and backup (v0.1). Exports are for reading elsewhere: one JSON file, or a folder of CSVs
//! (sessions, planner, trackers, notes, and the rest of your own data). Backups are the whole
//! database, restorable here. Both go under Documents\Sanctum. Sign-ins aren't in either: the
//! refresh tokens live in Windows Credential Manager, not the database.

use crate::engine::Locked;
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

/// Writes a consistent copy of the live database (safe while it's in use). The copy is one
/// self-contained file: the live database runs in WAL mode, and a copy that kept that header
/// would need its -wal and -shm files to open.
pub fn snapshot(conn: &Connection, dest: &Path) -> rusqlite::Result<()> {
    conn.execute("VACUUM INTO ?1", [dest.to_string_lossy().as_ref()])?;
    let copy = Connection::open(dest)?;
    copy.query_row("PRAGMA journal_mode = DELETE", [], |_| Ok(()))?;
    Ok(())
}

/// A restored backup may come from mid-seal. That seal is long over: close it, so neither the
/// guard nor the next start treats this PC as sealed.
pub fn close_open_sessions(conn: &Connection) -> rusqlite::Result<usize> {
    conn.execute(
        "UPDATE sessions SET outcome = 'broken', ended_at = COALESCE(last_seen_at, started_at) WHERE ended_at IS NULL",
        [],
    )
}

/// A file is restorable when it's a Sanctum database this version can open. Returns its schema.
pub fn check_backup(path: &Path) -> Result<usize, String> {
    let bad = || "That file isn't a Sanctum backup.".to_string();
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX).map_err(|_| bad())?;
    conn.query_row("SELECT count(*) FROM sqlite_master", [], |_| Ok(())).map_err(|_| bad())?;
    let version = db::schema_version(&conn).map_err(|_| bad())?;
    if version == 0 || !["settings", "sessions", "profiles"].iter().all(|t| present(&conn, t)) {
        return Err(bad());
    }
    if version > db::latest_version() {
        return Err("That backup is from a newer Sanctum. Update first, then restore it.".into());
    }
    Ok(version)
}

pub(crate) fn stamp(now: chrono::DateTime<chrono::Local>) -> String {
    now.format("%Y-%m-%d %H%M%S").to_string()
}

pub(crate) fn folder(app: &AppHandle, sub: &str) -> Result<PathBuf, String> {
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

pub(crate) fn info(path: &Path) -> Option<FileInfo> {
    let meta = std::fs::metadata(path).ok()?;
    let modified_at = meta.modified().ok()?.duration_since(std::time::UNIX_EPOCH).ok()?.as_millis() as i64;
    Some(FileInfo {
        name: path.file_name()?.to_string_lossy().into_owned(),
        path: path.to_string_lossy().into_owned(),
        bytes: if meta.is_dir() { 0 } else { meta.len() },
        modified_at,
    })
}

/// A read-only connection of its own for exports and backups (2026-11-17). They used to hold the
/// app's connection, and its lock, through VACUUM INTO and the file writes, which stalled the
/// engine tick and every command behind it. In WAL mode this reads one consistent snapshot
/// while the app keeps writing.
pub fn reader(path: &Path) -> rusqlite::Result<Connection> {
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX)?;
    conn.busy_timeout(std::time::Duration::from_secs(5))?;
    Ok(conn)
}

#[tauri::command]
pub async fn export_data(app: AppHandle, format: String) -> Result<FileInfo, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dir = folder(&app, "Exports")?;
        let name = format!("Sanctum export {}", stamp(chrono::Local::now()));
        let mut conn = reader(&app.state::<Shared>().db_path).map_err(|e| e.to_string())?;
        // One read transaction, so every table comes from the same moment.
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        let path = match format.as_str() {
            "json" => {
                let doc = export_json(&tx, crate::session::now_ms()).map_err(|e| e.to_string())?;
                drop(tx);
                let path = dir.join(format!("{name}.json"));
                std::fs::write(&path, serde_json::to_string_pretty(&doc).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
                path
            }
            "csv" => {
                let files = export_csv(&tx).map_err(|e| e.to_string())?;
                drop(tx);
                let path = dir.join(&name);
                std::fs::create_dir_all(&path).map_err(|e| e.to_string())?;
                for (file, body) in files {
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
        let conn = reader(&app.state::<Shared>().db_path).map_err(|e| format!("Couldn't write the backup: {e}"))?;
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
    list.sort_by_key(|f| std::cmp::Reverse(f.modified_at));
    Ok(list)
}

/// Safety copies of each kind kept (2026-11-17, the user's call): "Backups before updates" and
/// the "before restore" snapshots used to pile up forever.
pub const KEEP: usize = 3;

/// "before v31 2026-11-17 093000" (a folder in Backups before updates): its time.
pub fn update_stamp(name: &str) -> Option<chrono::NaiveDateTime> {
    let (_, at) = name.strip_prefix("before v")?.split_once(' ')?;
    chrono::NaiveDateTime::parse_from_str(at, "%Y-%m-%d %H%M%S").ok()
}

/// "Sanctum backup 2026-11-17 093000 before restore.sanctum": its time. Your own backups don't
/// match and are never pruned.
pub fn restore_stamp(name: &str) -> Option<chrono::NaiveDateTime> {
    let at = name.strip_prefix(BACKUP_PREFIX)?.strip_suffix(&format!(" before restore.{BACKUP_EXT}"))?;
    chrono::NaiveDateTime::parse_from_str(at, "%Y-%m-%d %H%M%S").ok()
}

/// Deletes all but the `keep` newest entries in `dir` whose names `stamp` reads, never `made`
/// (the one just written, even if the clock says it's older). Links and junctions are skipped,
/// never followed or removed. Returns how many went.
pub fn keep_newest(dir: &Path, keep: usize, made: &Path, stamp: fn(&str) -> Option<chrono::NaiveDateTime>) -> usize {
    let Ok(entries) = std::fs::read_dir(dir) else { return 0 };
    let mut found: Vec<(chrono::NaiveDateTime, PathBuf)> = entries
        .flatten()
        .filter(|e| e.path() != made)
        .filter(|e| std::fs::symlink_metadata(e.path()).is_ok_and(|m| !is_link(&m)))
        .filter_map(|e| Some((stamp(&e.file_name().to_string_lossy())?, e.path())))
        .collect();
    found.sort_by_key(|(at, _)| std::cmp::Reverse(*at));
    // The one just made is one of the kept.
    let mut gone = 0;
    for (_, p) in found.iter().skip(keep.saturating_sub(1)) {
        let removed = if p.is_dir() { std::fs::remove_dir_all(p) } else { std::fs::remove_file(p) };
        gone += usize::from(removed.is_ok());
    }
    gone
}

/// A symlink, or on Windows any reparse point (junctions included).
fn is_link(m: &std::fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if m.file_attributes() & 0x400 != 0 {
            return true;
        }
    }
    m.file_type().is_symlink()
}

/// Settings that describe this PC's standing, not its data (2026-11-17): Start over and Restore
/// keep them, so an older backup can't forget the partner link or give back today's emergency
/// unlock.
pub(crate) const CARRIED: &[&str] = &[crate::cloud::K_PARTNER_LINKED, crate::cloud::K_PARTNER_NAME, "emergency_used_at", "emergency_used_uptime"];

pub(crate) fn carried_settings(conn: &rusqlite::Connection) -> Vec<(&'static str, String)> {
    CARRIED.iter().filter_map(|k| db::get_setting(conn, k).ok().flatten().map(|v| (*k, v))).collect()
}

pub(crate) fn restore_carried(conn: &rusqlite::Connection, carried: &[(&'static str, String)]) -> Result<(), String> {
    for (k, v) in carried {
        db::set_setting(conn, k, v).map_err(|e| e.to_string())?;
    }
    Ok(())
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
        // Held for the whole restore (2026-11-17), so no seal starts part way.
        let _claim = shared.engine.begin_start().map_err(|_| "Restoring waits until the seal ends.".to_string())?;
        if shared.sealed() {
            return Err("Restoring waits until the seal ends.".into());
        }
        let mut conn = shared.db.locked();
        // Checked again under the database lock; with the claim held this can't deadlock.
        if shared.engine.is_active() {
            return Err("Restoring waits until the seal ends.".into());
        }
        let carried = carried_settings(&conn);
        let safety = dir.join(format!("{BACKUP_PREFIX}{} before restore.{BACKUP_EXT}", stamp(chrono::Local::now())));
        snapshot(&conn, &safety).map_err(|e| format!("Couldn't back up the current data first: {e}"))?;
        keep_newest(&dir, KEEP, &safety, restore_stamp);
        // On any failure the current data stays, and so does a real connection (db::replace).
        db::replace(
            &mut conn,
            &shared.db_path,
            |to| std::fs::copy(&source, to).map(|_| ()).map_err(|e| e.to_string()),
            |c| {
                restore_carried(c, &carried)?;
                classify::seed_from_catalog(c).map_err(|e| e.to_string())?;
                close_open_sessions(c).map(|_| ()).map_err(|e| e.to_string())
            },
        )
        .map_err(|e| format!("Couldn't restore that backup: {e}"))?;
        shared.replaced();
        drop(conn);
        engine::load_quiet(&app);
        engine::load_pause(&app);
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
    fn start_over_and_restore_keep_the_partner_link_and_the_emergency_day() {
        let old = fresh();
        db::set_setting(&old, crate::cloud::K_PARTNER_LINKED, "1").unwrap();
        db::set_setting(&old, crate::cloud::K_PARTNER_NAME, "Sam").unwrap();
        db::set_setting(&old, "emergency_used_at", "123").unwrap();
        db::set_setting(&old, "display_name", "Ryan").unwrap();
        let carried = carried_settings(&old);
        // A backup from before the partner, with no emergency used.
        let restored = fresh();
        restore_carried(&restored, &carried).unwrap();
        assert_eq!(crate::cloud::remembered_partner(&restored).as_deref(), Some("Sam"));
        assert_eq!(db::get_setting(&restored, "emergency_used_at").unwrap().as_deref(), Some("123"));
        // Ordinary data isn't carried.
        assert_eq!(db::get_setting(&restored, "display_name").unwrap(), None);
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
    fn a_backup_of_a_live_wal_database_opens_alone_and_comes_back_unsealed() {
        let dir = std::env::temp_dir().join(format!("sanctum-backup-wal-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let live = dir.join("live.db");
        let copy = dir.join("copy.sanctum");
        for p in [&live, &copy] {
            let _ = std::fs::remove_file(p);
        }
        let conn = db::open(&live).unwrap();
        conn.execute("INSERT INTO profiles (id, name, created_at) VALUES (1, 'Deep Work', 0)", []).unwrap();
        // Mid-seal: a session with no end.
        conn.execute("INSERT INTO sessions (profile_id, started_at, planned_minutes, last_seen_at) VALUES (1, 1000, 60, 5000)", []).unwrap();
        snapshot(&conn, &copy).unwrap();
        drop(conn);
        // Opens read-only with no -wal or -shm beside it.
        assert_eq!(check_backup(&copy).unwrap(), db::latest_version());
        let restored = Connection::open(&copy).unwrap();
        assert_eq!(close_open_sessions(&restored).unwrap(), 1);
        let (outcome, ended): (String, i64) = restored.query_row("SELECT outcome, ended_at FROM sessions", [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
        assert_eq!((outcome.as_str(), ended), ("broken", 5000));
        drop(restored);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn only_the_three_newest_safety_copies_of_each_kind_are_kept() {
        let dir = std::env::temp_dir().join(format!("sanctum-backup-keep-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let (updates, backups) = (dir.join("Backups before updates"), dir.join("Backups"));
        for d in 1..=5 {
            std::fs::create_dir_all(updates.join(format!("before v{} 2026-11-0{d} 120000", 25 + d))).unwrap();
        }
        std::fs::create_dir_all(&backups).unwrap();
        for d in 1..=5 {
            std::fs::write(backups.join(format!("Sanctum backup 2026-11-0{d} 120000 before restore.sanctum")), "x").unwrap();
        }
        // Your own backups and anything else in the folders are never touched.
        std::fs::write(backups.join("Sanctum backup 2026-01-01 120000.sanctum"), "mine").unwrap();
        std::fs::create_dir_all(updates.join("notes")).unwrap();
        // The one just made sorts oldest (the clock went back) and is still kept.
        let made = updates.join("before v31 2025-01-01 120000");
        std::fs::create_dir_all(&made).unwrap();
        assert_eq!(keep_newest(&updates, KEEP, &made, update_stamp), 3);
        let mut left: Vec<String> = std::fs::read_dir(&updates).unwrap().flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
        left.sort();
        assert_eq!(left, ["before v29 2026-11-04 120000", "before v30 2026-11-05 120000", "before v31 2025-01-01 120000", "notes"]);
        let made = backups.join("Sanctum backup 2026-11-06 120000 before restore.sanctum");
        std::fs::write(&made, "x").unwrap();
        assert_eq!(keep_newest(&backups, KEEP, &made, restore_stamp), 3);
        let mut left: Vec<String> = std::fs::read_dir(&backups).unwrap().flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
        left.sort();
        assert_eq!(
            left,
            [
                "Sanctum backup 2026-01-01 120000.sanctum",
                "Sanctum backup 2026-11-04 120000 before restore.sanctum",
                "Sanctum backup 2026-11-05 120000 before restore.sanctum",
                "Sanctum backup 2026-11-06 120000 before restore.sanctum",
            ]
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// A junction named like an old copy is left alone, and so is what it points at.
    #[cfg(windows)]
    #[test]
    fn pruning_never_follows_a_junction() {
        let dir = std::env::temp_dir().join(format!("sanctum-backup-junction-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let (updates, target) = (dir.join("updates"), dir.join("elsewhere"));
        std::fs::create_dir_all(&target).unwrap();
        std::fs::write(target.join("precious.txt"), "keep").unwrap();
        for d in 1..=3 {
            std::fs::create_dir_all(updates.join(format!("before v30 2026-11-1{d} 120000"))).unwrap();
        }
        let link = updates.join("before v20 2020-01-01 120000");
        let ok = std::process::Command::new("cmd").args(["/C", "mklink", "/J"]).arg(&link).arg(&target).output().unwrap().status.success();
        assert!(ok, "mklink /J");
        let made = updates.join("before v31 2026-11-20 120000");
        std::fs::create_dir_all(&made).unwrap();
        assert_eq!(keep_newest(&updates, KEEP, &made, update_stamp), 1);
        assert!(std::fs::symlink_metadata(&link).is_ok(), "the junction stays");
        assert!(target.join("precious.txt").exists());
        std::fs::remove_dir(&link).unwrap();
        let _ = std::fs::remove_dir_all(&dir);
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
