import { useCallback, useEffect, useRef, useState } from "react";
import { Suggestions } from "./Suggestions";
import { Button } from "../../components/Button";
import { ChevronRightIcon } from "../../components/icons";
import { Segmented, TabPanel, type SegmentOption } from "../../components/controls";
import { Odometer } from "../../components/Odometer";
import { Section } from "../setup/parts";
import { DayDot } from "../week/marks";
import { EVENTS, native, onNative, WEEK_TARGET_EVENT } from "../../lib/native";
import { useInstalledApps } from "../../lib/installedApps";
import { useStore } from "../../state/store";
import { addMonths, fromKey, todayKey, WEEKDAYS } from "../../lib/planner";
import { dayDetail, rangeOf, rangeTitle, shade, shiftRange, TEMPTED_KIND, temptedLabel, type StatsRange } from "../../lib/stats";
import { minutes } from "../../lib/time";
import type { DayStat, StatsOverview, PauseSummary, WeekTarget } from "../../lib/types";
import { SessionsTab } from "./SessionsTab";
import { ActivityTab } from "./ActivityTab";
import { DayTab } from "./DayTab";
import { DAY_NOTE, DayChart, FocusRuler } from "./Ruler";

// Stats (SPEC 4.9, 4.10): the streak, focus by day against the goal, what tempted you, and
// where the time went.
// v0.3 (decided 2026-10-29): tabs. Overview is the page as it was; Sessions, Activity, and Day
// go deeper (SessionsTab, ActivityTab, DayTab).
// v0.4 (redesign, ProtoStats.dc.html): the Ruler direction. Bars are "Focused" in the accent, a
// kept day carries a second-color mark, the daily goal is a dashed second-color line, and a day's
// details show in one fixed spot on hover or keyboard focus. No best-day mark (decided).

const RANGES: readonly SegmentOption<StatsRange>[] = [
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
];

function Summary({ o, paused, targetMin }: { o: StatsOverview; paused: PauseSummary | null; targetMin: number | null }) {
  const cells: [string, string][] = [
    [String(o.currentStreak), "Current streak"],
    [String(o.longestStreak), "Longest streak"],
    [String(o.kept), "Days kept"],
    [String(o.broken), o.broken === 1 ? "Seal broken" : "Seals broken"],
  ];
  // Pause mode (v0.3.1): how often a pause turned you back.
  if (paused?.paused) cells.push([`${paused.turnedBack} of ${paused.paused}`, "Pauses turned back"]);
  // This week's target (v0.3.1) lives here, not on Home: the main screens stay quiet.
  const note =
    targetMin === null ? "focused" : `focused of ${minutes(targetMin)}. ${o.focusMin >= targetMin ? "Target met." : `${minutes(targetMin - o.focusMin)} to go.`}`;
  return (
    <div
      data-testid="stats-summary"
      className="grid shrink-0 overflow-hidden rounded-panel border border-line bg-panel"
      // A tile is never narrower than its figure (2026-11-24: "5 of 30" ran into the next tile).
      style={{ gridTemplateColumns: `repeat(${cells.length}, minmax(min-content, 1fr)) minmax(240px, 2fr)` }}
    >
      {cells.map(([v, k], i) => (
        <div key={k} data-stat={k} className={`flex min-w-[96px] flex-col justify-center gap-[6px] px-[18px] py-4 ${i ? "border-l border-line" : ""}`}>
          <span data-testid="stat-value" className="flex h-6 items-center whitespace-nowrap font-mono text-[24px] font-medium leading-none tracking-[-0.02em]">
            <Odometer text={v} />
          </span>
          <span className="text-meta text-muted">{k}</span>
        </div>
      ))}
      <div data-stat="Focused" className="flex flex-col gap-2 border-l border-line px-[18px] py-4">
        <div className="flex items-center gap-2">
          <span className="flex h-6 items-center font-mono text-[24px] font-medium leading-none tracking-[-0.02em]">
            <Odometer text={minutes(o.focusMin)} />
          </span>
          <span className="text-meta text-muted">{note}</span>
        </div>
        <FocusRuler totalMin={o.focusMin} targetMin={targetMin} />
      </div>
    </div>
  );
}

