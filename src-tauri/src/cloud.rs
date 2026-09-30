//! The optional Sanctum account and accountability partner (SPEC 4.6, M6), on Supabase.
//!
//! Sign-in is Google or an email link, both through Supabase Auth with PKCE and a loopback
//! redirect to 127.0.0.1. The refresh token lives in Windows Credential Manager; the access
//! token only in memory. Everything else goes through PostgREST and Edge Functions as the
//! signed-in user, so row-level security decides what this app can see.

use crate::gcal::{oauth, secret};
use crate::Shared;
use reqwest::blocking::{Client, RequestBuilder};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, State as TauriState};

/// The Supabase project, set at build time (build.rs, docs/self-hosting.md). The publishable
/// key is public by design (SPEC 6); RLS guards the data. Empty: accounts are off in this build.
pub const URL: &str = env!("SANCTUM_SUPABASE_URL");
pub const KEY: &str = env!("SANCTUM_SUPABASE_KEY");

pub fn configured() -> bool {
    !URL.is_empty() && !KEY.is_empty()
}
/// Fixed so it can be listed in Supabase Auth's redirect URLs.
pub const REDIRECT_PORT: u16 = 54917;
/// Where invite links point: the partner page on Vercel, or the local dev server.
pub const PARTNER_URL: &str = if env!("SANCTUM_PARTNER_URL").is_empty() { "http://localhost:5174" } else { env!("SANCTUM_PARTNER_URL") };
const TARGET: &str = if cfg!(debug_assertions) { "Sanctum/account-dev" } else { "Sanctum/account" };
pub const EVENT: &str = "sanctum://cloud";
const GOOGLE_WAIT: Duration = Duration::from_secs(300);
const EMAIL_WAIT: Duration = Duration::from_secs(15 * 60);

struct Session {
    access: String,
    expires: Instant,
    user_id: String,
    email: Option<String>,
}

pub struct State {
    http: Client,
    session: Mutex<Option<Session>>,
    connecting: AtomicBool,
    cancel: AtomicBool,
    error: Mutex<Option<String>>,
}

impl State {
    pub fn new() -> Self {
        let http = Client::builder().timeout(Duration::from_secs(20)).build().expect("http client");
        State { http, session: Mutex::new(None), connecting: AtomicBool::new(false), cancel: AtomicBool::new(false), error: Mutex::new(None) }
    }
}

#[derive(Deserialize)]
struct TokenReply {
    access_token: String,
    refresh_token: String,
    expires_in: u64,
    user: AuthUser,
}

#[derive(Deserialize)]
struct AuthUser {
    id: String,
    email: Option<String>,
}

fn with_key(req: RequestBuilder) -> RequestBuilder {
    req.header("apikey", KEY)
}

fn error_text(res: reqwest::blocking::Response) -> String {
    let status = res.status();
    let body: Value = res.json().unwrap_or_default();
    let msg = body["error"].as_str().or(body["msg"].as_str()).or(body["message"].as_str()).or(body["error_description"].as_str());
    msg.map(String::from).unwrap_or_else(|| format!("Sanctum's server said {status}."))
}

fn store(state: &State, t: TokenReply) -> Result<(), String> {
    secret::save_to(TARGET, &t.refresh_token)?;
    *state.session.lock().unwrap() = Some(Session {
        access: t.access_token,
        expires: Instant::now() + Duration::from_secs(t.expires_in.saturating_sub(60)),
        user_id: t.user.id,
        email: t.user.email,
    });
    Ok(())
}

