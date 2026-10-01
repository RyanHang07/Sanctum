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

    /// Every process as (pid, lowercase exe name). A Toolhelp snapshot: cheap enough to take
    /// several times a second, unlike a full process refresh.
    pub fn process_snapshot() -> Vec<(u32, String)> {
        use windows::Win32::Foundation::CloseHandle;
        use windows::Win32::System::Diagnostics::ToolHelp::{
            CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
        };
        let mut out = Vec::new();
        unsafe {
            let Ok(snap) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else { return out };
            let mut e = PROCESSENTRY32W { dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32, ..Default::default() };
            if Process32FirstW(snap, &mut e).is_ok() {
                loop {
                    let end = e.szExeFile.iter().position(|&c| c == 0).unwrap_or(e.szExeFile.len());
                    out.push((e.th32ProcessID, String::from_utf16_lossy(&e.szExeFile[..end]).to_lowercase()));
                    if Process32NextW(snap, &mut e).is_err() {
                        break;
                    }
                }
            }
            let _ = CloseHandle(snap);
        }
        out
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
    pub fn process_snapshot() -> Vec<(u32, String)> {
        Vec::new()
    }
}

pub use imp::*;
