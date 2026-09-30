import { chartGeometry, CHART, formatChange, formatValue, rangeNote, rangeStart, sparkline, stepFor, trackerMeta } from "./trackers";
import type { Tracker, TrackerEntry } from "./types";

const tracker = (over: Partial<Tracker> = {}): Tracker => ({ id: 1, name: "Weight", unit: "lb", kind: "number", display: "both", goal: null, sort: 0, ...over });
const entry = (value: number | null, day: number, text: string | null = null): TrackerEntry => ({ id: day, trackerId: 1, value, text, loggedAt: day * 86_400_000, source: "checkin" });

describe("tracker values", () => {
  it("formats each kind the way a person reads it", () => {
    expect(formatValue(tracker(), entry(172.44, 0))).toBe("172.4 lb");
    expect(formatValue(tracker({ unit: "" }), entry(8, 0))).toBe("8");
    expect(formatValue(tracker({ kind: "bool" }), entry(1, 0))).toBe("Yes");
    expect(formatValue(tracker({ kind: "scale" }), entry(7, 0))).toBe("7 / 10");
    expect(formatValue(tracker({ kind: "text" }), entry(null, 0, "Slept well"))).toBe("Slept well");
    expect(trackerMeta(tracker())).toBe("Number · chart + table");
    expect(trackerMeta(tracker({ kind: "text", display: "table" }))).toBe("Text · list");
  });

  it("describes change, in points for percentages", () => {
    expect(formatChange(tracker(), -11.62)).toBe("−11.6 lb");
    expect(formatChange(tracker({ unit: "%" }), 0.4)).toBe("+0.4 pts");
    expect(formatChange(tracker({ unit: "" }), 0)).toBe("0");
    expect(rangeNote(tracker(), [entry(184, 0), entry(172.4, 10)])).toBe("−11.6 lb this range");
    expect(rangeNote(tracker(), [entry(184, 0)])).toBe("One entry");
    expect(rangeNote(tracker({ kind: "bool" }), [entry(1, 0), entry(0, 1), entry(1, 2)])).toBe("2 of 3 logged yes");
  });

  it("steps by tenths once a value has them", () => {
    expect(stepFor(172.4)).toBe(0.1);
    expect(stepFor(172)).toBe(1);
    expect(stepFor(null)).toBe(1);
  });

  it("measures ranges back from now", () => {
    expect(rangeStart("7D", 10 * 86_400_000)).toBe(3 * 86_400_000);
    expect(rangeStart("All")).toBe(0);
  });
});

describe("chart geometry", () => {
  it("spaces points by time and pads the value axis around the goal", () => {
    const g = chartGeometry([entry(180, 0), entry(176, 1), entry(172, 10)], 170, "number");
    expect(g.points[0]!.x).toBe(CHART.x0);
    expect(g.points[2]!.x).toBe(CHART.x1);
    // Day 1 sits a tenth of the way along, not halfway.
    expect(g.points[1]!.x).toBeCloseTo(CHART.x0 + (CHART.x1 - CHART.x0) / 10);
    // The goal is below every value but still inside the plot.
    expect(g.goalY!).toBeGreaterThan(g.points[2]!.y);
    expect(g.goalY!).toBeLessThan(CHART.y1);
    expect(g.xlabels.map((x) => x.anchor)).toEqual(["start", "middle", "end"]);
    expect(g.grid).toHaveLength(3);
  });

  it("keeps scales on 1 to 10 and centres a single point", () => {
    const g = chartGeometry([entry(5, 0)], null, "scale");
    expect(g.grid[0]!.label).toBe("10.0");
    expect(g.grid[2]!.label).toBe("1.0");
    expect(g.points[0]!.x).toBe((CHART.x0 + CHART.x1) / 2);
    expect(g.xlabels).toHaveLength(1);
  });

  it("draws the check-in sparkline", () => {
    expect(sparkline([1])).toBe("");
    expect(sparkline([1, 3, 2])).toBe("2.0,22.0 36.0,2.0 70.0,12.0");
  });
});
