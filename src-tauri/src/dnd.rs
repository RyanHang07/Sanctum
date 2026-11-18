//! Windows Do Not Disturb while sealed (v0.1, decided 2026-09-30). Windows has no public API for
//! it, so this flips the same internal switch the Action Center uses: the WNF state
//! WNF_SHEL_QUIETHOURS_ACTIVE_PROFILE_CHANGED (0 off, 1 priority only, 2 alarms only). It can
//! stop working after a Windows update; every failure is silent and Setup shows the status.
//! The profile you had before the seal is saved, so a crash mid-seal still restores it.

use crate::engine::Locked;
use crate::{db, Shared};
use serde::Serialize;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

const STATE_NAME: u64 = 0x0D83_063E_A3BF_1C75;
/// Alarms only: nothing but alarms gets through while sealed.
const ALARMS_ONLY: u32 = 2;
const SETTING: &str = "dnd_on_seal";
/// Also during quiet hours (v0.3.1, off to start): batching notifications helped well-being and
/// felt more productive (Fitz et al. 2019).
const QUIET_SETTING: &str = "dnd_on_quiet";
const RESTORE: &str = "dnd_restore";

#[cfg(windows)]
#[link(name = "ntdll")]
extern "system" {
    fn NtQueryWnfStateData(
        state_name: *const u64,
        type_id: *const std::ffi::c_void,
        explicit_scope: *const std::ffi::c_void,
        change_stamp: *mut u32,
        buffer: *mut std::ffi::c_void,
        buffer_size: *mut u32,
    ) -> i32;
    fn NtUpdateWnfStateData(
        state_name: *const u64,
        buffer: *const std::ffi::c_void,
        length: u32,
        type_id: *const std::ffi::c_void,
        explicit_scope: *const std::ffi::c_void,
        matching_change_stamp: u32,
        check_stamp: u32,
    ) -> i32;
}

/// The current Focus Assist profile, or None when the switch can't be read.
#[cfg(windows)]
pub fn read() -> Option<u32> {
    let mut stamp = 0u32;
    let mut value = 0u32;
    let mut size = std::mem::size_of::<u32>() as u32;
    let status = unsafe {
        NtQueryWnfStateData(&STATE_NAME, std::ptr::null(), std::ptr::null(), &mut stamp, (&mut value as *mut u32).cast(), &mut size)
    };
    (status >= 0 && size == 4).then_some(value)
}

/// Sets the profile and reads it back. False when Windows refused or ignored it.
#[cfg(windows)]
pub fn write(value: u32) -> bool {
    let status = unsafe {
        NtUpdateWnfStateData(&STATE_NAME, (&value as *const u32).cast(), 4, std::ptr::null(), std::ptr::null(), 0, 0)
    };
    status >= 0 && read() == Some(value)
}

#[cfg(not(windows))]
pub fn read() -> Option<u32> {
    None
}
#[cfg(not(windows))]
pub fn write(_value: u32) -> bool {
    false
}

fn enabled(app: &AppHandle) -> bool {
    let shared = app.state::<Shared>();
    let v = Some(shared.db.locked()).and_then(|c| db::get_setting(&c, SETTING).ok().flatten());
    v.as_deref() != Some("0")
}

fn save_restore(app: &AppHandle, value: Option<u32>) {
    let shared = app.state::<Shared>();
    let conn = shared.db.locked();
    let _ = match value {
        Some(v) => db::set_setting(&conn, RESTORE, &v.to_string()),
        None => conn.execute("DELETE FROM settings WHERE key = ?1", [RESTORE]).map(|_| ()),
    };
}

fn saved_restore(app: &AppHandle) -> Option<u32> {
    let shared = app.state::<Shared>();
    let v = Some(shared.db.locked()).and_then(|c| db::get_setting(&c, RESTORE).ok().flatten());
    v.and_then(|s| s.parse().ok())
}

/// Seal started (or resumed): alarms only, remembering what was there. Seal ended: put it back.
/// Runs off the caller's thread; the WNF calls are quick, but the database lock may not be.
fn quiet_enabled(app: &AppHandle) -> bool {
    let shared = app.state::<Shared>();
    let v = Some(shared.db.locked()).and_then(|c| db::get_setting(&c, QUIET_SETTING).ok().flatten());
    v.as_deref() == Some("1")
}

/// Quiet hours started or ended (outside a seal): Do not disturb follows, if you asked.
pub fn on_quiet(app: &AppHandle, quiet: bool) {
    if app.state::<Shared>().sealed() || !quiet_enabled(app) {
        return;
    }
    hold(app, quiet, true);
}

pub fn on_seal(app: &AppHandle, sealed: bool) {
    hold(app, sealed, enabled(app));
}

