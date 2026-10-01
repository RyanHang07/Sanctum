import type { QuietConfig, QuietStatus } from "./types";

// Quiet hours math, mirrored from src-tauri/src/quiet.rs for the mock backend and the Setup copy.

export const QUIET_PAUSE_MS = 15 * 60_000;
export const QUIET_MIN_REASON = 10;
export const DEFAULT_QUIET: QuietConfig = { enabled: false, daysMask: 127, start: "23:00", end: "07:00" };

const minutesOf = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h! * 60 + m!;
};

/** When the window you're in ends, or null outside quiet hours. Windows belong to the day they start. */
export function quietWindowEnd(c: QuietConfig, now: Date): Date | null {
  if (!c.enabled) return null;
  const s = minutesOf(c.start);
  const e = minutesOf(c.end);
  for (const back of [0, 1]) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back);
    if (!(c.daysMask & (1 << day.getDay()))) continue;
    const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, s);
    const end = new Date(day.getFullYear(), day.getMonth(), day.getDate() + (e > s ? 0 : 1), 0, e);
    if (start <= now && now < end) return end;
  }
  return null;
}

export function quietError(c: QuietConfig): string | null {
  if (c.daysMask < 1 || c.daysMask > 127) return "Pick at least one day.";
  if (c.start === c.end) return "Quiet hours need a start and an end that differ.";
  return null;
}

/** "Every night", "Weeknights", or the day names, for a window that crosses midnight or not. */
export function quietSummary(c: QuietConfig): string {
  const overnight = minutesOf(c.end) <= minutesOf(c.start);
  if (c.daysMask === 127) return overnight ? "Every night" : "Every day";
  if (c.daysMask === 0b0011111 && overnight) return "Sunday to Thursday nights";
  if (c.daysMask === 0b0111110) return overnight ? "Weeknights" : "Weekdays";
  if (c.daysMask === 0b1000001) return overnight ? "Weekend nights" : "Weekends";
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].filter((_, i) => c.daysMask & (1 << i));
  return names.join(", ");
}

export function mockQuietStatus(c: QuietConfig, pausedUntil: number | null, sealed: boolean, now = Date.now()): QuietStatus {
  const end = quietWindowEnd(c, new Date(now));
  const paused = end !== null && pausedUntil !== null && pausedUntil > now ? pausedUntil : null;
  return { config: c, active: end !== null, on: end !== null && paused === null && !sealed, endsAt: end?.getTime() ?? null, pausedUntil: paused };
}
