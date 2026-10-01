//! Focus sessions (SPEC 4.0, 6, 4.0.3). The end time is fixed in wall-clock time when the
//! session starts; while running, time advances on a monotonic clock so changing the system
//! clock can't shorten a seal. State is persisted every 10s so a restart can resume.

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::time::Instant;

/// Downtime longer than this (Sanctum killed, crashed, or the PC off) breaks the session.
pub const GAP_LIMIT_MS: i64 = 60_000;
pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[derive(Clone, Debug)]
pub struct Active {
    pub id: i64,
    pub profile_id: Option<i64>,
    pub profile_name: String,
    pub planned_ms: i64,
    pub started_at: i64,
    /// Planned end, before idle extensions.
    pub ends_at: i64,
    pub gap_ms: i64,
    pub broken: bool,
    pub attempts: i64,
    /// Enforced app and keyword rules, for "N apps sealed".
    pub sealed_count: i64,
    /// Finished idle stretches during this seal; the end moves later by this much (SPEC 4.8).
    pub idle_ms: i64,
    /// When the current idle stretch began (last input), if idle now.
    pub idle_since: Option<i64>,
    /// Broken by tampering (clock, guard, extension); the partner already heard.
    pub tampered: bool,
    /// The Today task this session is for, if one was picked.
    pub task: Option<TaskLink>,
    anchor_wall: i64,
    anchor_mono: Instant,
}

impl Active {
    /// Wall time as measured by the monotonic clock since the session was (re)anchored.
    pub fn now(&self) -> i64 {
        self.anchor_wall + self.anchor_mono.elapsed().as_millis() as i64
    }
    fn current_idle(&self, now: i64) -> i64 {
        self.idle_since.map_or(0, |s| (now - s.max(self.started_at)).max(0))
    }
    /// End time including idle so far, which keeps moving while idle.
    pub fn effective_end(&self) -> i64 {
        self.ends_at + self.idle_ms + self.current_idle(self.now())
    }
    pub fn remaining_ms(&self) -> i64 {
        (self.effective_end() - self.now()).max(0)
    }
    /// Follows the tracker's idle state. Returns the new idle total when a stretch ends,
    /// so the caller can persist it.
    pub fn set_idle(&mut self, since: Option<i64>) -> Option<i64> {
        match (self.idle_since, since) {
            (None, Some(s)) => {
                self.idle_since = Some(s.max(self.started_at));
                None
            }
            (Some(_), None) => {
                self.idle_ms += self.current_idle(self.now());
                self.idle_since = None;
                Some(self.idle_ms)
            }
            _ => None,
        }
    }
    pub fn view(&self) -> SessionView {
        let remaining = self.remaining_ms();
        SessionView {
            id: self.id,
            profile_id: self.profile_id,
            profile_name: self.profile_name.clone(),
            planned_minutes: self.planned_ms / 60_000,
            started_at: self.started_at,
            ends_at: self.effective_end(),
            remaining_ms: remaining,
            elapsed_ms: self.planned_ms - remaining,
            attempts: self.attempts,
            sealed_count: self.sealed_count,
            broken: self.broken,
            idle: self.idle_since.is_some(),
            task: self.task.clone(),
        }
    }
    pub fn held(&self) -> HeldStats {
        HeldStats {
            session_id: self.id,
            profile_id: self.profile_id,
            profile_name: self.profile_name.clone(),
            planned_minutes: self.planned_ms / 60_000,
            focus_minutes: ((self.planned_ms - self.gap_ms).max(0)) / 60_000,
            attempts: self.attempts,
            broken: self.broken,
            task: self.task.clone(),
        }
    }
}

/// A Today task a session is for: a one-time item, or a routine on its date.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TaskLink {
    /// "todo" or "routine".
    pub kind: String,
    pub id: i64,
    /// 'YYYY-MM-DD': the routine's day (a todo's due date).
    pub date: String,
    pub title: String,
}

impl TaskLink {
    pub fn valid(&self) -> bool {
        matches!(self.kind.as_str(), "todo" | "routine") && self.id > 0 && !self.title.trim().is_empty()
    }
}

