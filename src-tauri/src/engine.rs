//! Runs focus sessions: starts and resumes them, enforces the seal once a second, shows the
//! intercept overlay, and finishes them (SPEC 4.0, 4.4, 6). The frontend follows along through
//! events; Rust is the source of truth for whether Sanctum is sealed.

use crate::blocker::{self, Blocker, SealSet, SystemBlocker};
use crate::session::{self, Active, HeldStats, SessionView};
use crate::{distractions, pause, profiles, quiet, tray, winutil, AppState, Shared};
use serde::Serialize;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, State};

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
    outside: std::sync::atomic::AtomicBool,
    /// What the browsers last heard about pause mode, so its hours reach them as they turn.
    pausing_sent: std::sync::atomic::AtomicBool,
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
            outside: std::sync::atomic::AtomicBool::new(false),
            pausing_sent: std::sync::atomic::AtomicBool::new(false),
        }
    }
    pub fn is_active(&self) -> bool {
        self.active.lock().unwrap().is_some()
    }
    /// (session id, profile id) of the running seal, for tagging activity.
    pub fn session_ids(&self) -> Option<(i64, Option<i64>)> {
        self.active.lock().unwrap().as_ref().map(|a| (a.id, a.profile_id))
    }
    pub fn active_mut(&self) -> std::sync::MutexGuard<'_, Option<Active>> {
        self.active.lock().unwrap()
    }
    pub fn view(&self) -> Option<SessionView> {
        self.active.lock().unwrap().as_ref().map(Active::view)
    }
    /// While quiet hours are blocking: when the window ends.
    pub fn quiet_until(&self) -> Option<i64> {
        let mut q = self.quiet.lock().unwrap();
        if !q.on {
            return None;
        }
        q.evaluate(session::now_ms()).1
    }
    /// While a break is running: when it ends.
    pub fn break_until(&self) -> Option<i64> {
        self.brk.lock().unwrap().as_ref().map(|b| b.until).filter(|u| *u > session::now_ms())
    }
    /// Outside a seal and quiet hours, with pause mode on: the browsers ask before flagged sites.
    pub fn pausing(&self) -> bool {
        !self.is_active() && self.quiet_until().is_none() && self.break_until().is_none() && self.pause.lock().unwrap().on(session::now_ms())
    }
    /// For the tray: (blocking now, paused).
    pub fn quiet_menu(&self) -> (bool, bool) {
        let q = self.quiet.lock().unwrap();
        (q.on, q.paused_until.is_some())
    }
}

