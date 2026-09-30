import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { vi } from "vitest";
import { WeekPage } from "./WeekPage";
import { Home } from "../Home";
import { BlockPrompt } from "../../components/BlockPrompt";
import { useStore } from "../../state/store";
import { usePlanner } from "../../state/planner";
import { connectNativeEvents } from "../../state/events";
import { checkSchedule, resetPrompted } from "../../state/schedule";
import { mockControls, resetMockBackend } from "../../lib/mockBackend";
import { native } from "../../lib/native";
import { sampleProfiles } from "../../lib/catalog";
import { WEEKDAYS_MASK } from "../../lib/planner";

const initialStore = useStore.getState();
const initialPlanner = usePlanner.getState();
let disconnect = () => {};

// Tuesday, Sep 29 2026, 9:30 AM.
const TUESDAY = new Date(2026, 8, 29, 9, 30);

async function setup() {
  for (const d of sampleProfiles()) await native.createProfile(d);
  await act(() => useStore.getState().loadProfiles());
  await act(() => usePlanner.getState().ensure("2026-09-28", "2026-10-04"));
}
const profileId = (name: string) => useStore.getState().profiles.find((p) => p.name === name)!.id;

/** Types into the open quick-add popover and presses Enter. */
async function quickAdd(text: string) {
  const input = within(screen.getByRole("dialog", { name: "Quick add" })).getByLabelText("Quick add");
  fireEvent.change(input, { target: { value: text } });
  await act(async () => fireEvent.keyDown(input, { key: "Enter" }));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(TUESDAY);
  resetMockBackend();
  resetPrompted();
  useStore.setState(initialStore, true);
  usePlanner.setState(initialPlanner, true);
  disconnect = connectNativeEvents();
});
afterEach(() => {
  disconnect();
  vi.useRealTimers();
});

describe("Week: one-time items", () => {
  it("adds a one-time item inline on a day and checks it off", async () => {
    await setup();
    render(<WeekPage />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Sep 28 – Oct 4");
    const thursday = screen.getByRole("region", { name: "Thursday, October 1" });
    fireEvent.click(within(thursday).getByRole("button", { name: "Add to Thursday" }));
    await quickAdd("Mock interview");
    const box = within(thursday).getByRole("checkbox", { name: "Mock interview" });
    expect(box.closest("[data-kind]")).toHaveAttribute("data-kind", "todo");
    await act(async () => fireEvent.click(box));
    expect(box).toHaveAttribute("aria-checked", "true");
  });

  it("edits and deletes a one-time item from its dialog", async () => {
    await setup();
    await act(async () => void (await usePlanner.getState().saveTodo({ title: "Pay rent", dueDate: "2026-09-30", dueTime: null, durationMin: null, profileId: null })));
    render(<WeekPage />);
    fireEvent.click(screen.getByRole("button", { name: /Pay rent/ }));
    const dialog = screen.getByRole("dialog", { name: "Edit item" });
    fireEvent.change(within(dialog).getByLabelText("Time"), { target: { value: "13:00" } });
    await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: /Save/ })));
    expect(usePlanner.getState().todos[0]!.dueTime).toBe("13:00");
    fireEvent.click(screen.getByRole("button", { name: /Pay rent/ }));
    await act(async () => fireEvent.click(within(screen.getByRole("dialog", { name: "Edit item" })).getByRole("button", { name: "Delete" })));
    expect(usePlanner.getState().todos).toHaveLength(0);
  });

  it("steps between weeks", async () => {
    await setup();
    render(<WeekPage />);
    fireEvent.click(screen.getByRole("button", { name: "Next week" }));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Oct 5 – 11");
    expect(screen.getByText("Upcoming")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "This week" }));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Sep 28 – Oct 4");
  });
});

