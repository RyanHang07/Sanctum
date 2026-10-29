import { create } from "zustand";
import { errorText, native } from "../lib/native";
import { DEFAULT_SETUP, type JournalSetup } from "../lib/journalPrompts";
import type { JournalLock } from "../lib/types";
import { useStore } from "./store";

// The journal's setup (prompts, daily count) and its lock state (v0.2). Pages themselves load
// per day in JournalPage; the backend refuses them while the journal is locked.

const SETUP_KEY = "journal_setup";

/** The page's unsaved typing, waiting out its pause. Saved before the journal locks. */
let unsaved: (() => Promise<void>) | null = null;

export function holdJournalSave(save: (() => Promise<void>) | null) {
  unsaved = save;
}

/** Saves the page's typing now, if any is waiting. */
export async function flushJournal(): Promise<void> {
  const save = unsaved;
  unsaved = null;
  if (save) await save();
}

export interface JournalStore {
  setup: JournalSetup;
  lock: JournalLock | null;
  loaded: boolean;
  load: () => Promise<void>;
  saveSetup: (s: JournalSetup) => Promise<void>;
  setLock: (kind: JournalLock["lock"], pin?: string) => Promise<boolean>;
  unlockPin: (pin: string) => Promise<string | null>;
  unlockHello: () => Promise<string | null>;
  /** Locks it again (leaving the Journal, hiding Sanctum, or idle). */
  relock: () => void;
}

function parse(raw: string | null): JournalSetup {
  try {
    const s = JSON.parse(raw ?? "") as Partial<JournalSetup>;
    return { done: s.done === true, prompts: Array.isArray(s.prompts) ? s.prompts.filter((x) => typeof x === "string") : [], perDay: typeof s.perDay === "number" ? s.perDay : DEFAULT_SETUP.perDay };
  } catch {
    return DEFAULT_SETUP;
  }
}

export const useJournal = create<JournalStore>()((set, get) => ({
  setup: DEFAULT_SETUP,
  lock: null,
  loaded: false,

  load: async () => {
    const [raw, lock] = await Promise.all([native.getSetting(SETUP_KEY).catch(() => null), native.journalStatus().catch(() => null)]);
    set({ setup: parse(raw), lock, loaded: true });
  },

  saveSetup: async (setup) => {
    set({ setup });
    await native.setSetting(SETUP_KEY, JSON.stringify(setup)).catch((e) => useStore.getState().showNotice({ lead: errorText(e) }));
  },

  setLock: async (kind, pin) => {
    try {
      set({ lock: await native.journalSetLock(kind, pin ?? null) });
      return true;
    } catch (e) {
      useStore.getState().showNotice({ lead: errorText(e) });
      return false;
    }
  },

  unlockPin: async (pin) => {
    try {
      set({ lock: await native.journalUnlockPin(pin) });
      return null;
    } catch (e) {
      return errorText(e);
    }
  },

  unlockHello: async () => {
    try {
      const lock = await native.journalUnlockHello();
      set({ lock });
      return lock.unlocked ? null : "Windows Hello didn't confirm it was you.";
    } catch (e) {
      return errorText(e);
    }
  },

  relock: () => {
    const lock = get().lock;
    if (!lock || lock.lock === "none" || !lock.unlocked) return;
    set({ lock: { ...lock, unlocked: false } });
    // The last words typed land before the lock does.
    void flushJournal().finally(() => native.journalLock().catch(() => undefined));
  },
}));

import.meta.hot?.accept(() => window.location.reload());