/// A fresh access token and the user id, refreshing (and rotating) the stored token as needed.
fn session(state: &State) -> Result<(String, String), String> {
    if let Some(s) = state.session.lock().unwrap().as_ref().filter(|s| Instant::now() < s.expires) {
        return Ok((s.access.clone(), s.user_id.clone()));
    }
    let Some(refresh) = secret::load_from(TARGET) else { return Err("Sign in first.".into()) };
    let res = with_key(state.http.post(format!("{URL}/auth/v1/token?grant_type=refresh_token")))
        .json(&json!({ "refresh_token": refresh }))
        .send()
        .map_err(|_| "Can't reach Sanctum's server.".to_string())?;
    if res.status().as_u16() == 400 || res.status().as_u16() == 401 {
        // Revoked or rotated away: signed out.
        secret::clear_at(TARGET);
        *state.session.lock().unwrap() = None;
        return Err("Your sign-in expired. Sign in again.".into());
    }
    if !res.status().is_success() {
        return Err(error_text(res));
    }
    let t: TokenReply = res.json().map_err(|e| e.to_string())?;
    store(state, t)?;
    let s = state.session.lock().unwrap();
    let s = s.as_ref().unwrap();
    Ok((s.access.clone(), s.user_id.clone()))
}

fn authed(state: &State, req: RequestBuilder) -> Result<(RequestBuilder, String), String> {
    let (access, user) = session(state)?;
    Ok((with_key(req).bearer_auth(access), user))
}

fn send(req: RequestBuilder) -> Result<Value, String> {
    let res = req.send().map_err(|_| "Can't reach Sanctum's server.".to_string())?;
    if !res.status().is_success() {
        return Err(error_text(res));
    }
    let text = res.text().unwrap_or_default();
    Ok(serde_json::from_str(&text).unwrap_or(Value::Null))
}

// --- Sign-in -----------------------------------------------------------------------------

pub enum Method {
    Google,
    Email(String),
}

fn redirect_for(state_token: &str) -> String {
    format!("http://127.0.0.1:{REDIRECT_PORT}/auth/callback?s={state_token}")
}

pub fn google_url(redirect: &str, challenge: &str) -> String {
    reqwest::Url::parse_with_params(
        &format!("{URL}/auth/v1/authorize"),
        &[("provider", "google"), ("redirect_to", redirect), ("code_challenge", challenge), ("code_challenge_method", "s256")],
    )
    .expect("static URL")
    .to_string()
}

#[derive(Debug, PartialEq)]
pub enum Callback {
    Code(String),
    Failed(String),
    /// Some other request (a favicon); keep waiting.
    Other,
}

/// Reads `GET /auth/callback?s=...&code=... HTTP/1.1`.
pub fn parse_callback(request_line: &str, expected: &str) -> Callback {
    let target = request_line.split_whitespace().nth(1).unwrap_or("");
    let Ok(url) = reqwest::Url::parse(&format!("http://127.0.0.1{target}")) else { return Callback::Other };
    if url.path() != "/auth/callback" {
        return Callback::Other;
    }
    let get = |k: &str| url.query_pairs().find(|(key, _)| key == k).map(|(_, v)| v.into_owned());
    if get("s").as_deref() != Some(expected) {
        return Callback::Failed("That sign-in didn't come from Sanctum. Try again.".into());
    }
    if let Some(e) = get("error_description").or_else(|| get("error")) {
        return Callback::Failed(e);
    }
    get("code").map(Callback::Code).unwrap_or(Callback::Failed("No sign-in code came back.".into()))
}

fn page(heading: &str, body: &str) -> String {
    let html = format!(
        "<!doctype html><meta charset=utf-8><title>Sanctum</title>\
         <body style=\"margin:0;height:100vh;display:grid;place-items:center;background:#0B0D12;color:#E6E9EF;font:14px system-ui,sans-serif\">\
         <div style=\"text-align:center\"><h1 style=\"font-size:20px;margin:0 0 8px\">{heading}</h1>\
         <p style=\"margin:0;color:#8A93A6\">{body}</p></div>"
    );
    format!("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{html}", html.len())
}

