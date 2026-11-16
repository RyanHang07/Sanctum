import { useRef, useSyncExternalStore, type RefObject } from "react";
import { gsap, useGSAP } from "./gsap";
import { useWindowShown } from "./windowShown";

// One hook, two switches (motion spec §1.4): Windows' "reduce motion" and whether the window can
// be seen. The global reduced-motion rule in styles.css shortens CSS animations only; GSAP's
// inline tweens need this.

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(cb: () => void) {
  if (typeof window === "undefined" || !window.matchMedia) return () => undefined;
  const mq = window.matchMedia(QUERY);
  mq.addEventListener?.("change", cb);
  return () => mq.removeEventListener?.("change", cb);
}

const reducedNow = () => (typeof window !== "undefined" && !!window.matchMedia ? window.matchMedia(QUERY).matches : false);

/** True while Windows' "Show animations" is off (prefers-reduced-motion: reduce). */
export const useReducedMotion = () => useSyncExternalStore(subscribe, reducedNow, () => true);

// The last timeline each moment ran, by id. GSAP drops finished timelines from its global
// timeline (so gsap.getById misses a moment that jumped to its end); tests and replay still need it.
const moments = new Map<string, gsap.core.Timeline>();

/** A moment's timeline by id: the running one, or the last one run through useMotion. */
export function getMoment(id: string): gsap.core.Timeline | undefined {
  return (gsap.getById(id) as gsap.core.Timeline | undefined) ?? moments.get(id);
}

/** Forget finished moments (tests call this between cases). */
export function clearMoments() {
  moments.clear();
}

export type Build = (o: { reduced: boolean }) => gsap.core.Timeline;

/**
 * Moments call run(build): the timeline plays when motion is live, and jumps to its end
 * (callbacks included, so a chime still sounds) under reduced motion or a hidden window.
 * The end state is therefore identical on both paths, by construction. Everything built inside
 * run or a contextSafe handler is reverted when the component unmounts.
 */
export function useMotion<T extends Element>(scope: RefObject<T | null>) {
  const reduced = useReducedMotion();
  const shown = useWindowShown();
  const live = !reduced && shown;
  const liveRef = useRef(live);
  liveRef.current = live;
  const { contextSafe, context } = useGSAP({ scope });

  const run = contextSafe((build: Build) => {
    const tl = build({ reduced: !liveRef.current });
    const id = tl.vars.id;
    if (typeof id === "string") moments.set(id, tl);
    if (!liveRef.current) tl.progress(1); // fires .call()s; no spatial motion
    return tl;
  }) as (build: Build) => gsap.core.Timeline;

  return { live, reduced, shown, run, contextSafe, context };
}
