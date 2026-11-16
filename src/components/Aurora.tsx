import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useReducedMotion } from "../lib/useMotion";
import { useWindowShown } from "../lib/windowShown";
import {
  createAurora,
  levelFor,
  LIGHT_SCALE,
  readColours,
  targetFor,
  webglAvailable,
  type AuroraEngine,
  type AuroraPlacement,
  type AuroraTone,
} from "../lib/aurora";

export type { AuroraPlacement, AuroraTone } from "../lib/aurora";

// The aurora (redesign F4): the soft northern lights behind every screen, and the held page's
// fuller version of them. One WebGL canvas (lib/aurora.ts); a CSS gradient where WebGL is missing.
// It moves only while it can be seen and motion is allowed: still under reduced motion, paused
// while the window is hidden, and slower (or still) on battery.

interface BatteryLike {
  charging: boolean;
  addEventListener(type: "chargingchange", cb: () => void): void;
  removeEventListener(type: "chargingchange", cb: () => void): void;
}

/** True while the device runs on battery and isn't charging (Battery API, where the web view has it). */
export function useOnBattery(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const nav = navigator as Navigator & { getBattery?: () => Promise<BatteryLike> };
    if (typeof nav.getBattery !== "function") return;
    let alive = true;
    let battery: BatteryLike | null = null;
    const update = () => {
      if (alive && battery) setOn(!battery.charging);
    };
    nav
      .getBattery()
      .then((b) => {
        if (!alive) return;
        battery = b;
        update();
        b.addEventListener("chargingchange", update);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
      battery?.removeEventListener("chargingchange", update);
    };
  }, []);
  return on;
}

/** Bumps whenever the theme changes (applyTheme rewrites <html>'s style and data-theme). */
function useThemeVersion(): number {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (typeof MutationObserver === "undefined") return;
    const mo = new MutationObserver(() => setV((n) => n + 1));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["style", "data-theme", "data-scheme"] });
    return () => mo.disconnect();
  }, []);
  return v;
}

export type AuroraMotion = "live" | "still" | "paused";

export function Aurora({
  tone,
  placement = "top",
  paused = false,
  className = "",
}: {
  tone: AuroraTone;
  /** Where the band sits: "top" hangs the light from the top edge, "bottom" lets it rise. */
  placement?: AuroraPlacement;
  /** Freeze it (a page covering it, a window with focus elsewhere). */
  paused?: boolean;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const shown = useWindowShown();
  const onBattery = useOnBattery();
  const themeVersion = useThemeVersion();
  const [render, setRender] = useState<"webgl" | "fallback">(() => (webglAvailable() ? "webgl" : "fallback"));
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<AuroraEngine | null>(null);
  const firstRef = useRef(true);

  const level = levelFor(tone, onBattery);
  const motion: AuroraMotion = paused || !shown ? "paused" : reduced || level.fps === 0 ? "still" : "live";
  const light = typeof document !== "undefined" && document.documentElement.dataset.scheme === "light";
  const strength = level.strength * (light ? LIGHT_SCALE : 1);

  // Set up the shader once; fall back to CSS if it can't be had or the GPU drops it.
  useLayoutEffect(() => {
    if (render !== "webgl") return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const engine = createAurora(canvas);
    if (!engine) {
      setRender("fallback");
      return;
    }
    engineRef.current = engine;
    engine.resize();
    const onLost = (e: Event) => {
      e.preventDefault();
      setRender("fallback");
    };
    canvas.addEventListener("webglcontextlost", onLost);
    const ro = new ResizeObserver(() => {
      engine.resize();
      if (!engine.running) engine.draw();
    });
    ro.observe(canvas);
    return () => {
      ro.disconnect();
      canvas.removeEventListener("webglcontextlost", onLost);
      engine.destroy();
      engineRef.current = null;
    };
  }, [render]);

  // Point it at this state, then move, hold still, or pause.
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const colours = readColours(tone);
    const target = targetFor(tone, placement, colours, level);
    if (firstRef.current && tone === "broken" && motion === "live") {
      // A broken seal opens on the held light, then drains it to grey.
      engine.setTarget(targetFor("held", placement, colours), true);
    }
    engine.setTarget(target, motion !== "live" || (firstRef.current && tone !== "broken"));
    firstRef.current = false;
    if (motion === "live") engine.start(level.fps);
    else {
      engine.stop();
      if (motion === "still") engine.drawStill();
      else engine.draw(); // paused: hold the current frame (and paint it if it's the first)
    }
    // level is derived from tone and onBattery.
  },[tone, placement, motion, onBattery, themeVersion, render]);

  useEffect(() => () => engineRef.current?.stop(), []);

  return (
    <div
      aria-hidden="true"
      data-testid="aurora"
      data-tone={tone}
      data-placement={placement}
      data-render={render}
      data-motion={motion}
      data-strength={strength.toFixed(2)}
      className={`aurora pointer-events-none absolute inset-0 overflow-hidden ${className}`}
    >
      {render === "webgl" ? (
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      ) : (
        <div className="aurora-fallback absolute inset-0" style={{ opacity: strength }} />
      )}
    </div>
  );
}

/**
 * The app's backdrop: the aurora at the app's state. One canvas for every state; switching
 * eases the light from one strength and colour to the next instead of cross-fading two layers.
 */
export function StateBackdrop({ state, placement }: { state: "open" | "sealed" | "event"; placement?: AuroraPlacement }) {
  return <Aurora tone={state} placement={placement} />;
}
