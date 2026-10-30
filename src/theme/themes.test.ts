import { contrast } from "./color";
import { KEYS } from "./palette";
import { THEMES, themeById } from "./themes";

// Every theme clears the same bar (v0.3). Ratios are WCAG's: 4.5 for text, 3 for large text
// and things that only need to be seen (the event colour on a bar, a focus ring).
const pairs: [fg: string, bg: string, min: number][] = [
  ["text", "app", 7],
  ["text", "panel", 7],
  ["text-2", "panel", 4.5],
  ["muted", "app", 4.5],
  ["muted", "panel", 4.5],
  ["sealed-on", "sealed", 4.5],
  ["sealed-text", "app", 4.5],
  ["sealed-text", "panel", 4.5],
  ["sealed-text", "sealed-tint", 4.5],
  ["event", "app", 3],
  ["event", "panel", 3],
  ["broken-text", "app", 4.5],
  ["broken-text", "broken-tint", 4.5],
  ["sealed", "app", 3],
];

describe("themes (v0.3)", () => {
  it("are thirteen, Sanctum Dark first, with unique ids", () => {
    expect(THEMES).toHaveLength(13);
    expect(THEMES[0]!.id).toBe("sanctum-dark");
    expect(new Set(THEMES.map((t) => t.id)).size).toBe(13);
    expect(THEMES.filter((t) => t.scheme === "light").map((t) => t.name)).toEqual(["Sanctum Light", "GitHub Light", "Catppuccin Latte", "Solarized Light"]);
    expect(themeById("nord")?.name).toBe("Nord");
    expect(themeById("nope")).toBeUndefined();
  });

  it.each(THEMES.map((t) => [t.name, t] as const))("%s defines every colour", (_, t) => {
    for (const key of KEYS) expect(t.palette[key], `${t.id} ${key}`).toBeTruthy();
  });

  it.each(THEMES.map((t) => [t.name, t] as const))("%s reads clearly", (_, t) => {
    for (const [fg, bg, min] of pairs) {
      const ratio = contrast(t.palette[fg]!, t.palette[bg]!);
      expect(ratio, `${t.id}: ${fg} on ${bg} is ${ratio.toFixed(2)}, needs ${min}`).toBeGreaterThanOrEqual(min);
    }
  });
});
