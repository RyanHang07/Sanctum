import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { vi } from "vitest";
import { WeekPage } from "./WeekPage";
import { useStore } from "../../state/store";
import { usePlanner } from "../../state/planner";
import { connectNativeEvents } from "../../state/events";
import { resetPrompted } from "../../state/schedule";
import { mockControls, resetMockBackend } from "../../lib/mockBackend";
import { finish, moment, seek, setReducedMotion } from "../../test/motion";

// v0.4 Week (ProtoWeek.dc.html, flat: no glow): day states, done and slipped items, folds,
// no left-edge accents, the View switch and the week-step motion.

const initialStore = useStore.getState();
const initialPlanner = usePlanner.getState();
let disconnect = () => {};

// Tuesday, Sep 29 2026, 9:30 AM. The week is Mon Sep 28 – Sun Oct 4.
const TUESDAY = new Date(2026, 8, 29, 9, 30);
const day = (name: string) => screen.getByRole("region", { name });
const MONDAY = "Monday, September 28";
const TODAY = "Tuesday, September 29";
const WEDNESDAY = "Wednesday, September 30";

const todo = (title: string, dueDate: string) =>
  act(async () => void (await usePlanner.getState().saveTodo({ title, dueDate, dueTime: null, durationMin: null, profileId: null })));

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(TUESDAY);
  resetMockBackend();
  resetPrompted();
  useStore.setState(initialStore, true);
  usePlanner.setState(initialPlanner, true);
  disconnect = connectNativeEvents();
  await act(() => usePlanner.getState().ensure("2026-09-28", "2026-10-04"));
});
afterEach(() => {
  disconnect();
  vi.useRealTimers();
});

describe("Week day states", () => {
  it("marks kept, missed, today and future days, with focused minutes", async () => {
    mockControls.statsDays({
      "2026-09-26": { focusMin: 30 },
      "2026-09-27": { focusMin: 30 },
      "2026-09-28": { focusMin: 150 },
      "2026-09-29": { focusMin: 42 },
    });
    await act(async () => render(<WeekPage />));
    const kept = await within(day(MONDAY)).findByTestId("day-mark");
    expect(kept).toHaveAttribute("data-status", "kept");
    expect(kept).toHaveTextContent("Kept");
    // The kept mark is a solid dot in the second color, never the accent.
    expect(kept.querySelector("span")).toHaveClass("bg-second");
    expect(kept.querySelector("span")!.className).not.toMatch(/sealed|shadow|gradient|blur/);
    expect(within(day(MONDAY)).getByText("150")).toBeInTheDocument();

    const today = within(day(TODAY)).getByTestId("day-mark");
    expect(today).toHaveTextContent("In progress");
    expect(today.querySelector("span")).toHaveClass("bg-sealed");
    expect(within(day(TODAY)).getByTestId("today-minutes")).toHaveTextContent("42");
    expect(within(day(TODAY)).getByText("of 120 min")).toBeInTheDocument();
    expect(within(day(TODAY)).getByRole("img", { name: "42 minutes of a 120 minute goal" })).toBeInTheDocument();
    expect(within(day(TODAY)).getByTestId("today-fill").style.transform).toBe("scaleX(0.35)");

    // Future days have no mark and no minutes.
    expect(within(day(WEDNESDAY)).queryByTestId("day-mark")).toBeNull();
    expect(day(WEDNESDAY)).toHaveAttribute("data-when", "future");
    expect(within(day(WEDNESDAY)).queryByText(/min/)).toBeNull();

    // The week before: Sunday missed (a hollow ring), days before any history recorded nothing.
    fireEvent.click(screen.getByRole("button", { name: "Previous week" }));
    const missed = await within(day("Sunday, September 27")).findByTestId("day-mark");
    expect(missed).toHaveTextContent("Missed");
    expect(missed.querySelector("span")).toHaveClass("border-muted");
    expect(within(day("Monday, September 21")).getByText("Nothing recorded")).toBeInTheDocument();
  });

  it("has no key: the page is the key", async () => {
    await act(async () => render(<WeekPage />));
    expect(screen.queryByRole("button", { name: "Key" })).toBeNull();
  });
});

