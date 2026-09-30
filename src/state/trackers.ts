import { create } from "zustand";
import { errorText, native } from "../lib/native";
import type { Checkin, CheckinDue, NewEntry, NextCheckin, Tracker, TrackerDraft, TrackerEntry } from "../lib/types";
import { useStore } from "./store";

// Trackers, check-ins, and the check-in dialog (SPEC 4.13). Entries are small, so all of them
// load at once; the page filters by range.

/** What the check-in dialog is showing: a scheduled check-in, or Log entry for any tracker. */
export type CheckinPrompt = { kind: "scheduled"; due: CheckinDue; checkin: Checkin } | { kind: "manual" };

export interface TrackersStore {
  trackers: Tracker[];
  checkins: Checkin[];
  entries: TrackerEntry[];
  loaded: boolean;
  prompt: CheckinPrompt | null;
  next: NextCheckin | null;

  load: () => Promise<void>;
  saveTracker: (d: TrackerDraft) => Promise<Tracker | null>;
  deleteTracker: (id: number) => Promise<boolean>;
  saveCheckin: (c: Checkin) => Promise<Checkin | null>;
  deleteCheckin: (id: number) => Promise<boolean>;
  /** Logs values; returns false (with a notice) when refused. */
  log: (items: NewEntry[], checkinId?: number | null) => Promise<boolean>;
  deleteEntry: (id: number) => Promise<void>;
  openLog: () => void;
  /** A check-in came due. Ignored while sealed: Rust queues it until the seal ends. */
  showDue: (due: CheckinDue) => Promise<void>;
  /** Asks Rust whether one is due (startup, and when a seal ends). */
  checkPending: () => Promise<void>;
  /** Closes the dialog: logged or skipped for today, or snoozed 15 minutes. */
  answer: (outcome: "logged" | "skipped" | "snoozed") => Promise<void>;
  refreshNext: () => Promise<void>;
}

async function attempt<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (e) {
    useStore.getState().showNotice({ lead: errorText(e) });
    return null;
  }
}

const bySort = (a: Tracker, b: Tracker) => a.sort - b.sort || a.id - b.id;

export const useTrackers = create<TrackersStore>()((set, get) => ({
  trackers: [],
  checkins: [],
  entries: [],
  loaded: false,
  prompt: null,
  next: null,

  load: async () => {
    const [trackers, checkins, entries] = await Promise.all([
      native.listTrackers(),
      native.listCheckins(),
      native.trackerEntries(0, Date.now() + 86_400_000),
    ]).catch(() => [[], [], []] as [Tracker[], Checkin[], TrackerEntry[]]);
    set({ trackers, checkins, entries, loaded: true });
    void get().refreshNext();
  },

  saveTracker: async (d) => {
    const t = await attempt(() => native.saveTracker(d));
    if (t) set({ trackers: [...get().trackers.filter((x) => x.id !== t.id), t].sort(bySort) });
    return t;
  },

  deleteTracker: async (id) => {
    const ok = await attempt(() => native.deleteTracker(id).then(() => true));
    if (ok) {
      set({
        trackers: get().trackers.filter((t) => t.id !== id),
        entries: get().entries.filter((e) => e.trackerId !== id),
        checkins: get().checkins.map((c) => ({ ...c, trackerIds: c.trackerIds.filter((x) => x !== id) })),
      });
    }
    return !!ok;
  },

  saveCheckin: async (c) => {
    const saved = await attempt(() => native.saveCheckin(c));
    if (saved) {
      set({ checkins: [...get().checkins.filter((x) => x.id !== saved.id), saved].sort((a, b) => a.time.localeCompare(b.time) || a.id - b.id) });
      void get().refreshNext();
    }
    return saved;
  },

  deleteCheckin: async (id) => {
    const ok = await attempt(() => native.deleteCheckin(id).then(() => true));
    if (ok) {
      set({ checkins: get().checkins.filter((c) => c.id !== id) });
      void get().refreshNext();
    }
    return !!ok;
  },

  log: async (items, checkinId = null) => {
    const made = await attempt(() => native.logEntries(items, checkinId));
    if (made) set({ entries: [...get().entries, ...made] });
    return !!made;
  },

  deleteEntry: async (id) => {
    const ok = await attempt(() => native.deleteTrackerEntry(id).then(() => true));
    if (ok) set({ entries: get().entries.filter((e) => e.id !== id) });
  },

  openLog: () => set({ prompt: { kind: "manual" } }),

  showDue: async (due) => {
    if (useStore.getState().appState === "sealed") return;
    if (!get().loaded) await get().load();
    const checkin = get().checkins.find((c) => c.id === due.checkinId);
    if (checkin) set({ prompt: { kind: "scheduled", due, checkin } });
  },

  checkPending: async () => {
    const due = await native.checkinPending().catch(() => null);
    if (due) await get().showDue(due);
  },

  answer: async (outcome) => {
    const p = get().prompt;
    set({ prompt: null });
    if (p?.kind !== "scheduled") return;
    await attempt(() => native.checkinAnswer(p.checkin.id, p.due.date, outcome));
    void get().refreshNext();
  },

  refreshNext: async () => {
    set({ next: await native.nextCheckin().catch(() => null) });
  },
}));

// App-wide state: hot-swapping this module would split it into two copies. Reload instead.
import.meta.hot?.accept(() => window.location.reload());
