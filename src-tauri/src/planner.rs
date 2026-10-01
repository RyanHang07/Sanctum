//! Routines and one-time items (SPEC 4.12). Routines repeat on weekdays (the spec's daily
//! goals); one-time items are todos on a date. Expanding routines into days happens in the UI
//! (src/lib/planner.ts), where the local calendar lives; this module stores and validates.

use crate::session::now_ms;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Routine {
    pub id: i64,
    pub title: String,
    pub sort: i64,
    pub profile_id: Option<i64>,
    pub active: bool,
    /// Bit 0 = Sunday ... bit 6 = Saturday.
    pub days_mask: i64,
    /// 'HH:MM', or None for anytime.
    pub time: Option<String>,
    pub duration_min: Option<i64>,
}

#[derive(Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct RoutineDraft {
    #[serde(default)]
    pub id: Option<i64>,
    pub title: String,
    #[serde(default)]
    pub profile_id: Option<i64>,
    #[serde(default = "yes")]
    pub active: bool,
    pub days_mask: i64,
    #[serde(default)]
    pub time: Option<String>,
    #[serde(default)]
    pub duration_min: Option<i64>,
}

fn yes() -> bool {
    true
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Todo {
    pub id: i64,
    pub title: String,
    /// 'YYYY-MM-DD'
    pub due_date: String,
    pub due_time: Option<String>,
    pub duration_min: Option<i64>,
    pub profile_id: Option<i64>,
    pub done: bool,
    /// Order among a day's untimed items (Home's drag order).
    pub sort: i64,
}

#[derive(Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct TodoDraft {
    #[serde(default)]
    pub id: Option<i64>,
    pub title: String,
    pub due_date: String,
    #[serde(default)]
    pub due_time: Option<String>,
    #[serde(default)]
    pub duration_min: Option<i64>,
    #[serde(default)]
    pub profile_id: Option<i64>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RoutineCheck {
    pub routine_id: i64,
    pub date: String,
}

pub fn valid_time(t: &str) -> bool {
    let b = t.as_bytes();
    b.len() == 5
        && b[2] == b':'
        && t[..2].parse::<u32>().is_ok_and(|h| h < 24)
        && t[3..].parse::<u32>().is_ok_and(|m| m < 60)
        && b[..2].iter().chain(&b[3..]).all(u8::is_ascii_digit)
}

pub fn valid_date(d: &str) -> bool {
    let parts: Vec<&str> = d.split('-').collect();
    parts.len() == 3
        && parts[0].len() == 4
        && parts[1].len() == 2
        && parts[2].len() == 2
        && parts.iter().all(|p| p.bytes().all(|c| c.is_ascii_digit()))
        && parts[1].parse::<u32>().is_ok_and(|m| (1..=12).contains(&m))
        && parts[2].parse::<u32>().is_ok_and(|d| (1..=31).contains(&d))
}

fn check_common(title: &str, time: &Option<String>, duration: Option<i64>) -> Result<String, String> {
    let title = title.trim();
    if title.is_empty() {
        return Err("Give it a name.".into());
    }
    if let Some(t) = time {
        if !valid_time(t) {
            return Err(format!("{t} is not a time."));
        }
    }
    if let Some(d) = duration {
        if !(5..=480).contains(&d) {
            return Err("Length must be between 5 minutes and 8 hours.".into());
        }
    }
    Ok(title.to_string())
}

// --- routines ---

fn routine_row(r: &rusqlite::Row) -> rusqlite::Result<Routine> {
    Ok(Routine {
        id: r.get(0)?,
        title: r.get(1)?,
        sort: r.get(2)?,
        profile_id: r.get(3)?,
        active: r.get::<_, i64>(4)? != 0,
        days_mask: r.get(5)?,
        time: r.get(6)?,
        duration_min: r.get(7)?,
    })
}

const ROUTINE_COLS: &str = "id, name, sort, profile_id, active, days_mask, time, duration_min";

pub fn list_routines(conn: &Connection) -> rusqlite::Result<Vec<Routine>> {
    let mut stmt = conn.prepare(&format!("SELECT {ROUTINE_COLS} FROM daily_goals ORDER BY sort, id"))?;
    let rows = stmt.query_map([], routine_row)?;
    rows.collect()
}

fn get_routine(conn: &Connection, id: i64) -> Result<Routine, String> {
    conn.query_row(&format!("SELECT {ROUTINE_COLS} FROM daily_goals WHERE id = ?1"), [id], routine_row)
        .optional()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "That routine no longer exists.".into())
}

