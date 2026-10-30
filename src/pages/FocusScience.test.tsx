import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Home } from "./Home";
import { HeldPage } from "./HeldPage";
import { brokeLine, planLine } from "./headlines";
import { ParkCard, PauseCard } from "../windows/Intercept";
import { PauseModeSection } from "./setup/PauseMode";
import { WeekTargetRow } from "./setup/WeekTarget";
import { DndQuietRow } from "./setup/Dnd";
import { Suggestions } from "./stats/Suggestions";
import { RecapNotice } from "../components/RecapNotice";
import { useRecap } from "../state/recap";
import { useStore } from "../state/store";
import { usePlanner } from "../state/planner";
import { connectNativeEvents } from "../state/events";
import { mockControls, resetMockBackend } from "../lib/mockBackend";
import { native } from "../lib/native";
import { sampleProfiles } from "../lib/catalog";
import { addDays, todayKey } from "../lib/planner";

// The seal's science (v0.3.1): a goal and an if-then plan at the start, thoughts parked during,
// and how it went (with where you left off) at the end.

const initial = { store: useStore.getState(), planner: usePlanner.getState() };
let disconnect = () => {};
beforeEach(async () => {
  resetMockBackend();
  useStore.setState(initial.store, true);
  usePlanner.setState(initial.planner, true);
  disconnect = connectNativeEvents();
  await native.createProfile(sampleProfiles()[0]!);
  await act(() => useStore.getState().loadProfiles());
});
afterEach(() => disconnect());

const todayItems = () => native.listTodos(addDays(todayKey(), -1), addDays(todayKey(), 1));

describe("the seal's intent", () => {
  it("starts with a goal and a plan; the profile remembers the plan, and the overlay shows it", async () => {
    render(<Home />);
    const intent = within(screen.getByTestId("focus-intent"));
    fireEvent.change(intent.getByLabelText("Will be done"), { target: { value: "  Problem set 4  " } });
    fireEvent.change(intent.getByLabelText("If I'm tempted, I'll"), { target: { value: "stand up and stretch" } });
    await act(async () => fireEvent.keyDown(intent.getByLabelText("Will be done"), { key: "Enter" }));
    const s = useStore.getState().session!;
    expect(s.plan).toBe("stand up and stretch");
    expect(s.goal).toBe("Problem set 4");
    expect(screen.getByTestId("session-bar")).toHaveTextContent("Problem set 4");
    // The goal is this seal's; the plan comes back for the profile next time.
    expect(useStore.getState().focusGoal).toBe("");
    await act(async () => mockControls.fastForward(60 * 60_000));
    useStore.setState({ focusPlan: "", focusPlanFor: null });
    await act(() => useStore.getState().prepareFocus());
    expect(useStore.getState().focusPlan).toBe("stand up and stretch");
  });

  it("phrases the plan the same way whether or not you typed \"I'll\"", () => {
    expect(planLine("stand up and stretch")).toBe("If you're tempted, you said you'd stand up and stretch.");
    expect(planLine("I'll drink some water.")).toBe("If you're tempted, you said you'd drink some water.");
  });
});

