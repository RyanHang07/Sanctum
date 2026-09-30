//! Google Calendar (SPEC 4.3). A background thread syncs every two minutes (sooner when woken
//! by a local edit, a Week page asking for another range, or the window gaining focus):
//! push queued local edits to the Sanctum calendar, pull edits made there in Google, then
//! refresh the cached events of the calendars you chose.

pub mod api;
pub mod oauth;
pub mod secret;
pub mod sync;

use crate::{db, planner, Shared};
use api::{Api, ApiError};
use oauth::AuthError;
use reqwest::blocking::Client;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Condvar, Mutex};
use std::time::{Duration, Instant};
use sync::Job;
use tauri::{AppHandle, Emitter, Manager};

/// Status changes, for Setup and the Week header.
pub const EVENT: &str = "sanctum://gcal";
/// Edits made in Google changed local routines or items.
pub const PLANNER_EVENT: &str = "sanctum://planner";

const POLL: Duration = Duration::from_secs(120);
const SIGN_IN_TIMEOUT: Duration = Duration::from_secs(300);
/// Always cached: last week through six weeks out.
const WINDOW_BACK: i64 = 7;
const WINDOW_AHEAD: i64 = 42;

pub struct State {
    wake: Mutex<bool>,
    cv: Condvar,
    access: Mutex<Option<(String, Instant)>>,
    /// Extra ranges Week asked for (other weeks), newest last.
    windows: Mutex<Vec<(String, String)>>,
    syncing: AtomicBool,
    connecting: AtomicBool,
    cancel: AtomicBool,
    error: Mutex<Option<String>>,
}

impl State {
    pub fn new() -> Self {
        State {
            wake: Mutex::new(false),
            cv: Condvar::new(),
            access: Mutex::new(None),
            windows: Mutex::new(Vec::new()),
            syncing: AtomicBool::new(false),
            connecting: AtomicBool::new(false),
            cancel: AtomicBool::new(false),
            error: Mutex::new(None),
        }
    }

    pub fn wake(&self) {
        *self.wake.lock().unwrap() = true;
        self.cv.notify_all();
    }

    fn sleep(&self) {
        let guard = self.wake.lock().unwrap();
        let (mut woken, _) = self.cv.wait_timeout_while(guard, POLL, |w| !*w).unwrap();
        *woken = false;
    }
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    /// Built with an OAuth client (src-tauri/.env).
    pub configured: bool,
    pub connected: bool,
    pub email: Option<String>,
    pub needs_reconnect: bool,
    pub syncing: bool,
    pub connecting: bool,
    pub last_sync_at: Option<i64>,
    pub error: Option<String>,
}

fn shared(app: &AppHandle) -> tauri::State<'_, Shared> {
    app.state::<Shared>()
}

fn with_conn<T>(app: &AppHandle, f: impl FnOnce(&Connection) -> rusqlite::Result<T>) -> Result<T, Fail> {
    let s = shared(app);
    let conn = s.db.lock().map_err(|e| Fail::Other(e.to_string()))?;
    f(&conn).map_err(|e| Fail::Other(e.to_string()))
}

pub fn status(app: &AppHandle) -> Status {
    let s = shared(app);
    let (email, reconnect, last) = s
        .db
        .lock()
        .map(|c| {
            (
                db::get_setting(&c, sync::K_ACCOUNT).ok().flatten(),
                db::get_setting(&c, sync::K_RECONNECT).ok().flatten().is_some(),
                db::get_setting(&c, sync::K_LAST_SYNC).ok().flatten().and_then(|v| v.parse().ok()),
            )
        })
        .unwrap_or((None, false, None));
    let error = s.gcal.error.lock().unwrap().clone();
    Status {
        configured: oauth::configured(),
        connected: email.is_some(),
        email,
        needs_reconnect: reconnect,
        syncing: s.gcal.syncing.load(Ordering::SeqCst),
        connecting: s.gcal.connecting.load(Ordering::SeqCst),
        last_sync_at: last,
        error,
    }
}

fn emit(app: &AppHandle) {
    let _ = app.emit(EVENT, status(app));
}

