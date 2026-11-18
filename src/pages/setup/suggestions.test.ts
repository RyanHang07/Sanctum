import { DISMISS_MS, dismiss, parseDismissals, stillDismissed, suggestionChips } from "./suggestions";
import type { DistractionSuggestion } from "../../lib/types";

const DAY = 24 * 60 * 60_000;
const NOW = new Date(2026, 10, 16, 12, 0).getTime();

const list: DistractionSuggestion[] = [
  { kind: "site", value: "reddit.com", label: "reddit.com", minutes: 96 },
  { kind: "app", value: "leagueclient.exe", label: "League of Legends", minutes: 184 },
  { kind: "site", value: "youtube.com", label: "YouTube", minutes: null },
  { kind: "app", value: "youtube.exe", label: "YouTube", minutes: null },
  { kind: "site", value: "reddit.com", label: "Reddit", minutes: null },
  { kind: "site", value: "x.com", label: "X", minutes: null },
];

describe("dismissed suggestions", () => {
  it("stay away for three days", () => {
    const d = { at: NOW, minutes: 60 };
    expect(stillDismissed(d, 60, NOW + 1 * DAY)).toBe(true);
    expect(stillDismissed(d, 60, NOW + DISMISS_MS - 1)).toBe(true);
    expect(stillDismissed(d, 60, NOW + 3 * DAY)).toBe(false);
    expect(stillDismissed({ at: NOW, minutes: 0 }, null, NOW + 2 * DAY)).toBe(true);
    expect(stillDismissed(undefined, 60, NOW)).toBe(false);
  });

  it("come back sooner when time spent at least doubles and grows by 30 minutes", () => {
    const d = { at: NOW, minutes: 40 };
    expect(stillDismissed(d, 79, NOW + DAY)).toBe(true); // not double
    expect(stillDismissed(d, 80, NOW + DAY)).toBe(false); // double and +40
    // Double but only +10 minutes: a small number doubling isn't a spike.
    expect(stillDismissed({ at: NOW, minutes: 10 }, 20, NOW + DAY)).toBe(true);
    expect(stillDismissed({ at: NOW, minutes: 10 }, 40, NOW + DAY)).toBe(false);
    // A common distraction (dismissed at 0) comes back once it gets 30 minutes.
    expect(stillDismissed({ at: NOW, minutes: 0 }, 29, NOW + DAY)).toBe(true);
    expect(stillDismissed({ at: NOW, minutes: 0 }, 30, NOW + DAY)).toBe(false);
  });

  it("are saved as JSON, dropping old ones and anything unreadable", () => {
    expect(parseDismissals(null)).toEqual({});
    expect(parseDismissals("not json")).toEqual({});
    expect(parseDismissals('{"a":{"at":1,"minutes":2},"b":{"at":"x"}}')).toEqual({ a: { at: 1, minutes: 2 } });
    const old = { "site:x.com": { at: NOW - 4 * DAY, minutes: 0 } };
    expect(dismiss(old, "site:reddit.com", 96, NOW)).toEqual({ "site:reddit.com": { at: NOW, minutes: 96 } });
    expect(dismiss({}, "site:youtube.com", null, NOW)).toEqual({ "site:youtube.com": { at: NOW, minutes: 0 } });
  });
});

describe("suggestion chips", () => {
  it("put time-based ones first, most time first, then one chip per common distraction", () => {
    const chips = suggestionChips(list, {}, NOW);
    expect(chips.map((c) => c.label)).toEqual(["League of Legends", "reddit.com", "YouTube", "X"]);
    // Reddit is already suggested from the week; YouTube covers its site and its app.
    expect(chips[2]!.items.map((i) => i.value)).toEqual(["youtube.com", "youtube.exe"]);
    expect(chips[0]).toMatchObject({ key: "app:leagueclient.exe", minutes: 184 });
  });

  it("leave out dismissed ones until they resurface", () => {
    const dismissed = { "app:leagueclient.exe": { at: NOW, minutes: 184 }, "site:youtube.com": { at: NOW - 4 * DAY, minutes: 0 } };
    expect(suggestionChips(list, dismissed, NOW).map((c) => c.label)).toEqual(["reddit.com", "YouTube", "X"]);
    const spiked = list.map((s) => (s.value === "leagueclient.exe" ? { ...s, minutes: 400 } : s));
    expect(suggestionChips(spiked, dismissed, NOW).map((c) => c.label)).toContain("League of Legends");
  });
});
