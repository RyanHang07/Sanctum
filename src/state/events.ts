import { EVENTS, onNative } from "../lib/native";
import type { CheckinDue, GcalStatus, HeldStats, SessionView } from "../lib/types";
import { useCalendar } from "./calendar";
import { usePlanner } from "./planner";
import { useStore } from "./store";
import { useTrackers } from "./trackers";

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
    // From the tray menu, or the tray panel with its own picks.
    onNative<{ profileId: number; minutes: number } | null>(EVENTS.enterFocus, (pick) => {
      store().navigate("today");
      if (pick) {
        store().selectProfile(pick.profileId);
        store().setDuration(pick.minutes);
      }
      void store().enterFocus();
    }),
    onNative<SessionView | null>(EVENTS.session, (s) => store().applySession(s)),
    onNative<SessionView>(EVENTS.tick, (s) => store().applyTick(s)),
    onNative<HeldStats>(EVENTS.held, (h) => store().showHeld(h)),
    onNative(EVENTS.endEarly, () => store().openEndEarly()),
    onNative<GcalStatus>(EVENTS.gcal, (s) => useCalendar.getState().applyStatus(s)),
    // Edits made in Google changed routines or items.
    onNative(EVENTS.planner, () => void usePlanner.getState().reload()),
    onNative<CheckinDue>(EVENTS.checkin, (d) => void useTrackers.getState().showDue(d)),
    // Tampering broke the seal (M12): say why. The seal stays on until its planned end.
    onNative<{ kind: string; detail: string }>(EVENTS.tamper, (t) =>
      store().showNotice({ lead: "The seal is broken.", rest: `${t.detail[0]!.toUpperCase()}${t.detail.slice(1)}. It stays on until the planned end.` }),
    ),
  ];
  // Check-ins queue while sealed; one that came due shows when the seal ends.
  const offSeal = useStore.subscribe((s, prev) => {
    if (prev.appState === "sealed" && s.appState !== "sealed") void useTrackers.getState().checkPending();
  });
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
    offSeal();
    offs.forEach((p) => void p.then((off) => off()));
  };
}
