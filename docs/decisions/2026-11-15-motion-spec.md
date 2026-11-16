# Sanctum motion spec (GSAP)

**Status:** Proposal. Nothing is installed or built yet. The decision log (2026-11-15) lists GSAP as "the candidate, not added yet". Adding it needs your yes (see "Needs approval" at the end).
**Scope:** the main app (Tauri v2, WebView2/Chromium, React 19, Tailwind 4) and the intercept window. The extension and the partner site are out of scope.
**Sources:** `docs/decisions/2026-11-15-second-colour-and-headlines.md`, `SPEC.md` 4.0.2 and Voice, `src/styles.css`, `src/components/Mesh.tsx`, `src/components/AnimatedMark.tsx`, `src/lib/motion.tsx`, `src/theme/extra.json`, the gate-canvas prototypes (ProtoToday, Main, Held, HeldBroken, Intercept, Checkin), and the impeccable `animate.md` / `craft-floor.md` and GSAP skill references.

---

## 0. Motion thesis

Sanctum is an **Operate + Read** surface. Routine motion stays quick and never makes anyone wait. The app is serious and declarative, so its motion is too: things **settle, seat, fill and drain**. Nothing bounces, wobbles or shakes, and nothing celebrates loudly.

- **Focal moment:** the **held build** (torii assembles, the keyhole seats, two second-colour rings settle, the chime lands, the room blooms). It is the one sequence the app has fully earned. The **goal reached** moment on Today is its quieter sibling and uses the same vocabulary: a second-colour tick and a glow.
- **Continuity:** Open to Sealed on Today (the Enter focus fill becomes the seal line), the needle and fill on the day ruler, the sidebar indicator between screens, rows sinking when ticked, folds.
- **Feedback:** the minute roll, a crossed major tick, a ticked box, a saved tracker entry, the intercept countdown.
- **Budget:** two ambient loops (the aurora, the held mesh drift) plus the keyhole breathe. All three are CSS on the compositor and pause when the window is hidden. GSAP only runs **bursts**, which are timelines that end. There is no infinite GSAP tween anywhere, so the GSAP ticker has nothing to do while the app is idle.

**Material.** The app's own material is **the ruler**: ticks, a needle, an accent fill and second-colour goal marks. Motion stays on it. The needle glides, the fill extends, ticks light up, and digits roll like a mechanical counter. Glow appears only at completion, which the brief decides ("Completion is the only thing that glows"). Craft-floor normally treats a zero-offset colored halo as decoration, but the pinned brief overrides it here, and only here.

**Rules carried through every moment:**
1. Motion explains a change. If removing an animation loses no meaning, remove it.
2. One timeline per moment, built in one place, with labels. Do not scatter separate CSS delays.
3. No page-wide fade-and-rise. The current `page-in`, `row-in` and the `useStateFade` blur-fade in AppShell are retired (§8, §3).
4. Exits run faster than entrances. Input is never blocked. Every control is live from the first frame.
5. Default DOM state is the **final** state. GSAP animates *from* something. If GSAP fails to load, the app still renders correctly.
6. Reduced motion means the same timeline jumped to its end (`tl.progress(1)`). Opacity and colour changes that carry meaning may stay. Spatial motion goes.

---

## 1. GSAP setup for this codebase

### 1.1 Packages and plugins

| Package | Why |
|---|---|
| `gsap` | Core, timelines, `quickTo`, `matchMedia`, utils. Every plugin ships in this package for free (no Club token, no `.npmrc`). |
| `@gsap/react` | `useGSAP()` gives context-scoped selectors, automatic revert on unmount, and `contextSafe`. |

| Plugin | Use it? | Where |
|---|---|---|
| **CustomEase** | **Yes** | Registers the token eases (`ui`, `glide`, `settle`, `seat`, `exit`) from `extra.json`, so CSS and GSAP share exact curves. |
| **Flip** | **Yes** | Enter focus (the button fill becomes the seal line), rows sinking when ticked, the sidebar indicator. It replaces `motion`'s `layout="position"` in `Glide`. |
| SplitText | **No** | The odometer needs a 0–9 **strip per digit column**, not split characters. SplitText would split "1h 18m" into chars that still cannot roll. Geist Mono with `tabular-nums` already gives fixed-width columns. The headlines are single plain sentences (new rule), so there is no per-word reveal to justify it either. |
| DrawSVG | No | The check mark draws with a CSS `stroke-dashoffset` transition. Nothing else draws strokes. |
| MorphSVG, MotionPath, ScrollTrigger, Observer, Draggable | No | No use case here. Do not register them. |
| GSDevTools | Dev only | Optional, behind `import.meta.env.DEV`. Never ship it. |

**Existing `motion` (Framer Motion) dependency.** `src/lib/motion.tsx` uses it for `Glide` (layout reorder) and `useRolling` (number tween), and `AppShell` wraps the app in `MotionConfig`. Two animation engines is debt. Plan: replace `Glide` with a Flip-based `useFlipList` (§10.1) and `useRolling` with `<Odometer>` (§1.5), then remove `motion` and `MotionConfig`. This happens in the same rollout step that adds GSAP.

### 1.2 Token set

The live motion tokens are **in `src/theme/extra.json` → `motion`**, not in `design/tokens.css`. `tokens.css` has no motion values. `src/theme/tokens.ts` maps them into Tailwind's `transitionDuration` / `transitionTimingFunction`, which is where `duration-ui`, `duration-enter` and `ease-ui` come from. Extend that same block, so Tailwind classes, CSS keyframes and GSAP all read one source. Promote it into `design/tokens.json` when the design files are next updated, as the `_note` in `extra.json` already asks.

```jsonc
// src/theme/extra.json → "motion"
"motion": {
  "duration": {
    "ui":      "120ms",   // existing: hover, press, colour changes, immediate feedback
    "enter":   "180ms",   // existing: dialogs, toasts, small arrivals
    "state":   "240ms",   // routine state change: tick → row sinks, fold, indicator glide
    "glide":   "400ms",   // the needle and fill, one minute per tick (decided "about 400 ms")
    "moment":  "700ms",   // authored beats inside a focal timeline (rings, rise, aurora strength)
    "drain":   "1200ms",  // slow colour drains and glows settling (kept glow, broken seal)
    "breathe": "3200ms"   // the sealed keyhole loop (existing mark-breathe)
  },
  "easing": {
    "ui":     "cubic-bezier(0.2, 0, 0, 1)",     // existing ease-ui: crisp decel for UI
    "glide":  "cubic-bezier(0.2, 0.7, 0.2, 1)", // prototype EASE + held-rise: soft arrival, the needle
    "settle": "cubic-bezier(0.2, 0.8, 0.2, 1)", // held beam/nuki/legs: firm, no overshoot
    "seat":   "cubic-bezier(0.3, 1.4, 0.5, 1)", // the keyhole drop ONLY (decided mark motion); the one overshoot in the app
    "exit":   "cubic-bezier(0.4, 0, 1, 1)",     // leaving: accelerates away, always shorter than its entrance
    "drift":  "cubic-bezier(0.37, 0, 0.63, 1)"  // sine in-out: aurora and mesh loops
  }
}
```

The held page's leg curve `(0.3, 0.8, 0.2, 1)` folds into `settle`. The two curves are visually identical at 0.5 s, and one fewer token is better.

Tailwind picks up `duration-state`, `ease-glide` and the rest automatically. CSS keyframes refer to `theme(transitionTimingFunction.glide)` or the custom properties, never to raw beziers.

### 1.3 `src/lib/gsap.ts` (the only place GSAP is imported from)

