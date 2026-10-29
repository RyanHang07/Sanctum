import { useEffect, type RefObject } from "react";

// The home page's motion (v0.2 site; styles in home-motion.css). Content is visible by default:
// only once this runs, and only without "reduce motion", does `.motion-on` hide what hasn't
// scrolled in yet. Two pieces need script:
// - Reveals: `[data-reveal]` elements rise in once as they enter the viewport.
// - Spotlight: `.spot` cards light up under the pointer (a glow follows it).
// Scroll-linked effects (the hero shot settling flat, parallax) are pure CSS scroll-driven
// animations where supported, and simply still elsewhere.

const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

export function useHomeMotion(root: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = root.current;
    if (!el || reduced() || !("IntersectionObserver" in window)) return;

    el.classList.add("motion-on");
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          e.target.classList.add("in");
          io.unobserve(e.target);
        }
      },
      // A little before it's fully in view, so it's settled by the time you read it.
      { rootMargin: "0px 0px -8% 0px", threshold: 0.12 },
    );
    el.querySelectorAll("[data-reveal]").forEach((n) => io.observe(n));

    // The spotlight: pointer position as custom properties on the card under it.
    const fine = matchMedia("(pointer: fine)").matches;
    const move = (e: PointerEvent) => {
      const card = (e.target as Element | null)?.closest?.<HTMLElement>(".spot");
      if (!card) return;
      const r = card.getBoundingClientRect();
      card.style.setProperty("--mx", `${e.clientX - r.left}px`);
      card.style.setProperty("--my", `${e.clientY - r.top}px`);
    };
    if (fine) el.addEventListener("pointermove", move, { passive: true });

    return () => {
      io.disconnect();
      el.removeEventListener("pointermove", move);
      el.classList.remove("motion-on");
    };
  }, [root]);
}