describe("Week: routines are separate", () => {
  it("creates a routine with weekday chips in the Routines view and shows it on its days", async () => {
    await setup();
    render(<WeekPage />);
    fireEvent.click(screen.getByRole("tab", { name: "Routines" }));
    expect(screen.getByText("No routines yet. Add the things you do every day or every week.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /New routine/ }));
    const dialog = screen.getByRole("dialog", { name: "New routine" });
    fireEvent.change(within(dialog).getByLabelText("Title"), { target: { value: "Gym" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Weekdays" }));
    // Weekdays preset, then drop Tuesday and Thursday.
    fireEvent.click(within(dialog).getByRole("button", { name: "Tue" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Thu" }));
    fireEvent.change(within(dialog).getByLabelText("Time"), { target: { value: "07:00" } });
    await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: /Add routine/ })));
    const row = screen.getByTestId("routine-row");
    expect(row).toHaveTextContent("Gym");
    expect(row).toHaveTextContent("Mon Wed Fri");
    expect(row).toHaveTextContent("7:00a");

    fireEvent.click(screen.getByRole("tab", { name: "Week" }));
    const onDays = ["Monday, September 28", "Tuesday, September 29", "Wednesday, September 30"].map(
      (d) => within(screen.getByRole("region", { name: d })).queryByRole("checkbox", { name: "Gym" }) !== null,
    );
    expect(onDays).toEqual([true, false, true]);
    // Checking a routine off only marks that day.
    const monday = within(screen.getByRole("region", { name: "Monday, September 28" })).getByRole("checkbox", { name: "Gym" });
    await act(async () => fireEvent.click(monday));
    expect(monday).toHaveAttribute("aria-checked", "true");
    expect(within(screen.getByRole("region", { name: "Wednesday, September 30" })).getByRole("checkbox", { name: "Gym" })).toHaveAttribute("aria-checked", "false");
    expect(monday.closest("[data-kind]")).toHaveAttribute("data-kind", "routine");
  });

  it("pauses a routine from its row", async () => {
    await setup();
    await act(async () => void (await usePlanner.getState().saveRoutine({ title: "Weigh-in", daysMask: 127, time: "08:00", durationMin: null, profileId: null, active: true })));
    render(<WeekPage />);
    fireEvent.click(screen.getByRole("tab", { name: "Routines" }));
    await act(async () => fireEvent.click(screen.getByRole("switch", { name: "Weigh-in active" })));
    expect(usePlanner.getState().routines[0]!.active).toBe(false);
  });
});

describe("Week: list view and header", () => {
  it("reads day by day, with one-time items first and repeats grouped under them", async () => {
    await setup();
    await act(async () => {
      await usePlanner.getState().saveRoutine({ title: "Weigh", daysMask: 0b0010010, time: "08:00", durationMin: null, profileId: null, active: true });
      await usePlanner.getState().saveTodo({ title: "Reply to emails", dueDate: "2026-10-01", dueTime: null, durationMin: null, profileId: null });
    });
    render(<WeekPage />);
    fireEvent.click(screen.getByRole("tab", { name: "List" }));
    const thursday = screen.getByRole("region", { name: "Thursday list" });
    const rows = within(thursday).getAllByRole("checkbox").map((c) => [c.getAttribute("aria-label"), c.closest("[data-kind]")!.getAttribute("data-kind")]);
    expect(rows).toEqual([
      ["Reply to emails", "todo"],
      ["Weigh", "routine"],
    ]);
    expect(thursday).toHaveTextContent("Repeat");
    expect(within(screen.getByRole("region", { name: "Tuesday list" })).getByText("Today")).toBeInTheDocument();
    // Quick add on a day, like the To-do row in the reference page.
    fireEvent.focus(within(screen.getByRole("region", { name: "Saturday list" })).getByLabelText("Add a to-do on Saturday"));
    await quickAdd("Sheets laundry");
    expect(within(screen.getByRole("region", { name: "Saturday list" })).getByRole("checkbox", { name: "Sheets laundry" })).toBeInTheDocument();
  });

  it("collects unfinished one-time items from past days under Pending", async () => {
    await setup();
    await act(async () => {
      await native.saveTodo({ title: "Old errand", dueDate: "2026-09-20", dueTime: null, durationMin: null, profileId: null });
      const done = await native.saveTodo({ title: "Finished", dueDate: "2026-09-21", dueTime: null, durationMin: null, profileId: null });
      await native.setTodoDone(done.id, true);
    });
    render(<WeekPage />);
    fireEvent.click(screen.getByRole("tab", { name: "List" }));
    const pending = await screen.findByRole("region", { name: "Pending" });
    expect(within(pending).getByRole("checkbox", { name: "Old errand" })).toBeInTheDocument();
    expect(within(pending).queryByRole("checkbox", { name: "Finished" })).toBeNull();
    expect(pending).toHaveTextContent("Sep 20");
    await act(async () => fireEvent.click(within(pending).getByRole("checkbox", { name: "Old errand" })));
    expect(screen.queryByRole("region", { name: "Pending" })).toBeNull();
  });

  it("keeps New and the view tabs in the same place across views", async () => {
    await setup();
    render(<WeekPage />);
    const tabsBefore = screen.getByRole("tablist", { name: "View" });
    expect(screen.getByRole("button", { name: "New item" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Routines" }));
    expect(screen.getByRole("tablist", { name: "View" })).toBe(tabsBefore);
    expect(screen.getByRole("button", { name: "New routine" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "This week" })).toBeNull();
    // The Week tab reopens on the last view used.
    expect(await native.getSetting("week_view")).toBe("routines");
    expect(useStore.getState().settings.weekView).toBe("routines");
  });
});

describe("Home follows the schedule", () => {
  async function withBlock() {
    await setup();
    await act(
      async () =>
        void (await usePlanner
          .getState()
          .saveRoutine({ title: "Work session: SQL + DSA", daysMask: WEEKDAYS_MASK, time: "10:00", durationMin: 60, profileId: profileId("Deep Work"), active: true })),
    );
  }

  it("shows the next block before it starts", async () => {
    await withBlock();
    render(<Home />);
    act(() => void checkSchedule());
    const card = screen.getByTestId("suggestion");
    expect(card).toHaveTextContent("NEXT");
    expect(card).toHaveTextContent("Work session: SQL + DSA");
    expect(card).toHaveTextContent("at 10:00 AM");
    expect(card).toHaveTextContent("Deep Work · 60 min");
    // Nothing is pre-filled yet; Use applies it.
    expect(useStore.getState().selectedProfileId).toBe(profileId("Interview Prep"));
    fireEvent.click(within(card).getByRole("button", { name: "Use" }));
    expect(useStore.getState().selectedProfileId).toBe(profileId("Deep Work"));
  });

  it("during a block, pre-fills the profile and time left, and offers to start", async () => {
    await withBlock();
    vi.setSystemTime(new Date(2026, 8, 29, 10, 1));
    render(
      <>
        <Home />
        <BlockPrompt />
      </>,
    );
    act(() => void checkSchedule());
    const s = useStore.getState();
    expect([s.selectedProfileId, s.durationMin]).toEqual([profileId("Deep Work"), 60]);
    expect(screen.getByTestId("suggestion")).toHaveTextContent("NOW");
    const prompt = screen.getByRole("alertdialog", { name: "Deep Work starts now" });
    expect(prompt).toHaveTextContent("Work session: SQL + DSA · 60 min");
    await act(async () => fireEvent.click(within(prompt).getByRole("button", { name: /Enter focus/ })));
    expect(useStore.getState().session?.profileName).toBe("Deep Work");
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("keeps your manual pick for the rest of the block", async () => {
    await withBlock();
    vi.setSystemTime(new Date(2026, 8, 29, 10, 20));
    render(<Home />);
    act(() => void checkSchedule());
    expect(useStore.getState().durationMin).toBe(30); // 40 min left
    fireEvent.click(within(screen.getByRole("listbox", { name: "Length" })).getByRole("option", { name: "90 min" }));
    act(() => void checkSchedule());
    expect(useStore.getState().durationMin).toBe(90);
    // No second prompt for the same block.
    expect(useStore.getState().blockPrompt).toBeNull();
  });
});

describe("Home panels", () => {
  it("lists today's routines and items, and adds one-time items for today", async () => {
    await setup();
    await act(async () => void (await usePlanner.getState().saveRoutine({ title: "NeetCode daily", daysMask: 127, time: null, durationMin: null, profileId: profileId("Interview Prep"), active: true })));
    render(<Home />);
    const today = screen.getByRole("region", { name: "Today" });
    expect(within(today).getByText("NeetCode daily")).toBeInTheDocument();
    expect(within(today).getByText("Interview Prep")).toBeInTheDocument();
    fireEvent.focus(within(today).getByLabelText("Add a task for today"));
    await quickAdd("Call Mom");
    expect(within(today).getByText("Call Mom")).toBeInTheDocument();
    expect(usePlanner.getState().todos[0]!.dueDate).toBe("2026-09-29");
  });

  it("collapses panels and hides them via Customize, and remembers it", async () => {
    await setup();
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: "Collapse Schedule" }));
    expect(within(screen.getByRole("region", { name: "Schedule" })).queryByText("Nothing timed today.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Customize" }));
    fireEvent.click(screen.getByRole("switch", { name: "Show Focus today" }));
    expect(screen.queryByRole("region", { name: "Focus today" })).toBeNull();
    await waitFor(async () => expect(JSON.parse((await native.getSetting("home_layout"))!)).toEqual({ collapsed: ["schedule"], hidden: ["progress"] }));
  });
});

describe("Quick add popover", () => {
  it("fills picks from what you type, lets a click override, and adds a timed focus item", async () => {
    await setup();
    render(<WeekPage />);
    fireEvent.click(within(screen.getByRole("region", { name: "Wednesday, September 30" })).getByRole("button", { name: "Add to Wednesday" }));
    const panel = screen.getByRole("dialog", { name: "Quick add" });
    // The column's day is the default.
    expect(within(within(panel).getByRole("group", { name: "Day" })).getByRole("button", { name: "Tomorrow" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.change(within(panel).getByLabelText("Quick add"), { target: { value: "Mock interview thu 3pm @interview" } });
    expect(within(within(panel).getByRole("group", { name: "Time" })).getByRole("button", { name: "3pm" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("quick-preview")).toHaveTextContent("Mock interview · Once · Thu, Oct 1 · 3:00 PM · Interview Prep");
    // Clicking a length chip adds to what was typed.
    fireEvent.click(within(within(panel).getByRole("group", { name: "Length" })).getByRole("button", { name: "1.5h" }));
    await act(async () => fireEvent.click(within(panel).getByRole("button", { name: /^Add/ })));
    expect(usePlanner.getState().todos.find((t) => t.title === "Mock interview")).toMatchObject({
      dueDate: "2026-10-01",
      dueTime: "15:00",
      durationMin: 90,
      profileId: profileId("Interview Prep"),
    });
    // Stays open and clears for the next one; Esc closes.
    expect(within(panel).getByLabelText("Quick add")).toHaveValue("");
    fireEvent.keyDown(within(panel).getByLabelText("Quick add"), { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Quick add" })).toBeNull();
  });

  it("makes a routine when it repeats", async () => {
    await setup();
    render(<WeekPage />);
    fireEvent.click(screen.getByRole("button", { name: "Add to Monday" }));
    const panel = screen.getByRole("dialog", { name: "Quick add" });
    fireEvent.change(within(panel).getByLabelText("Quick add"), { target: { value: "Gym 7am" } });
    fireEvent.click(within(within(panel).getByRole("group", { name: "Repeat" })).getByRole("button", { name: "Weekdays" }));
    // Weekday toggles replace the day picks; turning Friday off.
    fireEvent.click(within(within(panel).getByRole("group", { name: "On" })).getByRole("button", { name: "Fri" }));
    expect(screen.getByTestId("quick-preview")).toHaveTextContent("Gym · Routine · Mon Tue Wed Thu · 7:00 AM");
    await act(async () => fireEvent.click(within(panel).getByRole("button", { name: /Add routine/ })));
    expect(usePlanner.getState().routines.find((r) => r.title === "Gym")).toMatchObject({ daysMask: 0b0011110, time: "07:00" });
  });
});

describe("Month view", () => {
  it("shows the month grid with routine progress and items, and opens a week from a day", async () => {
    await setup();
    await act(async () => void (await usePlanner.getState().saveRoutine({ title: "Stretch", daysMask: 127, time: null, durationMin: null, profileId: null, active: true })));
    await act(async () => void (await usePlanner.getState().saveTodo({ title: "Pay rent", dueDate: "2026-10-01", dueTime: null, durationMin: null, profileId: null })));
    render(<WeekPage />);
    fireEvent.click(screen.getByRole("tab", { name: "Month" }));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("September 2026");
    const today = screen.getByRole("button", { name: "Tuesday, September 29" });
    expect(within(today).getByTestId("month-routines")).toHaveTextContent("0/1");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Next month" })));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("October 2026");
    const oct1 = screen.getByRole("button", { name: "Thursday, October 1" });
    expect(oct1).toHaveTextContent("Pay rent");
    // Future days show how many routines, not progress.
    expect(within(oct1).getByTestId("month-routines")).toHaveTextContent(/^1$/);
    fireEvent.click(oct1);
    expect(screen.getByRole("tab", { name: "Week" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Sep 28 – Oct 4");
  });
});

describe("Streak marks", () => {
  it("marks each day in Week and dots each day in Month", async () => {
    await setup();
    mockControls.statsDays({
      "2026-09-26": { focusMin: 130 },
      "2026-09-27": { focusMin: 30 },
      "2026-09-28": { focusMin: 150, brokenAt: new Date(2026, 8, 28, 14, 14).getTime() },
    });
    await act(async () => render(<WeekPage />));
    const monday = screen.getByRole("region", { name: "Monday, September 28" });
    expect(await within(monday).findByTestId("streak-mark")).toHaveTextContent("Broken 2:14p");
    const tuesday = screen.getByRole("region", { name: "Tuesday, September 29" });
    expect(within(tuesday).getByTestId("streak-mark")).toHaveTextContent("In progress");
    expect(within(screen.getByRole("region", { name: "Wednesday, September 30" })).queryByTestId("streak-mark")).toBeNull();

    await act(async () => fireEvent.click(screen.getByRole("tab", { name: "Month" })));
    const dots = await screen.findAllByTestId("streak-dot");
    const status = (d: string) => dots.find((x) => x.closest("button")?.getAttribute("aria-label")?.includes(d))?.getAttribute("data-status");
    expect(status("September 26")).toBe("kept");
    expect(status("September 27")).toBe("missed");
  });
});
