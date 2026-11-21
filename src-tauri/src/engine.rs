//! Runs focus sessions: starts and resumes them, enforces the seal once a second, shows the
//! intercept overlay, and finishes them (SPEC 4.0, 4.4, 6). The frontend follows along through
//! events; Rust is the source of truth for whether Sanctum is sealed.

use crate::blocker::{self, Blocker, SealSet, SystemBlocker};
use crate::session::{self, Active, HeldStats, SessionView};
use crate::{distractions, pause, profiles, quiet, tray, winutil, AppState, Shared};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Mutex, MutexGuard, PoisonError};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, State};

/// Locks a mutex even after a panic poisoned it (2026-11-17). One panicking pass must not take
/// the seal's state down with it; every write behind these locks is whole between statements.
pub(crate) trait Locked<T> {
    fn locked(&self) -> MutexGuard<'_, T>;
}

impl<T> Locked<T> for Mutex<T> {
    fn locked(&self) -> MutexGuard<'_, T> {
        self.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

/// Runs one pass of a background loop, surviving a panic in it (2026-11-17: release builds
/// unwind, so one panic used to stop ticks, completion, tamper checks, and the sweep for good).
/// The panic hook has already written the crash log; this says the loop carries on.
pub(crate) fn guarded(what: &str, pass: impl FnOnce()) -> bool {
    let ok = std::panic::catch_unwind(std::panic::AssertUnwindSafe(pass)).is_ok();
    if !ok {
        eprintln!("{what}: a pass panicked; carrying on");
    }
    ok
}

/// What a start says while a seal runs, or while another start is still underway.
const ALREADY_SEALED: &str = "A session is already running.";

pub const EV_SESSION: &str = "sanctum://session";
pub const EV_TICK: &str = "sanctum://tick";
pub const EV_HELD: &str = "sanctum://held";
pub const EV_INTERCEPT: &str = "sanctum://intercept";
pub const EV_END_EARLY: &str = "sanctum://end-early";
/// Quiet hours started, ended, paused, or changed. Payload: quiet::Status.
pub const EV_QUIET: &str = "sanctum://quiet";
/// Open the pause dialog (tray or the quiet overlay).
pub const EV_QUIET_PAUSE: &str = "sanctum://quiet-pause";
/// A break after a seal started or ended (v0.3.1). Payload: Option<BreakView>.
pub const EV_BREAK: &str = "sanctum://break";
/// Pause mode's settings changed. Payload: pause::Status.
pub const EV_PAUSE: &str = "sanctum://pause";
/// A seal ended but the database couldn't record it (2026-11-17), so Sanctum ended it anyway and
/// keeps trying to save it. Payload: SealError.
pub const EV_SEAL_ERROR: &str = "sanctum://seal-error";

/// What the window shows when a seal's end couldn't be saved.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SealError {
    pub session_id: i64,
    /// "complete" (ran to its end) or "unlock" (the ladder or the emergency unlock).
    pub what: &'static str,
    /// The database's error.
    pub message: String,
}

/// How long past its end a seal waits on a failing database write before it ends in memory
/// anyway, and how many failed ticks before that. The guard's GRACE_MS bounds the hosts block.
pub const CLOSE_GRACE_MS: i64 = 60_000;
pub const CLOSE_TRIES: u32 = 10;

/// A seal that ran out gives up on its database write and ends in memory (2026-11-17: a write
/// that kept failing, say on a full disk, held the seal on for good and said nothing).
pub(crate) fn give_up_on_close(now: i64, end: i64, failures: u32) -> bool {
    failures >= CLOSE_TRIES || now >= end + CLOSE_GRACE_MS
}

/// A session end the database hasn't taken yet: retried every few seconds until it lands.
/// A startup in between still finds the row unended; one past its end is closed by the resume.
#[derive(Clone, Debug, PartialEq)]
pub(crate) enum PendingClose {
    Ran { id: i64, idle_ms: i64, outcome: &'static str, ended_at: i64 },
    Early { id: i64, reason: String, level: i64, at: i64 },
}

impl PendingClose {
    pub(crate) fn write(&self, conn: &mut rusqlite::Connection) -> Result<(), String> {
        match self {
            PendingClose::Ran { id, idle_ms, outcome, ended_at } => session::close(conn, *id, *idle_ms, outcome, *ended_at).map_err(|e| e.to_string()),
            PendingClose::Early { id, reason, level, at } => session::end_early(conn, *id, reason, *level, *at),
        }
    }
    /// Written now, or once more right away.
    fn write_twice(&self, conn: &mut rusqlite::Connection) -> Result<(), String> {
        self.write(conn).or_else(|e| {
            eprintln!("close: {e}; trying again");
            self.write(conn)
        })
    }
}

/// A break after a seal (v0.3.1, decided 2026-10-30): the Distractions list stays blocked, like
/// quiet hours, until it ends; then "Next block?" offers the same profile. Ending it early is
/// free; it never touches streaks. Scheduled breaks beat taking them ad hoc (Biwer et al. 2023).
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BreakView {
    pub until: i64,
    pub minutes: i64,
    /// The profile and length "Next block?" offers.
    pub profile_id: Option<i64>,
    pub next_minutes: i64,
}

pub const BREAK_LENGTHS: [i64; 3] = [5, 10, 15];

const HEARTBEAT_EVERY_S: u64 = 10;

#[derive(Clone, Debug)]
struct LastApp {
    hwnd: isize,
    exe: String,
}

pub struct Engine {
    active: Mutex<Option<Active>>,
    blocker: Mutex<SystemBlocker>,
    /// Last non-sealed app in front, for "Back to <app>".
    last_app: Mutex<Option<LastApp>>,
    pub quiet: Mutex<quiet::State>,
    /// Pause mode (v0.3.1): asks before a flagged app opens, outside seals.
    pub pause: Mutex<pause::State>,
    /// A break after a seal, while it runs.
    pub brk: Mutex<Option<BreakView>>,
    /// The blocker holds the Distractions list outside a seal (quiet hours or a break).
    outside: AtomicBool,
    /// What the browsers last heard about pause mode, so its hours reach them as they turn.
    pausing_sent: AtomicBool,
    /// A start is underway (2026-11-17): a double-click, or the tray racing the button, used
    /// to pass the running check twice and leave an orphaned row that later closed as broken.
    starting: AtomicBool,
    /// Session ends the database couldn't take yet (2026-11-17), retried from the tick.
    pending_closes: Mutex<Vec<PendingClose>>,
    /// Ticks in a row that couldn't write the running seal's end.
    close_fails: AtomicU32,
    /// When each closed app last counted as an attempt this seal.
    kills: Mutex<Kills>,
}

/// How long an app that keeps coming back counts as one attempt (2026-11-17). An app that
/// respawns used to log a row and raise the overlay on every kill, several a second.
pub const ATTEMPT_EVERY_MS: i64 = 30_000;

/// Per seal, the last time each exe's kill was logged. It's still closed every time.
#[derive(Default)]
pub struct Kills {
    session: Option<i64>,
    last: HashMap<String, i64>,
}

impl Kills {
    /// True when this kill counts: the first for `exe` this seal, or ATTEMPT_EVERY_MS after the
    /// last that did.
    pub fn counts(&mut self, session: i64, exe: &str, now: i64) -> bool {
        if self.session != Some(session) {
            *self = Kills { session: Some(session), last: HashMap::new() };
        }
        match self.last.get(exe) {
            Some(at) if (0..ATTEMPT_EVERY_MS).contains(&(now - at)) => false,
            _ => {
                self.last.insert(exe.to_string(), now);
                true
            }
        }
    }
}

/// One of something at a time: holds a flag set until dropped, panics included.
pub(crate) struct Claim<'a>(&'a AtomicBool);

