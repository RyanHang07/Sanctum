import { OPEN_IDLE } from "./headlines";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Home } from "./Home";
import { useStore } from "../state/store";
import { connectNativeEvents } from "../state/events";
import { mockControls, resetMockBackend } from "../lib/mockBackend";
import { native } from "../lib/native";
import { catalogDistractions, sampleProfiles } from "../lib/catalog";
import { usePlanner } from "../state/planner";
import { useTrackers } from "../state/trackers";
import { RoutineDialog } from "./week/editors";
import { useItemSelect } from "./itemSelect";
import { homeLine } from "./headlines";
import { EVERY_DAY, addDays, todayKey } from "../lib/planner";

const initial = useStore.getState();
const initialPlanner = usePlanner.getState();
const initialTrackers = useTrackers.getState();

/** The sample profiles, and the four common distractions onboarding starts with. */
async function withSampleProfiles() {
  for (const d of sampleProfiles()) await native.createProfile(d);
  for (const g of catalogDistractions().filter((g) => ["Discord", "YouTube", "Instagram", "TikTok"].includes(g.label))) {
    for (const item of g.items) await native.addDistraction(item);
  }
  await act(() => useStore.getState().loadProfiles());
  await act(() => useStore.getState().loadDistractions());
}

let disconnect = () => {};
beforeEach(() => {
  resetMockBackend();
  useStore.setState(initial, true);
  usePlanner.setState(initialPlanner, true);
  useTrackers.setState(initialTrackers, true);
  useItemSelect.setState({ key: null, editing: null });
  disconnect = connectNativeEvents();
});
afterEach(() => disconnect());

/** A focus picker's trigger, by its label. */
const picker = (name: string) => screen.getByRole("button", { name: new RegExp(`^${name} `) });

/** A drag from one row onto another, landing in its top half (jsdom rows have no height). */
function drag(from: HTMLElement, to: HTMLElement) {
  const dataTransfer = { setData: () => undefined, effectAllowed: "", dropEffect: "" };
  fireEvent.dragStart(from, { dataTransfer });
  fireEvent.dragOver(to, { dataTransfer, clientY: 0 });
  fireEvent.drop(to, { dataTransfer, clientY: 0 });
  fireEvent.dragEnd(from, { dataTransfer });
}

describe("Home Today list (v0.1)", () => {
  it("puts routines on the left and the day's items on the right, sinks checked items, and drags untimed ones", async () => {
    const day = todayKey();
    const base = { profileId: null, active: true, daysMask: EVERY_DAY, durationMin: null };
    await native.saveRoutine({ ...base, title: "Stretch", time: null });
    await native.saveRoutine({ ...base, title: "Read", time: null });
    await native.saveRoutine({ ...base, title: "Run", time: "07:00" });
    const todo = (title: string, dueTime: string | null) => native.saveTodo({ title, dueDate: day, dueTime, durationMin: null, profileId: null });
    await todo("Pay rent", null);
    await todo("Call mom", null);
    await todo("Dentist", "15:00");
    await act(() => usePlanner.getState().ensure(day, addDays(day, 1)));
    await act(async () => void render(<Home />));

    const titles = (id: string) => within(screen.getByTestId(id)).getAllByRole("checkbox").map((c) => c.getAttribute("aria-label"));
    expect(titles("routines-column")).toEqual(["Run", "Stretch", "Read"]);
    expect(titles("day-column")).toEqual(["Dentist", "Pay rent", "Call mom"]);

    // Checked off: to the bottom, still in order; unchecked, back in place.
    await act(async () => fireEvent.click(screen.getByRole("checkbox", { name: "Run" })));
    expect(titles("routines-column")).toEqual(["Stretch", "Read", "Run"]);

    // Untimed items drag into place, and the order is saved.
    const row = (name: string) => screen.getByRole("checkbox", { name }).closest("[data-testid=task-row]") as HTMLElement;
    expect(row("Dentist")).not.toHaveAttribute("draggable");
    // A one-time item drags once it's selected: the first click picks it.
    fireEvent.click(row("Call mom"));
    await act(async () => drag(row("Call mom"), row("Pay rent")));
    expect(titles("day-column")).toEqual(["Dentist", "Call mom", "Pay rent"]);
    // Routines don't select; they drag as before.
    fireEvent.click(row("Read"));
    expect(row("Read")).not.toHaveAttribute("data-selected");
    await act(async () => drag(row("Read"), row("Stretch")));
    expect(titles("routines-column")).toEqual(["Read", "Stretch", "Run"]);
    const saved = await native.listTodos(day, day);
    expect(saved.filter((t) => !t.dueTime).sort((a, b) => a.sort - b.sort).map((t) => t.title)).toEqual(["Call mom", "Pay rent"]);
    expect((await native.listRoutines()).map((r) => r.title)).toEqual(["Read", "Stretch", "Run"]);

    // The keyboard way: Alt+Down on a row moves it down one; Alt+Up past the top does nothing.
    await act(async () => fireEvent.keyDown(screen.getByRole("checkbox", { name: "Read" }), { key: "ArrowDown", altKey: true }));
    expect(titles("routines-column")).toEqual(["Stretch", "Read", "Run"]);
    await act(async () => fireEvent.keyDown(screen.getByRole("checkbox", { name: "Stretch" }), { key: "ArrowUp", altKey: true }));
    expect(titles("routines-column")).toEqual(["Stretch", "Read", "Run"]);
  });

  it("keeps done tasks readable, names truncated rows, and gives small controls a 24px hit area (H3, M12, M13)", async () => {
    const day = todayKey();
    await native.saveTodo({ title: "A long task name that runs past the column at 700px", dueDate: day, dueTime: null, durationMin: null, profileId: null });
    await act(() => usePlanner.getState().ensure(day, addDays(day, 1)));
    await act(async () => void render(<Home />));
    const box = screen.getByRole("checkbox", { name: /A long task name/ });
    expect(box).toHaveClass("h-4", "w-4", "before:h-[max(100%,24px)]", "before:w-[max(100%,24px)]");
    const row = box.closest("[data-testid=task-row]") as HTMLElement;
    const title = within(row).getByText(/A long task name/);
    expect(title).toHaveAttribute("title", "A long task name that runs past the column at 700px");
    await act(async () => fireEvent.click(box));
    // Done: struck through, in muted (readable), never faint.
    expect(title).toHaveClass("text-muted", "line-through");
    expect(title).not.toHaveClass("text-faint");
  });
});

