import { create } from "zustand";
import { EVENTS, errorText, native, onNative } from "../lib/native";
import type { UpdateInfo } from "../lib/types";
import { useStore } from "./store";

// One-click updates (v0.3, decided 2026-10-29). Sanctum downloads a new version in the
// background (src-tauri/src/updates.rs); this holds what's ready, and the one click that
// installs it and restarts. "Later" hides the notice until Sanctum next starts.

export interface UpdateStore {
  ready: UpdateInfo | null;
  /** The version you said "Later" to, this run. */
  later: string | null;
  applying: boolean;
  start: () => () => void;
  apply: () => Promise<void>;
  dismiss: () => void;
}

export const useUpdate = create<UpdateStore>()((set, get) => ({
  ready: null,
  later: null,
  applying: false,

  start: () => {
    void native.updateReady().then((ready) => ready && set({ ready }), () => undefined);
    const off = onNative<UpdateInfo>(EVENTS.updateReady, (ready) => set({ ready }));
    return () => void off.then((f) => f());
  },

  apply: async () => {
    set({ applying: true });
    try {
      // Restarts on success, so nothing after this runs then.
      await native.updateApply();
    } catch (e) {
      useStore.getState().showNotice({ lead: errorText(e) });
    } finally {
      set({ applying: false });
    }
  },

  dismiss: () => set({ later: get().ready?.version ?? null }),
}));
