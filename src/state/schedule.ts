import { useEffect, useRef } from "react";
import { useNow } from "../lib/useNow";
import { addDays, suggestFocus, todayKey, type AgendaItem, type Suggestion } from "../lib/planner";
import { currentMeeting } from "../lib/calendar";
import { agendaNow, useCalendar } from "./calendar";
import { usePlanner } from "./planner";
import { useStore } from "./store";

const CHECK_MS = 15_000;
/** A block counts as "just started" for this long, so the start prompt still shows. */
const PROMPT_WINDOW_MS = 2 * 60_000;

/** Today's and tomorrow's items (tomorrow so "next up" works late in the evening). */
export function upcomingItems(now = new Date()): AgendaItem[] {
  const today = todayKey(now, useStore.getState().settings.dailyResetTime);
  const days = [today, addDays(today, 1)];
  const agenda = agendaNow(days);
  return days.flatMap((d) => agenda[d] ?? []);
}

const prompted = new Set<string>();

/** One schedule check: update the suggestion and raise the start prompt when a block begins. */
export function checkSchedule(now = Date.now()): Suggestion | null {
  const store = useStore.getState();
  // A meeting with other people holds focus until it ends (SPEC 4.0, In event).
  store.applyMeeting(currentMeeting(useCalendar.getState().events, now));
  const s = suggestFocus(upcomingItems(new Date(now)), now);
  store.applySuggestion(s);
  if (s?.state === "now" && useStore.getState().appState === "open" && !store.session && now - s.startsAt < PROMPT_WINDOW_MS && !prompted.has(s.item.key)) {
    prompted.add(s.item.key);
    store.showBlockPrompt(s);
  }
  return s;
}

export const resetPrompted = () => prompted.clear();

/** Keeps the focus row following the schedule while Sanctum runs (SPEC 4.12, focus row). */
export function useScheduleFocus() {
  const dailyResetTime = useStore((s) => s.settings.dailyResetTime);
  // The planner day moves at the daily reset, not only when the reset setting changes.
  const today = todayKey(new Date(useNow(60_000)), dailyResetTime);
  const shown = useRef(today);
  useEffect(() => {
    void usePlanner.getState().ensure(today, addDays(today, 1)).then(() => checkSchedule());
    void useCalendar.getState().ensure(today, addDays(today, 1)).then(() => checkSchedule());
    // A new planner day (the reset passed, or it moved): Focus today counts from its reset.
    if (shown.current !== today) {
      shown.current = today;
      void useStore.getState().refreshFocusToday();
    }
  }, [today]);
  useEffect(() => {
    const t = setInterval(() => checkSchedule(), CHECK_MS);
    // Re-check right away when items change (added, checked off, moved).
    const off = usePlanner.subscribe((s, prev) => {
      if (s.routines !== prev.routines || s.todos !== prev.todos || s.checks !== prev.checks) checkSchedule();
    });
    const offEvents = useCalendar.subscribe((s, prev) => {
      if (s.events !== prev.events) checkSchedule();
    });
    return () => {
      clearInterval(t);
      off();
      offEvents();
    };
  }, []);
}
