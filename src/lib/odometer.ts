// The odometer's plan (motion spec §1.5), kept pure so it can be tested without a DOM.
//
// Each digit of the formatted figure ("1h 18m") is a column holding an 11-cell strip. Counting
// up, cell i shows digit i and cell 10 repeats 0, so 9 → 0 turns forward into cell 10 and then
// snaps back to cell 0. Counting down the strip runs 9..0 then 9 again, with the same rule.

export type Direction = "up" | "down";

/** Cells per strip: 0..9 and the repeated first digit. */
export const CELLS = 11;

export type Roll = { col: number; fromIndex: number; toIndex: number; wrapTo?: number };
export type Plan = Roll[] | { skeleton: true };

const isDigit = (c: string) => c >= "0" && c <= "9";

/** The figure with every digit replaced: "1h 18m" → "#h ##m". Two figures roll column by column only when this matches. */
export const skeletonOf = (text: string) => Array.from(text, (c) => (isDigit(c) ? "#" : c)).join("");

/** The digits of a figure, left to right. */
export const digitsOf = (text: string) => Array.from(text).filter(isDigit).map(Number);

/** Where a digit sits on a strip of the given direction. */
export const cellOf = (digit: number, direction: Direction) => (direction === "up" ? digit : 9 - digit);

/** The strip's digits, top to bottom. */
export const stripOf = (direction: Direction) => Array.from({ length: CELLS }, (_, i) => (direction === "up" ? i % 10 : 9 - (i % 10)));

/** yPercent that shows cell i. */
export const cellY = (i: number) => -i * (100 / CELLS);

/**
 * Which columns roll, from where to where. Only changed columns appear, left to right; the caller
 * rolls them rightmost first. A different skeleton (a column added, "59m" → "1h") is one swap.
 */
export function rollPlan(from: string, to: string, direction: Direction = "up"): Plan {
  if (from === to) return [];
  if (skeletonOf(from) !== skeletonOf(to)) return { skeleton: true };
  const a = digitsOf(from);
  const b = digitsOf(to);
  const plan: Roll[] = [];
  b.forEach((d, col) => {
    if (a[col] === d) return;
    const fromIndex = cellOf(a[col], direction);
    const target = cellOf(d, direction);
    // Wrapping onto the first digit turns forward to the repeated cell, then snaps to the top.
    if (target === 0 && fromIndex > 0) plan.push({ col, fromIndex, toIndex: CELLS - 1, wrapTo: 0 });
    else plan.push({ col, fromIndex, toIndex: target });
  });
  return plan;
}
