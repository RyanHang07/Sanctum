//! M8: the guard (SPEC 3, 4.4, 6). A Windows service, "Sanctum Guard", installed once from
//! Setup with one admin prompt. It is a copy of sanctum.exe run with `--guard run`, kept under
//! %ProgramData% so rebuilding or updating the app never fights a locked exe.
//!
//! While a seal is on (a session row with no end), every few seconds it:
//! - writes each whole-domain flagged site into a marked block in the hosts file, so they're
//!   blocked in every browser, with or without the extension. Links and keywords stay with the
//!   extension, and so do sites with Allow pages (the hosts file can't open one page).
//! - relaunches Sanctum into your session if its process is gone. The seal resumes and the
//!   restart is logged as a tamper event; it doesn't break the seal (decided 2026-09-30).
//!
//! The block comes out when the seal ends, when the service stops, and on uninstall.

use rusqlite::{Connection, OpenFlags, OptionalExtension};
use serde::Serialize;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

pub const SERVICE: &str = "SanctumGuard";
const DISPLAY: &str = "Sanctum Guard";
const DESCRIPTION: &str = "Keeps Sanctum's focus sessions sealed: blocks flagged sites in the hosts file and reopens Sanctum if it's closed mid-seal.";
const BEGIN: &str = "# >>> Sanctum: sealed sites (removed when the seal ends) >>>";
const END: &str = "# <<< Sanctum <<<";
/// Passed to the app when the guard brings it back.
pub const RESTART_ARG: &str = "--guard-restart";
const TICK: Duration = Duration::from_secs(3);

/// Exit codes of the elevated `--guard install|uninstall` process.
pub const EXIT_OK: u32 = 0;
pub const EXIT_FAILED: u32 = 1;
pub const EXIT_SEALED: u32 = 2;

// --- Pure parts (tested) ---

/// Whole-domain site flags without Allow pages: what the hosts file can block.
pub fn hosts_domains(conn: &Connection) -> rusqlite::Result<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT value FROM distractions d WHERE kind = 'site' AND instr(value, '/') = 0
           AND NOT EXISTS (SELECT 1 FROM distraction_allows a WHERE a.distraction_id = d.id)
         ORDER BY value",
    )?;
    let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
    rows.collect()
}

/// A seal is on: some session hasn't ended.
pub fn sealed(conn: &Connection) -> rusqlite::Result<Option<i64>> {
    conn.query_row("SELECT id FROM sessions WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1", [], |r| r.get(0)).optional()
}

/// The marked block for these domains (the bare name, www., and m.).
pub fn block_for(domains: &[String]) -> Option<String> {
    if domains.is_empty() {
        return None;
    }
    let mut lines = vec![BEGIN.to_string()];
    for d in domains {
        let mut names = vec![d.clone()];
        if d.split('.').count() == 2 {
            names.push(format!("www.{d}"));
            names.push(format!("m.{d}"));
        }
        for n in names {
            lines.push(format!("0.0.0.0 {n}"));
            lines.push(format!(":: {n}"));
        }
    }
    lines.push(END.to_string());
    Some(lines.join("\r\n"))
}

/// The hosts file with our block swapped in (or taken out), everything else untouched.
pub fn with_block(hosts: &str, block: Option<&str>) -> String {
    let mut kept: Vec<&str> = Vec::new();
    let mut inside = false;
    for line in hosts.lines() {
        let t = line.trim();
        if t == BEGIN {
            inside = true;
        } else if t == END && inside {
            inside = false;
        } else if !inside {
            kept.push(line);
        }
    }
    while kept.last().is_some_and(|l| l.trim().is_empty()) {
        kept.pop();
    }
    let mut out = kept.join("\r\n");
    if let Some(b) = block {
        if !out.is_empty() {
            out.push_str("\r\n\r\n");
        }
        out.push_str(b);
    }
    out.push_str("\r\n");
    out
}

/// Domains in our block, for Setup.
pub fn blocked_in(hosts: &str) -> usize {
    let mut inside = false;
    let mut n = 0;
    for line in hosts.lines().map(str::trim) {
        if line == BEGIN {
            inside = true;
        } else if line == END {
            inside = false;
        } else if inside && line.starts_with("0.0.0.0 ") && !line.contains(" www.") && !line.contains(" m.") {
            n += 1;
        }
    }
    n
}

