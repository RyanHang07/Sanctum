import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../components/Button";
import { FoldIcon, PlusIcon, PopOutIcon, SearchIcon } from "../../components/icons";
import { native } from "../../lib/native";
import { noteTitle, notePreview, useNotes } from "../../state/notes";
import { Glide } from "../../lib/motion";
import { gsap, RISE_FROM, RISE_TO, useGSAP } from "../../lib/gsap";
import { useMotion } from "../../lib/useMotion";
import { openNoteWindow, useNoteWindows, useNotesSync } from "../../lib/noteWindows";
import type { Note } from "../../lib/types";
import { DeleteNoteDialog, NoteEditorPane, PinGlyph, edited } from "./NoteEditorPane";

export { edited } from "./NoteEditorPane";

// Notes (decided 2026-09-30): anything that isn't a task for the day. A list on the left, the
// note on the right, autosaved, open while sealed too. v0.2: block documents (lists,
// checklists, tables, callouts, toggles, links to Sanctum); older plain notes convert on open.
// 2026-11-20: a note can open in its own window; while it does, its editor lives only there.

function NoteRow({ n, active, windowed, onOpen }: { n: Note; active: boolean; windowed: boolean; onOpen: () => void }) {
  return (
    <button
      type="button"
      aria-current={active || undefined}
      onClick={onOpen}
      className={`animate-fade-in flex w-full flex-col gap-[3px] rounded-control px-3 py-[9px] text-left transition-colors duration-ui ease-ui ${
        active ? "bg-raised" : "hover:bg-raised/60"
      }`}
    >
      <span className="flex items-center gap-[6px]">
        {n.pinned ? (
          <span className="flex text-text-2" aria-label="Pinned">
            <PinGlyph on />
          </span>
        ) : null}
        <span className={`min-w-0 grow truncate text-body font-medium ${n.title.trim() || n.body.trim() ? "text-text" : "text-muted"}`}>{noteTitle(n)}</span>
        {windowed ? (
          <span className="flex shrink-0 text-muted" aria-label="In its own window" title="In its own window">
            <PopOutIcon size={11} />
          </span>
        ) : null}
        <span className="shrink-0 font-mono text-micro text-muted">{edited(n.updatedAt)}</span>
      </span>
      <span className="truncate text-meta text-muted">{notePreview(n) || "Empty note"}</span>
    </button>
  );
}

