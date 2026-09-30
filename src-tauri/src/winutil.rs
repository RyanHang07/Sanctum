//! Small Win32 helpers for the launcher and blocker. Window handles cross threads as isize.
//! Non-Windows builds get inert stubs (SPEC 1: design for macOS, don't build it).

use std::collections::HashSet;

#[derive(Clone, Debug)]
pub struct Foreground {
    pub hwnd: isize,
    pub pid: u32,
    pub title: String,
}

#[cfg(windows)]
mod imp {
    use super::*;
    use windows::core::BOOL;
    use windows::Win32::Foundation::{HWND, LPARAM};
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetForegroundWindow, GetWindow, GetWindowTextLengthW, GetWindowTextW, GetWindowThreadProcessId,
        IsIconic, IsWindowVisible, SetForegroundWindow, ShowWindow, GW_OWNER, SW_MINIMIZE, SW_RESTORE,
    };

    fn pid_of(hwnd: HWND) -> u32 {
        let mut pid = 0u32;
        unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
        pid
    }

    /// Visible, unowned top-level windows: what a person would call "an open app".
    fn is_app_window(hwnd: HWND) -> bool {
        unsafe {
            IsWindowVisible(hwnd).as_bool()
                && !GetWindow(hwnd, GW_OWNER).is_ok_and(|h| !h.is_invalid())
                && GetWindowTextLengthW(hwnd) > 0
        }
    }

    fn app_windows() -> Vec<HWND> {
        unsafe extern "system" fn visit(hwnd: HWND, lparam: LPARAM) -> BOOL {
            let out = &mut *(lparam.0 as *mut Vec<HWND>);
            if is_app_window(hwnd) {
                out.push(hwnd);
            }
            BOOL(1)
        }
        let mut out: Vec<HWND> = Vec::new();
        unsafe {
            let _ = EnumWindows(Some(visit), LPARAM(&mut out as *mut _ as isize));
        }
        out
    }

    pub fn windowed_pids() -> HashSet<u32> {
        app_windows().into_iter().map(pid_of).collect()
    }

    pub fn foreground() -> Option<Foreground> {
        unsafe {
            let hwnd = GetForegroundWindow();
            if hwnd.is_invalid() {
                return None;
            }
            let len = GetWindowTextLengthW(hwnd);
            let mut buf = vec![0u16; len as usize + 1];
            let n = GetWindowTextW(hwnd, &mut buf);
            Some(Foreground { hwnd: hwnd.0 as isize, pid: pid_of(hwnd), title: String::from_utf16_lossy(&buf[..n as usize]) })
        }
    }

    /// Milliseconds since the last keyboard or mouse input, system-wide.
    pub fn idle_ms() -> i64 {
        use windows::Win32::System::SystemInformation::GetTickCount;
        use windows::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};
        let mut info = LASTINPUTINFO { cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32, dwTime: 0 };
        unsafe {
            if !GetLastInputInfo(&mut info).as_bool() {
                return 0;
            }
            // Both are 32-bit tick counts; wrapping_sub survives the 49.7-day rollover.
            GetTickCount().wrapping_sub(info.dwTime) as i64
        }
    }

    pub fn minimize(hwnd: isize) {
        unsafe {
            let _ = ShowWindow(HWND(hwnd as *mut _), SW_MINIMIZE);
        }
    }

    /// Minimizes every app window belonging to these processes.
    pub fn minimize_windows_of(pids: &[u32]) {
        for h in app_windows().into_iter().filter(|h| pids.contains(&pid_of(*h))) {
            unsafe {
                if !IsIconic(h).as_bool() {
                    let _ = ShowWindow(h, SW_MINIMIZE);
                }
            }
        }
    }

    pub fn focus(hwnd: isize) -> bool {
        unsafe {
            let h = HWND(hwnd as *mut _);
            if IsIconic(h).as_bool() {
                let _ = ShowWindow(h, SW_RESTORE);
            }
            SetForegroundWindow(h).as_bool()
        }
    }

    pub fn focus_process_window(pids: &[u32]) -> bool {
        app_windows().into_iter().find(|h| pids.contains(&pid_of(*h))).is_some_and(|h| focus(h.0 as isize))
    }

    /// Exe of the default https handler, so allowlist mode never seals the browser a profile opens URLs in.
    pub fn default_browser_exe() -> Option<String> {
        use winreg::enums::{HKEY_CLASSES_ROOT, HKEY_CURRENT_USER};
        use winreg::RegKey;
        let prog_id: String = RegKey::predef(HKEY_CURRENT_USER)
            .open_subkey("Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice")
            .ok()?
            .get_value("ProgId")
            .ok()?;
        let cmd: String = RegKey::predef(HKEY_CLASSES_ROOT)
            .open_subkey(format!("{prog_id}\\shell\\open\\command"))
            .ok()?
            .get_value("")
            .ok()?;
        super::exe_from_command(&cmd)
    }
}

#[cfg(not(windows))]
mod imp {
    use super::*;
    pub fn windowed_pids() -> HashSet<u32> {
        HashSet::new()
    }
    pub fn foreground() -> Option<Foreground> {
        None
    }
    pub fn idle_ms() -> i64 {
        0
    }
    pub fn minimize(_hwnd: isize) {}
    pub fn minimize_windows_of(_pids: &[u32]) {}
    pub fn focus(_hwnd: isize) -> bool {
        false
    }
    pub fn focus_process_window(_pids: &[u32]) -> bool {
        false
    }
    pub fn default_browser_exe() -> Option<String> {
        None
    }
}

pub use imp::*;

/// `"C:\Program Files\Google\Chrome\Application\chrome.exe" --single-argument %1` -> `chrome.exe`.
pub fn exe_from_command(cmd: &str) -> Option<String> {
    let cmd = cmd.trim();
    let path = match cmd.strip_prefix('"') {
        Some(rest) => rest.split('"').next()?,
        None => &cmd[..cmd.to_lowercase().find(".exe")? + 4],
    };
    let file = path.rsplit(['\\', '/']).next()?.to_lowercase();
    file.ends_with(".exe").then_some(file)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_exe_from_open_commands() {
        assert_eq!(
            exe_from_command("\"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe\" --single-argument %1").as_deref(),
            Some("chrome.exe")
        );
        assert_eq!(
            exe_from_command("C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe --single-argument %1").as_deref(),
            Some("msedge.exe")
        );
        assert_eq!(exe_from_command("rundll32 url.dll"), None);
    }
}
