//! The journal (v0.2): one page per day, written with the notes editor, kept on this PC only
//! (never shared, never synced). A page is a block document plus its plain text.
//!
//! The optional lock (chosen in the journal's own setup): none, Windows Hello (face,
//! fingerprint, or the Windows PIN, through Windows' own prompt), or a journal PIN (argon2id).
//! While locked, the backend refuses to read or write pages, so the window can't show them by
//! mistake. It's a lock against people at this PC, not encryption at rest: the database file
//! holds the pages as it holds notes. The window relocks when you leave the Journal, hide
//! Sanctum, or idle.

use crate::engine::Locked;
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

/// The pause after `fails` wrong PINs in a row: 30 s, then 1 min, 2 min, … up to an hour.
pub fn pause_after(fails: u32) -> Duration {
    let rounds = (fails / TRIES).saturating_sub(1).min(7);
    (PAUSE * 2u32.pow(rounds)).min(Duration::from_secs(3600))
}

#[derive(Default)]
pub struct State {
    unlocked: AtomicBool,
    fails: Mutex<(u32, Option<Instant>)>,
    /// Whether Windows Hello is set up, and when that was asked (2026-11-17): the WinRT check
    /// can take seconds, and the status is asked often.
    hello: Mutex<Option<(bool, Instant)>>,
}

/// How long a Windows Hello availability answer is reused.
const HELLO_FRESH: Duration = Duration::from_secs(60);

/// The cached answer while it's fresh, else a new one from `probe`.
fn hello_cached(cache: &Mutex<Option<(bool, Instant)>>, probe: impl FnOnce() -> bool) -> bool {
    if let Some((v, at)) = *cache.locked() {
        if at.elapsed() < HELLO_FRESH {
            return v;
        }
    }
    let v = probe();
    *cache.locked() = Some((v, Instant::now()));
    v
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

/// The journal can be written now: no lock, or unlocked.
pub fn is_open(shared: &Shared, conn: &Connection) -> bool {
    open(shared, conn).is_ok()
}

/// Pages can be read and written now.
fn open(shared: &Shared, conn: &Connection) -> Result<(), String> {
    gate(conn, shared.journal.unlocked.load(Ordering::SeqCst))
}

/// The lock check itself: no lock, or unlocked.
fn gate(conn: &Connection, unlocked: bool) -> Result<(), String> {
    if lock_kind(conn) == "none" || unlocked {
        Ok(())
    } else {
        Err("The journal is locked.".into())
    }
}

/// Most hits a search returns.
const MAX_HITS: usize = 50;
/// About how long a hit's snippet is, in characters.
const SNIPPET: usize = 120;

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Hit {
    pub date: String,
    pub snippet: String,
}

/// Lowercases char by char, so indexes line up with the original's chars.
fn fold(chars: &[char]) -> Vec<char> {
    chars.iter().map(|c| c.to_lowercase().next().unwrap_or(*c)).collect()
}

fn find(hay: &[char], needle: &[char]) -> Option<usize> {
    if needle.is_empty() || needle.len() > hay.len() {
        return None;
    }
    (0..=hay.len() - needle.len()).find(|&i| hay[i..i + needle.len()] == *needle)
}

/// About SNIPPET characters of `text` around the first match of `query` (case-insensitive),
/// whitespace collapsed, cut at word boundaries, with "…" where cut. None when it doesn't match.
pub fn snippet(text: &str, query: &str) -> Option<String> {
    let chars: Vec<char> = text.split_whitespace().collect::<Vec<_>>().join(" ").chars().collect();
    let q: Vec<char> = fold(&query.split_whitespace().collect::<Vec<_>>().join(" ").chars().collect::<Vec<_>>());
    let at = find(&fold(&chars), &q)?;
    let (len, end_of_match) = (chars.len(), at + q.len());
    let mut start = at.saturating_sub(SNIPPET.saturating_sub(q.len()) / 2);
    let mut end = (start + SNIPPET).max(end_of_match).min(len);
    if end == len {
        start = len.saturating_sub(SNIPPET).min(at);
    }
    // Word boundaries: drop the partial word at each cut, never the match itself.
    if start > 0 && chars[start - 1] != ' ' {
        if let Some(sp) = chars[start..at].iter().position(|c| *c == ' ') {
            start += sp + 1;
        }
    }
    if end < len && chars[end] != ' ' {
        if let Some(sp) = chars[end_of_match..end].iter().rposition(|c| *c == ' ') {
            end = end_of_match + sp;
        }
    }
    let body: String = chars[start..end].iter().collect::<String>().trim().to_string();
    Some(format!("{}{body}{}", if start > 0 { "…" } else { "" }, if end < len { "…" } else { "" }))
}

/// Pages whose text holds `query`, newest first, at most MAX_HITS. Refuses while locked.
pub fn search(conn: &Connection, unlocked: bool, query: &str) -> Result<Vec<Hit>, String> {
    gate(conn, unlocked)?;
    if query.trim().is_empty() {
        return Ok(Vec::new());
    }
    let mut stmt = conn.prepare("SELECT date, body FROM journal_days ORDER BY date DESC").map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))).map_err(|e| e.to_string())?;
    let mut hits = Vec::new();
    for row in rows {
        let (date, body) = row.map_err(|e| e.to_string())?;
        if let Some(snippet) = snippet(&body, query) {
            hits.push(Hit { date, snippet });
            if hits.len() == MAX_HITS {
                break;
            }
        }
    }
    Ok(hits)
}