/** Where the editor was, while the note is in its own window. Rises in. */
function InWindow({ id }: { id: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const { run } = useMotion(ref);
  useGSAP(() => {
    if (ref.current) run(() => gsap.timeline({ id: "note-in-window" }).fromTo(ref.current!, RISE_FROM, RISE_TO));
  });
  return (
    <div ref={ref} data-note-in-window={id} className="m-auto flex flex-col items-center gap-3 text-center">
      <p className="m-0 text-body text-muted">Open in its own window.</p>
      <Button variant="raised" onClick={() => void openNoteWindow(id)}>
        Bring it forward
      </Button>
    </div>
  );
}

export function NotesPage() {
  const { notes, loaded, openId, load, open, create, flush, remove } = useNotes();
  const windowed = useNoteWindows();
  useNotesSync();
  const [query, setQuery] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<Note | null>(null);
  const [deleting, setDeleting] = useState(false);
  // The list folds away for focus (decided 2026-11-16); the choice is remembered.
  const [listHidden, setListHidden] = useState(false);
  useEffect(() => void native.getSetting("notes_list_hidden").then((v) => setListHidden(v === "1"), () => undefined), []);
  const toggleList = () => {
    setListHidden(!listHidden);
    void native.setSetting("notes_list_hidden", listHidden ? "0" : "1").catch(() => undefined);
  };
  useEffect(() => {
    void load();
    return () => void flush();
  }, [load, flush]);

  const q = query.trim().toLowerCase();
  const shown = useMemo(() => (q ? notes.filter((n) => `${n.title}\n${n.body}`.toLowerCase().includes(q)) : notes), [notes, q]);
  const current = notes.find((n) => n.id === openId) ?? null;

  const confirmDeleteNote = async () => {
    if (!confirmDelete) return;
    setDeleting(true);
    try {
      await flush();
      await remove(confirmDelete.id);
      setConfirmDelete(null);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="flex h-full flex-col gap-4 px-7 pb-6 pt-5">
      <div className="flex h-control shrink-0 items-center justify-between">
        <h1 className="page-title m-0">Notes</h1>
        <Button data-new-note variant="primary" onClick={() => void create()}>
          <PlusIcon size={13} /> New note
        </Button>
      </div>
      {loaded && !notes.length ? (
        <div className="flex grow flex-col items-center justify-center gap-3 text-center">
          <h2 className="m-0 text-[16px] font-semibold">No notes yet</h2>
          <p className="m-0 max-w-[360px] text-body text-muted">For anything that isn’t a task: ideas, lists, what you learned. They stay on this PC.</p>
          <Button variant="primary" onClick={() => void create()}>
            New note
          </Button>
        </div>
      ) : (
        <div className="flex min-h-0 grow">
          {/* The list folds to its button (decided 2026-11-16): the button stays put, the search
              and the list fade as the column narrows. A 3px inset keeps the focus ring in view. */}
          <aside
            aria-label="All notes"
            className={`-mb-[3px] -ml-[3px] -mt-[3px] mr-[13px] flex shrink-0 flex-col gap-2 overflow-hidden p-[3px] transition-[width] duration-state ease-glide motion-reduce:transition-none ${listHidden ? "w-[40px]" : "w-[266px]"}`}
          >
            {/* The fold button, boxed like the search beside it (2026-11-20), with hover text
                that says what a click does. It stays put as the list folds; the search fades. */}
            <div className="flex w-[260px] shrink-0 items-center gap-2">
              <Button
                variant="ghost"
                aria-label={listHidden ? "Expand notes sidebar" : "Collapse notes sidebar"}
                title={listHidden ? "Expand notes sidebar" : "Collapse notes sidebar"}
                aria-expanded={!listHidden}
                aria-controls="notes-list"
                className="group h-control w-control shrink-0 !px-0"
                onClick={toggleList}
              >
                {/* The same 14px icon as the app sidebar's fold button (2026-11-20). */}
                <FoldIcon className={`shrink-0 ${listHidden ? "" : "rotate-180"}`} />
              </Button>
              <label
                inert={listHidden}
                className={`focus-ring-within flex h-control min-w-0 grow items-center gap-2 rounded-control border border-line-input bg-panel px-[10px] text-muted transition-opacity duration-enter ease-ui ${listHidden ? "opacity-0" : "opacity-100"}`}
              >
                <SearchIcon size={12} />
                <input
                  aria-label="Search notes"
                  placeholder="Search notes"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="focus-ring-off min-w-0 grow bg-transparent text-body text-text placeholder:text-muted"
                />
              </label>
            </div>
            <nav id="notes-list" inert={listHidden} className={`flex min-h-0 w-[260px] grow flex-col gap-px overflow-y-auto transition-opacity duration-enter ease-ui ${listHidden ? "opacity-0" : "opacity-100"}`}>
              {shown.map((n) => (
                // Glides up as it becomes the most recently edited.
                <Glide key={n.id}>
                  <NoteRow n={n} active={n.id === openId} windowed={windowed.includes(n.id)} onOpen={() => open(n.id)} />
                </Glide>
              ))}
              {!shown.length ? <p className="m-0 px-3 py-2 text-meta text-muted">No notes match.</p> : null}
            </nav>
          </aside>
          <section className="flex min-h-0 min-w-0 grow flex-col rounded-panel border border-line bg-panel py-5 pl-4 pr-8">
            {!current ? (
              <p className="m-auto text-body text-muted">Pick a note, or write a new one.</p>
            ) : windowed.includes(current.id) ? (
              <InWindow key={current.id} id={current.id} />
            ) : (
              <NoteEditorPane key={current.id} n={current} onRequestDelete={() => setConfirmDelete(current)} onPopOut={() => void openNoteWindow(current.id)} />
            )}
          </section>
        </div>
      )}
      {confirmDelete ? (
        <DeleteNoteDialog
          note={confirmDelete}
          deleting={deleting}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => void confirmDeleteNote()}
          // The Delete button goes with the note: land on New note, else the list.
          fallback={() => document.querySelector<HTMLElement>("[data-new-note]") ?? document.getElementById("notes-list")}
        />
      ) : null}
    </div>
  );
}
