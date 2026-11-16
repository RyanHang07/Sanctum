import type { ReactNode } from "react";
import type { DayStat, DayStatus } from "../../lib/types";

// Week's own marks (ProtoWeek.dc.html, without the glow: the app is flat since 2026-11-16).
// Day states: kept is a solid second-colour dot (decoration, never an action), today is the
// accent, missed is a hollow ring, future has no mark. Ticked boxes stay the accent.

/** When a day sits relative to today: past items can slip, future ones are only planned. */
export type When = "past" | "today" | "future";
export const whenOf = (date: string, today: string): When => (date < today ? "past" : date === today ? "today" : "future");

const MARK: Partial<Record<DayStatus, { label: string; dot: string; chip: string }>> = {
  kept: { label: "Kept", dot: "bg-second", chip: "border-second-line text-second-text" },
  today: { label: "In progress", dot: "bg-sealed", chip: "border-sealed text-sealed-text" },
  missed: { label: "Missed", dot: "border-[1.5px] border-muted", chip: "border-line text-muted" },
  broken: { label: "Broken", dot: "bg-broken", chip: "border-broken-line text-broken-text" },
  rest: { label: "Rest day", dot: "border-[1.5px] border-dashed border-muted", chip: "border-line text-muted" },
};

const shortClock = (t: number) =>
  new Date(t).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).replace(" AM", "a").replace(" PM", "p");

/** The words for a day's mark, or null when it has none (future, or before any history). */
export function dayMarkLabel(d: DayStat | undefined): string | null {
  const s = d ? MARK[d.status] : undefined;
  if (!d || !s) return null;
  return d.status === "broken" && d.brokenAt ? `Broken ${shortClock(d.brokenAt)}` : s.label;
}

/** A day's state as a small chip under its name in Week. */
export function DayMark({ day }: { day: DayStat | undefined }) {
  const s = day ? MARK[day.status] : undefined;
  if (!day || !s) return null;
  return (
    <span
      data-testid="day-mark"
      data-status={day.status}
      className={`flex h-[22px] shrink-0 items-center gap-[7px] self-start rounded-control border px-2 text-meta font-semibold ${s.chip}`}
    >
      <span aria-hidden="true" className={`box-border h-[7px] w-[7px] shrink-0 rounded-full ${s.dot}`} />
      <span className="truncate">{dayMarkLabel(day)}</span>
    </span>
  );
}

/** The same state as a dot alone, for Month's cells. */
export function DayDot({ day }: { day: DayStat | undefined }) {
  const s = day ? MARK[day.status] : undefined;
  if (!day || !s) return null;
  return (
    <span
      data-testid="day-dot"
      data-status={day.status}
      title={dayMarkLabel(day) ?? undefined}
      className={`box-border h-[7px] w-[7px] shrink-0 rounded-full ${s.dot}`}
    />
  );
}

/**
 * A fold (motion spec §10.3): the row track opens 0fr → 1fr, the content fades in after 60 ms,
 * and closing is faster. Closed content stays mounted so it can animate, but is hidden from
 * focus and from screen readers (inert, aria-hidden). Reduced motion: the global rule in
 * styles.css shortens the transitions to nothing.
 */
export function Fold({ open, children, className = "" }: { open: boolean; children: ReactNode; className?: string }) {
  return (
    <div
      data-testid="fold"
      data-open={open || undefined}
      className={`grid transition-[grid-template-rows] ease-ui ${open ? "grid-rows-[1fr] duration-state" : "grid-rows-[0fr] duration-enter"} ${className}`}
    >
      <div
        aria-hidden={open ? undefined : true}
        inert={!open}
        className={`min-h-0 overflow-hidden transition-[opacity,visibility] duration-ui ease-ui ${open ? "visible opacity-100 delay-[60ms]" : "invisible opacity-0"}`}
      >
        {children}
      </div>
    </div>
  );
}

/** A checkbox's box: the accent when ticked, and the check draws itself (motion spec §10.1). */
export function TickBox({
  done,
  partial = false,
  size = 14,
  label,
  checked,
  onToggle,
}: {
  done: boolean;
  partial?: boolean;
  size?: 14 | 16;
  label: string;
  checked: boolean | "mixed";
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={onToggle}
      className={`box-border flex shrink-0 items-center justify-center rounded-[4px] p-0 text-sealed-on transition-colors duration-ui ease-ui ${size === 16 ? "h-4 w-4" : "mt-px h-[14px] w-[14px]"} ${
        done ? "border border-sealed bg-sealed" : partial ? "border border-sealed bg-sealed/25" : "border-[1.5px] border-check-line hover:border-muted"
      }`}
    >
      {partial && !done ? (
        <span className="h-[5px] w-[5px] rounded-[1px] bg-sealed" />
      ) : (
        <svg viewBox="0 0 12 12" fill="none" aria-hidden="true" className={size === 16 ? "h-[10px] w-[10px]" : "h-[9px] w-[9px]"}>
          <path
            data-check={done ? "on" : "off"}
            d="M2.5 6.3l2.4 2.4L9.6 3.8"
            pathLength={1}
            stroke="currentColor"
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`[stroke-dasharray:1] transition-[stroke-dashoffset] duration-enter ease-ui ${done ? "[stroke-dashoffset:0]" : "[stroke-dashoffset:1]"}`}
          />
        </svg>
      )}
    </button>
  );
}
