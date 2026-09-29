// Quick add (SPEC 4.12): "mock interview thu 3pm 90m @interview" -> a one-time item, or with
// "every mon wed" / "daily" / "weekdays", a routine. Whatever isn't understood is the title.

import { addDays, dayOf, EVERY_DAY, weekStart, WEEKDAYS_MASK, WEEKENDS_MASK } from "./planner";

export interface Parsed {
  title: string;
  /** "YYYY-MM-DD" */
  date: string | null;
  /** "HH:MM" */
  time: string | null;
  durationMin: number | null;
  profileId: number | null;
  /** Set when it repeats: a routine on these weekdays (bit 0 = Sunday). */
  daysMask: number | null;
}

const DAY_NAMES: [RegExp, number][] = [
  [/^sun(day)?s?$/, 0],
  [/^mon(day)?s?$/, 1],
  [/^tue(s|sday)?s?$/, 2],
  [/^wed(nesday)?s?$/, 3],
  [/^thu(r|rs|rsday)?s?$/, 4],
  [/^fri(day)?s?$/, 5],
  [/^sat(urday)?s?$/, 6],
];

const dayNumber = (w: string) => DAY_NAMES.find(([re]) => re.test(w))?.[1] ?? null;

const pad = (n: number) => String(n).padStart(2, "0");
const hhmm = (h: number, m: number) => `${pad(h)}:${pad(m)}`;

/** "3pm", "3:30pm", "3p", "15:00", "noon", "midnight". */
export function parseTime(w: string): string | null {
  if (w === "noon") return "12:00";
  if (w === "midnight") return "00:00";
  const ampm = /^(\d{1,2})(?::(\d{2}))?\s?(a|am|p|pm)$/.exec(w);
  if (ampm) {
    let h = Number(ampm[1]);
    const m = Number(ampm[2] ?? 0);
    if (h < 1 || h > 12 || m > 59) return null;
    const pm = ampm[3]!.startsWith("p");
    if (h === 12) h = pm ? 12 : 0;
    else if (pm) h += 12;
    return hhmm(h, m);
  }
  const clock = /^(\d{1,2}):(\d{2})$/.exec(w);
  if (clock) {
    const h = Number(clock[1]);
    const m = Number(clock[2]);
    return h < 24 && m < 60 ? hhmm(h, m) : null;
  }
  return null;
}

/** "90m", "90min", "1h", "1.5h", "1h30", "2hrs". */
export function parseLength(w: string): number | null {
  const hm = /^(\d+)h(\d{1,2})m?$/.exec(w);
  if (hm) return Number(hm[1]) * 60 + Number(hm[2]);
  const h = /^(\d+(?:\.\d+)?)\s?(h|hr|hrs|hour|hours)$/.exec(w);
  if (h) return Math.round(Number(h[1]) * 60);
  const m = /^(\d+)\s?(m|min|mins|minute|minutes)$/.exec(w);
  if (m) return Number(m[1]);
  return null;
}

/** "10/3" or "10/3/2026": the next such date on or after today. */
function parseSlashDate(w: string, today: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/.exec(w);
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const year = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : Number(today.slice(0, 4));
  let key = `${year}-${pad(month)}-${pad(day)}`;
  if (!m[3] && key < today) key = `${year + 1}-${pad(month)}-${pad(day)}`;
  return key;
}

/** The next `day` (0 = Sunday) on or after today; "next" means the one in the following week. */
function nextWeekday(today: string, day: number, next: boolean): string {
  if (next) return addDays(weekStart(today), 7 + ((day + 6) % 7));
  return addDays(today, (day - dayOf(today) + 7) % 7);
}

export interface Profileish {
  id: number;
  name: string;
}

const squash = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

/** "@interview" or "@deep" -> the first profile whose name starts with it. */
function matchProfile(tag: string, profiles: readonly Profileish[]): number | null {
  const q = squash(tag);
  if (!q) return null;
  return (profiles.find((p) => squash(p.name) === q) ?? profiles.find((p) => squash(p.name).startsWith(q)))?.id ?? null;
}

