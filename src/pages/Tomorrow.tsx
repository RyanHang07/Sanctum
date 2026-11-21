import { create } from "zustand";
import { PlusIcon } from "../components/icons";
import { QuickAddField } from "../components/QuickAdd";
import { useAgenda } from "../state/calendar";
import { useStore } from "../state/store";
import { shortTime, type AgendaItem } from "../lib/planner";
import { EventMark } from "./week/marks";
import { Check } from "../components/controls";
import { usePlanner } from "../state/planner";
import { canMove, dragProps } from "./week/drag";
import { RepeatGlyph } from "./week/editors";
import { selectProps, useSelectedKey } from "./itemSelect";

// Tomorrow on Today (2026-11-20): with the setting on (Setup › Behavior › Tomorrow on Today),
// Today's list has a Today | Tomorrow switch. Tomorrow lists the next day in time order, checks
// off like today, and takes items dropped on its tab. The tab carries a second-color dot when
// tomorrow has anything open, or (Setup › Behavior › Mark tomorrow) only what starts before a
// chosen time, and those rows carry the same mark. Off by default.

/**
 * Which day Today's list shows, and a counter that replays the reset refresh. A store rather
 * than local state so the dev panel can drive both (2026-11-20); the app only ever moves `tab`
 * from the tabs and never bumps `resets`.
 */
/** `blank`: dev tools only, shows tomorrow as empty (previewing the dot arriving at a reset). */
export const useDayTab = create<{ tab: "today" | "tomorrow"; resets: number; blank?: boolean }>()(() => ({ tab: "today", resets: 0 }));

/** Before noon: the morning, worth knowing about the night before. */
export const isMorning = (time: string | null) => time !== null && time < "12:00";

/** What the Tomorrow tab marks: every open item, or only those timed before `before`. */
export const marked = (i: Pick<AgendaItem, "done" | "time">, before: string | null) =>
  !i.done && (before === null || (i.time !== null && i.time < before));

/** "9:00a", "noon": the cutoff, said in a label. */
export const cutoffLabel = (before: string) => (before === "12:00" ? "noon" : shortTime(before));

/** Open before done; timed items first by time, then the rest in their order. */
function ordered(items: AgendaItem[]): AgendaItem[] {
  return [...items].sort(
    (a, b) => Number(a.done) - Number(b.done) || (a.time && b.time ? a.time.localeCompare(b.time) : a.time ? -1 : b.time ? 1 : a.order - b.order),
  );
}

function TomorrowRow({ item, before }: { item: AgendaItem; before: string | null }) {
  // Rows carry the mark only when it means something: with a cutoff, the ones before it.
  const morning = before !== null && marked(item, before);
  const toggle = usePlanner((s) => s.toggle);
  const selected = useSelectedKey() === item.key;
  // Only the selected row drags (2026-11-20), so a stray press-and-move does nothing.
  const drag = selected ? dragProps(item) : {};
  return (
    <div
      {...selectProps(item, selected)}
      data-testid="tomorrow-row"
      data-morning={morning || undefined}
      {...drag}
      onDragStart={(e) => {
        if (!drag.onDragStart) return void e.preventDefault();
        drag.onDragStart(e);
      }}
      // Routines repeat on their own days, so they don't move; say so on hover (2026-11-20).
      // Same row shape and selected mark as Today's rows, so both tabs read alike.
      title={item.kind === "routine" ? "A routine stays on its days" : undefined}
      className={`@container flex h-row shrink-0 items-center gap-[10px] border-l-2 px-[14px] text-body transition-colors duration-ui ease-ui hover:bg-raised ${selected ? "border-l-text-2 bg-raised" : "border-l-transparent"} ${selected && canMove(item) ? "cursor-grab active:cursor-grabbing" : ""}`}
    >
      {item.kind === "event" ? (
        <EventMark size={16} />
      ) : (
        // Tomorrow's items check off here too (2026-11-20), the same as today's.
        <Check checked={item.done} done={item.done} label={item.title} onToggle={() => void toggle(item)} />
      )}
      <span className={`min-w-0 grow truncate ${item.done ? "text-muted line-through" : "text-text"}`} title={item.title}>
        {item.title}
      </span>
      {/* A routine repeats on its days, so it can't be dragged to another; the mark says which these are. */}
      {item.kind === "routine" ? (
        <span className="flex shrink-0 items-center text-muted">
          <RepeatGlyph className="h-[10px] w-[10px]" />
          <span className="sr-only">Routine</span>
        </span>
      ) : null}
      {item.time ? (
        <span className={`hidden shrink-0 items-center gap-[6px] font-mono @[220px]:flex text-meta ${morning ? "text-second-text" : "text-muted"}`}>
          {morning ? <span aria-hidden="true" className="h-[6px] w-[6px] rounded-full bg-second" /> : null}
          {morning ? <span className="sr-only">Before {cutoffLabel(before!)}, </span> : null}
          {shortTime(item.time)}
        </span>
      ) : null}
    </div>
  );
}

/** Tomorrow's day: its items in time order (morning ones marked) and a field to add one. */
export function TomorrowList({ date, className = "" }: { date: string; className?: string }) {
  const agenda = useAgenda([date]);
  const items = ordered(agenda[date] ?? []);
  const before = useStore((s) => s.settings.tomorrowMarkBefore);
  return (
    <div data-tomorrow-list className={`flex flex-col ${className}`}>
      {items.length === 0 ? <p className="m-0 px-[16px] py-2 text-meta text-muted">Nothing planned yet.</p> : null}
      {items.map((i) => (
        <TomorrowRow key={i.key} item={i} before={before} />
      ))}
      <QuickAddField
        date={date}
        label="Add a task for tomorrow"
        placeholder="Add a task for tomorrow"
        prefix={<PlusIcon className="shrink-0 text-faint" />}
        className="flex h-[34px] shrink-0 cursor-text items-center gap-[10px] px-[16px] transition-colors duration-ui ease-ui hover:bg-raised"
      />
    </div>
  );
}

/** Tomorrow's items, for the tabs' count. */
export function useTomorrowItems(date: string): AgendaItem[] {
  const agenda = useAgenda([date]);
  const blank = useDayTab((d) => !!d.blank);
  return blank ? [] : ordered(agenda[date] ?? []);
}
