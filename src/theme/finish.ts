import { contrast, mix, onColor, readable, rgb } from "./color";
import type { Palette, Theme } from "./palette";

// The redesign's theme pass (v0.4, decided 2026-11-15, docs/decisions/2026-11-15-theme-pairs.md).
// Every theme, Sanctum's and OpenCode's alike, goes through finishTheme() once, so the same
// rules hold everywhere:
// - a `second` color (decoration only: kept marks, the goal tick, the active sidebar icon) with its
//   text, tint and line versions, defaulting to the theme's event color;
// - `muted` that reads at 4.5:1 on every surface muted text sits on;
// - `line-input` that reaches 3:1, so an input's edge can be seen (WCAG 1.4.11);
// - the hand-picked fixes from the theme-pair review.

const WHITE = "#FFFFFF";
const BLACK = "#000000";

/** Second colors picked by hand, where the event color fails as a pair with the accent. */
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
  // Watch themes the review recommends, so a theme family keeps one second color.
  "everforest-light": "#3A94C5",
  flexoki: "#3AA99F",
  "matrix-light": "#268FCC",
};

/**
 * Orng and Lucent Orng: the accent was a near-white (a text color, not a color), so the
 * orange event carried the theme. Orange becomes the accent, the theme's cyan the second
 * color and the event color, and broken moves to a redder value so a broken seal doesn't
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

/** The second color's roles, worked out like the accent's. */
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

/**
 * The enabled color (2026-11-20): connected, on, turned on, and the app's Open state. Sanctum's
 * own themes share one green (2026-11-21): #6EEB80 on dark (hue 129, 76% saturation, 68%
 * lightness, between the sealed blue's 59% and the second coral's 71%), and on light the same hue
 * at the light second's 62% saturation, as light as a 3:1 fill on the page allows. It is also the
 * fallback for an imported theme that brings no green of its own.
 */
export const OK_GREEN = { dark: "#6EEB80", light: "#27A53A" } as const;

/** Sanctum's own themes, which always take OK_GREEN. */
const SANCTUM = new Set(["sanctum-dark", "sanctum-light"]);

/**
 * Enabled greens picked by hand, where a theme's imported open color isn't its green
 * (green audit, 2026-11-21).
 */
export const OK: Readonly<Record<string, string>> = {
  // Built here from its published colors, which name no open: Latte's own green.
  "catppuccin-latte": "#40A02B",
  // Its open is a grey teal; Nord's aurora green (the dark Nord's open).
  "nord-light": "#A3BE8C",
  // Rosé Pine has no green; pine is the color it gives success, so it stays.
  rosepine: "#31748F",
  "rosepine-light": "#286983",
};

/** A green: a hue from yellow-green to sea green, with enough color not to read as grey. */
export function isGreen(c: string | undefined): c is string {
  if (!c || !/^#[0-9A-Fa-f]{6}$/.test(c)) return false;
  const [r, g, b] = rgb(c);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (d < 24) return false;
  const hue = max === r ? 60 * (((g - b) / d + 6) % 6) : max === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4);
  // 55 takes in Gruvbox Light's olive; 176 takes in Night Owl Light's sea green (175) and stops
  // short of Nord Light's grey teal (178).
  return hue >= 55 && hue <= 176;
}

/** Where a theme's enabled green comes from: Sanctum's green, a hand pick, its own open, or the fallback. */
export function okSource(theme: Theme): string {
  if (SANCTUM.has(theme.id)) return OK_GREEN[theme.scheme];
  const own = theme.palette.open;
  return OK[theme.id] ?? (isGreen(own) ? own : OK_GREEN[theme.scheme]);
}

export function okRoles(source: string, app: string, panel: string, dark: boolean): Palette {
  const away = dark ? WHITE : BLACK;
  const ok = readable(source, [app, panel], 3, away);
  const tint = mix(app, ok, dark ? 0.13 : 0.1);
  return {
    ok,
    "ok-text": readable(ok, [app, panel, tint], 4.5, away),
    "ok-tint": tint,
    "ok-line": mix(app, ok, dark ? 0.4 : 0.35),
  };
}

