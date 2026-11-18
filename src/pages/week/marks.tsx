import type { ReactNode } from "react";
import type { DayStat, DayStatus } from "../../lib/types";
import { WeekIcon } from "../../components/icons";

// Week's own marks (ProtoWeek.dc.html, without the glow: the app is flat since 2026-11-16).
// Day states: kept is a solid second-color dot (decoration, never an action), today is the
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

/**
 * A calendar event's mark (decided 2026-11-16): a small calendar glyph in the slot where a task
 * has its checkbox, in neutral muted. Events no longer carry a color of their own, so the event
 * color stays the In event state's, and the second color stays the kept mark's.
 */
export function EventMark({ size = 14 }: { size?: 14 | 16 }) {
  return (
    <span role="img" aria-label="Calendar event" data-event-mark className={`flex shrink-0 items-center justify-center text-muted ${size === 16 ? "h-4 w-4" : "mt-px h-[14px] w-[14px]"}`}>
      <WeekIcon size={size} />
    </span>
  );
}
