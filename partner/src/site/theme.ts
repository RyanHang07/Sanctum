import { useEffect, useState } from "react";

// Light or dark (v0.2 site): follows the visitor's system until they pick one with the toggle.
// The pick is a convenience kept in this browser only.

export type ThemePick = "system" | "light" | "dark";
const KEY = "sanctum-theme";

function stored(): ThemePick {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

/** Puts the pick on <html data-theme>; "system" leaves it to prefers-color-scheme. */
export function applyTheme(pick: ThemePick = stored()) {
  if (pick === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = pick;
}

const systemDark = () => matchMedia("(prefers-color-scheme: dark)").matches;

/** The theme now showing, and a toggle that flips it (and remembers the flip). */
export function useTheme(): { dark: boolean; toggle: () => void } {
  const [pick, setPick] = useState<ThemePick>(stored);
  const [system, setSystem] = useState(systemDark);
  useEffect(() => {
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const on = () => setSystem(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  const dark = pick === "system" ? system : pick === "dark";
  const toggle = () => {
    // Flipping back to what the system shows returns to following it.
    const next: ThemePick = dark ? (system ? "light" : "system") : system ? "system" : "dark";
    setPick(next);
    applyTheme(next);
    try {
      if (next === "system") localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, next);
    } catch {
      // private window: the pick lasts this visit
    }
  };
  return { dark, toggle };
}
