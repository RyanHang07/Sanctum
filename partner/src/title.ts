import { useEffect } from "react";

// Tab titles and the favicon (v0.1, decided 2026-09-30): status first, then the brand. While
// requests wait for your answer the title leads with the count and the icon gets a coral dot.

export function tabTitle(status: string | null, waiting = 0): string {
  const base = status ? `${status} · Sanctum` : "Sanctum";
  return waiting > 0 ? `(${waiting}) ${base}` : base;
}

/** Sets the tab title and swaps the favicon while anything is waiting. */
export function useTabTitle(status: string | null, waiting = 0) {
  useEffect(() => {
    document.title = tabTitle(status, waiting);
    const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (icon) icon.href = waiting > 0 ? "/favicon-waiting.svg" : "/favicon.svg";
  }, [status, waiting]);
}

/** For screens that render no component of their own (sign in, not set up). */
export function Title({ status, waiting = 0 }: { status: string | null; waiting?: number }) {
  useTabTitle(status, waiting);
  return null;
}
