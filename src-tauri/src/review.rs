//! The week, reviewed (v0.3.1, decided 2026-10-30): a focus target for the week, two questions
//! under the Monday recap, an opt-in weekly summary for the partner, and suggestions drawn from
//! your own sessions.
//!
//! - Reflection improves later performance (Di Stefano, Gino, Pisano & Staats 2014), and new
//!   beginnings like a Monday start goals more often (Dai, Milkman & Riis 2014).
//! - Monitoring progress works better when someone else sees it (Harkin et al. 2016): the partner
//!   can get the week's totals, never sites, apps, or titles.
//! - Fixed rhythms (Pomodoro, 90-minute cycles) have little support; people differ. So the
//!   suggestions come from your own history: the length you finish, the hours you keep, and
//!   when temptation comes.

use crate::session::{self, now_ms};
use crate::stats::{self, Days};
use crate::{db, journal, Shared};
use chrono::{Datelike, Duration, NaiveDate, Timelike};
use rusqlite::{params, Connection};
use serde::Serialize;
use std::collections::HashMap;
use tauri::{AppHandle, Manager, State};

const TARGET_KEY: &str = "week_target_min";
const PARTNER_KEY: &str = "partner_weekly_summary";
const SENT_KEY: &str = "partner_summary_sent_week";
/// Enough history to say something about you, not noise.
const MIN_SESSIONS: usize = 8;
const LOOKBACK_DAYS: i64 = 60;

fn monday_of(d: NaiveDate) -> NaiveDate {
    d - Duration::days(d.weekday().num_days_from_monday() as i64)
}

// --- The week's target ---

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WeekTarget {
    /// This week's Monday.
    pub week: String,
    pub target_min: i64,
    /// Not set by you: the average of the last four weeks (or the daily goal × 5).
    pub is_default: bool,
    /// Focus so far this week.
    pub focus_min: i64,
}

/// The last four weeks' average focus, rounded to the half hour; for a new install, the daily
/// goal for five days.
pub fn default_target(conn: &Connection, today: NaiveDate) -> rusqlite::Result<i64> {
    let monday = monday_of(today);
    let o = stats::overview(conn, monday - Duration::days(28), monday - Duration::days(1), today, 0)?;
    if o.focus_min > 0 {
        let avg = o.focus_min / 4;
        return Ok(((avg + 15) / 30 * 30).max(30));
    }
    Ok(o.goal_min * 5)
}

pub fn week_target(conn: &Connection, today: NaiveDate, running_ms: i64) -> rusqlite::Result<WeekTarget> {
    let monday = monday_of(today);
    let set: Option<i64> = db::get_setting(conn, TARGET_KEY)?.and_then(|v| v.parse().ok()).filter(|m: &i64| *m > 0);
    let target_min = match set {
        Some(m) => m,
        None => default_target(conn, today)?,
    };
    let focus = stats::overview(conn, monday, today, today, running_ms)?.focus_min;
    Ok(WeekTarget { week: monday.format("%Y-%m-%d").to_string(), target_min, is_default: set.is_none(), focus_min: focus })
}

/// Sets the target in minutes (30 minutes to 80 hours), or clears it back to the default.
pub fn set_week_target(conn: &Connection, min: Option<i64>) -> Result<(), String> {
    match min {
        Some(m) if !(30..=4800).contains(&m) => Err("A week's target is 30 minutes to 80 hours.".into()),
        Some(m) => db::set_setting(conn, TARGET_KEY, &m.to_string()).map_err(|e| e.to_string()),
        None => conn.execute("DELETE FROM settings WHERE key = ?1", [TARGET_KEY]).map(|_| ()).map_err(|e| e.to_string()),
    }
}

// --- The review ---

