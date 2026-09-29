import { useEffect, useMemo, useState } from "react";
import { Button } from "../../components/Button";
import { Switch } from "../../components/controls";
import { CheckIcon, ChevronRightIcon, PlusIcon } from "../../components/icons";
import { EventDialog, OneTimeCard, OneTimeDialog, RepeatGlyph, RoutineDialog } from "./editors";
import { usePlanner } from "../../state/planner";
import { useAgenda, useCalendar } from "../../state/calendar";
import { useStore, type WeekView } from "../../state/store";
import { addDays, daysLabel, fromKey, shortTime, todayKey, weekKeys, weekStart, type AgendaItem } from "../../lib/planner";
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
      className="flex w-full shrink-0 items-start gap-2 whitespace-normal rounded-control border border-line bg-panel px-2 py-[7px] text-left transition-colors duration-ui ease-ui hover:border-line-input"
    >
      <span aria-hidden="true" className={`w-[3px] shrink-0 self-stretch rounded-[2px] ${item.profileId !== null ? "bg-sealed" : "bg-event"}`} />
      <span className="flex min-w-0 grow flex-col gap-[2px]">
        <span className="line-clamp-3 break-words text-meta leading-snug text-text">{item.title}</span>
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
      className={`group flex items-start gap-2 rounded-control border border-l-2 border-line bg-panel px-2 py-[7px] transition-colors duration-ui ease-ui hover:border-line-input ${edge}`}
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={item.done}
        aria-label={item.title}
        onClick={() => void toggle(item)}
        className={`mt-px box-border flex h-[14px] w-[14px] shrink-0 items-center justify-center rounded-[4px] p-0 text-sealed-on transition-colors duration-ui ease-ui ${
          item.done ? "border border-sealed bg-sealed" : "border-[1.5px] border-check-line hover:border-muted"
        }`}
      >
        {item.done ? <CheckIcon size={8} /> : null}
      </button>
      <button type="button" onClick={onOpen} className="flex min-w-0 grow flex-col gap-[2px] whitespace-normal text-left">
        <span className={`line-clamp-3 break-words text-meta leading-snug ${item.done ? "text-faint line-through" : "text-text"}`}>{item.title}</span>
        <span className="flex items-center gap-1 font-mono text-[10px] text-muted">
          {routine ? <RepeatGlyph className="h-[10px] w-[10px]" /> : null}
          {item.time ? shortTime(item.time) : routine ? "anytime" : ""}
        </span>
      </button>
    </div>
  );
}

function DayColumn({ date, items, today, onOpen }: { date: string; items: AgendaItem[]; today: boolean; onOpen: (i: AgendaItem) => void }) {
  const [adding, setAdding] = useState(false);
  const d = fromKey(date);
  return (
    <section
      aria-label={d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
      className={`flex min-h-0 min-w-0 flex-[1_1_0%] flex-col gap-[6px] overflow-y-auto overflow-x-hidden rounded-panel border p-[6px] transition-[flex-grow,opacity,background-color] duration-enter ease-ui hover:flex-[2.6_1_0%] focus-within:flex-[2.6_1_0%] group-hover/week:opacity-60 hover:opacity-100! focus-within:opacity-100! ${
        today ? "border-sealed-line bg-sealed-tint/40" : "border-line bg-panel/40 hover:bg-panel"
      }`}
    >
      <div className="flex items-baseline justify-between px-1 pb-1 pt-[2px]">
        <span className={`text-meta font-semibold ${today ? "text-sealed-text" : "text-text"}`}>{d.toLocaleDateString("en-US", { weekday: "short" })}</span>
        <span className={`font-mono text-[11px] ${today ? "text-sealed-text" : "text-muted"}`}>{d.getDate()}</span>
      </div>
      {items.map((i) => (
        <ItemCard key={i.key} item={i} onOpen={() => onOpen(i)} />
      ))}
      {adding ? (
        <OneTimeCard date={date} onDone={() => setAdding(false)} />
      ) : (
        <button
          type="button"
          aria-label={`Add to ${d.toLocaleDateString("en-US", { weekday: "long" })}`}
          onClick={() => setAdding(true)}
          className="flex h-7 shrink-0 items-center gap-[6px] rounded-control px-[6px] text-left text-meta text-faint transition-colors duration-ui ease-ui hover:bg-line-soft hover:text-text-2"
        >
          <PlusIcon size={11} /> Add
        </button>
      )}
    </section>
  );
}

/** "Synced with Google Calendar" (Week.dc.html), or a way to connect or reconnect. */
function SyncStatus() {
  const status = useCalendar((s) => s.status);
  const navigate = useStore((s) => s.navigate);
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
    <button type="button" onClick={() => navigate("setup")} className="ml-auto flex items-center gap-[6px] text-muted transition-colors duration-ui ease-ui hover:text-text">
      <span className={`h-[6px] w-[6px] rounded-full ${status.needsReconnect ? "bg-broken" : "bg-open"}`} />
      {status.needsReconnect ? "Reconnect Google Calendar in Setup" : "Connect Google Calendar in Setup"}
    </button>
  );
}

