import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { useStore } from "./store";
import { usePlanner } from "./planner";
import { useTrackers } from "./trackers";
import { connectNativeEvents } from "./events";
import { mockControls, resetMockBackend } from "../lib/mockBackend";
import { native } from "../lib/native";
import { sampleProfiles } from "../lib/catalog";
import { todayKey } from "../lib/planner";
import { Home } from "../pages/Home";
import { HeldPage } from "../pages/HeldPage";

const initial = useStore.getState();
const initialPlanner = usePlanner.getState();
const initialTrackers = useTrackers.getState();
beforeEach(() => useTrackers.setState(initialTrackers, true));

let disconnect = () => {};
beforeEach(() => {
  resetMockBackend();
  useStore.setState(initial, true);
  usePlanner.setState(initialPlanner, true);
  disconnect = connectNativeEvents();
});
afterEach(() => disconnect());

async function setup() {
  for (const d of sampleProfiles()) await native.createProfile(d);
  await act(() => useStore.getState().loadProfiles());
  const deep = useStore.getState().profiles.find((p) => p.name !== useStore.getState().profiles[0]!.name)!;
  const todo = await native.saveTodo({ title: "Write the essay", dueDate: todayKey(), dueTime: null, durationMin: null, profileId: deep.id });
  await act(() => usePlanner.getState().reload());
  return { deep, todo };
}

describe("a session for a task (v0.1)", () => {
  it("links a Today task, seals for it, and checks it off from the held page", async () => {
    const { deep, todo } = await setup();
    render(<Home />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Focus on Write the essay" })));
    // The task takes the suggestion's place and brings its profile.
    expect(screen.getByTestId("focus-task")).toHaveTextContent("Write the essay");
    expect(useStore.getState().selectedProfileId).toBe(deep.id);
    expect(screen.getByRole("button", { name: "Unlink Write the essay" })).toHaveAttribute("aria-pressed", "true");

    await act(async () => void (await useStore.getState().enterFocus()));
    expect(useStore.getState().session?.task).toMatchObject({ kind: "todo", id: todo.id, title: "Write the essay" });
    expect(useStore.getState().focusTask).toBeNull();
    expect(screen.getByTestId("session-bar")).toHaveTextContent("Write the essay");
    // Sealed, the list can't relink.
    expect(screen.queryByRole("button", { name: /Focus on/ })).toBeNull();

    await act(async () => mockControls.fastForward(24 * 60 * 60_000));
    const held = useStore.getState().held!;
    expect(held.task?.title).toBe("Write the essay");
    render(<HeldPage held={held} />);
    const page = within(screen.getByTestId("held-page"));
    // Offered on the card itself, without opening Add a note (2026-11-20).
    expect(page.queryByTestId("held-review")).toBeNull();
    await act(async () => fireEvent.click(page.getByRole("button", { name: "Mark Write the essay done" })));
    expect(page.getByTestId("held-task")).toHaveTextContent("Write the essay is done");
    expect((await native.listTodos(todayKey(), todayKey())).find((t) => t.id === todo.id)?.done).toBe(true);
  });

  it("unlinks from the strip, and a suggested block links its own item", async () => {
    await setup();
    render(<Home />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Focus on Write the essay" })));
    fireEvent.click(screen.getByRole("button", { name: "Unlink task" }));
    expect(screen.queryByTestId("focus-task")).toBeNull();
    expect(useStore.getState().focusTask).toBeNull();

    const item = usePlanner.getState().todos[0]!;
    await act(async () =>
      void (await useStore.getState().enterSuggested({
        item: { key: `todo:${item.id}`, kind: "todo", id: item.id, title: item.title, date: item.dueDate, time: null, durationMin: 30, profileId: item.profileId, done: false, order: 0 },
        state: "now",
        startsAt: Date.now(),
        endsAt: Date.now() + 30 * 60_000,
        profileId: item.profileId!,
        minutes: 30,
      })),
    );
    expect(useStore.getState().session?.task?.title).toBe("Write the essay");
  });

  /** A block on now for the essay, from the setup's profile. */
  const block = (todo: { id: number; title: string; dueDate: string; profileId: number | null }, state: "now" | "next" = "now") => ({
    item: { key: `todo:${todo.id}`, kind: "todo" as const, id: todo.id, title: todo.title, date: todo.dueDate, time: null, durationMin: 30, profileId: todo.profileId, done: false, order: 0 },
    state,
    startsAt: Date.now(),
    endsAt: Date.now() + 30 * 60_000,
    profileId: todo.profileId!,
    minutes: 30,
  });

  it("Enter focus during a block that's on now makes that item the session's task", async () => {
    await setup();
    const todo = usePlanner.getState().todos[0]!;
    act(() => useStore.getState().applySuggestion(block(todo)));
    await act(async () => void (await useStore.getState().enterFocus()));
    expect(useStore.getState().session?.task).toMatchObject({ kind: "todo", id: todo.id, title: "Write the essay" });
  });

  it("but not once you picked another profile or length yourself", async () => {
    await setup();
    const todo = usePlanner.getState().todos[0]!;
    act(() => useStore.getState().applySuggestion(block(todo)));
    act(() => {
      useStore.getState().setDuration(45);
      useStore.getState().markManualFocus();
    });
    await act(async () => void (await useStore.getState().enterFocus()));
    expect(useStore.getState().session?.task ?? null).toBeNull();
  });

  it("Use on a block links its item, so the session can check it off", async () => {
    await setup();
    const todo = usePlanner.getState().todos[0]!;
    act(() => useStore.setState({ selectedProfileId: useStore.getState().profiles[0]!.id, durationMin: 15 }));
    act(() => useStore.getState().applySuggestion(block(todo, "next")));
    render(<Home />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /^Use / })));
    expect(useStore.getState().focusTask).toMatchObject({ kind: "todo", id: todo.id });
    expect(screen.getByTestId("focus-task")).toHaveTextContent("Write the essay");
  });

  it("answering Done in How it went checks the task off too", async () => {
    const { todo } = await setup();
    render(<Home />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Focus on Write the essay" })));
    await act(async () => void (await useStore.getState().enterFocus()));
    await act(async () => mockControls.fastForward(24 * 60 * 60_000));
    render(<HeldPage held={useStore.getState().held!} />);
    const page = within(screen.getByTestId("held-page"));
    fireEvent.click(page.getByRole("button", { name: "Add a note" }));
    await act(async () => fireEvent.click(page.getByRole("radio", { name: "Done" })));
    expect((await native.listTodos(todayKey(), todayKey())).find((t) => t.id === todo.id)?.done).toBe(true);
    expect(page.getByTestId("held-task")).toHaveTextContent("Write the essay is done");
  });
});

