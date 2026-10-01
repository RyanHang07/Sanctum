import { useEffect, useState } from "react";
import { AnimatedMark } from "../components/AnimatedMark";
import { Mesh } from "../components/Mesh";
import { useStore } from "../state/store";
import { play } from "../lib/sound";
import { minutes } from "../lib/time";
import type { HeldStats, TaskLink } from "../lib/types";
import { usePlanner } from "../state/planner";
import { native } from "../lib/native";
import { CheckIcon } from "../components/icons";

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

export function HeldPage({ held }: { held: HeldStats }) {
  const today = useStore((s) => s.focusTodayMin);
  const goal = useStore((s) => s.settings.dailyGoalMin);
  const dismiss = useStore((s) => s.dismissHeld);
  const [run, setRun] = useState(0);

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

      <div key={run} className="relative flex h-full w-full flex-col items-center justify-center gap-7 p-10">
        <AnimatedMark size={96} rings />
        <div className="held-r1 flex flex-col items-center gap-[10px] text-center">
          <span className="text-body uppercase tracking-[0.08em] text-sealed-on/85">
            {held.profileName} · {held.plannedMinutes} min
          </span>
          <h1 className="headline m-0 text-[88px] leading-none tracking-[-0.04em] text-sealed-on">
            Sanctum <em className="text-sealed-on/86">held.</em>
          </h1>
          <p className="m-0 text-[17px] text-sealed-on/90">
            {held.broken ? "Held, but the downtime broke it." : "Promise kept."}
          </p>
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
