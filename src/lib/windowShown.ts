import { useSyncExternalStore } from "react";
import { inTauri } from "./native";

// Whether the window can be seen: false while it is minimized, hidden in the tray, or the page is
// hidden. One shared store, so the app attaches one set of listeners however many components ask
// (lifted from Mesh.tsx, motion spec §1.4). While hidden, <html> carries data-window-hidden, so CSS
// loops (aurora, held mesh, keyhole breathe) can pause through one switch.

type Listener = () => void;

const listeners = new Set<Listener>();
let shown = typeof document === "undefined" || document.visibilityState !== "hidden";
let stop: (() => void) | null = null;

function apply(next: boolean) {
  if (typeof document !== "undefined") {
    if (next) delete document.documentElement.dataset.windowHidden;
    else document.documentElement.dataset.windowHidden = "";
  }
  if (next === shown) return;
  shown = next;
  listeners.forEach((l) => l());
}

/** Set the answer directly (tests, or a caller that knows better). */
export function setWindowShown(next: boolean) {
  apply(next);
}

export function getWindowShown(): boolean {
  return shown;
}

function start(): () => void {
  let alive = true;
  const offs: (() => void)[] = [];
  const check = async () => {
    let next = document.visibilityState !== "hidden";
    if (next && inTauri()) {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const w = getCurrentWindow();
        next = (await w.isVisible()) && !(await w.isMinimized());
      } catch {
        // Keep the page's own answer.
      }
    }
    if (alive) apply(next);
  };
  const onVisibility = () => void check();
  document.addEventListener("visibilitychange", onVisibility);
  offs.push(() => document.removeEventListener("visibilitychange", onVisibility));
  if (inTauri()) {
    void import("@tauri-apps/api/window").then(({ getCurrentWindow }) => {
      const w = getCurrentWindow();
      // Minimizing resizes the window; restoring from the tray focuses it.
      for (const on of [w.onResized(() => void check()), w.onFocusChanged(() => void check())]) {
        void on.then((off) => (alive ? offs.push(off) : off()));
      }
    });
  }
  // Tests set the answer directly; only a real page asks the window.
  if (inTauri()) void check();
  return () => {
    alive = false;
    offs.forEach((off) => off());
  };
}

function subscribe(cb: Listener): () => void {
  listeners.add(cb);
  if (!stop && typeof document !== "undefined") stop = start();
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0 && stop) {
      stop();
      stop = null;
    }
  };
}

/** False while the window is minimized, hidden in the tray, or the page is hidden. */
export function useWindowShown(): boolean {
  return useSyncExternalStore(subscribe, getWindowShown, () => true);
}