/// Queues a planner change for Google and wakes the sync thread. Called with the DB locked.
pub fn queue(shared: &Shared, conn: &Connection, job: Job) {
    if sync::connected(conn) && sync::enqueue(conn, job).is_ok() {
        shared.gcal.wake();
    }
}

#[derive(Debug)]
enum Fail {
    /// The refresh token is gone: the user has to sign in again.
    Reconnect,
    Api(ApiError),
    Other(String),
}

impl From<ApiError> for Fail {
    fn from(e: ApiError) -> Self {
        Fail::Api(e)
    }
}

impl std::fmt::Display for Fail {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Fail::Reconnect => write!(f, "{}", AuthError::Revoked),
            Fail::Api(e) => write!(f, "{e}"),
            Fail::Other(e) => write!(f, "{e}"),
        }
    }
}

fn http() -> Client {
    Client::builder().timeout(Duration::from_secs(20)).user_agent("Sanctum").build().unwrap_or_default()
}

/// A live access token, refreshed from the stored refresh token when it's about to expire.
fn access_token(app: &AppHandle, http: &Client) -> Result<String, Fail> {
    let s = shared(app);
    if let Some((t, exp)) = s.gcal.access.lock().unwrap().clone() {
        if exp > Instant::now() + Duration::from_secs(60) {
            return Ok(t);
        }
    }
    let Some(refresh) = secret::load() else {
        mark_reconnect(app);
        return Err(Fail::Reconnect);
    };
    match oauth::refresh(http, &refresh) {
        Ok(tok) => {
            *s.gcal.access.lock().unwrap() = Some((tok.access_token.clone(), Instant::now() + Duration::from_secs(tok.expires_in)));
            Ok(tok.access_token)
        }
        Err(AuthError::Revoked) => {
            mark_reconnect(app);
            Err(Fail::Reconnect)
        }
        Err(AuthError::Other(e)) => Err(Fail::Other(e)),
    }
}

fn mark_reconnect(app: &AppHandle) {
    let _ = with_conn(app, |c| db::set_setting(c, sync::K_RECONNECT, "1"));
}

/// Runs `f` with a signed-in client, retrying once with a fresh token after a 401.
fn with_api<T>(app: &AppHandle, f: impl Fn(&Api) -> Result<T, Fail>) -> Result<T, Fail> {
    let http = http();
    for attempt in 0..2 {
        let api = Api::new(&http, access_token(app, &http)?);
        match f(&api) {
            Err(Fail::Api(ApiError::Unauthorized)) if attempt == 0 => *shared(app).gcal.access.lock().unwrap() = None,
            other => return other,
        }
    }
    Err(Fail::Api(ApiError::Unauthorized))
}

pub fn spawn(app: AppHandle) {
    std::thread::Builder::new()
        .name("sanctum-gcal".into())
        .spawn(move || loop {
            run_cycle(&app);
            shared(&app).gcal.sleep();
        })
        .expect("spawn gcal thread");
}

fn run_cycle(app: &AppHandle) {
    let ready = with_conn(app, |c| {
        Ok(sync::connected(c) && db::get_setting(c, sync::K_RECONNECT)?.is_none())
    })
    .unwrap_or(false);
    if !oauth::configured() || !ready {
        return;
    }
    let st = &shared(app).gcal;
    st.syncing.store(true, Ordering::SeqCst);
    emit(app);
    let result = with_api(app, |api| cycle(app, api));
    *st.error.lock().unwrap() = match &result {
        Ok(changed) => {
            let _ = with_conn(app, |c| db::set_setting(c, sync::K_LAST_SYNC, &crate::session::now_ms().to_string()));
            if *changed {
                let _ = app.emit(PLANNER_EVENT, ());
            }
            None
        }
        Err(Fail::Reconnect) => None,
        Err(e) => Some(e.to_string()),
    };
    st.syncing.store(false, Ordering::SeqCst);
    emit(app);
}