/// Links a session to a task. The title is copied so it reads after a rename or delete.
pub fn set_task(conn: &Connection, id: i64, task: &TaskLink) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE sessions SET task_kind = ?1, task_id = ?2, task_date = ?3, task_title = ?4 WHERE id = ?5",
        params![task.kind, task.id, task.date, task.title.trim(), id],
    )?;
    Ok(())
}

fn load_task(conn: &Connection, id: i64) -> rusqlite::Result<Option<TaskLink>> {
    conn.query_row("SELECT task_kind, task_id, task_date, task_title FROM sessions WHERE id = ?1", [id], |r| {
        Ok(match (r.get::<_, Option<String>>(0)?, r.get::<_, Option<i64>>(1)?, r.get::<_, Option<String>>(2)?, r.get::<_, Option<String>>(3)?) {
            (Some(kind), Some(task_id), Some(date), Some(title)) => Some(TaskLink { kind, id: task_id, date, title }),
            _ => None,
        })
    })
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionView {
    pub id: i64,
    pub profile_id: Option<i64>,
    pub profile_name: String,
    pub planned_minutes: i64,
    pub started_at: i64,
    pub ends_at: i64,
    pub remaining_ms: i64,
    pub elapsed_ms: i64,
    pub attempts: i64,
    pub sealed_count: i64,
    pub broken: bool,
    /// Idle right now: the countdown is paused.
    pub idle: bool,
    pub task: Option<TaskLink>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HeldStats {
    pub session_id: i64,
    pub profile_id: Option<i64>,
    pub profile_name: String,
    pub planned_minutes: i64,
    pub focus_minutes: i64,
    pub attempts: i64,
    pub broken: bool,
    /// The task the session was for; the held page offers to check it off.
    pub task: Option<TaskLink>,
}

#[derive(Debug, PartialEq)]
pub enum Resume {
    Continue { remaining_ms: i64, gap_ms: i64, broken: bool },
    Finished { outcome: &'static str, gap_ms: i64 },
}

/// What to do with an unfinished session found at startup.
pub fn resume_decision(now: i64, started_at: i64, ends_at: i64, last_seen_at: Option<i64>, already_broken: bool) -> Resume {
    let last = last_seen_at.unwrap_or(started_at).max(started_at);
    // Only downtime inside the session window counts.
    let gap_ms = (now.min(ends_at) - last).max(0);
    let broken = already_broken || gap_ms > GAP_LIMIT_MS;
    if now >= ends_at {
        Resume::Finished { outcome: if broken { "broken" } else { "completed" }, gap_ms }
    } else {
        Resume::Continue { remaining_ms: ends_at - now, gap_ms, broken }
    }
}

pub fn start(conn: &Connection, profile_id: i64, profile_name: &str, minutes: i64, now: i64) -> rusqlite::Result<Active> {
    conn.execute(
        "INSERT INTO sessions (profile_id, profile_name, started_at, planned_minutes, source, last_seen_at)
         VALUES (?1, ?2, ?3, ?4, 'manual', ?3)",
        params![profile_id, profile_name, now, minutes],
    )?;
    let planned_ms = minutes * 60_000;
    Ok(Active {
        id: conn.last_insert_rowid(),
        profile_id: Some(profile_id),
        profile_name: profile_name.to_string(),
        planned_ms,
        started_at: now,
        ends_at: now + planned_ms,
        gap_ms: 0,
        broken: false,
        attempts: 0,
        sealed_count: 0,
        idle_ms: 0,
        idle_since: None,
        anchor_wall: now,
        tampered: false,
        task: None,
        anchor_mono: Instant::now(),
    })
}

pub fn save_idle(conn: &Connection, id: i64, idle_ms: i64) -> rusqlite::Result<()> {
    conn.execute("UPDATE sessions SET idle_ms = ?1 WHERE id = ?2", params![idle_ms, id])?;
    Ok(())
}

/// Marks a running session broken (tamper): it can no longer finish as completed.
pub fn mark_broken(conn: &Connection, id: i64, now: i64) -> rusqlite::Result<()> {
    conn.execute("UPDATE sessions SET broken_at = COALESCE(broken_at, ?1) WHERE id = ?2", params![now, id])?;
    Ok(())
}

pub fn heartbeat(conn: &Connection, id: i64, now: i64) -> rusqlite::Result<()> {
    conn.execute("UPDATE sessions SET last_seen_at = ?1 WHERE id = ?2", params![now, id])?;
    Ok(())
}

/// Logs one blocked launch and returns the session's attempt count.
pub fn record_attempt(conn: &Connection, id: i64, exe: &str, kind: &str, now: i64) -> rusqlite::Result<i64> {
    conn.execute(
        "INSERT INTO blocked_attempts (session_id, ts, exe, kind) VALUES (?1, ?2, ?3, ?4)",
        params![id, now, exe, kind],
    )?;
    conn.execute("UPDATE sessions SET attempts_blocked = attempts_blocked + 1 WHERE id = ?1", [id])?;
    conn.query_row("SELECT attempts_blocked FROM sessions WHERE id = ?1", [id], |r| r.get(0))
}

pub fn finish(conn: &Connection, id: i64, outcome: &str, ended_at: i64) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE sessions SET outcome = ?1, ended_at = ?2, last_seen_at = ?2 WHERE id = ?3",
        params![outcome, ended_at, id],
    )?;
    Ok(())
}

/// An early exit through the ladder (or the emergency unlock), logged as an approved unlock
/// attempt at the level reached. Unlocked early is never broken (SPEC 4.5).
pub fn end_early(conn: &mut Connection, id: i64, reason: &str, level: i64, now: i64) -> Result<(), String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO unlock_attempts (session_id, level_reached, reason, approved, created_at) VALUES (?1, ?2, ?3, 1, ?4)",
        params![id, level.clamp(1, 3), reason.trim(), now],
    )
    .map_err(|e| e.to_string())?;
    finish(&tx, id, "unlocked_early", now).map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())
}

