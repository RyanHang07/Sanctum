import { useRef, useState } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TableKit } from "@tiptap/extension-table";
import { Placeholder } from "@tiptap/extensions";
import { Details, DetailsContent, DetailsSummary } from "@tiptap/extension-details";
import { NodeSelection } from "@tiptap/pm/state";
import { BlockMove, Callout, NoteImage, SanctumMention, SlashCommands, insertImages, openLink } from "./extensions";
import { IMAGE_TYPES } from "../../lib/noteImages";
import { DEFAULT_NOTE_SIZE, NoteToolbar } from "./NoteToolbar";
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
    NoteImage,
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

/**
 * The top-level block on the pointer's row, found by height, so the text, the margins, and the
 * gutter where the handle sits all count (not only the element under the pointer).
 */
function blockAtY(editor: Editor, y: number): { pos: number; el: HTMLElement } | null {
  const blocks = [...editor.view.dom.children].filter((c): c is HTMLElement => c instanceof HTMLElement);
  let best: HTMLElement | null = null;
  for (const el of blocks) {
    const r = el.getBoundingClientRect();
    // Each block owns the band down to the next one's top, so the gaps between blocks count too.
    if (y >= r.top - 4) best = el;
    else break;
  }
  if (!best) return null;
  const inside = editor.view.posAtDOM(best, 0);
  const $pos = editor.state.doc.resolve(Math.max(0, Math.min(inside, editor.state.doc.content.size)));
  return { pos: $pos.depth >= 1 ? $pos.before(1) : inside, el: best };
}

/** The gutter on the left that holds the handle, inside the editor so reaching it never leaves. */
export const GUTTER = 32;

export function NoteEditor({
  doc,
  label,
  placeholder,
  onChange,
  size = DEFAULT_NOTE_SIZE,
  onSize,
}: {
  doc: DocNode;
  label: string;
  placeholder: string;
  onChange: (c: NoteChange) => void;
  /** Text size in px, for every note; the toolbar changes it. */
  size?: number;
  onSize?: (px: number) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Editor | null>(null);
  const [handle, setHandle] = useState<{ top: number; pos: number } | null>(null);
  // A short grace period before the handle hides, so a quick move toward it doesn't lose it.
  const hide = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const editor = useEditor({
    extensions: editorExtensions(placeholder),
    content: doc,
    immediatelyRender: true,
    editorProps: {
      attributes: { "aria-label": label, class: "note-doc", spellcheck: "true" },
      // Pasted or dropped image files go in the note (stored by Sanctum).
      handlePaste: (_view, event) => {
        const files = [...(event.clipboardData?.files ?? [])].filter((f) => IMAGE_TYPES.includes(f.type));
        if (!files.length || !editorRef.current) return false;
        void insertImages(editorRef.current, files);
        return true;
      },
      handleDrop: (view, event, _slice, moved) => {
        const files = [...(event.dataTransfer?.files ?? [])].filter((f) => IMAGE_TYPES.includes(f.type));
        if (moved || !files.length || !editorRef.current) return false;
        event.preventDefault();
        const at = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
        void insertImages(editorRef.current, files, at);
        return true;
      },
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
  editorRef.current = editor;

  const track = (e: React.MouseEvent) => {
    clearTimeout(hide.current);
    // Over the handle itself: keep it where it is.
    if (!editor || !box.current || (e.target as HTMLElement).closest?.("[data-block-handle]")) return;
    const hit = blockAtY(editor, e.clientY);
    if (!hit) return;
    const top = hit.el.getBoundingClientRect().top - box.current.getBoundingClientRect().top;
    if (handle?.pos !== hit.pos || handle.top !== top) setHandle({ top, pos: hit.pos });
  };
  const leave = () => {
    clearTimeout(hide.current);
    hide.current = setTimeout(() => setHandle(null), 250);
  };

  return (
    <div ref={box} className="note-editor relative" style={{ paddingLeft: GUTTER, ["--note-size" as string]: `${size}px` }} onMouseMove={track} onMouseLeave={leave}>
      {editor && onSize ? (
        <div className="sticky top-0 z-10 -mt-px mb-3 bg-panel pb-1 pt-px">
          <NoteToolbar editor={editor} size={size} onSize={onSize} />
        </div>
      ) : null}
      {editor && handle ? (
        <button
          type="button"
          draggable
          aria-label="Drag to move this block"
          data-block-handle=""
          onMouseEnter={() => clearTimeout(hide.current)}
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
          style={{ top: handle.top - 2, left: 2, width: GUTTER - 8 }}
          className="absolute z-[5] flex h-8 cursor-grab items-center justify-center rounded-control text-faint opacity-70 transition-[opacity,color,background-color,top] duration-ui ease-ui hover:bg-line-soft hover:text-text-2 hover:opacity-100 active:cursor-grabbing"
        >
          <svg width="12" height="18" viewBox="0 0 12 18" fill="currentColor" aria-hidden="true">
            {[3, 9, 15].map((y) => (
              <g key={y}>
                <circle cx="3" cy={y} r="1.6" />
                <circle cx="9" cy={y} r="1.6" />
              </g>
            ))}
          </svg>
        </button>
      ) : null}
      <EditorContent editor={editor} />
    </div>
  );
}
