import { useEffect, useState } from "react";
import { AnimatedMark } from "../components/AnimatedMark";
import { Mesh } from "../components/Mesh";
import { useStore } from "../state/store";
import { play } from "../lib/sound";
import { minutes } from "../lib/time";
import type { HeldStats, SessionResult, TaskLink } from "../lib/types";
import { usePlanner } from "../state/planner";
import { native } from "../lib/native";
import { CheckIcon } from "../components/icons";
import { brokeLine, heldLine } from "./headlines";
import { addDays, todayKey } from "../lib/planner";

// Full-page takeover when a session completes (SPEC 4.0.2, design/screens/HeldPage.dc.html).
// Stays until dismissed. Colors are the held mesh tokens; white is `sealed-on`.

function Stat({ value, label, last = false }: { value: string; label: string; last?: boolean }) {
  return (
    <div className={`flex flex-col gap-[2px] px-[22px] py-3 ${last ? "" : "border-r border-sealed-on/12"}`}>
      <span className="font-mono text-[18px] font-medium">{value}</span>
      <span className="text-meta text-sealed-on/72">{label}</span>
    </div>
  );
}

/** The session's task, checked off from here (v0.1). Already done shows as done. */
function TaskDone({ task }: { task: TaskLink }) {
  const alreadyDone = usePlanner((p) =>
    task.kind === "todo" ? p.todos.some((t) => t.id === task.id && t.done) : p.checks.some((c) => c.routineId === task.id && c.date === task.date),
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
      className={`flex h-9 max-w-[520px] items-center gap-[10px] rounded-control border px-[14px] text-body transition-colors duration-ui ease-ui ${
        isDone ? "border-sealed-on/16 text-sealed-on/80" : "border-sealed-on/30 bg-app/35 text-sealed-on hover:bg-app/55"
      }`}
    >
      <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] ${isDone ? "bg-sealed-on text-app" : "border-[1.5px] border-sealed-on/60"}`}>
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
const chipClass = (on: boolean) => `${CHIP} ${on ? "border-sealed-on bg-sealed-on text-app" : "border-sealed-on/30 bg-app/35 text-sealed-on hover:bg-app/55"}`;

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
    <div data-testid="held-wrap" className="held-r3 flex w-[560px] max-w-full flex-col gap-3 rounded-[10px] border border-sealed-on/16 bg-app/35 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="min-w-0 truncate text-body text-sealed-on/90">
          {what ? (
            <>
              Did <span className="font-semibold text-sealed-on">{what}</span> get done?
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
        <span className="text-body text-sealed-on/90">Focus, 1 to 5</span>
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
        className="h-9 rounded-control border border-sealed-on/30 bg-app/35 px-3 text-body text-sealed-on outline-none placeholder:text-sealed-on/55 focus:border-sealed-on/70"
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
    await native.saveTodo({ id, title, dueDate: addDays(todayKey(), 1), dueTime: null, durationMin: null, profileId: null }).catch(() => undefined);
    void usePlanner.getState().reload();
  };
  const drop = async (id: number) => {
    await native.deleteTodo(id).catch(() => undefined);
    void usePlanner.getState().reload();
  };
  return (
    <div data-testid="held-parked" className="held-r3 flex w-[560px] max-w-full flex-col gap-1">
      <span className="px-1 text-meta text-sealed-on/72">Parked during the seal, on today's list</span>
      {parked.map((t) => (
        <div key={t.id} className="flex h-9 items-center gap-2 rounded-control border border-sealed-on/16 bg-app/35 pl-3 pr-1">
          <span className="min-w-0 flex-1 truncate text-body text-sealed-on">{t.title}</span>
          <button type="button" className="h-7 rounded-[5px] px-2 text-meta text-sealed-on/80 hover:bg-sealed-on/10" onClick={() => void tomorrow(t.id, t.title)}>
            Tomorrow
          </button>
          <button type="button" aria-label={`Delete ${t.title}`} className="h-7 rounded-[5px] px-2 text-meta text-sealed-on/80 hover:bg-sealed-on/10" onClick={() => void drop(t.id)}>
            Delete
          </button>
        </div>
      ))}
    </div>
  );
}

export function HeldPage({ held }: { held: HeldStats }) {
  const today = useStore((s) => s.focusTodayMin);
  const goal = useStore((s) => s.settings.dailyGoalMin);
  const close = useStore((s) => s.dismissHeld);
  const [wrap, setWrap] = useState<Wrap>({ result: null, rating: null, leftOff: "" });
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
  const [run, setRun] = useState(0);
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
  const line = broke ? broke.line : heldLine({ sessionId: held.sessionId, broken: held.broken, attempts: held.attempts, focusMinutes: held.focusMinutes, todayMinutes: today, goalMinutes: goal, streak });

  const enterAgain = async () => {
    const s = useStore.getState();
    if (held.profileId !== null && s.profiles.some((p) => p.id === held.profileId)) s.selectProfile(held.profileId);
    s.setDuration(held.plannedMinutes);
    // Another round on the same task, unless it was just checked off.
    const t = held.task;
    const done = t && (t.kind === "todo" ? usePlanner.getState().todos.some((x) => x.id === t.id && x.done) : usePlanner.getState().checks.some((c) => c.routineId === t.id && c.date === t.date));
    s.setFocusTask(t && !done ? t : null);
    dismiss();
    await s.enterFocus();
  };

  // The chime lands as the keyhole drops in (1.2s), again on Replay.
  // A broken session still lands here; it sounds like one.
  useEffect(() => play(held.broken ? "broken" : "held", 1.2), [run, held.broken]);

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
    <div data-testid="held-page" className="relative h-full w-full overflow-hidden bg-app font-sans text-sealed-on">
      <Mesh tone="held" />

      <div key={run} className="relative flex h-full w-full flex-col items-center gap-6 overflow-y-auto p-10 [&>*]:shrink-0 [&>:first-child]:mt-auto [&>:last-child]:mb-auto">
        <AnimatedMark size={96} rings />
        <div className="held-r1 flex flex-col items-center gap-[10px] text-center">
          <span className="text-body uppercase tracking-[0.08em] text-sealed-on/85">
            {held.profileName} · {held.plannedMinutes} min
          </span>
          <h1 className="headline m-0 text-[88px] leading-none tracking-[-0.04em] text-sealed-on">
            Sanctum <em className="text-sealed-on/86">held.</em>
          </h1>
          <p className="m-0 text-[17px] text-sealed-on/90">
            {line}
          </p>
          {broke?.fix ? (
            <button
              type="button"
              onClick={() => {
                const tab = broke.fix!.tab;
                dismiss();
                useStore.getState().openSetup(tab);
              }}
              className="mt-1 h-8 rounded-control border border-sealed-on/30 px-3 text-body text-sealed-on transition-colors duration-ui ease-ui hover:bg-sealed-on/10"
            >
              {broke.fix.label}
            </button>
          ) : null}
        </div>
        <div className="held-r2 flex overflow-hidden rounded-[10px] border border-sealed-on/16 bg-app/35">
          <Stat value={minutes(held.focusMinutes)} label="in focus" />
          <Stat value={String(held.attempts)} label={held.attempts === 1 ? "attempt blocked" : "attempts blocked"} />
          <Stat value={minutes(today)} label={today >= goal ? "today, goal hit" : `today of ${minutes(goal)}`} last />
        </div>
        {held.task ? (
          <div className="held-r3">
            <TaskDone task={held.task} />
          </div>
        ) : null}
        <WrapUp held={held} wrap={wrap} setWrap={setWrap} />
        <Parked sessionId={held.sessionId} />
        <div className="held-r3 flex gap-2">
          <button
            type="button"
            onClick={() => setRun((r) => r + 1)}
            className="flex h-9 items-center gap-2 rounded-control border border-sealed-on/22 bg-app/35 px-3 text-body text-sealed-on transition-colors duration-ui ease-ui hover:bg-app/55"
          >
            Replay
          </button>
          <button
            type="button"
            onClick={dismiss}
            className="flex h-9 items-center gap-[10px] rounded-control border border-sealed-on/30 px-[14px] text-body text-sealed-on transition-colors duration-ui ease-ui hover:bg-sealed-on/10"
          >
            Done<span className="font-mono text-[11px] opacity-70">Esc</span>
          </button>
          <button
            type="button"
            onClick={() => void enterAgain()}
            className="flex h-9 items-center gap-[10px] rounded-control bg-sealed-on px-4 text-body font-semibold text-app transition-[filter] duration-ui ease-ui hover:brightness-90"
          >
            Enter again<span className="font-mono text-[11px] font-medium opacity-60">↵</span>
          </button>
        </div>
      </div>
    </div>
  );
}
