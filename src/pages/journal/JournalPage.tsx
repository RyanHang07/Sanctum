import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { Button } from "../../components/Button";
import { useSlidingIndicator } from "../../components/controls";
import { ChevronRightIcon, LockIcon } from "../../components/icons";
import { NoteEditor, plainText, type NoteChange } from "../../components/editor/NoteEditor";
import { flushJournal, heldPage, holdJournalSave, holdLockedPage, useJournal } from "../../state/journal";
import { useStore } from "../../state/store";
import { useNotes } from "../../state/notes";
import { usePlanner } from "../../state/planner";
import { useTrackers } from "../../state/trackers";
import { useAgenda } from "../../state/calendar";
import { errorText, native } from "../../lib/native";
import { addDays, dayBounds, fromKey, todayKey } from "../../lib/planner";
import { minutes } from "../../lib/time";
import { dayPrompt, promptDoc, PROMPTS, writtenText } from "../../lib/journalPrompts";
import { gsap, RISE_FROM, RISE_TO, useGSAP } from "../../lib/gsap";
import { useMotion } from "../../lib/useMotion";
import type { DayStat, DayStatus, JournalDay } from "../../lib/types";
import type { DocNode } from "../../lib/noteDoc";
import { HEADLINE } from "../headlines";
import { DayDot, dayMarkLabel } from "../week/marks";
import { JournalSetup, PROTECTION } from "./JournalSetup";
import { OlderPages, OnThisDay } from "./LookBack";

// The journal (v0.2): one page per day. A strip of days to move between (v0.4: each day's kept or
// missed mark, as in Week, and a neutral dot where you wrote),
// the day's card (focus, sessions, tasks, counters, mood), then the page: the notes editor.
// v0.5: a new page opens blank, with one prompt offered above it to use or pass on; a look back a
// month and a year under the card; "Older pages" for a month calendar and search. Moving to
// another day rises the day in, the way screens rise in. Local only; locked when you leave, hide
// Sanctum, or idle.

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
      <h2 className="headline m-0 text-moment-dialog">{HEADLINE.journalLocked}</h2>
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
      <p data-testid="journal-protection" className="m-0 text-meta text-muted">
        {PROTECTION}
      </p>
    </div>
  );
}

