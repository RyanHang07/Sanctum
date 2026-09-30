//! Breaking the seal early (SPEC 4.5, M7). Levels in order:
//! 1. A reason (50+ characters) and a 5-minute wait that restarts if you leave the window.
//! 2. Retype a paragraph exactly.
//! 3. With a partner: their approval, from their page with their PIN (30 minutes to answer).
//!    Solo, or when the partner can't be reached: a 30-minute cooldown that restarts if you
//!    leave the window.
//!
//! An approval ends the session as unlocked early, never broken. A denial or expiry means the
//! seal stands; the next request opens after 15 minutes and starts at level 2.
//! The emergency unlock skips all of it, once a week.
//!
//! `Ladder` is pure (times are passed in) so the rules are tested without clocks or network.

use serde::Serialize;

pub const MIN_REASON: usize = 50;
pub const WAIT_MS: i64 = 5 * 60_000;
pub const SOLO_MS: i64 = 30 * 60_000;
pub const REQUEST_TTL_MS: i64 = 30 * 60_000;
pub const RETRY_AFTER_MS: i64 = 15 * 60_000;
pub const EMERGENCY_EVERY_MS: i64 = 7 * 24 * 3_600_000;

/// Level 2: one at random, typed exactly. Plain ASCII so every keyboard can type it.
pub const PARAGRAPHS: &[&str] = &[
    "I set this time aside when my head was clear. The version of me who planned it knew what mattered and what would pull at me. Leaving now trades that plan for a feeling that will pass in minutes. I can stay, finish the block, and decide afterward with the work already done.",
    "Every session I finish makes the next one easier to start. Every session I abandon teaches me that the seal is a suggestion. I am not choosing between this task and something fun. I am choosing what kind of promise my own word is going to be for the rest of the week.",
    "The urge to check something is loudest right before the work gets interesting. That is not a coincidence. Hard problems feel uncomfortable at first, and the mind looks for an exit. If I wait it out, the discomfort turns into focus. If I leave, I only reset the clock on it.",
    "Nothing outside this room is on fire. Messages will still be there when the timer ends, and so will the feed. What will not still be here is this block of quiet, uninterrupted time. I planned it on purpose, and I would be annoyed with anyone else who took it away from me.",
    "I do not need to feel motivated to keep going. I only need to do the next small step in front of me, then the one after that. The feeling of wanting to quit is information, not an instruction. I can notice it, name it, and keep my hands on the actual work for a while longer.",
    "Future me is going to look back at today. They will either see a day where I kept my word or a day where I negotiated with myself and lost. The reason I am typing right now might be real, but most reasons feel real in the moment. I would rather be sure than be convenient.",
    "Focus is not something I have or lack. It is something I practice, one session at a time, by staying when leaving would be easier. Each time I sit through the pull to escape, the pull gets weaker. Each time I give in, it gets louder. I know which of those I want to train.",
    "The goal for today was set by someone who cared about where I will be in a few months. That person is me. The tasks are small on their own, but together they are the whole plan. Skipping this one does not feel like much, which is exactly how plans quietly fall apart.",
    "It is easy to call a distraction a break. A real break is chosen, planned, and ends on time. What I want right now is not a break. It is a way out of something that feels hard. The work will still be hard later, and I will have less time and less trust in myself.",
    "I am typing this slowly on purpose. The point is to put a little distance between the impulse and the action. If the reason to stop is still good after I finish this paragraph, I will keep going with the next step. If it was only an itch, it has probably already faded.",
    "Discipline is remembering what I want most instead of what I want now. What I want most is to be ready, to be sharp, and to not have to cram at the last minute. What I want now is relief. Relief is cheap and available any time. Readiness is built only in moments like this.",
    "The people I admire did not get there by feeling like working every day. They built systems and then trusted them on the days they did not want to. This seal is my system. If I break it whenever it is inconvenient, it is not a system at all, just a timer I ignore.",
    "Most of the time I spend distracted does not even feel good. It feels like nothing, and then it feels like regret. The work, on the other hand, usually feels hard and then satisfying. I already know how both of these stories end. I only have to pick the better one again.",
    "One unfinished session does not ruin anything by itself. The danger is the habit it starts. The first exception makes the second one easier, and soon the exceptions are the rule. I would rather protect the habit today, while it is still easy to protect, than rebuild it later.",
    "I asked for this friction because I knew this moment would come. I knew I would want out, and I knew I would have a convincing reason. The friction is not punishment. It is a message from a calmer version of me, asking me to slow down and look at what I am about to do.",
    "Attention is the only thing I truly spend when I work. Everything I care about gets built out of it. When I hand it to a feed or a game, I am not resting, I am spending it on someone else's goals. This block of time is mine, and I would like to spend it on something that lasts.",
    "The timer is not the enemy. It is the one thing in the room that is on my side, holding the line when my attention wanders. It asks for less than an hour of honesty. When it ends I can do whatever I like, and I will have earned it instead of stealing it from myself.",
    "If this truly cannot wait, typing this paragraph will not change that, and I will keep going. But if I am being honest, most urgent things are only urgent to my impatience. I can write the thought down, trust that it will keep, and return to it when the session is over.",
    "Progress is quiet and slow and it rarely feels like progress while it is happening. It shows up weeks later as things I can suddenly do without effort. Those weeks are made of sessions exactly like this one, including the parts that are boring and the parts I want to leave.",
    "I am allowed to find this hard. Hard is not the same as wrong, and uncomfortable is not the same as unsafe. The work is supposed to stretch me a little. I can let it feel difficult and still stay in the chair, still keep going, and still finish what I said I would finish.",
];

