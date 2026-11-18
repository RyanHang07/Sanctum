import { useEffect, useMemo, useRef, useState } from "react";
import { useDayStats } from "../../components/StreakMark";
import type { DayStat } from "../../lib/types";
import { Button } from "../../components/Button";
import { Check, SEGMENT_TEXT, SEGMENTED_HEIGHT, Segmented, Switch, type SegmentOption } from "../../components/controls";
import { ChevronRightIcon, PlusIcon, WeekIcon } from "../../components/icons";
import { DUR, EASE, gsap } from "../../lib/gsap";
import { useMotion } from "../../lib/useMotion";
import { DayDot, DayMark, EventMark, Fold, whenOf, type When } from "./marks";
import { EventDialog, OneTimeDialog, RepeatGlyph, RoutineDialog } from "./editors";
import { drag, dragProps, moveTo } from "./drag";
import { PendingBox, PendingSection, PendingStrip } from "./Pending";
import { NARROW, useMedia } from "../../lib/useMedia";
import { QuickAddField, QuickAddPanel } from "../../components/QuickAdd";
import { usePlanner } from "../../state/planner";
import { useAgenda, useCalendar } from "../../state/calendar";
import { useStore, type WeekView } from "../../state/store";
import { addDays, addMonths, daysLabel, fromKey, monthGrid, moveId, shortTime, todayKey, weekKeys, weekStart, type AgendaItem } from "../../lib/planner";
import type { CalEvent, Routine, Todo } from "../../lib/types";

// Week tab (design/screens/Week.dc.html): 7 day columns of one-time items plus routine cards,
// and a separate Routines view for everything that repeats (SPEC 4.12).

type View = WeekView;

const VIEWS: readonly SegmentOption<View>[] = [
  { value: "week", label: "Week" },
  { value: "list", label: "List" },
  { value: "month", label: "Month" },
  { value: "routines", label: "Routines" },
];

/** The four views. They swap the whole page rather than a panel, so a pressed-button group, not tabs. */
function ViewSwitch({ view, onChange }: { view: View; onChange: (v: View) => void }) {
  return <Segmented label="View" options={VIEWS} value={view} onChange={onChange} />;
}

function rangeTitle(start: string) {
  const a = fromKey(start);
  const b = fromKey(addDays(start, 6));
  const month = (d: Date) => d.toLocaleDateString("en-US", { month: "short" });
  return a.getMonth() === b.getMonth() ? `${month(a)} ${a.getDate()} – ${b.getDate()}` : `${month(a)} ${a.getDate()} – ${month(b)} ${b.getDate()}`;
}

/** The words under a card's title: its time, then what it is or how it went. */
function cardMeta(item: AgendaItem, when: When, tag: string | undefined): string {
  const parts: string[] = [];
  // An event names its calendar, so it reads as an event without hovering (decided 2026-11-16).
  if (item.kind === "event") parts.push(item.time ? shortTime(item.time) : "all day", ...(item.event?.calendarName ? [item.event.calendarName] : []));
  else if (item.kind === "routine" && (item.sessionsTarget ?? 1) > 1) parts.push(`${item.sessionsDone ?? 0}/${item.sessionsTarget}`);
  else if (item.time) parts.push(shortTime(item.time));
  if (tag) parts.push(tag);
  if (item.kind === "todo" && !item.time && !tag) {
    if (item.done) parts.push("Done");
    else if (when === "past") parts.push("Not done");
  }
  if (item.kind === "routine" && !parts.length) parts.push("anytime");
  return parts.join(" · ");
}

/**
 * One card in a day (ProtoWeek.dc.html). Past and today sit on a raised surface; future items are
 * outlined, only planned. A Google Calendar event has no box. Done items are struck through;
 * past ones left undone keep a hollow box and dim, so what slipped stays visible. No left-edge
 * accent: the profile's name in the meta line says an item seals a profile.
 */
