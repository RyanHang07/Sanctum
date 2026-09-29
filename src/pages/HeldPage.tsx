import { useEffect, useState } from "react";
import { AnimatedMark } from "../components/AnimatedMark";
import { useStore } from "../state/store";
import { play } from "../lib/sound";
import { minutes } from "../lib/time";
import type { HeldStats } from "../lib/types";

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

export function HeldPage({ held }: { held: HeldStats }) {
  const today = useStore((s) => s.focusTodayMin);
  const goal = useStore((s) => s.settings.dailyGoalMin);
  const dismiss = useStore((s) => s.dismissHeld);
  const [run, setRun] = useState(0);

  const enterAgain = async () => {
    const s = useStore.getState();
    if (held.profileId !== null && s.profiles.some((p) => p.id === held.profileId)) s.selectProfile(held.profileId);
    s.setDuration(held.plannedMinutes);
    dismiss();
    await s.enterFocus();
  };

  // The chime lands as the keyhole drops in (1.2s), again on Replay.
  useEffect(() => play("held", 1.2), [run]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
      else if (e.key === "Enter") void enterAgain();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div data-testid="held-page" className="relative h-full w-full overflow-hidden bg-app font-sans text-sealed-on">
      <div aria-hidden="true" className="absolute inset-0 overflow-hidden">
        <div className="held-blob-a absolute -left-[160px] -top-[200px] h-[680px] w-[680px] rounded-full bg-held-1 opacity-90 blur-[120px]" />
        <div className="held-blob-b absolute -right-[200px] -top-[80px] h-[700px] w-[700px] rounded-full bg-held-2 opacity-80 blur-[130px]" />
        <div className="held-blob-c absolute -bottom-[380px] left-[260px] h-[720px] w-[720px] rounded-full bg-held-3 opacity-85 blur-[130px]" />
        <div className="held-blob-d absolute -bottom-[200px] right-[120px] h-[460px] w-[460px] rounded-full bg-held-4 opacity-70 blur-[110px]" />
        <div className="absolute inset-0 bg-radial-[ellipse_70%_60%_at_50%_48%] from-app/10 from-0% to-app/55 to-100%" />
        <svg className="absolute inset-0 h-full w-full opacity-[0.09] mix-blend-overlay">
          <filter id="held-grain">
            <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves={2} stitchTiles="stitch" />
          </filter>
          <rect width="100%" height="100%" filter="url(#held-grain)" />
        </svg>
      </div>

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