pub fn save_routine(conn: &Connection, d: RoutineDraft) -> Result<Routine, String> {
    let title = check_common(&d.title, &d.time, d.duration_min)?;
    if !(1..=127).contains(&d.days_mask) {
        return Err("Pick at least one day.".into());
    }
    let id = match d.id {
        Some(id) => {
            get_routine(conn, id)?;
            conn.execute(
                "UPDATE daily_goals SET name = ?1, profile_id = ?2, active = ?3, days_mask = ?4, time = ?5, duration_min = ?6 WHERE id = ?7",
                params![title, d.profile_id, d.active as i64, d.days_mask, d.time, d.duration_min, id],
            )
            .map_err(|e| e.to_string())?;
            id
        }
        None => {
            let sort: i64 = conn
                .query_row("SELECT COALESCE(MAX(sort), -1) + 1 FROM daily_goals", [], |r| r.get(0))
                .map_err(|e| e.to_string())?;
            conn.execute(
                "INSERT INTO daily_goals (name, sort, profile_id, active, days_mask, time, duration_min, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![title, sort, d.profile_id, d.active as i64, d.days_mask, d.time, d.duration_min, now_ms()],
            )
            .map_err(|e| e.to_string())?;
            conn.last_insert_rowid()
        }
    };
    get_routine(conn, id)
}

pub fn delete_routine(conn: &Connection, id: i64) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM daily_goals WHERE id = ?1", [id])?;
    Ok(())
}

pub fn list_checks(conn: &Connection, from: &str, to: &str) -> rusqlite::Result<Vec<RoutineCheck>> {
    let mut stmt = conn.prepare("SELECT goal_id, date FROM daily_goal_checks WHERE date BETWEEN ?1 AND ?2")?;
    let rows = stmt.query_map([from, to], |r| Ok(RoutineCheck { routine_id: r.get(0)?, date: r.get(1)? }))?;
    rows.collect()
}

/// Checks a routine off for one day only (the series keeps going).
pub fn set_routine_done(conn: &Connection, id: i64, date: &str, done: bool) -> Result<(), String> {
    if !valid_date(date) {
        return Err(format!("{date} is not a date."));
    }
    get_routine(conn, id)?;
    let r = if done {
        conn.execute(
            "INSERT OR IGNORE INTO daily_goal_checks (goal_id, date, done_at) VALUES (?1, ?2, ?3)",
            params![id, date, now_ms()],
        )
    } else {
        conn.execute("DELETE FROM daily_goal_checks WHERE goal_id = ?1 AND date = ?2", params![id, date])
    };
    r.map(|_| ()).map_err(|e| e.to_string())
}

// --- one-time items ---

fn todo_row(r: &rusqlite::Row) -> rusqlite::Result<Todo> {
    Ok(Todo {
        id: r.get(0)?,
        title: r.get(1)?,
        due_date: r.get(2)?,
        due_time: r.get(3)?,
        duration_min: r.get(4)?,
        profile_id: r.get(5)?,
        done: r.get::<_, Option<i64>>(6)?.is_some(),
        sort: r.get(7)?,
    })
}

const TODO_COLS: &str = "id, title, due_date, due_time, duration_min, profile_id, done_at, sort";

pub fn list_todos(conn: &Connection, from: &str, to: &str) -> rusqlite::Result<Vec<Todo>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {TODO_COLS} FROM todos WHERE due_date BETWEEN ?1 AND ?2 ORDER BY due_date, due_time IS NULL, due_time, sort, id"
    ))?;
    let rows = stmt.query_map([from, to], todo_row)?;
    rows.collect()
}

fn get_todo(conn: &Connection, id: i64) -> Result<Todo, String> {
    conn.query_row(&format!("SELECT {TODO_COLS} FROM todos WHERE id = ?1"), [id], todo_row)
        .optional()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "That item no longer exists.".into())
}

