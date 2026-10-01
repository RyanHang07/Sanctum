//! The database side of Google Calendar sync (SPEC 4.3, 4.12): the outbox of local edits,
//! the event bodies Sanctum writes, applying edits made in Google, and the event cache.
//! Network calls live in mod.rs; everything here is testable offline.

use crate::db;
use crate::session::now_ms;
use chrono::{DateTime, Datelike, Duration, Local, NaiveDate, NaiveDateTime, NaiveTime, TimeZone, Timelike};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashSet;

pub const K_ACCOUNT: &str = "gcal_account";
pub const K_SANCTUM: &str = "gcal_sanctum_id";
pub const K_TZ: &str = "gcal_tz";
pub const K_SYNC_TOKEN: &str = "gcal_sync_token";
pub const K_RECONNECT: &str = "gcal_needs_reconnect";
pub const K_LAST_SYNC: &str = "gcal_last_sync";

pub const SANCTUM_SUMMARY: &str = "Sanctum";
/// Also how Sanctum finds its calendar again after a disconnect.
pub const SANCTUM_DESCRIPTION: &str = "Routines and plans from Sanctum. Sanctum keeps this calendar in sync.";
const FROM_SANCTUM: &str = "From Sanctum.";
/// Checked-off items carry this prefix in Google (decided 2026-09-29).
pub const DONE_MARK: &str = "✓ ";
const DEFAULT_BLOCK_MIN: i64 = 60;

pub fn connected(conn: &Connection) -> bool {
    db::get_setting(conn, K_ACCOUNT).ok().flatten().is_some()
}

// --- local time ---

fn date(s: &str) -> Option<NaiveDate> {
    NaiveDate::parse_from_str(s, "%Y-%m-%d").ok()
}

fn time(s: &str) -> Option<NaiveTime> {
    NaiveTime::parse_from_str(s, "%H:%M").ok()
}

fn key(d: NaiveDate) -> String {
    d.format("%Y-%m-%d").to_string()
}

/// The planner's today: before the daily reset time (4:00 AM), it's still yesterday.
pub fn today(conn: &Connection) -> String {
    let reset = db::get_setting(conn, "daily_reset_time").ok().flatten().and_then(|t| time(&t)).unwrap_or(NaiveTime::MIN);
    let shift = Duration::seconds(i64::from(reset.num_seconds_from_midnight()));
    key((Local::now() - shift).date_naive())
}

pub fn add_days(d: &str, n: i64) -> String {
    date(d).map(|x| key(x + Duration::days(n))).unwrap_or_else(|| d.to_string())
}

/// Local wall time as RFC 3339 with this machine's offset.
pub fn local_rfc3339(d: &str, t: &str) -> Option<String> {
    let dt = NaiveDateTime::new(date(d)?, time(t)?);
    Local.from_local_datetime(&dt).earliest().map(|x| x.to_rfc3339())
}

fn naive(d: &str, t: &str) -> Option<NaiveDateTime> {
    Some(NaiveDateTime::new(date(d)?, time(t)?))
}

fn wall(dt: NaiveDateTime) -> String {
    dt.format("%Y-%m-%dT%H:%M:00").to_string()
}

/// A start or end from Google in local time, or None for all-day.
fn local_instant(v: &Value) -> Option<DateTime<Local>> {
    DateTime::parse_from_rfc3339(v["dateTime"].as_str()?).ok().map(|x| x.with_timezone(&Local))
}

// --- weekdays <-> RRULE (bit 0 = Sunday, as in planner.rs) ---

const BYDAY: [&str; 7] = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

pub fn rrule(mask: i64) -> String {
    if mask == 127 {
        return "RRULE:FREQ=DAILY".into();
    }
    let days: Vec<&str> = (0..7).filter(|b| mask & (1 << b) != 0).map(|b| BYDAY[b]).collect();
    format!("RRULE:FREQ=WEEKLY;BYDAY={}", days.join(","))
}

/// Reads the weekdays back from a recurrence edited in Google. None if it isn't a plain
/// daily or weekly rule (monthly and the like keep the local days).
pub fn mask_from_recurrence(recurrence: &Value) -> Option<i64> {
    let rule = recurrence.as_array()?.iter().filter_map(Value::as_str).find(|l| l.starts_with("RRULE:"))?;
    let parts: Vec<(&str, &str)> = rule[6..].split(';').filter_map(|p| p.split_once('=')).collect();
    let get = |k: &str| parts.iter().find(|(key, _)| *key == k).map(|(_, v)| *v);
    if get("INTERVAL").is_some_and(|i| i != "1") {
        return None;
    }
    match get("FREQ")? {
        "DAILY" => Some(127),
        "WEEKLY" => {
            let mut mask = 0;
            for d in get("BYDAY")?.split(',') {
                mask |= 1 << BYDAY.iter().position(|x| *x == d)?;
            }
            (mask > 0).then_some(mask)
        }
        _ => None,
    }
}

/// First day on or after `from` that the routine falls on.
pub fn first_on_or_after(from: &str, mask: i64) -> String {
    let Some(mut d) = date(from) else { return from.to_string() };
    for _ in 0..7 {
        if mask & (1 << d.weekday().num_days_from_sunday()) != 0 {
            break;
        }
        d += Duration::days(1);
    }
    key(d)
}

pub fn is_done_title(t: &str) -> bool {
    t.trim_start().starts_with('✓')
}

pub fn strip_done(t: &str) -> String {
    t.trim_start().trim_start_matches('✓').trim().to_string()
}

pub fn titled(title: &str, done: bool) -> String {
    if done {
        format!("{DONE_MARK}{title}")
    } else {
        title.to_string()
    }
}

// --- outbox ---

