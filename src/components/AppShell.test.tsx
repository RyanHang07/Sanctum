import { readFileSync } from "node:fs";
import { act, render } from "@testing-library/react";
import { AppShell } from "./AppShell";
import { useStore } from "../state/store";
import { resetMockBackend } from "../lib/mockBackend";
import { native } from "../lib/native";
import { sampleProfiles } from "../lib/catalog";
import { gsap } from "../lib/gsap";
import { moment, seek, setReducedMotion } from "../test/motion";

const initial = useStore.getState();

beforeEach(async () => {
  resetMockBackend();
  useStore.setState(initial, true);
  for (const d of sampleProfiles()) await native.createProfile(d);
  await native.setSetting("onboarded", "1");
});

async function renderShell() {
  render(<AppShell />);
  await act(async () => await useStore.getState().loadProfiles());
  return document.querySelector<HTMLElement>("[data-page]")!;
}

describe("moving between screens (motion spec §8)", () => {
  it("the new screen rises in: a short fade up from 6px", async () => {
    setReducedMotion(false);
    const page = await renderShell();
    expect(moment("page-swap")).toBeUndefined(); // the first screen just appears
    act(() => useStore.getState().navigate("notes"));
    expect(page).toHaveAttribute("data-page", "notes");
    const tl = moment("page-swap")!;
    expect(tl).toBeDefined();
    seek(tl, 0);
    expect(Number(gsap.getProperty(page, "opacity"))).toBe(0);
    expect(gsap.getProperty(page, "y")).toBe(6);
    seek(tl, tl.duration());
    expect(Number(gsap.getProperty(page, "opacity"))).toBe(1);
    expect(tl.duration()).toBeLessThanOrEqual(0.3);
  });

  it("swaps at once under reduced motion", async () => {
    const page = await renderShell();
    act(() => useStore.getState().navigate("notes"));
    expect(moment("page-swap")!.progress()).toBe(1);
    expect(Number(gsap.getProperty(page, "opacity"))).toBe(1);
  });

  it("drops the page-wide fade-and-rise", async () => {
    const page = await renderShell();
    expect(document.querySelector(".page-in")).toBeNull();
    act(() => useStore.setState({ appState: "event" }));
    expect(page.getAnimations?.() ?? []).toHaveLength(0);
    expect(page.style.filter).toBe("");
  });
});

describe("focus ring (design critique finding 6)", () => {
  const css = readFileSync("src/styles.css", "utf8");
  const start = css.indexOf("/* ---- Focus ring");
  const block = css.slice(start, css.indexOf("/* ---- end focus ring"));

  it("is one unlayered :focus-visible rule in the accent token", () => {
    expect(start).toBeGreaterThan(-1);
    // Brace depth 0: outside every @layer, so a utility's outline-none cannot beat it.
    const depth = [...css.slice(0, start)].reduce((d, c) => d + (c === "{" ? 1 : c === "}" ? -1 : 0), 0);
    expect(depth).toBe(0);
    expect(block).toContain(":focus-visible");
    expect(block).toContain("outline: 2px solid theme(colors.sealed.DEFAULT)");
    expect(block).toMatch(/border-color: theme\(colors\.sealed\.DEFAULT\)/);
    expect(block).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });

  it("covers buttons, links, tabs, fields and the opt-in class", () => {
    for (const sel of ["button", "a[href]", '[role="tab"]', '[role="switch"]', "select", "textarea", ".focus-ring", ".focus-ring-within"]) {
      expect(block).toContain(sel);
    }
  });

  it("is never removed without a replacement in the shell", () => {
    for (const f of ["AppShell", "Sidebar", "CommandBar", "Toast", "Button", "controls", "icons"]) {
      expect(readFileSync(`src/components/${f}.tsx`, "utf8"), f).not.toContain("outline-none");
    }
  });
});

describe("Pending cascades in with the screens' rise-in", () => {
  it("opening it rises each row in, 40ms apart", async () => {
    setReducedMotion(false);
    const { PendingTab } = await import("../pages/week/Pending");
    const { getByRole, getByTestId } = render(<PendingTab />);
    act(() => getByRole("button", { name: "Show pending" }).click());
    const tl = moment("pending-cascade")!;
    expect(tl).toBeDefined();
    seek(tl, 0);
    const first = getByTestId("pending-tab").querySelector("[data-pending-list] > *")!;
    expect(first).not.toBeNull();
    expect(Number(gsap.getProperty(first, "opacity"))).toBe(0);
    expect(tl.duration()).toBeCloseTo(0.24); // one rise-in; more rows add 40ms each
    seek(tl, tl.duration());
    expect(Number(gsap.getProperty(first, "opacity"))).toBe(1);
  });
});