describe("a session for a routine adds one, not all (2026-11-24)", () => {
  /** Seals for a routine and lands on the held page. */
  async function sealFor(draft: Partial<Parameters<typeof native.saveRoutine>[0]>) {
    await setup();
    await act(() =>
      usePlanner.getState().saveRoutine({ title: "Stretch", daysMask: 127, time: null, durationMin: null, profileId: null, active: true, trackerId: null, goalAmount: null, noteMode: "off", onCalendar: false, sessionsPerDay: 3, ...draft }),
    );
    const r = usePlanner.getState().routines.find((x) => x.title === (draft.title ?? "Stretch"))!;
    act(() => useStore.getState().setFocusTask({ kind: "routine", id: r.id, date: todayKey(), title: r.title }));
    await act(async () => void (await useStore.getState().enterFocus()));
    await act(async () => mockControls.fastForward(24 * 60 * 60_000));
    render(<HeldPage held={useStore.getState().held!} />);
    return { r, page: within(screen.getByTestId("held-page")) };
  }
  const progress = (id: number) => usePlanner.getState().checks.find((c) => c.routineId === id && c.date === todayKey())?.completed ?? 0;

  it("marks one session of a routine done three times a day, once, from the row or from Done", async () => {
    const { r, page } = await sealFor({});
    await act(async () => fireEvent.click(page.getByRole("button", { name: "Mark this Stretch session done, 1 of 3" })));
    expect(progress(r.id)).toBe(1);
    expect(page.getByTestId("held-task")).toHaveTextContent("1 of 3 Stretch sessions done");
    expect(page.getByTestId("held-task")).toBeDisabled();
    // Done in How it went doesn't count this session a second time.
    fireEvent.click(page.getByRole("button", { name: "Add a note" }));
    await act(async () => fireEvent.click(page.getByRole("radio", { name: "Done" })));
    await act(async () => fireEvent.click(page.getByRole("radio", { name: "Done" })));
    await act(async () => fireEvent.click(page.getByRole("radio", { name: "Done" })));
    expect(progress(r.id)).toBe(1);
  });

  it("a routine once a day is still checked off whole", async () => {
    const { r, page } = await sealFor({ sessionsPerDay: 1 });
    await act(async () => fireEvent.click(page.getByRole("button", { name: "Mark Stretch done" })));
    expect(progress(r.id)).toBe(1);
    expect(page.getByTestId("held-task")).toHaveTextContent("Stretch is done");
  });

  it("a counter routine takes an amount toward its total and is never checked off whole", async () => {
    const t = await native.saveTracker({ name: "Reading", kind: "number", unit: "pages" });
    await act(() => useTrackers.getState().load());
    const { r, page } = await sealFor({ title: "Reading", trackerId: t.id, goalAmount: 30 });
    const task = within(page.getByTestId("held-task"));
    expect(page.queryByRole("button", { name: /^Mark/ })).toBeNull();
    expect(page.getByTestId("held-counter-total")).toHaveTextContent("0 / 30 pages");
    // Done in How it went leaves it to the total.
    fireEvent.click(page.getByRole("button", { name: "Add a note" }));
    await act(async () => fireEvent.click(page.getByRole("radio", { name: "Done" })));
    expect(progress(r.id)).toBe(0);
    fireEvent.change(task.getByRole("textbox", { name: "Amount for Reading" }), { target: { value: "12" } });
    await act(async () => fireEvent.click(task.getByRole("button", { name: "Add" })));
    expect(page.getByTestId("held-counter-total")).toHaveTextContent("12 / 30 pages");
    expect(useTrackers.getState().entries.filter((e) => e.trackerId === t.id).map((e) => e.value)).toEqual([12]);
    expect(progress(r.id)).toBe(0);
  });
});
