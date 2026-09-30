import { useEffect, useMemo, useState } from "react";
import { StreakDot, StreakMark, useDayStats } from "../../components/StreakMark";
import type { DayStat } from "../../lib/types";
import { Button } from "../../components/Button";
import { Switch } from "../../components/controls";
import { CheckIcon, ChevronRightIcon, PlusIcon } from "../../components/icons";
import { EventDialog, OneTimeDialog, RepeatGlyph, RoutineDialog } from "./editors";
import { QuickAddField, QuickAddPanel } from "../../components/QuickAdd";
import { usePlanner } from "../../state/planner";
import { useAgenda, useCalendar } from "../../state/calendar";
import { useStore, type WeekView } from "../../state/store";
import { addDays, addMonths, daysLabel, fromKey, monthGrid, shortTime, todayKey, weekKeys, weekStart, type AgendaItem } from "../../lib/planner";
import type { CalEvent, Routine, Todo } from "../../lib/types";

// Week tab (design/screens/Week.dc.html): 7 day columns of one-time items plus routine cards,
// and a separate Routines view for everything that repeats (SPEC 4.12).

type View = WeekView;

function ViewSwitch({ view, onChange }: { view: View; onChange: (v: View) => void }) {
  const views: { id: View; label: string }[] = [
    { id: "week", label: "Week" },
    { id: "list", label: "List" },
    { id: "month", label: "Month" },
    { id: "routines", label: "Routines" },
  ];
  return (
    <div role="tablist" aria-label="View" className="flex rounded-control border border-line-input p-[2px]">
      {views.map((v) => (
        <button
          key={v.id}
          role="tab"
          aria-selected={view === v.id}
          onClick={() => onChange(v.id)}
          className={`h-[26px] rounded-[4px] px-[10px] text-meta transition-colors duration-ui ease-ui ${
            view === v.id ? "bg-line font-medium text-text" : "text-muted hover:text-text-2"
          }`}
        >
          {v.label}
        </button>
      ))}
    </div>
  );
}

function rangeTitle(start: string) {
  const a = fromKey(start);
  const b = fromKey(addDays(start, 6));
  const month = (d: Date) => d.toLocaleDateString("en-US", { month: "short" });
  return a.getMonth() === b.getMonth() ? `${month(a)} ${a.getDate()} – ${b.getDate()}` : `${month(a)} ${a.getDate()} – ${month(b)} ${b.getDate()}`;
}

/** A Google Calendar event: a teal bar (cobalt when #focus-tagged), no checkbox (Week.dc.html). */
function EventCard({ item, onOpen }: { item: AgendaItem; onOpen: () => void }) {
  return (
    <button
      type="button"
      data-kind="event"
      onClick={onOpen}
      title={item.event?.calendarName}
      className="flex w-full shrink-0 items-start gap-[6px] whitespace-normal rounded-control border border-line bg-panel py-[7px] pl-[6px] pr-[5px] text-left transition-colors duration-ui ease-ui hover:border-line-input"
    >
      <span aria-hidden="true" className={`w-[3px] shrink-0 self-stretch rounded-[2px] ${item.profileId !== null ? "bg-sealed" : "bg-event"}`} />
      <span className="flex min-w-0 grow flex-col gap-[2px]">
        <span className="line-clamp-3 hyphens-auto break-words text-meta leading-snug text-text">{item.title}</span>
        <span className="truncate font-mono text-[10px] text-muted">{item.time ? shortTime(item.time) : "all day"}</span>
      </span>
    </button>
  );
}

function ItemCard({ item, onOpen }: { item: AgendaItem; onOpen: () => void }) {
  const toggle = usePlanner((s) => s.toggle);
  if (item.kind === "event") return <EventCard item={item} onOpen={onOpen} />;
  const routine = item.kind === "routine";
  const focus = item.profileId !== null;
  // Routines carry a tinted edge; focus-linked items (which seal their profile) a cobalt one.
  const edge = focus ? "border-l-sealed" : routine ? "border-l-check-line" : "border-l-transparent";
  return (
    <div
      data-kind={item.kind}
      className={`group flex items-start gap-[6px] rounded-control border border-l-2 border-line bg-panel py-[7px] pl-[6px] pr-[5px] transition-colors duration-ui ease-ui hover:border-line-input ${edge}`}
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={item.done}
        aria-label={item.title}
        onClick={() => void toggle(item)}
        className={`check-pop mt-px box-border flex h-[14px] w-[14px] shrink-0 items-center justify-center rounded-[4px] p-0 text-sealed-on transition-colors duration-ui ease-ui ${
          item.done ? "border border-sealed bg-sealed" : "border-[1.5px] border-check-line hover:border-muted"
        }`}
      >
        {item.done ? <CheckIcon size={8} /> : null}
      </button>
      <button type="button" onClick={onOpen} className="flex min-w-0 grow flex-col gap-[2px] whitespace-normal text-left">
        <span className={`line-clamp-3 hyphens-auto break-words text-meta leading-snug ${item.done ? "text-faint line-through" : "text-text"}`}>{item.title}</span>
        <span className="flex items-center gap-1 font-mono text-[10px] text-muted">
          {routine ? <RepeatGlyph className="h-[10px] w-[10px]" /> : null}
          {item.time ? shortTime(item.time) : routine ? "anytime" : ""}
        </span>
      </button>
    </div>
  );
}