/// One sync pass. Returns true if edits made in Google changed local items.
fn cycle(app: &AppHandle, api: &Api) -> Result<bool, Fail> {
    let (sanctum, tz) = ensure_calendars(app, api)?;
    push(app, api, &sanctum, &tz)?;
    let changed = pull(app, api, &sanctum)?;
    refresh_windows(app, api)?;
    Ok(changed)
}

/// Refreshes the calendar list and makes sure the Sanctum calendar exists.
fn ensure_calendars(app: &AppHandle, api: &Api) -> Result<(String, String), Fail> {
    let mut list = api.calendar_list()?;
    let tz = list
        .iter()
        .find(|c| c["primary"].as_bool() == Some(true))
        .and_then(|c| c["timeZone"].as_str())
        .unwrap_or("UTC")
        .to_string();
    let saved = with_conn(app, |c| db::get_setting(c, sync::K_SANCTUM))?;
    let has = |id: &str| list.iter().any(|c| c["id"].as_str() == Some(id));
    let sanctum = match saved.filter(|id| has(id)) {
        Some(id) => id,
        None => {
            // Reuse the one a previous connection made, else create it.
            let found = list
                .iter()
                .find(|c| c["description"].as_str() == Some(sync::SANCTUM_DESCRIPTION) && c["accessRole"].as_str() == Some("owner"))
                .and_then(|c| c["id"].as_str().map(str::to_string));
            let id = match found {
                Some(id) => id,
                None => {
                    let id = api.insert_calendar(sync::SANCTUM_SUMMARY, sync::SANCTUM_DESCRIPTION, &tz)?;
                    list.push(serde_json::json!({ "id": id, "summary": sync::SANCTUM_SUMMARY, "accessRole": "owner" }));
                    // A new calendar: old links point nowhere, so push everything again.
                    with_conn(app, |c| {
                        sync::unlink_all(c)?;
                        sync::backfill(c)
                    })?;
                    id
                }
            };
            with_conn(app, |c| c.execute("DELETE FROM settings WHERE key = ?1", [sync::K_SYNC_TOKEN]).map(|_| ()))?;
            id
        }
    };
    with_conn(app, |c| {
        db::set_setting(c, sync::K_SANCTUM, &sanctum)?;
        db::set_setting(c, sync::K_TZ, &tz)?;
        sync::upsert_calendars(c, &list, Some(&sanctum))
    })?;
    Ok((sanctum, tz))
}

fn push(app: &AppHandle, api: &Api, sanctum: &str, tz: &str) -> Result<(), Fail> {
    for (ids, job) in with_conn(app, sync::pending)? {
        match push_job(app, api, sanctum, tz, &job) {
            // Offline, signed out, or a stale token: keep the job and stop for now.
            Err(e @ (Fail::Api(ApiError::Offline | ApiError::Unauthorized) | Fail::Reconnect)) => return Err(e),
            // Google refused this one; drop it so it can't block the rest.
            Err(e) => eprintln!("gcal: dropped {job:?}: {e}"),
            Ok(()) => {}
        }
        with_conn(app, |c| sync::clear_jobs(c, &ids))?;
    }
    Ok(())
}

fn etag_of(v: &Value) -> (String, String) {
    (v["id"].as_str().unwrap_or_default().to_string(), v["etag"].as_str().unwrap_or_default().to_string())
}

/// Patches the event, or creates it if it's missing (deleted in Google, or never pushed).
fn upsert(api: &Api, sanctum: &str, event_id: Option<&str>, body: &Value) -> Result<Value, Fail> {
    if let Some(id) = event_id {
        match api.patch_event(sanctum, id, body) {
            Ok(v) => return Ok(v),
            Err(ApiError::NotFound | ApiError::Gone) => {}
            Err(e) => return Err(e.into()),
        }
    }
    Ok(api.insert_event(sanctum, body)?)
}

