import { useMemo } from "react";
import { create } from "zustand";
import { errorText, native } from "../lib/native";
import { agendaFor, type AgendaItem } from "../lib/planner";
import { eventItems } from "../lib/calendar";
import type { CalEvent, EventDraft, GcalCalendar, GcalStatus } from "../lib/types";
import { usePlanner } from "./planner";
import { useStore } from "./store";

// Google Calendar (SPEC 4.3): connection status, calendars, and cached events for the
// ranges Home and Week are showing. Rust syncs in the background and emits sanctum://gcal.

export interface CalendarStore {
  status: GcalStatus | null;
  calendars: GcalCalendar[];
  events: CalEvent[];
  /** Inclusive range the events cover. */
  range: [string, string] | null;

  load: () => Promise<void>;
  applyStatus: (s: GcalStatus) => void;
  ensure: (from: string, to: string) => Promise<void>;
  reloadEvents: () => Promise<void>;
  connect: () => Promise<boolean>;
  cancelConnect: () => void;
  disconnect: () => Promise<void>;
  removeCalendar: () => Promise<void>;
  setSelected: (id: string, selected: boolean) => Promise<void>;
  syncNow: () => void;
  saveEvent: (d: EventDraft) => Promise<boolean>;
  /** One occurrence, or with `series` every occurrence of its series. */
  deleteEvent: (e: CalEvent, series?: boolean) => Promise<boolean>;
}

const notice = (e: unknown) => useStore.getState().showNotice({ lead: errorText(e) });

export const useCalendar = create<CalendarStore>()((set, get) => ({
  status: null,
  calendars: [],
  events: [],
  range: null,

  load: async () => {
    try {
      const [status, calendars] = await Promise.all([native.gcalStatus(), native.gcalCalendars()]);
      set({ status, calendars });
    } catch {
      // Stays disconnected.
    }
    await get().reloadEvents();
  },

  applyStatus: (status) => {
    const was = get().status;
    set({ status });
    // Every sync and edit ends with a status event; pick up what changed.
    if (!status.syncing || !was?.connected) void get().load();
  },

  ensure: async (from, to) => {
    const r = get().range;
    if (r && r[0] <= from && r[1] >= to) return;
    set({ range: r ? [from < r[0] ? from : r[0], to > r[1] ? to : r[1]] : [from, to] });
    await get().reloadEvents();
  },

  reloadEvents: async () => {
    const r = get().range;
    if (!r) return;
    const events = await native.gcalEvents(r[0], r[1]).catch(() => [] as CalEvent[]);
    set({ events });
  },

  connect: async () => {
    try {
      set({ status: await native.gcalConnect() });
      await get().load();
      return true;
    } catch (e) {
      notice(e);
      await get().load();
      return false;
    }
  },

  cancelConnect: () => void native.gcalCancelConnect(),

  disconnect: async () => {
    try {
      set({ status: await native.gcalDisconnect(), calendars: [], events: [] });
    } catch (e) {
      notice(e);
    }
  },

  removeCalendar: async () => {
    try {
      set({ status: await native.gcalRemoveCalendar(), calendars: [], events: [] });
      useStore.getState().showNotice({ lead: "Sanctum calendar removed.", rest: "Your routines and items stay here." });
    } catch (e) {
      notice(e);
    }
  },

  setSelected: async (id, selected) => {
    set({ calendars: get().calendars.map((c) => (c.id === id ? { ...c, selected } : c)) });
    try {
      await native.gcalSetSelected(id, selected);
      await get().reloadEvents();
    } catch (e) {
      notice(e);
    }
  },

  syncNow: () => void native.gcalSyncNow(),

  saveEvent: async (d) => {
    try {
      await native.gcalSaveEvent(d);
      await get().reloadEvents();
      return true;
    } catch (e) {
      notice(e);
      return false;
    }
  },

  deleteEvent: async (e, series = false) => {
    try {
      const seriesId = series ? (e.seriesId ?? null) : null;
      await native.gcalDeleteEvent(e.calendarId, e.eventId, seriesId);
      const gone = (x: CalEvent) => x.calendarId === e.calendarId && (seriesId ? x.seriesId === seriesId : x.eventId === e.eventId);
      set({ events: get().events.filter((x) => !gone(x)) });
      return true;
    } catch (err) {
      notice(err);
      return false;
    }
  },
}));

/** Routines, one-time items, and calendar events for `dates`, outside React. */
export function agendaNow(dates: readonly string[]): Record<string, AgendaItem[]> {
  const { routines, todos, checks } = usePlanner.getState();
  const { profiles, selectedProfileId } = useStore.getState();
  return agendaFor(dates, routines, todos, checks, eventItems(dates, useCalendar.getState().events, profiles, selectedProfileId));
}

/** Same, as a hook that follows every source. */
export function useAgenda(dates: readonly string[]): Record<string, AgendaItem[]> {
  const { routines, todos, checks } = usePlanner();
  const events = useCalendar((s) => s.events);
  const profiles = useStore((s) => s.profiles);
  const fallback = useStore((s) => s.selectedProfileId);
  const key = dates.join(",");
  return useMemo(
    () => agendaFor(dates, routines, todos, checks, eventItems(dates, events, profiles, fallback)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, routines, todos, checks, events, profiles, fallback],
  );
}

// App-wide state: hot-swapping this module would split it into two copies (the UI reading an
// empty one). Reload the page instead.
import.meta.hot?.accept(() => window.location.reload());
