import { readFileSync } from "node:fs";
import {
  AT_RISK,
  FINISHING,
  FIRST,
  GOAL_CROSSED,
  GOAL_MET_TODAY,
  HEADLINE,
  HELD,
  ONBOARDING,
  OPEN,
  OPEN_BY_HOUR,
  OVERLAY,
  OVERLAY_ENDING,
  PARK,
  PARK_LINES,
  PAUSE,
  SEALED,
  WELCOME,
  heldLine,
  homeHeadline,
  homeLine,
  overlayLine,
  pauseHeadline,
  pick,
  welcome,
  welcomeLine,
  type HeldContext,
} from "./headlines";

const at = (h: number, day = 1) => new Date(2026, 9, day, h, 0);

/** One plain sentence: ends in a full stop, no second sentence inside, never a question. */
const oneSentence = (s: string) => /^[^.?!]*[^\s.?!][^.?!]*\.$/.test(s.replace(/“[^”]*”/g, "x")) && !s.includes("?");

describe("headlines are one plain sentence (2026-11-15 headline rule)", () => {
  const filled = (f: string | ((...a: string[]) => string)) => (typeof f === "function" ? f("Discord", "10:50 AM") : f);
  const all = [
    ...OPEN,
    ...OPEN_BY_HOUR.map((p) => p.line),
    ...GOAL_MET_TODAY,
    ...AT_RISK,
    ...SEALED,
    ...FINISHING,
    ...PARK_LINES,
    ...WELCOME,
    ...PAUSE.map((l) => l.replaceAll("{site}", "Discord")),
    ...Object.values(HEADLINE).map(filled),
    ...Object.values(ONBOARDING).map(filled),
  ];

  it.each(all)("%s", (line) => {
    expect(oneSentence(line)).toBe(true);
  });

  it("gives old two-part markup the whole sentence and an empty payoff", () => {
    expect(homeHeadline("sealed", undefined, at(9))).toEqual([homeLine("sealed", undefined, at(9)), ""]);
    expect(welcomeLine(3)).toEqual([welcome(3), ""]);
    expect(PARK.map(([a, b]) => `${a}${b}`)).toEqual(PARK_LINES);
  });

  it("asks nothing on a pause: the site goes into a statement", () => {
    expect(PAUSE.map((l) => l.replaceAll("{site}", "youtube.com"))).toContain(pauseHeadline("youtube.com", 4));
    expect(pauseHeadline("youtube.com", 4)).not.toMatch(/\?|\{site\}/);
  });

  it("matches the extension's sealed page, which can't import this module", () => {
    const blocked = readFileSync("extension/blocked.js", "utf8");
    for (const line of PAUSE) expect(blocked).toContain(JSON.stringify(line));
    expect(blocked).not.toMatch(/createElement\("em"\)/);
    expect(blocked).not.toMatch(/headline\(`Still want/);
    expect(readFileSync("extension/blocked.css", "utf8")).not.toMatch(/h1 em|--font-serif/);
  });
});

describe("moment lines (v0.1)", () => {
  it("holds one headline all day, and the part of the day joins Open's choices", () => {
    expect(homeLine("open", undefined, at(14))).toBe(homeLine("open", undefined, new Date(2026, 9, 1, 16, 59)));
    expect(homeLine("sealed", undefined, at(9))).toBe(homeLine("sealed", undefined, at(20)));
    const choices = (h: number) => [...OPEN, OPEN_BY_HOUR[h]!.line];
    expect(choices(0)).toContain(homeLine("open", undefined, at(7)));
    expect(choices(3)).toContain(homeLine("open", undefined, new Date(2026, 9, 2, 1, 30)));
  });

  it("varies across days", () => {
    const days = Array.from({ length: 20 }, (_, i) => homeLine("sealed", undefined, at(10, i + 1)));
    expect(new Set(days).size).toBeGreaterThan(2);
    expect(days.every((d) => SEALED.includes(d))).toBe(true);
  });

  it("is the event itself while in one", () => {
    expect(homeLine("event", { title: "Design review", until: "10:39 AM" }, at(10))).toBe("Design review until 10:39 AM.");
  });

  const base: HeldContext = { sessionId: 7, broken: false, attempts: 1, focusMinutes: 60, todayMinutes: 90, goalMinutes: 120, streak: 3 };

  it("says what the session did when it's worth saying", () => {
    expect(FIRST).toContain(heldLine({ ...base, todayMinutes: 60 }));
    expect(heldLine({ ...base, todayMinutes: 150 })).toBe("3 days running.");
    expect(GOAL_CROSSED).toContain(heldLine({ ...base, todayMinutes: 150, streak: 1 }));
    expect(heldLine({ ...base, attempts: 4 })).toBe("Tempted 4 times. Held anyway.");
    expect(heldLine({ ...base, broken: true, todayMinutes: 150 })).toMatch(/streak resets|downtime/);
    // Never scolding (v0.3.1).
    expect(heldLine({ ...base, broken: true, todayMinutes: 150 })).not.toMatch(/letting go|distraction/);
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
    // The end in sight comes first, then repeat tries.
    expect(OVERLAY_ENDING).toContain(overlayLine(seed, "11:20 AM", { attempts: 5, remainingMs: 4 * 60_000 }));
    expect(overlayLine(seed, "11:20 AM", { attempts: 4, remainingMs: 40 * 60_000 })).toMatch(/4/);
    expect(overlayLine(seed, "11:20 AM", { attempts: 2, remainingMs: 40 * 60_000 })).toBe("It’ll still be there at 11:20 AM.");
    // Home says what's true today before a general line.
    const at9 = new Date(2026, 9, 1, 9);
    expect(GOAL_MET_TODAY).toContain(homeLine("open", undefined, at9, { goalMet: true, atRisk: true }));
    expect(AT_RISK).toContain(homeLine("open", undefined, at9, { atRisk: true }));
    expect(FINISHING).toContain(homeLine("sealed", undefined, at9, { finishing: true }));
  });
});
