import { Extension, Node, mergeAttributes, type Editor, type Range } from "@tiptap/react";
import Suggestion from "@tiptap/suggestion";
import { Mention } from "@tiptap/extension-mention";
import { Image } from "@tiptap/extension-image";
import { imageId, noteImageUrl, pickImages, storeImage } from "../../lib/noteImages";
import { errorText } from "../../lib/native";
import { TextSelection } from "@tiptap/pm/state";
import { menuRenderer, type MenuItem } from "./SuggestMenu";
import { usePlanner } from "../../state/planner";
import { useTrackers } from "../../state/trackers";
import { useStore } from "../../state/store";
import { addDays, fromKey, todayKey } from "../../lib/planner";

// The note editor's own pieces (v0.2): a callout block, moving blocks with Alt+Up/Down, the "/"
// menu of blocks, and "@" links to Sanctum (tasks, routines, trackers, days).

/** A highlighted box of blocks: "> **Note**" without the markdown. */
export const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,
  parseHTML: () => [{ tag: "div[data-callout]" }],
  renderHTML: ({ HTMLAttributes }) => ["div", mergeAttributes(HTMLAttributes, { "data-callout": "", class: "note-callout" }), 0],
});

/**
 * Images (v0.2): stored by Sanctum and referenced as "noteimg:<id>"; shown at the scheme's URL,
 * resizable by their corners, aspect kept. Pasted images from elsewhere on the web are left out
 * (the window doesn't load outside images); paste or drop the file instead.
 */
export const NoteImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      src: {
        default: null,
        parseHTML: (el: HTMLElement) => {
          const id = imageId(el.getAttribute("src"));
          return id === null ? null : `noteimg:${id}`;
        },
        renderHTML: (attrs: { src?: string | null }) => ({ src: noteImageUrl(attrs.src) }),
      },
    };
  },
  parseHTML() {
    return [{ tag: "img[src]", getAttrs: (el: HTMLElement) => (imageId(el.getAttribute("src")) === null ? false : null) }];
  },
}).configure({ inline: false, allowBase64: false, resize: { enabled: true, minWidth: 80, minHeight: 40, alwaysPreserveAspectRatio: true } });

/** Saves image files and puts them in the note, at `pos` or the caret. */
export async function insertImages(editor: Editor, files: File[], pos?: number) {
  for (const file of files) {
    try {
      const src = await storeImage(file);
      const at = pos ?? editor.state.selection.to;
      editor.chain().focus().insertContentAt(at, { type: "image", attrs: { src, alt: file.name.replace(/\.[^.]+$/, "") } }).run();
    } catch (e) {
      useStore.getState().showNotice({ lead: errorText(e) });
    }
  }
}

/** Moves the block the caret is in up or down past its neighbour, caret and all. */
export function moveBlock(editor: Editor, dir: -1 | 1): boolean {
  const { state, view } = editor;
  const { $from } = state.selection;
  if ($from.depth < 1) return false;
  const index = $from.index(0);
  const target = index + dir;
  if (target < 0 || target >= state.doc.childCount) return true;
  const node = state.doc.child(index);
  const other = state.doc.child(target);
  const start = $from.before(1);
  const offset = $from.pos - start;
  const newStart = dir < 0 ? start - other.nodeSize : start + other.nodeSize;
  const tr = state.tr.delete(start, start + node.nodeSize).insert(newStart, node);
  tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(newStart + offset, tr.doc.content.size))));
  view.dispatch(tr.scrollIntoView());
  return true;
}

export const BlockMove = Extension.create({
  name: "blockMove",
  addKeyboardShortcuts() {
    return {
      "Alt-ArrowUp": () => moveBlock(this.editor, -1),
      "Alt-ArrowDown": () => moveBlock(this.editor, 1),
    };
  },
});

// --- "/" blocks ---

interface Command extends MenuItem {
  keywords?: string;
  run: (editor: Editor, range: Range) => void;
}

/** The current block's text, minus the "/query" being typed. */
function blockText(editor: Editor, range: Range): string {
  const { $from } = editor.state.selection;
  const start = $from.start();
  const text = editor.state.doc.textBetween(start, $from.end(), " ");
  const from = range.from - start;
  const to = range.to - start;
  return (text.slice(0, from) + text.slice(to)).trim();
}