function DayColumn({ date, items, today, stat, onOpen }: { date: string; items: AgendaItem[]; today: boolean; stat?: DayStat; onOpen: (i: AgendaItem) => void }) {
  const [adding, setAdding] = useState<HTMLElement | null>(null);
  const d = fromKey(date);
  return (
    <section
      aria-label={d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
      className={`flex min-h-0 min-w-0 flex-[1_1_0%] flex-col gap-[6px] overflow-y-auto overflow-x-hidden rounded-panel border p-[6px] [scrollbar-width:none] transition-[flex-grow,opacity,background-color] duration-enter ease-ui hover:flex-[2.6_1_0%] focus-within:flex-[2.6_1_0%] group-hover/week:opacity-60 hover:opacity-100! focus-within:opacity-100! ${
        today ? "border-sealed-line bg-sealed-tint/40" : "border-line bg-panel/40 hover:bg-panel"
      }`}
    >
      <div className="flex items-baseline justify-between px-1 pb-1 pt-[2px]">
        <span className={`text-meta font-semibold ${today ? "text-sealed-text" : "text-text"}`}>{d.toLocaleDateString("en-US", { weekday: "short" })}</span>
        <span className={`font-mono text-[11px] ${today ? "text-sealed-text" : "text-muted"}`}>{d.getDate()}</span>
      </div>
      <StreakMark day={stat} />
      {items.map((i) => (
        <ItemCard key={i.key} item={i} onOpen={() => onOpen(i)} />
      ))}
      <button
        type="button"
        aria-label={`Add to ${d.toLocaleDateString("en-US", { weekday: "long" })}`}
        aria-expanded={!!adding}
        onClick={(e) => setAdding(e.currentTarget)}
        className="flex h-7 shrink-0 items-center gap-[6px] rounded-control px-[6px] text-left text-meta text-faint transition-colors duration-ui ease-ui hover:bg-line-soft hover:text-text-2"
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
      <span className={`h-[6px] w-[6px] rounded-full ${status.needsReconnect ? "bg-broken" : "bg-open"}`} />
      {status.needsReconnect ? "Reconnect Google Calendar in Setup" : "Connect Google Calendar in Setup"}
    </button>
  );
}

function WeekView({ start, onOpen }: { start: string; onOpen: (i: AgendaItem) => void }) {
  const days = useMemo(() => weekKeys(start), [start]);
  const agenda = useAgenda(days);
  const stats = useDayStats(days[0]!, days[6]!);
  const today = todayKey();
  return (
    <>
      {/* The day under the pointer (or being edited) widens; the rest step back. */}
      <div className="group/week flex min-h-0 grow gap-2">
        {days.map((d) => (
          <DayColumn key={d} date={d} items={agenda[d] ?? []} today={d === today} stat={stats[d]} onOpen={onOpen} />
        ))}
      </div>
      <div className="flex gap-[18px] text-meta text-muted">
        <span className="flex items-center gap-[6px]">
          <span className="h-3 w-[3px] rounded-[2px] bg-sealed" />
          Focus block, seals its profile
        </span>
        <span className="flex items-center gap-[6px]">
          <RepeatGlyph className="h-3 w-3" />
          Routine, edit in Routines
        </span>
        <span className="flex items-center gap-[6px]">
          <span className="box-border h-[10px] w-[10px] rounded-[3px] border-[1.5px] border-check-line" />
          One-time item
        </span>
        <span className="flex items-center gap-[6px]">
          <span className="h-3 w-[3px] rounded-[2px] bg-event" />
          Calendar event
        </span>
        <SyncStatus />
      </div>
    </>
  );
}

function RoutinesView({ onOpen }: { onOpen: (r: Routine) => void }) {
  const routines = usePlanner((s) => s.routines);
  const saveRoutine = usePlanner((s) => s.saveRoutine);
  const profiles = useStore((s) => s.profiles);
  const sorted = [...routines].sort((a, b) => a.sort - b.sort || a.id - b.id);
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
              className={`group flex h-12 shrink-0 items-center gap-3 border-b border-line-soft px-[14px] transition-colors duration-ui ease-ui last:border-b-0 hover:bg-line-soft ${r.active ? "" : "opacity-55"}`}
            >
              <RepeatGlyph className={profile ? "text-sealed-text" : "text-muted"} />
              <button type="button" onClick={() => onOpen(r)} className="flex min-w-0 grow items-center gap-3 text-left">
                <span className="min-w-0 grow truncate text-body font-medium text-text">{r.title}</span>
                <span className="w-[120px] shrink-0 text-meta text-text-2">{daysLabel(r.daysMask)}</span>
                <span className="w-[56px] shrink-0 font-mono text-meta text-muted">{r.time ? shortTime(r.time) : "anytime"}</span>
                <span className="w-[52px] shrink-0 font-mono text-meta text-muted">{r.durationMin ? `${r.durationMin}m` : ""}</span>
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

const asItem = (t: Todo): AgendaItem => ({
  key: `todo:${t.id}`,
  kind: "todo",
  id: t.id,
  title: t.title,
  date: t.dueDate,
  time: t.dueTime,
  durationMin: t.durationMin,
  profileId: t.profileId,
  done: t.done,
});

function ListRow({ item, meta, onOpen }: { item: AgendaItem; meta?: string; onOpen: () => void }) {
  const toggle = usePlanner((s) => s.toggle);
  const tag = useStore((s) => s.profiles.find((p) => p.id === item.profileId)?.name);
  return (
    <div data-kind={item.kind} className="group flex h-[30px] items-center gap-[10px] rounded-control px-1 transition-colors duration-ui ease-ui hover:bg-line-soft">
      {item.kind === "event" ? (
        <span aria-hidden="true" className="flex h-4 w-4 shrink-0 justify-center">
          <span className={`w-[3px] rounded-[2px] ${item.profileId !== null ? "bg-sealed" : "bg-event"}`} />
        </span>
      ) : (
      <button
        type="button"
        role="checkbox"
        aria-checked={item.done}
        aria-label={item.title}
        onClick={() => void toggle(item)}
        className={`box-border flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] p-0 text-sealed-on transition-colors duration-ui ease-ui ${
          item.done ? "border border-sealed bg-sealed" : "border-[1.5px] border-check-line hover:border-muted"
        }`}
      >
        {item.done ? <CheckIcon size={9} /> : null}
      </button>
      )}
      <button type="button" onClick={onOpen} className={`min-w-0 grow truncate text-left text-body ${item.done ? "text-faint line-through" : "text-text"}`}>
        {item.title}
      </button>
      {tag ? <span className="flex h-5 shrink-0 items-center rounded-[4px] border border-line-input px-[7px] text-[11px] text-text-2">{tag}</span> : null}
      <span className="shrink-0 font-mono text-[11px] text-muted">{meta ?? (item.time ? shortTime(item.time) : item.kind === "event" ? "all day" : "")}</span>
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
      className="flex h-[30px] cursor-text items-center gap-[10px] rounded-control px-1 text-faint transition-colors duration-ui ease-ui hover:bg-line-soft"
    />
  );
}

function DayList({ date, items, today, onOpen }: { date: string; items: AgendaItem[]; today: boolean; onOpen: (i: AgendaItem) => void }) {
  const d = fromKey(date);
  const weekday = d.toLocaleDateString("en-US", { weekday: "long" });
  const once = items.filter((i) => i.kind !== "routine");
  const repeats = items.filter((i) => i.kind === "routine");
  return (
    <section aria-label={`${weekday} list`} className="mb-6 break-inside-avoid">
      <h2 className={`m-0 mb-1 flex items-baseline gap-2 border-b pb-[6px] text-[14px] font-semibold ${today ? "border-sealed-line text-sealed-text" : "border-line text-text"}`}>
        {weekday}
        <span className="font-mono text-[11px] font-normal text-muted">{d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
        {today ? <span className="ml-auto text-[11px] font-medium">Today</span> : null}
      </h2>
      {once.map((i) => (
        <ListRow key={i.key} item={i} onOpen={() => onOpen(i)} />
      ))}
      <QuickAdd date={date} label={`Add a to-do on ${weekday}`} />
      {repeats.length ? (
        <div className="mt-2">
          <span className="flex items-center gap-[6px] px-1 pb-1 text-[11px] font-medium uppercase tracking-[0.06em] text-faint">
            <RepeatGlyph className="h-[10px] w-[10px]" /> Repeat
          </span>
          {repeats.map((i) => (
            <ListRow key={i.key} item={i} onOpen={() => onOpen(i)} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function ListView({ start, onOpen }: { start: string; onOpen: (i: AgendaItem) => void }) {
  const { pending, loadPending } = usePlanner();
  const days = useMemo(() => weekKeys(start), [start]);
  const agenda = useAgenda(days);
  const today = todayKey();
  useEffect(() => void loadPending(), [loadPending]);
  return (
    <div className="min-h-0 grow overflow-y-auto pr-1">
      {/* Two flowing columns: Monday to Thursday, then Friday to Sunday and Pending. */}
      <div className="columns-2 gap-10">
        {days.map((d) => (
          <DayList key={d} date={d} items={agenda[d] ?? []} today={d === today} onOpen={onOpen} />
        ))}
        {pending.length ? (
          <section aria-label="Pending" className="mb-6 break-inside-avoid">
            <h2 className="m-0 mb-1 flex items-baseline gap-2 border-b border-line pb-[6px] text-[14px] font-semibold text-text">
              Pending
              <span className="font-mono text-[11px] font-normal text-muted">{pending.length}</span>
            </h2>
            {[...pending]
              .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
              .map((t) => (
                <ListRow
                  key={t.id}
                  item={asItem(t)}
                  meta={fromKey(t.dueDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  onOpen={() => onOpen(asItem(t))}
                />
              ))}
          </section>
        ) : null}
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
        isToday ? "border-sealed-line bg-sealed-tint/40" : "border-line bg-panel/40"
      } ${inMonth ? "" : "opacity-40"}`}
    >
      <span className="flex items-center justify-between">
        <span className="flex items-center gap-[5px]">
          <span className={`font-mono text-[11px] ${isToday ? "font-semibold text-sealed-text" : "text-text-2"}`}>{d.getDate()}</span>
          {inMonth ? <StreakDot day={stat} /> : null}
        </span>
        {routines.length ? (
          <span data-testid="month-routines" className={`flex items-center gap-[3px] font-mono text-[10px] ${date <= today ? "text-muted" : "text-faint"}`}>
            <RepeatGlyph className="h-[9px] w-[9px]" />
            {date <= today ? `${routines.filter((r) => r.done).length}/${routines.length}` : routines.length}
          </span>
        ) : null}
      </span>
      {shown.map((i) => (
        <span key={i.key} className="flex min-w-0 items-center gap-[5px]">
          <span className={`h-[10px] w-[3px] shrink-0 rounded-[2px] ${i.profileId !== null ? "bg-sealed" : i.kind === "event" ? "bg-event" : "bg-check-line"}`} />
          <span className={`truncate text-[11px] leading-tight ${i.done ? "text-faint line-through" : "text-text"}`}>{i.title}</span>
        </span>
      ))}
      {rest.length > MONTH_ITEMS ? <span className="text-[10px] text-muted">+{rest.length - MONTH_ITEMS} more</span> : null}
    </button>
  );
}

function MonthView({ month, onPick }: { month: string; onPick: (date: string) => void }) {
  const days = useMemo(() => monthGrid(month), [month]);
  const agenda = useAgenda(days);
  const stats = useDayStats(days[0]!, days[days.length - 1]!);
  const today = todayKey();
  const m = fromKey(month).getMonth();
  return (
    <section aria-label="Month" className="flex min-h-0 grow flex-col gap-[6px]">
      <div className="grid grid-cols-7 gap-[6px] px-1">
        {WEEKDAY_HEADS.map((h) => (
          <span key={h} className="text-[11px] font-medium uppercase tracking-[0.06em] text-faint">
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
  const [start, setStart] = useState(() => weekStart(todayKey()));
  const [month, setMonth] = useState(() => addMonths(todayKey(), 0));
  const [editing, setEditing] = useState<
    { kind: "todo"; todo?: Todo; date: string } | { kind: "routine"; routine?: Routine } | { kind: "event"; event: CalEvent; date: string } | null
  >(null);
  const ensure = usePlanner((s) => s.ensure);
  const ensureEvents = useCalendar((s) => s.ensure);
  const { routines, todos, pending } = usePlanner();

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
  const thisWeek = weekStart(todayKey());
  const thisMonth = addMonths(todayKey(), 0);
  const dated = view === "week" || view === "list";
  const newItem = () => {
    if (view === "routines") return setEditing({ kind: "routine" });
    if (view === "month") return setEditing({ kind: "todo", date: month === thisMonth ? todayKey() : month });
    setEditing({ kind: "todo", date: start <= todayKey() && todayKey() <= addDays(start, 6) ? todayKey() : start });
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
          <Button variant="primary" aria-label={view === "routines" ? "New routine" : "New item"} className="w-[92px]" onClick={newItem}>
            {view === "routines" ? <RepeatGlyph className="h-3 w-3" /> : <PlusIcon size={12} />} New
          </Button>
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
