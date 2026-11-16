import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../components/Button";
import { ChevronRightIcon, LockIcon } from "../../components/icons";
import { NoteEditor, type NoteChange } from "../../components/editor/NoteEditor";
import { flushJournal, holdJournalSave, useJournal } from "../../state/journal";
import { useStore } from "../../state/store";
import { useNotes } from "../../state/notes";
import { usePlanner } from "../../state/planner";
import { useTrackers } from "../../state/trackers";
import { useAgenda } from "../../state/calendar";
import { errorText, native } from "../../lib/native";
import { addDays, dayBounds, fromKey, todayKey } from "../../lib/planner";
import { minutes } from "../../lib/time";
import { promptDoc, promptsFor, writtenText } from "../../lib/journalPrompts";
import type { DayStat, DayStatus, JournalDay } from "../../lib/types";
import type { DocNode } from "../../lib/noteDoc";
import { HEADLINE } from "../headlines";
import { DayDot, dayMarkLabel } from "../week/marks";
import { JournalSetup } from "./JournalSetup";

// The journal (v0.2): one page per day. A strip of days to move between (v0.4: each day's kept or
// missed mark, as in Week, and a neutral dot where you wrote),
// the day's card (focus, sessions, tasks, counters, mood), then the page: the notes editor,
// starting from the day's prompts. Local only; locked when you leave, hide Sanctum, or idle.

const SAVE_MS = 700;
const IDLE_MS = 5 * 60_000;
const STRIP = 14;

const long = (key: string) => fromKey(key).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

/** Relocks the journal when you leave it, hide Sanctum, or idle on it. */
function useRelock() {
  const relock = useJournal((s) => s.relock);
  useEffect(() => {
    let idle = setTimeout(relock, IDLE_MS);
    const poke = () => {
      clearTimeout(idle);
      idle = setTimeout(relock, IDLE_MS);
    };
    const hidden = () => document.visibilityState === "hidden" && relock();
    const events = ["keydown", "pointerdown", "pointermove", "wheel"] as const;
    events.forEach((e) => window.addEventListener(e, poke, { passive: true }));
    document.addEventListener("visibilitychange", hidden);
    return () => {
      clearTimeout(idle);
      events.forEach((e) => window.removeEventListener(e, poke));
      document.removeEventListener("visibilitychange", hidden);
      // Leaving the Journal locks it.
      relock();
    };
  }, [relock]);
}

function Locked() {
  const { lock, unlockPin, unlockHello } = useJournal();
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const hello = lock?.lock === "hello";
  return (
    <div className="m-auto flex w-[320px] flex-col items-center gap-4 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-panel border border-sealed-line bg-sealed-tint text-sealed">
        <LockIcon size={18} />
      </span>
      <h2 className="headline m-0 text-[22px]">{HEADLINE.journalLocked}</h2>
      {hello ? (
        <Button variant="primary" onClick={() => void unlockHello().then(setError)}>
          Unlock with Windows Hello
        </Button>
      ) : (
        <form
          className="flex w-full gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void unlockPin(pin).then((err) => {
              setError(err);
              if (err) setPin("");
            });
          }}
        >
          <input
            aria-label="Journal PIN"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            autoFocus
            placeholder="PIN"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
            className="h-control min-w-0 grow rounded-control border border-line-input bg-raised px-3 text-center font-mono text-body tracking-[0.3em] text-text"
          />
          <Button variant="primary" disabled={pin.length < 4}>
            Unlock
          </Button>
        </form>
      )}
      {error ? <p className="m-0 text-meta text-broken-text">{error}</p> : null}
    </div>
  );
}

