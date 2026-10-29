import type { ReactNode } from "react";
import { useEditorState, type Editor } from "@tiptap/react";

// The small row of tools above a note (v0.2): text size for every note, then the formats you'd
// otherwise type ("/" and markdown still work). Buttons keep the caret in the note.

export const NOTE_SIZES = [12, 13, 14, 15, 16, 18, 20, 22] as const;
export const DEFAULT_NOTE_SIZE = 14;

function Tool({ label, active, onRun, children, wide = false }: { label: string; active?: boolean; onRun: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active ?? undefined}
      title={label}
      // Don't take focus from the note: the format applies to the selection there.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onRun}
      className={`flex h-7 shrink-0 items-center justify-center rounded-control text-meta transition-colors duration-ui ease-ui ${wide ? "px-2" : "w-7"} ${
        active ? "bg-raised text-text" : "text-muted hover:bg-line-soft hover:text-text"
      }`}
    >
      {children}
    </button>
  );
}

const Divider = () => <span aria-hidden="true" className="mx-1 h-4 w-px shrink-0 bg-line" />;

export function NoteToolbar({ editor, size, onSize }: { editor: Editor; size: number; onSize: (px: number) => void }) {
  const on = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      strike: e.isActive("strike"),
      h1: e.isActive("heading", { level: 1 }),
      h2: e.isActive("heading", { level: 2 }),
      bullets: e.isActive("bulletList"),
      numbers: e.isActive("orderedList"),
      tasks: e.isActive("taskList"),
      callout: e.isActive("callout"),
    }),
  });
  const at = NOTE_SIZES.indexOf(size as (typeof NOTE_SIZES)[number]);
  const step = (d: -1 | 1) => {
    const next = NOTE_SIZES[Math.max(0, Math.min(NOTE_SIZES.length - 1, (at < 0 ? NOTE_SIZES.indexOf(DEFAULT_NOTE_SIZE) : at) + d))]!;
    if (next !== size) onSize(next);
  };
  const run = (f: (c: ReturnType<Editor["chain"]>) => ReturnType<Editor["chain"]>) => f(editor.chain().focus()).run();

  return (
    <div role="toolbar" aria-label="Note tools" className="flex shrink-0 flex-wrap items-center gap-px rounded-control border border-line bg-app/40 p-[3px]">
      <span className="flex items-center" role="group" aria-label="Text size">
        <Tool label="Smaller text" onRun={() => step(-1)}>
          <span className="font-semibold">A</span>
          <span className="text-[9px]">−</span>
        </Tool>
        <span aria-live="polite" aria-label={`Text size ${size}`} className="w-7 text-center font-mono text-[11px] text-text-2">
          {size}
        </span>
        <Tool label="Larger text" onRun={() => step(1)}>
          <span className="text-[15px] font-semibold">A</span>
          <span className="text-[9px]">+</span>
        </Tool>
      </span>
      <Divider />
      <Tool label="Bold" active={on.bold} onRun={() => run((c) => c.toggleBold())}>
        <span className="font-bold">B</span>
      </Tool>
      <Tool label="Italic" active={on.italic} onRun={() => run((c) => c.toggleItalic())}>
        <span className="font-serif text-[14px] italic">I</span>
      </Tool>
      <Tool label="Strikethrough" active={on.strike} onRun={() => run((c) => c.toggleStrike())}>
        <span className="line-through">S</span>
      </Tool>
      <Divider />
      <Tool label="Heading" active={on.h1} onRun={() => run((c) => c.toggleHeading({ level: 1 }))}>
        <span className="font-semibold">H1</span>
      </Tool>
      <Tool label="Subheading" active={on.h2} onRun={() => run((c) => c.toggleHeading({ level: 2 }))}>
        <span className="font-semibold">H2</span>
      </Tool>
      <Divider />
      <Tool label="Bulleted list" active={on.bullets} onRun={() => run((c) => c.toggleBulletList())}>
        •≡
      </Tool>
      <Tool label="Numbered list" active={on.numbers} onRun={() => run((c) => c.toggleOrderedList())}>
        <span className="font-mono text-[11px]">1.</span>
      </Tool>
      <Tool label="Checklist" active={on.tasks} onRun={() => run((c) => c.toggleTaskList())}>
        ☑
      </Tool>
      <Tool label="Table" onRun={() => run((c) => c.insertTable({ rows: 3, cols: 3, withHeaderRow: true }))}>
        ▦
      </Tool>
      <Tool label="Callout" active={on.callout} onRun={() => run((c) => (on.callout ? c.lift("callout") : c.wrapIn("callout")))}>
        !
      </Tool>
    </div>
  );
}
