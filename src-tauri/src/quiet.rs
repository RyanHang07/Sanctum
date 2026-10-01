//! Quiet hours (v0.1, decided 2026-09-30): the Distractions list is blocked on a schedule, outside
//! focus sessions. Soft by design: a 15-minute pause from the tray takes a reason and no ladder,
//! and nothing here touches sessions or streaks.

use crate::session::now_ms;
use chrono::{Datelike, Duration, Local, NaiveDateTime, NaiveTime, TimeZone};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

pub const PAUSE_MS: i64 = 15 * 60_000;
/// A reason is a sentence, not a keystroke.
pub const MIN_REASON: usize = 10;
const KEY: &str = "quiet_hours";

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    pub enabled: bool,
    /// Bit 0 = Sunday ... bit 6 = Saturday: the days a window starts on.
    pub days_mask: i64,
    /// 'HH:MM'. An end at or before the start runs past midnight.
    pub start: String,
    pub end: String,
}

impl Default for Config {
    fn default() -> Self {
        Config { enabled: false, days_mask: 127, start: "23:00".into(), end: "07:00".into() }
    }
}

fn time(t: &str) -> Option<NaiveTime> {
    NaiveTime::parse_from_str(t, "%H:%M").ok()
}

impl Config {
    pub fn validate(&self) -> Result<(), String> {
        if !(1..=127).contains(&self.days_mask) {
            return Err("Pick at least one day.".into());
        }
        let (Some(s), Some(e)) = (time(&self.start), time(&self.end)) else {
            return Err("Times must be HH:MM.".into());
        };
        if s == e {
            return Err("Quiet hours need a start and an end that differ.".into());
        }
        Ok(())
    }

    /// When the window you're in ends, or None outside quiet hours. A window belongs to the day
    /// it starts on, so an overnight Friday window still runs into Saturday morning.
    pub fn window_end(&self, now: NaiveDateTime) -> Option<NaiveDateTime> {
        if !self.enabled {
            return None;
        }
        let (s, e) = (time(&self.start)?, time(&self.end)?);
        for back in [0, 1] {
            let day = now.date() - Duration::days(back);
            if self.days_mask & (1 << day.weekday().num_days_from_sunday()) == 0 {
                continue;
            }
            let start = day.and_time(s);
            let end = if e > s { day.and_time(e) } else { (day + Duration::days(1)).and_time(e) };
            if start <= now && now < end {
                return Some(end);
            }
        }
        None
    }
}

pub fn load(conn: &Connection) -> Config {
    conn.query_row("SELECT value FROM settings WHERE key = ?1", [KEY], |r| r.get::<_, String>(0))
        .optional()
        .ok()
        .flatten()
        .and_then(|v| serde_json::from_str(&v).ok())
        .unwrap_or_default()
}

