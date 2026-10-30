import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { buildColors, durationsMin, theme, tokens, windowSize } from "./tokens";
import { KEYS, SANCTUM_DARK, applyTheme } from "./palette";
import tailwindConfig from "../../tailwind.config";

const root = resolve(__dirname, "../..");
const css = readFileSync(join(root, "design/tokens.css"), "utf8");
const cssVar = (name: string) => css.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1].trim();

describe("design tokens", () => {
  it("tokens.json and tokens.css agree on every color", () => {
    for (const [name, value] of Object.entries(tokens.color)) {
      if (typeof value === "string") expect(cssVar(name)?.toUpperCase(), name).toBe(value.toUpperCase());
    }
    expect(cssVar("sealed")).toBe(tokens.color.sealed.DEFAULT);
    expect(cssVar("sealed-text")).toBe(tokens.color.sealed.text);
    expect(cssVar("sealed-text-hover")).toBe(tokens.color.sealed.textHover);
    expect(cssVar("sealed-tint")).toBe(tokens.color.sealed.tint);
    expect(cssVar("sealed-line")).toBe(tokens.color.sealed.line);
    expect(cssVar("on-sealed")).toBe(tokens.color.sealed.on);
    expect(cssVar("event")).toBe(tokens.color.event.DEFAULT);
    expect(cssVar("event-tint")).toBe(tokens.color.event.tint);
    expect(cssVar("event-line")).toBe(tokens.color.event.line);
    tokens.color.held.forEach((v, i) => expect(cssVar(`held-${i + 1}`)).toBe(v));
    tokens.color.ember.forEach((v, i) => expect(cssVar(`ember-${i + 1}`)).toBe(v));
  });

  it("exposes every token color to Tailwind by name, as its theme variable", () => {
    const colors = buildColors();
    expect(colors.app).toBe("var(--s-app)");
    expect(colors["text-2"]).toBe("var(--s-text-2)");
    expect(colors.sealed).toMatchObject({
      DEFAULT: "var(--s-sealed)",
      text: "var(--s-sealed-text)",
      "text-hover": "var(--s-sealed-text-hover)",
      on: "var(--s-sealed-on)",
      tint: "var(--s-sealed-tint)",
      line: "var(--s-sealed-line)",
    });
    expect(colors.held).toEqual({ "1": "var(--s-held-1)", "2": "var(--s-held-2)", "3": "var(--s-held-3)", "4": "var(--s-held-4)" });
    expect(colors.heat).toEqual({ "1": "var(--s-heat-1)", "2": "var(--s-heat-2)", "3": "var(--s-heat-3)" });
    for (const name of Object.keys(tokens.color)) expect(colors, name).toHaveProperty(name);
    // Every variable a class can point at is one a palette defines.
    const refs = JSON.stringify(colors).match(/--s-[a-z0-9-]+/g)!;
    for (const r of refs) expect(KEYS, r).toContain(r.slice(4));
  });

  it("Sanctum Dark is the design tokens, value for value", () => {
    const p = SANCTUM_DARK.palette;
    expect(p.app).toBe(tokens.color.app);
    expect(p["text-2"]).toBe(tokens.color["text-2"]);
    expect([p.sealed, p["sealed-text"], p["sealed-text-hover"], p["sealed-on"], p["sealed-tint"], p["sealed-line"]]).toEqual([
      tokens.color.sealed.DEFAULT,
      tokens.color.sealed.text,
      tokens.color.sealed.textHover,
      tokens.color.sealed.on,
      tokens.color.sealed.tint,
      tokens.color.sealed.line,
    ]);
    expect([p["held-1"], p["held-2"], p["held-3"], p["held-4"]]).toEqual(tokens.color.held);
    expect([p["ember-1"], p["ember-2"], p["ember-3"], p["ember-4"]]).toEqual(tokens.color.ember);
    expect(p["shadow-dialog"]).toMatch(/^0 24px/);
  });

  it("puts a theme on <html> as variables", () => {
    applyTheme(SANCTUM_DARK);
    const root = document.documentElement;
    expect(root.style.getPropertyValue("--s-app")).toBe(tokens.color.app);
    expect(root.style.getPropertyValue("--s-sealed-on")).toBe(tokens.color.sealed.on);
    expect(root.dataset.theme).toBe("sanctum-dark");
    expect(root.style.colorScheme).toBe("dark");
  });

  it("wires radii, control and row heights, sidebar width, and fonts into the Tailwind config", () => {
    const ext = tailwindConfig.theme.extend;
    expect(ext).toBe(theme);
    expect(ext.borderRadius).toEqual({ control: "6px", panel: "8px", dialog: "12px" });
    expect(ext.spacing).toEqual({ control: "32px", row: "38px", sidebar: "220px", "sidebar-rail": "60px" });
    expect(ext.fontFamily.sans[0]).toContain("Geist");
    expect(ext.fontFamily.mono[0]).toContain("Geist Mono");
    expect(ext.fontFamily.serif[0]).toContain("Instrument Serif");
  });

  it("defines one shared motion scale for hover and enter transitions", () => {
    const ext = tailwindConfig.theme.extend;
    expect(ext.transitionDuration).toEqual({ ui: "120ms", enter: "180ms" });
    expect(ext.transitionTimingFunction.ui).toMatch(/^cubic-bezier/);
    expect(Object.keys(ext.animation)).toEqual(["fade-in", "rise-in"]);
  });

  it("matches the window size and focus durations from the spec", () => {
    expect(windowSize).toEqual({ width: 1120, height: 720 });
    expect([...durationsMin]).toEqual([15, 30, 45, 60, 75, 90, 105, 120]);
  });

  it("matches the Tauri main window config", () => {
    const conf = JSON.parse(readFileSync(join(root, "src-tauri/tauri.conf.json"), "utf8"));
    const main = conf.app.windows.find((w: { label: string }) => w.label === "main");
    expect(main).toMatchObject({
      width: windowSize.width,
      height: windowSize.height,
      // Resizable (v0.1), down to a size that fits a vertical 1080p monitor.
      minWidth: 900,
      minHeight: 640,
      center: true,
      resizable: true,
      backgroundColor: tokens.color.app,
    });
  });

  it("components use token names, never raw hex", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith(".tsx") && !p.endsWith(".test.tsx")) files.push(p);
      }
    };
    walk(join(root, "src"));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      expect(readFileSync(f, "utf8").match(/#[0-9a-fA-F]{3,8}\b/g), f).toBeNull();
    }
  });
});
