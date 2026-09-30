mod activity;
mod apps;
mod blocker;
pub mod bridge;
mod browser;
mod classify;
mod db;
mod engine;
mod gcal;
mod launcher;
mod planner;
mod profiles;
mod session;
mod stats;
mod tray;
mod winutil;

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State, WindowEvent};

/// Passed by the autostart entry so we can tell a login launch from a manual one.
pub const AUTOSTART_ARG: &str = "--autostart";

/// Mirror of the frontend store's state (SPEC 4.0). The UI owns it and pushes changes here
/// so the tray and close handling can enforce the sealed rules.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AppState {
    Open,
    Sealed,
    Event,
}

pub struct Shared {
    pub db: Mutex<rusqlite::Connection>,
    pub db_path: PathBuf,
    pub app_state: Mutex<AppState>,
    /// Installed-app scan, cached until the picker asks for a refresh.
    pub apps: Mutex<Option<Vec<apps::InstalledApp>>>,
    pub icons: Mutex<HashMap<String, Option<String>>>,
    pub engine: engine::Engine,
    pub activity: activity::State,
    pub gcal: gcal::State,
    pub browser: browser::State,
}

impl Shared {
    pub fn sealed(&self) -> bool {
        *self.app_state.lock().unwrap() == AppState::Sealed
    }
}

#[derive(Debug, PartialEq, Eq)]
enum CloseAction {
    Ask,
    Tray,
    Quit,
}

/// Same rule as `resolveClose` in src/state/appState.ts: a saved Quit goes to the tray while sealed.
fn resolve_close(sealed: bool, saved: Option<&str>) -> CloseAction {
    match saved {
        Some("tray") => CloseAction::Tray,
        Some("quit") if sealed => CloseAction::Tray,
        Some("quit") => CloseAction::Quit,
        _ => CloseAction::Ask,
    }
}

pub fn show_main_window(app: &AppHandle) {
    for label in ["compact", "tray-panel"] {
        if let Some(w) = app.get_webview_window(label) {
            let _ = w.hide();
        }
    }
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

pub fn show_compact_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.hide();
    }
    let Some(w) = app.get_webview_window("compact") else { return };
    if let Some(geo) = compact_geometry(&w) {
        let saved = app
            .state::<Shared>()
            .db
            .lock()
            .ok()
            .and_then(|c| db::get_setting(&c, "compact_offset").ok().flatten())
            .and_then(|s| parse_pair(&s))
            .unwrap_or((0, 0));
        let (x, y) = compact_position(&geo, saved);
        let _ = w.set_position(tauri::PhysicalPosition::new(x, y));
    }
    let _ = w.show();
    let _ = w.set_focus();
}

/// Work area of the primary screen plus the timer's size, all in physical pixels.
struct CompactGeometry {
    area: (i32, i32, i32, i32),
    size: (i32, i32),
    margin: i32,
}

fn compact_geometry(w: &tauri::WebviewWindow) -> Option<CompactGeometry> {
    let m = w.primary_monitor().ok()??;
    let a = m.work_area();
    let s = w.outer_size().ok()?;
    Some(CompactGeometry {
        area: (a.position.x, a.position.y, a.size.width as i32, a.size.height as i32),
        size: (s.width as i32, s.height as i32),
        margin: (12.0 * m.scale_factor()).round() as i32,
    })
}

/// Home spot for the compact timer: top middle of the primary screen.
fn compact_anchor(g: &CompactGeometry) -> (i32, i32) {
    let (ax, ay, aw, _) = g.area;
    (ax + (aw - g.size.0) / 2, ay + g.margin)
}

/// Top middle plus the offset it was last dragged by. Falls back to top middle if that
/// would put the timer off screen (e.g. after a monitor change).
fn compact_position(g: &CompactGeometry, offset: (i32, i32)) -> (i32, i32) {
    let (x0, y0) = compact_anchor(g);
    let (x, y) = (x0 + offset.0, y0 + offset.1);
    let (ax, ay, aw, ah) = g.area;
    let fits = x >= ax && y >= ay && x + g.size.0 <= ax + aw && y + g.size.1 <= ay + ah;
    if fits { (x, y) } else { (x0, y0) }
}