function DayStrip({ date, onPick }: { date: string; onPick: (d: string) => void }) {
  const dailyResetTime = useStore((s) => s.settings.dailyResetTime);
  const today = todayKey(new Date(), dailyResetTime);
  // Two weeks ending on the later of today and the picked day; a day further back (from the
  // calendar or a look back) gets the two weeks around it.
  const oldest = addDays(today, 1 - STRIP);
  const end = date > today ? date : date < oldest && addDays(date, 7) < today ? addDays(date, 7) : today;
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
  // The selected day's highlight slides between days, like the sidebar's and the segmented controls'.
  const root = useRef<HTMLDivElement>(null);
  const indicator = useRef<HTMLSpanElement>(null);
  useSlidingIndicator(root, indicator, days.includes(date) ? date : null, days.join());
  return (
    // The key (Kept, Missed, Today) shows beside the strip only while it's hovered or a day has
    // keyboard focus, revealed with a clip so nothing shifts (Journal.dc.html). Reduced motion:
    // the global rule in styles.css makes the reveal instant.
    <div className="group/strip flex w-fit max-w-full shrink-0 items-center gap-3">
      <div ref={root} role="tablist" aria-label="Days" className="relative flex min-w-0 gap-1 overflow-x-auto">
        <span ref={indicator} aria-hidden="true" data-indicator="" className="pointer-events-none absolute left-0 top-0 rounded-control bg-sealed-tint opacity-0" />
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
              data-indicator-item={d}
              onClick={() => onPick(d)}
              className={`relative flex w-10 shrink-0 flex-col items-center gap-[2px] rounded-control py-[6px] transition-colors duration-ui ease-ui ${on ? "" : "hover:bg-raised"}`}
            >
              <span className={`text-micro ${on || d === today ? "text-text" : "text-muted"}`}>{dt.toLocaleDateString("en-US", { weekday: "narrow" })}</span>
              <span className={`font-mono text-body ${on ? "text-sealed-text" : "text-text-2"}`}>{dt.getDate()}</span>
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
        className="pointer-events-none flex h-8 shrink-0 items-center gap-[10px] whitespace-nowrap rounded-control border border-line bg-panel px-[10px] text-micro text-muted opacity-0 transition-[clip-path,opacity] duration-enter ease-ui [clip-path:inset(0_100%_0_0)] group-hover/strip:opacity-100 group-hover/strip:delay-150 group-hover/strip:[clip-path:inset(0)] group-has-[:focus-visible]/strip:opacity-100 group-has-[:focus-visible]/strip:[clip-path:inset(0)]"
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
      <span className="text-micro text-muted">{label}</span>
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
        <span className="text-micro text-muted">Mood</span>
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
                className={`h-6 w-6 rounded-full border text-micro transition-colors duration-ui ease-ui disabled:opacity-40 ${on ? "border-sealed bg-sealed text-sealed-on" : "border-line-input text-muted hover:border-sealed"}`}
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

/**
 * The day's page: its saved document, or a blank one. Above it, one quiet line offers a prompt
 * from the journal's picks ("Try: …"); "Use it" puts the prompt on the page as a small heading to
 * write under, "Another" offers the next. Prompts alone are never writing, so a page with only a
 * prompt on it isn't saved.
 */
function Page({ date, onPrompts }: { date: string; onPrompts: () => void }) {
  const setup = useJournal((s) => s.setup);
  const { fontSize, setFontSize } = useNotes();
  const [day, setDay] = useState<JournalDay | null | undefined>(undefined);
  // The page didn't load: say so with a retry. Never a blank editor, whose first keystroke would
  // save over the real page.
  const [failed, setFailed] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [text, setText] = useState("");
  const [turn, setTurn] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    let live = true;
    setDay(undefined);
    setFailed(null);
    void native
      .journalGet(date)
      .then((d) => {
        if (!live) return;
        // Typing the lock refused (and that still hasn't saved) opens in place of the saved page.
        const kept = heldPage(date);
        const page = kept ? { date, doc: kept.doc, body: kept.body, updatedAt: d?.updatedAt ?? 0 } : d;
        setDay(page);
        setText(page?.body ?? "");
      })
      .catch((e) => {
        if (!live) return;
        if (/locked/.test(errorText(e))) useJournal.getState().lockedOut();
        setFailed(errorText(e));
      });
    return () => {
      live = false;
    };
  }, [date, attempt]);

  const doc = useMemo<DocNode | null>(() => {
    if (day === undefined) return null;
    if (day?.doc) {
      try {
        return JSON.parse(day.doc) as DocNode;
      } catch {
        // falls through to a fresh page
      }
    }
    return promptDoc([]) as DocNode;
  }, [day]);

  const offer = dayPrompt(setup, date, turn);
  const another = !!offer && dayPrompt(setup, date, turn + 1)?.id !== offer.id;
  const onPage = !!offer && text.split("\n").some((l) => l.trim() === offer.text);

  const save = (c: NoteChange) => {
    setText(c.text);
    clearTimeout(timer.current);
    // Held until typing pauses; the lock, leaving the page, or quitting saves it sooner.
    holdJournalSave(() => {
      clearTimeout(timer.current);
      // Only prompts, nothing written: no page (and an existing one goes).
      const wrote = writtenText(c.text, PROMPTS);
      const page = { date, doc: wrote ? c.doc : null, body: wrote ? c.text : "" };
      return native.journalSave(page.date, page.doc, page.body).then(
        () => undefined,
        (e) => {
          // Locked meanwhile: keep the typing to save after unlocking, and show the lock.
          if (/locked/.test(errorText(e))) {
            holdLockedPage(page);
            useJournal.getState().lockedOut();
          } else useStore.getState().showNotice({ lead: errorText(e) });
        },
      );
    });
    timer.current = setTimeout(() => void flushJournal(), SAVE_MS);
  };
  // Moving to another day, or leaving, saves what's waiting.
  useEffect(() => () => void flushJournal(), [date]);

  const use = () => {
    const editor = (box.current?.querySelector(".note-doc") as unknown as { editor?: Editor } | null)?.editor;
    if (!offer || !editor) return;
    // A blank page becomes the prompt and a line under it; a written one gets it at the end.
    if (editor.isEmpty) editor.chain().setContent(promptDoc([offer])).focus("end").run();
    else editor.chain().focus("end").insertContent(promptDoc([offer]).content).focus("end").run();
    setText(plainText(editor));
  };

  if (failed !== null)
    return (
      <div role="alert" className="flex flex-col items-start gap-3">
        <p className="m-0 text-body text-text-2">This page didn't open.</p>
        <p className="m-0 text-meta text-broken-text">{failed}</p>
        <Button variant="ghost" onClick={() => setAttempt((n) => n + 1)}>
          Try again
        </Button>
      </div>
    );
  if (!doc) return <p className="m-0 text-body text-muted">Opening…</p>;
  return (
    <>
      {offer && !onPage ? (
        <p data-testid="journal-offer" className="m-0 mb-3 flex shrink-0 items-baseline gap-3 pl-8 text-meta text-muted">
          <span className="min-w-0">Try: {offer.text}</span>
          <button type="button" onClick={use} className="shrink-0 text-text-2 transition-colors duration-ui ease-ui hover:text-text">
            Use it
          </button>
          {another ? (
            <button type="button" aria-label="Another prompt" onClick={() => setTurn((n) => n + 1)} className="shrink-0 transition-colors duration-ui ease-ui hover:text-text-2">
              Another
            </button>
          ) : null}
          {/* First run no longer asks for prompts (2026-11-17), so changing them is one click from here. */}
          <button type="button" onClick={onPrompts} className="ml-auto shrink-0 transition-colors duration-ui ease-ui hover:text-text-2">
            Change prompts
          </button>
        </p>
      ) : null}
      <div ref={box} className="min-h-0 grow overflow-y-auto pr-1">
        <NoteEditor key={date} doc={doc} label={`Journal, ${long(date)}`} placeholder="Write about the day…" size={fontSize} onSize={setFontSize} onChange={save} />
      </div>
    </>
  );
}

