import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { TrackersPage } from "./TrackersPage";
import { TrackersTab } from "../setup/Trackers";
import { CheckinDialog } from "../../components/CheckinDialog";
import { Toast } from "../../components/Toast";
import { useStore } from "../../state/store";
import { useTrackers } from "../../state/trackers";
import { usePlanner } from "../../state/planner";
import { connectNativeEvents } from "../../state/events";
import { mockControls, resetMockBackend } from "../../lib/mockBackend";
import { native } from "../../lib/native";
import { addDays, todayKey } from "../../lib/planner";
import type { Checkin } from "../../lib/types";

const initial = useStore.getState();
const initialTrackers = useTrackers.getState();
const initialPlanner = usePlanner.getState();

beforeEach(() => {
  resetMockBackend();
  useStore.setState(initial, true);
  useTrackers.setState(initialTrackers, true);
  usePlanner.setState(initialPlanner, true);
});

const click = (el: HTMLElement) => act(async () => fireEvent.click(el));

async function seed() {
  const w = await native.saveTracker({ name: "Weight", kind: "number", unit: "lb" });
  const mood = await native.saveTracker({ name: "Mood", kind: "scale", display: "chart" });
  const gym = await native.saveTracker({ name: "Gym", kind: "bool" });
  const journal = await native.saveTracker({ name: "Journal", kind: "text" });
  mockControls.history(w.id, [
    [20, 176.2],
    [10, 174],
    [3, 172.4],
  ]);
  mockControls.history(journal.id, [[1, "Long day."]]);
  return { w, mood, gym, journal };
}

describe("Setup > Trackers", () => {
  it("makes custom trackers from a template or from scratch, and edits them", async () => {
    render(
      <>
        <TrackersTab />
        <Toast />
      </>,
    );
    const trackers = within(await screen.findByRole("region", { name: "Trackers" }));
    expect(trackers.getByText(/Nothing tracked yet/)).toBeInTheDocument();

    await click(trackers.getByRole("button", { name: "New tracker" }));
    await click(trackers.getByRole("button", { name: "Body fat" }));
    expect(trackers.getByLabelText("Tracker name")).toHaveValue("Body fat");
    expect(trackers.getByLabelText("Unit")).toHaveValue("%");
    await click(trackers.getByRole("button", { name: "Add tracker" }));
    expect(trackers.getByRole("button", { name: "Edit Body fat" })).toHaveTextContent("Number · chart + table");

    await click(trackers.getByRole("button", { name: "New tracker" }));
    fireEvent.change(trackers.getByLabelText("Tracker name"), { target: { value: "Gratitude" } });
    fireEvent.change(trackers.getByLabelText("Tracker type"), { target: { value: "text" } });
    expect(trackers.queryByLabelText("Unit")).toBeNull();
    expect(trackers.queryByLabelText("Show as")).toBeNull();
    await click(trackers.getByRole("button", { name: "Add tracker" }));
    expect(trackers.getByRole("button", { name: "Edit Gratitude" })).toHaveTextContent("Text · list");

    // Names are unique.
    await click(trackers.getByRole("button", { name: "New tracker" }));
    fireEvent.change(trackers.getByLabelText("Tracker name"), { target: { value: "gratitude" } });
    await click(trackers.getByRole("button", { name: "Add tracker" }));
    expect(screen.getByRole("status")).toHaveTextContent("A tracker named gratitude already exists.");
    await click(trackers.getByRole("button", { name: "Cancel" }));

    await click(trackers.getByRole("button", { name: "Edit Body fat" }));
    fireEvent.change(trackers.getByLabelText("Goal"), { target: { value: "15" } });
    await click(trackers.getByRole("button", { name: "Save" }));
    expect(trackers.getByRole("button", { name: "Edit Body fat" })).toHaveTextContent("goal 15");
  });

  it("schedules check-ins with days, trackers, and a goal review", async () => {
    await seed();
    render(
      <>
        <TrackersTab />
        <Toast />
      </>,
    );
    const section = within(await screen.findByRole("region", { name: "Check-ins" }));
    await click(section.getByRole("button", { name: "New check-in" }));
    fireEvent.change(section.getByLabelText("Check-in name"), { target: { value: "Morning weigh-in" } });
    fireEvent.change(section.getByLabelText("Time"), { target: { value: "08:00" } });
    await click(section.getByRole("button", { name: "Add check-in" }));
    expect(screen.getByRole("status")).toHaveTextContent("Ask for at least one tracker, or review your goals.");

    await click(await section.findByRole("checkbox", { name: "Weight" }));
    // Monday and Thursday only.
    for (const d of ["Tue", "Wed", "Fri", "Sat", "Sun"]) await click(section.getByRole("button", { name: d }));
    await click(section.getByRole("button", { name: "Add check-in" }));
    const row = section.getByRole("button", { name: "Edit Morning weigh-in" });
    expect(row).toHaveTextContent("8:00 AM");
    expect(row).toHaveTextContent("Weight");
    expect(row).toHaveTextContent("Mon Thu");

    await click(section.getByRole("button", { name: "New check-in" }));
    fireEvent.change(section.getByLabelText("Check-in name"), { target: { value: "Evening wrap-up" } });
    fireEvent.change(section.getByLabelText("Time"), { target: { value: "21:30" } });
    await click(section.getByRole("switch", { name: "Review goals" }));
    await click(section.getByRole("button", { name: "Add check-in" }));
    const wrap = section.getByRole("button", { name: "Edit Evening wrap-up" });
    expect(wrap).toHaveTextContent("goal review");
    expect(wrap).toHaveTextContent("Every day");

    await click(section.getByRole("switch", { name: "Check in on startup" }));
    expect(await native.getSetting("checkin_on_startup")).toBe("0");
  });
});