fn wait_for_code(listener: &TcpListener, expected: &str, timeout: Duration, cancel: &AtomicBool) -> Result<String, String> {
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let deadline = Instant::now() + timeout;
    loop {
        if cancel.load(Ordering::SeqCst) {
            return Err("Sign-in was cancelled.".into());
        }
        if Instant::now() > deadline {
            return Err("Sign-in timed out. Try again.".into());
        }
        let (mut stream, _) = match listener.accept() {
            Ok(s) => s,
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(150));
                continue;
            }
            Err(e) => return Err(e.to_string()),
        };
        let _ = stream.set_nonblocking(false);
        let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
        let mut line = String::new();
        let _ = BufReader::new(&stream).read_line(&mut line);
        let result = parse_callback(&line, expected);
        let reply = match &result {
            Callback::Code(_) => page("You're signed in to Sanctum.", "Close this tab and go back to Sanctum."),
            Callback::Failed(e) => page("You're not signed in.", e),
            Callback::Other => "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".into(),
        };
        let _ = stream.write_all(reply.as_bytes());
        match result {
            Callback::Code(c) => return Ok(c),
            Callback::Failed(e) => return Err(e),
            Callback::Other => continue,
        }
    }
}

fn sign_in(app: &AppHandle, method: Method) -> Result<(), String> {
    let shared = app.state::<Shared>();
    let state = &shared.cloud;
    let listener = TcpListener::bind(("127.0.0.1", REDIRECT_PORT)).map_err(|_| format!("Port {REDIRECT_PORT} is busy. Close whatever uses it and try again."))?;
    let pkce = oauth::pkce();
    let expected = oauth::new_state();
    let redirect = redirect_for(&expected);
    let wait = match &method {
        Method::Google => {
            use tauri_plugin_opener::OpenerExt;
            app.opener().open_url(google_url(&redirect, &pkce.challenge), None::<&str>).map_err(|e| e.to_string())?;
            GOOGLE_WAIT
        }
        Method::Email(email) => {
            let url = reqwest::Url::parse_with_params(&format!("{URL}/auth/v1/otp"), &[("redirect_to", redirect.as_str())]).expect("static URL");
            send(with_key(state.http.post(url)).json(&json!({
                "email": email,
                "create_user": true,
                "code_challenge": pkce.challenge,
                "code_challenge_method": "s256",
            })))?;
            EMAIL_WAIT
        }
    };
    let code = wait_for_code(&listener, &expected, wait, &state.cancel)?;
    let t: TokenReply = serde_json::from_value(send(
        with_key(state.http.post(format!("{URL}/auth/v1/token?grant_type=pkce"))).json(&json!({ "auth_code": code, "code_verifier": pkce.verifier })),
    )?)
    .map_err(|e| e.to_string())?;
    store(state, t)?;
    // The name on Home becomes the name your partner sees.
    let name = shared.db.lock().ok().and_then(|c| crate::db::get_setting(&c, "display_name").ok().flatten()).filter(|n| !n.trim().is_empty());
    if let Some(name) = name {
        let (_, me) = session(state)?;
        if let Ok((req, _)) = authed(state, state.http.patch(format!("{URL}/rest/v1/profiles_user?id=eq.{me}"))) {
            let _ = send(req.json(&json!({ "display_name": name.trim() })));
        }
    }
    Ok(())
}

// --- Status and partner ------------------------------------------------------------------

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    /// This build has a Supabase project to talk to.
    pub configured: bool,
    pub signed_in: bool,
    pub email: Option<String>,
    pub connecting: bool,
    pub error: Option<String>,
}

fn status_of(state: &State) -> Status {
    let session = state.session.lock().unwrap();
    Status {
        configured: configured(),
        signed_in: configured() && (session.is_some() || secret::load_from(TARGET).is_some()),
        email: session.as_ref().and_then(|s| s.email.clone()),
        connecting: state.connecting.load(Ordering::SeqCst),
        error: state.error.lock().unwrap().clone(),
    }
}

fn emit(app: &AppHandle) {
    let _ = app.emit(EVENT, status_of(&app.state::<Shared>().cloud));
}

#[derive(Serialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Partner {
    pub email: Option<String>,
    pub name: Option<String>,
    /// "active" or "removal_requested".
    pub status: String,
    pub since: String,
}