describe("Home counters (v0.1.4)", () => {
  it("makes a counter in the routine editor, adds amounts with notes, and checks it off at the goal", async () => {
    const day = todayKey();
    await act(() => useTrackers.getState().load());
    // The editor: Counter on, a goal, a unit, and notes required.
    const editor = render(<RoutineDialog onClose={() => undefined} />);
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Protein" } });
    fireEvent.click(screen.getByRole("switch", { name: "Counter" }));
    expect(screen.queryByLabelText("Time")).toBeNull();
    fireEvent.change(screen.getByLabelText("Daily goal"), { target: { value: "150" } });
    fireEvent.change(screen.getByLabelText("Unit"), { target: { value: "g" } });
    fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "required" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /Add routine/ })));
    editor.unmount();
    const [routine] = await native.listRoutines();
    const tracker = (await native.listTrackers()).find((t) => t.id === routine!.trackerId)!;
    expect([tracker.name, tracker.unit, tracker.kind, routine!.goalAmount, routine!.noteMode]).toEqual(["Protein", "g", "number", 150, "required"]);

    await act(() => usePlanner.getState().ensure(day, addDays(day, 1)));
    await act(async () => void render(<Home />));
    const counter = within(screen.getByTestId("routines-column")).getByTestId("counter");
    // Pinned at the top, not a checkbox row.
    expect(screen.queryByRole("checkbox", { name: "Protein" })).toBeNull();
    const amount = within(counter).getByLabelText("Add to Protein");
    // Sized to the unit's text, capped, and cut short with an ellipsis past that (2026-11-24).
    expect(amount).toHaveClass("field-sizing-content", "min-w-[64px]", "max-w-[140px]", "text-ellipsis");
    expect(amount).toHaveAttribute("title", amount.getAttribute("placeholder"));
    const note = within(counter).getByLabelText("Note for Protein");
    fireEvent.change(amount, { target: { value: "60" } });
    await act(async () => fireEvent.submit(amount.closest("form")!));
    expect(counter).toHaveTextContent("Add a note.");
    fireEvent.change(note, { target: { value: "eggs" } });
    await act(async () => fireEvent.submit(amount.closest("form")!));
    const total = () => within(counter).getByRole("button", { name: /Show today's entries|Hide today's entries/ }).getAttribute("aria-label");
    expect(total()).toContain("60 of 150 g");
    expect(counter).not.toHaveAttribute("data-done");
    fireEvent.change(amount, { target: { value: "95" } });
    fireEvent.change(note, { target: { value: "chicken" } });
    await act(async () => fireEvent.submit(amount.closest("form")!));
    expect(total()).toContain("155 of 150 g");
    expect(counter).toHaveAttribute("data-done", "true");
    expect(usePlanner.getState().checks).toContainEqual(expect.objectContaining({ routineId: routine!.id, date: day }));
    // The entries, with notes, are in the tracker.
    const logged = (await native.trackerEntries(0, Date.now() + 1)).filter((e) => e.trackerId === tracker.id);
    expect(logged.map((e) => [e.value, e.text])).toEqual([[60, "eggs"], [95, "chicken"]]);
    // Removing one drops below the goal and unchecks it.
    fireEvent.click(within(counter).getByRole("button", { name: /Show today's entries/ }));
    await act(async () => fireEvent.click(within(counter).getByRole("button", { name: "Remove 95 g" })));
    expect(total()).toContain("60 of 150 g");
    expect(usePlanner.getState().checks).not.toContainEqual(expect.objectContaining({ routineId: routine!.id, date: day }));
  });
});

