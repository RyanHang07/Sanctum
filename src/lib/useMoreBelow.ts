import { useEffect, useState, type RefObject } from "react";

/**
 * Whether a scrolling list has more below what's in view (2026-11-20). When it does, the list
 * fades out at its foot instead of ending on a divider, so a tight column gains the room and
 * still says there's more. Re-checked on scroll and whenever the list or its contents resize.
 */
export function useMoreBelow(scroller: RefObject<HTMLElement | null>): boolean {
  const [more, setMore] = useState(false);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const check = () => setMore(el.scrollHeight - el.clientHeight - el.scrollTop > 1);
    check();
    el.addEventListener("scroll", check, { passive: true });
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(check);
    ro?.observe(el);
    for (const child of Array.from(el.children)) ro?.observe(child);
    // Rows added or removed change the height without resizing the box.
    const mo = typeof MutationObserver === "undefined" ? null : new MutationObserver(check);
    mo?.observe(el, { childList: true, subtree: true });
    return () => {
      el.removeEventListener("scroll", check);
      ro?.disconnect();
      mo?.disconnect();
    };
  }, [scroller]);
  return more;
}

/** The foot of a list with more below: content fades out over its last 28px. */
export const FADE_WHEN_MORE = "data-[more]:[mask-image:linear-gradient(to_bottom,black_calc(100%-28px),transparent)]";
