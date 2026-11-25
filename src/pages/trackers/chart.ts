import { num, shortDate, type TrackerRange } from "../../lib/trackers";
import type { Tracker, TrackerEntry } from "../../lib/types";

// The tracker chart's ruler axes (ProtoTrackers.dc.html, decision log "Trackers"). Entries are
// grouped into days (7D, 30D), weeks (90D) or months (1Y): one major tick per group on the bottom
// ruler, in the second color and taller where the group is at goal. Positions are percentages of
// the plot, so the card can be any width.

const DAY = 86_400_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const RANGE_DAYS: Record<TrackerRange, number | null> = { "7D": 7, "30D": 30, "90D": 90, "1Y": 365, All: null };

export type GoalDirection = "up" | "down";

/**
 * Which side of the goal counts. Trackers don't store it, so it comes from where the history
 * started: a weight that began above its goal is aiming down, sleep that began below is aiming up.
 */
export function goalDirection(history: TrackerEntry[], goal: number | null): GoalDirection {
  const first = history.find((e) => e.value !== null);
  return goal !== null && first && first.value! > goal ? "down" : "up";
}

/** Whether a value is at goal (on the goal counts). */
export const atGoal = (v: number, goal: number | null, dir: GoalDirection) => goal !== null && (dir === "down" ? v <= goal : v >= goal);

const startOfDay = (ms: number) => {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};
const addDays = (ms: number, n: number) => {
  const d = new Date(ms);
  d.setDate(d.getDate() + n);
  return d.getTime();
};

export type Grain = "day" | "week" | "month";

export interface Bucket {
  start: number;
  end: number;
  /** Under the tick: "Mon", "Nov 9", "Nov". */
  label: string;
  /** In the tooltip and the summary: "Nov 9", "week of Nov 9", "Nov 2026". */
  full: string;
}

/** The groups a range is charted in, oldest first; the last one holds today. */
export function bucketsFor(range: TrackerRange, now = Date.now(), firstAt: number | null = null): { grain: Grain; buckets: Bucket[] } {
  const today = startOfDay(now);
  const days = RANGE_DAYS[range] ?? Math.max(7, Math.round((today - startOfDay(firstAt ?? now)) / DAY) + 1);
  const grain: Grain = days <= 30 ? "day" : days <= 182 ? "week" : "month";
  const buckets: Bucket[] = [];
  if (grain === "day") {
    for (let i = days - 1; i >= 0; i--) {
      const start = addDays(today, -i);
      const d = new Date(start);
      buckets.push({ start, end: addDays(start, 1), label: days <= 7 ? WD[d.getDay()]! : shortDate(start), full: shortDate(start) });
    }
  } else if (grain === "week") {
    // Weeks counted back from today, so the last one ends tonight.
    for (let end = addDays(today, 1); buckets.length * 7 < days; end = addDays(end, -7)) {
      const start = addDays(end, -7);
      buckets.unshift({ start, end, label: shortDate(start), full: `week of ${shortDate(start)}` });
    }
  } else {
    const first = new Date(addDays(today, -(days - 1)));
    const cur = new Date(first.getFullYear(), first.getMonth(), 1);
    while (cur.getTime() <= today) {
      const start = cur.getTime();
      cur.setMonth(cur.getMonth() + 1);
      buckets.push({ start, end: cur.getTime(), label: MONTHS[new Date(start).getMonth()]!, full: `${MONTHS[new Date(start).getMonth()]} ${new Date(start).getFullYear()}` });
    }
  }
  return { grain, buckets };
}

/** One value a day: the day's last entry (logging again replaces it). Keyed by the day's start. */
/** Each day's value: its last entry, or (`sum`, a counter's tracker) its entries added up. */
export function dailyValues(list: TrackerEntry[], sum = false): Map<number, number> {
  const out = new Map<number, number>();
  for (const e of [...list].sort((a, b) => a.loggedAt - b.loggedAt)) {
    if (e.value === null) continue;
    const d = startOfDay(e.loggedAt);
    out.set(d, sum ? (out.get(d) ?? 0) + e.value : e.value);
  }
  return out;
}

/** Today's total, for a counter's tracker. */
export function todayTotal(list: TrackerEntry[], now = Date.now()): number {
  return dailyValues(list, true).get(startOfDay(now)) ?? 0;
}

export interface RulerTick {
  /** 0 to 100 along the plot. */
  x: number;
  kind: "major" | "minor" | "goal";
  /** The last group's tick (today, this week, this month). */
  last: boolean;
}

export interface TrackerChart {
  grain: Grain;
  /** Groups with a value, positioned. x and y are 0 to 100. */
  points: { x: number; y: number; value: number; full: string; hit: boolean }[];
  yticks: { y: number; major: boolean }[];
  ylabels: { y: number; label: string }[];
  xticks: RulerTick[];
  xlabels: { x: number; label: string; hit: boolean; align: "start" | "middle" | "end" }[];
  goalY: number | null;
  /** Yes or no, averaged over weeks or months: the share of yes, 0 to 1. */
  share: boolean;
  /** Days in the range with a value, and how many of them were at goal. */
  days: number;
  hitDays: number;
  /** The current group is at goal. */
  lastHit: boolean;
  dir: GoalDirection;
}

