import { create } from "zustand";
import { native } from "../lib/native";
import { weekStart, todayKey } from "../lib/planner";
import type { Recap } from "../lib/types";
import { useStore } from "./store";

// The weekly recap (v0.3, decided 2026-10-29): once a week, the first time you open Sanctum
// (Monday or later), last week in a few lines. Never a system notification; closing it (or
// opening Stats from it) means it's seen until next week. Off by default (decided 2026-11-16):
// Setup › General › "Weekly recap" turns the card on. With it off, the week is still marked
// seen and the partner's weekly summary still goes out; only the card stays away.

const SEEN = "recap_seen_week";
/** "1" shows the weekly recap card; anything else (unset included) keeps it off. */
export const RECAP_SETTING = "weekly_recap";

export interface RecapStore {
  recap: Recap | null;
  check: () => Promise<void>;
  /** Seen for this week. */
  close: () => void;
}

export const useRecap = create<RecapStore>()((set) => ({
  recap: null,

  check: async () => {
    const week = weekStart(todayKey(new Date(), useStore.getState().settings.dailyResetTime));
    if ((await native.getSetting(SEEN).catch(() => null)) === week) return;
    const recap = await native.statsRecap().catch(() => null);
    // Nothing happened last week: nothing to say, and no reason to ask again this week.
    if (!recap) return void native.setSetting(SEEN, week).catch(() => undefined);
    const on = (await native.getSetting(RECAP_SETTING).catch(() => null)) === "1";
    if (on) set({ recap });
    else void native.setSetting(SEEN, week).catch(() => undefined);
    // The partner's weekly summary goes out now, once a week, if you turned it on (v0.3.1).
    void native.reviewRecapShown().catch(() => undefined);
  },

  close: () => {
    set({ recap: null });
    void native.setSetting(SEEN, weekStart(todayKey(new Date(), useStore.getState().settings.dailyResetTime))).catch(() => undefined);
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