pub fn save_todo(conn: &Connection, d: TodoDraft) -> Result<Todo, String> {
    let title = check_common(&d.title, &d.due_time, d.duration_min)?;
    if !valid_date(&d.due_date) {
        return Err(format!("{} is not a date.", d.due_date));
    }
    let now = now_ms();
    let id = match d.id {
        Some(id) => {
            get_todo(conn, id)?;
            conn.execute(
                "UPDATE todos SET title = ?1, due_date = ?2, due_time = ?3, duration_min = ?4, profile_id = ?5, updated_at = ?6 WHERE id = ?7",
                params![title, d.due_date, d.due_time, d.duration_min, d.profile_id, now, id],
            )
            .map_err(|e| e.to_string())?;
            id
        }
        None => {
            // New items go to the end of their day.
            let sort: i64 = conn
                .query_row("SELECT COALESCE(MAX(sort), -1) + 1 FROM todos WHERE due_date = ?1", [&d.due_date], |r| r.get(0))
                .map_err(|e| e.to_string())?;
            conn.execute(
                "INSERT INTO todos (title, due_date, due_time, duration_min, profile_id, updated_at, created_at, sort)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6, ?7)",
                params![title, d.due_date, d.due_time, d.duration_min, d.profile_id, now, sort],
            )
            .map_err(|e| e.to_string())?;
            conn.last_insert_rowid()
        }
    };
    get_todo(conn, id)
}

pub fn set_todo_done(conn: &Connection, id: i64, done: bool) -> Result<Todo, String> {
    get_todo(conn, id)?;
    let now = now_ms();
    conn.execute(
        "UPDATE todos SET done_at = ?1, updated_at = ?2 WHERE id = ?3",
        params![done.then_some(now), now, id],
    )
    .map_err(|e| e.to_string())?;
    get_todo(conn, id)
}

pub fn delete_todo(conn: &Connection, id: i64) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM todos WHERE id = ?1", [id])?;
    Ok(())
}

/// Saves a drag order: each id's sort becomes its position. Ids not listed keep theirs.
fn reorder(conn: &Connection, table: &str, ids: &[i64]) -> rusqlite::Result<()> {
    let tx = conn.unchecked_transaction()?;
    {
        let mut stmt = tx.prepare(&format!("UPDATE {table} SET sort = ?1 WHERE id = ?2"))?;
        for (i, id) in ids.iter().enumerate() {
            stmt.execute(params![i as i64, id])?;
        }
    }
    tx.commit()
}

/// Routines in the order given (the Routines page and Home's Routines column).
pub fn reorder_routines(conn: &Connection, ids: &[i64]) -> rusqlite::Result<()> {
    reorder(conn, "daily_goals", ids)
}

