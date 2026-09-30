//! Trackers and scheduled check-ins (SPEC 4.13). Trackers are fully custom: a number with a
//! unit, a yes/no, a 1 to 10 scale, or a short text note. Check-ins ask for some of them at set
//! times on set days; they queue while sealed and can pop up at startup if one was missed.
//! Everything stays local.

use chrono::{DateTime, Datelike, Local, NaiveDate, NaiveTime};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

const KINDS: &[&str] = &["number", "bool", "scale", "text"];
const DISPLAYS: &[&str] = &["chart", "table", "both"];
const MAX_TEXT: usize = 2000;

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Tracker {
    pub id: i64,
    pub name: String,
    pub unit: String,
    pub kind: String,
    pub display: String,
    pub goal: Option<f64>,
    pub sort: i64,
}

#[derive(Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct TrackerDraft {
    #[serde(default)]
    pub id: Option<i64>,
    pub name: String,
    #[serde(default)]
    pub unit: String,
    pub kind: String,
    #[serde(default)]
    pub display: Option<String>,
    #[serde(default)]
    pub goal: Option<f64>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub id: i64,
    pub tracker_id: i64,
    pub value: Option<f64>,
    pub text: Option<String>,
    pub logged_at: i64,
    pub source: String,
}

#[derive(Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct NewEntry {
    pub tracker_id: i64,
    #[serde(default)]
    pub value: Option<f64>,
    #[serde(default)]
    pub text: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Checkin {
    #[serde(default)]
    pub id: i64,
    pub name: String,
    /// "HH:MM", local time.
    pub time: String,
    /// Weekday mask, bit 0 = Sunday.
    pub days_mask: i64,
    pub tracker_ids: Vec<i64>,
    /// Also review today's open tasks and plan tomorrow's top 3.
    pub include_goal_review: bool,
}

type Result<T> = std::result::Result<T, String>;
fn db<T>(r: rusqlite::Result<T>) -> Result<T> {
    r.map_err(|e| e.to_string())
}

pub fn list(conn: &Connection) -> rusqlite::Result<Vec<Tracker>> {
    let mut stmt = conn.prepare("SELECT id, name, unit, kind, display, goal, sort FROM trackers ORDER BY sort, id")?;
    let rows = stmt.query_map([], |r| {
        Ok(Tracker { id: r.get(0)?, name: r.get(1)?, unit: r.get(2)?, kind: r.get(3)?, display: r.get(4)?, goal: r.get(5)?, sort: r.get(6)? })
    })?;
    rows.collect()
}

fn get(conn: &Connection, id: i64) -> Result<Tracker> {
    list(conn).map_err(|e| e.to_string())?.into_iter().find(|t| t.id == id).ok_or_else(|| "That tracker no longer exists.".into())
}

/// Creates or updates a tracker. The kind is fixed once it has entries.
pub fn save(conn: &Connection, d: TrackerDraft, now: i64) -> Result<Tracker> {
    let name = d.name.trim();
    if name.is_empty() {
        return Err("Give the tracker a name.".into());
    }
    if name.chars().count() > 40 {
        return Err("Keep the name under 40 characters.".into());
    }
    if !KINDS.contains(&d.kind.as_str()) {
        return Err(format!("Unknown tracker type: {}.", d.kind));
    }
    // Text notes only make sense as a list.
    let display = if d.kind == "text" { "table".to_string() } else { d.display.unwrap_or_else(|| "both".into()) };
    if !DISPLAYS.contains(&display.as_str()) {
        return Err(format!("Unknown display: {display}."));
    }
    let unit = if d.kind == "number" { d.unit.trim().chars().take(12).collect::<String>() } else { String::new() };
    let goal = match d.kind.as_str() {
        "number" => d.goal.filter(|g| g.is_finite()),
        "scale" => d.goal.filter(|g| (1.0..=10.0).contains(g)),
        _ => None,
    };
    let taken: Option<i64> = db(conn
        .query_row("SELECT id FROM trackers WHERE name = ?1 COLLATE NOCASE AND id IS NOT ?2", params![name, d.id], |r| r.get(0))
        .optional())?;
    if taken.is_some() {
        return Err(format!("A tracker named {name} already exists."));
    }
    let id = match d.id {
        Some(id) => {
            let old = get(conn, id)?;
            let used: i64 = db(conn.query_row("SELECT COUNT(*) FROM tracker_entries WHERE tracker_id = ?1", [id], |r| r.get(0)))?;
            if used > 0 && old.kind != d.kind {
                return Err("A tracker with entries keeps its type. Make a new one instead.".into());
            }
            db(conn.execute(
                "UPDATE trackers SET name = ?1, unit = ?2, kind = ?3, display = ?4, goal = ?5 WHERE id = ?6",
                params![name, unit, d.kind, display, goal, id],
            ))?;
            id
        }
        None => {
            let sort: i64 = db(conn.query_row("SELECT COALESCE(MAX(sort) + 1, 0) FROM trackers", [], |r| r.get(0)))?;
            db(conn.execute(
                "INSERT INTO trackers (name, unit, kind, display, goal, sort, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![name, unit, d.kind, display, goal, sort, now],
            ))?;
            conn.last_insert_rowid()
        }
    };
    get(conn, id)
}