impl<'a> Claim<'a> {
    /// None while someone else holds it.
    pub(crate) fn take(flag: &'a AtomicBool) -> Option<Self> {
        // Lazily: an eager Claim built on a failed exchange would drop and clear the holder's flag.
        flag.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst).is_ok().then(|| Claim(flag))
    }
}

impl Drop for Claim<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

impl Engine {
    pub fn new() -> Self {
        Engine {
            active: Mutex::new(None),
            blocker: Mutex::new(SystemBlocker::new()),
            last_app: Mutex::new(None),
            quiet: Mutex::new(quiet::State::default()),
            pause: Mutex::new(pause::State::default()),
            brk: Mutex::new(None),
            outside: AtomicBool::new(false),
            pausing_sent: AtomicBool::new(false),
            starting: AtomicBool::new(false),
            pending_closes: Mutex::new(Vec::new()),
            close_fails: AtomicU32::new(0),
            kills: Mutex::new(Kills::default()),
        }
    }
    /// Retries session ends the database refused. Returns how many are still waiting.
    pub(crate) fn retry_closes(&self, conn: &mut rusqlite::Connection) -> usize {
        let mut list = self.pending_closes.locked();
        list.retain(|c| c.write(conn).is_err());
        list.len()
    }
    pub fn is_active(&self) -> bool {
        self.active.locked().is_some()
    }
    /// Claims the start: refused while a seal runs or another start holds the claim.
    pub(crate) fn begin_start(&self) -> Result<Claim<'_>, String> {
        let claim = Claim::take(&self.starting).ok_or(ALREADY_SEALED)?;
        if self.is_active() {
            return Err(ALREADY_SEALED.into());
        }
        Ok(claim)
    }
    /// The running seal's id and its monotonic clock (`Active::now`), which setting the system
    /// clock can't move. The ladder's waits read it (2026-11-17).
    pub fn session_clock(&self) -> Option<(i64, i64)> {
        self.active.locked().as_ref().map(|a| (a.id, a.now()))
    }
    /// (session id, profile id) of the running seal, for tagging activity.
    pub fn session_ids(&self) -> Option<(i64, Option<i64>)> {
        self.active.locked().as_ref().map(|a| (a.id, a.profile_id))
    }
    pub fn active_mut(&self) -> MutexGuard<'_, Option<Active>> {
        self.active.locked()
    }
    pub fn view(&self) -> Option<SessionView> {
        self.active.locked().as_ref().map(Active::view)
    }
    /// While quiet hours are blocking: when the window ends.
    pub fn quiet_until(&self) -> Option<i64> {
        let mut q = self.quiet.locked();
        if !q.on {
            return None;
        }
        q.evaluate(session::now_ms()).1
    }
    /// While a break is running: when it ends.
    pub fn break_until(&self) -> Option<i64> {
        self.brk.locked().as_ref().map(|b| b.until).filter(|u| *u > session::now_ms())
    }
    /// Outside a seal and quiet hours, with pause mode on: the browsers ask before flagged sites.
    pub fn pausing(&self) -> bool {
        !self.is_active() && self.quiet_until().is_none() && self.break_until().is_none() && self.pause.locked().on(session::now_ms())
    }
    /// For the tray: (blocking now, paused).
    pub fn quiet_menu(&self) -> (bool, bool) {
        let q = self.quiet.locked();
        (q.on, q.paused_until.is_some())
    }
}

/// Logs an attempt caught outside the engine's own sweep (the browser extension). Returns
/// the session's new attempt count.
pub fn record_external_attempt(app: &AppHandle, what: &str, kind: &str) -> Option<i64> {
    let shared = app.state::<Shared>();
    let id = shared.engine.active.locked().as_ref()?.id;
    let attempts = {
        let conn = shared.db.locked();
        session::record_attempt(&conn, id, what, kind, session::now_ms()).ok()?
    };
    let view = {
        let mut guard = shared.engine.active.locked();
        let active = guard.as_mut().filter(|a| a.id == id)?;
        active.attempts = attempts;
        active.view()
    };
    let _ = app.emit(EV_TICK, view);
    Some(attempts)
}

/// What the intercept window shows.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Intercept {
    /// "app" / "allowlist": the sealed-app overlay. "title": the corner nudge.
    pub kind: &'static str,
    pub label: String,
    pub attempts: i64,
    pub profile_name: String,
    pub elapsed_ms: i64,
    pub remaining_ms: i64,
    pub back_to: Option<String>,
    pub keyword: Option<String>,
    /// "welcome": the window title you were on when idle began.
    pub title: Option<String>,
    /// "welcome": how long you were idle, and the seal's new end.
    pub idle_ms: Option<i64>,
    pub ends_at: Option<i64>,
    /// The seal's if-then plan (v0.3.1), shown on every catch: "If I'm tempted, I'll …".
    pub plan: Option<String>,
}

/// Sends the running session's view to the window now (outside the tick).
pub fn emit_view(app: &AppHandle) {
    if let Some(v) = app.state::<Shared>().engine.view() {
        let _ = app.emit(EV_TICK, v);
    }
}

fn set_sealed(app: &AppHandle, sealed: bool) {
    let shared = app.state::<Shared>();
    *shared.app_state.locked() = if sealed { AppState::Sealed } else { AppState::Open };
    crate::tamper::on_seal(app, sealed);
    crate::dnd::on_seal(app, sealed);
    crate::focus::on_seal(app, sealed);
    let _ = tray::refresh(app, sealed);
    crate::browser::push_rules(app);
}

/// Friendly name for an exe from the app scan (when it has run), else the exe stem.
fn app_name(shared: &Shared, exe: &str) -> String {
    if let Some(a) = shared.apps.locked().as_ref().and_then(|list| list.iter().find(|a| a.exe == exe).cloned()) {
        return a.name;
    }
    let stem = exe.trim_end_matches(".exe");
    let mut c = stem.chars();
    c.next().map(|f| f.to_uppercase().collect::<String>() + c.as_str()).unwrap_or_default()
}

