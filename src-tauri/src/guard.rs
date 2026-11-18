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
//! - when you've turned it on (v0.1, off by default), closes sealed apps you started as
//!   administrator. Sanctum itself can't close those; the guard runs as SYSTEM and can. They
//!   close without a chance to save.
//!
//! The block comes out when the seal ends, when the service stops, and on uninstall.
//!
//! v0.3 (macOS groundwork): the service, its installer, and the session launcher are Windows
//! only. Elsewhere `--guard` says Protection isn't there yet, status reads not installed, and
//! turning it on is refused; the pure parts (the hosts block, the seal's sites) are shared.

use rusqlite::{Connection, OpenFlags, OptionalExtension};
use serde::Serialize;
#[cfg(windows)]
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

/// The hosts block this tick should hold. A failed read is an Err, never "no block"
/// (2026-11-17: it used to read as no sites and took the block out mid-seal); the caller leaves
/// the hosts file as it is and tries again next tick.
pub fn seal_block(conn: &Connection, sealed: bool) -> rusqlite::Result<Option<String>> {
    if !sealed {
        return Ok(None);
    }
    Ok(block_for(&hosts_domains(conn)?))
}

/// Setting: the guard closes sealed apps running as administrator ("1") or leaves them ("0").
pub const CLOSE_ELEVATED: &str = "guard_close_elevated";

/// What the running seal closes, for the guard's own pass over elevated apps.
pub fn seal_for(conn: &Connection, session: i64) -> rusqlite::Result<crate::blocker::SealSet> {
    let flags = crate::distractions::list(conn)?;
    let profile_id: Option<i64> = conn.query_row("SELECT profile_id FROM sessions WHERE id = ?1", [session], |r| r.get(0))?;
    let profile = profile_id.and_then(|id| crate::profiles::get(conn, id).ok());
    Ok(crate::blocker::SealSet::new(&flags, profile.as_ref()))
}

pub fn close_elevated_on(conn: &Connection) -> bool {
    crate::db::get_setting(conn, CLOSE_ELEVATED).ok().flatten().as_deref() == Some("1")
}

/// How long past its planned end (plus idle) an unended session still counts as sealed. The app
/// ends sessions itself; this only covers it being slow or gone (2026-11-17).
pub const GRACE_MS: i64 = 15 * 60_000;

/// The newest session with no end, with what the guard needs to know when it should be over.
#[derive(Debug, Clone, PartialEq)]
pub struct OpenSession {
    pub id: i64,
    pub started_at: i64,
    pub planned_minutes: i64,
    /// Idle stretches already over (they move the end later, SPEC 4.8).
    pub idle_ms: i64,
    /// The idle stretch still open, if any, and the last time the app was seen. The open stretch
    /// only counts up to then, so a stale row from a crash can't stretch the seal forever.
    pub idle_since: Option<i64>,
    pub last_seen_at: Option<i64>,
}

impl OpenSession {
    /// When the guard stops treating this session as sealed (2026-11-17: an unended row used to
    /// hold the seal, the hosts block, and the relaunches forever).
    pub fn holds_until(&self) -> i64 {
        let seen = self.last_seen_at.unwrap_or(self.started_at);
        let open_idle = self.idle_since.map_or(0, |s| (seen - s.max(self.started_at)).max(0));
        self.started_at + self.planned_minutes * 60_000 + self.idle_ms.max(0) + open_idle + GRACE_MS
    }
    pub fn sealed_at(&self, now: i64) -> bool {
        now < self.holds_until()
    }
}

pub fn open_session(conn: &Connection) -> rusqlite::Result<Option<OpenSession>> {
    conn.query_row(
        "SELECT s.id, s.started_at, s.planned_minutes, s.idle_ms, s.last_seen_at,
                (SELECT MIN(started_at) FROM idle_periods i WHERE i.session_id = s.id AND i.ended_at IS NULL)
           FROM sessions s WHERE s.ended_at IS NULL ORDER BY s.started_at DESC LIMIT 1",
        [],
        |r| {
            Ok(OpenSession {
                id: r.get(0)?,
                started_at: r.get(1)?,
                planned_minutes: r.get(2)?,
                idle_ms: r.get(3)?,
                last_seen_at: r.get(4)?,
                idle_since: r.get(5)?,
            })
        },
    )
    .optional()
}

/// A seal is on: a session hasn't ended and isn't long past its end.
pub fn sealed(conn: &Connection, now: i64) -> rusqlite::Result<Option<i64>> {
    Ok(open_session(conn)?.filter(|s| s.sealed_at(now)).map(|s| s.id))
}

/// The guard's clock for one seal: wall time, but never ahead of the monotonic clock since the
/// guard first saw that seal, so setting the clock forward can't end it early (2026-11-17).
pub struct SealClock {
    session: i64,
    wall: i64,
    mono: Instant,
}

impl SealClock {
    pub fn now(clock: &mut Option<SealClock>, session: i64, wall: i64, mono: Instant) -> i64 {
        match clock {
            Some(c) if c.session == session => wall.min(c.wall + mono.saturating_duration_since(c.mono).as_millis() as i64),
            _ => {
                *clock = Some(SealClock { session, wall, mono });
                wall
            }
        }
    }
}

/// Relaunches within one seal. After this many in a row without Sanctum ever showing up running,
/// the guard stops until the next seal, so a Sanctum that can't start isn't relaunched all seal
/// long (2026-11-17). The 5-in-10-minutes Backoff (SPEC 6) still applies on top.
pub const MAX_UNSEEN_RELAUNCHES: u32 = 5;

#[derive(Default)]
pub struct Relaunches {
    session: Option<i64>,
    unseen: u32,
}

