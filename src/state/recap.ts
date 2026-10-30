import { create } from "zustand";
import { native } from "../lib/native";
import { weekStart, todayKey } from "../lib/planner";
import type { Recap } from "../lib/types";

// The weekly recap (v0.3, decided 2026-10-29): once a week, the first time you open Sanctum
// (Monday or later), last week in a few lines. Never a system notification; closing it (or
// opening Stats from it) means it's seen until next week.

const SEEN = "recap_seen_week";

export interface RecapStore {
  recap: Recap | null;
  check: () => Promise<void>;
  /** Seen for this week. */
  close: () => void;
}

export const useRecap = create<RecapStore>()((set) => ({
  recap: null,

  check: async () => {
    const week = weekStart(todayKey());
    if ((await native.getSetting(SEEN).catch(() => null)) === week) return;
    const recap = await native.statsRecap().catch(() => null);
    // Nothing happened last week: nothing to say, and no reason to ask again this week.
    if (!recap) return void native.setSetting(SEEN, week).catch(() => undefined);
    set({ recap });
  },

  close: () => {
    set({ recap: null });
    void native.setSetting(SEEN, weekStart(todayKey())).catch(() => undefined);
  },
}));

/** "11h 20m in focus, up 2h from the week before." */
export function recapLines(r: Recap): { lead: string; lines: string[] } {
  const fmt = (m: number) => {
    const h = Math.floor(m / 60);
    return h ? (m % 60 ? `${h}h ${m % 60}m` : `${h}h`) : `${m}m`;
  };
  const diff = r.focusMin - r.previousFocusMin;
  const change = r.previousFocusMin === 0 ? "" : diff === 0 ? ", the same as the week before" : `, ${diff > 0 ? "up" : "down"} ${fmt(Math.abs(diff))} from the week before`;
  const lines = [`${fmt(r.focusMin)} in focus over ${r.sessions} ${r.sessions === 1 ? "session" : "sessions"}${change}.`];
  lines.push(`${r.kept} of ${r.days} days kept${r.broken ? `, ${r.broken} with a broken seal` : ""}.`);
  if (r.bestDay) lines.push(`Best day: ${new Date(`${r.bestDay}T12:00:00`).toLocaleDateString("en-US", { weekday: "long" })}, ${fmt(r.bestDayMin)}.`);
  if (r.mostTempting) lines.push(`Most tempting: ${r.mostTempting.replace(/\.exe$/i, "")}.`);
  return { lead: "Last week, in short.", lines };
}
