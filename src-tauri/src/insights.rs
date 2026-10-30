//! Stats in depth (v0.3, decided 2026-10-29): the Sessions, Activity, and Day tabs, and the
//! weekly recap. Sessions are kept for good; raw activity only for its retention window (30
//! days by default), so Activity and Day reach back that far.
//!
//! Sites: a browser's activity row carries the tab's domain at the end of its title
//! ("Shorts - YouTube — youtube.com", added in activity.rs from the extension), or the title
//! names the site; either way it's grouped by domain here.

use crate::classify::{self, is_browser, title_matches_domain, CATEGORIES};
use crate::stats::{self, Days};
use crate::{session, Shared};
use chrono::{Datelike, Duration, NaiveDate};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use std::collections::HashMap;
use tauri::{AppHandle, State};

const DAY_MS: i64 = 86_400_000;

// --- Sessions ---

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionRow {
    pub id: i64,
    pub profile_id: Option<i64>,
    pub profile_name: String,
    pub started_at: i64,
    pub ended_at: i64,
    pub planned_min: i64,
    /// Focus that counted: time sealed, less idle and any downtime, at most the plan.
    pub focus_min: i64,
    pub idle_min: i64,
    /// "completed" (kept), "unlocked_early" (let out), or "broken".
    pub outcome: String,
    pub attempts: i64,
    pub task: Option<String>,
}

const SESSION_COLS: &str = "s.id, s.profile_id, COALESCE(NULLIF(s.profile_name, ''), p.name, 'Focus'), s.started_at, s.ended_at, s.planned_minutes,
     MAX(0, MIN(s.planned_minutes * 60000, s.ended_at - s.started_at - s.idle_ms) - s.gap_ms), s.idle_ms, COALESCE(s.outcome, 'completed'),
     (SELECT COUNT(*) FROM blocked_attempts b WHERE b.session_id = s.id), s.task_title";

fn session_row(r: &rusqlite::Row) -> rusqlite::Result<SessionRow> {
    Ok(SessionRow {
        id: r.get(0)?,
        profile_id: r.get(1)?,
        profile_name: r.get(2)?,
        started_at: r.get(3)?,
        ended_at: r.get(4)?,
        planned_min: r.get(5)?,
        focus_min: r.get::<_, i64>(6)? / 60_000,
        idle_min: r.get::<_, i64>(7)? / 60_000,
        outcome: r.get(8)?,
        attempts: r.get(9)?,
        task: r.get(10)?,
    })
}