describe("Week items", () => {
  it("strikes through done items and dims what slipped on past days", async () => {
    await todo("Renew passport", "2026-09-28");
    await todo("Pay rent", "2026-09-28");
    await todo("Pack", "2026-09-30");
    await act(async () => render(<WeekPage />));
    await act(async () => fireEvent.click(within(day(MONDAY)).getByRole("checkbox", { name: "Pay rent" })));

    const slipped = within(day(MONDAY)).getByRole("checkbox", { name: "Renew passport" }).closest("[data-kind]")!;
    expect(slipped).toHaveAttribute("data-state", "slipped");
    expect(slipped).toHaveTextContent("Not done");
    expect(within(slipped as HTMLElement).getByText("Renew passport")).toHaveClass("text-muted");
    expect(within(slipped as HTMLElement).getByText("Renew passport")).not.toHaveClass("line-through");

    const done = within(day(MONDAY)).getByRole("checkbox", { name: "Pay rent" });
    expect(done).toHaveAttribute("aria-checked", "true");
    expect(done.querySelector("path")).toHaveAttribute("data-check", "on");
    const row = done.closest("[data-kind]")!;
    expect(row).toHaveAttribute("data-state", "done");
    expect(within(row as HTMLElement).getByText("Pay rent")).toHaveClass("line-through");

    // Future items are only planned: outlined, not on a raised surface.
    const future = within(day(WEDNESDAY)).getByRole("checkbox", { name: "Pack" });
    expect(future.querySelector("path")).toHaveAttribute("data-check", "off");
    expect(future.closest("[data-kind]")).toHaveAttribute("data-when", "future");
    expect(future.closest("[data-kind]")).toHaveClass("bg-transparent");
  });

  it("draws no left-edge accent on any card", async () => {
    await act(async () => void (await usePlanner.getState().saveTodo({ title: "Deep work", dueDate: "2026-09-29", dueTime: "10:00", durationMin: 60, profileId: 1 })));
    await act(async () => void (await usePlanner.getState().saveRoutine({ title: "Stretch", daysMask: 127, time: null, durationMin: null, profileId: null, active: true })));
    await act(async () => render(<WeekPage />));
    fireEvent.click(within(day(TODAY)).getByRole("button", { name: /^Routines/ }));
    const cards = document.querySelectorAll("[data-kind]");
    expect(cards.length).toBeGreaterThan(1);
    for (const c of cards) expect(c.className).not.toMatch(/\bborder-l(-(?!ine)|\s|$)|\bbg-event\b|w-\[3px\]/);
  });
});

describe("Week routine folds", () => {
  it("keeps closed routines mounted for the fold, but out of reach", async () => {
    await act(async () => void (await usePlanner.getState().saveRoutine({ title: "Stretch", daysMask: 127, time: null, durationMin: null, profileId: null, active: true })));
    await act(async () => render(<WeekPage />));
    const toggle = within(day(TODAY)).getByRole("button", { name: "Routines, 0 of 1 done" });
    const fold = within(day(TODAY)).getByTestId("fold");
    const inner = fold.firstElementChild as HTMLElement;
    expect(fold).not.toHaveAttribute("data-open");
    expect(inner).toHaveAttribute("aria-hidden", "true");
    expect(inner).toHaveAttribute("inert");
    expect(within(day(TODAY)).queryByRole("checkbox", { name: "Stretch" })).toBeNull();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(fold).toHaveAttribute("data-open", "true");
    expect(inner).not.toHaveAttribute("aria-hidden");
    expect(inner).not.toHaveAttribute("inert");
    await act(async () => fireEvent.click(within(day(TODAY)).getByRole("checkbox", { name: "Stretch" })));
    expect(within(day(TODAY)).getByRole("button", { name: "Routines, 1 of 1 done" })).toBeInTheDocument();
  });
});

describe("Week header", () => {
  it("switches views with a segmented button group, not tabs", async () => {
    await act(async () => render(<WeekPage />));
    expect(screen.queryByRole("tablist")).toBeNull();
    const group = screen.getByRole("group", { name: "View" });
    expect(within(group).getByRole("button", { name: "Week" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(within(group).getByRole("button", { name: "List" }));
    expect(within(group).getByRole("button", { name: "List" })).toHaveAttribute("aria-pressed", "true");
    expect(within(group).getByRole("button", { name: "Week" })).toHaveAttribute("aria-pressed", "false");
  });

  it("slides the days in the direction of travel, then settles", async () => {
    setReducedMotion(false);
    await act(async () => render(<WeekPage />));
    const grid = screen.getByTestId("week-grid");
    fireEvent.click(screen.getByRole("button", { name: "Next week" }));
    seek("week-step", 0);
    expect(grid.style.transform).toContain("translate(16px");
    expect(grid.style.opacity).toBe("0.5");
    finish("week-step");
    expect(grid.style.transform).toBe("");
    expect(grid.style.opacity).toBe("");

    fireEvent.click(screen.getByRole("button", { name: "Previous week" }));
    seek("week-step", 0);
    expect(grid.style.transform).toContain("translate(-16px");
  });

  it("does not move the days under reduced motion", async () => {
    await act(async () => render(<WeekPage />));
    const grid = screen.getByTestId("week-grid");
    fireEvent.click(screen.getByRole("button", { name: "Next week" }));
    expect(moment("week-step")!.progress()).toBe(1);
    expect(grid.style.transform).toBe("");
  });
});
