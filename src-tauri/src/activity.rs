//! Activity + idle tracking (SPEC 4.7, 4.8). Every 2s: what's in front, and how long since
//! the last input. Consecutive samples of the same window extend one row. Idle starts at the
//! last input, so the threshold minutes count as idle too. Raw titles stay on this machine,
//! and private windows are stored as "(private)".

use crate::classify::{self, Classifier};
use crate::session::now_ms;
use crate::{blocker, db, profiles, winutil, Shared};
use rusqlite::{params, Connection};
use serde::Serialize;
use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Manager};

pub const SAMPLE_MS: i64 = 2_000;
/// A sample more than this after the last one (sleep, suspend) starts a new row
/// instead of stretching the old one across the gap.
const MAX_STEP_MS: i64 = 10_000;

#[derive(Clone, Debug)]
pub struct Config {
    pub idle_threshold_ms: i64,
    pub retention_days: i64,
    /// Apps that count as present while in front (calls, meetings).
    pub passive: HashSet<String>,
    pub private: HashSet<String>,
}

impl Default for Config {
    fn default() -> Self {
        Config { idle_threshold_ms: 3 * 60_000, retention_days: 30, passive: HashSet::new(), private: HashSet::new() }
    }
}

pub fn load_config(conn: &Connection) -> Config {
    let get = |k: &str| db::get_setting(conn, k).ok().flatten();
    Config {
        idle_threshold_ms: get("idle_threshold_min").and_then(|v| v.parse::<i64>().ok()).filter(|m| *m > 0).unwrap_or(3) * 60_000,
        retention_days: get("activity_retention_days").and_then(|v| v.parse().ok()).filter(|d| *d > 0).unwrap_or(30),
        passive: blocker::parse_always(&get("passive_apps").unwrap_or_default()),
        private: blocker::parse_always(&get("private_apps").unwrap_or_default()),
    }
}

/// What's in front right now.
#[derive(Clone, Debug)]
pub struct Sample {
    pub exe: String,
    pub title: String,
}

#[derive(Clone, Debug)]
struct OpenRow {
    id: i64,
    exe: String,
    title: String,
    category: &'static str,
    session_id: Option<i64>,
    ts: i64,
    ms: i64,
}

/// One reading: when, how long since the last input, what's in front, and the running seal.
#[derive(Clone, Debug)]
pub struct Reading {
    pub now: i64,
    pub idle_ms: i64,
    pub fg: Option<Sample>,
    pub session_id: Option<i64>,
}

#[derive(Debug, PartialEq)]
pub enum Event {
    IdleStarted { since: i64 },
    IdleEnded { since: i64, until: i64 },
}

#[derive(Default)]
pub struct Tracker {
    /// When the current idle stretch began (the last input), or None when active.
    pub idle_since: Option<i64>,
    /// What you were doing when idle began, for "Welcome back".
    pub before_idle: Option<Sample>,
    idle_row: Option<i64>,
    row: Option<OpenRow>,
    last_step: Option<i64>,
}

