//! The browser extension's side of Sanctum (SPEC 4.4, BACKLOG 4b). Each browser starts
//! `sanctum-bridge.exe` (a copy of this exe, see bridge.rs) for its extension; the bridge
//! relays newline-delimited JSON to a localhost socket here, guarded by a token file.
//!
//! Sanctum sends the running seal's sites and keywords; the extension reports blocks (logged
//! as attempts) and the active tab's domain (never the full URL) for Activity. A browser whose
//! extension drops out mid-seal gets its windows minimized until it's back.

use crate::distractions::{self, Distraction};
use crate::{db, engine, session, winutil, Shared};
use rand::RngCore;
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::net::{Shutdown, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, State as TauriState};

pub const HOST_NAME: &str = "app.sanctum.bridge";
/// Fixed by the public key in extension/manifest.json.
pub const EXTENSION_ID: &str = "iiapijigajhpjklfkokmjobdfconijag";
pub const BRIDGE_EXE: &str = "sanctum-bridge.exe";
/// Connection and version changes, for Setup.
pub const EVENT: &str = "sanctum://browser";

/// A domain report older than this is stale (the heartbeat re-sends every 30s).
const DOMAIN_FRESH: Duration = Duration::from_secs(90);
/// How long a sealed browser may run without its extension before it counts.
const GRACE: Duration = Duration::from_secs(5);
/// Browsers whose extension has connected before (settings key). Only these are held to it,
/// so a browser you never set up isn't minimized.
const SEEN_KEY: &str = "browser_extension_seen";

/// Chromium browsers Sanctum registers its bridge with: name, exe, HKCU\Software subkey.
pub const BROWSERS: &[(&str, &str, &str)] = &[
    ("Comet", "comet.exe", "Perplexity\\Comet"),
    ("Chrome", "chrome.exe", "Google\\Chrome"),
    ("Edge", "msedge.exe", "Microsoft\\Edge"),
    ("Brave", "brave.exe", "BraveSoftware\\Brave-Browser"),
];

/// "Comet" for comet.exe.
fn browser_label(exe: &str) -> &str {
    BROWSERS.iter().find(|b| b.1 == exe).map_or(exe, |b| b.0)
}

/// Where the bridge finds this Sanctum: `%APPDATA%\<identifier>\bridge(-dev).json`.
pub fn token_file(app_data: &Path) -> PathBuf {
    app_data.join(if cfg!(debug_assertions) { "bridge-dev.json" } else { "bridge.json" })
}

struct Conn {
    exe: String,
    stream: TcpStream,
    version: Option<String>,
    incognito: Option<bool>,
    domain: Option<(String, Instant)>,
}

#[derive(Default)]
struct Inner {
    next_id: u64,
    conns: HashMap<u64, Conn>,
    /// The last rules sent, for new connections.
    rules: Value,
    /// Browser exe -> when it was first seen running without its extension this seal.
    missing: HashMap<String, Instant>,
    /// Browsers already logged as an attempt for the current gap.
    logged: Vec<String>,
    /// Browsers whose extension was connected when the seal started (tamper if it goes quiet).
    at_seal: Vec<String>,
}

pub struct State {
    inner: Mutex<Inner>,
    token: String,
}

impl State {
    pub fn new() -> Self {
        let mut bytes = [0u8; 24];
        rand::rng().fill_bytes(&mut bytes);
        let token = bytes.iter().map(|b| format!("{b:02x}")).collect();
        State { inner: Mutex::new(Inner { rules: json!({ "type": "rules", "sealed": false, "sites": [], "keywords": [] }), ..Default::default() }), token }
    }

    /// The active tab's domain in `exe`, when a fresh report says that browser is in front.
    pub fn active_domain(&self, exe: &str) -> Option<String> {
        let inner = self.inner.lock().unwrap();
        inner
            .conns
            .values()
            .filter(|c| c.exe == exe)
            .filter_map(|c| c.domain.as_ref())
            .filter(|(_, at)| at.elapsed() < DOMAIN_FRESH)
            .max_by_key(|(_, at)| *at)
            .map(|(d, _)| d.clone())
    }
}