/// Every page, oldest first. Refuses while locked.
pub fn all(conn: &Connection, unlocked: bool) -> Result<Vec<Day>, String> {
    gate(conn, unlocked)?;
    let mut stmt = conn.prepare("SELECT date, doc, body, updated_at FROM journal_days ORDER BY date").map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| Ok(Day { date: r.get(0)?, doc: r.get(1)?, body: r.get(2)?, updated_at: r.get(3)? }))
        .map_err(|e| e.to_string())?;
    rows.collect::<rusqlite::Result<Vec<_>>>().map_err(|e| e.to_string())
}

/// The journal as one Markdown file: a "## Weekday, Month D, YYYY" heading per page, then its text.
pub fn export_md(days: &[Day]) -> String {
    let mut out = String::new();
    for d in days {
        let heading = chrono::NaiveDate::parse_from_str(&d.date, "%Y-%m-%d").map(|n| n.format("%A, %B %-d, %Y").to_string()).unwrap_or_else(|_| d.date.clone());
        if !out.is_empty() {
            out.push('\n');
        }
        out.push_str(&format!("## {heading}\n\n{}\n", d.body.trim_end()));
    }
    out
}

/// The journal as JSON: [{ date, doc, body, updatedAt }], oldest first.
pub fn export_json(days: &[Day]) -> Result<String, String> {
    serde_json::to_string_pretty(days).map_err(|e| e.to_string())
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

/// The lock's state. Reads the lock kind under the DB lock, then asks Windows about Hello
/// outside it (2026-11-17: that check can be slow, and held up every other DB user).
fn status(shared: &Shared) -> LockStatus {
    let lock = lock_kind(&shared.db.locked());
    let hello = hello_cached(&shared.journal.hello, hello_available);
    LockStatus { unlocked: lock == "none" || shared.journal.unlocked.load(Ordering::SeqCst), lock, hello_available: hello }
}

fn with<T>(shared: &Shared, f: impl FnOnce(&Connection) -> Result<T, String>) -> Result<T, String> {
    let conn = shared.db.locked();
    f(&conn)
}

/// Off the main thread (2026-11-17): the Windows Hello check is a slow WinRT call.
#[tauri::command]
pub async fn journal_status(app: AppHandle) -> Result<LockStatus, String> {
    tauri::async_runtime::spawn_blocking(move || status(&app.state::<Shared>())).await.map_err(|e| e.to_string())
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
/// Off the main thread, with the PIN hashed outside the DB lock (2026-11-17).
#[tauri::command]
pub async fn journal_set_lock(app: AppHandle, kind: String, pin: Option<String>) -> Result<LockStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let shared = app.state::<Shared>();
        with(&shared, |c| open(&shared, c))?;
        let hash = match kind.as_str() {
            "none" => None,
            "hello" if hello_available() => None,
            "hello" => return Err("Windows Hello isn't set up on this PC.".into()),
            "pin" => Some(hash_pin(pin.as_deref().unwrap_or(""))?),
            _ => return Err("Pick a lock: none, Windows Hello, or a PIN.".into()),
        };
        with(&shared, |c| {
            open(&shared, c)?;
            let tx = c.unchecked_transaction().map_err(|e| e.to_string())?;
            match &hash {
                Some(h) => db::set_setting(&tx, PIN_KEY, h).map_err(|e| e.to_string())?,
                None => {
                    tx.execute("DELETE FROM settings WHERE key = ?1", [PIN_KEY]).map_err(|e| e.to_string())?;
                }
            }
            db::set_setting(&tx, LOCK_KEY, &kind).map_err(|e| e.to_string())?;
            tx.commit().map_err(|e| e.to_string())
        })?;
        // Whoever just set it is the owner: it stays open until it relocks.
        shared.journal.unlocked.store(true, Ordering::SeqCst);
        Ok(status(&shared))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Checks the PIN off the main thread, with argon2 outside the DB lock (2026-11-17: it ran
/// under it on the main thread, freezing the window and every DB user while it hashed).
#[tauri::command]
pub async fn journal_unlock_pin(app: AppHandle, pin: String) -> Result<LockStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let shared = app.state::<Shared>();
        // Held through the check, so wrong PINs are counted one at a time.
        let mut fails = shared.journal.fails.locked();
        if let Some(until) = fails.1.filter(|t| Instant::now() < *t) {
            return Err(format!("Too many tries. Wait {} s.", (until - Instant::now()).as_secs() + 1));
        }
        let hash = with(&shared, |c| db::get_setting(c, PIN_KEY).map_err(|e| e.to_string()))?.ok_or("The journal has no PIN.")?;
        if !pin_matches(&hash, &pin) {
            fails.0 += 1;
            if fails.0 % TRIES == 0 {
                // The pause doubles with each round of wrong PINs, up to an hour.
                let pause = pause_after(fails.0);
                fails.1 = Some(Instant::now() + pause);
                return Err(format!("Too many tries. Wait {} s.", pause.as_secs()));
            }
            return Err("That isn't the PIN.".into());
        }
        *fails = (0, None);
        shared.journal.unlocked.store(true, Ordering::SeqCst);
        drop(fails);
        Ok(status(&shared))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn journal_unlock_hello(app: AppHandle) -> Result<LockStatus, String> {
    // Only a Hello lock opens with Hello (a PIN lock asks for its PIN).
    if with(&app.state::<Shared>(), |c| Ok(lock_kind(c)))? != "hello" {
        return Err("This journal unlocks with its PIN.".into());
    }
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
    Ok(status(&shared))
}

#[tauri::command]
pub fn journal_lock(shared: TauriState<Shared>) {
    shared.journal.unlocked.store(false, Ordering::SeqCst);
}

/// Searches the pages' text. Refuses while locked, like reading a page.
#[tauri::command]
pub fn journal_search(shared: TauriState<Shared>, query: String) -> Result<Vec<Hit>, String> {
    with(&shared, |c| search(c, shared.journal.unlocked.load(Ordering::SeqCst), &query))
}

/// Writes the whole journal to Documents\Sanctum\Exports as Markdown ("md") or JSON ("json").
/// Refuses while locked.
#[tauri::command]
pub async fn journal_export(app: AppHandle, format: String) -> Result<crate::backup::FileInfo, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let ext = match format.as_str() {
            "md" | "json" => format.as_str(),
            _ => return Err("Export the journal as Markdown or JSON.".to_string()),
        };
        let shared = app.state::<Shared>();
        let days = with(&shared, |c| all(c, shared.journal.unlocked.load(Ordering::SeqCst)))?;
        let text = if ext == "md" { export_md(&days) } else { export_json(&days)? };
        let dir = crate::backup::folder(&app, "Exports")?;
        let path = dir.join(format!("Sanctum journal {}.{ext}", crate::backup::stamp(chrono::Local::now())));
        std::fs::write(&path, text).map_err(|e| e.to_string())?;
        crate::backup::info(&path).ok_or_else(|| "The export didn't land.".to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_hello_check_is_cached() {
        let cache = Mutex::new(None);
        let mut asked = 0;
        assert!(hello_cached(&cache, || { asked += 1; true }));
        assert!(hello_cached(&cache, || { asked += 1; false }), "the fresh answer is reused");
        assert_eq!(asked, 1);
        // A stale answer is asked again.
        *cache.locked() = Some((true, Instant::now() - HELLO_FRESH - Duration::from_secs(1)));
        assert!(!hello_cached(&cache, || false));
    }

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
        // Wrong PINs pause longer each round: 30 s, 1 min, 2 min, … at most an hour.
        assert_eq!(pause_after(5), Duration::from_secs(30));
        assert_eq!(pause_after(10), Duration::from_secs(60));
        assert_eq!(pause_after(15), Duration::from_secs(120));
        assert_eq!(pause_after(500), Duration::from_secs(3600));
        assert_eq!(lock_kind(&fresh()), "none");
    }

    fn locked(conn: &Connection) {
        db::set_setting(conn, LOCK_KEY, "pin").unwrap();
    }

    #[test]
    fn search_matches_any_case_newest_first() {
        let conn = fresh();
        save(&conn, "2026-10-01", None, "Walked by the river.", 1).unwrap();
        save(&conn, "2026-10-03", None, "The RIVER was high.", 2).unwrap();
        save(&conn, "2026-10-02", None, "Stayed in.", 3).unwrap();
        let hits = search(&conn, false, "river").unwrap();
        assert_eq!(hits.iter().map(|h| h.date.as_str()).collect::<Vec<_>>(), vec!["2026-10-03", "2026-10-01"]);
        assert_eq!(hits[0].snippet, "The RIVER was high.");
        assert_eq!(search(&conn, false, "  River ").unwrap().len(), 2);
        assert!(search(&conn, false, "ocean").unwrap().is_empty());
        // Empty or blank queries find nothing.
        assert!(search(&conn, false, "").unwrap().is_empty());
        assert!(search(&conn, false, "   ").unwrap().is_empty());
    }

    #[test]
    fn search_returns_at_most_fifty() {
        let conn = fresh();
        let start = chrono::NaiveDate::from_ymd_opt(2026, 1, 1).unwrap();
        for i in 0..60 {
            let d = (start + chrono::Days::new(i)).format("%Y-%m-%d").to_string();
            save(&conn, &d, None, "same words", 1).unwrap();
        }
        let hits = search(&conn, false, "words").unwrap();
        assert_eq!(hits.len(), 50);
        assert_eq!(hits[0].date, "2026-03-01");
    }

    #[test]
    fn snippets_cut_at_words_around_the_match() {
        let filler = "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau";
        let text = format!("{filler} {filler} needle {filler} {filler}");
        let s = snippet(&text, "NEEDLE").unwrap();
        assert!(s.starts_with('…') && s.ends_with('…'), "{s}");
        assert!(s.contains("needle"));
        let inner = s.trim_matches('…');
        assert!(inner.chars().count() <= 120, "{s}");
        // Whole words only at the cuts.
        let words: Vec<&str> = filler.split(' ').collect();
        assert!(inner.split(' ').all(|w| w == "needle" || words.contains(&w)), "{s}");
        // Short pages come back whole; whitespace collapses.
        assert_eq!(snippet("Line one.\n\nLine  two.", "two").unwrap(), "Line one. Line two.");
        // A match at the very end keeps the end and cuts the front.
        let s = snippet(&format!("{filler} {filler} last"), "last").unwrap();
        assert!(s.starts_with('…') && s.ends_with("last"), "{s}");
        assert!(snippet("nothing here", "else").is_none());
    }

    #[test]
    fn search_and_export_refuse_while_locked() {
        let conn = fresh();
        save(&conn, "2026-10-01", None, "Private.", 1).unwrap();
        locked(&conn);
        assert_eq!(search(&conn, false, "private").unwrap_err(), "The journal is locked.");
        assert_eq!(search(&conn, false, "").unwrap_err(), "The journal is locked.");
        assert_eq!(all(&conn, false).unwrap_err(), "The journal is locked.");
        // Unlocked, both work.
        assert_eq!(search(&conn, true, "private").unwrap().len(), 1);
        assert_eq!(all(&conn, true).unwrap().len(), 1);
    }

    #[test]
    fn exports_as_markdown_and_json_oldest_first() {
        let conn = fresh();
        save(&conn, "2026-11-02", Some(r#"{"type":"doc"}"#), "Second page.\n", 20).unwrap();
        save(&conn, "2026-11-01", None, "First page.\nTwo lines.", 10).unwrap();
        let days = all(&conn, false).unwrap();
        assert_eq!(
            export_md(&days),
            "## Sunday, November 1, 2026\n\nFirst page.\nTwo lines.\n\n## Monday, November 2, 2026\n\nSecond page.\n"
        );
        let json: serde_json::Value = serde_json::from_str(&export_json(&days).unwrap()).unwrap();
        assert_eq!(
            json,
            serde_json::json!([
                { "date": "2026-11-01", "doc": null, "body": "First page.\nTwo lines.", "updatedAt": 10 },
                { "date": "2026-11-02", "doc": "{\"type\":\"doc\"}", "body": "Second page.\n", "updatedAt": 20 }
            ])
        );
        assert_eq!(export_md(&[]), "");
    }
}
