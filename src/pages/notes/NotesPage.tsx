import { useEffect, useMemo, useState } from "react";
import { Button } from "../../components/Button";
import { PlusIcon, SearchIcon, XIcon } from "../../components/icons";
import { noteTitle, notePreview, useNotes } from "../../state/notes";
import { GUTTER, NoteEditor } from "../../components/editor/NoteEditor";
import { docOf } from "../../lib/noteDoc";
import { ShareMenu } from "./ShareMenu";
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
        active ? "bg-raised" : "hover:bg-line-soft"
      }`}
    >
      <span className="flex items-center gap-[6px]">
        {n.pinned ? (
          <span className="text-sealed-text" aria-label="Pinned">
            <PinGlyph on />
          </span>
        ) : null}
        <span className={`min-w-0 grow truncate text-body font-medium ${n.title.trim() || n.body.trim() ? "text-text" : "text-muted"}`}>{noteTitle(n)}</span>
        <span className="shrink-0 font-mono text-[11px] text-faint">{edited(n.updatedAt)}</span>
      </span>
      <span className="truncate text-meta text-muted">{notePreview(n) || "No more text"}</span>
    </button>
  );
}

const PLACEHOLDER = "Write, or type “/” for blocks and “@” to link to Sanctum";

function Editor({ n }: { n: Note }) {
  const { edit, pin, remove, fontSize, setFontSize } = useNotes();
  // The document as it was when the note opened; the editor owns it from there.
  const doc = useMemo(() => docOf(n), [n.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const focusBody = () => document.querySelector<HTMLElement>(".note-doc")?.focus();
  return (
    <article aria-label={noteTitle(n)} className="flex min-h-0 grow flex-col gap-3">
      {/* Lined up with the note's text, past the gutter where blocks' drag handle sits. */}
      <div className="flex items-center gap-2" style={{ paddingLeft: GUTTER }}>
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
          className="min-w-0 grow bg-transparent text-[20px] font-semibold tracking-[-0.02em] text-text outline-none placeholder:text-faint"
        />
        <span className="shrink-0 text-meta text-faint">Edited {edited(n.updatedAt)}</span>
        <ShareMenu n={n} />
        <button
          type="button"
          aria-pressed={n.pinned}
          aria-label={n.pinned ? "Unpin" : "Pin to top"}
          title={n.pinned ? "Unpin" : "Pin to top"}
          onClick={() => void pin(n.id, !n.pinned)}
          className={`flex h-7 w-7 items-center justify-center rounded-control transition-colors duration-ui ease-ui hover:bg-raised ${n.pinned ? "text-sealed-text" : "text-muted hover:text-text"}`}
        >
          <PinGlyph on={n.pinned} />
        </button>
        <button
          type="button"
          aria-label="Delete note"
          title="Delete note"
          onClick={() => void remove(n.id)}
          className="flex h-7 w-7 items-center justify-center rounded-control text-muted transition-colors duration-ui ease-ui hover:bg-raised hover:text-text"
        >
          <XIcon size={12} />
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
  const { notes, loaded, openId, load, open, create, flush } = useNotes();
  const [query, setQuery] = useState("");
  useEffect(() => {
    void load();
    return () => void flush();
  }, [load, flush]);

  const q = query.trim().toLowerCase();
  const shown = useMemo(() => (q ? notes.filter((n) => `${n.title}\n${n.body}`.toLowerCase().includes(q)) : notes), [notes, q]);
  const current = notes.find((n) => n.id === openId) ?? null;

  return (
    <div className="flex h-full flex-col gap-4 px-7 pb-6 pt-5">
      <div className="flex h-control shrink-0 items-center justify-between">
        <h1 className="page-title m-0">Notes</h1>
        <Button variant="primary" onClick={() => void create()}>
          <PlusIcon size={13} /> New note
        </Button>
      </div>
      {loaded && !notes.length ? (
        <div className="flex grow flex-col items-center justify-center gap-3 text-center">
          <h2 className="m-0 text-[16px] font-semibold">No notes yet</h2>
          <p className="m-0 max-w-[360px] text-body text-muted">For anything that isn’t a task: ideas, lists, what you learned. They stay on this PC.</p>
          <Button variant="primary" onClick={() => void create()}>
            Write a note
          </Button>
        </div>
      ) : (
        <div className="flex min-h-0 grow gap-4">
          <aside aria-label="All notes" className="flex w-[260px] shrink-0 flex-col gap-2">
            <label className="flex h-control shrink-0 items-center gap-2 rounded-control border border-line bg-panel px-[10px] text-muted focus-within:border-sealed">
              <SearchIcon size={12} />
              <input
                aria-label="Search notes"
                placeholder="Search notes"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="min-w-0 grow bg-transparent text-body text-text outline-none placeholder:text-faint"
              />
            </label>
            <nav className="flex min-h-0 grow flex-col gap-px overflow-y-auto">
              {shown.map((n) => (
                <NoteRow key={n.id} n={n} active={n.id === openId} onOpen={() => open(n.id)} />
              ))}
              {!shown.length ? <p className="m-0 px-3 py-2 text-meta text-muted">No notes match.</p> : null}
            </nav>
          </aside>
          <section className="flex min-h-0 grow flex-col rounded-panel border border-line bg-panel py-5 pl-4 pr-8">
            {current ? <Editor key={current.id} n={current} /> : <p className="m-auto text-body text-muted">Pick a note, or write a new one.</p>}
          </section>
        </div>
      )}
    </div>
  );
}