#[derive(Clone, Debug, PartialEq)]
pub enum Job {
    Routine(i64),
    Todo(i64),
    Check(i64, String),
    Delete(String),
}

/// Queues a local change for Google. Does nothing while disconnected.
pub fn enqueue(conn: &Connection, job: Job) -> rusqlite::Result<()> {
    if !connected(conn) {
        return Ok(());
    }
    let (kind, ref_id, d, event): (&str, Option<i64>, Option<String>, Option<String>) = match job {
        Job::Routine(id) => ("routine", Some(id), None, None),
        Job::Todo(id) => ("todo", Some(id), None, None),
        Job::Check(id, d) => ("check", Some(id), Some(d), None),
        Job::Delete(e) => ("delete", None, None, Some(e)),
    };
    conn.execute(
        "INSERT INTO gcal_outbox (kind, ref_id, date, event_id, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![kind, ref_id, d, event, now_ms()],
    )?;
    Ok(())
}

/// Queued jobs, oldest first, with duplicates folded together (the row ids to clear with them).
pub fn pending(conn: &Connection) -> rusqlite::Result<Vec<(Vec<i64>, Job)>> {
    let mut stmt = conn.prepare("SELECT id, kind, ref_id, date, event_id FROM gcal_outbox ORDER BY id")?;
    let rows = stmt.query_map([], |r| {
        let kind: String = r.get(1)?;
        let ref_id: Option<i64> = r.get(2)?;
        let job = match kind.as_str() {
            "routine" => Job::Routine(ref_id.unwrap_or(0)),
            "todo" => Job::Todo(ref_id.unwrap_or(0)),
            "check" => Job::Check(ref_id.unwrap_or(0), r.get::<_, Option<String>>(3)?.unwrap_or_default()),
            _ => Job::Delete(r.get::<_, Option<String>>(4)?.unwrap_or_default()),
        };
        Ok((r.get::<_, i64>(0)?, job))
    })?;
    let mut out: Vec<(Vec<i64>, Job)> = Vec::new();
    for row in rows {
        let (id, job) = row?;
        match out.iter_mut().find(|(_, j)| *j == job) {
            Some((ids, _)) => ids.push(id),
            None => out.push((vec![id], job)),
        }
    }
    Ok(out)
}

pub fn clear_jobs(conn: &Connection, ids: &[i64]) -> rusqlite::Result<()> {
    for id in ids {
        conn.execute("DELETE FROM gcal_outbox WHERE id = ?1", [id])?;
    }
    Ok(())
}

fn has_pending(conn: &Connection, kind: &str, ref_id: i64) -> rusqlite::Result<bool> {
    conn.query_row("SELECT EXISTS(SELECT 1 FROM gcal_outbox WHERE kind = ?1 AND ref_id = ?2)", params![kind, ref_id], |r| r.get(0))
}

/// First connect: routines and timed items from today on go up (decided 2026-09-29).
pub fn backfill(conn: &Connection) -> rusqlite::Result<()> {
    let today = today(conn);
    let ids = |sql: &str, arg: Option<&str>| -> rusqlite::Result<Vec<i64>> {
        let mut stmt = conn.prepare(sql)?;
        let rows = match arg {
            Some(a) => stmt.query_map([a], |r| r.get(0))?.collect(),
            None => stmt.query_map([], |r| r.get(0))?.collect(),
        };
        rows
    };
    for id in ids("SELECT id FROM daily_goals WHERE active = 1 AND time IS NOT NULL ORDER BY id", None)? {
        enqueue(conn, Job::Routine(id))?;
    }
    for id in ids("SELECT id FROM todos WHERE due_time IS NOT NULL AND due_date >= ?1 ORDER BY id", Some(&today))? {
        enqueue(conn, Job::Todo(id))?;
    }
    let mut stmt = conn.prepare("SELECT goal_id, date FROM daily_goal_checks WHERE date >= ?1")?;
    let checks: Vec<(i64, String)> = stmt.query_map([&today], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<rusqlite::Result<_>>()?;
    for (id, d) in checks {
        enqueue(conn, Job::Check(id, d))?;
    }
    Ok(())
}

// --- what Sanctum writes ---

pub struct PushRoutine {
    pub id: i64,
    pub title: String,
    pub active: bool,
    pub days_mask: i64,
    pub time: Option<String>,
    pub duration_min: Option<i64>,
    pub event_id: Option<String>,
    pub start_date: Option<String>,
}

pub fn push_routine(conn: &Connection, id: i64) -> rusqlite::Result<Option<PushRoutine>> {
    conn.query_row(
        "SELECT id, name, active, days_mask, time, duration_min, gcal_event_id, gcal_start_date FROM daily_goals WHERE id = ?1",
        [id],
        |r| {
            Ok(PushRoutine {
                id: r.get(0)?,
                title: r.get(1)?,
                active: r.get::<_, i64>(2)? != 0,
                days_mask: r.get(3)?,
                time: r.get(4)?,
                duration_min: r.get(5)?,
                event_id: r.get(6)?,
                start_date: r.get(7)?,
            })
        },
    )
    .optional()
}

pub struct PushTodo {
    pub id: i64,
    pub title: String,
    pub date: String,
    pub time: Option<String>,
    pub duration_min: Option<i64>,
    pub done: bool,
    pub event_id: Option<String>,
}

pub fn push_todo(conn: &Connection, id: i64) -> rusqlite::Result<Option<PushTodo>> {
    conn.query_row(
        "SELECT id, title, due_date, due_time, duration_min, done_at IS NOT NULL, gcal_event_id FROM todos WHERE id = ?1",
        [id],
        |r| {
            Ok(PushTodo {
                id: r.get(0)?,
                title: r.get(1)?,
                date: r.get(2)?,
                time: r.get(3)?,
                duration_min: r.get(4)?,
                done: r.get(5)?,
                event_id: r.get(6)?,
            })
        },
    )
    .optional()
}

fn span(d: &str, t: &str, minutes: Option<i64>, tz: &str) -> Option<(Value, Value)> {
    let start = naive(d, t)?;
    let end = start + Duration::minutes(minutes.unwrap_or(DEFAULT_BLOCK_MIN));
    Some((json!({ "dateTime": wall(start), "timeZone": tz }), json!({ "dateTime": wall(end), "timeZone": tz })))
}

/// One recurring series per routine, anchored at `start_date`.
pub fn routine_body(r: &PushRoutine, start_date: &str, tz: &str) -> Option<Value> {
    let (start, end) = span(start_date, r.time.as_deref()?, r.duration_min, tz)?;
    Some(json!({
        "summary": r.title,
        "description": FROM_SANCTUM,
        "start": start,
        "end": end,
        "recurrence": [rrule(r.days_mask)],
        "extendedProperties": { "private": { "sanctum": format!("routine:{}", r.id) } },
    }))
}

pub fn todo_body(t: &PushTodo, tz: &str) -> Option<Value> {
    let (start, end) = span(&t.date, t.time.as_deref()?, t.duration_min, tz)?;
    Some(json!({
        "summary": titled(&t.title, t.done),
        "description": FROM_SANCTUM,
        "start": start,
        "end": end,
        "extendedProperties": { "private": { "sanctum": format!("todo:{}", t.id) } },
    }))
}

pub fn set_routine_link(conn: &Connection, id: i64, event: Option<(&str, &str)>, start_date: Option<&str>) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE daily_goals SET gcal_event_id = ?1, gcal_etag = ?2, gcal_start_date = ?3 WHERE id = ?4",
        params![event.map(|e| e.0), event.map(|e| e.1), start_date, id],
    )?;
    Ok(())
}