function DayStrip({ date, onPick }: { date: string; onPick: (d: string) => void }) {
  const dailyResetTime = useStore((s) => s.settings.dailyResetTime);
  const today = todayKey(new Date(), dailyResetTime);
  // Two weeks ending on the later of today and the picked day.
  const end = date > today ? date : today;
  const days = useMemo(() => Array.from({ length: STRIP }, (_, i) => addDays(end, i - STRIP + 1)), [end]);
  const [written, setWritten] = useState<string[]>([]);
  const [stats, setStats] = useState<DayStat[]>([]);
  useEffect(() => {
    const [from, to] = [days[0]!, days[days.length - 1]!];
    void native.journalWritten(from, to).then(setWritten).catch(() => setWritten([]));
    void native
      .statsOverview(from, to)
      .then((o) => setStats(o.days))
      .catch(() => setStats([]));
  }, [days, date]);
  return (
    // The key (Kept, Missed, Today) shows beside the strip only while it's hovered or a day has
    // keyboard focus, revealed with a clip so nothing shifts (Journal.dc.html). Reduced motion:
    // the global rule in styles.css makes the reveal instant.
    <div className="group/strip flex w-fit max-w-full shrink-0 items-center gap-3">
      <div role="tablist" aria-label="Days" className="flex min-w-0 gap-1 overflow-x-auto">
        {days.map((d) => {
          const on = d === date;
          const dt = fromKey(d);
          const stat = stats.find((s) => s.date === d);
          const wrote = written.includes(d);
          const said = [dayMarkLabel(stat)?.toLowerCase(), wrote ? "page written" : null].filter(Boolean).join(", ");
          return (
            <button
              key={d}
              type="button"
              role="tab"
              aria-selected={on}
              aria-label={said ? `${long(d)}: ${said}` : long(d)}
              title={said ? said[0]!.toUpperCase() + said.slice(1) : undefined}
              data-day={d}
              onClick={() => onPick(d)}
              className={`flex w-10 shrink-0 flex-col items-center gap-[2px] rounded-control py-[6px] transition-colors duration-ui ease-ui ${on ? "bg-sealed-tint" : "hover:bg-line-soft"}`}
            >
              <span className={`text-[10px] ${on || d === today ? "text-text" : "text-muted"}`}>{dt.toLocaleDateString("en-US", { weekday: "narrow" })}</span>
              <span className={`font-mono text-[13px] ${on ? "text-sealed-text" : "text-text-2"}`}>{dt.getDate()}</span>
              {/* The day's state (the same marks as Week), then a neutral dot for a written page. */}
              <span aria-hidden="true" className="flex h-[7px] items-center gap-[3px]">
                <DayDot day={stat} />
                {wrote ? <span data-testid="written-dot" className="h-1 w-1 rounded-full bg-muted" /> : null}
              </span>
            </button>
          );
        })}
      </div>
      <span
        aria-hidden="true"
        className="pointer-events-none flex h-8 shrink-0 items-center gap-[10px] whitespace-nowrap rounded-control border border-line bg-panel px-[10px] text-[11px] text-muted opacity-0 transition-[clip-path,opacity] duration-enter ease-ui [clip-path:inset(0_100%_0_0)] group-hover/strip:opacity-100 group-hover/strip:delay-150 group-hover/strip:[clip-path:inset(0)] group-has-[:focus-visible]/strip:opacity-100 group-has-[:focus-visible]/strip:[clip-path:inset(0)]"
      >
        {LEGEND.map(([status, word]) => (
          <span key={status} className="flex items-center gap-[5px]">
            <DayDot day={{ ...KEY_DAY, status }} />
            {word}
          </span>
        ))}
      </span>
    </div>
  );
}

const KEY_DAY: DayStat = { date: "", status: "kept", focusMin: 0, sessions: 0, attempts: 0, brokenAt: null, productiveMin: 0, distractingMin: 0 };
const LEGEND: readonly [DayStatus, string][] = [
  ["kept", "Kept"],
  ["missed", "Missed"],
  ["today", "Today"],
];

/** "1 session", "3 sessions", with a note when a seal broke that day. */
export function sessionsLabel(n: number, broke: boolean): string {
  return `${n === 1 ? "session" : "sessions"}${broke ? " · a seal broke" : ""}`;
}

const MOODS = [
  { value: 2, label: "Rough" },
  { value: 4, label: "Low" },
  { value: 6, label: "Okay" },
  { value: 8, label: "Good" },
  { value: 10, label: "Great" },
];

