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
import { DUR, gsap } from "../../lib/gsap";
import { finish, moment, seek, setReducedMotion } from "../../test/motion";

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
    expect(trackers.getByRole("button", { name: "Body fat" }).className).toMatch(/(^|\s)border-sealed(\s|$)/);
    expect(trackers.getByLabelText("Tracker name")).toHaveValue("Body fat");
    expect(trackers.getByLabelText("Unit")).toHaveValue("%");
    await click(trackers.getByRole("button", { name: "Add tracker" }));
    expect(trackers.getByRole("button", { name: "Edit Body fat" })).toHaveTextContent("Number, chart and table");

    await click(trackers.getByRole("button", { name: "New tracker" }));
    fireEvent.change(trackers.getByLabelText("Tracker name"), { target: { value: "Gratitude" } });
    fireEvent.change(trackers.getByLabelText("Tracker type"), { target: { value: "text" } });
    expect(trackers.queryByLabelText("Unit")).toBeNull();
    expect(trackers.queryByLabelText("Show as")).toBeNull();
    await click(trackers.getByRole("button", { name: "Add tracker" }));
    expect(trackers.getByRole("button", { name: "Edit Gratitude" })).toHaveTextContent("Text, list");

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

    // 7 days drops the older entries.
    await click(screen.getByRole("button", { name: "7 days" }));
    expect(weight.getByText("One entry")).toBeInTheDocument();

    await click(screen.getByRole("button", { name: "Table" }));
    expect(screen.queryByRole("region", { name: "Weight" })).toBeNull();
    const table = within(screen.getByRole("region", { name: "Entries" }));
    expect(table.getByText("172.4 lb")).toBeInTheDocument();
    await click(table.getByRole("button", { name: /Delete Journal entry/ }));
    expect(table.queryByText("Long day.")).toBeNull();
  });

  it("filters the table to one tracker, with its change and goal, or back to all", async () => {
    const w = await native.saveTracker({ name: "Weight", kind: "number", unit: "lb", goal: 175 });
    mockControls.history(w.id, [
      [20, 176.2],
      [10, 174],
      [3, 172.4],
    ]);
    const journal = await native.saveTracker({ name: "Journal", kind: "text" });
    mockControls.history(journal.id, [[1, "Long day."]]);
    render(<TrackersPage />);
    await click(await screen.findByRole("button", { name: "Table" }));
    const table = within(screen.getByRole("region", { name: "Entries" }));
    const show = within(table.getByRole("group", { name: "Show entries for" }));
    expect(show.getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "true");
    expect(table.getByText("Long day.")).toBeInTheDocument();

    await click(show.getByRole("button", { name: "Weight" }));
    expect(table.queryByText("Long day.")).toBeNull();
    expect(table.getByText("Change")).toBeInTheDocument();
    // Weight began above 175, so the goal is 175 or less.
    expect(table.getByText("−1.6")).toBeInTheDocument();
    expect(table.getByText("−2.2")).toBeInTheDocument();
    expect(table.getAllByText("At goal")).toHaveLength(2);
    expect(table.getByText("1.2 over")).toBeInTheDocument();

    await click(show.getByRole("button", { name: "All" }));
    expect(table.getByText("Long day.")).toBeInTheDocument();
  });

  it("slides one highlight to the pressed entry filter, across wrapped lines", async () => {
    const w = await native.saveTracker({ name: "Weight", kind: "number", unit: "lb" });
    const j = await native.saveTracker({ name: "Journal", kind: "text" });
    // jsdom has no layout: Journal wraps onto the second line.
    const POS: Record<string, [number, number, number]> = { all: [14, 10, 40], [String(w.id)]: [60, 10, 70], [String(j.id)]: [14, 42, 72] };
    const saved: Record<string, PropertyDescriptor | undefined> = {};
    const props = { offsetLeft: 0, offsetTop: 1, offsetWidth: 2 } as const;
    for (const [prop, i] of Object.entries(props)) {
      saved[prop] = Object.getOwnPropertyDescriptor(HTMLElement.prototype, prop);
      Object.defineProperty(HTMLElement.prototype, prop, {
        configurable: true,
        get(this: HTMLElement) {
          return POS[this.getAttribute("data-indicator-item") ?? ""]?.[i] ?? 0;
        },
      });
    }
    try {
      setReducedMotion(false);
      render(<TrackersPage />);
      await click(await screen.findByRole("button", { name: "Table" }));
      const row = screen.getByRole("group", { name: "Show entries for" });
      const mark = row.querySelector<HTMLElement>("[data-indicator]")!;
      const at = () => [Number(gsap.getProperty(mark, "x")), Number(gsap.getProperty(mark, "y")), parseFloat(String(gsap.getProperty(mark, "width")))];
      expect(gsap.isTweening(mark)).toBe(false);
      expect(at()).toEqual(POS.all);
      expect(mark.className).toContain("border-check-line");

      await click(within(row).getByRole("button", { name: "Journal" }));
      const tweens = gsap.getTweensOf(mark);
      expect(tweens.length).toBeGreaterThan(0);
      act(() => tweens.forEach((t) => t.progress(1)));
      expect(at()).toEqual(POS[String(j.id)]);
      expect(within(row).getByRole("button", { name: "Journal" })).toHaveClass("border-transparent");

      setReducedMotion(true);
      await click(within(row).getByRole("button", { name: "Weight" }));
      expect(at()).toEqual(POS[String(w.id)]);
    } finally {
      for (const [prop, d] of Object.entries(saved)) if (d) Object.defineProperty(HTMLElement.prototype, prop, d);
    }
  });

  it("draws rulers with taller second-color ticks on days at goal", async () => {
    const sleep = await native.saveTracker({ name: "Sleep", kind: "number", unit: "h", goal: 8, display: "chart" });
    const weight = await native.saveTracker({ name: "Weight", kind: "number", unit: "lb", goal: 170 });
    mockControls.history(sleep.id, [
      [3, 7],
      [2, 8.2],
      [1, 8.5],
    ]);
    mockControls.history(weight.id, [
      [5, 172],
      [1, 169.8],
    ]);
    render(<TrackersPage />);
    await click(await screen.findByRole("button", { name: "7 days" }));
    expect(screen.getByRole("button", { name: "7 days" })).toHaveAttribute("aria-pressed", "true");

    const card = within(screen.getByRole("region", { name: "Sleep" }));
    expect(card.getByText("Goal 8 h")).toBeInTheDocument();
    expect(card.getByText("2 of 3 days at goal")).toBeInTheDocument();
    const region = screen.getByRole("region", { name: "Sleep" });
    expect(region.querySelectorAll('[data-kind="goal"]')).toHaveLength(2);
    expect(region.querySelectorAll('[data-kind="major"]')).toHaveLength(5);
    expect(region.querySelector("[data-goal-tick]")).toHaveClass("bg-second");
    expect(region.querySelectorAll("[data-hit]")).toHaveLength(2);
    expect(card.getByRole("img")).toHaveAccessibleName(/Sleep from .*, latest 8.5 h, goal 8 h, 2 of 3 days at goal/);

    // Weight started above its goal, so at goal means at or under it.
    const w = within(screen.getByRole("region", { name: "Weight" }));
    expect(w.getByText("Goal 170 lb or less")).toBeInTheDocument();
    expect(w.getByText("1 of 2 days at goal")).toBeInTheDocument();
  });

  it("rolls the figure and grows today's tick when a logged entry reaches the goal", async () => {
    setReducedMotion(false);
    const sleep = await native.saveTracker({ name: "Sleep", kind: "number", unit: "h", goal: 8, display: "chart" });
    mockControls.history(sleep.id, [[1, 7]]);
    render(<TrackersPage />);
    await click(await screen.findByRole("button", { name: "7 days" }));
    const region = screen.getByRole("region", { name: "Sleep" });
    expect(region.querySelector('[data-xt="last"]')).toHaveAttribute("data-kind", "major"); // nothing today yet: a plain tick
    expect(moment("tracker-goal")).toBeUndefined();

    await act(async () => void (await useTrackers.getState().log([{ trackerId: sleep.id, value: 8.4 }])));
    expect(within(region).getByText("8.4")).toBeInTheDocument();
    expect(moment("odometer")).toBeDefined();
    const tick = region.querySelector<HTMLElement>('[data-xt="last"]')!;
    expect(tick).toHaveAttribute("data-kind", "goal");
    // It waits for the roll, then grows from a plain tick's height to the full one.
    seek("tracker-goal", DUR.glide * 0.75);
    expect(Number(gsap.getProperty(tick, "scaleY"))).toBeCloseTo(8 / 11);
    finish("tracker-goal");
    expect(tick.style.transform).toBe("");
  });

  it("lands on the full tick at once under reduced motion", async () => {
    const sleep = await native.saveTracker({ name: "Sleep", kind: "number", unit: "h", goal: 8, display: "chart" });
    mockControls.history(sleep.id, [[1, 7]]);
    render(<TrackersPage />);
    await click(await screen.findByRole("button", { name: "7 days" }));
    await act(async () => void (await useTrackers.getState().log([{ trackerId: sleep.id, value: 9 }])));
    expect(moment("tracker-goal")!.progress()).toBe(1);
    expect(screen.getByRole("region", { name: "Sleep" }).querySelector<HTMLElement>('[data-xt="last"]')!.style.transform).toBe("");
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
    await click(within(dialog.getByRole("radiogroup", { name: "Mood, 1 to 10" })).getByRole("radio", { name: "7" }));
    fireEvent.change(dialog.getByLabelText("Journal"), { target: { value: "Shipped M11." } });
    await click(dialog.getByRole("button", { name: /^Log/ }));
    expect(screen.queryByRole("dialog")).toBeNull();
    const logged = useTrackers.getState().entries.filter((e) => e.source === "manual");
    expect(logged.map((e) => [e.trackerId, e.value ?? e.text])).toEqual([
      [mood.id, 7],
      [journal.id, "Shipped M11."],
    ]);
  });

  it("keeps focus inside the check-in while it's open, and gives it back on closing (H1)", async () => {
    await seed();
    render(
      <>
        <TrackersPage />
        <CheckinDialog />
      </>,
    );
    const opener = await screen.findByRole("button", { name: "Log entry" });
    opener.focus();
    await click(opener);
    const dialog = screen.getByRole("dialog", { name: "Log entry" });
    expect(dialog.contains(document.activeElement)).toBe(true);
    // Shift+Tab from the first control wraps to the last, not out to the page.
    const first = within(dialog).getByRole("button", { name: "Close" });
    first.focus();
    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(first);
    await act(async () => fireEvent.keyDown(window, { key: "Escape" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(opener).toHaveFocus();
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
    // The title leads; when it was due sits under it.
    expect(dialog.getByRole("heading", { level: 1 })).toHaveTextContent("Morning weigh-in");
    expect(dialog.getByText(/^Scheduled for/)).toHaveTextContent("Scheduled for 8:00 AM");
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

  it("shows each goal as a dashed line, answers by radio, and scrolls inside", async () => {
    const sleep = await native.saveTracker({ name: "Sleep", kind: "number", unit: "h", goal: 8 });
    const mood = await native.saveTracker({ name: "Mood", kind: "scale", goal: 7 });
    const gym = await native.saveTracker({ name: "Gym", kind: "bool" });
    mockControls.history(sleep.id, [
      [2, 7.2],
      [1, 6.8],
    ]);
    mockControls.history(mood.id, [
      [2, 6],
      [1, 7],
    ]);
    const { off } = await due({ id: 0, name: "Evening check-in", time: "21:00", daysMask: 127, trackerIds: [sleep.id, mood.id, gym.id], includeGoalReview: false });
    const dialog = await screen.findByRole("dialog", { name: "Evening check-in" });
    const d = within(dialog);
    // Sleep and Mood have goals; their sparklines draw them dashed in the second color.
    const goals = dialog.querySelectorAll("[data-spark-goal]");
    expect(goals).toHaveLength(2);
    expect(goals[0]).toHaveClass("stroke-second");
    expect(goals[0]).toHaveAttribute("stroke-dasharray", "3 3");

    // One tab stop per question; the arrows move the answer.
    const scale = d.getByRole("radiogroup", { name: "Mood, 1 to 10" });
    const radios = within(scale).getAllByRole("radio");
    expect(radios.filter((r) => r.tabIndex === 0)).toHaveLength(1);
    await click(radios[6]!);
    expect(radios[6]).toHaveAttribute("aria-checked", "true");
    await act(async () => fireEvent.keyDown(radios[6]!, { key: "ArrowRight" }));
    expect(radios[7]).toHaveAttribute("aria-checked", "true");
    expect(radios[7]).toHaveFocus();
    await click(radios[7]!); // picking it again leaves Mood blank
    expect(radios[7]).toHaveAttribute("aria-checked", "false");
    await click(within(d.getByRole("radiogroup", { name: "Gym" })).getByRole("radio", { name: "No" }));

    // The questions scroll under a fixed header, which draws a hairline once they do.
    const body = d.getByRole("region", { name: "Check-in questions" });
    const head = dialog.querySelector("[data-checkin-head]")!;
    expect(head).toHaveClass("border-transparent");
    body.scrollTop = 40;
    fireEvent.scroll(body);
    expect(head).toHaveClass("border-line");

    await click(d.getByRole("button", { name: /^Log/ }));
    const last = useTrackers.getState().entries.filter((e) => e.source === "checkin").slice(-2);
    expect(last.map((e) => [e.trackerId, e.value])).toEqual([
      [sleep.id, 6.8],
      [gym.id, 0],
    ]);
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

  it("reviews the planner day by the daily reset, not the calendar day (M14)", async () => {
    // 10:00 with the day resetting at 23:00: the planner day is still yesterday.
    const now = new Date();
    now.setHours(10, 0, 0, 0);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
    try {
      useStore.setState({ settings: { ...useStore.getState().settings, dailyResetTime: "23:00" } });
      const day = todayKey(now, "23:00");
      expect(day).not.toBe(todayKey(now));
      await native.saveTodo({ title: "From the reset day", dueDate: day, dueTime: null, durationMin: null, profileId: null });
      await native.saveTodo({ title: "From the calendar day", dueDate: todayKey(now), dueTime: null, durationMin: null, profileId: null });
      const { off } = await due({ id: 0, name: "Evening wrap-up", time: "21:30", daysMask: 127, trackerIds: [], includeGoalReview: true });
      const review = within(await screen.findByRole("region", { name: "Goal review" }));
      expect(await review.findByText("From the reset day")).toBeInTheDocument();
      expect(review.queryByText("From the calendar day")).toBeNull();
      off();
    } finally {
      vi.useRealTimers();
    }
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
