import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gsap } from "./gsap";
import { Glide, GLIDE, useRolling } from "./motion";
import { finish, moment, seek, setReducedMotion, setShown } from "../test/motion";

function Rolling({ value }: { value: number }) {
  return <span data-testid="n">{useRolling(value, 1)}</span>;
}
const shown = () => Number(screen.getByTestId("n").textContent);

describe("useRolling", () => {
  it("shows the first value at once", () => {
    setReducedMotion(false);
    render(<Rolling value={40} />);
    expect(shown()).toBe(40);
    expect(moment("rolling")).toBeUndefined();
  });

  it("rolls to a new value", () => {
    setReducedMotion(false);
    const { rerender } = render(<Rolling value={40} />);
    rerender(<Rolling value={50} />);
    const t = moment("rolling")!;
    expect(t.duration()).toBe(1);
    seek(t, 0.5);
    expect(shown()).toBeGreaterThan(40);
    expect(shown()).toBeLessThan(50);
    finish(t);
    expect(shown()).toBe(50);
  });

  it("snaps under reduced motion", () => {
    const { rerender } = render(<Rolling value={40} />);
    rerender(<Rolling value={50} />);
    expect(shown()).toBe(50);
    expect(moment("rolling")).toBeUndefined();
  });

  it("snaps while the window is hidden", () => {
    setReducedMotion(false);
    const { rerender } = render(<Rolling value={40} />);
    setShown(false);
    rerender(<Rolling value={50} />);
    expect(shown()).toBe(50);
    expect(moment("rolling")).toBeUndefined();
  });
});

/** Rows whose layout we control (jsdom has none). Like a browser, the drawn box includes the glide's transform. */
let tops: Record<string, number> = {};
const placeRows = (next: Record<string, number>) => void (tops = next);
const realRect = Element.prototype.getBoundingClientRect;
beforeEach(() => {
  tops = {};
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const row = this.hasAttribute("data-glide");
    // GSAP's own cache, not getProperty (which can measure, and would land back here).
    const y = parseFloat(String((this as { _gsap?: { y?: string } })._gsap?.y ?? 0)) || 0;
    const top = row ? (tops[this.textContent!] ?? 0) + y : 0;
    return { x: 0, y: top, left: 0, top, right: 100, bottom: top + 20, width: 100, height: 20, toJSON: () => ({}) } as DOMRect;
  };
});
afterEach(() => {
  Element.prototype.getBoundingClientRect = realRect;
});

function List({ ids }: { ids: string[] }) {
  return (
    <div>
      {ids.map((id) => (
        <Glide key={id} className="row">
          {id}
        </Glide>
      ))}
    </div>
  );
}

describe("Glide", () => {
  it("keeps its className and children in a plain wrapper", () => {
    render(<List ids={["a"]} />);
    expect(screen.getByText("a")).toHaveClass("row");
  });

  it("glides a row from its old place to its new one", () => {
    setReducedMotion(false);
    placeRows({ a: 0, b: 20 });
    const { rerender } = render(<List ids={["a", "b"]} />);
    placeRows({ a: 20, b: 0 });
    rerender(<List ids={["b", "a"]} />);
    const a = screen.getByText("a");
    const b = screen.getByText("b");
    // Each starts drawn where it was, and travels to its new place.
    expect(a.getBoundingClientRect().top).toBe(0);
    expect(b.getBoundingClientRect().top).toBe(20);
    const tween = gsap.getTweensOf(a)[0];
    expect(tween.duration()).toBeCloseTo(GLIDE.duration);
    finish(tween);
    expect(a.getBoundingClientRect().top).toBe(20);
    expect(a.style.transform).toBe("");
  });

  it("carries on from where it is when the list moves again mid-glide", () => {
    setReducedMotion(false);
    placeRows({ a: 0, b: 20 });
    const { rerender } = render(<List ids={["a", "b"]} />);
    placeRows({ a: 20, b: 0 });
    rerender(<List ids={["b", "a"]} />);
    const a = screen.getByText("a");
    seek(gsap.getTweensOf(a)[0], GLIDE.duration / 2);
    const drawn = a.getBoundingClientRect().top;
    expect(drawn).toBeGreaterThan(0);
    expect(drawn).toBeLessThan(20);
    placeRows({ a: 0, b: 20 });
    rerender(<List ids={["a", "b"]} />);
    // The new glide starts where the row was drawn, not from either resting place.
    expect(a.getBoundingClientRect().top).toBeCloseTo(drawn);
  });

  it("does not move under reduced motion", () => {
    const spy = vi.spyOn(gsap, "fromTo");
    placeRows({ a: 0, b: 20 });
    const { rerender } = render(<List ids={["a", "b"]} />);
    placeRows({ a: 20, b: 0 });
    rerender(<List ids={["b", "a"]} />);
    expect(spy).not.toHaveBeenCalled();
    expect(screen.getByText("a").getBoundingClientRect().top).toBe(20);
    spy.mockRestore();
  });
});
