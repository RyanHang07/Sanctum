import { dayStatus, rangeOf, rangeTitle, shade, shiftRange, streaks, temptedLabel } from "./stats";

// Mirrors the Rust tests in src-tauri/src/stats.rs.

describe("streak rules", () => {
  it("keeps a day only at the goal with no broken seal", () => {
    expect(dayStatus(130, false, false, 120, -1, false)).toBe("kept");
    expect(dayStatus(90, false, false, 120, -1, false)).toBe("missed");
    expect(dayStatus(200, true, false, 120, -1, false)).toBe("broken");
    expect(dayStatus(0, false, true, 120, -1, false)).toBe("rest");
    expect(dayStatus(30, false, false, 120, 0, false)).toBe("today");
    expect(dayStatus(0, false, false, 120, -1, true)).toBe("none");
    expect(dayStatus(0, false, false, 120, 1, false)).toBe("future");
  });

  it("counts kept and rest days, resets on missed or broken", () => {
    expect(streaks(["none", "kept", "kept", "rest", "kept", "today"])).toEqual([4, 4]);
    expect(streaks(["kept", "kept", "kept", "missed", "kept", "today"])).toEqual([1, 3]);
    expect(streaks(["kept", "broken", "kept", "kept"])).toEqual([2, 2]);
  });
});

describe("ranges", () => {
  it("covers a Monday-first week and whole weeks of a month", () => {
    expect(rangeOf("week", "2026-09-30")).toEqual({ from: "2026-09-28", to: "2026-10-04" });
    // September 2026 starts on a Tuesday and ends on a Wednesday.
    expect(rangeOf("month", "2026-09-15")).toEqual({ from: "2026-08-31", to: "2026-10-04" });
    expect(shiftRange("week", "2026-09-30", -1)).toBe("2026-09-23");
    expect(shiftRange("month", "2026-09-30", 1)).toBe("2026-10-01");
  });

  it("names the range", () => {
    expect(rangeTitle("week", "2026-09-16")).toBe("Sep 14 – 20");
    expect(rangeTitle("week", "2026-09-30")).toBe("Sep 28 – Oct 4");
    expect(rangeTitle("month", "2026-09-30")).toBe("September 2026");
  });

  it("shades kept days by focus against the goal", () => {
    expect(shade(120, 120)).toBe(2);
    expect(shade(170, 120)).toBe(3);
    expect(shade(60, 120)).toBe(1);
  });

  it("names what tempted you", () => {
    expect(temptedLabel("discord.exe")).toBe("Discord");
    expect(temptedLabel("leagueclient.exe", [{ exe: "leagueclient.exe", name: "League of Legends" }])).toBe("League of Legends");
    expect(temptedLabel("youtube.com")).toBe("youtube.com");
  });
});
