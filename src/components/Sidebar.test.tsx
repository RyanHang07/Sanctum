import { act, render, screen } from "@testing-library/react";
import { Sidebar } from "./Sidebar";
import { useStore } from "../state/store";
import { TABS } from "../state/appState";
import { gsap } from "../lib/gsap";
import { setReducedMotion } from "../test/motion";

const initial = useStore.getState();

function renderSidebar(overrides: Partial<ReturnType<typeof useStore.getState>> = {}) {
  act(() => useStore.setState({ ...initial, ...overrides } as any, true));
  return render(<Sidebar pillMeta="4m left" />);
}

beforeEach(() => {
  act(() => useStore.setState(initial, true));
});

describe("Sidebar", () => {
  it("keeps a toggle with shortcut hint and no clipped hover tooltip markup", () => {
    renderSidebar({ appState: "open", activeTab: "today", settings: { ...initial.settings, sidebarCollapsed: false, displayName: "Ada" } });
    const toggle = screen.getByRole("button", { name: "Collapse sidebar" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveAttribute("title", "Collapse sidebar (Ctrl B)");
    expect(document.querySelector(".group-hover\\/toggle\\:flex")).toBeNull();
    expect(screen.queryByText("Ada")).toBeNull();
  });

  it("shows app version in the expanded sidebar", () => {
    renderSidebar({ settings: { ...initial.settings, sidebarCollapsed: false } });
    expect(screen.getByText(/^v\d+\.\d+$/)).toBeInTheDocument();
    // Read text, so muted, not faint (H3); the shortcut hints too.
    expect(screen.getByText(/^v\d+\.\d+$/)).toHaveClass("text-muted");
    expect(screen.getByRole("button", { name: /^Today/ }).querySelector(".font-mono")).toHaveClass("text-muted");
  });

  it("says why a tab is locked while sealed", () => {
    renderSidebar({ appState: "sealed", activeTab: "today", settings: { ...initial.settings, sidebarCollapsed: false } });
    const locked = TABS.filter((t) => t.id !== "today").map((t) => screen.getByRole("button", { name: new RegExp(`^${t.label}`) }));
    const described = locked.filter((b) => b.getAttribute("aria-disabled") === "true");
    expect(described.length).toBeGreaterThan(0);
    for (const b of described) expect(b).toHaveAttribute("aria-description", "Locked while sealed");
    expect(screen.getByRole("button", { name: /^Today/ })).not.toHaveAttribute("aria-description");
  });

  it("hides the version in the rail, even on hover, so the button stays put (v0.3.3)", () => {
    renderSidebar({ settings: { ...initial.settings, sidebarCollapsed: true } });
    const version = screen.getByText(/^v\d+\.\d+$/);
    expect(version.className).toContain("max-w-0");
    expect(version.className).not.toContain("group-hover");
    expect(version).toHaveAttribute("aria-hidden", "true");
  });

  describe("active indicator (motion spec §8)", () => {
    const ROW = 34;
    let restore: PropertyDescriptor | undefined;
    beforeEach(() => {
      // jsdom has no layout: give each nav row the offsetTop it would have.
      restore = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetTop");
      Object.defineProperty(HTMLElement.prototype, "offsetTop", {
        configurable: true,
        get(this: HTMLElement) {
          const id = this.getAttribute("data-nav-item");
          return id ? TABS.findIndex((t) => t.id === id) * ROW : 0;
        },
      });
    });
    afterEach(() => {
      if (restore) Object.defineProperty(HTMLElement.prototype, "offsetTop", restore);
    });

    const indicator = () => document.querySelector<HTMLElement>("[data-nav-indicator]")!;
    const y = () => Number(gsap.getProperty(indicator(), "y"));

    it("sits on the active row and paints its icon in the second color", () => {
      renderSidebar({ appState: "open", activeTab: "stats" });
      expect(y()).toBe(2 * ROW);
      const active = screen.getByRole("button", { name: /Stats/ });
      expect(active).toHaveAttribute("aria-current", "page");
      expect(active.querySelector("[data-nav-icon]")!.className).toContain("text-second");
      const other = screen.getByRole("button", { name: /Week/ });
      expect(other).not.toHaveAttribute("aria-current");
      expect(other.querySelector("[data-nav-icon]")!.className).not.toContain("text-second");
    });

    it("jumps under reduced motion", () => {
      renderSidebar({ appState: "open", activeTab: "today" });
      act(() => useStore.getState().navigate("trackers"));
      expect(gsap.isTweening(indicator())).toBe(false);
      expect(y()).toBe(TABS.findIndex((t) => t.id === "trackers") * ROW);
    });

    it("glides to the new row when motion is on", () => {
      setReducedMotion(false);
      renderSidebar({ appState: "open", activeTab: "today" });
      expect(y()).toBe(0); // the first placement never glides
      act(() => useStore.getState().navigate("stats"));
      const tweens = gsap.getTweensOf(indicator());
      expect(tweens.length).toBeGreaterThan(0);
      expect(y()).toBeLessThan(2 * ROW); // still on its way
      act(() => tweens.forEach((t) => t.progress(1)));
      expect(y()).toBe(2 * ROW);
    });
  });

  it("aligns the expanded status pill contents with nav rows", () => {
    renderSidebar({ settings: { ...initial.settings, sidebarCollapsed: false } });
    const pill = screen.getByTestId("state-pill");
    expect(pill.className).toContain("w-full");
    expect(pill.className).toContain("gap-[10px]");
  });
});
