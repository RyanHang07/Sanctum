import type { Broke } from "../lib/types";
import type { AppState } from "../state/appState";

// The words on the moments (SPEC 4.0, design/README.md headline rule). A headline is one plain
// sentence in Schibsted Grotesk: one weight, one colour, no italic payoff, no question. Every
// headline in the app comes from here. Each moment has a few lines, so it doesn't read the same
// every day. Picks are seeded (by the day, the session), never random per render, so a line holds
// still while you look at it.

/** Open, any time of day. */
export const OPEN: readonly string[] = [
  "Dial in, or stay mid.",
  "Dreams start with the next block.",
  "The work is waiting, and so is the excuse.",
  "Nobody is coming, so start anyway.",
  "Small promises, kept, are the whole game.",
  "Your word is the plan.",
  "Show up, then stay.",
  "Today counts, so act like it.",
];

/** Open, one more for each part of the day. */
export const OPEN_BY_HOUR: readonly { from: number; to: number; line: string }[] = [
  { from: 5, to: 11, line: "The first hour is the best hour." },
  { from: 11, to: 17, line: "Half the day is left to use." },
  { from: 17, to: 22, line: "One more block, then rest." },
  { from: 22, to: 29, line: "It’s late, so close the gaps or sleep." },
];

/** Open, when today's goal is already met. */
export const GOAL_MET_TODAY: readonly string[] = ["Goal met, so go again or go rest.", "The day is kept, and anything more is extra.", "Today’s promise is paid."];

/** Open, the day after a miss: one more and the streak resets. */
export const AT_RISK: readonly string[] = ["You missed yesterday, so not twice.", "One miss is a slip, and two is a pattern.", "The streak is on the line today."];

export const SEALED: readonly string[] = [
  "Nothing else matters right now.",
  "Head down, the noise can wait.",
  "This is the rep you don’t skip.",
  "Show who you are when no one’s watching.",
  "You’re locked in until it’s finished.",
];

/** Sealed, the last few minutes. */
export const FINISHING: readonly string[] = ["Finish the last stretch clean.", "Almost there, so don’t drift now.", "Make the last minutes count."];

/** Under "Sanctum held." (a fact line, not part of the headline). */
export const HELD: readonly string[] = [
  "Promise kept.",
  "You did what you said.",
  "That one counts.",
  "Proof, not hope.",
  "The seal held. So did you.",
  "Done, and done right.",
  "Actions, not words.",
];

/** The day's first seal. */
export const FIRST: readonly string[] = ["First one down.", "The day has started.", "One on the board."];

/** The seal that reached today's goal, on the first day of a streak. */
export const GOAL_CROSSED: readonly string[] = ["Goal met for today, but the best never stopped here.", "Goal met. The rest is extra.", "That’s today’s promise kept."];

/** A broken seal, when what broke it isn't known (v0.3.1: plain, never scolding). */
export const HELD_BROKEN: readonly string[] = ["The seal broke, so today's streak resets. The work still counts.", "The downtime broke the seal. The next one starts fresh."];

