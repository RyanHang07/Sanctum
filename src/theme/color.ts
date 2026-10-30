// Colour arithmetic for themes (v0.3): mixing, and WCAG contrast, so each theme's derived
// colours (tints, lines, accent text) are worked out rather than hand-picked, and a test can
// hold every theme to the same contrast bar.

type Rgb = [number, number, number];

export function rgb(hex: string): Rgb {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as Rgb;
}

export const hex = ([r, g, b]: Rgb) => `#${[r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("").toUpperCase()}`;

/** `a` blended toward `b` by `t` (0 = a, 1 = b). */
export function mix(a: string, b: string, t: number): string {
  const [x, y] = [rgb(a), rgb(b)];
  return hex([0, 1, 2].map((i) => x[i]! + (y[i]! - x[i]!) * t) as Rgb);
}

/** WCAG relative luminance. */
export function luminance(c: string): number {
  const [r, g, b] = rgb(c).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, 1 to 21. */
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

/**
 * `c`, moved toward `toward` in small steps until it reaches `ratio` against `bg`
 * (unchanged when it already does).
 */
export function reach(c: string, bg: string, ratio: number, toward: string): string {
  let out = c;
  for (let t = 0.05; contrast(out, bg) < ratio && t <= 1; t += 0.05) out = mix(c, toward, t);
  return out;
}

/** Whichever of `light` and `dark` reads better on `bg`. */
export const onColor = (bg: string, light: string, dark: string) => (contrast(light, bg) >= contrast(dark, bg) ? light : dark);
