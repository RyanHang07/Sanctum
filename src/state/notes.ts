import { create } from "zustand";
import { errorText, native } from "../lib/native";
import type { Note } from "../lib/types";
import { useStore } from "./store";
import { DEFAULT_NOTE_SIZE } from "../components/editor/NoteToolbar";
import type { SharedImage } from "../lib/types";
import { docOf } from "../lib/noteDoc";
import { imageBytes, imageIdsIn, stripMetadata } from "../lib/noteImages";
import { encryptBytes, encryptJson, newShareKey, toBase64 } from "../lib/shareCrypto";

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
  edit: (id: number, patch: { title?: string; body?: string; doc?: string }) => void;
  flush: () => Promise<void>;
  pin: (id: number, pinned: boolean) => Promise<void>;
  remove: (id: number) => Promise<void>;
  /** Shares a note as a live, end-to-end encrypted link for `hours` (1, 24, or 168). */
  share: (id: number, hours: number) => Promise<boolean>;
  /** Pushes a shared note's latest version (encrypted) to its link. */
  pushShare: (id: number) => Promise<void>;
  stopShare: (id: number) => Promise<void>;
  /** Text size for every note, in px (the note toolbar's A− / A+). */
  fontSize: number;
  setFontSize: (px: number) => void;
}

const pending = new Map<number, ReturnType<typeof setTimeout>>();
/** A shared note's edits reach its link this long after typing pauses. */
const PUSH_MS = 1500;
const pushes = new Map<number, ReturnType<typeof setTimeout>>();

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
      const saved = await native.saveNote({ id, title: n.title, body: n.body, doc: n.doc });
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
    fontSize: DEFAULT_NOTE_SIZE,

    setFontSize: (fontSize) => {
      set({ fontSize });
      void native.setSetting("note_font_size", String(fontSize)).catch(fail);
    },

    load: async () => {
      try {
        const [notes, size] = await Promise.all([native.listNotes(), native.getSetting("note_font_size").catch(() => null)]);
        const fontSize = Number(size);
        set({ notes, loaded: true, openId: get().openId ?? notes[0]?.id ?? null, ...(fontSize >= 10 && fontSize <= 30 ? { fontSize } : {}) });
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
      if (get().notes.find((n) => n.id === id)?.share) {
        clearTimeout(pushes.get(id));
        pushes.set(id, setTimeout(() => void get().pushShare(id), PUSH_MS));
      }
    },

    share: async (id, hours) => {
      await get().flush();
      try {
        const key = newShareKey();
        const info = await native.shareNote(id, hours, key);
        set({ notes: get().notes.map((n) => (n.id === id ? { ...n, share: { ...info, key, imageIds: [] } } : n)) });
        await get().pushShare(id);
        return true;
      } catch (e) {
        fail(e);
        return false;
      }
    },

    pushShare: async (id) => {
      pushes.delete(id);
      const n = get().notes.find((x) => x.id === id);
      if (!n?.share) return;
      const { key, imageIds } = n.share;
      try {
        const doc = docOf(n);
        // New images: metadata stripped, then encrypted, before they leave this PC.
        const images: SharedImage[] = [];
        for (const img of imageIdsIn(doc).filter((x) => !imageIds.includes(x))) {
          const clean = await stripMetadata(await imageBytes(img));
          images.push({ id: img, data: toBase64(await encryptBytes(key, new Uint8Array(await clean.arrayBuffer()))) });
        }
        const cipher = await encryptJson(key, { title: n.title, doc });
        const up = await native.updateNoteShare(id, cipher, images);
        set({ notes: get().notes.map((x) => (x.id === id && x.share ? { ...x, share: { ...x.share, imageIds: up } } : x)) });
      } catch (e) {
        const text = errorText(e);
        // Gone on the server (expired, or stopped elsewhere): not shared any more.
        if (/isn't shared|expired/.test(text)) set({ notes: get().notes.map((x) => (x.id === id ? { ...x, share: null } : x)) });
        fail(e);
      }
    },

    stopShare: async (id) => {
      clearTimeout(pushes.get(id));
      pushes.delete(id);
      try {
        await native.stopNoteShare(id);
        set({ notes: get().notes.map((n) => (n.id === id ? { ...n, share: null } : n)) });
      } catch (e) {
        fail(e);
      }
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
      clearTimeout(pushes.get(id));
      pushes.delete(id);
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
  return n.title.trim() || n.body.trim().split("\n")[0]?.replace(/^(- |\[[ x]\] |#{1,3} )/i, "").slice(0, 60) || "Untitled";
}

/** The first line of the body that isn't the title, for the list. */
export function notePreview(n: Pick<Note, "title" | "body">): string {
  const lines = n.body.split("\n").map((l) => l.trim()).filter(Boolean);
  const rest = n.title.trim() ? lines : lines.slice(1);
  return rest[0]?.replace(/^(- |\[[ x]\] |#{1,3} )/i, "") ?? "";
}

// App-wide state: hot-swapping this module would split it into two copies. Reload instead.
import.meta.hot?.accept(() => window.location.reload());
