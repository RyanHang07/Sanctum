import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { vi } from "vitest";
import { WeekPage } from "./week/WeekPage";
import { Home } from "./Home";
import { homeLine } from "./headlines";
import { ConnectionsSection } from "./setup/Connections";
import { Toast } from "../components/Toast";
import { useStore } from "../state/store";
import { usePlanner } from "../state/planner";
import { useCalendar } from "../state/calendar";
import { connectNativeEvents } from "../state/events";
import { checkSchedule, resetPrompted } from "../state/schedule";
import { mockControls, resetMockBackend } from "../lib/mockBackend";
import { native } from "../lib/native";
import { sampleProfiles } from "../lib/catalog";
import type { CalEvent } from "../lib/types";

// Google Calendar in the UI (SPEC 4.3), against the mock backend's fake account.

const initialStore = useStore.getState();
const initialPlanner = usePlanner.getState();
const initialCalendar = useCalendar.getState();
let disconnect = () => {};

// Tuesday, Sep 29 2026, 9:40 AM: the mock's 9:30 standup is running.
const TUESDAY = new Date(2026, 8, 29, 9, 40);

async function setup({ connect = true } = {}) {
  for (const d of sampleProfiles()) await native.createProfile(d);
  await act(() => useStore.getState().loadProfiles());
  await act(() => usePlanner.getState().ensure("2026-09-28", "2026-10-04"));
  if (connect) await act(() => useCalendar.getState().connect().then(() => undefined));
  await act(() => useCalendar.getState().ensure("2026-09-28", "2026-10-04"));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(TUESDAY);
  resetMockBackend();
  resetPrompted();
  useStore.setState(initialStore, true);
  usePlanner.setState(initialPlanner, true);
  useCalendar.setState(initialCalendar, true);
  disconnect = connectNativeEvents();
});
afterEach(() => {
  disconnect();
  vi.useRealTimers();
});

describe("Setup: Connections", () => {
  it("connects, picks calendars, and disconnects", async () => {
    await setup({ connect: false });
    render(<ConnectionsSection />);
    expect(await screen.findByTestId("calendar-status")).toHaveTextContent("Not connected to Google Calendar.");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Connect" })));
    expect(await screen.findByText("Connected to Google Calendar.")).toBeInTheDocument();
    expect(screen.getByTestId("calendar-status")).toHaveAttribute("data-tone", "ok");
    expect(screen.getByText("you@example.com")).toBeInTheDocument();
    expect(screen.getByText("Synced just now")).toBeInTheDocument();

    // Main and Sanctum's calendar are shown by default; others are off.
    expect(screen.getByRole("switch", { name: "Show Personal" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("switch", { name: "Show Sanctum" })).toHaveAttribute("aria-checked", "true");
    const team = screen.getByRole("switch", { name: "Show Team" });
    expect(team).toHaveAttribute("aria-checked", "false");
    await act(async () => fireEvent.click(team));
    expect(team).toHaveAttribute("aria-checked", "true");
    expect(useCalendar.getState().events.some((e) => e.title === "Sprint retro")).toBe(true);

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Disconnect" })));
    expect(screen.getByRole("button", { name: "Connect" })).toBeEnabled();
    expect(screen.queryByRole("switch", { name: "Show Personal" })).toBeNull();
  });

  it("removes the Sanctum calendar only after confirming", async () => {
    await setup();
    render(
      <>
        <ConnectionsSection />
        <Toast />
      </>,
    );
    await act(async () => fireEvent.click(await screen.findByRole("button", { name: "Remove Sanctum calendar" })));
    const dialog = screen.getByRole("alertdialog", { name: "Remove the Sanctum calendar" });
    expect(within(dialog).getByRole("heading", { level: 1 })).toHaveTextContent("This removes the Sanctum calendar.");
    expect(dialog).toHaveTextContent("Your routines and items stay in Sanctum.");
    await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "Remove calendar" })));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(useCalendar.getState().status?.connected).toBe(false);
    expect(screen.getByText("Sanctum calendar removed.")).toBeInTheDocument();
  });
});