pub fn set_todo_link(conn: &Connection, id: i64, event: Option<(&str, &str)>) -> rusqlite::Result<()> {
    conn.execute("UPDATE todos SET gcal_event_id = ?1, gcal_etag = ?2 WHERE id = ?3", params![event.map(|e| e.0), event.map(|e| e.1), id])?;
    Ok(())
}

pub fn routine_done(conn: &Connection, id: i64, d: &str) -> rusqlite::Result<bool> {
    conn.query_row("SELECT EXISTS(SELECT 1 FROM daily_goal_checks WHERE goal_id = ?1 AND date = ?2)", params![id, d], |r| r.get(0))
}

/// Forgets every link to Google (after the Sanctum calendar is removed).
pub fn unlink_all(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "UPDATE daily_goals SET gcal_event_id = NULL, gcal_etag = NULL, gcal_start_date = NULL;
         UPDATE todos SET gcal_event_id = NULL, gcal_etag = NULL;",
    )
}

/// Clears everything a connection left behind, except the links (reconnecting reuses them).
pub fn forget_account(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch("DELETE FROM gcal_events; DELETE FROM gcal_outbox; DELETE FROM gcal_calendars;")?;
    for k in [K_ACCOUNT, K_SANCTUM, K_SYNC_TOKEN, K_RECONNECT, K_LAST_SYNC] {
        conn.execute("DELETE FROM settings WHERE key = ?1", [k])?;
    }
    Ok(())
}

// --- edits made in Google, on the Sanctum calendar ---

fn original_date(item: &Value) -> Option<String> {
    let o = &item["originalStartTime"];
    local_instant(o).map(|x| key(x.date_naive())).or_else(|| o["date"].as_str().map(str::to_string))
}

/// Start date, start time, and length of a timed event, in local time.
fn timed(item: &Value) -> Option<(String, String, i64)> {
    let start = local_instant(&item["start"])?;
    let end = local_instant(&item["end"])?;
    let minutes = (end - start).num_minutes().clamp(5, 480);
    Some((key(start.date_naive()), start.format("%H:%M").to_string(), minutes))
}

