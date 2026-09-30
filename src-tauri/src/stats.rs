//! Stats and streaks (SPEC 4.9, 4.10). Days run from the daily reset time (4:00 AM) to the
//! next, in local time. A day is kept when focus reaches the daily goal and no seal broke;
//! planned rest days never break the streak and count toward it.

use crate::{db, session, Shared};
use chrono::{DateTime, Datelike, Duration, Local, NaiveDate, NaiveTime, Timelike};
use rusqlite::{params, Connection};
use serde::Serialize;
use std::collections::{BTreeMap, HashMap};
use tauri::State;

pub const REST_DAYS_KEY: &str = "rest_days_mask";
const DEFAULT_GOAL_MIN: i64 = 120;

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DayStatus {
    /// Before your first session: nothing to keep yet.
    None,
    Kept,
    /// A non-rest day under the goal: the streak resets.
    Missed,
    /// A seal broke: the streak resets.
    Broken,
    Rest,
    /// Today, not kept yet. Never breaks the streak.
    Today,
    Future,
}

/// What a day counts as. `rest` is a planned rest day; `before_start` is before any session.
pub fn day_status(focus_min: i64, broken: bool, rest: bool, goal_min: i64, when: std::cmp::Ordering, before_start: bool) -> DayStatus {
    use std::cmp::Ordering::*;
    if when == Greater {
        return DayStatus::Future;
    }
    if broken {
        return DayStatus::Broken;
    }
    if focus_min >= goal_min {
        return DayStatus::Kept;
    }
    if rest {
        return DayStatus::Rest;
    }
    if when == Equal {
        return DayStatus::Today;
    }
    if before_start {
        DayStatus::None
    } else {
        DayStatus::Missed
    }
}

