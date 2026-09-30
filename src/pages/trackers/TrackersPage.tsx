import { useEffect, useMemo, useState } from "react";
import { Button } from "../../components/Button";
import { XIcon } from "../../components/icons";
import { useStore } from "../../state/store";
import { useTrackers } from "../../state/trackers";
import { CHART, charted, chartGeometry, entriesOf, formatValue, num, RANGES, rangeNote, rangeStart, shortDate, type TrackerRange } from "../../lib/trackers";
import type { Tracker, TrackerEntry } from "../../lib/types";

// Trackers tab (design/screens/Tracking.dc.html, SPEC 4.13): one chart per tracker (never two
// metrics on one axis), a range toggle, hover for date and value, and a table of every entry.

type View = "chart" | "table";

function Segmented<T extends string>({ label, value, options, onChange, mono = false }: { label: string; value: T; options: readonly { id: T; label: string }[]; onChange: (v: T) => void; mono?: boolean }) {
  return (
    <div role="group" aria-label={label} className="flex rounded-control border border-line-input p-[2px]">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={value === o.id}
          onClick={() => onChange(o.id)}
          className={`h-[26px] rounded-[4px] px-[10px] text-meta transition-colors duration-ui ease-ui ${mono ? "font-mono" : ""} ${
            value === o.id ? "bg-line font-medium text-text" : "text-muted hover:text-text-2"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function ChartCard({ t, list }: { t: Tracker; list: TrackerEntry[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const g = useMemo(() => chartGeometry(list, t.goal, t.kind), [list, t.goal, t.kind]);
  const last = list[list.length - 1];
  const h = hover !== null ? g.points[hover] : null;
  const current = !last ? "—" : t.kind === "bool" ? (last.value ? "Yes" : "No") : num(last.value ?? 0);
  const unit = t.kind === "scale" ? "/ 10" : t.kind === "number" ? t.unit : "";
  // Hit areas halfway to each neighbour.
  const hits = g.points.map((p, i) => {
    const l = i === 0 ? CHART.x0 - 4 : (g.points[i - 1]!.x + p.x) / 2;
    const r = i === g.points.length - 1 ? CHART.x1 + 4 : (p.x + g.points[i + 1]!.x) / 2;
    return { x: l, w: Math.max(r - l, 4) };
  });
  return (
    <section aria-label={t.name} className="flex min-w-0 flex-col gap-3 rounded-panel border border-line bg-panel px-4 py-[14px]">
      <div className="flex items-end justify-between">
        <div className="flex flex-col gap-1">
          <h2 className="m-0 text-meta font-medium text-muted">{t.name}</h2>
          <span className="font-mono text-[24px] font-medium tracking-[-0.02em]">
            {current}
            {unit && last ? <span className="text-meta text-muted"> {unit}</span> : null}
          </span>
        </div>
        <span className="text-meta text-text-2">{rangeNote(t, list)}</span>
      </div>
      {list.length ? (
        <div className="relative w-full" style={{ aspectRatio: `${CHART.w} / ${CHART.h}` }}>
          <svg viewBox={`0 0 ${CHART.w} ${CHART.h}`} className="absolute inset-0 h-full w-full" role="img" aria-label={`${t.name} over the selected range`} onMouseLeave={() => setHover(null)}>
            {g.grid.map((l) => (
              <g key={l.y}>
                <line x1={38} x2={382} y1={l.y} y2={l.y} className="stroke-line" strokeWidth={1} />
                <text x={30} y={l.y + 3.5} textAnchor="end" className="fill-faint font-mono" fontSize={10}>
                  {l.label}
                </text>
              </g>
            ))}
            {g.goalY !== null ? <line x1={38} x2={382} y1={g.goalY} y2={g.goalY} className="stroke-sealed-line" strokeWidth={1} strokeDasharray="4 4" /> : null}
            {g.xlabels.map((x) => (
              <text key={x.anchor} x={x.x} y={192} textAnchor={x.anchor} className="fill-faint font-mono" fontSize={10}>
                {x.label}
              </text>
            ))}
            {t.kind === "bool" ? (
              g.points.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={4} className={p.value ? "fill-sealed" : "fill-line-input"} />)
            ) : (
              <>
                <polyline points={g.points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")} fill="none" className="stroke-sealed" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                <circle cx={g.points.at(-1)!.x} cy={g.points.at(-1)!.y} r={4} className="fill-sealed stroke-panel" strokeWidth={2} />
              </>
            )}
            {hits.map((b, i) => (
              <rect key={i} data-testid="chart-hit" x={b.x} y={0} width={b.w} height={176} fill="transparent" onMouseEnter={() => setHover(i)} />
            ))}
          </svg>
          {h ? (
            <>
              <div className="pointer-events-none absolute w-px bg-check-line" style={{ left: `${(h.x / CHART.w) * 100}%`, top: `${(10 / CHART.h) * 100}%`, height: `${(162 / CHART.h) * 100}%` }} />
              <div
                role="tooltip"
                className="pointer-events-none absolute flex w-[92px] -translate-x-1/2 flex-col gap-[2px] rounded-control border border-line-input bg-toast px-2 py-[6px]"
                style={{ left: `clamp(46px, ${(h.x / CHART.w) * 100}%, calc(100% - 46px))`, top: `max(0px, calc(${(h.y / CHART.h) * 100}% - 54px))` }}
              >
                <span className="font-mono text-body text-text">{formatValue(t, { value: h.value, text: null })}</span>
                <span className="text-[11px] text-muted">{shortDate(h.at)}</span>
              </div>
            </>
          ) : null}
        </div>
      ) : (
        <p className="m-0 flex h-[120px] items-center justify-center text-body text-muted">No entries in this range.</p>
      )}
    </section>
  );
}

const SOURCE = { checkin: "Check-in", manual: "Logged" } as const;

function EntryTable({ trackers, list, limit }: { trackers: Tracker[]; list: TrackerEntry[]; limit?: number }) {
  const deleteEntry = useTrackers((s) => s.deleteEntry);
  const rows = [...list].reverse().slice(0, limit);
  const name = (id: number) => trackers.find((t) => t.id === id);
  return (
    <section aria-label="Entries" className="flex min-h-0 shrink-0 flex-col overflow-hidden rounded-panel border border-line bg-panel">
      <div className="grid h-[34px] shrink-0 grid-cols-[110px_140px_minmax(0,1fr)_90px_28px] items-center border-b border-line px-[14px] text-meta text-muted">
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
            <div key={e.id} className="group grid min-h-[34px] grid-cols-[110px_140px_minmax(0,1fr)_90px_28px] items-center border-b border-line-soft px-[14px] py-[6px] text-body last:border-b-0">
              <span className="text-text-2">{shortDate(e.loggedAt)}</span>
              <span className="truncate">{t.name}</span>
              <span className={`${t.kind === "text" ? "whitespace-pre-wrap leading-normal" : "font-mono"} min-w-0 break-words pr-3`}>{formatValue(t, e)}</span>
              <span className="text-muted">{SOURCE[e.source]}</span>
              <button
                type="button"
                aria-label={`Delete ${t.name} entry from ${shortDate(e.loggedAt)}`}
                onClick={() => void deleteEntry(e.id)}
                className="flex h-6 w-6 items-center justify-center rounded-control text-faint opacity-0 transition-opacity duration-ui ease-ui hover:bg-raised hover:text-text focus-visible:opacity-100 group-hover:opacity-100"
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

  return (
    <div className="flex h-full flex-col gap-4 px-7 pb-6 pt-5">
      <div className="flex h-control shrink-0 items-center justify-between">
        <h1 className="page-title m-0">Trackers</h1>
        {trackers.length ? (
          <div className="flex items-center gap-[6px]">
            <Segmented label="Time range" value={range} onChange={setRange} options={RANGES.map((r) => ({ id: r, label: r }))} mono />
            <Segmented label="View" value={view} onChange={setView} options={[{ id: "chart", label: "Chart" }, { id: "table", label: "Table" }] as const} />
            <Button variant="quiet" onClick={() => openSetup("trackers")}>
              Edit
            </Button>
            <Button variant="primary" onClick={openLog}>
              Log entry
            </Button>
          </div>
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
          {view === "chart" && charts.length ? (
            <div className="grid shrink-0 grid-cols-2 gap-3">
              {charts.map((t) => (
                <ChartCard key={t.id} t={t} list={entriesOf(inRange, t.id)} />
              ))}
            </div>
          ) : null}
          <EntryTable trackers={trackers} list={view === "chart" && charts.length ? inRange.filter((e) => trackers.find((t) => t.id === e.trackerId)?.display !== "chart") : inRange} limit={view === "chart" && charts.length ? 8 : undefined} />
        </div>
      )}
    </div>
  );
}
