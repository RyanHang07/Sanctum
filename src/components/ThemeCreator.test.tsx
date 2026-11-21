import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { DevStateToggle, resetDevTools } from "./DevStateToggle";
import { draftTheme, resetThemeCreator } from "./ThemeCreator";
import { useStore } from "../state/store";
import { useTheme } from "../state/theme";
import { applyTheme } from "../theme/palette";
import { contrast, toHex } from "../theme/color";
import { themeById } from "../theme/themes";
import { resetMockBackend } from "../lib/mockBackend";

const initial = useStore.getState();
const root = document.documentElement;
const v = (k: string) => root.style.getPropertyValue(`--s-${k}`);

beforeEach(() => {
  resetMockBackend();
  resetDevTools();
  resetThemeCreator();
  localStorage.clear();
  useStore.setState(initial, true);
  applyTheme(useTheme.getState().theme);
});

function openCreator() {
  render(<DevStateToggle />);
  fireEvent.click(screen.getByRole("button", { name: "Show dev tools" }));
  fireEvent.click(screen.getByRole("button", { name: "Theme creator" }));
  return within(screen.getByLabelText("Theme creator"));
}

describe("theme creator", () => {
  it("applies an edited color live, and Reset restores the saved theme", () => {
    const saved = useTheme.getState().theme.palette.app!;
    const c = openCreator();
    act(() => fireEvent.change(c.getByLabelText("App"), { target: { value: "#123456" } }));
    expect(v("app")).toBe("#123456");
    act(() => fireEvent.click(c.getByRole("button", { name: "Reset" })));
    expect(v("app")).toBe(saved);
  });

  it("closing shows the saved theme and reopening brings the draft back", () => {
    const saved = useTheme.getState().theme.palette.panel!;
    const c = openCreator();
    act(() => fireEvent.change(c.getByLabelText("Panel"), { target: { value: "#224466" } }));
    act(() => fireEvent.click(c.getByRole("button", { name: "Close theme creator" })));
    expect(v("panel")).toBe(saved);
    act(() => fireEvent.click(screen.getByRole("button", { name: "Theme creator" })));
    expect(v("panel")).toBe("#224466");
  });

  it("jumps between screens", () => {
    const c = openCreator();
    act(() => fireEvent.click(c.getByRole("button", { name: "Stats" })));
    expect(useStore.getState().activeTab).toBe("stats");
    act(() => fireEvent.click(c.getByRole("button", { name: "Setup" })));
    expect(useStore.getState().activeTab).toBe("setup");
  });

  it("derives the rest through the same pass real themes use", () => {
    const base = themeById("sanctum-dark")!;
    const colors = Object.fromEntries(["app", "panel", "raised", "sidebar", "line", "line-input", "text", "text-2", "muted", "faint", "sealed", "event", "second", "ok", "broken", "toast"].map((k) => [k, toHex(base.palette[k])]));
    // A muted color that fails is lifted to 4.5:1 by the finish pass.
    const t = draftTheme({ baseId: base.id, scheme: "dark", derive: true, colors: { ...colors, muted: "#2A2D35" } as never });
    expect(contrast(t.palette.muted!, t.palette.panel!)).toBeGreaterThanOrEqual(4.5);
    expect(t.palette["sealed-tint"]).toMatch(/^#/);
    expect(t.palette.second).toBeDefined();
  });

  it("edits the enabled green, and deriving works out its text, tint and line", () => {
    const base = themeById("sanctum-dark")!;
    const colors = Object.fromEntries(Object.entries(base.palette).map(([k, x]) => [k, toHex(x)]));
    const t = draftTheme({ baseId: base.id, scheme: "dark", derive: true, colors: { ...colors, ok: "#0A3A12" } as never });
    // A green too dark for the page is lifted to 3:1, its text to 4.5:1, and Open follows it.
    expect(contrast(t.palette.ok!, t.palette.app!)).toBeGreaterThanOrEqual(3);
    expect(contrast(t.palette["ok-text"]!, t.palette.panel!)).toBeGreaterThanOrEqual(4.5);
    expect(t.palette["ok-tint"]).not.toBe(base.palette["ok-tint"]);
    expect(t.palette.open).toBe(t.palette.ok);

    const c = openCreator();
    act(() => fireEvent.change(c.getByLabelText("Ok (enabled)"), { target: { value: "#22CC55" } }));
    expect(v("ok")).toBe("#22CC55");
    expect(v("open")).toBe("#22CC55");
    expect(c.getByText("Ok text on panel")).toBeInTheDocument();
  });

  it("reads rgba and short hex for the color inputs", () => {
    expect(toHex("rgba(255, 0, 16, 0.5)")).toBe("#FF0010");
    expect(toHex("#abc")).toBe("#AABBCC");
  });
});