/// Finished sessions that started in [from, to), newest first; optionally one outcome or profile.
pub fn sessions(conn: &Connection, from: i64, to: i64, outcome: Option<&str>, profile: Option<i64>) -> rusqlite::Result<Vec<SessionRow>> {
    let sql = format!(
        "SELECT {SESSION_COLS} FROM sessions s LEFT JOIN profiles p ON p.id = s.profile_id
         WHERE s.ended_at IS NOT NULL AND s.started_at >= ?1 AND s.started_at < ?2
           AND (?3 IS NULL OR COALESCE(s.outcome, 'completed') = ?3) AND (?4 IS NULL OR s.profile_id = ?4)
         ORDER BY s.started_at DESC"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![from, to, outcome, profile], session_row)?;
    rows.collect()
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Count {
    pub what: String,
    pub kind: String,
    pub count: i64,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Moment {
    pub at: i64,
    pub what: String,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionDetail {
    pub session: SessionRow,
    /// What was blocked, most first.
    pub blocked: Vec<Count>,
    /// Asking to leave early: each step reached, and the answer.
    pub unlocks: Vec<Moment>,
    /// Tamper during the seal (clock, guard, extension, closed, PC off).
    pub tamper: Vec<Moment>,
}

pub fn session_detail(conn: &Connection, id: i64) -> rusqlite::Result<Option<SessionDetail>> {
    let sql = format!("SELECT {SESSION_COLS} FROM sessions s LEFT JOIN profiles p ON p.id = s.profile_id WHERE s.id = ?1 AND s.ended_at IS NOT NULL");
    let Some(session) = conn.query_row(&sql, [id], session_row).optional()? else { return Ok(None) };
    let mut stmt = conn.prepare("SELECT exe, kind, COUNT(*) AS n FROM blocked_attempts WHERE session_id = ?1 GROUP BY exe, kind ORDER BY n DESC, exe")?;
    let blocked = stmt.query_map([id], |r| Ok(Count { what: r.get(0)?, kind: r.get(1)?, count: r.get(2)? }))?.collect::<rusqlite::Result<_>>()?;
    let mut stmt = conn.prepare("SELECT created_at, level_reached, approved FROM unlock_attempts WHERE session_id = ?1 ORDER BY created_at")?;
    let unlocks = stmt
        .query_map([id], |r| {
            let (level, approved): (i64, Option<i64>) = (r.get(1)?, r.get(2)?);
            let what = match approved {
                Some(1) => format!("Asked to leave (step {level}); approved"),
                Some(_) => format!("Asked to leave (step {level}); denied"),
                None => format!("Asked to leave (step {level})"),
            };
            Ok(Moment { at: r.get(0)?, what })
        })?
        .collect::<rusqlite::Result<_>>()?;
    let mut stmt = conn.prepare("SELECT ts, kind FROM tamper_events WHERE session_id = ?1 ORDER BY ts")?;
    let tamper = stmt
        .query_map([id], |r| {
            let kind: String = r.get(1)?;
            let what = match kind.as_str() {
                "clock" => "The clock changed",
                "guard" => "Protection stopped",
                "extension" => "A browser ran without the extension",
                "shutdown" => "The PC went off",
                _ => "Sanctum was closed",
            };
            Ok(Moment { at: r.get(0)?, what: what.into() })
        })?
        .collect::<rusqlite::Result<_>>()?;
    Ok(Some(SessionDetail { session, blocked, unlocks, tamper }))
}

fn csv_field(s: &str) -> String {
    if s.contains([',', '"', '\n']) {
        format!("\"{}\"", s.replace('"', "\"\""))
    } else {
        s.to_string()
    }
}

/// The session list as CSV, with local times.
pub fn sessions_csv(rows: &[SessionRow]) -> String {
    let time = |ms: i64| chrono::DateTime::from_timestamp_millis(ms).map(|t| t.with_timezone(&chrono::Local).format("%Y-%m-%d %H:%M").to_string()).unwrap_or_default();
    let outcome = |o: &str| match o {
        "unlocked_early" => "let out early",
        "broken" => "broken",
        _ => "kept",
    };
    let mut out = String::from("started,ended,profile,planned_min,focus_min,idle_min,outcome,attempts_blocked,task\n");
    for r in rows {
        out.push_str(&format!(
            "{},{},{},{},{},{},{},{},{}\n",
            time(r.started_at),
            time(r.ended_at),
            csv_field(&r.profile_name),
            r.planned_min,
            r.focus_min,
            r.idle_min,
            outcome(&r.outcome),
            r.attempts,
            csv_field(r.task.as_deref().unwrap_or(""))
        ));
    }
    out
}

// --- Activity ---

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    /// "exe" or "domain".
    pub kind: String,
    /// The exe or the domain.
    pub key: String,
    pub seconds: i64,
    /// The category most of its time fell in.
    pub category: String,
}

/// The site a browser row is on, when it can tell: the domain activity.rs appended
/// ("… — youtube.com").
pub fn domain_of(exe: &str, title: &str) -> Option<String> {
    if !is_browser(exe) {
        return None;
    }
    let tail = title.rsplit(" — ").next()?.trim().to_lowercase();
    (tail != title.trim().to_lowercase() || title.contains(" — "))
        .then_some(tail)
        .filter(|t| t.contains('.') && !t.contains(' ') && t.len() <= 253)
}

/// Time by app and by site in [from, to), most first.
pub fn activity(conn: &Connection, from: i64, to: i64) -> rusqlite::Result<(Vec<Usage>, Vec<Usage>)> {
    let mut apps: HashMap<String, HashMap<String, i64>> = HashMap::new();
    let mut sites: HashMap<String, HashMap<String, i64>> = HashMap::new();
    let mut stmt = conn.prepare("SELECT exe, title, duration_s, category FROM activity WHERE ts >= ?1 AND ts < ?2 AND duration_s > 0")?;
    let rows = stmt.query_map(params![from, to], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, i64>(2)?, r.get::<_, String>(3)?)))?;
    for row in rows {
        let (exe, title, secs, cat) = row?;
        match domain_of(&exe, &title) {
            Some(d) => *sites.entry(d).or_default().entry(cat).or_default() += secs,
            None => *apps.entry(exe).or_default().entry(cat).or_default() += secs,
        }
    }
    let flatten = |m: HashMap<String, HashMap<String, i64>>, kind: &str| {
        let mut out: Vec<Usage> = m
            .into_iter()
            .map(|(key, cats)| {
                let seconds = cats.values().sum();
                let category = cats.into_iter().max_by_key(|(_, s)| *s).map(|(c, _)| c).unwrap_or_else(|| "neutral".into());
                Usage { kind: kind.into(), key, seconds, category }
            })
            .collect();
        out.sort_by(|a, b| b.seconds.cmp(&a.seconds).then(a.key.cmp(&b.key)));
        out
    };
    Ok((flatten(apps, "exe"), flatten(sites, "domain")))
}

/// Exceptions for one profile, checked before the everywhere rules while it's sealed.
pub fn exceptions(conn: &Connection, profile: i64) -> rusqlite::Result<Vec<classify::ClassRule>> {
    let mut stmt = conn.prepare("SELECT id, match_kind, pattern, category FROM classification_exceptions WHERE profile_id = ?1")?;
    let rows = stmt.query_map([profile], |r| {
        Ok(classify::ClassRule { id: r.get(0)?, match_kind: r.get(1)?, pattern: r.get(2)?, category: r.get(3)?, source: "exception".into() })
    })?;
    rows.collect()
}

/// Sets an app's or site's category, everywhere or only in one profile, and recounts the
/// activity still kept. Returns how many entries changed.
pub fn reclassify(conn: &mut Connection, kind: &str, pattern: &str, category: &str, profile: Option<i64>) -> Result<usize, String> {
    if !CATEGORIES.contains(&category) {
        return Err(format!("Unknown category: {category}."));
    }
    let pattern = match kind {
        "exe" => {
            let p = pattern.trim().to_lowercase();
            if !p.ends_with(".exe") {
                return Err(format!("{p} is not an app name."));
            }
            p
        }
        "domain" => crate::profiles::normalize_domain(pattern).ok_or_else(|| format!("{} is not a site.", pattern.trim()))?,
        _ => return Err(format!("Unknown kind: {kind}.")),
    };
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    match profile {
        None => {
            classify::add(&tx, classify::ClassRule { id: 0, match_kind: kind.into(), pattern: pattern.clone(), category: category.into(), source: "user".into() })?;
        }
        Some(p) => {
            tx.execute(
                "INSERT INTO classification_exceptions (profile_id, match_kind, pattern, category) VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(profile_id, match_kind, pattern) DO UPDATE SET category = excluded.category",
                params![p, kind, pattern, category],
            )
            .map_err(|e| e.to_string())?;
        }
    }
    // Recount: everywhere, except sessions of profiles with their own exception; or only that profile's sessions.
    let excepted: Vec<i64> = {
        let mut stmt = tx.prepare("SELECT profile_id FROM classification_exceptions WHERE match_kind = ?1 AND pattern = ?2").map_err(|e| e.to_string())?;
        let ids = stmt.query_map(params![kind, pattern], |r| r.get(0)).map_err(|e| e.to_string())?;
        ids.collect::<rusqlite::Result<_>>().map_err(|e| e.to_string())?
    };
    let targets: Vec<i64> = {
        let mut stmt = tx
            .prepare("SELECT a.id, a.exe, a.title, s.profile_id FROM activity a LEFT JOIN sessions s ON s.id = a.session_id WHERE a.category != ?1")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([category], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, Option<i64>>(3)?)))
            .map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for row in rows {
            let (id, exe, title, prof) = row.map_err(|e| e.to_string())?;
            let hit = match kind {
                "exe" => exe.eq_ignore_ascii_case(&pattern),
                _ => is_browser(&exe) && (domain_of(&exe, &title).as_deref() == Some(pattern.as_str()) || title_matches_domain(&title, &pattern)),
            };
            let applies = match profile {
                None => prof.map_or(true, |p| !excepted.contains(&p)),
                Some(p) => prof == Some(p),
            };
            if hit && applies {
                out.push(id);
            }
        }
        out
    };
    for id in &targets {
        tx.execute("UPDATE activity SET category = ?1 WHERE id = ?2", params![category, id]).map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(targets.len())
}

