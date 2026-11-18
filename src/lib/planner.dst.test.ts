// Daylight-saving days in a fixed zone: the planner day rolls over at the reset in wall-clock time.
// Set before any Date is made; Vitest runs each file in its own process, so other files keep theirs.
process.env.TZ = "America/Los_Angeles";

import { describe, expect, it } from "vitest";
import { dayBounds, msUntilReset, todayKey } from "./planner";

const HOUR = 3_600_000;

describe("planner day across daylight saving (America/Los_Angeles)", () => {
  it("runs in the zone it asks for", () => {
    expect(new Date(2026, 0, 15, 12).getTimezoneOffset()).toBe(480);
    expect(new Date(2026, 6, 15, 12).getTimezoneOffset()).toBe(420);
  });

  // 2026-03-08: 2:00 AM jumps to 3:00 AM.
  it("rolls over at 4:00 wall time on the spring-forward day", () => {
    expect(todayKey(new Date(2026, 2, 8, 3, 59))).toBe("2026-03-07");
    expect(todayKey(new Date(2026, 2, 8, 4, 0))).toBe("2026-03-08");
    expect(todayKey(new Date(2026, 2, 8, 4, 30))).toBe("2026-03-08");
    const [start, end] = dayBounds("2026-03-07");
    expect(end - start).toBe(23 * HOUR);
    expect(end).toBe(new Date(2026, 2, 8, 4, 0).getTime());
  });

  // 2026-11-01: 2:00 AM falls back to 1:00 AM.
  it("rolls over at 4:00 wall time on the fall-back day", () => {
    expect(todayKey(new Date(2026, 10, 1, 3, 30))).toBe("2026-10-31");
    expect(todayKey(new Date(2026, 10, 1, 4, 0))).toBe("2026-11-01");
    const [start, end] = dayBounds("2026-10-31");
    expect(end - start).toBe(25 * HOUR);
    expect(end).toBe(new Date(2026, 10, 1, 4, 0).getTime());
  });

  it("agrees with msUntilReset and dayBounds on both transitions", () => {
    for (const now of [new Date(2026, 2, 7, 22, 0), new Date(2026, 9, 31, 22, 0)]) {
      const at = now.getTime() + msUntilReset(now);
      const before = todayKey(new Date(at - 1));
      expect(before).toBe(todayKey(now));
      expect(todayKey(new Date(at))).not.toBe(before);
      expect(dayBounds(before)[1]).toBe(at);
    }
  });

  it("keeps a custom reset on wall time", () => {
    expect(todayKey(new Date(2026, 2, 8, 5, 59), "06:00")).toBe("2026-03-07");
    expect(todayKey(new Date(2026, 2, 8, 6, 0), "06:00")).toBe("2026-03-08");
    expect(todayKey(new Date(2026, 10, 1, 5, 59), "06:00")).toBe("2026-10-31");
    expect(todayKey(new Date(2026, 10, 1, 6, 0), "06:00")).toBe("2026-11-01");
  });
});