pub fn save(conn: &Connection, cfg: &Config) -> Result<(), String> {
    cfg.validate()?;
    let v = serde_json::to_string(cfg).map_err(|e| e.to_string())?;
    conn.execute("INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value", params![KEY, v])
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Logs a pause with its reason (kept for your own review; it never reaches the partner).
pub fn log_pause(conn: &Connection, reason: &str, now: i64) -> Result<(), String> {
    let reason = reason.trim();
    if reason.chars().count() < MIN_REASON {
        return Err("Say why in a sentence.".into());
    }
    conn.execute("INSERT INTO quiet_pauses (ts, reason) VALUES (?1, ?2)", params![now, reason]).map_err(|e| e.to_string())?;
    Ok(())
}

/// Live quiet-hours state, kept by the engine.
#[derive(Default, Debug)]
pub struct State {
    pub config: Config,
    /// Enforcing right now: in the window, not paused, no session running.
    pub on: bool,
    pub paused_until: Option<i64>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub config: Config,
    /// Inside a window (paused or not).
    pub active: bool,
    /// Blocking now.
    pub on: bool,
    /// When the current window ends (ms), if inside one.
    pub ends_at: Option<i64>,
    pub paused_until: Option<i64>,
}

fn to_ms(t: NaiveDateTime) -> i64 {
    Local.from_local_datetime(&t).earliest().map(|d| d.timestamp_millis()).unwrap_or(0)
}

impl State {
    /// Where the window stands at `now` (ms): (inside, window end, pause still running).
    pub fn evaluate(&mut self, now: i64) -> (bool, Option<i64>, bool) {
        let local = Local.timestamp_millis_opt(now).single().map(|d| d.naive_local());
        let end = local.and_then(|l| self.config.window_end(l)).map(to_ms);
        if self.paused_until.is_some_and(|p| p <= now) || end.is_none() {
            self.paused_until = None;
        }
        (end.is_some(), end, self.paused_until.is_some())
    }

    pub fn status(&mut self) -> Status {
        let (active, ends_at, _) = self.evaluate(now_ms());
        Status { config: self.config.clone(), active, on: self.on, ends_at, paused_until: self.paused_until }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use chrono::NaiveDate;

    fn at(y: i32, m: u32, d: u32, h: u32, min: u32) -> NaiveDateTime {
        NaiveDate::from_ymd_opt(y, m, d).unwrap().and_hms_opt(h, min, 0).unwrap()
    }

    #[test]
    fn overnight_windows_belong_to_the_day_they_start() {
        // 2026-10-02 is a Friday (bit 5); 2026-10-03 a Saturday (bit 6).
        let cfg = Config { enabled: true, days_mask: 1 << 5, start: "23:00".into(), end: "07:00".into() };
        assert_eq!(cfg.window_end(at(2026, 10, 2, 23, 30)), Some(at(2026, 10, 3, 7, 0)));
        assert_eq!(cfg.window_end(at(2026, 10, 3, 6, 59)), Some(at(2026, 10, 3, 7, 0)));
        assert_eq!(cfg.window_end(at(2026, 10, 3, 7, 0)), None);
        // Saturday night isn't picked.
        assert_eq!(cfg.window_end(at(2026, 10, 3, 23, 30)), None);
        // Off means off.
        assert_eq!(Config { enabled: false, ..cfg.clone() }.window_end(at(2026, 10, 2, 23, 30)), None);
    }

    #[test]
    fn same_day_windows_and_validation() {
        let cfg = Config { enabled: true, days_mask: 127, start: "13:00".into(), end: "15:30".into() };
        assert_eq!(cfg.window_end(at(2026, 10, 1, 14, 0)), Some(at(2026, 10, 1, 15, 30)));
        assert_eq!(cfg.window_end(at(2026, 10, 1, 12, 59)), None);
        assert!(cfg.validate().is_ok());
        assert!(Config { end: "13:00".into(), ..cfg.clone() }.validate().is_err());
        assert!(Config { days_mask: 0, ..cfg.clone() }.validate().is_err());
        assert!(Config { start: "25:00".into(), ..cfg }.validate().is_err());
    }

    #[test]
    fn saves_loads_and_logs_pauses_with_a_reason() {
        let mut conn = Connection::open_in_memory().unwrap();
        db::prepare(&mut conn).unwrap();
        assert_eq!(load(&conn), Config::default());
        let cfg = Config { enabled: true, days_mask: 62, start: "22:30".into(), end: "06:00".into() };
        save(&conn, &cfg).unwrap();
        assert_eq!(load(&conn), cfg);
        assert!(log_pause(&conn, "short", 1).is_err());
        log_pause(&conn, "  Calling my sister back about the weekend  ", 2).unwrap();
        let r: String = conn.query_row("SELECT reason FROM quiet_pauses", [], |r| r.get(0)).unwrap();
        assert_eq!(r, "Calling my sister back about the weekend");
    }

    #[test]
    fn a_pause_lapses_and_ends_with_the_window() {
        let mut s = State { config: Config { enabled: true, days_mask: 127, start: "00:00".into(), end: "23:59".into() }, ..Default::default() };
        let now = now_ms();
        s.paused_until = Some(now - 1);
        let (_, _, paused) = s.evaluate(now);
        assert!(!paused);
        assert_eq!(s.paused_until, None);
    }
}