/// Relaunches allowed: no more than 5 in 10 minutes, at least 10 s apart, so a Sanctum that
/// can't start doesn't loop forever.
#[derive(Default)]
pub struct Backoff {
    recent: Vec<Instant>,
}

impl Backoff {
    pub fn allow(&mut self, now: Instant) -> bool {
        self.recent.retain(|t| now.duration_since(*t) < Duration::from_secs(600));
        if self.recent.len() >= 5 || self.recent.last().is_some_and(|t| now.duration_since(*t) < Duration::from_secs(10)) {
            return false;
        }
        self.recent.push(now);
        true
    }
}

// --- Paths ---

pub fn hosts_path() -> PathBuf {
    let root = std::env::var_os("SystemRoot").unwrap_or_else(|| "C:\\Windows".into());
    Path::new(&root).join("System32\\drivers\\etc\\hosts")
}

fn guard_dir() -> PathBuf {
    let data = std::env::var_os("ProgramData").unwrap_or_else(|| "C:\\ProgramData".into());
    Path::new(&data).join("Sanctum\\guard")
}

// --- Command line: `sanctum.exe --guard install|uninstall|run --db <path> --app <path>` ---

struct Args {
    action: String,
    db: PathBuf,
    app: PathBuf,
}

fn parse(args: &[String]) -> Option<Args> {
    let i = args.iter().position(|a| a == "--guard")?;
    let value = |flag: &str| args.iter().position(|a| a == flag).and_then(|j| args.get(j + 1)).map(PathBuf::from);
    Some(Args { action: args.get(i + 1)?.clone(), db: value("--db")?, app: value("--app")? })
}

/// Runs the guard modes. Returns the exit code, or None for a normal app launch.
pub fn cli() -> Option<u32> {
    let args: Vec<String> = std::env::args().collect();
    let a = parse(&args)?;
    Some(match a.action.as_str() {
        "install" => report(install(&a)),
        "uninstall" => match uninstall(&a.db) {
            Ok(true) => EXIT_OK,
            Ok(false) => EXIT_SEALED,
            Err(e) => report(Err(e)),
        },
        "run" => {
            if let Err(e) = service::start() {
                eprintln!("guard: {e}");
                return Some(EXIT_FAILED);
            }
            EXIT_OK
        }
        _ => EXIT_FAILED,
    })
}

fn report(r: Result<(), String>) -> u32 {
    match r {
        Ok(()) => EXIT_OK,
        Err(e) => {
            let _ = std::fs::create_dir_all(guard_dir());
            let _ = std::fs::write(guard_dir().join("last-error.txt"), &e);
            EXIT_FAILED
        }
    }
}

fn open_db(path: &Path) -> rusqlite::Result<Connection> {
    // Never create or migrate: the app owns the database.
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX)?;
    conn.busy_timeout(Duration::from_secs(2))?;
    Ok(conn)
}

fn write_hosts(block: Option<&str>) -> std::io::Result<bool> {
    let path = hosts_path();
    let now = std::fs::read_to_string(&path).unwrap_or_default();
    let next = with_block(&now, block);
    if next == now {
        return Ok(false);
    }
    std::fs::write(&path, next)?;
    flush_dns();
    Ok(true)
}

fn flush_dns() {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let _ = std::process::Command::new("ipconfig").arg("/flushdns").creation_flags(CREATE_NO_WINDOW).status();
}

// --- Install and uninstall (run elevated) ---

fn service_info(exe: PathBuf, a: &Args) -> windows_service::service::ServiceInfo {
    use windows_service::service::*;
    ServiceInfo {
        name: SERVICE.into(),
        display_name: DISPLAY.into(),
        service_type: ServiceType::OWN_PROCESS,
        start_type: ServiceStartType::AutoStart,
        error_control: ServiceErrorControl::Normal,
        executable_path: exe,
        launch_arguments: vec!["--guard".into(), "run".into(), "--db".into(), a.db.clone().into(), "--app".into(), a.app.clone().into()],
        dependencies: vec![],
        account_name: None,
        account_password: None,
    }
}