/// Requests to change Do not disturb, applied one at a time with the last one winning
/// (2026-11-17). Each used to get a thread of its own, so a seal started and ended quickly could
/// run "off" before "on" and leave it on.
pub struct Latest {
    seq: AtomicU64,
    lock: Mutex<()>,
}

impl Latest {
    pub const fn new() -> Self {
        Latest { seq: AtomicU64::new(0), lock: Mutex::new(()) }
    }
    /// Takes a place in line, at request time.
    pub fn ticket(&self) -> u64 {
        self.seq.fetch_add(1, Ordering::SeqCst) + 1
    }
    /// Runs `f` unless a newer request came in since `ticket`. Never two at once.
    pub fn run(&self, ticket: u64, f: impl FnOnce()) -> bool {
        let _one = self.lock.locked();
        if self.seq.load(Ordering::SeqCst) != ticket {
            return false;
        }
        f();
        true
    }
}

static REQUESTS: Latest = Latest::new();

/// Turns Do not disturb on (remembering what was there) or gives the old setting back.
fn hold(app: &AppHandle, on: bool, wanted: bool) {
    let app = app.clone();
    let ticket = REQUESTS.ticket();
    std::thread::spawn(move || {
        REQUESTS.run(ticket, || apply(&app, on, wanted));
    });
}

fn apply(app: &AppHandle, on: bool, wanted: bool) {
    if !on {
        restore(app);
        return;
    }
    if !wanted {
        return;
    }
    // A resumed seal already saved the original; don't overwrite it with our own value.
    if saved_restore(app).is_none() {
        let Some(before) = read() else { return };
        if before == ALARMS_ONLY {
            return;
        }
        save_restore(app, Some(before));
    }
    write(ALARMS_ONLY);
}

/// Puts back the profile from before the seal, if Sanctum changed it (also run at startup).
pub fn restore(app: &AppHandle) {
    if let Some(before) = saved_restore(app) {
        write(before);
        save_restore(app, None);
    }
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub enabled: bool,
    /// Also during quiet hours (v0.3.1).
    pub quiet: bool,
    /// The switch can be read on this Windows.
    pub supported: bool,
    /// Sanctum has it on right now (sealed).
    pub active: bool,
}

#[tauri::command]
pub fn dnd_status(app: AppHandle) -> Status {
    let current = read();
    Status { enabled: enabled(&app), quiet: quiet_enabled(&app), supported: current.is_some(), active: current == Some(ALARMS_ONLY) && saved_restore(&app).is_some() }
}

#[tauri::command]
pub fn dnd_set_enabled(app: AppHandle, shared: State<Shared>, enabled: bool) -> Result<Status, String> {
    {
        let conn = shared.db.locked();
        db::set_setting(&conn, SETTING, if enabled { "1" } else { "0" }).map_err(|e| e.to_string())?;
    }
    // Turning it off mid-seal gives notifications back now, in line after any pending "on";
    // on, it starts with the next seal.
    if !enabled {
        REQUESTS.run(REQUESTS.ticket(), || restore(&app));
    }
    Ok(dnd_status(app))
}

#[tauri::command]
pub fn dnd_set_quiet(app: AppHandle, shared: State<Shared>, enabled: bool) -> Result<Status, String> {
    {
        let conn = shared.db.locked();
        db::set_setting(&conn, QUIET_SETTING, if enabled { "1" } else { "0" }).map_err(|e| e.to_string())?;
    }
    // Inside quiet hours now: follow the switch right away.
    let quiet_now = shared.engine.quiet_until().is_some();
    if quiet_now && !shared.sealed() {
        hold(&app, enabled, true);
    }
    Ok(dnd_status(app))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_quick_on_then_off_ends_off_whatever_order_the_threads_run() {
        let latest = Latest::new();
        let state = Mutex::new("off");
        let on = latest.ticket();
        let off = latest.ticket();
        // The "off" thread happens to run first; the stale "on" then does nothing.
        assert!(latest.run(off, || *state.lock().unwrap() = "off"));
        assert!(!latest.run(on, || *state.lock().unwrap() = "on"));
        assert_eq!(*state.lock().unwrap(), "off");
        // In order, the last still wins.
        let (a, b) = (latest.ticket(), latest.ticket());
        assert!(!latest.run(a, || *state.lock().unwrap() = "on"));
        assert!(latest.run(b, || *state.lock().unwrap() = "on"));
        assert_eq!(*state.lock().unwrap(), "on");
    }

    /// Reads the real switch; ignored by default since it touches the machine.
    #[test]
    #[ignore]
    fn reads_the_focus_assist_profile() {
        let v = read().expect("WNF readable");
        assert!(v <= 2);
    }
}
