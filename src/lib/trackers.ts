// Tracker helpers (SPEC 4.13): value formatting, ranges, and chart geometry for
// design/screens/Tracking.dc.html and Checkin.dc.html.
import type { Tracker, TrackerDraft, TrackerEntry, TrackerKind } from "./types";

export const RANGES = ["7D", "30D", "90D", "1Y", "All"] as const;
export type TrackerRange = (typeof RANGES)[number];
const RANGE_DAYS: Record<TrackerRange, number | null> = { "7D": 7, "30D": 30, "90D": 90, "1Y": 365, All: null };

/** Where a range starts (ms); 0 for All. */
export function rangeStart(range: TrackerRange, now = Date.now()): number {
  const days = RANGE_DAYS[range];
  return days === null ? 0 : now - days * 86_400_000;
}

export const KIND_LABEL: Record<TrackerKind, string> = { number: "Number", bool: "Yes / no", scale: "Scale 1–10", text: "Text" };
export const DISPLAY_LABEL = { chart: "chart", table: "table", both: "chart + table" } as const;

/** "Number · chart + table", "Text · list". */
export function trackerMeta(t: Tracker): string {
  return `${KIND_LABEL[t.kind]} · ${t.kind === "text" ? "list" : DISPLAY_LABEL[t.display]}`;
}

/** Starting points for New tracker; everything stays editable. */
export const TEMPLATES: (TrackerDraft & { hint: string })[] = [
  { name: "Weight", kind: "number", unit: "lb", display: "both", hint: "Number in lb" },
  { name: "Body fat", kind: "number", unit: "%", display: "both", hint: "Number in %" },
  { name: "Sleep", kind: "number", unit: "h", display: "chart", hint: "Hours a night" },
  { name: "Mood", kind: "scale", display: "chart", hint: "1 to 10" },
  { name: "Workout", kind: "bool", display: "both", hint: "Yes or no" },
  { name: "Journal", kind: "text", display: "table", hint: "A short note" },
];

/** 172.4 → "172.4", 15 → "15". */
export const num = (v: number) => String(Math.round(v * 10) / 10);

/** A value as a person reads it: "172.4 lb", "Yes", "7 / 10", or the note. */
export function formatValue(t: Pick<Tracker, "kind" | "unit">, e: Pick<TrackerEntry, "value" | "text">): string {
  if (t.kind === "text") return e.text ?? "";
  const v = e.value ?? 0;
  if (t.kind === "bool") return v ? "Yes" : "No";
  if (t.kind === "scale") return `${num(v)} / 10`;
  return t.unit ? `${num(v)} ${t.unit}` : num(v);
}

/** Change between two values: "+1.2 lb", "−4.3 pts" (percent units change in points). */
export function formatChange(t: Pick<Tracker, "unit">, diff: number): string {
  const d = Math.round(diff * 10) / 10;
  const sign = d > 0 ? "+" : d < 0 ? "−" : "";
  const unit = t.unit === "%" ? " pts" : t.unit ? ` ${t.unit}` : "";
  return `${sign}${num(Math.abs(d))}${unit}`;
}

/** The chart card's corner note. */
export function rangeNote(t: Tracker, list: TrackerEntry[]): string {
  if (t.kind === "bool") {
    const yes = list.filter((e) => e.value === 1).length;
    return `${yes} of ${list.length} logged yes`;
  }
  if (list.length < 2) return list.length ? "One entry" : "No entries";
  return `${formatChange(t, list[list.length - 1]!.value! - list[0]!.value!)} this range`;
}

/** Nudge step for the check-in stepper: tenths once a value has them. */
export const stepFor = (last: number | null) => (last !== null && !Number.isInteger(last) ? 0.1 : 1);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const shortDate = (ms: number) => {
  const d = new Date(ms);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
};

// Chart geometry from Tracking.dc.html: a 384 x 196 plot, labels in the left 38px and bottom 20px.
export const CHART = { w: 384, h: 196, x0: 42, x1: 378, y0: 10, y1: 172 } as const;

export interface ChartPoint {
  x: number;
  y: number;
  value: number;
  at: number;
}

export interface ChartGeometry {
  points: ChartPoint[];
  grid: { y: number; label: string }[];
  xlabels: { x: number; label: string; anchor: "start" | "middle" | "end" }[];
  goalY: number | null;
}

/** Lays entries out by time, with a padded value axis that always fits the goal. */
export function chartGeometry(list: TrackerEntry[], goal: number | null, kind: TrackerKind): ChartGeometry {
  const vals = list.map((e) => e.value ?? 0);
  let lo = Math.min(...vals, ...(goal !== null ? [goal] : []));
  let hi = Math.max(...vals, ...(goal !== null ? [goal] : []));
  if (kind === "scale") [lo, hi] = [Math.min(lo, 1), Math.max(hi, 10)];
  else if (kind === "bool") [lo, hi] = [0, 1];
  else {
    const pad = (hi - lo) * 0.15 || 1;
    lo -= pad;
    hi += pad;
  }
  const t0 = list[0]?.loggedAt ?? 0;
  const t1 = list[list.length - 1]?.loggedAt ?? t0;
  const X = (t: number) => (t1 === t0 ? (CHART.x0 + CHART.x1) / 2 : CHART.x0 + ((t - t0) / (t1 - t0)) * (CHART.x1 - CHART.x0));
  const Y = (v: number) => CHART.y0 + (1 - (v - lo) / (hi - lo || 1)) * (CHART.y1 - CHART.y0);
  const dec = hi - lo >= 10 ? 0 : 1;
  const points = list.map((e) => ({ x: X(e.loggedAt), y: Y(e.value ?? 0), value: e.value ?? 0, at: e.loggedAt }));
  const grid = [0, 0.5, 1].map((f) => ({ y: CHART.y0 + f * (CHART.y1 - CHART.y0), label: (hi - (hi - lo) * f).toFixed(dec) }));
  const xlabels: ChartGeometry["xlabels"] = [];
  if (list.length) {
    xlabels.push({ x: CHART.x0, label: shortDate(t0), anchor: "start" });
    if (t1 - t0 > 2 * 86_400_000) xlabels.push({ x: (CHART.x0 + CHART.x1) / 2, label: shortDate((t0 + t1) / 2), anchor: "middle" });
    if (t1 !== t0) xlabels.push({ x: CHART.x1, label: shortDate(t1), anchor: "end" });
  }
  return { points, grid, xlabels, goalY: goal !== null ? Y(goal) : null };
}

/** The 72 x 24 sparkline in the check-in rows. */
export function sparkline(vals: number[]): string {
  if (vals.length < 2) return "";
  const lo = Math.min(...vals);
  const span = Math.max(...vals) - lo || 1;
  return vals.map((v, i) => `${(2 + i * (68 / (vals.length - 1))).toFixed(1)},${(2 + (1 - (v - lo) / span) * 20).toFixed(1)}`).join(" ");
}

/** Entries for one tracker, oldest first. */
export const entriesOf = (list: TrackerEntry[], id: number) => list.filter((e) => e.trackerId === id);

/** Whether a tracker gets a chart card. */
export const charted = (t: Tracker) => t.kind !== "text" && t.display !== "table";
