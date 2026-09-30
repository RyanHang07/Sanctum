import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../components/Button";
import { CheckIcon, PlusIcon, SearchIcon, XIcon } from "../../components/icons";
import { noteTitle, notePreview, toggleLine, useNotes } from "../../state/notes";
import { clock } from "../../lib/time";
import { shortDate } from "../../lib/trackers";
import type { Note } from "../../lib/types";

// Notes (decided 2026-09-30): anything that isn't a task for the day. A list on the left, the
// note on the right. Plain text, autosaved; lines starting "- " read as a list and "[ ]" as a
// checkbox you can tick without editing. Open while sealed too.

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

/** The body read-only: lists and tickable checkboxes. Click anywhere else to edit. */
function Rendered({ body, onToggle, onEdit }: { body: string; onToggle: (line: number) => void; onEdit: () => void }) {
  const lines = body.split("\n");
  return (
    <div role="document" aria-label="Note" onClick={onEdit} className="min-h-full cursor-text whitespace-pre-wrap break-words text-[14px] leading-[1.6] text-text">
      {body.trim() ? (
        lines.map((line, i) => {
          const box = /^(\s*)\[( |x)\] ?(.*)$/i.exec(line);
          if (box) {
            const done = box[2]!.toLowerCase() === "x";
            return (
              <div key={i} className="flex items-start gap-[10px]" style={{ paddingLeft: `${box[1]!.length * 8}px` }}>
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={done}
                  aria-label={box[3] || "Checkbox"}
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggle(i);
                  }}
                  className={`mt-[4px] box-border flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-[4px] transition-colors duration-ui ease-ui ${
                    done ? "border border-sealed bg-sealed text-sealed-on" : "border-[1.5px] border-check-line hover:border-sealed"
                  }`}
                >
                  {done ? <CheckIcon size={9} /> : null}
                </button>
                <span className={done ? "text-faint line-through" : ""}>{box[3]}</span>
              </div>
            );
          }
          const bullet = /^(\s*)- (.*)$/.exec(line);
          if (bullet) {
            return (
              <div key={i} className="flex items-start gap-[10px]" style={{ paddingLeft: `${bullet[1]!.length * 8}px` }}>
                <span aria-hidden="true" className="mt-[10px] h-[4px] w-[4px] shrink-0 rounded-full bg-muted" />
                <span>{bullet[2]}</span>
              </div>
            );
          }
          return <div key={i}>{line || " "}</div>;
        })
      ) : (
        <span className="text-faint">Write anything. Lines starting “- ” make a list, “[ ] ” a checkbox.</span>
      )}
    </div>
  );
}

function Editor({ n }: { n: Note }) {
  const { edit, pin, remove, flush } = useNotes();
  const [editing, setEditing] = useState(!n.body);
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => setEditing(!n.body), [n.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (editing) area.current?.focus();
  }, [editing]);
  return (
    <article aria-label={noteTitle(n)} className="flex min-h-0 grow flex-col gap-3">
      <div className="flex items-center gap-2">
        <input
          aria-label="Title"
          value={n.title}
          placeholder="Untitled"
          maxLength={200}
          onChange={(e) => edit(n.id, { title: e.target.value })}
          onKeyDown={(e) => e.key === "Enter" && setEditing(true)}
          className="min-w-0 grow bg-transparent text-[20px] font-semibold tracking-[-0.02em] text-text outline-none placeholder:text-faint"
        />
        <span className="shrink-0 text-meta text-faint">Edited {edited(n.updatedAt)}</span>
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
        {editing ? (
          <textarea
            ref={area}
            aria-label="Note text"
            value={n.body}
            placeholder="Write anything. Lines starting “- ” make a list, “[ ] ” a checkbox."
            onChange={(e) => edit(n.id, { body: e.target.value })}
            onBlur={() => {
              void flush();
              if (n.body.trim()) setEditing(false);
            }}
            onKeyDown={(e) => e.key === "Escape" && (e.currentTarget as HTMLTextAreaElement).blur()}
            className="h-full min-h-[320px] w-full resize-none bg-transparent text-[14px] leading-[1.6] text-text outline-none placeholder:text-faint"
          />
        ) : (
          <Rendered body={n.body} onEdit={() => setEditing(true)} onToggle={(i) => edit(n.id, { body: toggleLine(n.body, i) })} />
        )}
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
          <section className="flex min-h-0 grow flex-col rounded-panel border border-line bg-panel px-6 py-5">
            {current ? <Editor key={current.id} n={current} /> : <p className="m-auto text-body text-muted">Pick a note, or write a new one.</p>}
          </section>
        </div>
      )}
    </div>
  );
}