/// Deletes a tracker, its entries, and its place in any check-in.
pub fn delete(conn: &Connection, id: i64) -> Result<()> {
    db(conn.execute("DELETE FROM trackers WHERE id = ?1", [id]))?;
    for mut c in list_checkins(conn).map_err(|e| e.to_string())? {
        if c.tracker_ids.contains(&id) {
            c.tracker_ids.retain(|t| *t != id);
            db(conn.execute("UPDATE checkins SET tracker_ids = ?1 WHERE id = ?2", params![ids_json(&c.tracker_ids), c.id]))?;
        }
    }
    Ok(())
}

/// Entries logged in [from, to), oldest first.
pub fn entries(conn: &Connection, from: i64, to: i64) -> rusqlite::Result<Vec<Entry>> {
    let mut stmt = conn.prepare(
        "SELECT id, tracker_id, value, text, logged_at, source FROM tracker_entries
         WHERE logged_at >= ?1 AND logged_at < ?2 ORDER BY logged_at, id",
    )?;
    let rows = stmt.query_map([from, to], |r| {
        Ok(Entry { id: r.get(0)?, tracker_id: r.get(1)?, value: r.get(2)?, text: r.get(3)?, logged_at: r.get(4)?, source: r.get(5)? })
    })?;
    rows.collect()
}

/// Checks one value against its tracker's type.
fn clean(t: &Tracker, e: &NewEntry) -> Result<(Option<f64>, Option<String>)> {
    let bad = || format!("{} needs {}.", t.name, match t.kind.as_str() {
        "number" => "a number",
        "bool" => "yes or no",
        "scale" => "a value from 1 to 10",
        _ => "some text",
    });
    match t.kind.as_str() {
        "text" => {
            let s = e.text.as_deref().map(str::trim).filter(|s| !s.is_empty()).ok_or_else(bad)?;
            if s.chars().count() > MAX_TEXT {
                return Err(format!("Keep {} under {MAX_TEXT} characters.", t.name));
            }
            Ok((None, Some(s.to_string())))
        }
        kind => {
            let v = e.value.filter(|v| v.is_finite()).ok_or_else(bad)?;
            let ok = match kind {
                "bool" => v == 0.0 || v == 1.0,
                "scale" => v.fract() == 0.0 && (1.0..=10.0).contains(&v),
                _ => true,
            };
            if !ok {
                return Err(bad());
            }
            Ok((Some(v), None))
        }
    }
}

/// Logs several values at once (a check-in, or Log entry). All or nothing.
pub fn log(conn: &mut Connection, items: &[NewEntry], source: &str, checkin: Option<i64>, at: i64) -> Result<Vec<Entry>> {
    if items.is_empty() {
        return Err("Nothing to log.".into());
    }
    let trackers = list(conn).map_err(|e| e.to_string())?;
    let tx = db(conn.transaction())?;
    let mut ids = Vec::new();
    for e in items {
        let t = trackers.iter().find(|t| t.id == e.tracker_id).ok_or("That tracker no longer exists.")?;
        let (value, text) = clean(t, e)?;
        db(tx.execute(
            "INSERT INTO tracker_entries (tracker_id, value, text, logged_at, source, checkin_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![t.id, value, text, at, source, checkin],
        ))?;
        ids.push(tx.last_insert_rowid());
    }
    db(tx.commit())?;
    Ok(entries(conn, at, at + 1).map_err(|e| e.to_string())?.into_iter().filter(|e| ids.contains(&e.id)).collect())
}