impl Relaunches {
    /// Called each sealed tick with whether Sanctum is running.
    pub fn observe(&mut self, session: i64, running: bool) {
        if self.session != Some(session) {
            *self = Relaunches { session: Some(session), unseen: 0 };
        }
        if running {
            self.unseen = 0;
        }
    }
    pub fn may_try(&self) -> bool {
        self.unseen < MAX_UNSEEN_RELAUNCHES
    }
    pub fn tried(&mut self) {
        self.unseen += 1;
    }
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

/// The hosts file with our block swapped in (or taken out). Works on bytes (2026-11-17): every
/// line outside the block is kept byte for byte, so a file that isn't UTF-8 or uses LF endings
/// comes back as it was. Our block goes at the end after one blank line, in the file's own line
/// endings; taking it out also takes that blank line, so in then out restores the original.
pub fn with_block(hosts: &[u8], block: Option<&str>) -> Vec<u8> {
    let eol: &[u8] = if hosts.windows(2).any(|w| w == b"\r\n") || !hosts.contains(&b'\n') { b"\r\n" } else { b"\n" };
    let lines: Vec<&[u8]> = hosts.split_inclusive(|&b| b == b'\n').collect();
    let mut out: Vec<u8> = Vec::with_capacity(hosts.len() + 512);
    // A BEGIN waiting for its END: the blank line taken from before it, and its lines so far.
    // One that never meets its END isn't our block (2026-11-17: everything after it used to be
    // dropped); its lines go back as they were.
    let mut open: Option<(&[u8], Vec<&[u8]>)> = None;
    let put_back = |out: &mut Vec<u8>, (blank, held): (&[u8], Vec<&[u8]>)| {
        out.extend_from_slice(blank);
        held.iter().for_each(|l| out.extend_from_slice(l));
    };
    for (i, line) in lines.iter().enumerate() {
        let t = trim(line);
        if t == BEGIN.as_bytes() {
            if let Some(orphan) = open.take() {
                put_back(&mut out, orphan);
            }
            // The blank line we put before the block.
            let blank = match i.checked_sub(1).map(|j| lines[j]).filter(|l| trim(l).is_empty() && out.ends_with(l)) {
                Some(prev) => {
                    out.truncate(out.len() - prev.len());
                    prev
                }
                None => &[],
            };
            open = Some((blank, vec![*line]));
        } else if open.is_some() {
            if t == END.as_bytes() {
                open = None;
            } else if let Some((_, held)) = open.as_mut() {
                held.push(*line);
            }
        } else {
            out.extend_from_slice(line);
        }
    }
    if let Some(orphan) = open {
        put_back(&mut out, orphan);
    }
    if let Some(b) = block {
        if !out.is_empty() && !out.ends_with(b"\n") {
            out.extend_from_slice(eol);
        }
        if !out.is_empty() {
            out.extend_from_slice(eol);
        }
        for l in b.lines() {
            out.extend_from_slice(l.as_bytes());
            out.extend_from_slice(eol);
        }
    }
    out
}

/// A line without its surrounding whitespace and line ending (`<[u8]>::trim_ascii` is newer than
/// our MSRV).
fn trim(line: &[u8]) -> &[u8] {
    let start = line.iter().position(|b| !b.is_ascii_whitespace()).unwrap_or(line.len());
    let end = line.iter().rposition(|b| !b.is_ascii_whitespace()).map_or(start, |i| i + 1);
    &line[start..end]
}

/// One pass over the hosts file: read it, swap the block, write it only if it changed. A failed
/// read writes nothing (2026-11-17: it used to read as empty and write back only our block,
/// wiping the user's entries). A missing file has nothing to lose and reads as empty.
pub fn apply_hosts(
    read: impl FnOnce() -> std::io::Result<Vec<u8>>,
    write: impl FnOnce(&[u8]) -> std::io::Result<()>,
    block: Option<&str>,
) -> std::io::Result<bool> {
    let now = match read() {
        Ok(b) => b,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Vec::new(),
        Err(e) => return Err(e),
    };
    let next = with_block(&now, block);
    if next == now {
        return Ok(false);
    }
    write(&next)?;
    Ok(true)
}

/// Writes a file whole or not at all: a temp file beside it, flushed, then moved over it.
pub fn replace_file(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let tmp = path.with_file_name(format!("{name}.sanctum-tmp"));
    let result = (|| {
        let mut f = std::fs::File::create(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
        drop(f);
        move_over(&tmp, path)
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    result
}

#[cfg(windows)]
fn move_over(from: &Path, to: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::{MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH};
    let wide = |p: &Path| p.as_os_str().encode_wide().chain(Some(0)).collect::<Vec<u16>>();
    let (f, t) = (wide(from), wide(to));
    unsafe { MoveFileExW(PCWSTR(f.as_ptr()), PCWSTR(t.as_ptr()), MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH) }
        .map_err(|e| std::io::Error::from_raw_os_error(e.code().0 & 0xFFFF))
}

#[cfg(not(windows))]
fn move_over(from: &Path, to: &Path) -> std::io::Result<()> {
    std::fs::rename(from, to)
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

/// How long the database may stay unreadable before the guard takes its block out (2026-11-17).
/// A migration this guard doesn't know, or Sanctum removed with the guard left behind, used to
/// keep a block written mid-seal in the hosts file for good.
pub const UNREADABLE_FOR: Duration = Duration::from_secs(600);
/// Ticks in a row with no database file at all before the block comes out: one tick could land
/// in the moment Start over or Restore has it moved aside.
pub const GONE_TICKS: u32 = 3;

#[derive(Default)]
pub struct Unreadable {
    since: Option<Instant>,
    gone: u32,
}

impl Unreadable {
    /// One tick that couldn't read the seal (`gone`: the file isn't there). True when the block
    /// should come out. A good read starts it over (`Unreadable::default()`).
    pub fn failed(&mut self, now: Instant, gone: bool) -> bool {
        let since = *self.since.get_or_insert(now);
        self.gone = if gone { self.gone + 1 } else { 0 };
        self.gone >= GONE_TICKS || now.saturating_duration_since(since) >= UNREADABLE_FOR
    }
}

/// What last-error.txt should get after a hosts write.
#[derive(Debug, PartialEq)]
pub enum HostsNote {
    Write(String),
    Clear,
    Nothing,
}

/// A failed hosts write goes to last-error.txt once, not every tick, and comes out once a write
/// works again (2026-11-17: failures used to vanish).
#[derive(Default)]
pub struct HostsErrors {
    last: Option<String>,
}

impl HostsErrors {
    pub fn after(&mut self, r: &std::io::Result<bool>) -> HostsNote {
        match r {
            Err(e) => {
                let text = format!("Protection couldn't update the hosts file: {e}");
                if self.last.as_ref() == Some(&text) {
                    return HostsNote::Nothing;
                }
                self.last = Some(text.clone());
                HostsNote::Write(text)
            }
            Ok(_) if self.last.take().is_some() => HostsNote::Clear,
            Ok(_) => HostsNote::Nothing,
        }
    }
}

/// The guard's version, written beside its exe at install (2026-11-17).
const VERSION_FILE: &str = "version.txt";

/// The installed guard is from another Sanctum. Its exe is a copy taken at install and nothing
/// copies it again when the app updates; one from before the version file counts as outdated.
pub fn outdated(installed: bool, guard: Option<&str>, app: &str) -> bool {
    installed && guard.map(str::trim) != Some(app)
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

#[cfg(windows)]
pub fn hosts_path() -> PathBuf {
    let root = std::env::var_os("SystemRoot").unwrap_or_else(|| "C:\\Windows".into());
    Path::new(&root).join("System32\\drivers\\etc\\hosts")
}

#[cfg(not(windows))]
pub fn hosts_path() -> PathBuf {
    PathBuf::from("/etc/hosts")
}

/// %ProgramData%\Sanctum: holds only the guard's folder.
fn data_dir() -> PathBuf {
    let data = std::env::var_os("ProgramData").unwrap_or_else(|| "C:\\ProgramData".into());
    Path::new(&data).join("Sanctum")
}

fn guard_dir() -> PathBuf {
    data_dir().join("guard")
}

/// The guard's folders (2026-11-17): SYSTEM and Administrators write, Users only read and run,
/// nothing inherited. %ProgramData% lets any user create files, so an inherited ACL let a
/// standard user plant a DLL or a pre-made sanctum-guard.exe that then ran as SYSTEM.
pub const GUARD_SDDL: &str = "D:P(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)(A;OICI;0x1200a9;;;BU)";

/// Creates one folder with this security descriptor. Fails if anything is already there, so a
/// folder someone made first (with their own ACL) is never reused.
#[cfg(windows)]
pub fn create_secured_dir(path: &Path, sddl: &str) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{LocalFree, HLOCAL};
    use windows::Win32::Security::Authorization::{ConvertStringSecurityDescriptorToSecurityDescriptorW, SDDL_REVISION_1};
    use windows::Win32::Security::{PSECURITY_DESCRIPTOR, SECURITY_ATTRIBUTES};
    use windows::Win32::Storage::FileSystem::CreateDirectoryW;
    let wide_sddl: Vec<u16> = sddl.encode_utf16().chain(Some(0)).collect();
    let wide_path: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    unsafe {
        let mut sd = PSECURITY_DESCRIPTOR::default();
        ConvertStringSecurityDescriptorToSecurityDescriptorW(PCWSTR(wide_sddl.as_ptr()), SDDL_REVISION_1, &mut sd, None)
            .map_err(|e| format!("Couldn't build the guard folder's permissions: {e}"))?;
        let sa = SECURITY_ATTRIBUTES { nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32, lpSecurityDescriptor: sd.0, bInheritHandle: false.into() };
        let made = CreateDirectoryW(PCWSTR(wide_path.as_ptr()), Some(&sa));
        let _ = LocalFree(Some(HLOCAL(sd.0)));
        made.map_err(|e| format!("Couldn't make {}: {e}", path.display()))
    }
}

/// Removes a folder tree, or just the link when it's a junction or symlink (never following it).
#[cfg(windows)]
fn remove_tree(path: &Path) -> std::io::Result<()> {
    use std::os::windows::fs::MetadataExt;
    match std::fs::symlink_metadata(path) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e),
        Ok(m) if m.file_attributes() & REPARSE_POINT != 0 => std::fs::remove_dir(path).or_else(|_| std::fs::remove_file(path)),
        Ok(m) if m.is_dir() => std::fs::remove_dir_all(path),
        Ok(_) => std::fs::remove_file(path),
    }
}

#[cfg(windows)]
const REPARSE_POINT: u32 = 0x400;

/// A plain folder, not a link.
#[cfg(windows)]
fn is_real_dir(path: &Path) -> bool {
    use std::os::windows::fs::MetadataExt;
    std::fs::symlink_metadata(path).is_ok_and(|m| m.is_dir() && m.file_attributes() & REPARSE_POINT == 0)
}

/// Install's fresh start: whatever is at %ProgramData%\Sanctum goes (it holds only the guard),
/// and both folders come back with GUARD_SDDL. Run elevated, after the service has stopped.
#[cfg(windows)]
fn secure_guard_dir() -> Result<PathBuf, String> {
    let (data, dir) = (data_dir(), guard_dir());
    remove_tree(&data).map_err(|e| format!("Couldn't clear {}: {e}", data.display()))?;
    create_secured_dir(&data, GUARD_SDDL)?;
    create_secured_dir(&dir, GUARD_SDDL)?;
    Ok(dir)
}

/// System32's own copy of a tool: the guard runs as SYSTEM, so never a bare name the search
/// path resolves (2026-11-17).
#[cfg(windows)]
fn system_exe(name: &str) -> PathBuf {
    use windows::Win32::System::SystemInformation::GetSystemDirectoryW;
    let mut buf = [0u16; 260];
    let n = unsafe { GetSystemDirectoryW(Some(&mut buf)) } as usize;
    let dir = if n > 0 && n < buf.len() { PathBuf::from(String::from_utf16_lossy(&buf[..n])) } else { PathBuf::from("C:\\Windows\\System32") };
    dir.join(name)
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
    Some(run_action(&a))
}

#[cfg(not(windows))]
fn run_action(_a: &Args) -> u32 {
    eprintln!("guard: Protection isn't on this platform yet.");
    EXIT_FAILED
}

#[cfg(windows)]
fn run_action(a: &Args) -> u32 {
    match a.action.as_str() {
        "install" => report(install(a)),
        "uninstall" => match uninstall(&a.db) {
            Ok(true) => EXIT_OK,
            Ok(false) => EXIT_SEALED,
            Err(e) => report(Err(e)),
        },
        "run" => {
            if let Err(e) = service::start() {
                eprintln!("guard: {e}");
                return EXIT_FAILED;
            }
            EXIT_OK
        }
        _ => EXIT_FAILED,
    }
}

#[cfg(windows)]
fn report(r: Result<(), String>) -> u32 {
    match r {
        Ok(()) => EXIT_OK,
        Err(e) => {
            write_last_error(&e);
            EXIT_FAILED
        }
    }
}

/// Leaves the error for the app to show. Elevated, so only into the secured folders: a missing
/// one is made secured, a link is refused, and an old file is replaced rather than written
/// through (it could be a link someone planted).
#[cfg(windows)]
fn write_last_error(e: &str) {
    for d in [data_dir(), guard_dir()] {
        if !d.exists() && create_secured_dir(&d, GUARD_SDDL).is_err() {
            return;
        }
        if !is_real_dir(&d) {
            return;
        }
    }
    let path = guard_dir().join("last-error.txt");
    let _ = std::fs::remove_file(&path);
    if let Ok(mut f) = std::fs::OpenOptions::new().write(true).create_new(true).open(&path) {
        use std::io::Write;
        let _ = f.write_all(e.as_bytes());
    }
}

#[cfg(windows)]
fn open_db(path: &Path) -> rusqlite::Result<Connection> {
    // Never create or migrate: the app owns the database.
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX)?;
    conn.busy_timeout(Duration::from_secs(2))?;
    Ok(conn)
}

/// A failed read or write leaves the file as it was; the next tick tries again.
#[cfg(windows)]
fn write_hosts(block: Option<&str>) -> std::io::Result<bool> {
    let path = hosts_path();
    let changed = apply_hosts(|| std::fs::read(&path), |b| replace_file(&path, b), block)?;
    if changed {
        flush_dns();
    }
    Ok(changed)
}

#[cfg(windows)]
fn flush_dns() {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let _ = std::process::Command::new(system_exe("ipconfig.exe")).arg("/flushdns").creation_flags(CREATE_NO_WINDOW).status();
}

// --- Install and uninstall (run elevated) ---

#[cfg(windows)]
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

#[cfg(windows)]
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

#[cfg(windows)]
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
    // Deleted and made again with its own ACL (2026-11-17), then the exe goes in under a temp
    // name and is moved into place, so nothing made there beforehand survives.
    let dir = secure_guard_dir()?;
    let exe = dir.join("sanctum-guard.exe");
    let tmp = dir.join("sanctum-guard.exe.new");
    let me = std::env::current_exe().map_err(|x| x.to_string())?;
    std::fs::copy(&me, &tmp).map_err(|x| format!("Couldn't copy the guard: {x}"))?;
    move_over(&tmp, &exe).map_err(|x| format!("Couldn't put the guard in place: {x}"))?;
    std::fs::write(dir.join(VERSION_FILE), env!("CARGO_PKG_VERSION")).map_err(|x| format!("Couldn't write the guard's version: {x}"))?;
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
#[cfg(windows)]
fn uninstall(db: &Path) -> Result<bool, String> {
    use windows_service::service::ServiceAccess;
    use windows_service::service_manager::{ServiceManager, ServiceManagerAccess};
    if let Ok(conn) = open_db(db) {
        if sealed(&conn, crate::session::now_ms()).ok().flatten().is_some() {
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
    let _ = std::fs::remove_file(guard_dir().join(VERSION_FILE));
    Ok(true)
}

// --- The service itself ---

#[cfg(windows)]
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
        let mut s = State {
            sys: sysinfo::System::new(),
            backoff: Backoff::default(),
            relaunches: Relaunches::default(),
            clock: None,
            unreadable: Unreadable::default(),
            hosts_errors: HostsErrors::default(),
        };
        loop {
            tick(&a, &mut s);
            if rx.recv_timeout(TICK).is_ok() {
                break;
            }
        }
        let _ = write_hosts(None);
        set(ServiceState::Stopped, ServiceControlAccept::empty());
    }

    struct State {
        sys: sysinfo::System,
        backoff: Backoff,
        relaunches: Relaunches,
        clock: Option<SealClock>,
        unreadable: Unreadable,
        hosts_errors: HostsErrors,
    }

    impl State {
        fn write_hosts(&mut self, block: Option<&str>) {
            match self.hosts_errors.after(&write_hosts(block)) {
                HostsNote::Write(e) => write_last_error(&e),
                HostsNote::Clear => {
                    let _ = std::fs::remove_file(guard_dir().join("last-error.txt"));
                }
                HostsNote::Nothing => {}
            }
        }
    }

    /// The connection, the running seal, and the hosts block it needs; None when a read fails
    /// (missing tables, a schema this guard doesn't know, a locked file).
    fn read_seal(db: &Path, clock: &mut Option<SealClock>) -> Option<(Connection, Option<i64>, Option<String>)> {
        // Opened per tick and closed before the wait (2026-11-17): a connection held between
        // ticks kept the database files open, so Start over and Restore couldn't replace them.
        let c = open_db(db).ok()?;
        let session = open_session(&c).ok()?.and_then(|o| {
            let now = SealClock::now(clock, o.id, crate::session::now_ms(), Instant::now());
            o.sealed_at(now).then_some(o.id)
        });
        let block = seal_block(&c, session.is_some()).ok()?;
        Some((c, session, block))
    }

    fn tick(a: &Args, s: &mut State) {
        let gone = !a.db.exists();
        let Some((c, session, block)) = (!gone).then(|| read_seal(&a.db, &mut s.clock)).flatten() else {
            // Usually brief: try again next tick. Long or gone, the block comes out.
            if s.unreadable.failed(Instant::now(), gone) {
                s.write_hosts(None);
            }
            return;
        };
        s.unreadable = Unreadable::default();
        s.write_hosts(block.as_deref());
        let Some(id) = session else { return };
        if close_elevated_on(&c) {
            if let Ok(seal) = seal_for(&c, id) {
                close_elevated(&mut s.sys, &seal);
            }
        }
        drop(c);
        let running = app_running(&mut s.sys, &a.app);
        s.relaunches.observe(id, running);
        if !running && s.relaunches.may_try() && s.backoff.allow(Instant::now()) {
            // Nobody signed in (None) isn't a failed relaunch: there's no desktop to open into.
            if launch_in_session(&a.app).is_some() {
                s.relaunches.tried();
            }
        }
    }
}

/// Closes sealed apps that run elevated in the signed-in user's session. Everything else is
/// Sanctum's job; it closes those itself and shows the overlay.
#[cfg(windows)]
fn close_elevated(sys: &mut sysinfo::System, seal: &crate::blocker::SealSet) {
    use sysinfo::{ProcessRefreshKind, ProcessesToUpdate};
    use windows::Win32::System::RemoteDesktop::{ProcessIdToSessionId, WTSGetActiveConsoleSessionId};
    sys.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::nothing());
    let console = unsafe { WTSGetActiveConsoleSessionId() };
    let procs: Vec<crate::blocker::Proc> =
        sys.processes().iter().map(|(pid, p)| crate::blocker::Proc { pid: pid.as_u32(), exe: p.name().to_string_lossy().to_lowercase() }).collect();
    for p in crate::blocker::targets(&procs, seal, &std::collections::HashSet::new()) {
        let mut sid = 0u32;
        let in_console = unsafe { ProcessIdToSessionId(p.pid, &mut sid) }.is_ok() && sid == console;
        if in_console && is_elevated(p.pid) {
            if let Some(proc_) = sys.process(sysinfo::Pid::from_u32(p.pid)) {
                proc_.kill();
            }
        }
    }
}

#[cfg(not(windows))]
fn close_elevated(_sys: &mut sysinfo::System, _seal: &crate::blocker::SealSet) {}

/// The process runs with an elevated (administrator) token.
#[cfg(windows)]
pub fn is_elevated(pid: u32) -> bool {
    use windows::Win32::Foundation::{CloseHandle, HANDLE};
    use windows::Win32::Security::{GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY};
    use windows::Win32::System::Threading::{OpenProcess, OpenProcessToken, PROCESS_QUERY_LIMITED_INFORMATION};
    unsafe {
        let Ok(process) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) else { return false };
        let mut token = HANDLE::default();
        let mut elevated = false;
        if OpenProcessToken(process, TOKEN_QUERY, &mut token).is_ok() {
            let mut info = TOKEN_ELEVATION::default();
            let mut len = 0u32;
            let size = std::mem::size_of::<TOKEN_ELEVATION>() as u32;
            elevated = GetTokenInformation(token, TokenElevation, Some((&mut info as *mut TOKEN_ELEVATION).cast()), size, &mut len).is_ok()
                && info.TokenIsElevated != 0;
            let _ = CloseHandle(token);
        }
        let _ = CloseHandle(process);
        elevated
    }
}

