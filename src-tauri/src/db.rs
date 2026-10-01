//! Local SQLite (SPEC 5.1). Migrations are embedded SQL files applied in order and tracked
//! with `PRAGMA user_version`, so migration N is applied exactly once.

use rusqlite::{params, Connection, OptionalExtension};
use std::path::Path;

pub const MIGRATIONS: &[(&str, &str)] = &[
    ("0001_init", include_str!("../migrations/0001_init.sql")),
    ("0002_profiles", include_str!("../migrations/0002_profiles.sql")),
    ("0003_sessions", include_str!("../migrations/0003_sessions.sql")),
    ("0004_activity", include_str!("../migrations/0004_activity.sql")),
    ("0005_planner", include_str!("../migrations/0005_planner.sql")),
    ("0006_gcal", include_str!("../migrations/0006_gcal.sql")),
    ("0007_browser", include_str!("../migrations/0007_browser.sql")),
    ("0008_distractions", include_str!("../migrations/0008_distractions.sql")),
    ("0009_trackers", include_str!("../migrations/0009_trackers.sql")),
    ("0010_guard", include_str!("../migrations/0010_guard.sql")),
    ("0011_tamper", include_str!("../migrations/0011_tamper.sql")),
    ("0012_notes", include_str!("../migrations/0012_notes.sql")),
    ("0013_session_task", include_str!("../migrations/0013_session_task.sql")),
    ("0014_quiet", include_str!("../migrations/0014_quiet.sql")),
    ("0015_gcal_series", include_str!("../migrations/0015_gcal_series.sql")),
    ("0016_todo_sort", include_str!("../migrations/0016_todo_sort.sql")),
];

/// Every table SPEC 5.1 requires.
pub const EXPECTED_TABLES: &[&str] = &[
    "activity",
    "blocked_attempts",
    "checkin_log",
    "checkins",
    "classification_rules",
    "daily_goal_checks",
    "daily_goals",
    "distractions",
    "idle_periods",
    "notes",
    "profile_rules",
    "profiles",
    "sessions",
    "settings",
    "tamper_events",
    "todos",
    "tracker_entries",
    "trackers",
    "unlock_attempts",
];

pub fn open(path: &Path) -> rusqlite::Result<Connection> {
    let mut conn = Connection::open(path)?;
    conn.query_row("PRAGMA journal_mode = WAL", [], |_| Ok(()))?;
    prepare(&mut conn)?;
    Ok(conn)
}

/// Connection setup shared by the app and the tests (which use an in-memory DB).
pub fn prepare(conn: &mut Connection) -> rusqlite::Result<usize> {
    conn.pragma_update(None, "foreign_keys", true)?;
    migrate(conn)
}

pub fn schema_version(conn: &Connection) -> rusqlite::Result<usize> {
    conn.pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0))
        .map(|v| v as usize)
}

/// Applies pending migrations, each in its own transaction. Returns how many ran.
pub fn migrate(conn: &mut Connection) -> rusqlite::Result<usize> {
    let current = schema_version(conn)?;
    let mut applied = 0;
    for (i, (_name, sql)) in MIGRATIONS.iter().enumerate().skip(current) {
        let tx = conn.transaction()?;
        tx.execute_batch(sql)?;
        tx.pragma_update(None, "user_version", (i + 1) as i64)?;
        tx.commit()?;
        applied += 1;
    }
    Ok(applied)
}

pub fn tables(conn: &Connection) -> rusqlite::Result<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )?;
    let rows = stmt.query_map([], |r| r.get(0))?;
    rows.collect()
}

/// The schema this build migrates to.
pub fn latest_version() -> usize {
    MIGRATIONS.len()
}

pub struct Status {
    pub ready: bool,
    pub version: usize,
    pub tables: Vec<String>,
}

pub fn status(conn: &Connection) -> rusqlite::Result<Status> {
    let version = schema_version(conn)?;
    let tables = tables(conn)?;
    let ready = version == MIGRATIONS.len() && EXPECTED_TABLES.iter().all(|t| tables.iter().any(|x| x == t));
    Ok(Status { ready, version, tables })
}

pub fn get_setting(conn: &Connection, key: &str) -> rusqlite::Result<Option<String>> {
    conn.query_row("SELECT value FROM settings WHERE key = ?1", [key], |r| r.get(0))
        .optional()
}

pub fn set_setting(conn: &Connection, key: &str, value: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fresh() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        prepare(&mut conn).unwrap();
        conn
    }

    #[test]
    fn migration_creates_every_spec_table() {
        let conn = fresh();
        let s = status(&conn).unwrap();
        assert!(s.ready);
        assert_eq!(s.version, MIGRATIONS.len());
        for t in EXPECTED_TABLES {
            assert!(s.tables.iter().any(|x| x == t), "missing table {t}");
        }
    }

    #[test]
    fn migration_is_idempotent() {
        let mut conn = fresh();
        assert_eq!(migrate(&mut conn).unwrap(), 0);
        assert_eq!(schema_version(&conn).unwrap(), MIGRATIONS.len());
    }

    #[test]
    fn migration_survives_reopen_on_disk() {
        let path = std::env::temp_dir().join(format!("sanctum-test-{}.db", std::process::id()));
        let _ = std::fs::remove_file(&path);
        {
            let conn = open(&path).unwrap();
            set_setting(&conn, "close_action", "tray").unwrap();
        }
        let conn = open(&path).unwrap();
        assert!(status(&conn).unwrap().ready);
        assert_eq!(get_setting(&conn, "close_action").unwrap().as_deref(), Some("tray"));
        drop(conn);
        for ext in ["", "-wal", "-shm"] {
            let _ = std::fs::remove_file(format!("{}{ext}", path.display()));
        }
    }

    #[test]
    fn seeds_default_settings_and_round_trips() {
        let conn = fresh();
        assert_eq!(get_setting(&conn, "on_login").unwrap().as_deref(), Some("home"));
        assert_eq!(get_setting(&conn, "close_action").unwrap().as_deref(), Some("ask"));
        assert_eq!(get_setting(&conn, "daily_reset_time").unwrap().as_deref(), Some("04:00"));
        set_setting(&conn, "on_login", "tray").unwrap();
        assert_eq!(get_setting(&conn, "on_login").unwrap().as_deref(), Some("tray"));
        assert_eq!(get_setting(&conn, "missing").unwrap(), None);
    }

    #[test]
    fn enforces_constraints_and_foreign_keys() {
        let conn = fresh();
        // 30 minutes is the minimum focus length.
        assert!(conn
            .execute("INSERT INTO profiles (name, default_minutes, created_at) VALUES ('Short', 15, 0)", [])
            .is_err());
        conn.execute("INSERT INTO profiles (name, created_at) VALUES ('Deep Work', 0)", []).unwrap();
        let id = conn.last_insert_rowid();
        conn.execute("INSERT INTO profile_rules (profile_id, kind, value) VALUES (?1, 'app', 'discord.exe')", [id])
            .unwrap();
        assert!(conn
            .execute("INSERT INTO profile_rules (profile_id, kind, value) VALUES (?1, 'bogus', 'x')", [id])
            .is_err());
        conn.execute("DELETE FROM profiles WHERE id = ?1", [id]).unwrap();
        let left: i64 = conn.query_row("SELECT COUNT(*) FROM profile_rules", [], |r| r.get(0)).unwrap();
        assert_eq!(left, 0);
    }
}
