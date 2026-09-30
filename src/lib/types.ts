// Shapes shared with the Rust backend (src-tauri/src/profiles.rs, apps.rs, launcher.rs).

/** What a profile opens. What gets sealed is the one Distractions list. */
export type RuleKind = "launch_app" | "launch_url";

export interface Rule {
  id: number;
  profileId: number;
  kind: RuleKind;
  /** launch_app: lowercase exe name. launch_url: absolute URL. */
  value: string;
  label: string | null;
  /** launch_app: last known launch target (.lnk or .exe). */
  path: string | null;
}

/** One entry in the Distractions list (src-tauri/src/distractions.rs): blocked in every seal, counted as distracting. */
export type DistractionKind = "app" | "site" | "keyword";

export interface Distraction {
  id: number;
  kind: DistractionKind;
  /** app: lowercase exe. site: bare host plus optional path. keyword: lowercase text. */
  value: string;
  label: string | null;
  /** app: where it was found, for its icon. */
  path: string | null;
  /** site: pages that stay open ("youtube.com/@mitocw"). */
  allow: { id: number; prefix: string }[];
}

export interface NewDistraction {
  /** "auto" works it out from the text. */
  kind: DistractionKind | "auto";
  value: string;
  label?: string | null;
  path?: string | null;
}

export interface DistractionSuggestion {
  kind: DistractionKind;
  value: string;
  label: string;
  /** Minutes in front over the last week; null for the common distractions. */
  minutes: number | null;
}

/** Setup > Browser extension (src-tauri/src/browser.rs). */
export interface BrowserInfo {
  name: string;
  exe: string;
  installed: boolean;
  /** The bridge is registered with this browser. */
  registered: boolean;
  connected: boolean;
  version: string | null;
  /** Allowed in private windows. Null until the extension says hello. */
  incognito: boolean | null;
  /** Running without its extension during a seal that needs it. */
  missing: boolean;
}

export interface BrowserStatus {
  extensionDir: string;
  extensionId: string;
  browsers: BrowserInfo[];
}

export interface Profile {
  id: number;
  name: string;
  defaultMinutes: number;
  workTypes: string[];
  createdAt: number;
  rules: Rule[];
}

export interface NewRule {
  kind: RuleKind;
  value: string;
  label?: string | null;
  path?: string | null;
}

export interface ProfileDraft {
  name: string;
  defaultMinutes?: number;
  workTypes?: string[];
  rules?: NewRule[];
}

export interface ProfilePatch {
  name?: string;
  defaultMinutes?: number;
}

export interface InstalledApp {
  name: string;
  /** Lowercase exe name. */
  exe: string;
  /** .lnk or .exe to open. Also used for the icon. */
  launch: string;
  /** Has a window open right now. */
  running: boolean;
}

export interface LaunchReport {
  opened: string[];
  focused: string[];
  missing: string[];
  failed: string[];
}

/** A running focus session (src-tauri/src/session.rs). */
export interface SessionView {
  id: number;
  profileId: number | null;
  profileName: string;
  plannedMinutes: number;
  startedAt: number;
  endsAt: number;
  remainingMs: number;
  elapsedMs: number;
  attempts: number;
  /** Enforced app and keyword rules. */
  sealedCount: number;
  /** Sanctum was down for more than a minute; the session can't finish as completed. */
  broken: boolean;
  /** Idle right now: the countdown is paused and the end moves later (SPEC 4.8). */
  idle: boolean;
}

/** Shown on the Sanctum held page when a session completes. */
export interface HeldStats {
  sessionId: number;
  profileId: number | null;
  profileName: string;
  plannedMinutes: number;
  focusMinutes: number;
  attempts: number;
  broken: boolean;
}

/** Payload for the intercept window (src-tauri/src/engine.rs). */
export interface Intercept {
  /** "app" / "allowlist": sealed-app overlay. "title": corner nudge. "welcome": back from idle. */
  kind: "app" | "allowlist" | "title" | "welcome";
  label: string;
  attempts: number;
  profileName: string;
  elapsedMs: number;
  remainingMs: number;
  backTo: string | null;
  keyword: string | null;
  /** "welcome": the window you were on when idle began. */
  title?: string | null;
  idleMs?: number | null;
  /** "welcome": the seal's end after the idle extension. */
  endsAt?: number | null;
}

export type Category = "productive" | "neutral" | "distracting";
export const CATEGORIES: readonly Category[] = ["productive", "neutral", "distracting"];

/** Activity classification rule (src-tauri/src/classify.rs). */
export interface ClassRule {
  id: number;
  matchKind: "exe" | "title" | "domain";
  pattern: string;
  category: Category;
  /** "catalog": seeded default. "user": added or changed in Setup. */
  source: "catalog" | "user";
}

export interface ActivitySummary {
  productiveMin: number;
  neutralMin: number;
  distractingMin: number;
  idleMin: number;
}

/** A recurring item (src-tauri/src/planner.rs). */
export interface Routine {
  id: number;
  title: string;
  sort: number;
  profileId: number | null;
  active: boolean;
  /** Bit 0 = Sunday ... bit 6 = Saturday (Date.getDay order). 127 = every day. */
  daysMask: number;
  /** "HH:MM", or null for anytime. */
  time: string | null;
  durationMin: number | null;
}

export type RoutineDraft = Omit<Routine, "id" | "sort"> & { id?: number };