describe("parking a thought", () => {
  it("from Home while sealed: a task for today, then kept, moved, or dropped on the held page", async () => {
    render(<Home />);
    await act(() => useStore.getState().enterFocus());
    const park = within(screen.getByTestId("park"));
    for (const t of ["Email Alex", "Look up the lab hours"]) {
      fireEvent.change(park.getByLabelText("Park a thought for later"), { target: { value: t } });
      await act(async () => fireEvent.submit(screen.getByTestId("park")));
    }
    expect(useStore.getState().notice?.lead).toBe("Parked.");
    const sessionId = useStore.getState().session!.id;
    const items = await todayItems();
    expect(items.filter((t) => t.parkedFrom === sessionId).map((t) => t.title)).toEqual(["Email Alex", "Look up the lab hours"]);

    await act(async () => mockControls.fastForward(60 * 60_000));
    await act(() => usePlanner.getState().reload());
    render(<HeldPage held={useStore.getState().held!} />);
    const parked = within(screen.getByTestId("held-parked"));
    await act(async () => fireEvent.click(parked.getAllByRole("button", { name: "Tomorrow" })[0]!));
    await act(async () => fireEvent.click(parked.getByRole("button", { name: "Delete Look up the lab hours" })));
    const after = await todayItems();
    expect(after.find((t) => t.title === "Email Alex")?.dueDate).toBe(addDays(todayKey(), 1));
    expect(after.some((t) => t.title === "Look up the lab hours")).toBe(false);
  });

  it("from the Ctrl Alt P card", async () => {
    await act(() => useStore.getState().enterFocus());
    const done = vi.fn();
    render(<ParkCard onDone={done} />);
    fireEvent.change(screen.getByLabelText("The thought"), { target: { value: "Buy printer ink" } });
    await act(async () => fireEvent.submit(screen.getByRole("dialog", { name: "Park a thought" })));
    expect(screen.getByRole("status")).toHaveTextContent("Parked.");
    expect((await todayItems()).find((t) => t.title === "Buy printer ink")?.parkedFrom).toBe(useStore.getState().session!.id);
  });

  it("needs a seal", async () => {
    await expect(native.focusPark("Later")).rejects.toBe("Parking works while sealed.");
  });
});

describe("how it went", () => {
  it("saves Done / Partly / No, the rating, and where you left off, which the next seal shows", async () => {
    await act(() => useStore.getState().enterFocus());
    await act(async () => mockControls.fastForward(60 * 60_000));
    const held = useStore.getState().held!;
    render(<HeldPage held={held} />);
    const wrap = within(screen.getByTestId("held-wrap"));
    fireEvent.click(wrap.getByRole("radio", { name: "Partly" }));
    fireEvent.click(wrap.getByRole("radio", { name: "4" }));
    fireEvent.change(wrap.getByLabelText("Where I left off"), { target: { value: "Halfway through question 3" } });
    expect(wrap.getByRole("radio", { name: "Partly" })).toBeChecked();
    // Leaving the page saves it.
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /^Done/ })));
    render(<Home />);
    await act(() => useStore.getState().prepareFocus());
    expect(screen.getByTestId("left-off")).toHaveTextContent("Last time: Halfway through question 3");
  });

  it("asks about the goal by name", async () => {
    useStore.setState({ focusGoal: "Chapter 7" });
    await act(() => useStore.getState().enterFocus());
    await act(async () => mockControls.fastForward(60 * 60_000));
    render(<HeldPage held={useStore.getState().held!} />);
    expect(screen.getByTestId("held-wrap")).toHaveTextContent("Did Chapter 7 get done?");
  });
});

describe("after a break", () => {
  it("says what broke it plainly, with the fix", () => {
    expect(brokeLine({ kind: "extension", afterMin: 34 })).toEqual({ line: "A browser ran without the extension 34 minutes in.", fix: { label: "Check the extension", tab: "browser" } });
    expect(brokeLine({ kind: "shutdown", afterMin: 1 }).line).toBe("The PC went off 1 minute in. Restarts fit best between seals.");
    expect(brokeLine({ kind: "clock", afterMin: 5 }).fix).toBeNull();
    render(<HeldPage held={{ sessionId: 9, profileId: 1, profileName: "Study", plannedMinutes: 60, focusMinutes: 30, attempts: 0, broken: true, broke: { kind: "killed", afterMin: 12 } }} />);
    expect(screen.getByTestId("held-page")).toHaveTextContent("Sanctum was closed 12 minutes in.");
    fireEvent.click(screen.getByRole("button", { name: "Turn on Protection" }));
    expect(useStore.getState().activeTab).toBe("setup");
  });
});