pub fn delete_entry(conn: &Connection, id: i64) -> Result<()> {
    db(conn.execute("DELETE FROM tracker_entries WHERE id = ?1", [id])).map(|_| ())
}

fn ids_json(ids: &[i64]) -> String {
    serde_json::to_string(ids).unwrap_or_else(|_| "[]".into())
}

pub fn list_checkins(conn: &Connection) -> rusqlite::Result<Vec<Checkin>> {
    let mut stmt = conn.prepare("SELECT id, name, time, days_mask, tracker_ids, include_goal_review FROM checkins ORDER BY time, sort, id")?;
    let rows = stmt.query_map([], |r| {
        let ids: String = r.get(4)?;
        Ok(Checkin {
            id: r.get(0)?,
            name: r.get(1)?,
            time: r.get(2)?,
            days_mask: r.get(3)?,
            tracker_ids: serde_json::from_str(&ids).unwrap_or_default(),
            include_goal_review: r.get::<_, i64>(5)? != 0,
        })
    })?;
    rows.collect()
}

pub fn parse_time(s: &str) -> Option<NaiveTime> {
    NaiveTime::parse_from_str(s.trim(), "%H:%M").ok()
}

pub fn save_checkin(conn: &Connection, c: Checkin) -> Result<Checkin> {
    let name = c.name.trim();
    if name.is_empty() {
        return Err("Give the check-in a name.".into());
    }
    let time = parse_time(&c.time).ok_or_else(|| format!("{} is not a time.", c.time))?.format("%H:%M").to_string();
    if !(1..=127).contains(&c.days_mask) {
        return Err("Pick at least one day.".into());
    }
    let known: Vec<i64> = list(conn).map_err(|e| e.to_string())?.iter().map(|t| t.id).collect();
    let mut ids: Vec<i64> = Vec::new();
    for id in c.tracker_ids {
        if known.contains(&id) && !ids.contains(&id) {
            ids.push(id);
        }
    }
    if ids.is_empty() && !c.include_goal_review {
        return Err("Ask for at least one tracker, or review your goals.".into());
    }
    let id = if c.id > 0 {
        let n = db(conn.execute(
            "UPDATE checkins SET name = ?1, time = ?2, days_mask = ?3, tracker_ids = ?4, include_goal_review = ?5 WHERE id = ?6",
            params![name, time, c.days_mask, ids_json(&ids), c.include_goal_review as i64, c.id],
        ))?;
        if n == 0 {
            return Err("That check-in no longer exists.".into());
        }
        c.id
    } else {
        db(conn.execute(
            "INSERT INTO checkins (name, time, days_mask, tracker_ids, include_goal_review) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![name, time, c.days_mask, ids_json(&ids), c.include_goal_review as i64],
        ))?;
        conn.last_insert_rowid()
    };
    list_checkins(conn).map_err(|e| e.to_string())?.into_iter().find(|x| x.id == id).ok_or_else(|| "That check-in no longer exists.".into())
}

pub fn delete_checkin(conn: &Connection, id: i64) -> Result<()> {
    db(conn.execute("DELETE FROM checkins WHERE id = ?1", [id])).map(|_| ())
}

/// Records that today's check-in was answered or skipped, so it doesn't ask again.
pub fn mark(conn: &Connection, id: i64, date: &str, outcome: &str, at: i64) -> Result<()> {
    db(conn.execute(
        "INSERT INTO checkin_log (checkin_id, date, outcome, at) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(checkin_id, date) DO UPDATE SET outcome = excluded.outcome, at = excluded.at",
        params![id, date, outcome, at],
    ))
    .map(|_| ())
}