```ts
import gsap from "gsap";
import { Flip } from "gsap/Flip";
import { CustomEase } from "gsap/CustomEase";
import { useGSAP } from "@gsap/react";
import extra from "../theme/extra.json";

gsap.registerPlugin(useGSAP, Flip, CustomEase);

type DurKey = keyof typeof extra.motion.duration;
type EaseKey = keyof typeof extra.motion.easing;

/** Seconds, from the same tokens Tailwind uses (duration-ui = DUR.ui * 1000 ms). */
export const DUR = Object.fromEntries(
  Object.entries(extra.motion.duration).map(([k, v]) => [k, parseFloat(v) / 1000]),
) as Record<DurKey, number>;

// Each cubic-bezier token becomes a named GSAP ease: ease: "glide".
for (const [name, css] of Object.entries(extra.motion.easing)) {
  const m = /cubic-bezier\(([^)]+)\)/.exec(css);
  if (m) CustomEase.create(name, m[1]);
}
export const EASE = Object.fromEntries(Object.keys(extra.motion.easing).map((k) => [k, k])) as Record<EaseKey, string>;

gsap.defaults({ duration: DUR.enter, ease: EASE.ui, overwrite: "auto" });

export { gsap, Flip, useGSAP };
```

`overwrite: "auto"` by default handles interruptions: a minute tick that lands while the previous glide is still running takes over the `x` it shares instead of fighting it.

### 1.4 `useMotion`: one hook, two switches

Two things decide whether a moment animates: the user's reduced-motion setting and whether the window can be seen. `useWindowShown()` already exists in `Mesh.tsx`. Lift it into a tiny shared store, so the app attaches **one** set of Tauri listeners instead of one per component, then build on it:

```ts
// src/lib/useMotion.ts
import { useRef, useSyncExternalStore, type RefObject } from "react";
import { gsap, useGSAP } from "./gsap";
import { useWindowShown } from "../state/windowShown"; // lifted from Mesh.tsx

const QUERY = "(prefers-reduced-motion: reduce)";
function subscribe(cb: () => void) {
  const mq = window.matchMedia(QUERY);
  mq.addEventListener?.("change", cb);
  return () => mq.removeEventListener?.("change", cb);
}
export const useReducedMotion = () => useSyncExternalStore(subscribe, () => window.matchMedia(QUERY).matches, () => true);

/**
 * Moments call run(build): the timeline plays when motion is live, and jumps to its end
 * (callbacks included, so a chime still sounds) under reduced motion or a hidden window.
 * The end state is therefore identical on both paths, by construction.
 */
export function useMotion<T extends Element>(scope: RefObject<T | null>) {
  const reduced = useReducedMotion();
  const shown = useWindowShown();
  const live = !reduced && shown;
  const liveRef = useRef(live);
  liveRef.current = live;
  const { contextSafe } = useGSAP({ scope });

  const run = contextSafe((build: (o: { reduced: boolean }) => gsap.core.Timeline) => {
    const tl = build({ reduced: !liveRef.current });
    if (!liveRef.current) tl.progress(1); // fires .call()s; no spatial motion
    return tl;
  });

  return { live, reduced, shown, run, contextSafe };
}
```

Conventions every moment follows:
- **Scope.** Each moment's component passes its root ref. Selectors are `data-*` attributes (`[data-needle]`, `[data-part="leg"]`), never Tailwind classes, so restyling never breaks motion.
- **IDs.** Every moment timeline gets an `id` (`"held"`, `"enter-focus"`, `"goal"`). Tests can then use `gsap.getById()`.
- **clearProps.** Entrances that end at the CSS default use `clearProps: "transform,opacity,visibility"` on their last tween. CSS owns the element again, and no compositor layer is left behind.
- **No GSAP during render.** Only `useGSAP` bodies, `contextSafe` handlers and store subscriptions call GSAP.
- **The global reduced-motion rule in `styles.css`** (1 ms on every CSS animation and transition) does not touch GSAP inline tweens. That is why `useMotion` exists. Keep the CSS rule for the CSS side.

### 1.5 `<Odometer>`: the shared digit roll

This one component is used by the live minutes, the session's time left, the streak, tracker totals and the intercept countdown.

**Structure.** Split the formatted string (`"1h 18m"`) into tokens. Each digit becomes a column:

```html
<span data-odo class="relative inline-flex tabular-nums">
  <span class="sr-only">1h 18m</span>                      <!-- the real text for screen readers -->
  <span aria-hidden="true" class="inline-flex">
    <span data-col data-digit="1" class="odo-col"><span data-strip>0 1 2 … 9 0</span></span>
    <span>h</span><span>&nbsp;</span>
    <span data-col data-digit="1" class="odo-col">…</span>
    <span data-col data-digit="8" class="odo-col">…</span>
    <span>m</span>
  </span>
</span>
```

```css
.odo-col { display:inline-block; height:1em; line-height:1; overflow:clip;
           mask-image: linear-gradient(transparent, #000 22%, #000 78%, transparent); }
.odo-col [data-strip] { display:flex; flex-direction:column; }   /* 11 cells: 0..9 then 0 again */
```

The mask fades digits in and out at the column edges, like a counter seen through a window. This is the material choice (mask) that makes it read as a roll and not a fade.

**Rule.** Cell index `i` sits at `yPercent: -i * (100 / 11)`. Counting up from 8 to 9 moves the strip up one cell. Wrapping from 9 to 0 tweens to index 10 (the duplicate 0), then `set`s to index 0 on complete, so the wheel always turns forward. A countdown (`direction="down"`) reverses the strip order with the same code. Only columns whose digit changed roll. A carry (59 to 60, 109 to 110) rolls every changed column together, **rightmost first** with `stagger: { each: 0.04, from: "end" }`, the way a mechanical counter turns.

**Skeleton changes** (the column count or units change, as when "59m" becomes "1h"). This happens about once an hour. The whole figure rolls as one: the old figure moves `yPercent: -60, autoAlpha: 0` while the new one comes in from `yPercent: 60` (`DUR.state`, `glide`). The two figures stack in a grid cell, so the width changes once, in the same frame.

```tsx
export function Odometer({ text, direction = "up", delay = 0 }: { text: string; direction?: "up" | "down"; delay?: number }) {
  const root = useRef<HTMLSpanElement>(null);
  const prev = useRef(text);
  const { run } = useMotion(root);

  useGSAP(() => {
    const from = prev.current;
    prev.current = text;
    const plan = rollPlan(from, text, direction); // pure: [{ col, fromIndex, toIndex, wrapTo? }] or { skeleton: true }
    if (plan.length === 0) return;
    run(() => {
      const tl = gsap.timeline({ id: "odometer", delay, defaults: { duration: DUR.glide, ease: EASE.glide } });
      plan.forEach((p, k) => {
        const strip = root.current!.querySelector(`[data-col="${p.col}"] [data-strip]`)!;
        gsap.set(strip, { yPercent: -p.fromIndex * (100 / 11) });
        tl.to(strip, {
          yPercent: -p.toIndex * (100 / 11),
          onComplete: p.wrapTo != null ? () => gsap.set(strip, { yPercent: -p.wrapTo! * (100 / 11) }) : undefined,
        }, (plan.length - 1 - k) * 0.04); // rightmost first
      });
      return tl;
    });
  }, { scope: root, dependencies: [text] });
  // render as above, keyed by skeleton so a skeleton change swaps the stacked figures
}
```

`rollPlan` is pure and gets unit tests (§11.3). Under reduced motion `run` jumps to the end, so the strip simply shows the new digit.

---

## 2. Moment 1: Live minutes while sealed

**Purpose.** Each focused minute moves the day forward on the ruler. The needle's glide says "time spent here counts". The roll says "the number went up by one". A crossed major tick marks a half hour passed. All of it happens only while Today is on screen (decided).

