import { useEffect, useId, useRef } from "react";

export interface WheelOption<T> {
  value: T;
  label: string;
  /** Small secondary text under the label. */
  sub?: string;
}

const ROW = 40;
/** The selected row plus half a row of each neighbor. */
const WINDOW = ROW * 2;
/** Wheel deltas smaller than this are collected until they add up to one step (trackpads). */
const STEP_DELTA = 40;

const prefersReducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * A vertical picker that snaps to one value (the Home focus row, SPEC 4.12). Scroll one notch
 * per step, drag, use the arrow keys, or click a neighbor; it glides and locks onto the
 * nearest value. Changing `value` from outside (the schedule) scrolls it into place.
 */
export function Wheel<T extends string | number>({
  label,
  options,
  value,
  onChange,
  className = "",
  mono = false,
}: {
  label: string;
  options: readonly WheelOption<T>[];
  value: T | null;
  onChange: (v: T) => void;
  className?: string;
  mono?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  const settle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const wheelSum = useRef(0);
  const first = useRef(true);

  const select = (i: number) => {
    const o = options[Math.min(options.length - 1, Math.max(0, i))];
    if (o && o.value !== value) onChange(o.value);
  };

  // Keep the scroll position on the selected value.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.scrollTo?.({ top: index * ROW, behavior: first.current || prefersReducedMotion() ? "auto" : "smooth" });
    first.current = false;
  }, [index, options.length]);

  // One step per wheel notch (native scrolling would jump several rows at once).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      wheelSum.current += e.deltaY;
      if (Math.abs(wheelSum.current) < STEP_DELTA) return;
      const step = Math.sign(wheelSum.current);
      wheelSum.current = 0;
      const current = Math.round(el.scrollTop / ROW);
      select(current + step);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  });

  // Dragging with the mouse: follow the pointer, then lock onto the nearest row.
  const drag = useRef<{ y: number; top: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    const el = ref.current;
    if (!el || e.pointerType === "touch") return;
    drag.current = { y: e.clientY, top: el.scrollTop };
    el.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const el = ref.current;
    if (!el || !drag.current) return;
    el.scrollTop = drag.current.top - (e.clientY - drag.current.y);
  };
  const onPointerUp = () => {
    const el = ref.current;
    if (!el || !drag.current) return;
    const moved = Math.abs(el.scrollTop - drag.current.top) > 4;
    drag.current = null;
    if (moved) {
      const i = Math.round(el.scrollTop / ROW);
      if (i === index) el.scrollTo?.({ top: index * ROW, behavior: "smooth" });
      else select(i);
    }
  };

  // Touch and scrollbar scrolling: settle on the nearest row when it stops.
  const onScroll = () => {
    if (drag.current) return;
    clearTimeout(settle.current);
    settle.current = setTimeout(() => {
      const el = ref.current;
      if (!el) return;
      const i = Math.round(el.scrollTop / ROW);
      if (i !== index) select(i);
    }, 120);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") select(index + 1);
    else if (e.key === "ArrowUp") select(index - 1);
    else if (e.key === "Home") select(0);
    else if (e.key === "End") select(options.length - 1);
    else return;
    e.preventDefault();
  };

  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <span className="px-1 text-[11px] font-medium uppercase tracking-[0.06em] text-faint">{label}</span>
      <div className="relative rounded-panel border border-line-input bg-raised transition-colors duration-ui ease-ui focus-within:border-sealed hover:border-check-line">
        {/* The lock-in band. */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-1 rounded-control bg-line" style={{ top: ROW / 2, height: ROW }} />
        <div
          ref={ref}
          role="listbox"
          tabIndex={0}
          aria-label={label}
          aria-activedescendant={options.length ? `${id}-${index}` : undefined}
          onKeyDown={onKeyDown}
          onScroll={onScroll}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          className="relative cursor-grab snap-y snap-mandatory overflow-y-scroll outline-none [scrollbar-width:none] active:cursor-grabbing [&::-webkit-scrollbar]:hidden"
          style={{
            height: WINDOW,
            paddingBlock: ROW / 2,
            maskImage: "linear-gradient(to bottom, rgba(0, 0, 0, 0.2) 0%, black 25%, black 75%, rgba(0, 0, 0, 0.2) 100%)",
          }}
        >
          {options.map((o, i) => {
            const on = i === index;
            return (
              <div
                key={String(o.value)}
                id={`${id}-${i}`}
                role="option"
                aria-selected={on}
                onClick={() => select(i)}
                style={{ height: ROW }}
                className={`flex snap-center select-none flex-col items-center justify-center px-3 text-center transition-[color,font-size] duration-ui ease-ui ${
                  on ? "text-[15px] font-semibold text-text" : "text-body text-muted hover:text-text-2"
                } ${mono ? "font-mono" : ""}`}
              >
                <span className="max-w-full truncate leading-tight">{o.label}</span>
                {o.sub && on ? <span className="max-w-full truncate font-sans text-[10px] font-normal text-muted">{o.sub}</span> : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
