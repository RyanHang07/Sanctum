import { useRef } from "react";
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { gsap } from "./gsap";
import { useMotion } from "./useMotion";
import { finish, moment, seek, setReducedMotion, setShown } from "../test/motion";

/** A tiny moment: a box rises in, and a chime-like callback lands half way. */
function Moment({ onBeat, onLive }: { onBeat: () => void; onLive?: (live: boolean) => void }) {
  const root = useRef<HTMLDivElement>(null);
  const { run, live } = useMotion(root);
  onLive?.(live);
  return (
    <div ref={root}>
      <div data-box>box</div>
      <button
        type="button"
        onClick={() =>
          run(() =>
            gsap
              .timeline({ id: "test-moment" })
              .from("[data-box]", { y: 10, opacity: 0, duration: 1 })
              .call(onBeat, [], 0.5),
          )
        }
      >
        go
      </button>
    </div>
  );
}

const box = () => document.querySelector("[data-box]")!;

describe("useMotion", () => {
  it("plays the timeline when motion is live, and seeks like real playback", () => {
    setReducedMotion(false);
    const beat = vi.fn();
    const { getByText } = render(<Moment onBeat={beat} />);
    getByText("go").click();
    const tl = moment("test-moment")!;
    expect(tl.progress()).toBe(0);
    expect(Number(gsap.getProperty(box(), "y"))).toBe(10);
    seek(tl, 0.25);
    expect(beat).not.toHaveBeenCalled();
    seek(tl, 0.75);
    expect(beat).toHaveBeenCalledTimes(1);
    finish(tl);
    expect(Number(gsap.getProperty(box(), "y"))).toBe(0);
    expect(Number(gsap.getProperty(box(), "opacity"))).toBe(1);
  });

  it("jumps to the end under reduced motion, callbacks included", () => {
    const beat = vi.fn();
    const seen: boolean[] = [];
    const { getByText } = render(<Moment onBeat={beat} onLive={(l) => seen.push(l)} />);
    expect(seen.at(-1)).toBe(false);
    getByText("go").click();
    expect(moment("test-moment")!.progress()).toBe(1);
    expect(beat).toHaveBeenCalledTimes(1);
    expect(Number(gsap.getProperty(box(), "y"))).toBe(0);
  });

  it("jumps to the end while the window is hidden", () => {
    setReducedMotion(false);
    const beat = vi.fn();
    const seen: boolean[] = [];
    const { getByText } = render(<Moment onBeat={beat} onLive={(l) => seen.push(l)} />);
    expect(seen.at(-1)).toBe(true);
    setShown(false);
    expect(seen.at(-1)).toBe(false);
    expect(document.documentElement.dataset.windowHidden).toBe("");
    getByText("go").click();
    expect(moment("test-moment")!.progress()).toBe(1);
    expect(beat).toHaveBeenCalledTimes(1);
    setShown(true);
    expect(document.documentElement.dataset.windowHidden).toBeUndefined();
  });

  it("reverts its timelines on unmount", () => {
    setReducedMotion(false);
    const { getByText, unmount } = render(<Moment onBeat={() => undefined} />);
    getByText("go").click();
    expect(moment("test-moment")).toBeDefined();
    unmount();
    expect(gsap.globalTimeline.getChildren(true, true, true)).toHaveLength(0);
  });
});
