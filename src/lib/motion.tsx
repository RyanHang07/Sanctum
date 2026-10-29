import { useEffect, useRef, useState, type ReactNode } from "react";
import { animate, motion, useReducedMotion } from "motion/react";

// Motion (v0.2): crisp and snappy. Short, decelerating moves; nothing bounces. Every animation
// here also respects Windows' "reduce motion" (MotionConfig reducedMotion="user" in AppShell).

/** The app's UI easing (src/theme/extra.json "ui"). */
export const EASE = [0.2, 0, 0, 1] as const;
/** How long a row takes to glide to its new place. */
export const GLIDE = { duration: 0.18, ease: EASE };

/**
 * A list row that glides to its new place when the list reorders (dragged, checked to the
 * bottom, moved by Alt+arrows) instead of jumping there. The row's own element stays a plain
 * div inside, so native drag-and-drop on it keeps working.
 */
export function Glide({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div layout="position" transition={{ layout: GLIDE }} className={className}>
      {children}
    </motion.div>
  );
}

/**
 * A number that rolls to its new value (focus time, a counter's total) instead of snapping.
 * The first value shows at once; reduced motion snaps every time.
 */
export function useRolling(value: number, duration = 0.45): number {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  const reduce = useReducedMotion();
  useEffect(() => {
    if (reduce || from.current === value) {
      from.current = value;
      setShown(value);
      return;
    }
    const run = animate(from.current, value, { duration, ease: EASE, onUpdate: setShown });
    from.current = value;
    return () => run.stop();
  }, [value, duration, reduce]);
  return shown;
}
