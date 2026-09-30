//! Tamper detection during a seal (SPEC 4.0.1, 6; M12, decided 2026-09-30). Each of these
//! breaks the seal: it can't finish as kept, the streak resets, and the partner hears about it.
//! The seal itself stays on until its planned end, so tampering never lets you out early.
//! - The system clock jumps more than 2 minutes. Measured against GetTickCount64, which keeps
//!   counting through sleep, so waking a laptop never counts as a jump.
//! - Sanctum Guard was running when the seal started and stays stopped for 20 seconds
//!   (Windows restarts a killed guard within 2).
//! - A browser's extension was connected when the seal started and the browser keeps running
//!   without it for 90 seconds (browser.rs). Closing the browser is fine.

use crate::{engine, session, Shared};
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

pub const EV_TAMPER: &str = "sanctum://tamper";
pub const JUMP_LIMIT_MS: i64 = 120_000;
pub const GUARD_GRACE: Duration = Duration::from_secs(20);
pub const EXTENSION_GRACE: Duration = Duration::from_secs(90);

/// How far the wall clock moved beyond real elapsed time between two samples of
/// (wall ms, uptime ms). Positive: set forward; negative: set back.
pub fn clock_jump(prev: (i64, u64), now: (i64, u64)) -> i64 {
    (now.0 - prev.0) - (now.1 as i64 - prev.1 as i64)
}

#[derive(Default)]
pub struct State {
    sample: Mutex<Option<(i64, u64)>>,
    guard_at_seal: AtomicBool,
    guard_down_since: Mutex<Option<Instant>>,
}

fn uptime_ms() -> u64 {
    unsafe { windows::Win32::System::SystemInformation::GetTickCount64() }
}

/// Called when a seal starts or resumes, and when it ends.
pub fn on_seal(app: &AppHandle, sealed: bool) {
    let shared = app.state::<Shared>();
    let t = &shared.tamper;
    *t.sample.lock().unwrap() = None;
    *t.guard_down_since.lock().unwrap() = None;
    let guard = sealed && crate::guard::service_running();
    t.guard_at_seal.store(guard, Ordering::Relaxed);
}

/// One engine tick while sealed.
pub fn check(app: &AppHandle, n: u64) {
    let shared = app.state::<Shared>();
    let t = &shared.tamper;
    let now = (session::now_ms(), uptime_ms());
    let prev = t.sample.lock().unwrap().replace(now);
    if let Some(prev) = prev {
        let jump = clock_jump(prev, now);
        if jump.abs() > JUMP_LIMIT_MS {
            let dir = if jump > 0 { "forward" } else { "back" };
            break_seal(app, "clock", format!("the system clock was set {dir} {} min", jump.abs() / 60_000));
        }
    }
    if n % 5 == 0 && t.guard_at_seal.load(Ordering::Relaxed) {
        let mut down = t.guard_down_since.lock().unwrap();
        if crate::guard::service_running() {
            *down = None;
        } else if down.get_or_insert_with(Instant::now).elapsed() >= GUARD_GRACE {
            drop(down);
            break_seal(app, "guard", "Sanctum Guard was stopped".into());
        }
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Tampered {
    kind: &'static str,
    detail: String,
}

/// Breaks the running seal once: logs it, tells the partner, and tells the window.
pub fn break_seal(app: &AppHandle, kind: &'static str, detail: String) {
    let shared = app.state::<Shared>();
    let (id, profile) = {
        let mut guard = shared.engine.active_mut();
        let Some(active) = guard.as_mut() else { return };
        if active.tampered {
            return;
        }
        active.tampered = true;
        active.broken = true;
        (active.id, active.profile_name.clone())
    };
    let now = session::now_ms();
    if let Ok(conn) = shared.db.lock() {
        let _ = session::mark_broken(&conn, id, now);
        let _ = conn.execute("INSERT INTO tamper_events (session_id, ts, kind) VALUES (?1, ?2, ?3)", rusqlite::params![id, now, kind]);
    }
    crate::cloud::notify(app, "session_broken", format!("{profile}: {detail}"));
    engine::emit_view(app);
    let _ = app.emit(EV_TAMPER, Tampered { kind, detail });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn jumps_are_measured_against_uptime() {
        // One real second, clock moved one second: no jump.
        assert_eq!(clock_jump((1_000, 50), (2_000, 1_050)), 0);
        // Slept an hour: both moved an hour.
        assert_eq!(clock_jump((0, 0), (3_600_000, 3_600_000)), 0);
        // Set forward an hour within a second.
        assert_eq!(clock_jump((0, 0), (3_601_000, 1_000)), 3_600_000);
        // Set back 5 minutes.
        assert_eq!(clock_jump((600_000, 0), (301_000, 1_000)), -300_000);
        // NTP nudges stay under the limit.
        assert!(clock_jump((0, 0), (31_000, 1_000)).abs() < JUMP_LIMIT_MS);
    }
}
