import { useCallback, useEffect, useState } from "react";
import { Button } from "../../components/Button";
import { ChevronRightIcon } from "../../components/icons";
import { Section } from "../setup/parts";
import { EVENTS, native, onNative } from "../../lib/native";
import { useInstalledApps } from "../../lib/installedApps";
import { addMonths, fromKey, todayKey, WEEKDAYS } from "../../lib/planner";
import { dayDetail, rangeOf, rangeTitle, shade, shiftRange, TEMPTED_KIND, temptedLabel, type StatsRange } from "../../lib/stats";
import { minutes } from "../../lib/time";
import type { DayStat, StatsOverview } from "../../lib/types";

// Stats (SPEC 4.9, 4.10): the streak, focus by day against the goal, what tempted you, and
// where the time went. No design screen; built from Month.dc.html (summary row, heatmap,
// legend) and Tracking.dc.html (panels, range toggle).

function RangeSwitch({ range, onChange }: { range: StatsRange; onChange: (r: StatsRange) => void }) {
  return (
    <div role="tablist" aria-label="Range" className="flex rounded-control border border-line-input p-[2px]">
      {(["week", "month"] as const).map((r) => (
        <button
          key={r}
          role="tab"
          aria-selected={range === r}
          onClick={() => onChange(r)}
          className={`h-[26px] rounded-[4px] px-[10px] text-meta transition-colors duration-ui ease-ui ${
            range === r ? "bg-line font-medium text-text" : "text-muted hover:text-text-2"
          }`}
        >
          {r === "week" ? "Week" : "Month"}
        </button>
      ))}
    </div>
  );
}

function Summary({ o }: { o: StatsOverview }) {
  const cells: [string, string][] = [
    [String(o.currentStreak), "Current streak"],
    [String(o.longestStreak), "Longest streak"],
    [String(o.kept), "Days kept"],
    [String(o.broken), o.broken === 1 ? "Seal broken" : "Seals broken"],
    [minutes(o.focusMin), "Focused"],
  ];
  return (
    <div data-testid="stats-summary" className="grid shrink-0 grid-cols-5 overflow-hidden rounded-panel border border-line bg-panel">
      {cells.map(([v, k], i) => (
        <div key={k} className={`flex flex-col gap-[2px] px-[14px] py-3 ${i < cells.length - 1 ? "border-r border-line" : ""}`}>
          <span className="font-mono text-[18px] font-medium">{v}</span>
          <span className="text-meta text-muted">{k}</span>
        </div>
      ))}
    </div>
  );
}

const STATUS_LABEL: Partial<Record<DayStat["status"], string>> = {
  broken: "Broken",
  missed: "Missed",
  rest: "Rest",
  today: "Today",
};

function cellClass(d: DayStat, goal: number, inMonth: boolean): string {
  if (!inMonth) return "border-transparent bg-transparent";
  switch (d.status) {
    case "kept":
      return `border-transparent ${["", "bg-heat-1", "bg-heat-2", "bg-heat-3"][shade(d.focusMin, goal)]}`;
    case "broken":
      return "border-broken bg-broken-tint";
    case "missed":
      return "border-line-input bg-panel";
    case "rest":
      return "border-dashed border-check-line bg-transparent";
    case "today":
      return "border-sealed bg-panel";
    default:
      return "border-line-soft bg-panel-footer";
  }
}