pub fn paragraph_for(seed: u64) -> &'static str {
    PARAGRAPHS[(seed % PARAGRAPHS.len() as u64) as usize]
}

#[derive(Clone, Debug, PartialEq)]
pub enum Third {
    /// Waiting on the partner's answer to this request.
    Partner { request_id: String, partner: String, requested_at: i64 },
    /// Solo cooldown, restarted whenever you leave the window.
    Solo { started_at: i64 },
}

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Outcome {
    Approved,
    Denied,
    Expired,
}

#[derive(Clone, Debug)]
pub struct Ladder {
    pub session_id: i64,
    /// The level being worked on (1 to 3).
    pub level: u8,
    pub reason: Option<String>,
    pub wait_started: Option<i64>,
    pub paragraph: Option<&'static str>,
    pub third: Option<Third>,
    /// The last partner answer, shown until you start again.
    pub outcome: Option<Outcome>,
    pub note: Option<String>,
    /// After a denial or expiry, no new request before this.
    pub retry_at: Option<i64>,
}

impl Ladder {
    pub fn new(session_id: i64) -> Self {
        Ladder { session_id, level: 1, reason: None, wait_started: None, paragraph: None, third: None, outcome: None, note: None, retry_at: None }
    }

    /// Level 1: the reason starts the wait.
    pub fn give_reason(&mut self, reason: &str, now: i64) -> Result<(), String> {
        if self.level != 1 {
            return Err("You already gave a reason.".into());
        }
        let r = reason.trim();
        if r.chars().count() < MIN_REASON {
            return Err(format!("Write at least {MIN_REASON} characters."));
        }
        self.reason = Some(r.to_string());
        self.wait_started = Some(now);
        Ok(())
    }

    pub fn wait_left(&self, now: i64) -> Option<i64> {
        self.wait_started.map(|t| (t + WAIT_MS - now).max(0))
    }

    /// Leaving the window restarts whichever wait is running.
    pub fn left_window(&mut self, now: i64) {
        if self.level == 1 && self.wait_started.is_some() {
            self.wait_started = Some(now);
        }
        if let Some(Third::Solo { started_at }) = &mut self.third {
            *started_at = now;
        }
    }

    /// Level 1 done once the wait has run out: on to the paragraph.
    pub fn finish_wait(&mut self, now: i64, seed: u64) -> Result<(), String> {
        if self.level != 1 || self.wait_left(now) != Some(0) {
            return Err("The wait isn't over.".into());
        }
        self.enter_level2(seed);
        Ok(())
    }

    fn enter_level2(&mut self, seed: u64) {
        self.level = 2;
        self.paragraph = Some(paragraph_for(seed));
    }

    /// Level 2: exact, character for character (surrounding whitespace aside).
    pub fn retype(&mut self, text: &str) -> Result<(), String> {
        let Some(p) = self.paragraph.filter(|_| self.level == 2) else { return Err("There's no paragraph to type yet.".into()) };
        if text.trim() != p {
            return Err("Not an exact match. Check it and try again.".into());
        }
        self.level = 3;
        Ok(())
    }

    pub fn can_request(&self, now: i64) -> Result<(), String> {
        if self.level != 3 {
            return Err("Finish the earlier steps first.".into());
        }
        if self.third.is_some() {
            return Err("A request is already running.".into());
        }
        if let Some(t) = self.retry_at.filter(|t| *t > now) {
            let min = (t - now + 59_999) / 60_000;
            return Err(format!("The next request opens in {min} min."));
        }
        Ok(())
    }

    pub fn start_partner(&mut self, request_id: String, partner: String, now: i64) {
        self.outcome = None;
        self.note = None;
        self.third = Some(Third::Partner { request_id, partner, requested_at: now });
    }

    pub fn start_solo(&mut self, now: i64) {
        self.outcome = None;
        self.third = Some(Third::Solo { started_at: now });
    }