fn push_job(app: &AppHandle, api: &Api, sanctum: &str, tz: &str, job: &Job) -> Result<(), Fail> {
    match job {
        Job::Routine(id) => {
            let Some(r) = with_conn(app, |c| sync::push_routine(c, *id))? else { return Ok(()) };
            // Paused and anytime routines stay local.
            if !r.active || r.time.is_none() {
                if let Some(ev) = &r.event_id {
                    api.delete_event(sanctum, ev)?;
                }
                return with_conn(app, |c| sync::set_routine_link(c, r.id, None, None));
            }
            let today = with_conn(app, |c| Ok(sync::today(c)))?;
            let start = sync::first_on_or_after(r.start_date.as_deref().unwrap_or(&today), r.days_mask);
            let Some(body) = sync::routine_body(&r, &start, tz) else { return Ok(()) };
            let v = upsert(api, sanctum, r.event_id.as_deref(), &body)?;
            let (ev, etag) = etag_of(&v);
            with_conn(app, |c| sync::set_routine_link(c, r.id, Some((&ev, &etag)), Some(&start)))
        }
        Job::Todo(id) => {
            let Some(t) = with_conn(app, |c| sync::push_todo(c, *id))? else { return Ok(()) };
            if t.time.is_none() {
                if let Some(ev) = &t.event_id {
                    api.delete_event(sanctum, ev)?;
                }
                return with_conn(app, |c| sync::set_todo_link(c, t.id, None));
            }
            let Some(body) = sync::todo_body(&t, tz) else { return Ok(()) };
            let v = upsert(api, sanctum, t.event_id.as_deref(), &body)?;
            let (ev, etag) = etag_of(&v);
            with_conn(app, |c| sync::set_todo_link(c, t.id, Some((&ev, &etag))))
        }
        Job::Check(id, date) => {
            let Some(r) = with_conn(app, |c| sync::push_routine(c, *id))? else { return Ok(()) };
            let Some(ev) = r.event_id else { return Ok(()) };
            let done = with_conn(app, |c| sync::routine_done(c, *id, date))?;
            let (Some(from), Some(to)) = (sync::local_rfc3339(date, "00:00"), sync::local_rfc3339(&sync::add_days(date, 1), "00:00")) else { return Ok(()) };
            if let Some(day) = api.instances(sanctum, &ev, &from, &to)?.first() {
                let id = day["id"].as_str().unwrap_or_default();
                api.patch_event(sanctum, id, &serde_json::json!({ "summary": sync::titled(&r.title, done) }))?;
            }
            Ok(())
        }
        Job::Delete(ev) => Ok(api.delete_event(sanctum, ev)?),
    }
}

/// Edits made in Google on the Sanctum calendar, via an incremental sync token.
fn pull(app: &AppHandle, api: &Api, sanctum: &str) -> Result<bool, Fail> {
    let token = with_conn(app, |c| db::get_setting(c, sync::K_SYNC_TOKEN))?;
    let page = match token {
        Some(t) => match api.list_events(sanctum, &[("syncToken", t)]) {
            Ok(p) => p,
            // Expired token: start over with a full listing.
            Err(ApiError::Gone) => api.list_events(sanctum, &[])?,
            Err(e) => return Err(e.into()),
        },
        None => api.list_events(sanctum, &[])?,
    };
    with_conn(app, |c| {
        let mut changed = false;
        for item in &page.items {
            changed |= sync::apply_remote(c, item)?;
        }
        if let Some(t) = &page.next_sync_token {
            db::set_setting(c, sync::K_SYNC_TOKEN, t)?;
        }
        Ok(changed)
    })
}

fn refresh_windows(app: &AppHandle, api: &Api) -> Result<(), Fail> {
    let (today, calendars, own) = with_conn(app, |c| Ok((sync::today(c), sync::selected_calendars(c)?, sync::own_event_ids(c)?)))?;
    let mut windows = vec![(sync::add_days(&today, -WINDOW_BACK), sync::add_days(&today, WINDOW_AHEAD))];
    windows.extend(shared(app).gcal.windows.lock().unwrap().iter().cloned());
    for cal in &calendars {
        for (from, to) in &windows {
            let (Some(min), Some(max)) = (sync::local_rfc3339(from, "00:00"), sync::local_rfc3339(&sync::add_days(to, 1), "00:00")) else { continue };
            let q = [("singleEvents", "true".to_string()), ("orderBy", "startTime".into()), ("timeMin", min), ("timeMax", max)];
            let page = match api.list_events(cal, &q) {
                Ok(p) => p,
                Err(ApiError::NotFound) => continue,
                Err(e) => return Err(e.into()),
            };
            with_conn(app, |c| sync::store_window(c, cal, from, to, &page.items, &own))?;
        }
    }
    Ok(())
}