**Choreography** (once per completed minute, starting from the store's minute change):

| t (s) | Target | Tween | Dur | Ease |
|---|---|---|---|---|
| 0.00 | `[data-needle]` | `x` → new position | glide 0.40 | glide |
| 0.00 | `[data-fill]` (origin left) | `scaleX` → `m / span` | 0.40 | glide |
| 0.00 | needle label `[data-needle-label]` | `x` → new position (same `quickTo` as the needle) | 0.40 | glide |
| 0.00 | minutes figure | `<Odometer>` rolls the changed columns, rightmost first, 0.04 each | 0.40 | glide |
| 0.28 | crossed major tick `[data-tick-glow="90"]` | `opacity` 0 → 1 | 0.12 | none |
| 0.40 | same | `opacity` 1 → 0 | 0.60 | power2.out |
| 0.00 | "left" figure | `<Odometer direction="down">` | 0.40 | glide |
| once | label side flip (needle past 72%) | label `xPercent` 0 → -100 | state 0.24 | ui |

The tick lights at 0.28 s, just before the needle arrives at about 0.7 of the glide. It reads as the needle *reaching* the tick, not the tick reacting late. The prototype's `filter: brightness` + `box-shadow` flash becomes an opacity-only glow child: a 1 px span in `second` with a pre-rendered soft shadow, which is painted once and only fades.

**Span change** (at more than 170 minutes the ruler rescales from 3 h to 4 h): one Flip over the ticks and labels (`Flip.getState("[data-tick],[data-ruler-label]")` → re-render → `Flip.from(state, { duration: DUR.moment, ease: EASE.glide })`). It is rare, and it explains why every tick moved.

**GSAP implementation**

```tsx
function DayRuler({ minutes, goal, span }: { minutes: number; goal: number; span: number }) {
  const root = useRef<HTMLDivElement>(null);
  const width = useRef(0);
  const prev = useRef(minutes);
  const q = useRef<Record<"needle" | "label" | "fill", gsap.QuickToFunc> | null>(null);
  const { live, contextSafe } = useMotion(root);

  // Build the quickTo setters once, and measure the ruler only when it resizes (one read, then writes).
  useGSAP(() => {
    q.current = {
      needle: gsap.quickTo("[data-needle]", "x", { duration: DUR.glide, ease: EASE.glide }),
      label:  gsap.quickTo("[data-needle-label]", "x", { duration: DUR.glide, ease: EASE.glide }),
      fill:   gsap.quickTo("[data-fill]", "scaleX", { duration: DUR.glide, ease: EASE.glide }),
    };
    const onResize = contextSafe(([e]: ResizeObserverEntry[]) => {
      width.current = e.contentRect.width;
      place(prev.current, false); // snap, never animate a resize
    });
    const ro = new ResizeObserver(onResize);
    ro.observe(root.current!);
    return () => ro.disconnect();
  }, { scope: root });

  const place = (m: number, animate: boolean) => {
    const x = (Math.min(m, span) / span) * width.current;
    if (!animate) return gsap.set("[data-needle],[data-needle-label]", { x }), gsap.set("[data-fill]", { scaleX: m / span });
    q.current!.needle(x); q.current!.label(x); q.current!.fill(Math.min(1, m / span));
  };

  useGSAP(() => {
    const step = minutes === prev.current + 1;  // a real tick, not a jump (load, resume, day change)
    const crossed = majorCrossed(prev.current, minutes, goal); // 30, 60, ... excluding the goal tick
    prev.current = minutes;
    place(minutes, live && step);
    if (live && step && crossed != null) {
      gsap.timeline({ id: "tick-cross" })
        .fromTo(`[data-tick-glow="${crossed}"]`, { opacity: 0 }, { opacity: 1, duration: 0.12, ease: "none" }, DUR.glide * 0.7)
        .to(`[data-tick-glow="${crossed}"]`, { opacity: 0, duration: 0.6, ease: "power2.out" });
    }
  }, { scope: root, dependencies: [minutes, span, live] });

  // ...ticks, fill (origin left), needle, label with <Odometer text={fmt(minutes)} />
}
```

Positioning is transform-only. Needle, label and fill sit at `left: 0` and move with `x` / `scaleX`. The prototype's `transition: left / width` (layout on every tick) is gone.

**Reduced motion.** As decided, values update without motion: `place(m, false)`, the Odometer jumps, and no tick glow. The aria label on the ruler (`"42 minutes focused of a 2 hour goal, 1 hour 18 minutes left"`) updates as before.

**Performance.** One `quickTo` call per minute on three already-promoted elements, and one 0.7 s glow on a 1 px element. Width is read only in the ResizeObserver, never per tick, so nothing can thrash. While the window is hidden, `live` is false and ticks `set` the final values. Nothing queues up to play when the window comes back. `will-change: transform` goes on the needle, label and fill only (they move every minute while sealed). Tick glows get none.

---

## 3. Moment 3: Entering focus (Open to Sealed)

(Numbered after live minutes because it hands over to them.)

**Purpose.** The commitment. The focus card stays in place, and **the Enter focus button's accent fill collapses into a thin accent line along the card's bottom edge.** That line is the seal, and the session bar fills along it. Around it the room deepens (aurora strengthens), the tools step aside, and the keyhole starts to breathe. The user sees that what they pressed has become the seal around the work.

**Trigger.** The moment is driven by **state, not the click**. Ctrl Enter, the tray, a scheduled focus and a resumed session all reach `appState: "sealed"` through the store. A Zustand `subscribe` runs synchronously inside `set()`, **before React commits**, so it can capture the old layout with `Flip.getState` whatever started the session. A session resumed at launch, where there was no Open state, skips the moment.

**Choreography** (`id: "enter-focus"`, about 1.0 s, controls live from 0 s)

| Label / t | Target | Tween | Dur | Ease |
|---|---|---|---|---|
| `seal` 0.00 | `[data-flip-id="seal"]` (button fill → bottom line) | `Flip.from` (position + scale) | 0.38 | settle |
| 0.00 | search + Customize `[data-tools]` | `autoAlpha` → 0 | ui 0.12 | exit |
| 0.00 | aurora strength (CSS, §9) | opacity → sealed level | drain 1.2 | drift |
| 0.08 | sealed cells `[data-cell]` (Profile, Time left, Sealed + Stop) | `opacity` 0 → 1, `stagger 0.04` | state 0.24 | ui |
| 0.12 | time left `<Odometer>` | strip rolls from blank to digits, left to right | glide 0.40 | glide |
| 0.10 | headline | `opacity` 0.4 → 1 (text swaps to "Nothing else right now. Just this.") | 0.24 | ui |
| `line` 0.38 | seal line | holds full accent for 0.2 s, then `opacity` → 0, showing the real track and fill under it | 0.40 | ui |
| 0.30 | card border | CSS `transition: border-color` to `sealed/55` | 0.40 | ui |
| `breathe` 1.00 | sidebar keyhole | `.mark-breathe` with `animation-delay: 1s` (CSS loop) | 3.2 loop | drift |

The sealed cells **crossfade in place**. They occupy the same grid slots as the open cells, so nothing slides and the eye stays on the seal line. The enter sound (220 Hz swell) is unchanged. Its swell and the aurora's 1.2 s strengthen share a start.

**GSAP implementation** (in the Today page)

```tsx
const root = useRef<HTMLDivElement>(null);
const sealState = useRef<Flip.FlipState | null>(null);
const { run } = useMotion(root);
const appState = useStore((s) => s.appState);

// Capture before React swaps the open card for the sealed one, whatever entered focus.
useEffect(() => useStore.subscribe((s, p) => {
  if (p.appState === "open" && s.appState === "sealed" && root.current) {
    sealState.current = Flip.getState(root.current.querySelectorAll("[data-flip-id]"));
  }
}), []);

useGSAP(() => {
  const state = sealState.current;
  sealState.current = null;
  if (appState !== "sealed" || !state) return;     // resumed session: no moment
  run(() => {
    const tl = gsap.timeline({ id: "enter-focus" });
    tl.addLabel("seal", 0)
      .add(Flip.from(state, { targets: "[data-flip-id='seal']", duration: 0.38, ease: EASE.settle }), "seal")
      .to("[data-tools]", { autoAlpha: 0, duration: DUR.ui, ease: EASE.exit }, "seal")
      .from("[data-cell]", { opacity: 0, duration: DUR.state, stagger: 0.04, clearProps: "opacity" }, 0.08)
      .from("[data-headline]", { opacity: 0.4, duration: DUR.state, clearProps: "opacity" }, 0.1)
      .addLabel("line", 0.38)
      .to("[data-flip-id='seal']", { autoAlpha: 0, duration: 0.4, ease: EASE.ui }, "line+=0.2");
    return tl;
  });
}, { scope: root, dependencies: [appState] });
```

Markup: the Enter focus button has an inner `<span data-flip-id="seal" class="absolute inset-0 rounded-control bg-sealed">` as its fill. The sealed card has `<span data-flip-id="seal" class="absolute inset-x-0 bottom-0 h-[2px] bg-sealed">` above its 2 px session track. Flip matches the two by id.

**Leaving (Stop, End early).** Exits are faster and use no Flip. The tools return (`autoAlpha` 1, 0.12 s), the open cells crossfade in (0.12 s), and the aurora relaxes through its CSS transition. If Stop is pressed mid-moment, `gsap.getById("enter-focus")?.progress(1)` runs first, so nothing is left half-way.

**Retire.** Remove `useStateFade` in AppShell (the page-wide 520 ms opacity + translate + blur on every state change). This moment replaces it, and the other states change colour through CSS.

**Reduced motion.** The timeline jumps to its end: sealed card, tools hidden, seal line gone. The keyhole does not breathe (existing rule). The aurora holds still at sealed strength.

**Performance.** Flip reads two rects (in the subscription, before the DOM changes, and once after the commit), then writes transforms only. There is one 2 px element, a few opacity tweens, and one CSS opacity transition on the aurora. The breathe is a CSS loop on a 20 px SVG group, paused when hidden (§9).

---

## 4. Moment 2: Goal reached

**Purpose.** The day is kept. This is the app's main celebration, and it stays calm. The goal tick lights in the second colour, today's cell in the days strip turns kept with its glow, and the streak counts up by one. **Completion is the only thing that glows** (decided). There is no confetti, no scale pop, no colour flash on the page, and no sound (the sound cue list has none for this moment, and the held chime belongs to the held page).

**Trigger.** `met` turns from false to true **while Today is mounted and shown**. If it happens with the window hidden or another screen open, Today renders the kept state directly with nothing replayed. A late celebration would be stale.

**Choreography** (`id: "goal"`, about 2.1 s, appended after the minute's needle glide)

| Label / t | Target | Tween | Dur | Ease |
|---|---|---|---|---|
| 0.00 | needle, fill, digits | the final minute (§2) | 0.40 | glide |
| `flare` 0.30 | goal tick glow `[data-goal-glow]` | `opacity` 0 → 1 | 0.35 | power2.out |
| 0.65 | same | `opacity` 1 → 0.55 (the resting met-glow from the prototype) | drain 1.2 | drift |
| 0.30 | goal label suffix " · kept" | `clipPath: inset(0 100% 0 0)` → `inset(0 0% 0 0)` | state 0.24 | ui |
| 0.40 | headline → "Goal met. Go again, or go rest." | `opacity` 0.4 → 1 | 0.24 | ui |
| `kept` 0.55 | today's cell: kept layer `[data-cell-kept]` (second colour) over the accent fill | `autoAlpha` 0 → 1 | moment 0.70 | drift |
| 0.55 | today's cell glow `[data-cell-glow]` | `opacity` 0 → 1 | drain 1.2 | drift |
| 0.55 | "Focus today" strip goal mark glow | `opacity` 0 → 1 | 1.2 | drift |
| `streak` 0.95 | streak `<Odometer delay={0.95}>` | one column rolls up | glide 0.40 | glide |

The order follows cause and effect: ruler, then goal tick, then the day turns kept, then the streak grows. The glows rise slowly and settle at their resting strength, without pulsing in and out. The prototype's `goal-pulse` keyframe reaches a peak and falls to zero, which reads as an alert. Here the glow peaks once at 0.35 s and **settles to its resting value**, so it says "this is now kept", not "look at this".

**GSAP implementation** (Today page scope: the top bar, ruler and footer strip all live inside Today)

```tsx
const wasMet = useRef(met);
useGSAP(() => {
  const justKept = met && !wasMet.current;
  wasMet.current = met;
  if (!justKept) return;
  run(() => gsap.timeline({ id: "goal", defaults: { ease: EASE.drift } })
    .addLabel("flare", 0.3)
    .fromTo("[data-goal-glow]", { opacity: 0 }, { opacity: 1, duration: 0.35, ease: "power2.out" }, "flare")
    .to("[data-goal-glow]", { opacity: 0.55, duration: DUR.drain }, ">")
    .fromTo("[data-goal-suffix]", { clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0% 0 0)", duration: DUR.state, ease: EASE.ui }, "flare")
    .addLabel("kept", 0.55)
    .fromTo("[data-today-cell] [data-cell-kept]", { autoAlpha: 0 }, { autoAlpha: 1, duration: DUR.moment }, "kept")
    .fromTo("[data-today-cell] [data-cell-glow], [data-strip-goal-glow]", { opacity: 0 }, { opacity: 1, duration: DUR.drain }, "kept"));
}, { scope: root, dependencies: [met] });
// <Odometer text={String(streak)} delay={justKept ? 0.95 : 0} /> in the streak chip
```

The glows are **separate child layers** (a span with the glow pre-rendered as a static `box-shadow`, or a radial-gradient), and only their opacity animates. Animating `box-shadow` repaints every frame. The 6×12 px cell in the days strip keeps its accent fill underneath, so the crossfade reads as "in progress becomes kept".

**Reduced motion.** Per the brief, the pulse is skipped and values update without motion. The timeline jumps to its end: glow at 0.55, kept layer on, suffix shown, streak changed. A 150 ms opacity crossfade on the kept cell is allowed (colour carries meaning, nothing moves), but it is optional, and instant also matches the brief.

**Performance.** Five opacity tweens, one clip-path on a short label, and one odometer column. Glow layers are static paint. The ruler's goal glow sits on its own small layer (`will-change: opacity` for the duration only, through `onStart` / `onComplete`).

---

## 5. Moment 4: The held build (one GSAP timeline)

**Purpose.** The focal moment. The session held: the gate assembles, the keyhole seats, two second-colour rings settle around it as the chime lands, and the room blooms in the theme's colours. It replaces the current spread of CSS delays (`held-leg`, `-leg-2`, `-beam`, `-nuki`, `-key`, `-ring`, `-ring-2`, `held-r1..3`, and `play("held", 1.2)` timed separately) with **one timeline that owns sound and motion on one clock**. Replay becomes `tl.restart()` instead of remounting the content with `key={run}`.

**Change from today.** The rings no longer pulse out and vanish (scale 0.4 → 2.6, fade to 0). They **expand from the keyhole and come to rest** at the radii and opacities in `Held.dc.html` (r 5.2 at 0.55 and r 7.6 at 0.25, in `second`). The motion ends on the designed still frame.

**Choreography** (`id: "held"`, about 2.6 s, SPEC "~2.9 s" budget)

| Label / t | Target | Tween | Dur | Ease |
|---|---|---|---|---|
| `bloom` 0.00 | mesh wrapper `[data-mesh-bloom]` | `autoAlpha` 0 → 1, `scale` 0.92 → 1 | 1.6 | drift |
| `build` 0.00 | left leg `[data-part="leg"]` (origin bottom) | `scaleY` 0 → 1 | 0.50 | settle |
| 0.08 | right leg | `scaleY` 0 → 1 | 0.50 | settle |
| 0.35 | beam | `autoAlpha` 0 → 1, `y` -4 → 0, `scaleX` 0.6 → 1 | 0.50 | settle |
| 0.60 | nuki (crossbar) | `scaleX` 0 → 1 | 0.40 | settle |
| `key` 0.95 | keyhole group | `autoAlpha` 0 → 1, `y` -5 → 0, `scale` 0.7 → 1 | 0.50 | **seat** (the only overshoot) |
| `rings` 1.20 | `tl.call(play, ["held"])` | the chime | | |
| 1.20 | inner ring | `attr: { r: 2.6 → 5.2 }`, `opacity` 0 → 0.55 | 1.10 | glide |
| 1.35 | outer ring | `attr: { r: 2.6 → 7.6 }`, `opacity` 0 → 0.25 | 1.10 | glide |
| `rise` 1.30 | `[data-rise="1"]` (eyebrow, "Sanctum held.", streak line) | `autoAlpha` 0 → 1, `y` 10 → 0 | moment 0.70 | glide |
| 1.45 | `[data-rise="2"]` (stats row) | same | 0.70 | glide |
| 1.60 | `[data-rise="3"]` (task, how-it-went, break, actions) | same, `stagger: 0.05` (max 4 × 0.05) | 0.70 | glide |

The rise is the **one** staggered entrance in the app. It is earned because the held page arrives as a list of results, under a cap of three groups. The distance drops from 14 px to 10 px, so it settles rather than flies.

**GSAP implementation**

```tsx
export function buildHeld(tl: gsap.core.Timeline, { broken }: { broken: boolean }) {
  tl.addLabel("bloom", 0)
    .fromTo("[data-mesh-bloom]", { autoAlpha: 0, scale: 0.92 }, { autoAlpha: 1, scale: 1, duration: 1.6, ease: EASE.drift, clearProps: "transform" }, "bloom")
    .addLabel("build", 0)
    .from("[data-part='leg']", { scaleY: 0, transformOrigin: "50% 100%", duration: 0.5, ease: EASE.settle, stagger: 0.08 }, "build")
    .from("[data-part='beam']", { autoAlpha: 0, y: -4, scaleX: 0.6, transformOrigin: "50% 50%", duration: 0.5, ease: EASE.settle }, 0.35)
    .from("[data-part='nuki']", { scaleX: 0, transformOrigin: "50% 50%", duration: 0.4, ease: EASE.settle }, 0.6)
    .addLabel("key", 0.95)
    .from("[data-part='key']", { autoAlpha: 0, y: -5, scale: 0.7, transformOrigin: "50% 50%", duration: 0.5, ease: EASE.seat }, "key");

  if (!broken) {
    tl.addLabel("rings", 1.2)
      .call(() => play("held"), [], "rings")
      .fromTo("[data-ring='1']", { attr: { r: 2.6 }, opacity: 0 }, { attr: { r: 5.2 }, opacity: 0.55, duration: 1.1, ease: EASE.glide }, "rings")
      .fromTo("[data-ring='2']", { attr: { r: 2.6 }, opacity: 0 }, { attr: { r: 7.6 }, opacity: 0.25, duration: 1.1, ease: EASE.glide }, "rings+=0.15");
  }
  tl.addLabel("rise", 1.3);
  ([1, 2, 3] as const).forEach((n, i) =>
    tl.from(`[data-rise='${n}']`, { autoAlpha: 0, y: 10, duration: DUR.moment, ease: EASE.glide, stagger: n === 3 ? 0.05 : 0, clearProps: "transform,opacity,visibility" }, `rise+=${i * 0.15}`));
  return tl;
}

export function HeldPage() {
  const root = useRef<HTMLDivElement>(null);
  const tlRef = useRef<gsap.core.Timeline | null>(null);
  const { run, contextSafe } = useMotion(root);

  useGSAP(() => {
    tlRef.current = run(({ reduced }) => buildHeld(gsap.timeline({ id: "held" }), { broken: held.broken }));
  }, { scope: root, dependencies: [held.id] });

  const replay = contextSafe(() => tlRef.current?.restart()); // no remount, no lost form input
  // ...
}
```

`AnimatedMark` drops its CSS build classes and gets `data-part` attributes (`leg`, `beam`, `nuki`, `key`) plus optional `data-ring` circles in `text-second`. The path data stays verbatim; the mark is never redrawn, and the existing test keeps guarding it. The boot splash uses the same `buildHeld` build segment (up to `key`) through its own short timeline, so the mark has one build everywhere.

**Reduced motion.** `run` jumps to the end. The final frame is the Held.dc still (gate, keyhole, rings at rest, all text visible), the mesh is static (CSS rule), and the chime still plays once, because sound is a separate setting and `progress(1)` fires `.call()`.

**Performance.** Every tween is transform, opacity or two SVG `r` attributes on a 96 px icon. The bloom scales one full-window wrapper of blurred blobs for 1.6 s. The wrapper is composited and its content is not re-rasterised. Its transform is cleared at the end, which drops the layer. The mesh's own drift stays CSS (§9). The `rise` elements clear their props, so no layer outlives the moment.

---

## 6. Moment 5: The broken seal

**Purpose.** It must look different from a kept session (a listed design gap: "A broken seal looks the same as a kept one"). It must stay plain and never alarming. The same gate builds, because the session still happened and its minutes count. The keyhole seats in the accent and then **the colour drains out of it and out of the room**. There are no rings, no shake, no red, and no blur.

**Choreography** (`id: "held"` with `broken: true`, about 2.8 s)

| Label / t | Target | Tween | Dur | Ease |
|---|---|---|---|---|
| 0 – 1.45 | build + key, as in §5 | same | | |
| `drain` 1.45 | `tl.call(play, ["broken"])` (two notes falling a minor third) | | | |
| 1.45 | keyhole group | `color` sealed → muted (fills are `currentColor`), `opacity` 1 → 0.55 | drain 1.2 | power1.inOut |
| 0.60 | held-colour mesh layer `[data-mesh="held"]` | `autoAlpha` 1 → 0, showing the drained layer under it | 1.6 | drift |
| 1.45 → 3.45 | mesh drift speed | CSS animations' `playbackRate` 1 → 0.33 (ambient speed, as in HeldBroken.dc) | 2.0 | power1.out |
| `rise` 1.30 | text groups | as §5 ("Seal broken." headline, "23m" with its second-colour dot) | 0.70 | glide |

The broken sound moves from the keyhole landing to the **drain**: the falling notes play while the colour leaves, so sound and image say the same thing.

**GSAP implementation** (an extension of `buildHeld`)

```ts
if (broken) {
  const anims = () => root.querySelectorAll<HTMLElement>("[data-mesh] [data-blob]").values()
    .flatMap((el) => el.getAnimations()).toArray();            // the CSS drift animations
  const rate = { v: 1 };
  tl.addLabel("drain", 1.45)
    .call(() => play("broken"), [], "drain")
    .to("[data-part='key']", { color: "var(--color-muted)", opacity: 0.55, duration: DUR.drain, ease: "power1.inOut" }, "drain")
    .to("[data-mesh='held']", { autoAlpha: 0, duration: 1.6, ease: EASE.drift }, 0.6)
    .to(rate, { v: 0.33, duration: 2, ease: "power1.out", onUpdate: () => anims().forEach((a) => (a.playbackRate = rate.v)) }, "drain");
}
```

Setting `playbackRate` on a running Web Animation keeps its current time, so the drift slows down without jumping. This is the one place GSAP drives a CSS loop, and only for 2 s.

**Mesh layers.** The broken page renders two held meshes stacked: the **drained** palette (HeldBroken.dc: accent → muted, second colour faint, neutral, trace of accent) underneath and the **held** palette on top. The top layer fades out. Once it is at `autoAlpha: 0` it is `visibility: hidden` and not painted, and it unmounts after the timeline completes. *Cheaper fallback, if two blurred layers measure badly on an integrated GPU:* one full-window veil with `mix-blend-mode: saturation` fading to about 0.85. That desaturates the whole mesh in one layer, at the cost of the mock's selective warmth.

**Reduced motion.** The end state: muted keyhole at 0.55, drained mesh, no drift, broken sound played once.

**Performance.** For 1.6 s, two sets of four blurred blobs composite together, which is the heaviest frame budget in the app. Keep it short, keep the blobs on `radial-gradient` instead of `filter: blur` (§9), and unmount the held layer afterwards.

---

## 7. Moment 6: The intercept card

**Purpose.** Something sealed was just stopped. The card **catches** the launch: it appears in place with no slide, because there is no place it came from. Its top-edge ruler fills to "now", showing how far into the seal you are. The return countdown ticks down like a counter. Then the card gets out of the way.

**Choreography** (`id: "intercept"`, separate window, 480×320)

| Label / t | Target | Tween | Dur | Ease |
|---|---|---|---|---|
| `in` 0.00 | card `[role=alertdialog]` | `autoAlpha` 0 → 1, `scale` 0.98 → 1 (origin center) | enter 0.18 | ui |
| 0.00 | `play("blocked")` muted tick | | | |
| `ruler` 0.12 | fill `[data-ic-fill]` (origin left) | `scaleX` 0 → elapsed / length | glide 0.40 | glide |
| 0.12 | needle `[data-ic-needle]` | `x` 0 → elapsed / length × width | 0.40 | glide |
| as passed | each major tick `[data-ic-glow]` ≤ elapsed | `opacity` 0 → 1 when the needle passes it | 0.20 | ui |
| every 1 s | "Returning in" `<Odometer direction="down">` | one column rolls **down** | state 0.24 | ui |
| `out` (Enter, Back, or 0 s) | card | `autoAlpha` → 0, `scale` → 0.99 | ui 0.12 | exit |

Tick glows light up **as the needle reaches them**. An `onUpdate` on the needle tween compares its progress with the three or four major tick positions. That is cheap, and it stays correct under any ease. The `"42:14 to go"` figure is static (a snapshot of the payload) and does not roll.

**GSAP implementation**

```tsx
export function SealedAppCard({ p, onBack, onBreak }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const { run, contextSafe } = useMotion(root);
  const ratio = Math.min(1, p.elapsedMs / (p.elapsedMs + p.remainingMs));

  useGSAP(() => {
    run(() => {
      const w = root.current!.querySelector<HTMLElement>("[data-ic-ruler]")!.offsetWidth; // one read
      const glows = gsap.utils.toArray<HTMLElement>("[data-ic-glow]").filter((g) => Number(g.dataset.at) <= ratio);
      const lit = new Set<HTMLElement>();
      const tl = gsap.timeline({ id: "intercept" });
      tl.fromTo("[role=alertdialog]", { autoAlpha: 0, scale: 0.98 }, { autoAlpha: 1, scale: 1, duration: DUR.enter, ease: EASE.ui, clearProps: "transform" })
        .call(() => play("blocked"), [], 0)
        .addLabel("ruler", 0.12)
        .fromTo("[data-ic-fill]", { scaleX: 0 }, { scaleX: ratio, duration: DUR.glide, ease: EASE.glide }, "ruler")
        .fromTo("[data-ic-needle]", { x: 0 }, {
          x: ratio * w, duration: DUR.glide, ease: EASE.glide,
          onUpdate() {
            const at = (gsap.getProperty(this.targets()[0], "x") as number) / w;
            for (const g of glows) if (!lit.has(g) && at >= Number(g.dataset.at)) { lit.add(g); gsap.to(g, { opacity: 1, duration: 0.2 }); }
          },
        }, "ruler");
      return tl;
    });
  }, { scope: root, dependencies: [p] });

  const leave = contextSafe((then: () => void) =>
    gsap.to("[role=alertdialog]", { autoAlpha: 0, scale: 0.99, duration: DUR.ui, ease: EASE.exit, onComplete: then }));
  // useAutoReturn(p, () => leave(onBack)); Break the seal → leave(onBreak)
}
```

`animate-rise-in` (translateY 6 px) on the card is removed. The card should not travel.

**Reduced motion.** The card appears at full opacity, the fill and needle sit at their final place, and the ticks are lit. The countdown digits change without rolling. The exit is instant, and the window hides.

**Performance.** This is a transparent, always-on-top window, so animate the card only, never the window's size or position. The `shadow-dialog` stays static; never tween `box-shadow` here. The card's 0.98 → 1 scale stays inside the window bounds (the 480×320 clipping gap is a layout fix, separate from this). The window is short-lived, and `useGSAP` reverts everything when it unmounts.

---

## 8. Moment 7: Moving between screens (Today, Week, Stats, Trackers)

**Purpose.** Show where you went and keep the place steady. The **sidebar's active indicator glides** to the new item, and its icon takes the second colour (decided). The content area swaps almost at once. There is no fade-up and nothing slides in from below.

**Choreography**

| Target | Tween | Dur | Ease | Tool |
|---|---|---|---|---|
| active indicator `[data-nav-indicator]` (one element, absolutely positioned) | `y` → the new item's `offsetTop` | state 0.24 (exit-free: one move) | ui | GSAP `quickTo` |
| active icon colour | `color` → second colour | ui 0.12 | ui | CSS transition |
| page content `[data-page]` | `opacity` 0.6 → 1, **no transform** | ui 0.12 | ui | CSS keyframe `page-swap` |
| Week previous / next | week grid `x` ±16 → 0 in the travel direction, `opacity` 0.5 → 1 | state 0.24 | ui | CSS keyframes keyed by `data-dir` |
| locked tab click while sealed | nothing moves; the toast explains | | | |

Week previous / next is the one directional move, because the direction *is* the information (earlier or later). It is two static CSS keyframes, so it needs no GSAP.

**GSAP implementation** (sidebar)

```tsx
function NavIndicator({ activeIndex }: { activeIndex: number }) {
  const root = useRef<HTMLDivElement>(null);
  const yTo = useRef<gsap.QuickToFunc>();
  const { live } = useMotion(root);
  useGSAP(() => { yTo.current = gsap.quickTo("[data-nav-indicator]", "y", { duration: DUR.state, ease: EASE.ui }); }, { scope: root });
  useGSAP(() => {
    const item = root.current!.querySelectorAll<HTMLElement>("[data-nav-item]")[activeIndex];
    if (!item) return;
    const y = item.offsetTop;                       // read once per navigation
    live ? yTo.current!(y) : gsap.set("[data-nav-indicator]", { y });
  }, { scope: root, dependencies: [activeIndex, live] });
  // ...
}
```

It works for both the 220 px sidebar and the 60 px rail, because it reads `offsetTop` of the actual item. Ctrl 1–4 take the same path.

**Retire.** Delete `.page-in` (180 ms translateY 4 px + fade) from `AppShell`, `Setup` tabs, `StatsPage` tabs and the Week key, along with `.row-in` on Home and Week rows. Rows that appear because the user added them get the add feedback in §10. Rows that appear because a page rendered do not animate.

**Reduced motion.** The indicator jumps, and the content swaps with no opacity ramp (the CSS rule shortens it to 1 ms).

**Performance.** One transform tween per navigation. The content opacity ramp is a CSS animation on one container. Nothing measures the incoming page.

---

## 9. Moment 8: The aurora (continuous drift)

**Purpose.** A soft sense of depth behind every screen, in the theme's accent and second colour: three lights drifting, veiled toward the page colour. It is stronger while sealed and still under reduced motion (decided). It replaces the open-state mesh's fixed colours.

### CSS keyframes vs a GSAP ticker: pick CSS

| | CSS keyframes (transform only) | GSAP ticker / repeating tweens |
|---|---|---|
| Where it runs | Chromium's **compositor thread**. Transform animations on promoted layers keep running when the main thread is busy (typing in the notes editor, a React render, a Rust event burst). | **Main thread**, a rAF callback every frame for as long as the app is open. It stutters whenever JS is busy. |
| Battery | No JS wakeups. The GPU composites three layers. | 60 JS wakeups a second, forever. This keeps the CPU out of its deeper idle states, the main battery cost for a desktop app that sits open all day. `gsap.ticker.fps(20)` cuts the cost but makes large soft shapes visibly step. |
| Pausing | Already built: `data-paused` → `animation-play-state: paused` from `useWindowShown`. | Needs the same plumbing plus ticker sleep and wake. |
| Reduced motion | `animation: none` in CSS, already the pattern. | Code path. |
| What GSAP would add | Randomised paths and tweening `timeScale`. The aurora needs neither. Three incommensurate durations (46 / 54 / 62 s) already never visibly repeat. | |

**Decision: CSS keyframes.** GSAP touches the aurora only to strengthen it for Enter focus, and even that is a CSS opacity transition (§3). One exception exists: the broken seal's 2 s `playbackRate` slow-down on the held mesh (§6), which ends.

**Spec**
- Three blobs: A = `sealed`, B = `second`, C = a 120° gradient from `sealed` to `second`. Keyframes as in `Main.dc.html` (`auroraA/B/C`, translate + scale or a few degrees of rotate only), durations **46 s / 54 s / 62 s**, easing `drift`.
- **Draw blobs as `radial-gradient(closest-side, colour, transparent)` instead of `filter: blur(110px)`.** It looks the same for soft round lights and costs no filter pass. A filtered layer can be re-rasterised when its transform scales, and a gradient never needs that. This also applies to `Mesh.tsx`'s held and ambient blobs.
- `will-change: transform` on the three blobs only. It is legitimate here because they animate for as long as they are visible.
- Strength: an opacity per state (open 0.30 / 0.32 / 0.22 dark; sealed A to 0.42; light themes lower, per Main.dc), changed with `transition: opacity var(--duration-drain) var(--ease-drift)`.
- The veil: a static radial gradient toward `app`. Do **not** carry the `feTurbulence` grain into the aurora. Main.dc has none, and craft-floor flags feTurbulence grain as amateur.
- **Pause** when the window is hidden (existing `data-paused`), while the held page covers it, and while the intercept or held window has focus. Add one global hook: `html[data-window-hidden] .loop { animation-play-state: paused }`, so the aurora, the held mesh **and the keyhole breathe** (`.mark-breathe` currently keeps running when hidden) pause through the same switch.
- **Reduced motion:** `animation: none`, so the aurora is a still image at the current strength (decided).

---

## 10. Moment 9: Small interactions

These are mostly **CSS**, with GSAP only where two things must be ordered.

### 10.1 Ticking an item (routines, tasks, Week, held page task)
**Purpose.** "Done", then it gets out of the way.

| t | Target | Change | Dur | Tool |
|---|---|---|---|---|
| 0 | box | border and background → `sealed` | ui 0.12 | CSS transition |
| 0 | check path | `stroke-dashoffset` length → 0 (the check draws) | enter 0.18 | CSS transition |
| 0 | title | colour → muted, plus a strike line (`::after`, 1 px) `scaleX` 0 → 1 from the left | enter 0.18 | CSS transition |
| 0.18 | row | sinks to the done group: Flip from its old place | state 0.24 | GSAP Flip |

Retire `check-pop` (a 0.8 → 1.1 → 1 overshoot) and `check-glow` (an accent halo). A ticked routine is not a completion of the day, and only completion glows. `text-decoration` cannot animate, which is why the strike is a pseudo-element.

```ts
// useFlipList: replaces <Glide>. Capture before the store reorders, play after commit.
export function useFlipList(scope: RefObject<HTMLElement | null>, deps: unknown[]) {
  const state = useRef<Flip.FlipState | null>(null);
  const { live, contextSafe } = useMotion(scope);
  const capture = contextSafe(() => { state.current = Flip.getState(scope.current!.querySelectorAll("[data-flip-row]")); });
  useGSAP(() => {
    const s = state.current; state.current = null;
    if (s && live) Flip.from(s, { duration: DUR.state, ease: EASE.ui, delay: DUR.enter, nested: true, simple: true });
  }, { scope, dependencies: deps });
  return capture; // call capture() in the toggle handler, before the store update
}
```

The `delay` lets the tick finish before the row moves, so the motion explains both steps. Drag-reorder and Alt+arrow moves call `capture()` too, with no delay. Rows use `data-flip-id={item.id}` so Flip matches them across renders.

### 10.2 The days-strip key on hover (Today top bar)
**Purpose.** Explain the strip's colours on demand.

CSS only. **A deviation from the prototype, for design confirmation:** the prototype animates `max-width` and `margin-left`, so the streak chip grows and its left edge moves under the pointer. That causes layout on every frame and breaks the hover rule ("hover never moves the hovered element or a neighbour"). Instead, the key is absolutely positioned at the chip's right edge, over the empty flex space beside the date, so the chip's box never changes. It is revealed with `clip-path: inset(0 100% 0 0)` → `inset(0 0 0 0)` plus opacity, `DUR.state`, `ease-ui`. It waits 150 ms on hover-in only (`transition-delay` on `:hover` / `:focus-visible`, none on leave). Under reduced motion it appears and disappears at once.

### 10.3 Opening folds (Setup groups, CounterRow history, Notes toggles, Check-in rows)
CSS only. Use a `grid-template-rows: 0fr → 1fr` transition (`DUR.state`, `ease-ui`) on the wrapper. The content fades `opacity` 0 → 1 over `DUR.ui` after 60 ms, and the chevron rotates 90° (`DUR.ui`). Closing uses `DUR.enter` (faster). This is a contained layout change in a small region, so it is acceptable. The notes editor's `details` toggle keeps its `display: none` (ProseMirror owns that DOM). It gets the chevron rotation only.

### 10.4 Tracker log saving
**Purpose.** The entry landed, the chart now includes it, and the goal is met if it is.

| t | Target | Tween | Dur | Ease | Tool |
|---|---|---|---|---|---|
| 0 | input | value clears, focus stays (no animation) | | | |
| 0 | today's bar `[data-bar="today"]` (origin bottom) | `scaleY` old / new → 1 | glide 0.40 | glide | GSAP |
| 0 | total | `<Odometer>` | 0.40 | glide | GSAP |
| 0.30 | if this entry reaches the goal: that day's tick `[data-day-tick]` | `scaleY` (short / tall) → 1, colour → `second`, its label → `second-text` | state 0.24 | settle | GSAP |
| 0.30 | same tick's glow layer | `opacity` 0 → 1 | drain 1.2 | drift | GSAP |

This is the goal vocabulary at small scale: the tick and the glow, nothing more. Retire `goal-shine` (a light sweep across the bar) because it is decoration. The tall tick says the same thing. The Log entry button only has its CSS press state. There is no "Saved" toast, because the chart change is the confirmation.

Reduced motion: the bar, total and tick show their final state, and the glow appears without a ramp.

---

## 11. Testing motion with Vitest

### 11.1 Ground rules
- GSAP runs in jsdom. It reads and writes inline styles and SVG attributes, and its ticker falls back cleanly. **Never wait on real time.** Drive timelines by seeking them.
- `src/test/setup.ts` already makes `prefers-reduced-motion` match, so **every existing test runs reduced**: moments jump to their end state, and tests read final values. Keep that default.
- jsdom has no layout. `getBoundingClientRect` returns zeros (already stubbed), so Flip runs but measures nothing. Test that Flip moments *run and end in the right DOM state*, not their pixel paths. Stub `ResizeObserver` in setup (`globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} }`).
- Read transforms with `gsap.getProperty(el, "x")` / `"scaleX"`, not by parsing `style.transform`.

### 11.2 Helpers (`src/test/motion.ts`)

```ts
import { vi, afterEach } from "vitest";
import { gsap } from "../lib/gsap";

/** Turn reduced motion off (or on) for one test; setup.ts's default is on. */
export function setReducedMotion(reduce: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("prefers-reduced-motion") ? reduce : false, media: query, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
  }));
}

/** A moment's timeline by id. */
export const moment = (id: string) => gsap.getById(id) as gsap.core.Timeline | undefined;

afterEach(() => {
  vi.unstubAllGlobals();
  gsap.globalTimeline.clear();   // no tween leaks between tests
});
```

`useWindowShown` should come from the lifted store (§1.4), so tests can set `shown` directly instead of faking Tauri.

### 11.3 What to test

```ts
it("plays the held build as one timeline, chime at the rings", () => {
  setReducedMotion(false);
  const play = vi.spyOn(sound, "play");
  render(<HeldPage />);
  const tl = moment("held")!;
  expect(tl.labels.rings).toBeCloseTo(1.2);
  expect(tl.duration()).toBeLessThanOrEqual(2.9);
  tl.seek("key");                         // seek() suppresses callbacks by default
  expect(play).not.toHaveBeenCalled();
  tl.progress(1);                          // progress() fires them
  expect(play).toHaveBeenCalledWith("held");
  expect(document.querySelector("[data-ring='1']")).toHaveAttribute("r", "5.2");
});

it("lands on the designed still frame under reduced motion", () => {
  render(<HeldPage />);                     // setup default: reduced
  expect(moment("held")!.progress()).toBe(1);
  expect(screen.getByText("Sanctum held.")).toBeVisible();
});

it("cleans up on unmount", () => {
  setReducedMotion(false);
  const { unmount } = render(<HeldPage />);
  unmount();
  expect(gsap.globalTimeline.getChildren(true, true, true)).toHaveLength(0);
});

it("a broken seal drains instead of ringing", () => {
  setReducedMotion(false);
  render(<HeldPage held={{ ...held, broken: true }} />);
  const tl = moment("held")!;
  expect(tl.labels.rings).toBeUndefined();
  tl.progress(1);
  expect(gsap.getProperty("[data-part='key']", "opacity")).toBeCloseTo(0.55);
});
```

Also cover:
- `rollPlan` (pure): `"42m" → "43m"` rolls one column; `"49m" → "50m"` rolls two, rightmost first, with the 9 wrapping through index 10; `"59m" → "1h"` returns a skeleton change; a countdown `"5" → "4"` rolls down.
- Live minutes: a +1 minute step calls the needle `quickTo` (spy), and a jump of 5 minutes (resume) `set`s the value without animating. Crossing 90 creates `"tick-cross"`, and crossing the goal tick does not.
- Goal reached: `met` false → true creates `"goal"`. Mounting with `met` already true creates nothing, so there is no stale celebration.
- Enter focus: moving the store from open to sealed creates `"enter-focus"`. Mounting already sealed (a resumed session) creates nothing.
- Hidden window: with `shown = false`, the same triggers end at `progress() === 1`.

---

## 12. What should NOT use GSAP

CSS transitions and keyframes are enough, and are better here because they cost no JS:

- Hover, press and focus states: colour, background, border, `brightness`, the focus ring. Everything already on `transition-colors duration-ui ease-ui`.
- **Fix in passing:** Week's event cards use `hover:-translate-y-px` on the card itself, so the hovered element moves out from under the pointer. Move the lift to an inner surface (`.card:hover .card-surface`), or drop it.
- Toggles (`controls.tsx`), select chevrons and fold chevrons.
- Folds (§10.3), and the days-strip key reveal (§10.2).
- Checkbox fill, check draw and strike line (§10.1, everything except the row's Flip).
- Dialog and toast entrances (`animate-fade-in` / `rise-in`, 180 ms). They are routine and short. Note: rise-in's 6 px is acceptable for overlays, which do come from somewhere.
- The aurora and the held or ambient mesh drift (§9), and the keyhole breathe loop.
- The boot splash word (`splash-word`, `splash-out`). It runs before the app is interactive and must not wait for anything. The mark build in the splash may share `buildHeld`'s segment, but the word stays CSS.
- Progress bars that track a value (Home's focus strip, CounterRow): CSS `transition: transform` on a `scaleX` fill, replacing today's `transition-[width]` (a layout change per update).
- Theme switching: no motion (the `.theme-switching` kill-switch stays).
- Anything inside the notes editor (ProseMirror owns the DOM).
- The tray panel and compact timer: CSS only. They are tiny windows, and GSAP there costs bundle size for nothing.

**Rule of thumb:** use GSAP when a change has **more than one step that must be ordered** (a timeline), **depends on a measured or dynamic value** (Flip, needle position), or must be **seekable for tests and replay**. Otherwise use CSS.

---

## 13. Rollout (matches the decision log's order)

1. **Tokens step:** add the motion tokens to `extra.json`, `src/lib/gsap.ts`, `useMotion`, the lifted `useWindowShown` store, test helpers, and the global `data-window-hidden` pause. *(after approval to add `gsap` + `@gsap/react`)*
2. **Today step (decision step 4):** `<Odometer>`, the day ruler with live minutes, goal reached, Enter focus, retire `useStateFade` and `page-in`.
3. **Week / Stats / Trackers step (decision step 5):** the nav indicator, Week direction, `useFlipList` (then remove `motion` and `MotionConfig`), tracker log saving.
4. **Aurora step (decision step 6):** CSS aurora with radial-gradient blobs, the theme-derived held mesh.
5. **The rest (decision step 7):** held build timeline, broken seal, intercept card.

Each step ships with Vitest coverage, a CHANGELOG note, and items in `docs/manual-testing.md` for what jsdom cannot show: smoothness on an integrated GPU, pausing when minimised to the tray, the intercept window's composition, and Windows "Show animations" off. Before calling any moment smooth, capture it twice, at normal and at reduced motion, as filmstrips over the same interaction (the `animate.md` verification loop), and review both.

---

## 14. Needs approval

1. **Add `gsap` and `@gsap/react`** (the decision log says "candidate, not added yet").
2. **Remove `motion` (Framer Motion)** once `Glide` → Flip and `useRolling` → `<Odometer>` are ported, so the app has one animation engine.
3. **Days-strip key** as an overlay that doesn't resize the chip (§10.2), a deviation from the prototype's inline `max-width` reveal.
4. **Retiring** `page-in`, `row-in`, `check-pop`, `check-glow`, `goal-shine` and the AppShell state blur-fade (decided 2026-09-30 as "subtle transitions"; this spec replaces them).
5. **Held rings** settle at the mock's radii instead of pulsing out and vanishing, and the **broken** sound moves from the keyhole landing to the drain.
6. **Motion tokens** stay in `src/theme/extra.json` for now (that's where `ease-ui` / `duration-ui` already live, not `design/tokens.css`), to be promoted into `design/tokens.json` with the next design update.