// --- Day ---

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Block {
    pub start: i64,
    pub end: i64,
    pub category: String,
    /// The app or site most of the block was spent in.
    pub label: String,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Band {
    pub id: i64,
    pub start: i64,
    pub end: i64,
    pub profile_name: String,
    pub outcome: String,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DayView {
    pub date: String,
    /// Activity is kept for this day (within the retention window).
    pub has_activity: bool,
    pub blocks: Vec<Block>,
    pub sessions: Vec<Band>,
    /// The day's biggest apps and sites.
    pub top: Vec<Usage>,
}

/// Gaps shorter than this join a block; longer ones split it.
const JOIN_GAP_MS: i64 = 2 * 60_000;

pub fn day(conn: &Connection, date: NaiveDate) -> rusqlite::Result<DayView> {
    let days = Days::load(conn);
    let from = stats::start_ms(&days, date);
    let to = stats::start_ms(&days, date + Duration::days(1));
    let mut blocks: Vec<Block> = Vec::new();
    let mut weights: Vec<HashMap<String, i64>> = Vec::new();
    let mut stmt = conn.prepare("SELECT ts, duration_s, exe, title, category FROM activity WHERE ts >= ?1 AND ts < ?2 AND duration_s > 0 ORDER BY ts")?;
    let rows = stmt.query_map(params![from, to], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?, r.get::<_, String>(2)?, r.get::<_, String>(3)?, r.get::<_, String>(4)?)))?;
    for row in rows {
        let (ts, secs, exe, title, cat) = row?;
        let end = ts + secs * 1000;
        let label = domain_of(&exe, &title).unwrap_or(exe);
        match blocks.last_mut() {
            Some(b) if b.category == cat && ts - b.end < JOIN_GAP_MS => {
                b.end = b.end.max(end);
                *weights.last_mut().unwrap().entry(label).or_default() += secs;
            }
            _ => {
                blocks.push(Block { start: ts, end, category: cat, label: label.clone() });
                weights.push(HashMap::from([(label, secs)]));
            }
        }
    }
    for (b, w) in blocks.iter_mut().zip(weights) {
        if let Some((l, _)) = w.into_iter().max_by_key(|(_, s)| *s) {
            b.label = l;
        }
    }
    let mut stmt = conn.prepare(
        "SELECT s.id, s.started_at, s.ended_at, COALESCE(NULLIF(s.profile_name, ''), p.name, 'Focus'), COALESCE(s.outcome, 'completed')
         FROM sessions s LEFT JOIN profiles p ON p.id = s.profile_id
         WHERE s.ended_at IS NOT NULL AND s.started_at < ?2 AND s.ended_at > ?1 ORDER BY s.started_at",
    )?;
    let sessions = stmt
        .query_map(params![from, to], |r| Ok(Band { id: r.get(0)?, start: r.get(1)?, end: r.get(2)?, profile_name: r.get(3)?, outcome: r.get(4)? }))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let (apps, sites) = activity(conn, from, to)?;
    let mut top: Vec<Usage> = apps.into_iter().chain(sites).collect();
    top.sort_by_key(|u| std::cmp::Reverse(u.seconds));
    top.truncate(8);
    let retention: i64 = crate::db::get_setting(conn, "activity_retention_days")?.and_then(|v| v.parse().ok()).unwrap_or(30);
    Ok(DayView { date: date.format("%Y-%m-%d").to_string(), has_activity: to > session::now_ms() - retention * DAY_MS, blocks, sessions, top })
}

