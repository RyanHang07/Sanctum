// In-memory stand-in for the Rust commands, used outside the Tauri webview
// (`npm run dev` in a browser, and Vitest). Mirrors the validation in profiles.rs closely
// enough to exercise the UI; the Rust tests are the source of truth.
import type { HeldStats, InstalledApp, Intercept, LaunchReport, NewRule, Profile, ProfileDraft, ProfilePatch, Rule, SessionView } from "./types";
import { normalizeAllow, normalizeDomain } from "./rules";
import { catalogClassRules } from "./catalog";
import type { ActivitySummary, BrowserStatus, CalEvent, Category, ClassRule, EventDraft, GcalCalendar, GcalStatus, Routine, RoutineCheck, RoutineDraft, Todo, TodoDraft } from "./types";
import { addDays, fromKey, minutesOf, todayKey } from "./planner";
import { bus } from "./bus";

const EV = { session: "sanctum://session", tick: "sanctum://tick", held: "sanctum://held", intercept: "sanctum://intercept", gcal: "sanctum://gcal", browser: "sanctum://browser" };

const DURATIONS = [30, 60, 90, 120];

const SAMPLE_APPS: InstalledApp[] = [
  { name: "Discord", exe: "discord.exe", launch: "C:\\Mock\\Discord.lnk", running: true },
  { name: "League of Legends", exe: "leagueclient.exe", launch: "C:\\Riot Games\\LeagueClient.exe", running: true },
  { name: "Notion", exe: "notion.exe", launch: "C:\\Mock\\Notion.lnk", running: false },
  { name: "Spotify", exe: "spotify.exe", launch: "C:\\Mock\\Spotify.lnk", running: false },
  { name: "Steam", exe: "steam.exe", launch: "C:\\Mock\\Steam.lnk", running: false },
  { name: "Visual Studio Code", exe: "code.exe", launch: "C:\\Mock\\Visual Studio Code.lnk", running: true },
  { name: "Zoom", exe: "zoom.exe", launch: "C:\\Mock\\Zoom.lnk", running: false },
];

interface MockState {
  settings: Map<string, string>;
  profiles: Profile[];
  nextId: number;
  running: Set<string>;
  session: SessionView | null;
  /** Idle bookkeeping for the running session (idle extends the seal). */
  idleSince: number | null;
  idleTotal: number;
  classRules: ClassRule[];
  summary: ActivitySummary;
  routines: Routine[];
  todos: Todo[];
  checks: RoutineCheck[];
  timer: ReturnType<typeof setInterval> | null;
  /** [startedAt, focusedMs] of finished sessions. */
  finished: [number, number][];
  gcal: { email: string | null; lastSyncAt: number | null; calendars: GcalCalendar[]; events: CalEvent[] };
  browsers: BrowserStatus;
}

let state: MockState;

export function resetMockBackend() {
  if (state?.timer) clearInterval(state.timer);
  state = {
    settings: new Map([
      ["on_login", "home"],
      ["close_action", "ask"],
      ["daily_reset_time", "04:00"],
      ["checkin_on_startup", "1"],
      ["idle_threshold_min", "3"],
      ["activity_retention_days", "30"],
      ["passive_apps", "zoom.exe, teams.exe, ms-teams.exe, webex.exe, ciscocollabhost.exe"],
      ["private_apps", "1password.exe, bitwarden.exe, keepassxc.exe, keepass.exe"],
      ["allowlist_always_allowed", "claude.exe, spotify.exe, comet.exe, chrome.exe, msedge.exe, brave.exe, firefox.exe, windowsterminal.exe, snippingtool.exe"],
    ]),
    profiles: [],
    nextId: 1,
    running: new Set(["code.exe", "discord.exe"]),
    session: null,
    idleSince: null,
    idleTotal: 0,
    classRules: catalogClassRules().map((r, i) => ({ id: 1000 + i, ...r, source: "catalog" as const })),
    summary: { productiveMin: 134, neutralMin: 41, distractingMin: 12, idleMin: 9 },
    routines: [],
    todos: [],
    checks: [],
    timer: null,
    finished: [],
    gcal: { email: null, lastSyncAt: null, calendars: [], events: [] },
    browsers: {
      extensionDir: "C:\\Mock\\Sanctum\\extension",
      extensionId: "iiapijigajhpjklfkokmjobdfconijag",
      browsers: [
        { name: "Comet", exe: "comet.exe", installed: true, registered: true, connected: false, version: null, incognito: null, missing: false },
        { name: "Chrome", exe: "chrome.exe", installed: true, registered: true, connected: false, version: null, incognito: null, missing: false },
        { name: "Edge", exe: "msedge.exe", installed: false, registered: false, connected: false, version: null, incognito: null, missing: false },
        { name: "Brave", exe: "brave.exe", installed: false, registered: false, connected: false, version: null, incognito: null, missing: false },
      ],
    },
  };
}
resetMockBackend();