/// Applies one changed event from the Sanctum calendar to the local routine or item it
/// belongs to. Last edit wins: a local edit still waiting in the outbox beats Google's.
/// Returns true if something local changed.
pub fn apply_remote(conn: &Connection, item: &Value) -> rusqlite::Result<bool> {
    let id = item["id"].as_str().unwrap_or_default();
    let cancelled = item["status"].as_str() == Some("cancelled");
    let summary = item["summary"].as_str().unwrap_or_default();

    if let Some(master) = item["recurringEventId"].as_str() {
        // One day of a routine: a ✓ in its title means done that day.
        let rid: Option<i64> = conn.query_row("SELECT id FROM daily_goals WHERE gcal_event_id = ?1", [master], |r| r.get(0)).optional()?;
        let (Some(rid), Some(d)) = (rid, original_date(item)) else { return Ok(false) };
        if cancelled || has_pending(conn, "check", rid)? {
            return Ok(false);
        }
        let n = if is_done_title(summary) {
            conn.execute("INSERT OR IGNORE INTO daily_goal_checks (goal_id, date, done_at) VALUES (?1, ?2, ?3)", params![rid, d, now_ms()])?
        } else {
            conn.execute("DELETE FROM daily_goal_checks WHERE goal_id = ?1 AND date = ?2", params![rid, d])?
        };
        return Ok(n > 0);
    }

    let etag = item["etag"].as_str();
    let routine: Option<(i64, Option<String>)> =
        conn.query_row("SELECT id, gcal_etag FROM daily_goals WHERE gcal_event_id = ?1", [id], |r| Ok((r.get(0)?, r.get(1)?))).optional()?;
    if let Some((rid, local_etag)) = routine {
        if has_pending(conn, "routine", rid)? || (!cancelled && local_etag.as_deref() == etag) {
            return Ok(false);
        }
        if cancelled {
            conn.execute("DELETE FROM daily_goals WHERE id = ?1", [rid])?;
            return Ok(true);
        }
        let Some((start_date, start_time, minutes)) = timed(item) else { return Ok(false) };
        let mask: Option<i64> = mask_from_recurrence(&item["recurrence"]);
        conn.execute(
            "UPDATE daily_goals SET name = ?1, time = ?2, duration_min = ?3, days_mask = COALESCE(?4, days_mask),
             gcal_etag = ?5, gcal_start_date = ?6 WHERE id = ?7",
            params![strip_done(summary), start_time, minutes, mask, etag, start_date, rid],
        )?;
        return Ok(true);
    }

    let todo: Option<(i64, Option<String>)> =
        conn.query_row("SELECT id, gcal_etag FROM todos WHERE gcal_event_id = ?1", [id], |r| Ok((r.get(0)?, r.get(1)?))).optional()?;
    if let Some((tid, local_etag)) = todo {
        if has_pending(conn, "todo", tid)? || (!cancelled && local_etag.as_deref() == etag) {
            return Ok(false);
        }
        if cancelled {
            conn.execute("DELETE FROM todos WHERE id = ?1", [tid])?;
            return Ok(true);
        }
        let (d, t, minutes) = match timed(item) {
            Some((d, t, m)) => (d, Some(t), Some(m)),
            // Made all-day in Google: keep the date, drop the time.
            None => match item["start"]["date"].as_str() {
                Some(d) => (d.to_string(), None, None),
                None => return Ok(false),
            },
        };
        let now = now_ms();
        conn.execute(
            "UPDATE todos SET title = ?1, due_date = ?2, due_time = ?3, duration_min = ?4,
             done_at = CASE WHEN ?5 THEN COALESCE(done_at, ?6) ELSE NULL END, gcal_etag = ?7, updated_at = ?6 WHERE id = ?8",
            params![strip_done(summary), d, t, minutes, is_done_title(summary), now, etag, tid],
        )?;
        return Ok(true);
    }
    Ok(false)
}

/// Event ids that are Sanctum's own routines and items (shown from the planner, not the cache).
pub fn own_event_ids(conn: &Connection) -> rusqlite::Result<HashSet<String>> {
    let mut stmt = conn.prepare(
        "SELECT gcal_event_id FROM daily_goals WHERE gcal_event_id IS NOT NULL
         UNION SELECT gcal_event_id FROM todos WHERE gcal_event_id IS NOT NULL",
    )?;
    let rows = stmt.query_map([], |r| r.get(0))?;
    rows.collect()
}

// --- calendars and the event cache ---

pub fn upsert_calendars(conn: &Connection, entries: &[Value], sanctum_id: Option<&str>) -> rusqlite::Result<()> {
    let mut seen = Vec::new();
    for (i, e) in entries.iter().enumerate() {
        let Some(id) = e["id"].as_str() else { continue };
        let summary = e["summaryOverride"].as_str().or(e["summary"].as_str()).unwrap_or(id);
        let primary = e["primary"].as_bool().unwrap_or(false);
        let sanctum = Some(id) == sanctum_id;
        let writable = matches!(e["accessRole"].as_str(), Some("owner" | "writer"));
        conn.execute(
            "INSERT INTO gcal_calendars (id, summary, is_primary, is_sanctum, writable, selected, sort)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(id) DO UPDATE SET summary = excluded.summary, is_primary = excluded.is_primary,
               is_sanctum = excluded.is_sanctum, writable = excluded.writable, sort = excluded.sort",
            params![id, summary, primary, sanctum, writable, primary || sanctum, i as i64],
        )?;
        seen.push(id.to_string());
    }
    let mut stmt = conn.prepare("SELECT id FROM gcal_calendars")?;
    let known: Vec<String> = stmt.query_map([], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?;
    for id in known.iter().filter(|k| !seen.contains(k)) {
        conn.execute("DELETE FROM gcal_events WHERE calendar_id = ?1", [id])?;
        conn.execute("DELETE FROM gcal_calendars WHERE id = ?1", [id])?;
    }
    Ok(())
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Calendar {
    pub id: String,
    pub summary: String,
    pub primary: bool,
    pub sanctum: bool,
    pub writable: bool,
    pub selected: bool,
}

pub fn list_calendars(conn: &Connection) -> rusqlite::Result<Vec<Calendar>> {
    let mut stmt = conn.prepare(
        "SELECT id, summary, is_primary, is_sanctum, writable, selected FROM gcal_calendars
         ORDER BY is_primary DESC, is_sanctum DESC, sort",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(Calendar { id: r.get(0)?, summary: r.get(1)?, primary: r.get(2)?, sanctum: r.get(3)?, writable: r.get(4)?, selected: r.get(5)? })
    })?;
    rows.collect()
}

pub fn selected_calendars(conn: &Connection) -> rusqlite::Result<Vec<String>> {
    let mut stmt = conn.prepare("SELECT id FROM gcal_calendars WHERE selected = 1 ORDER BY sort")?;
    let rows = stmt.query_map([], |r| r.get(0))?;
    rows.collect()
}

pub fn set_selected(conn: &Connection, id: &str, selected: bool) -> rusqlite::Result<()> {
    conn.execute("UPDATE gcal_calendars SET selected = ?1 WHERE id = ?2", params![selected, id])?;
    Ok(())
}

/// One occurrence as cached.
#[derive(Debug, PartialEq)]
pub struct Parsed {
    pub id: String,
    pub title: String,
    pub date: String,
    pub end_date: String,
    pub time: Option<String>,
    pub duration_min: Option<i64>,
    pub start_ms: i64,
    pub end_ms: i64,
    pub all_day: bool,
    pub attendees: i64,
    pub recurring: bool,
    pub series_id: Option<String>,
    pub html_link: Option<String>,
}

/// Reads an occurrence (singleEvents=true). Cancelled and declined events are skipped.
pub fn parse_event(item: &Value) -> Option<Parsed> {
    if item["status"].as_str() == Some("cancelled") {
        return None;
    }
    let attendees = item["attendees"].as_array().cloned().unwrap_or_default();
    if attendees.iter().any(|a| a["self"].as_bool() == Some(true) && a["responseStatus"].as_str() == Some("declined")) {
        return None;
    }
    let others = attendees.iter().filter(|a| a["self"].as_bool() != Some(true) && a["resource"].as_bool() != Some(true)).count() as i64;
    let (d, end_date, t, minutes, start_ms, end_ms, all_day) = match (local_instant(&item["start"]), local_instant(&item["end"])) {
        (Some(s), Some(e)) => {
            let last = if e > s { e - Duration::minutes(1) } else { s };
            let minutes = (e - s).num_minutes().max(0);
            (key(s.date_naive()), key(last.date_naive()), Some(s.format("%H:%M").to_string()), Some(minutes), s.timestamp_millis(), e.timestamp_millis(), false)
        }
        _ => {
            let s = date(item["start"]["date"].as_str()?)?;
            // Google's all-day end date is exclusive.
            let e = item["end"]["date"].as_str().and_then(date).unwrap_or(s + Duration::days(1));
            let ms = |x: NaiveDate| Local.from_local_datetime(&x.and_time(NaiveTime::MIN)).earliest().map(|v| v.timestamp_millis()).unwrap_or(0);
            (key(s), key((e - Duration::days(1)).max(s)), None, None, ms(s), ms(e), true)
        }
    };
    Some(Parsed {
        id: item["id"].as_str()?.to_string(),
        title: item["summary"].as_str().filter(|s| !s.trim().is_empty()).unwrap_or("(No title)").to_string(),
        date: d,
        end_date,
        time: t,
        duration_min: minutes,
        start_ms,
        end_ms,
        all_day,
        attendees: others,
        recurring: item["recurringEventId"].is_string(),
        series_id: item["recurringEventId"].as_str().map(str::to_string),
        html_link: item["htmlLink"].as_str().map(str::to_string),
    })
}

fn insert_event(conn: &Connection, calendar: &str, p: &Parsed) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT OR REPLACE INTO gcal_events (calendar_id, event_id, title, date, end_date, start_time, duration_min,
           start_ms, end_ms, all_day, attendees, recurring, html_link, series_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
        params![calendar, p.id, p.title, p.date, p.end_date, p.time, p.duration_min, p.start_ms, p.end_ms, p.all_day, p.attendees, p.recurring, p.html_link, p.series_id],
    )?;
    Ok(())
}