function Heatmap({ o, month, onHover }: { o: StatsOverview; month: string; onHover: (d: DayStat | null) => void }) {
  const inMonth = (k: string) => fromKey(k).getMonth() === fromKey(month).getMonth();
  return (
    <div className="flex min-h-0 grow flex-col gap-1">
      <div className="grid grid-cols-7 gap-1 px-[2px]">
        {WEEKDAYS.map((w) => (
          <span key={w.name} className="pl-[6px] text-[11px] text-faint">
            {w.name}
          </span>
        ))}
      </div>
      <div className="grid min-h-0 grow grid-cols-7 gap-1" style={{ gridTemplateRows: `repeat(${o.days.length / 7}, minmax(0, 1fr))` }}>
        {o.days.map((d) => {
          const shown = inMonth(d.date);
          const dim = !shown || d.status === "future" || d.status === "none";
          const label = shown ? STATUS_LABEL[d.status] : undefined;
          return (
            <div
              key={d.date}
              role="gridcell"
              aria-label={shown ? dayDetail(d.date, d, o.goalMin) : undefined}
              onMouseEnter={() => shown && onHover(d)}
              onMouseLeave={() => onHover(null)}
              className={`flex min-h-0 flex-col justify-between rounded-control border px-2 py-[6px] ${cellClass(d, o.goalMin, shown)}`}
            >
              <span className="flex w-full justify-between">
                <span className={`font-mono text-[11px] ${dim ? "text-check-line" : "text-text"}`}>{fromKey(d.date).getDate()}</span>
                {label ? (
                  <span className={`text-[10px] ${d.status === "broken" || d.status === "missed" ? "text-broken-text" : d.status === "today" ? "text-sealed-text" : "text-muted"}`}>
                    {label}
                  </span>
                ) : null}
              </span>
              {shown && d.focusMin > 0 ? <span className="font-mono text-[11px] text-text-2">{minutes(d.focusMin)}</span> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function barClass(d: DayStat): string {
  switch (d.status) {
    case "kept":
      return "bg-sealed";
    case "today":
      return "border border-sealed bg-sealed-tint";
    case "broken":
      return "border border-broken bg-broken-tint";
    case "rest":
      return "border border-dashed border-check-line";
    default:
      return "bg-line-input";
  }
}

function WeekBars({ o, onHover }: { o: StatsOverview; onHover: (d: DayStat | null) => void }) {
  const top = Math.max(o.goalMin * 1.5, ...o.days.map((d) => d.focusMin));
  const goalPct = (o.goalMin / top) * 100;
  return (
    <div className="flex min-h-0 grow flex-col gap-2">
      <div className="relative flex min-h-0 grow items-end gap-3 border-b border-line px-1">
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 border-t border-dashed border-check-line" style={{ bottom: `${goalPct}%` }}>
          <span className="absolute -top-[18px] right-0 font-mono text-[10px] text-faint">goal {minutes(o.goalMin)}</span>
        </div>
        {o.days.map((d) => (
          <div
            key={d.date}
            role="img"
            aria-label={dayDetail(d.date, d, o.goalMin)}
            onMouseEnter={() => onHover(d)}
            onMouseLeave={() => onHover(null)}
            className="flex h-full min-w-0 flex-1 flex-col items-center justify-end"
          >
            {d.status === "future" ? null : (
              <div
                className={`w-full max-w-[44px] rounded-t-[4px] ${barClass(d)}`}
                style={{ height: `${Math.max(d.status === "rest" && !d.focusMin ? 100 : 0, (d.focusMin / top) * 100, 1.5)}%`, opacity: d.status === "rest" && !d.focusMin ? 0.5 : 1 }}
              />
            )}
          </div>
        ))}
      </div>
      <div className="flex gap-3 px-1">
        {o.days.map((d) => {
          const label = STATUS_LABEL[d.status];
          return (
            <div key={d.date} className="flex min-w-0 flex-1 flex-col items-center gap-[2px]">
              <span className="flex items-baseline gap-1">
                <span className="text-meta text-text-2">{fromKey(d.date).toLocaleDateString("en-US", { weekday: "short" })}</span>
                {label ? (
                  <span className={`text-[10px] ${d.status === "broken" || d.status === "missed" ? "text-broken-text" : d.status === "today" ? "text-sealed-text" : "text-muted"}`}>
                    {label}
                  </span>
                ) : null}
              </span>
              <span className="font-mono text-[11px] text-muted">{d.status === "future" ? "" : minutes(d.focusMin)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Legend({ hover, o }: { hover: DayStat | null; o: StatsOverview }) {
  const swatch = "h-3 w-3 rounded-[3px]";
  return (
    <div className="flex h-5 shrink-0 items-center gap-[18px] text-meta text-muted">
      <span className="flex items-center gap-[6px]">
        <span className={`${swatch} bg-heat-1`} />
        <span className={`${swatch} bg-heat-2`} />
        <span className={`${swatch} bg-heat-3`} />
        Kept
      </span>
      <span className="flex items-center gap-[6px]">
        <span className={`${swatch} border border-line-input bg-panel`} />
        Goal missed
      </span>
      <span className="flex items-center gap-[6px]">
        <span className={`${swatch} border border-broken bg-broken-tint`} />
        Seal broken
      </span>
      <span className="flex items-center gap-[6px]">
        <span className={`${swatch} border border-dashed border-check-line`} />
        Rest day
      </span>
      <span data-testid="stats-hover" className="ml-auto truncate text-text-2">
        {hover ? dayDetail(hover.date, hover, o.goalMin) : "Hover a day for details"}
      </span>
    </div>
  );
}

function TemptedPanel({ o }: { o: StatsOverview }) {
  const apps = useInstalledApps();
  const top = Math.max(1, ...o.tempted.map((t) => t.count));
  return (
    <Section title="What tempted you" action={<span className="font-mono text-meta text-muted">{o.attempts} attempts</span>}>
      {o.tempted.length === 0 ? (
        <p className="m-0 px-[14px] py-3 text-meta text-muted">Nothing tried to get in.</p>
      ) : (
        <div className="flex flex-col py-1">
          {o.tempted.map((t) => (
            <div key={`${t.what}-${t.kind}`} className="flex flex-col gap-1 px-[14px] py-[6px]">
              <span className="flex items-baseline gap-2">
                <span className="min-w-0 truncate text-body text-text">{temptedLabel(t.what, apps)}</span>
                <span className="text-[11px] text-faint">{TEMPTED_KIND[t.kind] ?? t.kind}</span>
                <span className="ml-auto font-mono text-meta text-text-2">{t.count}</span>
              </span>
              <span className="h-1 overflow-hidden rounded-full bg-line">
                <span className="block h-full rounded-full bg-sealed-line" style={{ width: `${(t.count / top) * 100}%` }} />
              </span>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

function TimePanel({ o }: { o: StatsOverview }) {
  const parts = [
    { label: "Productive", min: o.productiveMin, color: "bg-sealed" },
    { label: "Neutral", min: o.neutralMin, color: "bg-check-line" },
    { label: "Distracting", min: o.distractingMin, color: "bg-broken" },
    { label: "Idle", min: o.idleMin, color: "bg-line-input" },
  ];
  const total = parts.reduce((a, p) => a + p.min, 0);
  return (
    <Section title="Where time went" action={<span className="font-mono text-meta text-muted">{minutes(total)}</span>}>
      <div className="flex flex-col gap-3 px-[14px] py-3">
        <div aria-hidden="true" className="flex h-2 overflow-hidden rounded-full bg-line">
          {total ? parts.map((p) => <span key={p.label} className={`h-full ${p.color}`} style={{ width: `${(p.min / total) * 100}%` }} />) : null}
        </div>
        <div className="flex flex-col gap-[6px]">
          {parts.map((p) => (
            <span key={p.label} className="flex items-center gap-2 text-meta">
              <span className={`h-[6px] w-[6px] rounded-full ${p.color}`} />
              <span className="text-text-2">{p.label}</span>
              <span className="ml-auto font-mono text-text">{minutes(p.min)}</span>
              <span className="w-9 text-right font-mono text-faint">{total ? `${Math.round((p.min / total) * 100)}%` : "–"}</span>
            </span>
          ))}
        </div>
        {total === 0 ? <p className="m-0 text-meta text-muted">Activity shows up as you work.</p> : null}
      </div>
    </Section>
  );
}

export function StatsPage() {
  const today = todayKey();
  const [range, setRange] = useState<StatsRange>("week");
  const [anchor, setAnchor] = useState(today);
  const [o, setO] = useState<StatsOverview | null>(null);
  const [hover, setHover] = useState<DayStat | null>(null);
  const { from, to } = rangeOf(range, anchor);
  const current = range === "week" ? from <= today && today <= to : addMonths(anchor, 0) === addMonths(today, 0);

  const load = useCallback(() => {
    void native
      .statsOverview(from, to)
      .then(setO)
      .catch(() => setO(null));
  }, [from, to]);
  useEffect(() => {
    load();
    const offs = [onNative(EVENTS.held, load), onNative(EVENTS.session, load)];
    const t = setInterval(load, 60_000);
    return () => {
      clearInterval(t);
      for (const off of offs) void off.then((f) => f());
    };
  }, [load]);

  const unit = range === "week" ? "week" : "month";
  return (
    <div className="flex h-full flex-col gap-[14px] px-7 pb-6 pt-5">
      <div className="flex h-control items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <h1 className="page-title m-0 whitespace-nowrap">Stats</h1>
          <span className="whitespace-nowrap text-body text-muted">{rangeTitle(range, anchor)}</span>
          <div className="flex items-center gap-1">
            <Button variant="quiet" aria-label={`Previous ${unit}`} className="w-control px-0" onClick={() => setAnchor(shiftRange(range, anchor, -1))}>
              <ChevronRightIcon size={12} className="rotate-180" />
            </Button>
            <Button variant={current ? "quiet" : "ghost"} size="sm" onClick={() => setAnchor(today)}>
              This {unit}
            </Button>
            <Button
              variant="quiet"
              aria-label={`Next ${unit}`}
              className="w-control px-0"
              disabled={current}
              onClick={() => setAnchor(shiftRange(range, anchor, 1))}
            >
              <ChevronRightIcon size={12} />
            </Button>
          </div>
        </div>
        <RangeSwitch
          range={range}
          onChange={(r) => {
            setRange(r);
            if (current) setAnchor(today);
          }}
        />
      </div>

      {o ? (
        <>
          <Summary o={o} />
          <div className="grid min-h-0 grow grid-cols-[minmax(0,1fr)_280px] gap-4">
            <section aria-label={range === "week" ? "Focus by day" : "Focus heatmap"} className="flex min-h-0 flex-col gap-3 rounded-panel border border-line bg-panel p-[14px]">
              {range === "week" ? <WeekBars o={o} onHover={setHover} /> : <Heatmap o={o} month={anchor} onHover={setHover} />}
              <Legend hover={hover} o={o} />
            </section>
            <div className="flex min-h-0 flex-col gap-4 overflow-y-auto">
              <TemptedPanel o={o} />
              <TimePanel o={o} />
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
