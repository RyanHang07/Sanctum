// The preview's journal search and export, matching src-tauri/src/journal.rs: a case-insensitive
// match on the page text, newest first, at most 50 hits, with a ~120-character snippet cut at
// word boundaries; exports oldest first.

import type { JournalDay, JournalHit } from "./types";

const MAX_HITS = 50;
const SNIPPET = 120;

const collapse = (s: string) => s.split(/\s+/).filter(Boolean).join(" ");
// Lowercased char by char, so indexes line up with the original's chars.
const fold = (chars: string[]) => chars.map((c) => Array.from(c.toLowerCase())[0] ?? c);

function find(hay: string[], needle: string[]): number {
  if (!needle.length || needle.length > hay.length) return -1;
  outer: for (let i = 0; i <= hay.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

/** About 120 characters around the first match, cut at words, with "…" where cut. Null when it doesn't match. */
export function journalSnippet(text: string, query: string): string | null {
  const chars = Array.from(collapse(text));
  const q = fold(Array.from(collapse(query)));
  const at = find(fold(chars), q);
  if (at < 0) return null;
  const len = chars.length;
  const endOfMatch = at + q.length;
  let start = Math.max(0, at - Math.floor(Math.max(0, SNIPPET - q.length) / 2));
  let end = Math.min(len, Math.max(start + SNIPPET, endOfMatch));
  if (end === len) start = Math.min(Math.max(0, len - SNIPPET), at);
  if (start > 0 && chars[start - 1] !== " ") {
    const sp = chars.slice(start, at).indexOf(" ");
    if (sp >= 0) start += sp + 1;
  }
  if (end < len && chars[end] !== " ") {
    const sp = chars.slice(endOfMatch, end).lastIndexOf(" ");
    if (sp >= 0) end = endOfMatch + sp;
  }
  return `${start > 0 ? "…" : ""}${chars.slice(start, end).join("").trim()}${end < len ? "…" : ""}`;
}

export function journalSearch(days: Iterable<JournalDay>, query: string): JournalHit[] {
  if (!query.trim()) return [];
  const hits: JournalHit[] = [];
  for (const d of [...days].sort((a, b) => b.date.localeCompare(a.date))) {
    const snippet = journalSnippet(d.body, query);
    if (snippet !== null) hits.push({ date: d.date, snippet });
    if (hits.length === MAX_HITS) break;
  }
  return hits;
}

const oldestFirst = (days: Iterable<JournalDay>) => [...days].sort((a, b) => a.date.localeCompare(b.date));

/** One Markdown file: a "## Weekday, Month D, YYYY" heading per page, oldest first. */
export function journalMarkdown(days: Iterable<JournalDay>): string {
  return oldestFirst(days)
    .map((d) => {
      const heading = new Date(`${d.date}T12:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
      return `## ${heading}\n\n${d.body.trimEnd()}\n`;
    })
    .join("\n");
}

/** [{ date, doc, body, updatedAt }], oldest first. */
export function journalJson(days: Iterable<JournalDay>): string {
  return JSON.stringify(
    oldestFirst(days).map(({ date, doc, body, updatedAt }) => ({ date, doc, body, updatedAt })),
    null,
    2,
  );
}
