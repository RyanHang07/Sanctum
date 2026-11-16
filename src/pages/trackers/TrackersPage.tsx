import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../components/Button";
import { Segmented } from "../../components/controls";
import { XIcon } from "../../components/icons";
import { Odometer } from "../../components/Odometer";
import { DUR, EASE, gsap, useGSAP } from "../../lib/gsap";
import { useMotion } from "../../lib/useMotion";
import { useStore } from "../../state/store";
import { useTrackers } from "../../state/trackers";
import { charted, entriesOf, formatValue, num, RANGES, rangeNote, rangeStart, shortDate, type TrackerRange } from "../../lib/trackers";
import type { Tracker, TrackerEntry } from "../../lib/types";
import { goalDirection, goalText, trackerChart, type RulerTick } from "./chart";

// Trackers (gate-canvas ProtoTrackers.dc.html, SPEC 4.13): one chart per tracker (never two
// metrics on one axis), drawn on rulers. The left ruler is the value axis; the bottom ruler has a
// tick per day (week, month), and a day at goal gets a taller tick and label in the second colour.
// A new entry rolls the figure, and if it reaches the goal, today's tick grows to full height.

type View = "chart" | "table";

const RANGE_OPTIONS = RANGES.map((r) => ({ value: r, label: <span className="font-mono">{r}</span> }));
const VIEW_OPTIONS = [
  { value: "chart", label: "Chart" },
  { value: "table", label: "Table" },
] as const;

/** Bottom-ruler ticks: neutral scale marks, only the goal in the second colour. */
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

function ChartCard({ t, list, history, range }: { t: Tracker; list: TrackerEntry[]; history: TrackerEntry[]; range: TrackerRange }) {
  const root = useRef<HTMLElement>(null);
  const { run } = useMotion(root);
  const [hover, setHover] = useState<number | null>(null);
  const dir = useMemo(() => goalDirection(history, t.goal), [history, t.goal]);
  const c = useMemo(() => trackerChart(t, list, range, dir), [t, list, range, dir]);
  const last = list[list.length - 1];
  const h = hover !== null ? c.points[hover] : null;
  const current = !last ? "—" : t.kind === "bool" ? (last.value ? "Yes" : "No") : num(last.value ?? 0);
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

  // Hover areas reach halfway to each neighbour.
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
        <h2 className="m-0 min-w-0 truncate pb-[2px] text-body font-semibold">{t.name}</h2>
        <span className="shrink-0 pb-[2px] text-meta text-muted">{goalText(t, dir)}</span>
        <span className="ml-auto flex shrink-0 items-end gap-1" aria-live="polite">
          <Odometer text={current} className="font-mono text-[22px] font-medium tracking-[-0.02em] text-text" />
          {unit && last ? <span className="text-meta leading-none text-muted">{unit}</span> : null}
        </span>
      </div>
      {c.points.length ? (
        <>
          <div role="img" aria-label={aria} className="relative ml-11 mr-1 mt-[6px] h-[104px]" onMouseLeave={() => setHover(null)}>
            {/* Left ruler: a tick every tenth, the labelled ones longer. */}
            <span aria-hidden="true" className="absolute inset-y-0 -left-3 w-px bg-line" />
            {c.yticks.map((y) => (
              <span key={y.y} aria-hidden="true" className={`absolute h-px ${y.major ? "-left-[18px] w-[6px] bg-muted" : "-left-4 w-1 bg-line-input"}`} style={{ top: `${y.y}%` }} />
            ))}
            {c.ylabels.map((l) => (
              <span key={l.y} aria-hidden="true" className="absolute -left-12 w-7 -translate-y-1/2 text-right font-mono text-[10px] text-muted" style={{ top: `${l.y}%` }}>
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
                  <span className="text-[11px] text-muted">{h.full}</span>
                </div>
              </>
            ) : null}
          </div>
          {/* Bottom ruler: a tick per day (or week, or month); days at goal stand taller in the second colour. */}
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
                className={`absolute top-0 whitespace-nowrap text-[10.5px] ${x.align === "end" ? "-translate-x-full" : x.align === "middle" ? "-translate-x-1/2" : ""} ${
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
      <div className="flex justify-between gap-3 border-t border-line pt-2 text-meta text-text-2">
        <span>{rangeNote(t, list)}</span>
        {hasGoal ? <span className="text-muted">{`${c.hitDays} of ${c.days} ${c.days === 1 ? "day" : "days"} at goal`}</span> : null}
      </div>
    </section>
  );
}

const SOURCE = { checkin: "Check-in", manual: "Logged" } as const;
const COLS = "grid-cols-[90px_110px_minmax(0,1fr)_90px_28px]";

function EntryTable({ trackers, list, limit }: { trackers: Tracker[]; list: TrackerEntry[]; limit?: number }) {
  const deleteEntry = useTrackers((s) => s.deleteEntry);
  const rows = [...list].reverse().slice(0, limit);
  const name = (id: number) => trackers.find((t) => t.id === id);
  return (
    <section aria-label="Entries" className="flex min-h-0 shrink-0 flex-col overflow-hidden rounded-panel border border-line bg-panel">
      <div className={`grid h-8 shrink-0 ${COLS} items-center border-b border-line px-[14px] text-meta text-muted`}>
        <span>Date</span>
        <span>Tracker</span>
        <span>Value</span>
        <span>Source</span>
        <span />
      </div>
      {rows.length ? (
        rows.map((e) => {
          const t = name(e.trackerId);
          if (!t) return null;
          return (
            <div key={e.id} className={`group grid min-h-[34px] ${COLS} items-center border-b border-line px-[14px] py-[6px] text-body last:border-b-0`}>
              <span className="font-mono text-meta text-text-2">{shortDate(e.loggedAt)}</span>
              <span className="truncate">{t.name}</span>
              <span className={`${t.kind === "text" ? "whitespace-pre-wrap leading-normal" : "font-mono"} min-w-0 break-words pr-3`}>{formatValue(t, e)}</span>
              <span className="text-muted">{SOURCE[e.source]}</span>
              <button
                type="button"
                aria-label={`Delete ${t.name} entry from ${shortDate(e.loggedAt)}`}
                onClick={() => void deleteEntry(e.id)}
                className="flex h-6 w-6 items-center justify-center rounded-control text-muted opacity-0 transition-opacity duration-ui ease-ui hover:bg-raised hover:text-text focus-visible:opacity-100 group-hover:opacity-100"
              >
                <XIcon size={11} />
              </button>
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
          <EntryTable trackers={trackers} list={showCharts ? inRange.filter((e) => trackers.find((t) => t.id === e.trackerId)?.display !== "chart") : inRange} limit={showCharts ? 8 : undefined} />
        </div>
      )}
    </div>
  );
}
