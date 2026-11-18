import { create } from "zustand";
import { native } from "../lib/native";
import { weekStart, todayKey } from "../lib/planner";
import type { Recap } from "../lib/types";
import { useStore } from "./store";

// The weekly recap (v0.3, decided 2026-10-29): once a week, the first time you open Sanctum
// (Monday or later), last week in a few lines. Never a system notification; closing it (or
// opening Stats from it) means it's seen until next week. Off by default (decided 2026-11-16):
// Setup › Goals › "Weekly recap" turns it on. With it off, the week is still marked seen and
// the partner's weekly summary still goes out; only the dialog stays away. Shown as a centered
// dialog like the check-in (2026-11-16): one line of figures over the week as a strip (layout C,
// 2026-11-17), and one optional line.

const SEEN = "recap_seen_week";
/** "1" shows the weekly recap dialog; anything else (unset included) keeps it off. */
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

/** "11h 20m", "45m", "2h". */
export function recapTime(m: number): string {
  const h = Math.floor(m / 60);
  return h ? (m % 60 ? `${h}h ${m % 60}m` : `${h}h`) : `${m}m`;
}

export interface RecapFigures {
  /** Focus time, then how it moved against the week before ("In focus, up 2h on the week before"). */
  focus: { value: string; previous: string | null; note: string; direction: "up" | "down"; delta: string | null };
  /** Days kept of the days used ("5 of 6"), and the broken seals, if any. */
  kept: { value: string; note: string };
  /** The one quieter line: the best day, if there was one. */
  aside: string | null;
}

/** The recap as two figures and one quiet line: the rest is in Stats. */
export function recapFigures(r: Recap): RecapFigures {
  const diff = r.focusMin - r.previousFocusMin;
  const note = r.previousFocusMin === 0 ? "In focus" : diff === 0 ? "In focus, the same as the week before" : `In focus, ${diff > 0 ? "up" : "down"} ${recapTime(Math.abs(diff))} on the week before`;
  return {
    focus: {
      value: recapTime(r.focusMin),
      previous: r.previousFocusMin > 0 ? recapTime(r.previousFocusMin) : null,
      note,
      direction: diff < 0 ? "down" : "up",
      // "+3h" against the week before; nothing when there's no week before or no change.
      delta: r.previousFocusMin === 0 || diff === 0 ? null : `${diff > 0 ? "+" : "−"}${recapTime(Math.abs(diff))}`,
    },
    kept: { value: `${r.kept} of ${r.days}`, note: r.broken ? `Days kept, ${r.broken} with a broken seal` : "Days kept" },
    aside: r.bestDay ? `Best day: ${new Date(`${r.bestDay}T12:00:00`).toLocaleDateString("en-US", { weekday: "long" })}, ${recapTime(r.bestDayMin)}.` : null,
  };
}