const clone = <T>(v: T): T => structuredClone(v);

function find(id: number): Profile {
  const p = state.profiles.find((x) => x.id === id);
  if (!p) throw "That profile no longer exists.";
  return p;
}

function normalizeRule(r: NewRule): NewRule {
  const raw = r.value.trim();
  if (!raw) throw "A rule needs a value.";
  let value = raw;
  if (r.kind === "app" || r.kind === "launch_app") {
    value = raw.toLowerCase();
    if (!value.endsWith(".exe")) throw `${raw} is not an app name.`;
  } else if (r.kind === "domain") {
    const d = normalizeDomain(raw);
    if (!d) throw `${raw} is not a site.`;
    value = d;
  } else if (r.kind === "launch_url" && !/^https?:\/\/.+\..+/i.test(raw)) {
    throw `${raw} is not a URL.`;
  }
  return { ...r, value };
}

function addRuleTo(p: Profile, rule: NewRule) {
  const r = normalizeRule(rule);
  if (p.rules.some((x) => x.kind === r.kind && x.value === r.value)) return;
  const full: Rule = { id: state.nextId++, profileId: p.id, kind: r.kind, value: r.value, label: r.label ?? null, path: r.path ?? null, allow: [] };
  p.rules.push(full);
}

function uniqueName(base: string): string {
  const b = base.trim() || "New profile";
  const taken = (n: string) => state.profiles.some((p) => p.name.toLowerCase() === n.toLowerCase());
  if (!taken(b)) return b;
  for (let i = 2; ; i++) if (!taken(`${b} ${i}`)) return `${b} ${i}`;
}

