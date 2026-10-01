// Local calendar math for Today + Week (SPEC 4.12). Dates are "YYYY-MM-DD" in local time;
// weeks start Monday (Week.dc.html). A "day" rolls over at the daily reset time (4:00 AM),
// so a late night still counts as the day you started it.

import type { CalEvent, Routine, RoutineCheck, Todo } from "./types";
import { durationsMin } from "../theme/tokens";

const pad = (n: number) => String(n).padStart(2, "0");

export const toKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function fromKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y!, m! - 1, d!);
}

export const addDays = (key: string, n: number) => {
  const d = fromKey(key);
  d.setDate(d.getDate() + n);
  return toKey(d);
};

/** 0 = Sunday ... 6 = Saturday. */
export const dayOf = (key: string) => fromKey(key).getDay();

/** First day of the month `n` months from the one containing `key`. */
export function addMonths(key: string, n: number): string {
  const d = fromKey(key);
  return toKey(new Date(d.getFullYear(), d.getMonth() + n, 1));
}

/** Every day shown in a month grid: whole weeks (Monday first) covering the month. */
export function monthGrid(key: string): string[] {
  const first = addMonths(key, 0);
  const last = addDays(addMonths(key, 1), -1);
  const out: string[] = [];
  for (let d = weekStart(first); d <= last || out.length % 7 !== 0; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Monday of the week containing `key`. */
export const weekStart = (key: string) => addDays(key, -((dayOf(key) + 6) % 7));

export const weekKeys = (start: string) => Array.from({ length: 7 }, (_, i) => addDays(start, i));

export const minutesOf = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h! * 60 + m!;
};

/** The planner's "today": before the reset time (default 4:00), it's still yesterday. */
export function todayKey(now: Date = new Date(), resetTime = "04:00"): string {
  const shifted = new Date(now.getTime() - minutesOf(resetTime) * 60_000);
  return toKey(shifted);
}

/** "8:00a", "4:30p" (Home.dc.html). */
export function shortTime(hhmm: string): string {
  const total = minutesOf(hhmm);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${((h + 11) % 12) + 1}:${pad(m)}${h < 12 ? "a" : "p"}`;
}

/** "2:00 PM" */
export function longTime(hhmm: string): string {
  return shortTime(hhmm).replace(/a$/, " AM").replace(/p$/, " PM");
}

// Days are ordered Monday first in the UI.
export const WEEKDAYS = [
  { bit: 1, short: "M", name: "Mon" },
  { bit: 2, short: "T", name: "Tue" },
  { bit: 3, short: "W", name: "Wed" },
  { bit: 4, short: "T", name: "Thu" },
  { bit: 5, short: "F", name: "Fri" },
  { bit: 6, short: "S", name: "Sat" },
  { bit: 0, short: "S", name: "Sun" },
] as const;

export const EVERY_DAY = 127;
export const WEEKDAYS_MASK = 0b0111110;
export const WEEKENDS_MASK = 0b1000001;

export const hasDay = (mask: number, day: number) => (mask & (1 << day)) !== 0;

/** "Every day", "Weekdays", "Weekends", or "Mon Wed Fri". */
export function daysLabel(mask: number): string {
  if (mask === EVERY_DAY) return "Every day";
  if (mask === WEEKDAYS_MASK) return "Weekdays";
  if (mask === WEEKENDS_MASK) return "Weekends";
  return WEEKDAYS.filter((d) => hasDay(mask, d.bit))
    .map((d) => d.name)
    .join(" ");
}

export interface AgendaItem {
  /** Stable across renders: "routine:3:2026-09-29", "todo:12", or "event:<calendar>:<event>:<date>". */
  key: string;
  kind: "todo" | "routine" | "event";
  /** Routine or item id (0 for calendar events). */
  id: number;
  title: string;
  date: string;
  time: string | null;
  durationMin: number | null;
  profileId: number | null;
  done: boolean;
  /** Drag order among untimed items of its kind (routine or item sort; 0 for events). */
  order: number;
  /** A one-time item with no day yet (Pending); `date` is its week's Monday. */
  undated?: boolean;
  /** Calendar events only. */
  event?: CalEvent;
}

const allDay = (i: AgendaItem) => i.kind === "event" && !i.time;
const UNTIMED_ORDER = { routine: 0, todo: 1, event: 2 } as const;

function sortItems(a: AgendaItem, b: AgendaItem) {
  // All-day events first, then timed items in time order, then anytime items: routines in
  // their drag order, then one-time items in theirs.
  if (allDay(a) !== allDay(b)) return allDay(a) ? -1 : 1;
  if (a.time && b.time) return minutesOf(a.time) - minutesOf(b.time);
  if (a.time) return -1;
  if (b.time) return 1;
  return UNTIMED_ORDER[a.kind] - UNTIMED_ORDER[b.kind] || a.order - b.order;
}

/** Open items first, checked-off ones after; each group keeps its order. */
export const openFirst = (items: readonly AgendaItem[]) => [...items.filter((i) => !i.done), ...items.filter((i) => i.done)];

/** Untimed and still open: the items you can drag into your own order. */
export const canReorder = (i: AgendaItem) => i.kind !== "event" && !i.time && !i.done;

/** `ids` with `moved` placed before (or after) `target`. */
export function moveId(ids: readonly number[], moved: number, target: number, after: boolean): number[] {
  if (moved === target) return [...ids];
  const out = ids.filter((id) => id !== moved);
  const at = out.indexOf(target);
  if (at < 0) return [...ids];
  out.splice(after ? at + 1 : at, 0, moved);
  return out;
}

/**
 * Each date's items: active routines that fall on it, that date's one-time items, and any
 * extra items per date (calendar events, from lib/calendar.ts).
 */
export function agendaFor(
  dates: readonly string[],
  routines: readonly Routine[],
  todos: readonly Todo[],
  checks: readonly RoutineCheck[],
  extra: Record<string, AgendaItem[]> = {},
) {
  const done = new Set(checks.map((c) => `${c.routineId}:${c.date}`));
  const out: Record<string, AgendaItem[]> = {};
  const byOrder = [...routines].sort((a, b) => a.sort - b.sort || a.id - b.id);
  for (const date of dates) {
    const day = dayOf(date);
    const items: AgendaItem[] = byOrder
      .filter((r) => r.active && hasDay(r.daysMask, day))
      .map((r) => ({
        key: `routine:${r.id}:${date}`,
        kind: "routine",
        id: r.id,
        title: r.title,
        date,
        time: r.time,
        durationMin: r.durationMin,
        profileId: r.profileId,
        done: done.has(`${r.id}:${date}`),
        order: r.sort,
      }));
    // Pending items have no day yet; they show in Pending, not on their week's Monday.
    for (const t of todos.filter((t) => t.dueDate === date && !t.undated)) {
      items.push({
        key: `todo:${t.id}`,
        kind: "todo",
        id: t.id,
        title: t.title,
        date,
        time: t.dueTime,
        durationMin: t.durationMin,
        profileId: t.profileId,
        done: t.done,
        order: t.sort,
      });
    }
    items.push(...(extra[date] ?? []));
    out[date] = items.sort(sortItems);
  }
  return out;
}

/**
 * What's pending in the week starting `week`: items parked on it with no day yet. For the current
 * week, also anything still open from before (parked on an earlier week, or overdue from an
 * earlier day). Oldest first.
 */
export function pendingFor(week: string, today: string, ...sources: readonly (readonly Todo[])[]): Todo[] {
  const thisWeek = week === weekStart(today);
  const seen = new Map<number, Todo>();
  for (const list of sources) for (const t of list) seen.set(t.id, t);
  return [...seen.values()]
    .filter((t) => !t.done && (t.undated ? t.dueDate === week || (thisWeek && t.dueDate < week) : thisWeek && t.dueDate < today))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || Number(b.undated) - Number(a.undated) || a.sort - b.sort || a.id - b.id);
}

/** Nearest focus length (15-minute steps to 2 h), rounding ties up and never below 15. */
export function snapMinutes(minutes: number): number {
  let best = durationsMin[0]!;
  for (const d of durationsMin) if (Math.abs(d - minutes) <= Math.abs(best - minutes)) best = d;
  return best;
}

const DEFAULT_BLOCK_MIN = 60;

export function blockTimes(item: AgendaItem): { startsAt: number; endsAt: number } | null {
  if (!item.time) return null;
  const startsAt = fromKey(item.date).getTime() + minutesOf(item.time) * 60_000;
  return { startsAt, endsAt: startsAt + (item.durationMin ?? DEFAULT_BLOCK_MIN) * 60_000 };
}

export interface Suggestion {
  item: AgendaItem;
  /** "now": the block is happening. "next": the next one today. */
  state: "now" | "next";
  startsAt: number;
  endsAt: number;
  profileId: number;
  minutes: number;
}

/** How far ahead "next" looks. */
const LOOKAHEAD_MS = 12 * 3_600_000;

/** Items that belong to the day itself win over routines when both fit. */
const routineLast = (i: AgendaItem) => (i.kind === "routine" ? 1 : 0);

/**
 * The focus block the schedule points at: a timed, unfinished item linked to a profile that's
 * happening now (duration = time left, snapped), else the next one coming up. When a one-time
 * item or event and a routine overlap, the one that belongs to the day wins.
 */
export function suggestFocus(items: readonly AgendaItem[], now: number): Suggestion | null {
  const blocks = items
    .filter((i) => i.profileId !== null && !i.done)
    .map((item) => ({ item, t: blockTimes(item) }))
    .filter((b): b is { item: AgendaItem; t: { startsAt: number; endsAt: number } } => b.t !== null)
    .sort((a, b) => routineLast(a.item) - routineLast(b.item) || a.t.startsAt - b.t.startsAt);
  const current = blocks.find((b) => b.t.startsAt <= now && now < b.t.endsAt);
  if (current) {
    return { item: current.item, state: "now", ...current.t, profileId: current.item.profileId!, minutes: snapMinutes((current.t.endsAt - now) / 60_000) };
  }
  const next = blocks
    .filter((b) => b.t.startsAt > now && b.t.startsAt - now <= LOOKAHEAD_MS)
    .sort((a, b) => a.t.startsAt - b.t.startsAt || routineLast(a.item) - routineLast(b.item))[0];
  if (!next) return null;
  return {
    item: next.item,
    state: "next",
    ...next.t,
    profileId: next.item.profileId!,
    minutes: snapMinutes((next.t.endsAt - next.t.startsAt) / 60_000),
  };
}
