import { useRef, useState } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TableKit } from "@tiptap/extension-table";
import { Placeholder } from "@tiptap/extensions";
import { Details, DetailsContent, DetailsSummary } from "@tiptap/extension-details";
import { NodeSelection } from "@tiptap/pm/state";
import { BlockMove, Callout, SanctumMention, SlashCommands, openLink } from "./extensions";
import type { DocNode } from "../../lib/noteDoc";

// The block editor for notes (and the journal, v0.2): Notion-style. Type "/" for blocks, "@" to
// link something in Sanctum, markdown shortcuts as you type ("- ", "1. ", "[] ", "## ", "> ",
// "---"). Drag a block by its handle, or move it with Alt+Up/Down.

export interface NoteChange {
  doc: string;
  /** Plain text, one block per line: what search, previews, and exports read. */
  text: string;
}

export function editorExtensions(placeholder: string) {
  return [
    StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: { openOnClick: false, autolink: true } }),
    TaskList,
    TaskItem.configure({ nested: true }),
    TableKit.configure({ table: { resizable: true } }),
    Details.configure({ persist: true }),
    DetailsSummary,
    DetailsContent,
    Callout,
    BlockMove,
    SlashCommands,
    SanctumMention,
    Placeholder.configure({ placeholder, includeChildren: false }),
  ];
}

/** Nested blocks (a list in a checklist item) each add a break: one line per item is enough. */
export const plainText = (editor: Editor) =>
  editor
    .getText({ blockSeparator: "\n" })
    .split("\n")
    .map((l) => l.trimEnd())
    .filter(Boolean)
    .join("\n");

export const changeOf = (editor: Editor): NoteChange => ({ doc: JSON.stringify(editor.getJSON()), text: plainText(editor) });

/** The top-level block under the pointer: its position and element. */
function blockAt(editor: Editor, target: EventTarget | null): { pos: number; el: HTMLElement } | null {
  const root = editor.view.dom;
  let el = target instanceof HTMLElement ? target : null;
  while (el && el.parentElement !== root) el = el.parentElement;
  if (!el || el.parentElement !== root) return null;
  const inside = editor.view.posAtDOM(el, 0);
  const $pos = editor.state.doc.resolve(Math.max(0, Math.min(inside, editor.state.doc.content.size)));
  return { pos: $pos.depth >= 1 ? $pos.before(1) : inside, el };
}

export function NoteEditor({ doc, label, placeholder, onChange }: { doc: DocNode; label: string; placeholder: string; onChange: (c: NoteChange) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [handle, setHandle] = useState<{ top: number; pos: number } | null>(null);
  const editor = useEditor({
    extensions: editorExtensions(placeholder),
    content: doc,
    immediatelyRender: true,
    editorProps: {
      attributes: { "aria-label": label, class: "note-doc", spellcheck: "true" },
      handleClickOn: (_view, _pos, node) => {
        if (node.type.name === "mention" && typeof node.attrs.id === "string") {
          openLink(node.attrs.id);
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor }) => onChange(changeOf(editor)),
  });

  const track = (e: React.MouseEvent) => {
    if (!editor || !box.current) return;
    const hit = blockAt(editor, e.target);
    if (!hit) return;
    const top = hit.el.getBoundingClientRect().top - box.current.getBoundingClientRect().top;
    if (handle?.pos !== hit.pos || handle.top !== top) setHandle({ top, pos: hit.pos });
  };

  return (
    <div ref={box} className="note-editor relative" onMouseMove={track} onMouseLeave={() => setHandle(null)}>
      {editor && handle ? (
        <button
          type="button"
          draggable
          aria-label="Drag to move this block"
          title="Drag to move · Alt+↑ / Alt+↓"
          tabIndex={-1}
          onMouseDown={(e) => e.stopPropagation()}
          onDragStart={(e) => {
            // Select the block and hand it to ProseMirror's own drag-and-drop as a move.
            const { view } = editor;
            view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, handle.pos)));
            const slice = view.state.selection.content();
            const { dom, text } = view.serializeForClipboard(slice);
            e.dataTransfer.clearData();
            e.dataTransfer.setData("text/html", dom.innerHTML);
            e.dataTransfer.setData("text/plain", text);
            e.dataTransfer.effectAllowed = "move";
            const el = view.nodeDOM(handle.pos);
            if (el instanceof HTMLElement) e.dataTransfer.setDragImage(el, 0, 0);
            (view as unknown as { dragging: { slice: typeof slice; move: boolean } | null }).dragging = { slice, move: true };
          }}
          style={{ top: handle.top + 2 }}
          className="absolute -left-6 flex h-6 w-5 cursor-grab items-center justify-center rounded-control text-faint opacity-70 transition-[opacity,color,background-color] duration-ui ease-ui hover:bg-line-soft hover:text-text-2 hover:opacity-100 active:cursor-grabbing"
        >
          <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor" aria-hidden="true">
            {[2, 7, 12].map((y) => (
              <g key={y}>
                <circle cx="2.5" cy={y} r="1.2" />
                <circle cx="7.5" cy={y} r="1.2" />
              </g>
            ))}
          </svg>
        </button>
      ) : null}
      <EditorContent editor={editor} />
    </div>
  );
}
