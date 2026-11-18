import type { Category, SessionOutcome } from "../../lib/types";

// Shared by the Stats tabs (v0.3): the category colors (as Overview's "Where time went") and
// outcome words. Segmented switches come from components/controls (v0.4).

export const CATEGORY: Record<Category, { label: string; dot: string }> = {
  productive: { label: "Productive", dot: "bg-sealed" },
  neutral: { label: "Neutral", dot: "bg-check-line" },
  distracting: { label: "Distracting", dot: "bg-second" },
};

export const OUTCOME: Record<SessionOutcome, string> = {
  completed: "Kept",
  unlocked_early: "Let out early",
  broken: "Broken",
};

/** 45s, 12m, 2h 05m */
export function duration(seconds: number): string {
  const m = Math.round(seconds / 60);
  if (m < 1) return `${Math.max(0, Math.round(seconds))}s`;
  const h = Math.floor(m / 60);
  return h ? `${h}h ${String(m % 60).padStart(2, "0")}m` : `${m}m`;
}

/** A sealed app or site's name for people: "discord.exe" → "discord". */
export const appLabel = (key: string) => key.replace(/\.exe$/i, "");
