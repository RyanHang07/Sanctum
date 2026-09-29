import tokens from "../../design/tokens.json";
import extra from "./extra.json";

/** camelCase -> kebab-case, so `textHover` becomes the class suffix `text-hover`. */
const kebab = (s: string) => s.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase());

type ColorValue = string | Record<string, string>;

/** Flattens design/tokens.json colors into the shape Tailwind expects. */
export function buildColors(): Record<string, ColorValue> {
  const out: Record<string, ColorValue> = {};
  for (const [name, value] of Object.entries(tokens.color)) {
    if (typeof value === "string") {
      out[name] = value;
    } else if (Array.isArray(value)) {
      out[name] = Object.fromEntries(value.map((v, i) => [String(i + 1), v]));
    } else {
      out[name] = Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k === "DEFAULT" ? k : kebab(k), v]),
      );
    }
  }
  for (const [name, value] of Object.entries(extra.color)) out[name] = value;
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
  boxShadow: extra.shadow,
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
