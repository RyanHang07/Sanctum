import { useMemo } from "react";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/controls";
import { PopOutIcon } from "../../components/icons";
import { ToolIcon } from "../../components/editor/toolIcons";
import { GUTTER, NoteEditor } from "../../components/editor/NoteEditor";
import { noteTitle, useNotes } from "../../state/notes";
import { docOf } from "../../lib/noteDoc";
import { clock } from "../../lib/time";
import { shortDate } from "../../lib/trackers";
import type { Note } from "../../lib/types";
import { ShareMenu } from "./ShareMenu";

// One note's editor: its title, the text, share, pin, and delete. The Notes page and a note's own
// window (2026-11-20) both show this, never both for the same note at once.

/** "2:14 PM" today, "Yesterday", or "Sep 28". */
export function edited(ms: number, now = Date.now()): string {
  const d = new Date(ms);
  const today = new Date(now);
  const midnight = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  if (ms >= midnight) return clock(d);
  if (ms >= midnight - 86_400_000) return "Yesterday";
  return shortDate(ms);
}

export function PinGlyph({ on }: { on: boolean }) {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill={on ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 4h6l-1 6 4 3v2H6v-2l4-3z" />
      <path d="M12 15v5" />
    </svg>
  );
}

const PLACEHOLDER = "Write, or type “/” for blocks and “@” to link to Sanctum";

const ICON_BUTTON = "flex h-7 w-7 items-center justify-center rounded-control transition-colors duration-ui ease-ui";

/** The note's editor. `onPopOut` adds "Open in new window" beside the pin (the Notes page only). */
export function NoteEditorPane({ n, onRequestDelete, onPopOut }: { n: Note; onRequestDelete: () => void; onPopOut?: () => void }) {
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
        {onPopOut ? (
          <button type="button" aria-label="Open in new window" title="Open in new window" onClick={onPopOut} className={`${ICON_BUTTON} text-muted hover:bg-raised hover:text-text`}>
            <PopOutIcon size={13} />
          </button>
        ) : null}
        <button
          type="button"
          aria-pressed={n.pinned}
          aria-label={n.pinned ? "Unpin" : "Pin to top"}
          title={n.pinned ? "Unpin" : "Pin to top"}
          onClick={() => void pin(n.id, !n.pinned)}
          className={`${ICON_BUTTON} ${n.pinned ? "bg-raised text-text" : "text-muted hover:bg-raised hover:text-text"}`}
        >
          <PinGlyph on={n.pinned} />
        </button>
        <button type="button" aria-label="Delete note" title="Delete note" onClick={onRequestDelete} className={`${ICON_BUTTON} text-muted hover:bg-danger-tint hover:text-danger-text`}>
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

/** "Delete this note": the confirm both the Notes page and a note's window use. */
export function DeleteNoteDialog({
  note,
  deleting,
  onCancel,
  onConfirm,
  fallback,
}: {
  note: Note;
  deleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  fallback: () => HTMLElement | null;
}) {
  return (
    <Dialog label="Delete this note" alert onClose={() => (deleting ? null : onCancel())} fallback={fallback} width={420} top={170}>
      <div className="flex flex-col gap-4 p-5">
        <div className="flex flex-col gap-1">
          <h2 className="m-0 text-[16px] font-semibold text-text">Delete this note</h2>
          <p className="m-0 text-body text-muted">
            This deletes <span className="text-text">“{noteTitle(note)}”</span>. This cannot be undone.
          </p>
        </div>
        <div className="flex items-center justify-end gap-2">
          <Button variant="quiet" onClick={onCancel} disabled={deleting}>
            Cancel
          </Button>
          <Button variant="danger" onClick={onConfirm} disabled={deleting}>
            {deleting ? "Deleting…" : "Delete"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
