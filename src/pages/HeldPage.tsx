import { useEffect, useId, useRef, useState } from "react";
import { MARK_PATHS } from "../components/AnimatedMark";
import { Button } from "../components/Button";
import { useStore } from "../state/store";
import { play } from "../lib/sound";
import { DUR, EASE, gsap, useGSAP } from "../lib/gsap";
import { useMotion } from "../lib/useMotion";
import { minutes } from "../lib/time";
import type { HeldStats, SessionResult, TaskLink } from "../lib/types";
import { usePlanner } from "../state/planner";
import { native } from "../lib/native";
import { CheckIcon } from "../components/icons";
import { HEADLINE, brokeLine, heldLine } from "./headlines";
import { addDays, routineDoneOn, todayKey } from "../lib/planner";

// Full-page takeover when a session completes (SPEC 4.0.2, design/gate-canvas/project/Held.dc.html
// and HeldBroken.dc.html). Stays until dismissed. A clean page on the app colour (redesign
// 2026-11-16: no backdrop): the mark, one headline, one fact line, Done and Enter again. The
// session review ("Add a note") opens only when asked.

/** A seal's facts in one sentence: "1h of Interview Prep, 3 attempts blocked." */
export function heldFacts(h: Pick<HeldStats, "focusMinutes" | "profileName" | "attempts">): string {
  const what = `${minutes(h.focusMinutes)} of ${h.profileName}`;
  if (h.attempts === 0) return `${what}.`;
  return `${what}, ${h.attempts} ${h.attempts === 1 ? "attempt" : "attempts"} blocked.`;
}

/**
 * The held build (motion spec §5 and §6), one timeline that owns sound and motion on one clock.
 * The gate assembles, the keyhole seats, and then either two second-colour rings settle around it
 * with the chime (held), or the keyhole's colour drains out to a hollow broken outline as the
 * falling notes play (broken). The text rises in three groups. The DOM's resting state is the
 * final frame, so everything here animates from something.
 */
export function buildHeld(tl: gsap.core.Timeline, { broken }: { broken: boolean }): gsap.core.Timeline {
  tl.addLabel("build", 0)
    .from("[data-part='leg']", { scaleY: 0, transformOrigin: "50% 100%", duration: 0.5, ease: EASE.settle, stagger: 0.08 }, "build")
    .from("[data-part='beam']", { autoAlpha: 0, y: -4, scaleX: 0.6, transformOrigin: "50% 50%", duration: 0.5, ease: EASE.settle }, 0.35)
    .from("[data-part='nuki']", { scaleX: 0, transformOrigin: "50% 50%", duration: 0.4, ease: EASE.settle }, 0.6)
    .addLabel("key", 0.95)
    .from("[data-part='key']", { autoAlpha: 0, y: -5, scale: 0.7, transformOrigin: "50% 50%", duration: 0.5, ease: EASE.seat }, "key");

  if (broken) {
    // The seal drains: the accent keyhole fades out, leaving its outline in the broken colour.
    tl.addLabel("drain", 1.45)
      .call(() => play("broken"), [], "drain")
      .fromTo("[data-key='sealed']", { opacity: 1 }, { opacity: 0, duration: DUR.drain, ease: "power1.inOut" }, "drain")
      .fromTo("[data-key='drained']", { opacity: 0 }, { opacity: 1, duration: DUR.drain, ease: "power1.inOut" }, "drain");
  } else {
    tl.addLabel("rings", 1.2)
      .call(() => play("held"), [], "rings")
      .fromTo("[data-ring='1']", { attr: { r: 2.6 }, opacity: 0 }, { attr: { r: 5.2 }, opacity: 0.55, duration: 1.1, ease: EASE.glide }, "rings")
      .fromTo("[data-ring='2']", { attr: { r: 2.6 }, opacity: 0 }, { attr: { r: 7.6 }, opacity: 0.25, duration: 1.1, ease: EASE.glide }, "rings+=0.15");
  }
  tl.addLabel("rise", 1.3);
  ([1, 2, 3] as const).forEach((n, i) =>
    tl.from(
      `[data-rise='${n}']`,
      { autoAlpha: 0, y: 10, duration: DUR.moment, ease: EASE.glide, stagger: n === 3 ? 0.05 : 0, clearProps: "transform,opacity,visibility" },
      `rise+=${i * 0.15}`,
    ),
  );
  return tl;
}

/**
 * The torii keyhole for this page, its parts tagged for the build. Path data comes from
 * MARK_PATHS (verbatim from design/logo), so the mark is never redrawn. The gate is `text`, the
 * keyhole the accent; held adds two second-colour rings at rest, broken a hollow keyhole in the
 * broken colour under the accent one (which the build fades out).
 */
