import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../components/Button";
import { Segmented, useSlidingIndicator } from "../../components/controls";
import { XIcon } from "../../components/icons";
import { Odometer } from "../../components/Odometer";
import { DUR, EASE, gsap, useGSAP } from "../../lib/gsap";
import { useMotion } from "../../lib/useMotion";
import { useStore } from "../../state/store";
import { useTrackers } from "../../state/trackers";
import { charted, entriesOf, formatValue, num, RANGE_LABEL, RANGES, rangeNote, rangeStart, shortDate, type TrackerRange } from "../../lib/trackers";
import type { Tracker, TrackerEntry } from "../../lib/types";
import { OriginLabel } from "./Origin";
import { usePlanner } from "../../state/planner";
import { atGoal, goalDirection, goalText, trackerChart, type RulerTick, todayTotal } from "./chart";

// Trackers (gate-canvas ProtoTrackers.dc.html, SPEC 4.13): one chart per tracker (never two
// metrics on one axis), drawn on rulers. The left ruler is the value axis; the bottom ruler has a
// tick per day (week, month), and a day at goal gets a taller tick and label in the second color.
// A new entry rolls the figure, and if it reaches the goal, today's tick grows to full height.

type View = "chart" | "table";

const RANGE_OPTIONS = RANGES.map((r) => ({ value: r, label: RANGE_LABEL[r] }));
const VIEW_OPTIONS = [
  { value: "chart", label: "Chart" },
  { value: "table", label: "Table" },
] as const;

/** Bottom-ruler ticks: neutral scale marks, only the goal in the second color. */
const TICK: Record<RulerTick["kind"], string> = {
  minor: "h-1 w-px bg-line-input",
  major: "-ml-[0.75px] h-2 w-[1.5px] bg-muted",
  goal: "-ml-px h-[11px] w-[2px] bg-second",
};
/** A full tick is 11px; a plain one is 8. The goal tick grows from one to the other. */
const SHORT = 8 / 11;

/** "7.2 h", "Yes", or for a yes/no averaged over weeks, "71% yes". */
function pointValue(t: Tracker, v: number, share: boolean) {
  return share ? `${Math.round(v * 100)}% yes` : formatValue(t, { value: v, text: null });
}

