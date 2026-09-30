/** The three app states from SPEC 4.0. The store is the single source of truth. */
export type AppState = "open" | "sealed" | "event";
export const APP_STATES: readonly AppState[] = ["open", "sealed", "event"];

export type TabId = "today" | "week" | "stats" | "trackers" | "setup";

export interface TabDef {
  id: TabId;
  label: string;
  /** Display label for the shortcut. */
  key: string;
  /** KeyboardEvent.key that triggers it with Ctrl. */
  hotkey: string;
}

export const TABS: readonly TabDef[] = [
  { id: "today", label: "Today", key: "Ctrl 1", hotkey: "1" },
  { id: "week", label: "Week", key: "Ctrl 2", hotkey: "2" },
  { id: "stats", label: "Stats", key: "Ctrl 3", hotkey: "3" },
  { id: "trackers", label: "Trackers", key: "Ctrl 4", hotkey: "4" },
  { id: "setup", label: "Setup", key: "Ctrl ,", hotkey: "," },
];

export const tabLabel = (id: TabId) => TABS.find((t) => t.id === id)!.label;

/** While sealed, every tab except Today is locked. */
export function isTabLocked(state: AppState, tab: TabId): boolean {
  return state === "sealed" && tab !== "today";
}

/** Quitting while sealed is only possible through the break-the-seal ladder (SPEC 4.0.1). */
export function canQuit(state: AppState): boolean {
  return state !== "sealed";
}

export function lockedToast(tab: TabId) {
  return { lead: `${tabLabel(tab)} is locked while you're sealed.`, rest: "End focus to open it." };
}

/** What the close button does. "ask" shows the Close dialog. */
export type CloseAction = "ask" | "tray" | "quit";

/**
 * Resolves a window close request. While sealed, a saved "quit" still goes to the tray,
 * and "ask" still shows the dialog (with Quit disabled).
 */
export function resolveClose(state: AppState, saved: CloseAction): CloseAction {
  if (saved === "quit" && !canQuit(state)) return "tray";
  return saved;
}

export type OnLogin = "home" | "tray";
