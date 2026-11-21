import { contrast } from "./color";
import { KEYS } from "./palette";
import { ACCENT, OK_GREEN, SECOND } from "./finish";
import { OPENCODE_THEMES } from "./opencodeThemes";
import { THEMES, themeById } from "./themes";

// Every theme clears the same bar (v0.3). Ratios are WCAG's: 4.5 for text, 3 for large text
// and things that only need to be seen (the event color on a bar, a focus ring).
const pairs: [fg: string, bg: string, min: number][] = [
  ["text", "app", 7],
  ["text", "panel", 7],
  // Toasts and chart tooltips (2026-11-20: imported themes had them inverted).
  ["text", "toast", 4.5],
  ["muted", "toast", 4.5],
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
  // v0.4: muted on every surface it sits on, input edges, and the second color.
  ["muted", "raised", 4.5],
  ["muted", "sidebar", 4.5],
  ["muted", "sealed-tint", 4.5],
  ["line-input", "app", 3],
  ["line-input", "panel", 3],
  ["second", "app", 3],
  ["second", "panel", 3],
  ["second-text", "app", 4.5],
  ["second-text", "panel", 4.5],
  ["second-text", "second-tint", 4.5],
  // The enabled and delete colors (2026-11-20): their text reads on the page, the panel and the tint.
  ["ok", "app", 3],
  ["ok", "panel", 3],
  ["ok-text", "app", 4.5],
  ["ok-text", "panel", 4.5],
  ["ok-text", "ok-tint", 4.5],
  ["danger-text", "app", 4.5],
  ["danger-text", "panel", 4.5],
  ["danger-text", "danger-tint", 4.5],
  // UI audit (2026-11-18): the lightest heatmap step reads on the panel without an edge.
  ["heat-1", "panel", 2],
];

describe("theme pass (v0.4)", () => {
  it("every hand-picked second color and accent fix names a real theme", () => {
    for (const id of [...Object.keys(SECOND), ...Object.keys(ACCENT)]) expect(themeById(id), id).toBeDefined();
  });

  it("the second color defaults to the event color", () => {
    const t = themeById("aura")!;
    expect(t.palette.second).toBe(t.palette.event);
    expect(themeById("sanctum-dark")!.palette.second).toBe("#FF8A6B");
  });

  it("uses the hand-picked second color where the review flagged the pair", () => {
    expect(themeById("nord")!.palette.second).toBe("#88C0D0");
    expect(themeById("sanctum-light")!.palette.second).toBe("#C2822E");
    expect(themeById("flexoki-light")!.palette.second).not.toBe(themeById("flexoki-light")!.palette.sealed);
  });

  it("swaps Orng's roles: orange accent, cyan second, a redder broken", () => {
    for (const id of ["orng", "lucent-orng"]) {
      const p = themeById(id)!.palette;
      expect(p.sealed, id).toBe("#EC5B2B");
      expect(p.second, id).toBe("#56B6C2");
      expect(p.event, id).toBe("#56B6C2");
      expect(p.broken, id).toBe("#E5484D");
    }
  });

  it("replaces the two dark 'Light' Catppuccin copies with a real Latte", () => {
    expect(THEMES.some((t) => t.id === "catppuccin-frappe-light" || t.id === "catppuccin-macchiato-light")).toBe(false);
    const latte = themeById("catppuccin-latte")!;
    expect(latte.scheme).toBe("light");
    expect(latte.palette.app).toBe("#EFF1F5");
    expect(themeById("catppuccin-frappe-light")).toBe(latte);
    expect(themeById("catppuccin-macchiato-light")).toBe(latte);
  });

  it("keeps every heatmap step at 2:1 or more on the panel, and Sanctum's steps climbing", () => {
    for (const t of THEMES) {
      const c = (k: string) => contrast(t.palette[k]!, t.palette.panel!);
      for (const k of ["heat-1", "heat-2", "heat-3"]) expect(c(k), `${t.id} ${k}`).toBeGreaterThanOrEqual(2);
      if (t.id.startsWith("sanctum")) expect(c("heat-2"), t.id).toBeGreaterThan(c("heat-1"));
    }
  });

  it("no theme calls itself Light on a dark scheme", () => {
    for (const t of THEMES) if (/ Light$/.test(t.name)) expect(t.scheme, t.id).toBe("light");
  });
});

describe("themes (v0.3)", () => {
  it("includes Sanctum themes first and all OpenCode themes with unique ids", () => {
    expect(THEMES[0]!.id).toBe("sanctum-dark");
    expect(THEMES[1]!.id).toBe("sanctum-light");
    expect(new Set(THEMES.map((t) => t.id)).size).toBe(THEMES.length);
    expect(THEMES.length).toBeGreaterThan(13);
    expect(THEMES.some((t) => t.scheme === "light")).toBe(true);
    expect(THEMES.some((t) => t.scheme === "dark")).toBe(true);
    expect(themeById("opencode")?.name).toBe("OpenCode");
    expect(themeById("nord")?.name).toBe("Nord");
    expect(themeById("tokyonight")?.name).toBe("Tokyonight");
    expect(themeById("nope")).toBeUndefined();
  });

  it.each(THEMES.map((t) => [t.name, t] as const))("%s defines every color", (_, t) => {
    for (const key of KEYS) expect(t.palette[key], `${t.id} ${key}`).toBeTruthy();
  });

  it.each(THEMES.map((t) => [t.name, t] as const))("%s reads clearly", (_, t) => {
    for (const [fg, bg, min] of pairs) {
      const ratio = contrast(t.palette[fg]!, t.palette[bg]!);
      expect(ratio, `${t.id}: ${fg} on ${bg} is ${ratio.toFixed(2)}, needs ${min}`).toBeGreaterThanOrEqual(min);
    }
  });
});

describe("Open is the enabled green", () => {
  // The app, tray and extension draw Open as a green dot, the same green on every theme's surfaces (2026-11-20).
  it("is the theme's ok color in every theme", () => {
    for (const t of THEMES) expect(t.palette.open, t.id).toBe(t.palette.ok);
  });
});

describe("The enabled and delete colors", () => {
  const FAMILY = ["ok", "ok-text", "ok-tint", "ok-line", "danger", "danger-text", "danger-tint", "danger-line"];
  it("every theme has them", () => {
    for (const t of THEMES) for (const k of FAMILY) expect(t.palette[k], `${t.id} ${k}`).toMatch(/^#[0-9A-F]{6}$/i);
  });

  it("an imported theme's enabled color comes from its own green, not the text", () => {
    const aura = OPENCODE_THEMES.find((t) => t.id === "aura")!;
    expect(themeById("aura")!.palette.ok).toBe(aura.palette.open);
  });

  it("Sanctum's own themes get a plain green for their scheme", () => {
    expect(themeById("sanctum-dark")!.palette.ok).toBe(OK_GREEN.dark);
    expect(themeById("sanctum-light")!.palette.ok).toBe(OK_GREEN.light);
  });

  it("delete mirrors the broken red under its own name", () => {
    for (const t of THEMES) {
      expect(t.palette.danger, t.id).toBe(t.palette.broken);
      expect(t.palette["danger-tint"], t.id).toBe(t.palette["broken-tint"]);
    }
  });
});