/// Replaces the cache for one calendar over [from, to] with a fresh listing, leaving out
/// Sanctum's own routines and items.
pub fn store_window(conn: &Connection, calendar: &str, from: &str, to: &str, items: &[Value], own: &HashSet<String>) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM gcal_events WHERE calendar_id = ?1 AND date BETWEEN ?2 AND ?3", params![calendar, from, to])?;
    for item in items {
        let mine = item["id"].as_str().is_some_and(|i| own.contains(i))
            || item["recurringEventId"].as_str().is_some_and(|i| own.contains(i))
            || item["extendedProperties"]["private"]["sanctum"].is_string();
        if mine {
            continue;
        }
        if let Some(p) = parse_event(item) {
            insert_event(conn, calendar, &p)?;
        }
    }
    Ok(())
}

pub fn store_one(conn: &Connection, calendar: &str, item: &Value) -> rusqlite::Result<()> {
    if let Some(id) = item["id"].as_str() {
        conn.execute("DELETE FROM gcal_events WHERE calendar_id = ?1 AND event_id = ?2", params![calendar, id])?;
    }
    if let Some(p) = parse_event(item) {
        insert_event(conn, calendar, &p)?;
    }
    Ok(())
}

pub fn forget_event(conn: &Connection, calendar: &str, id: &str) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM gcal_events WHERE calendar_id = ?1 AND event_id = ?2", params![calendar, id])?;
    Ok(())
}

/// Drops every cached occurrence of a series (it was edited or deleted as a whole; the next
/// sync brings back what's left).
pub fn forget_series(conn: &Connection, calendar: &str, series: &str) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM gcal_events WHERE calendar_id = ?1 AND (series_id = ?2 OR event_id = ?2)", params![calendar, series])?;
    Ok(())
}

