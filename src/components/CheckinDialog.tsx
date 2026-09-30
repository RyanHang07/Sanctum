import { useEffect, useMemo, useState } from "react";
import { Button, Kbd } from "./Button";
import { XIcon } from "./icons";
import { useTrackers } from "../state/trackers";
import { usePlanner } from "../state/planner";
import { addDays, agendaFor, longTime, todayKey, type AgendaItem } from "../lib/planner";
import { entriesOf, formatChange, formatValue, num, shortDate, sparkline, stepFor } from "../lib/trackers";
import type { NewEntry, Tracker, TrackerEntry } from "../lib/types";

// Scheduled check-in and Log entry (design/screens/Checkin.dc.html, SPEC 4.13). A centered
// dialog over the current screen; Rust keeps the window on top until it's answered.

type Draft = { value: number | null; text: string };

const WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** "since Thursday" within the week, else "since Sep 14". */
function since(ms: number, now = Date.now()) {
  return now - ms < 6 * 86_400_000 ? `since ${WEEKDAY[new Date(ms).getDay()]}` : `since ${shortDate(ms)}`;
}

function Stepper({ t, value, step, onChange }: { t: Tracker; value: number | null; step: number; onChange: (v: number | null) => void }) {
  const [text, setText] = useState(value === null ? "" : num(value));
  useEffect(() => setText(value === null ? "" : num(value)), [value]);
  const nudge = (d: number) => onChange(Math.round(((value ?? 0) + d) * 10) / 10);
  const side = "flex h-8 w-8 items-center justify-center bg-raised text-text-2 transition-colors duration-ui ease-ui hover:bg-line hover:text-text";
  return (
    <div className="flex shrink-0 items-center overflow-hidden rounded-control border border-line-input">
      <button type="button" aria-label={`Decrease ${t.name}`} onClick={() => nudge(-step)} className={side}>
        −
      </button>
      <label className="flex w-[84px] items-baseline justify-center gap-1">
        <input
          aria-label={t.name}
          inputMode="decimal"
          value={text}
          placeholder="—"
          onChange={(e) => {
            setText(e.target.value);
            const v = e.target.value.trim() === "" ? null : Number(e.target.value);
            if (v === null || Number.isFinite(v)) onChange(v);
          }}
          className="w-[52px] bg-transparent text-right font-mono text-[15px] font-medium text-text outline-none placeholder:text-faint"
        />
        {t.unit ? <span className="font-mono text-[11px] text-muted">{t.unit}</span> : null}
      </label>
      <button type="button" aria-label={`Increase ${t.name}`} onClick={() => nudge(step)} className={side}>
        +
      </button>
    </div>
  );
}

function Choice({ label, on, onClick, wide = false }: { label: string; on: boolean; onClick: () => void; wide?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`h-7 rounded-control border font-mono text-meta transition-colors duration-ui ease-ui ${wide ? "px-3" : "w-7"} ${
        on ? "border-sealed bg-sealed text-sealed-on" : "border-line-input text-text-2 hover:border-check-line hover:text-text"
      }`}
    >
      {label}
    </button>
  );
}