pub fn handled_on(conn: &Connection, date: &str) -> rusqlite::Result<Vec<i64>> {
    let mut stmt = conn.prepare("SELECT checkin_id FROM checkin_log WHERE date = ?1")?;
    let rows = stmt.query_map([date], |r| r.get(0))?;
    rows.collect()
}

pub fn date_key(d: NaiveDate) -> String {
    d.format("%Y-%m-%d").to_string()
}

fn local_ms(d: NaiveDate, t: NaiveTime) -> Option<i64> {
    use chrono::TimeZone;
    Local.from_local_datetime(&d.and_time(t)).earliest().map(|x| x.timestamp_millis())
}

/// A check-in that should be showing now.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Due {
    pub checkin_id: i64,
    /// When it was scheduled for today (ms).
    pub scheduled_at: i64,
    /// Local date it belongs to ("YYYY-MM-DD").
    pub date: String,
    /// Scheduled before Sanctum started: only shown with "Check in on startup".
    pub missed: bool,
}

/// Today's check-ins whose time has come and that nobody has answered, skipped, or snoozed.
/// Ones scheduled before Sanctum started count as missed and only show with the startup option.
pub fn due(checkins: &[Checkin], handled: &[i64], snoozed: &HashMap<i64, i64>, now: DateTime<Local>, booted_at: i64, on_startup: bool) -> Vec<Due> {
    let today = now.date_naive();
    let bit = 1i64 << today.weekday().num_days_from_sunday();
    let now_ms = now.timestamp_millis();
    let mut out: Vec<Due> = checkins
        .iter()
        .filter(|c| c.days_mask & bit != 0 && !handled.contains(&c.id))
        .filter(|c| snoozed.get(&c.id).map_or(true, |until| *until <= now_ms))
        .filter_map(|c| {
            let at = local_ms(today, parse_time(&c.time)?)?;
            let missed = at < booted_at;
            (at <= now_ms && (!missed || on_startup)).then(|| Due { checkin_id: c.id, scheduled_at: at, date: date_key(today), missed })
        })
        .collect();
    out.sort_by_key(|d| d.scheduled_at);
    out
}

/// The next check-in still to come today, for Home ("Next check-in 9:30 PM").
pub fn next_today(checkins: &[Checkin], handled: &[i64], now: DateTime<Local>) -> Option<(i64, String)> {
    let bit = 1i64 << now.date_naive().weekday().num_days_from_sunday();
    let t = now.time();
    checkins
        .iter()
        .filter(|c| c.days_mask & bit != 0 && !handled.contains(&c.id))
        .filter_map(|c| parse_time(&c.time).filter(|x| *x > t).map(|x| (x, c)))
        .min_by_key(|(x, _)| *x)
        .map(|(_, c)| (c.id, c.time.clone()))
}

// --- Runtime: the scheduler loop and the commands ---

use crate::{session::now_ms, Shared};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State as TauriState};

pub const EV_CHECKIN: &str = "sanctum://checkin";
const TICK: std::time::Duration = std::time::Duration::from_secs(15);
const SNOOZE_MS: i64 = 15 * 60_000;

pub struct State {
    booted_at: i64,
    snoozed: Mutex<HashMap<i64, i64>>,
    /// The check-in on screen, so the loop doesn't show it twice.
    showing: Mutex<Option<i64>>,
}

impl State {
    pub fn new() -> Self {
        State { booted_at: now_ms(), snoozed: Mutex::new(HashMap::new()), showing: Mutex::new(None) }
    }
}

/// The first check-in due now, or None while sealed (they queue until the seal ends).
fn first_due(shared: &Shared) -> Option<Due> {
    if shared.sealed() || shared.engine.is_active() {
        return None;
    }
    let conn = shared.db.lock().ok()?;
    let now = Local::now();
    let list = list_checkins(&conn).ok()?;
    let handled = handled_on(&conn, &date_key(now.date_naive())).ok()?;
    let on_startup = crate::db::get_setting(&conn, "checkin_on_startup").ok().flatten().as_deref() != Some("0");
    let snoozed = shared.checkins.snoozed.lock().ok()?.clone();
    due(&list, &handled, &snoozed, now, shared.checkins.booted_at, on_startup).into_iter().next()
}