/// (current, longest) from statuses oldest first, ending today.
pub fn streaks(statuses: &[DayStatus]) -> (i64, i64) {
    let (mut run, mut longest) = (0i64, 0i64);
    for s in statuses {
        match s {
            DayStatus::Kept | DayStatus::Rest => run += 1,
            DayStatus::Missed | DayStatus::Broken => run = 0,
            DayStatus::None | DayStatus::Today | DayStatus::Future => {}
        }
        longest = longest.max(run);
    }
    (run, longest)
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DayStat {
    pub date: String,
    pub status: DayStatus,
    pub focus_min: i64,
    pub sessions: i64,
    pub attempts: i64,
    /// When the seal broke that day, for the tooltip.
    pub broken_at: Option<i64>,
    pub productive_min: i64,
    pub distracting_min: i64,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Tempted {
    /// Exe, site, or “keyword”.
    pub what: String,
    pub kind: String,
    pub count: i64,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Overview {
    pub from: String,
    pub to: String,
    pub goal_min: i64,
    pub rest_mask: i64,
    pub current_streak: i64,
    pub longest_streak: i64,
    pub days: Vec<DayStat>,
    pub kept: i64,
    pub broken: i64,
    pub missed: i64,
    pub focus_min: i64,
    pub attempts: i64,
    pub tempted: Vec<Tempted>,
    pub productive_min: i64,
    pub neutral_min: i64,
    pub distracting_min: i64,
    pub idle_min: i64,
}

/// Local day boundaries shifted by the reset time.
pub struct Days {
    reset: Duration,
}

impl Days {
    pub fn load(conn: &Connection) -> Self {
        let reset = db::get_setting(conn, "daily_reset_time")
            .ok()
            .flatten()
            .and_then(|t| NaiveTime::parse_from_str(&t, "%H:%M").ok())
            .unwrap_or(NaiveTime::MIN);
        Days { reset: Duration::seconds(i64::from(reset.num_seconds_from_midnight())) }
    }
    pub fn of(&self, ts_ms: i64) -> NaiveDate {
        DateTime::from_timestamp_millis(ts_ms).map(|t| (t.with_timezone(&Local) - self.reset).date_naive()).unwrap_or_default()
    }
}

fn key(d: NaiveDate) -> String {
    d.format("%Y-%m-%d").to_string()
}

#[derive(Default, Clone)]
struct Tally {
    focus_ms: i64,
    sessions: i64,
    attempts: i64,
    broken_at: Option<i64>,
    productive_s: i64,
    distracting_s: i64,
}

/// Everything the Stats tab shows for `from..=to` (date keys). `live_ms` is the running
/// session's focus so far, counted today.
pub fn overview(conn: &Connection, from: NaiveDate, to: NaiveDate, today: NaiveDate, live_ms: i64) -> rusqlite::Result<Overview> {
    let days = Days::load(conn);
    let goal_min = db::get_setting(conn, "daily_goal_min")?.and_then(|v| v.parse().ok()).filter(|g: &i64| *g > 0).unwrap_or(DEFAULT_GOAL_MIN);
    let rest_mask: i64 = db::get_setting(conn, REST_DAYS_KEY)?.and_then(|v| v.parse().ok()).unwrap_or(0);

    // Sessions, all time: the streak needs the whole history.
    let mut tally: BTreeMap<NaiveDate, Tally> = BTreeMap::new();
    let mut stmt = conn.prepare(
        "SELECT started_at, MAX(0, MIN(planned_minutes * 60000, ended_at - started_at - idle_ms) - gap_ms), outcome, COALESCE(broken_at, ended_at)
         FROM sessions WHERE ended_at IS NOT NULL",
    )?;
    let rows = stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?, r.get::<_, Option<String>>(2)?, r.get::<_, Option<i64>>(3)?)))?;
    for row in rows {
        let (started, focus, outcome, broke) = row?;
        let t = tally.entry(days.of(started)).or_default();
        t.focus_ms += focus;
        t.sessions += 1;
        if outcome.as_deref() == Some("broken") {
            let at = broke.unwrap_or(started);
            let bt = tally.entry(days.of(at)).or_default();
            bt.broken_at = Some(bt.broken_at.map_or(at, |b| b.min(at)));
        }
    }
    if live_ms > 0 {
        let t = tally.entry(today).or_default();
        t.focus_ms += live_ms;
        t.sessions += 1;
    }
    let mut stmt = conn.prepare("SELECT ts FROM blocked_attempts")?;
    for ts in stmt.query_map([], |r| r.get::<_, i64>(0))? {
        tally.entry(days.of(ts?)).or_default().attempts += 1;
    }

    // Activity is only kept for the retention window, so it's read for the range alone.
    let range_start = start_ms(&days, from);
    let range_end = start_ms(&days, to + Duration::days(1));
    let mut cats: HashMap<String, i64> = HashMap::new();
    let mut stmt = conn.prepare("SELECT ts, duration_s, category FROM activity WHERE ts >= ?1 AND ts < ?2")?;
    let rows = stmt.query_map(params![range_start, range_end], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?, r.get::<_, String>(2)?)))?;
    for row in rows {
        let (ts, secs, cat) = row?;
        let t = tally.entry(days.of(ts)).or_default();
        match cat.as_str() {
            "productive" => t.productive_s += secs,
            "distracting" => t.distracting_s += secs,
            _ => {}
        }
        *cats.entry(cat).or_default() += secs;
    }
    let idle_ms: Option<i64> = conn.query_row(
        "SELECT SUM(MIN(COALESCE(ended_at, ?3), ?2) - MAX(started_at, ?1)) FROM idle_periods
         WHERE started_at < ?2 AND COALESCE(ended_at, ?3) > ?1",
        params![range_start, range_end, session::now_ms()],
        |r| r.get(0),
    )?;

    // Walk every day from the first session (or the range start) to today for the streak.
    let first = tally.keys().next().copied().unwrap_or(from).min(from);
    let started = tally.iter().find(|(_, t)| t.sessions > 0).map(|(d, _)| *d);
    let status_of = |d: NaiveDate| {
        let t = tally.get(&d).cloned().unwrap_or_default();
        let rest = rest_mask & (1 << d.weekday().num_days_from_sunday()) != 0;
        day_status(t.focus_ms / 60_000, t.broken_at.is_some(), rest, goal_min, d.cmp(&today), started.map_or(true, |s| d < s))
    };
    let mut history = Vec::new();
    let mut d = first;
    while d <= today {
        history.push(status_of(d));
        d += Duration::days(1);
    }
    let (current_streak, longest_streak) = streaks(&history);

    let mut out = Vec::new();
    let mut d = from;
    while d <= to {
        let t = tally.get(&d).cloned().unwrap_or_default();
        out.push(DayStat {
            date: key(d),
            status: status_of(d),
            focus_min: t.focus_ms / 60_000,
            sessions: t.sessions,
            attempts: t.attempts,
            broken_at: t.broken_at,
            productive_min: t.productive_s / 60,
            distracting_min: t.distracting_s / 60,
        });
        d += Duration::days(1);
    }

    let mut stmt = conn.prepare(
        "SELECT exe, kind, COUNT(*) AS n FROM blocked_attempts WHERE ts >= ?1 AND ts < ?2
         GROUP BY exe, kind ORDER BY n DESC, exe LIMIT 6",
    )?;
    let tempted = stmt
        .query_map(params![range_start, range_end], |r| Ok(Tempted { what: r.get(0)?, kind: r.get(1)?, count: r.get(2)? }))?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    let count = |s: DayStatus| out.iter().filter(|x| x.status == s).count() as i64;
    Ok(Overview {
        from: key(from),
        to: key(to),
        goal_min,
        rest_mask,
        current_streak,
        longest_streak,
        kept: count(DayStatus::Kept),
        broken: count(DayStatus::Broken),
        missed: count(DayStatus::Missed),
        focus_min: out.iter().map(|x| x.focus_min).sum(),
        attempts: out.iter().map(|x| x.attempts).sum(),
        tempted,
        productive_min: cats.get("productive").copied().unwrap_or(0) / 60,
        neutral_min: cats.get("neutral").copied().unwrap_or(0) / 60,
        distracting_min: cats.get("distracting").copied().unwrap_or(0) / 60,
        idle_min: idle_ms.unwrap_or(0).max(0) / 60_000,
        days: out,
    })
}

