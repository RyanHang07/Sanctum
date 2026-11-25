import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../components/Button";
import { CheckMark } from "../components/controls";
import { Odometer } from "../components/Odometer";
import { ChevronIcon, XIcon } from "../components/icons";
import { usePlanner } from "../state/planner";
import { useTrackers } from "../state/trackers";
import { useStore } from "../state/store";
import { dayBounds, todayKey, type AgendaItem } from "../lib/planner";
import { clock } from "../lib/time";
import type { Routine } from "../lib/types";

// A counter routine on Home (v0.1.4): "Protein 75 / 150 g". Amounts add up through the day and
// land in the linked tracker; the routine counts as done once the day's total reaches the goal.

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

const inputClass =
  "h-control-sm min-w-0 rounded-control border border-line-input bg-raised px-2 text-meta text-text transition-colors duration-ui ease-ui placeholder:text-muted focus:border-sealed";

/** A counter routine's day: its entries, their total, the goal, and whether the total meets it.
 *  Shared by the Today row and the held page, so a session for a counter adds to the same total. */
export function useCounterDay(routine: Routine, date: string) {
  const loaded = useTrackers((s) => s.loaded);
  const tracker = useTrackers((s) => s.trackers.find((t) => t.id === routine.trackerId));
  const all = useTrackers((s) => s.entries);
  const dailyResetTime = useStore((s) => s.settings.dailyResetTime);
  const [from, to] = useMemo(() => dayBounds(date, dailyResetTime), [date, dailyResetTime]);
  const entries = useMemo(() => all.filter((e) => e.trackerId === routine.trackerId && e.loggedAt >= from && e.loggedAt < to), [all, routine.trackerId, from, to]);
  const total = entries.reduce((sum, e) => sum + (e.value ?? 0), 0);
  const goal = routine.goalAmount ?? 0;
  return { loaded, tracker, entries, total, goal, met: goal > 0 && total >= goal, unit: tracker?.unit ? ` ${tracker.unit}` : "", dailyResetTime };
}

export const counterAmount = fmt;

/** Logs one amount to a counter routine's tracker: null once saved, what to fix when the input
 *  won't do, or false when the save failed (the store already says why; keep what was typed). */
export async function addToCounter(routine: Routine, amount: string, note: string): Promise<string | null | false> {
  const v = Number(amount);
  if (!amount.trim() || !Number.isFinite(v) || v === 0) return "Enter an amount.";
  if (routine.noteMode === "required" && !note.trim()) return "Add a note.";
  const ok = await useTrackers.getState().log([{ trackerId: routine.trackerId!, value: v, text: routine.noteMode === "off" ? null : note.trim() || null }]);
  return ok ? null : false;
}

export function CounterRow({ item, routine }: { item: AgendaItem; routine: Routine }) {
  const { loaded, tracker, entries, total, goal, met, unit, dailyResetTime } = useCounterDay(routine, item.date);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The routine's check follows the total (only today's, once entries have loaded). Each change
  // is tried once: a toggle that fails rolls the check back, and must not try again in a loop.
  const synced = useRef<string | null>(null);
  useEffect(() => {
    if (!loaded || item.date !== todayKey(new Date(), dailyResetTime) || met === item.done) return;
    const want = `${item.id}:${item.date}:${met}`;
    if (synced.current === want) return;
    synced.current = want;
    void usePlanner.getState().toggle(item);
  }, [loaded, met, item, dailyResetTime]);

  const needsNote = routine.noteMode === "required";
  const add = async () => {
    const err = await addToCounter(routine, amount, note);
    if (err === false) return;
    setError(err);
    if (err) return;
    setAmount("");
    setNote("");
  };

  return (
    <div data-testid="counter" data-done={met || undefined} className="flex flex-col gap-[6px] border-b border-line-soft px-[14px] py-[10px]">
      <div className="flex items-center gap-[10px]">
        <CheckMark done={met} />
        <span className={`min-w-0 grow truncate text-body ${met ? "text-text-2" : "text-text"}`}>{item.title}</span>
        <button
          type="button"
          aria-expanded={open}
          aria-label={`${item.title}: ${fmt(total)} of ${fmt(goal)}${unit}. ${open ? "Hide" : "Show"} today's entries`}
          onClick={() => setOpen(!open)}
          className="flex shrink-0 items-center gap-[6px] rounded-control px-1 font-mono text-micro text-muted transition-colors duration-ui ease-ui hover:text-text-2"
        >
          <Odometer text={fmt(Math.round(total * 10) / 10)} className={met ? "text-second-text" : "text-text-2"} /> / {fmt(goal)}
          {unit}
          <ChevronIcon size={9} className={`transition-transform duration-ui ease-ui ${open ? "" : "-rotate-90"}`} />
        </button>
      </div>
      {/* The fill tracks the total (a transform, never a width); at the goal its end mark is the second color. */}
      <div className="relative ml-[26px] h-1 rounded-full bg-line">
        <div
          data-counter-fill
          className="absolute inset-0 origin-left rounded-full bg-sealed transition-transform duration-glide ease-glide"
          style={{ transform: `scaleX(${goal > 0 ? Math.min(1, total / goal) : 0})` }}
        />
        {met ? <span data-counter-goal className="absolute right-0 top-[-3px] h-[10px] w-[2px] rounded-[1px] bg-second" /> : null}
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
          title={`+ ${tracker?.unit || "amount"}`}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          // Sized to its text (the unit you set), between 64 and 140px; past that it truncates
          // with an ellipsis (2026-11-24). It was a fixed 72px, which cut "+ amount" short.
          className={`${inputClass} field-sizing-content min-w-[64px] max-w-[140px] shrink-0 text-ellipsis font-mono`}
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
        <Button type="submit" variant="primary" size="sm" className="px-3">
          Add
        </Button>
      </form>
      {error ? <p className="m-0 ml-[26px] text-meta text-broken-text">{error}</p> : null}
      {open ? (
        <ul aria-label={`${item.title} today`} className="m-0 ml-[26px] flex list-none flex-col gap-[2px] p-0">
          {entries.length === 0 ? <li className="text-meta text-muted">Nothing logged today.</li> : null}
          {entries.map((e) => (
            <li key={e.id} className="group flex items-center gap-2 text-meta">
              <span className="w-[54px] shrink-0 font-mono text-muted">{clock(e.loggedAt)}</span>
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
                className="shrink-0 text-faint opacity-0 transition-[opacity,color] duration-ui ease-ui hover:text-danger-text focus-visible:opacity-100 focus-visible:text-danger-text group-hover:opacity-100"
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