/// The Distractions list, minus what this profile opens.
fn seal_set(shared: &Shared, profile: Option<&profiles::Profile>) -> SealSet {
    let flags = distractions::list(&shared.db.locked()).unwrap_or_default();
    SealSet::new(&flags, profile)
}

/// A flag added mid-seal takes effect right away: apps close, the extension hears.
pub fn refresh_seal(app: &AppHandle) {
    let shared = app.state::<Shared>();
    let Some(profile_id) = shared.engine.session_ids().map(|s| s.1) else { return };
    let profile = profile_id.and_then(|id| load_profile(&shared, id).ok());
    let seal = seal_set(&shared, profile.as_ref());
    if let Some(a) = shared.engine.active.locked().as_mut() {
        a.sealed_count = seal.enforced_count() as i64;
    }
    shared.engine.blocker.locked().set_rules(seal);
    crate::browser::push_rules(app);
}

fn load_profile(shared: &Shared, id: i64) -> Result<profiles::Profile, String> {
    let conn = shared.db.locked();
    profiles::get(&conn, id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_session(shared: State<Shared>) -> Option<SessionView> {
    shared.engine.active.locked().as_ref().map(Active::view)
}

#[tauri::command]
pub fn preview_seal(shared: State<Shared>, profile_id: i64) -> Result<Vec<String>, String> {
    let profile = load_profile(&shared, profile_id)?;
    let seal = seal_set(&shared, Some(&profile));
    let exes = shared.engine.blocker.locked().preview(&seal);
    Ok(exes.iter().map(|e| app_name(&shared, e)).collect())
}

#[tauri::command]
pub async fn start_session(
    app: AppHandle,
    profile_id: i64,
    minutes: i64,
    task: Option<session::TaskLink>,
) -> Result<SessionView, String> {
    tauri::async_runtime::spawn_blocking(move || start(&app, profile_id, minutes, task)).await.map_err(|e| e.to_string())?
}

fn start(app: &AppHandle, profile_id: i64, minutes: i64, task: Option<session::TaskLink>) -> Result<SessionView, String> {
    let shared = app.state::<Shared>();
    let engine = &shared.engine;
    // Held until the seal is stored (or this start fails): a second start meanwhile is refused.
    let _claim = engine.begin_start()?;
    if !profiles::DURATIONS.contains(&minutes) {
        return Err("Focus length must be 15 minutes to 2 hours, in 15-minute steps.".into());
    }
    let profile = load_profile(&shared, profile_id)?;
    let seal = seal_set(&shared, Some(&profile));
    let mut active = {
        let conn = shared.db.locked();
        // One transaction (2026-11-17): a failed task or plan write leaves no unended row behind.
        let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
        let mut a = session::start(&tx, profile.id, &profile.name, minutes, session::now_ms()).map_err(|e| e.to_string())?;
        // A task is optional; a malformed one is dropped rather than refusing the seal.
        if let Some(t) = task.filter(session::TaskLink::valid) {
            session::set_task(&tx, a.id, &t).map_err(|e| e.to_string())?;
            a.task = Some(session::TaskLink { title: t.title.trim().to_string(), ..t });
        }
        a.plan = crate::focus::seal_plan(&tx, a.id, a.profile_id).map_err(|e| e.to_string())?;
        // The first heartbeat carries the uptime, for the resume clock (2026-11-17).
        session::heartbeat_at(&tx, a.id, a.started_at, crate::tamper::uptime_ms()).map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
        a
    };
    active.sealed_count = seal.enforced_count() as i64;
    {
        let mut b = engine.blocker.locked();
        b.set_rules(seal);
        // First sweep closes what the focus row warned about; it isn't an attempt. Allowlist
        // mode leaves what's already running alone.
        b.block_apps();
    }
    let view = active.view();
    *engine.active.locked() = Some(active);
    if engine.brk.locked().take().is_some() {
        let _ = app.emit(EV_BREAK, None::<BreakView>);
    }
    engine.outside.store(false, Ordering::SeqCst);
    set_sealed(app, true);
    let _ = app.emit(EV_SESSION, Some(view.clone()));
    Ok(view)
}

/// Ends the running session as unlocked early: the ladder finished, or the emergency unlock
/// (SPEC 4.5). Only unlock.rs calls this; there's no command that skips the ladder.
/// `session_id` is the seal the ladder ran for (2026-11-17): a different one running now is
/// left alone. A database that won't take the end doesn't keep the seal on: it ends in memory,
/// the write is retried, and the window hears (EV_SEAL_ERROR).
pub fn end_unlocked(app: &AppHandle, session_id: i64, reason: &str, level: i64) -> Result<(), String> {
    let shared = app.state::<Shared>();
    let engine = &shared.engine;
    let mut guard = engine.active.locked();
    match guard.as_ref() {
        None => return Err("No session is running.".into()),
        Some(a) if a.id != session_id => return Err("That session already ended.".into()),
        Some(_) => {}
    }
    let close = PendingClose::Early { id: session_id, reason: reason.trim().to_string(), level, at: session::now_ms() };
    let failed = close.write_twice(&mut shared.db.locked()).err();
    if failed.is_some() {
        engine.pending_closes.locked().push(close);
    }
    *guard = None;
    drop(guard);
    engine.blocker.locked().unblock_all();
    set_sealed(app, false);
    let _ = app.emit(EV_SESSION, None::<SessionView>);
    if let Some(message) = failed {
        let _ = app.emit(EV_SEAL_ERROR, SealError { session_id, what: "unlock", message });
    }
    Ok(())
}

#[tauri::command]
pub fn focus_minutes_since(shared: State<Shared>, since: i64) -> Result<i64, String> {
    let conn = shared.db.locked();
    session::focus_minutes_since(&conn, since).map_err(|e| e.to_string())
}

/// "Back to <app>": hide the overlay and return to the last app that wasn't sealed.
#[tauri::command]
pub fn intercept_return(app: AppHandle, shared: State<Shared>) {
    hide_intercept(&app);
    if let Some(last) = shared.engine.last_app.locked().clone() {
        winutil::focus(last.hwnd);
    }
}

#[tauri::command]
pub fn intercept_hide(app: AppHandle) {
    hide_intercept(&app);
}

/// "Break the seal" from the overlay: open Sanctum on the End early dialog.
#[tauri::command]
pub fn intercept_break(app: AppHandle) {
    hide_intercept(&app);
    crate::show_main_window(&app);
    let _ = app.emit(EV_END_EARLY, ());
}

/// The park card (v0.3.1): Ctrl Alt P while sealed opens it in the corner, focused for typing.
pub fn show_park(app: &AppHandle) {
    let shared = app.state::<Shared>();
    let Some(view) = shared.engine.view() else { return };
    let payload = Intercept {
        kind: "park",
        label: String::new(),
        attempts: view.attempts,
        profile_name: view.profile_name,
        elapsed_ms: view.elapsed_ms,
        remaining_ms: view.remaining_ms,
        back_to: None,
        keyword: None,
        title: None,
        idle_ms: None,
        ends_at: Some(view.ends_at),
        plan: None,
    };
    show_intercept(app, &payload);
}

fn hide_intercept(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("intercept") {
        let _ = w.hide();
    }
}

/// The intercept window's size in logical pixels, per kind. The centre cards are 420px wide in a
/// 520px window (50px each side), tall enough with a plan for the seal ruler and the card's
/// 0 12px 32px shadow, so the shadow is never clipped (redesign, Intercept.dc.html).
pub(crate) fn intercept_size(kind: &str, plan: bool) -> (f64, f64) {
    match kind {
        "title" => (380.0, if plan { 108.0 } else { 84.0 }),
        "welcome" => (400.0, 118.0),
        "park" => (400.0, 132.0),
        _ => (520.0, if plan { 360.0 } else { 330.0 }),
    }
}

fn show_intercept(app: &AppHandle, payload: &Intercept) {
    let Some(w) = app.get_webview_window("intercept") else { return };
    let Ok(Some(monitor)) = w.primary_monitor() else { return };
    let scale = monitor.scale_factor();
    let area = monitor.work_area();
    let px = |v: f64| (v * scale).round() as i32;
    let corner = matches!(payload.kind, "title" | "welcome" | "park");
    let (lw, lh) = intercept_size(payload.kind, payload.plan.is_some());
    let (width, height) = (px(lw), px(lh));
    let (x, y) = if corner {
        // Corner nudge, bottom-right above the taskbar.
        (area.position.x + area.size.width as i32 - width - px(16.0), area.position.y + area.size.height as i32 - height - px(16.0))
    } else {
        (area.position.x + (area.size.width as i32 - width) / 2, area.position.y + (area.size.height as i32 - height) / 2)
    };
    let _ = w.set_size(PhysicalSize::new(width as u32, height as u32));
    let _ = w.set_position(PhysicalPosition::new(x, y));
    let _ = app.emit(EV_INTERCEPT, payload.clone());
    let _ = w.show();
    let _ = w.set_always_on_top(true);
    // The park card takes the keyboard so you can type; the other corner cards never steal it.
    if !corner || payload.kind == "park" {
        let _ = w.set_focus();
    }
}

/// Picks up an unfinished session after a restart or crash (SPEC 6).
pub fn resume_on_startup(app: &AppHandle) {
    let shared = app.state::<Shared>();
    // The boot clock (2026-11-17): a clock set forward while Sanctum was down can't end the seal.
    let (resumed, downtime) = session::resume_after_boot(&shared.db.locked(), session::now_ms(), crate::tamper::uptime_ms());
    // Downtime broke the seal (the PC went off, or Sanctum was closed): it's tamper, so the
    // partner hears, and the window says why once it's up.
    if let Some(d) = downtime {
        crate::cloud::notify(app, "session_broken", format!("{}: {}", d.profile_name, d.detail()));
        let app = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_secs(4));
            crate::tamper::announce(&app, d.kind, d.detail().to_string());
        });
    }
    let Some(mut active) = resumed else { return };
    let profile = active.profile_id.and_then(|id| load_profile(&shared, id).ok());
    let seal = seal_set(&shared, profile.as_ref());
    active.sealed_count = seal.enforced_count() as i64;
    shared.engine.blocker.locked().set_rules(seal);
    *shared.engine.active.locked() = Some(active);
    set_sealed(app, true);
}