/// Brings the window forward, always on top, for a check-in (SPEC 4.13).
fn present(app: &AppHandle, due: &Due) {
    crate::show_main_window(app);
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.set_always_on_top(true);
    }
    let _ = app.emit(EV_CHECKIN, due);
}

pub fn spawn(app: AppHandle) {
    std::thread::Builder::new()
        .name("sanctum-checkins".into())
        .spawn(move || loop {
            std::thread::sleep(TICK);
            let shared = app.state::<Shared>();
            let Some(d) = first_due(&shared) else { continue };
            let mut showing = shared.checkins.showing.lock().unwrap();
            if *showing == Some(d.checkin_id) {
                continue;
            }
            *showing = Some(d.checkin_id);
            drop(showing);
            present(&app, &d);
        })
        .expect("spawn check-in loop");
}

fn with<T>(shared: &Shared, f: impl FnOnce(&mut Connection) -> Result<T>) -> Result<T> {
    let mut conn = shared.db.lock().map_err(|e| e.to_string())?;
    f(&mut conn)
}

#[tauri::command]
pub fn list_trackers(shared: TauriState<Shared>) -> Result<Vec<Tracker>> {
    with(&shared, |c| db(list(c)))
}

#[tauri::command]
pub fn save_tracker(shared: TauriState<Shared>, draft: TrackerDraft) -> Result<Tracker> {
    with(&shared, |c| save(c, draft, now_ms()))
}

#[tauri::command]
pub fn delete_tracker(shared: TauriState<Shared>, id: i64) -> Result<()> {
    with(&shared, |c| delete(c, id))
}

#[tauri::command]
pub fn tracker_entries(shared: TauriState<Shared>, from: i64, to: i64) -> Result<Vec<Entry>> {
    with(&shared, |c| db(entries(c, from, to)))
}

#[tauri::command]
pub fn log_entries(shared: TauriState<Shared>, items: Vec<NewEntry>, checkin_id: Option<i64>) -> Result<Vec<Entry>> {
    let source = if checkin_id.is_some() { "checkin" } else { "manual" };
    with(&shared, |c| log(c, &items, source, checkin_id, now_ms()))
}

#[tauri::command]
pub fn delete_tracker_entry(shared: TauriState<Shared>, id: i64) -> Result<()> {
    with(&shared, |c| delete_entry(c, id))
}

#[tauri::command]
pub fn list_checkins_cmd(shared: TauriState<Shared>) -> Result<Vec<Checkin>> {
    with(&shared, |c| db(list_checkins(c)))
}

#[tauri::command]
pub fn save_checkin_cmd(shared: TauriState<Shared>, checkin: Checkin) -> Result<Checkin> {
    with(&shared, |c| save_checkin(c, checkin))
}

#[tauri::command]
pub fn delete_checkin_cmd(shared: TauriState<Shared>, id: i64) -> Result<()> {
    with(&shared, |c| delete_checkin(c, id))
}

/// The check-in to show now, if any. The window asks on startup and after a seal ends.
#[tauri::command]
pub fn checkin_pending(app: AppHandle, shared: TauriState<Shared>) -> Option<Due> {
    let d = first_due(&shared)?;
    *shared.checkins.showing.lock().unwrap() = Some(d.checkin_id);
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.set_always_on_top(true);
    }
    Some(d)
}

/// Closes a check-in: "logged" or "skipped" (done for today) or "snoozed" (back in 15 min).
#[tauri::command]
pub fn checkin_answer(app: AppHandle, shared: TauriState<Shared>, id: i64, date: String, outcome: String) -> Result<()> {
    match outcome.as_str() {
        "logged" | "skipped" => with(&shared, |c| mark(c, id, &date, &outcome, now_ms()))?,
        "snoozed" => {
            shared.checkins.snoozed.lock().unwrap().insert(id, now_ms() + SNOOZE_MS);
        }
        _ => return Err(format!("Unknown outcome: {outcome}.")),
    }
    *shared.checkins.showing.lock().unwrap() = None;
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.set_always_on_top(false);
    }
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NextCheckin {
    pub id: i64,
    pub name: String,
    pub time: String,
}

