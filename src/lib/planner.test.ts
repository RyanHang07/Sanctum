import {
  EVERY_DAY,
  WEEKDAYS_MASK,
  addDays,
  agendaFor,
  daysLabel,
  dayOf,
  longTime,
  moveId,
  openFirst,
  pendingFor,
  shortTime,
  snapMinutes,
  suggestFocus,
  todayKey,
  weekKeys,
  weekStart,
} from "./planner";
import { addMonths, monthGrid } from "./planner";
import type { Routine, Todo } from "./types";

const routine = (id: number, title: string, daysMask: number, time: string | null, extra: Partial<Routine> = {}): Routine => ({
  id,
  title,
  sort: id,
  profileId: null,
  active: true,
  daysMask,
  time,
  durationMin: null,
  ...extra,
});

const todo = (id: number, title: string, dueDate: string, dueTime: string | null, extra: Partial<Todo> = {}): Todo => ({
  id,
  title,
  dueDate,
  dueTime,
  durationMin: null,
  profileId: null,
  done: false,
  sort: id,
  undated: false,
  ...extra,
});

describe("dates", () => {
  it("steps days and weeks (Monday first)", () => {
    expect(addDays("2026-09-30", 2)).toBe("2026-10-02");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(dayOf("2026-09-29")).toBe(2); // Tuesday
    expect(weekStart("2026-10-04")).toBe("2026-09-28"); // Sunday belongs to the week before
    expect(weekKeys("2026-09-28")).toEqual(["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"]);
  });

  it("keeps late nights on the day you started", () => {
    expect(todayKey(new Date(2026, 8, 30, 1, 30))).toBe("2026-09-29");
    expect(todayKey(new Date(2026, 8, 30, 4, 0))).toBe("2026-09-30");
    expect(todayKey(new Date(2026, 8, 30, 5, 0), "06:00")).toBe("2026-09-29");
  });

  it("formats times and days", () => {
    expect([shortTime("08:00"), shortTime("16:30"), shortTime("00:05"), shortTime("12:00")]).toEqual(["8:00a", "4:30p", "12:05a", "12:00p"]);
    expect(longTime("14:00")).toBe("2:00 PM");
    expect(daysLabel(EVERY_DAY)).toBe("Every day");
    expect(daysLabel(WEEKDAYS_MASK)).toBe("Weekdays");
    expect(daysLabel(0b1000001)).toBe("Weekends");
    expect(daysLabel(0b0101010)).toBe("Mon Wed Fri");
  });
});

describe("agenda", () => {
  it("puts routines on their days, merges one-time items, and orders by time", () => {
    const routines = [
      routine(1, "Gym", 0b0101010, "07:00"), // Mon Wed Fri
      routine(2, "NeetCode daily", EVERY_DAY, null),
      routine(3, "Weigh-in", 0b0010010, "08:00"), // Mon Thu
      routine(4, "Paused", EVERY_DAY, null, { active: false }),
    ];
    const todos = [todo(10, "Mock interview", "2026-09-28", "14:00"), todo(11, "Pay rent", "2026-09-28", null)];
    const a = agendaFor(["2026-09-28", "2026-09-29"], routines, todos, [{ routineId: 3, date: "2026-09-28" }]);
    expect(a["2026-09-28"]!.map((i) => [i.title, i.done])).toEqual([
      ["Gym", false],
      ["Weigh-in", true],
      ["Mock interview", false],
      ["NeetCode daily", false],
      ["Pay rent", false],
    ]);
    expect(a["2026-09-29"]!.map((i) => i.title)).toEqual(["NeetCode daily"]);
    expect(a["2026-09-28"]![0]!.key).toBe("routine:1:2026-09-28");
  });
});

describe("schedule-driven focus", () => {
  const day = "2026-09-29";
  const at = (h: number, m = 0) => new Date(2026, 8, 29, h, m).getTime();
  const items = agendaFor(
    [day],
    [
      routine(1, "Work session: SQL + DSA", WEEKDAYS_MASK, "10:00", { profileId: 7, durationMin: 60 }),
      routine(2, "Gym", EVERY_DAY, "07:00"), // no profile: never suggested
    ],
    [todo(5, "System design reading", day, "16:00", { profileId: 8, durationMin: 90 })],
    [],
  )[day]!;

  it("snaps lengths to 30/60/90/120", () => {
    expect([10, 30, 44, 45, 50, 75, 100, 200].map(snapMinutes)).toEqual([30, 30, 30, 60, 60, 90, 90, 120]);
  });

  it("suggests the next block with its planned length", () => {
    const s = suggestFocus(items, at(8, 30))!;
    expect([s.state, s.item.title, s.profileId, s.minutes]).toEqual(["next", "Work session: SQL + DSA", 7, 60]);
  });

  it("during a block, suggests it with the time left", () => {
    const s = suggestFocus(items, at(10, 25))!;
    expect([s.state, s.minutes]).toEqual(["now", 30]); // 35 min left
    expect(suggestFocus(items, at(10, 5))!.minutes).toBe(60); // 55 min left
  });

  it("moves on once a block is over or done", () => {
    expect(suggestFocus(items, at(11, 0))!.item.title).toBe("System design reading");
    const done = items.map((i) => (i.title.startsWith("Work") ? { ...i, done: true } : i));
    expect(suggestFocus(done, at(10, 30))!.item.title).toBe("System design reading");
    expect(suggestFocus(items, at(18, 0))).toBeNull();
  });
});