/**
 * `sum`: a counter routine counts into this tracker, so a day's entries are amounts that add up
 * (2026-11-24). Charting each day's last amount made a counter look like it lost its data.
 */
export function trackerChart(t: Pick<Tracker, "kind" | "goal"> & { sum?: boolean }, list: TrackerEntry[], range: TrackerRange, dir: GoalDirection, now = Date.now()): TrackerChart {
  const bool = t.kind === "bool";
  const goal = bool ? null : t.goal;
  const daily = dailyValues(list, !!t.sum);
  const { grain, buckets } = bucketsFor(range, now, list[0]?.loggedAt ?? null);
  const share = bool && grain !== "day";
  const P = buckets.length;

  // A group's value: the day's value, or the mean of its days (rounded to tenths, yes/no as a share).
  const values = buckets.map((b) => {
    const vs = [...daily].filter(([d]) => d >= b.start && d < b.end).map(([, v]) => v);
    if (!vs.length) return null;
    const m = vs.reduce((s, v) => s + v, 0) / vs.length;
    return share ? m : Math.round(m * 10) / 10;
  });
  const present = values.filter((v): v is number => v !== null);

  let lo: number;
  let hi: number;
  if (bool) [lo, hi] = [0, 1];
  else if (t.kind === "scale") [lo, hi] = [Math.min(1, ...present), Math.max(10, ...present)];
  else {
    const all = goal !== null ? [...present, goal] : present;
    lo = all.length ? Math.min(...all) : 0;
    hi = all.length ? Math.max(...all) : 1;
    const pad = (hi - lo) * 0.15 || 1;
    lo -= pad;
    hi += pad;
  }
  const X = (i: number) => (P === 1 ? 50 : (i / (P - 1)) * 100);
  const Y = (v: number) => (1 - (v - lo) / (hi - lo || 1)) * 100;
  const dec = hi - lo >= 10 ? 0 : 1;
  const hitOf = (v: number | null) => v !== null && atGoal(v, goal, dir);

  // Bottom ruler: a major tick per group, minor ticks between when there's room.
  const minors = P <= 7 ? 3 : P <= 13 ? 1 : 0;
  const steps = (P - 1) * (minors + 1);
  const xticks: RulerTick[] = Array.from({ length: steps + 1 }, (_, i) => {
    const x = steps ? (i / steps) * 100 : 50;
    if (i % (minors + 1) !== 0) return { x, kind: "minor", last: false };
    return { x, kind: hitOf(values[i / (minors + 1)]!) ? "goal" : "major", last: i === steps };
  });
  // Labels: every group in a week, else about six, always the last.
  const every = P <= 7 ? 1 : Math.ceil(P / 6);
  const xlabels = buckets.flatMap((b, i) =>
    (P - 1 - i) % every === 0 ? [{ x: X(i), label: b.label, hit: hitOf(values[i]!), align: (P > 7 && i === P - 1 ? "end" : P > 7 && i === 0 ? "start" : "middle") as "start" | "middle" | "end" }] : [],
  );

  const dayVals = [...daily].filter(([d]) => d >= buckets[0]!.start).map(([, v]) => v);
  return {
    grain,
    points: values.flatMap((v, i) => (v === null ? [] : [{ x: X(i), y: Y(v), value: v, full: buckets[i]!.full, hit: hitOf(v) }])),
    yticks: Array.from({ length: 11 }, (_, i) => ({ y: i * 10, major: i % 5 === 0 })),
    ylabels: (bool ? (share ? ["100%", "50%", "0%"] : ["Yes", "", "No"]) : [0, 0.5, 1].map((f) => (hi - (hi - lo) * f).toFixed(dec))).map((label, i) => ({ y: i * 50, label })),
    xticks,
    xlabels,
    goalY: goal !== null ? Y(goal) : null,
    share,
    days: dayVals.length,
    hitDays: dayVals.filter((v) => atGoal(v, goal, dir)).length,
    lastHit: hitOf(values[P - 1] ?? null),
    dir,
  };
}

/** "Goal 8 h", "Goal 170 lb or less", "Goal 7 of 10", "Yes or no". */
export function goalText(t: Pick<Tracker, "kind" | "goal" | "unit">, dir: GoalDirection): string {
  if (t.kind === "bool") return "Yes or no";
  if (t.goal === null) return "No goal";
  const of = t.kind === "scale" ? " of 10" : t.unit ? ` ${t.unit}` : "";
  return `Goal ${num(t.goal)}${of}${dir === "down" ? " or less" : ""}`;
}

/** A sparkline's 72 x 24 box with its range widened to hold the goal, so the goal line lands inside. */
export function goalSpark(vals: number[], goal: number | null): { points: string; goalY: number | null; last: { x: number; y: number } } | null {
  if (vals.length < 2) return null;
  const lo = Math.min(...vals, ...(goal !== null ? [goal] : []));
  const span = Math.max(...vals, ...(goal !== null ? [goal] : [])) - lo || 1;
  const y = (v: number) => 2 + (1 - (v - lo) / span) * 20;
  const x = (i: number) => 2 + i * (68 / (vals.length - 1));
  return {
    points: vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" "),
    goalY: goal !== null ? Number(y(goal).toFixed(1)) : null,
    last: { x: Number(x(vals.length - 1).toFixed(1)), y: Number(y(vals.at(-1)!).toFixed(1)) },
  };
}
