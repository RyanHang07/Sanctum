import { useEffect, useState } from "react";
import { EVENTS, native, onNative } from "../lib/native";
import { clock, countdown } from "../lib/time";
import type { HeldStats, SessionView } from "../lib/types";

// Compact focus timer (SPEC 4.0.1, design/screens/MiniTimer.dc.html): 300x58, always on top,
// draggable. Sealed colour fills left to right with progress. Text/ring must stay readable
// over both the sealed fill and the unfilled panel background across all themes.

import { theme as tokens } from "../theme/tokens";

const RING = 75.4; // 2 * pi * 12
const colors = tokens.colors as Record<string, string | Record<string, string>>;
const sealedColor = (colors.sealed as Record<string, string>).DEFAULT;
const panelColor = colors.panel as string;

/** Legacy helper (used by tests): linear gradient fill background. */
export function fillStyle(progress: number) {
  const pct = `${(Math.min(1, Math.max(0, progress)) * 100).toFixed(1)}%`;
  return { background: `linear-gradient(90deg, ${sealedColor} 0%, ${sealedColor} ${pct}, ${panelColor} ${pct})` };
}

function Content({ progress, sub, name, remaining }: { progress: number; sub: string; name: string; remaining: number }) {
  return (
    <>
      <svg data-tauri-drag-region width="30" height="30" viewBox="0 0 30 30" aria-hidden="true" className="shrink-0">
        <circle cx="15" cy="15" r="12" fill="none" stroke="currentColor" strokeOpacity="0.22" strokeWidth="3" />
        <circle
          cx="15"
          cy="15"
          r="12"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={RING}
          strokeDashoffset={(RING * (1 - progress)).toFixed(1)}
          transform="rotate(-90 15 15)"
        />
      </svg>
      <div data-tauri-drag-region className="flex min-w-0 grow flex-col gap-px">
        <span data-tauri-drag-region className="truncate text-meta font-medium">
          {name}
        </span>
        <span data-tauri-drag-region className="truncate text-[11px] opacity-80">
          {sub}
        </span>
      </div>
      <span data-tauri-drag-region className="font-mono text-[20px] font-medium tracking-[-0.02em]">
        {countdown(remaining)}
      </span>
    </>
  );
}

export function CompactTimer() {
  const [session, setSession] = useState<SessionView | null>(null);
  const [held, setHeld] = useState(false);

  useEffect(() => {
    void native.getSession().then(setSession);
    const offs = [
      // A fresh handler per mount: the preview bus keys handlers by identity, and StrictMode's
      // second mount would otherwise lose its subscription to the first mount's cleanup.
      onNative<SessionView>(EVENTS.tick, (s) => setSession(s)),
      onNative<SessionView | null>(EVENTS.session, (s) => {
        setSession(s);
        if (s) setHeld(false);
      }),
      onNative<HeldStats>(EVENTS.held, () => setHeld(true)),
    ];
    return () => offs.forEach((p) => void p.then((f) => f()));
  }, []);

  const planned = (session?.plannedMinutes ?? 0) * 60_000;
  const progress = held ? 1 : planned ? (session?.elapsedMs ?? 0) / planned : 0;
  const pct = Math.min(100, Math.max(0, progress * 100));
  const remaining = held ? 0 : session?.remainingMs ?? 0;
  const name = session?.profileName ?? "Sanctum";
  const sub = held
    ? "Held. Nice."
    : session?.idle
      ? "Paused while you're away"
      : session
      ? `${Math.ceil(remaining / 60_000)} min left · until ${clock(session.endsAt)}`
      : "Not sealed";

  return (
    <div
      data-tauri-drag-region
      role="timer"
      aria-label={`Focus timer, ${countdown(remaining)} left`}
      onDoubleClick={() => void native.showMain()}
      className="relative box-border h-full w-full select-none overflow-hidden rounded-dialog border border-sealed-line bg-panel"
    >
      <div aria-hidden="true" className="absolute inset-y-0 left-0 bg-sealed" style={{ width: `${pct}%` }} />
      {/* Visuals clipped to unfilled (panel) area. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 flex items-center gap-3 pl-3 pr-[10px] text-text" style={{ clipPath: `inset(0 0 0 ${pct}%)` }}>
        <Content progress={progress} sub={sub} name={name} remaining={remaining} />
        <span className="h-[26px] w-[26px] shrink-0" />
      </div>
      {/* Visuals clipped to filled (sealed) area. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 flex items-center gap-3 pl-3 pr-[10px] text-sealed-on" style={{ clipPath: `inset(0 ${100 - pct}% 0 0)` }}>
        <Content progress={progress} sub={sub} name={name} remaining={remaining} />
        <span className="h-[26px] w-[26px] shrink-0" />
      </div>
      {/* Interactive layer (drag + button) always reachable; button color adapts to which side it's on. */}
      <div data-tauri-drag-region className="absolute inset-0 flex items-center justify-end pr-[10px]">
        <button
          type="button"
          aria-label="Expand to full window"
          onClick={() => void native.showMain()}
          className={`flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-control transition-colors duration-ui ease-ui ${
            pct > 88 ? "text-sealed-on/80 hover:bg-sealed-on/12 hover:text-sealed-on" : "text-muted hover:bg-raised hover:text-text"
          }`}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
          </svg>
        </button>
      </div>
    </div>
  );
}
