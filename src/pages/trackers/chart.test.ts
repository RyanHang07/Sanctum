import { describe, expect, it } from "vitest";
import { atGoal, bucketsFor, goalDirection, goalSpark, goalText, trackerChart } from "./chart";
import type { TrackerEntry } from "../../lib/types";

const DAY = 86_400_000;
// Sunday 15 Nov 2026, mid-afternoon local time.
const NOW = new Date(2026, 10, 15, 15, 0).getTime();
let id = 1;
const entry = (daysAgo: number, value: number, trackerId = 1): TrackerEntry => ({ id: id++, trackerId, value, text: null, loggedAt: NOW - daysAgo * DAY, source: "checkin" });

describe("tracker chart rulers", () => {
  it("groups a range into days, weeks or months, ending today", () => {
    const week = bucketsFor("7D", NOW);
    expect(week.grain).toBe("day");
    expect(week.buckets.map((b) => b.label)).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
    expect(bucketsFor("30D", NOW).buckets.at(-1)!.label).toBe("Nov 15");
    const q = bucketsFor("90D", NOW);
    expect(q.grain).toBe("week");
    expect(q.buckets).toHaveLength(13);
    expect(q.buckets.at(-1)!.full).toBe("week of Nov 9");
    const y = bucketsFor("1Y", NOW);
    expect(y.grain).toBe("month");
    expect(y.buckets.at(-1)!.full).toBe("Nov 2026");
    // All starts at the first entry, a week at least.
    expect(bucketsFor("All", NOW, NOW - 2 * DAY).buckets).toHaveLength(7);
  });

  it("reads the goal's direction from where the history started", () => {
    expect(goalDirection([entry(9, 176), entry(1, 171)], 170)).toBe("down");
    expect(goalDirection([entry(9, 6.5)], 8)).toBe("up");
    expect(goalDirection([], 8)).toBe("up");
    expect(atGoal(170, 170, "down")).toBe(true);
    expect(atGoal(170.2, 170, "down")).toBe(false);
    expect(atGoal(8, 8, "up")).toBe(true);
    expect(goalText({ kind: "number", goal: 170, unit: "lb" }, "down")).toBe("Goal 170 lb or less");
    expect(goalText({ kind: "scale", goal: 7, unit: "" }, "up")).toBe("Goal 7 of 10");
  });

  it("gives days at goal a taller second-color tick and label, and counts them", () => {
    const list = [entry(4, 7.1), entry(2, 8.2), entry(1, 6.9), entry(0, 8)];
    const c = trackerChart({ kind: "number", goal: 8 }, list, "7D", "up", NOW);
    // Seven days, three minor ticks between each.
    expect(c.xticks).toHaveLength(25);
    expect(c.xticks.filter((t) => t.kind === "minor")).toHaveLength(18);
    expect(c.xticks.filter((t) => t.kind === "goal").map((t) => Math.round(t.x))).toEqual([67, 100]);
    expect(c.xticks.at(-1)).toMatchObject({ last: true, kind: "goal" });
    expect(c.xlabels.filter((l) => l.hit).map((l) => l.label)).toEqual(["Fri", "Sun"]);
    expect([c.hitDays, c.days, c.lastHit]).toEqual([2, 4, true]);
    expect(c.points).toHaveLength(4);
    // The goal sits inside the padded axis.
    expect(c.goalY).toBeGreaterThan(0);
    expect(c.goalY).toBeLessThan(100);
  });

  it("keeps a day's last entry, and averages days over weeks", () => {
    const list = [entry(0.3, 7), entry(0.1, 9)];
    expect(trackerChart({ kind: "number", goal: null }, list, "7D", "up", NOW).points.at(-1)!.value).toBe(9);
    const yn = [entry(3, 1), entry(2, 0), entry(1, 1), entry(0, 1)];
    const c = trackerChart({ kind: "bool", goal: null }, yn, "90D", "up", NOW);
    expect(c.share).toBe(true);
    expect(c.points.at(-1)!.value).toBe(0.75);
    expect(c.ylabels.map((l) => l.label)).toEqual(["100%", "50%", "0%"]);
    expect(c.xticks.some((t) => t.kind === "goal")).toBe(false);
  });

  it("widens the check-in sparkline to hold the goal", () => {
    const s = goalSpark([7, 7.5, 7.2], 9)!;
    expect(s.goalY).toBe(2); // the goal is the top of the box
    expect(goalSpark([7], 9)).toBeNull();
    expect(goalSpark([7, 8], null)!.goalY).toBeNull();
  });
});
