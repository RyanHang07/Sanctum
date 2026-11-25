import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { StatsPage } from "./StatsPage";
import { useStore } from "../../state/store";
import { mockControls, resetMockBackend } from "../../lib/mockBackend";
import { native } from "../../lib/native";
import { addDays, todayKey, weekStart } from "../../lib/planner";

const initial = useStore.getState();

beforeEach(() => {
  resetMockBackend();
  useStore.setState(initial, true);
});

/** Kept, kept, missed, broken, then kept, relative to today. */
function seed() {
  const t = todayKey();
  mockControls.statsDays(
    {
      [addDays(t, -5)]: { focusMin: 130, attempts: 2, productiveMin: 150, distractingMin: 20 },
      [addDays(t, -4)]: { focusMin: 125 },
      [addDays(t, -3)]: { focusMin: 40 },
      [addDays(t, -2)]: { focusMin: 150, brokenAt: Date.now() - 2 * 86_400_000, attempts: 3 },
      [addDays(t, -1)]: { focusMin: 180, attempts: 1 },
    },
    [
      { what: "discord.exe", kind: "app", count: 4 },
      { what: "youtube.com", kind: "site", count: 2 },
    ],
  );
}

/** A summary tile's value, as screen readers hear it (the odometer's plain text). */
const tile = (summary: HTMLElement, label: string) => summary.querySelector(`[data-stat="${label}"] .sr-only`)?.textContent;