impl Tracker {
    /// Records one reading. Rows made during a seal are tagged with its session.
    pub fn step(&mut self, conn: &Connection, reading: Reading, cfg: &Config, classifier: &Classifier) -> rusqlite::Result<Option<Event>> {
        let Reading { now, idle_ms, fg, session_id } = reading;
        let passive = fg.as_ref().is_some_and(|s| cfg.passive.contains(&s.exe));
        let idle = idle_ms >= cfg.idle_threshold_ms && !passive;
        let step = self.last_step.map_or(SAMPLE_MS, |t| now - t);
        self.last_step = Some(now);

        if idle {
            if self.idle_since.is_some() {
                return Ok(None);
            }
            let since = now - idle_ms;
            // The open row kept growing through the threshold minutes; trim it back to the last input.
            if let Some(row) = self.row.take() {
                let keep = (since - row.ts).max(0);
                if keep < 1_000 {
                    conn.execute("DELETE FROM activity WHERE id = ?1", [row.id])?;
                } else {
                    conn.execute("UPDATE activity SET duration_s = ?1 WHERE id = ?2", params![keep / 1000, row.id])?;
                }
                self.before_idle = Some(Sample { exe: row.exe, title: row.title });
            }
            conn.execute("INSERT INTO idle_periods (started_at, session_id) VALUES (?1, ?2)", params![since, session_id])?;
            self.idle_row = Some(conn.last_insert_rowid());
            self.idle_since = Some(since);
            return Ok(Some(Event::IdleStarted { since }));
        }

        let mut event = None;
        if let Some(since) = self.idle_since.take() {
            if let Some(id) = self.idle_row.take() {
                conn.execute("UPDATE idle_periods SET ended_at = ?1 WHERE id = ?2", params![now, id])?;
            }
            event = Some(Event::IdleEnded { since, until: now });
        }

        let Some(fg) = fg else {
            self.row = None;
            return Ok(event);
        };
        // Classify on the real title in memory; store the redacted one.
        let category = classifier.classify(&fg.exe, &fg.title);
        let title = classify::redact(&fg.exe, &fg.title, &cfg.private);
        let add = if (0..=MAX_STEP_MS).contains(&step) && event.is_none() { step } else { SAMPLE_MS };

        match self.row.as_mut() {
            Some(r) if r.exe == fg.exe && r.title == title && r.category == category && r.session_id == session_id && add == step => {
                r.ms += add;
                conn.execute("UPDATE activity SET duration_s = ?1 WHERE id = ?2", params![r.ms / 1000, r.id])?;
            }
            _ => {
                conn.execute(
                    "INSERT INTO activity (ts, exe, title, duration_s, category, session_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                    params![now, fg.exe, title, add / 1000, category, session_id],
                )?;
                self.row = Some(OpenRow { id: conn.last_insert_rowid(), exe: fg.exe, title, category, session_id, ts: now, ms: add });
            }
        }
        Ok(event)
    }
}

/// Deletes raw activity older than the retention window (SPEC 4.7).
pub fn prune(conn: &Connection, now: i64, days: i64) -> rusqlite::Result<usize> {
    let cutoff = now - days * 24 * 3_600_000;
    let a = conn.execute("DELETE FROM activity WHERE ts < ?1", [cutoff])?;
    let b = conn.execute("DELETE FROM idle_periods WHERE started_at < ?1 AND ended_at IS NOT NULL", [cutoff])?;
    Ok(a + b)
}

#[derive(Serialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub productive_min: i64,
    pub neutral_min: i64,
    pub distracting_min: i64,
    pub idle_min: i64,
}

pub fn summary(conn: &Connection, since: i64, now: i64) -> rusqlite::Result<Summary> {
    let mut out = Summary::default();
    let mut stmt = conn.prepare("SELECT category, SUM(duration_s) FROM activity WHERE ts >= ?1 GROUP BY category")?;
    let rows = stmt.query_map([since], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))?;
    for row in rows {
        let (cat, s) = row?;
        match cat.as_str() {
            "productive" => out.productive_min = s / 60,
            "distracting" => out.distracting_min = s / 60,
            _ => out.neutral_min += s / 60,
        }
    }
    let idle_ms: Option<i64> = conn.query_row(
        "SELECT SUM(COALESCE(ended_at, ?2) - MAX(started_at, ?1)) FROM idle_periods WHERE COALESCE(ended_at, ?2) > ?1",
        params![since, now],
        |r| r.get(0),
    )?;
    out.idle_min = idle_ms.unwrap_or(0) / 60_000;
    Ok(out)
}

/// Tracker state shared with the engine (which pauses the seal while idle).
pub struct State {
    pub tracker: Mutex<Tracker>,
    /// Set when rules, profiles, or settings change so the tracker reloads them.
    pub dirty: AtomicBool,
}

impl State {
    pub fn new() -> Self {
        State { tracker: Mutex::new(Tracker::default()), dirty: AtomicBool::new(true) }
    }
    pub fn idle_since(&self) -> Option<i64> {
        self.tracker.lock().unwrap().idle_since
    }
    pub fn mark_dirty(&self) {
        self.dirty.store(true, Ordering::Relaxed);
    }
}

fn load_classifier(conn: &Connection, session_profile: Option<i64>) -> Classifier {
    let user = classify::list(conn).unwrap_or_default();
    let all = profiles::list(conn).unwrap_or_default();
    let session = session_profile
        .and_then(|id| all.iter().find(|p| p.id == id))
        .map(classify::profile_rules)
        .unwrap_or_default();
    Classifier { session, user, profiles: all.iter().flat_map(classify::profile_rules).collect() }
}