#[derive(Serialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Invite {
    pub link: String,
    pub expires_at: String,
}

#[derive(Serialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PartnerStatus {
    pub email: Option<String>,
    pub partner: Option<Partner>,
    pub invite: Option<Invite>,
    /// People who chose you as their partner.
    pub partner_of: Vec<String>,
}

pub fn invite_link(token: &str) -> String {
    format!("{}/invite/{token}", PARTNER_URL.trim_end_matches('/'))
}

fn partner_status(state: &State) -> Result<PartnerStatus, String> {
    let (access, me) = session(state)?;
    let get = |path: &str| send(with_key(state.http.get(format!("{URL}/rest/v1/{path}"))).bearer_auth(&access));
    let links = get("partnerships?select=id,user_id,partner_id,status,created_at&status=neq.ended")?;
    let links = links.as_array().cloned().unwrap_or_default();
    let ids: Vec<String> = links.iter().flat_map(|l| [l["user_id"].as_str(), l["partner_id"].as_str()]).flatten().map(String::from).collect();
    let profiles = if ids.is_empty() { Value::Array(vec![]) } else { get(&format!("profiles_user?select=id,email,display_name&id=in.({})", ids.join(",")))? };
    let profile = |id: &str| profiles.as_array().and_then(|ps| ps.iter().find(|p| p["id"] == id)).cloned().unwrap_or_default();

    let mut out = PartnerStatus { email: profile(&me)["email"].as_str().map(String::from), ..Default::default() };
    for l in &links {
        if l["user_id"] == me.as_str() {
            let p = profile(l["partner_id"].as_str().unwrap_or(""));
            out.partner = Some(Partner {
                email: p["email"].as_str().map(String::from),
                name: p["display_name"].as_str().map(String::from),
                status: l["status"].as_str().unwrap_or("active").into(),
                since: l["created_at"].as_str().unwrap_or("").into(),
            });
        } else {
            let p = profile(l["user_id"].as_str().unwrap_or(""));
            out.partner_of.push(p["display_name"].as_str().or(p["email"].as_str()).unwrap_or("Someone").into());
        }
    }
    if out.partner.is_none() {
        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
        let invites = get(&format!("invites?select=token,expires_at&used_at=is.null&expires_at=gt.{now}&order=created_at.desc&limit=1"))?;
        out.invite = invites.get(0).map(|i| Invite { link: invite_link(i["token"].as_str().unwrap_or("")), expires_at: i["expires_at"].as_str().unwrap_or("").into() });
    }
    Ok(out)
}

/// The linked partner's name, or None when there's none (or you're signed out or offline).
pub fn partner_name(app: &AppHandle) -> Option<String> {
    let status = partner_status(&app.state::<Shared>().cloud).ok()?;
    status.partner.map(|p| p.name.or(p.email).unwrap_or_else(|| "your partner".into()))
}

/// Level 3 with a partner: files the request and emails them. Returns its id.
pub fn create_unlock_request(app: &AppHandle, reason: &str) -> Result<String, String> {
    let shared = app.state::<Shared>();
    let state = &shared.cloud;
    // The partner's approve screen shows the session and its time left.
    let view = shared.engine.view();
    let profile = view.as_ref().map(|v| v.profile_name.clone());
    let ends_at = view.as_ref().and_then(|v| chrono::DateTime::from_timestamp_millis(v.ends_at)).map(|t| t.to_rfc3339());
    let minutes_in = view.as_ref().map(|v| v.elapsed_ms / 60_000);
    let (req, me) = authed(state, state.http.post(format!("{URL}/rest/v1/unlock_requests")))?;
    let body = json!({ "user_id": me, "reason": reason, "level": 3, "profile_name": profile, "ends_at": ends_at });
    let rows = send(req.header("Prefer", "return=representation").json(&body))?;
    let id = rows.get(0).and_then(|r| r["id"].as_str()).ok_or("The request didn't come back.")?.to_string();
    if let Ok((req, _)) = authed(state, state.http.post(format!("{URL}/functions/v1/notify"))) {
        let _ = send(req.json(&json!({ "kind": "unlock_request", "detail": reason, "requestId": id, "profile": profile, "minutesIn": minutes_in })));
    }
    Ok(id)
}

