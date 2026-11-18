import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { vi } from "vitest";
import { useStore } from "./store";
import { usePlanner, UNDO_MS } from "./planner";
import { resetMockBackend } from "../lib/mockBackend";
import { native } from "../lib/native";
import { sampleProfiles } from "../lib/catalog";
import { todayKey } from "../lib/planner";
import { BreakSealDialog } from "../components/BreakSealDialog";
import { ProtectionSection, useProtectionStatus } from "../pages/setup/Protection";
import type { Todo } from "../lib/types";

// Stability audit (2026-11-17): races and rejections that used to blank or wedge the UI.

const initial = useStore.getState();
const initialPlanner = usePlanner.getState();

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function sealed() {
  for (const d of sampleProfiles()) await native.createProfile(d);
  await act(() => useStore.getState().loadProfiles());
  await act(async () => void (await useStore.getState().enterFocus()));
}

beforeEach(() => {
  resetMockBackend();
  useStore.setState(initial, true);
  usePlanner.setState(initialPlanner, true);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("enter focus", () => {
  it("a second start while one is in flight is a no-op (tray event racing the button)", async () => {
    for (const d of sampleProfiles()) await native.createProfile(d);
    await act(() => useStore.getState().loadProfiles());
    const gate = deferred<void>();
    const real = native.startSession;
    const start = vi.spyOn(native, "startSession").mockImplementation(async (...args) => {
      await gate.promise;
      return real(...args);
    });
    const first = useStore.getState().enterFocus();
    const second = await useStore.getState().enterFocus();
    expect(second).toBe(false);
    gate.resolve();
    await act(async () => expect(await first).toBe(true));
    expect(start).toHaveBeenCalledTimes(1);
    expect(useStore.getState().appState).toBe("sealed");
  });

  it("a failed start releases the guard, so the next try goes through", async () => {
    for (const d of sampleProfiles()) await native.createProfile(d);
    await act(() => useStore.getState().loadProfiles());
    vi.spyOn(native, "startSession").mockRejectedValueOnce("Couldn't start.");
    await act(async () => expect(await useStore.getState().enterFocus()).toBe(false));
    await act(async () => expect(await useStore.getState().enterFocus()).toBe(true));
  });

  it("a failed session read on startup is said, not thrown", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(native, "getSession").mockRejectedValueOnce("database is locked");
    await act(() => useStore.getState().loadSession());
    expect(useStore.getState().notice?.lead).toBe("Couldn't read the current session.");
  });
});

describe("break the seal dialog", () => {
  it("a ladder that fails to open shows the error with Close, and can be reopened", async () => {
    await sealed();
    const open = vi.spyOn(native, "ladderOpen").mockRejectedValueOnce("The ladder is unavailable.");
    act(() => useStore.getState().openEndEarly());
    render(<BreakSealDialog />);
    const dialog = await screen.findByRole("dialog", { name: "Break the seal" });
    expect(dialog).toHaveTextContent("The ladder is unavailable.");
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(useStore.getState().endEarlyOpen).toBe(false);

    // Reopening runs the ladder again, and this time it opens.
    act(() => useStore.getState().openEndEarly());
    expect(await screen.findByRole("button", { name: "Start the wait" })).toBeInTheDocument();
    expect(open).toHaveBeenCalledTimes(2);
  });

  it("Try again retries a failed open", async () => {
    await sealed();
    vi.spyOn(native, "ladderOpen").mockRejectedValueOnce("Busy.");
    act(() => useStore.getState().openEndEarly());
    render(<BreakSealDialog />);
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("button", { name: "Start the wait" })).toBeInTheDocument();
  });

  it("polls one at a time while a slow read is in flight, and says when polling fails", async () => {
    await sealed();
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const slow = deferred<never>();
    const view = vi.spyOn(native, "ladderView").mockImplementation(() => slow.promise);
    act(() => useStore.getState().openEndEarly());
    render(<BreakSealDialog />);
    await screen.findByRole("button", { name: "Start the wait" });
    act(() => void vi.advanceTimersByTime(5000));
    expect(view).toHaveBeenCalledTimes(1);
    await act(async () => slow.reject("Partner service timed out."));
    expect(await screen.findByText("Partner service timed out.")).toBeInTheDocument();
    view.mockResolvedValue(await native.ladderOpen());
    act(() => void vi.advanceTimersByTime(1000));
    expect(view).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(screen.queryByText("Partner service timed out.")).toBeNull());
  });

  it("a failed cancel is caught, and the dialog still closes", async () => {
    await sealed();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      await native.ladderOpen();
      await native.ladderReason("I need to stop now because something urgent came up at home today.");
      vi.spyOn(native, "ladderCancel").mockRejectedValueOnce("gone");
      act(() => useStore.getState().openEndEarly());
      render(<BreakSealDialog />);
      fireEvent.click(await screen.findByRole("button", { name: "Never mind, stay sealed" }));
      expect(useStore.getState().endEarlyOpen).toBe(false);
      await new Promise((r) => setTimeout(r, 0));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });

  it("a new session starts from its own ladder, not the last one's", async () => {
    await sealed();
    act(() => useStore.getState().openEndEarly());
    render(<BreakSealDialog />);
    await screen.findByRole("button", { name: "Start the wait" });
    const gate = deferred<Awaited<ReturnType<typeof native.ladderOpen>>>();
    vi.spyOn(native, "ladderOpen").mockImplementation(() => gate.promise);
    const s = useStore.getState().session!;
    act(() => useStore.setState({ session: { ...s, id: s.id + 1 } }));
    // The old session's ladder is gone while the new one loads.
    expect(screen.queryByRole("button", { name: "Start the wait" })).toBeNull();
    gate.resolve(await native.ladderView());
    expect(await screen.findByRole("button", { name: "Start the wait" })).toBeInTheDocument();
  });
});

