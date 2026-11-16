import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { DUR, EASE as EASES, gsap } from "./gsap";
import { useMotion } from "./useMotion";

// Motion: crisp and snappy. Short, decelerating moves; nothing bounces. Since the redesign this
// runs on GSAP (src/lib/gsap.ts) behind the same API it had on Framer Motion, and every
// animation here follows Windows' "reduce motion" and stops while the window is hidden (useMotion).

/** The app's UI easing as a bezier (src/theme/extra.json "ui"). GSAP code uses EASE.ui from ./gsap. */
export const EASE = [0.2, 0, 0, 1] as const;
/** How long a row takes to glide to its new place. */
export const GLIDE = { duration: DUR.enter, ease: EASE };

/**
 * A list row that glides to its new place when the list reorders (dragged, checked to the
 * bottom, moved by Alt+arrows) instead of jumping there. The row's own element stays a plain
 * div inside, so native drag-and-drop on it keeps working.
 *
 * Each render it measures where it sits in its list; if that moved since the last render, it
 * plays from the old place to the new one (a FLIP of one row, transform only). A row caught
 * mid-glide carries on from where it is.
 */
export function Glide({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const last = useRef<{ x: number; y: number } | null>(null);
  const { live, contextSafe } = useMotion(ref);
  const glide = useRef(contextSafe((el: HTMLDivElement, x: number, y: number) => {
    gsap.fromTo(el, { x, y }, { x: 0, y: 0, duration: GLIDE.duration, ease: EASES.ui, clearProps: "transform" });
  }));

  // No dependency list on purpose: the row's place can change on any render of its list.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const parent = el.parentElement;
    const box = el.getBoundingClientRect();
    const origin = parent?.getBoundingClientRect() ?? { left: 0, top: 0 };
    // Where it is drawn now, less any glide still running: its place in the layout.
    const dx = Number(gsap.getProperty(el, "x")) || 0;
    const dy = Number(gsap.getProperty(el, "y")) || 0;
    const now = { x: box.left - origin.left - dx, y: box.top - origin.top - dy };
    const before = last.current;
    last.current = now;
    if (!before || !live) return;
    const fromX = before.x + dx - now.x;
    const fromY = before.y + dy - now.y;
    if (Math.abs(fromX) < 0.5 && Math.abs(fromY) < 0.5) return;
    glide.current(el, fromX, fromY);
  });

  return (
    <div ref={ref} data-glide className={className}>
      {children}
    </div>
  );
}

/**
 * A number that rolls to its new value (focus time, a counter's total) instead of snapping.
 * The first value shows at once; reduced motion and a hidden window snap every time.
 */
export function useRolling(value: number, duration = 0.45): number {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  const scope = useRef<HTMLElement>(null);
  const { live } = useMotion(scope);
  useEffect(() => {
    if (!live || from.current === value) {
      from.current = value;
      setShown(value);
      return;
    }
    // From whatever is showing, so a value that changes mid-roll carries on without a jump.
    const proxy = { v: from.current };
    const tween = gsap.to(proxy, {
      id: "rolling",
      v: value,
      duration,
      ease: EASES.ui,
      overwrite: false,
      onUpdate: () => {
        from.current = proxy.v;
        setShown(proxy.v);
      },
      onComplete: () => void (from.current = value),
    });
    return () => {
      tween.kill();
    };
  }, [value, duration, live]);
  return shown;
}
