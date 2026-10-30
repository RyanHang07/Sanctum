import tokens from "../../design/tokens.json";
import extra from "./extra.json";
import { cssVar, kebab } from "./palette";

type ColorValue = string | Record<string, string>;

/** A colour by its flat name, as the theme's variable (src/theme/palette.ts). */
const ref = (flat: string) => `var(${cssVar(flat)})`;

/**
 * The colour names from design/tokens.json (and extra.json) in the shape Tailwind expects,
 * each pointing at its theme variable: `bg-sealed-tint` draws `var(--s-sealed-tint)`.
 */
export function buildColors(): Record<string, ColorValue> {
  const out: Record<string, ColorValue> = {};
  for (const [name, value] of Object.entries({ ...tokens.color, ...extra.color })) {
    if (typeof value === "string") {
      out[name] = ref(name);
    } else if (Array.isArray(value)) {
      out[name] = Object.fromEntries(value.map((_, i) => [String(i + 1), ref(`${name}-${i + 1}`)]));
    } else {
      out[name] = Object.fromEntries(
        Object.keys(value).map((k) => (k === "DEFAULT" ? [k, ref(name)] : [kebab(k), ref(`${name}-${kebab(k)}`)])),
      );
    }
  }
  return out;
}

const px = (n: number) => `${n}px`;

export const fontStacks = {
  sans: [`"${tokens.font.sans} Variable"`, `"${tokens.font.sans}"`, "system-ui", "sans-serif"],
  mono: [`"${tokens.font.mono} Variable"`, `"${tokens.font.mono}"`, "ui-monospace", "monospace"],
  serif: [`"${tokens.font.serif}"`, "Georgia", "serif"],
};

export const theme = {
  colors: buildColors(),
  fontFamily: fontStacks,
  borderRadius: Object.fromEntries(Object.entries(tokens.radius).map(([k, v]) => [k, px(v)])),
  spacing: Object.fromEntries(Object.entries({ ...tokens.size, ...extra.size }).map(([k, v]) => [k, px(v)])),
  fontSize: {
    "page-title": [px(tokens.type.pageTitle[0]), { fontWeight: String(tokens.type.pageTitle[1]) }],
    body: px(tokens.type.body[0]),
    meta: px(tokens.type.meta[0]),
    moment: [px(tokens.type.moment[0]), { fontWeight: String(tokens.type.moment[1]) }],
  },
  // Shadows are part of the theme too (a light theme casts a softer one).
  boxShadow: Object.fromEntries(Object.keys(extra.shadow).map((k) => [k, ref(`shadow-${k}`)])),
  transitionDuration: extra.motion.duration,
  transitionTimingFunction: extra.motion.easing,
  keyframes: {
    "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
    "rise-in": { from: { opacity: "0", transform: "translateY(6px)" }, to: { opacity: "1", transform: "translateY(0)" } },
  },
  animation: {
    "fade-in": `fade-in ${extra.motion.duration.enter} ${extra.motion.easing.ui} both`,
    "rise-in": `rise-in ${extra.motion.duration.enter} ${extra.motion.easing.ui} both`,
  },
};

export const windowSize = tokens.window;
export const durationsMin: readonly number[] = tokens.durationsMin;
export { tokens };