describe("Trackers page", () => {
  it("shows an empty state that leads to Setup", async () => {
    render(<TrackersPage />);
    await click(await screen.findByRole("button", { name: "Make a tracker" }));
    expect(useStore.getState().setupTab).toBe("trackers");
    expect(useStore.getState().activeTab).toBe("setup");
  });

  it("charts each tracker on its own axis, with hover and a table", async () => {
    await seed();
    render(<TrackersPage />);
    const weight = within(await screen.findByRole("region", { name: "Weight" }));
    expect(weight.getByText("172.4")).toBeInTheDocument();
    expect(weight.getByText("−3.8 lb this range")).toBeInTheDocument();
    fireEvent.mouseEnter(weight.getAllByTestId("chart-hit")[0]!);
    expect(weight.getByRole("tooltip")).toHaveTextContent("176.2 lb");
    // Text trackers never get a chart; their notes are in the table.
    expect(screen.queryByRole("region", { name: "Journal" })).toBeNull();
    expect(within(screen.getByRole("region", { name: "Entries" })).getByText("Long day.")).toBeInTheDocument();

    // 7D drops the older entries.
    await click(screen.getByRole("button", { name: "7D" }));
    expect(weight.getByText("One entry")).toBeInTheDocument();

    await click(screen.getByRole("button", { name: "Table" }));
    expect(screen.queryByRole("region", { name: "Weight" })).toBeNull();
    const table = within(screen.getByRole("region", { name: "Entries" }));
    expect(table.getByText("172.4 lb")).toBeInTheDocument();
    await click(table.getByRole("button", { name: /Delete Journal entry/ }));
    expect(table.queryByText("Long day.")).toBeNull();
  });

  it("logs a manual entry with only what was filled in", async () => {
    const { mood, journal } = await seed();
    render(
      <>
        <TrackersPage />
        <CheckinDialog />
      </>,
    );
    await click(await screen.findByRole("button", { name: "Log entry" }));
    const dialog = within(screen.getByRole("dialog", { name: "Log entry" }));
    expect(dialog.getByRole("button", { name: /^Log/ })).toBeDisabled();
    await click(within(dialog.getByRole("group", { name: "Mood" })).getByRole("button", { name: "7" }));
    fireEvent.change(dialog.getByLabelText("Journal"), { target: { value: "Shipped M11." } });
    await click(dialog.getByRole("button", { name: /^Log/ }));
    expect(screen.queryByRole("dialog")).toBeNull();
    const logged = useTrackers.getState().entries.filter((e) => e.source === "manual");
    expect(logged.map((e) => [e.trackerId, e.value ?? e.text])).toEqual([
      [mood.id, 7],
      [journal.id, "Shipped M11."],
    ]);
  });
});