describe("Home Pending tab (v0.1)", () => {
  it("sits folded under Today, opens, and adds an item with no day", async () => {
    const day = todayKey();
    await act(() => usePlanner.getState().ensure(day, addDays(day, 1)));
    await act(async () => void render(<Home />));
    const tab = within(screen.getByTestId("day-column")).getByTestId("pending-tab");
    const toggle = within(tab).getByRole("button", { name: "Show pending" });
    expect(toggle).toHaveClass("text-muted");
    fireEvent.click(toggle);
    const add = within(tab).getByRole("textbox", { name: "Add to pending" });
    fireEvent.change(add, { target: { value: "Renew passport" } });
    await act(async () => fireEvent.keyDown(add, { key: "Enter" }));
    expect(within(tab).getByRole("checkbox", { name: "Renew passport" })).toBeInTheDocument();
    // Not one of today's items.
    expect(within(screen.getByTestId("day-column")).queryAllByTestId("task-row")).toHaveLength(0);
  });

  it("puts the profile tag at the far right when an item has no time", async () => {
    const day = todayKey();
    const [p] = [await native.createProfile({ name: "Light Work" })];
    await act(() => useStore.getState().loadProfiles());
    await native.saveTodo({ title: "Send the weekly update", dueDate: day, dueTime: null, durationMin: null, profileId: p.id });
    await act(() => usePlanner.getState().ensure(day, addDays(day, 1)));
    await act(async () => void render(<Home />));
    const row = screen.getByRole("checkbox", { name: "Send the weekly update" }).closest("[data-testid=task-row]")!;
    expect(row.lastElementChild).toHaveTextContent("Light Work");
  });

  it("a click selects a one-time item, only the selected one drags, and a double-click opens it", async () => {
    const day = todayKey();
    await native.saveTodo({ title: "Pay rent", dueDate: day, dueTime: null, durationMin: null, profileId: null });
    await native.saveTodo({ title: "Call mom", dueDate: day, dueTime: null, durationMin: null, profileId: null });
    await act(() => usePlanner.getState().ensure(day, addDays(day, 1)));
    await act(async () => void render(<Home />));
    const row = (name: string) => screen.getByRole("checkbox", { name }).closest("[data-testid=task-row]") as HTMLElement;
    // Not selected: no drag, so a stray press-and-move does nothing.
    expect(row("Pay rent")).not.toHaveAttribute("draggable");
    expect(fireEvent.dragStart(row("Pay rent"), { dataTransfer: { setData: () => undefined } })).toBe(false);
    fireEvent.click(row("Pay rent"));
    expect(row("Pay rent")).toHaveAttribute("data-selected", "true");
    expect(row("Pay rent")).toHaveAttribute("draggable", "true");
    expect(row("Call mom")).not.toHaveAttribute("draggable");
    // Another click moves the selection; a click outside clears it.
    fireEvent.click(row("Call mom"));
    expect(row("Pay rent")).not.toHaveAttribute("data-selected");
    fireEvent.mouseDown(document.body);
    expect(row("Call mom")).not.toHaveAttribute("data-selected");
    // The box still just checks it off, without selecting.
    await act(async () => fireEvent.click(screen.getByRole("checkbox", { name: "Call mom" })));
    expect(row("Call mom")).not.toHaveAttribute("data-selected");
    // A double-click opens the editor, where it can be deleted.
    await act(async () => fireEvent.doubleClick(row("Pay rent")));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "Delete" })).toBeInTheDocument();
    await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "Delete" })));
    await waitFor(() => expect(screen.queryByRole("checkbox", { name: "Pay rent" })).toBeNull());
  });

  it("gives a narrow row's room to the title: Focus first, then the type, then the time", async () => {
    const day = todayKey();
    const [p] = [await native.createProfile({ name: "Light Work" })];
    await act(() => useStore.getState().loadProfiles());
    await native.saveTodo({ title: "Inbox and email", dueDate: day, dueTime: "16:30", durationMin: null, profileId: p.id });
    await act(() => usePlanner.getState().ensure(day, addDays(day, 1)));
    await act(async () => void render(<Home />));
    const row = screen.getByRole("checkbox", { name: "Inbox and email" }).closest("[data-testid=task-row]") as HTMLElement;
    expect(row).toHaveClass("@container");
    expect(within(row).getByText("Inbox and email")).not.toHaveClass("hidden");
    expect(within(row).getByRole("button", { name: "Focus on Inbox and email" })).toHaveClass("hidden", "@[340px]:flex");
    expect(within(row).getByText("Light Work")).toHaveClass("hidden", "@[300px]:flex");
    expect(within(row).getByText("4:30p")).toHaveClass("hidden", "@[220px]:block");
  });
});