pub fn spawn(app: AppHandle) {
    std::thread::Builder::new()
        .name("sanctum-activity".into())
        .spawn(move || {
            let mut sys = sysinfo::System::new();
            let mut cfg = Config::default();
            let mut classifier = Classifier::default();
            let mut loaded_for: Option<Option<i64>> = None;
            let mut n: u64 = 0;
            loop {
                let shared = app.state::<Shared>();
                let session = shared.engine.session_ids();
                let profile_id = session.and_then(|s| s.1);
                let reload = shared.activity.dirty.swap(false, Ordering::Relaxed) || loaded_for != Some(profile_id) || n % 30 == 0;
                if reload {
                    if let Ok(conn) = shared.db.lock() {
                        cfg = load_config(&conn);
                        classifier = load_classifier(&conn, profile_id);
                        if n % 1800 == 0 {
                            let _ = prune(&conn, now_ms(), cfg.retention_days);
                        }
                    }
                    loaded_for = Some(profile_id);
                }

                let fg = winutil::foreground().and_then(|f| {
                    use sysinfo::{ProcessRefreshKind, ProcessesToUpdate};
                    let pid = sysinfo::Pid::from_u32(f.pid);
                    sys.refresh_processes_specifics(ProcessesToUpdate::Some(&[pid]), true, ProcessRefreshKind::nothing());
                    let exe = sys.process(pid)?.name().to_string_lossy().to_lowercase();
                    Some(Sample { exe, title: f.title })
                });
                let idle_ms = winutil::idle_ms();
                let event = {
                    let conn = shared.db.lock().unwrap();
                    let mut t = shared.activity.tracker.lock().unwrap();
                    let reading = Reading { now: now_ms(), idle_ms, fg, session_id: session.map(|s| s.0) };
                    t.step(&conn, reading, &cfg, &classifier).ok().flatten()
                };
                if let Some(e) = event {
                    crate::engine::on_idle_event(&app, &e, cfg.idle_threshold_ms);
                }
                n += 1;
                std::thread::sleep(Duration::from_millis(SAMPLE_MS as u64));
            }
        })
        .expect("activity thread");
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::classify::ClassRule;

    const S: i64 = 1_000;
    const MIN: i64 = 60_000;

    fn fresh() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        db::prepare(&mut conn).unwrap();
        for id in [1, 7] {
            conn.execute("INSERT INTO sessions (id, started_at, planned_minutes) VALUES (?1, 0, 60)", [id]).unwrap();
        }
        conn
    }

    /// Shorthand for a reading.
    fn at(now: i64, idle_ms: i64, fg: Option<Sample>, session_id: Option<i64>) -> Reading {
        Reading { now, idle_ms, fg, session_id }
    }

    fn fg(exe: &str, title: &str) -> Option<Sample> {
        Some(Sample { exe: exe.into(), title: title.into() })
    }

    fn cfg() -> Config {
        Config {
            passive: ["zoom.exe".to_string()].into(),
            private: ["1password.exe".to_string()].into(),
            ..Config::default()
        }
    }

    fn classifier() -> Classifier {
        Classifier {
            user: vec![
                ClassRule { id: 0, match_kind: "exe".into(), pattern: "code.exe".into(), category: "productive".into(), source: "user".into() },
                ClassRule { id: 0, match_kind: "domain".into(), pattern: "youtube.com".into(), category: "distracting".into(), source: "user".into() },
            ],
            ..Default::default()
        }
    }

    fn rows(conn: &Connection) -> Vec<(String, String, i64, String)> {
        let mut stmt = conn.prepare("SELECT exe, title, duration_s, category FROM activity ORDER BY id").unwrap();
        stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))).unwrap().map(Result::unwrap).collect()
    }

    #[test]
    fn merges_samples_of_the_same_window() {
        let conn = fresh();
        let (c, k) = (cfg(), classifier());
        let mut t = Tracker::default();
        for i in 0..5 {
            t.step(&conn, at(i * 2 * S, 0, fg("code.exe", "graph.py - Code"), None), &c, &k).unwrap();
        }
        t.step(&conn, at(10 * S, 0, fg("chrome.exe", "Shorts - YouTube - Google Chrome"), Some(7)), &c, &k).unwrap();
        t.step(&conn, at(12 * S, 0, fg("chrome.exe", "New tab - Google Chrome (Incognito)"), Some(7)), &c, &k).unwrap();
        t.step(&conn, at(14 * S, 0, fg("1password.exe", "Chase login"), Some(7)), &c, &k).unwrap();
        assert_eq!(
            rows(&conn),
            vec![
                ("code.exe".into(), "graph.py - Code".into(), 10, "productive".into()),
                ("chrome.exe".into(), "Shorts - YouTube - Google Chrome".into(), 2, "distracting".into()),
                ("chrome.exe".into(), "(private)".into(), 2, "neutral".into()),
                ("1password.exe".into(), "(private)".into(), 2, "neutral".into()),
            ]
        );
    }

    #[test]
    fn idle_starts_at_last_input_and_trims_the_open_row() {
        let conn = fresh();
        let (c, k) = (cfg(), classifier());
        let mut t = Tracker::default();
        // Active in VS Code for 5 minutes; the last input was at 2 minutes.
        let mut now = 0;
        while now <= 5 * MIN {
            let idle = (now - 2 * MIN).max(0);
            if let Some(e) = t.step(&conn, at(now, idle, fg("code.exe", "graph.py - Code"), Some(1)), &c, &k).unwrap() {
                assert_eq!(e, Event::IdleStarted { since: 2 * MIN });
            }
            now += 2 * S;
        }
        assert_eq!(t.idle_since, Some(2 * MIN));
        assert_eq!(rows(&conn)[0].2, 120, "row trimmed back to the last input");
        assert_eq!(t.before_idle.as_ref().unwrap().title, "graph.py - Code");
        // Back after 10 minutes.
        let e = t.step(&conn, at(12 * MIN, 0, fg("code.exe", "graph.py - Code"), Some(1)), &c, &k).unwrap();
        assert_eq!(e, Some(Event::IdleEnded { since: 2 * MIN, until: 12 * MIN }));
        let (start, end, sid): (i64, i64, i64) =
            conn.query_row("SELECT started_at, ended_at, session_id FROM idle_periods", [], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).unwrap();
        assert_eq!((start, end, sid), (2 * MIN, 12 * MIN, 1));
        // A new row starts after idle instead of stretching across it.
        assert_eq!(rows(&conn).len(), 2);
        let s = summary(&conn, 0, 12 * MIN).unwrap();
        assert_eq!((s.productive_min, s.idle_min), (2, 10));
    }

    #[test]
    fn calls_never_count_as_idle() {
        let conn = fresh();
        let mut t = Tracker::default();
        let e = t.step(&conn, at(10 * MIN, 9 * MIN, fg("zoom.exe", "Zoom Meeting"), None), &cfg(), &classifier()).unwrap();
        assert_eq!(e, None);
        assert_eq!(t.idle_since, None);
    }

    #[test]
    fn a_long_gap_starts_a_new_row() {
        let conn = fresh();
        let mut t = Tracker::default();
        t.step(&conn, at(0, 0, fg("code.exe", "a"), None), &cfg(), &classifier()).unwrap();
        t.step(&conn, at(2 * S, 0, fg("code.exe", "a"), None), &cfg(), &classifier()).unwrap();
        // The PC slept for an hour; input resumed right away.
        t.step(&conn, at(3_600 * S, 0, fg("code.exe", "a"), None), &cfg(), &classifier()).unwrap();
        let r = rows(&conn);
        assert_eq!(r.len(), 2);
        assert_eq!((r[0].2, r[1].2), (4, 2));
    }

    #[test]
    fn prunes_old_rows() {
        let conn = fresh();
        let day = 24 * 3_600_000;
        conn.execute("INSERT INTO activity (ts, exe, duration_s) VALUES (?1, 'a.exe', 5), (?2, 'b.exe', 5)", params![0, 40 * day]).unwrap();
        assert_eq!(prune(&conn, 41 * day, 30).unwrap(), 1);
        assert_eq!(rows(&conn).len(), 1);
    }
}

#[cfg(all(test, windows))]
mod machine {
    /// Reads the real foreground window and idle time. `cargo test reads_this_machine -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn reads_this_machine() {
        let fg = crate::winutil::foreground();
        println!("foreground: {:?}", fg.map(|f| (f.pid, f.title)));
        let idle = crate::winutil::idle_ms();
        println!("idle ms: {idle}");
        assert!((0..7 * 24 * 3_600_000).contains(&idle));
    }
}
