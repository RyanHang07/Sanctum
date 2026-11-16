import { useEffect, useState } from "react";
import { useStore } from "./store";
import { EVENTS, native, onNative } from "../lib/native";
import { addDays, todayKey } from "../lib/planner";
import type { StatsOverview } from "../lib/types";

// UI hooks and pure helpers for Today: focused minutes, the day ruler's scale, and the days strip.

/** Focused minutes today: finished sessions plus the running one as it ticks. */
export function useFocusToday(): { minutes: number; goal: number; met: boolean } {
  const done = useStore((s) => s.focusTodayMin);
  const liveMs = useStore((s) => s.session?.elapsedMs ?? 0);
  const goal = useStore((s) => s.settings.dailyGoalMin);
  const minutes = done + Math.floor(liveMs / 60_000);
  return { minutes, goal, met: goal > 0 && minutes >= goal };
}

/**
 * The last 7 days (streak, day states) for the days strip and the headline. Refreshes when a
 * session starts or ends, when a seal is held, and once a minute.
 */
export function useWeekOverview(): StatsOverview | null {
  const sessionId = useStore((s) => s.session?.id);
  const dailyResetTime = useStore((s) => s.settings.dailyResetTime);
  const [o, setO] = useState<StatsOverview | null>(null);
  useEffect(() => {
    let live = true;
    const today = todayKey(new Date(), dailyResetTime);
    const load = () =>
      void native
        .statsOverview(addDays(today, -6), today)
        .then((v) => live && setO(v))
        .catch(() => undefined);
    load();
    const off = onNative(EVENTS.held, load);
    const t = setInterval(load, 60_000);
    return () => {
      live = false;
      clearInterval(t);
      void off.then((f) => f());
    };
  }, [sessionId, dailyResetTime]);
  return o;
}

// --- The day ruler ---

/** The ruler's length in minutes: 3 hours, growing by whole hours to fit the goal and the day. */
export function rulerSpan(minutes: number, goal: number): number {
  return Math.max(180, Math.ceil((Math.max(minutes, goal) + 10) / 60) * 60);
}

export interface Tick {
  m: number;
  kind: "minor" | "half" | "hour" | "goal";
}

/** A tick every 5 minutes; half hours and hours are major; the goal gets its own tall tick. */
export function rulerTicks(span: number, goal: number): Tick[] {
  const out: Tick[] = [];
  for (let m = 0; m <= span; m += 5) {
    out.push({ m, kind: m === goal ? "goal" : m % 60 === 0 ? "hour" : m % 30 === 0 ? "half" : "minor" });
  }
  // A goal off the 5-minute grid still gets its tick.
  if (goal > 0 && goal <= span && goal % 5 !== 0) out.push({ m: goal, kind: "goal" });
  return out;
}

/** The major tick (a half hour) a one-minute step crossed, if any. The goal tick has its own moment. */
export function majorCrossed(prev: number, next: number, goal: number): number | null {
  if (next <= prev) return null;
  for (let m = Math.ceil((prev + 1) / 30) * 30; m <= next; m += 30) {
    if (m > 0 && m !== goal) return m;
  }
  return null;
}

/** 78 -> "1 hour 18 minutes", for screen readers. */
export function spoken(total: number, adjective = false): string {
  const m = Math.max(0, Math.round(total));
  const h = Math.floor(m / 60);
  const r = m % 60;
  const s = (n: number) => (n === 1 || adjective ? "" : "s");
  const parts: string[] = [];
  if (h) parts.push(`${h} hour${s(h)}`);
  if (r || !h) parts.push(`${r} minute${s(r)}`);
  return parts.join(" ");
}

/** The ruler's label: "42 minutes focused of a 2 hour goal, 1 hour 18 minutes left". */
export function rulerLabel(minutes: number, goal: number): string {
  const met = minutes >= goal;
  return `${spoken(minutes)} focused of a ${spoken(goal, true)} goal${met ? ", goal met" : `, ${spoken(goal - minutes)} left`}`;
}
