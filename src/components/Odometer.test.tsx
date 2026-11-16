import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { gsap } from "../lib/gsap";
import { cellY } from "../lib/odometer";
import { finish, moment, seek, setReducedMotion } from "../test/motion";
import { Odometer } from "./Odometer";

const strip = (col: number) => document.querySelector<HTMLElement>(`[data-figure='new'] [data-col="${col}"] [data-strip]`)!;
/** The cell a strip rests on (its margin, in em). */
const rest = (col: number) => -parseFloat(strip(col).style.marginTop);
/** The cell a strip is drawn on right now: its resting cell plus GSAP's offset. */
const drawn = (col: number) => rest(col) - parseFloat(String(gsap.getProperty(strip(col), "yPercent"))) / (100 / 11);

describe("Odometer", () => {
  it("gives screen readers the plain figure and shows each digit on its strip", () => {
    render(<Odometer text="1h 18m" />);
    expect(screen.getByText("1h 18m")).toHaveClass("sr-only");
    const cols = document.querySelectorAll("[data-figure='new'] [data-col]");
    expect(Array.from(cols, (c) => c.getAttribute("data-digit"))).toEqual(["1", "1", "8"]);
    expect(rest(2)).toBe(8);
    expect(strip(2).children[8].textContent).toBe("8");
    expect(moment("odometer")).toBeUndefined(); // the first value shows at once
  });

  it("rolls only the changed columns, rightmost first", () => {
    setReducedMotion(false);
    const { rerender } = render(<Odometer text="49m" />);
    rerender(<Odometer text="50m" />);
    const tl = moment("odometer")!;
    const rolls = tl.getChildren() as gsap.core.Tween[];
    expect(rolls).toHaveLength(2);
    const tens = rolls.find((t) => t.targets()[0] === strip(0))!;
    const ones = rolls.find((t) => t.targets()[0] === strip(1))!;
    expect(ones.startTime()).toBeLessThan(tens.startTime());
    seek(tl, 0);
    expect(drawn(1)).toBeCloseTo(9);
    expect(drawn(0)).toBeCloseTo(4);
    seek(tl, ones.endTime() - 0.0001);
    // 9 turns forward onto the repeated 0, then rests on the top cell.
    expect(drawn(1)).toBeCloseTo(10, 1);
    finish(tl);
    expect(drawn(1)).toBeCloseTo(0);
    expect(drawn(0)).toBeCloseTo(5);
    expect(strip(1).style.transform).toBe("");
    expect(screen.getByText("50m")).toBeInTheDocument();
  });

  it("changes digits without rolling under reduced motion", () => {
    const { rerender } = render(<Odometer text="42" />);
    rerender(<Odometer text="43" />);
    expect(moment("odometer")!.progress()).toBe(1);
    expect(drawn(1)).toBeCloseTo(3);
  });

  it("rolls the whole figure over when its shape changes, then drops the old one", () => {
    setReducedMotion(false);
    const { rerender } = render(<Odometer text="59m" />);
    rerender(<Odometer text="1h" />);
    expect(document.querySelector("[data-figure='old']")).not.toBeNull();
    finish("odometer");
    expect(document.querySelector("[data-figure='old']")).toBeNull();
    expect(document.querySelector("[data-figure='new'] [data-col]")!.getAttribute("data-digit")).toBe("1");
  });

  it("counts down on a reversed strip", () => {
    setReducedMotion(false);
    const { rerender } = render(<Odometer text="5" direction="down" />);
    rerender(<Odometer text="4" direction="down" />);
    seek("odometer", 0);
    expect(drawn(0)).toBeCloseTo(4); // on the down strip, 5 sits in cell 4 ...
    finish("odometer");
    expect(drawn(0)).toBeCloseTo(5); // ... and 4 in cell 5, one turn on
    expect(strip(0).children[5].textContent).toBe("4");
  });

  it("keeps cellY in step with the strip's 11 cells", () => {
    expect(cellY(11)).toBeCloseTo(-100);
  });
});
