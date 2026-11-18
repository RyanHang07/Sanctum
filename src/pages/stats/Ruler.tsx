import { useEffect, useRef } from "react";
import { DUR, EASE, gsap } from "../../lib/gsap";
import { useMotion } from "../../lib/useMotion";
import { fromKey } from "../../lib/planner";
import { dayDetail } from "../../lib/stats";
import { minutes } from "../../lib/time";
import type { DayStat, StatsOverview } from "../../lib/types";
import { barPct, chartAxis, chartHours, focusScale } from "./scale";

// Stats' Ruler direction (ProtoStats.dc.html, without its glow: the app is flat since 2026-11-16).
// Bars are focused minutes in the accent; a kept day gets a short second-color mark on its cap,
// like Week's kept dot. The axis is a thin tick scale (hours in the second color, quarter hours in
// the line color) and the daily goal is a dashed second-color line. No best-day mark (decided).

/** The word under a day's name, when its state isn't plain from the bar. */
export const DAY_NOTE: Partial<Record<DayStat["status"], string>> = {
  broken: "Broken",
  missed: "Missed",
  rest: "Rest",
  today: "Today",
};

function barClass(d: DayStat): string {
  switch (d.status) {
    case "kept":
      return "border-[1.5px] border-sealed bg-sealed";
    case "today":
      return "border-[1.5px] border-sealed bg-sealed-tint";
    case "broken":
      return "border border-broken bg-broken-tint";
    case "rest":
      return "border border-dashed border-muted";
    default:
      // Missed, or before your history: a quiet bar with an edge that still reads (3:1).
      return "border border-line-input bg-raised";
  }
}


/**
 * The week as bars on a ruler. Each day is a button: hover or keyboard focus shows its details in
 * the legend row's fixed spot, and clicking opens it in the Day tab.
 *
 * Motion: when the figures change (another week, the minute refresh, today turning kept) each bar
 * glides from its old height, and a new kept mark fades in. The first render doesn't move, and
 * reduced motion or a hidden window lands on the end at once.
 */