fn send_line(stream: &mut TcpStream, msg: &Value) -> std::io::Result<()> {
    let mut line = msg.to_string();
    line.push('\n');
    stream.write_all(line.as_bytes())
}

/// What the extension should enforce right now: the flagged sites and keywords while sealed.
pub fn rules_message(active: Option<&session::SessionView>, flags: &[Distraction]) -> Value {
    let Some(a) = active else {
        return json!({ "type": "rules", "sealed": false, "sites": [], "keywords": [] });
    };
    let sites: Vec<Value> = flags
        .iter()
        .filter(|d| d.kind == "site")
        .map(|d| json!({ "domain": d.value, "allow": d.allow.iter().map(|x| x.prefix.clone()).collect::<Vec<_>>() }))
        .collect();
    let keywords: Vec<String> = flags.iter().filter(|d| d.kind == "keyword").map(|d| d.value.to_lowercase()).collect();
    json!({ "type": "rules", "sealed": true, "profile": a.profile_name, "endsAt": a.ends_at, "sites": sites, "keywords": keywords })
}

fn needs_extension(rules: &Value) -> bool {
    rules["sealed"].as_bool() == Some(true)
        && (rules["sites"].as_array().is_some_and(|s| !s.is_empty()) || rules["keywords"].as_array().is_some_and(|k| !k.is_empty()))
}

/// Recomputes the rules from the running session and sends them to every connected browser.
/// Called whenever the seal starts, resumes, or ends.
pub fn push_rules(app: &AppHandle) {
    let shared = app.state::<Shared>();
    let view = shared.engine.view();
    let flags = shared.db.lock().ok().and_then(|c| distractions::list(&c).ok()).unwrap_or_default();
    let msg = rules_message(view.as_ref(), &flags);
    let mut inner = shared.browser.inner.lock().unwrap();
    inner.rules = msg.clone();
    inner.missing.clear();
    inner.logged.clear();
    inner.conns.retain(|_, c| send_line(&mut c.stream, &msg).is_ok());
    inner.at_seal = if view.is_some() { inner.conns.values().map(|c| c.exe.clone()).collect() } else { Vec::new() };
}

fn emit_status(app: &AppHandle) {
    let _ = app.emit(EVENT, ());
}

/// Starts the localhost server and writes the token file the bridge reads.
pub fn start(app: &AppHandle, app_data: &Path) -> std::io::Result<()> {
    let listener = TcpListener::bind(("127.0.0.1", 0))?;
    let port = listener.local_addr()?.port();
    let token = app.state::<Shared>().browser.token.clone();
    std::fs::write(token_file(app_data), json!({ "port": port, "token": token }).to_string())?;
    let app = app.clone();
    std::thread::Builder::new().name("sanctum-browser".into()).spawn(move || {
        for stream in listener.incoming().flatten() {
            let app = app.clone();
            let _ = std::thread::Builder::new().name("sanctum-browser-conn".into()).spawn(move || serve(&app, stream));
        }
    })?;
    Ok(())
}

fn serve(app: &AppHandle, stream: TcpStream) {
    let shared = app.state::<Shared>();
    let _ = stream.set_read_timeout(Some(Duration::from_secs(10)));
    let Ok(writer) = stream.try_clone() else { return };
    let mut lines = BufReader::new(stream).lines();

    // The first line proves the bridge read our token file.
    let Some(Ok(first)) = lines.next() else { return };
    let auth: Value = serde_json::from_str(&first).unwrap_or_default();
    if auth["type"] != "auth" || auth["token"].as_str() != Some(shared.browser.token.as_str()) {
        let _ = writer.shutdown(Shutdown::Both);
        return;
    }
    let exe = auth["browser"].as_str().unwrap_or("").to_lowercase();
    // The heartbeat is every 30s; a minute of silence means it's gone.
    let _ = writer.set_read_timeout(Some(Duration::from_secs(70)));

    let id = {
        let mut inner = shared.browser.inner.lock().unwrap();
        let id = inner.next_id;
        inner.next_id += 1;
        let mut w = match writer.try_clone() {
            Ok(w) => w,
            Err(_) => return,
        };
        let _ = send_line(&mut w, &inner.rules);
        inner.conns.insert(id, Conn { exe: exe.clone(), stream: w, version: None, incognito: None, domain: None });
        inner.missing.remove(&exe);
        inner.logged.retain(|e| *e != exe);
        id
    };
    mark_seen(&shared, &exe);
    emit_status(app);

    for line in lines {
        let Ok(line) = line else { break };
        let Ok(msg) = serde_json::from_str::<Value>(&line) else { continue };
        handle(app, &shared, id, &msg);
    }

    shared.browser.inner.lock().unwrap().conns.remove(&id);
    let _ = writer.shutdown(Shutdown::Both);
    emit_status(app);
}