/// Logs an attempt caught outside the engine's own sweep (the browser extension). Returns
/// the session's new attempt count.
pub fn record_external_attempt(app: &AppHandle, what: &str, kind: &str) -> Option<i64> {
    let shared = app.state::<Shared>();
    let id = shared.engine.active.lock().unwrap().as_ref()?.id;
    let attempts = {
        let conn = shared.db.lock().ok()?;
        session::record_attempt(&conn, id, what, kind, session::now_ms()).ok()?
    };
    let view = {
        let mut guard = shared.engine.active.lock().unwrap();
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
    *shared.app_state.lock().unwrap() = if sealed { AppState::Sealed } else { AppState::Open };
    crate::tamper::on_seal(app, sealed);
    crate::dnd::on_seal(app, sealed);
    crate::focus::on_seal(app, sealed);
    let _ = tray::refresh(app, sealed);
    crate::browser::push_rules(app);
}

/// Friendly name for an exe from the app scan (when it has run), else the exe stem.
fn app_name(shared: &Shared, exe: &str) -> String {
    if let Some(a) = shared.apps.lock().unwrap().as_ref().and_then(|list| list.iter().find(|a| a.exe == exe).cloned()) {
        return a.name;
    }
    let stem = exe.trim_end_matches(".exe");
    let mut c = stem.chars();
    c.next().map(|f| f.to_uppercase().collect::<String>() + c.as_str()).unwrap_or_default()
}

/// The Distractions list, minus what this profile opens.
fn seal_set(shared: &Shared, profile: Option<&profiles::Profile>) -> SealSet {
    let flags = shared.db.lock().ok().and_then(|c| distractions::list(&c).ok()).unwrap_or_default();
    SealSet::new(&flags, profile)
}

/// A flag added mid-seal takes effect right away: apps close, the extension hears.
pub fn refresh_seal(app: &AppHandle) {
    let shared = app.state::<Shared>();
    let Some(profile_id) = shared.engine.session_ids().map(|s| s.1) else { return };
    let profile = profile_id.and_then(|id| load_profile(&shared, id).ok());
    let seal = seal_set(&shared, profile.as_ref());
    if let Some(a) = shared.engine.active.lock().unwrap().as_mut() {
        a.sealed_count = seal.enforced_count() as i64;
    }
    shared.engine.blocker.lock().unwrap().set_rules(seal);
    crate::browser::push_rules(app);
}

fn load_profile(shared: &Shared, id: i64) -> Result<profiles::Profile, String> {
    let conn = shared.db.lock().map_err(|e| e.to_string())?;
    profiles::get(&conn, id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_session(shared: State<Shared>) -> Option<SessionView> {
    shared.engine.active.lock().unwrap().as_ref().map(Active::view)
}

#[tauri::command]
pub fn preview_seal(shared: State<Shared>, profile_id: i64) -> Result<Vec<String>, String> {
    let profile = load_profile(&shared, profile_id)?;
    let seal = seal_set(&shared, Some(&profile));
    let exes = shared.engine.blocker.lock().unwrap().preview(&seal);
    Ok(exes.iter().map(|e| app_name(&shared, e)).collect())
}

#[tauri::command]
pub async fn start_session(
    app: AppHandle,
    profile_id: i64,
    minutes: i64,
    task: Option<session::TaskLink>,
    goal: Option<String>,
    plan: Option<String>,
) -> Result<SessionView, String> {
    tauri::async_runtime::spawn_blocking(move || start(&app, profile_id, minutes, task, goal, plan)).await.map_err(|e| e.to_string())?
}

fn start(app: &AppHandle, profile_id: i64, minutes: i64, task: Option<session::TaskLink>, goal: Option<String>, plan: Option<String>) -> Result<SessionView, String> {
    let shared = app.state::<Shared>();
    let engine = &shared.engine;
    if engine.is_active() {
        return Err("A session is already running.".into());
    }
    if !profiles::DURATIONS.contains(&minutes) {
        return Err("Focus length must be 15 minutes to 2 hours, in 15-minute steps.".into());
    }
    let profile = load_profile(&shared, profile_id)?;
    let seal = seal_set(&shared, Some(&profile));
    let mut active = {
        let conn = shared.db.lock().map_err(|e| e.to_string())?;
        let mut a = session::start(&conn, profile.id, &profile.name, minutes, session::now_ms()).map_err(|e| e.to_string())?;
        // A task is optional; a malformed one is dropped rather than refusing the seal.
        if let Some(t) = task.filter(session::TaskLink::valid) {
            session::set_task(&conn, a.id, &t).map_err(|e| e.to_string())?;
            a.task = Some(session::TaskLink { title: t.title.trim().to_string(), ..t });
        }
        (a.goal, a.plan) = crate::focus::set_intent(&conn, a.id, a.profile_id, goal.as_deref(), plan.as_deref()).map_err(|e| e.to_string())?;
        a
    };
    active.sealed_count = seal.enforced_count() as i64;
    {
        let mut b = engine.blocker.lock().unwrap();
        b.set_rules(seal);
        // First sweep closes what the focus row warned about; it isn't an attempt. Allowlist
        // mode leaves what's already running alone.
        b.block_apps();
    }
    let view = active.view();
    *engine.active.lock().unwrap() = Some(active);
    if engine.brk.lock().unwrap().take().is_some() {
        let _ = app.emit(EV_BREAK, None::<BreakView>);
    }
    engine.outside.store(false, std::sync::atomic::Ordering::SeqCst);
    set_sealed(app, true);
    let _ = app.emit(EV_SESSION, Some(view.clone()));
    Ok(view)
}

/// Ends the running session as unlocked early: the ladder finished, or the emergency unlock
/// (SPEC 4.5). Only unlock.rs calls this; there's no command that skips the ladder.
pub fn end_unlocked(app: &AppHandle, reason: &str, level: i64) -> Result<(), String> {
    let shared = app.state::<Shared>();
    let engine = &shared.engine;
    let mut guard = engine.active.lock().unwrap();
    let Some(active) = guard.as_ref() else { return Err("No session is running.".into()) };
    {
        let mut conn = shared.db.lock().map_err(|e| e.to_string())?;
        session::end_early(&mut conn, active.id, reason, level, session::now_ms())?;
    }
    *guard = None;
    drop(guard);
    engine.blocker.lock().unwrap().unblock_all();
    set_sealed(app, false);
    let _ = app.emit(EV_SESSION, None::<SessionView>);
    Ok(())
}

#[tauri::command]
pub fn focus_minutes_since(shared: State<Shared>, since: i64) -> Result<i64, String> {
    let conn = shared.db.lock().map_err(|e| e.to_string())?;
    session::focus_minutes_since(&conn, since).map_err(|e| e.to_string())
}

/// "Back to <app>": hide the overlay and return to the last app that wasn't sealed.
#[tauri::command]
pub fn intercept_return(app: AppHandle, shared: State<Shared>) {
    hide_intercept(&app);
    if let Some(last) = shared.engine.last_app.lock().unwrap().clone() {
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

fn show_intercept(app: &AppHandle, payload: &Intercept) {
    let Some(w) = app.get_webview_window("intercept") else { return };
    let Ok(Some(monitor)) = w.primary_monitor() else { return };
    let scale = monitor.scale_factor();
    let area = monitor.work_area();
    let px = |v: f64| (v * scale).round() as i32;
    let corner = matches!(payload.kind, "title" | "welcome" | "park");
    let (width, height) = match payload.kind {
        "title" => (px(380.0), px(if payload.plan.is_some() { 108.0 } else { 84.0 })),
        "welcome" => (px(400.0), px(118.0)),
        "park" => (px(400.0), px(132.0)),
        _ => (px(480.0), px(if payload.plan.is_some() { 320.0 } else { 290.0 })),
    };
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
    let now = session::now_ms();
    let booted_at = now - crate::tamper::uptime_ms() as i64;
    let (resumed, downtime) = {
        let conn = shared.db.lock().unwrap();
        session::resume_at(&conn, now, Some(booted_at)).unwrap_or((None, None))
    };
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
    shared.engine.blocker.lock().unwrap().set_rules(seal);
    *shared.engine.active.lock().unwrap() = Some(active);
    set_sealed(app, true);
}

pub fn spawn_loop(app: AppHandle) {
    std::thread::Builder::new()
        .name("sanctum-engine".into())
        .spawn(move || {
            let mut n: u64 = 0;
            loop {
                std::thread::sleep(Duration::from_secs(1));
                tick(&app, n);
                n += 1;
            }
        })
        .expect("engine thread");
}

fn tick(app: &AppHandle, n: u64) {
    let shared = app.state::<Shared>();
    let engine = &shared.engine;
    // Catch up with the tracker's idle state (it also pushes changes as they happen).
    if let Some((_, id, Some(total))) = sync_idle(&shared, shared.activity.idle_since()) {
        if let Ok(conn) = shared.db.lock() {
            let _ = session::save_idle(&conn, id, total);
        }
        // Idle pushed the end later: tell the browsers, so a seal they hold while Sanctum is
        // unreachable lasts as long as the real one.
        crate::browser::push_rules(app);
    }
    let Some(remaining) = engine.active.lock().unwrap().as_ref().map(Active::remaining_ms) else {
        quiet_tick(app);
        return;
    };
    // A session owns the blocker; quiet hours pick up again after it ends.
    engine.outside.store(false, std::sync::atomic::Ordering::SeqCst);
    let was_quiet = std::mem::replace(&mut engine.quiet.lock().unwrap().on, false);
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
        let mut guard = engine.active.lock().unwrap();
        let Some(active) = guard.as_mut() else { return };
        if n % HEARTBEAT_EVERY_S == 0 {
            if let Ok(conn) = shared.db.lock() {
                let _ = session::heartbeat(&conn, active.id, now);
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
    let config = shared.db.lock().map(|c| quiet::load(&c)).unwrap_or_default();
    *shared.engine.quiet.lock().unwrap() = quiet::State { config, ..Default::default() };
}

/// Once a second with no session: starts or stops blocking with quiet hours (and their pause)
/// or a break, enforces the Distractions list like a seal while either runs, and otherwise
/// lets pause mode ask before flagged apps.
fn quiet_tick(app: &AppHandle) {
    use std::sync::atomic::Ordering;
    let shared = app.state::<Shared>();
    let engine = &shared.engine;
    let now = session::now_ms();
    let (quiet_want, quiet_end, quiet_flip) = {
        let mut q = engine.quiet.lock().unwrap();
        let (inside, end, paused) = q.evaluate(now);
        let want = inside && !paused;
        let flip = q.on != want;
        q.on = want;
        (want, end, flip)
    };
    let break_until = {
        let mut b = engine.brk.lock().unwrap();
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
        let mut b = engine.blocker.lock().unwrap();
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
        let mut b = engine.blocker.lock().unwrap();
        (b.block_apps(), b.check_title())
    };
    let label = if let Some(b) = blocked.iter().find(|b| b.closed) {
        Some(("quiet", app_name(&shared, &b.exe), None))
    } else {
        title.map(|t| ("title", t.title, Some(t.keyword)))
    };
    if let Some((kind, label, keyword)) = label {
        let back_to = engine.last_app.lock().unwrap().as_ref().map(|l| app_name(&shared, &l.exe));
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
    let status = shared.engine.quiet.lock().unwrap().status();
    crate::dnd::on_quiet(app, status.on);
    let _ = app.emit(EV_QUIET, status);
    let _ = tray::refresh(app, shared.sealed());
    crate::browser::push_rules(app);
}

#[tauri::command]
pub fn quiet_status(shared: State<Shared>) -> quiet::Status {
    shared.engine.quiet.lock().unwrap().status()
}

#[tauri::command]
pub fn quiet_save(app: AppHandle, shared: State<Shared>, config: quiet::Config) -> Result<quiet::Status, String> {
    // Mid-window the schedule holds; the way out is the pause, which asks why.
    if shared.engine.quiet.lock().unwrap().on {
        return Err("The schedule can change after this window ends.".into());
    }
    {
        let conn = shared.db.lock().map_err(|e| e.to_string())?;
        quiet::save(&conn, &config)?;
    }
    shared.engine.quiet.lock().unwrap().config = config;
    let status = shared.engine.quiet.lock().unwrap().status();
    let _ = app.emit(EV_QUIET, status.clone());
    Ok(status)
}

/// Fifteen minutes off, with a reason. No ladder, no partner, no effect on streaks.
#[tauri::command]
pub fn quiet_pause(app: AppHandle, shared: State<Shared>, reason: String) -> Result<quiet::Status, String> {
    let now = session::now_ms();
    {
        let mut q = shared.engine.quiet.lock().unwrap();
        let (inside, _, paused) = q.evaluate(now);
        if !inside || paused || shared.engine.is_active() {
            return Err("Quiet hours aren't blocking right now.".into());
        }
        let conn = shared.db.lock().map_err(|e| e.to_string())?;
        quiet::log_pause(&conn, &reason, now)?;
        q.paused_until = Some(now + quiet::PAUSE_MS);
        q.on = false;
    }
    shared.engine.blocker.lock().unwrap().unblock_all();
    // A break running alongside picks the blocker back up on the next tick.
    shared.engine.outside.store(false, std::sync::atomic::Ordering::SeqCst);
    quiet_changed(&app);
    Ok(shared.engine.quiet.lock().unwrap().status())
}

/// Ends a pause early; blocking resumes on the next tick.
#[tauri::command]
pub fn quiet_resume(shared: State<Shared>) -> quiet::Status {
    let mut q = shared.engine.quiet.lock().unwrap();
    q.paused_until = None;
    q.status()
}

// --- Pause mode (v0.3.1) ---

/// Reads pause mode's settings into the engine (startup, and after Start over).
pub fn load_pause(app: &AppHandle) {
    let shared = app.state::<Shared>();
    let config = shared.db.lock().map(|c| pause::load(&c)).unwrap_or_default();
    *shared.engine.pause.lock().unwrap() = pause::State { config, ..Default::default() };
}

/// Outside seals and quiet hours, with pause mode on: a flagged app coming to the front is
/// minimized behind "Still want it?" until you answer.
fn pause_tick(app: &AppHandle, now: i64) {
    let shared = app.state::<Shared>();
    let engine = &shared.engine;
    if !engine.pause.lock().unwrap().on(now) {
        return;
    }
    track_foreground(&shared);
    let Some(fg) = winutil::foreground() else { return };
    if fg.pid == std::process::id() {
        return;
    }
    let flags = shared.db.lock().ok().and_then(|c| distractions::list(&c).ok()).unwrap_or_default();
    let exe = {
        let b = engine.blocker.lock().unwrap();
        b.exe_of(fg.pid)
    };
    let Some(exe) = exe.filter(|e| flags.iter().any(|d| d.kind == "app" && d.value.eq_ignore_ascii_case(e)) && !blocker::is_protected(e)) else {
        return;
    };
    if !engine.pause.lock().unwrap().should_pause(&exe, now) {
        return;
    }
    let pids = engine.blocker.lock().unwrap().pids_of(&exe);
    winutil::minimize_windows_of(&pids);
    engine.pause.lock().unwrap().pending = Some(pause::Pending { exe: exe.clone(), pids, at: now });
    let back_to = engine.last_app.lock().unwrap().as_ref().map(|l| app_name(&shared, &l.exe));
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
        let mut p = shared.engine.pause.lock().unwrap();
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
    if let Ok(conn) = shared.db.lock() {
        let _ = pause::log(&conn, &pending.exe, "app", if go_on { "went_on" } else { "turned_back" }, now);
    }
    hide_intercept(&app);
    if go_on {
        winutil::focus_process_window(&pending.pids);
    } else {
        shared.engine.blocker.lock().unwrap().close_exe(&pending.exe);
        if let Some(last) = shared.engine.last_app.lock().unwrap().clone() {
            winutil::focus(last.hwnd);
        }
    }
    Ok(())
}

#[tauri::command]
pub fn pause_status(shared: State<Shared>) -> pause::Status {
    pause::status(&shared.engine.pause.lock().unwrap())
}

#[tauri::command]
pub fn pause_save(app: AppHandle, shared: State<Shared>, config: pause::Config) -> Result<pause::Status, String> {
    {
        let conn = shared.db.lock().map_err(|e| e.to_string())?;
        pause::save(&conn, &config)?;
    }
    shared.engine.pause.lock().unwrap().config = config;
    let status = pause::status(&shared.engine.pause.lock().unwrap());
    let _ = app.emit(EV_PAUSE, status.clone());
    crate::browser::push_rules(&app);
    Ok(status)
}

/// A site the extension paused, and what you chose there.
pub fn log_site_pause(app: &AppHandle, site: &str, went_on: bool) {
    let shared = app.state::<Shared>();
    if let Ok(conn) = shared.db.lock() {
        let _ = pause::log(&conn, site, "site", if went_on { "went_on" } else { "turned_back" }, session::now_ms());
    };
}

#[tauri::command]
pub fn pause_summary(shared: State<Shared>, from: String, to: String) -> Result<pause::Summary, String> {
    let conn = shared.db.lock().map_err(|e| e.to_string())?;
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
    *shared.engine.brk.lock().unwrap() = Some(view.clone());
    let _ = app.emit(EV_BREAK, Some(view.clone()));
    Ok(view)
}

/// Ends the break now: free, no questions.
#[tauri::command]
pub fn break_end(app: AppHandle, shared: State<Shared>) {
    if shared.engine.brk.lock().unwrap().take().is_some() {
        let _ = app.emit(EV_BREAK, None::<BreakView>);
    }
}

#[tauri::command]
pub fn break_status(shared: State<Shared>) -> Option<BreakView> {
    shared.engine.brk.lock().unwrap().clone().filter(|b| b.until > session::now_ms())
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
        let mut b = engine.blocker.lock().unwrap();
        let blocked = b.block_apps();
        b.block_sites();
        (blocked, b.check_title())
    };
    let now = session::now_ms();
    let mut intercept: Option<Intercept> = None;
    let record = |exe: &str, kind: &str| -> Option<i64> {
        let id = engine.active.lock().unwrap().as_ref()?.id;
        let conn = shared.db.lock().ok()?;
        session::record_attempt(&conn, id, exe, kind, now).ok()
    };
    for b in blocked.iter().filter(|b| b.closed) {
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
        if let Some(a) = engine.active.lock().unwrap().as_mut() {
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
                let shared = app.state::<Shared>();
                let Some(watch) = shared.engine.blocker.lock().unwrap().watch_list() else {
                    known.clear();
                    continue;
                };
                let procs = winutil::process_snapshot();
                let started = !known.is_empty() && procs.iter().any(|(pid, exe)| !known.contains(pid) && watch.contains(exe));
                known = procs.into_iter().map(|(pid, _)| pid).collect();
                if started {
                    sweep_now(&app);
                }
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
        .lock()
        .unwrap()
        .as_ref()
        .map(|a| {
            let v = a.view();
            (v.profile_name, v.elapsed_ms, v.remaining_ms, v.plan)
        })
        .unwrap_or_default();
    let back_to = shared.engine.last_app.lock().unwrap().as_ref().map(|l| app_name(shared, &l.exe));
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
        if let Ok(conn) = shared.db.lock() {
            let _ = session::save_idle(&conn, id, total);
        }
    }
    let _ = app.emit(EV_TICK, view.clone());
    if let Event::IdleEnded { since, until } = event {
        if until - since < threshold_ms {
            return;
        }
        let before = shared.activity.tracker.lock().unwrap().before_idle.clone();
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
    let mut guard = shared.engine.active.lock().unwrap();
    let active = guard.as_mut()?;
    let saved = active.set_idle(since);
    Some((active.view(), active.id, saved))
}

fn track_foreground(shared: &Shared) {
    let Some(fg) = winutil::foreground() else { return };
    if fg.pid == std::process::id() {
        return;
    }
    let b = shared.engine.blocker.lock().unwrap();
    let Some(exe) = b.exe_of(fg.pid) else { return };
    if blocker::is_protected(&exe) || b.is_sealed(&exe) {
        return;
    }
    *shared.engine.last_app.lock().unwrap() = Some(LastApp { hwnd: fg.hwnd, exe });
}

fn complete(app: &AppHandle) {
    let shared = app.state::<Shared>();
    let Some(active) = shared.engine.active.lock().unwrap().take() else { return };
    shared.unlock.clear();
    let outcome = if active.broken { "broken" } else { "completed" };
    if let Ok(conn) = shared.db.lock() {
        let _ = session::save_idle(&conn, active.id, active.idle_ms);
        let _ = session::finish(&conn, active.id, outcome, active.effective_end());
    }
    shared.engine.blocker.lock().unwrap().unblock_all();
    set_sealed(app, false);
    if active.broken && !active.tampered {
        // The streak resets; the partner hears about it (SPEC 4.6). Tampering already told them.
        crate::cloud::notify(app, "session_broken", active.profile_name.clone());
    }
    let mut held: HeldStats = active.held();
    if active.broken {
        held.broke = shared.db.lock().ok().and_then(|c| session::first_break(&c, active.id, active.started_at).ok().flatten());
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
