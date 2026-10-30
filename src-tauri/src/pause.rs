//! Pause mode (v0.3.1, decided 2026-10-30): outside seals, a flagged app or site asks "Still want
//! it?" for 5 seconds before it opens. Go on lets it be for 15 minutes; Not now closes it. A
//! one-second pause before opening an app cut how often it was opened by about 57% (Grüning et
//! al. 2023, PNAS). Opt-in: off, all day, or set hours. Never during a seal or quiet hours,
//! which block outright.

use crate::quiet;
use crate::session::now_ms;
use chrono::{Local, TimeZone};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// How long the card waits before Go on works.
pub const WAIT_MS: i64 = 5_000;
/// How long Go on leaves an app or site alone.
pub const ALLOW_MS: i64 = 15 * 60_000;
const KEY: &str = "pause_mode";

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    /// "off", "all" (all day), or "hours" (the window below).
    pub mode: String,
    pub days_mask: i64,
    pub start: String,
    pub end: String,
}

impl Default for Config {
    fn default() -> Self {
        Config { mode: "off".into(), days_mask: 127, start: "09:00".into(), end: "17:00".into() }
    }
}

impl Config {
    pub fn validate(&self) -> Result<(), String> {
        match self.mode.as_str() {
            "off" | "all" => Ok(()),
            "hours" => self.window().validate().map_err(|e| e.replace("Quiet hours need", "Pause hours need")),
            _ => Err("Pick off, all day, or set hours.".into()),
        }
    }
    /// The same schedule rules as quiet hours.
    fn window(&self) -> quiet::Config {
        quiet::Config { enabled: true, days_mask: self.days_mask, start: self.start.clone(), end: self.end.clone() }
    }
    /// On at `now` (ms).
    pub fn on_at(&self, now: i64) -> bool {
        match self.mode.as_str() {
            "all" => true,
            "hours" => Local.timestamp_millis_opt(now).single().is_some_and(|t| self.window().window_end(t.naive_local()).is_some()),
            _ => false,
        }
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

/// Logs what you chose at a pause: "went_on" or "turned_back".
pub fn log(conn: &Connection, what: &str, kind: &str, outcome: &str, now: i64) -> Result<(), String> {
    if !matches!(kind, "app" | "site") || !matches!(outcome, "went_on" | "turned_back") {
        return Err("Unknown pause.".into());
    }
    let what: String = what.trim().chars().take(120).collect();
    if what.is_empty() {
        return Err("Unknown pause.".into());
    }
    conn.execute("INSERT INTO pause_events (ts, what, kind, outcome) VALUES (?1, ?2, ?3, ?4)", params![now, what, kind, outcome])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(Serialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub paused: i64,
    pub turned_back: i64,
}

/// How often a pause turned you back in [from, to).
pub fn summary(conn: &Connection, from: i64, to: i64) -> rusqlite::Result<Summary> {
    conn.query_row(
        "SELECT COUNT(*), COALESCE(SUM(outcome = 'turned_back'), 0) FROM pause_events WHERE ts >= ?1 AND ts < ?2",
        params![from, to],
        |r| Ok(Summary { paused: r.get(0)?, turned_back: r.get(1)? }),
    )
}

/// The app waiting on the card: its exe and the windows' processes hidden behind it.
#[derive(Clone, Debug, PartialEq)]
pub struct Pending {
    pub exe: String,
    pub pids: Vec<u32>,
    pub at: i64,
}

/// Live pause-mode state, kept by the engine.
#[derive(Default, Debug)]
pub struct State {
    pub config: Config,
    /// exe -> until (ms): Go on leaves it alone this long.
    pub allowed: HashMap<String, i64>,
    pub pending: Option<Pending>,
}

impl State {
    pub fn on(&self, now: i64) -> bool {
        self.config.on_at(now)
    }
    /// Whether an app in front should be paused now: flagged, not allowed, not already waiting.
    pub fn should_pause(&mut self, exe: &str, now: i64) -> bool {
        self.allowed.retain(|_, until| *until > now);
        // A card left unanswered for two minutes lets go, so nothing stays stuck behind it.
        if self.pending.as_ref().is_some_and(|p| now - p.at > 120_000) {
            self.pending = None;
        }
        !self.allowed.contains_key(exe) && !self.pending.as_ref().is_some_and(|p| p.exe == exe)
    }
    pub fn allow(&mut self, exe: &str, now: i64) {
        self.allowed.insert(exe.to_string(), now + ALLOW_MS);
    }
}

/// Go on is ready once the wait is over.
pub fn ready(p: &Pending, now: i64) -> bool {
    now - p.at >= WAIT_MS
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub config: Config,
    /// Asking right now.
    pub on: bool,
}

pub fn status(s: &State) -> Status {
    Status { config: s.config.clone(), on: s.on(now_ms()) }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    #[test]
    fn modes_and_validation() {
        assert!(!Config::default().on_at(now_ms()), "off by default");
        assert!(Config { mode: "all".into(), ..Default::default() }.on_at(now_ms()));
        let always = Config { mode: "hours".into(), start: "00:00".into(), end: "23:59".into(), ..Default::default() };
        assert!(always.validate().is_ok());
        assert!(Config { mode: "sometimes".into(), ..Default::default() }.validate().is_err());
        assert_eq!(Config { mode: "hours".into(), start: "09:00".into(), end: "09:00".into(), ..Default::default() }.validate(), Err("Pause hours need a start and an end that differ.".into()));
        assert!(Config { mode: "hours".into(), days_mask: 0, ..Default::default() }.validate().is_err());
    }

    #[test]
    fn go_on_leaves_an_app_alone_for_a_while() {
        let mut s = State::default();
        assert!(s.should_pause("discord.exe", 0));
        s.pending = Some(Pending { exe: "discord.exe".into(), pids: vec![1], at: 0 });
        assert!(!s.should_pause("discord.exe", 1_000), "already waiting");
        assert!(!ready(s.pending.as_ref().unwrap(), WAIT_MS - 1));
        assert!(ready(s.pending.as_ref().unwrap(), WAIT_MS));
        s.pending = None;
        s.allow("discord.exe", 10_000);
        assert!(!s.should_pause("discord.exe", 10_000 + ALLOW_MS - 1));
        assert!(s.should_pause("discord.exe", 10_000 + ALLOW_MS), "the allowance runs out");
    }

    #[test]
    fn saves_and_counts_what_you_chose() {
        let mut conn = Connection::open_in_memory().unwrap();
        db::prepare(&mut conn).unwrap();
        assert_eq!(load(&conn), Config::default());
        let cfg = Config { mode: "hours".into(), days_mask: 62, start: "09:00".into(), end: "17:00".into() };
        save(&conn, &cfg).unwrap();
        assert_eq!(load(&conn), cfg);
        log(&conn, "discord.exe", "app", "turned_back", 10).unwrap();
        log(&conn, "youtube.com", "site", "went_on", 20).unwrap();
        log(&conn, "youtube.com", "site", "turned_back", 30).unwrap();
        assert!(log(&conn, "x", "app", "maybe", 40).is_err());
        assert!(log(&conn, "  ", "app", "went_on", 40).is_err());
        assert_eq!(summary(&conn, 0, 100).unwrap(), Summary { paused: 3, turned_back: 2 });
        assert_eq!(summary(&conn, 15, 25).unwrap(), Summary { paused: 1, turned_back: 0 });
    }
}
