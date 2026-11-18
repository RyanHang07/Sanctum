import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type DependencyList, type RefObject } from "react";
import gsap from "gsap";
import { CustomEase } from "gsap/CustomEase";
import extra from "../../../src/theme/extra.json";

// The site's motion, mirroring the app's (src/lib/gsap.ts, useMotion.ts, useSwap.ts, and
// useSlidingIndicator in src/components/controls.tsx). The durations and eases are read from the
// same tokens (src/theme/extra.json "motion"), so the site and the app move the same way. GSAP is
// imported only here. Everything jumps to its end under "reduce motion"; nothing loops.

gsap.registerPlugin(CustomEase);

const useIsoLayoutEffect = typeof document === "undefined" ? useEffect : useLayoutEffect;
const NONE: DependencyList = [];

/**
 * useGSAP, as @gsap/react 2.1 has it (the app's src/lib/gsap.ts uses that one): tweens made in the
 * callback, or in a contextSafe function, belong to a gsap.context and are reverted on unmount.
 * A local copy because the site's tests run in the app's Vitest, where a second @gsap/react under
 * partner/node_modules would bring its own copy of React.
 */
export function useGSAP(callback: (() => void | (() => void)) | null, { scope, dependencies = NONE }: { scope?: RefObject<Element | null>; dependencies?: DependencyList } = {}) {
  const mounted = useRef(false);
  const context = useRef<gsap.Context | null>(null);
  // Like @gsap/react, the scope is the ref itself: gsap reads .current when it needs it.
  context.current ??= gsap.context(() => undefined, scope as object | undefined);
  const deferCleanup = dependencies.length > 0;
  // With dependencies, an update adds to the context; only unmounting reverts it.
  useIsoLayoutEffect(() => {
    if (!deferCleanup) return;
    mounted.current = true;
    return () => context.current?.revert();
  }, NONE);
  useIsoLayoutEffect(() => {
    if (callback) context.current!.add(callback, scope as object | undefined);
    if (!deferCleanup || !mounted.current) return () => context.current?.revert();
  }, dependencies);
  const contextSafe = useRef(<F extends (...args: never[]) => unknown>(fn: F): F => context.current!.add(null as never, fn as never) as unknown as F);
  return { context: context.current, contextSafe: contextSafe.current };
}

type DurKey = keyof typeof extra.motion.duration;
type EaseKey = keyof typeof extra.motion.easing;

/** Seconds, from the app's tokens (ui 0.12, enter 0.18, state 0.24, glide 0.4, moment 0.7). */
export const DUR = Object.fromEntries(Object.entries(extra.motion.duration).map(([k, v]) => [k, parseFloat(v) / 1000])) as Record<DurKey, number>;

for (const [name, css] of Object.entries(extra.motion.easing)) {
  const m = /cubic-bezier\(([^)]+)\)/.exec(css);
  if (m) CustomEase.create(name, m[1]!);
}

/** The token eases by name: `ease: EASE.glide`. */
export const EASE = Object.fromEntries(Object.keys(extra.motion.easing).map((k) => [k, k])) as Record<EaseKey, string>;

gsap.defaults({ duration: DUR.enter, ease: EASE.ui, overwrite: "auto" });

/** The rise-in (the app's, decided 2026-11-16): a short fade up from 6px below. */
export const RISE_FROM: gsap.TweenVars = { opacity: 0, y: 6 };
export const RISE_TO: gsap.TweenVars = { opacity: 1, y: 0, duration: DUR.state, ease: EASE.glide, clearProps: "opacity,transform" };
/** A list cascades its items this far apart. */
export const RISE_STAGGER = 0.04;
/** The beat between old content leaving and new content arriving. */
const BEAT = DUR.ui;

const QUERY = "(prefers-reduced-motion: reduce)";
const reducedNow = () => typeof window !== "undefined" && !!window.matchMedia && window.matchMedia(QUERY).matches;
function subscribe(cb: () => void) {
  if (typeof window === "undefined" || !window.matchMedia) return () => undefined;
  const mq = window.matchMedia(QUERY);
  mq.addEventListener?.("change", cb);
  return () => mq.removeEventListener?.("change", cb);
}