/// One day's items in the order given (Home's Today column).
pub fn reorder_todos(conn: &Connection, ids: &[i64]) -> rusqlite::Result<()> {
    reorder(conn, "todos", ids)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    fn fresh() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        db::prepare(&mut conn).unwrap();
        conn.execute("INSERT INTO profiles (id, name, created_at) VALUES (1, 'Interview Prep', 0)", []).unwrap();
        conn
    }

    fn routine(title: &str, mask: i64, time: Option<&str>) -> RoutineDraft {
        RoutineDraft { title: title.into(), days_mask: mask, time: time.map(Into::into), active: true, ..Default::default() }
    }

    #[test]
    fn validates_times_and_dates() {
        assert!(valid_time("07:30") && valid_time("23:59") && valid_time("00:00"));
        assert!(!valid_time("24:00") && !valid_time("7:30") && !valid_time("07:60") && !valid_time("ab:cd"));
        assert!(valid_date("2026-09-29") && !valid_date("2026-13-01") && !valid_date("2026-9-29") && !valid_date("yesterday"));
    }

    #[test]
    fn saves_edits_and_orders_routines() {
        let conn = fresh();
        let gym = save_routine(&conn, RoutineDraft { profile_id: Some(1), duration_min: Some(60), ..routine(" Gym ", 0b0101010, Some("07:00")) }).unwrap();
        assert_eq!((gym.title.as_str(), gym.days_mask, gym.time.as_deref(), gym.sort), ("Gym", 42, Some("07:00"), 0));
        let neet = save_routine(&conn, routine("NeetCode daily", 127, None)).unwrap();
        assert_eq!(neet.sort, 1);
        let edited = save_routine(&conn, RoutineDraft { id: Some(gym.id), ..routine("Gym", 0b0010100, Some("06:30")) }).unwrap();
        assert_eq!((edited.days_mask, edited.time.as_deref(), edited.profile_id), (20, Some("06:30"), None));
        assert_eq!(list_routines(&conn).unwrap().iter().map(|r| r.title.as_str()).collect::<Vec<_>>(), vec!["Gym", "NeetCode daily"]);

        for bad in [routine("", 1, None), routine("x", 0, None), routine("x", 128, None), routine("x", 1, Some("25:00"))] {
            assert!(save_routine(&conn, bad).is_err());
        }
        assert!(save_routine(&conn, RoutineDraft { duration_min: Some(2), ..routine("x", 1, None) }).is_err());
    }

    #[test]
    fn checks_off_one_day_of_a_routine() {
        let conn = fresh();
        let r = save_routine(&conn, routine("Weigh-in", 0b0010010, Some("08:00"))).unwrap();
        set_routine_done(&conn, r.id, "2026-09-28", true).unwrap();
        set_routine_done(&conn, r.id, "2026-09-28", true).unwrap(); // idempotent
        set_routine_done(&conn, r.id, "2026-10-01", true).unwrap();
        assert_eq!(list_checks(&conn, "2026-09-28", "2026-09-30").unwrap(), vec![RoutineCheck { routine_id: r.id, date: "2026-09-28".into() }]);
        set_routine_done(&conn, r.id, "2026-09-28", false).unwrap();
        assert!(list_checks(&conn, "2026-09-28", "2026-09-30").unwrap().is_empty());
        assert!(set_routine_done(&conn, r.id, "not-a-date", true).is_err());
        delete_routine(&conn, r.id).unwrap();
        assert!(list_checks(&conn, "2026-01-01", "2026-12-31").unwrap().is_empty(), "checks cascade with the routine");
    }

    #[test]
    fn one_time_items() {
        let conn = fresh();
        let mock = save_todo(
            &conn,
            TodoDraft { title: "Mock interview".into(), due_date: "2026-10-01".into(), due_time: Some("14:00".into()), duration_min: Some(60), profile_id: Some(1), ..Default::default() },
        )
        .unwrap();
        let untimed = save_todo(&conn, TodoDraft { title: "Pay rent".into(), due_date: "2026-10-01".into(), ..Default::default() }).unwrap();
        save_todo(&conn, TodoDraft { title: "Later".into(), due_date: "2026-10-09".into(), ..Default::default() }).unwrap();
        let week: Vec<_> = list_todos(&conn, "2026-09-28", "2026-10-04").unwrap().into_iter().map(|t| t.title).collect();
        assert_eq!(week, vec!["Mock interview", "Pay rent"], "timed first, then untimed");
        assert!(set_todo_done(&conn, untimed.id, true).unwrap().done);
        assert!(!set_todo_done(&conn, untimed.id, false).unwrap().done);
        let moved = save_todo(&conn, TodoDraft { id: Some(mock.id), title: "Mock interview".into(), due_date: "2026-10-02".into(), ..Default::default() }).unwrap();
        assert_eq!((moved.due_date.as_str(), moved.due_time), ("2026-10-02", None));
        assert!(save_todo(&conn, TodoDraft { title: "x".into(), due_date: "tomorrow".into(), ..Default::default() }).is_err());
        delete_todo(&conn, moved.id).unwrap();
        assert!(set_todo_done(&conn, moved.id, true).is_err());
    }

    #[test]
    fn keeps_a_drag_order() {
        let conn = fresh();
        let day = |t: &str| TodoDraft { title: t.into(), due_date: "2026-10-01".into(), ..Default::default() };
        let a = save_todo(&conn, day("Pay rent")).unwrap();
        let b = save_todo(&conn, day("Call mom")).unwrap();
        let c = save_todo(&conn, day("Groceries")).unwrap();
        assert_eq!((a.sort, b.sort, c.sort), (0, 1, 2), "new items go to the end of their day");
        reorder_todos(&conn, &[c.id, a.id, b.id]).unwrap();
        let titles: Vec<_> = list_todos(&conn, "2026-10-01", "2026-10-01").unwrap().into_iter().map(|t| t.title).collect();
        assert_eq!(titles, vec!["Groceries", "Pay rent", "Call mom"]);

        let gym = save_routine(&conn, routine("Gym", 127, None)).unwrap();
        let read = save_routine(&conn, routine("Read", 127, None)).unwrap();
        reorder_routines(&conn, &[read.id, gym.id]).unwrap();
        let order: Vec<_> = list_routines(&conn).unwrap().into_iter().map(|r| r.title).collect();
        assert_eq!(order, vec!["Read", "Gym"]);
    }
}