/** The text on each heatmap step, by the same index as its fill (theme/finish.ts heatInk). */
const HEAT_INK = ["text-text", "text-heat-on-1", "text-heat-on-2", "text-heat-on-3"] as const;

function cellClass(d: DayStat, goal: number): string {
  switch (d.status) {
    case "kept":
      // Level 1 is near the panel (1.3:1), so it carries the line-input edge to read as filled.
      return ["border-transparent", "border-transparent bg-heat-1", "border-transparent bg-heat-2", "border-transparent bg-heat-3"][shade(d.focusMin, goal)]!;
    case "broken":
      return "border-broken bg-broken-tint";
    case "missed":
      return "border-line-input bg-raised";
    case "rest":
      return "border-dashed border-muted bg-transparent";
    case "today":
      return "border-sealed bg-sealed-tint";
    default:
      return "border-line-soft bg-panel-footer";
  }
}

function Heatmap({
  o,
  month,
  active,
  onActive,
  onOpen,
}: {
  o: StatsOverview;
  month: string;
  active: string | null;
  onActive: (date: string | null) => void;
  onOpen: (date: string) => void;
}) {
  const inMonth = (k: string) => fromKey(k).getMonth() === fromKey(month).getMonth();
  return (
    <div className="flex min-h-0 grow flex-col gap-1">
      <div aria-hidden="true" className="grid grid-cols-7 gap-1 px-[2px]">
        {WEEKDAYS.map((w) => (
          <span key={w.name} className="pl-[6px] text-meta text-muted">
            {w.name}
          </span>
        ))}
      </div>
      <div data-testid="stats-heatmap" className="grid min-h-0 grow grid-cols-7 gap-1" style={{ gridTemplateRows: `repeat(${o.days.length / 7}, minmax(0, 1fr))` }}>
        {o.days.map((d) => {
          // Days from the months either side keep the grid square but stay empty.
          if (!inMonth(d.date)) return <span key={d.date} aria-hidden="true" data-day={d.date} />;
          const quiet = d.status === "future" || d.status === "none";
          const note = d.status === "kept" ? null : DAY_NOTE[d.status];
          // On a kept day's fill, its step's own text color: dark on a light fill, light on a dark
          // one, so the number and time read in every theme (2026-11-24).
          const ink = d.status === "kept" ? HEAT_INK[shade(d.focusMin, o.goalMin)] : quiet ? "text-muted" : "text-text";
          return (
            <button
              key={d.date}
              type="button"
              data-day={d.date}
              aria-label={dayDetail(d.date, d, o.goalMin)}
              onMouseEnter={() => onActive(d.date)}
              onMouseLeave={() => onActive(null)}
              onFocus={() => onActive(d.date)}
              onBlur={() => onActive(null)}
              onClick={() => d.status !== "future" && onOpen(d.date)}
              className={`flex min-h-0 flex-col justify-between rounded-control border px-2 py-[6px] text-left outline outline-1 outline-offset-2 transition-[outline-color] duration-ui ease-ui ${cellClass(d, o.goalMin)} ${
                active === d.date ? "outline-muted" : "outline-transparent"
              } ${d.status === "future" ? "cursor-default" : ""}`}
            >
              <span className="flex w-full items-center justify-between">
                <span data-testid="day-number" className={`font-mono text-micro ${ink}`}>{fromKey(d.date).getDate()}</span>
                {d.status === "kept" ? <DayDot day={d} /> : null}
                {note ? <span className={`text-micro ${d.status === "broken" ? "text-broken-text" : d.status === "today" ? "text-sealed-text" : "text-muted"}`}>{note}</span> : null}
              </span>
              {d.focusMin > 0 ? <span data-testid="day-time" className={`font-mono text-micro ${d.status === "kept" ? ink : "text-text"}`}>{minutes(d.focusMin)}</span> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** One swatch and its word. */
function Key({ swatch, children }: { swatch: React.ReactNode; children: string }) {
  return (
    <span className="flex items-center gap-[6px]">
      {swatch}
      {children}
    </span>
  );
}

/**
 * What the marks mean, and in one fixed spot at the end of the row, the details of the day under
 * the pointer or keyboard focus (read out politely as it changes).
 */
function Legend({ o, active, month }: { o: StatsOverview; active: DayStat | null; month: boolean }) {
  const box = "box-border h-[10px] w-[10px] rounded-[2px]";
  const has = (s: DayStat["status"]) => o.days.some((d) => d.status === s);
  return (
    <div className="flex min-h-5 shrink-0 flex-wrap items-center gap-x-[18px] gap-y-1 whitespace-nowrap border-t border-line pt-3 text-meta text-muted">
      <Key
        swatch={
          month ? (
            <span className="flex gap-[3px]">
              <span className={`${box} bg-heat-1`} />
              <span className={`${box} bg-heat-2`} />
              <span className={`${box} bg-heat-3`} />
            </span>
          ) : (
            <span className={`${box} bg-sealed`} />
          )
        }
      >
        Focused
      </Key>
      {month ? <Key swatch={<span className="h-[7px] w-[7px] rounded-full bg-second" />}>Kept</Key> : null}
      <Key swatch={<span className={`${box} border border-line-input bg-raised`} />}>Missed</Key>
      <Key swatch={<span className={`${box} border-[1.5px] border-sealed bg-sealed-tint`} />}>Today</Key>
      {has("broken") ? <Key swatch={<span className={`${box} border border-broken bg-broken-tint`} />}>Broken</Key> : null}
      {has("rest") ? <Key swatch={<span className={`${box} border border-dashed border-muted`} />}>Rest day</Key> : null}
      {month ? null : <Key swatch={<span className="w-[14px] border-t-2 border-dashed border-second" />}>Target</Key>}
      <span data-testid="stats-hover" aria-live="polite" className="ml-auto min-w-0 shrink truncate text-right text-text-2">
        {active ? dayDetail(active.date, active, o.goalMin) : "Hover or focus a day for details"}
      </span>
    </div>
  );
}

function TemptedPanel({ o }: { o: StatsOverview }) {
  const apps = useInstalledApps();
  const top = Math.max(1, ...o.tempted.map((t) => t.count));
  return (
    <Section title="What tempted you" action={<span className="font-mono text-meta text-muted">{o.attempts === 1 ? "1 attempt" : `${o.attempts} attempts`}</span>}>
      {o.tempted.length === 0 ? (
        <p className="m-0 px-[14px] py-3 text-meta text-muted">Nothing tried to get in.</p>
      ) : (
        <div className="flex flex-col py-1">
          {o.tempted.map((t) => (
            <div key={`${t.what}-${t.kind}`} className="flex flex-col gap-[6px] px-[14px] py-[6px]">
              <span className="flex items-baseline gap-2">
                <span className="min-w-0 truncate text-body font-medium text-text">{temptedLabel(t.what, apps)}</span>
                <span className="text-micro text-muted">{TEMPTED_KIND[t.kind] ?? t.kind}</span>
                <span className="ml-auto font-mono text-meta text-text-2">{t.count}</span>
              </span>
              <span className="h-1 overflow-hidden rounded-[2px] bg-raised">
                <span className="block h-full rounded-[2px] bg-muted" style={{ width: `${(t.count / top) * 100}%` }} />
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
    { label: "Distracting", min: o.distractingMin, color: "bg-second" },
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
              <span className="w-9 text-right font-mono text-muted">{total ? `${Math.round((p.min / total) * 100)}%` : "–"}</span>
            </span>
          ))}
        </div>
        {total === 0 ? <p className="m-0 text-meta text-muted">Activity shows up as you work.</p> : null}
      </div>
    </Section>
  );
}

export type StatsTab = "overview" | "sessions" | "activity" | "day";
const TABS: readonly SegmentOption<StatsTab>[] = [
  { value: "overview", label: "Overview" },
  { value: "sessions", label: "Sessions" },
  { value: "activity", label: "Activity" },
  { value: "day", label: "Day" },
];

export function StatsPage() {
  const dailyResetTime = useStore((s) => s.settings.dailyResetTime);
  const [tab, setTab] = useState<StatsTab>("overview");
  // The Day tab opens on a date picked elsewhere (a day in Overview, a session's day).
  const [dayKey, setDayKey] = useState(() => todayKey(new Date(), dailyResetTime));
  const openDay = (key: string) => (setDayKey(key), setTab("day"));
  return (
    <div className="flex h-full flex-col gap-4 px-7 pb-6 pt-5">
      <div className="flex h-control shrink-0 items-center justify-between gap-3">
        <h1 className="page-title m-0 whitespace-nowrap">Stats</h1>
        <Segmented label="Stats" options={TABS} value={tab} onChange={setTab} panels="stats" />
      </div>
      {/* The tab's panel swaps in place: no fade or rise (motion spec §8). */}
      <TabPanel key={tab} base="stats" value={tab} className="flex min-h-0 grow flex-col gap-4">
        {tab === "overview" ? <Overview onOpenDay={openDay} /> : null}
        {tab === "sessions" ? <SessionsTab onOpenDay={openDay} /> : null}
        {tab === "activity" ? <ActivityTab /> : null}
        {tab === "day" ? <DayTab date={dayKey} onDate={setDayKey} /> : null}
      </TabPanel>
    </div>
  );
}

function Overview({ onOpenDay }: { onOpenDay: (key: string) => void }) {
  const dailyResetTime = useStore((s) => s.settings.dailyResetTime);
  const today = todayKey(new Date(), dailyResetTime);
  const [range, setRange] = useState<StatsRange>("week");
  const [anchor, setAnchor] = useState(() => todayKey(new Date(), dailyResetTime));
  const [o, setO] = useState<StatsOverview | null>(null);
  const [paused, setPaused] = useState<PauseSummary | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const { from, to } = rangeOf(range, anchor);
  const [target, setTarget] = useState<WeekTarget | null>(null);
  useEffect(() => {
    const load = () => void native.reviewWeekTarget().then(setTarget, () => undefined);
    load();
    window.addEventListener(WEEK_TARGET_EVENT, load);
    return () => window.removeEventListener(WEEK_TARGET_EVENT, load);
  }, []);
  const current = range === "week" ? from <= today && today <= to : addMonths(anchor, 0) === addMonths(today, 0);

  // Paging fast: only the latest range's answers land.
  const gen = useRef(0);
  const load = useCallback(() => {
    const g = ++gen.current;
    const latest = () => g === gen.current;
    void native
      .statsOverview(from, to)
      .then((v) => latest() && setO(v))
      .catch(() => latest() && setO(null));
    void native.pauseSummary(from, to).then(
      (v) => latest() && setPaused(v),
      () => latest() && setPaused(null),
    );
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
  const activeDay = (o && active && o.days.find((d) => d.date === active)) || null;
  return (
    <>
      <div className="flex h-control items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="whitespace-nowrap text-body text-text-2">{rangeTitle(range, anchor)}</span>
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
        <Segmented
          label="Range"
          options={RANGES}
          value={range}
          onChange={(r) => {
            setRange(r);
            setActive(null);
            if (current) setAnchor(today);
          }}
        />
      </div>

      {o ? (
        <>
          <Summary o={o} paused={paused} targetMin={range === "week" && target?.week === from ? target.targetMin : null} />
          <div className="grid min-h-0 grow grid-cols-[minmax(0,1fr)_280px] gap-4">
            <section
              aria-label={range === "week" ? "Focus by day" : "Focus heatmap"}
              className="flex min-h-0 flex-col gap-[14px] rounded-panel border border-line bg-panel pb-[18px] pl-[14px] pr-[22px] pt-[22px]"
            >
              {range === "week" ? (
                <DayChart o={o} active={active} onActive={setActive} onOpen={onOpenDay} />
              ) : (
                <Heatmap o={o} month={anchor} active={active} onActive={setActive} onOpen={onOpenDay} />
              )}
              <Legend o={o} active={activeDay} month={range === "month"} />
            </section>
            <div className="flex min-h-0 flex-col gap-4 overflow-y-auto">
              <Suggestions />
              <TemptedPanel o={o} />
              <TimePanel o={o} />
            </div>
          </div>
        </>
      ) : null}
    </>
  );
}
