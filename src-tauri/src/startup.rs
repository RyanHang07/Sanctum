//! Start with Windows (v0.1.4). Two registry values decide it, the same two Windows' own
//! Settings › Apps › Startup (and Task Manager) use:
//! - `HKCU\…\Run\Sanctum`: the command to start. Written on every launch, so an update or a
//!   reinstall that moved or dropped it is repaired the next time Sanctum runs.
//! - `HKCU\…\Explorer\StartupApproved\Run\Sanctum`: Windows' on/off switch for that entry
//!   (first byte even = on, odd = off). Sanctum's switch writes it exactly like Windows does,
//!   so turning it off leaves Sanctum listed as "Disabled" in Windows rather than gone, and
//!   either switch is reflected by the other.

use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_autostart::ManagerExt;

#[cfg(windows)]
const APPROVED: &str = r"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run";

/// Windows' StartupApproved flag: missing means on; an odd first byte means turned off.
pub fn approved(flag: Option<&[u8]>) -> bool {
    flag.and_then(|b| b.first()).map_or(true, |x| x & 1 == 0)
}

/// The 12-byte value Windows writes: 02 for on, 03 for off, then (unused) zeros.
pub fn flag(on: bool) -> Vec<u8> {
    let mut v = vec![0u8; 12];
    v[0] = if on { 0x02 } else { 0x03 };
    v
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StartupStatus {
    /// Starts when you sign in to Windows.
    pub enabled: bool,
    /// The startup entry exists (always, once a release build has run).
    pub registered: bool,
}

/// The entry's name: the product name, which is what the autostart plugin writes.
fn name(app: &AppHandle) -> String {
    app.config().product_name.clone().unwrap_or_else(|| "Sanctum".into())
}

#[cfg(windows)]
fn read_flag(name: &str) -> Option<Vec<u8>> {
    use winreg::{enums::HKEY_CURRENT_USER, RegKey};
    RegKey::predef(HKEY_CURRENT_USER).open_subkey(APPROVED).ok()?.get_raw_value(name).ok().map(|v| v.bytes.into_owned())
}

#[cfg(not(windows))]
fn read_flag(_name: &str) -> Option<Vec<u8>> {
    None
}

#[cfg(windows)]
fn write_flag(name: &str, on: bool) -> Result<(), String> {
    use winreg::{enums::{RegType::REG_BINARY, HKEY_CURRENT_USER}, RegKey, RegValue};
    let (key, _) = RegKey::predef(HKEY_CURRENT_USER).create_subkey(APPROVED).map_err(|e| e.to_string())?;
    key.set_raw_value(name, &RegValue { bytes: flag(on).into(), vtype: REG_BINARY }).map_err(|e| e.to_string())
}

#[cfg(not(windows))]
fn write_flag(_name: &str, _on: bool) -> Result<(), String> {
    Ok(())
}

/// On every launch of a release build: (re)write the startup command with this exe's path.
/// Never touches the on/off switch, so a choice made in Windows or in Sanctum stands.
pub fn ensure(app: &AppHandle) {
    if cfg!(debug_assertions) {
        return; // never point Windows at a debug binary
    }
    let _ = app.autolaunch().enable();
}

pub fn status(app: &AppHandle) -> StartupStatus {
    let registered = app.autolaunch().is_enabled().unwrap_or(false);
    StartupStatus { registered, enabled: registered && approved(read_flag(&name(app)).as_deref()) }
}

#[tauri::command]
pub fn startup_status(app: AppHandle) -> StartupStatus {
    status(&app)
}

#[tauri::command]
pub fn set_startup(app: AppHandle, on: bool) -> Result<StartupStatus, String> {
    ensure(&app);
    write_flag(&name(&app), on)?;
    Ok(status(&app))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_and_writes_windows_startup_switch() {
        assert!(approved(None), "no flag: on");
        assert!(approved(Some(&flag(true))));
        assert!(!approved(Some(&flag(false))));
        // What Windows itself writes after you toggle it in Settings.
        assert!(approved(Some(&[0x06, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])));
        assert!(!approved(Some(&[0x03, 0, 0, 0, 0x40, 0x2a, 0x1c, 0x5b, 0x9f, 0x01, 0xdb, 0x01])));
        assert!(approved(Some(&[])), "empty: treat as on");
        assert_eq!(flag(true).len(), 12);
    }
}
