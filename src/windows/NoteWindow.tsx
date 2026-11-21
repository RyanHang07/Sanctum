import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Toast } from "../components/Toast";
import { EVENTS, inTauri, native, onNative } from "../lib/native";
import { gsap, RISE_FROM, RISE_TO, useGSAP } from "../lib/gsap";
import { useMotion } from "../lib/useMotion";
import { useNotesSync } from "../lib/noteWindows";
import { useNotes } from "../state/notes";
import { DeleteNoteDialog, NoteEditorPane } from "../pages/notes/NoteEditorPane";
import type { Note } from "../lib/types";

// A note in its own window (2026-11-20): the Notes page's editor for this one note, on the page
// color with the app's padding. No list, no sidebar. Its title is the window's title.

/** The window title for a note: its title, or "Note" (as note_windows.rs names it). */
export function noteWindowTitle(n: Pick<Note, "title"> | null | undefined): string {
  return n?.title.trim() || "Note";
}

export function NoteWindow({ id }: { id: number }) {
  const n = useNotes((s) => s.notes.find((x) => x.id === id) ?? null);
  const loaded = useNotes((s) => s.loaded);
  const [confirm, setConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  useNotesSync();

  useEffect(() => {
    useNotes.setState({ openId: id });
    void useNotes.getState().load();
    const { flush } = useNotes.getState();
    // Leaving the window saves what's waiting: switching away, quitting from the tray, closing.
    const save = () => void flush();
    window.addEventListener("blur", save);
    window.addEventListener("pagehide", save);
    // Asked to close (the title bar's X): save, then close.
    const off = onNative<number>(EVENTS.noteWindowClosing, () => void flush().finally(() => void native.noteWindowClose(id)));
    return () => {
      window.removeEventListener("blur", save);
      window.removeEventListener("pagehide", save);
      void off.then((f) => f());
      void flush();
    };
  }, [id]);

  // The window's title follows the note's.
  const title = noteWindowTitle(n);
  useEffect(() => {
    document.title = title;
    if (inTauri()) void getCurrentWindow().setTitle(title).catch(() => undefined);
  }, [title]);

  // The content rises in once, when the note first shows.
  const ref = useRef<HTMLDivElement>(null);
  const { run } = useMotion(ref);
  const shown = !!n;
  useGSAP(
    () => {
      if (shown && ref.current) run(() => gsap.timeline({ id: "note-window" }).fromTo(ref.current!, RISE_FROM, RISE_TO));
    },
    { dependencies: [shown] },
  );

  const remove = async () => {
    setDeleting(true);
    try {
      const { flush, remove: del } = useNotes.getState();
      await flush();
      await del(id);
      // Deleting closes the note's window (the app does it in delete_note; this covers the preview).
      if (!useNotes.getState().notes.some((x) => x.id === id)) await native.noteWindowClose(id);
    } finally {
      setDeleting(false);
      setConfirm(false);
    }
  };

  return (
    <div className="relative flex h-full flex-col bg-app px-7 pb-6 pt-5">
      <div ref={ref} className="flex min-h-0 grow flex-col">
        {n ? (
          <NoteEditorPane n={n} onRequestDelete={() => setConfirm(true)} />
        ) : loaded ? (
          <p className="m-auto text-body text-muted">This note was deleted.</p>
        ) : null}
      </div>
      <Toast />
      {confirm && n ? (
        <DeleteNoteDialog
          note={n}
          deleting={deleting}
          onCancel={() => setConfirm(false)}
          onConfirm={() => void remove()}
          fallback={() => document.querySelector<HTMLElement>("[aria-label='Title']")}
        />
      ) : null}
    </div>
  );
}