pub fn spawn_loop(app: AppHandle) {
    std::thread::Builder::new()
        .name("sanctum-engine".into())
        .spawn(move || {
            let mut n: u64 = 0;
            loop {
                std::thread::sleep(Duration::from_secs(1));
                guarded("sanctum-engine", || tick(&app, n));
                n += 1;
            }
        })
        .expect("engine thread");
}

fn tick(app: &AppHandle, n: u64) {
    let shared = app.state::<Shared>();
    let engine = &shared.engine;
    // Session ends the database refused earlier: try again every few seconds.
    if n % 5 == 0 && !engine.pending_closes.locked().is_empty() {
        engine.retry_closes(&mut shared.db.locked());
    }
    // Catch up with the tracker's idle state (it also pushes changes as they happen).
    if let Some((_, id, Some(total))) = sync_idle(&shared, shared.activity.idle_since()) {
        {
            let conn = shared.db.locked();
            let _ = session::save_idle(&conn, id, total);
        }
        // Idle pushed the end later: tell the browsers, so a seal they hold while Sanctum is
        // unreachable lasts as long as the real one.
        crate::browser::push_rules(app);
    }
    let Some(remaining) = engine.active.locked().as_ref().map(Active::remaining_ms) else {
        quiet_tick(app);
        return;
    };
    // A session owns the blocker; quiet hours pick up again after it ends.
    engine.outside.store(false, Ordering::SeqCst);
    let was_quiet = std::mem::replace(&mut engine.quiet.locked().on, false);
    if was_quiet {
        quiet_changed(app);
    }
    if remaining == 0 {
        complete(app);
        return;
    }
    crate::tamper::check(app, n);

    let intercept = session_sweep(app);
    track_foreground(&shared);

    let now = session::now_ms();
    let view = {
        let mut guard = engine.active.locked();
        let Some(active) = guard.as_mut() else { return };
        if n % HEARTBEAT_EVERY_S == 0 {
            {
                let conn = shared.db.locked();
                let _ = session::heartbeat_at(&conn, active.id, now, crate::tamper::uptime_ms());
            }
        }
        active.view()
    };
    if let Some(i) = intercept {
        show_intercept(app, &i);
    }
    let _ = app.emit(EV_TICK, view);
}

// --- Quiet hours (v0.1) ---

/// Reads the schedule into the engine (startup, and after Start over).
pub fn load_quiet(app: &AppHandle) {
    let shared = app.state::<Shared>();
    let config = quiet::load(&shared.db.locked());
    *shared.engine.quiet.locked() = quiet::State { config, ..Default::default() };
}