function TrackerRow({ t, history, draft, onChange }: { t: Tracker; history: TrackerEntry[]; draft: Draft; onChange: (d: Draft) => void }) {
  const last = history[history.length - 1] ?? null;
  const vals = history.slice(-7).map((e) => e.value ?? 0);
  const spark = t.kind === "number" || t.kind === "scale" ? sparkline(draft.value !== null ? [...vals, draft.value] : vals) : "";
  const note =
    !last ? "First entry" : t.kind === "number" && draft.value !== null ? `${formatChange(t, draft.value - (last.value ?? 0))} ${since(last.loggedAt)}` : `Last: ${formatValue(t, last)}`;
  const stacked = t.kind === "scale" || t.kind === "text";
  return (
    <div className={`flex gap-[14px] border-t border-line px-[18px] py-3 ${stacked ? "flex-col" : "items-center"}`}>
      <div className="flex min-w-0 grow items-center gap-[14px]">
        <div className="flex min-w-0 grow flex-col gap-[2px]">
          <span className="text-body font-medium">{t.name}</span>
          <span className="truncate text-meta text-muted">{note}</span>
        </div>
        {spark ? (
          <svg width="72" height="24" viewBox="0 0 72 24" aria-hidden="true" className="shrink-0">
            <polyline points={spark} fill="none" className="stroke-sealed" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
          </svg>
        ) : null}
      </div>
      {t.kind === "number" ? <Stepper t={t} value={draft.value} step={stepFor(last?.value ?? null)} onChange={(value) => onChange({ ...draft, value })} /> : null}
      {t.kind === "bool" ? (
        <div role="group" aria-label={t.name} className="flex shrink-0 gap-1">
          <Choice wide label="Yes" on={draft.value === 1} onClick={() => onChange({ ...draft, value: draft.value === 1 ? null : 1 })} />
          <Choice wide label="No" on={draft.value === 0} onClick={() => onChange({ ...draft, value: draft.value === 0 ? null : 0 })} />
        </div>
      ) : null}
      {t.kind === "scale" ? (
        <div role="group" aria-label={t.name} className="flex justify-between">
          {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
            <Choice key={n} label={String(n)} on={draft.value === n} onClick={() => onChange({ ...draft, value: draft.value === n ? null : n })} />
          ))}
        </div>
      ) : null}
      {t.kind === "text" ? (
        <textarea
          aria-label={t.name}
          value={draft.text}
          rows={3}
          maxLength={2000}
          placeholder="Write a few lines"
          onChange={(e) => onChange({ ...draft, text: e.target.value })}
          className="resize-none rounded-control border border-line-input bg-raised px-3 py-2 text-body leading-normal text-text outline-none transition-colors duration-ui ease-ui placeholder:text-faint hover:border-check-line focus:border-sealed"
        />
      ) : null}
    </div>
  );
}

