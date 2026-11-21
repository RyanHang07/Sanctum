import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRef } from "react";
import { isMorning, marked } from "./Tomorrow";
import { Home } from "./Home";
import { useStore } from "../state/store";
import { usePlanner } from "../state/planner";
import { resetMockBackend } from "../lib/mockBackend";
import { native } from "../lib/native";
import { addDays, todayKey } from "../lib/planner";
import { moment, setReducedMotion } from "../test/motion";
import { useMoreBelow } from "../lib/useMoreBelow";
import { useItemSelect } from "./itemSelect";

const initial = useStore.getState();
const initialPlanner = usePlanner.getState();

beforeEach(() => {
  resetMockBackend();
  useStore.setState(initial, true);
  usePlanner.setState(initialPlanner, true);
  useItemSelect.setState({ key: null, editing: null });
  setReducedMotion(true);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 10, 20, 10, 0, 0));
});
afterEach(() => {
  vi.useRealTimers();
});

const days = () => {
  const today = todayKey(new Date(), useStore.getState().settings.dailyResetTime);
  return { today, tomorrow: addDays(today, 1) };
};

describe("Tomorrow on Today", () => {
  it("is off by default: Today's list keeps its plain heading", async () => {
    await act(async () => void render(<Home />));
    expect(useStore.getState().settings.tomorrowTab).toBe(false);
    expect(screen.queryByRole("tablist", { name: "Day" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Today" })).toBeInTheDocument();
  });

  it("turned on, switches Today's list to tomorrow's, marks the morning, and checks off there", async () => {
    const { today, tomorrow } = days();
    await native.saveTodo({ title: "Dentist", dueDate: tomorrow, dueTime: "09:30", durationMin: null, profileId: null });
    await native.saveTodo({ title: "Call mom", dueDate: tomorrow, dueTime: "15:00", durationMin: null, profileId: null });
    act(() => useStore.getState().setTomorrowTab(true));
    expect(await native.getSetting("tomorrow_tab")).toBe("1");
    await act(async () => void render(<Home />));
    await act(() => usePlanner.getState().ensure(today, tomorrow));
    const day = within(screen.getByRole("tablist", { name: "Day" }));
    // By default the dot marks anything open tomorrow, seen from Today too.
    expect(day.getByRole("tab", { name: /Tomorrow, 2 planned/ })).toBeInTheDocument();
    await act(async () => fireEvent.click(day.getByRole("tab", { name: /Tomorrow/ })));
    const rows = screen.getAllByTestId("tomorrow-row");
    expect(rows.map((r) => r.textContent)).toEqual([expect.stringContaining("Dentist"), expect.stringContaining("Call mom")]);
    // With no cutoff, rows carry no mark of their own.
    expect(rows[0]).not.toHaveAttribute("data-morning");
    expect(screen.getByLabelText("Add a task for tomorrow")).toBeInTheDocument();
    await act(async () => fireEvent.click(screen.getByRole("checkbox", { name: "Dentist" })));
    expect(usePlanner.getState().todos.find((t) => t.title === "Dentist")?.done).toBe(true);
    await act(async () => fireEvent.click(day.getByRole("tab", { name: "Today" })));
    expect(screen.getByLabelText("Add a task for today")).toBeInTheDocument();
  });

  it("moves an item dropped on the other day's tab", async () => {
    const { today, tomorrow } = days();
    await native.saveTodo({ title: "Pay rent", dueDate: today, dueTime: null, durationMin: null, profileId: null });
    act(() => useStore.getState().setTomorrowTab(true));
    await act(async () => void render(<Home />));
    await act(() => usePlanner.getState().ensure(today, tomorrow));
    const row = screen.getByRole("checkbox", { name: "Pay rent" }).closest("[data-testid=task-row]") as HTMLElement;
    const data = { setData: () => undefined, effectAllowed: "", dropEffect: "" };
    fireEvent.click(row);
    fireEvent.dragStart(row, { dataTransfer: data });
    const tab = screen.getByRole("tab", { name: /Tomorrow/ });
    fireEvent.dragOver(tab, { dataTransfer: data });
    await act(async () => void fireEvent.drop(tab, { dataTransfer: data }));
    expect((await native.listTodos(tomorrow, tomorrow)).some((t) => t.title === "Pay rent")).toBe(true);
  });

  it("an item dragged to Tomorrow and back shows at full strength, though its row left mid-drag", async () => {
    const { today, tomorrow } = days();
    await native.saveTodo({ title: "Pay rent", dueDate: today, dueTime: null, durationMin: null, profileId: null });
    act(() => useStore.getState().setTomorrowTab(true));
    await act(async () => void render(<Home />));
    await act(() => usePlanner.getState().ensure(today, tomorrow));
    const data = { setData: () => undefined, effectAllowed: "", dropEffect: "" };
    const day = within(screen.getByRole("tablist", { name: "Day" }));
    const row = screen.getByRole("checkbox", { name: "Pay rent" }).closest("[data-testid=task-row]") as HTMLElement;
    fireEvent.click(row);
    fireEvent.dragStart(row, { dataTransfer: data });
    fireEvent.dragOver(day.getByRole("tab", { name: /Tomorrow/ }), { dataTransfer: data });
    // The drop moves the row away, so only the window hears the drag end.
    await act(async () => void fireEvent.drop(day.getByRole("tab", { name: /Tomorrow/ }), { dataTransfer: data }));
    await act(async () => void window.dispatchEvent(new Event("dragend")));
    await act(async () => fireEvent.click(day.getByRole("tab", { name: /Tomorrow/ })));
    const back = screen.getAllByTestId("tomorrow-row").find((r) => r.textContent?.includes("Pay rent"))!;
    fireEvent.click(back);
    fireEvent.dragStart(back, { dataTransfer: data });
    fireEvent.dragOver(day.getByRole("tab", { name: "Today" }), { dataTransfer: data });
    await act(async () => void fireEvent.drop(day.getByRole("tab", { name: "Today" }), { dataTransfer: data }));
    await act(async () => fireEvent.click(day.getByRole("tab", { name: "Today" })));
    const again = screen.getByRole("checkbox", { name: "Pay rent" }).closest("[data-testid=task-row]") as HTMLElement;
    expect(again).not.toHaveClass("opacity-40");
  });

  it("moves an item dragged from Tomorrow onto the Today tab", async () => {
    const { today, tomorrow } = days();
    await native.saveTodo({ title: "Water plants", dueDate: tomorrow, dueTime: null, durationMin: null, profileId: null });
    act(() => useStore.getState().setTomorrowTab(true));
    await act(async () => void render(<Home />));
    await act(() => usePlanner.getState().ensure(today, tomorrow));
    const day = within(screen.getByRole("tablist", { name: "Day" }));
    await act(async () => fireEvent.click(day.getByRole("tab", { name: /Tomorrow/ })));
    const row = screen.getAllByTestId("tomorrow-row").find((r) => r.textContent?.includes("Water plants"))!;
    // Only the selected row drags.
    expect(row).not.toHaveAttribute("draggable");
    fireEvent.click(row);
    expect(row).toHaveAttribute("draggable", "true");
    // Selected looks the same as on Today: a light left edge on a raised row.
    expect(row).toHaveClass("border-l-text-2", "bg-raised");
    const data = { setData: () => undefined, effectAllowed: "", dropEffect: "" };
    fireEvent.click(row);
    fireEvent.dragStart(row, { dataTransfer: data });
    const tab = day.getByRole("tab", { name: "Today" });
    fireEvent.dragOver(tab, { dataTransfer: data });
    await act(async () => void fireEvent.drop(tab, { dataTransfer: data }));
    expect((await native.listTodos(today, today)).some((t) => t.title === "Water plants")).toBe(true);
  });

  it("with a cutoff, marks only what starts before it, on the tab and the rows", async () => {
    const { today, tomorrow } = days();
    await native.saveTodo({ title: "Dentist", dueDate: tomorrow, dueTime: "09:30", durationMin: null, profileId: null });
    await native.saveTodo({ title: "Call mom", dueDate: tomorrow, dueTime: "15:00", durationMin: null, profileId: null });
    act(() => {
      useStore.getState().setTomorrowTab(true);
      useStore.getState().setTomorrowMarkBefore("12:00");
    });
    expect(await native.getSetting("tomorrow_mark_before")).toBe("12:00");
    await act(async () => void render(<Home />));
    await act(() => usePlanner.getState().ensure(today, tomorrow));
    const day = within(screen.getByRole("tablist", { name: "Day" }));
    expect(day.getByRole("tab", { name: /Tomorrow, 1 before noon/ })).toBeInTheDocument();
    await act(async () => fireEvent.click(day.getByRole("tab", { name: /Tomorrow/ })));
    const rows = screen.getAllByTestId("tomorrow-row");
    expect(rows[0]).toHaveAttribute("data-morning", "true");
    expect(rows[1]).not.toHaveAttribute("data-morning");
  });

  it("marks anything open, or only what's before the cutoff", () => {
    expect([marked({ done: false, time: null }, null), marked({ done: true, time: "08:00" }, null)]).toEqual([true, false]);
    expect([marked({ done: false, time: "09:30" }, "12:00"), marked({ done: false, time: "15:00" }, "12:00"), marked({ done: false, time: null }, "12:00")]).toEqual([true, false, false]);
    expect([isMorning("06:00"), isMorning("12:00")]).toEqual([true, false]);
  });
});

describe("at the reset time", () => {
  it("both lists refresh with the screens' swap as tomorrow becomes today", async () => {
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
    // 03:59, a minute before the default 04:00 reset.
    vi.setSystemTime(new Date(2026, 10, 21, 3, 59, 0));
    setReducedMotion(false);
    await act(async () => void render(<Home />));
    expect(moment("day-swap")).toBeUndefined();
    expect(moment("routines-reset")).toBeUndefined();
    await act(async () => void vi.advanceTimersByTime(61_000));
    expect(moment("day-swap")).toBeDefined();
    expect(moment("routines-reset")).toBeDefined();
  });

  it("the dot sits still on first paint, and bumps in once tomorrow gets something", async () => {
    const { today, tomorrow } = days();
    await native.saveTodo({ title: "Dentist", dueDate: tomorrow, dueTime: "09:30", durationMin: null, profileId: null });
    act(() => useStore.getState().setTomorrowTab(true));
    setReducedMotion(false);
    await act(async () => void render(<Home />));
    await act(() => usePlanner.getState().ensure(today, tomorrow));
    expect(document.querySelector("[data-tomorrow-dot]")).not.toBeNull();
    expect(moment("tomorrow-dot")).toBeUndefined();
    // Emptied: no dot. Then something lands tomorrow and the dot arrives with its bump.
    const id = usePlanner.getState().todos.find((t) => t.title === "Dentist")!.id;
    await act(async () => {
      await native.deleteTodo(id);
      await usePlanner.getState().reload();
    });
    expect(document.querySelector("[data-tomorrow-dot]")).toBeNull();
    await act(async () => {
      await native.saveTodo({ title: "Call the bank", dueDate: tomorrow, dueTime: "15:00", durationMin: null, profileId: null });
      await usePlanner.getState().reload();
    });
    expect(document.querySelector("[data-tomorrow-dot]")).not.toBeNull();
    expect(moment("tomorrow-dot")).toBeDefined();
  });
});

describe("a list with more below", () => {
  function List({ onMore }: { onMore: (m: boolean) => void }) {
    const ref = useRef<HTMLDivElement>(null);
    onMore(useMoreBelow(ref));
    return <div ref={ref} data-testid="list" />;
  }

  it("knows when it's scrolled short of its end", () => {
    let more = false;
    const proto = HTMLElement.prototype;
    const sizes = vi.spyOn(proto, "scrollHeight", "get").mockReturnValue(400);
    const view = vi.spyOn(proto, "clientHeight", "get").mockReturnValue(200);
    render(<List onMore={(m) => (more = m)} />);
    expect(more).toBe(true);
    const list = screen.getByTestId("list");
    list.scrollTop = 200;
    act(() => void list.dispatchEvent(new Event("scroll")));
    expect(more).toBe(false);
    sizes.mockRestore();
    view.mockRestore();
  });
});
