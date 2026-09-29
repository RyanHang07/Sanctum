import { useEffect, useState } from "react";
import { Button, Kbd } from "../components/Button";
import { LockIcon } from "../components/icons";
import { EVENTS, native, onNative } from "../lib/native";
import { play, setSoundsEnabled } from "../lib/sound";
import { clock, countdown, minutes, minutesIn } from "../lib/time";
import type { Intercept as Payload } from "../lib/types";

const RETURN_AFTER_S = 5;
const NUDGE_MS = 3500;
const WELCOME_MS = 7000;

export function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${s}`;
}

/** "Discord stays sealed." overlay (design/screens/Blocked.dc.html). Auto-returns after 5s. */
export function SealedAppCard({ p, onBack, onBreak }: { p: Payload; onBack: () => void; onBreak: () => void }) {
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

  return (
    <div
      role="alertdialog"
      aria-label={`${p.label} is sealed`}
      className="flex w-[420px] animate-rise-in flex-col overflow-hidden rounded-dialog border border-sealed-line bg-panel shadow-dialog"
    >
      <div className="flex flex-col gap-[14px] px-[22px] pb-[18px] pt-[22px]">
        <div className="flex h-9 w-9 items-center justify-center rounded-panel border border-sealed-line bg-sealed-tint text-sealed">
          <LockIcon size={18} />
        </div>
        <div className="flex flex-col gap-[6px]">
          <h1 className="headline m-0 text-[24px]">
            {p.label} stays <em>sealed.</em>
          </h1>
          <p className="m-0 text-body leading-normal text-text-2">
            {minutesIn(p.elapsedMs)} minutes into {p.profileName}, <span className="font-mono text-text">{countdown(p.remainingMs)}</span> to
            go. You don't need it. You need the reps.
          </p>
        </div>
        <div className="flex gap-4 text-meta text-muted">
          <span>{ordinal(p.attempts)} attempt this session</span>
          {p.kind === "allowlist" ? <span>Allowlist mode</span> : null}
          <span>Logged to stats</span>
        </div>
      </div>
      <div className="flex items-center gap-2 border-t border-line bg-panel-footer px-[22px] py-3">
        <Button variant="quiet" onClick={onBreak}>
          Break the seal
        </Button>
        <span className="ml-auto whitespace-nowrap text-meta text-faint">
          Returning in <span className="font-mono">{Math.max(0, left)}s</span>
        </span>
        <Button variant="primary" className="min-w-0 gap-[10px] px-[14px]" onClick={onBack}>
          <span className="max-w-[128px] truncate">Back to {p.backTo ?? "work"}</span>
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
  return (
    <div role="status" className="flex w-[372px] animate-rise-in flex-col gap-1 rounded-panel border border-sealed-line bg-panel px-4 py-3 shadow-toast">
      <span className="headline text-[16px]">
        Welcome back. <em>Pick it up.</em>
      </span>
      {was ? <span className="truncate text-meta text-text-2">You were in {was}.</span> : null}
      <span className="text-meta text-muted">
        <span className="font-mono text-text-2">{minutes((p.idleMs ?? 0) / 60_000)}</span> idle · seal extended to{" "}
        <span className="font-mono text-text-2">{p.endsAt ? clock(p.endsAt) : "later"}</span>
      </span>
    </div>
  );
}

/** The always-on-top intercept window. Rust sizes and positions it per kind. */
export function InterceptWindow() {
  const [payload, setPayload] = useState<Payload | null>(null);

  useEffect(() => {
    void native.getSetting("sounds").then((v) => setSoundsEnabled(v !== "0"));
    const off = onNative<Payload>(EVENTS.intercept, (p) => {
      setPayload(p);
      if (p.kind !== "welcome") play("blocked");
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
      payload.kind === "welcome" ? WELCOME_MS : NUDGE_MS,
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
  return (
    <div className="flex h-full w-full items-center justify-center">
      {payload.kind === "title" ? (
        <TitleNudge p={payload} />
      ) : payload.kind === "welcome" ? (
        <WelcomeCard p={payload} />
      ) : (
        <SealedAppCard p={payload} onBack={back} onBreak={breakSeal} />
      )}
    </div>
  );
}