fn stop_and_wait(s: &windows_service::service::Service) {
    use windows_service::service::ServiceState;
    let _ = s.stop();
    for _ in 0..50 {
        if s.query_status().map(|x| x.current_state == ServiceState::Stopped).unwrap_or(true) {
            return;
        }
        std::thread::sleep(Duration::from_millis(200));
    }
}

fn install(a: &Args) -> Result<(), String> {
    use windows_service::service::*;
    use windows_service::service_manager::{ServiceManager, ServiceManagerAccess};
    let e = |x: windows_service::Error| x.to_string();
    let mgr = ServiceManager::local_computer(None::<&str>, ServiceManagerAccess::CONNECT | ServiceManagerAccess::CREATE_SERVICE).map_err(e)?;
    let access = ServiceAccess::QUERY_STATUS | ServiceAccess::START | ServiceAccess::STOP | ServiceAccess::CHANGE_CONFIG;
    // A running guard holds its exe open: stop it before replacing the copy.
    let existing = mgr.open_service(SERVICE, access).ok();
    if let Some(s) = &existing {
        stop_and_wait(s);
    }
    let dir = guard_dir();
    std::fs::create_dir_all(&dir).map_err(|x| x.to_string())?;
    let exe = dir.join("sanctum-guard.exe");
    let me = std::env::current_exe().map_err(|x| x.to_string())?;
    std::fs::copy(&me, &exe).map_err(|x| format!("Couldn't copy the guard: {x}"))?;
    let info = service_info(exe, a);
    let service = match existing {
        Some(s) => {
            s.change_config(&info).map_err(e)?;
            s
        }
        None => mgr.create_service(&info, access).map_err(e)?,
    };
    let _ = service.set_description(DESCRIPTION);
    // If it's killed, Windows restarts it after 2 seconds, every time.
    let restart = ServiceAction { action_type: ServiceActionType::Restart, delay: Duration::from_secs(2) };
    let _ = service.update_failure_actions(ServiceFailureActions {
        reset_period: ServiceFailureResetPeriod::After(Duration::from_secs(3600)),
        reboot_msg: None,
        command: None,
        actions: Some(vec![restart.clone(), restart.clone(), restart]),
    });
    let _ = service.set_failure_actions_on_non_crash_failures(true);
    service.start::<&str>(&[]).map_err(e)?;
    let _ = std::fs::remove_file(dir.join("last-error.txt"));
    Ok(())
}

/// Removes the service and the hosts block. Refused (false) while a seal is on.
fn uninstall(db: &Path) -> Result<bool, String> {
    use windows_service::service::ServiceAccess;
    use windows_service::service_manager::{ServiceManager, ServiceManagerAccess};
    if let Ok(conn) = open_db(db) {
        if sealed(&conn).ok().flatten().is_some() {
            return Ok(false);
        }
    }
    let mgr = ServiceManager::local_computer(None::<&str>, ServiceManagerAccess::CONNECT).map_err(|x| x.to_string())?;
    if let Ok(s) = mgr.open_service(SERVICE, ServiceAccess::QUERY_STATUS | ServiceAccess::STOP | ServiceAccess::DELETE) {
        stop_and_wait(&s);
        s.delete().map_err(|x| x.to_string())?;
    }
    write_hosts(None).map_err(|x| x.to_string())?;
    let _ = std::fs::remove_file(guard_dir().join("sanctum-guard.exe"));
    Ok(true)
}

// --- The service itself ---

mod service {
    use super::*;
    use std::sync::mpsc;
    use windows_service::service::*;
    use windows_service::service_control_handler::{self, ServiceControlHandlerResult};
    use windows_service::{define_windows_service, service_dispatcher};

    define_windows_service!(ffi_main, main);

    pub fn start() -> windows_service::Result<()> {
        service_dispatcher::start(SERVICE, ffi_main)
    }

