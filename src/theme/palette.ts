import tokens from "../../design/tokens.json";
import extra from "./extra.json";

// Themes (v0.3): every colour the app draws with is a CSS variable, `--s-<name>`, set on <html>
// at start-up and whenever the theme changes. Tailwind's colours (src/theme/tokens.ts) point at
// these variables, so `bg-app` or `text-sealed` follows the theme with no component changes.
// A palette is one theme's value for each name. Sanctum Dark is design/tokens.json itself
// (plus src/theme/extra.json), so the design files stay the source of truth for the default.

/** camelCase -> kebab-case, so `textHover` becomes `text-hover`. */
export const kebab = (s: string) => s.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase());

/** Every colour as a flat name: `sealed` (the DEFAULT), `sealed-text-hover`, `held-1`… */
function flatten(groups: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(groups)) {
    if (typeof value === "string") out[name] = value;
    else if (Array.isArray(value)) value.forEach((v, i) => (out[`${name}-${i + 1}`] = String(v)));
    else
      for (const [k, v] of Object.entries(value as Record<string, string>)) out[k === "DEFAULT" ? name : `${name}-${kebab(k)}`] = v;
  }
  return out;
}

const DARK: Record<string, string> = {
  ...flatten(tokens.color),
  ...flatten(extra.color),
  ...Object.fromEntries(Object.entries(extra.shadow).map(([k, v]) => [`shadow-${k}`, v])),
};

/** The names every palette defines. */
export const KEYS = Object.keys(DARK) as readonly string[];
export type Palette = Record<string, string>;

export interface Theme {
  id: string;
  name: string;
  /** Light themes get a light title bar, light native controls, and the dark tray mark. */
  scheme: "dark" | "light";
  palette: Palette;
}

/** Sanctum Dark: the design tokens, unchanged. */
export const SANCTUM_DARK: Theme = { id: "sanctum-dark", name: "Sanctum Dark", scheme: "dark", palette: DARK };

export const cssVar = (key: string) => `--s-${key}`;

/** Puts a theme's colours on <html> (and its scheme, so scrollbars and inputs match). */
export function applyTheme(theme: Theme, root: HTMLElement = document.documentElement) {
  for (const key of KEYS) root.style.setProperty(cssVar(key), theme.palette[key] ?? DARK[key]!);
  root.style.colorScheme = theme.scheme;
  root.dataset.theme = theme.id;
  root.dataset.scheme = theme.scheme;
}
