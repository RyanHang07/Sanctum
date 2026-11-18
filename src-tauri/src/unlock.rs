//! The Break the seal dialog's commands (SPEC 4.5): drives `ladder::Ladder` for the running
//! session, asks the partner through `cloud`, and ends the session when a level-3 path
//! finishes. Rust holds the state, so closing the dialog or reloading the UI changes nothing.

use crate::ladder::{self, Ladder, Outcome, Third};
use crate::engine::Locked;
use crate::{cloud, db, engine, Shared};
use serde::Serialize;
use std::sync::atomic::AtomicBool;
use std::sync::{Mutex, TryLockError};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

const POLL_EVERY: Duration = Duration::from_secs(4);
const EMERGENCY_KEY: &str = "emergency_used_at";
/// Uptime when the emergency unlock was last used (2026-11-17), so a clock set forward can't
/// bring it back before midnight.
const EMERGENCY_UPTIME_KEY: &str = "emergency_used_uptime";

pub struct Unlock {
    ladder: Ladder,
    /// The partner's name when one is linked; None means the solo path. Starts from the link
    /// remembered in settings and is only cleared by a lookup that reached the server
    /// (2026-11-17), so offline or signed out never reads as solo.
    partner: Option<String>,
    last_poll: Option<Instant>,
    /// Why level 3 fell back to the solo cooldown.
    notice: Option<String>,
}

#[derive(Default)]
pub struct State {
    current: Mutex<Option<Unlock>>,
    /// A partner answer check is on the network (2026-11-17): a slow one used to queue a call
    /// per view poll behind it. Polls meanwhile skip the check and show what's known.
    checking: AtomicBool,
    /// Held while ladder_open looks the partner up; a second open waits on it and reuses the
    /// answer instead of queueing another lookup.
    looking_up: Mutex<()>,
}

