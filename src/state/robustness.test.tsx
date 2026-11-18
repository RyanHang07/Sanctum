import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { vi } from "vitest";
import { useStore } from "./store";
import { usePlanner } from "./planner";
import { useCalendar } from "./calendar";
import { useNotes } from "./notes";
import { connectNativeEvents } from "./events";
import { resetMockBackend } from "../lib/mockBackend";
import { EVENTS, native } from "../lib/native";
import { bus } from "../lib/bus";
import { sampleProfiles } from "../lib/catalog";
import { todayKey } from "../lib/planner";
import type { Intercept } from "../lib/types";
import { AppShell } from "../components/AppShell";
import { BreakSealDialog } from "../components/BreakSealDialog";
import { CloseDialog } from "../components/CloseDialog";
import { TrayPanel } from "../windows/TrayPanel";
import { InterceptWindow } from "../windows/Intercept";

// Robustness pass (2026-11-17): fire-and-forget calls are caught, settings roll back when the save
// fails, and a failed save says so.

const initial = { store: useStore.getState(), planner: usePlanner.getState(), calendar: useCalendar.getState(), notes: useNotes.getState() };
const unhandled = vi.fn();

beforeAll(() => process.on("unhandledRejection", unhandled));
afterAll(() => process.off("unhandledRejection", unhandled));
beforeEach(() => {
  resetMockBackend();
  unhandled.mockClear();
  useStore.setState(initial.store, true);
  usePlanner.setState(initial.planner, true);
  useCalendar.setState(initial.calendar, true);
  useNotes.setState(initial.notes, true);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));

describe("settings that fail to save", () => {
  it("roll back and say so", async () => {
    vi.spyOn(native, "setSetting").mockRejectedValueOnce("Disk is full.");
    const before = useStore.getState().settings.dailyGoalMin;
    act(() => useStore.getState().setDailyGoal(before + 30));
    expect(useStore.getState().settings.dailyGoalMin).toBe(before + 30);
    await settle();
    expect(useStore.getState().settings.dailyGoalMin).toBe(before);
    expect(useStore.getState().notice).toMatchObject({ lead: "Not saved.", rest: "Disk is full." });
    expect(unhandled).not.toHaveBeenCalled();
  });

  it("put the sound back too", async () => {
    vi.spyOn(native, "setSetting").mockRejectedValueOnce("Disk is full.");
    expect(useStore.getState().settings.sounds).toBe(true);
    act(() => useStore.getState().setSounds(false));
    await settle();
    expect(useStore.getState().settings.sounds).toBe(true);
    expect(useStore.getState().notice?.lead).toBe("Not saved.");
  });

  it("leave a newer change alone", async () => {
    const save = vi.spyOn(native, "setSetting");
    let fail!: (e: unknown) => void;
    save.mockImplementationOnce(() => new Promise((_, rej) => (fail = rej)));
    act(() => useStore.getState().setWeekView("month"));
    act(() => useStore.getState().setWeekView("list"));
    await act(async () => fail("Disk is full."));
    await settle();
    expect(useStore.getState().settings.weekView).toBe("list");
    expect(useStore.getState().notice?.lead).toBe("Not saved.");
  });

  it("the daily reset rolls back and says so", async () => {
    vi.spyOn(native, "setSetting").mockRejectedValueOnce("Disk is full.");
    await act(() => useStore.getState().setDailyResetTime("06:30"));
    expect(useStore.getState().settings.dailyResetTime).toBe("04:00");
    expect(useStore.getState().notice).toMatchObject({ lead: "Not saved.", rest: "Disk is full." });
  });

  it("a failed app-state write is logged, not thrown", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(native, "setAppState").mockRejectedValueOnce("Tray is gone.");
    act(() => useStore.getState().setAppState("sealed"));
    await settle();
    expect(log).toHaveBeenCalledWith("setAppState", "Tray is gone.");
    expect(unhandled).not.toHaveBeenCalled();
  });
});

describe("background calls are logged", () => {
  it("calendar sync and cancel", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(native, "gcalSyncNow").mockRejectedValueOnce("offline");
    vi.spyOn(native, "gcalCancelConnect").mockRejectedValueOnce("offline");
    useCalendar.getState().syncNow();
    useCalendar.getState().cancelConnect();
    await settle();
    expect(log).toHaveBeenCalledWith("gcalSyncNow", "offline");
    expect(log).toHaveBeenCalledWith("gcalCancelConnect", "offline");
    expect(unhandled).not.toHaveBeenCalled();
  });

  it("the intercept window's buttons", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(native, "interceptReturn").mockRejectedValueOnce("No window.");
    render(<InterceptWindow />);
    const app: Intercept = { kind: "app", label: "Discord", attempts: 1, profileName: "Deep Work", elapsedMs: 60_000, remainingMs: 600_000, backTo: "VS Code", keyword: null };
    await act(async () => bus.emit(EVENTS.intercept, app));
    fireEvent.click(screen.getByRole("button", { name: /Back to VS Code/ }));
    await settle();
    expect(log).toHaveBeenCalledWith("interceptReturn", "No window.");
    expect(unhandled).not.toHaveBeenCalled();
  });
});