describe("order (v0.1)", () => {
  const day = "2026-10-01";
  const list = agendaFor(
    [day],
    [routine(1, "Read", EVERY_DAY, null, { sort: 2 }), routine(2, "Stretch", EVERY_DAY, null, { sort: 0 }), routine(3, "Plan", EVERY_DAY, "09:00")],
    [todo(4, "Pay rent", day, null, { sort: 1 }), todo(5, "Call mom", day, null, { sort: 0, done: true }), todo(6, "Dentist", day, "08:00")],
    [],
  )[day]!;

  it("runs timed items by time, then untimed ones in their drag order", () => {
    expect(list.map((i) => i.title)).toEqual(["Dentist", "Plan", "Stretch", "Read", "Call mom", "Pay rent"]);
  });

  it("sinks checked-off items to the bottom, keeping both groups in order", () => {
    expect(openFirst(list).map((i) => i.title)).toEqual(["Dentist", "Plan", "Stretch", "Read", "Pay rent", "Call mom"]);
  });

  it("moves an id before or after another", () => {
    expect(moveId([1, 2, 3, 4], 4, 2, false)).toEqual([1, 4, 2, 3]);
    expect(moveId([1, 2, 3, 4], 1, 3, true)).toEqual([2, 3, 1, 4]);
    expect(moveId([1, 2, 3], 2, 2, true)).toEqual([1, 2, 3]);
  });

  it("prefers what belongs to the day over a routine at the same time", () => {
    const items = agendaFor(
      [day],
      [routine(1, "Deep work", EVERY_DAY, "10:00", { profileId: 7, durationMin: 90 })],
      [todo(2, "Design review prep", day, "10:00", { profileId: 8, durationMin: 60 })],
      [],
    )[day]!;
    const at = (h: number, m: number) => new Date(2026, 9, 1, h, m).getTime();
    expect(suggestFocus(items, at(9, 30))!.item.title).toBe("Design review prep");
    expect(suggestFocus(items, at(10, 15))!.item.title).toBe("Design review prep");
    // Once the item ends, the routine still running takes over.
    expect(suggestFocus(items, at(11, 5))!.item.title).toBe("Deep work");
  });
});

describe("pending (v0.1)", () => {
  const today = "2026-10-01"; // Thursday; the week starts Sep 28
  const all = [
    todo(1, "Book flights", "2026-09-28", null, { undated: true }),
    todo(2, "Old parked", "2026-09-21", null, { undated: true }),
    todo(3, "Overdue", "2026-09-29", null),
    todo(4, "Next week", "2026-10-05", null, { undated: true }),
    todo(5, "Today's", today, null),
    todo(6, "Done parked", "2026-09-28", null, { undated: true, done: true }),
  ];

  it("this week: parked items, plus anything still open from before", () => {
    expect(pendingFor("2026-09-28", today, all).map((t) => t.title)).toEqual(["Old parked", "Book flights", "Overdue"]);
  });

  it("another week: only what's parked on it", () => {
    expect(pendingFor("2026-10-05", today, all).map((t) => t.title)).toEqual(["Next week"]);
  });

  it("keeps parked items off their Monday", () => {
    expect(agendaFor(["2026-09-28"], [], all, [])["2026-09-28"]).toEqual([]);
  });
});

describe("month grid", () => {
  it("covers whole Monday-first weeks around the month", () => {
    expect(addMonths("2026-09-29", 0)).toBe("2026-09-01");
    expect(addMonths("2026-12-15", 1)).toBe("2027-01-01");
    expect(addMonths("2026-01-31", -1)).toBe("2025-12-01");
    const sep = monthGrid("2026-09-01");
    expect([sep[0], sep[sep.length - 1], sep.length]).toEqual(["2026-08-31", "2026-10-04", 35]);
    // February 2027 starts on a Monday and fits in exactly 4 weeks.
    const feb = monthGrid("2027-02-01");
    expect([feb[0], feb.length]).toEqual(["2027-02-01", 28]);
    expect(monthGrid("2026-08-01").length).toBe(42);
  });
});