describe("Week: calendar events", () => {
  it("shows events in their day columns and the list, with the sync status", async () => {
    await setup();
    await act(async () => void render(<WeekPage />));
    const tuesday = screen.getByRole("region", { name: "Tuesday, September 29" });
    const standup = within(tuesday).getByRole("button", { name: /Team standup/ });
    expect(standup.closest("[data-kind]")).toHaveAttribute("data-kind", "event");
    expect(standup).toHaveTextContent("9:30a");
    // An event has no box to tick: a calendar mark stands in its place, and it names its calendar.
    const card = within(standup.closest("[data-kind]") as HTMLElement);
    expect(card.queryByRole("checkbox")).toBeNull();
    expect(card.getByRole("img", { name: "Calendar event" })).toBeInTheDocument();
    expect(standup.textContent).toMatch(/9:30a · \S/);
    // A bare #focus tag reads as a focus block, shown without the tag (and without a left-edge accent).
    const wednesday = screen.getByRole("region", { name: "Wednesday, September 30" });
    const deep = within(wednesday).getByRole("button", { name: /^Deep work/ });
    expect(deep).not.toHaveTextContent("#focus");
    expect(deep.closest("[data-kind]")).toHaveAttribute("data-focus", "true");
    // All-day, two days.
    for (const day of ["Friday, October 2", "Saturday, October 3"]) {
      expect(within(screen.getByRole("region", { name: day })).getByRole("button", { name: /Offsite/ })).toHaveTextContent("all day");
    }
    expect(screen.getByText("Synced with Google Calendar")).toBeInTheDocument();

    fireEvent.click(within(screen.getByRole("group", { name: "View" })).getByRole("button", { name: "List" }));
    const list = screen.getByRole("region", { name: "Tuesday list" });
    expect(within(list).getByText("Team standup").closest("[data-kind]")).toHaveAttribute("data-kind", "event");
  });

  it("edits an event, tags it with a profile, and deletes it after confirming", async () => {
    await setup();
    await act(async () => void render(<WeekPage />));
    const wednesday = screen.getByRole("region", { name: "Wednesday, September 30" });
    fireEvent.click(within(wednesday).getByRole("button", { name: /^Deep work/ }));
    let dialog = screen.getByRole("dialog", { name: "Edit event" });
    expect(within(dialog).getByLabelText("Title")).toHaveValue("Deep work");
    // A bare #focus uses the profile picked on Home.
    expect(within(dialog).getByLabelText("Focus profile")).toHaveDisplayValue("Interview Prep");
    fireEvent.change(within(dialog).getByLabelText("Focus profile"), { target: { value: String(useStore.getState().profiles.find((p) => p.name === "Deep Work")!.id) } });
    fireEvent.change(within(dialog).getByLabelText("Time"), { target: { value: "15:00" } });
    await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: /Save/ })));
    const saved = useCalendar.getState().events.find((e) => e.eventId === "deep")!;
    expect(saved).toMatchObject({ title: "Deep work #focus:deep-work", time: "15:00" });
    expect(within(wednesday).getByRole("button", { name: /^Deep work/ })).toHaveTextContent("3:00p");

    fireEvent.click(within(wednesday).getByRole("button", { name: /^Deep work/ }));
    dialog = screen.getByRole("dialog", { name: "Edit event" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect(useCalendar.getState().events.some((e) => e.eventId === "deep")).toBe(true);
    await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "Delete from Google" })));
    expect(useCalendar.getState().events.some((e) => e.eventId === "deep")).toBe(false);
    expect(within(wednesday).queryByRole("button", { name: /^Deep work/ })).toBeNull();
  });

  it("adds a new item straight onto one of your calendars", async () => {
    await setup();
    await act(async () => void render(<WeekPage />));
    fireEvent.click(screen.getByRole("button", { name: "New item" }));
    const dialog = screen.getByRole("dialog", { name: "New item" });
    fireEvent.change(within(dialog).getByLabelText("Title"), { target: { value: "Coffee with Sam" } });
    // To-do or event is a visible choice; the calendar picker shows only for an event.
    expect(within(dialog).queryByLabelText("Save to")).toBeNull();
    fireEvent.click(within(within(dialog).getByRole("group", { name: "Kind" })).getByRole("button", { name: "Event" }));
    fireEvent.change(within(dialog).getByLabelText("Save to"), { target: { value: "primary@example.com" } });
    // On a calendar, no time means all day.
    expect(within(within(dialog).getByLabelText("Time")).getByRole("option", { name: "All day" })).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText("Time"), { target: { value: "16:00" } });
    await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: /Add/ })));
    expect(useCalendar.getState().events.find((e) => e.title === "Coffee with Sam")).toMatchObject({ calendarId: "primary@example.com", date: "2026-09-29", time: "16:00" });
    expect(usePlanner.getState().todos).toHaveLength(0);
  });

  it("shows read-only calendars without edit controls", async () => {
    await setup();
    // Holidays is read-only in the mock; give it an event directly.
    const day = new Date(2026, 8, 29).getTime();
    const holiday: CalEvent = {
      calendarId: "holidays@group.calendar",
      calendarName: "Holidays",
      eventId: "h1",
      title: "Indigenous Peoples' Day",
      date: "2026-09-29",
      endDate: "2026-09-29",
      time: null,
      durationMin: null,
      startMs: day,
      endMs: day + 86_400_000,
      allDay: true,
      attendees: 0,
      recurring: false,
      htmlLink: "https://calendar.google.com/calendar/event?eid=h1",
      writable: false,
    };
    act(() => useCalendar.setState({ events: [...useCalendar.getState().events, holiday] }));
    await act(async () => void render(<WeekPage />));
    const tuesday = screen.getByRole("region", { name: "Tuesday, September 29" });
    fireEvent.click(within(tuesday).getByRole("button", { name: /Indigenous/ }));
    const dialog = screen.getByRole("dialog", { name: "Holidays" });
    expect(dialog).toHaveTextContent("This calendar is read-only.");
    expect(within(dialog).queryByLabelText("Title")).toBeNull();
    expect(within(dialog).queryByRole("button", { name: "Delete" })).toBeNull();
    expect(within(dialog).getByRole("button", { name: "Open in Google" })).toBeInTheDocument();
  });
});