/** What the day held: focus, sessions, tasks, counters, and a one-tap mood (saved to Mood). */
function DayCard({ date }: { date: string }) {
  const [stat, setStat] = useState<DayStat | null>(null);
  const days = useMemo(() => [date], [date]);
  const items = useAgenda(days)[date] ?? [];
  const routines = usePlanner((s) => s.routines);
  const { trackers, entries, log, saveTracker } = useTrackers();
  const dailyResetTime = useStore((s) => s.settings.dailyResetTime);
  const [from, to] = useMemo(() => dayBounds(date, dailyResetTime), [date, dailyResetTime]);
  useEffect(() => {
    void usePlanner.getState().ensure(date, date);
    void native
      .statsOverview(date, date)
      .then((o) => setStat(o.days.find((d) => d.date === date) ?? null))
      .catch(() => setStat(null));
  }, [date]);

  const tasks = items.filter((i) => i.kind !== "event");
  const counters = routines.filter((r) => r.trackerId !== null && tasks.some((t) => t.kind === "routine" && t.id === r.id));
  const sumFor = (trackerId: number) => entries.filter((e) => e.trackerId === trackerId && e.loggedAt >= from && e.loggedAt < to).reduce((s, e) => s + (e.value ?? 0), 0);
  const mood = trackers.find((t) => t.name.toLowerCase() === "mood" && t.kind === "scale");
  const moodToday = mood ? [...entries].reverse().find((e) => e.trackerId === mood.id && e.loggedAt >= from && e.loggedAt < to)?.value ?? null : null;
  const isToday = date === todayKey(new Date(), dailyResetTime);

  const setMood = async (value: number) => {
    const t = mood ?? (await saveTracker({ name: "Mood", kind: "scale" }));
    if (t) await log([{ trackerId: t.id, value }]);
  };

  const fact = (value: string, label: string) => (
    <span className="flex flex-col">
      <span className="font-mono text-[15px] text-text">{value}</span>
      <span className="text-[11px] text-muted">{label}</span>
    </span>
  );

  return (
    <section aria-label="The day" className="flex shrink-0 flex-wrap items-center gap-x-6 gap-y-3 rounded-panel border border-line bg-panel px-5 py-3">
      {fact(minutes(stat?.focusMin ?? 0), "in focus")}
      {fact(String(stat?.sessions ?? 0), sessionsLabel(stat?.sessions ?? 0, !!stat?.brokenAt))}
      {fact(`${tasks.filter((t) => t.done).length}/${tasks.length}`, "done")}
      {counters.map((r) => {
        const unit = trackers.find((t) => t.id === r.trackerId)?.unit;
        const total = sumFor(r.trackerId!);
        return <span key={r.id}>{fact(`${Math.round(total * 10) / 10}/${r.goalAmount}${unit ? ` ${unit}` : ""}`, r.title)}</span>;
      })}
      <span className="ml-auto flex items-center gap-2">
        <span className="text-[11px] text-muted">Mood</span>
        <span role="radiogroup" aria-label="Mood" className="flex gap-1">
          {MOODS.map((m) => {
            const on = moodToday !== null && Math.round(moodToday / 2) * 2 === m.value;
            return (
              <button
                key={m.value}
                type="button"
                role="radio"
                aria-checked={on}
                aria-label={m.label}
                title={m.label}
                disabled={!isToday && moodToday === null}
                onClick={() => void setMood(m.value)}
                className={`h-6 w-6 rounded-full border text-[10px] transition-colors duration-ui ease-ui disabled:opacity-40 ${on ? "border-sealed bg-sealed text-sealed-on" : "border-line-input text-muted hover:border-sealed"}`}
              >
                {m.value / 2}
              </button>
            );
          })}
        </span>
      </span>
    </section>
  );
}