// --- The weekly recap ---

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Recap {
    /// The Monday the recapped week started.
    pub week: String,
    pub focus_min: i64,
    pub previous_focus_min: i64,
    pub kept: i64,
    pub broken: i64,
    /// Days that counted (not rest days).
    pub days: i64,
    pub best_day: Option<String>,
    pub best_day_min: i64,
    pub most_tempting: Option<String>,
    pub sessions: i64,
}

/// Last week (Monday to Sunday) before `today`, and how it compared with the one before.
/// None when last week had no sessions: nothing to recap.
pub fn recap(conn: &Connection, today: NaiveDate) -> rusqlite::Result<Option<Recap>> {
    let monday = today - Duration::days(today.weekday().num_days_from_monday() as i64) - Duration::days(7);
    let o = stats::overview(conn, monday, monday + Duration::days(6), today, 0)?;
    let sessions: i64 = o.days.iter().map(|d| d.sessions).sum();
    if sessions == 0 {
        return Ok(None);
    }
    let before = stats::overview(conn, monday - Duration::days(7), monday - Duration::days(1), today, 0)?;
    let best = o.days.iter().max_by_key(|d| d.focus_min).filter(|d| d.focus_min > 0);
    let rest = o.days.iter().filter(|d| d.status == stats::DayStatus::Rest).count() as i64;
    Ok(Some(Recap {
        week: monday.format("%Y-%m-%d").to_string(),
        focus_min: o.focus_min,
        previous_focus_min: before.focus_min,
        kept: o.kept,
        broken: o.broken,
        days: 7 - rest,
        best_day: best.map(|d| d.date.clone()),
        best_day_min: best.map_or(0, |d| d.focus_min),
        most_tempting: o.tempted.first().map(|t| t.what.clone()),
        sessions,
    }))
}