/// The request's status ("pending", "approved", "denied", "expired") and the partner's note.
pub fn unlock_request_status(app: &AppHandle, id: &str) -> Result<(String, Option<String>), String> {
    let state = &app.state::<Shared>().cloud;
    let (req, _) = authed(state, state.http.get(format!("{URL}/rest/v1/unlock_requests?select=status,note&id=eq.{id}")))?;
    let rows = send(req)?;
    let row = rows.get(0).ok_or("The request is gone.")?;
    Ok((row["status"].as_str().unwrap_or("pending").to_string(), row["note"].as_str().map(String::from)))
}

pub fn cancel_unlock_request(app: &AppHandle, id: &str) {
    let state = &app.state::<Shared>().cloud;
    if let Ok((req, _)) = authed(state, state.http.post(format!("{URL}/rest/v1/rpc/cancel_unlock_request"))) {
        let _ = send(req.json(&json!({ "rid": id })));
    }
}

/// Tells the partner (if any) what happened. Best effort, off the calling thread.
pub fn notify(app: &AppHandle, kind: &'static str, detail: String) {
    if !configured() {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        let state = &app.state::<Shared>().cloud;
        if let Ok((req, _)) = authed(state, state.http.post(format!("{URL}/functions/v1/notify"))) {
            let _ = send(req.json(&json!({ "kind": kind, "detail": detail })));
        }
    });
}

// --- Commands ----------------------------------------------------------------------------

#[tauri::command]
pub fn cloud_status(shared: TauriState<Shared>) -> Status {
    status_of(&shared.cloud)
}

fn start_sign_in(app: AppHandle, method: Method) -> Result<Status, String> {
    if !configured() {
        return Err("Accounts aren't set up in this build. See docs/self-hosting.md.".into());
    }
    let state = &app.state::<Shared>().cloud;
    if state.connecting.swap(true, Ordering::SeqCst) {
        return Err("Already signing in.".into());
    }
    state.cancel.store(false, Ordering::SeqCst);
    *state.error.lock().unwrap() = None;
    let status = status_of(state);
    let handle = app.clone();
    std::thread::spawn(move || {
        let result = sign_in(&handle, method);
        let state = &handle.state::<Shared>().cloud;
        state.connecting.store(false, Ordering::SeqCst);
        *state.error.lock().unwrap() = result.err();
        emit(&handle);
    });
    emit(&app);
    Ok(status)
}

#[tauri::command]
pub fn cloud_sign_in_google(app: AppHandle) -> Result<Status, String> {
    start_sign_in(app, Method::Google)
}

#[tauri::command]
pub fn cloud_sign_in_email(app: AppHandle, email: String) -> Result<Status, String> {
    let email = email.trim().to_lowercase();
    if !email.contains('@') || email.contains(' ') || email.len() < 5 {
        return Err("That doesn't look like an email address.".into());
    }
    start_sign_in(app, Method::Email(email))
}

#[tauri::command]
pub fn cloud_cancel_sign_in(shared: TauriState<Shared>) {
    shared.cloud.cancel.store(true, Ordering::SeqCst);
}

#[tauri::command]
pub async fn cloud_sign_out(app: AppHandle) -> Result<Status, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = &app.state::<Shared>().cloud;
        if let Ok((req, _)) = authed(state, state.http.post(format!("{URL}/auth/v1/logout"))) {
            let _ = req.send();
        }
        secret::clear_at(TARGET);
        *state.session.lock().unwrap() = None;
        *state.error.lock().unwrap() = None;
        emit(&app);
        status_of(state)
    })
    .await
    .map_err(|e| e.to_string())
}

