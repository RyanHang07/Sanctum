import { readFileSync } from "node:fs";
import { act, render, screen } from "@testing-library/react";
import { AppShell } from "./AppShell";
import { useStore } from "../state/store";
import { resetMockBackend } from "../lib/mockBackend";
import { EVENTS, native } from "../lib/native";
import { bus } from "../lib/bus";
import { sampleProfiles } from "../lib/catalog";
import { gsap } from "../lib/gsap";
import { MARK_PATHS } from "./AnimatedMark";
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

describe("moving between screens (motion spec §8, with the arches)", () => {
  const OUT = 0.12; // the old screen fades out
  const BEAT = 0.12; // only the arches show
  const RISE = 0.24; // the new screen rises in

  it("the old screen fades out, a beat of only the arches, then the new screen rises in", async () => {
    setReducedMotion(false);
    const page = await renderShell();
    const arches = document.querySelector("[data-arches]")!;
    expect(moment("page-swap")).toBeUndefined(); // the first screen just appears
    act(() => useStore.getState().navigate("notes"));
    const tl = moment("page-swap")!;
    expect(tl).toBeDefined();
    expect(tl.duration()).toBeCloseTo(OUT + BEAT + RISE);
    expect(tl.duration()).toBeLessThan(0.6);

    // At the start the old screen is still showing and the new one is not there yet.
    seek(tl, 0);
    expect(page).toHaveAttribute("data-page", "today");
    expect(Number(gsap.getProperty(page, "opacity"))).toBe(1);

    // In the beat: the new screen is mounted but hidden, and only the arches show.
    seek(tl, OUT + BEAT / 2);
    expect(page).toHaveAttribute("data-page", "notes");
    expect(Number(gsap.getProperty(page, "opacity"))).toBe(0);
    expect(arches.isConnected).toBe(true);

    // The rise starts 6px down.
    seek(tl, OUT + BEAT);
    expect(Number(gsap.getProperty(page, "opacity"))).toBe(0);
    expect(gsap.getProperty(page, "y")).toBe(6);

    seek(tl, tl.duration());
    expect(page).toHaveAttribute("data-page", "notes");
    expect(Number(gsap.getProperty(page, "opacity"))).toBe(1);
    expect(gsap.getProperty(page, "y")).toBe(0);
  });

  it("the arches stay put: nothing in the swap animates them", async () => {
    setReducedMotion(false);
    await renderShell();
    const arches = document.querySelector<SVGElement>("[data-arches]")!;
    act(() => useStore.getState().navigate("notes"));
    const tl = moment("page-swap")!;
    const targets = tl.getChildren(true, true, false).flatMap((t) => (t as gsap.core.Tween).targets());
    expect(targets).not.toContain(arches);
    expect(targets.some((t) => (t as Element).contains?.(arches))).toBe(false);
    seek(tl, OUT + BEAT / 2);
    expect(arches.getAttribute("style")).toBeNull();
  });

  it("switching again mid-swap drops the first swap and lands on the latest screen", async () => {
    setReducedMotion(false);
    const page = await renderShell();
    act(() => useStore.getState().navigate("notes"));
    const firstSwap = moment("page-swap")!;
    seek(firstSwap, OUT / 2);
    act(() => useStore.getState().navigate("journal"));
    const second = moment("page-swap")!;
    expect(second).not.toBe(firstSwap);
    // The first swap is gone, so it can never land on Notes.
    expect(firstSwap.parent).toBeFalsy(); // killed: off the global timeline
    seek(second, second.duration());
    expect(page).toHaveAttribute("data-page", "journal");
    expect(Number(gsap.getProperty(page, "opacity"))).toBe(1);
    // Fading out from half-faded takes less than a full fade.
    expect(second.duration()).toBeLessThan(OUT + BEAT + RISE);
  });

  it("swaps at once under reduced motion", async () => {
    const page = await renderShell();
    act(() => useStore.getState().navigate("notes"));
    expect(moment("page-swap")!.progress()).toBe(1);
    expect(page).toHaveAttribute("data-page", "notes");
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

describe("no scrollbars during a swap", () => {
  const SWAPPING = "data-swapping";

  it("hides the content area's scrollbars for the swap and gives them back when it lands", async () => {
    setReducedMotion(false);
    const page = await renderShell();
    expect(page).not.toHaveAttribute(SWAPPING);
    // The mark clips the moving layer and makes every scroller inside it paint no scrollbar.
    expect(page.className).toContain("data-swapping:overflow-hidden");
    expect(page.className).toContain("data-swapping:[&_*]:[scrollbar-color:transparent_transparent]");
    act(() => useStore.getState().navigate("setup"));
    const tl = moment("page-swap")!;
    seek(tl, 0.06);
    expect(page).toHaveAttribute(SWAPPING);
    seek(tl, 0.18); // the beat
    expect(page).toHaveAttribute(SWAPPING);
    seek(tl, tl.duration() - 0.01); // still rising
    expect(page).toHaveAttribute(SWAPPING);
    seek(tl, tl.duration());
    expect(page).not.toHaveAttribute(SWAPPING);
    await act(async () => {}); // the new page's loads land inside act
  });

  it("gives them back after a swap is interrupted by another", async () => {
    setReducedMotion(false);
    const page = await renderShell();
    act(() => useStore.getState().navigate("stats"));
    const first = moment("page-swap")!;
    seek(first, 0.06);
    act(() => useStore.getState().navigate("week"));
    const second = moment("page-swap")!;
    expect(page).toHaveAttribute(SWAPPING); // the new swap holds them
    first.progress(1); // the dead swap can no longer touch the mark
    expect(page).toHaveAttribute(SWAPPING);
    seek(second, second.duration());
    expect(page).not.toHaveAttribute(SWAPPING);
    await act(async () => {}); // the new page's loads land inside act
  });

  it("gives them back if a swap is killed with nothing after it", async () => {
    setReducedMotion(false);
    const page = await renderShell();
    act(() => useStore.getState().navigate("stats"));
    act(() => {
      moment("page-swap")!.kill();
    });
    expect(page).not.toHaveAttribute(SWAPPING);
  });

  it("never holds them under reduced motion", async () => {
    const page = await renderShell();
    act(() => useStore.getState().navigate("setup"));
    expect(moment("page-swap")!.progress()).toBe(1);
    expect(page).not.toHaveAttribute(SWAPPING);
    await act(async () => {}); // the new page's loads land inside act
  });
});

describe("the arches", () => {
  it("are the whole mark from the logo, torii in the text color and keyhole in the accent, faint, hidden from assistive tech", async () => {
    await renderShell();
    const arches = document.querySelector<SVGElement>("[data-arches]")!;
    expect(arches).not.toBeNull();
    expect(arches.closest("[aria-hidden=true]")).not.toBeNull();
    expect(arches.getAttribute("class")).toContain("pointer-events-none");

    const torii = arches.querySelector("[data-arches-torii]")!;
    expect(torii.getAttribute("class")).toContain("text-text");
    expect(torii.getAttribute("class")).toMatch(/opacity-\[0\.0\d+\]/);
    expect([...torii.querySelectorAll("path")].map((p) => p.getAttribute("d"))).toEqual([MARK_PATHS.beam]);
    const rects = [...torii.querySelectorAll("rect")].map((r) => ["x", "y", "width", "height"].map((k) => Number(r.getAttribute(k))));
    expect(rects).toEqual([MARK_PATHS.nuki, MARK_PATHS.legLeft, MARK_PATHS.legRight].map((r) => [r.x, r.y, r.width, r.height]));

    const key = arches.querySelector("[data-arches-key]")!;
    expect(key.getAttribute("class")).toContain("text-sealed");
    expect(key.getAttribute("class")).toMatch(/opacity-\[0\.0\d+\]/);
    const circle = key.querySelector("circle")!;
    expect(["cx", "cy", "r"].map((k) => Number(circle.getAttribute(k)))).toEqual([MARK_PATHS.keyCircle.cx, MARK_PATHS.keyCircle.cy, MARK_PATHS.keyCircle.r]);
    expect([...key.querySelectorAll("path")].map((p) => p.getAttribute("d"))).toEqual([MARK_PATHS.keyStem]);
    // Every shape takes its color from the group's token.
    for (const shape of arches.querySelectorAll("path, rect, circle")) expect(shape.getAttribute("fill")).toBe("currentColor");
  });

  it("keep the mark's own proportions: cropped to its extent, scaled uniformly, never stretched", async () => {
    await renderShell();
    const arches = document.querySelector<SVGElement>("[data-arches]")!;
    const [, , w, h] = arches.getAttribute("viewBox")!.split(" ").map(Number);
    expect(arches.getAttribute("preserveAspectRatio")).toBe("xMidYMid meet");
    expect(arches.getAttribute("class")).toContain(`[aspect-ratio:${w}/${h}]`);
    expect(arches.getAttribute("class")).toContain("w-auto");
  });

  it("draw every part a tad thinner by eroding it evenly, not by redrawing the paths", async () => {
    await renderShell();
    const arches = document.querySelector<SVGElement>("[data-arches]")!;
    const erode = arches.querySelector("filter feMorphology")!;
    expect(erode.getAttribute("operator")).toBe("erode");
    const r = Number(erode.getAttribute("radius"));
    expect(r).toBeGreaterThan(0);
    expect(r).toBeLessThan(0.4); // a tad: a 3.2-wide leg keeps most of its weight
    const id = erode.closest("filter")!.id;
    for (const g of arches.querySelectorAll("[data-arches-torii], [data-arches-key]")) expect(g.getAttribute("filter")).toBe(`url(#${id})`);
  });

  it("sit behind the screens, outside the part that moves", async () => {
    const page = await renderShell();
    const arches = document.querySelector("[data-arches]")!;
    expect(page.contains(arches)).toBe(false);
    expect(arches.compareDocumentPosition(page) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("use tokens, not raw colors", () => {
    expect(readFileSync("src/components/Arches.tsx", "utf8")).not.toMatch(/#[0-9a-f]{3,8}/i);
  });
});

describe("the close button in every state (H2)", () => {
  const held = { sessionId: 7, profileId: 1, profileName: "Interview Prep", plannedMinutes: 60, focusMinutes: 60, attempts: 0, broken: false };

  it("asks on the held page and in onboarding too, not only on the main screens", async () => {
    await renderShell();
    act(() => useStore.setState({ held }));
    await act(async () => bus.emit(EVENTS.closeRequested, null));
    expect(screen.getByRole("dialog", { name: "Close Sanctum" })).toBeInTheDocument();
    act(() => useStore.getState().closeCloseDialog());
    expect(screen.queryByRole("dialog", { name: "Close Sanctum" })).toBeNull();

    act(() => useStore.setState({ held: null, onboarding: true }));
    await act(async () => bus.emit(EVENTS.closeRequested, null));
    expect(screen.getByRole("dialog", { name: "Close Sanctum" })).toBeInTheDocument();
  });
});