describe("pause mode", () => {
  it("is off until you pick a mode, and validates the hours", async () => {
    render(<PauseModeSection />);
    const mode = await screen.findByRole("combobox", { name: "Pause mode" });
    expect(screen.getByTestId("pause-status")).toHaveTextContent("Off");
    await act(async () => fireEvent.change(mode, { target: { value: "all" } }));
    expect(await native.pauseStatus()).toMatchObject({ config: { mode: "all" }, on: true });
    expect(screen.getByTestId("pause-status")).toHaveTextContent("Asking first right now");
    await act(async () => fireEvent.change(mode, { target: { value: "hours" } }));
    expect(screen.getByTestId("pause-hours")).toBeInTheDocument();
    await act(async () => fireEvent.change(screen.getByRole("combobox", { name: "Until" }), { target: { value: "09:00" } }));
    expect(useStore.getState().notice?.lead).toBe("Pause hours need a start and an end that differ.");
  });

  it("the card waits five seconds before Go on works; Not now is the default", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval"] });
    const answer = vi.fn();
    render(<PauseCard p={{ kind: "pause", label: "Discord", attempts: 0, profileName: "", elapsedMs: 0, remainingMs: 5000, backTo: null, keyword: null, endsAt: Date.now() + 5000 }} onAnswer={answer} />);
    expect(screen.getByRole("alertdialog", { name: "Still want Discord?" })).toHaveTextContent("It opens in 5s");
    expect(screen.getByRole("button", { name: "Go on" })).toBeDisabled();
    fireEvent.keyDown(window, { key: "Enter" });
    expect(answer).toHaveBeenLastCalledWith(false);
    await act(async () => vi.advanceTimersByTime(5_500));
    expect(screen.getByRole("button", { name: "Go on" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Go on" }));
    expect(answer).toHaveBeenLastCalledWith(true);
    vi.useRealTimers();
  });
});

describe("a break after a seal", () => {
  it("starts from the held page, shows on Home, and offers the next block when it ends", async () => {
    await act(() => useStore.getState().enterFocus());
    const profileId = useStore.getState().session!.profileId;
    await act(async () => mockControls.fastForward(60 * 60_000));
    const held = useStore.getState().held!;
    const { unmount } = render(<HeldPage held={held} />);
    await act(async () => fireEvent.click(within(screen.getByTestId("held-break")).getByRole("button", { name: "10 min" })));
    unmount();
    expect(useStore.getState().held).toBeNull();
    render(<Home />);
    expect(screen.getByTestId("break-bar")).toHaveTextContent("Break");
    expect(screen.queryByTestId("focus-row")).toBeNull();
    // Seals don't start inside a break by accident: the break card replaces the focus row.
    await act(async () => mockControls.breakOver());
    expect(screen.queryByTestId("break-bar")).toBeNull();
    expect(useStore.getState().notice?.lead).toBe("Break's over.");
    await act(async () => useStore.getState().notice!.action!.run());
    expect(useStore.getState().session?.profileId).toBe(profileId);
    expect(useStore.getState().session?.plannedMinutes).toBe(held.plannedMinutes);
  });

  it("ends early for free", async () => {
    await act(async () => void (await native.breakStart(5, null, 60)));
    render(<Home />);
    await act(() => useStore.getState().loadBreak());
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "End break" })));
    expect(useStore.getState().brk).toBeNull();
    expect(screen.getByTestId("focus-row")).toBeInTheDocument();
  });
});

