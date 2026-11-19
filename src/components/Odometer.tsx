import { useRef, useState } from "react";
import { DUR, EASE, gsap, useGSAP } from "../lib/gsap";
import { useMotion } from "../lib/useMotion";
import { cellOf, cellY, rollPlan, skeletonOf, stripOf, type Direction } from "../lib/odometer";

// The shared digit roll (motion spec §1.5): live minutes, time left, the streak, tracker totals
// and the intercept countdown. Each digit is a column seen through a masked window, so a change
// reads as a counter turning, not a fade. Screen readers get the plain text.

const isDigit = (c: string) => c >= "0" && c <= "9";

/** A column's window: one digit tall, fading at its top and bottom edges. overflow-hidden, not
 *  clip: a hidden inline-block takes its bottom edge as its baseline, so the strip's last digit
 *  can't stretch the line it sits in. */
const COL = "inline-block h-[1em] overflow-hidden [mask-image:linear-gradient(transparent,black_22%,black_78%,transparent)]";
const CELL = "block h-[1em] leading-none";
/** A letter or space beside the digits: the same 1em hidden inline-block, so its baseline is its
 *  bottom edge too and every character in a figure sits on one line. */
const CHAR = "inline-block h-[1em] overflow-hidden leading-none";

function Column({ col, digit, direction }: { col: number; digit: number; direction: Direction }) {
  return (
    <span data-col={col} data-digit={digit} className={COL}>
      {/* The DOM's resting state is the final digit (a margin, so the transform stays GSAP's
          alone); GSAP only plays the strip in from the old digit and then clears itself. */}
      <span data-strip className="flex flex-col" style={{ marginTop: `${-cellOf(digit, direction)}em` }}>
        {stripOf(direction).map((d, i) => (
          <span key={i} className={CELL}>
            {d}
          </span>
        ))}
      </span>
    </span>
  );
}

function Figure({ text, direction, which }: { text: string; direction: Direction; which: "new" | "old" }) {
  let col = 0;
  return (
    // Inline, not flex (2026-11-18): as flex items the columns took their baseline from the first
    // digit of the shifted strip, and the figure sat a line below the words beside it.
    <span data-figure={which} className="whitespace-nowrap [grid-area:1/1]">
      {Array.from(text).map((c, i) =>
        isDigit(c) ? (
          <Column key={i} col={col++} digit={Number(c)} direction={direction} />
        ) : (
          <span key={i} className={CHAR}>
            {c ===" " ? " " : c}
          </span>
        ),
      )}
    </span>
  );
}

type Shown = { text: string; from: string | null; old: string | null };

/**
 * A figure ("1h 18m", "42", "0:14") whose changed digits roll like a mechanical counter, rightmost
 * first. When the figure's shape changes ("59m" → "1h") the whole figure rolls over as one.
 * The first value shows at once; reduced motion and a hidden window change digits without rolling.
 */
export function Odometer({
  text,
  direction = "up",
  delay = 0,
  className = "",
}: {
  text: string;
  /** "down" for countdowns: digits roll the other way. */
  direction?: Direction;
  /** Seconds to wait before rolling (to land after an earlier beat). */
  delay?: number;
  className?: string;
}) {
  const root = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState<Shown>({ text, from: null, old: null });
  if (shown.text !== text) {
    // A new value: remember where it came from, and keep the old figure while a new shape rolls in.
    setShown({ text, from: shown.text, old: skeletonOf(shown.text) !== skeletonOf(text) ? shown.text : null });
  }
  const { run } = useMotion(root);

  useGSAP(
    () => {
      const { from, old } = shown;
      if (from == null) return;
      const sign = direction === "up" ? 1 : -1;
      if (old != null) {
        run(() =>
          gsap
            .timeline({
              id: "odometer",
              delay,
              defaults: { duration: DUR.state, ease: EASE.glide },
              onComplete: () => setShown((s) => (s.old === old ? { ...s, old: null } : s)),
            })
            .to("[data-figure='old']", { yPercent: -60 * sign, autoAlpha: 0 }, 0)
            .from("[data-figure='new']", { yPercent: 60 * sign, autoAlpha: 0, clearProps: "transform,opacity,visibility" }, 0),
        );
        return;
      }
      const plan = rollPlan(from, shown.text, direction);
      if (!Array.isArray(plan) || plan.length === 0) return;
      run(() => {
        const tl = gsap.timeline({ id: "odometer", delay, defaults: { duration: DUR.glide, ease: EASE.glide } });
        plan.forEach((p, k) => {
          const strip = root.current?.querySelector(`[data-figure='new'] [data-col="${p.col}"] [data-strip]`);
          if (!strip) return;
          // Offsets from the resting cell. A wrap ends on the repeated cell, which looks the same
          // as the resting one, so clearing the transform at the end is never seen.
          const rest = p.wrapTo ?? p.toIndex;
          tl.fromTo(
            strip,
            { yPercent: cellY(p.fromIndex - rest) },
            { yPercent: cellY(p.toIndex - rest), clearProps: "transform" },
            (plan.length - 1 - k) * 0.04, // rightmost first
          );
        });
        return tl;
      });
    },
    { scope: root, dependencies: [shown] },
  );

  return (
    <span ref={root} data-odo className={`relative inline-grid align-[-0.2em] tabular-nums leading-none ${className}`}>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true" className="inline-grid">
        {shown.old != null ? <Figure key={`old:${shown.old}`} text={shown.old} direction={direction} which="old" /> : null}
        <Figure key={`new:${skeletonOf(shown.text)}`} text={shown.text} direction={direction} which="new" />
      </span>
    </span>
  );
}