/** True while the visitor asks for less motion. */
export const useReducedMotion = () => useSyncExternalStore(subscribe, reducedNow, () => true);

/**
 * A scope for tweens, as the app's useMotion: run(build) plays the timeline, or jumps to its end
 * (callbacks included) under reduced motion, so both paths end in the same state.
 */
export function useMotion<T extends Element>(scope: RefObject<T | null>) {
  const reduced = useReducedMotion();
  const live = useRef(!reduced);
  live.current = !reduced;
  const { contextSafe } = useGSAP(null, { scope });
  const run = contextSafe((build: () => gsap.core.Timeline) => {
    const tl = build();
    if (!live.current) tl.progress(1);
    return tl;
  }) as (build: () => gsap.core.Timeline) => gsap.core.Timeline;
  return { live: !reduced, run, contextSafe };
}

/**
 * Swaps content the way the app's screens swap: the old content fades out (120ms), a 120ms
 * beat, then the new content rises in (240ms, glide). Returns the ref for the moving element and
 * the key to render, which trails `key` until the old content has gone. The first render just
 * appears. While it swaps, the element hides its overflow so no scrollbar flashes.
 */
export function useSwap<K>(key: K) {
  const ref = useRef<HTMLDivElement>(null);
  const first = useRef(true);
  const swap = useRef<gsap.core.Timeline | null>(null);
  const [shown, setShown] = useState(key);
  const { run } = useMotion(ref);
  useGSAP(
    () => {
      if (first.current) {
        first.current = false;
        return;
      }
      const el = ref.current;
      if (!el) return setShown(key);
      holdLanding();
      swap.current?.kill();
      const from = Number(gsap.getProperty(el, "opacity"));
      const settle = () => {
        el.style.overflow = "";
      };
      el.style.overflow = "hidden";
      swap.current = run(() =>
        gsap
          .timeline({ onComplete: settle, onInterrupt: settle })
          .to(el, { opacity: 0, duration: DUR.ui * from, ease: EASE.exit })
          .call(() => setShown(key))
          .fromTo(el, RISE_FROM, { ...RISE_TO, immediateRender: false }, `+=${BEAT}`),
      );
    },
    { dependencies: [key] },
  );
  // The new content is in: scroll to where the move asked (the top, or a heading).
  useEffect(() => {
    if (!first.current) land();
  }, [shown]);
  return { ref, shown };
}

// Where a move lands: go() asks for the top or an anchor, and the swap that brings the new
// content in scrolls there once it has rendered (site/nav.tsx).
let pending: string | null = null;
let held = false;

/** go() calls this: scroll to `hash` (or the top) once the new content is in. */
export function landAt(hash: string | null) {
  pending = hash ?? "";
  held = false;
  // No swap took the move (same page, a hash on this page): land now.
  requestAnimationFrame(() => {
    if (!held) land();
  });
}
function holdLanding() {
  held = true;
}
function land() {
  held = false;
  if (pending === null) return;
  const hash = pending;
  pending = null;
  const el = hash ? document.getElementById(hash) : null;
  if (el) el.scrollIntoView?.();
  else if (!navigator.userAgent.includes("jsdom")) window.scrollTo({ top: 0 });
}

/**
 * Cascades `selector`'s matches in (rise-in, 40ms apart) when `deps` change and when `when` is
 * true. With `onView`, each group waits until it scrolls into view. Content is never hidden
 * unless motion is live and the tween is about to run.
 */
export function useCascade(scope: RefObject<HTMLElement | null>, selector: string, deps: unknown[] = [], when = true) {
  const { live, run } = useMotion(scope);
  useGSAP(
    () => {
      const root = scope.current;
      if (!root || !when || !live) return;
      const items = Array.from(root.querySelectorAll(selector));
      if (!items.length) return;
      run(() => gsap.timeline().fromTo(items, RISE_FROM, { ...RISE_TO, stagger: RISE_STAGGER }));
    },
    { scope, dependencies: [live, when, ...deps] },
  );
}

