import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StatsPage } from "./StatsPage";
import { useStore } from "../../state/store";
import { useRecap, recapLines } from "../../state/recap";
import { RecapNotice } from "../../components/RecapNotice";
import { mockControls, resetMockBackend } from "../../lib/mockBackend";
import { native } from "../../lib/native";
import { todayKey } from "../../lib/planner";

const initial = { store: useStore.getState(), recap: useRecap.getState() };

beforeEach(() => {
  resetMockBackend();
  useStore.setState(initial.store, true);
  useRecap.setState(initial.recap, true);
});

const at = (key: string, h: number) => new Date(`${key}T${String(h).padStart(2, "0")}:00:00`).getTime();
const today = todayKey(new Date(), "00:00");

async function openTab(name: string) {
  render(<StatsPage />);
  await act(async () => fireEvent.click(screen.getByRole("tab", { name })));
}

describe("Stats in depth (v0.3)", () => {
  it("Sessions: lists, filters, totals, details, and CSV", async () => {
    mockControls.insightSession({ profileName: "Deep Work", profileId: 1, startedAt: at(today, 9), plannedMin: 60 }, { blocked: [{ what: "discord.exe", kind: "app", count: 2 }] });
    mockControls.insightSession({ profileName: "Study", profileId: 2, startedAt: at(today, 14), plannedMin: 45, focusMin: 20, outcome: "broken" }, { tamper: [{ at: at(today, 14) + 1_200_000, what: "The clock changed" }] });
    await openTab("Sessions");
    const list = await screen.findByRole("region", { name: "Sessions" });
    await waitFor(() => expect(within(list).getAllByRole("button")).toHaveLength(2));
    const totals = within(screen.getByRole("list", { name: "Totals" }));
    expect(totals.getByText("1h 20m")).toBeInTheDocument();

    await act(async () => fireEvent.change(screen.getByRole("combobox", { name: "Outcome" }), { target: { value: "broken" } }));
    await waitFor(() => expect(within(list).getAllByRole("button")).toHaveLength(1));

    await act(async () => fireEvent.click(within(list).getByRole("button", { name: /Study/ })));
    const dialog = within(await screen.findByRole("dialog", { name: "Session" }));
    expect(await dialog.findByText("The clock changed")).toBeInTheDocument();
    expect(dialog.getByText("Broken")).toBeInTheDocument();
    fireEvent.click(dialog.getByRole("button", { name: "Done" }));

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Export CSV" })));
    expect(useStore.getState().notice?.lead).toBe("Saved.");
  });

  it("Activity: apps and sites, and one click reclassifies (everywhere or one profile)", async () => {
    mockControls.insightActivity([
      { ts: at(today, 9), seconds: 1800, exe: "code.exe", title: "main.rs", category: "productive", sessionId: null },
      { ts: at(today, 10), seconds: 600, exe: "chrome.exe", title: "Lecture - YouTube — youtube.com", category: "distracting", sessionId: null },
    ]);
    await openTab("Activity");
    const sites = within(await screen.findByRole("region", { name: "Sites" }));
    expect(await sites.findByText("youtube.com")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Apps" })).getByText("code")).toBeInTheDocument();

    await act(async () => fireEvent.change(sites.getByRole("combobox", { name: "youtube.com is" }), { target: { value: "productive" } }));
    expect(useStore.getState().notice?.lead).toBe("youtube.com is productive everywhere.");
    expect(mockControls.insightState().activity[1]!.category).toBe("productive");
    expect(mockControls.insightState().rules).toContainEqual({ kind: "domain", pattern: "youtube.com", category: "productive" });
  });

  it("Day: the strip, sessions above it, and the biggest blocks", async () => {
    mockControls.insightSession({ profileName: "Deep Work", startedAt: at(today, 9), plannedMin: 60 });
    mockControls.insightActivity([
      { ts: at(today, 9), seconds: 1800, exe: "code.exe", title: "a", category: "productive", sessionId: 1 },
      { ts: at(today, 9) + 1_800_000, seconds: 300, exe: "chrome.exe", title: "Shorts — youtube.com", category: "distracting", sessionId: 1 },
    ]);
    await openTab("Day");
    expect(await screen.findByRole("img", { name: /^Deep Work, .* Kept$/ })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /^youtube\.com, .* Distracting$/ })).toBeInTheDocument();
    const top = within(screen.getByRole("region", { name: "Biggest blocks" }));
    expect(top.getByText("code")).toBeInTheDocument();
    // Hover tells what a stretch was.
    fireEvent.pointerEnter(screen.getByRole("img", { name: /^code,/ }));
    expect(screen.getByText(/· Productive$/)).toBeInTheDocument();
  });

  it("the Monday recap shows once a week, says it plainly, and opens Stats", async () => {
    const recap = { week: "2026-10-19", focusMin: 680, previousFocusMin: 560, kept: 5, broken: 1, days: 6, bestDay: "2026-10-20", bestDayMin: 240, mostTempting: "discord.exe", sessions: 12 };
    expect(recapLines(recap).lines).toEqual([
      "11h 20m in focus over 12 sessions, up 2h from the week before.",
      "5 of 6 days kept, 1 with a broken seal.",
      "Best day: Tuesday, 4h.",
      "Most tempting: discord.",
    ]);
    mockControls.insightRecap(recap);
    await act(() => useRecap.getState().check());
    render(<RecapNotice />);
    expect(screen.getByRole("region", { name: "Last week" })).toBeInTheDocument();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "See the week" })));
    expect(useStore.getState().activeTab).toBe("stats");
    // Seen: not again this week.
    await act(() => useRecap.getState().check());
    expect(useRecap.getState().recap).toBeNull();
    expect(await native.getSetting("recap_seen_week")).toBeTruthy();
  });
});