#[cfg(not(windows))]
pub fn is_elevated(_pid: u32) -> bool {
    false
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

/// Starts Sanctum in the signed-in user's desktop session (a service runs in session 0). None
/// when nobody is signed in at the console.
#[cfg(windows)]
fn launch_in_session(app: &Path) -> Option<windows::core::Result<()>> {
    use windows::core::{PCWSTR, PWSTR};
    use windows::Win32::Foundation::{CloseHandle, HANDLE};
    use windows::Win32::System::Environment::{CreateEnvironmentBlock, DestroyEnvironmentBlock};
    use windows::Win32::System::RemoteDesktop::{WTSGetActiveConsoleSessionId, WTSQueryUserToken};
    use windows::Win32::System::Threading::{CreateProcessAsUserW, CREATE_UNICODE_ENVIRONMENT, PROCESS_INFORMATION, STARTUPINFOW};
    let wide = |s: &str| s.encode_utf16().chain(Some(0)).collect::<Vec<u16>>();
    unsafe {
        let session = WTSGetActiveConsoleSessionId();
        let mut token = HANDLE::default();
        if session == u32::MAX || WTSQueryUserToken(session, &mut token).is_err() {
            return None;
        }
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
        Some(r)
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
    /// Installed from another version of Sanctum (2026-11-17). Installing again (one admin
    /// prompt) puts this version's guard in place; Sanctum never prompts for it on its own.
    pub outdated: bool,
    /// What the guard last couldn't do (update the hosts file, or an install), if anything.
    pub last_error: Option<String>,
}

/// The guard service is installed and running.
#[cfg(not(windows))]
pub fn service_running() -> bool {
    false
}

/// The guard service is installed and running.
#[cfg(windows)]
pub fn service_running() -> bool {
    use windows_service::service::{ServiceAccess, ServiceState};
    use windows_service::service_manager::{ServiceManager, ServiceManagerAccess};
    ServiceManager::local_computer(None::<&str>, ServiceManagerAccess::CONNECT)
        .ok()
        .and_then(|m| m.open_service(SERVICE, ServiceAccess::QUERY_STATUS).ok())
        .and_then(|s| s.query_status().ok())
        .is_some_and(|s| s.current_state == ServiceState::Running)
}

/// Installed, and running (Windows only; elsewhere never).
#[cfg(windows)]
fn service_state() -> (bool, bool) {
    use windows_service::service::{ServiceAccess, ServiceState};
    use windows_service::service_manager::{ServiceManager, ServiceManagerAccess};
    let svc = ServiceManager::local_computer(None::<&str>, ServiceManagerAccess::CONNECT)
        .ok()
        .and_then(|m| m.open_service(SERVICE, ServiceAccess::QUERY_STATUS).ok());
    let running = svc.as_ref().and_then(|s| s.query_status().ok()).is_some_and(|s| s.current_state == ServiceState::Running);
    (svc.is_some(), running)
}

#[cfg(not(windows))]
fn service_state() -> (bool, bool) {
    (false, false)
}

pub fn status(conn: &Connection) -> GuardStatus {
    let (installed, running) = service_state();
    let (restarts, last_restart_at) = conn
        .query_row("SELECT COUNT(*), MAX(ts) FROM tamper_events WHERE kind = 'killed'", [], |r| Ok((r.get(0)?, r.get(1)?)))
        .unwrap_or((0, None));
    GuardStatus {
        installed,
        running,
        hosts_blocked: std::fs::read(hosts_path()).map(|h| blocked_in(&String::from_utf8_lossy(&h))).unwrap_or(0),
        restarts,
        last_restart_at,
        outdated: outdated(installed, std::fs::read_to_string(guard_dir().join(VERSION_FILE)).ok().as_deref(), env!("CARGO_PKG_VERSION")),
        last_error: last_error(),
    }
}

/// Logs that the guard had to bring Sanctum back (called at startup with RESTART_ARG).
/// The resume's boot clock applies (2026-11-17): a clock set forward before the kill can't make
/// the seal look over and the restart go unlogged.
pub fn log_restart(conn: &Connection, now: i64, uptime: u64) -> rusqlite::Result<()> {
    let (now, _) = crate::session::boot_clock(conn, now, uptime);
    let session = sealed(conn, now)?;
    conn.execute("INSERT INTO tamper_events (session_id, ts, kind) VALUES (?1, ?2, 'killed')", rusqlite::params![session, now])?;
    Ok(())
}

/// Protection isn't on this platform yet (v0.3 macOS groundwork).
#[cfg(not(windows))]
pub fn run_elevated(_action: &str, _db: &Path) -> Result<u32, String> {
    Err("Protection isn't on macOS yet.".into())
}

/// Runs this exe elevated (the one UAC prompt) and waits for it. Returns its exit code.
#[cfg(windows)]
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

    #[cfg(windows)]
    #[test]
    fn the_guard_folder_gets_its_own_protected_acl() {
        use std::os::windows::ffi::OsStrExt;
        use windows::core::{PCWSTR, PWSTR};
        use windows::Win32::Foundation::{LocalFree, HLOCAL};
        use windows::Win32::Security::Authorization::{ConvertSecurityDescriptorToStringSecurityDescriptorW, GetNamedSecurityInfoW, SDDL_REVISION_1, SE_FILE_OBJECT};
        use windows::Win32::Security::{DACL_SECURITY_INFORMATION, PSECURITY_DESCRIPTOR};
        let dir = std::env::temp_dir().join(format!("sanctum-guard-acl-{}", std::process::id()));
        let _ = remove_tree(&dir);
        // The guard's SDDL plus owner rights, so the test can clean up after itself.
        create_secured_dir(&dir, &format!("{GUARD_SDDL}(A;OICI;FA;;;OW)")).unwrap();
        // Something is already there: refused, never reused.
        assert!(create_secured_dir(&dir, GUARD_SDDL).is_err());
        let wide: Vec<u16> = dir.as_os_str().encode_wide().chain(Some(0)).collect();
        let text = unsafe {
            let mut sd = PSECURITY_DESCRIPTOR::default();
            let rc = GetNamedSecurityInfoW(PCWSTR(wide.as_ptr()), SE_FILE_OBJECT, DACL_SECURITY_INFORMATION, None, None, None, None, &mut sd);
            assert_eq!(rc.0, 0);
            let mut s = PWSTR::null();
            ConvertSecurityDescriptorToStringSecurityDescriptorW(sd, SDDL_REVISION_1, DACL_SECURITY_INFORMATION, &mut s, None).unwrap();
            let text = s.to_string().unwrap();
            let _ = LocalFree(Some(HLOCAL(s.0.cast())));
            let _ = LocalFree(Some(HLOCAL(sd.0)));
            text
        };
        remove_tree(&dir).unwrap();
        assert!(text.starts_with("D:P"), "protected, nothing inherited: {text}");
        assert!(text.contains("(A;OICI;FA;;;SY)") && text.contains("(A;OICI;FA;;;BA)"), "{text}");
        // Users: read and execute only, never write or create.
        assert!(text.contains("(A;OICI;0x1200a9;;;BU)"), "{text}");
        assert!(!text.contains(";AU)") && !text.contains(";WD)"), "{text}");
        assert!(system_exe("ipconfig.exe").is_absolute());
    }

    #[test]
    fn a_failed_read_never_takes_the_block_out() {
        let conn = fresh();
        conn.execute("INSERT INTO distractions (kind, value, created_at) VALUES ('site', 'youtube.com', 0)", []).unwrap();
        assert!(seal_block(&conn, true).unwrap().is_some_and(|b| b.contains("youtube.com")));
        assert_eq!(seal_block(&conn, false).unwrap(), None);
        // The table can't be read (locked, or an old database): an error, not an empty block.
        conn.execute("DROP TABLE distraction_allows", []).unwrap();
        assert!(seal_block(&conn, true).is_err());
    }

    #[test]
    fn the_guard_closes_elevated_apps_only_when_asked() {
        let conn = fresh();
        assert!(!close_elevated_on(&conn));
        crate::db::set_setting(&conn, CLOSE_ELEVATED, "1").unwrap();
        assert!(close_elevated_on(&conn));
        conn.execute("INSERT INTO profiles (id, name, created_at) VALUES (1, 'Deep Work', 0)", []).unwrap();
        conn.execute("INSERT INTO profile_rules (profile_id, kind, value) VALUES (1, 'launch_app', 'code.exe')", []).unwrap();
        conn.execute("INSERT INTO distractions (kind, value, created_at) VALUES ('app', 'discord.exe', 0), ('app', 'code.exe', 0)", []).unwrap();
        conn.execute("INSERT INTO sessions (id, profile_id, started_at, planned_minutes) VALUES (5, 1, 0, 60)", []).unwrap();
        let seal = seal_for(&conn, 5).unwrap();
        assert!(seal.apps.contains("discord.exe"));
        // What the profile opens is never closed, elevated or not.
        assert!(seal.opens.contains("code.exe"));
        // This test process isn't elevated in CI or a normal shell.
        let _ = is_elevated(std::process::id());
    }

    #[test]
    fn seal_follows_open_sessions() {
        let conn = fresh();
        assert_eq!(sealed(&conn, 5).unwrap(), None);
        conn.execute("INSERT INTO sessions (started_at, planned_minutes) VALUES (1, 60)", []).unwrap();
        let id = conn.last_insert_rowid();
        assert_eq!(sealed(&conn, 5).unwrap(), Some(id));
        log_restart(&conn, 5, 0).unwrap();
        conn.execute("UPDATE sessions SET ended_at = 2, outcome = 'completed'", []).unwrap();
        assert_eq!(sealed(&conn, 5).unwrap(), None);
        let (n, s): (i64, Option<i64>) = conn.query_row("SELECT COUNT(*), MAX(session_id) FROM tamper_events", [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
        assert_eq!((n, s), (1, Some(id)));
    }

    #[test]
    fn a_restart_after_the_clock_jumped_is_still_logged_against_the_seal() {
        let conn = fresh();
        conn.execute("INSERT INTO sessions (started_at, planned_minutes, last_seen_at, last_seen_uptime) VALUES (0, 60, 600000, 1800000)", []).unwrap();
        let id = conn.last_insert_rowid();
        // The clock says a day later; uptime says 20 seconds passed.
        log_restart(&conn, 24 * 3_600_000, 1_820_000).unwrap();
        let s: Option<i64> = conn.query_row("SELECT session_id FROM tamper_events", [], |r| r.get(0)).unwrap();
        assert_eq!(s, Some(id));
    }

    const MIN: i64 = 60_000;

    #[test]
    fn an_unended_session_stops_sealing_after_its_end_plus_idle_and_grace() {
        let conn = fresh();
        conn.execute("INSERT INTO sessions (id, started_at, planned_minutes, idle_ms, last_seen_at) VALUES (7, 0, 60, ?1, ?2)", [5 * MIN, 50 * MIN]).unwrap();
        let end = 60 * MIN + 5 * MIN + GRACE_MS;
        assert_eq!(open_session(&conn).unwrap().unwrap().holds_until(), end);
        assert_eq!(sealed(&conn, end - 1).unwrap(), Some(7));
        assert_eq!(sealed(&conn, end).unwrap(), None);
        // Days later, a crashed session no longer holds anything.
        assert_eq!(sealed(&conn, 3 * 24 * 60 * MIN).unwrap(), None);
        // An open idle stretch counts up to the last time the app was seen, not to now.
        conn.execute("INSERT INTO idle_periods (started_at, session_id) VALUES (?1, 7)", [40 * MIN]).unwrap();
        let s = open_session(&conn).unwrap().unwrap();
        assert_eq!(s.holds_until(), end + 10 * MIN);
        assert!(!s.sealed_at(30 * 24 * 60 * MIN));
    }

    #[test]
    fn the_seal_clock_ignores_the_wall_clock_jumping_forward() {
        let t0 = Instant::now();
        let mut clock = None;
        assert_eq!(SealClock::now(&mut clock, 1, 1_000, t0), 1_000);
        // A day forward on the wall clock, 3 s on the monotonic one.
        assert_eq!(SealClock::now(&mut clock, 1, 1_000 + 24 * 60 * MIN, t0 + Duration::from_secs(3)), 4_000);
        // Back is taken as is: it only holds the seal longer.
        assert_eq!(SealClock::now(&mut clock, 1, 500, t0 + Duration::from_secs(6)), 500);
        // A new seal starts a new anchor.
        assert_eq!(SealClock::now(&mut clock, 2, 9_000, t0 + Duration::from_secs(9)), 9_000);
    }

    #[test]
    fn relaunches_stop_after_five_that_never_show_up_until_the_next_seal() {
        let mut r = Relaunches::default();
        for _ in 0..MAX_UNSEEN_RELAUNCHES {
            r.observe(1, false);
            assert!(r.may_try());
            r.tried();
        }
        r.observe(1, false);
        assert!(!r.may_try());
        // Seen running once: the count starts over.
        r.observe(1, true);
        assert!(r.may_try());
        for _ in 0..MAX_UNSEEN_RELAUNCHES {
            r.tried();
        }
        assert!(!r.may_try());
        r.observe(2, false);
        assert!(r.may_try(), "a new seal tries again");
    }

    const ORIGINAL: &[u8] = b"# Copyright (c) Microsoft\r\n127.0.0.1 localhost\r\n\r\n";

    #[test]
    fn block_goes_in_and_comes_out_cleanly() {
        let block = block_for(&["twitch.tv".into(), "news.ycombinator.com".into()]).unwrap();
        assert!(block.contains("0.0.0.0 www.twitch.tv") && block.contains(":: m.twitch.tv"));
        // Subdomains are blocked as given, without guessing more.
        assert!(!block.contains("www.news."));
        let sealed = with_block(ORIGINAL, Some(&block));
        let text = String::from_utf8(sealed.clone()).unwrap();
        assert!(text.starts_with("# Copyright (c) Microsoft\r\n127.0.0.1 localhost\r\n\r\n\r\n# >>> Sanctum"), "{text:?}");
        assert!(text.ends_with("# <<< Sanctum <<<\r\n"));
        assert_eq!(blocked_in(&text), 2);
        // Applying again changes nothing; removing restores the original exactly.
        assert_eq!(with_block(&sealed, Some(&block)), sealed);
        let open = with_block(&sealed, None);
        assert_eq!(open, ORIGINAL);
        assert_eq!(blocked_in(&String::from_utf8_lossy(&open)), 0);
        assert_eq!(block_for(&[]), None);
        // Nothing to take out: the bytes are untouched.
        assert_eq!(with_block(ORIGINAL, None), ORIGINAL);
    }

    #[test]
    fn the_hosts_file_keeps_its_bytes_and_line_endings() {
        let block = block_for(&["twitch.tv".into()]).unwrap();
        // Latin-1 comment (not UTF-8), LF endings, a user entry after a blank line, no final newline.
        let original: &[u8] = b"# caf\xe9\n10.0.0.2 nas\n\n192.168.1.5 printer";
        let sealed = with_block(original, Some(&block));
        assert!(sealed.starts_with(b"# caf\xe9\n10.0.0.2 nas\n\n192.168.1.5 printer\n\n# >>> Sanctum"));
        assert!(!sealed.contains(&b'\r'), "LF stays LF");
        assert_eq!(with_block(&sealed, Some(&block)), sealed);
        // Only the missing final newline is added.
        assert_eq!(with_block(&sealed, None), [original, b"\n"].concat());
        // A block written by an older Sanctum (no blank line kept) comes out leaving the rest.
        let old = b"127.0.0.1 localhost\r\n# >>> Sanctum: sealed sites (removed when the seal ends) >>>\r\n0.0.0.0 x.com\r\n# <<< Sanctum <<<\r\n::1 localhost\r\n";
        assert_eq!(with_block(old, None), b"127.0.0.1 localhost\r\n::1 localhost\r\n");
        // An empty file gets just the block.
        assert!(with_block(b"", Some(&block)).starts_with(b"# >>> Sanctum"));
    }

    #[test]
    fn an_unreadable_or_missing_database_takes_the_block_out_in_the_end() {
        let t0 = Instant::now();
        let mut u = Unreadable::default();
        // A locked file or a schema the guard doesn't know: it waits ten minutes.
        assert!(!u.failed(t0, false));
        assert!(!u.failed(t0 + UNREADABLE_FOR - Duration::from_secs(3), false));
        assert!(u.failed(t0 + UNREADABLE_FOR, false));
        // A good read starts over.
        u = Unreadable::default();
        assert!(!u.failed(t0, false));
        // The file gone (Sanctum removed): out after a few ticks, not one, since Start over moves
        // it aside for a moment.
        let mut u = Unreadable::default();
        assert!(!u.failed(t0, true));
        assert!(!u.failed(t0 + TICK, false), "back again");
        for i in 0..GONE_TICKS - 1 {
            assert!(!u.failed(t0 + TICK * (i + 2), true));
        }
        assert!(u.failed(t0 + TICK * (GONE_TICKS + 1), true));
    }

    #[test]
    fn a_failed_hosts_write_is_noted_once_and_cleared_once_it_works() {
        let mut h = HostsErrors::default();
        let denied = || Err(std::io::Error::from(std::io::ErrorKind::PermissionDenied));
        assert_eq!(h.after(&Ok(true)), HostsNote::Nothing);
        assert!(matches!(h.after(&denied()), HostsNote::Write(e) if e.starts_with("Protection couldn't update the hosts file")));
        assert_eq!(h.after(&denied()), HostsNote::Nothing, "not every tick");
        assert_eq!(h.after(&Ok(false)), HostsNote::Clear);
        assert_eq!(h.after(&Ok(false)), HostsNote::Nothing);
    }

    #[test]
    fn a_guard_from_another_version_reads_as_outdated() {
        assert!(!outdated(false, None, "0.3.3"), "not installed");
        assert!(!outdated(true, Some("0.3.3\r\n"), "0.3.3"));
        assert!(outdated(true, Some("0.3.2"), "0.3.3"));
        assert!(outdated(true, None, "0.3.3"), "installed before the version file");
    }

    #[test]
    fn a_begin_with_no_end_keeps_every_line_after_it() {
        let block = block_for(&["twitch.tv".into()]).unwrap();
        // A BEGIN left behind (an edit, a crash mid-write) with the user's entries after it.
        let original: &[u8] = b"127.0.0.1 localhost\r\n\r\n# >>> Sanctum: sealed sites (removed when the seal ends) >>>\r\n10.0.0.2 nas\r\n192.168.1.5 printer\r\n";
        assert_eq!(with_block(original, None), original, "nothing of ours to take out");
        let sealed = with_block(original, Some(&block));
        assert!(sealed.starts_with(original), "{}", String::from_utf8_lossy(&sealed));
        assert!(sealed.ends_with(b"# <<< Sanctum <<<\r\n"));
        // Every tick after keeps them, and taking the block out gives the file back.
        assert_eq!(with_block(&sealed, Some(&block)), sealed);
        assert_eq!(with_block(&sealed, None), original);
    }

    #[test]
    fn a_failed_read_never_writes() {
        let block = block_for(&["twitch.tv".into()]).unwrap();
        let locked = || Err(std::io::Error::from(std::io::ErrorKind::PermissionDenied));
        let r = apply_hosts(locked, |_| panic!("wrote after a failed read"), Some(&block));
        assert!(r.is_err());
        let r = apply_hosts(locked, |_| panic!("wrote after a failed read"), None);
        assert!(r.is_err());
        // Unchanged: no write.
        assert!(!apply_hosts(|| Ok(ORIGINAL.to_vec()), |_| panic!("wrote an unchanged file"), None).unwrap());
        // Changed: the user's entries are in what's written.
        let mut written = Vec::new();
        assert!(apply_hosts(|| Ok(ORIGINAL.to_vec()), |b| {
            written = b.to_vec();
            Ok(())
        }, Some(&block))
        .unwrap());
        assert!(written.starts_with(ORIGINAL));
    }

    #[test]
    fn replacing_a_file_swaps_it_whole() {
        let dir = std::env::temp_dir().join(format!("sanctum-guard-replace-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("hosts");
        std::fs::write(&path, b"old").unwrap();
        replace_file(&path, b"new\r\n").unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"new\r\n");
        assert!(!dir.join("hosts.sanctum-tmp").exists());
        let _ = std::fs::remove_dir_all(&dir);
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