/// Once a second with no session: starts or stops blocking with quiet hours (and their pause)
/// or a break, enforces the Distractions list like a seal while either runs, and otherwise
/// lets pause mode ask before flagged apps.
fn quiet_tick(app: &AppHandle) {
    let shared = app.state::<Shared>();
    let engine = &shared.engine;
    let now = session::now_ms();
    let (quiet_want, quiet_end, quiet_flip) = {
        let mut q = engine.quiet.locked();
        let (inside, end, paused) = q.evaluate(now);
        let want = inside && !paused;
        let flip = q.on != want;
        q.on = want;
        (want, end, flip)
    };
    let break_until = {
        let mut b = engine.brk.locked();
        let until = b.as_ref().map(|x| x.until);
        if until.is_some_and(|u| u <= now) {
            // The break is over: the window offers the next block.
            let ended = b.take();
            drop(b);
            let _ = app.emit(EV_BREAK, None::<BreakView>);
            let _ = app.emit("sanctum://break-over", ended);
            None
        } else {
            until
        }
    };
    let want = quiet_want || break_until.is_some();
    let flip = engine.outside.swap(want, Ordering::SeqCst) != want;
    if flip {
        let mut b = engine.blocker.locked();
        if want {
            b.set_rules(seal_set(&shared, None));
            // What's already open closes quietly, like the first sweep of a seal.
            b.block_apps();
        } else {
            b.unblock_all();
        }
    }
    if quiet_flip || flip {
        quiet_changed(app);
        return;
    }
    if want {
        track_foreground(&shared);
        // A break inside quiet hours shows the later end.
        let end = match (quiet_want.then_some(quiet_end).flatten(), break_until) {
            (Some(q), Some(b)) => Some(q.max(b)),
            (q, b) => q.or(b),
        };
        quiet_sweep(app, end, !quiet_want);
        return;
    }
    let pausing = engine.pausing();
    if engine.pausing_sent.swap(pausing, Ordering::SeqCst) != pausing {
        crate::browser::push_rules(app);
    }
    pause_tick(app, now);
}

/// One enforcement pass for quiet hours or a break: the Distractions list, no attempts logged.
fn quiet_sweep(app: &AppHandle, ends_at: Option<i64>, on_break: bool) {
    let shared = app.state::<Shared>();
    let engine = &shared.engine;
    let now = session::now_ms();
    let (blocked, title) = {
        let mut b = engine.blocker.locked();
        (b.block_apps(), b.check_title())
    };
    let label = if let Some(b) = blocked.iter().find(|b| b.closed) {
        Some(("quiet", app_name(&shared, &b.exe), None))
    } else {
        title.map(|t| ("title", t.title, Some(t.keyword)))
    };
    if let Some((kind, label, keyword)) = label {
        let back_to = engine.last_app.locked().as_ref().map(|l| app_name(&shared, &l.exe));
        let remaining_ms = ends_at.map_or(0, |e| (e - now).max(0));
        show_intercept(
            app,
            &Intercept {
                kind,
                label,
                attempts: 0,
                profile_name: if on_break { "Break".into() } else { "Quiet hours".into() },
                elapsed_ms: 0,
                remaining_ms,
                back_to,
                keyword,
                title: None,
                idle_ms: None,
                ends_at,
                plan: None,
            },
        );
    }
}

/// Tells the window, the tray, and the browsers.
fn quiet_changed(app: &AppHandle) {
    let shared = app.state::<Shared>();
    let status = shared.engine.quiet.locked().status();
    crate::dnd::on_quiet(app, status.on);
    let _ = app.emit(EV_QUIET, status);
    let _ = tray::refresh(app, shared.sealed());
    crate::browser::push_rules(app);
}

#[tauri::command]
pub fn quiet_status(shared: State<Shared>) -> quiet::Status {
    shared.engine.quiet.locked().status()
}

#[tauri::command]
pub fn quiet_save(app: AppHandle, shared: State<Shared>, config: quiet::Config) -> Result<quiet::Status, String> {
    // Mid-window the schedule holds; the way out is the pause, which asks why.
    if shared.engine.quiet.locked().on {
        return Err("The schedule can change after this window ends.".into());
    }
    {
        let conn = shared.db.locked();
        quiet::save(&conn, &config)?;
    }
    shared.engine.quiet.locked().config = config;
    let status = shared.engine.quiet.locked().status();
    let _ = app.emit(EV_QUIET, status.clone());
    Ok(status)
}

/// Fifteen minutes off, with a reason. No ladder, no partner, no effect on streaks.
#[tauri::command]
pub fn quiet_pause(app: AppHandle, shared: State<Shared>, reason: String) -> Result<quiet::Status, String> {
    let now = session::now_ms();
    {
        let mut q = shared.engine.quiet.locked();
        let (inside, _, paused) = q.evaluate(now);
        if !inside || paused || shared.engine.is_active() {
            return Err("Quiet hours aren't blocking right now.".into());
        }
        let conn = shared.db.locked();
        quiet::log_pause(&conn, &reason, now)?;
        q.paused_until = Some(now + quiet::PAUSE_MS);
        q.on = false;
    }
    shared.engine.blocker.locked().unblock_all();
    // A break running alongside picks the blocker back up on the next tick.
    shared.engine.outside.store(false, Ordering::SeqCst);
    quiet_changed(&app);
    Ok(shared.engine.quiet.locked().status())
}

/// Ends a pause early; blocking resumes on the next tick.
#[tauri::command]
pub fn quiet_resume(shared: State<Shared>) -> quiet::Status {
    let mut q = shared.engine.quiet.locked();
    q.paused_until = None;
    q.status()
}

// --- Pause mode (v0.3.1) ---

/// Reads pause mode's settings into the engine (startup, and after Start over).
pub fn load_pause(app: &AppHandle) {
    let shared = app.state::<Shared>();
    let config = pause::load(&shared.db.locked());
    *shared.engine.pause.locked() = pause::State { config, ..Default::default() };
}

/// Outside seals and quiet hours, with pause mode on: a flagged app coming to the front is
/// minimized behind "Still want it?" until you answer.
fn pause_tick(app: &AppHandle, now: i64) {
    let shared = app.state::<Shared>();
    let engine = &shared.engine;
    if !engine.pause.locked().on(now) {
        return;
    }
    track_foreground(&shared);
    // Left unanswered, the card turns the app back: it's closed, as "Not now" would. Before, the
    // card let go after two minutes and the app stayed open behind it.
    let expired = {
        let mut p = engine.pause.locked();
        let gone = p.pending.as_ref().is_some_and(|w| pause::unanswered(w, now));
        if gone { p.pending.take() } else { None }
    };
    if let Some(w) = expired {
        let _ = pause::log(&shared.db.locked(), &w.exe, "app", "turned_back", now);
        hide_intercept(app);
        engine.blocker.locked().close_exe(&w.exe);
        return;
    }
    let Some(fg) = winutil::foreground() else { return };
    if fg.pid == std::process::id() {
        return;
    }
    // While its card waits, the app stays behind it. Brought to the front (on another monitor,
    // say), it goes back down and the card comes forward, so it can't be used unanswered.
    let waiting = engine.pause.locked().pending.as_ref().map(|w| w.exe.clone());
    if let Some(waiting) = waiting {
        let fg_exe = engine.blocker.locked().exe_of(fg.pid);
        if fg_exe.as_deref() == Some(waiting.as_str()) {
            let pids = engine.blocker.locked().pids_of(&waiting);
            winutil::minimize_windows_of(&pids);
            if let Some(w) = app.get_webview_window("intercept") {
                let _ = w.show();
                let _ = w.set_focus();
            }
            return;
        }
    }
    let flags = distractions::list(&shared.db.locked()).unwrap_or_default();
    let exe = {
        let b = engine.blocker.locked();
        b.exe_of(fg.pid)
    };
    let Some(exe) = exe.filter(|e| flags.iter().any(|d| d.kind == "app" && d.value.eq_ignore_ascii_case(e)) && !blocker::is_protected(e)) else {
        return;
    };
    if !engine.pause.locked().should_pause(&exe, now) {
        return;
    }
    let pids = engine.blocker.locked().pids_of(&exe);
    winutil::minimize_windows_of(&pids);
    engine.pause.locked().pending = Some(pause::Pending { exe: exe.clone(), pids, at: now });
    let back_to = engine.last_app.locked().as_ref().map(|l| app_name(&shared, &l.exe));
    show_intercept(
        app,
        &Intercept {
            kind: "pause",
            label: app_name(&shared, &exe),
            attempts: 0,
            profile_name: String::new(),
            elapsed_ms: 0,
            remaining_ms: pause::WAIT_MS,
            back_to,
            keyword: None,
            title: None,
            idle_ms: None,
            ends_at: Some(now + pause::WAIT_MS),
            plan: None,
        },
    );
}

