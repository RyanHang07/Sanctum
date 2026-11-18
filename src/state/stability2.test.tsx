import { act, render } from "@testing-library/react";
import { useStore } from "./store";
import { usePlanner } from "./planner";
import { useCalendar } from "./calendar";
import { useNotes } from "./notes";
import { useTrackers } from "./trackers";
import { useScheduleFocus } from "./schedule";
import { resetMockBackend } from "../lib/mockBackend";
import { native } from "../lib/native";
import { sampleProfiles } from "../lib/catalog";
import { addDays, dayBounds, todayKey } from "../lib/planner";
import type { CalEvent, LaunchReport, Note, TrackerEntry } from "../lib/types";

// Stale reads and day boundaries across the stores (the second stability audit; the first is stability.test.tsx).

const initial = { store: useStore.getState(), planner: usePlanner.getState(), calendar: useCalendar.getState(), notes: useNotes.getState(), trackers: useTrackers.getState() };

beforeEach(() => {
  resetMockBackend();
  useStore.setState(initial.store, true);
  usePlanner.setState(initial.planner, true);
  useCalendar.setState(initial.calendar, true);
  useNotes.setState(initial.notes, true);
  useTrackers.setState(initial.trackers, true);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const setReset = (dailyResetTime: string) => useStore.setState({ settings: { ...useStore.getState().settings, dailyResetTime } });

function Schedule() {
  useScheduleFocus();
  return null;
}

describe("the planner day follows the daily reset (H3, H4)", () => {
  it("loads the new day's items and refreshes Focus today once the reset passes", async () => {
    const before = new Date();
    before.setHours(3, 59, 0, 0);
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(before);
    setReset("04:00");
    const since = vi.spyOn(native, "focusMinutesSince");
    render(<Schedule />);
    await act(async () => void (await vi.advanceTimersByTimeAsync(10)));
    const yesterday = todayKey(before, "04:00");
    expect(usePlanner.getState().range).toEqual([yesterday, addDays(yesterday, 1)]);

    await act(async () => void (await vi.advanceTimersByTimeAsync(2 * 60_000)));
    const today = addDays(yesterday, 1);
    expect(usePlanner.getState().range![1] >= addDays(today, 1)).toBe(true);
    // Focus today counts from the new day's reset, not midnight.
    expect(since).toHaveBeenLastCalledWith(dayBounds(today, "04:00")[0]);
  });

  it("counts Focus today from the reset time", async () => {
    const now = new Date();
    now.setHours(5, 0, 0, 0);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
    setReset("06:00");
    const since = vi.spyOn(native, "focusMinutesSince");
    await useStore.getState().refreshFocusToday();
    // 05:00 with a 06:00 reset is still yesterday's planner day, from 06:00 yesterday.
    expect(since).toHaveBeenCalledWith(dayBounds(todayKey(now, "06:00"), "06:00")[0]);
    expect(since.mock.calls[0]![0]).toBeLessThan(now.getTime() - 22 * 3_600_000);
  });
});

describe("planner edits across a reset (M7)", () => {
  it("an edit settling after a reset doesn't leave every later reload dropped", async () => {
    const day = todayKey();
    await native.saveTodo({ title: "Pay rent", dueDate: day, dueTime: null, durationMin: null, profileId: null });
    await usePlanner.getState().ensure(day, day);
    const slow = deferred<never>();
    vi.spyOn(native, "setTodoDone").mockReturnValueOnce(slow.promise);
    const item = { kind: "todo", id: usePlanner.getState().todos[0]!.id, done: false } as Parameters<ReturnType<typeof usePlanner.getState>["toggle"]>[0];
    const editing = usePlanner.getState().toggle(item);
    resetMockBackend();
    await native.saveTodo({ title: "Call mom", dueDate: day, dueTime: null, durationMin: null, profileId: null });
    slow.reject("gone");
    await editing;
    await usePlanner.getState().reload();
    expect(usePlanner.getState().todos.map((t) => t.title)).toEqual(["Call mom"]);
  });
});

describe("starting a seal (M8)", () => {
  it("releases the start guard once the session lands, not after the profile's apps launch", async () => {
    for (const d of sampleProfiles()) await native.createProfile(d);
    await useStore.getState().loadProfiles();
    const launch = deferred<LaunchReport | null>();
    vi.spyOn(useStore.getState(), "launchProfile").mockReturnValue(launch.promise);
    const start = vi.spyOn(native, "startSession");
    const first = useStore.getState().enterFocus();
    await vi.waitFor(() => expect(useStore.getState().appState).toBe("sealed"));
    // The seal ends while the apps are still launching; a new one can start.
    useStore.getState().applySession(null);
    useStore.getState().setAppState("open");
    void useStore.getState().enterFocus();
    await vi.waitFor(() => expect(start).toHaveBeenCalledTimes(2));
    launch.resolve(null);
    await first;
  });
});

describe("calendar reads (M4)", () => {
  const event = (id: string): CalEvent => ({ calendarId: "c", calendarName: "Work", eventId: id, title: id, date: todayKey(), endDate: todayKey(), time: "10:00", durationMin: 30, startMs: 0, endMs: 1, allDay: false, attendees: 2 }) as unknown as CalEvent;

  it("keeps the last events when a read fails", async () => {
    useCalendar.setState({ range: [todayKey(), todayKey()], events: [event("standup")] });
    vi.spyOn(native, "gcalEvents").mockRejectedValueOnce("offline");
    await useCalendar.getState().reloadEvents();
    expect(useCalendar.getState().events.map((e) => e.eventId)).toEqual(["standup"]);
  });

  it("drops an older read that finishes after a newer one", async () => {
    useCalendar.setState({ range: [todayKey(), todayKey()], events: [] });
    const old = deferred<CalEvent[]>();
    const spy = vi.spyOn(native, "gcalEvents").mockReturnValueOnce(old.promise).mockResolvedValueOnce([event("new")]);
    const a = useCalendar.getState().reloadEvents();
    await useCalendar.getState().reloadEvents();
    old.resolve([event("old")]);
    await a;
    expect(spy).toHaveBeenCalledTimes(2);
    expect(useCalendar.getState().events.map((e) => e.eventId)).toEqual(["new"]);
  });
});

describe("note saves and loads (M2, M12)", () => {
  it("saves one note's edits one after another, so the latest lands last", async () => {
    const n = await native.saveNote({ title: "", body: "a" });
    useNotes.setState({ notes: [n], loaded: true });
    const first = deferred<Note>();
    const real = native.saveNote;
    const calls: string[] = [];
    vi.spyOn(native, "saveNote")
      .mockImplementationOnce((d) => {
        calls.push(d.body ?? "");
        return first.promise;
      })
      .mockImplementation((d) => {
        calls.push(d.body ?? "");
        return real(d);
      });
    vi.useFakeTimers();
    useNotes.getState().edit(n.id, { body: "ab" });
    await vi.advanceTimersByTimeAsync(500);
    useNotes.getState().edit(n.id, { body: "abc" });
    await vi.advanceTimersByTimeAsync(500);
    // The second save waits on the first.
    expect(calls).toEqual(["ab"]);
    first.resolve({ ...n, body: "ab" });
    await vi.advanceTimersByTimeAsync(0);
    await useNotes.getState().flush();
    expect(calls).toEqual(["ab", "abc"]);
    expect((await native.listNotes()).find((x) => x.id === n.id)?.body).toBe("abc");
  });

  it("a load in flight keeps typing that landed meanwhile", async () => {
    const n = await native.saveNote({ title: "", body: "old" });
    useNotes.setState({ notes: [n], loaded: true });
    const list = deferred<Note[]>();
    vi.spyOn(native, "listNotes").mockReturnValueOnce(list.promise);
    const loading = useNotes.getState().load();
    useNotes.getState().edit(n.id, { body: "typed early" });
    list.resolve([n]);
    await loading;
    expect(useNotes.getState().notes.find((x) => x.id === n.id)?.body).toBe("typed early");
    await useNotes.getState().flush();
  });
});

describe("tracker loads (C2, M12)", () => {
  it("a failed load stays not loaded", async () => {
    vi.spyOn(native, "listTrackers").mockRejectedValueOnce("offline");
    await useTrackers.getState().load();
    expect(useTrackers.getState().loaded).toBe(false);
  });

  it("an entry logged while the first load is in flight isn't dropped", async () => {
    const t = await native.saveTracker({ name: "Water", kind: "number" });
    const slow = deferred<TrackerEntry[]>();
    const real = native.trackerEntries;
    vi.spyOn(native, "trackerEntries")
      .mockReturnValueOnce(slow.promise)
      .mockImplementation((a, b) => real(a, b));
    const loading = useTrackers.getState().load();
    await useTrackers.getState().log([{ trackerId: t.id, value: 1, text: null }]);
    slow.resolve([]);
    await loading;
    expect(useTrackers.getState().loaded).toBe(true);
    expect(useTrackers.getState().entries.map((e) => e.value)).toEqual([1]);
  });
});
