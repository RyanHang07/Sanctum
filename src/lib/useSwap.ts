import { useRef, useState } from "react";
import { DUR, EASE, gsap, RISE_FROM, RISE_TO, useGSAP } from "./gsap";
import { useMotion } from "./useMotion";

/** The beat between the old content leaving and the new one arriving, as screens do. */
const BEAT = 0.12;

/**
 * Swaps content the way screens swap (decided 2026-11-16): the old content fades out, a short
 * beat, then the new content rises in. Returns the ref for the moving element and the key to
 * render, which trails `key` until the old content has gone. The first render just appears;
 * a switch mid-swap takes over from wherever the fade is; reduced motion swaps at once. While
 * it swaps, the element hides its overflow so no scrollbar flashes.
 */
export function useSwap<K>(key: K, id: string) {
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
      swap.current?.kill();
      const from = Number(gsap.getProperty(el, "opacity"));
      const settle = () => {
        el.style.overflow = "";
      };
      el.style.overflow = "hidden";
      swap.current = run(() =>
        gsap
          .timeline({ id, onComplete: settle, onInterrupt: settle })
          .to(el, { opacity: 0, duration: DUR.ui * from, ease: EASE.exit })
          .call(() => setShown(key))
          .fromTo(el, RISE_FROM, { ...RISE_TO, immediateRender: false }, `+=${BEAT}`),
      );
    },
    { dependencies: [key] },
  );
  return { ref, shown };
}