#[tauri::command]
pub fn next_checkin(shared: TauriState<Shared>) -> Result<Option<NextCheckin>> {
    with(&shared, |c| {
        let now = Local::now();
        let list = db(list_checkins(c))?;
        let handled = db(handled_on(c, &date_key(now.date_naive())))?;
        Ok(next_today(&list, &handled, now).and_then(|(id, time)| list.iter().find(|x| x.id == id).map(|x| NextCheckin { id, name: x.name.clone(), time })))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn fresh() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        crate::db::prepare(&mut conn).unwrap();
        conn
    }

    fn tracker(conn: &Connection, name: &str, kind: &str) -> Tracker {
        save(conn, TrackerDraft { name: name.into(), kind: kind.into(), unit: "lb".into(), ..Default::default() }, 0).unwrap()
    }

    #[test]
    fn saves_custom_trackers_of_every_kind() {
        let conn = fresh();
        let w = tracker(&conn, "Weight", "number");
        assert_eq!((w.unit.as_str(), w.display.as_str(), w.sort), ("lb", "both", 0));
        let j = tracker(&conn, "Journal", "text");
        // Text is always a list and has no unit.
        assert_eq!((j.unit.as_str(), j.display.as_str(), j.sort), ("", "table", 1));
        let mood = save(&conn, TrackerDraft { name: "Mood".into(), kind: "scale".into(), goal: Some(14.0), ..Default::default() }, 0).unwrap();
        assert_eq!(mood.goal, None);
        assert!(save(&conn, TrackerDraft { name: "weight".into(), kind: "bool".into(), ..Default::default() }, 0).unwrap_err().contains("already exists"));
        assert!(save(&conn, TrackerDraft { name: " ".into(), kind: "bool".into(), ..Default::default() }, 0).is_err());
        assert!(save(&conn, TrackerDraft { name: "X".into(), kind: "emoji".into(), ..Default::default() }, 0).is_err());
        let renamed = save(&conn, TrackerDraft { id: Some(w.id), name: "Body weight".into(), kind: "number".into(), unit: "kg".into(), display: Some("chart".into()), goal: Some(75.0) }, 0).unwrap();
        assert_eq!((renamed.name.as_str(), renamed.unit.as_str(), renamed.display.as_str(), renamed.goal), ("Body weight", "kg", "chart", Some(75.0)));
    }

    #[test]
    fn logs_checked_values_all_or_nothing() {
        let mut conn = fresh();
        let w = tracker(&conn, "Weight", "number");
        let gym = tracker(&conn, "Gym", "bool");
        let mood = tracker(&conn, "Mood", "scale");
        let note = tracker(&conn, "Journal", "text");
        let e = |id, v: Option<f64>, t: Option<&str>| NewEntry { tracker_id: id, value: v, text: t.map(Into::into) };
        let out = log(&mut conn, &[e(w.id, Some(172.4), None), e(gym.id, Some(1.0), None), e(note.id, None, Some("  Slept well. "))], "checkin", None, 1000).unwrap();
        assert_eq!(out.len(), 3);
        assert_eq!(out[2].text.as_deref(), Some("Slept well."));
        // One bad value rejects the whole check-in.
        assert!(log(&mut conn, &[e(w.id, Some(170.0), None), e(mood.id, Some(11.0), None)], "manual", None, 2000).unwrap_err().contains("1 to 10"));
        assert!(log(&mut conn, &[e(gym.id, Some(0.5), None)], "manual", None, 2000).is_err());
        assert!(log(&mut conn, &[e(note.id, None, Some("   "))], "manual", None, 2000).is_err());
        assert_eq!(entries(&conn, 0, 10_000).unwrap().len(), 3);
        // The type is fixed once there are entries.
        assert!(save(&conn, TrackerDraft { id: Some(w.id), name: "Weight".into(), kind: "scale".into(), ..Default::default() }, 0).is_err());
        delete_entry(&conn, out[0].id).unwrap();
        assert_eq!(entries(&conn, 0, 10_000).unwrap().len(), 2);
    }

    #[test]
    fn checkins_validate_and_forget_deleted_trackers() {
        let conn = fresh();
        let w = tracker(&conn, "Weight", "number");
        let bf = tracker(&conn, "Body fat", "number");
        let c = save_checkin(&conn, Checkin { name: "Morning weigh-in".into(), time: "8:00".into(), days_mask: 0b0010010, tracker_ids: vec![w.id, bf.id, w.id, 99], ..Default::default() }).unwrap();
        assert_eq!((c.time.as_str(), c.tracker_ids.clone()), ("08:00", vec![w.id, bf.id]));
        assert!(save_checkin(&conn, Checkin { name: "Empty".into(), time: "09:00".into(), days_mask: 1, ..Default::default() }).is_err());
        assert!(save_checkin(&conn, Checkin { name: "Wrap".into(), time: "25:00".into(), days_mask: 1, include_goal_review: true, ..Default::default() }).is_err());
        let wrap = save_checkin(&conn, Checkin { name: "Evening wrap-up".into(), time: "21:30".into(), days_mask: 127, include_goal_review: true, ..Default::default() }).unwrap();
        assert!(wrap.include_goal_review);
        delete(&conn, w.id).unwrap();
        assert_eq!(list_checkins(&conn).unwrap()[0].tracker_ids, vec![bf.id]);
        mark(&conn, wrap.id, "2026-09-29", "skipped", 0).unwrap();
        mark(&conn, wrap.id, "2026-09-29", "logged", 1).unwrap();
        assert_eq!(handled_on(&conn, "2026-09-29").unwrap(), vec![wrap.id]);
    }

    #[test]
    fn due_follows_days_snoozes_and_the_startup_option() {
        // Tuesday 2026-09-29, 21:40 local.
        let now = Local.with_ymd_and_hms(2026, 9, 29, 21, 40, 0).unwrap();
        let at = |h, m| Local.with_ymd_and_hms(2026, 9, 29, h, m, 0).unwrap().timestamp_millis();
        let c = |id, time: &str, mask| Checkin { id, name: format!("c{id}"), time: time.into(), days_mask: mask, tracker_ids: vec![1], include_goal_review: false };
        let tue = 1 << 2;
        let list = vec![c(1, "08:00", tue), c(2, "21:30", 127), c(3, "22:00", 127), c(4, "09:00", 1 << 4)];
        let none = HashMap::new();
        // Booted at 7:00: both passed ones are due, earliest first. 22:00 hasn't come; Thursday's isn't today.
        let d = due(&list, &[], &none, now, at(7, 0), false);
        assert_eq!(d.iter().map(|x| x.checkin_id).collect::<Vec<_>>(), vec![1, 2]);
        assert_eq!(d[0].date, "2026-09-29");
        // Booted at 21:35: 8:00 and 21:30 were missed, and only show with the startup option.
        assert!(due(&list, &[], &none, now, at(21, 35), false).is_empty());
        let missed = due(&list, &[], &none, now, at(21, 35), true);
        assert!(missed.iter().all(|x| x.missed) && missed.len() == 2);
        // Answered, skipped, or snoozed ones wait.
        let snoozed = HashMap::from([(2, now.timestamp_millis() + 60_000)]);
        assert_eq!(due(&list, &[1], &snoozed, now, at(7, 0), true), vec![]);
        let past = HashMap::from([(2, now.timestamp_millis() - 1)]);
        assert_eq!(due(&list, &[1], &past, now, at(7, 0), true).len(), 1);
        assert_eq!(next_today(&list, &[], now), Some((3, "22:00".into())));
        assert_eq!(next_today(&list, &[3], now), None);
    }

    #[test]
    fn migration_keeps_old_rows_and_allows_text() {
        let conn = fresh();
        let t = tracker(&conn, "Journal", "text");
        assert!(conn.execute("INSERT INTO tracker_entries (tracker_id, logged_at) VALUES (?1, 0)", [t.id]).is_err());
        conn.execute("INSERT INTO tracker_entries (tracker_id, text, logged_at) VALUES (?1, 'x', 0)", [t.id]).unwrap();
        delete(&conn, t.id).unwrap();
        let left: i64 = conn.query_row("SELECT COUNT(*) FROM tracker_entries", [], |r| r.get(0)).unwrap();
        assert_eq!(left, 0);
    }
}
