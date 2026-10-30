//! The seal's science (v0.3.1, decided 2026-10-30): what a seal is for, the plan for temptation,
//! thoughts parked for later, and how it went.
//!
//! - An if-then plan ("If I'm tempted, I'll stand up") makes the plan run when the cue comes
//!   (Gollwitzer & Sheeran 2006). Each profile remembers its last one; every catch shows it.
//! - A specific goal ("What will be done?") with feedback after beats "do your best" (Locke &
//!   Latham); the held page asks Done / Partly / No and a 1-5 focus rating.
//! - A stray thought written down as a plan stops pulling at attention (Masicampo & Baumeister
//!   2011): Ctrl Alt P parks it as a task for today. "Where I left off" eases the restart
//!   (attention residue, Leroy 2009) and shows at the next seal of the same task or profile.

use crate::session::{self, TaskLink};
use crate::{gcal, planner, stats, Shared};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

/// The longest goal, plan, or left-off line kept.
pub const MAX_LINE: usize = 200;
/// Ctrl Alt P while sealed: park a thought (not Ctrl Shift P, which editors use).
pub const PARK_SHORTCUT: &str = "Ctrl+Alt+KeyP";

/// Trims, folds whitespace, and caps a line; empty is None.
pub fn line(s: Option<&str>) -> Option<String> {
    let s: String = s?.split_whitespace().collect::<Vec<_>>().join(" ");
    let s: String = s.chars().take(MAX_LINE).collect();
    (!s.is_empty()).then_some(s)
}

/// The seal's goal and plan; the plan is also kept on the profile for next time.
pub fn set_intent(conn: &Connection, session_id: i64, profile_id: Option<i64>, goal: Option<&str>, plan: Option<&str>) -> rusqlite::Result<(Option<String>, Option<String>)> {
    let (goal, plan) = (line(goal), line(plan));
    conn.execute("UPDATE sessions SET goal = ?1, plan = ?2 WHERE id = ?3", params![goal, plan, session_id])?;
    if let Some(p) = profile_id {
        conn.execute("UPDATE profiles SET plan = ?1 WHERE id = ?2", params![plan, p])?;
    }
    Ok((goal, plan))
}