// --- Commands ---

fn parse_date(s: &str) -> Result<NaiveDate, String> {
    NaiveDate::parse_from_str(s, "%Y-%m-%d").map_err(|_| format!("{s} is not a date."))
}

fn range_ms(conn: &Connection, from: &str, to: &str) -> Result<(i64, i64), String> {
    let (f, t) = (parse_date(from)?, parse_date(to)?);
    if t < f {
        return Err("That range ends before it starts.".into());
    }
    let days = Days::load(conn);
    Ok((stats::start_ms(&days, f), stats::start_ms(&days, t + Duration::days(1))))
}

fn outcome_filter(o: Option<String>) -> Result<Option<String>, String> {
    match o.as_deref() {
        None | Some("") => Ok(None),
        Some(x @ ("completed" | "unlocked_early" | "broken")) => Ok(Some(x.to_string())),
        Some(x) => Err(format!("Unknown outcome: {x}.")),
    }
}

/// `from`/`to` are planner dates; omit both for all time.
#[tauri::command]
pub fn stats_sessions(shared: State<Shared>, from: Option<String>, to: Option<String>, outcome: Option<String>, profile: Option<i64>) -> Result<Vec<SessionRow>, String> {
    let conn = shared.db.lock().map_err(|e| e.to_string())?;
    let (f, t) = match (from, to) {
        (Some(f), Some(t)) => range_ms(&conn, &f, &t)?,
        _ => (0, i64::MAX),
    };
    sessions(&conn, f, t, outcome_filter(outcome)?.as_deref(), profile).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn stats_session(shared: State<Shared>, id: i64) -> Result<Option<SessionDetail>, String> {
    let conn = shared.db.lock().map_err(|e| e.to_string())?;
    session_detail(&conn, id).map_err(|e| e.to_string())
}

/// Saves the filtered session list as CSV in Documents\Sanctum\Exports.
#[tauri::command]
pub fn stats_sessions_csv(app: AppHandle, shared: State<Shared>, from: Option<String>, to: Option<String>, outcome: Option<String>, profile: Option<i64>) -> Result<crate::backup::FileInfo, String> {
    let rows = stats_sessions(shared, from, to, outcome, profile)?;
    let dir = crate::backup::folder(&app, "Exports")?;
    let path = dir.join(format!("Sanctum sessions {}.csv", crate::backup::stamp(chrono::Local::now())));
    std::fs::write(&path, sessions_csv(&rows)).map_err(|e| format!("Couldn't save {}: {e}", path.display()))?;
    crate::backup::info(&path).ok_or_else(|| "The file was saved but can't be read back.".into())
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ActivityView {
    pub apps: Vec<Usage>,
    pub sites: Vec<Usage>,
}

#[tauri::command]
pub fn stats_activity(shared: State<Shared>, from: String, to: String) -> Result<ActivityView, String> {
    let conn = shared.db.lock().map_err(|e| e.to_string())?;
    let (f, t) = range_ms(&conn, &from, &to)?;
    let (apps, sites) = activity(&conn, f, t).map_err(|e| e.to_string())?;
    Ok(ActivityView { apps, sites })
}

#[tauri::command]
pub fn stats_reclassify(shared: State<Shared>, kind: String, pattern: String, category: String, profile: Option<i64>) -> Result<usize, String> {
    let changed = {
        let mut conn = shared.db.lock().map_err(|e| e.to_string())?;
        reclassify(&mut conn, &kind, &pattern, &category, profile)?
    };
    // The live tracker picks the new rule up on its next step.
    shared.activity.mark_dirty();
    Ok(changed)
}

#[tauri::command]
pub fn stats_day(shared: State<Shared>, date: String) -> Result<DayView, String> {
    let conn = shared.db.lock().map_err(|e| e.to_string())?;
    day(&conn, parse_date(&date)?).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn stats_recap(shared: State<Shared>) -> Result<Option<Recap>, String> {
    let conn = shared.db.lock().map_err(|e| e.to_string())?;
    let today = Days::load(&conn).of(session::now_ms());
    recap(&conn, today).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{Local, TimeZone};

    fn fresh() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        crate::db::prepare(&mut conn).unwrap();
        conn
    }

    fn at(d: NaiveDate, hour: u32, min: u32) -> i64 {
        Local.from_local_datetime(&d.and_hms_opt(hour, min, 0).unwrap()).earliest().unwrap().timestamp_millis()
    }

    fn profile(conn: &Connection, name: &str) -> i64 {
        conn.execute("INSERT INTO profiles (name, default_minutes, created_at) VALUES (?1, 60, 0)", [name]).unwrap();
        conn.last_insert_rowid()
    }

    fn session(conn: &Connection, profile: i64, start: i64, minutes: i64, outcome: &str) -> i64 {
        conn.execute(
            "INSERT INTO sessions (profile_id, profile_name, started_at, ended_at, planned_minutes, outcome) VALUES (?1, '', ?2, ?3, ?4, ?5)",
            params![profile, start, start + minutes * 60_000, minutes, outcome],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    fn act(conn: &Connection, ts: i64, secs: i64, exe: &str, title: &str, cat: &str, session: Option<i64>) {
        conn.execute(
            "INSERT INTO activity (ts, exe, title, duration_s, category, session_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![ts, exe, title, secs, cat, session],
        )
        .unwrap();
    }

    #[test]
    fn lists_sessions_with_filters_details_and_csv() {
        let conn = fresh();
        let d = NaiveDate::from_ymd_opt(2026, 10, 27).unwrap();
        let deep = profile(&conn, "Deep Work");
        let study = profile(&conn, "Study");
        let a = session(&conn, deep, at(d, 9, 0), 60, "completed");
        let b = session(&conn, study, at(d, 14, 0), 45, "broken");
        conn.execute("INSERT INTO blocked_attempts (session_id, ts, exe, kind) VALUES (?1, ?2, 'discord.exe', 'app'), (?1, ?2, 'discord.exe', 'app')", params![a, at(d, 9, 5)]).unwrap();
        conn.execute("INSERT INTO tamper_events (session_id, ts, kind) VALUES (?1, ?2, 'clock')", params![b, at(d, 14, 10)]).unwrap();

        let all = sessions(&conn, 0, i64::MAX, None, None).unwrap();
        assert_eq!(all.iter().map(|s| s.id).collect::<Vec<_>>(), vec![b, a], "newest first");
        assert_eq!((all[1].profile_name.as_str(), all[1].focus_min, all[1].attempts), ("Deep Work", 60, 2));
        assert_eq!(sessions(&conn, 0, i64::MAX, Some("broken"), None).unwrap().len(), 1);
        assert_eq!(sessions(&conn, 0, i64::MAX, None, Some(deep)).unwrap()[0].id, a);

        let detail = session_detail(&conn, b).unwrap().unwrap();
        assert_eq!(detail.tamper[0].what, "The clock changed");
        assert_eq!(session_detail(&conn, a).unwrap().unwrap().blocked[0], Count { what: "discord.exe".into(), kind: "app".into(), count: 2 });

        let csv = sessions_csv(&all);
        assert!(csv.starts_with("started,ended,profile,"));
        assert!(csv.contains(",Study,45,"));
        assert!(csv.contains(",broken,"));
        assert_eq!(csv_field("a, \"b\""), "\"a, \"\"b\"\"\"");
    }

    #[test]
    fn splits_time_by_app_and_site() {
        let conn = fresh();
        let d = NaiveDate::from_ymd_opt(2026, 10, 27).unwrap();
        act(&conn, at(d, 9, 0), 600, "code.exe", "main.rs - Sanctum", "productive", None);
        act(&conn, at(d, 9, 10), 300, "chrome.exe", "Shorts - YouTube — youtube.com", "distracting", None);
        act(&conn, at(d, 9, 15), 120, "chrome.exe", "Two Sum - LeetCode — leetcode.com", "productive", None);
        act(&conn, at(d, 9, 17), 60, "chrome.exe", "New Tab", "neutral", None);
        let (apps, sites) = activity(&conn, 0, i64::MAX).unwrap();
        assert_eq!(apps.iter().map(|u| (u.key.as_str(), u.seconds)).collect::<Vec<_>>(), vec![("code.exe", 600), ("chrome.exe", 60)]);
        assert_eq!(sites.iter().map(|u| (u.key.as_str(), u.category.as_str())).collect::<Vec<_>>(), vec![("youtube.com", "distracting"), ("leetcode.com", "productive")]);
        assert_eq!(domain_of("code.exe", "a — b.com"), None);
        assert_eq!(domain_of("msedge.exe", "Docs — docs.rs"), Some("docs.rs".into()));
    }

    #[test]
    fn reclassifies_everywhere_or_in_one_profile_and_recounts() {
        let mut conn = fresh();
        let d = NaiveDate::from_ymd_opt(2026, 10, 27).unwrap();
        let deep = profile(&conn, "Deep Work");
        let study = profile(&conn, "Study");
        let s1 = session(&conn, deep, at(d, 9, 0), 60, "completed");
        let s2 = session(&conn, study, at(d, 11, 0), 60, "completed");
        act(&conn, at(d, 9, 5), 300, "chrome.exe", "Lecture - YouTube — youtube.com", "distracting", Some(s1));
        act(&conn, at(d, 11, 5), 300, "chrome.exe", "Lecture - YouTube — youtube.com", "distracting", Some(s2));
        act(&conn, at(d, 13, 0), 300, "chrome.exe", "Shorts - YouTube — youtube.com", "distracting", None);

        // Only in Study: just that session's time changes, and Study gets an exception.
        assert_eq!(reclassify(&mut conn, "domain", "youtube.com", "productive", Some(study)).unwrap(), 1);
        assert_eq!(exceptions(&conn, study).unwrap()[0].category, "productive");
        fn cat(conn: &Connection, sid: Option<i64>) -> String {
            conn.query_row("SELECT category FROM activity WHERE session_id IS ?1", [sid], |r| r.get(0)).unwrap()
        }
        assert_eq!(cat(&conn, Some(s2)), "productive");
        assert_eq!(cat(&conn, Some(s1)), "distracting");

        // Everywhere neutral: everything but Study's exception follows.
        assert_eq!(reclassify(&mut conn, "domain", "https://www.youtube.com/", "neutral", None).unwrap(), 2);
        assert_eq!((cat(&conn, Some(s1)), cat(&conn, Some(s2)), cat(&conn, None)), ("neutral".into(), "productive".into(), "neutral".into()));
        assert!(classify::list(&conn).unwrap().iter().any(|r| r.pattern == "youtube.com" && r.category == "neutral"));

        assert!(reclassify(&mut conn, "exe", "notanapp", "neutral", None).is_err());
        assert!(reclassify(&mut conn, "exe", "code.exe", "great", None).is_err());
    }

    #[test]
    fn draws_a_day_as_blocks_with_sessions_on_top() {
        let conn = fresh();
        let d = NaiveDate::from_ymd_opt(2026, 10, 27).unwrap();
        let deep = profile(&conn, "Deep Work");
        let s = session(&conn, deep, at(d, 9, 0), 60, "broken");
        act(&conn, at(d, 9, 0), 600, "code.exe", "a", "productive", Some(s));
        act(&conn, at(d, 9, 10), 300, "code.exe", "b", "productive", Some(s));
        act(&conn, at(d, 9, 15), 120, "chrome.exe", "Shorts — youtube.com", "distracting", Some(s));
        // A long gap splits even the same category.
        act(&conn, at(d, 11, 0), 60, "code.exe", "c", "productive", None);
        let v = day(&conn, d).unwrap();
        assert_eq!(v.blocks.iter().map(|b| (b.category.as_str(), b.label.as_str())).collect::<Vec<_>>(), vec![
            ("productive", "code.exe"),
            ("distracting", "youtube.com"),
            ("productive", "code.exe"),
        ]);
        assert_eq!(v.blocks[0].end - v.blocks[0].start, 15 * 60_000);
        assert_eq!((v.sessions.len(), v.sessions[0].outcome.as_str()), (1, "broken"));
        assert_eq!(v.top[0].key, "code.exe");
    }

    #[test]
    fn recaps_last_week_against_the_one_before() {
        let conn = fresh();
        let deep = profile(&conn, "Deep Work");
        // Today is Wednesday Oct 28, 2026: last week is Oct 19 to 25.
        let today = NaiveDate::from_ymd_opt(2026, 10, 28).unwrap();
        assert_eq!(recap(&conn, today).unwrap(), None, "nothing to recap");
        let mon = NaiveDate::from_ymd_opt(2026, 10, 19).unwrap();
        session(&conn, deep, at(mon, 9, 0), 120, "completed");
        session(&conn, deep, at(mon + Duration::days(2), 9, 0), 60, "completed");
        session(&conn, deep, at(mon - Duration::days(3), 9, 0), 30, "completed");
        let r = recap(&conn, today).unwrap().unwrap();
        assert_eq!((r.week.as_str(), r.focus_min, r.previous_focus_min, r.sessions), ("2026-10-19", 180, 30, 2));
        assert_eq!((r.best_day.as_deref(), r.best_day_min), (Some("2026-10-19"), 120));
    }
}