export function JournalPage() {
  const { loaded, setup, lock, load } = useJournal();
  const dailyResetTime = useStore((s) => s.settings.dailyResetTime);
  const [date, setDate] = useState(() => todayKey(new Date(), dailyResetTime));
  const [setupOpen, setSetupOpen] = useState<false | "top" | "prompts">(false);
  const [olderOpen, setOlderOpen] = useState(false);
  const olderButton = useRef<HTMLSpanElement>(null);
  useRelock();
  useEffect(() => {
    void load();
    if (!useTrackers.getState().loaded) void useTrackers.getState().load();
  }, [load]);

  // An unknown lock (the status didn't load) counts as locked: no page shows until it's known.
  const locked = !lock || !lock.unlocked;
  const today = todayKey(new Date(), dailyResetTime);
  const closeOlder = useCallback(() => setOlderOpen(false), []);
  const open = useCallback((d: string) => {
    setOlderOpen(false);
    setDate(d);
  }, []);

  // Moving to another day: the card and the page rise in together, the screens' rise-in. The
  // first day just appears (the screen itself rose in).
  const dayRef = useRef<HTMLDivElement>(null);
  const { run } = useMotion(dayRef);
  const firstDay = useRef(true);
  useGSAP(
    () => {
      if (firstDay.current) {
        firstDay.current = false;
        return;
      }
      if (!dayRef.current) return;
      run(() => gsap.timeline({ id: "journal-day" }).fromTo(dayRef.current!, RISE_FROM, RISE_TO));
    },
    { dependencies: [date] },
  );

  const ready = loaded && setup.done && !locked;

  return (
    <div className="flex h-full flex-col gap-4 px-7 pb-6 pt-5">
      <div className="relative flex h-control shrink-0 items-center gap-3">
        <h1 className="page-title m-0">Journal</h1>
        <span className="text-body text-muted">{long(date)}</span>
        <span className="grow" />
        {date !== today ? (
          <Button variant="ghost" onClick={() => setDate(today)}>
            Today
          </Button>
        ) : null}
        {ready ? (
          <span ref={olderButton} className="contents">
            <Button variant="quiet" aria-expanded={olderOpen} aria-haspopup="dialog" onClick={() => setOlderOpen((o) => !o)}>
              Older pages
            </Button>
          </span>
        ) : null}
        {setup.done ? (
          <Button variant="quiet" aria-label="Journal settings" onClick={() => setSetupOpen("top")} disabled={locked}>
            Journal settings <ChevronRightIcon size={10} />
          </Button>
        ) : null}
        {ready && olderOpen ? <OlderPages date={date} today={today} onOpen={open} onClose={closeOlder} toggle={olderButton} /> : null}
      </div>
      {!loaded ? null : !setup.done ? (
        // First visit: the setup is the page (left part way, it starts over next time).
        <JournalSetup first onClose={() => undefined} />
      ) : !lock ? (
        <div role="alert" className="m-auto flex flex-col items-center gap-3 text-center">
          <p className="m-0 text-body text-text-2">The journal didn't open.</p>
          <Button variant="ghost" onClick={() => void load()}>
            Try again
          </Button>
        </div>
      ) : locked ? (
        <Locked />
      ) : (
        <>
          <DayStrip date={date} onPick={setDate} />
          <div ref={dayRef} data-journal-day className="flex min-h-0 min-w-0 grow flex-col gap-4">
            <DayCard date={date} />
            <OnThisDay date={date} onOpen={open} />
            <section className="flex min-h-0 min-w-0 grow flex-col rounded-panel border border-line bg-panel py-5 pl-4 pr-8">
              <Page key={date} date={date} onPrompts={() => setSetupOpen("prompts")} />
            </section>
          </div>
        </>
      )}
      {setupOpen && setup.done ? <JournalSetup first={false} at={setupOpen === "prompts" ? "prompts" : undefined} onClose={() => setSetupOpen(false)} /> : null}
    </div>
  );
}