pub fn load_intent(conn: &Connection, session_id: i64) -> rusqlite::Result<(Option<String>, Option<String>)> {
    conn.query_row("SELECT goal, plan FROM sessions WHERE id = ?1", [session_id], |r| Ok((r.get(0)?, r.get(1)?)))
        .optional()
        .map(Option::unwrap_or_default)
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LeftOff {
    pub text: String,
    pub at: i64,
}

/// Where you left off last time: on this task if there is one, else in this profile.
pub fn left_off(conn: &Connection, task: Option<&TaskLink>, profile_id: Option<i64>) -> rusqlite::Result<Option<LeftOff>> {
    let row = |r: &rusqlite::Row| Ok(LeftOff { text: r.get(0)?, at: r.get(1)? });
    if let Some(t) = task {
        let hit = conn
            .query_row(
                "SELECT left_off, ended_at FROM sessions WHERE task_kind = ?1 AND task_id = ?2 AND left_off IS NOT NULL AND ended_at IS NOT NULL
                 ORDER BY ended_at DESC LIMIT 1",
                params![t.kind, t.id],
                row,
            )
            .optional()?;
        if hit.is_some() {
            return Ok(hit);
        }
    }
    let Some(p) = profile_id else { return Ok(None) };
    conn.query_row(
        "SELECT left_off, ended_at FROM sessions WHERE profile_id = ?1 AND task_kind IS NULL AND left_off IS NOT NULL AND ended_at IS NOT NULL
         ORDER BY ended_at DESC LIMIT 1",
        [p],
        row,
    )
    .optional()
}

/// The profile's last if-then plan.
pub fn profile_plan(conn: &Connection, profile_id: i64) -> rusqlite::Result<Option<String>> {
    conn.query_row("SELECT plan FROM profiles WHERE id = ?1", [profile_id], |r| r.get(0)).optional().map(Option::flatten)
}

/// Parks a thought as a task for today, tagged with the seal it came from.
/// Without a seal (it ended while the card was open) it's a plain task for today: a thought is
/// never lost.
pub fn park(conn: &Connection, session_id: Option<i64>, text: &str, today: &str) -> Result<planner::Todo, String> {
    let title = line(Some(text)).ok_or("Write the thought first.")?;
    let todo = planner::save_todo(conn, planner::TodoDraft { title, due_date: today.to_string(), ..Default::default() })?;
    if let Some(id) = session_id {
        conn.execute("UPDATE todos SET parked_session = ?1 WHERE id = ?2", params![id, todo.id]).map_err(|e| e.to_string())?;
    }
    Ok(planner::Todo { parked_from: session_id, ..todo })
}

/// How a finished seal went: Done / Partly / No, a 1-5 rating, and where you left off.
pub fn wrap(conn: &Connection, session_id: i64, result: Option<&str>, rating: Option<i64>, left: Option<&str>) -> Result<(), String> {
    if result.is_some_and(|r| !matches!(r, "done" | "partly" | "no")) {
        return Err("Pick Done, Partly, or No.".into());
    }
    if rating.is_some_and(|r| !(1..=5).contains(&r)) {
        return Err("Rate focus from 1 to 5.".into());
    }
    let n = conn
        .execute(
            "UPDATE sessions SET result = ?1, focus_rating = ?2, left_off = ?3 WHERE id = ?4 AND ended_at IS NOT NULL",
            params![result, rating, line(left), session_id],
        )
        .map_err(|e| e.to_string())?;
    if n == 0 {
        return Err("That session isn't finished.".into());
    }
    Ok(())
}

// --- Commands ---

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Prep {
    /// The profile's last if-then plan, to prefill.
    pub plan: Option<String>,
    pub left_off: Option<LeftOff>,
}

/// What the focus row prefills for this profile and task.
#[tauri::command]
pub fn focus_prepare(shared: State<Shared>, profile_id: i64, task: Option<TaskLink>) -> Result<Prep, String> {
    let conn = shared.db.lock().map_err(|e| e.to_string())?;
    let plan = profile_plan(&conn, profile_id).map_err(|e| e.to_string())?;
    let left_off = left_off(&conn, task.as_ref(), Some(profile_id)).map_err(|e| e.to_string())?;
    Ok(Prep { plan, left_off })
}

/// Parks a thought during the seal (the hotkey card, Home, the tray panel, the extension).
#[tauri::command]
pub fn focus_park(app: AppHandle, text: String) -> Result<planner::Todo, String> {
    park_now(&app, &text)
}

pub fn park_now(app: &AppHandle, text: &str) -> Result<planner::Todo, String> {
    let shared = app.state::<Shared>();
    let id = shared.engine.session_ids().map(|s| s.0);
    let todo = {
        let conn = shared.db.lock().map_err(|e| e.to_string())?;
        let today = stats::Days::load(&conn).of(session::now_ms()).format("%Y-%m-%d").to_string();
        let t = park(&conn, id, text, &today)?;
        gcal::queue(&shared, &conn, gcal::sync::Job::Todo(t.id));
        t
    };
    let _ = app.emit(gcal::PLANNER_EVENT, ());
    Ok(todo)
}

#[tauri::command]
pub fn focus_wrap(shared: State<Shared>, session_id: i64, result: Option<String>, rating: Option<i64>, left_off: Option<String>) -> Result<(), String> {
    let conn = shared.db.lock().map_err(|e| e.to_string())?;
    wrap(&conn, session_id, result.as_deref(), rating, left_off.as_deref())
}

// --- The park hotkey, registered only while sealed ---

/// Ctrl Alt P on while sealed, off after: it never takes the keys from other apps otherwise.
pub fn on_seal(app: &AppHandle, sealed: bool) {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;
    let gs = app.global_shortcut();
    let registered = gs.is_registered(PARK_SHORTCUT);
    if sealed && !registered {
        let _ = gs.on_shortcut(PARK_SHORTCUT, |app, _, event| {
            if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                crate::engine::show_park(app);
            }
        });
    } else if !sealed && registered {
        let _ = gs.unregister(PARK_SHORTCUT);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    fn fresh() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        db::prepare(&mut conn).unwrap();
        conn.execute("INSERT INTO profiles (id, name, created_at) VALUES (1, 'Deep Work', 0), (2, 'Study', 0)", []).unwrap();
        conn
    }

    fn seal(conn: &Connection, profile: i64, ended: Option<i64>, task: Option<(&str, i64)>) -> i64 {
        conn.execute(
            "INSERT INTO sessions (profile_id, profile_name, started_at, planned_minutes, ended_at, task_kind, task_id, task_date, task_title)
             VALUES (?1, 'P', 0, 60, ?2, ?3, ?4, CASE WHEN ?3 IS NULL THEN NULL ELSE '2026-10-30' END, CASE WHEN ?3 IS NULL THEN NULL ELSE 'T' END)",
            params![profile, ended, task.map(|t| t.0), task.map(|t| t.1)],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    #[test]
    fn lines_are_trimmed_folded_and_capped() {
        assert_eq!(line(Some("  stand   up\nand stretch ")).as_deref(), Some("stand up and stretch"));
        assert_eq!(line(Some("   ")), None);
        assert_eq!(line(None), None);
        assert_eq!(line(Some(&"x".repeat(500))).unwrap().chars().count(), MAX_LINE);
    }

    #[test]
    fn the_plan_is_kept_on_the_seal_and_remembered_by_the_profile() {
        let conn = fresh();
        let s = seal(&conn, 1, None, None);
        let (goal, plan) = set_intent(&conn, s, Some(1), Some(" Finish problem set 4 "), Some("I'll stand up")).unwrap();
        assert_eq!((goal.as_deref(), plan.as_deref()), (Some("Finish problem set 4"), Some("I'll stand up")));
        assert_eq!(load_intent(&conn, s).unwrap(), (goal, plan));
        assert_eq!(profile_plan(&conn, 1).unwrap().as_deref(), Some("I'll stand up"));
        assert_eq!(profile_plan(&conn, 2).unwrap(), None);
    }

    #[test]
    fn a_parked_thought_is_a_task_for_today_from_that_seal() {
        let conn = fresh();
        let s = seal(&conn, 1, None, None);
        let t = park(&conn, Some(s), "  Email Alex about the lab ", "2026-10-30").unwrap();
        assert_eq!((t.title.as_str(), t.due_date.as_str(), t.parked_from), ("Email Alex about the lab", "2026-10-30", Some(s)));
        let listed = planner::list_todos(&conn, "2026-10-30", "2026-10-30").unwrap();
        assert_eq!(listed[0].parked_from, Some(s));
        assert!(park(&conn, Some(s), "   ", "2026-10-30").is_err());
        let late = park(&conn, None, "after the seal", "2026-10-30").unwrap();
        assert_eq!(late.parked_from, None);
    }

    #[test]
    fn wrap_up_and_where_you_left_off() {
        let conn = fresh();
        let running = seal(&conn, 1, None, None);
        assert!(wrap(&conn, running, Some("done"), None, None).is_err(), "only finished seals");
        let a = seal(&conn, 1, Some(1_000), None);
        assert!(wrap(&conn, a, Some("maybe"), None, None).is_err());
        assert!(wrap(&conn, a, None, Some(6), None).is_err());
        wrap(&conn, a, Some("partly"), Some(4), Some("Halfway through Q3")).unwrap();
        let b = seal(&conn, 1, Some(2_000), Some(("todo", 7)));
        wrap(&conn, b, Some("no"), None, Some("Stuck on the proof")).unwrap();
        // The task's own note first; without a task, the profile's latest untasked one.
        let task = TaskLink { kind: "todo".into(), id: 7, date: "2026-10-30".into(), title: "T".into() };
        assert_eq!(left_off(&conn, Some(&task), Some(1)).unwrap().unwrap().text, "Stuck on the proof");
        assert_eq!(left_off(&conn, None, Some(1)).unwrap().unwrap(), LeftOff { text: "Halfway through Q3".into(), at: 1_000 });
        let other = TaskLink { id: 8, ..task };
        assert_eq!(left_off(&conn, Some(&other), Some(1)).unwrap().unwrap().text, "Halfway through Q3", "falls back to the profile");
        assert_eq!(left_off(&conn, None, Some(2)).unwrap(), None);
    }
}