describe("Home streak chip", () => {
  it("after a missed day, says keep it today with the dot evenly spaced", async () => {
    const { addDays, todayKey } = await import("../lib/planner");
    const t = todayKey();
    mockControls.statsDays({ [addDays(t, -3)]: { focusMin: 130 }, [addDays(t, -2)]: { focusMin: 125 }, [addDays(t, -1)]: { focusMin: 10 } });
    await act(async () => void render(<Home />));
    const chip = await screen.findByTestId("streak");
    await waitFor(() => expect(chip).toHaveTextContent("keep it today"));
    // The dot is its own element, so the gap on each side is the same.
    const dot = within(chip).getByTestId("streak-dot");
    expect(dot).toHaveTextContent("·");
    expect(dot.parentElement).toHaveClass("gap-[6px]");
    expect(dot.nextElementSibling).toHaveTextContent(/^keep it today$/);
  });

  it("shows the streak and the last 7 days, and opens Stats", async () => {
    const { addDays, todayKey } = await import("../lib/planner");
    const t = todayKey();
    mockControls.statsDays({ [addDays(t, -2)]: { focusMin: 130 }, [addDays(t, -1)]: { focusMin: 125 } });
    await act(async () => void render(<Home />));
    const chip = await screen.findByRole("button", { name: "2 day streak, 2 of the last 7 days kept, today 0m of 2h. Open Stats" });
    expect(chip.querySelectorAll("[data-status]")).toHaveLength(7);
    expect(chip.querySelectorAll('[data-status="kept"]')).toHaveLength(2);
    // Kept is the second color; today is the accent, filling as you focus.
    expect(chip.querySelector('[data-status="kept"]')).toHaveClass("bg-second");
    expect(chip.querySelector("[data-today-cell]")).toHaveClass("border-sealed");
    fireEvent.click(chip);
    expect(useStore.getState().activeTab).toBe("stats");
  });
});

