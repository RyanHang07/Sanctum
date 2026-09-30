//! The Break the seal dialog's commands (SPEC 4.5): drives `ladder::Ladder` for the running
//! session, asks the partner through `cloud`, and ends the session when a level-3 path
//! finishes. Rust holds the state, so closing the dialog or reloading the UI changes nothing.

use crate::ladder::{self, Ladder, Outcome, Third};
use crate::{cloud, db, engine, session, Shared};
use serde::Serialize;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

const POLL_EVERY: Duration = Duration::from_secs(4);
const EMERGENCY_KEY: &str = "emergency_used_at";

pub struct Unlock {
    ladder: Ladder,
    /// The partner's name when one is linked and reachable; None means the solo path.
    partner: Option<String>,
    last_poll: Option<Instant>,
    /// Why level 3 fell back to the solo cooldown.
    notice: Option<String>,
}

#[derive(Default)]
pub struct State {
    current: Mutex<Option<Unlock>>,
}

impl State {
    pub fn clear(&self) {
        *self.current.lock().unwrap() = None;
    }
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LadderView {
    pub level: u8,
    pub reason: Option<String>,
    pub wait_left_ms: Option<i64>,
    pub paragraph: Option<String>,
    /// "none", "partner", or "solo".
    pub stage: &'static str,
    pub partner: Option<String>,
    pub expires_at: Option<i64>,
    pub requested_at: Option<i64>,
    pub solo_left_ms: Option<i64>,
    pub outcome: Option<Outcome>,
    pub note: Option<String>,
    pub retry_at: Option<i64>,
    pub notice: Option<String>,
    /// When the next emergency unlock is available; None means now.
    pub emergency_next_at: Option<i64>,
}

fn seed() -> u64 {
    rand::random()
}

fn emergency_next(shared: &Shared, now: i64) -> Option<i64> {
    let last = shared.db.lock().ok().and_then(|c| db::get_setting(&c, EMERGENCY_KEY).ok().flatten()).and_then(|v| v.parse().ok());
    ladder::emergency_next(last, now)
}

fn view(u: &Unlock, shared: &Shared, now: i64) -> LadderView {
    let l = &u.ladder;
    let (stage, requested_at) = match &l.third {
        Some(Third::Partner { requested_at, .. }) => ("partner", Some(*requested_at)),
        Some(Third::Solo { .. }) => ("solo", None),
        None => ("none", None),
    };
    LadderView {
        level: l.level,
        reason: l.reason.clone(),
        wait_left_ms: l.wait_left(now),
        paragraph: l.paragraph.map(String::from),
        stage,
        partner: u.partner.clone(),
        expires_at: l.expires_at(),
        requested_at,
        solo_left_ms: l.solo_left(now),
        outcome: l.outcome,
        note: l.note.clone(),
        retry_at: l.retry_at.filter(|t| *t > now),
        notice: u.notice.clone(),
        emergency_next_at: emergency_next(shared, now),
    }
}

/// Runs `f` on the running session's ladder, creating it on first use.
fn with_ladder<T>(app: &AppHandle, f: impl FnOnce(&mut Unlock, i64) -> Result<T, String>) -> Result<(T, LadderView), String> {
    let shared = app.state::<Shared>();
    let Some((id, _)) = shared.engine.session_ids() else { return Err("No session is running.".into()) };
    let now = session::now_ms();
    let mut guard = shared.unlock.current.lock().unwrap();
    if guard.as_ref().map_or(true, |u| u.ladder.session_id != id) {
        *guard = Some(Unlock { ladder: Ladder::new(id), partner: None, last_poll: None, notice: None });
    }
    let u = guard.as_mut().unwrap();
    let out = f(u, now)?;
    Ok((out, view(u, &shared, now)))
}

/// Ends the running session as unlocked early (never broken) and closes the ladder.
fn finish(app: &AppHandle, reason: &str, level: i64) -> Result<(), String> {
    engine::end_unlocked(app, reason, level)?;
    app.state::<Shared>().unlock.clear();
    Ok(())
}

#[tauri::command]
pub async fn ladder_open(app: AppHandle) -> Result<LadderView, String> {
    tauri::async_runtime::spawn_blocking(move || {
        // Who's the partner? Signed out or offline means the solo path.
        let partner = cloud::partner_name(&app);
        with_ladder(&app, |u, _| {
            if u.ladder.third.is_none() {
                u.partner = partner;
            }
            Ok(())
        })?;
        poll(&app)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// The current view, checking the partner's answer every few seconds while waiting.
fn poll(app: &AppHandle) -> Result<LadderView, String> {
    let (due, _) = with_ladder(app, |u, _| {
        let waiting = match &u.ladder.third {
            Some(Third::Partner { request_id, .. }) => Some(request_id.clone()),
            _ => None,
        };
        Ok(waiting.filter(|_| u.last_poll.map_or(true, |t| t.elapsed() >= POLL_EVERY)))
    })?;
    if let Some(id) = due {
        let answer = cloud::unlock_request_status(app, &id);
        let (approved, view) = with_ladder(app, |u, now| {
            u.last_poll = Some(Instant::now());
            let expired = u.ladder.expires_at().is_some_and(|t| now >= t);
            match answer {
                Ok((s, _)) if s == "approved" => return Ok(true),
                Ok((s, note)) if s == "denied" => u.ladder.refused(Outcome::Denied, note, now, seed()),
                Ok((s, _)) if s == "expired" => u.ladder.refused(Outcome::Expired, None, now, seed()),
                _ if expired => u.ladder.refused(Outcome::Expired, None, now, seed()),
                _ => {}
            }
            Ok(false)
        })?;
        if approved {
            let reason = view.reason.clone().unwrap_or_default();
            finish(app, &reason, 3)?;
            return Ok(LadderView { outcome: Some(Outcome::Approved), ..view });
        }
        return Ok(view);
    }
    Ok(with_ladder(app, |_, _| Ok(()))?.1)
}


#[tauri::command]
pub async fn ladder_view(app: AppHandle) -> Result<LadderView, String> {
    tauri::async_runtime::spawn_blocking(move || poll(&app)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn ladder_reason(app: AppHandle, reason: String) -> Result<LadderView, String> {
    Ok(with_ladder(&app, |u, now| u.ladder.give_reason(&reason, now))?.1)
}

#[tauri::command]
pub fn ladder_continue(app: AppHandle) -> Result<LadderView, String> {
    Ok(with_ladder(&app, |u, now| u.ladder.finish_wait(now, seed()))?.1)
}

#[tauri::command]
pub fn ladder_retype(app: AppHandle, text: String) -> Result<LadderView, String> {
    Ok(with_ladder(&app, |u, _| u.ladder.retype(&text))?.1)
}

/// Level 3: ask the partner, or start the solo cooldown (also when the partner can't be reached).
#[tauri::command]
pub async fn ladder_request(app: AppHandle) -> Result<LadderView, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (partner, _) = with_ladder(&app, |u, now| {
            u.ladder.can_request(now)?;
            Ok((u.partner.clone(), u.ladder.reason.clone().unwrap_or_default()))
        })?;
        let (partner, reason) = partner;
        let asked = partner.as_ref().map(|_| cloud::create_unlock_request(&app, &reason));
        Ok(with_ladder(&app, |u, now| {
            match (asked, partner) {
                (Some(Ok(id)), Some(name)) => u.ladder.start_partner(id, name, now),
                (Some(Err(e)), _) => {
                    u.notice = Some(format!("Couldn't reach your partner ({e}). The solo cooldown applies instead."));
                    u.ladder.start_solo(now);
                }
                _ => u.ladder.start_solo(now),
            }
            u.last_poll = None;
            Ok(())
        })?
        .1)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// The solo cooldown ran out: the session ends.
#[tauri::command]
pub fn ladder_finish_solo(app: AppHandle) -> Result<LadderView, String> {
    let (reason, view) = with_ladder(&app, |u, now| {
        if u.ladder.solo_left(now) != Some(0) {
            return Err("The cooldown isn't over.".into());
        }
        Ok(u.ladder.reason.clone().unwrap_or_default())
    })?;
    finish(&app, &reason, 3)?;
    Ok(LadderView { outcome: Some(Outcome::Approved), ..view })
}

/// "Never mind, stay sealed": withdraws a pending request or stops the cooldown.
#[tauri::command]
pub async fn ladder_cancel(app: AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (pending, _) = with_ladder(&app, |u, _| {
            let id = match &u.ladder.third {
                Some(Third::Partner { request_id, .. }) => Some(request_id.clone()),
                _ => None,
            };
            u.ladder.cancel_third();
            Ok(id)
        })?;
        if let Some(id) = pending {
            cloud::cancel_unlock_request(&app, &id);
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Leaving the window restarts the level-1 wait and the solo cooldown.
pub fn left_window(app: &AppHandle) {
    let shared = app.state::<Shared>();
    let mut guard = shared.unlock.current.lock().unwrap();
    if let Some(u) = guard.as_mut() {
        u.ladder.left_window(session::now_ms());
    }
}

/// Once a week: ends the session without the ladder. Not a broken seal; the partner hears.
#[tauri::command]
pub fn emergency_unlock(app: AppHandle, reason: String) -> Result<(), String> {
    let shared = app.state::<Shared>();
    let now = session::now_ms();
    if let Some(next) = emergency_next(&shared, now) {
        let days = (next - now + 86_399_999) / 86_400_000;
        return Err(format!("The emergency unlock is back in {days} {}.", if days == 1 { "day" } else { "days" }));
    }
    let reason = reason.trim();
    if reason.is_empty() {
        return Err("Say what the emergency is.".into());
    }
    finish(&app, &format!("Emergency: {reason}"), 1)?;
    if let Ok(conn) = shared.db.lock() {
        let _ = db::set_setting(&conn, EMERGENCY_KEY, &now.to_string());
    }
    cloud::notify(&app, "emergency_unlock", reason.to_string());
    Ok(())
}
