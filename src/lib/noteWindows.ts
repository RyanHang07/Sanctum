import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { EVENTS, errorText, inTauri, native, onNative } from "./native";
import { useNotes } from "../state/notes";
import { useStore } from "../state/store";
import { useTheme } from "../state/theme";

// A note in its own window (2026-11-20). Rust keeps the windows (src-tauri/src/note_windows.rs);
// this side opens them, hears which notes have one, and follows notes changed in other windows.

/** The note a `#/note/<id>` hash opens, or null. */
export function noteIdFromView(view: string): number | null {
  const id = Number(/^note\/(\d+)$/.exec(view)?.[1]);
  return id > 0 ? id : null;
}

/** This window's label: Tauri's, or in the browser preview the one the hash implies. */
export function windowLabel(): string {
  if (inTauri()) return getCurrentWindow().label;
  const id = noteIdFromView(window.location.hash.replace(/^#\/?/, ""));
  return id ? `note-${id}` : "main";
}

/** Opens a note in its own window (or brings it forward), saved first and in this theme's colors. */
export async function openNoteWindow(id: number): Promise<void> {
  await useNotes.getState().flush();
  const { theme, prefs } = useTheme.getState();
  try {
    await native.noteWindowOpen(id, theme.palette.app ?? null, prefs.follow ? null : theme.scheme);
  } catch (e) {
    useStore.getState().showNotice({ lead: errorText(e) });
  }
}

/**
 * The notes open in their own window: the list now, then every change. A note whose window just
 * closed is read again before it leaves the list, so its editor comes back with the latest text.
 */
export function useNoteWindows(): number[] {
  const [ids, setIds] = useState<number[]>([]);
  useEffect(() => {
    let alive = true;
    let prev: number[] = [];
    const apply = async (next: number[]) => {
      const list = Array.isArray(next) ? next : [];
      const closed = prev.some((id) => !list.includes(id));
      prev = list;
      if (closed) await useNotes.getState().sync();
      if (alive) setIds(list);
    };
    void native.noteWindowList().then((l) => apply(l ?? []), () => undefined);
    const off = onNative<number[]>(EVENTS.noteWindows, (l) => void apply(l));
    return () => {
      alive = false;
      void off.then((f) => f());
    };
  }, []);
  return ids;
}

/** Waits this long after another window's change, so a run of saves reads the list once. */
const SYNC_MS = 150;

/** Follows notes created, saved, pinned, or deleted in other windows. */
export function useNotesSync(): void {
  useEffect(() => {
    const me = windowLabel();
    let t: ReturnType<typeof setTimeout> | undefined;
    const off = onNative<{ id: number; kind: string; from: string } | null>(EVENTS.notes, (p) => {
      if (p?.from === me) return;
      clearTimeout(t);
      t = setTimeout(() => void useNotes.getState().sync(), SYNC_MS);
    });
    return () => {
      clearTimeout(t);
      void off.then((f) => f());
    };
  }, []);
}