fn handle(app: &AppHandle, shared: &Shared, id: u64, msg: &Value) {
    match msg["type"].as_str() {
        Some("hello") => {
            if let Some(c) = shared.browser.inner.lock().unwrap().conns.get_mut(&id) {
                c.version = msg["version"].as_str().map(String::from);
                c.incognito = msg["incognito"].as_bool();
            }
            emit_status(app);
        }
        Some("active") => {
            if let Some(c) = shared.browser.inner.lock().unwrap().conns.get_mut(&id) {
                c.domain = msg["domain"].as_str().map(|d| (d.to_lowercase(), Instant::now()));
            }
        }
        Some("blocked") => {
            // Only the site (or the keyword) is kept, never the page.
            let what = msg["keyword"].as_str().map(|k| format!("“{k}”")).or_else(|| msg["site"].as_str().map(String::from));
            if let Some(what) = what.filter(|w| !w.is_empty()) {
                engine::record_external_attempt(app, &what, "site");
            }
        }
        Some("open-sanctum") => crate::show_main_window(app),
        _ => {}
    }
}

fn seen(conn: &rusqlite::Connection) -> Vec<String> {
    db::get_setting(conn, SEEN_KEY).ok().flatten().unwrap_or_default().split(',').filter(|s| !s.is_empty()).map(String::from).collect()
}

fn mark_seen(shared: &Shared, exe: &str) {
    if exe.is_empty() {
        return;
    }
    if let Ok(conn) = shared.db.lock() {
        let mut list = seen(&conn);
        if !list.iter().any(|e| e == exe) {
            list.push(exe.to_string());
            let _ = db::set_setting(&conn, SEEN_KEY, &list.join(","));
        }
    }
}

/// While a seal needs the extension, a browser that had it and now runs without it is
/// minimized, and the gap is logged once as an attempt.
pub fn spawn_watch(app: AppHandle) {
    std::thread::Builder::new()
        .name("sanctum-browser-watch".into())
        .spawn(move || {
            let mut sys = sysinfo::System::new();
            loop {
                std::thread::sleep(Duration::from_secs(1));
                watch(&app, &mut sys);
            }
        })
        .expect("browser watch thread");
}

