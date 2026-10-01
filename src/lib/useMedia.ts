import { useSyncExternalStore } from "react";

/** The window is narrow (a vertical monitor, or dragged thin): the sidebar folds, Week goes to two rows. */
export const NARROW = "(max-width: 1040px)";

/** Whether a media query matches, following it as the window resizes. False where there's no matchMedia. */
export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (on) => {
      const m = window.matchMedia?.(query);
      m?.addEventListener("change", on);
      return () => m?.removeEventListener("change", on);
    },
    () => window.matchMedia?.(query).matches ?? false,
    () => false,
  );
}
