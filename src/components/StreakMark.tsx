import { useEffect, useState } from "react";
import { EVENTS, native, onNative } from "../lib/native";
import type { DayStat, DayStatus } from "../lib/types";

// Streak marks under each day in Week (Week.dc.html) and a dot in Month (SPEC 4.10).

const STYLE: Partial<Record<DayStatus, { label: string; dot: string; box: string }>> = {
  kept: { label: "Kept", dot: "bg-sealed", box: "border-sealed-line bg-sealed-tint" },
  broken: { label: "Broken", dot: "bg-broken", box: "border-broken-line bg-broken-tint" },
  missed: { label: "Missed", dot: "bg-check-line", box: "border-line-input" },
  rest: { label: "Rest day", dot: "bg-muted", box: "border-line-input" },
  today: { label: "In progress", dot: "bg-sealed", box: "border-sealed-line" },
};

const shortClock = (t: number) =>
  new Date(t).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).replace(" AM", "a").replace(" PM", "p");

export function markLabel(d: DayStat): string | null {
  const s = STYLE[d.status];
  if (!s) return null;
  return d.status === "broken" && d.brokenAt ? `Broken ${shortClock(d.brokenAt)}` : s.label;
}

export function StreakMark({ day }: { day: DayStat | undefined }) {
  const s = day ? STYLE[day.status] : undefined;
  if (!day || !s) return null;
  return (
    <div data-testid="streak-mark" data-status={day.status} className={`mx-1 flex h-5 shrink-0 items-center gap-[6px] rounded-[4px] border px-[6px] text-[11px] text-text ${s.box}`}>
      <span className={`h-[6px] w-[6px] shrink-0 rounded-full ${s.dot}`} />
      <span className="truncate">{markLabel(day)}</span>
    </div>
  );
}

export function StreakDot({ day }: { day: DayStat | undefined }) {
  const s = day ? STYLE[day.status] : undefined;
  if (!day || !s) return null;
  return <span data-testid="streak-dot" data-status={day.status} title={markLabel(day) ?? undefined} className={`h-[6px] w-[6px] shrink-0 rounded-full ${s.dot}`} />;
}

/** Day stats for a range, by date. Refreshes when a session starts or ends. */
export function useDayStats(from: string, to: string): Record<string, DayStat> {
  const [days, setDays] = useState<Record<string, DayStat>>({});
  useEffect(() => {
    let live = true;
    const load = () =>
      void native
        .statsOverview(from, to)
        .then((o) => live && setDays(Object.fromEntries(o.days.map((d) => [d.date, d]))))
        .catch(() => undefined);
    load();
    const offs = [onNative(EVENTS.held, load), onNative(EVENTS.session, load)];
    return () => {
      live = false;
      for (const off of offs) void off.then((f) => f());
    };
  }, [from, to]);
  return days;
}
