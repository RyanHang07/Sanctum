//! Windows Do Not Disturb while sealed (v0.1, decided 2026-09-30). Windows has no public API for
//! it, so this flips the same internal switch the Action Center uses: the WNF state
//! WNF_SHEL_QUIETHOURS_ACTIVE_PROFILE_CHANGED (0 off, 1 priority only, 2 alarms only). It can
//! stop working after a Windows update; every failure is silent and Setup shows the status.
//! The profile you had before the seal is saved, so a crash mid-seal still restores it.

use crate::{db, Shared};
use serde::Serialize;
use tauri::{AppHandle, Manager, State};

const STATE_NAME: u64 = 0x0D83_063E_A3BF_1C75;
/// Alarms only: nothing but alarms gets through while sealed.
const ALARMS_ONLY: u32 = 2;
const SETTING: &str = "dnd_on_seal";
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
    let v = shared.db.lock().ok().and_then(|c| db::get_setting(&c, SETTING).ok().flatten());
    v.as_deref() != Some("0")
}

fn save_restore(app: &AppHandle, value: Option<u32>) {
    let shared = app.state::<Shared>();
    let Ok(conn) = shared.db.lock() else { return };
    let _ = match value {
        Some(v) => db::set_setting(&conn, RESTORE, &v.to_string()),
        None => conn.execute("DELETE FROM settings WHERE key = ?1", [RESTORE]).map(|_| ()),
    };
}

fn saved_restore(app: &AppHandle) -> Option<u32> {
    let shared = app.state::<Shared>();
    let v = shared.db.lock().ok().and_then(|c| db::get_setting(&c, RESTORE).ok().flatten());
    v.and_then(|s| s.parse().ok())
}

/// Seal started (or resumed): alarms only, remembering what was there. Seal ended: put it back.
/// Runs off the caller's thread; the WNF calls are quick, but the database lock may not be.
pub fn on_seal(app: &AppHandle, sealed: bool) {
    let app = app.clone();
    std::thread::spawn(move || {
        if sealed {
            if !enabled(&app) {
                return;
            }
            // A resumed seal already saved the original; don't overwrite it with our own value.
            if saved_restore(&app).is_none() {
                let Some(before) = read() else { return };
                if before == ALARMS_ONLY {
                    return;
                }
                save_restore(&app, Some(before));
            }
            write(ALARMS_ONLY);
        } else {
            restore(&app);
        }
    });
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
    /// The switch can be read on this Windows.
    pub supported: bool,
    /// Sanctum has it on right now (sealed).
    pub active: bool,
}

#[tauri::command]
pub fn dnd_status(app: AppHandle) -> Status {
    let current = read();
    Status { enabled: enabled(&app), supported: current.is_some(), active: current == Some(ALARMS_ONLY) && saved_restore(&app).is_some() }
}

#[tauri::command]
pub fn dnd_set_enabled(app: AppHandle, shared: State<Shared>, enabled: bool) -> Result<Status, String> {
    {
        let conn = shared.db.lock().map_err(|e| e.to_string())?;
        db::set_setting(&conn, SETTING, if enabled { "1" } else { "0" }).map_err(|e| e.to_string())?;
    }
    // Turning it off mid-seal gives notifications back now; on, it starts with the next seal.
    if !enabled {
        restore(&app);
    }
    Ok(dnd_status(app))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Reads the real switch; ignored by default since it touches the machine.
    #[test]
    #[ignore]
    fn reads_the_focus_assist_profile() {
        let v = read().expect("WNF readable");
        assert!(v <= 2);
    }
}