/// "What worked?" and "What will you change?", kept for the week (and added to today's journal
/// page when the journal is open).
pub fn save_review(conn: &Connection, week: &str, worked: Option<&str>, change: Option<&str>, now: i64) -> Result<(), String> {
    NaiveDate::parse_from_str(week, "%Y-%m-%d").map_err(|_| format!("{week} is not a date."))?;
    let clip = |s: Option<&str>| s.map(str::trim).filter(|s| !s.is_empty()).map(|s| s.chars().take(2000).collect::<String>());
    let (worked, change) = (clip(worked), clip(change));
    if worked.is_none() && change.is_none() {
        return Ok(());
    }
    conn.execute(
        "INSERT INTO weekly_reviews (week, worked, change, created_at) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(week) DO UPDATE SET worked = excluded.worked, change = excluded.change",
        params![week, worked, change, now],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// The review as journal blocks: a heading and a paragraph for each answer.
pub fn review_doc(worked: Option<&str>, change: Option<&str>) -> (Vec<serde_json::Value>, String) {
    use serde_json::json;
    let mut blocks = Vec::new();
    let mut text = Vec::new();
    for (q, a) in [("What worked last week?", worked), ("What will I change this week?", change)] {
        let Some(a) = a.map(str::trim).filter(|a| !a.is_empty()) else { continue };
        blocks.push(json!({ "type": "heading", "attrs": { "level": 3 }, "content": [{ "type": "text", "text": q }] }));
        blocks.push(json!({ "type": "paragraph", "content": [{ "type": "text", "text": a }] }));
        text.push(format!("{q}\n{a}"));
    }
    (blocks, text.join("\n"))
}

/// Adds the review to the end of `date`'s journal page (a new page if there isn't one).
pub fn append_to_journal(conn: &Connection, date: &str, worked: Option<&str>, change: Option<&str>, now: i64) -> Result<bool, String> {
    let (blocks, text) = review_doc(worked, change);
    if blocks.is_empty() {
        return Ok(false);
    }
    let day = journal::get(conn, date).map_err(|e| e.to_string())?;
    // A page that's there but doesn't read as a document is left alone: the answers stay with
    // the week rather than writing over it.
    let mut doc: serde_json::Value = match day.as_ref().and_then(|d| d.doc.as_deref()) {
        Some(d) => match serde_json::from_str::<serde_json::Value>(d) {
            Ok(v) if v["content"].is_array() => v,
            _ => return Ok(false),
        },
        None => serde_json::json!({ "type": "doc", "content": [] }),
    };
    doc["content"].as_array_mut().unwrap().extend(blocks);
    let body = match day.map(|d| d.body).filter(|b| !b.trim().is_empty()) {
        Some(b) => format!("{b}\n{text}"),
        None => text,
    };
    journal::save(conn, date, Some(&doc.to_string()), &body, now)?;
    Ok(true)
}

// --- The partner's weekly summary ---

/// The week in one line for the partner: totals only.
pub fn summary_line(r: &crate::insights::Recap, streak: i64) -> String {
    let h = |m: i64| if m >= 60 { if m % 60 == 0 { format!("{}h", m / 60) } else { format!("{}h {}m", m / 60, m % 60) } } else { format!("{m}m") };
    let mut parts = vec![format!("{} in focus over {} {}", h(r.focus_min), r.sessions, if r.sessions == 1 { "session" } else { "sessions" })];
    parts.push(format!("{} of {} days kept", r.kept, r.days));
    if r.broken > 0 {
        parts.push(format!("{} with a broken seal", r.broken));
    }
    if streak > 1 {
        parts.push(format!("a {streak}-day streak"));
    }
    parts.join(", ")
}

/// Once a week, when you've turned it on: last week's totals to the partner.
pub fn maybe_send_summary(app: &AppHandle) {
    let shared = app.state::<Shared>();
    let line = {
        let Ok(conn) = shared.db.lock() else { return };
        if db::get_setting(&conn, PARTNER_KEY).ok().flatten().as_deref() != Some("1") {
            return;
        }
        let today = Days::load(&conn).of(now_ms());
        let Ok(Some(recap)) = crate::insights::recap(&conn, today) else { return };
        if db::get_setting(&conn, SENT_KEY).ok().flatten().as_deref() == Some(recap.week.as_str()) {
            return;
        }
        let streak = stats::overview(&conn, today - Duration::days(6), today, today, 0).map(|o| o.current_streak).unwrap_or(0);
        let _ = db::set_setting(&conn, SENT_KEY, &recap.week);
        summary_line(&recap, streak)
    };
    crate::cloud::notify(app, "weekly_summary", line);
}

// --- Suggestions from your own data ---

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum Suggestion {
    /// "Your 45-minute seals finish 85% of the time; 90-minute ones 60%."
    Length { line: String, profile_id: Option<i64>, minutes: i64 },
    /// "Your kept seals cluster 9 to 11 AM."
    Hours { line: String, start: String, end: String, profile_id: Option<i64> },
    /// "Discord gets in most after 40 minutes."
    Tempted { line: String, what: String, after_min: i64 },
}

struct Seal {
    profile_id: Option<i64>,
    started_at: i64,
    planned: i64,
    outcome: String,
}

fn pct(n: usize, d: usize) -> i64 {
    (n * 100).checked_div(d).unwrap_or(0) as i64
}

fn hour_label(h: u32) -> String {
    match h {
        0 => "12 AM".into(),
        12 => "12 PM".into(),
        h if h < 12 => format!("{h} AM"),
        h => format!("{} PM", h - 12),
    }
}

/// Up to three suggestions, each only when the history clearly says it.
pub fn suggestions(conn: &Connection, now: i64) -> rusqlite::Result<Vec<Suggestion>> {
    let since = now - LOOKBACK_DAYS * 86_400_000;
    let mut stmt = conn.prepare(
        "SELECT profile_id, started_at, planned_minutes, COALESCE(outcome, 'completed') FROM sessions
         WHERE ended_at IS NOT NULL AND started_at >= ?1 ORDER BY started_at",
    )?;
    let seals: Vec<Seal> = stmt
        .query_map([since], |r| Ok(Seal { profile_id: r.get(0)?, started_at: r.get(1)?, planned: r.get(2)?, outcome: r.get(3)? }))?
        .collect::<rusqlite::Result<_>>()?;
    let mut out = Vec::new();
    if seals.len() < MIN_SESSIONS {
        return Ok(out);
    }
    // The profile you use most, for "Use it".
    let mut uses: HashMap<Option<i64>, usize> = HashMap::new();
    for s in &seals {
        *uses.entry(s.profile_id).or_default() += 1;
    }
    let main = uses.into_iter().max_by_key(|(p, n)| (*n, p.unwrap_or(0))).and_then(|(p, _)| p);
    let kept = |s: &&Seal| s.outcome == "completed";

    // The length you finish: the best completion rate among lengths with 3+ seals, against the
    // length you pick most.
    let mut by_len: HashMap<i64, (usize, usize)> = HashMap::new();
    // Only lengths a profile can take: an extended or imported seal can't become the default.
    for s in seals.iter().filter(|s| crate::profiles::DURATIONS.contains(&s.planned)) {
        let e = by_len.entry(s.planned).or_default();
        e.0 += 1;
        if s.outcome == "completed" {
            e.1 += 1;
        }
    }
    let tried: Vec<(i64, usize, usize)> = by_len.into_iter().filter(|(_, (n, _))| *n >= 3).map(|(m, (n, k))| (m, n, k)).collect();
    if let (Some(best), Some(usual)) = (
        tried.iter().max_by_key(|(m, n, k)| (pct(*k, *n), *m)),
        tried.iter().max_by_key(|(m, n, _)| (*n, *m)),
    ) {
        let (b, u) = (pct(best.2, best.1), pct(usual.2, usual.1));
        if best.0 != usual.0 && b - u >= 15 {
            out.push(Suggestion::Length {
                line: format!("Your {}-minute seals finish {b}% of the time; {}-minute ones {u}%.", best.0, usual.0),
                profile_id: main,
                minutes: best.0,
            });
        }
    }

    // The hours you keep: the two-hour window holding the most kept seals, if it holds 40%+.
    let kept_hours: Vec<u32> = seals
        .iter()
        .filter(kept)
        .filter_map(|s| chrono::DateTime::from_timestamp_millis(s.started_at).map(|t| t.with_timezone(&chrono::Local).hour()))
        .collect();
    if kept_hours.len() >= MIN_SESSIONS / 2 {
        // Ties go to the window that starts where the seals do.
        let at = |h: u32| kept_hours.iter().filter(|x| **x == h).count();
        let (start, n) = (0..23u32).map(|h| (h, at(h) + at(h + 1))).max_by_key(|(h, n)| (*n, at(*h), 24 - h)).unwrap();
        if pct(n, kept_hours.len()) >= 40 {
            out.push(Suggestion::Hours {
                line: format!("Your kept seals cluster {} to {}.", hour_label(start), hour_label(start + 2)),
                start: format!("{start:02}:00"),
                end: format!("{:02}:00", (start + 2) % 24),
                profile_id: main,
            });
        }
    }

    // When temptation comes: the most-tried thing, and the median minute into a seal it's tried.
    let mut stmt = conn.prepare(
        "SELECT b.exe, b.ts - s.started_at FROM blocked_attempts b JOIN sessions s ON s.id = b.session_id WHERE b.ts >= ?1",
    )?;
    let mut tries: HashMap<String, Vec<i64>> = HashMap::new();
    for row in stmt.query_map([since], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))? {
        let (what, at) = row?;
        tries.entry(what).or_default().push(at.max(0) / 60_000);
    }
    if let Some((what, mut at)) = tries.into_iter().filter(|(_, v)| v.len() >= 5).max_by_key(|(w, v)| (v.len(), std::cmp::Reverse(w.clone()))) {
        at.sort_unstable();
        let median = at[at.len() / 2];
        if median >= 5 {
            let name = what.trim_end_matches(".exe").to_string();
            out.push(Suggestion::Tempted { line: format!("{} gets in most after {median} minutes.", capitalize(&name)), what, after_min: median });
        }
    }
    Ok(out)
}

fn capitalize(s: &str) -> String {
    let mut c = s.chars();
    c.next().map(|f| f.to_uppercase().collect::<String>() + c.as_str()).unwrap_or_default()
}

// --- Commands ---

#[tauri::command]
pub fn review_week_target(shared: State<Shared>) -> Result<WeekTarget, String> {
    let running = shared.engine.view().map(|v| v.elapsed_ms).unwrap_or(0);
    let conn = shared.db.lock().map_err(|e| e.to_string())?;
    let today = Days::load(&conn).of(now_ms());
    week_target(&conn, today, running).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn review_set_week_target(shared: State<Shared>, minutes: Option<i64>) -> Result<(), String> {
    let conn = shared.db.lock().map_err(|e| e.to_string())?;
    set_week_target(&conn, minutes)
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Saved {
    /// Added to today's journal page (it's open, or has no lock).
    pub in_journal: bool,
}

/// The Monday card's answers: kept for the week, and in today's journal page when it's open.
#[tauri::command]
pub fn review_save(shared: State<Shared>, week: String, worked: Option<String>, change: Option<String>) -> Result<Saved, String> {
    let conn = shared.db.lock().map_err(|e| e.to_string())?;
    let now = now_ms();
    save_review(&conn, &week, worked.as_deref(), change.as_deref(), now)?;
    let today = Days::load(&conn).of(now).format("%Y-%m-%d").to_string();
    let in_journal = journal::is_open(&shared, &conn) && append_to_journal(&conn, &today, worked.as_deref(), change.as_deref(), now)?;
    Ok(Saved { in_journal })
}

#[tauri::command]
pub fn review_suggestions(shared: State<Shared>) -> Result<Vec<Suggestion>, String> {
    let conn = shared.db.lock().map_err(|e| e.to_string())?;
    suggestions(&conn, session::now_ms()).map_err(|e| e.to_string())
}

/// The recap was shown: the partner's summary goes out (once a week, if it's on).
#[tauri::command]
pub fn review_recap_shown(app: AppHandle) {
    std::thread::spawn(move || maybe_send_summary(&app));
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{Local, TimeZone};

    fn fresh() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        db::prepare(&mut conn).unwrap();
        db::set_setting(&conn, "daily_reset_time", "00:00").unwrap();
        db::set_setting(&conn, "daily_goal_min", "60").unwrap();
        conn.execute("INSERT INTO profiles (id, name, created_at) VALUES (1, 'Deep Work', 0)", []).unwrap();
        conn
    }

    fn at(d: NaiveDate, h: u32) -> i64 {
        Local.from_local_datetime(&d.and_hms_opt(h, 0, 0).unwrap()).earliest().unwrap().timestamp_millis()
    }

    fn seal(conn: &Connection, start: i64, planned: i64, outcome: &str) -> i64 {
        conn.execute(
            "INSERT INTO sessions (profile_id, profile_name, started_at, planned_minutes, ended_at, outcome) VALUES (1, 'Deep Work', ?1, ?2, ?3, ?4)",
            params![start, planned, start + planned * 60_000, outcome],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    #[test]
    fn the_target_defaults_to_your_recent_average_then_yours() {
        let conn = fresh();
        let wed = NaiveDate::from_ymd_opt(2026, 10, 28).unwrap();
        // New install: the daily goal for five days.
        assert_eq!(week_target(&conn, wed, 0).unwrap(), WeekTarget { week: "2026-10-26".into(), target_min: 300, is_default: true, focus_min: 0 });
        // Four weeks with 10h total: 2h 30m a week.
        for w in 1..=4 {
            seal(&conn, at(wed - Duration::days(7 * w), 9), 150, "completed");
        }
        seal(&conn, at(wed, 9), 45, "completed");
        let t = week_target(&conn, wed, 15 * 60_000).unwrap();
        assert_eq!((t.target_min, t.is_default, t.focus_min), (150, true, 60));
        set_week_target(&conn, Some(600)).unwrap();
        assert_eq!(week_target(&conn, wed, 0).unwrap().target_min, 600);
        assert!(set_week_target(&conn, Some(10)).is_err());
        set_week_target(&conn, None).unwrap();
        assert!(week_target(&conn, wed, 0).unwrap().is_default);
    }

    #[test]
    fn the_review_is_kept_and_reads_as_journal_blocks() {
        let conn = fresh();
        save_review(&conn, "2026-10-26", Some("  Mornings  "), None, 1).unwrap();
        save_review(&conn, "2026-10-26", Some("Mornings"), Some("Phone in the other room"), 2).unwrap();
        let (w, c): (String, String) = conn.query_row("SELECT worked, change FROM weekly_reviews WHERE week = '2026-10-26'", [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
        assert_eq!((w.as_str(), c.as_str()), ("Mornings", "Phone in the other room"));
        assert!(save_review(&conn, "soon", Some("x"), None, 3).is_err());
        // Appended to the day's page, after what's there.
        journal::save(&conn, "2026-10-26", Some(r#"{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Tired."}]}]}"#), "Tired.", 4).unwrap();
        assert!(append_to_journal(&conn, "2026-10-26", Some("Mornings"), Some("Phone away"), 5).unwrap());
        let day = journal::get(&conn, "2026-10-26").unwrap().unwrap();
        assert_eq!(day.body, "Tired.\nWhat worked last week?\nMornings\nWhat will I change this week?\nPhone away");
        let doc: serde_json::Value = serde_json::from_str(day.doc.as_deref().unwrap()).unwrap();
        assert_eq!(doc["content"].as_array().unwrap().len(), 5);
        assert!(!append_to_journal(&conn, "2026-10-27", None, Some("  "), 6).unwrap());
        // A page that doesn't read as a document is never written over.
        journal::save(&conn, "2026-10-28", Some("not a doc"), "Kept.", 7).unwrap();
        assert!(!append_to_journal(&conn, "2026-10-28", Some("Mornings"), None, 8).unwrap());
        assert_eq!(journal::get(&conn, "2026-10-28").unwrap().unwrap().doc.as_deref(), Some("not a doc"));
    }

    #[test]
    fn the_partner_line_is_totals_only() {
        let r = crate::insights::Recap {
            week: "2026-10-19".into(),
            focus_min: 680,
            previous_focus_min: 0,
            kept: 5,
            broken: 1,
            days: 6,
            best_day: None,
            best_day_min: 0,
            most_tempting: Some("discord.exe".into()),
            sessions: 12,
        };
        let line = summary_line(&r, 4);
        assert_eq!(line, "11h 20m in focus over 12 sessions, 5 of 6 days kept, 1 with a broken seal, a 4-day streak");
        assert!(!line.contains("discord"), "never what tempted you");
    }

    #[test]
    fn suggestions_only_when_your_history_says_so() {
        let conn = fresh();
        let now = at(NaiveDate::from_ymd_opt(2026, 10, 30).unwrap(), 18);
        let day = |n: i64| NaiveDate::from_ymd_opt(2026, 10, 30).unwrap() - Duration::days(n);
        assert!(suggestions(&conn, now).unwrap().is_empty(), "too little history");
        // 45-minute seals at 9 AM finish; 90-minute ones in the evening break half the time.
        for n in 1..=5 {
            seal(&conn, at(day(n), 9), 45, "completed");
        }
        for n in 1..=6 {
            let id = seal(&conn, at(day(n + 5), 19), 90, if n % 2 == 0 { "broken" } else { "completed" });
            conn.execute("INSERT INTO blocked_attempts (session_id, ts, exe, kind) VALUES (?1, ?2, 'discord.exe', 'app')", params![id, at(day(n + 5), 19) + 40 * 60_000]).unwrap();
        }
        let s = suggestions(&conn, now).unwrap();
        assert!(s.contains(&Suggestion::Length { line: "Your 45-minute seals finish 100% of the time; 90-minute ones 50%.".into(), profile_id: Some(1), minutes: 45 }), "{s:?}");
        assert!(s.iter().any(|x| matches!(x, Suggestion::Hours { start, .. } if start == "09:00")), "{s:?}");
        assert!(s.contains(&Suggestion::Tempted { line: "Discord gets in most after 40 minutes.".into(), what: "discord.exe".into(), after_min: 40 }), "{s:?}");
    }
}