fn parse_pair(s: &str) -> Option<(i32, i32)> {
    let (x, y) = s.split_once(',')?;
    Some((x.trim().parse().ok()?, y.trim().parse().ok()?))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DbStatus {
    ready: bool,
    schema_version: usize,
    tables: Vec<String>,
    path: String,
}

#[tauri::command]
fn db_status(shared: State<Shared>) -> Result<DbStatus, String> {
    let conn = shared.db.lock().map_err(|e| e.to_string())?;
    let s = db::status(&conn).map_err(|e| e.to_string())?;
    Ok(DbStatus {
        ready: s.ready,
        schema_version: s.version,
        tables: s.tables,
        path: shared.db_path.display().to_string(),
    })
}

#[tauri::command]
fn get_setting(shared: State<Shared>, key: String) -> Result<Option<String>, String> {
    let conn = shared.db.lock().map_err(|e| e.to_string())?;
    db::get_setting(&conn, &key).map_err(|e| e.to_string())
}

#[tauri::command]
fn set_setting(shared: State<Shared>, key: String, value: String) -> Result<(), String> {
    let conn = shared.db.lock().map_err(|e| e.to_string())?;
    db::set_setting(&conn, &key, &value).map_err(|e| e.to_string())?;
    shared.activity.mark_dirty();
    Ok(())
}

#[tauri::command]
fn list_class_rules(shared: State<Shared>) -> Result<Vec<classify::ClassRule>, String> {
    let conn = shared.db.lock().map_err(|e| e.to_string())?;
    classify::list(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
fn add_class_rule(shared: State<Shared>, rule: classify::ClassRule) -> Result<classify::ClassRule, String> {
    let conn = shared.db.lock().map_err(|e| e.to_string())?;
    let r = classify::add(&conn, rule)?;
    shared.activity.mark_dirty();
    Ok(r)
}

#[tauri::command]
fn set_class_rule_category(shared: State<Shared>, id: i64, category: String) -> Result<(), String> {
    let conn = shared.db.lock().map_err(|e| e.to_string())?;
    classify::set_category(&conn, id, &category)?;
    shared.activity.mark_dirty();
    Ok(())
}

#[tauri::command]
fn remove_class_rule(shared: State<Shared>, id: i64) -> Result<(), String> {
    let conn = shared.db.lock().map_err(|e| e.to_string())?;
    classify::remove(&conn, id).map_err(|e| e.to_string())?;
    shared.activity.mark_dirty();
    Ok(())
}

fn db_call<T>(shared: &Shared, f: impl FnOnce(&rusqlite::Connection) -> Result<T, String>) -> Result<T, String> {
    let conn = shared.db.lock().map_err(|e| e.to_string())?;
    f(&conn)
}

#[tauri::command]
fn list_routines(shared: State<Shared>) -> Result<Vec<planner::Routine>, String> {
    db_call(&shared, |c| planner::list_routines(c).map_err(|e| e.to_string()))
}

#[tauri::command]
fn save_routine(shared: State<Shared>, draft: planner::RoutineDraft) -> Result<planner::Routine, String> {
    db_call(&shared, |c| {
        let r = planner::save_routine(c, draft)?;
        gcal::queue(&shared, c, gcal::sync::Job::Routine(r.id));
        Ok(r)
    })
}

/// The Google event linked to a routine or item, read before it's deleted.
fn linked_event(c: &rusqlite::Connection, table: &str, id: i64) -> Option<String> {
    c.query_row(&format!("SELECT gcal_event_id FROM {table} WHERE id = ?1"), [id], |r| r.get(0)).ok().flatten()
}

#[tauri::command]
fn delete_routine(shared: State<Shared>, id: i64) -> Result<(), String> {
    db_call(&shared, |c| {
        let event = linked_event(c, "daily_goals", id);
        planner::delete_routine(c, id).map_err(|e| e.to_string())?;
        if let Some(e) = event {
            gcal::queue(&shared, c, gcal::sync::Job::Delete(e));
        }
        Ok(())
    })
}

#[tauri::command]
fn list_routine_checks(shared: State<Shared>, from: String, to: String) -> Result<Vec<planner::RoutineCheck>, String> {
    db_call(&shared, |c| planner::list_checks(c, &from, &to).map_err(|e| e.to_string()))
}

#[tauri::command]
fn set_routine_done(shared: State<Shared>, id: i64, date: String, done: bool) -> Result<(), String> {
    db_call(&shared, |c| {
        planner::set_routine_done(c, id, &date, done)?;
        gcal::queue(&shared, c, gcal::sync::Job::Check(id, date));
        Ok(())
    })
}

#[tauri::command]
fn list_todos(shared: State<Shared>, from: String, to: String) -> Result<Vec<planner::Todo>, String> {
    db_call(&shared, |c| planner::list_todos(c, &from, &to).map_err(|e| e.to_string()))
}

#[tauri::command]
fn save_todo(shared: State<Shared>, draft: planner::TodoDraft) -> Result<planner::Todo, String> {
    db_call(&shared, |c| {
        let t = planner::save_todo(c, draft)?;
        gcal::queue(&shared, c, gcal::sync::Job::Todo(t.id));
        Ok(t)
    })
}

#[tauri::command]
fn set_todo_done(shared: State<Shared>, id: i64, done: bool) -> Result<planner::Todo, String> {
    db_call(&shared, |c| {
        let t = planner::set_todo_done(c, id, done)?;
        gcal::queue(&shared, c, gcal::sync::Job::Todo(t.id));
        Ok(t)
    })
}

#[tauri::command]
fn delete_todo(shared: State<Shared>, id: i64) -> Result<(), String> {
    db_call(&shared, |c| {
        let event = linked_event(c, "todos", id);
        planner::delete_todo(c, id).map_err(|e| e.to_string())?;
        if let Some(e) = event {
            gcal::queue(&shared, c, gcal::sync::Job::Delete(e));
        }
        Ok(())
    })
}

#[tauri::command]
fn activity_summary(shared: State<Shared>, since: i64) -> Result<activity::Summary, String> {
    let conn = shared.db.lock().map_err(|e| e.to_string())?;
    activity::summary(&conn, since, session::now_ms()).map_err(|e| e.to_string())
}

#[tauri::command]
fn set_app_state(app: AppHandle, shared: State<Shared>, state: AppState) -> Result<(), String> {
    // A running session owns the sealed state; only it can end the seal.
    if shared.engine.is_active() {
        return if state == AppState::Sealed { Ok(()) } else { Err("A session is running.".into()) };
    }
    *shared.app_state.lock().map_err(|e| e.to_string())? = state;
    tray::refresh(&app, state == AppState::Sealed).map_err(|e| e.to_string())
}

fn unsealed(shared: &Shared) -> Result<(), String> {
    if shared.sealed() {
        Err("Profiles are locked while you're sealed.".into())
    } else {
        Ok(())
    }
}

fn with_db<T>(shared: &Shared, f: impl FnOnce(&mut rusqlite::Connection) -> profiles::Result<T>) -> Result<T, String> {
    let mut conn = shared.db.lock().map_err(|e| e.to_string())?;
    let out = f(&mut conn).map_err(|e| e.to_string());
    // Profiles feed activity classification.
    shared.activity.mark_dirty();
    out
}

#[tauri::command]
fn list_profiles(shared: State<Shared>) -> Result<Vec<profiles::Profile>, String> {
    with_db(&shared, |c| profiles::list(c))
}

#[tauri::command]
fn create_profile(shared: State<Shared>, draft: profiles::ProfileDraft) -> Result<profiles::Profile, String> {
    unsealed(&shared)?;
    with_db(&shared, |c| profiles::create(c, draft))
}

#[tauri::command]
fn update_profile(shared: State<Shared>, id: i64, patch: profiles::ProfilePatch) -> Result<profiles::Profile, String> {
    unsealed(&shared)?;
    with_db(&shared, |c| profiles::update(c, id, patch))
}

#[tauri::command]
fn delete_profile(shared: State<Shared>, id: i64) -> Result<(), String> {
    unsealed(&shared)?;
    with_db(&shared, |c| profiles::delete(c, id))
}

#[tauri::command]
fn add_rule(shared: State<Shared>, profile_id: i64, rule: profiles::NewRule) -> Result<profiles::Profile, String> {
    unsealed(&shared)?;
    with_db(&shared, |c| profiles::add_rule(c, profile_id, rule))
}

#[tauri::command]
fn remove_rule(shared: State<Shared>, rule_id: i64) -> Result<profiles::Profile, String> {
    unsealed(&shared)?;
    with_db(&shared, |c| profiles::remove_rule(c, rule_id))
}

#[tauri::command]
fn add_site_allow(shared: State<Shared>, rule_id: i64, prefix: String) -> Result<profiles::Profile, String> {
    unsealed(&shared)?;
    with_db(&shared, |c| profiles::add_site_allow(c, rule_id, &prefix))
}

#[tauri::command]
fn remove_site_allow(shared: State<Shared>, id: i64) -> Result<profiles::Profile, String> {
    unsealed(&shared)?;
    with_db(&shared, |c| profiles::remove_site_allow(c, id))
}

fn installed_apps(shared: &Shared, refresh: bool) -> Vec<apps::InstalledApp> {
    let mut cache = shared.apps.lock().unwrap();
    if refresh || cache.is_none() {
        *cache = Some(apps::scan());
    }
    cache.clone().unwrap_or_default()
}

#[tauri::command]
async fn list_installed_apps(app: AppHandle, refresh: bool) -> Result<Vec<apps::InstalledApp>, String> {
    tauri::async_runtime::spawn_blocking(move || installed_apps(&app.state::<Shared>(), refresh))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn app_icon(app: AppHandle, path: String) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let shared = app.state::<Shared>();
        if let Some(hit) = shared.icons.lock().unwrap().get(&path) {
            return hit.clone();
        }
        let icon = apps::icon_data_url(&path);
        shared.icons.lock().unwrap().insert(path, icon.clone());
        icon
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
async fn launch_profile(app: AppHandle, id: i64) -> Result<launcher::LaunchReport, String> {
    tauri::async_runtime::spawn_blocking(move || launch(&app, id))
        .await
        .map_err(|e| e.to_string())?
}

fn launch(app: &AppHandle, id: i64) -> Result<launcher::LaunchReport, String> {
    use launcher::Step;
    use tauri_plugin_opener::OpenerExt;

    let shared = app.state::<Shared>();
    let profile = with_db(&shared, |c| profiles::get(c, id))?;
    let procs = launcher::running_processes();
    let running: HashSet<String> = procs.iter().map(|(n, _)| n.clone()).collect();

    // A saved path wins while it still exists; otherwise look the exe up in the app scan.
    let mut scanned: Option<Vec<apps::InstalledApp>> = None;
    let steps = launcher::plan(&profile.rules, &running, |r| {
        if let Some(p) = r.path.as_ref().filter(|p| std::path::Path::new(p).exists()) {
            return Some(p.clone());
        }
        let list = scanned.get_or_insert_with(|| installed_apps(&shared, false));
        list.iter().find(|a| a.exe == r.value).map(|a| a.launch.clone())
    });

    let mut report = launcher::LaunchReport::default();
    for step in steps {
        match step {
            Step::Focus { label, exe } => {
                let pids: Vec<u32> = procs.iter().filter(|(n, _)| *n == exe).map(|(_, p)| *p).collect();
                winutil::focus_process_window(&pids);
                report.focused.push(label);
            }
            Step::OpenApp { label, target, rule_id } => match app.opener().open_path(&target, None::<&str>) {
                Ok(()) => {
                    let _ = with_db(&shared, |c| profiles::set_rule_path(c, rule_id, &target));
                    report.opened.push(label);
                }
                Err(_) => report.failed.push(label),
            },
            Step::OpenUrl { label, url } => match app.opener().open_url(&url, None::<&str>) {
                Ok(()) => report.opened.push(label),
                Err(_) => report.failed.push(label),
            },
            Step::Missing { label } => report.missing.push(label),
        }
    }
    Ok(report)
}

#[tauri::command]
fn hide_to_tray(app: AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.hide();
    }
}

#[tauri::command]
fn quit_app(app: AppHandle, shared: State<Shared>) -> Result<(), String> {
    if shared.sealed() {
        return Err("Sanctum stays open while sealed.".into());
    }
    app.exit(0);
    Ok(())
}

#[tauri::command]
fn show_compact(app: AppHandle) {
    show_compact_window(&app);
}

#[tauri::command]
fn show_main(app: AppHandle) {
    show_main_window(&app);
}

/// Autostart is on by default (SPEC 4.11 step 6). Registered once, in release builds only,
/// so dev builds never write a Run key pointing at a debug binary.
fn init_autostart(app: &AppHandle, conn: &rusqlite::Connection) -> rusqlite::Result<()> {
    if cfg!(debug_assertions) || db::get_setting(conn, "autostart_initialized")?.is_some() {
        return Ok(());
    }
    use tauri_plugin_autostart::ManagerExt;
    if app.autolaunch().enable().is_ok() {
        db::set_setting(conn, "autostart_initialized", "1")?;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Must be registered first: a second launch focuses the existing window instead.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main_window(app)))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![AUTOSTART_ARG]),
        ))
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            // Dev builds keep their own database so sample data never reaches a real install.
            let db_path = dir.join(if cfg!(debug_assertions) { "sanctum-dev.db" } else { "sanctum.db" });
            let conn = db::open(&db_path)?;
            classify::seed_from_catalog(&conn)?;
            blocker::seed_always(&conn)?;

            init_autostart(app.handle(), &conn)?;
            let start_in_tray = std::env::args().any(|a| a == AUTOSTART_ARG)
                && db::get_setting(&conn, "on_login")?.as_deref() == Some("tray");

            app.manage(Shared {
                db: Mutex::new(conn),
                db_path,
                app_state: Mutex::new(AppState::Open),
                apps: Mutex::new(None),
                icons: Mutex::new(HashMap::new()),
                engine: engine::Engine::new(),
                activity: activity::State::new(),
                gcal: gcal::State::new(),
                browser: browser::State::new(),
            });
            tray::create(app.handle())?;
            engine::resume_on_startup(app.handle());
            engine::spawn_loop(app.handle().clone());
            activity::spawn(app.handle().clone());
            gcal::spawn(app.handle().clone());
            // The browser extension (4b). A failure here leaves app blocking untouched.
            if let Err(e) = browser::register(&dir) {
                eprintln!("browser bridge registration failed: {e}");
            }
            if let Err(e) = browser::start(app.handle(), &dir) {
                eprintln!("browser bridge server failed: {e}");
            }
            browser::spawn_watch(app.handle().clone());

            // On login, open Home by default; "Start in tray" keeps the window hidden.
            if !start_in_tray {
                show_main_window(app.handle());
            }
            Ok(())
        })
        .on_window_event(|window, event| match (window.label(), event) {
            ("main", WindowEvent::CloseRequested { api, .. }) => {
                api.prevent_close();
                let app = window.app_handle();
                let shared = app.state::<Shared>();
                let saved = shared
                    .db
                    .lock()
                    .ok()
                    .and_then(|c| db::get_setting(&c, "close_action").ok().flatten());
                match resolve_close(shared.sealed(), saved.as_deref()) {
                    CloseAction::Tray => {
                        let _ = window.hide();
                    }
                    CloseAction::Quit => app.exit(0),
                    CloseAction::Ask => {
                        let _ = app.emit("sanctum://close-requested", ());
                    }
                }
            }
            ("tray-panel", WindowEvent::Focused(false)) => tray::hide_panel(window.app_handle()),
            ("compact", WindowEvent::Moved(pos)) => {
                // Remember where it was dragged, relative to top middle.
                let Some(w) = window.app_handle().get_webview_window("compact") else { return };
                let Some(geo) = compact_geometry(&w) else { return };
                let (x0, y0) = compact_anchor(&geo);
                // Windows move while they're created, before setup has managed Shared.
                let Some(shared) = window.app_handle().try_state::<Shared>() else { return };
                if let Ok(conn) = shared.db.lock() {
                    let _ = db::set_setting(&conn, "compact_offset", &format!("{},{}", pos.x - x0, pos.y - y0));
                };
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            db_status,
            get_setting,
            set_setting,
            set_app_state,
            hide_to_tray,
            quit_app,
            show_compact,
            show_main,
            list_profiles,
            create_profile,
            update_profile,
            delete_profile,
            add_rule,
            remove_rule,
            add_site_allow,
            remove_site_allow,
            browser::browser_status,
            browser::browser_open_extension_dir,
            list_installed_apps,
            app_icon,
            launch_profile,
            engine::get_session,
            engine::preview_seal,
            engine::start_session,
            engine::end_session_early,
            engine::focus_minutes_since,
            engine::intercept_return,
            engine::intercept_hide,
            engine::intercept_break,
            list_class_rules,
            add_class_rule,
            set_class_rule_category,
            remove_class_rule,
            activity_summary,
            stats::stats_overview,
            list_routines,
            save_routine,
            delete_routine,
            list_routine_checks,
            set_routine_done,
            list_todos,
            save_todo,
            set_todo_done,
            delete_todo,
            gcal::gcal_status,
            gcal::gcal_connect,
            gcal::gcal_cancel_connect,
            gcal::gcal_disconnect,
            gcal::gcal_remove_calendar,
            gcal::gcal_calendars,
            gcal::gcal_set_selected,
            gcal::gcal_events,
            gcal::gcal_sync_now,
            gcal::gcal_save_event,
            gcal::gcal_delete_event,
            gcal::gcal_open
        ])
        .run(tauri::generate_context!())
        .expect("error while running Sanctum");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn close_goes_to_tray_while_sealed() {
        assert_eq!(resolve_close(true, Some("quit")), CloseAction::Tray);
        assert_eq!(resolve_close(true, Some("tray")), CloseAction::Tray);
        assert_eq!(resolve_close(true, Some("ask")), CloseAction::Ask);
        assert_eq!(resolve_close(false, Some("quit")), CloseAction::Quit);
        assert_eq!(resolve_close(false, None), CloseAction::Ask);
    }

    #[test]
    fn compact_timer_sits_top_middle() {
        // 1920x1040 work area, 300x58 timer at 100% scale.
        let g = CompactGeometry { area: (0, 0, 1920, 1040), size: (300, 58), margin: 12 };
        assert_eq!(compact_position(&g, (0, 0)), (810, 12));
        assert_eq!(compact_position(&g, (200, 40)), (1010, 52));
        // An offset that would leave the screen snaps back to top middle.
        assert_eq!(compact_position(&g, (2000, 0)), (810, 12));
        // Secondary layouts: work area not at the origin.
        let g = CompactGeometry { area: (-1920, 0, 1920, 1080), size: (450, 87), margin: 18 };
        assert_eq!(compact_position(&g, (0, 0)), (-1920 + 735, 18));
        assert_eq!(parse_pair("-20, 7"), Some((-20, 7)));
        assert_eq!(parse_pair("junk"), None);
    }

    #[test]
    fn app_state_matches_frontend_names() {
        let s: AppState = serde_json::from_str("\"sealed\"").unwrap();
        assert_eq!(s, AppState::Sealed);
        assert_eq!(serde_json::to_string(&AppState::Event).unwrap(), "\"event\"");
    }
}
