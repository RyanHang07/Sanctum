//! Google sign-in for a desktop app (SPEC 4.3): the system browser, a loopback redirect to
//! 127.0.0.1 on a random port, and PKCE. The client ID and secret are compiled in from
//! src-tauri/.env (a desktop client's secret is not confidential, per Google's own docs).

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use rand::RngCore;
use reqwest::blocking::Client;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

pub const CLIENT_ID: &str = env!("GOOGLE_CLIENT_ID");
const CLIENT_SECRET: &str = env!("GOOGLE_CLIENT_SECRET");

const AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const REVOKE_URL: &str = "https://oauth2.googleapis.com/revoke";
/// Full calendar access: Sanctum creates its own calendar and edits events on yours.
pub const SCOPES: &str = "openid email https://www.googleapis.com/auth/calendar";

pub fn configured() -> bool {
    !CLIENT_ID.is_empty() && !CLIENT_SECRET.is_empty()
}

fn random_token() -> String {
    let mut bytes = [0u8; 32];
    rand::rng().fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

pub fn challenge_for(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

pub struct Pkce {
    pub verifier: String,
    pub challenge: String,
}

pub fn pkce() -> Pkce {
    let verifier = random_token();
    let challenge = challenge_for(&verifier);
    Pkce { verifier, challenge }
}

pub fn new_state() -> String {
    random_token()
}

pub fn auth_url(redirect: &str, challenge: &str, state: &str) -> String {
    reqwest::Url::parse_with_params(
        AUTH_URL,
        &[
            ("client_id", CLIENT_ID),
            ("redirect_uri", redirect),
            ("response_type", "code"),
            ("scope", SCOPES),
            ("code_challenge", challenge),
            ("code_challenge_method", "S256"),
            ("state", state),
            // A refresh token every time, so reconnecting after a revoke works.
            ("access_type", "offline"),
            ("prompt", "consent"),
        ],
    )
    .expect("static auth URL")
    .to_string()
}

#[derive(Debug, PartialEq)]
pub enum Callback {
    Code(String),
    Denied,
    /// Some other request (a favicon); keep waiting.
    Other,
}

/// Reads the redirect's request line: `GET /?state=...&code=... HTTP/1.1`.
pub fn parse_callback(request_line: &str, expected_state: &str) -> Result<Callback, String> {
    let target = request_line.split_whitespace().nth(1).unwrap_or("");
    let Ok(url) = reqwest::Url::parse(&format!("http://127.0.0.1{target}")) else { return Ok(Callback::Other) };
    if url.path() != "/" {
        return Ok(Callback::Other);
    }
    let get = |k: &str| url.query_pairs().find(|(key, _)| key == k).map(|(_, v)| v.into_owned());
    if get("state").as_deref() != Some(expected_state) {
        return if get("code").is_some() || get("error").is_some() {
            Err("That sign-in didn't come from Sanctum. Try again.".into())
        } else {
            Ok(Callback::Other)
        };
    }
    if get("error").is_some() {
        return Ok(Callback::Denied);
    }
    get("code").map(Callback::Code).ok_or_else(|| "Google didn't send a sign-in code.".into())
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

/// Waits for Google to redirect back with a code, until `timeout` or `cancel`.
pub fn wait_for_code(listener: &TcpListener, state: &str, timeout: Duration, cancel: &AtomicBool) -> Result<String, String> {
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let deadline = Instant::now() + timeout;
    loop {
        if cancel.load(Ordering::SeqCst) {
            return Err("Connecting was cancelled.".into());
        }
        if Instant::now() > deadline {
            return Err("Google sign-in timed out. Try again.".into());
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
        let result = parse_callback(&line, state);
        let reply = match &result {
            Ok(Callback::Code(_)) => page("Sanctum is connected.", "Close this tab and go back to Sanctum."),
            Ok(Callback::Denied) => page("Nothing was connected.", "Google Calendar stays off. Close this tab."),
            Ok(Callback::Other) => "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".into(),
            Err(e) => page("Nothing was connected.", e),
        };
        let _ = stream.write_all(reply.as_bytes());
        match result {
            Ok(Callback::Code(code)) => return Ok(code),
            Ok(Callback::Denied) => return Err("Google sign-in was cancelled.".into()),
            Ok(Callback::Other) => continue,
            Err(e) => return Err(e),
        }
    }
}

#[derive(Deserialize, Debug)]
pub struct Tokens {
    pub access_token: String,
    pub expires_in: u64,
    #[serde(default)]
    pub refresh_token: Option<String>,
    #[serde(default)]
    pub id_token: Option<String>,
}

#[derive(Debug)]
pub enum AuthError {
    /// The refresh token was revoked or expired (7 days in Testing mode): sign in again.
    Revoked,
    Other(String),
}

impl std::fmt::Display for AuthError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AuthError::Revoked => write!(f, "Google sign-in expired. Reconnect in Setup."),
            AuthError::Other(e) => write!(f, "{e}"),
        }
    }
}

fn token_request(http: &Client, form: &[(&str, &str)]) -> Result<Tokens, AuthError> {
    let res = http
        .post(TOKEN_URL)
        .form(form)
        .send()
        .map_err(|_| AuthError::Other("Google is unreachable. Check your connection.".into()))?;
    let status = res.status();
    let body: serde_json::Value = res.json().map_err(|e| AuthError::Other(e.to_string()))?;
    if status.is_success() {
        return serde_json::from_value(body).map_err(|e| AuthError::Other(e.to_string()));
    }
    match body["error"].as_str() {
        Some("invalid_grant") => Err(AuthError::Revoked),
        Some(e) => Err(AuthError::Other(format!("Google refused the sign-in ({e})."))),
        None => Err(AuthError::Other(format!("Google returned {status}."))),
    }
}

pub fn exchange(http: &Client, code: &str, verifier: &str, redirect: &str) -> Result<Tokens, AuthError> {
    token_request(
        http,
        &[
            ("client_id", CLIENT_ID),
            ("client_secret", CLIENT_SECRET),
            ("code", code),
            ("code_verifier", verifier),
            ("redirect_uri", redirect),
            ("grant_type", "authorization_code"),
        ],
    )
}

pub fn refresh(http: &Client, refresh_token: &str) -> Result<Tokens, AuthError> {
    token_request(
        http,
        &[
            ("client_id", CLIENT_ID),
            ("client_secret", CLIENT_SECRET),
            ("refresh_token", refresh_token),
            ("grant_type", "refresh_token"),
        ],
    )
}

pub fn revoke(http: &Client, token: &str) {
    let _ = http.post(REVOKE_URL).form(&[("token", token)]).send();
}

/// The account's email from the ID token. It came straight from Google's token endpoint over
/// TLS, so reading the payload without verifying the signature is fine here.
pub fn email_from_id_token(id_token: &str) -> Option<String> {
    let payload = id_token.split('.').nth(1)?;
    let bytes = URL_SAFE_NO_PAD.decode(payload.trim_end_matches('=')).ok()?;
    let v: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
    v["email"].as_str().map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pkce_matches_the_rfc_example() {
        // RFC 7636 appendix B.
        assert_eq!(challenge_for("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
        let p = pkce();
        assert_eq!(p.verifier.len(), 43);
        assert_eq!(p.challenge, challenge_for(&p.verifier));
        assert_ne!(new_state(), new_state());
    }

    #[test]
    fn builds_the_consent_url() {
        let url = reqwest::Url::parse(&auth_url("http://127.0.0.1:5173", "abc", "xyz")).unwrap();
        let q: std::collections::HashMap<_, _> = url.query_pairs().into_owned().collect();
        assert_eq!(q["redirect_uri"], "http://127.0.0.1:5173");
        assert_eq!(q["code_challenge_method"], "S256");
        assert_eq!(q["access_type"], "offline");
        assert!(q["scope"].contains("auth/calendar"));
    }

    #[test]
    fn reads_the_redirect() {
        let line = "GET /?state=s1&code=4%2F0Ab&scope=email HTTP/1.1\r\n";
        assert_eq!(parse_callback(line, "s1").unwrap(), Callback::Code("4/0Ab".into()));
        assert_eq!(parse_callback("GET /?state=s1&error=access_denied HTTP/1.1", "s1").unwrap(), Callback::Denied);
        assert_eq!(parse_callback("GET /favicon.ico HTTP/1.1", "s1").unwrap(), Callback::Other);
        assert!(parse_callback("GET /?state=other&code=x HTTP/1.1", "s1").is_err());
    }

    #[test]
    fn reads_email_from_id_token() {
        let payload = URL_SAFE_NO_PAD.encode(br#"{"email":"someone@example.com"}"#);
        assert_eq!(email_from_id_token(&format!("h.{payload}.sig")).as_deref(), Some("someone@example.com"));
        assert_eq!(email_from_id_token("junk"), None);
    }
}
