import { useEffect, useMemo, useRef, useState } from "react";
import { useRolling } from "../lib/motion";
import { CheckIcon, ChevronIcon, XIcon } from "../components/icons";
import { usePlanner } from "../state/planner";
import { useTrackers } from "../state/trackers";
import { dayBounds, todayKey, type AgendaItem } from "../lib/planner";
import { clock } from "../lib/time";
import type { Routine } from "../lib/types";

// A counter routine on Home (v0.1.4): "Protein 75 / 150 g". Amounts add up through the day and
// land in the linked tracker; the routine counts as done once the day's total reaches the goal.

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

const inputClass =
  "h-[26px] min-w-0 rounded-control border border-line-input bg-raised px-2 text-meta text-text outline-none transition-colors duration-ui ease-ui placeholder:text-faint focus:border-sealed";

export function CounterRow({ item, routine }: { item: AgendaItem; routine: Routine }) {
  const loaded = useTrackers((s) => s.loaded);
  const tracker = useTrackers((s) => s.trackers.find((t) => t.id === routine.trackerId));
  const all = useTrackers((s) => s.entries);
  const [from, to] = dayBounds(item.date);
  const entries = useMemo(() => all.filter((e) => e.trackerId === routine.trackerId && e.loggedAt >= from && e.loggedAt < to), [all, routine.trackerId, from, to]);
  const total = entries.reduce((sum, e) => sum + (e.value ?? 0), 0);
  const goal = routine.goalAmount ?? 0;
  const met = goal > 0 && total >= goal;
  const rolled = useRolling(total);
  // A shimmer across the bar, once, when the goal is reached (not on load).
  const [shine, setShine] = useState(false);
  const wasMet = useRef<boolean | null>(null);
  useEffect(() => {
    if (wasMet.current === false && met) {
      setShine(true);
      const t = setTimeout(() => setShine(false), 900);
      wasMet.current = met;
      return () => clearTimeout(t);
    }
    wasMet.current = met;
  }, [met]);
  const unit = tracker?.unit ? ` ${tracker.unit}` : "";
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The routine's check follows the total (only today's, once entries have loaded).
  useEffect(() => {
    if (loaded && item.date === todayKey() && met !== item.done) void usePlanner.getState().toggle(item);
  }, [loaded, met, item]);

  const needsNote = routine.noteMode === "required";
  const add = async () => {
    const v = Number(amount);
    if (!amount.trim() || !Number.isFinite(v) || v === 0) return setError("Enter an amount.");
    if (needsNote && !note.trim()) return setError("Add a note.");
    const ok = await useTrackers.getState().log([{ trackerId: routine.trackerId!, value: v, text: routine.noteMode === "off" ? null : note.trim() || null }]);
    if (ok) {
      setAmount("");
      setNote("");
      setError(null);
    }
  };

  return (
    <div data-testid="counter" data-done={met || undefined} className="flex flex-col gap-[6px] border-b border-line-soft px-[14px] py-[10px]">
      <div className="flex items-center gap-[10px]">
        <span
          aria-hidden="true"
          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] text-sealed-on ${met ? "border border-sealed bg-sealed" : "border-[1.5px] border-check-line"}`}
        >
          {met ? <CheckIcon /> : null}
        </span>
        <span className={`min-w-0 grow truncate text-body ${met ? "text-text-2" : "text-text"}`}>{item.title}</span>
        <button
          type="button"
          aria-expanded={open}
          aria-label={`${item.title}: ${fmt(total)} of ${fmt(goal)}${unit}. ${open ? "Hide" : "Show"} today's entries`}
          onClick={() => setOpen(!open)}
          className="flex shrink-0 items-center gap-[6px] rounded-control px-1 font-mono text-[11px] text-muted transition-colors duration-ui ease-ui hover:text-text-2"
        >
          <span className={met ? "text-sealed-text" : "text-text-2"}>{fmt(Math.round(rolled * 10) / 10)}</span> / {fmt(goal)}
          {unit}
          <ChevronIcon size={9} className={`transition-transform duration-ui ease-ui ${open ? "" : "-rotate-90"}`} />
        </button>
      </div>
      <div className={`ml-[26px] h-1 overflow-hidden rounded-full bg-line ${shine ? "goal-shine" : ""}`}>
        <div className="h-full bg-sealed transition-[width] duration-enter ease-ui" style={{ width: `${goal > 0 ? Math.min(100, (total / goal) * 100) : 0}%` }} />
      </div>
      <form
        className="ml-[26px] mt-[3px] flex items-center gap-[6px]"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <input
          aria-label={`Add to ${item.title}`}
          inputMode="decimal"
          placeholder={`+ ${tracker?.unit || "amount"}`}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className={`${inputClass} w-[72px] font-mono`}
        />
        {routine.noteMode !== "off" ? (
          <input
            aria-label={`Note for ${item.title}`}
            placeholder={needsNote ? "note (required)" : "note (optional)"}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className={`${inputClass} grow`}
          />
        ) : (
          <span className="grow" />
        )}
        <button type="submit" className="h-[26px] shrink-0 rounded-control bg-sealed px-3 text-meta font-medium text-sealed-on transition-[filter] duration-ui ease-ui hover:brightness-110">
          Add
        </button>
      </form>
      {error ? <p className="m-0 ml-[26px] text-meta text-broken-text">{error}</p> : null}
      {open ? (
        <ul aria-label={`${item.title} today`} className="m-0 ml-[26px] flex list-none flex-col gap-[2px] p-0">
          {entries.length === 0 ? <li className="text-meta text-faint">Nothing logged today.</li> : null}
          {entries.map((e) => (
            <li key={e.id} className="group flex items-center gap-2 text-meta">
              <span className="w-[54px] shrink-0 font-mono text-faint">{clock(e.loggedAt)}</span>
              <span className="shrink-0 font-mono text-text-2">
                {(e.value ?? 0) > 0 ? "+" : ""}
                {fmt(e.value ?? 0)}
                {unit}
              </span>
              <span className="min-w-0 grow truncate text-muted">{e.text ?? ""}</span>
              <button
                type="button"
                aria-label={`Remove ${fmt(e.value ?? 0)}${unit}`}
                onClick={() => void useTrackers.getState().deleteEntry(e.id)}
                className="shrink-0 text-faint opacity-0 transition-opacity duration-ui ease-ui hover:text-text-2 focus-visible:opacity-100 group-hover:opacity-100"
              >
                <XIcon size={10} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
