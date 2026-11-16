import { contrast, mix, onColor, readable } from "./color";
import type { Palette, Theme } from "./palette";

// The redesign's theme pass (v0.4, decided 2026-11-15, docs/decisions/2026-11-15-theme-pairs.md).
// Every theme, Sanctum's and OpenCode's alike, goes through finishTheme() once, so the same
// rules hold everywhere:
// - a `second` colour (decoration only: kept marks, the goal tick, the aurora's tips) with its
//   text, tint and line versions, defaulting to the theme's event colour;
// - `muted` that reads at 4.5:1 on every surface muted text sits on;
// - `line-input` that reaches 3:1, so an input's edge can be seen (WCAG 1.4.11);
// - the hand-picked fixes from the theme-pair review.

const WHITE = "#FFFFFF";
const BLACK = "#000000";

/** Second colours picked by hand, where the event colour fails as a pair with the accent. */
export const SECOND: Readonly<Record<string, string>> = {
  // Flagged in the review.
  "sanctum-light": "#C2822E",
  "oc-2-light": "#A753AE",
  amoled: "#448AFF",
  ayu: "#59C2FF",
  catppuccin: "#B4BEFE",
  "catppuccin-latte": "#BB7718",
  everforest: "#7FBBB3",
  "flexoki-light": "#24837B",
  "lucent-orng": "#56B6C2",
  "lucent-orng-light": "#318795",
  matrix: "#30B3FF",
  "nightowl-light": "#4876D6",
  nord: "#88C0D0",
  "nord-light": "#5E81AC",
  "opencode-light": "#9D7CD8",
  orng: "#56B6C2",
  "orng-light": "#318795",
  tokyonight: "#7AA2F7",
  "tokyonight-light": "#2E7DE9",
  "zenburn-light": "#B28C72",
  // Watch themes the review recommends, so a theme family keeps one second colour.
  "everforest-light": "#3A94C5",
  flexoki: "#3AA99F",
  "matrix-light": "#268FCC",
};

/**
 * Orng and Lucent Orng: the accent was a near-white (a text colour, not a colour), so the
 * orange event carried the theme. Orange becomes the accent, the theme's cyan the second
 * colour and the event colour, and broken moves to a redder value so a broken seal doesn't
 * look like a sealed one.
 */
export const ACCENT: Readonly<Record<string, { accent: string; event: string; broken: string }>> = {
  orng: { accent: "#EC5B2B", event: "#56B6C2", broken: "#E5484D" },
  "lucent-orng": { accent: "#EC5B2B", event: "#56B6C2", broken: "#E5484D" },
};

/** Themes that were removed, and the theme a saved choice of them now opens. */
export const RETIRED: Readonly<Record<string, string>> = {
  // Byte-for-byte copies of the dark flavours under a "Light" name.
  "catppuccin-frappe-light": "catppuccin-latte",
  "catppuccin-macchiato-light": "catppuccin-latte",
};

/** The accent's roles: the fill, text on it, its text, tint and line. */
export function accentRoles(accent: string, app: string, panel: string, darkInk: string, dark: boolean): Palette {
  const away = dark ? WHITE : BLACK;
  let sealed = accent;
  let on = onColor(sealed, WHITE, darkInk);
  if (contrast(on, sealed) < 4.5) sealed = readable(sealed, [on], 4.5, on === WHITE ? BLACK : WHITE);
  on = onColor(sealed, WHITE, darkInk);
  const tint = mix(app, sealed, dark ? 0.17 : 0.1);
  const text = readable(sealed, [app, panel, tint], 4.5, away);
  return {
    sealed,
    "sealed-text": text,
    "sealed-text-hover": mix(text, away, 0.35),
    "sealed-on": on,
    "sealed-tint": tint,
    "sealed-line": mix(app, sealed, dark ? 0.45 : 0.35),
    "heat-1": mix(panel, sealed, 0.25),
    "heat-2": mix(panel, sealed, 0.5),
    "heat-3": mix(panel, sealed, 0.8),
  };
}

/** The second colour's roles, worked out like the accent's. */
export function secondRoles(source: string, app: string, panel: string, dark: boolean): Palette {
  const away = dark ? WHITE : BLACK;
  const second = readable(source, [app, panel], 3, away);
  const tint = mix(app, second, dark ? 0.13 : 0.1);
  return {
    second,
    "second-text": readable(second, [app, panel, tint], 4.5, away),
    "second-tint": tint,
    "second-line": mix(app, second, dark ? 0.45 : 0.35),
  };
}

export function eventRoles(event: string, app: string, panel: string, dark: boolean): Palette {
  const e = readable(event, [app, panel], 3, dark ? WHITE : BLACK);
  return { event: e, "event-tint": mix(app, e, dark ? 0.13 : 0.1), "event-line": mix(app, e, dark ? 0.4 : 0.35) };
}

export function brokenRoles(broken: string, app: string, panel: string, dark: boolean): Palette {
  const tint = mix(app, broken, dark ? 0.14 : 0.09);
  return {
    broken,
    "broken-tint": tint,
    "broken-text": readable(broken, [app, panel, tint], 4.5, dark ? WHITE : BLACK),
    "broken-line": mix(app, broken, dark ? 0.4 : 0.35),
  };
}

/** Surfaces muted text is drawn on. */
export const MUTED_ON = ["app", "panel", "raised", "sidebar", "sealed-tint"] as const;

export function finishTheme(theme: Theme): Theme {
  const dark = theme.scheme === "dark";
  const away = dark ? WHITE : BLACK;
  const p: Palette = { ...theme.palette };
  const { app, panel } = p as { app: string; panel: string };

  const fix = ACCENT[theme.id];
  if (fix) {
    Object.assign(p, accentRoles(fix.accent, app, panel, dark ? app : p.text!, dark));
    Object.assign(p, eventRoles(fix.event, app, panel, dark));
    Object.assign(p, brokenRoles(fix.broken, app, panel, dark));
  }

  Object.assign(p, secondRoles(SECOND[theme.id] ?? p.event!, app, panel, dark));
  p.muted = readable(p.muted!, MUTED_ON.map((k) => p[k]!), 4.5, away);
  p["line-input"] = readable(p["line-input"]!, [app, panel], 3, away);
  return { ...theme, palette: p };
}