export function parseQuickAdd(text: string, today: string, profiles: readonly Profileish[] = []): Parsed {
  const out: Parsed = { title: "", date: null, time: null, durationMin: null, profileId: null, daysMask: null };
  const words = text.trim().split(/\s+/).filter(Boolean);
  const keep: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const raw = words[i]!;
    const w = raw.toLowerCase().replace(/[,.]$/, "");
    const nextWord = words[i + 1]?.toLowerCase().replace(/[,.]$/, "");

    if (w.startsWith("@") && w.length > 1) {
      const id = matchProfile(w.slice(1), profiles);
      if (id !== null) {
        out.profileId = id;
        continue;
      }
    }
    if (w === "today" || w === "tonight") {
      out.date = today;
      continue;
    }
    if (w === "tomorrow" || w === "tmr" || w === "tmrw") {
      out.date = addDays(today, 1);
      continue;
    }
    if (w === "daily" || (w === "every" && nextWord === "day")) {
      out.daysMask = EVERY_DAY;
      if (w === "every") i++;
      continue;
    }
    if (w === "weekdays" || (w === "every" && nextWord === "weekday")) {
      out.daysMask = WEEKDAYS_MASK;
      if (w === "every") i++;
      continue;
    }
    if (w === "weekends" || (w === "every" && nextWord === "weekend")) {
      out.daysMask = WEEKENDS_MASK;
      if (w === "every") i++;
      continue;
    }
    if (w === "every" && nextWord && dayNumber(nextWord) !== null) {
      // "every mon wed and fri"
      let mask = 0;
      let j = i + 1;
      for (; j < words.length; j++) {
        const x = words[j]!.toLowerCase().replace(/[,.]$/, "");
        if (x === "and" || x === "&") continue;
        const d = dayNumber(x);
        if (d === null) break;
        mask |= 1 << d;
      }
      out.daysMask = mask;
      i = j - 1;
      continue;
    }
    if (w === "next" && nextWord && dayNumber(nextWord) !== null) {
      out.date = nextWeekday(today, dayNumber(nextWord)!, true);
      i++;
      continue;
    }
    if (dayNumber(w) !== null && out.date === null) {
      out.date = nextWeekday(today, dayNumber(w)!, false);
      continue;
    }
    const slash = parseSlashDate(w, today);
    if (slash) {
      out.date = slash;
      continue;
    }
    if (w === "at" && nextWord) {
      // "at 3" means 3 PM for 1-6, otherwise as written.
      const bare = /^(\d{1,2})(?::(\d{2}))?$/.exec(nextWord);
      const t = parseTime(nextWord) ?? (bare ? hhmm(Number(bare[1]) + (Number(bare[1]) >= 1 && Number(bare[1]) <= 6 ? 12 : 0), Number(bare[2] ?? 0)) : null);
      if (t && Number(t.slice(0, 2)) < 24) {
        out.time = t;
        i++;
        continue;
      }
    }
    const t = parseTime(w);
    if (t) {
      out.time = t;
      continue;
    }
    if (w === "for" && nextWord) {
      // "for 45 min", "for 2 hours", "for 90m"
      const joined = parseLength(nextWord) ?? (words[i + 2] ? parseLength(`${nextWord}${words[i + 2]!.toLowerCase()}`) : null);
      if (joined !== null) {
        i += parseLength(nextWord) !== null ? 1 : 2;
        out.durationMin = joined;
        continue;
      }
    }
    const len = parseLength(w) ?? (nextWord && /^\d+(\.\d+)?$/.test(w) ? parseLength(`${w}${nextWord}`) : null);
    if (len !== null) {
      if (parseLength(w) === null) i++;
      out.durationMin = len;
      continue;
    }
    keep.push(raw);
  }
  out.title = keep.join(" ").trim();
  return out;
}
