import { EVENT_PAYOFFS, HELD, OPEN, OVERLAY, SEALED, heldLine, homeHeadline, overlayLine, pick, welcomeLine, type HeldContext } from "./headlines";

const at = (h: number, day = 1) => new Date(2026, 9, day, h, 0);

describe("moment lines (v0.1)", () => {
  it("holds one headline all day, and the part of the day joins Open's choices", () => {
    expect(homeHeadline("open", undefined, at(14))).toEqual(homeHeadline("open", undefined, new Date(2026, 9, 1, 16, 59)));
    expect(homeHeadline("sealed", undefined, at(9))).toEqual(homeHeadline("sealed", undefined, at(20)));
    const choices = (h: number) => [...OPEN.map((l) => l.join(" ")), ["First hour, best hour. Spend it well.", "Half the day is left. Use it.", "One more block. Then rest.", "It’s late. Close the gaps, or sleep."][h]];
    expect(choices(0)).toContain(homeHeadline("open", undefined, at(7)).join(" "));
    expect(choices(3)).toContain(homeHeadline("open", undefined, new Date(2026, 9, 2, 1, 30)).join(" "));
  });

  it("varies across days", () => {
    const days = Array.from({ length: 20 }, (_, i) => homeHeadline("sealed", undefined, at(10, i + 1)).join(" "));
    expect(new Set(days).size).toBeGreaterThan(2);
    expect(days.every((d) => SEALED.some((l) => l.join(" ") === d))).toBe(true);
  });

  it("keeps the event's own words and adds a payoff", () => {
    const [lead, payoff] = homeHeadline("event", { title: "Design review", until: "10:39 AM" }, at(10));
    expect(lead).toBe("Design review until 10:39 AM.");
    expect(EVENT_PAYOFFS).toContain(payoff);
  });

  const base: HeldContext = { sessionId: 7, broken: false, attempts: 1, focusMinutes: 60, todayMinutes: 90, goalMinutes: 120, streak: 3 };

  it("says what the session did when it's worth saying", () => {
    expect(heldLine({ ...base, todayMinutes: 60 })).toBe("First one down.");
    expect(heldLine({ ...base, todayMinutes: 150 })).toBe("3 days running.");
    expect(heldLine({ ...base, todayMinutes: 150, streak: 1 })).toBe("Goal met for today, but the best never stopped here.");
    expect(heldLine({ ...base, attempts: 4 })).toBe("Tempted 4 times. Held anyway.");
    expect(heldLine({ ...base, broken: true, todayMinutes: 150 })).toMatch(/downtime|distraction/);
  });

  it("otherwise picks a general line, the same one for the same session", () => {
    expect(HELD).toContain(heldLine(base));
    expect(heldLine(base)).toBe(heldLine(base));
    expect([...HELD, "Not one slip."]).toContain(heldLine({ ...base, attempts: 0 }));
  });

  it("fills in when the seal ends on the overlay", () => {
    const i = OVERLAY.indexOf("It’ll still be there at {until}.");
    const seed = Array.from({ length: 200 }, (_, n) => n).find((n) => pick(OVERLAY, n) === OVERLAY[i])!;
    expect(overlayLine(seed, "11:20 AM")).toBe("It’ll still be there at 11:20 AM.");
    expect(welcomeLine(3)).toHaveLength(2);
  });
});