    fn main(_: Vec<OsString>) {
        let args: Vec<String> = std::env::args().collect();
        let Some(a) = parse(&args) else { return };
        let (tx, rx) = mpsc::channel();
        let handler = move |c| match c {
            ServiceControl::Stop | ServiceControl::Shutdown => {
                let _ = tx.send(());
                ServiceControlHandlerResult::NoError
            }
            ServiceControl::Interrogate => ServiceControlHandlerResult::NoError,
            _ => ServiceControlHandlerResult::NotImplemented,
        };
        let Ok(status) = service_control_handler::register(SERVICE, handler) else { return };
        let set = |state, accept| {
            let _ = status.set_service_status(ServiceStatus {
                service_type: ServiceType::OWN_PROCESS,
                current_state: state,
                controls_accepted: accept,
                exit_code: ServiceExitCode::Win32(0),
                checkpoint: 0,
                wait_hint: Duration::default(),
                process_id: None,
            });
        };
        set(ServiceState::Running, ServiceControlAccept::STOP | ServiceControlAccept::SHUTDOWN);
        let mut backoff = Backoff::default();
        let mut sys = sysinfo::System::new();
        let mut conn: Option<Connection> = None;
        loop {
            tick(&a, &mut conn, &mut sys, &mut backoff);
            if rx.recv_timeout(TICK).is_ok() {
                break;
            }
        }
        let _ = write_hosts(None);
        set(ServiceState::Stopped, ServiceControlAccept::empty());
    }

    fn tick(a: &Args, conn: &mut Option<Connection>, sys: &mut sysinfo::System, backoff: &mut Backoff) {
        if conn.is_none() {
            *conn = open_db(&a.db).ok();
        }
        let Some(c) = conn.as_ref() else { return };
        let session = match sealed(c) {
            Ok(s) => s,
            Err(_) => {
                // Missing tables (an old database) or a locked file: try again next tick.
                *conn = None;
                return;
            }
        };
        let block = if session.is_some() { hosts_domains(c).ok().and_then(|d| block_for(&d)) } else { None };
        let _ = write_hosts(block.as_deref());
        if session.is_some() && !app_running(sys, &a.app) && backoff.allow(Instant::now()) {
            let _ = launch_in_session(&a.app);
        }
    }
}

/// Sanctum's own window process (not the browser relay, not the guard).
pub fn app_running(sys: &mut sysinfo::System, app: &Path) -> bool {
    use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, UpdateKind};
    sys.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::nothing().with_exe(UpdateKind::Always).with_cmd(UpdateKind::Always));
    let want = app.to_string_lossy().to_lowercase();
    sys.processes().values().any(|p| {
        let same = p.exe().is_some_and(|e| e.to_string_lossy().to_lowercase() == want);
        let helper = p.cmd().iter().any(|a| {
            let a = a.to_string_lossy();
            a.starts_with("chrome-extension://") || a == "--guard"
        });
        same && !helper
    })
}

/// Starts Sanctum in the signed-in user's desktop session (a service runs in session 0).
fn launch_in_session(app: &Path) -> windows::core::Result<()> {
    use windows::core::{PCWSTR, PWSTR};
    use windows::Win32::Foundation::{CloseHandle, HANDLE};
    use windows::Win32::System::Environment::{CreateEnvironmentBlock, DestroyEnvironmentBlock};
    use windows::Win32::System::RemoteDesktop::{WTSGetActiveConsoleSessionId, WTSQueryUserToken};
    use windows::Win32::System::Threading::{CreateProcessAsUserW, CREATE_UNICODE_ENVIRONMENT, PROCESS_INFORMATION, STARTUPINFOW};
    let wide = |s: &str| s.encode_utf16().chain(Some(0)).collect::<Vec<u16>>();
    unsafe {
        let session = WTSGetActiveConsoleSessionId();
        if session == u32::MAX {
            return Err(windows::core::Error::from_thread());
        }
        let mut token = HANDLE::default();
        WTSQueryUserToken(session, &mut token)?;
        let mut env: *mut core::ffi::c_void = std::ptr::null_mut();
        let _ = CreateEnvironmentBlock(&mut env, Some(token), false);
        let mut desktop = wide("winsta0\\default");
        let si = STARTUPINFOW { cb: std::mem::size_of::<STARTUPINFOW>() as u32, lpDesktop: PWSTR(desktop.as_mut_ptr()), ..Default::default() };
        let mut pi = PROCESS_INFORMATION::default();
        let mut cmd = wide(&format!("\"{}\" {RESTART_ARG}", app.display()));
        let dir = wide(&app.parent().map(|p| p.display().to_string()).unwrap_or_default());
        let r = CreateProcessAsUserW(
            Some(token),
            PCWSTR::null(),
            Some(PWSTR(cmd.as_mut_ptr())),
            None,
            None,
            false,
            CREATE_UNICODE_ENVIRONMENT,
            (!env.is_null()).then_some(env as *const _),
            PCWSTR(dir.as_ptr()),
            &si,
            &mut pi,
        );
        if !env.is_null() {
            let _ = DestroyEnvironmentBlock(env);
        }
        let _ = CloseHandle(token);
        if r.is_ok() {
            let _ = CloseHandle(pi.hThread);
            let _ = CloseHandle(pi.hProcess);
        }
        r
    }
}

