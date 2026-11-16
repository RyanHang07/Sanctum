import { render, screen } from "@testing-library/react";
import { DayChart, FocusRuler } from "./Ruler";
import { barPct, chartAxis, chartHours, focusScale, ticks } from "./scale";
import { finish, moment, seek, setReducedMotion } from "../../test/motion";
import type { DayStat, DayStatus, StatsOverview } from "../../lib/types";

// Stats' Ruler direction: the scale maths, the marks' colour roles, and the motion when figures change.

const DATES = ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"];

function day(date: string, status: DayStatus, focusMin: number): DayStat {
  return { date, status, focusMin, sessions: 0, attempts: 0, brokenAt: null, productiveMin: 0, distractingMin: 0 };
}

function overview(days: [DayStatus, number][]): StatsOverview {
  return {
    from: DATES[0]!,
    to: DATES[6]!,
    goalMin: 120,
    restMask: 0,
    currentStreak: 0,
    longestStreak: 0,
    streakAtRisk: false,
    days: days.map(([s, m], i) => day(DATES[i]!, s, m)),
    kept: 0,
    broken: 0,
    missed: 0,
    focusMin: 0,
    attempts: 0,
    tempted: [],
    productiveMin: 0,
    neutralMin: 0,
    distractingMin: 0,
    idleMin: 0,
  };
}

const WEEK: [DayStatus, number][] = [
  ["missed", 90],
  ["kept", 222],
  ["kept", 158],
  ["missed", 78],
  ["kept", 204],
  ["kept", 132],
  ["today", 42],
];

const chart = (o: StatsOverview) => <DayChart o={o} active={null} onActive={() => undefined} onOpen={() => undefined} />;
const bar = (date: string) => document.querySelector<HTMLElement>(`[data-day="${date}"] [data-bar]`)!;

describe("the scales", () => {
  it("puts a major every so many ticks, ends included", () => {
    const t = ticks(4, 1, 2);
    expect(t.map((x) => x.at)).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(t.map((x) => x.major)).toEqual([true, false, true, false, true]);
  });

  it("sizes the day chart to 4 hours unless a day or the goal needs more", () => {
    expect(chartHours([day("a", "kept", 222)], 120)).toBe(4);
    expect(chartHours([day("a", "kept", 301)], 120)).toBe(6);
    expect(chartHours([day("a", "kept", 60)], 240)).toBe(5);
    // A future day's figure never stretches the chart.
    expect(chartHours([day("a", "future", 900)], 120)).toBe(4);
    // Quarter-hour ticks up to 6 hours, half hours past it, a label every hour (two past 8).
    expect(chartAxis(4).ticks).toHaveLength(17);
    expect(chartAxis(4).labels).toEqual([0, 1, 2, 3, 4]);
    expect(chartAxis(10).ticks).toHaveLength(21);
    expect(chartAxis(10).labels).toEqual([0, 2, 4, 6, 8, 10]);
  });

  it("scales the week's focus half again past the target, or to 15 hours", () => {
    // ProtoStats: 9h 16m of a 10h target on a 15 hour scale, labelled 0, 5, 10 and 15.
    const s = focusScale(556, 600);
    expect(s.scaleH).toBe(15);
    expect(s.labels).toEqual([0, 5, 10, 15]);
    expect(s.ticks).toHaveLength(16);
    expect(s.ticks.filter((t) => t.major)).toHaveLength(4);
    expect(focusScale(0, null).scaleH).toBe(15);
    // Past the scale, it grows in fives.
    expect(focusScale(17 * 60, 600).scaleH).toBe(20);
    // A month's worth takes coarser steps.
    expect(focusScale(80 * 60, null)).toMatchObject({ scaleH: 100, step: 5 });
  });

  it("gives a little day a sliver and a future day nothing", () => {
    expect(barPct(day("a", "missed", 1), 4)).toBe(1.5);
    expect(barPct(day("a", "kept", 120), 4)).toBe(50);
    expect(barPct(day("a", "future", 0), 4)).toBe(0);
    expect(barPct(day("a", "kept", 600), 4)).toBe(100);
  });
});

describe("FocusRuler", () => {
  it("draws the range's focus in the accent on a tick scale, the target in the second colour", () => {
    render(<FocusRuler totalMin={556} targetMin={570} />);
    const ruler = screen.getByRole("img", { name: "9h 16m focused against a 9h 30m target, on a 15 hour scale" });
    expect(ruler.querySelector("[data-fill]")).toHaveClass("bg-sealed");
    for (const t of ruler.querySelectorAll('[data-tick="major"]')) expect(t).toHaveClass("bg-second");
    for (const t of ruler.querySelectorAll('[data-tick="minor"]')) expect(t).toHaveClass("bg-line");
    // 9h 30m isn't on a major tick, so it gets its own.
    expect(screen.getByTestId("focus-target")).toHaveClass("bg-second");
  });

  it("names a target on a major tick in the second colour instead", () => {
    render(<FocusRuler totalMin={556} targetMin={600} />);
    expect(screen.queryByTestId("focus-target")).toBeNull();
    expect(screen.getByText("10h", { exact: false }).closest("span")).toHaveClass("text-second-text");
  });
});

describe("DayChart motion", () => {
  it("doesn't move on the first render", () => {
    setReducedMotion(false);
    render(chart(overview(WEEK)));
    expect(moment("stats-bars")).toBeUndefined();
    expect(bar(DATES[1]!).style.height).toBe(`${(222 / 240) * 100}%`);
  });

  it("glides a bar from its old height when the minutes change, and fades in a new kept mark", () => {
    setReducedMotion(false);
    const { rerender } = render(chart(overview(WEEK)));
    const later = WEEK.map((d, i): [DayStatus, number] => (i === 6 ? ["kept", 126] : d));
    rerender(chart(overview(later)));
    const today = bar(DATES[6]!);
    seek("stats-bars", 0);
    expect(today.style.height).toBe(`${(42 / 240) * 100}%`);
    const mark = today.querySelector<HTMLElement>("[data-kept-mark]")!;
    expect(mark.style.opacity).toBe("0");
    finish("stats-bars");
    expect(today.style.height).toBe(`${(126 / 240) * 100}%`);
    expect(mark.style.opacity).toBe("");
  });

  it("glides the bars to another week without fading its kept marks", () => {
    setReducedMotion(false);
    const { rerender } = render(chart(overview(WEEK)));
    const next = overview(WEEK.map(([, m]) => ["kept", m + 30] as [DayStatus, number]));
    next.days = next.days.map((d, i) => ({ ...d, date: `2026-11-${16 + i}` }));
    rerender(chart(next));
    seek("stats-bars", 0);
    for (const m of document.querySelectorAll<HTMLElement>("[data-kept-mark]")) expect(m.style.opacity).toBe("");
    finish("stats-bars");
  });

  it("lands on the new heights at once under reduced motion", () => {
    const { rerender } = render(chart(overview(WEEK)));
    rerender(chart(overview(WEEK.map((d, i): [DayStatus, number] => (i === 6 ? ["today", 90] : d)))));
    expect(moment("stats-bars")!.progress()).toBe(1);
    expect(bar(DATES[6]!).style.height).toBe(`${(90 / 240) * 100}%`);
  });
});
