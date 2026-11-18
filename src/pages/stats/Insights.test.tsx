import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StatsPage } from "./StatsPage";
import { useStore } from "../../state/store";
import { useRecap, recapFigures } from "../../state/recap";
import { RecapNotice } from "../../components/RecapNotice";
import { mockControls, resetMockBackend } from "../../lib/mockBackend";
import { native } from "../../lib/native";
import { todayKey } from "../../lib/planner";

const initial = { store: useStore.getState(), recap: useRecap.getState() };

// A fixed afternoon: before the app's 04:00 day start, "today" is still yesterday, so a run
// just after midnight (as on CI) would look for the data on the wrong day.
const NOW = new Date(2026, 9, 28, 17, 0);
beforeAll(() => vi.useFakeTimers({ toFake: ["Date"], now: NOW }));
afterAll(() => vi.useRealTimers());

beforeEach(() => {
  resetMockBackend();
  useStore.setState(initial.store, true);
  useRecap.setState(initial.recap, true);
});

const at = (key: string, h: number) => new Date(`${key}T${String(h).padStart(2, "0")}:00:00`).getTime();
const today = todayKey(NOW, "00:00");

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

  it("the Monday recap opens as a dialog with two figures, and See the week opens Stats", async () => {
    const recap = { week: "2026-10-19", focusMin: 680, previousFocusMin: 560, kept: 5, broken: 1, days: 6, bestDay: "2026-10-20", bestDayMin: 240, mostTempting: "discord.exe", sessions: 12 };
    expect(recapFigures(recap)).toEqual({
      focus: { value: "11h 20m", previous: "9h 20m", note: "In focus, up 2h on the week before", direction: "up", delta: "+2h" },
      kept: { value: "5 of 6", note: "Days kept, 1 with a broken seal" },
      aside: "Best day: Tuesday, 4h.",
    });
    expect(recapFigures({ ...recap, previousFocusMin: 0, broken: 0, bestDay: null }).focus.note).toBe("In focus");
    mockControls.insightRecap(recap);
    await native.setSetting("weekly_recap", "1");
    await act(() => useRecap.getState().check());
    render(<RecapNotice />);
    const dialog = screen.getByRole("dialog", { name: "Last week" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    // Named by its visible subline (no second copy of "Last week"), described by the figures.
    expect(dialog).not.toHaveAttribute("aria-label");
    expect(dialog).toHaveAttribute("aria-describedby", "recap-figures");
    expect(document.getElementById("recap-figures")).toContainElement(within(dialog).getByRole("group", { name: "Days kept" }));
    // Focus moves in, onto the one primary action.
    expect(within(dialog).getByRole("button", { name: "See the week" })).toHaveFocus();
    expect(within(dialog).getByRole("group", { name: "Days kept" })).toHaveTextContent("5 of 6");
    await waitFor(() => expect(within(dialog).getByRole("group", { name: "Focus time" })).toHaveTextContent("11h 20m"));
    expect(within(dialog).getByText("Best day: Tuesday, 4h.")).toBeInTheDocument();
    // Less to read: no most tempting, no target, one field at most.
    expect(within(dialog).queryByText(/discord/)).toBeNull();
    expect(within(dialog).getAllByRole("textbox")).toHaveLength(1);
    await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "See the week" })));
    expect(useStore.getState().activeTab).toBe("stats");
    expect(screen.queryByRole("dialog")).toBeNull();
    // Seen: not again this week.
    await act(() => useRecap.getState().check());
    expect(useRecap.getState().recap).toBeNull();
    expect(await native.getSetting("recap_seen_week")).toBeTruthy();
  });

  it("shows the week as a strip: a bar per day, kept days in the accent, the best day's letter in the second color", async () => {
    const day = (date: string, status: "kept" | "missed" | "broken" | "rest", focusMin: number) => ({ date, status, focusMin });
    useRecap.setState({
      recap: {
        week: "2026-10-19", focusMin: 680, previousFocusMin: 860, kept: 4, broken: 1, days: 6, bestDay: "2026-10-20", bestDayMin: 240, mostTempting: null, sessions: 12,
        daily: [day("2026-10-19", "kept", 120), day("2026-10-20", "kept", 240), day("2026-10-21", "missed", 20), day("2026-10-22", "broken", 60), day("2026-10-23", "kept", 140), day("2026-10-24", "kept", 100), day("2026-10-25", "rest", 0)],
      },
    });
    render(<RecapNotice />);
    const strip = screen.getByRole("img", { name: "Focus each day. Best day: Tuesday." });
    const cols = Array.from(strip.children) as HTMLElement[];
    expect(cols).toHaveLength(7);
    expect(cols[1].querySelector("[data-bar]")).toHaveClass("bg-sealed");
    expect(cols[1].querySelector("[data-bar]")).toHaveStyle({ height: "100%" });
    expect(cols[2].querySelector("[data-bar]")).toHaveClass("bg-check-line");
    expect(cols[1]).toHaveTextContent("T");
    expect(within(cols[1]).getByText("T")).toHaveClass("text-second-text");
    expect(cols[6].querySelector("[data-bar]")).toBeNull();
    expect(cols[6].firstElementChild).toHaveClass("border-dashed");
    // The quiet aside gives way to the strip; the change shows as a signed figure.
    expect(screen.queryByText(/^Best day:/)).toBeNull();
    expect(screen.getByText("−3h")).toHaveClass("text-second-text");
    expect(screen.getByRole("group", { name: "Days kept" })).toHaveTextContent("4 of 6 days kept, 1 broken");
  });

  it("Escape closes the recap and marks the week seen", async () => {
    mockControls.insightRecap({ week: "2026-10-19", focusMin: 45, previousFocusMin: 0, kept: 1, broken: 0, days: 2, bestDay: null, bestDayMin: 0, mostTempting: null, sessions: 1 });
    await native.setSetting("weekly_recap", "1");
    await act(() => useRecap.getState().check());
    render(<RecapNotice />);
    expect(screen.getByRole("group", { name: "Focus time" })).toHaveTextContent("45m");
    await act(async () => fireEvent.keyDown(window, { key: "Escape" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(useStore.getState().activeTab).not.toBe("stats");
    expect(await native.getSetting("recap_seen_week")).toBeTruthy();
    expect(mockControls.reviewState().saved).toEqual({});
  });

  it("the weekly recap is off by default: no dialog, but the week is still marked seen", async () => {
    mockControls.insightRecap({ week: "2026-10-19", focusMin: 680, previousFocusMin: 560, kept: 5, broken: 1, days: 6, bestDay: "2026-10-20", bestDayMin: 240, mostTempting: null, sessions: 12 });
    const shown = vi.spyOn(native, "reviewRecapShown");
    await act(() => useRecap.getState().check());
    expect(useRecap.getState().recap).toBeNull();
    expect(await native.getSetting("recap_seen_week")).toBeTruthy();
    // The partner's weekly summary doesn't depend on the card.
    expect(shown).toHaveBeenCalled();
    shown.mockRestore();
  });
});