// --- App side: status, and install/uninstall through one UAC prompt ---

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct GuardStatus {
    pub installed: bool,
    pub running: bool,
    /// Sites in the hosts block right now.
    pub hosts_blocked: usize,
    /// Times the guard brought Sanctum back mid-seal, and the last one (ms).
    pub restarts: i64,
    pub last_restart_at: Option<i64>,
}

pub fn status(conn: &Connection) -> GuardStatus {
    use windows_service::service::{ServiceAccess, ServiceState};
    use windows_service::service_manager::{ServiceManager, ServiceManagerAccess};
    let svc = ServiceManager::local_computer(None::<&str>, ServiceManagerAccess::CONNECT)
        .ok()
        .and_then(|m| m.open_service(SERVICE, ServiceAccess::QUERY_STATUS).ok());
    let running = svc.as_ref().and_then(|s| s.query_status().ok()).is_some_and(|s| s.current_state == ServiceState::Running);
    let (restarts, last_restart_at) = conn
        .query_row("SELECT COUNT(*), MAX(ts) FROM tamper_events WHERE kind = 'killed'", [], |r| Ok((r.get(0)?, r.get(1)?)))
        .unwrap_or((0, None));
    GuardStatus {
        installed: svc.is_some(),
        running,
        hosts_blocked: std::fs::read_to_string(hosts_path()).map(|h| blocked_in(&h)).unwrap_or(0),
        restarts,
        last_restart_at,
    }
}

/// Logs that the guard had to bring Sanctum back (called at startup with RESTART_ARG).
pub fn log_restart(conn: &Connection, now: i64) -> rusqlite::Result<()> {
    let session = sealed(conn)?;
    conn.execute("INSERT INTO tamper_events (session_id, ts, kind) VALUES (?1, ?2, 'killed')", rusqlite::params![session, now])?;
    Ok(())
}

/// Runs this exe elevated (the one UAC prompt) and waits for it. Returns its exit code.
pub fn run_elevated(action: &str, db: &Path) -> Result<u32, String> {
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Threading::{GetExitCodeProcess, WaitForSingleObject, INFINITE};
    use windows::Win32::UI::Shell::{ShellExecuteExW, SEE_MASK_NOASYNC, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW};
    use windows::Win32::UI::WindowsAndMessaging::SW_HIDE;
    let me = std::env::current_exe().map_err(|e| e.to_string())?;
    let wide = |s: &str| s.encode_utf16().chain(Some(0)).collect::<Vec<u16>>();
    let verb = wide("runas");
    let file = wide(&me.display().to_string());
    let params = wide(&format!("--guard {action} --db \"{}\" --app \"{}\"", db.display(), me.display()));
    let mut info = SHELLEXECUTEINFOW {
        cbSize: std::mem::size_of::<SHELLEXECUTEINFOW>() as u32,
        fMask: SEE_MASK_NOCLOSEPROCESS | SEE_MASK_NOASYNC,
        lpVerb: PCWSTR(verb.as_ptr()),
        lpFile: PCWSTR(file.as_ptr()),
        lpParameters: PCWSTR(params.as_ptr()),
        nShow: SW_HIDE.0,
        ..Default::default()
    };
    unsafe {
        if ShellExecuteExW(&mut info).is_err() {
            return Err("Windows didn't allow it. Protection needs one admin approval.".into());
        }
        if info.hProcess.is_invalid() {
            return Err("The installer didn't start.".into());
        }
        WaitForSingleObject(info.hProcess, INFINITE);
        let mut code = EXIT_FAILED;
        let _ = GetExitCodeProcess(info.hProcess, &mut code);
        let _ = CloseHandle(info.hProcess);
        Ok(code)
    }
}