/** Today's open items and tomorrow's top 3 (the check-in's goal review). */
function GoalReview({ top, setTop }: { top: string[]; setTop: (t: string[]) => void }) {
  const { routines, todos, checks, toggle, saveTodo, ensure } = usePlanner();
  const today = todayKey();
  const tomorrow = addDays(today, 1);
  useEffect(() => void ensure(today, tomorrow), [ensure, today, tomorrow]);
  const items = useMemo(() => agendaFor([today], routines, todos, checks)[today] ?? [], [routines, todos, checks, today]);
  const open = items.filter((i) => !i.done);
  const [moved, setMoved] = useState<string[]>([]);
  const move = async (i: AgendaItem) => {
    const t = todos.find((x) => x.id === i.id);
    if (!t) return;
    if (await saveTodo({ ...t, dueDate: tomorrow })) setMoved([...moved, i.title]);
  };
  return (
    <section aria-label="Goal review" className="flex flex-col gap-3 border-t border-line px-[18px] py-3">
      <div className="flex flex-col gap-[6px]">
        <span className="text-meta text-muted">{open.length ? "Still open today" : moved.length ? "Everything open moved to tomorrow" : "Nothing left open today"}</span>
        {open.map((i) => (
          <div key={i.key} className="flex h-7 items-center gap-2">
            <button
              type="button"
              role="checkbox"
              aria-checked={false}
              aria-label={`Done: ${i.title}`}
              onClick={() => void toggle(i)}
              className="flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-[4px] border-[1.5px] border-check-line hover:border-sealed"
            />
            <span className="min-w-0 grow truncate text-body">{i.title}</span>
            {i.kind === "todo" ? (
              <Button variant="quiet" size="sm" onClick={() => void move(i)}>
                Tomorrow
              </Button>
            ) : null}
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-[6px]">
        <span className="text-meta text-muted">Tomorrow’s top 3</span>
        {top.map((v, n) => (
          <input
            key={n}
            aria-label={`Tomorrow ${n + 1}`}
            value={v}
            placeholder={`${n + 1}.`}
            onChange={(e) => setTop(top.map((x, k) => (k === n ? e.target.value : x)))}
            className="h-8 rounded-control border border-line-input bg-raised px-3 text-body text-text outline-none transition-colors duration-ui ease-ui placeholder:text-faint hover:border-check-line focus:border-sealed"
          />
        ))}
      </div>
    </section>
  );
}

export function CheckinDialog() {
  const prompt = useTrackers((s) => s.prompt);
  const allTrackers = useTrackers((s) => s.trackers);
  const entries = useTrackers((s) => s.entries);
  const { log, answer } = useTrackers.getState();
  const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  const [top, setTop] = useState(["", "", ""]);
  const [busy, setBusy] = useState(false);

  const scheduled = prompt?.kind === "scheduled" ? prompt : null;
  const trackers = useMemo(
    () => (scheduled ? scheduled.checkin.trackerIds.map((id) => allTrackers.find((t) => t.id === id)).filter((t): t is Tracker => !!t) : allTrackers),
    [scheduled, allTrackers],
  );

  // A scheduled check-in starts numbers at their last value (nudge from there); Log entry starts empty.
  useEffect(() => {
    if (!prompt) return;
    const next: Record<number, Draft> = {};
    for (const t of trackers) {
      const last = entriesOf(entries, t.id).at(-1);
      next[t.id] = { value: scheduled && t.kind === "number" ? last?.value ?? null : null, text: "" };
    }
    setDrafts(next);
    setTop(["", "", ""]);
    // Only when a new prompt opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prompt]);

  const items: NewEntry[] = trackers.flatMap((t): NewEntry[] => {
    const d = drafts[t.id];
    if (!d) return [];
    if (t.kind === "text") return d.text.trim() ? [{ trackerId: t.id, text: d.text }] : [];
    return d.value !== null ? [{ trackerId: t.id, value: d.value }] : [];
  });
  const review = !!scheduled?.checkin.includeGoalReview;
  const tops = top.map((x) => x.trim()).filter(Boolean);
  const canLog = items.length > 0 || (review && (tops.length > 0 || trackers.length === 0));

  const close = () => void answer(scheduled ? "snoozed" : "skipped");
  const submit = async () => {
    if (!canLog || busy) return;
    setBusy(true);
    try {
      if (items.length && !(await log(items, scheduled?.checkin.id ?? null))) return;
      if (review) {
        const tomorrow = addDays(todayKey(), 1);
        for (const title of tops) await usePlanner.getState().saveTodo({ title, dueDate: tomorrow, dueTime: null, durationMin: null, profileId: null });
      }
      await answer("logged");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!prompt) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (e.key === "Enter" && !(e.target instanceof HTMLTextAreaElement) && !(e.target instanceof HTMLButtonElement)) void submit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!prompt) return null;
  const title = scheduled ? scheduled.checkin.name : "Log entry";
  const meta = scheduled
    ? `${scheduled.due.missed ? "Missed check-in" : "Scheduled check-in"} · ${longTime(scheduled.checkin.time)}`
    : "Fill in what you have; blanks are left out";

  return (
    <div className="fixed inset-0 z-40 animate-fade-in bg-scrim">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="absolute left-1/2 top-[120px] flex max-h-[calc(100%-160px)] w-[440px] -translate-x-1/2 animate-rise-in flex-col overflow-hidden rounded-dialog border border-line-input bg-panel shadow-dialog"
      >
        <div className="flex items-start justify-between pb-3 pl-[18px] pr-4 pt-4">
          <div className="flex flex-col gap-1">
            <span className="text-meta text-muted">{meta}</span>
            <h1 className="m-0 text-[18px] font-semibold tracking-[-0.02em]">{title}</h1>
          </div>
          <button
            type="button"
            aria-label={scheduled ? "Close and ask again in 15 minutes" : "Close"}
            onClick={close}
            className="flex h-7 w-7 items-center justify-center rounded-control text-muted transition-colors duration-ui ease-ui hover:bg-raised hover:text-text"
          >
            <XIcon size={14} />
          </button>
        </div>
        <div className="min-h-0 overflow-y-auto">
          {trackers.map((t) =>
            drafts[t.id] ? (
              <TrackerRow key={t.id} t={t} history={entriesOf(entries, t.id)} draft={drafts[t.id]!} onChange={(d) => setDrafts({ ...drafts, [t.id]: d })} />
            ) : null,
          )}
          {!trackers.length && !review ? <p className="m-0 border-t border-line px-[18px] py-4 text-body text-muted">No trackers yet. Make one in Setup › Trackers.</p> : null}
          {review ? <GoalReview top={top} setTop={setTop} /> : null}
        </div>
        <div className="flex items-center gap-2 border-t border-line bg-panel-footer px-[18px] py-3">
          {scheduled ? (
            <>
              <Button variant="quiet" onClick={() => void answer("skipped")}>
                Skip today
              </Button>
              <Button variant="ghost" onClick={() => void answer("snoozed")}>
                Snooze 15m
              </Button>
            </>
          ) : (
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
          )}
          <Button variant="primary" className="ml-auto gap-[10px] px-[14px]" disabled={!canLog || busy} onClick={() => void submit()}>
            {items.length || !review ? "Log" : "Done"}
            <Kbd onFill>↵</Kbd>
          </Button>
        </div>
      </div>
    </div>
  );
}