describe("Stats", () => {
  it("shows the streak, the week against the goal, and what tempted you", async () => {
    seed();
    render(<StatsPage />);
    const summary = await screen.findByTestId("stats-summary");
    // Broken two days ago; yesterday kept. Today is in progress.
    expect(tile(summary, "Current streak")).toBe("1");
    expect(tile(summary, "Longest streak")).toBe("2");
    expect(within(summary).getByText(/^Seals? broken$/)).toBeInTheDocument();
    expect(within(summary).getByRole("img", { name: /focused.*, on a \d+ hour scale$/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Stats");
    expect(screen.getByRole("button", { name: "Next week" })).toBeDisabled();

    const tempted = within(screen.getByRole("region", { name: "What tempted you" }));
    expect(tempted.getByText("Discord")).toBeInTheDocument();
    expect(tempted.getByText("Site")).toBeInTheDocument();
  });

  it("draws the week as Focused bars on a ruler, with kept marks and the dashed target", async () => {
    seed();
    render(<StatsPage />);
    await screen.findByTestId("stats-summary");
    const region = screen.getByRole("region", { name: "Focus by day" });
    const chart = within(region);
    const days = region.querySelectorAll("[data-day]");
    expect(days).toHaveLength(7);
    // Kept days are solid accent bars, with no cap over them (2026-11-17).
    const kept = region.querySelectorAll('[data-bar][data-status="kept"]');
    expect(region.querySelectorAll("[data-kept-mark]")).toHaveLength(0);
    for (const b of kept) expect(b).toHaveClass("bg-sealed");
    // The target: a dashed second-color line named for the daily goal.
    expect(chart.getByTestId("stats-target")).toHaveClass("border-dashed", "border-second");
    expect(chart.getByText("2h a day")).toHaveClass("text-second-text");
    // The axis: hour ticks in the second color, quarter hours in the line color.
    const axis = chart.getByTestId("stats-axis");
    for (const t of axis.querySelectorAll('[data-tick="major"]')) expect(t).toHaveClass("bg-second");
    for (const t of axis.querySelectorAll('[data-tick="minor"]')) expect(t).toHaveClass("bg-line");
    // The legend says "Focused" and "Missed", never "Goal missed", and there is no best-day mark.
    expect(chart.getByText("Focused")).toBeInTheDocument();
    expect(chart.getByText("Missed", { selector: "span.flex" })).toBeInTheDocument();
    expect(chart.queryByText(/goal missed|best/i)).toBeNull();
  });

  it("shows a day's details in one fixed spot on hover and on keyboard focus", async () => {
    seed();
    render(<StatsPage />);
    await screen.findByTestId("stats-summary");
    const chart = within(screen.getByRole("region", { name: "Focus by day" }));
    const hover = screen.getByTestId("stats-hover");
    expect(hover).toHaveAttribute("aria-live", "polite");
    expect(hover).toHaveTextContent("Hover or focus a day for details");

    const todayBar = chart.getByRole("button", { name: /^Today:/ });
    fireEvent.focus(todayBar);
    expect(hover).toHaveTextContent(/^Today: .* so far$/);
    fireEvent.blur(todayBar);
    expect(hover).toHaveTextContent("Hover or focus a day for details");

    const today = todayKey();
    if (weekStart(today) <= addDays(today, -1)) {
      const yesterday = chart.getByRole("button", { name: /kept, 3h focused/ });
      fireEvent.mouseEnter(yesterday);
      expect(hover).toHaveTextContent("kept, 3h focused");
      // The bar under the pointer is outlined.
      expect(yesterday.querySelector("[data-bar]")).toHaveClass("outline-muted");
      fireEvent.mouseLeave(yesterday);
      expect(hover).toHaveTextContent("Hover or focus a day for details");
    }
  });

  it("opens a day in the Day tab", async () => {
    seed();
    render(<StatsPage />);
    await screen.findByTestId("stats-summary");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /^Today:/ })));
    expect(screen.getByRole("tab", { name: "Day" })).toHaveAttribute("aria-selected", "true");
  });

  it("switches tabs as a tablist with a panel, and the range as a pressed-button group", async () => {
    seed();
    render(<StatsPage />);
    await screen.findByTestId("stats-summary");
    const overview = screen.getByRole("tab", { name: "Overview" });
    expect(overview).toHaveAttribute("aria-selected", "true");
    const panel = screen.getByRole("tabpanel");
    expect(panel).toHaveAttribute("id", overview.getAttribute("aria-controls"));
    expect(panel).toHaveAccessibleName("Overview");
    expect(panel.className).not.toMatch(/page-in/);
    // Arrow keys move between tabs.
    await act(async () => fireEvent.keyDown(overview, { key: "ArrowRight" }));
    expect(screen.getByRole("tab", { name: "Sessions" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveAccessibleName("Sessions");
    // The Sessions range filter is a pressed-button group, not tabs.
    expect(screen.getByRole("group", { name: "Range" })).toBeInTheDocument();
    await act(async () => fireEvent.keyDown(screen.getByRole("tab", { name: "Sessions" }), { key: "Home" }));
    await screen.findByTestId("stats-summary");
    const range = within(screen.getByRole("group", { name: "Range" }));
    expect(range.getByRole("button", { name: "Week" })).toHaveAttribute("aria-pressed", "true");
  });

  it("switches to the month heatmap and back through the months", async () => {
    seed();
    render(<StatsPage />);
    await screen.findByTestId("stats-summary");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Month" })));
    const region = await screen.findByRole("region", { name: "Focus heatmap" });
    const heat = within(region);
    expect(region.querySelectorAll("[data-day]").length % 7).toBe(0);
    // Early in a month, the broken day is in the previous one.
    if (addDays(todayKey(), -2).slice(0, 7) === todayKey().slice(0, 7)) expect(heat.getByLabelText(/seal broken/)).toBeInTheDocument();
    // Kept days get the second-color dot; the target line is the week's alone.
    for (const d of region.querySelectorAll('[data-testid="day-dot"]')) expect(d).toHaveAttribute("data-status", "kept");
    // The lightest heat level reads on the panel by its own fill (heat-1 is 2:1 in every theme), no edge.
    for (const c of region.querySelectorAll(".bg-heat-1")) expect(c).not.toHaveClass("border-line-input");
    // A kept day's number and time take their step's own text color (2026-11-24).
    const filled = [1, 2, 3].flatMap((n) => [...region.querySelectorAll(`[data-day].bg-heat-${n}`)].map((c) => [n, c] as const));
    expect(filled.length).toBeGreaterThan(0);
    for (const [n, c] of filled) {
      expect(c.querySelector('[data-testid="day-number"]')).toHaveClass(`text-heat-on-${n}`);
      const time = c.querySelector('[data-testid="day-time"]');
      if (time) expect(time).toHaveClass(`text-heat-on-${n}`);
    }
    expect(heat.queryByTestId("stats-target")).toBeNull();
    // Days in the month are buttons with their details, on focus as on hover.
    const todayCell = heat.getByRole("button", { name: /^Today:/ });
    fireEvent.focus(todayCell);
    expect(screen.getByTestId("stats-hover")).toHaveTextContent(/^Today:/);
    expect(screen.getByRole("button", { name: "Next month" })).toBeDisabled();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Previous month" })));
    expect(screen.getByRole("button", { name: "Next month" })).toBeEnabled();
  });

  it("counts a running session toward today", async () => {
    await native.createProfile({ name: "Deep Work" });
    const p = (await native.listProfiles())[0]!;
    await native.startSession(p.id, 60);
    const o = await native.statsOverview(todayKey(), todayKey());
    expect(o.days[0]!.status).toBe("today");
    expect(o.days[0]!.sessions).toBe(1);
  });
});

describe("Stats paging (M3)", () => {
  it("shows the latest range when an older read lands after it", async () => {
    seed();
    const real = native.statsOverview;
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const spy = vi.spyOn(native, "statsOverview").mockImplementationOnce(async (from, to) => {
      await held;
      return real(from, to);
    });
    render(<StatsPage />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Previous week" })));
    await screen.findByTestId("stats-summary");
    await act(async () => release());
    const start = weekStart(todayKey());
    const days = [...screen.getByRole("region", { name: "Focus by day" }).querySelectorAll<HTMLElement>("[data-day]")].map((d) => d.dataset.day!);
    expect(days.length).toBe(7);
    for (const d of days) expect(d < start).toBe(true);
    spy.mockRestore();
  });
});