describe("Scheduled check-in", () => {
  async function due(c: Checkin) {
    const saved = await native.saveCheckin(c);
    render(
      <>
        <CheckinDialog />
        <Toast />
      </>,
    );
    const off = connectNativeEvents();
    await act(async () => mockControls.checkinDue(saved.id));
    return { saved, off };
  }

  it("starts from the last value, nudges, and logs as a check-in", async () => {
    const { w } = await seed();
    const { off } = await due({ id: 0, name: "Morning weigh-in", time: "08:00", daysMask: 127, trackerIds: [w.id], includeGoalReview: false });
    const dialog = within(await screen.findByRole("dialog", { name: "Morning weigh-in" }));
    expect(dialog.getByText("Scheduled check-in · 8:00 AM")).toBeInTheDocument();
    await waitFor(() => expect(dialog.getByLabelText("Weight")).toHaveValue("172.4"));
    await click(dialog.getByRole("button", { name: "Decrease Weight" }));
    expect(dialog.getByLabelText("Weight")).toHaveValue("172.3");
    expect(dialog.getByText(/−0.1 lb since/)).toBeInTheDocument();
    await act(async () => fireEvent.keyDown(window, { key: "Enter" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    const last = useTrackers.getState().entries.at(-1)!;
    expect([last.value, last.source]).toEqual([172.3, "checkin"]);
    expect(await native.checkinPending()).toBeNull();
    off();
  });

  it("skips or snoozes", async () => {
    const { w } = await seed();
    const { saved, off } = await due({ id: 0, name: "Weigh-in", time: "08:00", daysMask: 127, trackerIds: [w.id], includeGoalReview: false });
    await click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Snooze 15m" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    await act(async () => mockControls.checkinDue(saved.id));
    await click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Skip today" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    // Nothing new was logged.
    expect(useTrackers.getState().entries.filter((e) => e.trackerId === w.id)).toHaveLength(3);
    off();
  });

  it("waits while sealed and shows when the seal ends", async () => {
    const { w } = await seed();
    useStore.setState({ appState: "sealed" });
    const { off } = await due({ id: 0, name: "Weigh-in", time: "08:00", daysMask: 127, trackerIds: [w.id], includeGoalReview: false });
    expect(screen.queryByRole("dialog")).toBeNull();
    await act(async () => useStore.getState().setAppState("open"));
    expect(await screen.findByRole("dialog", { name: "Weigh-in" })).toBeInTheDocument();
    off();
  });

  it("reviews today's open tasks and plans tomorrow's top 3", async () => {
    const today = todayKey();
    const tomorrow = addDays(today, 1);
    await native.saveTodo({ title: "Send the invoice", dueDate: today, dueTime: null, durationMin: null, profileId: null });
    await native.saveTodo({ title: "Call the bank", dueDate: today, dueTime: null, durationMin: null, profileId: null });
    const { off } = await due({ id: 0, name: "Evening wrap-up", time: "21:30", daysMask: 127, trackerIds: [], includeGoalReview: true });
    const review = within(await screen.findByRole("region", { name: "Goal review" }));
    expect(await review.findByText("Send the invoice")).toBeInTheDocument();
    await click(review.getByRole("checkbox", { name: "Done: Send the invoice" }));
    const moveRow = review.getByText("Call the bank").parentElement!;
    await click(within(moveRow).getByRole("button", { name: "Tomorrow" }));
    await waitFor(() => expect(review.getByText("Everything open moved to tomorrow")).toBeInTheDocument());
    fireEvent.change(review.getByLabelText("Tomorrow 1"), { target: { value: "Write the M12 plan" } });
    await click(screen.getByRole("button", { name: /^Done/ }));
    expect(screen.queryByRole("dialog")).toBeNull();
    const next = await native.listTodos(tomorrow, tomorrow);
    expect(next.map((t) => t.title).sort()).toEqual(["Call the bank", "Write the M12 plan"]);
    off();
  });
});
