import { useEffect, useRef, useState } from "react";
import { Button, Kbd } from "../components/Button";
import { LockIcon } from "../components/icons";
import { Odometer } from "../components/Odometer";
import { EVENTS, native, onNative } from "../lib/native";
import { play, setSoundsEnabled } from "../lib/sound";
import { DUR, EASE, gsap, useGSAP } from "../lib/gsap";
import { useMotion } from "../lib/useMotion";
import { clock, countdown, minutes, minutesIn } from "../lib/time";
import type { Intercept as Payload } from "../lib/types";
import { HEADLINE, PARK_LINES, QUIET_LINES, overlayLine, pauseHeadline, pick, planLine, welcome } from "../pages/headlines";

const RETURN_AFTER_S = 5;
const NUDGE_MS = 3500;
/** A nudge carrying your plan stays long enough to read it. */
const PLAN_NUDGE_MS = 5500;
const PARKED_MS = 900;
const WELCOME_MS = 7000;

export function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${s}`;
}

/** Counts down and returns to work; Enter returns now. */
function useAutoReturn(p: Payload, onBack: () => void): number {
  const [left, setLeft] = useState(RETURN_AFTER_S);
  useEffect(() => {
    setLeft(RETURN_AFTER_S);
    const t = setInterval(() => setLeft((s) => s - 1), 1000);
    return () => clearInterval(t);
  }, [p]);
  useEffect(() => {
    if (left <= 0) onBack();
  }, [left, onBack]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Enter" && onBack();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onBack]);
  return left;
}

export interface SealTick {
  /** Minutes into the seal. */
  m: number;
  major: boolean;
}

/**
 * The seal ruler's ticks (Intercept.dc.html): minor every 5 minutes and major every 15 for a seal
 * up to two hours; longer seals thin out (minor 10 or 30, major every hour) so the marks never
 * crowd. The ends are the card's corners, so they're left out.
 */
export function sealTicks(lengthMin: number): SealTick[] {
  const len = Math.max(1, Math.round(lengthMin));
  const [minor, major] = len <= 120 ? [5, 15] : len <= 240 ? [10, 60] : [30, 60];
  const out: SealTick[] = [];
  for (let m = minor; m < len; m += minor) out.push({ m, major: m % major === 0 });
  return out;
}

/** How far into the seal it is, 0 to 1. */
export const sealRatio = (elapsedMs: number, remainingMs: number) => {
  const total = elapsedMs + remainingMs;
  return total > 0 ? Math.min(1, Math.max(0, elapsedMs / total)) : 0;
};

/**
 * The seal's ruler along the card's top edge: an accent fill to now, a needle, and ticks as on
 * Today's day ruler (minors in line-input, majors in muted). Majors already passed are the accent:
 * it's the seal's progress, so none of it is the second colour, and nothing glows. The fill and
 * needle rest at now; the card's timeline plays them in from the start.
 */
function SealRuler({ elapsedMs, remainingMs }: { elapsedMs: number; remainingMs: number }) {
  const ratio = sealRatio(elapsedMs, remainingMs);
  const lengthMin = (elapsedMs + remainingMs) / 60_000;
  return (
    <div aria-hidden="true" data-ic-ruler className="pointer-events-none absolute inset-x-0 top-0 h-2">
      <span data-ic-fill className="absolute left-0 top-0 h-[2px] w-full origin-left bg-sealed" style={{ transform: `scaleX(${ratio})` }} />
      {sealTicks(lengthMin).map((t) => (
        <span
          key={t.m}
          data-ic-tick={t.m}
          data-major={t.major || undefined}
          className={`absolute top-0 ml-[-0.5px] w-px ${t.major ? `h-2 ${t.m <= lengthMin * ratio ? "bg-sealed" : "bg-muted"}` : "h-1 bg-line-input"}`}
          style={{ left: `${(t.m / lengthMin) * 100}%` }}
        />
      ))}
      <span data-ic-needle className="absolute inset-x-0 top-0 h-0" style={{ transform: `translateX(${ratio * 100}%)` }}>
        <span className="absolute left-[-1px] top-0 h-2 w-[2px] rounded-b-[1px] bg-sealed" />
      </span>
    </div>
  );
}

/** "Returning in 4s", the seconds rolling down on the odometer. */
function Returning({ left }: { left: number }) {
  return (
    <span data-testid="returning" className="ml-auto whitespace-nowrap text-meta text-muted">
      Returning in <Odometer text={`${Math.max(0, left)}s`} direction="down" className="font-mono" />
    </span>
  );
}

/** "Discord stays sealed." overlay (design/gate-canvas/project/Intercept.dc.html). Auto-returns
 *  after 5s. The card appears in place (it came from nowhere, so it doesn't travel), then the
 *  seal ruler fills to now (motion spec §7). */
export function SealedAppCard({ p, onBack, onBreak }: { p: Payload; onBack: () => void; onBreak: () => void }) {
  const left = useAutoReturn(p, onBack);
  const card = useRef<HTMLDivElement>(null);
  const { run } = useMotion(card);

  useGSAP(
    () => {
      const el = card.current;
      if (!el) return;
      const ratio = sealRatio(p.elapsedMs, p.remainingMs);
      run(() =>
        gsap
          .timeline({ id: "intercept" })
          .fromTo(el, { autoAlpha: 0, scale: 0.98 }, { autoAlpha: 1, scale: 1, duration: DUR.enter, ease: EASE.ui, clearProps: "transform,opacity,visibility" }, 0)
          .addLabel("ruler", 0.12)
          .fromTo("[data-ic-fill]", { scaleX: 0 }, { scaleX: ratio, duration: DUR.glide, ease: EASE.glide }, "ruler")
          .fromTo("[data-ic-needle]", { xPercent: 0 }, { xPercent: ratio * 100, duration: DUR.glide, ease: EASE.glide }, "ruler"),
      );
    },
    { scope: card, dependencies: [p] },
  );

  // From the third try the closing line already counts them ("That's 3 tries."), so the meta line
  // doesn't say it again.
  const repeat = p.attempts >= 3 && p.remainingMs >= 10 * 60_000;
  return (
    <div
      ref={card}
      role="alertdialog"
      aria-label={`${p.label} is sealed`}
      className="relative flex w-[420px] flex-col overflow-hidden rounded-dialog border border-sealed-line bg-panel shadow-toast"
    >
      <SealRuler elapsedMs={p.elapsedMs} remainingMs={p.remainingMs} />
      <div className="flex flex-col gap-[14px] px-[22px] pb-[18px] pt-[22px]">
        <div className="flex flex-col gap-[6px]">
          <h1 className="headline m-0 text-[24px]">{HEADLINE.stays(p.label)}</h1>
          <p className="m-0 text-body leading-normal text-text-2">
            {minutesIn(p.elapsedMs)} minutes into {p.profileName}, <span className="font-mono text-text">{countdown(p.remainingMs)}</span> to
            go. {overlayLine(`${p.label}:${p.attempts}`, clock(Date.now() + p.remainingMs), { attempts: p.attempts, remainingMs: p.remainingMs })}
          </p>
        </div>
        {p.plan ? (
          <p data-testid="overlay-plan" className="m-0 rounded-control bg-sealed-tint px-3 py-2 text-body text-text">
            {planLine(p.plan)}
          </p>
        ) : null}
        <div className="flex gap-4 text-meta text-muted">
          {repeat ? null : <span>{ordinal(p.attempts)} attempt this session</span>}
          {p.kind === "allowlist" ? <span>Allowlist mode</span> : null}
          <span>Logged to stats</span>
        </div>
      </div>
      <div className="flex items-center gap-2 border-t border-line bg-panel-footer px-[22px] py-3">
        {/* Quiet on purpose; pulled left by its padding so the text lines up with the card. */}
        <Button variant="quiet" className="-ml-3" onClick={onBreak}>
          Break the seal
        </Button>
        <Returning left={left} />
        <Button variant="primary" className="min-w-0 gap-[10px] px-[14px]" onClick={onBack}>
          <span className="max-w-[160px] truncate">Back to {p.backTo ?? "work"}</span>
          <Kbd onFill>↵</Kbd>
        </Button>
      </div>
    </div>
  );
}

/** Pause mode (v0.3.1): a flagged app came to the front outside a seal. It waits, minimized,
 *  while you take a breath: Not now closes it; Go on, after five seconds, brings it back. */
export function PauseCard({ p, onAnswer }: { p: Payload; onAnswer: (goOn: boolean) => void }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Enter" && onAnswer(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onAnswer]);
  const left = Math.max(0, Math.ceil(((p.endsAt ?? 0) - now) / 1000));
  const headline = pauseHeadline(p.label, p.endsAt ?? 0);
  return (
    <div role="alertdialog" aria-label={headline} className="flex w-[420px] animate-fade-in flex-col overflow-hidden rounded-dialog border border-line-input bg-panel shadow-toast">
      <div className="flex flex-col gap-[6px] px-[22px] pb-[18px] pt-[22px]">
        <h1 className="headline m-0 text-[24px]">{headline}</h1>
        <p className="m-0 text-body leading-normal text-text-2">
          {left ? (
            <>
              Go on unlocks in <span className="font-mono text-text">{left}s</span>, for 15 minutes if you still want it.
            </>
          ) : (
            "It's yours for 15 minutes if you still want it."
          )}
        </p>
      </div>
      <div className="flex items-center gap-2 border-t border-line bg-panel-footer px-[22px] py-3">
        <Button variant="quiet" className="-ml-3" disabled={left > 0} onClick={() => onAnswer(true)}>
          Go on
        </Button>
        <Button variant="primary" className="ml-auto gap-[10px] px-[14px]" onClick={() => onAnswer(false)}>
          Not now
          <Kbd onFill>↵</Kbd>
        </Button>
      </div>
    </div>
  );
}

/** Quiet hours caught a flagged app (v0.1): it waits until the window ends, or pause 15 minutes.
 *  In a break after a seal (v0.3.1) it waits for the break, with no pause. */
export function QuietCard({ p, onBack, onPause }: { p: Payload; onBack: () => void; onPause: () => void }) {
  const left = useAutoReturn(p, onBack);
  const until = p.endsAt ? clock(p.endsAt) : "morning";
  const onBreak = p.profileName === "Break";
  return (
    <div
      role="alertdialog"
      aria-label={`${p.label} waits for quiet hours`}
      className="flex w-[420px] animate-fade-in flex-col overflow-hidden rounded-dialog border border-sealed-line bg-panel shadow-toast"
    >
      <div className="flex flex-col gap-[14px] px-[22px] pb-[18px] pt-[22px]">
        <div className="flex flex-col gap-[6px]">
          <h1 className="headline m-0 text-[24px]">{HEADLINE.waits(p.label, until)}</h1>
          <p className="m-0 text-body leading-normal text-text-2">
            {onBreak ? "A break is for your eyes and legs. Your Distractions list waits too. " : `${pick(QUIET_LINES, p.endsAt ?? 0)} `}
            <span className="font-mono text-text">{countdown(p.remainingMs)}</span> to go.
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 border-t border-line bg-panel-footer px-[22px] py-3">
        {onBreak ? null : (
          <Button variant="quiet" className="-ml-3" onClick={onPause}>
            Pause 15 min
          </Button>
        )}
        <Returning left={left} />
        <Button variant="primary" className="min-w-0 gap-[10px] px-[14px]" onClick={onBack}>
          <span className="max-w-[160px] truncate">Back to {p.backTo ?? "work"}</span>
          <Kbd onFill>↵</Kbd>
        </Button>
      </div>
    </div>
  );
}

/** Corner nudge when a window is minimized for a sealed title keyword (SPEC 4.4). */
export function TitleNudge({ p }: { p: Payload }) {
  return (
    <div role="status" className="flex w-[348px] animate-rise-in items-center gap-3 rounded-panel border border-line-input bg-toast px-[14px] py-3 shadow-toast">
      <LockIcon size={14} className="shrink-0 text-sealed" />
      <div className="flex min-w-0 flex-col gap-[2px]">
        <span className="text-body text-text">“{p.keyword}” stays sealed.</span>
        <span className="truncate text-meta text-muted">Minimized {p.label}</span>
        {p.plan ? <span className="text-meta text-text-2">{planLine(p.plan)}</span> : null}
      </div>
    </div>
  );
}

/**
 * "Welcome back" after idling mid-session (SPEC 4.8): what you were doing, how long you
 * were away, and where the seal now ends. Corner card, never steals focus.
 */
export function WelcomeCard({ p }: { p: Payload }) {
  const was = p.title && p.title !== "(private)" ? `${p.label}: ${p.title}` : p.label;
  const line = welcome(p.endsAt ?? p.idleMs ?? 0);
  return (
    <div role="status" className="flex w-[372px] animate-rise-in flex-col gap-1 rounded-panel border border-sealed-line bg-panel px-4 py-3 shadow-toast">
      <span className="headline text-[16px]">{line}</span>
      {was ? <span className="truncate text-meta text-text-2">You were in {was}.</span> : null}
      <span className="text-meta text-muted">
        <span className="font-mono text-text-2">{minutes((p.idleMs ?? 0) / 60_000)}</span> idle · seal extended to{" "}
        <span className="font-mono text-text-2">{p.endsAt ? clock(p.endsAt) : "later"}</span>
      </span>
    </div>
  );
}

/** Park a thought (v0.3.1): Ctrl Alt P while sealed. It becomes a task for today, so it stops
 *  pulling at you (Masicampo & Baumeister 2011). Enter parks, Esc closes. */
export function ParkCard({ onDone }: { onDone: () => void }) {
  const [text, setText] = useState("");
  const [state, setState] = useState<"typing" | "parked" | "failed">("typing");
  const [line] = useState(() => pick(PARK_LINES, Date.now()));
  const park = async () => {
    const t = text.trim();
    if (!t) return onDone();
    try {
      await native.focusPark(t);
      setState("parked");
      setTimeout(onDone, PARKED_MS);
    } catch {
      setState("failed");
    }
  };
  return (
    <form
      role="dialog"
      aria-label="Park a thought"
      onSubmit={(e) => {
        e.preventDefault();
        void park();
      }}
      onKeyDown={(e) => e.key === "Escape" && onDone()}
      className="flex w-[372px] animate-rise-in flex-col gap-2 rounded-panel border border-sealed-line bg-panel px-4 py-3 shadow-toast"
    >
      <span className="headline text-[16px]">{line}</span>
      <input
        autoFocus
        value={text}
        maxLength={200}
        disabled={state === "parked"}
        onChange={(e) => setText(e.target.value)}
        placeholder="The thought, as a task for later"
        aria-label="The thought"
        className="h-8 rounded-control border border-line-input bg-raised px-3 text-body text-text placeholder:text-muted"
      />
      <span role="status" className="text-meta text-muted">
        {state === "parked" ? "Parked. It's on today's list." : state === "failed" ? "Couldn't park it. Try again from Home." : "Enter parks it · Esc closes"}
      </span>
    </form>
  );
}

/** The always-on-top intercept window. Rust sizes and positions it per kind. */
export function InterceptWindow() {
  const [payload, setPayload] = useState<Payload | null>(null);

  useEffect(() => {
    void native.getSetting("sounds").then((v) => setSoundsEnabled(v !== "0"));
    const off = onNative<Payload>(EVENTS.intercept, (p) => {
      setPayload(p);
      if (p.kind !== "welcome" && p.kind !== "park" && p.kind !== "pause") play("blocked");
    });
    return () => void off.then((f) => f());
  }, []);

  useEffect(() => {
    if (payload?.kind !== "title" && payload?.kind !== "welcome") return;
    const t = setTimeout(
      () => {
        setPayload(null);
        void native.interceptHide();
      },
      payload.kind === "welcome" ? WELCOME_MS : payload.plan ? PLAN_NUDGE_MS : NUDGE_MS,
    );
    return () => clearTimeout(t);
  }, [payload]);

  if (!payload) return null;
  const back = () => {
    setPayload(null);
    void native.interceptReturn();
  };
  const breakSeal = () => {
    setPayload(null);
    void native.interceptBreak();
  };
  const pauseQuiet = () => {
    setPayload(null);
    void native.interceptQuietPause();
  };
  const hide = () => {
    setPayload(null);
    void native.interceptHide();
  };
  const answerPause = (goOn: boolean) => {
    setPayload(null);
    void native.pauseAnswer(goOn).catch(() => undefined);
  };
  return (
    <div className="flex h-full w-full items-center justify-center">
      {payload.kind === "pause" ? (
        <PauseCard key={payload.endsAt ?? 0} p={payload} onAnswer={answerPause} />
      ) : payload.kind === "park" ? (
        <ParkCard key={payload.endsAt ?? 0} onDone={hide} />
      ) : payload.kind === "title" ? (
        <TitleNudge p={payload} />
      ) : payload.kind === "welcome" ? (
        <WelcomeCard p={payload} />
      ) : payload.kind === "quiet" ? (
        <QuietCard p={payload} onBack={back} onPause={pauseQuiet} />
      ) : (
        <SealedAppCard p={payload} onBack={back} onBreak={breakSeal} />
      )}
    </div>
  );
}