describe("native events", () => {
  it("a failed quit says why", async () => {
    vi.spyOn(native, "quitApp").mockRejectedValueOnce("Couldn't quit.");
    const off = connectNativeEvents();
    await act(async () => bus.emit(EVENTS.quit, null));
    await settle();
    expect(useStore.getState().notice?.lead).toBe("Couldn't quit.");
    off();
  });

  it("a tamper event with no detail falls back to the plain sentence", async () => {
    const off = connectNativeEvents();
    await act(async () => bus.emit(EVENTS.tamper, { kind: "clock", detail: "" }));
    expect(useStore.getState().notice).toMatchObject({ lead: "The seal is broken.", rest: "It stays on until the planned end." });
    await act(async () => bus.emit(EVENTS.tamper, { kind: "clock", detail: "the clock moved back" }));
    expect(useStore.getState().notice?.rest).toBe("The clock moved back. It stays on until the planned end.");
    off();
  });
});

describe("the close dialog", () => {
  it("says why the window didn't hide", async () => {
    vi.spyOn(native, "hideToTray").mockRejectedValueOnce("Tray is gone.");
    act(() => useStore.getState().openCloseDialog());
    render(<CloseDialog />);
    await act(async () => fireEvent.keyDown(window, { key: "Enter" }));
    await settle();
    expect(useStore.getState().notice?.lead).toBe("Tray is gone.");
    expect(unhandled).not.toHaveBeenCalled();
  });
});

describe("the command bar", () => {
  it("a command that fails says why", async () => {
    for (const d of sampleProfiles()) await native.createProfile(d);
    await native.setSetting("onboarded", "1");
    render(<AppShell />);
    await act(async () => await useStore.getState().loadProfiles());
    useNotes.setState({ create: () => Promise.reject("Notes are locked.") });
    await act(async () => fireEvent.keyDown(window, { key: "k", ctrlKey: true }));
    const bar = within(screen.getByRole("dialog", { name: "Command bar" }));
    const input = bar.getByRole("combobox", { name: "Search or command" });
    fireEvent.change(input, { target: { value: "New note" } });
    await act(async () => fireEvent.keyDown(input, { key: "Enter" }));
    await settle();
    expect(useStore.getState().notice?.lead).toBe("Notes are locked.");
    expect(unhandled).not.toHaveBeenCalled();
  });
});

describe("the tray panel", () => {
  async function seed() {
    const today = todayKey();
    await native.saveTodo({ title: "Send the invoice", dueDate: today, dueTime: null, durationMin: null, profileId: null });
  }

  it("keeps the text when adding fails, and says so", async () => {
    await seed();
    vi.spyOn(native, "saveTodo").mockRejectedValueOnce("Disk is full.");
    render(<TrayPanel />);
    const panel = within(await screen.findByRole("region", { name: "Sanctum tray panel" }));
    await panel.findByText("0/1");
    const add = panel.getByLabelText("Add a task for today");
    fireEvent.change(add, { target: { value: "Call the bank" } });
    await act(async () => fireEvent.keyDown(add, { key: "Enter" }));
    expect(add).toHaveValue("Call the bank");
    expect(panel.getByRole("status")).toHaveTextContent("Not saved. Disk is full.");
    // The next try goes through and clears it.
    await act(async () => fireEvent.keyDown(add, { key: "Enter" }));
    expect(add).toHaveValue("");
    expect(await panel.findByText("0/2")).toBeInTheDocument();
  });

  it("leaves a check as it was when the save fails", async () => {
    await seed();
    vi.spyOn(native, "setTodoDone").mockRejectedValueOnce("Disk is full.");
    render(<TrayPanel />);
    const panel = within(await screen.findByRole("region", { name: "Sanctum tray panel" }));
    await panel.findByText("0/1");
    await act(async () => fireEvent.click(panel.getByRole("checkbox", { name: "Send the invoice" })));
    expect(panel.getByRole("status")).toHaveTextContent("Not saved. Disk is full.");
    expect(panel.getByRole("checkbox", { name: "Send the invoice" })).toHaveAttribute("aria-checked", "false");
    expect(panel.getByText("0/1")).toBeInTheDocument();
    expect(unhandled).not.toHaveBeenCalled();
  });
});

describe("break the seal dialog", () => {
  it("a good poll after a failed open clears the old error", async () => {
    for (const d of sampleProfiles()) await native.createProfile(d);
    await act(() => useStore.getState().loadProfiles());
    await act(async () => void (await useStore.getState().enterFocus()));
    const view = await native.ladderOpen();
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    vi.spyOn(native, "ladderOpen").mockRejectedValueOnce("The ladder is unavailable.");
    vi.spyOn(native, "ladderView").mockResolvedValue(view);
    act(() => useStore.getState().openEndEarly());
    render(<BreakSealDialog />);
    expect(await screen.findByText("The ladder is unavailable.")).toBeInTheDocument();
    act(() => void vi.advanceTimersByTime(1000));
    expect(await screen.findByRole("button", { name: "Start the wait" })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("The ladder is unavailable.")).toBeNull());
  });
});