/**
 * Sections that rise in once as they scroll into view: each `[data-reveal]` group cascades its
 * `[data-rise]` children (or itself), 40ms apart. Only once this runs, and only with motion on,
 * is anything hidden before it's seen.
 */
export function useReveal(scope: RefObject<HTMLElement | null>) {
  const { live } = useMotion(scope);
  useGSAP(
    () => {
      const root = scope.current;
      if (!root || !live || typeof IntersectionObserver === "undefined") return;
      const groups = Array.from(root.querySelectorAll<HTMLElement>("[data-reveal]"));
      const partsOf = (g: HTMLElement) => {
        const parts = Array.from(g.querySelectorAll<HTMLElement>("[data-rise]"));
        return parts.length ? parts : [g];
      };
      // Only what's below the fold waits; what's already on screen stays put.
      const fold = window.innerHeight;
      const waiting = groups.filter((g) => g.getBoundingClientRect().top > fold * 0.92);
      for (const g of waiting) gsap.set(partsOf(g), { opacity: 0, y: 6 });
      const io = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            if (!e.isIntersecting) continue;
            io.unobserve(e.target);
            gsap.to(partsOf(e.target as HTMLElement), { ...RISE_TO, stagger: RISE_STAGGER });
          }
        },
        { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
      );
      waiting.forEach((g) => io.observe(g));
      return () => io.disconnect();
    },
    { scope, dependencies: [live] },
  );
}

/**
 * Grows a panel or an accordion's body to its height, then cascades its `[data-rise]` children
 * (or its direct children) in: the app's Pending (decided 2026-11-16). Runs each time `open`
 * turns true.
 */
export function useGrow(el: RefObject<HTMLElement | null>, open: boolean) {
  const { run } = useMotion(el);
  useGSAP(
    () => {
      const node = el.current;
      if (!open || !node) return;
      const marked = Array.from(node.querySelectorAll("[data-rise]"));
      const parts = marked.length ? marked : Array.from(node.children);
      run(() =>
        gsap
          .timeline()
          .fromTo(node, { height: 0, overflow: "hidden" }, { height: "auto", duration: DUR.state, ease: EASE.glide, clearProps: "height,overflow" })
          .fromTo(parts, RISE_FROM, { ...RISE_TO, stagger: RISE_STAGGER }, "-=0.06"),
      );
    },
    { scope: el, dependencies: [open] },
  );
}

/**
 * A segmented control's or tab strip's sliding highlight (useSlidingIndicator in the app's
 * controls.tsx): `indicator` glides to the `[data-indicator-item="<active>"]` inside `root`,
 * 180ms on the snap ease. A layout change re-measures in place.
 */
export function useSlidingIndicator(root: RefObject<HTMLElement | null>, indicator: RefObject<HTMLElement | null>, active: string | null, layoutKey = "") {
  const placed = useRef(false);
  const { live } = useMotion(root);
  const place = useRef<(glide: boolean) => void>(() => undefined);
  place.current = (glide) => {
    const el = indicator.current;
    if (!el) return;
    const item = active === null ? null : root.current?.querySelector<HTMLElement>(`[data-indicator-item="${CSS.escape(active)}"]`);
    if (!item || item.offsetWidth === 0) {
      gsap.set(el, { autoAlpha: 0, overwrite: true });
      placed.current = false;
      return;
    }
    const to = { x: item.offsetLeft, y: item.offsetTop, width: item.offsetWidth, height: item.offsetHeight, autoAlpha: 1 };
    if (glide && live && placed.current) gsap.to(el, { ...to, duration: DUR.enter, ease: EASE.snap, overwrite: true });
    else gsap.set(el, { ...to, overwrite: true });
    placed.current = true;
  };
  const last = useRef(active);
  useIsoLayoutEffect(() => {
    place.current(last.current !== active);
    last.current = active;
  }, [active, live, layoutKey]);
  useEffect(() => {
    const node = root.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => place.current(!!indicator.current && gsap.isTweening(indicator.current)));
    ro.observe(node);
    for (const child of Array.from(node.children)) ro.observe(child);
    return () => ro.disconnect();
  }, [root, indicator, layoutKey]);
}

export { gsap };
