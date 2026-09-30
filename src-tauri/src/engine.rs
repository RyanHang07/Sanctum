//! Runs focus sessions: starts and resumes them, enforces the seal once a second, shows the
//! intercept overlay, and finishes them (SPEC 4.0, 4.4, 6). The frontend follows along through
//! events; Rust is the source of truth for whether Sanctum is sealed.

use crate::blocker::{self, Blocker, SealSet, SystemBlocker};
use crate::session::{self, Active, HeldStats, SessionView};
use crate::{distractions, profiles, tray, winutil, AppState, Shared};
use serde::Serialize;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, State};

pub const EV_SESSION: &str = "sanctum://session";
pub const EV_TICK: &str = "sanctum://tick";
pub const EV_HELD: &str = "sanctum://held";
pub const EV_INTERCEPT: &str = "sanctum://intercept";
pub const EV_END_EARLY: &str = "sanctum://end-early";

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
}

impl Engine {
    pub fn new() -> Self {
        Engine { active: Mutex::new(None), blocker: Mutex::new(SystemBlocker::new()), last_app: Mutex::new(None) }
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
pub async fn start_session(app: AppHandle, profile_id: i64, minutes: i64) -> Result<SessionView, String> {
    tauri::async_runtime::spawn_blocking(move || start(&app, profile_id, minutes)).await.map_err(|e| e.to_string())?
}

fn start(app: &AppHandle, profile_id: i64, minutes: i64) -> Result<SessionView, String> {
    let shared = app.state::<Shared>();
    let engine = &shared.engine;
    if engine.is_active() {
        return Err("A session is already running.".into());
    }
    if !profiles::DURATIONS.contains(&minutes) {
        return Err("Focus length must be one of 30, 60, 90, or 120 minutes.".into());
    }
    let profile = load_profile(&shared, profile_id)?;
    let seal = seal_set(&shared, Some(&profile));
    let mut active = {
        let conn = shared.db.lock().map_err(|e| e.to_string())?;
        session::start(&conn, profile.id, &profile.name, minutes, session::now_ms()).map_err(|e| e.to_string())?
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
    let corner = payload.kind == "title" || payload.kind == "welcome";
    let (width, height) = match payload.kind {
        "title" => (px(380.0), px(84.0)),
        "welcome" => (px(400.0), px(118.0)),
        _ => (px(480.0), px(290.0)),
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
    if !corner {
        let _ = w.set_focus();
    }
}

/// Picks up an unfinished session after a restart or crash (SPEC 6).
pub fn resume_on_startup(app: &AppHandle) {
    let shared = app.state::<Shared>();
    let resumed = {
        let conn = shared.db.lock().unwrap();
        session::resume(&conn, session::now_ms()).ok().flatten()
    };
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
    }
    let Some(remaining) = engine.active.lock().unwrap().as_ref().map(Active::remaining_ms) else { return };
    if remaining == 0 {
        complete(app);
        return;
    }
    crate::tamper::check(app, n);

    let (blocked, title) = {
        let mut b = engine.blocker.lock().unwrap();
        let blocked = b.block_apps();
        b.block_sites();
        (blocked, b.check_title())
    };
    track_foreground(&shared);

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

    let view = {
        let mut guard = engine.active.lock().unwrap();
        let Some(active) = guard.as_mut() else { return };
        if let Some(i) = &intercept {
            active.attempts = i.attempts;
        }
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

fn make_intercept(shared: &Shared, kind: &'static str, label: String, attempts: i64, keyword: Option<String>) -> Intercept {
    let (profile_name, elapsed_ms, remaining_ms) = shared
        .engine
        .active
        .lock()
        .unwrap()
        .as_ref()
        .map(|a| {
            let v = a.view();
            (v.profile_name, v.elapsed_ms, v.remaining_ms)
        })
        .unwrap_or_default();
    let back_to = shared.engine.last_app.lock().unwrap().as_ref().map(|l| app_name(shared, &l.exe));
    Intercept { kind, label, attempts, profile_name, elapsed_ms, remaining_ms, back_to, keyword, title: None, idle_ms: None, ends_at: None }
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
    let held: HeldStats = active.held();
    let _ = app.emit(EV_SESSION, None::<SessionView>);
    let _ = app.emit(EV_HELD, held);
    // The compact timer shows "Held." for a beat before the held page takes over.
    let compact_visible = app.get_webview_window("compact").and_then(|w| w.is_visible().ok()).unwrap_or(false);
    if compact_visible {
        std::thread::sleep(Duration::from_millis(1600));
    }
    crate::show_main_window(app);
}