const handlers: Record<string, (a: any) => unknown> = {
  get_setting: ({ key }) => state.settings.get(key) ?? null,
  set_setting: ({ key, value }) => void state.settings.set(key, value),
  db_status: () => ({ ready: true, schemaVersion: 2, tables: [], path: "(mock)" }),

  list_profiles: () => clone(state.profiles),
  create_profile: ({ draft }: { draft: ProfileDraft }) => {
    const minutes = draft.defaultMinutes ?? 60;
    if (!DURATIONS.includes(minutes)) throw "Focus length must be one of 30, 60, 90, or 120 minutes.";
    const p: Profile = {
      id: state.nextId++,
      name: uniqueName(draft.name),
      allowlistMode: !!draft.allowlistMode,
      defaultMinutes: minutes,
      workTypes: draft.workTypes ?? [],
      createdAt: Date.now(),
      rules: [],
    };
    (draft.rules ?? []).forEach((r) => addRuleTo(p, r));
    state.profiles.push(p);
    return clone(p);
  },
  update_profile: ({ id, patch }: { id: number; patch: ProfilePatch }) => {
    const p = find(id);
    if (patch.name !== undefined) {
      const name = patch.name.trim();
      if (!name) throw "A profile needs a name.";
      if (state.profiles.some((x) => x.id !== id && x.name.toLowerCase() === name.toLowerCase()))
        throw `Another profile is already named ${name}.`;
      p.name = name;
    }
    if (patch.defaultMinutes !== undefined) {
      if (!DURATIONS.includes(patch.defaultMinutes)) throw "Focus length must be one of 30, 60, 90, or 120 minutes.";
      p.defaultMinutes = patch.defaultMinutes;
    }
    if (patch.allowlistMode !== undefined) p.allowlistMode = patch.allowlistMode;
    return clone(p);
  },
  delete_profile: ({ id }) => {
    find(id);
    state.profiles = state.profiles.filter((p) => p.id !== id);
  },
  add_rule: ({ profileId, rule }: { profileId: number; rule: NewRule }) => {
    const p = find(profileId);
    addRuleTo(p, rule);
    return clone(p);
  },
  remove_rule: ({ ruleId }) => {
    const p = state.profiles.find((x) => x.rules.some((r) => r.id === ruleId));
    if (!p) throw "That profile no longer exists.";
    p.rules = p.rules.filter((r) => r.id !== ruleId);
    return clone(p);
  },
  add_site_allow: ({ ruleId, prefix }: { ruleId: number; prefix: string }) => {
    const p = state.profiles.find((x) => x.rules.some((r) => r.id === ruleId));
    const rule = p?.rules.find((r) => r.id === ruleId);
    if (!p || !rule) throw "That profile no longer exists.";
    if (rule.kind !== "domain") throw "Only sealed sites take exceptions.";
    const s = normalizeAllow(rule.value, prefix);
    if (!s) throw `${prefix.trim()} is not a page on ${rule.value}.`;
    if (!rule.allow.some((a) => a.prefix === s)) rule.allow.push({ id: state.nextId++, prefix: s });
    return clone(p);
  },
  remove_site_allow: ({ id }: { id: number }) => {
    const p = state.profiles.find((x) => x.rules.some((r) => r.allow.some((a) => a.id === id)));
    if (!p) throw "That profile no longer exists.";
    for (const r of p.rules) r.allow = r.allow.filter((a) => a.id !== id);
    return clone(p);
  },
  browser_status: (): BrowserStatus => clone(state.browsers),

  get_session: () => (state.session ? view() : null),
  preview_seal: ({ profileId }) => {
    const p = find(profileId);
    const opens = new Set(p.rules.filter((r) => r.kind === "launch_app").map((r) => r.value));
    return p.rules
      .filter((r) => r.kind === "app" && state.running.has(r.value) && !opens.has(r.value))
      .map((r) => r.label ?? r.value);
  },
  start_session: ({ profileId, minutes }) => {
    if (state.session) throw "A session is already running.";
    if (!DURATIONS.includes(minutes)) throw "Focus length must be one of 30, 60, 90, or 120 minutes.";
    const p = find(profileId);
    const now = Date.now();
    state.session = {
      id: state.nextId++,
      profileId: p.id,
      profileName: p.name,
      plannedMinutes: minutes,
      startedAt: now,
      endsAt: now + minutes * 60_000,
      remainingMs: minutes * 60_000,
      elapsedMs: 0,
      attempts: 0,
      sealedCount: p.rules.filter((r) => r.kind === "app" || r.kind === "title").length,
      broken: false,
      idle: false,
    };
    state.idleSince = null;
    state.idleTotal = 0;
    // Sealed apps close at the start.
    p.rules.filter((r) => r.kind === "app").forEach((r) => state.running.delete(r.value));
    state.timer = setInterval(tick, 1000);
    bus.emit(EV.session, view());
    return view();
  },
  end_session_early: ({ reason }) => {
    if (!state.session) throw "No session is running.";
    if (String(reason).trim().length < 50) throw "Write at least 50 characters.";
    finishSession();
    bus.emit(EV.session, null);
  },
  focus_minutes_since: ({ since }) => {
    // Finished sessions only; the UI adds the running one from its ticks.
    const done = state.finished.filter(([s]) => s >= since).reduce((a, [, ms]) => a + ms, 0);
    return Math.floor(done / 60_000);
  },

  list_class_rules: () => clone(state.classRules),
  add_class_rule: ({ rule }: { rule: Pick<ClassRule, "matchKind" | "pattern" | "category"> }) => {
    let pattern = rule.pattern.trim();
    if (rule.matchKind === "exe") {
      pattern = pattern.toLowerCase();
      if (!pattern.endsWith(".exe")) throw `${pattern} is not an app name.`;
    } else if (rule.matchKind === "domain") {
      const d = normalizeDomain(pattern);
      if (!d) throw `${pattern} is not a site.`;
      pattern = d;
    }
    if (!pattern) throw "A rule needs a value.";
    const existing = state.classRules.find((r) => r.matchKind === rule.matchKind && r.pattern === pattern);
    if (existing) {
      existing.category = rule.category;
      existing.source = "user";
      return clone(existing);
    }
    const r: ClassRule = { id: state.nextId++, matchKind: rule.matchKind, pattern, category: rule.category, source: "user" };
    state.classRules.push(r);
    return clone(r);
  },
  set_class_rule_category: ({ id, category }: { id: number; category: Category }) => {
    const r = state.classRules.find((x) => x.id === id);
    if (r) {
      r.category = category;
      r.source = "user";
    }
  },
  remove_class_rule: ({ id }) => {
    state.classRules = state.classRules.filter((r) => r.id !== id);
  },
  activity_summary: () => clone(state.summary),

  list_routines: () => clone([...state.routines].sort((a, b) => a.sort - b.sort || a.id - b.id)),
  save_routine: ({ draft }: { draft: RoutineDraft }) => {
    const title = draft.title.trim();
    if (!title) throw "Give it a name.";
    if (draft.daysMask < 1 || draft.daysMask > 127) throw "Pick at least one day.";
    const existing = draft.id !== undefined ? state.routines.find((r) => r.id === draft.id) : undefined;
    if (draft.id !== undefined && !existing) throw "That routine no longer exists.";
    const r: Routine = {
      id: existing?.id ?? state.nextId++,
      sort: existing?.sort ?? state.routines.length,
      title,
      profileId: draft.profileId,
      active: draft.active,
      daysMask: draft.daysMask,
      time: draft.time,
      durationMin: draft.durationMin,
    };
    state.routines = [...state.routines.filter((x) => x.id !== r.id), r];
    return clone(r);
  },
  delete_routine: ({ id }) => {
    state.routines = state.routines.filter((r) => r.id !== id);
    state.checks = state.checks.filter((c) => c.routineId !== id);
  },
  list_routine_checks: ({ from, to }) => clone(state.checks.filter((c) => c.date >= from && c.date <= to)),
  set_routine_done: ({ id, date, done }) => {
    state.checks = state.checks.filter((c) => !(c.routineId === id && c.date === date));
    if (done) state.checks.push({ routineId: id, date });
  },
  list_todos: ({ from, to }) => clone(state.todos.filter((t) => t.dueDate >= from && t.dueDate <= to)),
  save_todo: ({ draft }: { draft: TodoDraft }) => {
    const title = draft.title.trim();
    if (!title) throw "Give it a name.";
    const existing = draft.id !== undefined ? state.todos.find((t) => t.id === draft.id) : undefined;
    const t: Todo = { ...draft, id: existing?.id ?? state.nextId++, title, done: existing?.done ?? false };
    state.todos = [...state.todos.filter((x) => x.id !== t.id), t];
    return clone(t);
  },
  set_todo_done: ({ id, done }) => {
    const t = state.todos.find((x) => x.id === id);
    if (!t) throw "That item no longer exists.";
    t.done = done;
    return clone(t);
  },
  delete_todo: ({ id }) => {
    state.todos = state.todos.filter((t) => t.id !== id);
  },

  list_installed_apps: () => clone(SAMPLE_APPS),
  app_icon: () => null,
  launch_profile: ({ id }): LaunchReport => {
    const report: LaunchReport = { opened: [], focused: [], missing: [], failed: [] };
    for (const r of find(id).rules) {
      const label = r.label ?? r.value;
      if (r.kind === "launch_url") report.opened.push(label);
      else if (r.kind === "launch_app") {
        if (state.running.has(r.value)) report.focused.push(label);
        else if (r.path || SAMPLE_APPS.some((a) => a.exe === r.value)) report.opened.push(label);
        else report.missing.push(label);
      }
    }
    return report;
  },
};