/// Resumes the unfinished session, if any. Sessions that ended while Sanctum was down are
/// closed as completed (or broken, if the downtime was too long) and nothing resumes.
pub fn resume(conn: &Connection, now: i64) -> rusqlite::Result<Option<Active>> {
    let row = conn
        .query_row(
            "SELECT id, profile_id, profile_name, started_at, planned_minutes, last_seen_at, gap_ms, broken_at, attempts_blocked, idle_ms
             FROM sessions WHERE ended_at IS NULL ORDER BY id DESC LIMIT 1",
            [],
            |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, Option<i64>>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, i64>(3)?,
                    r.get::<_, i64>(4)?,
                    r.get::<_, Option<i64>>(5)?,
                    r.get::<_, i64>(6)?,
                    r.get::<_, Option<i64>>(7)?,
                    r.get::<_, i64>(8)?,
                    r.get::<_, i64>(9)?,
                ))
            },
        )
        .optional()?;
    let Some((id, profile_id, profile_name, started_at, minutes, last_seen, gap_so_far, broken_at, attempts, idle_ms)) = row else {
        return Ok(None);
    };
    // Any older unfinished rows can only come from a crash loop; close them as broken.
    conn.execute(
        "UPDATE sessions SET outcome = 'broken', ended_at = COALESCE(last_seen_at, started_at) WHERE ended_at IS NULL AND id != ?1",
        [id],
    )?;

    let planned_ms = minutes * 60_000;
    let ends_at = started_at + planned_ms;
    // Idle before the restart already pushed the end later.
    match resume_decision(now, started_at, ends_at + idle_ms, last_seen, broken_at.is_some()) {
        Resume::Finished { outcome, gap_ms } => {
            conn.execute("UPDATE sessions SET gap_ms = gap_ms + ?1 WHERE id = ?2", params![gap_ms, id])?;
            finish(conn, id, outcome, ends_at + idle_ms)?;
            Ok(None)
        }
        Resume::Continue { gap_ms, broken, .. } => {
            conn.execute(
                "UPDATE sessions SET gap_ms = gap_ms + ?1, last_seen_at = ?2,
                 broken_at = CASE WHEN ?3 THEN COALESCE(broken_at, ?2) ELSE broken_at END WHERE id = ?4",
                params![gap_ms, now, broken, id],
            )?;
            let task = load_task(conn, id)?;
            Ok(Some(Active {
                id,
                profile_id,
                profile_name,
                planned_ms,
                started_at,
                ends_at,
                gap_ms: gap_so_far + gap_ms,
                broken,
                attempts,
                sealed_count: 0,
                idle_ms,
                idle_since: None,
                anchor_wall: now,
                tampered: false,
                task,
                anchor_mono: Instant::now(),
            }))
        }
    }
}

