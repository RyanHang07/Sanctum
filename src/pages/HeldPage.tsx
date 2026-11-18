import { useEffect, useId, useRef, useState } from "react";
import { MARK_PATHS } from "../components/AnimatedMark";
import { Button } from "../components/Button";
import { useStore } from "../state/store";
import { play } from "../lib/sound";
import { DUR, EASE, RISE_FROM, RISE_STAGGER, RISE_TO, gsap, useGSAP } from "../lib/gsap";
import { useMotion } from "../lib/useMotion";
import { minutes } from "../lib/time";
import type { HeldStats, SessionResult, TaskLink } from "../lib/types";
import { usePlanner } from "../state/planner";
import { native } from "../lib/native";
import { CheckIcon, PlusIcon } from "../components/icons";
import { HEADLINE, brokeLine, heldLine } from "./headlines";
import { addDays, routineDoneOn, todayKey } from "../lib/planner";

// Full-page takeover when a session completes (SPEC 4.0.2, design/gate-canvas/project/Held.dc.html
// and HeldBroken.dc.html). Stays until dismissed. A clean page on the app color (redesign
// 2026-11-16: no backdrop) holding one card: the mark, one headline and one fact line set left,
// a hairline, then a footer row with "Add a note" on the left and Done / Enter again on the
// right. The session review opens inside the card, above the footer, only when asked.

/** A seal's facts in one sentence: "1h of Interview Prep, 3 attempts blocked." */
export function heldFacts(h: Pick<HeldStats, "focusMinutes" | "profileName" | "attempts">): string {
  const what = `${minutes(h.focusMinutes)} of ${h.profileName}`;
  if (h.attempts === 0) return `${what}.`;
  return `${what}, ${h.attempts} ${h.attempts === 1 ? "attempt" : "attempts"} blocked.`;
}

/**
 * The held build (motion spec §5 and §6), one timeline that owns sound and motion on one clock.
 * The gate assembles, the keyhole seats, and then either two second-color rings settle around it
 * with the chime (held), or a crack runs down through the second-color keyhole from the nuki as
 * the falling notes play (broken). The text and the actions rise in, and "Add a note" rises
 * last. The DOM's resting state is the final frame, so everything here animates from something.
 */
export function buildHeld(tl: gsap.core.Timeline, { broken }: { broken: boolean }): gsap.core.Timeline {
  tl.addLabel("build", 0)
    .from("[data-part='leg']", { scaleY: 0, transformOrigin: "50% 100%", duration: 0.5, ease: EASE.settle, stagger: 0.08 }, "build")
    .from("[data-part='beam']", { autoAlpha: 0, y: -4, scaleX: 0.6, transformOrigin: "50% 50%", duration: 0.5, ease: EASE.settle }, 0.35)
    .from("[data-part='nuki']", { scaleX: 0, transformOrigin: "50% 50%", duration: 0.4, ease: EASE.settle }, 0.6)
    .addLabel("key", 0.95)
    .from("[data-part='key']", { autoAlpha: 0, y: -5, scale: 0.7, transformOrigin: "50% 50%", duration: 0.5, ease: EASE.seat }, "key");

  if (broken) {
    // The seal splits: a crack (pathLength 1) draws from the nuki down through the keyhole as the
    // broken notes fall. Its dashoffset runs 1 (hidden) to 0 (drawn), the DOM's resting value.
    tl.addLabel("drain", 1.45)
      .call(() => play("broken"), [], "drain")
      .fromTo("[data-crack]", { attr: { "stroke-dashoffset": 1 } }, { attr: { "stroke-dashoffset": 0 }, duration: 0.45, ease: EASE.settle }, "drain");
  } else {
    tl.addLabel("rings", 1.2)
      .call(() => play("held"), [], "rings")
      .fromTo("[data-ring='1']", { attr: { r: 2.6 }, opacity: 0 }, { attr: { r: 5.2 }, opacity: 0.55, duration: 1.1, ease: EASE.glide }, "rings")
      .fromTo("[data-ring='2']", { attr: { r: 2.6 }, opacity: 0 }, { attr: { r: 7.6 }, opacity: 0.25, duration: 1.1, ease: EASE.glide }, "rings+=0.15");
  }
  tl.addLabel("rise", 1.3);
  ([1, 2] as const).forEach((n, i) =>
    tl.from(`[data-rise='${n}']`, { autoAlpha: 0, y: 10, duration: DUR.moment, ease: EASE.glide, clearProps: "transform,opacity,visibility" }, `rise+=${i * 0.15}`),
  );
  // The last beat: "Add a note" (and a broken seal's fix) rise in once the actions have landed.
  tl.addLabel("note", "rise+=0.6").fromTo("[data-rise='note']", RISE_FROM, { ...RISE_TO, stagger: 0.05 }, "note");
  return tl;
}