export function DayChart({
  o,
  active,
  onActive,
  onOpen,
}: {
  o: StatsOverview;
  active: string | null;
  onActive: (date: string | null) => void;
  onOpen: (date: string) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const { run } = useMotion(root);
  const topH = chartHours(o.days, o.goalMin);
  const axis = chartAxis(topH);
  const pct = (m: number) => (m / (topH * 60)) * 100;
  const goalPct = pct(o.goalMin);
  const heights = o.days.map((d) => barPct(d, topH));

  // What the bars showed last time, by column, to glide from.
  const last = useRef<{ heights: number[] } | null>(null);
  const dates = o.days.map((d) => d.date).join(",");
  const keyOf = `${dates}|${heights.join(",")}|${o.days.map((d) => d.status).join(",")}`;
  useEffect(() => {
    const before = last.current;
    last.current = { heights };
    if (!before || !root.current) return;
    const bars = Array.from(root.current.querySelectorAll<HTMLElement>("[data-bar]"));
    const moved = bars.filter((_, i) => before.heights[i] !== undefined && before.heights[i] !== heights[i]);
    if (!moved.length) return;
    run(() => {
      const tl = gsap.timeline({ id: "stats-bars", defaults: { duration: DUR.glide, ease: EASE.glide } });
      moved.forEach((bar) => {
        const i = bars.indexOf(bar);
        tl.fromTo(bar, { height: `${before.heights[i]}%` }, { height: `${heights[i]}%` }, 0);
      });
      return tl;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyOf]);

  return (
    <div ref={root} className="flex min-h-0 grow flex-col gap-[10px]">
      <div className="flex min-h-[160px] grow gap-3">
        {/* The axis: a tick every quarter hour, hours in the second color. */}
        <div aria-hidden="true" data-testid="stats-axis" className="relative w-[38px] shrink-0 border-r border-line">
          {axis.ticks.map((t, i) => (
            <span
              key={i}
              data-tick={t.major ? "major" : "minor"}
              className={`absolute right-0 h-px ${t.major ? "w-3 bg-second" : "w-[6px] bg-line"}`}
              style={{ bottom: t.at === 1 ? "calc(100% - 1px)" : `${t.at * 100}%` }}
            />
          ))}
          {axis.labels.map((h) => (
            <span
              key={h}
              className={`absolute right-4 font-mono text-micro leading-none ${h * 60 === o.goalMin ? "text-second-text" : "text-muted"}`}
              style={{ bottom: `${(h / topH) * 100}%`, transform: h === 0 ? undefined : h === topH ? "translateY(100%)" : "translateY(50%)" }}
            >
              {h}h
            </span>
          ))}
        </div>
        <div className="relative flex min-w-0 grow items-end gap-[14px]">
          {/* The daily goal: a dashed second-color line, named at its right end. */}
          <div aria-hidden="true" data-testid="stats-target" className="pointer-events-none absolute inset-x-0 z-[1] border-t-2 border-dashed border-second" style={{ bottom: `${goalPct}%` }}>
            {/* Drawn over the bars, on the panel color, so a tall last day never hides it. */}
            <span className="absolute bottom-[4px] right-0 whitespace-nowrap rounded-[3px] bg-panel px-1 py-[2px] text-micro leading-none text-second-text">{minutes(o.goalMin)} a day</span>
          </div>
          {o.days.map((d, i) => {
            const on = active === d.date;
            return (
              <button
                key={i}
                type="button"
                data-day={d.date}
                aria-label={dayDetail(d.date, d, o.goalMin)}
                onMouseEnter={() => onActive(d.date)}
                onMouseLeave={() => onActive(null)}
                onFocus={() => onActive(d.date)}
                onBlur={() => onActive(null)}
                onClick={() => d.status !== "future" && onOpen(d.date)}
                className={`relative flex h-full min-w-0 flex-1 flex-col items-center justify-end rounded-[4px] p-0 ${d.status === "future" ? "cursor-default" : ""}`}
              >
                <span
                  data-bar
                  data-status={d.status}
                  className={`relative box-border block w-full max-w-[56px] rounded-b-[2px] rounded-t-[3px] outline outline-1 outline-offset-2 transition-[outline-color] duration-ui ease-ui ${barClass(d)} ${
                    on ? "outline-muted" : "outline-transparent"
                  } ${d.status === "future" ? "invisible" : ""}`}
                  style={{ height: `${heights[i]}%` }}
                  /* No cap over kept days (2026-11-17): the bar itself says it. */
                />
              </button>
            );
          })}
        </div>
      </div>
      <div aria-hidden="true" className="ml-[50px] flex gap-[14px]">
        {o.days.map((d, i) => (
          <div key={i} className="flex min-w-0 flex-1 flex-col items-center gap-[3px] text-meta">
            <span className="whitespace-nowrap font-semibold text-text">
              {fromKey(d.date).toLocaleDateString("en-US", { weekday: "short" })}
              {DAY_NOTE[d.status] ? <span className={`ml-1 text-micro font-medium ${d.status === "broken" ? "text-broken-text" : "text-muted"}`}>{DAY_NOTE[d.status]}</span> : null}
            </span>
            <span className="font-mono text-meta text-muted">{d.status === "future" ? "" : minutes(d.focusMin)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * The summary's focus cell: the range's focused time against this week's target, on an hour
 * ruler. The fill is the accent; the scale's majors and the target are the second color.
 */
export function FocusRuler({ totalMin, targetMin }: { totalMin: number; targetMin: number | null }) {
  const root = useRef<HTMLDivElement>(null);
  const { run } = useMotion(root);
  const s = focusScale(totalMin, targetMin);
  const fill = Math.min(100, (totalMin / (s.scaleH * 60)) * 100);
  const targetPct = targetMin ? (targetMin / (s.scaleH * 60)) * 100 : null;
  const targetOnMajor = targetMin !== null && targetMin % (s.step * 5 * 60) === 0;

  const was = useRef<number | null>(null);
  useEffect(() => {
    const before = was.current;
    was.current = fill;
    if (before === null || before === fill || !root.current) return;
    const el = root.current.querySelector("[data-fill]");
    run(() => gsap.timeline({ id: "stats-focus" }).fromTo(el, { width: `${before}%` }, { width: `${fill}%`, duration: DUR.glide, ease: EASE.glide }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fill]);

  const label = targetMin
    ? `${minutes(totalMin)} focused against a ${minutes(targetMin)} target, on a ${s.scaleH} hour scale`
    : `${minutes(totalMin)} focused, on a ${s.scaleH} hour scale`;
  return (
    <div ref={root} className="flex flex-col gap-[6px]">
      <div role="img" aria-label={label} data-testid="focus-ruler" className="relative h-4">
        {s.ticks.map((t, i) => (
          <span
            key={i}
            data-tick={t.major ? "major" : "minor"}
            className={`absolute bottom-[5px] w-px ${t.major ? "h-[11px] bg-second" : "h-[6px] bg-line"}`}
            style={{ left: t.at === 1 ? "calc(100% - 1px)" : `${t.at * 100}%` }}
          />
        ))}
        {targetPct !== null && !targetOnMajor ? (
          <span data-testid="focus-target" className="absolute bottom-[5px] h-[11px] w-[2px] -translate-x-1/2 bg-second" style={{ left: `${Math.min(100, targetPct)}%` }} />
        ) : null}
        <span data-fill className="absolute bottom-0 left-0 h-[3px] rounded-[2px] bg-sealed" style={{ width: `${fill}%` }} />
      </div>
      <div aria-hidden="true" className="relative h-3 font-mono text-micro leading-none text-muted">
        {s.labels.map((h) => (
          <span
            key={h}
            className={`absolute ${targetMin === h * 60 ? "text-second-text" : ""}`}
            style={h === s.scaleH ? { right: 0 } : { left: `${(h / s.scaleH) * 100}%`, transform: h ? "translateX(-50%)" : undefined }}
          >
            {h}
            {h ? "h" : ""}
          </span>
        ))}
      </div>
    </div>
  );
}
