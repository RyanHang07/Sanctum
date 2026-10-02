import type { AppState } from "../state/appState";

// The words on the moments (SPEC 4.0, design/README.md headline rule): a bold statement and a
// serif payoff. Each moment has a few, so it doesn't read the same every day. Picks are seeded
// (by the day, the session), never random per render, so a line holds still while you look at it.

type Line = readonly [string, string];

/** Open, any time of day. */
export const OPEN: readonly Line[] = [
  ["Dial in.", "Or stay mid."],
  ["Keep dreaming.", "Or start living them."],
  ["The work is waiting.", "So is the excuse."],
  ["Nobody is coming.", "Start anyway."],
  ["Small promises, kept.", "That’s the whole game."],
  ["Your word is the plan.", "Keep it."],
  ["Show up.", "Then stay."],
  ["Today counts.", "Act like it."],
];

/** Open, one more for each part of the day. */
export const OPEN_BY_HOUR: readonly { from: number; to: number; line: Line }[] = [
  { from: 5, to: 11, line: ["First hour, best hour.", "Spend it well."] },
  { from: 11, to: 17, line: ["Half the day is left.", "Use it."] },
  { from: 17, to: 22, line: ["One more block.", "Then rest."] },
  { from: 22, to: 29, line: ["It’s late.", "Close the gaps, or sleep."] },
];

export const SEALED: readonly Line[] = [
  ["Nothing else right now.", "Just this."],
  ["Head down.", "The noise can wait."],
  ["This is the rep.", "Don’t skip it."],
  ["No one’s watching.", "Show who you are."],
  ["You’re locked in.", "Finish what you started."],
];

/** In event: the statement is the event ("Design review until 10:39 AM."), the payoff one of these. */
export const EVENT_PAYOFFS: readonly string[] = [
  "Stay all in.",
  "Give it your all.",
  "Phone down, eyes up.",
  "Be the one who listened.",
  "Focus will be here after.",
  "Be where your feet are.",
  "One room at a time.",
  "Listen like it matters.",
  "Here, not halfway.",
];

/** Under "Sanctum held." */
export const HELD: readonly string[] = [
  "Promise kept.",
  "You did what you said.",
  "That one counts.",
  "Proof, not hope.",
  "The seal held. So did you.",
  "Done, and done right.",
  "Actions, not words.",
];

/** When downtime broke the session but it still landed on the held page. */
export const HELD_BROKEN: readonly string[] = ["Held, but the downtime broke it.", "Holding onto distraction is letting go of what really matters."];

/** After "18 minutes into Deep Work, 72:14 to go." on the blocked overlay. `{until}` is when the seal ends. */
export const OVERLAY: readonly string[] = [
  "You don’t need it. You need the reps.",
  "It’ll still be there at {until}.",
  "The itch passes in a minute. The work doesn’t.",
  "Nothing in there is urgent.",
  "Not now. Later, if it matters.",
  "Close it. Go back.",
];

export const WELCOME: readonly Line[] = [
  ["Welcome back.", "Pick it up."],
  ["Back in.", "Keep going."],
  ["You stepped away.", "Step back in."],
];

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

/**
 * Home headline per state. One pick a day for each state; Open also mixes in a line for the
 * part of the day, so it can change when morning turns to afternoon.
 */
export function homeHeadline(state: AppState, event?: { title: string; until: string }, now = new Date()): [string, string] {
  const day = dayOf(now);
  switch (state) {
    case "sealed":
      return [...pick(SEALED, `sealed:${day}`)];
    case "event":
      return [`${event?.title ?? "Event"} until ${event?.until ?? "it ends"}.`, pick(EVENT_PAYOFFS, `event:${day}:${event?.title ?? ""}`)];
    default: {
      const part = partOfDay(now);
      return [...pick([...OPEN, part.line], `open:${day}:${part.from}`)];
    }
  }
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
  if (crossed) return c.streak !== null && c.streak >= 2 ? `${c.streak} days running.` : "Goal met for today, but the best never stopped here.";
  if (c.todayMinutes <= c.focusMinutes) return "First one down.";
  if (c.attempts >= 3) return `Tempted ${c.attempts} times. Held anyway.`;
  if (c.attempts === 0) return pick([...HELD, "Not one slip."], c.sessionId);
  return pick(HELD, c.sessionId);
}

/** The overlay's closing line, steady for one attempt. */
export const overlayLine = (seed: string | number, until: string) => pick(OVERLAY, seed).replace("{until}", until);

export const welcomeLine = (seed: string | number): [string, string] => [...pick(WELCOME, seed)];