// --- Google Calendar stand-in: a fake account with a few events around today ---

const MOCK_CALENDARS: GcalCalendar[] = [
  { id: "primary@example.com", summary: "Personal", primary: true, sanctum: false, writable: true, selected: true },
  { id: "sanctum@group.calendar", summary: "Sanctum", primary: false, sanctum: true, writable: true, selected: true },
  { id: "team@group.calendar", summary: "Team", primary: false, sanctum: false, writable: true, selected: false },
  { id: "holidays@group.calendar", summary: "Holidays", primary: false, sanctum: false, writable: false, selected: false },
];

function mockEvent(calendarId: string, eventId: string, title: string, date: string, time: string | null, durationMin: number | null, extra: Partial<CalEvent> = {}): CalEvent {
  const cal = MOCK_CALENDARS.find((c) => c.id === calendarId)!;
  const day = fromKey(date).getTime();
  const startMs = time ? day + minutesOf(time) * 60_000 : day;
  const endDate = extra.endDate ?? date;
  const endMs = time ? startMs + (durationMin ?? 60) * 60_000 : fromKey(addDays(endDate, 1)).getTime();
  return {
    calendarId,
    calendarName: cal.summary,
    eventId,
    title,
    date,
    endDate,
    time,
    durationMin: time ? durationMin ?? 60 : null,
    startMs,
    endMs,
    allDay: !time,
    attendees: 0,
    recurring: false,
    htmlLink: "https://calendar.google.com/calendar/event?eid=mock",
    writable: cal.writable,
    ...extra,
  };
}