/// When the planner day `d` starts, in ms.
fn start_ms(days: &Days, d: NaiveDate) -> i64 {
    use chrono::TimeZone;
    let local = d.and_time(NaiveTime::MIN) + days.reset;
    Local.from_local_datetime(&local).earliest().map(|t| t.timestamp_millis()).unwrap_or(0)
}

#[tauri::command]
pub fn stats_overview(shared: State<Shared>, from: String, to: String) -> Result<Overview, String> {
    let parse = |s: &str| NaiveDate::parse_from_str(s, "%Y-%m-%d").map_err(|e| e.to_string());
    let (from, to) = (parse(&from)?, parse(&to)?);
    if to < from || (to - from).num_days() > 400 {
        return Err("That range is too long.".into());
    }
    let live_ms = shared.engine.view().map(|v| v.elapsed_ms.max(0)).unwrap_or(0);
    let conn = shared.db.lock().map_err(|e| e.to_string())?;
    let today = Days::load(&conn).of(session::now_ms());
    overview(&conn, from, to, today, live_ms).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cmp::Ordering::*;
    use DayStatus::*;

    #[test]
    fn days_count_by_the_goal_and_broken_seals() {
        assert_eq!(day_status(130, false, false, 120, Less, false), Kept);
        assert_eq!(day_status(90, false, false, 120, Less, false), Missed);
        assert_eq!(day_status(200, true, false, 120, Less, false), Broken, "a broken seal loses the day");
        assert_eq!(day_status(0, false, true, 120, Less, false), Rest);
        assert_eq!(day_status(130, false, true, 120, Less, false), Kept, "focus on a rest day still shows");
        assert_eq!(day_status(30, false, false, 120, Equal, false), Today);
        assert_eq!(day_status(120, false, false, 120, Equal, false), Kept);
        assert_eq!(day_status(0, false, false, 120, Less, true), None);
        assert_eq!(day_status(0, false, false, 120, Greater, false), Future);
    }

    #[test]
    fn streaks_count_kept_and_rest_days() {
        assert_eq!(streaks(&[None, None, Kept, Kept, Rest, Kept, Today]), (4, 4));
        assert_eq!(streaks(&[Kept, Kept, Kept, Missed, Kept, Today]), (1, 3));
        assert_eq!(streaks(&[Kept, Broken, Kept, Kept]), (2, 2));
        assert_eq!(streaks(&[]), (0, 0));
    }

    fn fresh() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        db::prepare(&mut conn).unwrap();
        db::set_setting(&conn, "daily_reset_time", "00:00").unwrap();
        db::set_setting(&conn, "daily_goal_min", "60").unwrap();
        conn
    }

    fn at(d: NaiveDate, hour: u32) -> i64 {
        use chrono::TimeZone;
        Local.from_local_datetime(&d.and_hms_opt(hour, 0, 0).unwrap()).earliest().unwrap().timestamp_millis()
    }

    fn session(conn: &Connection, start: i64, minutes: i64, outcome: &str) -> i64 {
        conn.execute(
            "INSERT INTO sessions (started_at, ended_at, planned_minutes, outcome, broken_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![start, start + minutes * 60_000, minutes.max(30), outcome, (outcome == "broken").then_some(start + minutes * 60_000)],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    #[test]
    fn builds_a_week_with_streak_attempts_and_activity() {
        let conn = fresh();
        let mon = NaiveDate::from_ymd_opt(2026, 9, 21).unwrap();
        let day = |n: i64| mon + Duration::days(n);
        // Mon kept, Tue kept, Wed short, Thu kept, Fri broken, Sat rest (planned), Sun today.
        db::set_setting(&conn, REST_DAYS_KEY, &(1 << 6).to_string()).unwrap();
        session(&conn, at(day(0), 9), 60, "completed");
        let tue = session(&conn, at(day(1), 9), 90, "completed");
        session(&conn, at(day(2), 9), 30, "completed");
        session(&conn, at(day(3), 9), 60, "completed");
        session(&conn, at(day(4), 9), 60, "completed");
        session(&conn, at(day(4), 14), 40, "broken");
        conn.execute("INSERT INTO blocked_attempts (session_id, ts, exe, kind) VALUES (?1, ?2, 'discord.exe', 'app')", params![tue, at(day(1), 10)]).unwrap();
        conn.execute("INSERT INTO blocked_attempts (session_id, ts, exe, kind) VALUES (?1, ?2, 'discord.exe', 'app')", params![tue, at(day(1), 11)]).unwrap();
        conn.execute("INSERT INTO blocked_attempts (session_id, ts, exe, kind) VALUES (?1, ?2, 'youtube.com', 'site')", params![tue, at(day(1), 12)]).unwrap();
        conn.execute("INSERT INTO activity (ts, exe, duration_s, category) VALUES (?1, 'code.exe', 3600, 'productive')", [at(day(1), 9)]).unwrap();
        conn.execute("INSERT INTO activity (ts, exe, duration_s, category) VALUES (?1, 'chrome.exe', 600, 'distracting')", [at(day(1), 13)]).unwrap();

        let o = overview(&conn, mon, day(6), day(6), 20 * 60_000).unwrap();
        let statuses: Vec<_> = o.days.iter().map(|d| d.status).collect();
        assert_eq!(statuses, vec![Kept, Kept, Missed, Kept, Broken, Rest, Today]);
        assert_eq!(o.days[1].focus_min, 90);
        assert_eq!(o.days[1].attempts, 3);
        assert_eq!(o.days[6].focus_min, 20, "the running session counts today");
        // Broken Friday reset the streak; Saturday's rest counts.
        assert_eq!((o.current_streak, o.longest_streak), (1, 2));
        assert_eq!((o.kept, o.broken, o.missed), (3, 1, 1));
        assert_eq!(o.tempted[0], Tempted { what: "discord.exe".into(), kind: "app".into(), count: 2 });
        assert_eq!((o.productive_min, o.distracting_min), (60, 10));
        assert_eq!(o.days[1].productive_min, 60);
    }
}
