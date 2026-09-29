import { parseLength, parseQuickAdd, parseTime } from "./quickAdd";

// Tuesday, Sep 29 2026.
const TODAY = "2026-09-29";
const profiles = [
  { id: 1, name: "Interview Prep" },
  { id: 2, name: "Deep Work" },
];
const parse = (t: string) => parseQuickAdd(t, TODAY, profiles);

describe("quick add", () => {
  it("reads the example from SPEC", () => {
    expect(parse("mock interview thu 3pm")).toMatchObject({ title: "mock interview", date: "2026-10-01", time: "15:00", daysMask: null });
    expect(parse("Mock interview thu 3pm 90m @interview")).toMatchObject({ title: "Mock interview", durationMin: 90, profileId: 1 });
  });

  it("reads days", () => {
    expect(parse("call mom today").date).toBe(TODAY);
    expect(parse("call mom tomorrow").date).toBe("2026-09-30");
    expect(parse("gym tue").date).toBe(TODAY); // today is Tuesday
    expect(parse("gym mon").date).toBe("2026-10-05");
    expect(parse("review next thu").date).toBe("2026-10-08");
    expect(parse("dentist 10/3").date).toBe("2026-10-03");
    expect(parse("taxes 4/15").date).toBe("2027-04-15"); // already past this year
    expect(parse("trip 12/20/2026").date).toBe("2026-12-20");
  });

  it("reads times and lengths", () => {
    expect(["3pm", "3p", "3:30pm", "12am", "12pm", "15:00", "noon", "7am"].map(parseTime)).toEqual(["15:00", "15:00", "15:30", "00:00", "12:00", "15:00", "12:00", "07:00"]);
    expect(parseTime("13pm")).toBeNull();
    expect(["90m", "45min", "1h", "1.5h", "1h30", "2hrs"].map(parseLength)).toEqual([90, 45, 60, 90, 90, 120]);
    expect(parse("standup at 9:30am for 15 min")).toMatchObject({ title: "standup", time: "09:30", durationMin: 15 });
    expect(parse("sync at 3").time).toBe("15:00");
    expect(parse("run at 8").time).toBe("08:00");
    expect(parse("write 2 hours").durationMin).toBe(120);
  });

  it("makes routines from repeats", () => {
    expect(parse("gym every mon wed and fri 7am")).toMatchObject({ title: "gym", daysMask: 0b0101010, time: "07:00" });
    expect(parse("neetcode daily @deep")).toMatchObject({ title: "neetcode", daysMask: 127, profileId: 2 });
    expect(parse("standup weekdays 9:30am").daysMask).toBe(0b0111110);
    expect(parse("long run every weekend").daysMask).toBe(0b1000001);
  });

  it("leaves what it doesn't understand in the title", () => {
    expect(parse("read chapter 3 @nobody")).toMatchObject({ title: "read chapter 3 @nobody", profileId: null, date: null, time: null });
    expect(parse("   ").title).toBe("");
    // Only the first day word is a date.
    expect(parse("plan mon vs tue")).toMatchObject({ date: "2026-10-05", title: "plan vs tue" });
  });
});
