import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { useState } from "react";
import { gsap } from "../lib/gsap";
import { clearMoments } from "../lib/useMotion";
import { moment, setReducedMotion, setShown } from "../test/motion";
import { DayRuler } from "./DayRuler";
import { FocusPicker } from "./FocusPicker";
import { Home } from "./Home";
import { useStore } from "../state/store";
import { connectNativeEvents } from "../state/events";
import { resetMockBackend } from "../lib/mockBackend";
import { native } from "../lib/native";
import { sampleProfiles } from "../lib/catalog";
import { majorCrossed, rulerLabel, rulerSpan, rulerTicks, spoken } from "../state/session";

// Today (redesign S1): the day ruler, the goal moment, entering focus, and the keyboard pickers.

const initial = useStore.getState();
let disconnect = () => {};
beforeEach(() => {
  resetMockBackend();
  useStore.setState(initial, true);
  disconnect = connectNativeEvents();
});
afterEach(() => disconnect());

describe("the ruler's scale", () => {
  it("spans 3 hours, growing by whole hours to fit the goal and the day", () => {
    expect(rulerSpan(42, 120)).toBe(180);
    expect(rulerSpan(171, 120)).toBe(240);
    expect(rulerSpan(0, 240)).toBe(300);
  });

  it("ticks every 5 minutes, with half hours, hours and the goal marked", () => {
    const ticks = rulerTicks(180, 120);
    expect(ticks).toHaveLength(37);
    expect(ticks.find((t) => t.m === 30)!.kind).toBe("half");
    expect(ticks.find((t) => t.m === 60)!.kind).toBe("hour");
    expect(ticks.find((t) => t.m === 120)!.kind).toBe("goal");
    expect(ticks.find((t) => t.m === 25)!.kind).toBe("minor");
    // A goal off the grid still gets its own tick.
    expect(rulerTicks(180, 100).filter((t) => t.kind === "goal").map((t) => t.m)).toEqual([100]);
  });

  it("knows which half hour a minute crossed, never the goal", () => {
    expect(majorCrossed(89, 90, 120)).toBe(90);
    expect(majorCrossed(119, 120, 120)).toBeNull();
    expect(majorCrossed(42, 43, 120)).toBeNull();
    expect(majorCrossed(0, 1, 120)).toBeNull();
  });

  it("reads out the day for screen readers", () => {
    expect(spoken(78)).toBe("1 hour 18 minutes");
    expect(rulerLabel(42, 120)).toBe("42 minutes focused of a 2 hour goal, 1 hour 18 minutes left");
    expect(rulerLabel(125, 120)).toBe("2 hours 5 minutes focused of a 2 hour goal, goal met");
  });
});

describe("DayRuler live minutes", () => {
  const needle = () => document.querySelector("[data-needle]")!;

  it("places the needle at once on load and on a jump, and glides it one minute at a time", () => {
    setReducedMotion(false);
    const { rerender } = render(<DayRuler minutes={42} goal={120} />);
    expect(gsap.getProperty(needle(), "xPercent")).toBeCloseTo((42 / 180) * 100);
    expect(gsap.getTweensOf(needle()).filter((t) => t.duration() > 0)).toHaveLength(0);
    rerender(<DayRuler minutes={43} goal={120} />);
    expect(gsap.getTweensOf(needle()).filter((t) => t.duration() > 0)).toHaveLength(1);
    // A resume or a reload jumps: set, not animated.
    rerender(<DayRuler minutes={60} goal={120} />);
    expect(gsap.getTweensOf(needle()).filter((t) => t.duration() > 0)).toHaveLength(0);
    expect(gsap.getProperty(needle(), "xPercent")).toBeCloseTo((60 / 180) * 100);
    expect(screen.getByRole("img")).toHaveAccessibleName(rulerLabel(60, 120));
  });

  it("lights a crossed half hour, but leaves the goal tick to its own moment", () => {
    setReducedMotion(false);
    const { rerender } = render(<DayRuler minutes={89} goal={120} />);
    rerender(<DayRuler minutes={90} goal={120} />);
    expect(moment("tick-cross")).toBeDefined();
    expect(moment("tick-cross")!.getChildren()[0]!.targets()[0]).toBe(document.querySelector('[data-tick-light="90"]'));
    rerender(<DayRuler minutes={119} goal={120} />);
    gsap.globalTimeline.clear();
    rerender(<DayRuler minutes={120} goal={120} />);
    expect(moment("tick-cross")!.getChildren()[0]!.targets()[0]).not.toBe(document.querySelector('[data-tick-light="120"]'));
  });

  it("under reduced motion, values change without motion and no tick lights", () => {
    const { rerender } = render(<DayRuler minutes={89} goal={120} />);
    rerender(<DayRuler minutes={90} goal={120} />);
    expect(gsap.getTweensOf(needle()).filter((t) => t.duration() > 0)).toHaveLength(0);
    expect(moment("tick-cross")).toBeUndefined();
  });

  it("draws the goal tick in the second color and says kept once it's met", () => {
    const { rerender } = render(<DayRuler minutes={100} goal={120} />);
    expect(document.querySelector('[data-kind="goal"]')).toHaveClass("bg-second");
    expect(document.querySelector('[data-kind="hour"]')).toHaveClass("bg-muted");
    expect(document.querySelector("[data-goal-suffix]")).toBeNull();
    rerender(<DayRuler minutes={120} goal={120} />);
    expect(document.querySelector("[data-goal-suffix]")).toHaveTextContent("· kept");
    expect(document.querySelector("[data-goal-glow]")).not.toBeNull();
  });
});