// --- commands ---

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

#[tauri::command]
pub fn gcal_status(app: AppHandle) -> Status {
    status(&app)
}

#[tauri::command]
pub async fn gcal_connect(app: AppHandle) -> Result<Status, String> {
    tauri::async_runtime::spawn_blocking(move || connect(&app)).await.map_err(err)?
}

fn connect(app: &AppHandle) -> Result<Status, String> {
    if !oauth::configured() {
        return Err("This build has no Google OAuth client. Add it to src-tauri/.env and rebuild.".into());
    }
    let st = &shared(app).gcal;
    if st.connecting.swap(true, Ordering::SeqCst) {
        return Err("Already connecting. Finish signing in in your browser.".into());
    }
    st.cancel.store(false, Ordering::SeqCst);
    *st.error.lock().unwrap() = None;
    emit(app);
    let result = sign_in(app);
    st.connecting.store(false, Ordering::SeqCst);
    st.wake();
    emit(app);
    result.map(|_| status(app))
}

fn sign_in(app: &AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).map_err(err)?;
    let redirect = format!("http://127.0.0.1:{}", listener.local_addr().map_err(err)?.port());
    let pkce = oauth::pkce();
    let state = oauth::new_state();
    app.opener()
        .open_url(oauth::auth_url(&redirect, &pkce.challenge, &state), None::<&str>)
        .map_err(|_| "Couldn't open your browser to sign in.".to_string())?;
    let code = oauth::wait_for_code(&listener, &state, SIGN_IN_TIMEOUT, &shared(app).gcal.cancel)?;
    let http = http();
    let tokens = oauth::exchange(&http, &code, &pkce.verifier, &redirect).map_err(err)?;
    let refresh = tokens.refresh_token.clone().ok_or("Google didn't grant offline access. Try again.")?;
    secret::save(&refresh)?;
    let email = tokens.id_token.as_deref().and_then(oauth::email_from_id_token).unwrap_or_else(|| "Google account".into());
    *shared(app).gcal.access.lock().unwrap() = Some((tokens.access_token, Instant::now() + Duration::from_secs(tokens.expires_in)));
    with_conn(app, |c| {
        let first = !sync::connected(c);
        db::set_setting(c, sync::K_ACCOUNT, &email)?;
        c.execute("DELETE FROM settings WHERE key = ?1", [sync::K_RECONNECT])?;
        if first {
            sync::backfill(c)?;
        }
        Ok(())
    })
    .map_err(err)
}

#[tauri::command]
pub fn gcal_cancel_connect(app: AppHandle) {
    shared(&app).gcal.cancel.store(true, Ordering::SeqCst);
}

fn sign_out(app: &AppHandle) -> Result<Status, String> {
    if let Some(t) = secret::load() {
        oauth::revoke(&http(), &t);
    }
    secret::clear();
    let st = &shared(app).gcal;
    *st.access.lock().unwrap() = None;
    *st.error.lock().unwrap() = None;
    st.windows.lock().unwrap().clear();
    with_conn(app, sync::forget_account).map_err(err)?;
    emit(app);
    Ok(status(app))
}

/// Signs out and keeps the Sanctum calendar in Google (decided 2026-09-29).
#[tauri::command]
pub async fn gcal_disconnect(app: AppHandle) -> Result<Status, String> {
    tauri::async_runtime::spawn_blocking(move || sign_out(&app)).await.map_err(err)?
}