/** The day's page: its saved document, or a new one from the day's prompts. */
function Page({ date }: { date: string }) {
  const setup = useJournal((s) => s.setup);
  const { fontSize, setFontSize } = useNotes();
  const [day, setDay] = useState<JournalDay | null | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const prompts = useMemo(() => promptsFor(setup, date), [setup, date]);
  useEffect(() => {
    let live = true;
    setDay(undefined);
    void native
      .journalGet(date)
      .then((d) => live && setDay(d))
      .catch(() => live && setDay(null));
    return () => {
      live = false;
    };
  }, [date]);

  const doc = useMemo<DocNode | null>(() => {
    if (day === undefined) return null;
    if (day?.doc) {
      try {
        return JSON.parse(day.doc) as DocNode;
      } catch {
        // falls through to a fresh page
      }
    }
    return promptDoc(prompts) as DocNode;
  }, [day, prompts]);

  const save = (c: NoteChange) => {
    clearTimeout(timer.current);
    // Held until typing pauses; the lock, leaving the page, or quitting saves it sooner.
    holdJournalSave(() => {
      clearTimeout(timer.current);
      // Only the prompts, nothing written: no page (and an existing one goes).
      const wrote = writtenText(c.text, prompts);
      return native.journalSave(date, wrote ? c.doc : null, wrote ? c.text : "").then(
        () => undefined,
        (e) => {
          // Locked meanwhile: show the lock; anything else, say so.
          if (/locked/.test(errorText(e))) useJournal.getState().relock();
          else useStore.getState().showNotice({ lead: errorText(e) });
        },
      );
    });
    timer.current = setTimeout(() => void flushJournal(), SAVE_MS);
  };
  // Moving to another day, or leaving, saves what's waiting.
  useEffect(() => () => void flushJournal(), [date]);

  if (!doc) return <p className="m-0 text-body text-muted">Opening…</p>;
  return (
    <div className="min-h-0 grow overflow-y-auto pr-1">
      {/* An unwritten page follows the prompt picks (e.g. right after setup); a written one is its own. */}
      <NoteEditor key={day ? date : `${date}:${prompts.map((p) => p.id).join()}`} doc={doc} label={`Journal, ${long(date)}`} placeholder="Write about the day…" size={fontSize} onSize={setFontSize} onChange={save} />
    </div>
  );
}

export function JournalPage() {
  const { loaded, setup, lock, load } = useJournal();
  const dailyResetTime = useStore((s) => s.settings.dailyResetTime);
  const [date, setDate] = useState(() => todayKey(new Date(), dailyResetTime));
  const [setupOpen, setSetupOpen] = useState(false);
  useRelock();
  useEffect(() => {
    void load();
    if (!useTrackers.getState().loaded) void useTrackers.getState().load();
  }, [load]);

  const locked = !!lock && !lock.unlocked;
  const today = todayKey(new Date(), dailyResetTime);

  return (
    <div className="flex h-full flex-col gap-4 px-7 pb-6 pt-5">
      <div className="flex h-control shrink-0 items-center gap-3">
        <h1 className="page-title m-0">Journal</h1>
        <span className="text-body text-muted">{long(date)}</span>
        <span className="grow" />
        {date !== today ? (
          <Button variant="ghost" onClick={() => setDate(today)}>
            Today
          </Button>
        ) : null}
        {setup.done ? (
          <Button variant="quiet" aria-label="Journal settings" onClick={() => setSetupOpen(true)} disabled={locked}>
            Journal settings <ChevronRightIcon size={10} />
          </Button>
        ) : null}
      </div>
      {!loaded ? null : !setup.done ? (
        // First visit: the setup is the page (left part way, it starts over next time).
        <JournalSetup first onClose={() => undefined} />
      ) : locked ? (
        <Locked />
      ) : (
        <>
          <DayStrip date={date} onPick={setDate} />
          <DayCard date={date} />
          <section className="flex min-h-0 min-w-0 grow flex-col rounded-panel border border-line bg-panel py-5 pl-4 pr-8">
            <Page date={date} />
          </section>
        </>
      )}
      {setupOpen && setup.done ? <JournalSetup first={false} onClose={() => setSetupOpen(false)} /> : null}
    </div>
  );
}
