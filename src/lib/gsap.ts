import gsap from "gsap";
import { Flip } from "gsap/Flip";
import { CustomEase } from "gsap/CustomEase";
import { useGSAP } from "@gsap/react";
import extra from "../theme/extra.json";

// The only place GSAP is imported from (docs/decisions/2026-11-15-motion-spec.md §1.3).
// Durations and eases come from the same tokens Tailwind uses (src/theme/extra.json "motion"),
// so a CSS transition and a GSAP tween with the same name move the same way.

gsap.registerPlugin(useGSAP, Flip, CustomEase);

export type DurKey = keyof typeof extra.motion.duration;
export type EaseKey = keyof typeof extra.motion.easing;

/** Seconds, from the same tokens Tailwind uses (duration-ui = DUR.ui * 1000 ms). */
export const DUR = Object.fromEntries(
  Object.entries(extra.motion.duration).map(([k, v]) => [k, parseFloat(v) / 1000]),
) as Record<DurKey, number>;

// Each cubic-bezier token becomes a named GSAP ease: ease: "glide".
for (const [name, css] of Object.entries(extra.motion.easing)) {
  const m = /cubic-bezier\(([^)]+)\)/.exec(css);
  if (m) CustomEase.create(name, m[1]);
}

/** The token eases by name, for `ease: EASE.glide`. */
export const EASE = Object.fromEntries(Object.keys(extra.motion.easing).map((k) => [k, k])) as Record<EaseKey, string>;

// overwrite "auto": a tween that lands while another is still moving the same property takes it over.
gsap.defaults({ duration: DUR.enter, ease: EASE.ui, overwrite: "auto" });

export { gsap, Flip, CustomEase, useGSAP };
