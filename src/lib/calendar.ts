// Google Calendar events in the planner (SPEC 4.3). An event tagged #focus or
// #focus:<profile> (or on a calendar named "Focus") is a focus block: Home suggests it and
// offers the same Enter / Skip prompt as a profile-linked routine.

import type { AgendaItem } from "./planner";
import { clock, minutes } from "./time";
import type { CalEvent, Profile } from "./types";
import { addDays } from "./planner";

const TAG = /(^|\s)#focus(?::([\p{L}\p{N}_-]+))?(?=\s|$)/iu;

/** "Interview Prep" -> "interview-prep" (how profiles are written in tags). */
export const profileSlug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");

const squash = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

export interface FocusTag {
  /** The title without the tag. */
  title: string;
  tagged: boolean;
  /** The tagged profile; a bare #focus uses `fallback` (the profile picked on Home). */
  profileId: number | null;
}

export function readFocusTag(title: string, profiles: readonly Pick<Profile, "id" | "name">[], fallback: number | null = null): FocusTag {
  const m = TAG.exec(title);
  if (!m) return { title, tagged: false, profileId: null };
  const clean = title.replace(TAG, " ").replace(/\s+/g, " ").trim();
  const name = m[2];
  const profileId = name ? profiles.find((p) => squash(p.name) === squash(name))?.id ?? null : fallback;
  return { title: clean || title, tagged: true, profileId };
}

/** The tag as written ("#focus:deep-work"), or null. */
export const focusTagText = (title: string) => TAG.exec(title)?.[0].trim() ?? null;

/** Sets (or with null, removes) the #focus tag, keeping the rest of the title. */
export function writeFocusTag(title: string, profile: Pick<Profile, "name"> | null): string {
  const base = title.replace(TAG, " ").replace(/\s+/g, " ").trim();
  return profile ? `${base} #focus:${profileSlug(profile.name)}` : base;
}

const isFocusCalendar = (e: CalEvent) => e.calendarName.trim().toLowerCase() === "focus";

/** Events as agenda items per date. Multi-day events appear on each day they cover. */
export function eventItems(
  dates: readonly string[],
  events: readonly CalEvent[],
  profiles: readonly Pick<Profile, "id" | "name">[],
  fallback: number | null = null,
): Record<string, AgendaItem[]> {
  const out: Record<string, AgendaItem[]> = {};
  const wanted = new Set(dates);
  for (const e of events) {
    const tag = readFocusTag(e.title, profiles, fallback);
    const focus = tag.tagged ? tag.profileId : isFocusCalendar(e) ? fallback : null;
    for (let d = e.date; d <= e.endDate; d = addDays(d, 1)) {
      if (!wanted.has(d)) continue;
      const first = d === e.date;
      (out[d] ??= []).push({
        key: `event:${e.calendarId}:${e.eventId}:${d}`,
        kind: "event",
        id: 0,
        title: tag.title,
        date: d,
        // Later days of a multi-day timed event read as all-day.
        time: first ? e.time : null,
        durationMin: first ? e.durationMin : null,
        profileId: first && e.time ? focus : null,
        done: false,
        order: 0,
        event: e,
      });
    }
  }
  return out;
}

/** A meeting happening now: a timed event with at least one other person (decided 2026-09-29). */
export function currentMeeting(events: readonly CalEvent[], now: number): CalEvent | null {
  return events.find((e) => !e.allDay && e.attendees > 0 && e.startMs <= now && now < e.endMs) ?? null;
}

export interface MeetingLabels {
  title: string;
  /** "2:00 PM to 3:00 PM" */
  range: string;
  /** "3:00 PM" */
  until: string;
  /** "18m" */
  left: string;
}

export function meetingLabels(e: CalEvent, now: number): MeetingLabels {
  return {
    title: readFocusTag(e.title, []).title,
    range: `${clock(e.startMs)} to ${clock(e.endMs)}`,
    until: clock(e.endMs),
    left: minutes(Math.ceil((e.endMs - now) / 60_000)),
  };
}

/** "Synced 3 min ago", for Setup and the Week legend. */
export function syncedAgo(at: number | null, now = Date.now()): string {
  if (!at) return "Not synced yet";
  const min = Math.floor((now - at) / 60_000);
  if (min < 1) return "Synced just now";
  if (min < 60) return `Synced ${min} min ago`;
  const h = Math.floor(min / 60);
  return `Synced ${h} h ago`;
}