function sampleEvents(): CalEvent[] {
  const t = todayKey();
  return [
    mockEvent("primary@example.com", "standup", "Team standup", t, "09:30", 15, { attendees: 4, recurring: true }),
    mockEvent("primary@example.com", "deep", "Deep work #focus", addDays(t, 1), "14:00", 90),
    mockEvent("primary@example.com", "dentist", "Dentist", addDays(t, 2), "16:00", 60),
    mockEvent("primary@example.com", "offsite", "Offsite", addDays(t, 3), null, null, { endDate: addDays(t, 4) }),
    mockEvent("team@group.calendar", "retro", "Sprint retro", addDays(t, 1), "11:00", 60, { attendees: 6 }),
  ];
}

function gcalStatus(): GcalStatus {
  const g = state.gcal;
  return { configured: true, connected: !!g.email, email: g.email, needsReconnect: false, syncing: false, connecting: false, lastSyncAt: g.lastSyncAt, error: null };
}

function withCalendar(e: CalEvent): CalEvent {
  const cal = state.gcal.calendars.find((c) => c.id === e.calendarId);
  return { ...e, calendarName: cal?.summary ?? e.calendarName, writable: cal?.writable ?? false };
}

const gcalHandlers: Record<string, (a: any) => unknown> = {
  gcal_status: () => gcalStatus(),
  gcal_connect: () => {
    state.gcal = { email: "you@example.com", lastSyncAt: Date.now(), calendars: clone(MOCK_CALENDARS), events: sampleEvents() };
    bus.emit(EV.gcal, gcalStatus());
    return gcalStatus();
  },
  gcal_cancel_connect: () => undefined,
  gcal_disconnect: () => {
    state.gcal = { email: null, lastSyncAt: null, calendars: [], events: [] };
    return gcalStatus();
  },
  gcal_remove_calendar: () => gcalHandlers.gcal_disconnect!({}),
  gcal_calendars: () => clone(state.gcal.calendars),
  gcal_set_selected: ({ id, selected }) => {
    const c = state.gcal.calendars.find((x) => x.id === id);
    if (c) c.selected = selected;
  },
  gcal_events: ({ from, to }) => {
    const on = new Set(state.gcal.calendars.filter((c) => c.selected).map((c) => c.id));
    return clone(state.gcal.events.filter((e) => on.has(e.calendarId) && e.date <= to && e.endDate >= from).sort((a, b) => a.startMs - b.startMs));
  },
  gcal_sync_now: () => {
    if (state.gcal.email) state.gcal.lastSyncAt = Date.now();
  },
  gcal_save_event: ({ draft }: { draft: EventDraft }) => {
    const title = draft.title.trim();
    if (!title) throw "Give it a name.";
    if (!state.gcal.email) throw "Google Calendar is not connected.";
    const prev = state.gcal.events.find((e) => e.calendarId === draft.calendarId && e.eventId === draft.eventId);
    const e = withCalendar(
      mockEvent(draft.calendarId, draft.eventId ?? `ev${state.nextId++}`, title, draft.date, draft.time, draft.durationMin, {
        attendees: prev?.attendees ?? 0,
        recurring: prev?.recurring ?? false,
      }),
    );
    state.gcal.events = [...state.gcal.events.filter((x) => x !== prev), e];
  },
  gcal_delete_event: ({ calendarId, eventId }) => {
    state.gcal.events = state.gcal.events.filter((e) => !(e.calendarId === calendarId && e.eventId === eventId));
  },
  gcal_open: () => undefined,
};

function view(): SessionView {
  const s = state.session!;
  const now = Date.now();
  const endsAt = s.endsAt + state.idleTotal + (state.idleSince !== null ? now - state.idleSince : 0);
  const remainingMs = Math.max(0, endsAt - now);
  return { ...s, endsAt, remainingMs, elapsedMs: s.plannedMinutes * 60_000 - remainingMs, idle: state.idleSince !== null };
}

