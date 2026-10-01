// Pending (v0.1): things for this week or next with no day yet, plus anything still open from
// before. Shown on Home (a tab under Today), in Week (a strip, or the eighth box in two rows), and
// in List. Not in Month or Routines. Drag an item onto a day to give it one; drop one here to park it.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { CheckIcon, ChevronIcon, PlusIcon } from "../../components/icons";
import { usePlanner } from "../../state/planner";
import { fromKey, pendingFor, todayKey, weekStart, type AgendaItem } from "../../lib/planner";
import type { Todo } from "../../lib/types";
import { drag, dragProps, parkOn, todoItem } from "./drag";

/** The week's pending items, kept current. */
export function usePending(week: string): Todo[] {
  const todos = usePlanner((s) => s.todos);
  const pending = usePlanner((s) => s.pending);
  const loadPending = usePlanner((s) => s.loadPending);
  useEffect(() => void loadPending(), [loadPending]);
  // Loaded items win over the Pending snapshot (they're the fresher copy).
  return useMemo(() => pendingFor(week, todayKey(), pending, todos), [week, todos, pending]);
}

const short = (key: string) => fromKey(key).toLocaleDateString("en-US", { month: "short", day: "numeric" });

/** Where an item came from: its old day if it's overdue, its old week if it was carried over. */
function origin(t: Todo, week: string): string {
  if (!t.undated) return short(t.dueDate);
  return t.dueDate < week ? `Since ${short(t.dueDate)}` : "";
}

/** Dropping an item here parks it on `week`. */
function useParkTarget(week: string) {
  const [over, setOver] = useState(false);
  const fits = () => {
    const i = drag.item;
    return !!i && i.kind === "todo" && !(i.undated && i.date === week);
  };
  return {
    over,
    props: {
      onDragOver: (e: React.DragEvent) => {
        if (!fits()) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
        setOver(true);
      },
      onDragLeave: (e: React.DragEvent) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
      },
      onDrop: (e: React.DragEvent) => {
        e.preventDefault();
        setOver(false);
        const item = drag.item;
        drag.item = null;
        if (item) void parkOn(item, week);
      },
    },
  };
}

function PendingRow({ t, week, onOpen }: { t: Todo; week: string; onOpen?: (i: AgendaItem) => void }) {
  const toggle = usePlanner((s) => s.toggle);
  const item = todoItem(t);
  const from = origin(t, week);
  return (
    <div {...dragProps(item)} data-testid="pending-row" className="group flex h-8 shrink-0 cursor-grab items-center gap-[10px] rounded-control px-2 transition-colors duration-ui ease-ui hover:bg-line-soft active:cursor-grabbing">
      <button
        type="button"
        role="checkbox"
        aria-checked={false}
        aria-label={t.title}
        onClick={() => void toggle(item)}
        className="check-pop box-border flex h-[14px] w-[14px] shrink-0 items-center justify-center rounded-[4px] border-[1.5px] border-check-line bg-transparent p-0 text-sealed-on transition-colors duration-ui ease-ui hover:border-muted"
      >
        {t.done ? <CheckIcon /> : null}
      </button>
      {onOpen ? (
        <button type="button" onClick={() => onOpen(item)} className="min-w-0 grow truncate text-left text-body text-text">
          {t.title}
        </button>
      ) : (
        <span className="min-w-0 grow truncate text-body text-text">{t.title}</span>
      )}
      {from ? <span className="shrink-0 font-mono text-[11px] text-faint">{from}</span> : null}
    </div>
  );
}

/** "Add to pending": a plain line, Enter saves (no day, no time). */
function AddPending({ week, className = "" }: { week: string; className?: string }) {
  const [title, setTitle] = useState("");
  const save = async () => {
    const t = title.trim();
    if (!t) return;
    const ok = await usePlanner.getState().saveTodo({ title: t, dueDate: week, dueTime: null, durationMin: null, profileId: null, undated: true });
    if (ok) setTitle("");
  };
  return (
    <label className={`flex h-8 shrink-0 cursor-text items-center gap-[10px] rounded-control px-2 text-faint transition-colors duration-ui ease-ui hover:bg-line-soft ${className}`}>
      <PlusIcon size={11} className="shrink-0" />
      <input
        aria-label="Add to pending"
        placeholder="Add to pending"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void save();
          if (e.key === "Escape") setTitle("");
        }}
        className="min-w-0 grow bg-transparent text-body text-text outline-none placeholder:text-faint"
      />
    </label>
  );
}