fn watch(app: &AppHandle, sys: &mut sysinfo::System) {
    use sysinfo::{ProcessRefreshKind, ProcessesToUpdate};
    let shared = app.state::<Shared>();
    let held: Vec<String> = {
        let inner = shared.browser.inner.lock().unwrap();
        if !needs_extension(&inner.rules) {
            return;
        }
        let connected: Vec<&str> = inner.conns.values().map(|c| c.exe.as_str()).collect();
        let Ok(conn) = shared.db.lock() else { return };
        seen(&conn).into_iter().filter(|e| !connected.contains(&e.as_str())).collect()
    };
    if held.is_empty() {
        return;
    }
    sys.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::nothing());
    for exe in held {
        let pids: Vec<u32> = sys
            .processes()
            .iter()
            .filter(|(_, p)| p.name().to_string_lossy().eq_ignore_ascii_case(&exe))
            .map(|(pid, _)| pid.as_u32())
            .collect();
        let mut inner = shared.browser.inner.lock().unwrap();
        if pids.is_empty() {
            inner.missing.remove(&exe);
            continue;
        }
        let since = *inner.missing.entry(exe.clone()).or_insert_with(Instant::now);
        if since.elapsed() < GRACE {
            continue;
        }
        // Its extension was on when the seal started and the browser is still open without it.
        if inner.at_seal.contains(&exe) && since.elapsed() >= crate::tamper::EXTENSION_GRACE {
            drop(inner);
            crate::tamper::break_seal(app, "extension", format!("the {} extension was turned off", browser_label(&exe)));
            winutil::minimize_windows_of(&pids);
            continue;
        }
        let first = !inner.logged.contains(&exe);
        if first {
            inner.logged.push(exe.clone());
        }
        drop(inner);
        winutil::minimize_windows_of(&pids);
        if first {
            engine::record_external_attempt(app, &exe, "extension");
            emit_status(app);
        }
    }
}

/// Copies this exe to `<app data>\bridge\sanctum-bridge.exe` (so rebuilding Sanctum never
/// fights a bridge the browser is running), writes the host manifest, and registers it with
/// every installed Chromium browser.
pub fn register(app_data: &Path) -> std::io::Result<()> {
    let dir = app_data.join("bridge");
    std::fs::create_dir_all(&dir)?;
    let exe = dir.join(BRIDGE_EXE);
    let current = std::env::current_exe()?;
    let stale = match (std::fs::metadata(&current), std::fs::metadata(&exe)) {
        (Ok(a), Ok(b)) => a.len() != b.len() || a.modified().ok() > b.modified().ok(),
        _ => true,
    };
    if stale {
        // In use by a running bridge: keep the old copy until next start.
        let _ = std::fs::copy(&current, &exe);
    }
    let manifest = dir.join(format!("{HOST_NAME}.json"));
    let body = json!({
        "name": HOST_NAME,
        "description": "Sanctum",
        "path": exe,
        "type": "stdio",
        "allowed_origins": [format!("chrome-extension://{EXTENSION_ID}/")],
    });
    std::fs::write(&manifest, serde_json::to_string_pretty(&body)?)?;
    for (_, _, key) in BROWSERS {
        if reg::installed(key) {
            let _ = reg::set_host(key, &manifest);
        }
    }
    Ok(())
}

#[cfg(windows)]
mod reg {
    use super::HOST_NAME;
    use std::path::Path;
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ};
    use winreg::RegKey;

    pub fn installed(key: &str) -> bool {
        let path = format!("Software\\{key}");
        RegKey::predef(HKEY_CURRENT_USER).open_subkey_with_flags(&path, KEY_READ).is_ok()
            || RegKey::predef(HKEY_LOCAL_MACHINE).open_subkey_with_flags(&path, KEY_READ).is_ok()
    }

    fn host_key(key: &str) -> String {
        format!("Software\\{key}\\NativeMessagingHosts\\{HOST_NAME}")
    }

    pub fn set_host(key: &str, manifest: &Path) -> std::io::Result<()> {
        let (k, _) = RegKey::predef(HKEY_CURRENT_USER).create_subkey(host_key(key))?;
        k.set_value("", &manifest.display().to_string())
    }

    pub fn registered(key: &str, manifest: &Path) -> bool {
        RegKey::predef(HKEY_CURRENT_USER)
            .open_subkey(host_key(key))
            .and_then(|k| k.get_value::<String, _>(""))
            .is_ok_and(|v| Path::new(&v) == manifest)
    }
}