/** A one-time item on a date. */
export interface Todo {
  id: number;
  title: string;
  /** "YYYY-MM-DD" */
  dueDate: string;
  dueTime: string | null;
  durationMin: number | null;
  profileId: number | null;
  done: boolean;
}

export type TodoDraft = Omit<Todo, "id" | "done"> & { id?: number };

export interface RoutineCheck {
  routineId: number;
  date: string;
}

/** Google Calendar connection (src-tauri/src/gcal/mod.rs). */
export interface GcalStatus {
  /** Built with an OAuth client (src-tauri/.env). */
  configured: boolean;
  connected: boolean;
  email: string | null;
  /** The sign-in expired (every 7 days while the Google app is in Testing). */
  needsReconnect: boolean;
  syncing: boolean;
  connecting: boolean;
  lastSyncAt: number | null;
  error: string | null;
}

export interface GcalCalendar {
  id: string;
  summary: string;
  primary: boolean;
  /** Sanctum's own calendar, where routines and timed items go. */
  sanctum: boolean;
  writable: boolean;
  /** Shown in Sanctum. */
  selected: boolean;
}

/** One occurrence of an event on a selected calendar. Dates and times are local. */
export interface CalEvent {
  calendarId: string;
  calendarName: string;
  eventId: string;
  title: string;
  date: string;
  /** Last day it covers (inclusive). */
  endDate: string;
  /** "HH:MM", null when all-day. */
  time: string | null;
  durationMin: number | null;
  startMs: number;
  endMs: number;
  allDay: boolean;
  /** Other people invited (not you, not rooms). */
  attendees: number;
  recurring: boolean;
  htmlLink: string | null;
  writable: boolean;
}

export interface EventDraft {
  calendarId: string;
  eventId?: string;
  title: string;
  date: string;
  /** null = all day. */
  time: string | null;
  durationMin: number | null;
}

/** Stats tab (src-tauri/src/stats.rs). */
export type DayStatus = "none" | "kept" | "missed" | "broken" | "rest" | "today" | "future";

export interface DayStat {
  /** YYYY-MM-DD, a planner day (it starts at the daily reset time). */
  date: string;
  status: DayStatus;
  focusMin: number;
  sessions: number;
  attempts: number;
  brokenAt: number | null;
  productiveMin: number;
  distractingMin: number;
}

export interface Tempted {
  /** Exe, site, or “keyword”. */
  what: string;
  kind: string;
  count: number;
}

export interface StatsOverview {
  from: string;
  to: string;
  goalMin: number;
  restMask: number;
  currentStreak: number;
  longestStreak: number;
  days: DayStat[];
  kept: number;
  broken: number;
  missed: number;
  focusMin: number;
  attempts: number;
  tempted: Tempted[];
  productiveMin: number;
  neutralMin: number;
  distractingMin: number;
  idleMin: number;
}

/** The optional Sanctum account (src-tauri/src/cloud.rs, SPEC 4.6). */
export interface CloudStatus {
  signedIn: boolean;
  email: string | null;
  connecting: boolean;
  error: string | null;
}

export interface Partner {
  email: string | null;
  name: string | null;
  status: "active" | "removal_requested";
  since: string;
}

export interface PartnerStatus {
  email: string | null;
  partner: Partner | null;
  invite: { link: string; expiresAt: string } | null;
  /** People who chose you as their partner. */
  partnerOf: string[];
}

/** Break the seal (src-tauri/src/unlock.rs, SPEC 4.5). */
export interface LadderView {
  /** The level being worked on, 1 to 3. */
  level: 1 | 2 | 3;
  reason: string | null;
  waitLeftMs: number | null;
  paragraph: string | null;
  stage: "none" | "partner" | "solo";
  /** The partner's name; null means the solo path. */
  partner: string | null;
  expiresAt: number | null;
  requestedAt: number | null;
  soloLeftMs: number | null;
  outcome: "approved" | "denied" | "expired" | null;
  note: string | null;
  retryAt: number | null;
  notice: string | null;
  /** When the next emergency unlock opens; null means it's available. */
  emergencyNextAt: number | null;
}

/** Trackers and check-ins (SPEC 4.13, src-tauri/src/trackers.rs). */
export type TrackerKind = "number" | "bool" | "scale" | "text";
export type TrackerDisplay = "chart" | "table" | "both";

export interface Tracker {
  id: number;
  name: string;
  unit: string;
  kind: TrackerKind;
  display: TrackerDisplay;
  goal: number | null;
  sort: number;
}

export interface TrackerDraft {
  id?: number;
  name: string;
  unit?: string;
  kind: TrackerKind;
  display?: TrackerDisplay;
  goal?: number | null;
}

export interface TrackerEntry {
  id: number;
  trackerId: number;
  value: number | null;
  text: string | null;
  loggedAt: number;
  source: "checkin" | "manual";
}

export interface NewEntry {
  trackerId: number;
  value?: number | null;
  text?: string | null;
}

export interface Checkin {
  id: number;
  name: string;
  /** "HH:MM", local. */
  time: string;
  /** Bit 0 = Sunday. */
  daysMask: number;
  trackerIds: number[];
  includeGoalReview: boolean;
}

export interface CheckinDue {
  checkinId: number;
  scheduledAt: number;
  date: string;
  missed: boolean;
}

export interface NextCheckin {
  id: number;
  name: string;
  time: string;
}
