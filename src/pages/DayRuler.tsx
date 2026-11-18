import { useRef } from "react";
import { DUR, EASE, gsap, useGSAP } from "../lib/gsap";
import { useMotion } from "../lib/useMotion";
import { Odometer } from "../components/Odometer";
import { minutes as fmt } from "../lib/time";
import { majorCrossed, rulerLabel, rulerSpan, rulerTicks, type Tick } from "../state/session";

// The day ruler on Today (decision log: "Today: Ruler", motion spec §2). Focused minutes against
// the goal: a needle and an accent fill move along ticks every 5 minutes, half hours and hours are
// major, and the goal is one tall tick in the second color. Each focused minute glides the needle
// and rolls the figure; a crossed half hour lights for a moment. Positions are transforms only, and
// GSAP owns them: the runners are full-width layers moved by xPercent, so nothing is measured.

const TICK: Record<Tick["kind"], string> = {
  minor: "h-2 w-px bg-line-input",
  half: "h-4 w-px bg-muted",
  hour: "h-6 w-px bg-muted",
  goal: "h-[46px] w-[2px] rounded-[1px] bg-second",
};

/** The figure turns to sit left of the needle past this share of the ruler. */
const FLIP_AT = 0.72;

export function DayRuler({ minutes, goal }: { minutes: number; goal: number }) {
  const root = useRef<HTMLDivElement>(null);
  const prev = useRef<number | null>(null);
  const { live, run } = useMotion(root);
  const span = rulerSpan(minutes, goal);
  const met = minutes >= goal;
  const share = (m: number) => Math.max(0, Math.min(1, m / span));
  const flip = share(minutes) > FLIP_AT;
  // No "time left" figure (removed 2026-11-16): the gap to the goal tick says it. Screen readers
  // still hear it in the ruler's label.

  useGSAP(
    () => {
      const was = prev.current;
      prev.current = minutes;
      const step = was !== null && minutes === was + 1; // a real tick, not a load, resume or day change
      const animate = live && step;
      const at = share(minutes) * 100;
      const vars = { duration: DUR.glide, ease: EASE.glide };
      // A jump drops any glide still under way, so it can't carry the needle back afterwards.
      const move = (sel: string, to: gsap.TweenVars) => {
        const els = root.current ? Array.from(root.current.querySelectorAll(sel)) : [];
        if (els.length === 0) return;
        if (animate) return void gsap.to(els, { ...to, ...vars });
        gsap.killTweensOf(els); // each runner moves one property, so all of its tweens go
        gsap.set(els, to);
      };
      move("[data-needle],[data-needle-label]", { xPercent: at });
      move("[data-fill]", { scaleX: at / 100 });
      const crossed = was === null ? null : majorCrossed(was, minutes, goal);
      if (animate && crossed !== null) {
        run(() =>
          gsap
            .timeline({ id: "tick-cross" })
            .fromTo(`[data-tick-light="${crossed}"]`, { opacity: 0 }, { opacity: 1, duration: 0.12, ease: "none" }, DUR.glide * 0.7)
            .to(`[data-tick-light="${crossed}"]`, { opacity: 0, duration: 0.6, ease: "power2.out" }),
        );
      }
    },
    { scope: root, dependencies: [minutes, goal, span, live] },
  );

  const labels = [0, 60, 120, 180, 240, 300, 360, 420, 480].filter((m) => m <= span);
  return (
    <div ref={root} data-ruler role="img" aria-label={rulerLabel(minutes, goal)} className="relative h-[104px] [overflow-clip-margin:6px] overflow-x-clip">
      {/* The figure: live minutes on the odometer. */}
      <div data-needle-label className="pointer-events-none absolute left-0 top-0 h-0 w-full">
        <div className={`absolute left-0 top-0 flex items-baseline gap-2 whitespace-nowrap transition-transform duration-state ease-ui ${flip ? "-translate-x-full" : ""}`}>
          <Odometer text={fmt(minutes)} className="font-mono text-[30px] font-medium tracking-[-0.03em] text-text" />
          <span className="text-meta text-muted">focused</span>
        </div>
      </div>
      {goal <= span ? (
        <div className={`absolute top-[34px] translate-x-2 whitespace-nowrap text-meta text-second-text ${met ? "font-semibold" : ""}`} style={{ left: `${share(goal) * 100}%` }}>
          Goal <span className="font-mono">{fmt(goal)}</span>
          {met ? (
            <span data-goal-suffix className="inline-block">
              {" "}· kept
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="absolute inset-x-0 bottom-[22px] h-[46px]">
        {met && goal <= span ? (
          // The goal once met: a second-color field behind its tick, at its resting strength.
          <span
            data-goal-glow
            className="pointer-events-none absolute bottom-0 h-full w-2 -translate-x-1/2 rounded-[2px] bg-second-tint opacity-55"
            style={{ left: `${share(goal) * 100}%` }}
          />
        ) : null}
        {rulerTicks(span, goal).map((t) => (
          <span
            key={`${t.kind}${t.m}`}
            data-tick={t.m}
            data-kind={t.kind}
            className={`absolute bottom-0 ${TICK[t.kind]}`}
            style={{ left: `${share(t.m) * 100}%`, marginLeft: t.m === 0 ? 0 : t.m === span ? (t.kind === "goal" ? -2 : -1) : t.kind === "goal" ? -1 : -0.5 }}
          >
            {t.kind === "half" || t.kind === "hour" ? (
              // Lit for a moment as the needle reaches it: a brighter, taller mark in the accent.
              <span data-tick-light={t.m} className="pointer-events-none absolute -left-[0.5px] bottom-0 h-[calc(100%+6px)] w-[2px] rounded-[1px] bg-sealed opacity-0" />
            ) : null}
          </span>
        ))}
        <span className="absolute inset-x-0 bottom-0 h-px bg-line" />
        <span data-fill className="absolute bottom-[-1px] left-0 h-[3px] w-full origin-left rounded-[2px] bg-sealed will-change-transform" />
        <span data-needle className="pointer-events-none absolute bottom-0 left-0 h-0 w-full will-change-transform">
          <span className="absolute bottom-[-1px] left-[-1px] h-[50px] w-[2px] rounded-[1px] bg-sealed" />
        </span>
      </div>

      <div className="absolute inset-x-0 bottom-0 h-[14px] font-mono text-micro text-muted">
        {labels.map((m) => (
          <span
            key={m}
            data-ruler-label={m}
            className={`absolute top-0 ${m === 0 ? "" : m === span ? "-translate-x-full" : "-translate-x-1/2"}`}
            style={{ left: `${share(m) * 100}%` }}
          >
            {m === 0 ? "0" : `${m / 60}h`}
          </span>
        ))}
      </div>
    </div>
  );
}