function WeekView({ start, onOpen }: { start: string; onOpen: (i: AgendaItem) => void }) {
  const days = useMemo(() => weekKeys(start), [start]);
  const agenda = useAgenda(days);
  const today = todayKey();
  return (
    <>
      {/* The day under the pointer (or being edited) widens; the rest step back. */}
      <div className="group/week flex min-h-0 grow gap-2">
        {days.map((d) => (
          <DayColumn key={d} date={d} items={agenda[d] ?? []} today={d === today} onOpen={onOpen} />
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
  const saveTodo = usePlanner((s) => s.saveTodo);
  const [draft, setDraft] = useState("");
  const add = async () => {
    if (draft.trim() && (await saveTodo({ title: draft, dueDate: date, dueTime: null, durationMin: null, profileId: null }))) setDraft("");
  };
  return (
    <label className="flex h-[30px] items-center gap-[10px] px-1 text-faint">
      <span className="box-border h-4 w-4 shrink-0 rounded-[4px] border-[1.5px] border-dashed border-line-input" />
      <input
        aria-label={label}
        value={draft}
        placeholder="To-do"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && void add()}
        className="h-7 min-w-0 grow border-none bg-transparent text-body text-text outline-none placeholder:text-faint"
      />
    </label>
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

export function WeekPage() {
  const view = useStore((s) => s.settings.weekView);
  const setView = useStore((s) => s.setWeekView);
  const [start, setStart] = useState(() => weekStart(todayKey()));
  const [editing, setEditing] = useState<
    { kind: "todo"; todo?: Todo; date: string } | { kind: "routine"; routine?: Routine } | { kind: "event"; event: CalEvent; date: string } | null
  >(null);
  const ensure = usePlanner((s) => s.ensure);
  const ensureEvents = useCalendar((s) => s.ensure);
  const { routines, todos, pending } = usePlanner();

  useEffect(() => void ensure(start, addDays(start, 6)), [start, ensure]);
  useEffect(() => void ensureEvents(start, addDays(start, 6)), [start, ensureEvents]);

  const open = (i: AgendaItem) => {
    if (i.kind === "event" && i.event) setEditing({ kind: "event", event: i.event, date: i.date });
    else if (i.kind === "routine") setEditing({ kind: "routine", routine: routines.find((r) => r.id === i.id) });
    else setEditing({ kind: "todo", todo: todos.find((t) => t.id === i.id) ?? pending.find((t) => t.id === i.id), date: i.date });
  };
  const thisWeek = weekStart(todayKey());
  const dated = view === "week" || view === "list";
  const newItem = () =>
    view === "routines"
      ? setEditing({ kind: "routine" })
      : setEditing({ kind: "todo", date: start <= todayKey() && todayKey() <= addDays(start, 6) ? todayKey() : start });

  return (
    <div className="flex h-full flex-col gap-4 px-7 pb-6 pt-5">
      {/* Title and week navigation on the left; New and the view tabs stay put on the right. */}
      <div className="flex h-control items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <h1 className="page-title m-0 whitespace-nowrap">{view === "routines" ? "Routines" : view === "month" ? "Month" : rangeTitle(start)}</h1>
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
          {view !== "month" ? (
            <Button variant="primary" aria-label={view === "routines" ? "New routine" : "New item"} className="w-[92px]" onClick={newItem}>
              {view === "routines" ? <RepeatGlyph className="h-3 w-3" /> : <PlusIcon size={12} />} New
            </Button>
          ) : null}
          <ViewSwitch view={view} onChange={setView} />
        </div>
      </div>

      {view === "week" ? <WeekView start={start} onOpen={open} /> : null}
      {view === "list" ? <ListView start={start} onOpen={open} /> : null}
      {view === "routines" ? <RoutinesView onOpen={(r) => setEditing({ kind: "routine", routine: r })} /> : null}
      {view === "month" ? (
        <div className="flex grow items-center justify-center rounded-panel border border-line bg-panel">
          <p className="m-0 text-body text-muted">The month view arrives with streaks.</p>
        </div>
      ) : null}

      {editing?.kind === "todo" ? <OneTimeDialog initial={editing.todo} date={editing.date} onClose={() => setEditing(null)} /> : null}
      {editing?.kind === "routine" ? <RoutineDialog initial={editing.routine} onClose={() => setEditing(null)} /> : null}
      {editing?.kind === "event" ? <EventDialog initial={editing.event} date={editing.date} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}
