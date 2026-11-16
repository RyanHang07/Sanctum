import { afterEach } from "vitest";
import { act } from "@testing-library/react";
import { gsap } from "../lib/gsap";
import { setWindowShown } from "../lib/windowShown";
import { clearMoments, getMoment } from "../lib/useMotion";

// Motion test helpers (motion spec §11.2). Never wait on real time: seek timelines instead.
// src/test/setup.ts makes reduced motion the default, so every test lands on final values unless
// it calls setReducedMotion(false).

const original = window.matchMedia;

/** Turn reduced motion off (or back on) for one test; setup.ts's default is on. Reset after each test. */
export function setReducedMotion(reduce: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: query.includes("prefers-reduced-motion") ? reduce : false,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

/** Pretend the window is hidden (minimized, in the tray) or shown again. Reset after each test. */
export function setShown(shown: boolean) {
  act(() => setWindowShown(shown));
}

/** A moment's timeline by id: running, or the last one run through useMotion (even if it finished). */
export const moment = (id: string) => getMoment(id);

/**
 * Seek a moment to a time in seconds or a label, inside act() so React sees any state its
 * callbacks set. Callbacks between the old and new time fire (like real playback) unless
 * `suppressEvents` is true.
 */
export function seek(target: string | gsap.core.Animation, to: number | string, suppressEvents = false) {
  const anim = typeof target === "string" ? moment(target) : target;
  if (!anim) throw new Error(`No timeline with id "${String(target)}"`);
  act(() => {
    anim.seek(to, suppressEvents);
  });
  return anim;
}

/** Jump a moment to its end, callbacks included. */
export function finish(target: string | gsap.core.Animation) {
  const anim = typeof target === "string" ? moment(target) : target;
  if (!anim) throw new Error(`No timeline with id "${String(target)}"`);
  act(() => {
    anim.progress(1);
  });
  return anim;
}

afterEach(() => {
  window.matchMedia = original;
  setWindowShown(true);
  clearMoments();
  gsap.globalTimeline.clear(); // no tween leaks between tests
});