/// "Go on" (after the wait) or "Not now" on the pause card.
#[tauri::command]
pub fn pause_answer(app: AppHandle, shared: State<Shared>, go_on: bool) -> Result<(), String> {
    let now = session::now_ms();
    let pending = {
        let mut p = shared.engine.pause.locked();
        let pending = p.pending.clone().ok_or("Nothing is waiting.")?;
        if go_on && !pause::ready(&pending, now) {
            return Err("A few more seconds.".into());
        }
        p.pending = None;
        if go_on {
            p.allow(&pending.exe, now);
        }
        pending
    };
    {
        let conn = shared.db.locked();
        let _ = pause::log(&conn, &pending.exe, "app", if go_on { "went_on" } else { "turned_back" }, now);
    }
    hide_intercept(&app);
    if go_on {
        winutil::focus_process_window(&pending.pids);
    } else {
        shared.engine.blocker.locked().close_exe(&pending.exe);
        if let Some(last) = shared.engine.last_app.locked().clone() {
            winutil::focus(last.hwnd);
        }
    }
    Ok(())
}

#[tauri::command]
pub fn pause_status(shared: State<Shared>) -> pause::Status {
    pause::status(&shared.engine.pause.locked())
}

#[tauri::command]
pub fn pause_save(app: AppHandle, shared: State<Shared>, config: pause::Config) -> Result<pause::Status, String> {
    {
        let conn = shared.db.locked();
        pause::save(&conn, &config)?;
    }
    shared.engine.pause.locked().config = config;
    let status = pause::status(&shared.engine.pause.locked());
    let _ = app.emit(EV_PAUSE, status.clone());
    crate::browser::push_rules(&app);
    Ok(status)
}

/// A site the extension paused, and what you chose there.
pub fn log_site_pause(app: &AppHandle, site: &str, went_on: bool) {
    let shared = app.state::<Shared>();
    {
        let conn = shared.db.locked();
        let _ = pause::log(&conn, site, "site", if went_on { "went_on" } else { "turned_back" }, session::now_ms());
    };
}

#[tauri::command]
pub fn pause_summary(shared: State<Shared>, from: String, to: String) -> Result<pause::Summary, String> {
    let conn = shared.db.locked();
    let parse = |s: &str| chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d").map_err(|_| format!("{s} is not a date."));
    let days = crate::stats::Days::load(&conn);
    let (f, t) = (parse(&from)?, parse(&to)?);
    pause::summary(&conn, crate::stats::start_ms(&days, f), crate::stats::start_ms(&days, t + chrono::Duration::days(1))).map_err(|e| e.to_string())
}

// --- A break after a seal (v0.3.1) ---

#[tauri::command]
pub fn break_start(app: AppHandle, shared: State<Shared>, minutes: i64, profile_id: Option<i64>, next_minutes: i64) -> Result<BreakView, String> {
    if shared.engine.is_active() {
        return Err("A break comes after the seal.".into());
    }
    if !BREAK_LENGTHS.contains(&minutes) {
        return Err("A break is 5, 10, or 15 minutes.".into());
    }
    let view = BreakView { until: session::now_ms() + minutes * 60_000, minutes, profile_id, next_minutes };
    *shared.engine.brk.locked() = Some(view.clone());
    let _ = app.emit(EV_BREAK, Some(view.clone()));
    Ok(view)
}

/// Ends the break now: free, no questions.
#[tauri::command]
pub fn break_end(app: AppHandle, shared: State<Shared>) {
    if shared.engine.brk.locked().take().is_some() {
        let _ = app.emit(EV_BREAK, None::<BreakView>);
    }
}

#[tauri::command]
pub fn break_status(shared: State<Shared>) -> Option<BreakView> {
    shared.engine.brk.locked().clone().filter(|b| b.until > session::now_ms())
}

/// "Pause 15 min" on the quiet overlay: open Sanctum on the pause dialog.
#[tauri::command]
pub fn intercept_quiet_pause(app: AppHandle) {
    hide_intercept(&app);
    crate::show_main_window(&app);
    let _ = app.emit(EV_QUIET_PAUSE, ());
}

/// One enforcement pass for the running session: closes flagged apps, minimizes keyword
/// windows, logs attempts. Returns the overlay to show for the first thing caught.
fn session_sweep(app: &AppHandle) -> Option<Intercept> {
    let shared = app.state::<Shared>();
    let engine = &shared.engine;
    let (blocked, title) = {
        let mut b = engine.blocker.locked();
        let blocked = b.block_apps();
        b.block_sites();
        (blocked, b.check_title())
    };
    let now = session::now_ms();
    let mut intercept: Option<Intercept> = None;
    let record = |exe: &str, kind: &str| -> Option<i64> {
        let id = engine.active.locked().as_ref()?.id;
        let conn = shared.db.locked();
        session::record_attempt(&conn, id, exe, kind, now).ok()
    };
    let session = engine.active.locked().as_ref().map(|a| a.id);
    // What couldn't be closed (usually run as administrator) still can't be used: its windows go
    // back down every pass, and it gets the card like anything else (2026-11-20). It used to be
    // skipped, which left it open beside the seal.
    for b in &blocked {
        if !b.left.is_empty() {
            winutil::minimize_windows_of(&b.left);
        }
    }
    for b in blocked.iter().filter(|b| b.closed || !b.left.is_empty()) {
        // Closed every time; logged and shown once per ATTEMPT_EVERY_MS.
        if !session.is_some_and(|id| engine.kills.locked().counts(id, &b.exe, now)) {
            continue;
        }
        if let Some(attempts) = record(&b.exe, b.kind) {
            if intercept.is_none() {
                intercept = Some(make_intercept(&shared, b.kind, app_name(&shared, &b.exe), attempts, None));
            }
        }
    }
    if let Some(hit) = title {
        if let Some(attempts) = record(&hit.exe, "title") {
            if intercept.is_none() {
                intercept = Some(make_intercept(&shared, "title", hit.title, attempts, Some(hit.keyword)));
            }
        }
    }
    if let Some(i) = &intercept {
        if let Some(a) = engine.active.locked().as_mut() {
            a.attempts = i.attempts;
        }
    }
    intercept
}

