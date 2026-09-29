import {
  EVERY_DAY,
  WEEKDAYS_MASK,
  addDays,
  agendaFor,
  daysLabel,
  dayOf,
  longTime,
  shortTime,
  snapMinutes,
  suggestFocus,
  todayKey,
  weekKeys,
  weekStart,
} from "./planner";
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