/// Minutes focused in finished sessions that started at or after `since` (downtime excluded).
/// The running session is added live by the UI from its ticks.
pub fn focus_minutes_since(conn: &Connection, since: i64) -> rusqlite::Result<i64> {
    let ms: Option<i64> = conn.query_row(
        "SELECT SUM(MAX(0, MIN(planned_minutes * 60000, ended_at - started_at - idle_ms) - gap_ms))
         FROM sessions WHERE started_at >= ?1 AND ended_at IS NOT NULL",
        params![since],
        |r| r.get(0),
    )?;
    Ok(ms.unwrap_or(0) / 60_000)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    fn fresh() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        db::prepare(&mut conn).unwrap();
        conn.execute("INSERT INTO profiles (id, name, created_at) VALUES (1, 'Deep Work', 0)", []).unwrap();
        conn
    }

    const MIN: i64 = 60_000;

    #[test]
    fn resume_rules() {
        // Short restart: resume, not broken.
        assert_eq!(
            resume_decision(10 * MIN + 30_000, 0, 60 * MIN, Some(10 * MIN), false),
            Resume::Continue { remaining_ms: 49 * MIN + 30_000, gap_ms: 30_000, broken: false }
        );
        // Down longer than a minute: resume, but broken.
        assert_eq!(
            resume_decision(20 * MIN, 0, 60 * MIN, Some(10 * MIN), false),
            Resume::Continue { remaining_ms: 40 * MIN, gap_ms: 10 * MIN, broken: true }
        );
        // Ended while down: only the in-window downtime counts.
        assert_eq!(
            resume_decision(90 * MIN, 0, 60 * MIN, Some(59 * MIN + 30_000), false),
            Resume::Finished { outcome: "completed", gap_ms: 30_000 }
        );
        assert_eq!(
            resume_decision(90 * MIN, 0, 60 * MIN, Some(30 * MIN), false),
            Resume::Finished { outcome: "broken", gap_ms: 30 * MIN }
        );
        // Once broken, always broken.
        assert!(matches!(resume_decision(MIN, 0, 60 * MIN, Some(MIN), true), Resume::Continue { broken: true, .. }));
    }

    #[test]
    fn start_heartbeat_and_resume() {
        let conn = fresh();
        let s = start(&conn, 1, "Deep Work", 60, 1_000).unwrap();
        assert_eq!(s.ends_at, 1_000 + 60 * MIN);
        heartbeat(&conn, s.id, 1_000 + 5 * MIN).unwrap();
        assert_eq!(record_attempt(&conn, s.id, "discord.exe", "app", 2_000).unwrap(), 1);
        assert_eq!(record_attempt(&conn, s.id, "steam.exe", "app", 3_000).unwrap(), 2);

        let r = resume(&conn, 1_000 + 5 * MIN + 20_000).unwrap().unwrap();
        assert_eq!((r.id, r.broken, r.attempts, r.gap_ms), (s.id, false, 2, 20_000));
        assert_eq!(r.view().remaining_ms / 1000, (60 * MIN - 5 * MIN - 20_000) / 1000);

        // Down 3 minutes: resumes broken, and stays broken on the next resume.
        let r = resume(&conn, 1_000 + 8 * MIN + 20_000).unwrap().unwrap();
        assert!(r.broken);
        let r = resume(&conn, 1_000 + 8 * MIN + 30_000).unwrap().unwrap();
        assert!(r.broken);
    }

    #[test]
    fn a_linked_task_survives_a_restart_and_reaches_the_held_page() {
        let conn = fresh();
        let mut s = start(&conn, 1, "Deep Work", 60, 1_000).unwrap();
        let task = TaskLink { kind: "todo".into(), id: 7, date: "2026-09-30".into(), title: " Write the essay ".into() };
        assert!(task.valid());
        assert!(!TaskLink { kind: "event".into(), ..task.clone() }.valid());
        set_task(&conn, s.id, &task).unwrap();
        s.task = Some(task.clone());
        assert_eq!(s.view().task.unwrap().title, " Write the essay ");
        heartbeat(&conn, s.id, 1_000 + MIN).unwrap();
        let r = resume(&conn, 1_000 + MIN + 5_000).unwrap().unwrap();
        let t = r.held().task.unwrap();
        assert_eq!((t.kind.as_str(), t.id, t.title.as_str()), ("todo", 7, "Write the essay"));
    }

    #[test]
    fn resume_closes_sessions_that_ended_while_down() {
        let conn = fresh();
        let s = start(&conn, 1, "Deep Work", 30, 0).unwrap();
        heartbeat(&conn, s.id, 30 * MIN - 10_000).unwrap();
        assert!(resume(&conn, 45 * MIN).unwrap().is_none());
        let (outcome, ended): (String, i64) =
            conn.query_row("SELECT outcome, ended_at FROM sessions WHERE id = ?1", [s.id], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
        assert_eq!((outcome.as_str(), ended), ("completed", 30 * MIN));
        assert!(resume(&conn, 46 * MIN).unwrap().is_none());
    }

    #[test]
    fn end_early_logs_the_level_and_reason() {
        let mut conn = fresh();
        let s = start(&conn, 1, "Deep Work", 60, 0).unwrap();
        let reason = "The interview moved up an hour and I need to prep the room and laptop.";
        end_early(&mut conn, s.id, reason, 3, 10 * MIN).unwrap();
        let (outcome, logged, level): (String, String, i64) = conn
            .query_row(
                "SELECT s.outcome, u.reason, u.level_reached FROM sessions s JOIN unlock_attempts u ON u.session_id = s.id WHERE s.id = ?1",
                [s.id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(outcome, "unlocked_early");
        assert_eq!(logged, reason);
        assert_eq!(level, 3);
        assert!(resume(&conn, 11 * MIN).unwrap().is_none());
    }

    #[test]
    fn idle_pauses_and_extends_the_seal() {
        let conn = fresh();
        let mut s = start(&conn, 1, "Deep Work", 60, now_ms()).unwrap();
        let end = s.ends_at;
        // Idle began 4 minutes ago (the 3 min threshold counts too).
        let since = s.now() - 4 * MIN;
        assert_eq!(s.set_idle(Some(since)), None);
        let v = s.view();
        assert!(v.idle);
        // Idle can't start before the session did, so at most the time since start counts.
        assert!(v.ends_at >= end && v.ends_at <= end + 4 * MIN);
        let total = s.set_idle(None).unwrap();
        assert!((0..=4 * MIN + 1000).contains(&total));
        assert!(!s.view().idle);
        save_idle(&conn, s.id, 7 * MIN).unwrap();
        // After a restart the saved idle still extends the end.
        let r = resume(&conn, s.started_at + 30_000).unwrap().unwrap();
        assert_eq!(r.idle_ms, 7 * MIN);
        assert_eq!(r.view().ends_at, r.ends_at + 7 * MIN);
    }

    #[test]
    fn counts_focus_minutes_without_downtime() {
        let conn = fresh();
        let a = start(&conn, 1, "Deep Work", 60, 0).unwrap();
        finish(&conn, a.id, "completed", 60 * MIN).unwrap();
        let b = start(&conn, 1, "Deep Work", 30, 100 * MIN).unwrap();
        conn.execute("UPDATE sessions SET gap_ms = ?1 WHERE id = ?2", params![5 * MIN, b.id]).unwrap();
        // b is still running, so only a counts.
        assert_eq!(focus_minutes_since(&conn, 0).unwrap(), 60);
        finish(&conn, b.id, "unlocked_early", 120 * MIN).unwrap();
        // b ended early after 20 min, 5 of them down.
        assert_eq!(focus_minutes_since(&conn, 0).unwrap(), 60 + 15);
        assert_eq!(focus_minutes_since(&conn, 90 * MIN).unwrap(), 15);
    }
}
