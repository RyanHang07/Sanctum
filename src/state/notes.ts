import { create } from "zustand";
import { errorText, native } from "../lib/native";
import type { Note } from "../lib/types";
import { useStore } from "./store";

// Notes (decided 2026-09-30): edits apply locally at once and save after a short pause, so
// typing never waits on the backend. Pinned first, then most recently edited.

const SAVE_MS = 400;

export interface NotesStore {
  notes: Note[];
  loaded: boolean;
  /** The note open in the editor. */
  openId: number | null;
  load: () => Promise<void>;
  open: (id: number | null) => void;
  /** Makes an empty note and opens it. */
  create: (body?: string) => Promise<Note | null>;
  /** Edits the open note; saved after a pause (or right away with flush). */
  edit: (id: number, patch: { title?: string; body?: string }) => void;
  flush: () => Promise<void>;
  pin: (id: number, pinned: boolean) => Promise<void>;
  remove: (id: number) => Promise<void>;
}

const pending = new Map<number, ReturnType<typeof setTimeout>>();

function sorted(list: Note[]): Note[] {
  return [...list].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt || b.id - a.id);
}

function fail(e: unknown) {
  useStore.getState().showNotice({ lead: errorText(e) });
}

export const useNotes = create<NotesStore>()((set, get) => {
  async function save(id: number) {
    pending.delete(id);
    const n = get().notes.find((x) => x.id === id);
    if (!n) return;
    try {
      const saved = await native.saveNote({ id, title: n.title, body: n.body });
      // Keep what's been typed since; take the server's timestamps.
      set({ notes: sorted(get().notes.map((x) => (x.id === id ? { ...x, updatedAt: saved.updatedAt } : x))) });
    } catch (e) {
      fail(e);
    }
  }

  return {
    notes: [],
    loaded: false,
    openId: null,

    load: async () => {
      try {
        const notes = await native.listNotes();
        set({ notes, loaded: true, openId: get().openId ?? notes[0]?.id ?? null });
      } catch (e) {
        set({ loaded: true });
        fail(e);
      }
    },

    open: (openId) => {
      void get().flush();
      set({ openId });
    },

    create: async (body = "") => {
      await get().flush();
      try {
        const n = await native.saveNote({ title: "", body });
        set({ notes: sorted([n, ...get().notes]), openId: n.id });
        return n;
      } catch (e) {
        fail(e);
        return null;
      }
    },

    edit: (id, patch) => {
      set({ notes: get().notes.map((n) => (n.id === id ? { ...n, ...patch } : n)) });
      clearTimeout(pending.get(id));
      pending.set(id, setTimeout(() => void save(id), SAVE_MS));
    },

    flush: async () => {
      const ids = [...pending.keys()];
      for (const id of ids) clearTimeout(pending.get(id));
      await Promise.all(ids.map(save));
    },

    pin: async (id, pinned) => {
      try {
        const n = await native.pinNote(id, pinned);
        set({ notes: sorted(get().notes.map((x) => (x.id === id ? { ...x, pinned: n.pinned } : x))) });
      } catch (e) {
        fail(e);
      }
    },

    remove: async (id) => {
      clearTimeout(pending.get(id));
      pending.delete(id);
      try {
        await native.deleteNote(id);
        const notes = get().notes.filter((n) => n.id !== id);
        set({ notes, openId: get().openId === id ? notes[0]?.id ?? null : get().openId });
      } catch (e) {
        fail(e);
      }
    },
  };
});

/** "Books to read", or the first line of the body, or "Untitled". */
export function noteTitle(n: Pick<Note, "title" | "body">): string {
  return n.title.trim() || n.body.trim().split("\n")[0]?.replace(/^(- |\[[ x]\] )/i, "").slice(0, 60) || "Untitled";
}

/** The first line of the body that isn't the title, for the list. */
export function notePreview(n: Pick<Note, "title" | "body">): string {
  const lines = n.body.split("\n").map((l) => l.trim()).filter(Boolean);
  const rest = n.title.trim() ? lines : lines.slice(1);
  return rest[0]?.replace(/^(- |\[[ x]\] )/i, "") ?? "";
}

/** Flips the checkbox on one line of a body ("[ ] x" <-> "[x] x"). */
export function toggleLine(body: string, index: number): string {
  const lines = body.split("\n");
  const line = lines[index];
  if (line === undefined) return body;
  lines[index] = /^(\s*)\[ \]/.test(line) ? line.replace(/^(\s*)\[ \]/, "$1[x]") : line.replace(/^(\s*)\[x\]/i, "$1[ ]");
  return lines.join("\n");
}

// App-wide state: hot-swapping this module would split it into two copies. Reload instead.
import.meta.hot?.accept(() => window.location.reload());
