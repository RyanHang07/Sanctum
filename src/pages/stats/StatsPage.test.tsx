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

describe("Stats", () => {
  it("shows the streak, the week against the goal, and what tempted you", async () => {
    seed();
    render(<StatsPage />);
    const summary = await screen.findByTestId("stats-summary");
    // Broken two days ago; yesterday kept. Today is in progress.
    expect(summary).toHaveTextContent("1Current streak");
    expect(summary).toHaveTextContent("2Longest streak");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Stats");
    expect(screen.getByRole("button", { name: "Next week" })).toBeDisabled();

    const tempted = within(screen.getByRole("region", { name: "What tempted you" }));
    expect(tempted.getByText("Discord")).toBeInTheDocument();
    expect(tempted.getByText("Site")).toBeInTheDocument();

    const today = todayKey();
    const bars = within(screen.getByRole("region", { name: "Focus by day" }));
    expect(bars.getAllByRole("img")).toHaveLength(7);
    if (weekStart(today) <= addDays(today, -1)) {
      fireEvent.mouseEnter(bars.getAllByRole("img").find((b) => b.getAttribute("aria-label")?.includes("kept, 3h"))!);
      expect(screen.getByTestId("stats-hover")).toHaveTextContent("kept, 3h focused");
    }
  });

  it("switches to the month heatmap and back through the months", async () => {
    seed();
    render(<StatsPage />);
    await screen.findByTestId("stats-summary");
    await act(async () => fireEvent.click(screen.getByRole("tab", { name: "Month" })));
    const heat = within(await screen.findByRole("region", { name: "Focus heatmap" }));
    expect(heat.getAllByRole("gridcell").length % 7).toBe(0);
    // Early in a month, the broken day is in the previous one.
    if (addDays(todayKey(), -2).slice(0, 7) === todayKey().slice(0, 7)) expect(heat.getByLabelText(/seal broken/)).toBeInTheDocument();
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