    pub fn solo_left(&self, now: i64) -> Option<i64> {
        match self.third {
            Some(Third::Solo { started_at }) => Some((started_at + SOLO_MS - now).max(0)),
            _ => None,
        }
    }

    pub fn expires_at(&self) -> Option<i64> {
        match self.third {
            Some(Third::Partner { requested_at, .. }) => Some(requested_at + REQUEST_TTL_MS),
            _ => None,
        }
    }

    /// A denial or expiry: the seal stands, and asking again starts at level 2.
    pub fn refused(&mut self, outcome: Outcome, note: Option<String>, now: i64, seed: u64) {
        self.third = None;
        self.outcome = Some(outcome);
        self.note = note;
        self.retry_at = Some(now + RETRY_AFTER_MS);
        self.enter_level2(seed);
    }

    /// "Never mind": stop what's running. The reason and progress are kept.
    pub fn cancel_third(&mut self) {
        self.third = None;
    }
}

/// Whether the weekly emergency unlock is free, and if not, when it will be.
pub fn emergency_next(last_used: Option<i64>, now: i64) -> Option<i64> {
    last_used.map(|t| t + EMERGENCY_EVERY_MS).filter(|next| *next > now)
}

#[cfg(test)]
mod tests {
    use super::*;

    const MIN: i64 = 60_000;
    const REASON: &str = "Recruiter moved my call up and I need Discord for the shared screen link.";

    #[test]
    fn level_one_needs_a_reason_and_an_unbroken_wait() {
        let mut l = Ladder::new(1);
        assert!(l.give_reason("too short", 0).is_err());
        l.give_reason(REASON, 0).unwrap();
        assert_eq!(l.wait_left(2 * MIN), Some(3 * MIN));
        assert!(l.finish_wait(2 * MIN, 0).is_err());
        // Leaving the window restarts the wait.
        l.left_window(4 * MIN);
        assert_eq!(l.wait_left(5 * MIN), Some(4 * MIN));
        l.finish_wait(9 * MIN, 3).unwrap();
        assert_eq!(l.level, 2);
        assert_eq!(l.paragraph, Some(PARAGRAPHS[3]));
    }

    #[test]
    fn level_two_is_an_exact_retype() {
        let mut l = Ladder::new(1);
        l.give_reason(REASON, 0).unwrap();
        l.finish_wait(WAIT_MS, 0).unwrap();
        let p = PARAGRAPHS[0];
        assert!(l.retype(&p.replace("clear", "Clear")).is_err());
        assert!(l.retype(&p[..p.len() - 1]).is_err());
        l.retype(&format!("  {p}\n")).unwrap();
        assert_eq!(l.level, 3);
    }

    #[test]
    fn a_denial_waits_15_minutes_and_restarts_at_level_two() {
        let mut l = Ladder::new(1);
        l.give_reason(REASON, 0).unwrap();
        l.finish_wait(WAIT_MS, 0).unwrap();
        l.retype(PARAGRAPHS[0]).unwrap();
        l.can_request(10 * MIN).unwrap();
        l.start_partner("req".into(), "Jordan".into(), 10 * MIN);
        assert!(l.can_request(11 * MIN).is_err(), "one request at a time");
        assert_eq!(l.expires_at(), Some(40 * MIN));
        l.refused(Outcome::Denied, Some("Finish the set.".into()), 12 * MIN, 1);
        assert_eq!((l.level, l.outcome, l.note.as_deref()), (2, Some(Outcome::Denied), Some("Finish the set.")));
        l.retype(PARAGRAPHS[1]).unwrap();
        assert_eq!(l.can_request(20 * MIN), Err("The next request opens in 7 min.".into()));
        l.can_request(27 * MIN).unwrap();
    }

    #[test]
    fn solo_cooldown_restarts_when_you_leave() {
        let mut l = Ladder::new(1);
        l.level = 3;
        l.start_solo(0);
        assert_eq!(l.solo_left(10 * MIN), Some(20 * MIN));
        l.left_window(10 * MIN);
        assert_eq!(l.solo_left(10 * MIN), Some(30 * MIN));
        assert_eq!(l.solo_left(45 * MIN), Some(0));
    }

    #[test]
    fn paragraphs_are_typeable_and_about_300_characters() {
        assert_eq!(PARAGRAPHS.len(), 20);
        for p in PARAGRAPHS {
            assert!(p.is_ascii(), "{p}");
            assert!((250..=330).contains(&p.len()), "{} chars: {p}", p.len());
        }
    }

    #[test]
    fn emergency_is_weekly() {
        assert_eq!(emergency_next(None, 0), None);
        assert_eq!(emergency_next(Some(0), 3 * 24 * 60 * MIN), Some(EMERGENCY_EVERY_MS));
        assert_eq!(emergency_next(Some(0), EMERGENCY_EVERY_MS), None);
    }
}