describe("Home", () => {
  it("shows the focus row with real profiles and Duration (15 min to 2 h, by 15) when open", async () => {
    await withSampleProfiles();
    render(<Home />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(homeLine("open"));
    const options = (name: string) => {
      fireEvent.click(picker(name));
      const list = within(screen.getByRole("listbox", { name })).getAllByRole("option");
      fireEvent.keyDown(screen.getByRole("listbox", { name }), { key: "Escape" });
      return list;
    };
    expect(options("Length").map((o) => o.textContent)).toEqual(["15 min", "30 min", "45 min", "60 min", "75 min", "90 min", "105 min", "120 min"]);
    expect(options("Profile").map((o) => o.textContent)).toEqual(["Interview Prep", "Deep Work", "Study", "Light Work"]);
    expect(picker("Profile")).toHaveTextContent("Interview Prep");
    expect(screen.getByTestId("focus-row")).toHaveTextContent(`Opens LeetCode, NeetCode, VS Code, Excalidraw, Notion · seals ${useStore.getState().distractions.length}`);
    // A calm, normal-size button with the note above it.
    expect(screen.getByRole("button", { name: /Enter focus/ })).not.toContainElement(screen.getByTestId("focus-note"));
    // As tall as the pickers beside it.
    expect(screen.getByRole("button", { name: /Enter focus/ }).className).toContain("h-cta");
    expect(screen.getByRole("button", { name: /Enter focus/ })).toBeEnabled();
  });

  it("switching profile applies its default duration", async () => {
    await withSampleProfiles();
    await act(async () => void render(<Home />));
    fireEvent.click(picker("Profile"));
    fireEvent.click(within(screen.getByRole("listbox", { name: "Profile" })).getByRole("option", { name: "Deep Work" }));
    expect(screen.queryByRole("listbox", { name: "Profile" })).toBeNull();
    expect(picker("Length")).toHaveTextContent("90 min");
    expect(useStore.getState().durationMin).toBe(90);
  });

  it("has an empty state with Enter focus disabled when there are no profiles", async () => {
    await act(() => useStore.getState().loadProfiles());
    await act(async () => void render(<Home />));
    expect(screen.queryByRole("button", { name: /Profile/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Enter focus/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Create one in Setup" }));
    expect(useStore.getState().activeTab).toBe("setup");
  });

  it("warns which open apps will close before entering", async () => {
    await withSampleProfiles();
    await act(async () => void render(<Home />));
    // Mock backend: Discord is running and flagged.
    await waitFor(() => expect(screen.getByTestId("focus-note")).toHaveTextContent("Discord closes when you enter"));
    // A label: sentence case, readable.
    expect(screen.getByTestId("focus-note")).toHaveClass("label");
  });

  it("Enter focus seals with a real session and runs the timer", async () => {
    await withSampleProfiles();
    await act(async () => void render(<Home />));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Enter focus/ }));
    });
    const s = useStore.getState();
    expect(s.appState).toBe("sealed");
    expect(s.session?.plannedMinutes).toBe(60);
    const bar = screen.getByTestId("session-bar");
    expect(within(bar).getByRole("timer")).toHaveAccessibleName("60 min left");
    // The top slot says only what the cells don't: the profile and length are in the cells.
    expect(screen.getByTestId("sealed-slot")).toHaveTextContent(/^Sealed.*Ends .* · \d+ apps? sealed · 0 attempts blocked$/);
    expect(bar).toHaveTextContent("Interview Prep");
    await act(async () => mockControls.fastForward(18 * 60_000 + 500));
    expect(within(bar).getByRole("timer")).toHaveAccessibleName("42 min left");
    act(() => mockControls.block("Discord"));
    expect(bar).toHaveTextContent("1 attempt blocked");
  });

  it("End early opens the break-the-seal dialog", async () => {
    await withSampleProfiles();
    await act(async () => void render(<Home />));
    await act(async () => void (await useStore.getState().enterFocus()));
    fireEvent.click(screen.getByRole("button", { name: "End early" }));
    expect(useStore.getState().endEarlyOpen).toBe(true);
  });

  it("Enter focus opens the launch set and reports it", async () => {
    await withSampleProfiles();
    await act(async () => void render(<Home />));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Enter focus/ }));
    });
    // Mock backend: VS Code is running, the rest open.
    expect(useStore.getState().notice?.lead).toBe("Opened LeetCode, NeetCode, Excalidraw, Notion.");
    expect(useStore.getState().notice?.rest).toBe("Focused VS Code.");
  });

  it("swaps the focus row for the session bar when sealed", async () => {
    await withSampleProfiles();
    act(() => useStore.getState().setAppState("sealed"));
    await act(async () => void render(<Home />));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(homeLine("sealed"));
    expect(screen.queryByTestId("focus-row")).toBeNull();
    expect(screen.getByTestId("sealed-slot")).toHaveTextContent(/^Sealed/);
    expect(screen.getByTestId("session-bar")).toHaveTextContent("Interview Prep");
  });

  it("steps the streak, search and Customize aside only while sealed, and brings them back after", () => {
    render(<Home />);
    const tools = screen.getByTestId("home-tools");
    expect(tools).not.toHaveAttribute("aria-hidden");
    expect(tools).toContainElement(screen.getByTestId("streak"));
    act(() => useStore.getState().setAppState("sealed"));
    expect(tools).toHaveAttribute("aria-hidden", "true");
    expect(tools).toHaveClass("opacity-0");
    // An event keeps them.
    act(() => useStore.getState().setAppState("event"));
    expect(tools).not.toHaveAttribute("aria-hidden");
    expect(tools).toHaveClass("opacity-100");
    act(() => useStore.getState().setAppState("open"));
    expect(tools).not.toHaveAttribute("aria-hidden");
    expect(tools).toHaveClass("opacity-100");
  });

  it("shows the event bar in an event", () => {
    act(() => useStore.getState().setAppState("event"));
    render(<Home />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(homeLine("event", { title: "Mock interview", until: "3:00p" }));
    expect(screen.getByTestId("event-bar")).toBeInTheDocument();
  });

  it("dismisses the empty schedule hint and brings it back from Customize", async () => {
    await withSampleProfiles();
    await act(async () => void render(<Home />));
    expect(screen.getByTestId("suggestion")).toHaveTextContent("No focus block on your schedule.");
    await act(async () => fireEvent.click(within(screen.getByTestId("suggestion")).getByRole("button", { name: "Dismiss" })));
    // The slot stays (2026-11-17), so the row below never moves: a line for the day fills it.
    expect(screen.getByTestId("suggestion")).toHaveAttribute("data-kind", "idle");
    expect(OPEN_IDLE).toContain(screen.getByTestId("suggestion").textContent);
    expect(await native.getSetting("home_layout")).toContain("hint");
    fireEvent.click(screen.getByRole("button", { name: "Customize" }));
    await act(async () => fireEvent.click(screen.getByRole("switch", { name: "Show Empty schedule hint" })));
    expect(screen.getByTestId("suggestion")).toHaveTextContent("No focus block on your schedule.");
  });

  it("draws the Enter focus fill as its own layer, the source of the seal line", async () => {
    await withSampleProfiles();
    await act(async () => void render(<Home />));
    const button = screen.getByRole("button", { name: /Enter focus/ });
    expect(button.querySelector("[data-seal-src]")).toHaveClass("bg-sealed");
    expect(screen.getByTestId("enter-label")).toHaveTextContent("Enter focus Ctrl ↵");
  });
});

