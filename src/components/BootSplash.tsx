import { useEffect, useState } from "react";
import { AnimatedMark } from "./AnimatedMark";

// Boot splash (design/screens/LogoMotion.dc.html, 2.2 s): the pillars rise, the beam settles,
// the crossbar slides in, the keyhole drops into place, then the wordmark. Once per launch.

let played = false;

/** Skipped in tests, when motion is reduced, and after the first time this launch. */
function shouldPlay(): boolean {
  if (played || import.meta.env.MODE === "test") return false;
  const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  return !reduced;
}

export function BootSplash() {
  const [show, setShow] = useState(shouldPlay);
  useEffect(() => {
    if (!show) return;
    played = true;
    const t = setTimeout(() => setShow(false), 2600);
    return () => clearTimeout(t);
  }, [show]);
  if (!show) return null;
  return (
    <div data-testid="boot-splash" aria-hidden="true" className="splash-out fixed inset-0 z-50 flex items-center justify-center bg-sidebar">
      {/* A fixed width: the word tightens as it enters, and a shrinking column would nudge the mark. */}
      <div className="flex w-[320px] flex-col items-center gap-4 text-text">
        <AnimatedMark size={96} label="Sanctum" keyClass="text-sealed" />
        <span className="splash-word whitespace-nowrap text-[22px] font-semibold">Sanctum</span>
      </div>
    </div>
  );
}