function finishSession() {
  const s = state.session;
  if (!s) return;
  if (state.timer) clearInterval(state.timer);
  state.finished.push([s.startedAt, view().elapsedMs]);
  state.session = null;
  state.timer = null;
}

function tick() {
  const s = state.session;
  if (!s) return;
  const v = view();
  if (v.remainingMs > 0) return bus.emit(EV.tick, v);
  const held: HeldStats = {
    sessionId: s.id,
    profileId: s.profileId,
    profileName: s.profileName,
    plannedMinutes: s.plannedMinutes,
    focusMinutes: s.plannedMinutes,
    attempts: s.attempts,
    broken: s.broken,
  };
  finishSession();
  bus.emit(EV.session, null);
  bus.emit(EV.held, held);
}

/** Dev/test helpers: jump the running session forward, simulate a blocked launch, or go idle. */
export const mockControls = {
  /** The extension connects (or drops) in a browser. */
  extension(exe: string, patch: { connected?: boolean; incognito?: boolean | null; missing?: boolean }) {
    const b = state.browsers.browsers.find((x) => x.exe === exe);
    if (!b) return;
    Object.assign(b, patch, patch.connected ? { version: "0.1.0" } : patch.connected === false ? { version: null, incognito: null } : {});
    bus.emit(EV.browser, null);
  },
  /** A meeting with other people running now, on the connected calendar (In event state). */
  meetingNow(minutesLeft = 30, title = "Mock interview") {
    if (!state.gcal.email) gcalHandlers.gcal_connect!({});
    const now = Date.now();
    const start = new Date(now - 10 * 60_000);
    const time = `${String(start.getHours()).padStart(2, "0")}:${String(start.getMinutes()).padStart(2, "0")}`;
    const e = mockEvent("primary@example.com", `meeting${state.nextId++}`, title, todayKey(start, "00:00"), time, 10 + minutesLeft, { attendees: 2 });
    state.gcal.events.push({ ...e, startMs: now - 10 * 60_000, endMs: now + minutesLeft * 60_000 });
    bus.emit(EV.gcal, gcalStatus());
  },
  /** Idle since `ms` ago (the countdown pauses). */
  goIdle(ms = 3 * 60_000) {
    if (!state.session || state.idleSince !== null) return;
    state.idleSince = Date.now() - ms;
    bus.emit(EV.tick, view());
  },
  /** Input resumed: the idle stretch extends the seal, then "Welcome back". */
  comeBack(title = "graph.py - Visual Studio Code") {
    if (!state.session || state.idleSince === null) return;
    const idleMs = Date.now() - state.idleSince;
    state.idleTotal += idleMs;
    state.idleSince = null;
    const v = view();
    bus.emit(EV.tick, v);
    bus.emit(EV.intercept, {
      kind: "welcome",
      label: "Visual Studio Code",
      attempts: v.attempts,
      profileName: v.profileName,
      elapsedMs: v.elapsedMs,
      remainingMs: v.remainingMs,
      backTo: null,
      keyword: null,
      title,
      idleMs,
      endsAt: v.endsAt,
    } satisfies Intercept);
  },
  fastForward(ms: number) {
    if (!state.session) return;
    state.session.startedAt -= ms;
    state.session.endsAt -= ms;
    tick();
  },
  block(label = "Discord", kind: Intercept["kind"] = "app") {
    // Without a session (e.g. previewing #/intercept on its own), use sample numbers.
    if (state.session) state.session.attempts += 1;
    const v = state.session
      ? view()
      : { attempts: 3, profileName: "Interview Prep", elapsedMs: 18 * 60_000, remainingMs: 32 * 60_000 + 14_000 };
    bus.emit(EV.intercept, {
      kind,
      label,
      attempts: v.attempts,
      profileName: v.profileName,
      elapsedMs: v.elapsedMs,
      remainingMs: v.remainingMs,
      backTo: "Visual Studio Code",
      keyword: kind === "title" ? "shorts" : null,
    } satisfies Intercept);
    if (state.session) bus.emit(EV.tick, v);
  },
};

if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as { __sanctumMock: typeof mockControls }).__sanctumMock = mockControls;
}

export async function mockInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const h = handlers[cmd] ?? gcalHandlers[cmd];
  // Window and tray commands have nothing to do outside Tauri.
  if (!h) return undefined as T;
  return h(args ?? {}) as T;
}
