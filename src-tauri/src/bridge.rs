//! Bridge mode (4b). A browser starts its native messaging host with the extension's origin as
//! an argument; Sanctum registers a copy of its own exe as that host, so when launched that way
//! it skips the app entirely and relays: native messages on stdin/stdout (4-byte little-endian
//! length, then JSON) to and from the running Sanctum's localhost socket (lines of JSON).
//!
//! The extension hears `online` when Sanctum is reachable (and says hello again) and `offline`
//! when it isn't, so it keeps enforcing the last rules it got.

use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpStream;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

const RETRY: Duration = Duration::from_secs(2);
/// Chrome's limit for messages from a host is 1 MB; ours are tiny.
const MAX_MESSAGE: u32 = 1024 * 1024;

/// Launched by a browser for the extension.
pub fn is_launch() -> bool {
    std::env::args().skip(1).any(|a| a.starts_with("chrome-extension://"))
}

pub fn run() {
    let stream: Arc<Mutex<Option<TcpStream>>> = Arc::new(Mutex::new(None));
    let browser = browser_exe();

    // Browser -> Sanctum. Ends the process when the browser closes the port.
    {
        let stream = stream.clone();
        std::thread::spawn(move || {
            let mut stdin = std::io::stdin().lock();
            while let Some(msg) = read_message(&mut stdin) {
                if let Some(s) = stream.lock().unwrap().as_mut() {
                    let _ = s.write_all(format!("{msg}\n").as_bytes());
                }
            }
            std::process::exit(0);
        });
    }

    // Sanctum -> browser, reconnecting whenever Sanctum restarts.
    let mut stdout = std::io::stdout().lock();
    let mut online = None;
    loop {
        let Some(s) = connect(&browser) else {
            if online != Some(false) {
                online = Some(false);
                let _ = write_message(&mut stdout, &json!({ "type": "offline" }));
            }
            std::thread::sleep(RETRY);
            continue;
        };
        let Ok(reader) = s.try_clone() else { continue };
        let _ = s.set_nodelay(true);
        *stream.lock().unwrap() = Some(s);
        online = Some(true);
        let _ = write_message(&mut stdout, &json!({ "type": "online" }));
        for line in BufReader::new(reader).lines() {
            let Ok(line) = line else { break };
            let Ok(msg) = serde_json::from_str::<Value>(&line) else { continue };
            if write_message(&mut stdout, &msg).is_err() {
                std::process::exit(0);
            }
        }
        *stream.lock().unwrap() = None;
    }
}

fn token_file() -> Option<PathBuf> {
    let dir = PathBuf::from(std::env::var_os("APPDATA")?).join("app.sanctum.desktop");
    Some(crate::browser::token_file(&dir))
}

fn connect(browser: &str) -> Option<TcpStream> {
    let cfg: Value = serde_json::from_str(&std::fs::read_to_string(token_file()?).ok()?).ok()?;
    let port = cfg["port"].as_u64()? as u16;
    let mut s = TcpStream::connect_timeout(&([127, 0, 0, 1], port).into(), Duration::from_secs(2)).ok()?;
    let auth = json!({ "type": "auth", "token": cfg["token"], "browser": browser });
    s.write_all(format!("{auth}\n").as_bytes()).ok()?;
    Some(s)
}

/// The browser that started us. Chrome on Windows starts hosts through cmd.exe, so walk up
/// past shells to the first real parent.
fn browser_exe() -> String {
    use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System};
    let mut sys = System::new();
    sys.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::nothing());
    let mut pid = sysinfo::get_current_pid().ok();
    for _ in 0..4 {
        let Some(parent) = pid.and_then(|p| sys.process(p)).and_then(|p| p.parent()) else { break };
        let Some(proc_) = sys.process(parent) else { break };
        let name = proc_.name().to_string_lossy().to_lowercase();
        if !["cmd.exe", "conhost.exe"].contains(&name.as_str()) {
            return name;
        }
        pid = Some(parent);
    }
    String::new()
}

pub fn read_message(r: &mut impl Read) -> Option<Value> {
    let mut len = [0u8; 4];
    r.read_exact(&mut len).ok()?;
    let len = u32::from_le_bytes(len);
    if len > MAX_MESSAGE {
        return None;
    }
    let mut buf = vec![0u8; len as usize];
    r.read_exact(&mut buf).ok()?;
    // A malformed message is skipped, not fatal.
    Some(serde_json::from_slice(&buf).unwrap_or(Value::Null))
}

pub fn write_message(w: &mut impl Write, msg: &Value) -> std::io::Result<()> {
    let body = msg.to_string();
    w.write_all(&(body.len() as u32).to_le_bytes())?;
    w.write_all(body.as_bytes())?;
    w.flush()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frames_native_messages() {
        let mut buf = Vec::new();
        write_message(&mut buf, &json!({ "type": "ping" })).unwrap();
        assert_eq!(&buf[..4], &(15u32).to_le_bytes());
        write_message(&mut buf, &json!({ "type": "active", "domain": "youtube.com" })).unwrap();
        let mut r = buf.as_slice();
        assert_eq!(read_message(&mut r), Some(json!({ "type": "ping" })));
        assert_eq!(read_message(&mut r).unwrap()["domain"], "youtube.com");
        assert_eq!(read_message(&mut r), None);
        // Oversized lengths are refused rather than allocated.
        let mut huge = (MAX_MESSAGE + 1).to_le_bytes().to_vec();
        huge.extend_from_slice(b"{}");
        assert_eq!(read_message(&mut huge.as_slice()), None);
    }
}
