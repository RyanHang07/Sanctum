import { currentMeeting, eventItems, focusTagText, meetingLabels, profileSlug, readFocusTag, syncedAgo, writeFocusTag } from "./calendar";
import { agendaFor, fromKey, suggestFocus } from "./planner";
import type { CalEvent } from "./types";

const profiles = [
  { id: 1, name: "Interview Prep" },
  { id: 2, name: "Deep Work" },
];

function ev(p: Partial<CalEvent> & Pick<CalEvent, "eventId" | "title" | "date">): CalEvent {
  const time = p.time === undefined ? "10:00" : p.time;
  const durationMin = p.durationMin ?? (time ? 60 : null);
  const startMs = time ? fromKey(p.date).getTime() + (Number(time.slice(0, 2)) * 60 + Number(time.slice(3))) * 60_000 : fromKey(p.date).getTime();
  return {
    calendarId: "me",
    calendarName: "Personal",
    endDate: p.date,
    time,
    durationMin,
    startMs,
    endMs: startMs + (durationMin ?? 24 * 60) * 60_000,
    allDay: !time,
    attendees: 0,
    recurring: false,
    htmlLink: null,
    writable: true,
    ...p,
  };
}

describe("focus tags", () => {
  it("reads #focus and #focus:<profile> from a title", () => {
    expect(readFocusTag("Mock interview #focus:interview-prep", profiles)).toEqual({ title: "Mock interview", tagged: true, profileId: 1 });
    expect(readFocusTag("#focus:DeepWork write-up", profiles)).toEqual({ title: "write-up", tagged: true, profileId: 2 });
    // A bare tag uses the profile picked on Home.
    expect(readFocusTag("Deep work #focus", profiles, 2)).toEqual({ title: "Deep work", tagged: true, profileId: 2 });
    expect(readFocusTag("Standup", profiles)).toEqual({ title: "Standup", tagged: false, profileId: null });
    expect(readFocusTag("#focusing on it", profiles).tagged).toBe(false);
    expect(readFocusTag("Thing #focus:unknown", profiles)).toMatchObject({ tagged: true, profileId: null });
  });

  it("writes and removes the tag", () => {
    expect(profileSlug("Interview Prep")).toBe("interview-prep");
    expect(writeFocusTag("Mock interview", profiles[0]!)).toBe("Mock interview #focus:interview-prep");
    expect(writeFocusTag("Mock interview #focus:deep-work", profiles[0]!)).toBe("Mock interview #focus:interview-prep");
    expect(writeFocusTag("Mock interview #focus", null)).toBe("Mock interview");
    expect(focusTagText("Deep work #focus")).toBe("#focus");
    expect(focusTagText("Deep work")).toBeNull();
  });
});

describe("events in the agenda", () => {
  const days = ["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01"];

  it("places events on each day they cover and tags focus blocks", () => {
    const events = [
      ev({ eventId: "a", title: "Deep work #focus:deep-work", date: "2026-09-29", time: "14:00", durationMin: 90 }),
      ev({ eventId: "b", title: "Offsite", date: "2026-09-30", endDate: "2026-10-01", time: null }),
      ev({ eventId: "c", title: "Write", date: "2026-09-28", calendarName: "Focus" }),
      ev({ eventId: "d", title: "Red-eye", date: "2026-09-28", endDate: "2026-09-29", time: "23:00", durationMin: 300 }),
    ];
    const items = eventItems(days, events, profiles, 1);
    expect(items["2026-09-29"]!.map((i) => [i.title, i.time, i.profileId])).toEqual([
      ["Deep work", "14:00", 2],
      // The second day of an overnight event reads as all-day and isn't a focus block.
      ["Red-eye", null, null],
    ]);
    expect(items["2026-09-30"]!.map((i) => i.title)).toEqual(["Offsite"]);
    expect(items["2026-10-01"]!.map((i) => i.title)).toEqual(["Offsite"]);
    // A calendar named "Focus" counts as tagged, with the Home profile.
    expect(items["2026-09-28"]!.find((i) => i.title === "Write")!.profileId).toBe(1);
    expect(items["2026-09-29"]![0]!.key).toBe("event:me:a:2026-09-29");
  });

  it("sorts all-day events first, then everything by time", () => {
    const extra = eventItems(["2026-09-30"], [ev({ eventId: "b", title: "Offsite", date: "2026-09-30", time: null }), ev({ eventId: "s", title: "Standup", date: "2026-09-30", time: "09:30" })], profiles);
    const routine = { id: 1, title: "Gym", sort: 0, profileId: null, active: true, daysMask: 127, time: "07:00", durationMin: 60 };
    const todo = { id: 2, title: "Pay rent", dueDate: "2026-09-30", dueTime: null, durationMin: null, profileId: null, done: false, sort: 0, undated: false };
    const agenda = agendaFor(["2026-09-30"], [routine], [todo], [], extra);
    expect(agenda["2026-09-30"]!.map((i) => i.title)).toEqual(["Offsite", "Gym", "Standup", "Pay rent"]);
  });

  it("suggests a #focus event like a profile-linked routine", () => {
    const items = eventItems(["2026-09-29"], [ev({ eventId: "a", title: "Deep work #focus:deep-work", date: "2026-09-29", time: "14:00", durationMin: 90 })], profiles)["2026-09-29"]!;
    const s = suggestFocus(items, new Date(2026, 8, 29, 14, 10).getTime());
    expect(s).toMatchObject({ state: "now", profileId: 2, minutes: 75 }); // 80 min left
  });
});

describe("meetings", () => {
  const now = new Date(2026, 8, 29, 10, 20).getTime();

  it("counts only timed events with other people", () => {
    const solo = ev({ eventId: "solo", title: "Focus time", date: "2026-09-29" });
    const allDay = ev({ eventId: "day", title: "Offsite", date: "2026-09-29", time: null, attendees: 5 });
    const later = ev({ eventId: "later", title: "1:1", date: "2026-09-29", time: "15:00", attendees: 1 });
    expect(currentMeeting([solo, allDay, later], now)).toBeNull();
    const standup = ev({ eventId: "st", title: "Standup #focus", date: "2026-09-29", attendees: 3 });
    expect(currentMeeting([solo, standup], now)?.eventId).toBe("st");
    const labels = meetingLabels(standup, now);
    expect(labels).toMatchObject({ title: "Standup", left: "40m" });
    expect(labels.range).toMatch(/10:00 AM to 11:00 AM/);
  });

  it("says when it last synced", () => {
    expect(syncedAgo(null)).toBe("Not synced yet");
    expect(syncedAgo(now - 20_000, now)).toBe("Synced just now");
    expect(syncedAgo(now - 4 * 60_000, now)).toBe("Synced 4 min ago");
    expect(syncedAgo(now - 130 * 60_000, now)).toBe("Synced 2 h ago");
  });
});