fn blocking<T: Send + 'static>(app: AppHandle, f: impl FnOnce(&State) -> Result<T, String> + Send + 'static) -> tauri::async_runtime::JoinHandle<Result<T, String>> {
    tauri::async_runtime::spawn_blocking(move || f(&app.state::<Shared>().cloud))
}

#[tauri::command]
pub async fn cloud_partner(app: AppHandle) -> Result<PartnerStatus, String> {
    blocking(app, partner_status).await.map_err(|e| e.to_string())?
}

/// Creates a fresh single-use invite link (48 hours), replacing any unused one.
#[tauri::command]
pub async fn cloud_create_invite(app: AppHandle) -> Result<PartnerStatus, String> {
    blocking(app, |state| {
        let (req, me) = authed(state, state.http.delete(format!("{URL}/rest/v1/invites?used_at=is.null")))?;
        send(req)?;
        let (req, _) = authed(state, state.http.post(format!("{URL}/rest/v1/invites")))?;
        send(req.header("Prefer", "return=minimal").json(&json!({ "user_id": me })))?;
        partner_status(state)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Has Sanctum email the open invite link to your partner-to-be (at most 5 a day).
#[tauri::command]
pub async fn cloud_email_invite(app: AppHandle, email: String) -> Result<PartnerStatus, String> {
    blocking(app, move |state| {
        let status = partner_status(state)?;
        let link = status.invite.as_ref().map(|i| i.link.clone()).ok_or("Make an invite link first.")?;
        let token = link.rsplit('/').next().unwrap_or_default().to_string();
        let (req, _) = authed(state, state.http.post(format!("{URL}/functions/v1/invite")))?;
        send(req.json(&json!({ "action": "email", "token": token, "email": email.trim() })))?;
        partner_status(state)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn cloud_cancel_invite(app: AppHandle) -> Result<PartnerStatus, String> {
    blocking(app, |state| {
        let (req, _) = authed(state, state.http.delete(format!("{URL}/rest/v1/invites?used_at=is.null")))?;
        send(req)?;
        partner_status(state)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Asks the partner to release you; they approve on their page (SPEC 4.6).
#[tauri::command]
pub async fn cloud_request_removal(app: AppHandle, shared: TauriState<'_, Shared>, cancel: bool) -> Result<PartnerStatus, String> {
    if !cancel && shared.engine.is_active() {
        return Err("Partner changes wait until the seal ends.".into());
    }
    blocking(app, move |state| {
        let rpc = if cancel { "cancel_partner_removal" } else { "request_partner_removal" };
        let (req, _) = authed(state, state.http.post(format!("{URL}/rest/v1/rpc/{rpc}")))?;
        send(req.json(&json!({})))?;
        partner_status(state)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_callback() {
        assert_eq!(parse_callback("GET /auth/callback?s=abc&code=xyz HTTP/1.1", "abc"), Callback::Code("xyz".into()));
        assert_eq!(parse_callback("GET /favicon.ico HTTP/1.1", "abc"), Callback::Other);
        assert!(matches!(parse_callback("GET /auth/callback?s=evil&code=xyz HTTP/1.1", "abc"), Callback::Failed(_)));
        assert_eq!(
            parse_callback("GET /auth/callback?s=abc&error=access_denied&error_description=Email+link+is+invalid HTTP/1.1", "abc"),
            Callback::Failed("Email link is invalid".into())
        );
    }

    #[test]
    fn builds_urls() {
        let r = redirect_for("st");
        assert_eq!(r, format!("http://127.0.0.1:{REDIRECT_PORT}/auth/callback?s=st"));
        let g = google_url(&r, "ch");
        assert!(g.starts_with(&format!("{URL}/auth/v1/authorize?provider=google&redirect_to=http%3A%2F%2F127.0.0.1")));
        assert!(g.ends_with("code_challenge=ch&code_challenge_method=s256"));
        assert!(invite_link("tok").ends_with("/invite/tok"));
    }
}
