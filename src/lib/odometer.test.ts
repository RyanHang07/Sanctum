import { describe, expect, it } from "vitest";
import { cellOf, rollPlan, skeletonOf, stripOf } from "./odometer";

describe("rollPlan", () => {
  it("rolls one column when one digit changes", () => {
    expect(rollPlan("42m", "43m")).toEqual([{ col: 1, fromIndex: 2, toIndex: 3 }]);
  });

  it("rolls a carry together, with 9 wrapping forward through the repeated 0", () => {
    expect(rollPlan("49m", "50m")).toEqual([
      { col: 0, fromIndex: 4, toIndex: 5 },
      { col: 1, fromIndex: 9, toIndex: 10, wrapTo: 0 },
    ]);
  });

  it("does nothing when nothing changed", () => {
    expect(rollPlan("1h 18m", "1h 18m")).toEqual([]);
  });

  it("swaps the whole figure when its shape changes", () => {
    expect(rollPlan("59m", "1h")).toEqual({ skeleton: true });
    expect(rollPlan("9", "10")).toEqual({ skeleton: true });
  });

  it("counts down on a reversed strip", () => {
    expect(rollPlan("5", "4", "down")).toEqual([{ col: 0, fromIndex: 4, toIndex: 5 }]);
    expect(rollPlan("0:10", "0:09", "down")).toEqual([
      { col: 1, fromIndex: 8, toIndex: 9 },
      { col: 2, fromIndex: 9, toIndex: 10, wrapTo: 0 },
    ]);
  });

  it("lays strips out so each cell shows its digit", () => {
    expect(stripOf("up")).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0]);
    expect(stripOf("down")).toEqual([9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 9]);
    for (const dir of ["up", "down"] as const) for (let d = 0; d < 10; d++) expect(stripOf(dir)[cellOf(d, dir)]).toBe(d);
  });

  it("names a figure's shape", () => {
    expect(skeletonOf("1h 18m")).toBe("#h ##m");
  });
});