#[cfg(not(windows))]
mod reg {
    use std::path::Path;
    pub fn installed(_key: &str) -> bool {
        false
    }
    pub fn set_host(_key: &str, _manifest: &Path) -> std::io::Result<()> {
        Ok(())
    }
    pub fn registered(_key: &str, _manifest: &Path) -> bool {
        false
    }
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BrowserInfo {
    pub name: String,
    pub exe: String,
    pub installed: bool,
    pub registered: bool,
    pub connected: bool,
    pub version: Option<String>,
    /// Whether the extension may run in private windows. None until it says hello.
    pub incognito: Option<bool>,
    /// Running without its extension during a seal that needs it.
    pub missing: bool,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BrowserStatus {
    pub extension_dir: String,
    pub extension_id: String,
    pub browsers: Vec<BrowserInfo>,
}

/// The unpacked extension to load (dev builds use the repo copy; installers ship it in M13).
fn extension_dir() -> PathBuf {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("extension");
    let dir = dir.canonicalize().unwrap_or(dir);
    // canonicalize() adds a \\?\ prefix that people shouldn't have to paste.
    PathBuf::from(dir.display().to_string().trim_start_matches(r"\\?\"))
}

#[tauri::command]
pub fn browser_status(app: AppHandle, shared: TauriState<Shared>) -> Result<BrowserStatus, String> {
    let manifest = app.path().app_data_dir().map_err(|e| e.to_string())?.join("bridge").join(format!("{HOST_NAME}.json"));
    let inner = shared.browser.inner.lock().unwrap();
    let browsers = BROWSERS
        .iter()
        .map(|(name, exe, key)| {
            let conn = inner.conns.values().filter(|c| c.exe == *exe).max_by_key(|c| c.version.is_some());
            BrowserInfo {
                name: name.to_string(),
                exe: exe.to_string(),
                installed: reg::installed(key),
                registered: reg::registered(key, &manifest),
                connected: conn.is_some(),
                version: conn.and_then(|c| c.version.clone()),
                incognito: conn.and_then(|c| c.incognito),
                missing: inner.logged.iter().any(|e| e == exe),
            }
        })
        .collect();
    Ok(BrowserStatus { extension_dir: extension_dir().display().to_string(), extension_id: EXTENSION_ID.into(), browsers })
}

#[tauri::command]
pub fn browser_open_extension_dir(app: AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener().open_path(extension_dir().display().to_string(), None::<&str>).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::distractions::Allow;

    fn flag(kind: &str, value: &str, allow: &[&str]) -> Distraction {
        Distraction {
            id: 0,
            kind: kind.into(),
            value: value.into(),
            label: None,
            path: None,
            allow: allow.iter().enumerate().map(|(i, p)| Allow { id: i as i64, prefix: p.to_string() }).collect(),
        }
    }

    fn view() -> session::SessionView {
        session::SessionView {
            id: 1,
            profile_id: Some(1),
            profile_name: "Deep Study".into(),
            planned_minutes: 60,
            started_at: 0,
            ends_at: 3_600_000,
            remaining_ms: 3_600_000,
            elapsed_ms: 0,
            attempts: 0,
            sealed_count: 0,
            broken: false,
            idle: false,
        }
    }

    #[test]
    fn sends_flagged_sites_with_exceptions_and_keywords() {
        let flags = vec![flag("site", "youtube.com", &["youtube.com/@mitocw"]), flag("app", "discord.exe", &[]), flag("keyword", "Shorts", &[])];
        let msg = rules_message(Some(&view()), &flags);
        assert_eq!(msg["sealed"], true);
        assert_eq!(msg["profile"], "Deep Study");
        assert_eq!(msg["endsAt"], 3_600_000);
        assert_eq!(msg["sites"], json!([{ "domain": "youtube.com", "allow": ["youtube.com/@mitocw"] }]));
        assert_eq!(msg["keywords"], json!(["shorts"]));
        assert!(needs_extension(&msg));

        let open = rules_message(None, &flags);
        assert_eq!(open["sealed"], false);
        assert!(!needs_extension(&open));

        // A seal with only apps doesn't need the extension.
        assert!(!needs_extension(&rules_message(Some(&view()), &[flag("app", "discord.exe", &[])])));
    }

    #[test]
    fn token_file_is_per_build() {
        let f = token_file(Path::new("C:\\data"));
        let name = f.file_name().unwrap().to_string_lossy().to_string();
        assert!(name == "bridge-dev.json" || name == "bridge.json");
    }
}