function ItemCard({ item, when, onOpen }: { item: AgendaItem; when: When; onOpen: () => void }) {
  const toggle = usePlanner((s) => s.toggle);
  const tag = useStore((s) => (item.profileId === null ? undefined : s.profiles.find((p) => p.id === item.profileId)?.name));
  const event = item.kind === "event";
  const routine = item.kind === "routine";
  const multi = routine && (item.sessionsTarget ?? 1) > 1;
  const partial = multi && (item.sessionsDone ?? 0) > 0 && !item.done;
  const slipped = !event && !item.done && when === "past";
  const title = item.done
    ? "font-medium text-muted line-through decoration-muted"
    : slipped
      ? "font-medium text-muted"
      : event && when === "past"
        ? "font-semibold text-text-2"
        : "font-semibold text-text";
  return (
    <div
      data-kind={item.kind}
      data-when={when}
      data-state={event ? undefined : item.done ? "done" : slipped ? "slipped" : "open"}
      data-focus={item.profileId !== null || undefined}
      {...dragProps(item)}
      className={`group flex shrink-0 items-start gap-2 rounded-control border px-[10px] py-[9px] transition-colors duration-ui ease-ui hover:border-line-input ${
        when === "future" ? "border-line bg-transparent" : "border-transparent bg-raised"
      }`}
    >
      {event ? <EventMark size={16} /> : (
        <Check
          done={item.done}
          partial={partial}
          checked={multi ? (item.done ? true : partial ? "mixed" : false) : item.done}
          label={multi ? `${item.title} (${item.sessionsDone ?? 0} of ${item.sessionsTarget} sessions)` : item.title}
          onToggle={() => void toggle(item)}
        />
      )}
      <button type="button" onClick={onOpen} title={item.event?.calendarName} className="flex min-w-0 grow flex-col gap-[3px] whitespace-normal text-left">
        <span className={`line-clamp-3 hyphens-auto break-words text-meta leading-snug transition-colors duration-ui ease-ui ${title}`}>{item.title}</span>
        <span className="flex min-w-0 items-center gap-1 font-mono text-micro text-muted">
          {routine ? <RepeatGlyph className="h-[10px] w-[10px] shrink-0" /> : null}
          <span title={cardMeta(item, when, tag)} className="truncate">{cardMeta(item, when, tag)}</span>
        </span>
      </button>
    </div>
  );
}

/** A day's routines, folded under one row at the top so the week shows what's different. */
function RoutineFold({ date, when, items, onOpen }: { date: string; when: When; items: AgendaItem[]; onOpen: (i: AgendaItem) => void }) {
  const open = useStore((s) => s.weekRoutinesOpen.includes(date));
  const toggle = useStore((s) => s.toggleWeekRoutines);
  const done = items.filter((i) => i.done).length;
  return (
    <div className="flex shrink-0 flex-col">
      <button
        type="button"
        aria-expanded={open}
        aria-label={`Routines, ${done} of ${items.length} done`}
        onClick={() => toggle(date)}
        className="flex h-7 w-full shrink-0 items-center gap-[6px] rounded-control border border-line px-2 text-left text-meta text-muted transition-colors duration-ui ease-ui hover:border-line-input hover:text-text-2"
      >
        <ChevronRightIcon size={8} className={`shrink-0 transition-transform duration-ui ease-ui ${open ? "rotate-90" : ""}`} />
        <span className="min-w-0 truncate">Routines</span>
        <span className="ml-auto shrink-0 font-mono text-micro">
          {done}/{items.length}
        </span>
      </button>
      <Fold open={open}>
        <div className="flex flex-col gap-[10px] pt-[10px]">
          {items.map((i) => (
            <ItemCard key={i.key} item={i} when={when} onOpen={() => onOpen(i)} />
          ))}
        </div>
      </Fold>
    </div>
  );
}

/** Focused minutes under the mark: a figure and the goal on today, a total on past days. */
function DayMinutes({ when, stat }: { when: When; stat?: DayStat }) {
  const goal = useStore((s) => s.settings.dailyGoalMin);
  if (when === "future") return null;
  const min = stat?.focusMin ?? 0;
  if (when === "today") {
    const pct = goal > 0 ? Math.min(1, min / goal) : 0;
    return (
      <div className="flex shrink-0 flex-col gap-2 pb-[2px] pt-1">
        <span className="flex items-baseline gap-[5px] overflow-hidden">
          <span data-testid="today-minutes" className="font-mono text-[30px] font-medium leading-none text-text">
            {min}
          </span>
          <span className="whitespace-nowrap text-meta text-muted">of {goal} min</span>
        </span>
        <div role="img" aria-label={`${min} minutes of a ${goal} minute goal`} className="relative h-1 overflow-hidden rounded-full bg-line">
          <span
            data-testid="today-fill"
            className="absolute inset-0 origin-left rounded-full bg-sealed transition-transform duration-glide ease-glide"
            style={{ transform: `scaleX(${pct})` }}
          />
        </div>
      </div>
    );
  }
  if (!stat || stat.status === "none") return <span className="shrink-0 text-meta text-muted">Nothing recorded</span>;
  return (
    <span className="shrink-0 text-meta text-muted">
      <span className="font-mono font-medium text-text-2">{min}</span> min
    </span>
  );
}