describe("Home: In event", () => {
  it("holds focus during a meeting with others, then enters the queued focus when it ends", async () => {
    await setup();
    // The mock's 9:30 standup (4 people) is running at 9:40.
    act(() => void checkSchedule());
    expect(useStore.getState().appState).toBe("event");
    await act(async () => void render(<Home />));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(homeLine("event", { title: "Team standup", until: "9:45 AM" }));
    const bar = screen.getByTestId("event-bar");
    // The time left is the cell's countdown, named for screen readers.
    // Whole minutes, the way the sealed timer counts (M6).
    expect(within(bar).getByRole("timer", { name: "5 min left" })).toBeInTheDocument();
    // The slot's chip is tinted with plain text and an event-colored dot, never white on the fill (H2).
    const chip = within(screen.getByTestId("event-slot")).getByText("In event");
    expect(chip).toHaveClass("bg-event-tint", "text-text");
    expect(chip).not.toHaveClass("bg-event");
    expect(chip.querySelector(".bg-event")).not.toBeNull();
    // Times read the way the Today list writes them.
    expect(screen.getByTestId("event-slot")).toHaveTextContent("9:30a to 9:45a");
    await act(async () => fireEvent.click(within(bar).getByRole("button", { name: "Queue focus at 9:45a" })));
    expect(bar).toHaveTextContent("Interview Prep starts when it ends");

    vi.setSystemTime(new Date(2026, 8, 29, 9, 46));
    await act(async () => void checkSchedule());
    await waitFor(() => expect(useStore.getState().appState).toBe("sealed"));
    expect(useStore.getState().session?.profileName).toBe("Interview Prep");
    await act(() => native.emergencyUnlock("test cleanup"));
  });

  it("goes back to open without focusing when nothing was queued; solo events don't count", async () => {
    await setup();
    act(() => void checkSchedule());
    expect(useStore.getState().appState).toBe("event");
    vi.setSystemTime(new Date(2026, 8, 29, 9, 50));
    act(() => void checkSchedule());
    expect(useStore.getState().appState).toBe("open");
    expect(useStore.getState().session).toBeNull();

    // A meeting added mid-day arrives through a sync and takes over.
    await act(async () => mockControls.meetingNow(20, "Mock interview"));
    await waitFor(() => expect(useCalendar.getState().events.some((e) => e.title === "Mock interview")).toBe(true));
    act(() => void checkSchedule());
    expect(useStore.getState().meeting?.title).toBe("Mock interview");
  });
});