/** The header of a collapsible Pending: light until you hover it or open it. */
function Toggle({ open, count, onClick, label }: { open: boolean; count: number; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-label={label}
      onClick={onClick}
      className={`group/pending flex h-9 w-full shrink-0 items-center gap-2 px-[14px] text-left text-meta transition-colors duration-ui ease-ui hover:text-text-2 ${open ? "text-text-2" : "text-faint"}`}
    >
      <ChevronIcon size={10} className={`transition-transform duration-ui ease-ui ${open ? "" : "-rotate-90"}`} />
      <span className="grow font-medium">Pending</span>
      <span className="font-mono text-[11px]">{count}</span>
    </button>
  );
}

/** Home: a tab at the foot of the Today column. Opens over the list's free space. */
export function PendingTab() {
  const week = weekStart(todayKey());
  const items = usePending(week);
  const [open, setOpen] = useState(false);
  const park = useParkTarget(week);
  return (
    <div {...park.props} data-testid="pending-tab" className={`flex min-h-0 shrink-0 flex-col border-t border-line ${park.over ? "bg-sealed-tint" : ""} ${open ? "max-h-[55%]" : ""}`}>
      <Toggle open={open} count={items.length} onClick={() => setOpen(!open)} label={open ? "Hide pending" : "Show pending"} />
      {open ? (
        <div className="flex min-h-0 flex-col overflow-y-auto px-[6px] pb-[6px]">
          {items.map((t) => (
            <PendingRow key={t.id} t={t} week={week} />
          ))}
          <AddPending week={week} />
        </div>
      ) : null}
    </div>
  );
}

/** Week at full width: a slim strip under the days. */
export function PendingStrip({ week, onOpen }: { week: string; onOpen: (i: AgendaItem) => void }) {
  const items = usePending(week);
  const [open, setOpen] = useState(false);
  const park = useParkTarget(week);
  return (
    <section
      {...park.props}
      aria-label="Pending"
      className={`shrink-0 rounded-panel border transition-colors duration-ui ease-ui ${park.over ? "border-sealed bg-sealed-tint" : "border-line bg-panel/40"}`}
    >
      <Toggle open={open} count={items.length} onClick={() => setOpen(!open)} label={open ? "Hide pending" : "Show pending"} />
      {open ? (
        <div className="grid max-h-[132px] grid-cols-3 gap-x-2 overflow-y-auto px-[6px] pb-[6px]">
          {items.map((t) => (
            <PendingRow key={t.id} t={t} week={week} onOpen={onOpen} />
          ))}
          <AddPending week={week} />
        </div>
      ) : null}
    </section>
  );
}

/** Week in two rows: the eighth box, beside Sunday. */
export function PendingBox({ week, onOpen }: { week: string; onOpen: (i: AgendaItem) => void }) {
  const items = usePending(week);
  const park = useParkTarget(week);
  return (
    <section
      {...park.props}
      aria-label="Pending"
      className={`flex min-h-0 min-w-0 flex-col gap-[2px] overflow-y-auto rounded-panel border p-[6px] [scrollbar-width:none] transition-colors duration-ui ease-ui ${
        park.over ? "border-sealed bg-sealed-tint" : "border-line bg-panel/40"
      }`}
    >
      <div className="flex items-baseline justify-between px-1 pb-1 pt-[2px]">
        <span className="text-meta font-semibold text-muted">Pending</span>
        <span className="font-mono text-[11px] text-muted">{items.length}</span>
      </div>
      {items.map((t) => (
        <PendingRow key={t.id} t={t} week={week} onOpen={onOpen} />
      ))}
      <AddPending week={week} />
    </section>
  );
}

/** List: a section after the days, like a day of its own. */
export function PendingSection({ week, onOpen, heading }: { week: string; onOpen: (i: AgendaItem) => void; heading: (count: number) => ReactNode }) {
  const items = usePending(week);
  const park = useParkTarget(week);
  return (
    <section {...park.props} aria-label="Pending" className={`mb-6 break-inside-avoid rounded-control ${park.over ? "bg-sealed-tint" : ""}`}>
      {heading(items.length)}
      {items.map((t) => (
        <PendingRow key={t.id} t={t} week={week} onOpen={onOpen} />
      ))}
      <AddPending week={week} />
    </section>
  );
}
