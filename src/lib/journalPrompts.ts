// Journal prompts (v0.2): themes to pick from in the journal's setup, and the day's draw. A new
// day starts with the prompts as small headings to write under; with a daily count set, each day
// draws that many from everything picked, so the page doesn't read the same every day.

export interface Prompt {
  id: string;
  text: string;
}

export interface Theme {
  id: string;
  label: string;
  /** One line on what the theme is for. */
  blurb: string;
  prompts: Prompt[];
}

const p = (id: string, text: string): Prompt => ({ id, text });

export const THEMES: Theme[] = [
  {
    id: "productivity",
    label: "Productivity",
    blurb: "Plan the day and judge it honestly.",
    prompts: [
      p("prod-one-thing", "What's the one thing that would make today a win?"),
      p("prod-in-the-way", "What could get in the way, and what will I do about it?"),
      p("prod-time", "Where did my time actually go today?"),
      p("prod-moved", "What did I move forward, even a little?"),
      p("prod-avoid", "What am I avoiding, and what's the smallest first step?"),
      p("prod-tomorrow", "What are tomorrow's top three?"),
      p("prod-energy", "When was my energy best today, and did I use it for the hard work?"),
      p("prod-drop", "What can I drop, delegate, or do worse on purpose?"),
    ],
  },
  {
    id: "reflection",
    label: "Reflection",
    blurb: "Look back to learn, not to grade.",
    prompts: [
      p("refl-well", "What went well?"),
      p("refl-differently", "What would I do differently?"),
      p("refl-learned", "What did I learn today?"),
      p("refl-surprised", "What surprised me?"),
      p("refl-proud", "What am I proud of, however small?"),
      p("refl-pattern", "What pattern am I noticing in my days lately?"),
      p("refl-advice", "What would I tell a friend who had my day?"),
      p("refl-future", "What will future me thank me for, from today?"),
    ],
  },
  {
    id: "emotional",
    label: "Emotional understanding",
    blurb: "Name what you feel, and what's under it.",
    prompts: [
      p("emo-feel", "How do I feel right now, in a few words?"),
      p("emo-under", "What's underneath that feeling?"),
      p("emo-drained", "What drained me today, and what filled me back up?"),
      p("emo-worry", "What am I worried about, and how much of it is in my control?"),
      p("emo-kind", "Where was I hard on myself today, and what would kindness say?"),
      p("emo-need", "What do I need more of this week?"),
      p("emo-let-go", "What can I let go of tonight?"),
      p("emo-connected", "Who did I feel connected to today?"),
    ],
  },
  {
    id: "gratitude",
    label: "Gratitude",
    blurb: "Notice what's going right.",
    prompts: [
      p("grat-three", "Three things I'm grateful for today"),
      p("grat-person", "Someone I'm glad is in my life, and why"),
      p("grat-small", "A small moment I'd like to remember"),
      p("grat-easy", "Something that was easier than it used to be"),
      p("grat-body", "Something my body or mind did well today"),
    ],
  },
  {
    id: "focus",
    label: "Focus review",
    blurb: "How the sessions went, from inside Sanctum.",
    prompts: [
      p("focus-sessions", "How did my focus sessions go?"),
      p("focus-tempted", "What tempted me, and when?"),
      p("focus-worth", "Was the seal worth it today? Why?"),
      p("focus-setup", "What would make tomorrow's sessions easier to start?"),
      p("focus-deep", "When was I most absorbed in the work?"),
    ],
  },
];

/** Quick picks for the setup: a few prompts that go together. */
export const PRESETS: { id: string; label: string; blurb: string; prompts: string[] }[] = [
  { id: "morning", label: "Morning intentions", blurb: "Set the day up.", prompts: ["prod-one-thing", "prod-in-the-way", "emo-feel"] },
  { id: "evening", label: "Evening reflection", blurb: "Close the day.", prompts: ["refl-well", "focus-tempted", "refl-differently", "prod-tomorrow"] },
  { id: "gratitude", label: "Gratitude", blurb: "Three good things.", prompts: ["grat-three", "grat-small"] },
  { id: "focus", label: "Focus review", blurb: "How the seals went.", prompts: ["focus-sessions", "focus-tempted", "focus-worth"] },
];

export const PROMPTS: Prompt[] = THEMES.flatMap((t) => t.prompts);
export const promptText = (id: string) => PROMPTS.find((x) => x.id === id)?.text ?? null;

export interface JournalSetup {
  /** The setup was finished (closing it part way starts it over next time). */
  done: boolean;
  /** Picked prompt ids, in the order they were picked. Empty: a blank page. */
  prompts: string[];
  /** How many a day, drawn from the picks; 0 shows all of them every day. */
  perDay: number;
}

export const DEFAULT_SETUP: JournalSetup = { done: false, prompts: [], perDay: 3 };

/** A small stable hash, so a date always draws the same prompts. */
function seedOf(s: string): number {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

/** The day's prompts: all picks, or `perDay` of them drawn by the date (kept in pick order). */
export function promptsFor(setup: JournalSetup, date: string): Prompt[] {
  const picked = setup.prompts.map((id) => PROMPTS.find((x) => x.id === id)).filter((x): x is Prompt => !!x);
  if (!setup.perDay || picked.length <= setup.perDay) return picked;
  // A seeded shuffle, then the first perDay, back in pick order.
  const order = picked.map((x, i) => ({ x, i, k: seedOf(`${date}:${x.id}`) })).sort((a, b) => a.k - b.k).slice(0, setup.perDay);
  return order.sort((a, b) => a.i - b.i).map((o) => o.x);
}

/** A new page: each prompt as a small heading with a line to write on. */
export function promptDoc(prompts: Prompt[]) {
  if (!prompts.length) return { type: "doc", content: [{ type: "paragraph" }] };
  return {
    type: "doc",
    content: prompts.flatMap((x) => [
      { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: x.text }] },
      { type: "paragraph" },
    ]),
  };
}

/** What was written on a page, leaving out the prompts themselves (untouched prompts aren't writing). */
export function writtenText(text: string, prompts: Prompt[]): string {
  const skip = new Set(prompts.map((x) => x.text.trim()));
  return text
    .split("\n")
    .filter((l) => l.trim() && !skip.has(l.trim()))
    .join("\n");
}