/// The body that moves a whole series to a new time and length, keeping the day it started on
/// and its time zone (Google requires one on recurring events). None for an all-day master.
pub fn series_body(master: &Value, title: &str, t: Option<&str>, minutes: Option<i64>) -> Option<Value> {
    let Some(t) = t else { return Some(json!({ "summary": title })) };
    let start = master["start"]["dateTime"].as_str()?;
    let first_day = chrono::DateTime::parse_from_rfc3339(start).ok()?.format("%Y-%m-%d").to_string();
    let mut body = event_body(title, &first_day, Some(t), minutes)?;
    for side in ["start", "end"] {
        if let Some(tz) = master[side]["timeZone"].as_str() {
            body[side]["timeZone"] = json!(tz);
        }
    }
    Some(body)
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CalEvent {
    pub calendar_id: String,
    pub calendar_name: String,
    pub event_id: String,
    pub title: String,
    pub date: String,
    pub end_date: String,
    pub time: Option<String>,
    pub duration_min: Option<i64>,
    pub start_ms: i64,
    pub end_ms: i64,
    pub all_day: bool,
    /// Other people invited (not you, not rooms).
    pub attendees: i64,
    pub recurring: bool,
    /// The recurring series this occurrence belongs to.
    pub series_id: Option<String>,
    pub html_link: Option<String>,
    pub writable: bool,
}

/// Cached events on the selected calendars that touch [from, to].
pub fn list_events(conn: &Connection, from: &str, to: &str) -> rusqlite::Result<Vec<CalEvent>> {
    let mut stmt = conn.prepare(
        "SELECT e.calendar_id, c.summary, e.event_id, e.title, e.date, e.end_date, e.start_time, e.duration_min,
                e.start_ms, e.end_ms, e.all_day, e.attendees, e.recurring, e.html_link, c.writable, e.series_id
         FROM gcal_events e JOIN gcal_calendars c ON c.id = e.calendar_id
         WHERE c.selected = 1 AND e.date <= ?2 AND e.end_date >= ?1
         ORDER BY e.all_day DESC, e.start_ms, e.title",
    )?;
    let rows = stmt.query_map([from, to], |r| {
        Ok(CalEvent {
            calendar_id: r.get(0)?,
            calendar_name: r.get(1)?,
            event_id: r.get(2)?,
            title: r.get(3)?,
            date: r.get(4)?,
            end_date: r.get(5)?,
            time: r.get(6)?,
            duration_min: r.get(7)?,
            start_ms: r.get(8)?,
            end_ms: r.get(9)?,
            all_day: r.get(10)?,
            attendees: r.get(11)?,
            recurring: r.get(12)?,
            html_link: r.get(13)?,
            writable: r.get(14)?,
            series_id: r.get(15)?,
        })
    })?;
    rows.collect()
}

/// Body for an event you create or edit on one of your calendars from Week.
pub fn event_body(title: &str, d: &str, t: Option<&str>, minutes: Option<i64>) -> Option<Value> {
    match t {
        Some(t) => {
            let start = naive(d, t)?;
            let end = start + Duration::minutes(minutes.unwrap_or(DEFAULT_BLOCK_MIN));
            let at = |x: NaiveDateTime| Local.from_local_datetime(&x).earliest().map(|v| v.to_rfc3339());
            Some(json!({ "summary": title, "start": { "dateTime": at(start)?, "date": null }, "end": { "dateTime": at(end)?, "date": null } }))
        }
        None => {
            let start = date(d)?;
            Some(json!({
                "summary": title,
                "start": { "date": key(start), "dateTime": null },
                "end": { "date": key(start + Duration::days(1)), "dateTime": null },
            }))
        }
    }
}

#[cfg(test)]
mod series_tests {
    use super::*;

    #[test]
    fn a_series_moves_to_a_new_time_on_its_first_day_in_its_own_zone() {
        let master = json!({
            "start": { "dateTime": "2026-09-01T09:00:00-04:00", "timeZone": "America/New_York" },
            "end": { "dateTime": "2026-09-01T09:30:00-04:00", "timeZone": "America/New_York" },
            "recurrence": ["RRULE:FREQ=WEEKLY;BYDAY=TU"]
        });
        let b = series_body(&master, "Standup", Some("10:15"), Some(45)).unwrap();
        assert_eq!(b["summary"], "Standup");
        assert!(b["start"]["dateTime"].as_str().unwrap().starts_with("2026-09-01T10:15:00"));
        assert!(b["end"]["dateTime"].as_str().unwrap().starts_with("2026-09-01T11:00:00"));
        assert_eq!(b["start"]["timeZone"], "America/New_York");
        // A rename alone leaves the times to Google.
        assert_eq!(series_body(&master, "Sync", None, None).unwrap(), json!({ "summary": "Sync" }));
        // An all-day master can't take a time.
        assert!(series_body(&json!({ "start": { "date": "2026-09-01" } }), "Off", Some("09:00"), Some(30)).is_none());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::planner;

    fn fresh() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        db::prepare(&mut conn).unwrap();
        conn
    }

    fn connect(conn: &Connection) {
        db::set_setting(conn, K_ACCOUNT, "someone@example.com").unwrap();
    }

    fn at(d: &str, t: &str) -> String {
        local_rfc3339(d, t).unwrap()
    }

    fn routine(conn: &Connection, title: &str, mask: i64, time: Option<&str>) -> i64 {
        planner::save_routine(
            conn,
            planner::RoutineDraft { title: title.into(), days_mask: mask, time: time.map(Into::into), duration_min: Some(60), active: true, ..Default::default() },
        )
        .unwrap()
        .id
    }

    fn todo(conn: &Connection, title: &str, d: &str, time: Option<&str>) -> i64 {
        planner::save_todo(conn, planner::TodoDraft { title: title.into(), due_date: d.into(), due_time: time.map(Into::into), duration_min: Some(45), ..Default::default() })
            .unwrap()
            .id
    }

    #[test]
    fn weekdays_round_trip_through_rrule() {
        assert_eq!(rrule(127), "RRULE:FREQ=DAILY");
        assert_eq!(rrule(0b0101010), "RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR");
        for mask in [1, 42, 62, 65, 126] {
            assert_eq!(mask_from_recurrence(&json!([rrule(mask)])), Some(mask), "mask {mask}");
        }
        assert_eq!(mask_from_recurrence(&json!(["RRULE:FREQ=DAILY"])), Some(127));
        assert_eq!(mask_from_recurrence(&json!(["RRULE:FREQ=MONTHLY;BYDAY=1MO"])), None);
        assert_eq!(mask_from_recurrence(&json!(["RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO"])), None);
        // 2026-09-29 is a Tuesday: the next Monday/Wednesday/Friday is Wednesday.
        assert_eq!(first_on_or_after("2026-09-29", 0b0101010), "2026-09-30");
        assert_eq!(first_on_or_after("2026-09-29", 127), "2026-09-29");
    }

    #[test]
    fn done_titles() {
        assert_eq!(titled("Gym", true), "✓ Gym");
        assert!(is_done_title("✓ Gym") && !is_done_title("Gym"));
        assert_eq!(strip_done("✓ Gym"), "Gym");
        assert_eq!(strip_done("Gym"), "Gym");
    }

    #[test]
    fn outbox_waits_for_a_connection_and_folds_duplicates() {
        let conn = fresh();
        enqueue(&conn, Job::Todo(1)).unwrap();
        assert!(pending(&conn).unwrap().is_empty(), "nothing queues while disconnected");
        connect(&conn);
        enqueue(&conn, Job::Todo(1)).unwrap();
        enqueue(&conn, Job::Routine(2)).unwrap();
        enqueue(&conn, Job::Todo(1)).unwrap();
        enqueue(&conn, Job::Check(2, "2026-09-29".into())).unwrap();
        enqueue(&conn, Job::Delete("abc".into())).unwrap();
        let jobs = pending(&conn).unwrap();
        assert_eq!(jobs.iter().map(|(_, j)| j.clone()).collect::<Vec<_>>(), vec![Job::Todo(1), Job::Routine(2), Job::Check(2, "2026-09-29".into()), Job::Delete("abc".into())]);
        assert_eq!(jobs[0].0.len(), 2);
        clear_jobs(&conn, &jobs[0].0).unwrap();
        assert_eq!(pending(&conn).unwrap().len(), 3);
    }

    #[test]
    fn backfill_pushes_today_onward() {
        let conn = fresh();
        let today = today(&conn);
        let gym = routine(&conn, "Gym", 127, Some("07:00"));
        routine(&conn, "Stretch", 127, None); // anytime: stays local
        let soon = todo(&conn, "Mock interview", &add_days(&today, 1), Some("14:00"));
        todo(&conn, "Past", &add_days(&today, -3), Some("09:00"));
        todo(&conn, "Untimed", &today, None);
        planner::set_routine_done(&conn, gym, &today, true).unwrap();
        connect(&conn);
        backfill(&conn).unwrap();
        let jobs: Vec<Job> = pending(&conn).unwrap().into_iter().map(|(_, j)| j).collect();
        assert_eq!(jobs, vec![Job::Routine(gym), Job::Todo(soon), Job::Check(gym, today)]);
    }

    #[test]
    fn builds_event_bodies() {
        let r = PushRoutine { id: 3, title: "Gym".into(), active: true, days_mask: 42, time: Some("07:00".into()), duration_min: Some(90), event_id: None, start_date: None };
        let b = routine_body(&r, "2026-09-30", "America/New_York").unwrap();
        assert_eq!(b["start"], json!({ "dateTime": "2026-09-30T07:00:00", "timeZone": "America/New_York" }));
        assert_eq!(b["end"]["dateTime"], "2026-09-30T08:30:00");
        assert_eq!(b["recurrence"], json!(["RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR"]));
        assert_eq!(b["extendedProperties"]["private"]["sanctum"], "routine:3");
        assert!(routine_body(&PushRoutine { time: None, ..r }, "2026-09-30", "UTC").is_none());

        let t = PushTodo { id: 9, title: "Mock interview".into(), date: "2026-10-01".into(), time: Some("23:30".into()), duration_min: None, done: true, event_id: None };
        let b = todo_body(&t, "UTC").unwrap();
        assert_eq!(b["summary"], "✓ Mock interview");
        assert_eq!(b["end"]["dateTime"], "2026-10-02T00:30:00", "default hour, across midnight");

        let all_day = event_body("Offsite", "2026-10-01", None, None).unwrap();
        assert_eq!((all_day["start"]["date"].as_str(), all_day["end"]["date"].as_str()), (Some("2026-10-01"), Some("2026-10-02")));
    }

    #[test]
    fn parses_occurrences() {
        let e = json!({
            "id": "e1", "summary": "Standup", "htmlLink": "https://calendar.google.com/x", "recurringEventId": "m",
            "start": { "dateTime": at("2026-09-29", "09:30") }, "end": { "dateTime": at("2026-09-29", "09:45") },
            "attendees": [{ "email": "me", "self": true, "responseStatus": "accepted" }, { "email": "a" }, { "email": "room", "resource": true }],
        });
        let p = parse_event(&e).unwrap();
        assert_eq!((p.date.as_str(), p.time.as_deref(), p.duration_min, p.attendees, p.recurring, p.all_day), ("2026-09-29", Some("09:30"), Some(15), 1, true, false));

        let declined = json!({ "id": "e2", "start": e["start"], "end": e["end"], "attendees": [{ "self": true, "responseStatus": "declined" }] });
        assert!(parse_event(&declined).is_none());
        assert!(parse_event(&json!({ "id": "e3", "status": "cancelled" })).is_none());

        let trip = parse_event(&json!({ "id": "e4", "summary": " ", "start": { "date": "2026-10-02" }, "end": { "date": "2026-10-05" } })).unwrap();
        assert_eq!((trip.title.as_str(), trip.date.as_str(), trip.end_date.as_str(), trip.all_day, trip.time), ("(No title)", "2026-10-02", "2026-10-04", true, None));
    }

    #[test]
    fn caches_windows_without_sanctums_own_events() {
        let conn = fresh();
        connect(&conn);
        upsert_calendars(
            &conn,
            &[json!({ "id": "me@x", "summary": "Me", "primary": true, "accessRole": "owner" }), json!({ "id": "hol", "summary": "Holidays", "accessRole": "reader" }), json!({ "id": "s", "summary": "Sanctum", "accessRole": "owner" })],
            Some("s"),
        )
        .unwrap();
        let cals = list_calendars(&conn).unwrap();
        assert_eq!(cals.iter().map(|c| (c.id.as_str(), c.selected, c.writable)).collect::<Vec<_>>(), vec![("me@x", true, true), ("s", true, true), ("hol", false, false)]);

        let ev = |id: &str, d: &str, t: &str| json!({ "id": id, "summary": id, "start": { "dateTime": at(d, t) }, "end": { "dateTime": at(d, "23:00") } });
        store_window(&conn, "me@x", "2026-09-28", "2026-10-04", &[ev("lunch", "2026-09-29", "12:00"), ev("late", "2026-10-09", "12:00")], &HashSet::new()).unwrap();
        let own: HashSet<String> = ["gym".to_string()].into();
        let tagged = json!({ "id": "t1", "start": { "dateTime": at("2026-09-30", "10:00") }, "end": { "dateTime": at("2026-09-30", "11:00") }, "extendedProperties": { "private": { "sanctum": "todo:1" } } });
        let instance = json!({ "id": "gym_1", "recurringEventId": "gym", "start": { "dateTime": at("2026-09-30", "07:00") }, "end": { "dateTime": at("2026-09-30", "08:00") } });
        store_window(&conn, "s", "2026-09-28", "2026-10-04", &[tagged, instance, ev("mine-by-hand", "2026-09-30", "15:00")], &own).unwrap();
        let week: Vec<String> = list_events(&conn, "2026-09-28", "2026-10-04").unwrap().into_iter().map(|e| e.event_id).collect();
        assert_eq!(week, vec!["lunch", "mine-by-hand"]);

        // A fresh listing replaces the window: lunch was deleted in Google.
        store_window(&conn, "me@x", "2026-09-28", "2026-10-04", &[], &HashSet::new()).unwrap();
        assert_eq!(list_events(&conn, "2026-09-28", "2026-10-04").unwrap().len(), 1);
        // Unselected calendars are hidden.
        set_selected(&conn, "s", false).unwrap();
        assert!(list_events(&conn, "2026-09-28", "2026-10-04").unwrap().is_empty());
        // A calendar that disappears from the list takes its events with it.
        upsert_calendars(&conn, &[json!({ "id": "me@x", "summary": "Me", "primary": true, "accessRole": "owner" })], None).unwrap();
        assert_eq!(list_calendars(&conn).unwrap().len(), 1);
    }

    #[test]
    fn applies_edits_made_in_google() {
        let conn = fresh();
        connect(&conn);
        let gym = routine(&conn, "Gym", 127, Some("07:00"));
        set_routine_link(&conn, gym, Some(("ev-gym", "\"1\"")), Some("2026-09-28")).unwrap();
        let mock = todo(&conn, "Mock", "2026-10-01", Some("14:00"));
        set_todo_link(&conn, mock, Some(("ev-mock", "\"1\""))).unwrap();

        // Our own push echoing back (same etag) changes nothing.
        let echo = json!({ "id": "ev-gym", "etag": "\"1\"", "summary": "Gym", "start": { "dateTime": at("2026-09-28", "07:00") }, "end": { "dateTime": at("2026-09-28", "08:00") } });
        assert!(!apply_remote(&conn, &echo).unwrap());

        // Moved to 6:30 on Mon/Wed/Fri and renamed.
        let moved = json!({ "id": "ev-gym", "etag": "\"2\"", "summary": "Lift", "start": { "dateTime": at("2026-09-28", "06:30") }, "end": { "dateTime": at("2026-09-28", "07:45") }, "recurrence": [rrule(42)] });
        assert!(apply_remote(&conn, &moved).unwrap());
        let r = planner::list_routines(&conn).unwrap().into_iter().find(|r| r.id == gym).unwrap();
        assert_eq!((r.title.as_str(), r.time.as_deref(), r.duration_min, r.days_mask), ("Lift", Some("06:30"), Some(75), 42));

        // Checking one day off in Google (✓ on that occurrence) checks it off here.
        let day = json!({ "id": "ev-gym_x", "recurringEventId": "ev-gym", "summary": "✓ Lift", "originalStartTime": { "dateTime": at("2026-09-30", "06:30") } });
        assert!(apply_remote(&conn, &day).unwrap());
        assert!(routine_done(&conn, gym, "2026-09-30").unwrap());

        // A pending local edit wins over Google's.
        enqueue(&conn, Job::Todo(mock)).unwrap();
        let renamed = json!({ "id": "ev-mock", "etag": "\"3\"", "summary": "✓ Mock!", "start": { "dateTime": at("2026-10-01", "15:00") }, "end": { "dateTime": at("2026-10-01", "16:00") } });
        assert!(!apply_remote(&conn, &renamed).unwrap());
        clear_jobs(&conn, &pending(&conn).unwrap()[0].0).unwrap();
        assert!(apply_remote(&conn, &renamed).unwrap());
        let t = planner::list_todos(&conn, "2026-10-01", "2026-10-01").unwrap().remove(0);
        assert_eq!((t.title.as_str(), t.due_time.as_deref(), t.done), ("Mock!", Some("15:00"), true));

        // Deleted in Google: gone here too.
        assert!(apply_remote(&conn, &json!({ "id": "ev-mock", "status": "cancelled" })).unwrap());
        assert!(planner::list_todos(&conn, "2026-10-01", "2026-10-01").unwrap().is_empty());
        assert!(apply_remote(&conn, &json!({ "id": "ev-gym", "status": "cancelled" })).unwrap());
        assert!(planner::list_routines(&conn).unwrap().is_empty());
        // Unknown events are left alone.
        assert!(!apply_remote(&conn, &json!({ "id": "someone-elses", "summary": "x" })).unwrap());
    }
}
