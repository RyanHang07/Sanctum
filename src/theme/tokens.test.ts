import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { buildColors, durationsMin, theme, tokens, windowSize } from "./tokens";
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
  });

  it("exposes every token color to Tailwind by name", () => {
    const colors = buildColors();
    expect(colors.app).toBe("#0B0D12");
    expect(colors["text-2"]).toBe("#B8BFCC");
    expect(colors.sealed).toMatchObject({
      DEFAULT: "#2F5BFF",
      text: "#7A95FF",
      "text-hover": "#A9BBFF",
      on: "#FFFFFF",
      tint: "#172040",
      line: "#1F3482",
    });
    expect(colors.event).toMatchObject({ DEFAULT: "#5FD4C8", tint: "#10262A", line: "#1F4A4A" });
    expect(colors.held).toEqual({ "1": "#1F3FD9", "2": "#2F5BFF", "3": "#6A4CFF", "4": "#12A8C9" });
    for (const name of Object.keys(tokens.color)) expect(colors, name).toHaveProperty(name);
  });

  it("wires radii, control and row heights, sidebar width, and fonts into the Tailwind config", () => {
    const ext = tailwindConfig.theme.extend;
    expect(ext).toBe(theme);
    expect(ext.borderRadius).toEqual({ control: "6px", panel: "8px", dialog: "12px" });
    expect(ext.spacing).toEqual({ control: "32px", row: "34px", sidebar: "220px", "sidebar-rail": "60px" });
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
    expect([...durationsMin]).toEqual([30, 60, 90, 120]);
  });

  it("matches the Tauri main window config", () => {
    const conf = JSON.parse(readFileSync(join(root, "src-tauri/tauri.conf.json"), "utf8"));
    const main = conf.app.windows.find((w: { label: string }) => w.label === "main");
    expect(main).toMatchObject({
      width: windowSize.width,
      height: windowSize.height,
      center: true,
      resizable: false,
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
