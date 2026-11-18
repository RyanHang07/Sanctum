import { useEffect, useMemo, useState } from "react";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/controls";
import { FoldIcon, PlusIcon, SearchIcon } from "../../components/icons";
import { native } from "../../lib/native";
import { ToolIcon } from "../../components/editor/toolIcons";
import { noteTitle, notePreview, useNotes } from "../../state/notes";
import { GUTTER, NoteEditor } from "../../components/editor/NoteEditor";
import { docOf } from "../../lib/noteDoc";
import { ShareMenu } from "./ShareMenu";
import { Glide } from "../../lib/motion";
import { clock } from "../../lib/time";
import { shortDate } from "../../lib/trackers";
import type { Note } from "../../lib/types";

// Notes (decided 2026-09-30): anything that isn't a task for the day. A list on the left, the
// note on the right, autosaved, open while sealed too. v0.2: block documents (lists,
// checklists, tables, callouts, toggles, links to Sanctum); older plain notes convert on open.

/** "2:14 PM" today, "Yesterday", or "Sep 28". */
export function edited(ms: number, now = Date.now()): string {
  const d = new Date(ms);
  const today = new Date(now);
  const midnight = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  if (ms >= midnight) return clock(d);
  if (ms >= midnight - 86_400_000) return "Yesterday";
  return shortDate(ms);
}

function PinGlyph({ on }: { on: boolean }) {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill={on ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 4h6l-1 6 4 3v2H6v-2l4-3z" />
      <path d="M12 15v5" />
    </svg>
  );
}

function NoteRow({ n, active, onOpen }: { n: Note; active: boolean; onOpen: () => void }) {
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
        <span className="shrink-0 font-mono text-micro text-muted">{edited(n.updatedAt)}</span>
      </span>
      <span className="truncate text-meta text-muted">{notePreview(n) || "Empty note"}</span>
    </button>
  );
}

const PLACEHOLDER = "Write, or type “/” for blocks and “@” to link to Sanctum";

function Editor({ n, onRequestDelete }: { n: Note; onRequestDelete: () => void }) {
  const { edit, pin, fontSize, setFontSize } = useNotes();
  // The document as it was when the note opened; the editor owns it from there.
  const doc = useMemo(() => docOf(n), [n.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const focusBody = () => document.querySelector<HTMLElement>(".note-doc")?.focus();
  return (
    <article aria-label={noteTitle(n)} className="flex min-h-0 grow flex-col gap-3">
      {/* Lined up with the note's text, past the gutter where blocks' drag handle sits. */}
      <div className="flex items-center gap-2" style={{ paddingLeft: GUTTER }}>
        {/* The ring sits on this wrapper, so the borderless title shows focus without a box of its own. */}
        <span className="focus-ring-within flex min-w-0 grow rounded-control">
        <input
          aria-label="Title"
          value={n.title}
          placeholder="Untitled"
          maxLength={200}
          onChange={(e) => edit(n.id, { title: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              focusBody();
            }
          }}
          className="focus-ring-off min-w-0 grow bg-transparent text-page-title font-semibold tracking-[-0.02em] text-text placeholder:text-muted"
        />
        </span>
        <span className="shrink-0 text-meta text-muted">
          Edited <span className="font-mono">{edited(n.updatedAt)}</span>
        </span>
        <ShareMenu n={n} />
        <button
          type="button"
          aria-pressed={n.pinned}
          aria-label={n.pinned ? "Unpin" : "Pin to top"}
          title={n.pinned ? "Unpin" : "Pin to top"}
          onClick={() => void pin(n.id, !n.pinned)}
          className={`flex h-7 w-7 items-center justify-center rounded-control transition-colors duration-ui ease-ui ${n.pinned ? "bg-raised text-text" : "text-muted hover:bg-raised hover:text-text"}`}
        >
          <PinGlyph on={n.pinned} />
        </button>
        <button
          type="button"
          aria-label="Delete note"
          title="Delete note"
          onClick={onRequestDelete}
          className="flex h-7 w-7 items-center justify-center rounded-control text-muted transition-colors duration-ui ease-ui hover:bg-raised hover:text-text"
        >
          <ToolIcon name="trash" size={13} />
        </button>
      </div>
      <div className="min-h-0 grow overflow-y-auto pr-1">
        <NoteEditor
          doc={doc}
          label="Note text"
          placeholder={PLACEHOLDER}
          size={fontSize}
          onSize={setFontSize}
          onChange={(c) => edit(n.id, { doc: c.doc, body: c.text })}
        />
      </div>
    </article>
  );
}

export function NotesPage() {
  const { notes, loaded, openId, load, open, create, flush, remove } = useNotes();
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
            <div className="flex w-[260px] shrink-0 items-center gap-2">
              <Button
                variant="quiet"
                aria-label={listHidden ? "Show notes list" : "Hide notes list"}
                aria-expanded={!listHidden}
                aria-controls="notes-list"
                className="group h-control w-[34px] shrink-0 px-0"
                onClick={toggleList}
              >
                <FoldIcon size={20} className={listHidden ? "" : "rotate-180"} />
              </Button>
            <label inert={listHidden} className={`focus-ring-within flex h-control min-w-0 grow items-center gap-2 rounded-control border border-line-input bg-panel px-[10px] text-muted transition-opacity duration-enter ease-ui ${listHidden ? "opacity-0" : "opacity-100"}`}>
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
                  <NoteRow n={n} active={n.id === openId} onOpen={() => open(n.id)} />
                </Glide>
              ))}
              {!shown.length ? <p className="m-0 px-3 py-2 text-meta text-muted">No notes match.</p> : null}
            </nav>
          </aside>
          <section className="flex min-h-0 min-w-0 grow flex-col rounded-panel border border-line bg-panel py-5 pl-4 pr-8">
            {current ? <Editor key={current.id} n={current} onRequestDelete={() => setConfirmDelete(current)} /> : <p className="m-auto text-body text-muted">Pick a note, or write a new one.</p>}
          </section>
        </div>
      )}
      {confirmDelete ? (
        <Dialog
          label="Delete this note"
          alert
          onClose={() => (deleting ? null : setConfirmDelete(null))}
          // The Delete button goes with the note: land on New note, else the list.
          fallback={() => document.querySelector<HTMLElement>("[data-new-note]") ?? document.getElementById("notes-list")}
          width={420}
          top={170}
        >
          <div className="flex flex-col gap-4 p-5">
            <div className="flex flex-col gap-1">
              <h2 className="m-0 text-[16px] font-semibold text-text">Delete this note</h2>
              <p className="m-0 text-body text-muted">
                This deletes <span className="text-text">“{noteTitle(confirmDelete)}”</span>. This cannot be undone.
              </p>
            </div>
            <div className="flex items-center justify-end gap-2">
              <Button variant="quiet" onClick={() => setConfirmDelete(null)} disabled={deleting}>
                Cancel
              </Button>
              <Button
                variant="raised"
                onClick={() => void confirmDeleteNote()}
                disabled={deleting}
                className="border-broken-line bg-broken-tint text-broken-text enabled:hover:bg-broken/20"
              >
                {deleting ? "Deleting…" : "Delete"}
              </Button>
            </div>
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}