impl State {
    pub fn clear(&self) {
        *self.current.locked() = None;
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
    let (last, uptime) = {
        let conn = shared.db.locked();
        let get = |k: &str| db::get_setting(&conn, k).ok().flatten();
        (get(EMERGENCY_KEY).and_then(|v| v.parse().ok()), get(EMERGENCY_UPTIME_KEY).and_then(|v| v.parse().ok()))
    };
    let now = ladder::emergency_clock(now, last.zip(uptime), crate::tamper::uptime_ms());
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

/// Who the partner is after a lookup (2026-11-17). Only an answer from the server can say
/// "none"; a lookup that couldn't reach it keeps what's known, or what settings remember.
pub(crate) fn resolve_partner(current: Option<String>, lookup: cloud::PartnerLookup, remembered: Option<String>) -> Option<String> {
    match lookup {
        cloud::PartnerLookup::Linked(name) => Some(name),
        cloud::PartnerLookup::None => None,
        cloud::PartnerLookup::Unknown(_) => current.or(remembered),
    }
}

/// An answer that was asked for one session and one request still applies (2026-11-17): the
/// session may have ended and another started, or the request been cancelled and re-sent.
pub(crate) fn still_applies(ladder: &Ladder, session_id: i64, request_id: Option<&str>) -> bool {
    ladder.session_id == session_id
        && match request_id {
            None => true,
            Some(r) => matches!(&ladder.third, Some(Third::Partner { request_id, .. }) if request_id == r),
        }
}

/// Runs `f` on the running session's ladder, creating it on first use.
fn with_ladder<T>(app: &AppHandle, f: impl FnOnce(&mut Unlock, i64) -> Result<T, String>) -> Result<(T, LadderView), String> {
    let shared = app.state::<Shared>();
    // The seal's monotonic clock (2026-11-17): the waits used to read the wall clock, so setting
    // it forward skipped them.
    let Some((id, now)) = shared.engine.session_clock() else { return Err("No session is running.".into()) };
    let mut guard = shared.unlock.current.locked();
    if guard.as_ref().map_or(true, |u| u.ladder.session_id != id) {
        let partner = cloud::remembered_partner(&shared.db.locked());
        *guard = Some(Unlock { ladder: Ladder::new(id), partner, last_poll: None, notice: None });
    }
    let u = guard.as_mut().unwrap();
    let out = f(u, now)?;
    Ok((out, view(u, &shared, now)))
}

/// `with_ladder`, but only while the same session (and, if given, the same partner request) is
/// still the one running. None when it isn't: the answer belongs to a ladder that's gone.
fn with_same<T>(app: &AppHandle, session_id: i64, request_id: Option<&str>, f: impl FnOnce(&mut Unlock, i64) -> Result<T, String>) -> Result<Option<(T, LadderView)>, String> {
    let shared = app.state::<Shared>();
    let Some((id, now)) = shared.engine.session_clock() else { return Ok(None) };
    if id != session_id {
        return Ok(None);
    }
    let mut guard = shared.unlock.current.locked();
    let Some(u) = guard.as_mut().filter(|u| still_applies(&u.ladder, session_id, request_id)) else { return Ok(None) };
    let out = f(u, now)?;
    Ok(Some((out, view(u, &shared, now))))
}

/// Ends that session as unlocked early (never broken) and closes the ladder.
fn finish(app: &AppHandle, session_id: i64, reason: &str, level: i64) -> Result<(), String> {
    engine::end_unlocked(app, session_id, reason, level)?;
    app.state::<Shared>().unlock.clear();
    Ok(())
}

#[tauri::command]
pub async fn ladder_open(app: AppHandle) -> Result<LadderView, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let shared = app.state::<Shared>();
        let lookup = match shared.unlock.looking_up.try_lock() {
            Ok(g) => Some(g),
            Err(TryLockError::Poisoned(p)) => Some(p.into_inner()),
            Err(TryLockError::WouldBlock) => None,
        };
        match lookup {
            Some(_lookup) => {
                // Who's the partner? Offline or signed out keeps the remembered link.
                let lookup = cloud::partner_lookup(&app);
                let remembered = cloud::remembered_partner(&shared.db.locked());
                with_ladder(&app, |u, _| {
                    if u.ladder.third.is_none() {
                        u.partner = resolve_partner(u.partner.take(), lookup, remembered);
                    }
                    Ok(())
                })?;
            }
            // Another open is asking: wait for its answer rather than asking again.
            None => drop(shared.unlock.looking_up.locked()),
        }
        poll(&app)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// The current view, checking the partner's answer every few seconds while waiting.
fn poll(app: &AppHandle) -> Result<LadderView, String> {
    let (due, _) = with_ladder(app, |u, _| {
        let waiting = match &u.ladder.third {
            Some(Third::Partner { request_id, .. }) => Some((u.ladder.session_id, request_id.clone())),
            _ => None,
        };
        Ok(waiting.filter(|_| u.last_poll.map_or(true, |t| t.elapsed() >= POLL_EVERY)))
    })?;
    let shared = app.state::<Shared>();
    let check = due.and_then(|w| Some((w, engine::Claim::take(&shared.unlock.checking)?)));
    // Held through an approval's finish, so a second poll can't end the session again.
    if let Some(((session_id, id), _claim)) = check {
        let answer = cloud::unlock_request_status(app, &id);
        // Only for the session and request it was asked for (2026-11-17).
        let Some((approved, view)) = with_same(app, session_id, Some(&id), |u, now| {
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
        })?
        else {
            return Ok(with_ladder(app, |_, _| Ok(()))?.1);
        };
        if approved {
            let reason = view.reason.clone().unwrap_or_default();
            finish(app, session_id, &reason, 3)?;
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

/// Level 3: ask the partner. Solo, the session ends here. A partner who can't be reached means
/// one more 5-minute wait instead.
#[tauri::command]
pub async fn ladder_request(app: AppHandle) -> Result<LadderView, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (asked_for, _) = with_ladder(&app, |u, now| {
            u.ladder.can_request(now)?;
            Ok((u.ladder.session_id, u.partner.clone(), u.ladder.reason.clone().unwrap_or_default()))
        })?;
        let (session_id, partner, reason) = asked_for;
        let Some(name) = partner else {
            // Solo: the reason, the wait, and the paragraph were the price. The session ends.
            let (_, view) = with_ladder(&app, |_, _| Ok(()))?;
            finish(&app, session_id, &reason, 3)?;
            return Ok(LadderView { outcome: Some(Outcome::Approved), stage: "solo", ..view });
        };
        let asked = cloud::create_unlock_request(&app, &reason);
        // The request was filed for that session: a different one running now never gets it.
        let applied = with_same(&app, session_id, None, |u, now| {
            match asked {
                Ok(id) => u.ladder.start_partner(id, name, now),
                Err(e) => {
                    u.notice = Some(format!("Couldn't reach your partner ({e}). A 5-minute wait applies instead."));
                    u.ladder.start_solo(now);
                }
            }
            u.last_poll = None;
            Ok(())
        })?;
        match applied {
            Some((_, view)) => Ok(view),
            None => Ok(with_ladder(&app, |_, _| Ok(()))?.1),
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

/// The solo cooldown ran out: the session ends.
#[tauri::command]
pub fn ladder_finish_solo(app: AppHandle) -> Result<LadderView, String> {
    let ((session_id, reason), view) = with_ladder(&app, |u, now| {
        if u.ladder.solo_left(now) != Some(0) {
            return Err("The cooldown isn't over.".into());
        }
        Ok((u.ladder.session_id, u.ladder.reason.clone().unwrap_or_default()))
    })?;
    finish(&app, session_id, &reason, 3)?;
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

/// Leaving the window pauses the running wait; coming back resumes it.
pub fn left_window(app: &AppHandle) {
    let shared = app.state::<Shared>();
    let Some((_, now)) = shared.engine.session_clock() else { return };
    let mut guard = shared.unlock.current.locked();
    if let Some(u) = guard.as_mut() {
        u.ladder.left_window(now);
    }
}

pub fn returned_to_window(app: &AppHandle) {
    let shared = app.state::<Shared>();
    let Some((_, now)) = shared.engine.session_clock() else { return };
    let mut guard = shared.unlock.current.locked();
    if let Some(u) = guard.as_mut() {
        u.ladder.returned(now);
    }
}

/// Once a day: ends the session without the ladder. Not a broken seal; the partner hears.
#[tauri::command]
pub fn emergency_unlock(app: AppHandle, reason: String) -> Result<(), String> {
    let shared = app.state::<Shared>();
    let Some((session_id, now)) = shared.engine.session_clock() else { return Err("No session is running.".into()) };
    if emergency_next(&shared, now).is_some() {
        return Err("The emergency unlock is back at midnight.".into());
    }
    let reason = reason.trim();
    if reason.is_empty() {
        return Err("Say what the emergency is.".into());
    }
    // Marked used before the seal ends (2026-11-17, L8), so a crash in between can't give it back.
    {
        let conn = shared.db.locked();
        let _ = db::set_setting(&conn, EMERGENCY_KEY, &now.to_string());
        let _ = db::set_setting(&conn, EMERGENCY_UPTIME_KEY, &crate::tamper::uptime_ms().to_string());
    }
    finish(&app, session_id, &format!("Emergency: {reason}"), 1)?;
    cloud::notify(&app, "emergency_unlock", reason.to_string());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cloud::PartnerLookup;

    #[test]
    fn offline_or_signed_out_never_reads_as_no_partner() {
        let sam = || Some("Sam".to_string());
        // Offline: what's known stays, else what settings remember.
        assert_eq!(resolve_partner(sam(), PartnerLookup::Unknown("offline".into()), None), sam());
        assert_eq!(resolve_partner(None, PartnerLookup::Unknown("Sign in first.".into()), sam()), sam());
        // Never linked and can't ask: solo.
        assert_eq!(resolve_partner(None, PartnerLookup::Unknown("offline".into()), None), None);
        // Only the server can say there's no partner (a removal they approved).
        assert_eq!(resolve_partner(sam(), PartnerLookup::None, sam()), None);
        assert_eq!(resolve_partner(None, PartnerLookup::Linked("Alex".into()), sam()).as_deref(), Some("Alex"));
    }

    #[test]
    fn an_answer_only_applies_to_its_own_session_and_request() {
        let mut l = Ladder::new(7);
        l.start_partner("req-1".into(), "Sam".into(), 0);
        assert!(still_applies(&l, 7, Some("req-1")));
        assert!(still_applies(&l, 7, None));
        // Another session is running now.
        assert!(!still_applies(&Ladder::new(8), 7, None));
        // The request was cancelled and a new one sent.
        l.cancel_third();
        assert!(!still_applies(&l, 7, Some("req-1")));
        l.start_partner("req-2".into(), "Sam".into(), 0);
        assert!(!still_applies(&l, 7, Some("req-1")));
    }
}
