// Notes as block documents (v0.2): the editor's JSON. Older notes are plain text whose
// "- " lines read as a list and "[ ] " / "[x] " lines as checkboxes; they convert, once, the
// first time they open, so nothing about them is lost.

export interface DocNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: DocNode[];
  text?: string;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
}

const text = (t: string): DocNode[] => (t ? [{ type: "text", text: t }] : []);
const paragraph = (t: string): DocNode => ({ type: "paragraph", content: text(t) });

/** A plain-text note body as a document: bullets, checklists, headings, and paragraphs. */
export function bodyToDoc(body: string): DocNode {
  const content: DocNode[] = [];
  for (const raw of body.split("\n")) {
    const line = raw.trimEnd();
    const box = /^\s*\[( |x)\] ?(.*)$/i.exec(line);
    const bullet = /^\s*- (.*)$/.exec(line);
    const heading = /^(#{1,3}) (.*)$/.exec(line);
    const last = content[content.length - 1];
    if (box) {
      const item: DocNode = { type: "taskItem", attrs: { checked: box[1]!.toLowerCase() === "x" }, content: [paragraph(box[2]!)] };
      if (last?.type === "taskList") last.content!.push(item);
      else content.push({ type: "taskList", content: [item] });
    } else if (bullet) {
      const item: DocNode = { type: "listItem", content: [paragraph(bullet[1]!)] };
      if (last?.type === "bulletList") last.content!.push(item);
      else content.push({ type: "bulletList", content: [item] });
    } else if (heading) {
      content.push({ type: "heading", attrs: { level: heading[1]!.length }, content: text(heading[2]!) });
    } else {
      content.push(paragraph(line));
    }
  }
  // Drop trailing empty paragraphs; keep at least one block.
  while (content.length > 1 && content[content.length - 1]!.type === "paragraph" && !content[content.length - 1]!.content?.length) content.pop();
  return { type: "doc", content: content.length ? content : [paragraph("")] };
}

/** The note's document: its saved JSON, or its plain-text body converted. */
export function docOf(n: { doc: string | null; body: string }): DocNode {
  if (n.doc) {
    try {
      const d = JSON.parse(n.doc) as DocNode;
      if (d?.type === "doc") return d;
    } catch {
      // A damaged document falls back to its text below.
    }
  }
  return bodyToDoc(n.body);
}