/// How often the watcher looks for new processes.
const WATCH_EVERY: Duration = Duration::from_millis(150);

/// Instant blocking (v0.1): while anything is sealed, a process snapshot every 150 ms. A
/// flagged app that starts closes right away, usually before its window draws, instead of
/// waiting for the next one-second tick.
pub fn spawn_watch(app: AppHandle) {
    std::thread::Builder::new()
        .name("sanctum-watch".into())
        .spawn(move || {
            let mut known: std::collections::HashSet<u32> = std::collections::HashSet::new();
            loop {
                std::thread::sleep(WATCH_EVERY);
                guarded("sanctum-watch", || {
                    let shared = app.state::<Shared>();
                    let Some(watch) = shared.engine.blocker.locked().watch_list() else {
                        known.clear();
                        return;
                    };
                    let procs = winutil::process_snapshot();
                    let started = !known.is_empty() && procs.iter().any(|(pid, exe)| !known.contains(pid) && watch.contains(exe));
                    known = procs.into_iter().map(|(pid, _)| pid).collect();
                    if started {
                        sweep_now(&app);
                    }
                });
            }
        })
        .expect("watch thread");
}

/// Enforces right now, outside the tick: the session's seal, or quiet hours.
fn sweep_now(app: &AppHandle) {
    let shared = app.state::<Shared>();
    if shared.engine.is_active() {
        if let Some(i) = session_sweep(app) {
            show_intercept(app, &i);
            emit_view(app);
        }
    } else if let Some(end) = shared.engine.quiet_until() {
        quiet_sweep(app, Some(end), false);
    } else if let Some(end) = shared.engine.break_until() {
        quiet_sweep(app, Some(end), true);
    }
}

fn make_intercept(shared: &Shared, kind: &'static str, label: String, attempts: i64, keyword: Option<String>) -> Intercept {
    let (profile_name, elapsed_ms, remaining_ms, plan) = shared
        .engine
        .active
        .locked()
        .as_ref()
        .map(|a| {
            let v = a.view();
            (v.profile_name, v.elapsed_ms, v.remaining_ms, v.plan)
        })
        .unwrap_or_default();
    let back_to = shared.engine.last_app.locked().as_ref().map(|l| app_name(shared, &l.exe));
    Intercept { kind, label, attempts, profile_name, elapsed_ms, remaining_ms, back_to, keyword, title: None, idle_ms: None, ends_at: None, plan }
}

/// Follows the tracker's idle state into the running seal (idle extends it, SPEC 4.8) and
/// shows "Welcome back" when you return from a real idle stretch mid-session.
pub fn on_idle_event(app: &AppHandle, event: &crate::activity::Event, threshold_ms: i64) {
    use crate::activity::Event;
    let shared = app.state::<Shared>();
    let since = match event {
        Event::IdleStarted { since } => Some(*since),
        Event::IdleEnded { .. } => None,
    };
    let Some((view, id, saved)) = sync_idle(&shared, since) else { return };
    if let Some(total) = saved {
        let _ = session::save_idle(&shared.db.locked(), id, total);
    }
    let _ = app.emit(EV_TICK, view.clone());
    if let Event::IdleEnded { since, until } = event {
        if until - since < threshold_ms {
            return;
        }
        let before = shared.activity.tracker.locked().before_idle.clone();
        let payload = Intercept {
            kind: "welcome",
            label: before.as_ref().map(|b| app_name(&shared, &b.exe)).unwrap_or_default(),
            attempts: view.attempts,
            profile_name: view.profile_name.clone(),
            elapsed_ms: view.elapsed_ms,
            remaining_ms: view.remaining_ms,
            back_to: None,
            keyword: None,
            title: before.map(|b| b.title),
            idle_ms: Some(until - since),
            ends_at: Some(view.ends_at),
            plan: None,
        };
        show_intercept(app, &payload);
    }
}

/// Applies an idle state to the running seal. Returns its view, id, and the idle total to
/// persist when a stretch just ended.
fn sync_idle(shared: &Shared, since: Option<i64>) -> Option<(SessionView, i64, Option<i64>)> {
    let mut guard = shared.engine.active.locked();
    let active = guard.as_mut()?;
    let saved = active.set_idle(since);
    Some((active.view(), active.id, saved))
}

fn track_foreground(shared: &Shared) {
    let Some(fg) = winutil::foreground() else { return };
    if fg.pid == std::process::id() {
        return;
    }
    let b = shared.engine.blocker.locked();
    let Some(exe) = b.exe_of(fg.pid) else { return };
    if blocker::is_protected(&exe) || b.is_sealed(&exe) {
        return;
    }
    *shared.engine.last_app.locked() = Some(LastApp { hwnd: fg.hwnd, exe });
}