describe("Home counters stay put when reads or writes fail (C2)", () => {
  async function counter(goal: number) {
    const tracker = await native.saveTracker({ name: "Water", unit: "cups", kind: "number" });
    const routine = await native.saveRoutine({ title: "Water", time: null, profileId: null, active: true, daysMask: EVERY_DAY, durationMin: null, trackerId: tracker.id, goalAmount: goal, noteMode: "off" });
    return { tracker, routine };
  }

  it("a failed tracker load leaves a done counter checked (nothing reads an empty list as the truth)", async () => {
    const day = todayKey();
    const { tracker, routine } = await counter(2);
    await native.logEntries([{ trackerId: tracker.id, value: 2, text: null }], null);
    await native.setRoutineProgress(routine.id, day, 1);
    const list = vi.spyOn(native, "trackerEntries").mockRejectedValue("No answer.");
    const progress = vi.spyOn(native, "setRoutineProgress");
    try {
      await act(() => useTrackers.getState().load());
      expect(useTrackers.getState().loaded).toBe(false);
      await act(() => usePlanner.getState().ensure(day, addDays(day, 1)));
      await act(async () => void render(<Home />));
      expect(progress).not.toHaveBeenCalled();
      expect(usePlanner.getState().checks).toContainEqual(expect.objectContaining({ routineId: routine.id, date: day }));
    } finally {
      list.mockRestore();
      progress.mockRestore();
    }
  });

  it("a check that fails to save is tried once, not in a loop", async () => {
    const day = todayKey();
    const { tracker } = await counter(2);
    await native.logEntries([{ trackerId: tracker.id, value: 3, text: null }], null);
    await act(() => useTrackers.getState().load());
    await act(() => usePlanner.getState().ensure(day, addDays(day, 1)));
    const progress = vi.spyOn(native, "setRoutineProgress").mockRejectedValue("The disk is busy.");
    try {
      await act(async () => void render(<Home />));
      await act(async () => void (await new Promise((r) => setTimeout(r, 50))));
      expect(progress).toHaveBeenCalledTimes(1);
    } finally {
      progress.mockRestore();
    }
  });
});

describe("Home seal preview (M11)", () => {
  it("reads one at a time: the poll and window focus don't stack slow reads", async () => {
    await withSampleProfiles();
    const preview = vi.spyOn(native, "previewSeal").mockImplementation(() => new Promise<string[]>(() => undefined));
    try {
      await act(async () => void render(<Home />));
      const before = preview.mock.calls.length;
      expect(before).toBeGreaterThan(0);
      act(() => {
        window.dispatchEvent(new Event("focus"));
        window.dispatchEvent(new Event("focus"));
      });
      expect(preview.mock.calls.length).toBe(before);
    } finally {
      preview.mockRestore();
    }
  });
});