async function withProfiles() {
  for (const d of sampleProfiles()) await native.createProfile(d);
  await act(() => useStore.getState().loadProfiles());
}

describe("Goal reached", () => {
  it("plays once when the goal is met on screen, and not when it was already met", async () => {
    setReducedMotion(false);
    act(() => useStore.setState({ focusTodayMin: 119 }));
    const { unmount } = render(<Home />);
    expect(moment("goal")).toBeUndefined();
    act(() => useStore.setState({ focusTodayMin: 120 }));
    const tl = moment("goal")!;
    expect(tl).toBeDefined();
    expect(tl.labels.flare).toBeCloseTo(0.3);
    expect(tl.labels.kept).toBeCloseTo(0.55);
    unmount();
    gsap.globalTimeline.clear();
    // Mounting with the goal already met: no stale celebration.
    clearMoments();
    render(<Home />);
    expect(document.querySelector("[data-goal-suffix]")).not.toBeNull();
    expect(moment("goal")).toBeUndefined();
    await act(async () => {}); // Today's loads land inside act, after the motion is checked
  });

  it("jumps to the kept state while the window is hidden", async () => {
    setReducedMotion(false);
    setShown(false);
    act(() => useStore.setState({ focusTodayMin: 119 }));
    render(<Home />);
    act(() => useStore.setState({ focusTodayMin: 120 }));
    expect(moment("goal")!.progress()).toBe(1);
    await act(async () => {});
  });
});

describe("Entering focus", () => {
  it("draws the seal line along the bottom edge, nothing traveling, then lets the track show", async () => {
    await withProfiles();
    setReducedMotion(false);
    await act(async () => void render(<Home />));
    act(() => useStore.getState().setAppState("sealed"));
    const tl = moment("enter-focus")!;
    expect(tl).toBeDefined();
    expect(tl.labels.line).toBeCloseTo(0.45);
    const line = document.querySelector<HTMLElement>("[data-seal-line]")!;
    // It draws left to right: no offset, only its width grows.
    act(() => void tl.seek(0.15));
    const mid = Number(gsap.getProperty(line, "scaleX"));
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    expect(gsap.getProperty(line, "x")).toBe(0);
    expect(gsap.getProperty(line, "y")).toBe(0);
    act(() => void tl.seek(0.3));
    expect(gsap.getProperty(line, "autoAlpha")).toBe(1);
    act(() => void tl.progress(1));
    // At the end, CSS owns the line again: hidden.
    expect(line.style.visibility).toBe("");
    expect(line).toHaveClass("invisible");
  });

  it("plays nothing for a session that was already running", async () => {
    await withProfiles();
    act(() => useStore.getState().setAppState("sealed"));
    await act(async () => void render(<Home />));
    expect(moment("enter-focus")).toBeUndefined();
  });

  it("jumps to its end under reduced motion", async () => {
    await withProfiles();
    await act(async () => void render(<Home />));
    act(() => useStore.getState().setAppState("sealed"));
    expect(moment("enter-focus")!.progress()).toBe(1);
    expect(screen.getByRole("button", { name: "End early" })).toBeInTheDocument();
  });
});

describe("Days strip key", () => {
  it("is part of the streak button, hidden until hover or keyboard focus", () => {
    render(<Home />);
    const key = screen.getByTestId("streak-key");
    expect(screen.getByTestId("streak")).toContainElement(key);
    expect(key).toHaveAttribute("aria-hidden", "true");
    expect(key).toHaveClass("opacity-0", "group-hover:opacity-100", "group-focus-visible:opacity-100");
    expect(key).toHaveTextContent("KeptMissedToday");
  });
});

describe("FocusPicker keyboard", () => {
  const options = [
    { value: 15, label: "15 min" },
    { value: 30, label: "30 min" },
    { value: 45, label: "45 min" },
  ];
  function Harness() {
    const [v, setV] = useState(30);
    return <FocusPicker label="Length" options={options} value={v} onChange={setV} mono />;
  }
  const trigger = () => screen.getByRole("button", { name: /^Length / });

  it("opens on the current choice, moves with arrows, picks with a press, and returns focus", () => {
    render(<Harness />);
    expect(trigger()).toHaveAccessibleName("Length 30 min");
    fireEvent.keyDown(trigger(), { key: "ArrowDown" });
    const list = screen.getByRole("listbox", { name: "Length" });
    expect(trigger()).toHaveAttribute("aria-expanded", "true");
    expect(document.activeElement).toBe(within(list).getByRole("option", { name: "30 min" }));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(within(list).getByRole("option", { name: "45 min" }));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" }); // wraps
    expect(document.activeElement).toBe(within(list).getByRole("option", { name: "15 min" }));
    fireEvent.keyDown(document.activeElement!, { key: "End" });
    fireEvent.click(document.activeElement!);
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(trigger()).toHaveAccessibleName("Length 45 min");
    expect(document.activeElement).toBe(trigger());
  });

  it("closes on Escape without picking, and jumps by letter", () => {
    function Names() {
      const [v, setV] = useState("deep");
      return (
        <FocusPicker
          label="Profile"
          options={[
            { value: "deep", label: "Deep Work" },
            { value: "study", label: "Study" },
            { value: "light", label: "Light Work" },
          ]}
          value={v}
          onChange={setV}
        />
      );
    }
    render(<Names />);
    const t = screen.getByRole("button", { name: /^Profile / });
    fireEvent.click(t);
    fireEvent.keyDown(document.activeElement!, { key: "l" });
    expect(document.activeElement).toHaveTextContent("Light Work");
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(t).toHaveAccessibleName("Profile Deep Work");
    expect(document.activeElement).toBe(t);
  });
});
