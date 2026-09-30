// Stats and streaks (SPEC 4.9, 4.10). The rules mirror src-tauri/src/stats.rs, which is the
// source of truth; the mock backend and the tests use these.
import type { DayStatus, StatsOverview } from "./types";
import { addDays, addMonths, fromKey, monthGrid, weekStart } from "./planner";
import { minutes } from "./time";

/** What a day counts as. Mirrors stats::day_status. `when` compares the day with today. */
export function dayStatus(focusMin: number, broken: boolean, rest: boolean, goalMin: number, when: -1 | 0 | 1, beforeStart: boolean): DayStatus {
  if (when > 0) return "future";
  if (broken) return "broken";
  if (focusMin >= goalMin) return "kept";
  if (rest) return "rest";
  if (when === 0) return "today";
  return beforeStart ? "none" : "missed";
}

/** [current, longest] from statuses oldest first. Mirrors stats::streaks. */
export function streaks(statuses: readonly DayStatus[]): [number, number] {
  let run = 0;
  let longest = 0;
  for (const s of statuses) {
    if (s === "kept" || s === "rest") run += 1;
    else if (s === "missed" || s === "broken") run = 0;
    longest = Math.max(longest, run);
  }
  return [run, longest];
}

export type StatsRange = "week" | "month";

/** First and last day keys for the week or month containing `anchor`. Months cover whole weeks. */
export function rangeOf(range: StatsRange, anchor: string): { from: string; to: string } {
  if (range === "week") {
    const from = weekStart(anchor);
    return { from, to: addDays(from, 6) };
  }
  const grid = monthGrid(anchor);
  return { from: grid[0]!, to: grid[grid.length - 1]! };
}

/** The anchor one week or month over. */
export const shiftRange = (range: StatsRange, anchor: string, n: number) =>
  range === "week" ? addDays(anchor, 7 * n) : addMonths(anchor, n);

export function rangeTitle(range: StatsRange, anchor: string): string {
  if (range === "month") return fromKey(anchor).toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const from = weekStart(anchor);
  const a = fromKey(from);
  const b = fromKey(addDays(from, 6));
  const fmt = (d: Date, withMonth: boolean) => d.toLocaleDateString("en-US", withMonth ? { month: "short", day: "numeric" } : { day: "numeric" });
  return `${fmt(a, true)} – ${fmt(b, a.getMonth() !== b.getMonth())}`;
}

/** Heatmap shade (1 to 3) for a kept day, by focus against the goal. */
export function shade(focusMin: number, goalMin: number): 1 | 2 | 3 {
  if (focusMin >= goalMin * 1.33) return 3;
  if (focusMin >= goalMin) return 2;
  return 1;
}

/** "discord.exe" -> "Discord"; sites and “keywords” stay as they are. */
export function temptedLabel(what: string, apps: readonly { exe: string; name: string }[] | null = null): string {
  if (!what.endsWith(".exe")) return what;
  const known = apps?.find((a) => a.exe === what);
  if (known) return known.name;
  const stem = what.slice(0, -4);
  return stem.charAt(0).toUpperCase() + stem.slice(1);
}

export const TEMPTED_KIND: Record<string, string> = {
  app: "App",
  allowlist: "New app",
  title: "Keyword",
  site: "Site",
  extension: "Extension off",
};

/** The hover line for a day. */
export function dayDetail(date: string, s: StatsOverview["days"][number], goalMin: number): string {
  const d = fromKey(date).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const focused = `${minutes(s.focusMin)} focused`;
  switch (s.status) {
    case "kept":
      return `${d}: kept, ${focused}`;
    case "missed":
      return `${d}: ${focused} of ${minutes(goalMin)}, streak reset`;
    case "broken": {
      const at = s.brokenAt ? new Date(s.brokenAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : null;
      return `${d}: seal broken${at ? ` at ${at}` : ""}, streak reset`;
    }
    case "rest":
      return `${d}: planned rest day`;
    case "today":
      return `Today: ${minutes(s.focusMin)} of ${minutes(goalMin)} so far`;
    case "future":
      return `${d}: ahead`;
    default:
      return `${d}: before your first session`;
  }
}