function HeldMark({ broken }: { broken: boolean }) {
  const p = MARK_PATHS;
  const { cx, cy } = p.keyCircle;
  return (
    <svg data-testid="held-mark" width={96} height={96} viewBox="0 0 26 26" fill="none" role="img" aria-label={broken ? "Sanctum, the seal broken" : "Sanctum"} className="shrink-0 overflow-visible">
      <g className="text-text">
        <path data-part="beam" d={p.beam} fill="currentColor" />
        <rect data-part="nuki" {...p.nuki} fill="currentColor" />
        <rect data-part="leg" {...p.legLeft} fill="currentColor" />
        <rect data-part="leg" {...p.legRight} fill="currentColor" />
      </g>
      {broken ? null : (
        <g className="text-second">
          <circle data-ring="1" cx={cx} cy={cy} r={5.2} opacity={0.55} stroke="currentColor" strokeWidth={0.5} />
          <circle data-ring="2" cx={cx} cy={cy} r={7.6} opacity={0.25} stroke="currentColor" strokeWidth={0.5} />
        </g>
      )}
      <g data-part="key">
        {broken ? (
          <g data-key="drained" className="text-broken-text">
            <circle {...p.keyCircle} stroke="currentColor" strokeWidth={0.45} />
            <path d={p.keyStem} stroke="currentColor" strokeWidth={0.45} strokeLinejoin="round" />
          </g>
        ) : null}
        <g data-key="sealed" className="text-sealed" opacity={broken ? 0 : undefined}>
          <circle {...p.keyCircle} fill="currentColor" />
          <path d={p.keyStem} fill="currentColor" />
        </g>
      </g>
    </svg>
  );
}

