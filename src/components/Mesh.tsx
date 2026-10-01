import { useEffect, useState } from "react";
import { inTauri } from "../lib/native";

// The held mesh (design/screens/HeldPage.dc.html), shared by the Sanctum held page and, dimmed,
// by the sealed app (decided 2026-09-30): the gradient is the sealed theme, and held is its peak.
// Motion stops while the window is minimized or hidden in the tray.

/** False while the window is minimized, hidden in the tray, or the page is hidden. */
export function useWindowShown(): boolean {
  const [shown, setShown] = useState(() => typeof document === "undefined" || document.visibilityState !== "hidden");
  useEffect(() => {
    let alive = true;
    const offs: (() => void)[] = [];
    const check = async () => {
      let next = document.visibilityState !== "hidden";
      if (next && inTauri()) {
        try {
          const { getCurrentWindow } = await import("@tauri-apps/api/window");
          const w = getCurrentWindow();
          next = (await w.isVisible()) && !(await w.isMinimized());
        } catch {
          // Keep the page's own answer.
        }
      }
      if (alive) setShown(next);
    };
    const onVisibility = () => void check();
    document.addEventListener("visibilitychange", onVisibility);
    offs.push(() => document.removeEventListener("visibilitychange", onVisibility));
    if (inTauri()) {
      void import("@tauri-apps/api/window").then(({ getCurrentWindow }) => {
        const w = getCurrentWindow();
        // Minimizing resizes the window; restoring from the tray focuses it.
        for (const on of [w.onResized(() => void check()), w.onFocusChanged(() => void check())]) {
          void on.then((off) => (alive ? offs.push(off) : off()));
        }
      });
    }
    void check();
    return () => {
      alive = false;
      offs.forEach((off) => off());
    };
  }, []);
  return shown;
}

const BLOBS = {
  held: ["bg-held-1", "bg-held-2", "bg-held-3", "bg-held-4"],
  ember: ["bg-ember-1", "bg-ember-2", "bg-ember-3", "bg-ember-4"],
} as const;

type Tone = "held" | "sealed" | "event";

/**
 * "held": the full mesh behind the Sanctum held page. "sealed" (cobalt) and "event" (ember): the
 * same mesh dimmed and slowed behind the app, so the content stays in front. `paused` freezes it.
 */
export function Mesh({ tone, paused = false, className = "" }: { tone: Tone; paused?: boolean; className?: string }) {
  const shown = useWindowShown();
  const ambient = tone !== "held";
  const [a, b, c, d] = BLOBS[tone === "event" ? "ember" : "held"];
  return (
    <div
      aria-hidden="true"
      data-testid={`mesh-${tone}`}
      data-paused={shown && !paused ? undefined : "true"}
      className={`mesh pointer-events-none absolute inset-0 overflow-hidden ${ambient ? "mesh-ambient" : ""} ${className}`}
    >
      <div className={`held-blob-a absolute -left-[160px] -top-[200px] h-[680px] w-[680px] rounded-full opacity-90 blur-[120px] ${a}`} />
      <div className={`held-blob-b absolute -right-[200px] -top-[80px] h-[700px] w-[700px] rounded-full opacity-80 blur-[130px] ${b}`} />
      <div className={`held-blob-c absolute -bottom-[380px] left-[260px] h-[720px] w-[720px] rounded-full opacity-85 blur-[130px] ${c}`} />
      <div className={`held-blob-d absolute -bottom-[200px] right-[120px] h-[460px] w-[460px] rounded-full opacity-70 blur-[110px] ${d}`} />
      {ambient ? (
        // Dimmed toward the app background so text and panels stay in front.
        <div className="absolute inset-0 bg-radial-[ellipse_80%_70%_at_50%_40%] from-app/70 from-0% to-app/45 to-100%" />
      ) : (
        <div className="absolute inset-0 bg-radial-[ellipse_70%_60%_at_50%_48%] from-app/10 from-0% to-app/55 to-100%" />
      )}
      <svg className="absolute inset-0 h-full w-full opacity-[0.09] mix-blend-overlay">
        <filter id={`mesh-grain-${tone}`}>
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves={2} stitchTiles="stitch" />
        </filter>
        <rect width="100%" height="100%" filter={`url(#mesh-grain-${tone})`} />
      </svg>
    </div>
  );
}

/** How long the backdrops cross-fade between states. */
export const STATE_FADE_MS = 700;

/**
 * The app's backdrop: cobalt while sealed, ember in an event, plain when open. Switching states
 * cross-fades the two; a faded-out mesh unmounts once the fade ends so it costs nothing.
 */
export function StateBackdrop({ state }: { state: "open" | "sealed" | "event" }) {
  const [mounted, setMounted] = useState(() => ({ sealed: state === "sealed", event: state === "event" }));
  useEffect(() => {
    if (state !== "open") setMounted((m) => ({ ...m, [state]: true }));
    const t = setTimeout(() => setMounted({ sealed: state === "sealed", event: state === "event" }), STATE_FADE_MS + 100);
    return () => clearTimeout(t);
  }, [state]);
  return (
    <>
      {(["sealed", "event"] as const).map((tone) =>
        mounted[tone] ? (
          <Mesh key={tone} tone={tone} paused={state !== tone} className={`state-backdrop ${state === tone ? "state-backdrop-on" : ""}`} />
        ) : null,
      )}
    </>
  );
}
