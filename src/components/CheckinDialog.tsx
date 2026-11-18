import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { MOMENT_DIALOG } from "./dialogFrame";
import { Button, Kbd } from "./Button";
import { Check, useDialogFocus } from "./controls";
import { XIcon } from "./icons";
import { play } from "../lib/sound";
import { useTrackers } from "../state/trackers";
import { usePlanner } from "../state/planner";
import { useStore } from "../state/store";
import { addDays, agendaFor, longTime, todayKey, type AgendaItem } from "../lib/planner";
import { entriesOf, formatChange, formatValue, num, shortDate, stepFor } from "../lib/trackers";
import { goalSpark } from "../pages/trackers/chart";
import type { NewEntry, Tracker, TrackerEntry } from "../lib/types";

// Scheduled check-in and Log entry (gate-canvas Checkin.dc.html, SPEC 4.13). A centered dialog
// over the current screen; Rust keeps the window on top until it's answered. The header and the
// footer stay put while the questions scroll inside, so it fits the 720px minimum window.

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
  const side = "flex h-control w-8 items-center justify-center bg-raised text-text-2 transition-colors duration-ui ease-ui hover:bg-line hover:text-text";
  return (
    <div className="flex shrink-0 items-center overflow-hidden rounded-control border border-line-input">
      <button type="button" aria-label={`Decrease ${t.name}`} onClick={() => nudge(-step)} className={side}>
        −
      </button>
      {/* The field opts out of its own ring; its box draws it, inset so the stepper's edge doesn't clip it. */}
      <label className="focus-ring-within flex h-control w-[84px] items-center justify-center gap-1 [outline-offset:-2px]!">
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
          className="focus-ring-off w-[52px] bg-transparent text-right font-mono text-[15px] font-medium text-text placeholder:text-muted"
        />
        {t.unit ? <span className="font-mono text-micro text-muted">{t.unit}</span> : null}
      </label>
      <button type="button" aria-label={`Increase ${t.name}`} onClick={() => nudge(step)} className={side}>
        +
      </button>
    </div>
  );
}

/**
 * One answer from a few (Yes or No, 1 to 10): a radio group with one tab stop, where the arrows
 * move the answer. Picking the chosen one again clears it, so a question can be left blank.
 */
