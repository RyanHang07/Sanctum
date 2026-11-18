import type { DistractionKind, DistractionSuggestion } from "../../lib/types";

// Setup › Distractions › Suggested (decided 2026-11-16): one row of chips, time-based first, then
// the common distractions. A dismissed chip stays away for three days, or comes back sooner when
// the time spent on it rises sharply.

/** The one setting dismissals live under: JSON of `{ [key]: { at, minutes } }`. */
export const DISMISSED_KEY = "distraction_suggestions_dismissed";
/** A dismissal lasts three days. */
export const DISMISS_MS = 3 * 24 * 60 * 60_000;
/** Sooner if the week's time at least doubles and grows by at least this many minutes. */
export const SPIKE_MIN = 30;

export interface Dismissal {
  /** When it was dismissed, epoch ms. */
  at: number;
  /** Minutes over the last week when it was dismissed (0 for a common distraction). */
  minutes: number;
}
export type Dismissals = Record<string, Dismissal>;

export interface SuggestionChip {
  /** `kind:value` of the chip's first item; what a dismissal is stored under. */
  key: string;
  label: string;
  /** Minutes over the last week; null for a common distraction. */
  minutes: number | null;
  /** What adding the chip flags: one item, or every item a common distraction covers. */
  items: { kind: DistractionKind; value: string; label: string }[];
}

/** Whether a dismissal still hides its suggestion. */
export function stillDismissed(d: Dismissal | undefined, minutesNow: number | null, now: number): boolean {
  if (!d) return false;
  if (now - d.at >= DISMISS_MS) return false;
  if (minutesNow !== null && minutesNow >= d.minutes * 2 && minutesNow - d.minutes >= SPIKE_MIN) return false;
  return true;
}

/** Saved dismissals; anything unreadable counts as none. */
export function parseDismissals(raw: string | null | undefined): Dismissals {
  if (!raw) return {};
  try {
    const v: unknown = JSON.parse(raw);
    if (!v || typeof v !== "object" || Array.isArray(v)) return {};
    const out: Dismissals = {};
    for (const [k, d] of Object.entries(v as Record<string, unknown>)) {
      const x = d as Partial<Dismissal> | null;
      if (x && typeof x.at === "number" && typeof x.minutes === "number") out[k] = { at: x.at, minutes: x.minutes };
    }
    return out;
  } catch {
    return {};
  }
}

/** Adds a dismissal and drops the ones three days old. */
export function dismiss(all: Dismissals, key: string, minutes: number | null, now: number): Dismissals {
  const out: Dismissals = {};
  for (const [k, d] of Object.entries(all)) if (now - d.at < DISMISS_MS) out[k] = d;
  out[key] = { at: now, minutes: minutes ?? 0 };
  return out;
}

/**
 * The chips to show: time-based suggestions by most time first, then one chip per common
 * distraction (YouTube covers its site and its app) that the week hasn't already suggested.
 */
export function suggestionChips(list: DistractionSuggestion[], dismissed: Dismissals, now: number): SuggestionChip[] {
  const used = list
    .filter((s) => s.minutes !== null)
    .sort((a, b) => (b.minutes ?? 0) - (a.minutes ?? 0))
    .map<SuggestionChip>((s) => ({ key: `${s.kind}:${s.value}`, label: s.label, minutes: s.minutes, items: [{ kind: s.kind, value: s.value, label: s.label }] }));
  const seen = new Set(used.map((c) => c.key));
  const groups = new Map<string, SuggestionChip>();
  for (const s of list) {
    if (s.minutes !== null) continue;
    const g = groups.get(s.label) ?? { key: `${s.kind}:${s.value}`, label: s.label, minutes: null, items: [] };
    g.items.push({ kind: s.kind, value: s.value, label: s.label });
    groups.set(s.label, g);
  }
  const common = [...groups.values()].filter((g) => !g.items.some((i) => seen.has(`${i.kind}:${i.value}`)));
  return [...used, ...common].filter((c) => !stillDismissed(dismissed[c.key], c.minutes, now));
}
