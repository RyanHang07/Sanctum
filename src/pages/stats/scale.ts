import type { DayStat } from "../../lib/types";

// The scales behind Stats' Ruler direction (ProtoStats.dc.html): thin ticks along an axis,
// majors in the second colour and minors in the line colour. Pure, so the maths is tested alone.

export interface Tick {
  /** Where the tick sits, 0 (start) to 1 (end). */
  at: number;
  major: boolean;
}

/** A tick every `step` from 0 to `top` (same unit), a major every `every` ticks. */
export function ticks(top: number, step: number, every: number): Tick[] {
  const n = Math.round(top / step);
  return Array.from({ length: n + 1 }, (_, i) => ({ at: i / n, major: i % every === 0 }));
}

/** The day chart's height in hours: 4 unless a day or the goal needs more (the goal line stays below the top). */
export function chartHours(days: readonly Pick<DayStat, "focusMin" | "status">[], goalMin: number): number {
  const most = Math.max(0, ...days.filter((d) => d.status !== "future").map((d) => d.focusMin));
  return Math.max(4, Math.ceil(most / 60), Math.floor(goalMin / 60) + 1);
}

/** The day chart's axis: a tick every 15 minutes up to 6 hours (30 beyond), a major and a label each hour (two beyond 8). */
export function chartAxis(topH: number) {
  const perHour = topH <= 6 ? 4 : 2;
  const labelEvery = topH <= 8 ? 1 : 2;
  const labels = Array.from({ length: topH + 1 }, (_, h) => h).filter((h) => h % labelEvery === 0 || h === topH);
  return { ticks: ticks(topH * perHour, 1, perHour), labels };
}

/**
 * The summary's scale for the range's focus, in hours: half again past the target (15 h with none),
 * or further when the focus passed it, rounded up to five. A tick per step hour, a major every five steps.
 */
export function focusScale(totalMin: number, targetMin: number | null) {
  const base = targetMin ? Math.ceil((targetMin * 1.5) / 60) : 15;
  const raw = Math.max(base, Math.ceil(totalMin / 60), 1);
  const step = raw <= 30 ? 1 : raw <= 60 ? 2 : raw <= 150 ? 5 : 10;
  const scaleH = Math.ceil(raw / (step * 5)) * step * 5;
  const labels = Array.from({ length: scaleH / (step * 5) + 1 }, (_, i) => i * step * 5).filter((h) => h === scaleH || scaleH - h > step * 5 * 0.4);
  return { scaleH, step, ticks: ticks(scaleH, step, 5), labels };
}

/** Bar height as a share of the chart (0 to 100), with a sliver for a day that has a little. */
export function barPct(d: Pick<DayStat, "focusMin" | "status">, topH: number): number {
  if (d.status === "future") return 0;
  if (d.status === "rest" && !d.focusMin) return 100;
  return Math.min(100, Math.max(1.5, (d.focusMin / (topH * 60)) * 100));
}
