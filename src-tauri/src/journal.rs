//! The journal (v0.2): one page per day, written with the notes editor, kept on this PC only
//! (never shared, never synced). A page is a block document plus its plain text.
//!
//! The optional lock (chosen in the journal's own setup): none, Windows Hello (face,
//! fingerprint, or the Windows PIN, through Windows' own prompt), or a journal PIN (argon2id).
//! While locked, the backend refuses to read or write pages, so the window can't show them by
//! mistake. It's a lock against people at this PC, not encryption at rest: the database file
//! holds the pages as it holds notes. The window relocks when you leave the Journal, hide
//! Sanctum, or idle.

use crate::{db, session::now_ms, Shared};
use argon2::{password_hash::SaltString, Argon2, PasswordHash, PasswordHasher, PasswordVerifier};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, State as TauriState};

const LOCK_KEY: &str = "journal_lock";
const PIN_KEY: &str = "journal_pin_hash";
const MAX_DOC: usize = 2_000_000;
const MAX_BODY: usize = 100_000;
/// Wrong PINs in a row before a pause.
const TRIES: u32 = 5;
const PAUSE: Duration = Duration::from_secs(30);

#[derive(Default)]
pub struct State {
    unlocked: AtomicBool,
    fails: Mutex<(u32, Option<Instant>)>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Day {
    pub date: String,
    pub doc: Option<String>,
    pub body: String,
    pub updated_at: i64,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LockStatus {
    /// "none", "hello", or "pin".
    pub lock: String,
    pub unlocked: bool,
    /// Windows Hello is set up on this PC.
    pub hello_available: bool,
}

fn valid_date(d: &str) -> bool {
    chrono::NaiveDate::parse_from_str(d, "%Y-%m-%d").is_ok()
}

pub fn get(conn: &Connection, date: &str) -> rusqlite::Result<Option<Day>> {
    conn.query_row("SELECT date, doc, body, updated_at FROM journal_days WHERE date = ?1", [date], |r| {
        Ok(Day { date: r.get(0)?, doc: r.get(1)?, body: r.get(2)?, updated_at: r.get(3)? })
    })
    .optional()
}

/// Saves a day's page; an empty one (nothing written beyond prompts) is removed instead.
pub fn save(conn: &Connection, date: &str, doc: Option<&str>, body: &str, now: i64) -> Result<Option<Day>, String> {
    if !valid_date(date) {
        return Err(format!("{date} is not a date."));
    }
    if body.chars().count() > MAX_BODY || doc.is_some_and(|d| d.len() > MAX_DOC) {
        return Err("That page is too long.".into());
    }
    if body.trim().is_empty() {
        conn.execute("DELETE FROM journal_days WHERE date = ?1", [date]).map_err(|e| e.to_string())?;
        return Ok(None);
    }
    conn.execute(
        "INSERT INTO journal_days (date, doc, body, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)
         ON CONFLICT(date) DO UPDATE SET doc = COALESCE(excluded.doc, journal_days.doc), body = excluded.body, updated_at = excluded.updated_at",
        params![date, doc, body, now],
    )
    .map_err(|e| e.to_string())?;
    get(conn, date).map_err(|e| e.to_string())
}

/// The days in [from, to] with a page.
pub fn written(conn: &Connection, from: &str, to: &str) -> rusqlite::Result<Vec<String>> {
    let mut stmt = conn.prepare("SELECT date FROM journal_days WHERE date BETWEEN ?1 AND ?2 ORDER BY date")?;
    let rows = stmt.query_map([from, to], |r| r.get(0))?;
    rows.collect()
}

pub fn lock_kind(conn: &Connection) -> String {
    db::get_setting(conn, LOCK_KEY).ok().flatten().filter(|k| k == "hello" || k == "pin").unwrap_or_else(|| "none".into())
}

pub fn hash_pin(pin: &str) -> Result<String, String> {
    if !(4..=8).contains(&pin.len()) || !pin.chars().all(|c| c.is_ascii_digit()) {
        return Err("Use a PIN of 4 to 8 digits.".into());
    }
    let salt = SaltString::encode_b64(&rand::random::<[u8; 16]>()).map_err(|e| e.to_string())?;
    Argon2::default().hash_password(pin.as_bytes(), &salt).map(|h| h.to_string()).map_err(|e| e.to_string())
}

pub fn pin_matches(hash: &str, pin: &str) -> bool {
    PasswordHash::new(hash).is_ok_and(|h| Argon2::default().verify_password(pin.as_bytes(), &h).is_ok())
}

/// Pages can be read and written now.
fn open(shared: &Shared, conn: &Connection) -> Result<(), String> {
    if lock_kind(conn) == "none" || shared.journal.unlocked.load(Ordering::SeqCst) {
        Ok(())
    } else {
        Err("The journal is locked.".into())
    }
}

#[cfg(windows)]
fn hello_available() -> bool {
    use windows::Security::Credentials::UI::{UserConsentVerifier, UserConsentVerifierAvailability};
    UserConsentVerifier::CheckAvailabilityAsync()
        .and_then(|op| op.join())
        .is_ok_and(|a| a == UserConsentVerifierAvailability::Available)
}

#[cfg(not(windows))]
fn hello_available() -> bool {
    false
}

/// Windows Hello's own prompt, over Sanctum's window. True when you verified.
#[cfg(windows)]
fn hello_verify(app: &AppHandle) -> Result<bool, String> {
    use windows::core::{factory, HSTRING};
    use windows::Security::Credentials::UI::{UserConsentVerificationResult, UserConsentVerifier};
    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::WinRT::IUserConsentVerifierInterop;
    let hwnd = app.get_webview_window("main").and_then(|w| w.hwnd().ok()).ok_or("Sanctum's window isn't open.")?;
    let interop = factory::<UserConsentVerifier, IUserConsentVerifierInterop>().map_err(|e| e.to_string())?;
    let op =
        unsafe { interop.RequestVerificationForWindowAsync::<windows_future::IAsyncOperation<UserConsentVerificationResult>>(HWND(hwnd.0), &HSTRING::from("Unlock your journal")) }.map_err(|e| e.to_string())?;
    let result = op.join().map_err(|e| e.to_string())?;
    Ok(result == UserConsentVerificationResult::Verified)
}

#[cfg(not(windows))]
fn hello_verify(_app: &AppHandle) -> Result<bool, String> {
    Err("Windows Hello isn't available here.".into())
}

fn status(shared: &Shared, conn: &Connection) -> LockStatus {
    let lock = lock_kind(conn);
    LockStatus { unlocked: lock == "none" || shared.journal.unlocked.load(Ordering::SeqCst), lock, hello_available: hello_available() }
}

fn with<T>(shared: &Shared, f: impl FnOnce(&Connection) -> Result<T, String>) -> Result<T, String> {
    let conn = shared.db.lock().map_err(|e| e.to_string())?;
    f(&conn)
}

#[tauri::command]
pub fn journal_status(shared: TauriState<Shared>) -> Result<LockStatus, String> {
    with(&shared, |c| Ok(status(&shared, c)))
}

#[tauri::command]
pub fn journal_get(shared: TauriState<Shared>, date: String) -> Result<Option<Day>, String> {
    with(&shared, |c| {
        open(&shared, c)?;
        get(c, &date).map_err(|e| e.to_string())
    })
}

#[tauri::command]
pub fn journal_save(shared: TauriState<Shared>, date: String, doc: Option<String>, body: String) -> Result<Option<Day>, String> {
    with(&shared, |c| {
        open(&shared, c)?;
        save(c, &date, doc.as_deref(), &body, now_ms())
    })
}

/// Which days in the range have a page (for the calendar strip's dots). Dates only, so it
/// works while locked.
#[tauri::command]
pub fn journal_written(shared: TauriState<Shared>, from: String, to: String) -> Result<Vec<String>, String> {
    with(&shared, |c| written(c, &from, &to).map_err(|e| e.to_string()))
}

/// Sets the lock (from the journal's setup): "none", "hello", or "pin" with a PIN. Changing it
/// needs the journal open, so a locked journal can't be unlocked by switching the lock off.
#[tauri::command]
pub fn journal_set_lock(shared: TauriState<Shared>, kind: String, pin: Option<String>) -> Result<LockStatus, String> {
    with(&shared, |c| {
        open(&shared, c)?;
        match kind.as_str() {
            "none" | "hello" => {
                if kind == "hello" && !hello_available() {
                    return Err("Windows Hello isn't set up on this PC.".into());
                }
                db::set_setting(c, LOCK_KEY, &kind).map_err(|e| e.to_string())?;
                c.execute("DELETE FROM settings WHERE key = ?1", [PIN_KEY]).map_err(|e| e.to_string())?;
            }
            "pin" => {
                let hash = hash_pin(pin.as_deref().unwrap_or(""))?;
                db::set_setting(c, PIN_KEY, &hash).map_err(|e| e.to_string())?;
                db::set_setting(c, LOCK_KEY, "pin").map_err(|e| e.to_string())?;
            }
            _ => return Err("Pick a lock: none, Windows Hello, or a PIN.".into()),
        }
        // Whoever just set it is the owner: it stays open until it relocks.
        shared.journal.unlocked.store(true, Ordering::SeqCst);
        Ok(status(&shared, c))
    })
}

#[tauri::command]
pub fn journal_unlock_pin(shared: TauriState<Shared>, pin: String) -> Result<LockStatus, String> {
    with(&shared, |c| {
        let mut fails = shared.journal.fails.lock().unwrap();
        if let Some(until) = fails.1.filter(|t| Instant::now() < *t) {
            return Err(format!("Too many tries. Wait {} s.", (until - Instant::now()).as_secs() + 1));
        }
        let hash = db::get_setting(c, PIN_KEY).map_err(|e| e.to_string())?.ok_or("The journal has no PIN.")?;
        if !pin_matches(&hash, &pin) {
            fails.0 += 1;
            if fails.0 >= TRIES {
                *fails = (0, Some(Instant::now() + PAUSE));
                return Err(format!("Too many tries. Wait {} s.", PAUSE.as_secs()));
            }
            return Err("That isn't the PIN.".into());
        }
        *fails = (0, None);
        shared.journal.unlocked.store(true, Ordering::SeqCst);
        Ok(status(&shared, c))
    })
}

#[tauri::command]
pub async fn journal_unlock_hello(app: AppHandle) -> Result<LockStatus, String> {
    let verified = tauri::async_runtime::spawn_blocking({
        let app = app.clone();
        move || hello_verify(&app)
    })
    .await
    .map_err(|e| e.to_string())??;
    let shared = app.state::<Shared>();
    if verified {
        shared.journal.unlocked.store(true, Ordering::SeqCst);
    }
    with(&shared, |c| Ok(status(&shared, c)))
}

#[tauri::command]
pub fn journal_lock(shared: TauriState<Shared>) {
    shared.journal.unlocked.store(false, Ordering::SeqCst);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fresh() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        db::prepare(&mut conn).unwrap();
        conn
    }

    #[test]
    fn a_page_per_day_and_empty_pages_go() {
        let conn = fresh();
        assert!(save(&conn, "Oct 29", None, "x", 1).is_err());
        let d = save(&conn, "2026-10-29", Some(r#"{"type":"doc"}"#), "Shipped it.", 1).unwrap().unwrap();
        assert_eq!((d.body.as_str(), d.updated_at), ("Shipped it.", 1));
        // An edit without a doc keeps the document.
        let d = save(&conn, "2026-10-29", None, "Shipped it. Tired.", 2).unwrap().unwrap();
        assert_eq!((d.doc.as_deref(), d.body.as_str()), (Some(r#"{"type":"doc"}"#), "Shipped it. Tired."));
        save(&conn, "2026-10-27", None, "Rest day.", 3).unwrap();
        assert_eq!(written(&conn, "2026-10-26", "2026-11-01").unwrap(), vec!["2026-10-27", "2026-10-29"]);
        // Cleared: the page goes.
        assert!(save(&conn, "2026-10-29", None, "  ", 4).unwrap().is_none());
        assert!(get(&conn, "2026-10-29").unwrap().is_none());
    }

    #[test]
    fn pins_are_digits_and_hashed() {
        assert!(hash_pin("12").is_err());
        assert!(hash_pin("12ab").is_err());
        let h = hash_pin("4821").unwrap();
        assert!(h.starts_with("$argon2"), "{h}");
        assert!(pin_matches(&h, "4821"));
        assert!(!pin_matches(&h, "4822"));
        assert_eq!(lock_kind(&fresh()), "none");
    }
}
