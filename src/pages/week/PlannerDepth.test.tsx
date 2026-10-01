import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { vi } from "vitest";
import { WeekPage } from "./WeekPage";
import { useStore } from "../../state/store";
import { usePlanner } from "../../state/planner";
import { useCalendar } from "../../state/calendar";
import { connectNativeEvents } from "../../state/events";
import { resetMockBackend } from "../../lib/mockBackend";
import { native } from "../../lib/native";

// v0.1 planner depth: drag between days, and edit a whole recurring series.

const initialStore = useStore.getState();
const initialPlanner = usePlanner.getState();
const initialCalendar = useCalendar.getState();
let disconnect = () => {};
const TUESDAY = new Date(2026, 8, 29, 8, 0);

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(TUESDAY);
  resetMockBackend();
  useStore.setState(initialStore, true);
  usePlanner.setState(initialPlanner, true);
  useCalendar.setState(initialCalendar, true);
  disconnect = connectNativeEvents();
  await act(() => usePlanner.getState().ensure("2026-09-28", "2026-10-04"));
  await act(() => useCalendar.getState().connect().then(() => undefined));
  await act(() => useCalendar.getState().ensure("2026-09-28", "2026-10-04"));
});
afterEach(() => {
  disconnect();
  vi.useRealTimers();
});

async function drag(card: HTMLElement, to: HTMLElement) {
  fireEvent.dragStart(card);
  fireEvent.dragOver(to);
  expect(to).toHaveAttribute("data-drop", "true");
  await act(async () => fireEvent.drop(to));
}

describe("Week: drag between days", () => {
  it("moves a one-time item and an event to another day; routines stay put", async () => {
    await act(async () => void (await usePlanner.getState().saveTodo({ title: "Mock interview", dueDate: "2026-09-29", dueTime: null, durationMin: null, profileId: null })));
    await act(async () => void (await usePlanner.getState().saveRoutine({ title: "Gym", daysMask: 127, time: null, durationMin: null, profileId: null, active: true })));
    render(<WeekPage />);
    const tuesday = screen.getByRole("region", { name: "Tuesday, September 29" });
    const friday = screen.getByRole("region", { name: "Friday, October 2" });

    await drag(within(tuesday).getByRole("checkbox", { name: "Mock interview" }).closest("[data-kind]") as HTMLElement, friday);
    expect(within(friday).getByRole("checkbox", { name: "Mock interview" })).toBeInTheDocument();
    expect(within(tuesday).queryByRole("checkbox", { name: "Mock interview" })).toBeNull();
    expect(usePlanner.getState().todos.find((t) => t.title === "Mock interview")?.dueDate).toBe("2026-10-02");

    await drag(within(screen.getByRole("region", { name: "Thursday, October 1" })).getByRole("button", { name: /Dentist/ }), friday);
    expect((await native.gcalEvents("2026-09-28", "2026-10-04")).find((e) => e.eventId === "dentist")?.date).toBe("2026-10-02");

    const gym = within(tuesday).getByRole("checkbox", { name: "Gym" }).closest("[data-kind]")!;
    expect(gym).not.toHaveAttribute("draggable");
  });
});

describe("Week: recurring series", () => {
  it("edits this occurrence or the whole series", async () => {
    render(<WeekPage />);
    const tuesday = screen.getByRole("region", { name: "Tuesday, September 29" });
    fireEvent.click(within(tuesday).getByRole("button", { name: /Team standup/ }));
    const dialog = within(screen.getByRole("dialog", { name: "Edit event" }));
    expect(dialog.getByRole("radio", { name: "This event" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(dialog.getByRole("radio", { name: "All events" }));
    expect(dialog.getByText("Repeats as set in Google")).toBeInTheDocument();
    fireEvent.change(dialog.getByRole("textbox"), { target: { value: "Daily sync" } });
    await act(async () => fireEvent.click(dialog.getByRole("button", { name: /Save/ })));
    expect(screen.queryByRole("dialog")).toBeNull();
    const ev = (await native.gcalEvents("2026-09-28", "2026-10-04")).find((e) => e.seriesId === "standup-series")!;
    expect(ev.title).toBe("Daily sync");
    expect(ev.date).toBe("2026-09-29");
  });

  it("deletes the whole series after a confirmation", async () => {
    render(<WeekPage />);
    fireEvent.click(within(screen.getByRole("region", { name: "Tuesday, September 29" })).getByRole("button", { name: /Team standup/ }));
    const dialog = within(screen.getByRole("dialog", { name: "Edit event" }));
    fireEvent.click(dialog.getByRole("radio", { name: "All events" }));
    fireEvent.click(dialog.getByRole("button", { name: "Delete series" }));
    await act(async () => fireEvent.click(dialog.getByRole("button", { name: "Delete every occurrence" })));
    expect((await native.gcalEvents("2026-09-28", "2026-10-04")).some((e) => e.seriesId === "standup-series")).toBe(false);
  });
});