function Choices({ label, options, value, onChange, wide = false }: { label: string; options: readonly { label: string; value: number }[]; value: number | null; onChange: (v: number | null) => void; wide?: boolean }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const at = Math.max(0, options.findIndex((o) => o.value === value));
  const onKey = (e: React.KeyboardEvent, i: number) => {
    const n = options.length;
    const next =
      e.key === "ArrowRight" || e.key === "ArrowDown" ? (i + 1) % n : e.key === "ArrowLeft" || e.key === "ArrowUp" ? (i - 1 + n) % n : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : -1;
    if (next < 0) return;
    e.preventDefault();
    onChange(options[next]!.value);
    refs.current[next]?.focus();
  };
  return (
    <div role="radiogroup" aria-label={label} className={`flex shrink-0 ${wide ? "gap-1" : "justify-between"}`}>
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => void (refs.current[i] = el)}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={i === at ? 0 : -1}
            onClick={() => onChange(on ? null : o.value)}
            onKeyDown={(e) => onKey(e, i)}
            className={`h-7 rounded-control border font-mono text-meta transition-colors duration-ui ease-ui ${wide ? "px-3" : "w-7"} ${
              on ? "border-sealed bg-sealed font-semibold text-sealed-on" : "border-line-input text-text-2 hover:border-check-line hover:text-text"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

const YES_NO = [
  { label: "Yes", value: 1 },
  { label: "No", value: 0 },
] as const;
const ONE_TO_TEN = Array.from({ length: 10 }, (_, i) => ({ label: String(i + 1), value: i + 1 }));

/** The last week as a 72 x 24 line, with the goal dashed in the second color. */
function Spark({ vals, goal }: { vals: number[]; goal: number | null }) {
  const s = goalSpark(vals, goal);
  if (!s) return null;
  return (
    <svg width="72" height="24" viewBox="0 0 72 24" aria-hidden="true" className="shrink-0 overflow-visible">
      {s.goalY !== null ? <line data-spark-goal x1={0} x2={72} y1={s.goalY} y2={s.goalY} className="stroke-second" strokeWidth={1} strokeDasharray="3 3" /> : null}
      <polyline points={s.points} fill="none" className="stroke-sealed" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={s.last.x} cy={s.last.y} r={2} className="fill-sealed" />
    </svg>
  );
}

function TrackerRow({ t, history, draft, onChange }: { t: Tracker; history: TrackerEntry[]; draft: Draft; onChange: (d: Draft) => void }) {
  const last = history[history.length - 1] ?? null;
  const vals = history.slice(-7).map((e) => e.value ?? 0);
  const charted = t.kind === "number" || t.kind === "scale";
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
        {charted ? <Spark vals={draft.value !== null ? [...vals, draft.value] : vals} goal={t.goal} /> : null}
      </div>
      {t.kind === "number" ? <Stepper t={t} value={draft.value} step={stepFor(last?.value ?? null)} onChange={(value) => onChange({ ...draft, value })} /> : null}
      {t.kind === "bool" ? <Choices wide label={t.name} options={YES_NO} value={draft.value} onChange={(value) => onChange({ ...draft, value })} /> : null}
      {t.kind === "scale" ? <Choices label={`${t.name}, 1 to 10`} options={ONE_TO_TEN} value={draft.value} onChange={(value) => onChange({ ...draft, value })} /> : null}
      {t.kind === "text" ? (
        <textarea
          aria-label={t.name}
          value={draft.text}
          rows={3}
          maxLength={2000}
          placeholder="Write a few lines"
          onChange={(e) => onChange({ ...draft, text: e.target.value })}
          className="resize-none rounded-control border border-line-input bg-raised px-3 py-2 text-body leading-normal text-text transition-colors duration-ui ease-ui placeholder:text-muted hover:border-check-line"
        />
      ) : null}
    </div>
  );
}

/** Today's open items and tomorrow's top 3 (the check-in's goal review). */
function GoalReview({ top, setTop }: { top: string[]; setTop: (t: string[]) => void }) {
  const { routines, todos, checks, toggle, saveTodo, ensure } = usePlanner();
  const dailyResetTime = useStore((s) => s.settings.dailyResetTime);
  const today = todayKey(new Date(), dailyResetTime);
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
        <span className="label">{open.length ? "Still open today" : moved.length ? "Everything open moved to tomorrow" : "Nothing left open today"}</span>
        {open.map((i) => (
          <div key={i.key} className="flex h-7 items-center gap-2">
            <Check
              checked={false}
              label={`Done: ${i.title}${i.kind === "routine" && (i.sessionsTarget ?? 1) > 1 ? ` (${(i.sessionsDone ?? 0) + 1} of ${i.sessionsTarget})` : ""}`}
              onToggle={() => void toggle(i)}
            />
            <span className="min-w-0 grow truncate text-body">{i.title}</span>
            {i.kind === "routine" && (i.sessionsTarget ?? 1) > 1 ? <span className="shrink-0 font-mono text-micro text-muted">{i.sessionsDone ?? 0}/{i.sessionsTarget}</span> : null}
            {i.kind === "todo" ? (
              <Button variant="quiet" size="sm" onClick={() => void move(i)}>
                Tomorrow
              </Button>
            ) : null}
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-[6px]">
        <span className="label">Tomorrow’s top 3</span>
        {top.map((v, n) => (
          <input
            key={n}
            aria-label={`Tomorrow ${n + 1}`}
            value={v}
            placeholder={`${n + 1}.`}
            onChange={(e) => setTop(top.map((x, k) => (k === n ? e.target.value : x)))}
            className="h-control rounded-control border border-line-input bg-raised px-3 text-body text-text transition-colors duration-ui ease-ui placeholder:text-muted hover:border-check-line"
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
  // Once the questions scroll, a hairline under the header marks where they go.
  const [scrolled, setScrolled] = useState(false);

  const scheduled = prompt?.kind === "scheduled" ? prompt : null;
  const trackers = useMemo(
    () => (scheduled ? scheduled.checkin.trackerIds.map((id) => allTrackers.find((t) => t.id === id)).filter((t): t is Tracker => !!t) : allTrackers),
    [scheduled, allTrackers],
  );

  // A scheduled check-in starts numbers at their last value (nudge from there); Log entry starts empty.
  useEffect(() => {
    if (!prompt) return;
    if (prompt.kind === "scheduled") play("checkin");
    const next: Record<number, Draft> = {};
    for (const t of trackers) {
      const last = entriesOf(entries, t.id).at(-1);
      next[t.id] = { value: scheduled && t.kind === "number" ? last?.value ?? null : null, text: "" };
    }
    setDrafts(next);
    setTop(["", "", ""]);
    setScrolled(false);
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
        const tomorrow = addDays(todayKey(new Date(), useStore.getState().settings.dailyResetTime), 1);
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
      // Escape and Tab are the dialog frame's (useDialogFocus).
      if (e.key === "Enter" && !(e.target instanceof HTMLTextAreaElement) && !(e.target instanceof HTMLButtonElement)) void submit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!prompt) return null;
  const title = scheduled ? scheduled.checkin.name : "Log entry";

  return (
    <CheckinFrame label={title} onClose={close}>
        <div data-checkin-head className={`flex shrink-0 items-start justify-between border-b pb-3 pl-[18px] pr-4 pt-4 ${scrolled ? "border-line" : "border-transparent"}`}>
          <div className="flex flex-col gap-1">
            <h1 className="headline m-0 text-moment-compact">{title}</h1>
            <span className="text-meta text-muted">
              {scheduled ? (
                <>
                  {scheduled.due.missed ? "Missed, scheduled for " : "Scheduled for "}
                  <span className="font-mono">{longTime(scheduled.checkin.time)}</span>
                </>
              ) : (
                "Fill in what you have; blanks are left out"
              )}
            </span>
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
        <div
          role="region"
          aria-label="Check-in questions"
          tabIndex={0}
          onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 1)}
          className="-mt-px min-h-0 flex-1 overflow-y-auto overscroll-contain"
        >
          {trackers.map((t) =>
            drafts[t.id] ? (
              <TrackerRow key={t.id} t={t} history={entriesOf(entries, t.id)} draft={drafts[t.id]!} onChange={(d) => setDrafts({ ...drafts, [t.id]: d })} />
            ) : null,
          )}
          {!trackers.length && !review ? <p className="m-0 border-t border-line px-[18px] py-4 text-body text-muted">No trackers yet. Make one in Setup › Trackers.</p> : null}
          {review ? <GoalReview top={top} setTop={setTop} /> : null}
        </div>
        <div className="flex shrink-0 items-center gap-2 border-t border-line bg-panel-footer px-[18px] py-3">
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
    </CheckinFrame>
  );
}

/** The scrim and dialog box: focus moves in, Tab stays inside, Escape closes, focus goes back. */
function CheckinFrame({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  useDialogFocus(box, onClose);
  return (
    <div className="fixed inset-0 z-40 animate-fade-in bg-scrim">
      <div ref={box} tabIndex={-1} role="dialog" aria-modal="true" aria-label={label} className={`${MOMENT_DIALOG} outline-none`}>
        {children}
      </div>
    </div>
  );
}