/** The if-then plan as it's shown on a catch (v0.3.1): "If you're tempted, you said you'd stand up." */
export function planLine(plan: string): string {
  const action = plan.trim().replace(/^i(?:'|’)ll\s+/i, "").replace(/[.!]+$/, "");
  return `If you're tempted, you said you'd ${action}.`;
}

/** After "18 minutes into Deep Work, 72:14 to go." on the blocked overlay. `{until}` is when the seal ends. */
export const OVERLAY: readonly string[] = [
  "You don’t need it. You need the reps.",
  "It’ll still be there at {until}.",
  "The itch passes in a minute. The work doesn’t.",
  "Nothing in there is urgent.",
  "Not now. Later, if it matters.",
  "Close it. Go back.",
];

/** The overlay in the last ten minutes: the end is the reason. */
export const OVERLAY_ENDING: readonly string[] = ["Under ten minutes. Hold.", "Almost out. Don’t spend it here.", "You’re nearly done. Finish."];

/** The overlay from the third attempt on. `{n}` is the count. */
export const OVERLAY_REPEAT: readonly string[] = ["That’s {n} tries. It hasn’t gotten more urgent.", "{n} attempts. The answer hasn’t changed.", "Try {n}. Still sealed."];

/** Pause mode's headline, on the app overlay and the extension's page (extension/blocked.js keeps
 *  the same lines). `{site}` is the app or site. A statement, never "Still want it?". */
export const PAUSE: readonly string[] = ["{site} can wait five seconds.", "Decide on {site} on purpose.", "Take a breath before {site}.", "{site} is your call, so make it a real one."];

/** @deprecated The old italic payoffs after the question "Still want Discord?". Use pauseHeadline. */
export const PAUSE_PAYOFFS: readonly string[] = ["Take a breath.", "Decide on purpose.", "It can wait five seconds.", "Your call. Make it a real one."];

/** The park card. */
export const PARK_LINES: readonly string[] = ["Park it and get back to work.", "Out of your head, back to the work.", "Write it down and let it go."];

/** @deprecated Statement-and-payoff pairs for old markup (`{line[0]} <em>{line[1]}</em>`); the
 *  payoff is empty. Use PARK_LINES. */
export const PARK: readonly (readonly [string, string])[] = PARK_LINES.map((l) => [l, ""] as const);

/** What a break is for. */
export const BREAK_TIPS: readonly string[] = ["stand up, look away from the screen", "get some water, rest your eyes", "walk to another room and back", "stretch, then look out a window"];

/** Why a flagged app is closed in quiet hours. */
export const QUIET_LINES: readonly string[] = ["Quiet hours keep your Distractions list closed.", "You closed this hour on purpose.", "This is the time you protected."];

export const WELCOME: readonly string[] = ["Welcome back to the work.", "You’re back in, so keep going.", "You stepped away, now step back in."];

/** Fixed headlines, one sentence each, for the screens that don't rotate lines. */
export const HEADLINE = {
  held: "Sanctum held.",
  broken: "Seal broken.",
  /** The block overlay and the extension's page (SPEC 8 core string). */
  stays: (what: string) => `${what} stays sealed.`,
  keyword: (keyword: string) => `Pages about “${keyword}” stay sealed.`,
  open: "You’re open again.",
  /** Quiet hours, on the overlay. */
  waits: (what: string, until: string) => `${what} waits until ${until}.`,
  quietPause: "Fifteen minutes needs a reason.",
  partnerDenied: (partner: string) => `${partner} said no, so the seal stands.`,
  partnerExpired: "The request expired, so the seal stands.",
  journalLocked: "The journal is locked.",
  journalSetup: "A page a day, yours alone.",
  journalPrompts: "Choose what a page asks.",
} as const;

/** Onboarding step titles. */
export const ONBOARDING = {
  welcome: "Distractions get sealed while you do the work.",
  profile: (name: string) => `Define ${name}.`,
  distractions: "Name your distractions.",
  look: "Pick a look you can change any time.",
  goal: "Set the bar.",
  calendar: "Bring your calendar.",
  browser: "Seal the browser too.",
  done: "You’re set.",
} as const;

/** A small stable hash, so the same seed always picks the same line. */
export function seedOf(s: string | number): number {
  let h = 2166136261;
  for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

export const pick = <T,>(list: readonly T[], seed: string | number): T => list[seedOf(seed) % list.length]!;

const dayOf = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

/** Which part of the day it is (late night runs past midnight to 5 AM). */
function partOfDay(now: Date) {
  const h = now.getHours() < 5 ? now.getHours() + 24 : now.getHours();
  return OPEN_BY_HOUR.find((p) => h >= p.from && h < p.to) ?? OPEN_BY_HOUR[0]!;
}

/** What's true right now that a headline should say instead of a general line. */
export interface HomeMoment {
  /** A seal's last five minutes. */
  finishing?: boolean;
  /** Today's goal is met. */
  goalMet?: boolean;
  /** Yesterday was missed and today isn't kept yet. */
  atRisk?: boolean;
}

/**
 * Home headline per state, one sentence. One pick a day for each state; Open also mixes in a line
 * for the part of the day, so it can change when morning turns to afternoon. In an event, the
 * headline is the event itself ("Design review until 10:39 AM.").
 */
export function homeLine(state: AppState, event?: { title: string; until: string }, now = new Date(), moment: HomeMoment = {}): string {
  const day = dayOf(now);
  switch (state) {
    case "sealed":
      return pick(moment.finishing ? FINISHING : SEALED, `sealed:${day}`);
    case "event":
      return `${event?.title ?? "Event"} until ${event?.until ?? "it ends"}.`;
    default: {
      // What's true today beats a line for the hour.
      if (moment.goalMet) return pick(GOAL_MET_TODAY, `met:${day}`);
      if (moment.atRisk) return pick(AT_RISK, `risk:${day}`);
      const part = partOfDay(now);
      return pick([...OPEN, part.line], `open:${day}:${part.from}`);
    }
  }
}

/** @deprecated For old markup (`{a} <em>{b}</em>`): the line and an empty payoff. Use homeLine. */
export function homeHeadline(...args: Parameters<typeof homeLine>): [string, string] {
  return [homeLine(...args), ""];
}

export interface HeldContext {
  sessionId: number;
  broken: boolean;
  attempts: number;
  focusMinutes: number;
  /** Focus today, this session included. */
  todayMinutes: number;
  goalMinutes: number;
  /** Days in a row the goal was hit, today included; null while unknown. */
  streak: number | null;
}

/**
 * The line under "Sanctum held.": what this session did when it's worth saying (goal just met,
 * the day's first, a hard-won hold), else one of the general lines, picked by the session.
 */
export function heldLine(c: HeldContext): string {
  if (c.broken) return pick(HELD_BROKEN, c.sessionId);
  const crossed = c.todayMinutes >= c.goalMinutes && c.todayMinutes - c.focusMinutes < c.goalMinutes;
  if (crossed) return c.streak !== null && c.streak >= 2 ? `${c.streak} days running.` : pick(GOAL_CROSSED, c.sessionId);
  if (c.todayMinutes <= c.focusMinutes) return pick(FIRST, c.sessionId);
  if (c.attempts >= 3) return `Tempted ${c.attempts} times. Held anyway.`;
  if (c.attempts === 0) return pick([...HELD, "Not one slip."], c.sessionId);
  return pick(HELD, c.sessionId);
}

/** The overlay's closing line, steady for one attempt. The end in sight, then repeat tries, say
 *  more than a general line does. */
export function overlayLine(seed: string | number, until: string, moment: { attempts?: number; remainingMs?: number } = {}): string {
  if (moment.remainingMs !== undefined && moment.remainingMs < 10 * 60_000) return pick(OVERLAY_ENDING, seed);
  if ((moment.attempts ?? 0) >= 3) return pick(OVERLAY_REPEAT, seed).replace("{n}", String(moment.attempts));
  return pick(OVERLAY, seed).replace("{until}", until);
}

export const welcome = (seed: string | number): string => pick(WELCOME, seed);

/** @deprecated For old markup (`{w[0]} <em>{w[1]}</em>`): the line and an empty payoff. Use welcome. */
export const welcomeLine = (seed: string | number): [string, string] => [welcome(seed), ""];

export const pauseHeadline = (site: string, seed: string | number): string => pick(PAUSE, seed).replaceAll("{site}", site);

/** What broke a seal, said plainly, with the fix that would have stopped it (v0.3.1). Self-
 *  compassion after a lapse raises the will to improve (Breines & Chen 2012): no scolding. */
/** The fix for each kind of tamper; also offered on the "seal is broken" notice. */
export function brokeFix(kind: string): { label: string; tab: "protection" | "browser" } | null {
  switch (kind) {
    case "guard":
      return { label: "Check Protection", tab: "protection" };
    case "extension":
      return { label: "Check the extension", tab: "browser" };
    case "shutdown":
    case "clock":
      return null;
    default:
      return { label: "Turn on Protection", tab: "protection" };
  }
}

export function brokeLine(b: Broke): { line: string; fix: { label: string; tab: "protection" | "browser" } | null } {
  const at = b.afterMin === 1 ? "1 minute in" : `${b.afterMin} minutes in`;
  switch (b.kind) {
    case "shutdown":
      return { line: `The PC went off ${at}. Restarts fit best between seals.`, fix: null };
    case "clock":
      return { line: `The clock changed ${at}.`, fix: null };
    case "guard":
      return { line: `Protection stopped ${at}.`, fix: brokeFix(b.kind) };
    case "extension":
      return { line: `A browser ran without the extension ${at}.`, fix: brokeFix(b.kind) };
    default:
      return { line: `Sanctum was closed ${at}. Protection reopens it within seconds.`, fix: brokeFix(b.kind) };
  }
}
