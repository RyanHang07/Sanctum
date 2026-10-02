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
    ("0017_todo_undated", include_str!("../migrations/0017_todo_undated.sql")),
    ("0018_focus_15min", include_str!("../migrations/0018_focus_15min.sql")),
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

/// A migration that rebuilds a table other tables point at starts with this line. It runs with
/// foreign keys off (dropping the old table would otherwise cascade), then checks them before
/// committing. SQLite only honors the pragma outside a transaction, so it's set around it.
const FOREIGN_KEYS_OFF: &str = "-- foreign_keys: off";

/// Applies pending migrations, each in its own transaction. Returns how many ran.
pub fn migrate(conn: &mut Connection) -> rusqlite::Result<usize> {
    migrate_until(conn, MIGRATIONS.len())
}

fn migrate_until(conn: &mut Connection, until: usize) -> rusqlite::Result<usize> {
    let current = schema_version(conn)?;
    let mut applied = 0;
    for (i, (_name, sql)) in MIGRATIONS.iter().enumerate().take(until).skip(current) {
        let rebuild = sql.starts_with(FOREIGN_KEYS_OFF);
        if rebuild {
            conn.pragma_update(None, "foreign_keys", false)?;
        }
        let result = (|| {
            let tx = conn.transaction()?;
            tx.execute_batch(sql)?;
            if rebuild {
                let broken: i64 = tx.query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |r| r.get(0))?;
                if broken > 0 {
                    return Err(rusqlite::Error::SqliteFailure(
                        rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_CONSTRAINT_FOREIGNKEY),
                        Some(format!("migration {} left {broken} broken references", i + 1)),
                    ));
                }
            }
            tx.pragma_update(None, "user_version", (i + 1) as i64)?;
            tx.commit()
        })();
        if rebuild {
            conn.pragma_update(None, "foreign_keys", true)?;
        }
        result?;
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

    #[test]
    fn sessions_take_15_minutes_and_keep_their_history_through_the_rebuild() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", true).unwrap();
        migrate_until(&mut conn, 17).unwrap();
        conn.execute_batch(
            "INSERT INTO sessions (id, started_at, planned_minutes, profile_name, attempts_blocked) VALUES (1, 100, 60, 'Deep Work', 2);
             INSERT INTO blocked_attempts (session_id, ts, exe, kind) VALUES (1, 110, 'discord.exe', 'app'), (1, 120, 'youtube.com', 'site');
             INSERT INTO activity (ts, exe, session_id) VALUES (105, 'code.exe', 1);
             INSERT INTO profiles (id, name, created_at) VALUES (1, 'Deep Work', 0);
             INSERT INTO profile_rules (profile_id, kind, value) VALUES (1, 'app', 'discord.exe');
             UPDATE sessions SET profile_id = 1 WHERE id = 1;",
        )
        .unwrap();
        assert!(conn.execute("INSERT INTO sessions (started_at, planned_minutes) VALUES (200, 15)", []).is_err(), "the old check");
        migrate(&mut conn).unwrap();
        let count = |sql: &str| conn.query_row(sql, [], |r| r.get::<_, i64>(0)).unwrap();
        assert_eq!(count("SELECT COUNT(*) FROM blocked_attempts WHERE session_id = 1"), 2, "nothing cascaded");
        assert_eq!(count("SELECT COUNT(*) FROM activity WHERE session_id = 1"), 1);
        assert_eq!(count("SELECT attempts_blocked FROM sessions WHERE id = 1"), 2);
        assert_eq!(count("SELECT COUNT(*) FROM profile_rules WHERE profile_id = 1"), 1, "profile rules kept");
        assert_eq!(count("SELECT profile_id FROM sessions WHERE id = 1"), 1);
        conn.execute("UPDATE profiles SET default_minutes = 15 WHERE id = 1", []).unwrap();
        conn.execute("INSERT INTO sessions (started_at, planned_minutes) VALUES (200, 15)", []).unwrap();
        assert!(conn.execute("INSERT INTO sessions (started_at, planned_minutes) VALUES (200, 10)", []).is_err());
        let fk: bool = conn.pragma_query_value(None, "foreign_keys", |r| r.get(0)).unwrap();
        assert!(fk, "foreign keys back on");
        // Deleting a session still cascades as before.
        conn.execute("DELETE FROM sessions WHERE id = 1", []).unwrap();
        assert_eq!(count("SELECT COUNT(*) FROM blocked_attempts"), 0);
    }

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
        // 15 minutes is the minimum focus length.
        assert!(conn
            .execute("INSERT INTO profiles (name, default_minutes, created_at) VALUES ('Short', 10, 0)", [])
            .is_err());
        conn.execute("INSERT INTO profiles (name, default_minutes, created_at) VALUES ('Quick', 15, 0)", []).unwrap();
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