describe("the week, reviewed", () => {
  const recap = { week: "2026-10-19", focusMin: 680, previousFocusMin: 560, kept: 5, broken: 1, days: 6, bestDay: "2026-10-20", bestDayMin: 240, mostTempting: "discord.exe", sessions: 12 };

  it("the Monday card keeps your answers and this week's target", async () => {
    useRecap.setState({ recap });
    render(<RecapNotice />);
    const card = within(screen.getByRole("region", { name: "Last week" }));
    const target = await card.findByLabelText("This week's target, in hours");
    // A new install starts at the daily goal for five days: 2h x 5.
    await waitFor(() => expect(target).toHaveValue(10));
    expect(card.getByText(/the target is your recent average/)).toBeInTheDocument();
    fireEvent.change(card.getByLabelText("What worked?"), { target: { value: "Mornings, phone in the other room" } });
    fireEvent.change(card.getByLabelText("What will you change?"), { target: { value: "Start before 9" } });
    fireEvent.change(target, { target: { value: "12.5" } });
    await act(async () => fireEvent.click(card.getByRole("button", { name: "Save" })));
    expect(mockControls.reviewState().saved[Object.keys(mockControls.reviewState().saved)[0]!]).toEqual({ worked: "Mornings, phone in the other room", change: "Start before 9" });
    expect((await native.reviewWeekTarget()).targetMin).toBe(750);
    expect(useStore.getState().notice?.rest).toBe("It's on today's journal page too.");
    expect(useRecap.getState().recap).toBeNull();
  });

  it("Home shows the week against its target; Setup changes it or goes back to the average", async () => {
    render(<Home />);
    expect(await screen.findByTestId("week-progress")).toHaveTextContent("Week 0m of 10h");
    render(<WeekTargetRow />);
    const input = await screen.findByLabelText("Week's focus target, in hours");
    fireEvent.change(input, { target: { value: "8" } });
    await act(async () => fireEvent.blur(input));
    expect((await native.reviewWeekTarget()).targetMin).toBe(480);
    await act(async () => fireEvent.click(await screen.findByRole("button", { name: "Use my average" })));
    expect((await native.reviewWeekTarget()).isDefault).toBe(true);
  });

  it("suggestions from your history do what they say", async () => {
    const [p] = await native.listProfiles();
    mockControls.suggestions([
      { kind: "length", line: "Your 45-minute seals finish 90% of the time; 90-minute ones 55%.", profileId: p!.id, minutes: 45 },
      { kind: "hours", line: "Your kept seals cluster 9 AM to 11 AM.", start: "09:00", end: "11:00", profileId: p!.id },
      { kind: "tempted", line: "Discord gets in most after 40 minutes.", what: "discord.exe", afterMin: 40 },
    ]);
    render(<Suggestions />);
    const card = within(await screen.findByRole("region", { name: "From your own history" }));
    await act(async () => fireEvent.click(card.getByRole("button", { name: "Use 45 min" })));
    expect((await native.listProfiles()).find((x) => x.id === p!.id)?.defaultMinutes).toBe(45);
    expect(useStore.getState().durationMin).toBe(45);
    await act(async () => fireEvent.click(card.getByRole("button", { name: "Add a focus block" })));
    expect((await native.listRoutines()).find((r) => r.title === "Focus block")).toMatchObject({ time: "09:00", durationMin: 120, profileId: p!.id });
    await act(async () => fireEvent.click(card.getByRole("button", { name: "Write an if-then" })));
    expect(useStore.getState().activeTab).toBe("today");
  });

  it("the focus row says your best length when you've picked another", async () => {
    const [p] = await native.listProfiles();
    mockControls.suggestions([{ kind: "length", line: "Your 45-minute seals finish 90% of the time; 90-minute ones 55%.", profileId: p!.id, minutes: 45 }]);
    useStore.getState().setDuration(90);
    render(<Home />);
    const tip = await screen.findByTestId("length-tip");
    await act(async () => fireEvent.click(within(tip).getByRole("button", { name: "Use 45 min" })));
    expect(useStore.getState().durationMin).toBe(45);
    expect(screen.queryByTestId("length-tip")).toBeNull();
  });

  it("Do not disturb can follow quiet hours too", async () => {
    render(<DndQuietRow />);
    const sw = await screen.findByRole("switch", { name: "Do not disturb in quiet hours" });
    expect(sw).not.toBeChecked();
    await act(async () => fireEvent.click(sw));
    expect((await native.dndStatus()).quiet).toBe(true);
  });
});