/**
 * The delete color: the theme's broken red family under its own name, so a delete reads as
 * destructive by name and a broken seal keeps its own meaning. Its text also reads on the panel,
 * where most delete buttons sit (a few imported broken-texts fall just short there).
 */
export function dangerRoles(p: Palette, dark: boolean): Palette {
  const tint = p["broken-tint"]!;
  return {
    danger: p.broken!,
    "danger-text": readable(p["broken-text"]!, [p.app!, p.panel!, tint], 4.5, dark ? WHITE : BLACK),
    "danger-tint": tint,
    "danger-line": p["broken-line"]!,
  };
}

/**
 * The month heatmap's steps. heat-1, the lightest, sits straight on the panel, so it reaches 2:1
 * there (UI audit, 2026-11-18; it was about 1.3:1 and needed an edge). heat-2 then sits halfway
 * to heat-3 when the raised heat-1 would crowd it, so the three steps still climb.
 */
export function heatSteps(p: Palette, panel: string): Palette {
  const one = readable(p["heat-1"]!, [panel], 2, p.sealed!);
  const three = p["heat-3"]!;
  let two = p["heat-2"]!;
  if (contrast(two, panel) < contrast(one, panel) + 0.3) two = mix(one, three, 0.5);
  return { "heat-1": one, "heat-2": two, "heat-3": three };
}

/**
 * The text on each heatmap step (2026-11-24): the day's number and its focused time. It stays the
 * theme's own text where that reads (4.5:1), and otherwise turns to the theme's ink for the other
 * side, dark on a light fill and light on a dark one. The fills themselves never change. Before,
 * the text was always `text`, so light fills under light text (Aura's kept days at 1.08:1) lost it.
 */
export function heatInk(p: Palette, dark: boolean): Palette {
  const other = dark ? p.app! : p.panel!;
  // A mid-tone fill can sit between both (Aura Light's lightest step): then plain black or white,
  // whichever reads, which always clears 4.5:1 on any color.
  const ink = (fill: string) => {
    if (contrast(p.text!, fill) >= 4.5) return p.text!;
    if (contrast(other, fill) >= 4.5) return other;
    return onColor(fill, WHITE, BLACK);
  };
  return { "heat-on-1": ink(p["heat-1"]!), "heat-on-2": ink(p["heat-2"]!), "heat-on-3": ink(p["heat-3"]!) };
}

/** Surfaces muted text is drawn on. */
export const MUTED_ON = ["app", "panel", "raised", "sidebar", "sealed-tint", "toast"] as const;

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
  // The enabled and delete colors (2026-11-20). The theme's own green (its imported open color)
  // becomes the enabled color; Sanctum's themes share one (okSource).
  Object.assign(p, okRoles(okSource(theme), app, panel, dark));
  Object.assign(p, dangerRoles(p, dark));
  // Open is the enabled green on every surface and theme (2026-11-20): the sidebar pill, the tray
  // and the extension all show it.
  p.open = p.ok!;
  // Toasts, the update notice and chart tooltips carry the theme's own text, so their surface is a
  // step off the page in the same scheme. The OpenCode themes came in with it inverted (light on
  // dark themes, dark on light ones), which left white boxes with unreadable text (2026-11-20).
  if (contrast(p.text!, p.toast!) < 4.5) p.toast = dark ? mix(p.raised!, p.line!, 0.3) : panel;
  p.muted = readable(p.muted!, MUTED_ON.map((k) => p[k]!), 4.5, away);
  p["line-input"] = readable(p["line-input"]!, [app, panel], 3, away);
  // check-line is the hover step and the quiet mark (unchecked boxes, neutral and missed bars). It
  // was derived from line-input before line-input was raised, so it could end up fainter: hovers
  // faded and marks went under 3:1 (theme audit, 2026-11-17). Now it sits a step past line-input.
  p["check-line"] = readable(mix(p["line-input"]!, p.muted!, 0.35), [app, panel, p.raised!], 3, away);
  // Locked nav items (while sealed) still say what's locked, so they keep 3:1 on the sidebar
  // (visual polish, 2026-11-17).
  p.locked = readable(p.locked!, [p.sidebar!, app], 3, away);
  Object.assign(p, heatSteps(p, panel));
  Object.assign(p, heatInk(p, dark));
  return { ...theme, palette: p };
}
