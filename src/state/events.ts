import { EVENTS, onNative } from "../lib/native";
import type { GcalStatus, HeldStats, SessionView } from "../lib/types";
import { useCalendar } from "./calendar";
import { usePlanner } from "./planner";
import { useStore } from "./store";

/** Coming back to the window syncs with Google, at most this often. */
const FOCUS_SYNC_MS = 30_000;

/**
 * Feeds Rust's events into the main window's store. Returns an unsubscribe function.
 * Rust owns the session; the store only mirrors it.
 */
export function connectNativeEvents(): () => void {
  const store = useStore.getState;
  const offs = [
    onNative(EVENTS.closeRequested, () => store().openCloseDialog()),
    onNative(EVENTS.enterFocus, () => {
      store().navigate("today");
      void store().enterFocus();
    }),
    onNative<SessionView | null>(EVENTS.session, (s) => store().applySession(s)),
    onNative<SessionView>(EVENTS.tick, (s) => store().applyTick(s)),
    onNative<HeldStats>(EVENTS.held, (h) => store().showHeld(h)),
    onNative(EVENTS.endEarly, () => store().openEndEarly()),
    onNative<GcalStatus>(EVENTS.gcal, (s) => useCalendar.getState().applyStatus(s)),
    // Edits made in Google changed routines or items.
    onNative(EVENTS.planner, () => void usePlanner.getState().reload()),
  ];
  void useCalendar.getState().load();
  let lastSync = 0;
  const onFocus = () => {
    if (!useCalendar.getState().status?.connected || Date.now() - lastSync < FOCUS_SYNC_MS) return;
    lastSync = Date.now();
    useCalendar.getState().syncNow();
  };
  window.addEventListener("focus", onFocus);
  return () => {
    window.removeEventListener("focus", onFocus);
    offs.forEach((p) => void p.then((off) => off()));
  };
}