/// Deletes the Sanctum calendar from Google, then signs out.
#[tauri::command]
pub async fn gcal_remove_calendar(app: AppHandle) -> Result<Status, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let id = with_conn(&app, |c| db::get_setting(c, sync::K_SANCTUM)).map_err(err)?;
        if let Some(id) = id {
            match with_api(&app, |api| Ok(api.delete_calendar(&id)?)) {
                Ok(()) | Err(Fail::Api(ApiError::NotFound | ApiError::Gone)) => {}
                Err(e) => return Err(e.to_string()),
            }
        }
        with_conn(&app, sync::unlink_all).map_err(err)?;
        sign_out(&app)
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub fn gcal_calendars(app: AppHandle) -> Result<Vec<sync::Calendar>, String> {
    with_conn(&app, sync::list_calendars).map_err(err)
}

#[tauri::command]
pub fn gcal_set_selected(app: AppHandle, id: String, selected: bool) -> Result<(), String> {
    with_conn(&app, |c| sync::set_selected(c, &id, selected)).map_err(err)?;
    shared(&app).gcal.wake();
    Ok(())
}

/// Cached events for [from, to]. A range outside the cached window is fetched in the
/// background; a `sanctum://gcal` event follows when it lands.
#[tauri::command]
pub fn gcal_events(app: AppHandle, from: String, to: String) -> Result<Vec<sync::CalEvent>, String> {
    let (events, today) = with_conn(&app, |c| Ok((sync::list_events(c, &from, &to)?, sync::today(c)))).map_err(err)?;
    let covered = from >= sync::add_days(&today, -WINDOW_BACK) && to <= sync::add_days(&today, WINDOW_AHEAD);
    let st = &shared(&app).gcal;
    let mut windows = st.windows.lock().unwrap();
    if !covered && !windows.contains(&(from.clone(), to.clone())) {
        windows.push((from, to));
        if windows.len() > 4 {
            windows.remove(0);
        }
        st.wake();
    }
    Ok(events)
}

#[tauri::command]
pub fn gcal_sync_now(app: AppHandle) {
    shared(&app).gcal.wake();
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct EventDraft {
    pub calendar_id: String,
    #[serde(default)]
    pub event_id: Option<String>,
    pub title: String,
    pub date: String,
    #[serde(default)]
    pub time: Option<String>,
    #[serde(default)]
    pub duration_min: Option<i64>,
}

/// Creates or edits an event on one of your calendars (Week, decided 2026-09-29).
#[tauri::command]
pub async fn gcal_save_event(app: AppHandle, draft: EventDraft) -> Result<(), String> {
    let title = draft.title.trim().to_string();
    if title.is_empty() {
        return Err("Give it a name.".into());
    }
    if !planner::valid_date(&draft.date) || draft.time.as_deref().is_some_and(|t| !planner::valid_time(t)) {
        return Err("That date or time isn't valid.".into());
    }
    let body = sync::event_body(&title, &draft.date, draft.time.as_deref(), draft.duration_min).ok_or("That date or time isn't valid.")?;
    tauri::async_runtime::spawn_blocking(move || {
        let saved = with_api(&app, |api| {
            Ok(match &draft.event_id {
                Some(id) => api.patch_event(&draft.calendar_id, id, &body)?,
                None => api.insert_event(&draft.calendar_id, &body)?,
            })
        })
        .map_err(err)?;
        with_conn(&app, |c| sync::store_one(c, &draft.calendar_id, &saved)).map_err(err)?;
        emit(&app);
        Ok(())
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub async fn gcal_delete_event(app: AppHandle, calendar_id: String, event_id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        with_api(&app, |api| Ok(api.delete_event(&calendar_id, &event_id)?)).map_err(err)?;
        with_conn(&app, |c| sync::forget_event(c, &calendar_id, &event_id)).map_err(err)?;
        emit(&app);
        Ok(())
    })
    .await
    .map_err(err)?
}

/// Opens an event in Google Calendar. Only Google Calendar links are allowed through.
#[tauri::command]
pub fn gcal_open(app: AppHandle, url: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let ok = reqwest::Url::parse(&url)
        .is_ok_and(|u| u.scheme() == "https" && matches!(u.host_str(), Some("www.google.com" | "calendar.google.com")));
    if !ok {
        return Err("That isn't a Google Calendar link.".into());
    }
    app.opener().open_url(url, None::<&str>).map_err(|_| "Couldn't open your browser.".into())
}
