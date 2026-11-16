import { useEffect, useState } from "react";
import { THEMES } from "../../../src/theme/themes";
import type { Theme } from "../../../src/theme/palette";

// Light or dark (v0.2 site): follows the visitor's system until they pick one with the toggle.
// The pick is a convenience kept in this browser only.
//
// Follows the person's Sanctum theme (v0.4 redesign, S8): a link from the app, or from an email
// the app asked for, can carry `?theme=<theme id>`; the page then paints in that theme's own
// palette (src/theme/themes.ts, the same colours as the app), for this visit. `?theme=light|dark`
// (older apps) still picks the site's light or dark. Anything else is ignored.

export type ThemePick = "system" | "light" | "dark" | { app: string };
const KEY = "sanctum-theme";

/** Opened from the app (v0.3): `?theme=…` is the app's theme, for this visit. */
const VISIT = "sanctum-theme-visit";

/** The app theme with this id, if there is one. */
export function appTheme(id: string | null | undefined): Theme | null {
  return (id && THEMES.find((t) => t.id === id)) || null;
}

/** A visit value: light, dark, or an app theme's id. */
function visitPick(v: string | null): ThemePick | null {
  if (v === "light" || v === "dark") return v;
  return appTheme(v) ? { app: v! } : null;
}

function fromApp(): ThemePick | null {
  const asked = visitPick(new URLSearchParams(location.search).get("theme"));
  if (asked) {
    try {
      sessionStorage.setItem(VISIT, typeof asked === "string" ? asked : asked.app);
    } catch {
      // private window: this page still shows it
    }
    return asked;
  }
  try {
    return visitPick(sessionStorage.getItem(VISIT));
  } catch {
    return null;
  }
}

function stored(): ThemePick {
  const app = fromApp();
  if (app) return app;
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

/** The app calls the text on the accent `sealed-on`; design/tokens.css calls it `--on-sealed`. */
const NAMES: Record<string, string> = { "sealed-on": "on-sealed" };
const COLOUR = /^(#[0-9a-f]{3,8}|rgba?\([0-9., ]+\))$/i;
/** The variables an app theme set, so a later pick can take them off again. */
let painted: string[] = [];

/**
 * Puts the pick on <html data-theme>; "system" leaves it to prefers-color-scheme. An app theme
 * also sets its palette on <html> (each colour as the site's variable of the same name) and
 * `data-app-theme`, and its scheme as data-theme so the right mark shows.
 */
export function applyTheme(pick: ThemePick = stored()) {
  const root = document.documentElement;
  for (const name of painted) root.style.removeProperty(name);
  painted = [];
  delete root.dataset.appTheme;
  root.style.colorScheme = "";
  const theme = typeof pick === "object" ? appTheme(pick.app) : null;
  if (theme) {
    for (const [name, value] of Object.entries(theme.palette)) {
      if (typeof value !== "string" || !COLOUR.test(value)) continue;
      const v = `--${NAMES[name] ?? name}`;
      root.style.setProperty(v, value);
      painted.push(v);
    }
    root.dataset.appTheme = theme.id;
    root.dataset.theme = theme.scheme;
    root.style.colorScheme = theme.scheme;
  } else if (pick === "system" || typeof pick === "object") delete root.dataset.theme;
  else root.dataset.theme = pick;
}

const systemDark = () => matchMedia("(prefers-color-scheme: dark)").matches;

/** The theme now showing, and a toggle that flips it (and remembers the flip). */
export function useTheme(): { dark: boolean; toggle: () => void; app: Theme | null } {
  const [pick, setPick] = useState<ThemePick>(stored);
  const [system, setSystem] = useState(systemDark);
  useEffect(() => {
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const on = () => setSystem(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  const app = typeof pick === "object" ? appTheme(pick.app) : null;
  const dark = app ? app.scheme === "dark" : pick === "system" ? system : pick === "dark";
  const toggle = () => {
    // Flipping back to what the system shows returns to following it.
    const next: ThemePick = dark ? (system ? "light" : "system") : system ? "system" : "dark";
    setPick(next);
    applyTheme(next);
    try {
      // Your own pick now outranks the app's for this visit.
      sessionStorage.removeItem(VISIT);
      if (next === "system") localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, next);
    } catch {
      // private window: the pick lasts this visit
    }
  };
  return { dark, toggle, app };
}