describe("planner reloads", () => {
  const todo = (id: number, title: string, done = false): Todo =>
    ({ id, title, done, dueDate: todayKey(), dueTime: null, durationMin: null, profileId: null, sort: id }) as Todo;

  /** Makes each reload wait on its own gate; returns them in call order. */
  function gatedReloads() {
    const gates: ReturnType<typeof deferred<Todo[]>>[] = [];
    vi.spyOn(native, "listRoutines").mockResolvedValue([]);
    vi.spyOn(native, "listRoutineChecks").mockResolvedValue([]);
    vi.spyOn(native, "listTodos").mockImplementation(() => {
      const d = deferred<Todo[]>();
      gates.push(d);
      return d.promise;
    });
    return gates;
  }
  const flush = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));

  it("only the latest reload sets state; an older one landing late is dropped", async () => {
    const gates = gatedReloads();
    const a = usePlanner.getState().reload();
    const b = usePlanner.getState().reload();
    gates[1]!.resolve([todo(1, "Newer")]);
    await act(() => b);
    expect(usePlanner.getState().todos.map((t) => t.title)).toEqual(["Newer"]);
    gates[0]!.resolve([todo(1, "Older")]);
    await act(() => a);
    expect(usePlanner.getState().todos.map((t) => t.title)).toEqual(["Newer"]);
  });

  it("ensure for two ranges: the wider, later one wins", async () => {
    const gates = gatedReloads();
    const today = todayKey();
    const first = usePlanner.getState().ensure(today, today);
    const second = usePlanner.getState().ensure("2000-01-01", today);
    gates[1]!.resolve([todo(2, "Wide")]);
    gates[0]!.resolve([todo(1, "Narrow")]);
    await act(() => Promise.all([first, second]).then(() => undefined));
    expect(usePlanner.getState().todos.map((t) => t.title)).toEqual(["Wide"]);
    expect(usePlanner.getState().range?.[0]).toBe("2000-01-01");
  });

  it("a local toggle during a reload wins over the reload's older read, then a fresh read follows", async () => {
    usePlanner.setState({ todos: [todo(1, "Write")], loaded: true, range: [todayKey(), todayKey()] });
    const gates = gatedReloads();
    const toggled = deferred<Todo>();
    vi.spyOn(native, "setTodoDone").mockImplementation(() => toggled.promise);
    const reload = usePlanner.getState().reload();
    const toggle = usePlanner.getState().toggle({ kind: "todo", id: 1, done: false } as Parameters<ReturnType<typeof usePlanner.getState>["toggle"]>[0]);
    expect(usePlanner.getState().todos[0]!.done).toBe(true);
    // The reload's read predates the toggle.
    gates[0]!.resolve([todo(1, "Write", false)]);
    await act(() => reload);
    expect(usePlanner.getState().todos[0]!.done).toBe(true);
    toggled.resolve(todo(1, "Write", true));
    await act(() => toggle);
    // The follow-up read sees the backend with the toggle in it.
    expect(gates).toHaveLength(2);
    gates[1]!.resolve([todo(1, "Write", true)]);
    await flush();
    expect(usePlanner.getState().todos[0]!.done).toBe(true);
  });

  it("resetMockBackend clears deletes in their undo window, so a leaked timer can't delete a later test's item", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const t = await native.saveTodo({ title: "Leaky", dueDate: todayKey(), dueTime: null, durationMin: null, profileId: null });
    usePlanner.setState({ todos: [t] as Todo[] });
    await act(async () => void (await usePlanner.getState().deleteTodo(t.id)));
    const del = vi.spyOn(native, "deleteTodo");
    resetMockBackend();
    act(() => void vi.advanceTimersByTime(UNDO_MS * 2));
    expect(del).not.toHaveBeenCalled();
    // The id is free again and nothing filters it out of a reload.
    const again = await native.saveTodo({ title: "Next test", dueDate: todayKey(), dueTime: null, durationMin: null, profileId: null });
    expect(again.id).toBe(t.id);
    vi.useRealTimers();
    await act(() => usePlanner.getState().reload());
    expect(usePlanner.getState().todos.map((x) => x.title)).toEqual(["Next test"]);
  });
});

describe("protection status", () => {
  function Dot() {
    return <span data-testid="dot">{useProtectionStatus()}</span>;
  }

  it("one poller serves the side list and the section, and a failed check keeps the last good value", async () => {
    await native.guardInstall();
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const status = vi.spyOn(native, "guardStatus");
    render(
      <>
        <Dot />
        <ProtectionSection />
      </>,
    );
    await waitFor(() => expect(screen.getByTestId("dot")).toHaveTextContent("ok"));
    expect(status).toHaveBeenCalledTimes(1);

    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    status.mockRejectedValueOnce("pipe busy");
    await act(async () => void vi.advanceTimersByTime(10_000));
    expect(status).toHaveBeenCalledTimes(2);
    await act(async () => undefined);
    expect(screen.getByTestId("dot")).toHaveTextContent("ok");
    expect(screen.getByTestId("protection-status")).toHaveAttribute("data-tone", "ok");
  });
});