const COMMANDS: Command[] = [
  { id: "text", title: "Text", hint: "Plain paragraph", icon: "T", run: (e, r) => e.chain().focus().deleteRange(r).setParagraph().run() },
  { id: "h1", title: "Heading 1", hint: "Big section heading", icon: "H1", keywords: "title", run: (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 1 }).run() },
  { id: "h2", title: "Heading 2", hint: "Medium heading", icon: "H2", run: (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 2 }).run() },
  { id: "h3", title: "Heading 3", hint: "Small heading", icon: "H3", run: (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 3 }).run() },
  { id: "bullets", title: "Bulleted list", hint: "Or type “- ”", icon: "•", keywords: "ul list", run: (e, r) => e.chain().focus().deleteRange(r).toggleBulletList().run() },
  { id: "numbers", title: "Numbered list", hint: "Or type “1. ”", icon: "1.", keywords: "ol ordered", run: (e, r) => e.chain().focus().deleteRange(r).toggleOrderedList().run() },
  { id: "checklist", title: "Checklist", hint: "Or type “[] ”", icon: "☐", keywords: "todo task checkbox", run: (e, r) => e.chain().focus().deleteRange(r).toggleTaskList().run() },
  {
    id: "table",
    title: "Table",
    hint: "3 × 3, Tab moves between cells",
    icon: "▦",
    keywords: "grid",
    run: (e, r) => e.chain().focus().deleteRange(r).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
  { id: "quote", title: "Quote", hint: "Or type “> ”", icon: "❝", run: (e, r) => e.chain().focus().deleteRange(r).toggleBlockquote().run() },
  { id: "callout", title: "Callout", hint: "A highlighted box", icon: "!", keywords: "note info", run: (e, r) => e.chain().focus().deleteRange(r).wrapIn("callout").run() },
  { id: "toggle", title: "Toggle", hint: "A section that folds away", icon: "▸", keywords: "details collapse fold", run: (e, r) => e.chain().focus().deleteRange(r).setDetails().run() },
  {
    id: "image",
    title: "Image",
    hint: "From a file, or paste or drop one",
    icon: "▣",
    keywords: "picture photo screenshot",
    run: (e, r) => {
      e.chain().focus().deleteRange(r).run();
      void pickImages().then((files) => insertImages(e, files));
    },
  },
  { id: "divider", title: "Divider", hint: "Or type “---”", icon: "—", keywords: "hr line rule", run: (e, r) => e.chain().focus().deleteRange(r).setHorizontalRule().run() },
  { id: "code", title: "Code", hint: "Or type “```”", icon: "{}", run: (e, r) => e.chain().focus().deleteRange(r).toggleCodeBlock().run() },
  {
    id: "task",
    title: "Make it a task for today",
    hint: "This line goes on Today and links here",
    icon: "→",
    keywords: "today todo add",
    run: (e, r) => {
      const title = blockText(e, r);
      e.chain().focus().deleteRange(r).run();
      if (!title) return;
      void usePlanner
        .getState()
        .saveTodo({ title, dueDate: todayKey(), dueTime: null, durationMin: null, profileId: null })
        .then((t) => {
          if (!t) return;
          // The line becomes a link to the task.
          const { $from } = e.state.selection;
          e.chain().focus().insertContentAt({ from: $from.start(), to: $from.end() }, { type: "mention", attrs: { id: `todo:${t.id}`, label: t.title } }).run();
          useStore.getState().showNotice({ lead: "Added to Today.", rest: t.title });
        });
    },
  },
];

const matches = (c: Command, q: string) => `${c.title} ${c.keywords ?? ""}`.toLowerCase().includes(q.toLowerCase());

export const SlashCommands = Extension.create({
  name: "slashCommands",
  addProseMirrorPlugins() {
    return [
      Suggestion<MenuItem>({
        editor: this.editor,
        char: "/",
        startOfLine: false,
        items: ({ query }) => COMMANDS.filter((c) => matches(c, query)).slice(0, 14),
        command: ({ editor, range, props }) => (props as Command).run(editor, range),
        render: menuRenderer("Blocks"),
      }),
    ];
  },
});

// --- "@" links to Sanctum ---

const dayLabel = (key: string) => fromKey(key).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

/** Tasks, routines, trackers, and days that match, nearest first. */
export function sanctumLinks(query: string): MenuItem[] {
  const q = query.trim().toLowerCase();
  const today = todayKey();
  const { todos, routines } = usePlanner.getState();
  const trackers = useTrackers.getState().trackers;
  const days: MenuItem[] = [
    { id: `day:${today}`, title: "Today", hint: dayLabel(today), icon: "◷" },
    { id: `day:${addDays(today, 1)}`, title: "Tomorrow", hint: dayLabel(addDays(today, 1)), icon: "◷" },
  ];
  const all: MenuItem[] = [
    ...days,
    ...todos.filter((t) => !t.done).map((t) => ({ id: `todo:${t.id}`, title: t.title, hint: t.undated ? "Pending" : `Task · ${dayLabel(t.dueDate)}`, icon: "☐" })),
    ...routines.filter((r) => r.active).map((r) => ({ id: `routine:${r.id}`, title: r.title, hint: "Routine", icon: "↻" })),
    ...trackers.map((t) => ({ id: `tracker:${t.id}`, title: t.name, hint: "Tracker", icon: "∿" })),
  ];
  return all.filter((i) => !q || i.title.toLowerCase().includes(q) || i.hint?.toLowerCase().includes(q)).slice(0, 8);
}

/** Where a link goes when clicked. */
export function openLink(id: string) {
  const [kind] = id.split(":");
  const s = useStore.getState();
  if (kind === "tracker") s.navigate("trackers");
  else if (kind === "routine") s.navigate("week");
  else s.navigate("today");
}

export const SanctumMention = Mention.configure({
  HTMLAttributes: { class: "note-link" },
  renderText: ({ node }) => `@${node.attrs.label ?? node.attrs.id}`,
  suggestion: {
    char: "@",
    items: ({ query }) => sanctumLinks(query),
    render: menuRenderer("Link to Sanctum"),
    command: ({ editor, range, props }) => {
      const item = props as unknown as MenuItem;
      editor
        .chain()
        .focus()
        .insertContentAt(range, [
          { type: "mention", attrs: { id: item.id, label: item.title } },
          { type: "text", text: " " },
        ])
        .run();
    },
  },
});