fn complete(app: &AppHandle) {
    let shared = app.state::<Shared>();
    let engine = &shared.engine;
    // The row ends before memory does (2026-11-17): taking the seal first and ignoring a failed
    // write showed Open while the row stayed unended. A write that fails leaves the seal running
    // and the next tick tries again, but only for so long (`give_up_on_close`): then the seal
    // ends in memory, the write is queued, and the window hears.
    let (active, failed) = {
        let mut guard = engine.active.locked();
        let Some(a) = guard.as_ref() else { return };
        let outcome = if a.broken { "broken" } else { "completed" };
        let (id, idle_ms, end) = (a.id, a.idle_ms, a.effective_end());
        let close = PendingClose::Ran { id, idle_ms, outcome, ended_at: end };
        let failed = match close.write_twice(&mut shared.db.locked()) {
            Ok(()) => None,
            Err(e) => {
                let fails = engine.close_fails.fetch_add(1, Ordering::SeqCst) + 1;
                if !give_up_on_close(a.now(), end, fails) {
                    return;
                }
                eprintln!("complete: ending seal {id} without saving it ({e}); the save is retried");
                engine.pending_closes.locked().push(close);
                Some(e)
            }
        };
        engine.close_fails.store(0, Ordering::SeqCst);
        let Some(a) = guard.take() else { return };
        (a, failed)
    };
    if let Some(message) = failed {
        let _ = app.emit(EV_SEAL_ERROR, SealError { session_id: active.id, what: "complete", message });
    }
    shared.unlock.clear();
    shared.engine.blocker.locked().unblock_all();
    set_sealed(app, false);
    if active.broken && !active.tampered {
        // The streak resets; the partner hears about it (SPEC 4.6). Tampering already told them.
        crate::cloud::notify(app, "session_broken", active.profile_name.clone());
    }
    let mut held: HeldStats = active.held();
    if active.broken {
        held.broke = session::first_break(&shared.db.locked(), active.id, active.started_at).ok().flatten();
    }
    let _ = app.emit(EV_SESSION, None::<SessionView>);
    let _ = app.emit(EV_HELD, held);
    // The compact timer shows "Held." for a beat before the held page takes over.
    let compact_visible = app.get_webview_window("compact").and_then(|w| w.is_visible().ok()).unwrap_or(false);
    if compact_visible {
        std::thread::sleep(Duration::from_millis(1600));
    }
    crate::show_main_window(app);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_app_that_keeps_respawning_counts_once_every_30_seconds() {
        let mut k = Kills::default();
        assert!(k.counts(1, "discord.exe", 0));
        // Killed again and again, several a second: no new attempt.
        for t in (150..ATTEMPT_EVERY_MS).step_by(150) {
            assert!(!k.counts(1, "discord.exe", t));
        }
        // Another app counts on its own.
        assert!(k.counts(1, "steam.exe", 1_000));
        assert!(k.counts(1, "discord.exe", ATTEMPT_EVERY_MS));
        // A new seal starts fresh.
        assert!(k.counts(2, "discord.exe", ATTEMPT_EVERY_MS + 1));
        // A clock set back doesn't silence it.
        assert!(k.counts(2, "discord.exe", 0));
    }

    #[test]
    fn only_one_start_at_a_time() {
        let engine = Engine::new();
        let first = engine.begin_start().unwrap();
        // A double-click, or the tray racing the button: refused like a running seal.
        assert_eq!(engine.begin_start().err().as_deref(), Some(ALREADY_SEALED));
        drop(first);
        // A start that failed lets the next one in.
        drop(engine.begin_start().unwrap());

        let mut conn = rusqlite::Connection::open_in_memory().unwrap();
        crate::db::prepare(&mut conn).unwrap();
        conn.execute("INSERT INTO profiles (id, name, created_at) VALUES (1, 'Deep Work', 0)", []).unwrap();
        *engine.active.locked() = Some(session::start(&conn, 1, "Deep Work", 60, 0).unwrap());
        assert_eq!(engine.begin_start().err().as_deref(), Some(ALREADY_SEALED));
    }

    #[test]
    fn concurrent_starts_make_one_session() {
        let engine = Engine::new();
        let barrier = std::sync::Barrier::new(8);
        let (won, tried) = (std::sync::atomic::AtomicUsize::new(0), std::sync::atomic::AtomicUsize::new(0));
        std::thread::scope(|s| {
            for _ in 0..8 {
                s.spawn(|| {
                    barrier.wait();
                    let claim = engine.begin_start();
                    tried.fetch_add(1, Ordering::SeqCst);
                    if claim.is_ok() {
                        won.fetch_add(1, Ordering::SeqCst);
                        // Stands in for the DB write and the store: held until everyone has tried.
                        while tried.load(Ordering::SeqCst) < 8 {
                            std::thread::yield_now();
                        }
                    }
                });
            }
        });
        assert_eq!(won.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn a_panicking_pass_does_not_stop_the_next() {
        let ran = std::sync::atomic::AtomicUsize::new(0);
        let lock = Mutex::new(0);
        for n in 0..3 {
            let ok = guarded("test", || {
                let mut held = lock.locked();
                *held += 1;
                assert!(n != 1, "tick {n} fails");
                ran.fetch_add(1, Ordering::SeqCst);
            });
            assert_eq!(ok, n != 1);
        }
        assert_eq!(ran.load(Ordering::SeqCst), 2);
        // The panic poisoned the lock while held; the next pass still got in.
        assert!(lock.is_poisoned());
        assert_eq!(*lock.locked(), 3);
    }

    #[test]
    fn a_seal_whose_end_cannot_be_saved_still_ends() {
        // Keeps trying for a while past its end...
        assert!(!give_up_on_close(1_000, 1_000, 1));
        assert!(!give_up_on_close(1_000 + CLOSE_GRACE_MS - 1, 1_000, CLOSE_TRIES - 1));
        // ...then ends in memory: a minute past the end, or after enough failed ticks.
        assert!(give_up_on_close(1_000 + CLOSE_GRACE_MS, 1_000, 1));
        assert!(give_up_on_close(1_000, 1_000, CLOSE_TRIES));
    }

    #[test]
    fn a_queued_close_lands_once_the_database_takes_it() {
        let mut conn = rusqlite::Connection::open_in_memory().unwrap();
        crate::db::prepare(&mut conn).unwrap();
        conn.execute("INSERT INTO profiles (id, name, created_at) VALUES (1, 'Deep Work', 0)", []).unwrap();
        let ran = session::start(&conn, 1, "Deep Work", 60, 0).unwrap();
        let early = session::start(&conn, 1, "Deep Work", 60, 100 * 60_000).unwrap();
        let engine = Engine::new();
        engine.pending_closes.locked().push(PendingClose::Ran { id: ran.id, idle_ms: 0, outcome: "completed", ended_at: 60 * 60_000 });
        engine.pending_closes.locked().push(PendingClose::Early { id: early.id, reason: "Family emergency at home.".into(), level: 3, at: 110 * 60_000 });
        // The disk is still refusing writes: both wait.
        conn.execute_batch("PRAGMA query_only = ON").unwrap();
        assert_eq!(engine.retry_closes(&mut conn), 2);
        conn.execute_batch("PRAGMA query_only = OFF").unwrap();
        assert_eq!(engine.retry_closes(&mut conn), 0);
        let outcome = |id: i64| -> String { conn.query_row("SELECT outcome FROM sessions WHERE id = ?1", [id], |r| r.get(0)).unwrap() };
        assert_eq!(outcome(ran.id), "completed");
        assert_eq!(outcome(early.id), "unlocked_early");
    }

    #[test]
    fn intercept_window_fits_the_card_and_its_shadow() {
        // 520x360 with a plan (was 480x320): the 420px card keeps 50px each side.
        assert_eq!(intercept_size("app", true), (520.0, 360.0));
        assert_eq!(intercept_size("allowlist", false), (520.0, 330.0));
        assert_eq!(intercept_size("quiet", false), (520.0, 330.0));
        assert_eq!(intercept_size("pause", false), (520.0, 330.0));
        // Corner cards keep their sizes.
        assert_eq!(intercept_size("title", true), (380.0, 108.0));
        assert_eq!(intercept_size("welcome", false), (400.0, 118.0));
        assert_eq!(intercept_size("park", false), (400.0, 132.0));
    }
}