/** The crack through a broken seal, in the mark's 26-unit box: from inside the nuki, down
 *  through the keyhole's circle and stem to its foot. Jagged, a hairline at 72px. */
export const CRACK_PATH = "M13.5 11L12.8 12.3L13.3 13.4L12.6 14.6L13.5 15.8L12.7 17.1L13.4 18.4L12.6 19.9L13.3 21.5L12.7 23L13.1 24";

/**
 * The torii keyhole for this page, its parts tagged for the build. Path data comes from
 * MARK_PATHS (verbatim from design/logo), so the mark is never redrawn. The gate is `text`.
 * Held: the keyhole in the accent with two second-color rings at rest. Broken: the keyhole in
 * full in the second color, split by a crack in the card's own color so it reads as a gap.
 */
function HeldMark({ broken }: { broken: boolean }) {
  const p = MARK_PATHS;
  const { cx, cy } = p.keyCircle;
  return (
    <svg data-testid="held-mark" width={72} height={72} viewBox="0 0 26 26" fill="none" role="img" aria-label={broken ? "Sanctum, the seal broken" : "Sanctum"} className="shrink-0 overflow-visible">
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
      <g data-part="key" data-key={broken ? "broken" : "sealed"} className={broken ? "text-second" : "text-sealed"}>
        <circle {...p.keyCircle} fill="currentColor" />
        <path d={p.keyStem} fill="currentColor" />
      </g>
      {broken ? (
        <path
          data-crack=""
          d={CRACK_PATH}
          pathLength={1}
          strokeDasharray="1 1"
          strokeDashoffset={0}
          className="text-panel"
          stroke="currentColor"
          strokeWidth={0.42}
          strokeLinejoin="miter"
          strokeLinecap="butt"
        />
      ) : null}
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
        className="h-control rounded-control border border-line-input bg-raised px-3 text-body text-text placeholder:text-muted"
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

/** The footer's left-hand buttons wear Done's style (decided 2026-11-16): outlined, full text. */
const SIDE = "gap-[10px] text-text";

export function HeldPage({ held }: { held: HeldStats }) {
  const today = useStore((s) => s.focusTodayMin);
  const goal = useStore((s) => s.settings.dailyGoalMin);
  const close = useStore((s) => s.dismissHeld);
  const [wrap, setWrap] = useState<Wrap>({ result: null, rating: null, leftOff: "" });
  const [reviewOpen, setReviewOpen] = useState(false);
  // Closing plays out before the panel unmounts; the button already reads closed.
  const [closing, setClosing] = useState(false);
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
    const t = todayKey(new Date(), useStore.getState().settings.dailyResetTime);
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
  // "Add a note" opens like Pending (decided 2026-11-16): the space grows to its height, then
  // what's inside cascades in. Closing is instant.
  const reviewRef = useRef<HTMLDivElement>(null);
  useGSAP(
    () => {
      const wrap = reviewRef.current;
      const panel = wrap?.firstElementChild;
      if (!reviewOpen || !wrap || !panel) return;
      run(() =>
        gsap
          .timeline({ id: "held-review" })
          .fromTo(wrap, { height: 0 }, { height: "auto", duration: DUR.state, ease: EASE.glide, clearProps: "height" })
          .fromTo(Array.from(panel.children), RISE_FROM, { ...RISE_TO, stagger: RISE_STAGGER }, "-=0.06"),
      );
    },
    { scope: root, dependencies: [reviewOpen] },
  );
  // Closing mirrors opening (decided 2026-11-16): the contents fade out, then the space folds shut.
  const toggleReview = () => {
    if (!reviewOpen) return setReviewOpen(true);
    if (closing) return;
    const wrap = reviewRef.current;
    const panel = wrap?.firstElementChild;
    if (!wrap || !panel) return setReviewOpen(false);
    setClosing(true);
    run(() =>
      gsap
        .timeline({
          id: "held-review-close",
          onComplete: () => {
            setClosing(false);
            setReviewOpen(false);
          },
        })
        .to(Array.from(panel.children), { opacity: 0, y: -4, duration: DUR.ui, ease: EASE.exit, stagger: { each: 0.02, from: "end" } })
        .to(wrap, { height: 0, duration: DUR.state, ease: EASE.glide }, "-=0.04"),
    );
  };

  // Hidden mid-build (minimized, sent to the tray): finish it, so it's whole when you come back.
  useEffect(() => {
    if (!shown) tlRef.current?.progress(1);
  }, [shown]);

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
      // The close dialog, when it's up over the page, owns Escape and Enter.
      if (useStore.getState().closeDialogOpen) return;
      if (e.key === "Escape") dismiss();
      // Enter on a focused button presses that button instead.
      else if (e.key === "Enter" && !(e.target instanceof HTMLButtonElement)) void enterAgain();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div ref={root} data-testid="held-page" data-broken={held.broken || undefined} className="relative h-full w-full overflow-hidden bg-app font-sans text-text">
      <div className="flex h-full w-full flex-col items-center overflow-y-auto px-10 py-8">
        <article data-testid="held-card" className="my-auto flex w-full max-w-[680px] shrink-0 flex-col rounded-dialog border border-line bg-panel">
          <div className="flex flex-col items-start gap-7 px-10 pb-9 pt-10">
            <HeldMark broken={held.broken} />
            <div data-rise="1" className="flex flex-col items-start gap-[14px] text-left">
              <h1 className="headline m-0 text-held leading-none">{held.broken ? HEADLINE.broken : HEADLINE.held}</h1>
              <p data-testid="held-fact" className="m-0 max-w-[520px] text-[16px] leading-normal text-text-2">
                {line}
              </p>
            </div>
          </div>
          {reviewOpen ? (
            <div ref={reviewRef} className="overflow-hidden">
              <section id={reviewId} aria-label="Review this session" data-testid="held-review" className="flex flex-col gap-4 border-t border-line px-10 py-6">
                {held.task ? <TaskDone task={held.task} /> : null}
                <WrapUp held={held} wrap={wrap} setWrap={setWrap} />
                <Parked sessionId={held.sessionId} />
              </section>
            </div>
          ) : null}
          <div data-testid="held-footer" className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-6 py-4">
            <div className="flex items-center gap-2">
              <Button data-rise="note" variant="ghost" size="lg" className={SIDE} aria-expanded={reviewOpen && !closing} aria-controls={reviewId} onClick={toggleReview}>
                <PlusIcon size={12} className={`transition-transform duration-ui ease-ui ${reviewOpen && !closing ? "rotate-45" : ""}`} />
                Add a note
              </Button>
              {broke?.fix ? (
                <Button
                  data-rise="note"
                  variant="ghost"
                  size="lg"
                  className={SIDE}
                  onClick={() => {
                    const tab = broke.fix!.tab;
                    dismiss();
                    useStore.getState().openSetup(tab);
                  }}
                >
                  {broke.fix.label}
                </Button>
              ) : null}
            </div>
            <div data-rise="2" className="ml-auto flex gap-2">
              <Button variant="ghost" size="lg" className="gap-[10px] text-text" onClick={dismiss}>
                Done<span className="font-mono text-micro text-muted">Esc</span>
              </Button>
              <Button variant="primary" size="lg" className="gap-[10px] px-4" onClick={() => void enterAgain()}>
                Enter again<span aria-hidden="true" className="font-mono text-micro font-medium">↵</span>
              </Button>
            </div>
          </div>
        </article>
      </div>
    </div>
  );
}