/** The session's task, checked off from here (v0.1). Already done shows as done. */
function TaskDone({ task }: { task: TaskLink }) {
  const alreadyDone = usePlanner((p) =>
    task.kind === "todo" ? p.todos.some((t) => t.id === task.id && t.done) : routineDoneOn(p.routines, p.checks, task.id, task.date),
  );
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const mark = async () => {
    setBusy(true);
    try {
      if (task.kind === "todo") await native.setTodoDone(task.id, true);
      else await native.setRoutineDone(task.id, task.date, true);
      setDone(true);
      void usePlanner.getState().reload();
    } catch {
      // Deleted meanwhile: nothing to check off.
      setDone(true);
    } finally {
      setBusy(false);
    }
  };
  const isDone = done || alreadyDone;
  return (
    <button
      type="button"
      data-testid="held-task"
      disabled={isDone || busy}
      onClick={() => void mark()}
      className={`flex h-9 min-w-0 items-center gap-[10px] rounded-control border px-3 text-left text-body transition-colors duration-ui ease-ui ${
        isDone ? "border-line text-muted" : "border-line-input text-text enabled:hover:bg-raised"
      }`}
    >
      <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] ${isDone ? "bg-sealed text-sealed-on" : "border-[1.5px] border-line-input"}`}>
        {isDone ? <CheckIcon /> : null}
      </span>
      <span className="truncate">{isDone ? `${task.title} is done` : `Mark ${task.title} done`}</span>
    </button>
  );
}

const RESULTS: [SessionResult, string][] = [
  ["done", "Done"],
  ["partly", "Partly"],
  ["no", "No"],
];

const CHIP = "flex h-8 items-center rounded-control border px-3 text-body transition-colors duration-ui ease-ui";
const chipClass = (on: boolean) => `${CHIP} ${on ? "border-sealed bg-sealed text-sealed-on" : "border-line-input text-text hover:bg-raised"}`;

interface Wrap {
  result: SessionResult | null;
  rating: number | null;
  leftOff: string;
}

const hasWrap = (w: Wrap) => w.result !== null || w.rating !== null || w.leftOff.trim() !== "";

/** How it went (v0.3.1): Done / Partly / No and a 1-5 focus rating (feedback on a specific
 *  goal, Locke & Latham), and where you left off, for the next seal (Leroy 2009). */
function WrapUp({ held, wrap, setWrap }: { held: HeldStats; wrap: Wrap; setWrap: (w: Wrap) => void }) {
  const what = held.goal ?? held.task?.title ?? null;
  return (
    <div data-testid="held-wrap" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="min-w-0 truncate text-body text-text-2">
          {what ? (
            <>
              Did <span className="font-semibold text-text">{what}</span> get done?
            </>
          ) : (
            "Did it get done?"
          )}
        </span>
        <div role="radiogroup" aria-label="Did it get done?" className="flex gap-[6px]">
          {RESULTS.map(([v, label]) => (
            <button key={v} type="button" role="radio" aria-checked={wrap.result === v} className={chipClass(wrap.result === v)} onClick={() => setWrap({ ...wrap, result: wrap.result === v ? null : v })}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-body text-text-2">Focus, 1 to 5</span>
        <div role="radiogroup" aria-label="Focus, 1 to 5" className="flex gap-[6px]">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={wrap.rating === n}
              className={`${chipClass(wrap.rating === n)} w-8 justify-center px-0 font-mono`}
              onClick={() => setWrap({ ...wrap, rating: wrap.rating === n ? null : n })}
            >
              {n}
            </button>
          ))}
        </div>
      </div>
      <input
        value={wrap.leftOff}
        maxLength={200}
        onChange={(e) => setWrap({ ...wrap, leftOff: e.target.value })}
        onKeyDown={(e) => e.stopPropagation()}
        placeholder="Where I left off (shown next time)"
        aria-label="Where I left off"
        className="h-9 rounded-control border border-line-input bg-raised px-3 text-body text-text placeholder:text-muted"
      />
    </div>
  );
}

/** Thoughts parked during this seal (v0.3.1): they're tasks for today; keep, move, or drop. */
function Parked({ sessionId }: { sessionId: number }) {
  const all = usePlanner((p) => p.todos);
  const parked = all.filter((t) => t.parkedFrom === sessionId && !t.done);
  if (!parked.length) return null;
  const tomorrow = async (id: number, title: string) => {
    await native.saveTodo({ id, title, dueDate: addDays(todayKey(new Date(), useStore.getState().settings.dailyResetTime), 1), dueTime: null, durationMin: null, profileId: null }).catch(() => undefined);
    void usePlanner.getState().reload();
  };
  const drop = async (id: number) => {
    await native.deleteTodo(id).catch(() => undefined);
    void usePlanner.getState().reload();
  };
  return (
    <div data-testid="held-parked" className="flex flex-col gap-1">
      <span className="label px-1">Parked during the seal, on today's list</span>
      {parked.map((t) => (
        <div key={t.id} className="flex h-9 items-center gap-2 rounded-control border border-line pl-3 pr-1">
          <span className="min-w-0 flex-1 truncate text-body text-text">{t.title}</span>
          <Button variant="quiet" size="sm" onClick={() => void tomorrow(t.id, t.title)}>
            Tomorrow
          </Button>
          <Button variant="quiet" size="sm" aria-label={`Delete ${t.title}`} onClick={() => void drop(t.id)}>
            Delete
          </Button>
        </div>
      ))}
    </div>
  );
}

const LINK = "h-7 rounded-control px-[10px] text-meta text-text-2 underline decoration-line-input underline-offset-[3px] transition-colors duration-ui ease-ui hover:text-text";

export function HeldPage({ held }: { held: HeldStats }) {
  const today = useStore((s) => s.focusTodayMin);
  const goal = useStore((s) => s.settings.dailyGoalMin);
  const close = useStore((s) => s.dismissHeld);
  const [wrap, setWrap] = useState<Wrap>({ result: null, rating: null, leftOff: "" });
  const [reviewOpen, setReviewOpen] = useState(false);
  const reviewId = useId();
  // Saved a moment after each change, and again on the way out, so leaving any way keeps it.
  const save = (w: Wrap) => void native.focusWrap(held.sessionId, w.result, w.rating, w.leftOff.trim() || null).catch(() => undefined);
  useEffect(() => {
    if (!hasWrap(wrap)) return;
    const t = setTimeout(() => save(wrap), 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wrap, held.sessionId]);
  const dismiss = () => {
    if (hasWrap(wrap)) save(wrap);
    close();
  };
  // The streak, for "3 days running." when this session met the goal.
  const [streak, setStreak] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    const t = todayKey();
    native
      .statsOverview(addDays(t, -6), t)
      .then((o) => live && setStreak(o.currentStreak))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [held.sessionId]);
  const broke = held.broken && held.broke ? brokeLine(held.broke) : null;
  const line = broke
    ? broke.line
    : held.broken
      ? heldLine({ sessionId: held.sessionId, broken: true, attempts: held.attempts, focusMinutes: held.focusMinutes, todayMinutes: today, goalMinutes: goal, streak })
      : `${heldFacts(held)} ${heldLine({ sessionId: held.sessionId, broken: false, attempts: held.attempts, focusMinutes: held.focusMinutes, todayMinutes: today, goalMinutes: goal, streak })}`;

  // The build: one timeline, played once per session. Reduced motion or a hidden window lands on
  // the final frame at once (the chime still sounds once).
  const root = useRef<HTMLDivElement>(null);
  const { run, shown } = useMotion(root);
  const tlRef = useRef<gsap.core.Timeline | null>(null);
  useGSAP(
    () => {
      tlRef.current = run(() => buildHeld(gsap.timeline({ id: "held" }), { broken: held.broken }));
    },
    { scope: root, dependencies: [held.sessionId, held.broken] },
  );
  // Hidden mid-build (minimized, sent to the tray): finish it, so it's whole when you come back.
  useEffect(() => {
    if (!shown) tlRef.current?.progress(1);
  }, [shown]);

  // A scheduled break, then "Next block?" with the same profile and length (v0.3.1).
  const takeBreak = async (m: number) => {
    try {
      useStore.getState().applyBreak(await native.breakStart(m, held.profileId, held.plannedMinutes));
      dismiss();
    } catch {
      // A seal started meanwhile: no break to take.
    }
  };

  const enterAgain = async () => {
    const s = useStore.getState();
    if (held.profileId !== null && s.profiles.some((p) => p.id === held.profileId)) s.selectProfile(held.profileId);
    s.setDuration(held.plannedMinutes);
    // Another round on the same task, unless it was just checked off.
    const t = held.task;
    const p = usePlanner.getState();
    const done = t && (t.kind === "todo" ? p.todos.some((x) => x.id === t.id && x.done) : routineDoneOn(p.routines, p.checks, t.id, t.date));
    s.setFocusTask(t && !done ? t : null);
    dismiss();
    await s.enterFocus();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
      // Enter on a focused button presses that button instead.
      else if (e.key === "Enter" && !(e.target instanceof HTMLButtonElement)) void enterAgain();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div ref={root} data-testid="held-page" data-broken={held.broken || undefined} className="relative h-full w-full overflow-hidden bg-app font-sans text-text">
      <div className="flex h-full w-full flex-col items-center gap-7 overflow-y-auto px-10 py-8 [&>*]:shrink-0 [&>:first-child]:mt-auto [&>:last-child]:mb-auto">
        <HeldMark broken={held.broken} />
        <div className="flex max-w-[760px] flex-col items-center gap-[22px] text-center">
          <div data-rise="1" className="flex flex-col items-center gap-[14px]">
            <h1 className="headline m-0 text-[88px] leading-none tracking-[-0.04em]">{held.broken ? HEADLINE.broken : HEADLINE.held}</h1>
            <p data-testid="held-fact" className="m-0 text-[16px] leading-normal text-text-2">
              {line}
            </p>
          </div>
          <div data-rise="2" className="flex gap-2">
            <Button variant="ghost" size="lg" className="gap-[10px] text-text" onClick={dismiss}>
              Done<span className="font-mono text-[11px] text-muted">Esc</span>
            </Button>
            <Button variant="primary" size="lg" className="gap-[10px] px-4" onClick={() => void enterAgain()}>
              Enter again<span aria-hidden="true" className="font-mono text-[11px] font-medium">↵</span>
            </Button>
          </div>
          <div data-rise="3" className="flex items-center gap-1">
            {broke?.fix ? (
              <button
                type="button"
                className={LINK}
                onClick={() => {
                  const tab = broke.fix!.tab;
                  dismiss();
                  useStore.getState().openSetup(tab);
                }}
              >
                {broke.fix.label}
              </button>
            ) : null}
            <button type="button" aria-expanded={reviewOpen} aria-controls={reviewId} className={LINK} onClick={() => setReviewOpen((o) => !o)}>
              Add a note
            </button>
          </div>
        </div>
        {reviewOpen ? (
          <section id={reviewId} aria-label="Review this session" data-testid="held-review" className="flex w-[560px] max-w-full flex-col gap-4 rounded-panel border border-line bg-panel p-4">
            {held.task ? <TaskDone task={held.task} /> : null}
            <WrapUp held={held} wrap={wrap} setWrap={setWrap} />
            <Parked sessionId={held.sessionId} />
            {held.broken ? null : (
              <div data-testid="held-break" className="flex flex-wrap items-center gap-2">
                <span className="text-meta text-muted">Take a break, distractions still closed:</span>
                {[5, 10, 15].map((m) => (
                  <Button key={m} variant="ghost" size="sm" className="font-mono" onClick={() => void takeBreak(m)}>
                    {m} min
                  </Button>
                ))}
              </div>
            )}
          </section>
        ) : null}
      </div>
    </div>
  );
}