pub fn last_error() -> Option<String> {
    std::fs::read_to_string(guard_dir().join("last-error.txt")).ok().filter(|s| !s.trim().is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fresh() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        crate::db::prepare(&mut conn).unwrap();
        conn
    }

    #[test]
    fn hosts_get_whole_domains_without_allowed_pages() {
        let conn = fresh();
        for (kind, value) in [("site", "youtube.com"), ("site", "reddit.com/r/all"), ("site", "news.ycombinator.com"), ("keyword", "shorts"), ("app", "discord.exe"), ("site", "twitch.tv")] {
            conn.execute("INSERT INTO distractions (kind, value, created_at) VALUES (?1, ?2, 0)", [kind, value]).unwrap();
        }
        let yt: i64 = conn.query_row("SELECT id FROM distractions WHERE value = 'youtube.com'", [], |r| r.get(0)).unwrap();
        conn.execute("INSERT INTO distraction_allows (distraction_id, prefix) VALUES (?1, 'youtube.com/@mitocw')", [yt]).unwrap();
        assert_eq!(hosts_domains(&conn).unwrap(), vec!["news.ycombinator.com", "twitch.tv"]);
    }

    #[test]
    fn seal_follows_open_sessions() {
        let conn = fresh();
        assert_eq!(sealed(&conn).unwrap(), None);
        conn.execute("INSERT INTO sessions (started_at, planned_minutes) VALUES (1, 60)", []).unwrap();
        let id = conn.last_insert_rowid();
        assert_eq!(sealed(&conn).unwrap(), Some(id));
        log_restart(&conn, 5).unwrap();
        conn.execute("UPDATE sessions SET ended_at = 2, outcome = 'completed'", []).unwrap();
        assert_eq!(sealed(&conn).unwrap(), None);
        let (n, s): (i64, Option<i64>) = conn.query_row("SELECT COUNT(*), MAX(session_id) FROM tamper_events", [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
        assert_eq!((n, s), (1, Some(id)));
    }

    #[test]
    fn block_goes_in_and_comes_out_cleanly() {
        let original = "# Copyright (c) Microsoft\r\n127.0.0.1 localhost\r\n\r\n";
        let block = block_for(&["twitch.tv".into(), "news.ycombinator.com".into()]).unwrap();
        assert!(block.contains("0.0.0.0 www.twitch.tv") && block.contains(":: m.twitch.tv"));
        // Subdomains are blocked as given, without guessing more.
        assert!(!block.contains("www.news."));
        let sealed = with_block(original, Some(&block));
        assert!(sealed.starts_with("# Copyright (c) Microsoft\r\n127.0.0.1 localhost\r\n\r\n# >>> Sanctum"));
        assert_eq!(blocked_in(&sealed), 2);
        // Applying again changes nothing; removing restores the original lines.
        assert_eq!(with_block(&sealed, Some(&block)), sealed);
        let open = with_block(&sealed, None);
        assert_eq!(open, "# Copyright (c) Microsoft\r\n127.0.0.1 localhost\r\n");
        assert_eq!(blocked_in(&open), 0);
        assert_eq!(block_for(&[]), None);
        // A file with only LF endings keeps its lines.
        assert_eq!(with_block("a\nb\n", None), "a\r\nb\r\n");
    }

    #[test]
    fn backoff_limits_relaunches() {
        let mut b = Backoff::default();
        let t0 = Instant::now();
        assert!(b.allow(t0));
        assert!(!b.allow(t0 + Duration::from_secs(5)));
        for i in 1..5 {
            assert!(b.allow(t0 + Duration::from_secs(11 * i)));
        }
        // Five in ten minutes: wait until the first ages out.
        assert!(!b.allow(t0 + Duration::from_secs(120)));
        assert!(b.allow(t0 + Duration::from_secs(601)));
    }

    #[test]
    fn parses_guard_arguments() {
        let args: Vec<String> = ["x.exe", "--guard", "run", "--db", "C:\\a b\\s.db", "--app", "C:\\s.exe"].iter().map(|s| s.to_string()).collect();
        let a = parse(&args).unwrap();
        assert_eq!((a.action.as_str(), a.db.to_str().unwrap(), a.app.to_str().unwrap()), ("run", "C:\\a b\\s.db", "C:\\s.exe"));
        assert!(parse(&["x.exe".to_string()]).is_none());
    }
}