/** One day. `fixed`: a cell in the two-row grid, which doesn't widen on hover. */
function DayColumn({ date, items, today, stat, onOpen, fixed = false }: { date: string; items: AgendaItem[]; today: string; stat?: DayStat; onOpen: (i: AgendaItem) => void; fixed?: boolean }) {
  const [adding, setAdding] = useState<HTMLElement | null>(null);
  const [over, setOver] = useState(false);
  const d = fromKey(date);
  const when = whenOf(date, today);
  const accepts = () => drag.item !== null && (drag.item.date !== date || !!drag.item.undated);
  const routines = items.filter((i) => i.kind === "routine");
  // Events first, then the rest in their order.
  const rest = items.filter((i) => i.kind === "event").concat(items.filter((i) => i.kind !== "routine" && i.kind !== "event"));
  return (
    <section
      aria-label={d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
      data-when={when}
      data-drop={over || undefined}
      onDragOver={(e) => {
        if (!accepts()) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
        setOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const item = drag.item;
        drag.item = null;
        if (item) void moveTo(item, date);
      }}
      className={`group/day ${over ? "outline-2 -outline-offset-2 outline-dashed outline-sealed" : ""} flex min-h-0 min-w-0 flex-col gap-[10px] overflow-y-auto overflow-x-hidden rounded-panel border px-[10px] py-[14px] [scrollbar-width:none] transition-[flex-grow,opacity] duration-enter ease-ui ${fixed ? "" : "flex-[1_1_0%] hover:flex-[2.6_1_0%] focus-within:flex-[2.6_1_0%] group-hover/week:opacity-60 hover:opacity-100! focus-within:opacity-100!"} ${
        when === "today" ? "border-sealed bg-panel" : when === "future" ? "border-line bg-app" : "border-line bg-panel"
      }`}
    >
      <div className="flex shrink-0 items-baseline justify-between">
        <span className={`text-[14px] font-bold ${when === "today" ? "text-sealed-text" : when === "future" ? "text-muted" : "text-text"}`}>
          {d.toLocaleDateString("en-US", { weekday: "short" })}
        </span>
        <span className={`font-mono text-meta ${when === "today" ? "text-sealed-text" : "text-muted"}`}>{d.getDate()}</span>
      </div>
      <DayMark day={stat} />
      <DayMinutes when={when} stat={stat} />
      {routines.length ? <RoutineFold date={date} when={when} items={routines} onOpen={onOpen} /> : null}
      {rest.map((i) => (
        <ItemCard key={i.key} item={i} when={when} onOpen={() => onOpen(i)} />
      ))}
      <button
        type="button"
        aria-label={`Add to ${d.toLocaleDateString("en-US", { weekday: "long" })}`}
        aria-expanded={!!adding}
        onClick={(e) => setAdding(e.currentTarget)}
        className="flex h-7 shrink-0 items-center gap-[6px] rounded-control px-[6px] text-left text-meta text-muted opacity-0 transition-[opacity,color,background-color] duration-ui ease-ui hover:bg-raised hover:text-text-2 focus-visible:opacity-100 group-hover/day:opacity-100 aria-expanded:opacity-100"
      >
        <PlusIcon size={11} /> Add
      </button>
      {adding ? <QuickAddPanel anchor={adding} date={date} onClose={() => setAdding(null)} /> : null}
    </section>
  );
}

/** "Synced with Google Calendar" (Week.dc.html), or a way to connect or reconnect. */
function SyncStatus() {
  const status = useCalendar((s) => s.status);
  if (!status?.configured) return null;
  if (status.connected && !status.needsReconnect) {
    return (
      <span className="ml-auto flex items-center gap-[6px]" title={status.email ?? undefined}>
        <span className={`h-[6px] w-[6px] rounded-full ${status.error ? "bg-broken" : "bg-event"}`} />
        {status.error ? "Google Calendar sync failed" : "Synced with Google Calendar"}
      </span>
    );
  }
  return (
    <button type="button" onClick={() => useStore.getState().openSetup("calendar")} className="ml-auto flex items-center gap-[6px] text-muted transition-colors duration-ui ease-ui hover:text-text">
      <span className={`h-[6px] w-[6px] rounded-full ${status.needsReconnect ? "bg-broken" : "bg-faint"}`} />
      {status.needsReconnect ? "Reconnect Google Calendar in Setup" : "Connect Google Calendar in Setup"}
    </button>
  );
}

/**
 * The seven days and Pending. Stepping to another week slides the days 16 px in the direction of
 * travel and settles (motion spec §8: the direction is the information). Reduced motion: no move.
 */
function WeekView({ start, onOpen }: { start: string; onOpen: (i: AgendaItem) => void }) {
  const days = useMemo(() => weekKeys(start), [start]);
  const agenda = useAgenda(days);
  const stats = useDayStats(days[0]!, days[6]!);
  const dailyResetTime = useStore((s) => s.settings.dailyResetTime);
  const today = todayKey(new Date(), dailyResetTime);
  const narrow = useMedia(NARROW);
  const grid = useRef<HTMLDivElement>(null);
  const { run } = useMotion(grid);
  const shown = useRef(start);
  useEffect(() => {
    if (shown.current === start || !grid.current) return;
    const dir = start > shown.current ? 1 : -1;
    shown.current = start;
    run(() =>
      gsap
        .timeline({ id: "week-step" })
        .fromTo(grid.current, { x: 16 * dir, opacity: 0.5 }, { x: 0, opacity: 1, duration: DUR.state, ease: EASE.ui, clearProps: "transform,opacity" }),
    );
  }, [start]);
  return (
    <>
      <div ref={grid} data-testid="week-grid" className="flex min-h-0 grow flex-col gap-2">
        {narrow ? (
          // Narrow (a vertical monitor): two rows, Monday to Thursday, then Friday to Sunday and Pending.
          <div className="grid min-h-0 grow grid-cols-4 grid-rows-2 gap-2">
            {days.map((d) => (
              <DayColumn key={d} date={d} items={agenda[d] ?? []} today={today} stat={stats[d]} onOpen={onOpen} fixed />
            ))}
            <PendingBox week={start} onOpen={onOpen} />
          </div>
        ) : (
          // The day under the pointer (or being edited) widens; the rest step back.
          <div className="group/week flex min-h-0 grow gap-[10px]">
            {days.map((d) => (
              <DayColumn key={d} date={d} items={agenda[d] ?? []} today={today} stat={stats[d]} onOpen={onOpen} />
            ))}
          </div>
        )}
      </div>
      {narrow ? null : <PendingStrip week={start} onOpen={onOpen} />}
      <div className="flex items-center gap-[18px] text-meta text-muted">
        <SyncStatus />
      </div>
    </>
  );
}

/** Every routine in your order: drag a row to move it (Home's untimed routines follow it). */
function RoutinesView({ onOpen }: { onOpen: (r: Routine) => void }) {
  const routines = usePlanner((s) => s.routines);
  const saveRoutine = usePlanner((s) => s.saveRoutine);
  const profiles = useStore((s) => s.profiles);
  const sorted = [...routines].sort((a, b) => a.sort - b.sort || a.id - b.id);
  // The dragged id lives in a ref too, so drag events between renders see it.
  const held = useRef<number | null>(null);
  const [dragId, setDragId] = useState<number | null>(null);
  const [over, setOver] = useState<{ id: number; after: boolean } | null>(null);
  const below = (e: React.DragEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return e.clientY > r.top + r.height / 2;
  };
  const endDrag = () => {
    held.current = null;
    setDragId(null);
    setOver(null);
  };
  return (
    <section aria-label="Routines" className="flex min-h-0 grow flex-col overflow-hidden rounded-panel border border-line bg-panel">
      {sorted.length === 0 ? (
        <p className="m-0 px-[14px] py-4 text-body text-muted">No routines yet. Add the things you do every day or every week.</p>
      ) : null}
      <div className="flex flex-col overflow-y-auto">
        {sorted.map((r) => {
          const profile = profiles.find((p) => p.id === r.profileId);
          return (
            <div
              key={r.id}
              data-testid="routine-row"
              data-id={r.id}
              draggable
              onKeyDown={(e) => {
                // Alt+Up / Alt+Down moves it, like dragging.
                if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
                const i = sorted.findIndex((x) => x.id === r.id);
                const next = sorted[i + (e.key === "ArrowUp" ? -1 : 1)];
                if (!next) return;
                e.preventDefault();
                void usePlanner.getState().reorderRoutines(moveId(sorted.map((x) => x.id), r.id, next.id, e.key === "ArrowDown"));
                requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-id="${r.id}"] button`)?.focus());
              }}
              onDragStart={(e) => {
                held.current = r.id;
                setDragId(r.id);
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", r.title);
              }}
              onDragEnd={endDrag}
              onDragOver={(e) => {
                if (held.current === null || held.current === r.id) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                const after = below(e);
                if (over?.id !== r.id || over.after !== after) setOver({ id: r.id, after });
              }}
              onDrop={(e) => {
                const moved = held.current;
                if (moved === null || moved === r.id) return;
                e.preventDefault();
                void usePlanner.getState().reorderRoutines(moveId(sorted.map((x) => x.id), moved, r.id, below(e)));
                endDrag();
              }}
              className={`group relative flex h-12 shrink-0 cursor-grab items-center gap-3 border-b border-line-soft px-[14px] transition-colors duration-ui ease-ui last:border-b-0 hover:bg-raised active:cursor-grabbing ${r.active ? "" : "opacity-55"} ${dragId === r.id ? "opacity-40" : ""}`}
            >
              {over?.id === r.id ? <span aria-hidden="true" className={`pointer-events-none absolute inset-x-[14px] h-[2px] rounded-full bg-sealed ${over.after ? "bottom-0" : "top-0"}`} /> : null}
              <RepeatGlyph className={profile ? "text-sealed-text" : "text-muted"} />
              <button type="button" onClick={() => onOpen(r)} className="flex min-w-0 grow items-center gap-3 text-left">
                <span className="min-w-0 grow truncate text-body font-medium text-text">{r.title}</span>
                <span className="w-[120px] shrink-0 text-meta text-text-2">{daysLabel(r.daysMask)}</span>
                <span className="w-[56px] shrink-0 font-mono text-meta text-muted">{r.time ? shortTime(r.time) : "anytime"}</span>
                <span className="w-[52px] shrink-0 font-mono text-meta text-muted">{r.durationMin ? `${r.durationMin}m` : ""}</span>
                <span className="w-[72px] shrink-0 font-mono text-meta text-muted">{!r.trackerId && r.sessionsPerDay > 1 ? `${r.sessionsPerDay}/day` : ""}</span>
                <span className="w-[120px] shrink-0 truncate text-meta text-muted">{profile?.name ?? ""}</span>
                <ChevronRightIcon size={10} className="shrink-0 text-faint opacity-0 transition-opacity duration-ui ease-ui group-hover:opacity-100" />
              </button>
              <Switch label={`${r.title} active`} checked={r.active} onChange={(active) => void saveRoutine({ ...r, active })} />
            </div>
          );
        })}
      </div>
    </section>
  );
}

// --- List view: easier to read, modeled on the user's weekly agenda page ---


function ListRow({ item, when, meta, onOpen }: { item: AgendaItem; when: When; meta?: string; onOpen: () => void }) {
  const toggle = usePlanner((s) => s.toggle);
  const tag = useStore((s) => s.profiles.find((p) => p.id === item.profileId)?.name);
  const multi = item.kind === "routine" && (item.sessionsTarget ?? 1) > 1;
  const partial = multi && (item.sessionsDone ?? 0) > 0 && !item.done;
  const slipped = item.kind !== "event" && !item.done && when === "past";
  return (
    <div
      data-kind={item.kind}
      data-state={item.kind === "event" ? undefined : item.done ? "done" : slipped ? "slipped" : "open"}
      className="group flex h-[30px] items-center gap-[10px] rounded-control px-1 transition-colors duration-ui ease-ui hover:bg-raised"
    >
      {item.kind === "event" ? (
        // An event has no box: nothing to tick.
        <span aria-hidden="true" className="h-4 w-4 shrink-0" />
      ) : (
        <Check
          done={item.done}
          partial={partial}
          checked={multi ? (item.done ? true : partial ? "mixed" : false) : item.done}
          label={multi ? `${item.title} (${item.sessionsDone ?? 0} of ${item.sessionsTarget} sessions)` : item.title}
          onToggle={() => void toggle(item)}
        />
      )}
      <button
        type="button"
        onClick={onOpen}
        title={item.title}
        className={`min-w-0 grow truncate text-left text-body transition-colors duration-ui ease-ui ${item.done ? "text-muted line-through decoration-muted" : slipped ? "text-muted" : "text-text"}`}
      >
        {item.title}
      </button>
      {multi ? <span className="shrink-0 font-mono text-micro text-muted">{item.sessionsDone ?? 0}/{item.sessionsTarget}</span> : null}
      {tag ? <span className="flex h-5 shrink-0 items-center rounded-[4px] border border-line-input px-[7px] text-micro text-text-2">{tag}</span> : null}
      <span className="shrink-0 font-mono text-micro text-muted">{meta ?? (item.time ? shortTime(item.time) : item.kind === "event" ? "all day" : "")}</span>
    </div>
  );
}

function QuickAdd({ date, label }: { date: string; label: string }) {
  return (
    <QuickAddField
      date={date}
      label={label}
      placeholder="To-do"
      prefix={<span className="box-border h-4 w-4 shrink-0 rounded-[4px] border-[1.5px] border-dashed border-line-input" />}
      className="flex h-[30px] cursor-text items-center gap-[10px] rounded-control px-1 text-muted transition-colors duration-ui ease-ui hover:bg-raised"
    />
  );
}

function DayList({ date, items, when, onOpen }: { date: string; items: AgendaItem[]; when: When; onOpen: (i: AgendaItem) => void }) {
  const d = fromKey(date);
  const today = when === "today";
  const weekday = d.toLocaleDateString("en-US", { weekday: "long" });
  const once = items.filter((i) => i.kind !== "routine");
  const repeats = items.filter((i) => i.kind === "routine");
  return (
    <section aria-label={`${weekday} list`} className="mb-6 break-inside-avoid">
      <h2 className={`m-0 mb-1 flex items-baseline gap-2 border-b pb-[6px] text-body font-semibold ${today ? "border-sealed-line text-sealed-text" : "border-line text-text"}`}>
        {weekday}
        <span className="font-mono text-micro font-normal text-muted">{d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
        {today ? <span className="ml-auto text-micro font-medium">Today</span> : null}
      </h2>
      {once.map((i) => (
        <ListRow key={i.key} item={i} when={when} onOpen={() => onOpen(i)} />
      ))}
      <QuickAdd date={date} label={`Add a to-do on ${weekday}`} />
      {repeats.length ? (
        <div className="mt-2">
          <span className="label flex items-center gap-[6px] px-1 pb-1">
            <RepeatGlyph className="h-[10px] w-[10px]" /> Repeat
          </span>
          {repeats.map((i) => (
            <ListRow key={i.key} item={i} when={when} onOpen={() => onOpen(i)} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function ListView({ start, onOpen }: { start: string; onOpen: (i: AgendaItem) => void }) {
  const days = useMemo(() => weekKeys(start), [start]);
  const agenda = useAgenda(days);
  const dailyResetTime = useStore((s) => s.settings.dailyResetTime);
  const today = todayKey(new Date(), dailyResetTime);
  return (
    <div className="min-h-0 grow overflow-y-auto pr-1">
      {/* Two flowing columns: Monday to Thursday, then Friday to Sunday and Pending. */}
      <div className="columns-2 gap-10">
        {days.map((d) => (
          <DayList key={d} date={d} items={agenda[d] ?? []} when={whenOf(d, today)} onOpen={onOpen} />
        ))}
        <PendingSection
          week={start}
          onOpen={onOpen}
          heading={(count) => (
            <h2 className="m-0 mb-1 flex items-baseline gap-2 border-b border-line pb-[6px] text-body font-semibold text-text">
              Pending
              <span className="font-mono text-micro font-normal text-muted">{count}</span>
            </h2>
          )}
        />
      </div>
    </div>
  );
}

// --- Month view: a grid of the month (SPEC 4.12). Clicking a day opens its week. ---

const WEEKDAY_HEADS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTH_ITEMS = 3;

function MonthCell({ date, items, inMonth, today, stat, onPick }: { date: string; items: AgendaItem[]; inMonth: boolean; today: string; stat?: DayStat; onPick: () => void }) {
  const d = fromKey(date);
  const routines = items.filter((i) => i.kind === "routine");
  const rest = items.filter((i) => i.kind !== "routine");
  const shown = rest.slice(0, MONTH_ITEMS);
  const isToday = date === today;
  return (
    <button
      type="button"
      onClick={onPick}
      aria-label={d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
      className={`flex min-h-0 min-w-0 flex-col gap-[3px] overflow-hidden rounded-control border p-[6px] text-left whitespace-normal transition-colors duration-ui ease-ui hover:border-line-input hover:bg-panel ${
        // Today is a full cobalt edge (H4); days outside the month recede with a soft edge and
        // muted text, not opacity (H5).
        isToday ? "border-sealed bg-sealed-tint" : inMonth ? "border-line bg-panel" : "border-line-soft bg-panel"
      }`}
      data-outside={inMonth ? undefined : ""}
    >
      <span className="flex items-center justify-between">
        <span className="flex items-center gap-[5px]">
          <span className={`font-mono text-micro ${isToday ? "font-semibold text-sealed-text" : inMonth ? "text-text-2" : "text-muted"}`}>{d.getDate()}</span>
          {inMonth ? <DayDot day={stat} /> : null}
        </span>
        {routines.length && inMonth ? (
          <span data-testid="month-routines" className={`flex items-center gap-[3px] font-mono text-micro text-muted`}>
            <RepeatGlyph className="h-[9px] w-[9px]" />
            {date <= today ? `${routines.filter((r) => r.done).length}/${routines.length}` : routines.length}
          </span>
        ) : null}
      </span>
      {shown.map((i) => (
        <span key={i.key} className="flex min-w-0 items-center gap-[5px]">
          {i.kind === "event" ? (
            <span className="flex h-[10px] w-[10px] shrink-0 items-center justify-center text-muted" aria-hidden="true">
              <WeekIcon size={10} />
            </span>
          ) : (
            <span className={`h-[10px] w-[3px] shrink-0 rounded-[2px] ${i.profileId !== null ? "bg-sealed" : "bg-check-line"}`} />
          )}
          <span title={i.title} className={`truncate text-micro leading-tight ${i.done ? "text-muted line-through" : inMonth ? "text-text" : "text-muted"}`}>{i.title}</span>
        </span>
      ))}
      {rest.length > MONTH_ITEMS && inMonth ? <span className="text-micro text-muted">+{rest.length - MONTH_ITEMS} more</span> : null}
    </button>
  );
}

function MonthView({ month, onPick }: { month: string; onPick: (date: string) => void }) {
  const days = useMemo(() => monthGrid(month), [month]);
  const agenda = useAgenda(days);
  const stats = useDayStats(days[0]!, days[days.length - 1]!);
  const dailyResetTime = useStore((s) => s.settings.dailyResetTime);
  const today = todayKey(new Date(), dailyResetTime);
  const m = fromKey(month).getMonth();
  return (
    <section aria-label="Month" className="flex min-h-0 grow flex-col gap-[6px]">
      <div className="grid grid-cols-7 gap-[6px] px-1">
        {WEEKDAY_HEADS.map((h) => (
          <span key={h} className="label">
            {h}
          </span>
        ))}
      </div>
      <div className="grid min-h-0 grow grid-cols-7 gap-[6px]" style={{ gridTemplateRows: `repeat(${days.length / 7}, minmax(0, 1fr))` }}>
        {days.map((d) => (
          <MonthCell key={d} date={d} items={agenda[d] ?? []} inMonth={fromKey(d).getMonth() === m} today={today} stat={stats[d]} onPick={() => onPick(d)} />
        ))}
      </div>
    </section>
  );
}

const monthTitle = (key: string) => fromKey(key).toLocaleDateString("en-US", { month: "long", year: "numeric" });

export function WeekPage() {
  const view = useStore((s) => s.settings.weekView);
  const setView = useStore((s) => s.setWeekView);
  const dailyResetTime = useStore((s) => s.settings.dailyResetTime);
  const [start, setStart] = useState(() => weekStart(todayKey(new Date(), dailyResetTime)));
  const [month, setMonth] = useState(() => addMonths(todayKey(new Date(), dailyResetTime), 0));
  const [editing, setEditing] = useState<
    { kind: "todo"; todo?: Todo; date: string } | { kind: "routine"; routine?: Routine } | { kind: "event"; event: CalEvent; date: string } | null
  >(null);
  const ensure = usePlanner((s) => s.ensure);
  const ensureEvents = useCalendar((s) => s.ensure);
  const { routines, todos, pending } = usePlanner();

  // A different week starts with its routines folded; a trip to another tab doesn't count.
  const shownWeek = useRef(start);
  useEffect(() => {
    if (shownWeek.current === start) return;
    shownWeek.current = start;
    useStore.getState().closeWeekRoutines();
  }, [start]);
  useEffect(() => void ensure(start, addDays(start, 6)), [start, ensure]);
  useEffect(() => void ensureEvents(start, addDays(start, 6)), [start, ensureEvents]);
  useEffect(() => {
    if (view !== "month") return;
    const grid = monthGrid(month);
    void ensure(grid[0]!, grid[grid.length - 1]!);
    void ensureEvents(grid[0]!, grid[grid.length - 1]!);
  }, [view, month, ensure, ensureEvents]);

  const open = (i: AgendaItem) => {
    if (i.kind === "event" && i.event) setEditing({ kind: "event", event: i.event, date: i.date });
    else if (i.kind === "routine") setEditing({ kind: "routine", routine: routines.find((r) => r.id === i.id) });
    else setEditing({ kind: "todo", todo: todos.find((t) => t.id === i.id) ?? pending.find((t) => t.id === i.id), date: i.date });
  };
  const today = todayKey(new Date(), dailyResetTime);
  const thisWeek = weekStart(today);
  const thisMonth = addMonths(today, 0);
  const dated = view === "week" || view === "list";
  const newItem = () => {
    if (view === "routines") return setEditing({ kind: "routine" });
    if (view === "month") return setEditing({ kind: "todo", date: month === thisMonth ? today : month });
    setEditing({ kind: "todo", date: start <= today && today <= addDays(start, 6) ? today : start });
  };
  const openWeek = (date: string) => {
    setStart(weekStart(date));
    setView("week");
  };

  return (
    <div className="flex h-full flex-col gap-4 px-7 pb-6 pt-5">
      {/* Title and week navigation on the left; New and the view tabs stay put on the right. */}
      <div className="flex h-control items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <h1 className="page-title m-0 whitespace-nowrap">{view === "routines" ? "Routines" : view === "month" ? monthTitle(month) : rangeTitle(start)}</h1>
          {view === "month" ? (
            <div className="flex items-center gap-1">
              <Button variant="quiet" aria-label="Previous month" className="w-control px-0" onClick={() => setMonth(addMonths(month, -1))}>
                <ChevronRightIcon size={12} className="rotate-180" />
              </Button>
              <Button variant={month === thisMonth ? "quiet" : "ghost"} size="sm" onClick={() => setMonth(thisMonth)}>
                This month
              </Button>
              <Button variant="quiet" aria-label="Next month" className="w-control px-0" onClick={() => setMonth(addMonths(month, 1))}>
                <ChevronRightIcon size={12} />
              </Button>
            </div>
          ) : null}
          {dated ? (
            <div className="flex items-center gap-1">
              <Button variant="quiet" aria-label="Previous week" className="w-control px-0" onClick={() => setStart(addDays(start, -7))}>
                <ChevronRightIcon size={12} className="rotate-180" />
              </Button>
              <Button variant={start === thisWeek ? "quiet" : "ghost"} size="sm" onClick={() => setStart(thisWeek)}>
                This week
              </Button>
              <Button variant="quiet" aria-label="Next week" className="w-control px-0" onClick={() => setStart(addDays(start, 7))}>
                <ChevronRightIcon size={12} />
              </Button>
              {start !== thisWeek ? <span className="ml-1 text-meta text-muted">{start < thisWeek ? "Past week" : "Upcoming"}</span> : null}
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {/* Sized like the view tabs beside it (their box height, an option's padding and text) and
              always the plus; the fill keeps it the primary action. */}
          <button
            type="button"
            data-new-button=""
            aria-label={view === "routines" ? "New routine" : "New item"}
            className={`inline-flex shrink-0 items-center justify-center gap-[6px] rounded-control bg-sealed font-semibold text-sealed-on transition-[filter] duration-ui ease-ui hover:brightness-110 active:brightness-95 ${SEGMENTED_HEIGHT} ${SEGMENT_TEXT}`}
            onClick={newItem}
          >
            <PlusIcon size={11} /> New
          </button>
          <ViewSwitch view={view} onChange={setView} />
        </div>
      </div>

      {view === "week" ? <WeekView start={start} onOpen={open} /> : null}
      {view === "list" ? <ListView start={start} onOpen={open} /> : null}
      {view === "routines" ? <RoutinesView onOpen={(r) => setEditing({ kind: "routine", routine: r })} /> : null}
      {view === "month" ? <MonthView month={month} onPick={openWeek} /> : null}

      {editing?.kind === "todo" ? <OneTimeDialog initial={editing.todo} date={editing.date} onClose={() => setEditing(null)} /> : null}
      {editing?.kind === "routine" ? <RoutineDialog initial={editing.routine} onClose={() => setEditing(null)} /> : null}
      {editing?.kind === "event" ? <EventDialog initial={editing.event} date={editing.date} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}
