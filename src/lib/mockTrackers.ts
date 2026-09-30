// Trackers and check-ins for the mock backend (mirrors src-tauri/src/trackers.rs closely enough
// for the UI; the Rust tests are the source of truth). There's no scheduler here: dev tools and
// tests make a check-in due with mockControls.checkinDue.
import type { Checkin, CheckinDue, NewEntry, NextCheckin, Tracker, TrackerDraft, TrackerEntry } from "./types";
import { bus } from "./bus";
import { todayKey } from "./planner";

interface TrackerState {
  trackers: Tracker[];
  entries: TrackerEntry[];
  checkins: Checkin[];
  /** "id:date" answered or skipped. */
  handled: Set<string>;
  pending: CheckinDue | null;
  nextId: number;
}

let t: TrackerState;

export function resetMockTrackers() {
  t = { trackers: [], entries: [], checkins: [], handled: new Set(), pending: null, nextId: 5000 };
}
resetMockTrackers();

const clone = <T>(v: T): T => structuredClone(v);
const today = () => todayKey(new Date(), "00:00");

function get(id: number): Tracker {
  const x = t.trackers.find((y) => y.id === id);
  if (!x) throw "That tracker no longer exists.";
  return x;
}

function clean(tr: Tracker, e: NewEntry): Pick<TrackerEntry, "value" | "text"> {
  const need = { number: "a number", bool: "yes or no", scale: "a value from 1 to 10", text: "some text" }[tr.kind];
  const bad = `${tr.name} needs ${need}.`;
  if (tr.kind === "text") {
    const s = e.text?.trim();
    if (!s) throw bad;
    return { value: null, text: s };
  }
  const v = e.value;
  if (v === null || v === undefined || !Number.isFinite(v)) throw bad;
  if (tr.kind === "bool" && v !== 0 && v !== 1) throw bad;
  if (tr.kind === "scale" && (!Number.isInteger(v) || v < 1 || v > 10)) throw bad;
  return { value: v, text: null };
}

export const trackerHandlers: Record<string, (a: any) => unknown> = {
  list_trackers: () => clone([...t.trackers].sort((a, b) => a.sort - b.sort || a.id - b.id)),
  save_tracker: ({ draft }: { draft: TrackerDraft }) => {
    const name = draft.name.trim();
    if (!name) throw "Give the tracker a name.";
    if (t.trackers.some((x) => x.id !== draft.id && x.name.toLowerCase() === name.toLowerCase())) throw `A tracker named ${name} already exists.`;
    const kind = draft.kind;
    const old = draft.id !== undefined ? get(draft.id) : null;
    if (old && old.kind !== kind && t.entries.some((e) => e.trackerId === old.id)) throw "A tracker with entries keeps its type. Make a new one instead.";
    const goal = kind === "number" ? draft.goal ?? null : kind === "scale" && draft.goal && draft.goal >= 1 && draft.goal <= 10 ? draft.goal : null;
    const next: Tracker = {
      id: old?.id ?? t.nextId++,
      sort: old?.sort ?? t.trackers.length,
      name,
      unit: kind === "number" ? (draft.unit ?? "").trim().slice(0, 12) : "",
      kind,
      display: kind === "text" ? "table" : draft.display ?? "both",
      goal,
    };
    t.trackers = [...t.trackers.filter((x) => x.id !== next.id), next];
    return clone(next);
  },
  delete_tracker: ({ id }: { id: number }) => {
    t.trackers = t.trackers.filter((x) => x.id !== id);
    t.entries = t.entries.filter((e) => e.trackerId !== id);
    for (const c of t.checkins) c.trackerIds = c.trackerIds.filter((x) => x !== id);
  },
  tracker_entries: ({ from, to }: { from: number; to: number }) =>
    clone(t.entries.filter((e) => e.loggedAt >= from && e.loggedAt < to).sort((a, b) => a.loggedAt - b.loggedAt || a.id - b.id)),
  log_entries: ({ items, checkinId }: { items: NewEntry[]; checkinId: number | null }) => {
    if (!items.length) throw "Nothing to log.";
    const now = Date.now();
    const made = items.map((e) => ({ id: 0, trackerId: e.trackerId, loggedAt: now, source: checkinId ? "checkin" : "manual", ...clean(get(e.trackerId), e) }) as TrackerEntry);
    for (const m of made) m.id = t.nextId++;
    t.entries.push(...made);
    return clone(made);
  },
  delete_tracker_entry: ({ id }: { id: number }) => {
    t.entries = t.entries.filter((e) => e.id !== id);
  },
  list_checkins_cmd: () => clone([...t.checkins].sort((a, b) => a.time.localeCompare(b.time) || a.id - b.id)),
  save_checkin_cmd: ({ checkin }: { checkin: Checkin }) => {
    const name = checkin.name.trim();
    if (!name) throw "Give the check-in a name.";
    const m = /^(\d{1,2}):(\d{2})$/.exec(checkin.time.trim());
    if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) throw `${checkin.time} is not a time.`;
    if (checkin.daysMask < 1 || checkin.daysMask > 127) throw "Pick at least one day.";
    const trackerIds = [...new Set(checkin.trackerIds)].filter((id) => t.trackers.some((x) => x.id === id));
    if (!trackerIds.length && !checkin.includeGoalReview) throw "Ask for at least one tracker, or review your goals.";
    const c: Checkin = { ...checkin, name, trackerIds, time: `${m[1]!.padStart(2, "0")}:${m[2]}`, id: checkin.id > 0 ? checkin.id : t.nextId++ };
    if (checkin.id > 0 && !t.checkins.some((x) => x.id === checkin.id)) throw "That check-in no longer exists.";
    t.checkins = [...t.checkins.filter((x) => x.id !== c.id), c];
    return clone(c);
  },
  delete_checkin_cmd: ({ id }: { id: number }) => {
    t.checkins = t.checkins.filter((c) => c.id !== id);
  },
  checkin_pending: () => clone(t.pending),
  checkin_answer: ({ id, date, outcome }: { id: number; date: string; outcome: string }) => {
    if (outcome === "logged" || outcome === "skipped") t.handled.add(`${id}:${date}`);
    if (t.pending?.checkinId === id) t.pending = null;
  },
  next_checkin: (): NextCheckin | null => {
    const now = new Date();
    const hm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    const hit = [...t.checkins]
      .filter((c) => (c.daysMask & (1 << now.getDay())) !== 0 && c.time > hm && !t.handled.has(`${c.id}:${today()}`))
      .sort((a, b) => a.time.localeCompare(b.time))[0];
    return hit ? { id: hit.id, name: hit.name, time: hit.time } : null;
  },
};

export const trackerControls = {
  /** The check-in comes due now (as the Rust loop would, outside a seal). */
  checkinDue(id: number, missed = false) {
    t.pending = { checkinId: id, scheduledAt: Date.now(), date: today(), missed };
    bus.emit("sanctum://checkin", clone(t.pending));
  },
  /** Back-dated entries for charts: [daysAgo, value | text] per tracker. */
  history(trackerId: number, points: [number, number | string][]) {
    const tr = get(trackerId);
    for (const [ago, v] of points) {
      t.entries.push({
        id: t.nextId++,
        trackerId,
        loggedAt: Date.now() - ago * 86_400_000,
        source: "checkin",
        value: tr.kind === "text" ? null : Number(v),
        text: tr.kind === "text" ? String(v) : null,
      });
    }
  },
};