function ChartCard({ t: tracker, list, history, range }: { t: Tracker; list: TrackerEntry[]; history: TrackerEntry[]; range: TrackerRange }) {
  const root = useRef<HTMLElement>(null);
  const { run } = useMotion(root);
  const [hover, setHover] = useState<number | null>(null);
  // A counter routine's tracker (2026-11-24): days add up, the figure is today's total, and the
  // routine's daily goal stands in when the tracker has none of its own.
  const counter = usePlanner((s) => s.routines.find((r) => r.trackerId === tracker.id && r.goalAmount !== null));
  const t = useMemo(() => (counter ? { ...tracker, goal: tracker.goal ?? counter.goalAmount, sum: true } : tracker), [tracker, counter]);
  const dir = useMemo(() => (counter ? "up" : goalDirection(history, t.goal)), [counter, history, t.goal]);
  const c = useMemo(() => trackerChart(t, list, range, dir), [t, list, range, dir]);
  const last = list[list.length - 1];
  const h = hover !== null ? c.points[hover] : null;
  const current = counter ? num(todayTotal(list)) : !last ? "—" : t.kind === "bool" ? (last.value ? "Yes" : "No") : num(last.value ?? 0);
  const unit = t.kind === "scale" ? "/ 10" : t.kind === "number" ? t.unit : "";
  const hasGoal = t.kind !== "bool" && t.goal !== null;
  const line = t.kind !== "bool" || c.share;

  // A saved entry that reaches the goal: today's tick grows to full height once the figure has rolled.
  const was = useRef<{ hit: boolean; count: number } | null>(null);
  useGSAP(
    () => {
      const prev = was.current;
      was.current = { hit: c.lastHit, count: list.length };
      if (!prev || prev.hit || !c.lastHit || list.length <= prev.count) return;
      run(() =>
        gsap
          .timeline({ id: "tracker-goal" })
          .fromTo('[data-xt="last"]', { scaleY: SHORT, transformOrigin: "50% 0%" }, { scaleY: 1, duration: DUR.state, ease: EASE.settle, clearProps: "transform" }, DUR.glide * 0.75),
      );
    },
    { scope: root, dependencies: [c.lastHit, list.length] },
  );

  // Hover areas reach halfway to each neighbor.
  const hits = c.points.map((p, i) => {
    const l = i === 0 ? 0 : (c.points[i - 1]!.x + p.x) / 2;
    const r = i === c.points.length - 1 ? 100 : (p.x + c.points[i + 1]!.x) / 2;
    return { l, w: Math.max(r - l, 1) };
  });
  const first = c.points[0];
  const aria = first
    ? `${t.name} from ${first.full} to ${c.points.at(-1)!.full}, latest ${pointValue(t, c.points.at(-1)!.value, c.share)}${
        hasGoal ? `, ${goalText(t, dir).toLowerCase()}, ${c.hitDays} of ${c.days} days at goal` : ""
      }`
    : `${t.name}, no entries in this range`;

  return (
    <section ref={root} aria-label={t.name} className="flex min-w-0 flex-col gap-2 rounded-panel border border-line bg-panel px-[18px] pb-3 pt-[14px]">
      <div className="flex items-end gap-[10px]">
        {/* The odometer's digit strips have no useful baseline, so the figure sits on the row's bottom edge instead. */}
        <h2 className="m-0 min-w-0 truncate pb-[4px] text-[15px] font-semibold leading-none">{t.name}</h2>
        <span className="shrink-0 pb-[4px] text-meta leading-none text-muted">{goalText(t, dir)}</span>
        <span className="ml-auto flex shrink-0 items-end gap-1" aria-live="polite">
          <Odometer text={current} className="font-mono text-[22px] font-medium tracking-[-0.02em] text-text" />
          {/* Lifted onto the digits' baseline: the odometer's box runs 4px below its glyphs (2026-11-24). */}
          {unit && (last || counter) ? <span className="pb-[4px] text-meta leading-none text-muted">{unit}</span> : null}
        </span>
      </div>
      {c.points.length ? (
        <>
          <div role="img" aria-label={aria} className="relative ml-11 mr-1 mt-[6px] h-[104px]" onMouseLeave={() => setHover(null)}>
            {/* Left ruler: a tick every tenth, the labeled ones longer. */}
            <span aria-hidden="true" className="absolute inset-y-0 -left-3 w-px bg-line" />
            {c.yticks.map((y) => (
              <span key={y.y} aria-hidden="true" className={`absolute h-px ${y.major ? "-left-[18px] w-[6px] bg-muted" : "-left-4 w-1 bg-line-input"}`} style={{ top: `${y.y}%` }} />
            ))}
            {c.ylabels.map((l) => (
              <span key={l.y} aria-hidden="true" className="absolute right-[calc(100%+20px)] -translate-y-1/2 whitespace-nowrap text-right font-mono text-micro text-muted" style={{ top: `${l.y}%` }}>
                {l.label}
              </span>
            ))}
            {c.goalY !== null ? (
              <>
                <span data-goal-tick aria-hidden="true" className="absolute -left-[22px] h-[2px] w-[10px] -translate-y-px bg-second" style={{ top: `${c.goalY}%` }} />
                <span data-goal-line aria-hidden="true" className="absolute inset-x-0 border-t border-dashed border-second-line" style={{ top: `${c.goalY}%` }} />
              </>
            ) : null}
            {line ? (
              <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" className="absolute inset-0 h-full w-full overflow-visible">
                <polyline
                  points={c.points.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ")}
                  fill="none"
                  className="stroke-sealed"
                  strokeWidth={2}
                  vectorEffect="non-scaling-stroke"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              </svg>
            ) : null}
            {c.points.map((p, i) =>
              line && i !== c.points.length - 1 ? null : (
                <span
                  key={i}
                  aria-hidden="true"
                  className={`absolute box-border -translate-x-1/2 -translate-y-1/2 rounded-full ${
                    line ? "h-[9px] w-[9px] border-2 border-panel bg-sealed" : `${c.points.length > 7 ? "h-[7px] w-[7px]" : "h-[9px] w-[9px]"} ${p.value ? "bg-sealed" : "border-[1.5px] border-line-input bg-panel"}`
                  }`}
                  style={{ left: `${p.x}%`, top: `${p.y}%` }}
                />
              ),
            )}
            {hits.map((b, i) => (
              <span key={i} data-testid="chart-hit" className="absolute inset-y-0" style={{ left: `${b.l}%`, width: `${b.w}%` }} onMouseEnter={() => setHover(i)} />
            ))}
            {h ? (
              <>
                <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 w-px bg-line-input" style={{ left: `${h.x}%` }} />
                <div
                  role="tooltip"
                  className="pointer-events-none absolute z-10 flex w-[104px] -translate-x-1/2 flex-col gap-[2px] rounded-control border border-line-input bg-toast px-2 py-[6px]"
                  style={{ left: `clamp(52px, ${h.x}%, calc(100% - 52px))`, top: `max(-40px, calc(${h.y}% - 54px))` }}
                >
                  <span className="font-mono text-body text-text">{pointValue(t, h.value, c.share)}</span>
                  <span className="text-micro text-muted">{h.full}</span>
                </div>
              </>
            ) : null}
          </div>
          {/* Bottom ruler: a tick per day (or week, or month); days at goal stand taller in the second color. */}
          <div aria-hidden="true" className="relative ml-11 mr-1 mt-[2px] h-3 border-t border-line">
            {c.xticks.map((x, i) => (
              <span key={i} data-xt={x.last ? "last" : undefined} data-kind={x.kind} className={`absolute top-0 ${TICK[x.kind]}`} style={{ left: `${x.x}%` }} />
            ))}
          </div>
          <div aria-hidden="true" className="relative ml-11 mr-1 h-[14px]">
            {c.xlabels.map((x) => (
              <span
                key={x.x}
                data-hit={x.hit || undefined}
                className={`absolute top-0 whitespace-nowrap text-micro ${x.align === "end" ? "-translate-x-full" : x.align === "middle" ? "-translate-x-1/2" : ""} ${
                  x.hit ? "font-semibold text-second-text" : "text-muted"
                }`}
                style={{ left: `${x.x}%` }}
              >
                {x.label}
              </span>
            ))}
          </div>
        </>
      ) : (
        <p className="m-0 flex h-[134px] items-center justify-center text-body text-muted">No entries in this range.</p>
      )}
      <div className="flex items-center justify-between gap-3 border-t border-line pt-2 text-meta text-text-2">
        {/* A counter's entries are amounts, so first-to-last change means nothing: today's total instead. */}
        <span className="min-w-0 truncate">{counter ? `${current} today` : rangeNote(t, list)}</span>
        <span className="flex min-w-0 items-center gap-3">
          {hasGoal ? <span className="truncate text-muted">{`${c.hitDays} of ${c.days} ${c.days === 1 ? "day" : "days"} at goal`}</span> : null}
          {/* Where its entries come from, in the footer's corner (2026-11-24). */}
          <OriginLabel trackerId={t.id} />
        </span>
      </div>
    </section>
  );
}

const SOURCE = { checkin: "Check-in", manual: "Logged" } as const;
/** An entry's source as read: a counter routine's entries say Routine, not Logged (2026-11-24). */
const sourceOf = (e: TrackerEntry, counters: ReadonlySet<number>) => (e.source === "manual" && counters.has(e.trackerId) ? "Routine" : SOURCE[e.source]);
const COLS = "grid-cols-[90px_110px_minmax(0,1fr)_90px_28px]";
/** One tracker: no Tracker column; Change and Goal take its place (decided 2026-11-16). */
const ONE_COLS = "grid-cols-[90px_minmax(0,1fr)_80px_110px_28px]";

/** "+0.4" / "−1.2" against the entry before it; numbers and scales only. */
function changeText(t: Tracker, e: TrackerEntry, prev: TrackerEntry | undefined): string {
  if ((t.kind !== "number" && t.kind !== "scale") || e.value === null || prev?.value == null) return "";
  const d = e.value - prev.value;
  if (Math.abs(d) < 1e-9) return "0";
  return `${d > 0 ? "+" : "−"}${num(Math.abs(d))}`;
}

/** "At goal", or how far off it is ("0.6 over", "1.5 under"); blank without a goal. */
function goalStatus(t: Tracker, e: TrackerEntry, dir: ReturnType<typeof goalDirection>): { text: string; met: boolean } | null {
  if (t.goal === null || e.value === null || t.kind === "text") return null;
  if (atGoal(e.value, t.goal, dir)) return { text: "At goal", met: true };
  if (t.kind === "bool") return { text: "Missed", met: false };
  const off = Math.abs(e.value - t.goal);
  return { text: `${num(off)} ${e.value > t.goal ? "over" : "under"}`, met: false };
}

function DeleteEntry({ t, e }: { t: Tracker; e: TrackerEntry }) {
  const deleteEntry = useTrackers((s) => s.deleteEntry);
  return (
    <button
      type="button"
      aria-label={`Delete ${t.name} entry from ${shortDate(e.loggedAt)}`}
      onClick={() => void deleteEntry(e.id)}
      className="flex h-6 w-6 items-center justify-center rounded-control text-muted opacity-0 transition-[opacity,color,background-color] duration-ui ease-ui hover:bg-danger-tint hover:text-danger-text focus-visible:opacity-100 focus-visible:text-danger-text group-hover:opacity-100"
    >
      <XIcon size={11} />
    </button>
  );
}

/**
 * The entries, filtered by tracker (decided 2026-11-16): All keeps the log of everything, newest
 * first; one tracker shows its own history with how each entry moved and where it stands
 * against the goal, so it reads as that tracker's record rather than an audit log.
 */
function EntryTable({ trackers, list, limit }: { trackers: Tracker[]; list: TrackerEntry[]; limit?: number }) {
  const [filter, setFilter] = useState<number | "all">("all");
  // Trackers a counter routine counts into, as one string so the selector stays stable.
  const counterKey = usePlanner((s) => s.routines.flatMap((r) => (r.trackerId === null ? [] : [r.trackerId])).join(","));
  const counters = useMemo(() => new Set(counterKey ? counterKey.split(",").map(Number) : []), [counterKey]);
  const one = filter === "all" ? null : (trackers.find((t) => t.id === filter) ?? null);
  const name = (id: number) => trackers.find((t) => t.id === id);
  const mine = one ? list.filter((e) => e.trackerId === one.id) : list;
  const dir = one ? goalDirection(mine, one.goal) : "up";
  const rows = [...mine].reverse().slice(0, limit);
  const prevOf = (e: TrackerEntry) => {
    const i = mine.indexOf(e);
    return i > 0 ? mine[i - 1] : undefined;
  };
  const filters = [{ id: "all" as const, label: "All" }, ...trackers.map((t) => ({ id: t.id, label: t.name }))];
  const filterRow = useRef<HTMLDivElement>(null);
  const filterMark = useRef<HTMLSpanElement>(null);
  useSlidingIndicator(filterRow, filterMark, one ? String(one.id) : "all", filters.map((o) => `${o.id}:${o.label}`).join("|"));
  return (
    <section aria-label="Entries" className="flex min-h-0 shrink-0 flex-col overflow-hidden rounded-panel border border-line bg-panel">
      <div
        ref={filterRow}
        role="group"
        aria-label="Show entries for"
        className="relative flex shrink-0 flex-wrap gap-[6px] border-b border-line px-[14px] py-[10px]"
      >
        {/* The pressed filter's box is one indicator that slides between filters, across lines too. */}
        <span
          ref={filterMark}
          aria-hidden="true"
          data-indicator=""
          className="pointer-events-none absolute left-0 top-0 box-border rounded-control border border-check-line bg-raised opacity-0"
        />
        {filters.map((o) => {
          const on = o.id === "all" ? !one : filter === o.id;
          return (
            <button
              key={o.id}
              type="button"
              aria-pressed={on}
              data-indicator-item={String(o.id)}
              onClick={() => setFilter(o.id)}
              className={`relative h-control-sm rounded-control border px-[12px] text-meta transition-colors duration-ui ease-ui ${
                on ? "border-transparent font-medium text-text" : "border-line-input text-muted hover:border-check-line hover:text-text-2"
              }`}
            >
              {/* Sized to the medium-weight name either way, so picking one never resizes it and the
                  box glides the whole way (2026-11-17), as Segmented does. */}
              <span
                data-label={o.label}
                className="inline-flex flex-col after:invisible after:h-0 after:overflow-hidden after:font-medium after:content-[attr(data-label)]"
              >
                {o.label}
              </span>
            </button>
          );
        })}
      </div>
      <div className={`grid h-8 shrink-0 ${one ? ONE_COLS : COLS} items-center border-b border-line px-[14px] text-meta text-muted`}>
        <span>Date</span>
        {one ? (
          <>
            <span>Value</span>
            <span>Change</span>
            <span>{one.goal !== null && one.kind !== "text" ? goalText(one, dir) : "Goal"}</span>
          </>
        ) : (
          <>
            <span>Tracker</span>
            <span>Value</span>
            <span>Source</span>
          </>
        )}
        <span />
      </div>
      {rows.length ? (
        rows.map((e) => {
          const t = one ?? name(e.trackerId);
          if (!t) return null;
          const value = <span className={`${t.kind === "text" ? "whitespace-pre-wrap leading-normal" : "font-mono"} min-w-0 break-words pr-3`}>{formatValue(t, e)}</span>;
          if (one) {
            const g = goalStatus(t, e, dir);
            return (
              <div key={e.id} className={`group grid min-h-[34px] ${ONE_COLS} items-center border-b border-line px-[14px] py-[6px] text-body last:border-b-0`}>
                <span className="font-mono text-meta text-text-2">{shortDate(e.loggedAt)}</span>
                {value}
                <span className="font-mono text-meta text-muted">{changeText(t, e, prevOf(e))}</span>
                <span className={g?.met ? "text-second-text" : "text-muted"}>{g?.text ?? ""}</span>
                <DeleteEntry t={t} e={e} />
              </div>
            );
          }
          return (
            <div key={e.id} className={`group grid min-h-[34px] ${COLS} items-center border-b border-line px-[14px] py-[6px] text-body last:border-b-0`}>
              <span className="font-mono text-meta text-text-2">{shortDate(e.loggedAt)}</span>
              <span className="truncate">{t.name}</span>
              {value}
              <span className="text-muted">{sourceOf(e, counters)}</span>
              <DeleteEntry t={t} e={e} />
            </div>
          );
        })
      ) : (
        <p className="m-0 px-[14px] py-4 text-body text-muted">Nothing logged in this range.</p>
      )}
    </section>
  );
}

export function TrackersPage() {
  const { trackers, entries, loaded, load, openLog } = useTrackers();
  const openSetup = useStore((s) => s.openSetup);
  const [range, setRange] = useState<TrackerRange>("90D");
  const [view, setView] = useState<View>("chart");
  useEffect(() => void load(), [load]);

  const from = rangeStart(range);
  const inRange = entries.filter((e) => e.loggedAt >= from);
  const charts = trackers.filter(charted);
  const showCharts = view === "chart" && charts.length > 0;

  return (
    <div className="flex h-full flex-col gap-4 px-7 pb-6 pt-5">
      <div className="flex min-h-control shrink-0 flex-wrap items-center gap-2">
        <h1 className="page-title m-0 min-w-[160px] grow">Trackers</h1>
        {trackers.length ? (
          <>
            <Segmented label="Time range" value={range} onChange={setRange} options={RANGE_OPTIONS} />
            <Segmented label="View" value={view} onChange={setView} options={VIEW_OPTIONS} />
            <Button variant="quiet" onClick={() => openSetup("trackers")}>
              Edit
            </Button>
            <Button variant="primary" onClick={openLog}>
              Log entry
            </Button>
          </>
        ) : null}
      </div>
      {loaded && !trackers.length ? (
        <div className="flex grow flex-col items-center justify-center gap-3 text-center">
          <h2 className="m-0 text-[16px] font-semibold">No trackers yet</h2>
          <p className="m-0 max-w-[380px] text-body text-muted">Numbers, yes or no, a 1 to 10 scale, or a short note. Check-ins ask for them on the days you pick.</p>
          <Button variant="primary" onClick={() => openSetup("trackers")}>
            Make a tracker
          </Button>
        </div>
      ) : (
        <div className="flex min-h-0 grow flex-col gap-3 overflow-y-auto pr-1">
          {showCharts ? (
            <div className="grid shrink-0 grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-3">
              {charts.map((t) => (
                <ChartCard key={t.id} t={t} range={range} list={entriesOf(inRange, t.id)} history={entriesOf(entries, t.id)} />
              ))}
            </div>
          ) : null}
          <EntryTable trackers={showCharts ? trackers.filter((t) => t.display !== "chart") : trackers} list={showCharts ? inRange.filter((e) => trackers.find((t) => t.id === e.trackerId)?.display !== "chart") : inRange} limit={showCharts ? 8 : undefined} />
        </div>
      )}
    </div>
  );
}
