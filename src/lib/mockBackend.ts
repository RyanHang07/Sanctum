// In-memory stand-in for the Rust commands, used outside the Tauri webview
// (`npm run dev` in a browser, and Vitest). Mirrors the validation in profiles.rs closely
// enough to exercise the UI; the Rust tests are the source of truth.
import type { HeldStats, InstalledApp, Intercept, LaunchReport, NewRule, Profile, ProfileDraft, ProfilePatch, Rule, SessionView } from "./types";
import { guessDistraction, normalizeAllow, normalizeDomain } from "./rules";
import { catalogClassRules, catalogDistractions } from "./catalog";
import type { GuardStatus, ActivitySummary, BrowserStatus, CalEvent, Distraction, DistractionSuggestion, NewDistraction, CloudStatus, LadderView, PartnerStatus, DayStatus, StatsOverview, Category, ClassRule, EventDraft, GcalCalendar, GcalStatus, Routine, RoutineCheck, RoutineDraft, Todo, TodoDraft } from "./types";
import { addDays, fromKey, minutesOf, todayKey } from "./planner";
import { bus } from "./bus";
import { resetMockTrackers, trackerControls, trackerHandlers } from "./mockTrackers";
import type { Note, NoteDraft } from "./types";
import { dayStatus, streaks } from "./stats";

const EV = { session: "sanctum://session", tick: "sanctum://tick", held: "sanctum://held", intercept: "sanctum://intercept", gcal: "sanctum://gcal", browser: "sanctum://browser", cloud: "sanctum://cloud" };

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

interface MockDay {
  focusMin: number;
  brokenAt?: number | null;
  attempts?: number;
  productiveMin?: number;
  distractingMin?: number;
}

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
  /** Extra per-day history for Stats (dev preview and tests). */
  statsDays: Record<string, MockDay>;
  distractions: Distraction[];
  tempted: { what: string; kind: string; count: number }[];
  gcal: { email: string | null; lastSyncAt: number | null; calendars: GcalCalendar[]; events: CalEvent[] };
  browsers: BrowserStatus;
  guard: { installed: boolean; decline: boolean; restarts: number[] };
  notes: Note[];
  cloud: { email: string | null; partner: PartnerStatus["partner"]; invite: PartnerStatus["invite"]; partnerOf: string[] };
}

let state: MockState;
// Declared before resetMockBackend runs at load.
let mockLadder: MockLadder | null = null;

export function resetMockBackend() {
  if (state?.timer) clearInterval(state.timer);
  mockLadder = null;
  resetMockTrackers();
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
      ["allowlist_always_allowed", "claude.exe, spotify.exe, comet.exe, chrome.exe, msedge.exe, brave.exe, firefox.exe, windowsterminal.exe, snippingtool.exe, lightshot.exe, sharex.exe, screenclippinghost.exe, powershell.exe, pwsh.exe, cmd.exe, docker desktop.exe, notepad.exe, calculatorapp.exe, 1password.exe, bitwarden.exe"],
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
    statsDays: {},
    distractions: [],
    tempted: [],
    gcal: { email: null, lastSyncAt: null, calendars: [], events: [] },
    cloud: { email: null, partner: null, invite: null, partnerOf: [] },
    guard: { installed: false, decline: false, restarts: [] },
    notes: [],
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
  if ((r.kind as string) === "app" || (r.kind as string) === "domain" || (r.kind as string) === "title") {
    throw "Seals live in Distractions now, for every profile.";
  }
  if (r.kind === "launch_app") {
    value = raw.toLowerCase();
    if (!value.endsWith(".exe")) throw `${raw} is not an app name.`;
  } else if (r.kind === "launch_url" && !/^https?:\/\/.+\..+/i.test(raw)) {
    throw `${raw} is not a URL.`;
  }
  return { ...r, value };
}

function addRuleTo(p: Profile, rule: NewRule) {
  const r = normalizeRule(rule);
  if (p.rules.some((x) => x.kind === r.kind && x.value === r.value)) return;
  const full: Rule = { id: state.nextId++, profileId: p.id, kind: r.kind, value: r.value, label: r.label ?? null, path: r.path ?? null };
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
  list_distractions: () => clone(state.distractions),
  add_distraction: ({ item }: { item: NewDistraction }) => {
    const raw = item.value.trim();
    const kind = item.kind === "auto" ? guessDistraction(raw) : item.kind;
    if (!kind) throw "Type an app, a site or link, or a keyword.";
    let value = raw.toLowerCase();
    if (kind === "app" && !value.endsWith(".exe")) throw `${raw} is not an app name.`;
    if (kind === "site") {
      const d = normalizeDomain(raw);
      if (!d) throw `${raw} is not a site or link.`;
      value = d;
    }
    if (kind === "keyword" && value.length < 3) throw "A keyword needs at least 3 characters.";
    const hit = state.distractions.find((d) => d.kind === kind && d.value === value);
    if (hit) hit.label = item.label ?? hit.label;
    else state.distractions.push({ id: state.nextId++, kind, value, label: item.label ?? null, path: item.path ?? null, allow: [] });
    state.distractions.sort((a, b) => a.kind.localeCompare(b.kind) || (a.label ?? a.value).localeCompare(b.label ?? b.value));
    return clone(state.distractions);
  },
  remove_distraction: ({ id }: { id: number }) => {
    if (state.session) throw "Distractions can't be loosened while you're sealed.";
    state.distractions = state.distractions.filter((d) => d.id !== id);
    return clone(state.distractions);
  },
  add_distraction_allow: ({ id, prefix }: { id: number; prefix: string }) => {
    if (state.session) throw "Distractions can't be loosened while you're sealed.";
    const d = state.distractions.find((x) => x.id === id);
    if (!d) throw "That distraction is gone.";
    if (d.kind !== "site") throw "Only sites can keep pages open.";
    const s = normalizeAllow(d.value, prefix);
    if (!s) throw `${prefix.trim()} is not a page on ${d.value}.`;
    if (!d.allow.some((a) => a.prefix === s)) d.allow.push({ id: state.nextId++, prefix: s });
    return clone(state.distractions);
  },
  remove_distraction_allow: ({ id }: { id: number }) => {
    for (const d of state.distractions) d.allow = d.allow.filter((a) => a.id !== id);
    return clone(state.distractions);
  },
  distraction_suggestions: (): DistractionSuggestion[] => {
    const flagged = new Set(state.distractions.map((d) => `${d.kind}:${d.value}`));
    const used: DistractionSuggestion[] = [
      { kind: "app", value: "leagueclient.exe", label: "League of Legends", minutes: 184 },
      { kind: "site", value: "reddit.com", label: "reddit.com", minutes: 96 },
      { kind: "app", value: "spotify.exe", label: "Spotify", minutes: 41 },
    ];
    const common: DistractionSuggestion[] = catalogDistractions().flatMap((g) =>
      g.items.map((i) => ({ kind: i.kind as Distraction["kind"], value: i.value, label: g.label, minutes: null })),
    );
    return [...used, ...common].filter((s) => !flagged.has(`${s.kind}:${s.value}`));
  },
  browser_status: (): BrowserStatus => clone(state.browsers),
  list_notes: () => clone([...state.notes].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt || b.id - a.id)),
  save_note: ({ draft }: { draft: NoteDraft }) => {
    const now = Math.max(Date.now(), ...state.notes.map((n) => n.updatedAt + 1));
    if (draft.id !== undefined) {
      const n = state.notes.find((x) => x.id === draft.id);
      if (!n) throw "That note no longer exists.";
      Object.assign(n, { title: draft.title.slice(0, 200), body: draft.body, updatedAt: now });
      return clone(n);
    }
    const n: Note = { id: state.nextId++, title: draft.title.slice(0, 200), body: draft.body, pinned: false, createdAt: now, updatedAt: now };
    state.notes.push(n);
    return clone(n);
  },
  pin_note: ({ id, pinned }: { id: number; pinned: boolean }) => {
    const n = state.notes.find((x) => x.id === id);
    if (!n) throw "That note no longer exists.";
    n.pinned = pinned;
    return clone(n);
  },
  delete_note: ({ id }: { id: number }) => {
    state.notes = state.notes.filter((n) => n.id !== id);
  },
  app_version: () => "0.1.0",
  update_check: () => null,
  update_install: () => {
    throw "Sanctum is up to date.";
  },
  diagnostics: () => "Sanctum 0.1.0 (mock)",
  guard_status: (): GuardStatus => guardStatus(),
  guard_install: (): GuardStatus => {
    if (state.guard.decline) throw "Windows didn't allow it. Protection needs one admin approval.";
    state.guard.installed = true;
    return guardStatus();
  },
  guard_uninstall: (): GuardStatus => {
    if (state.session) throw "Protection stays on while you're sealed.";
    state.guard.installed = false;
    return guardStatus();
  },

  cloud_status: (): CloudStatus => ({ configured: true, signedIn: !!state.cloud.email, email: state.cloud.email, connecting: false, error: null }),
  cloud_sign_in_google: () => {
    state.cloud.email = "you@gmail.com";
    bus.emit(EV.cloud, null);
    return handlers.cloud_status!({});
  },
  cloud_sign_in_email: ({ email }: { email: string }) => {
    if (!email.includes("@")) throw "That doesn't look like an email address.";
    state.cloud.email = email.trim().toLowerCase();
    bus.emit(EV.cloud, null);
    return handlers.cloud_status!({});
  },
  cloud_cancel_sign_in: () => undefined,
  cloud_sign_out: () => {
    state.cloud = { email: null, partner: null, invite: null, partnerOf: [] };
    return handlers.cloud_status!({});
  },
  cloud_partner: (): PartnerStatus => {
    if (!state.cloud.email) throw "Sign in first.";
    const c = state.cloud;
    return clone({ email: c.email, partner: c.partner, invite: c.partner ? null : c.invite, partnerOf: c.partnerOf });
  },
  cloud_create_invite: () => {
    state.cloud.invite = { link: `http://localhost:5174/invite/mock${state.nextId++}`, expiresAt: new Date(Date.now() + 48 * 3_600_000).toISOString() };
    return handlers.cloud_partner!({});
  },
  cloud_cancel_invite: () => {
    state.cloud.invite = null;
    return handlers.cloud_partner!({});
  },
  cloud_request_removal: ({ cancel }: { cancel: boolean }) => {
    if (!cancel && state.session) throw "Partner changes wait until the seal ends.";
    if (state.cloud.partner) state.cloud.partner.status = cancel ? "active" : "removal_requested";
    return handlers.cloud_partner!({});
  },

  get_session: () => (state.session ? view() : null),
  preview_seal: ({ profileId }) => {
    const p = find(profileId);
    const opens = new Set(p.rules.filter((r) => r.kind === "launch_app").map((r) => r.value));
    return state.distractions
      .filter((d) => d.kind === "app" && state.running.has(d.value) && !opens.has(d.value))
      .map((d) => d.label ?? d.value);
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
      sealedCount: state.distractions.length,
      broken: false,
      idle: false,
    };
    state.idleSince = null;
    state.idleTotal = 0;
    // Sealed apps close at the start.
    state.distractions.filter((d) => d.kind === "app").forEach((d) => state.running.delete(d.value));
    state.timer = setInterval(tick, 1000);
    bus.emit(EV.session, view());
    return view();
  },
  ladder_open: () => {
    const l = ladder();
    if (!l.third) l.partner = state.cloud.email && state.cloud.partner ? (state.cloud.partner.name ?? state.cloud.partner.email) : null;
    return ladderView();
  },
  ladder_view: () => {
    const l = ladder();
    const now = Date.now();
    if (l.approved) {
      const v = ladderView();
      endUnlocked();
      return { ...v, outcome: "approved" };
    }
    if (l.third?.kind === "partner" && now >= l.third.at + 30 * 60_000) refuse("expired", null);
    return ladderView();
  },
  ladder_reason: ({ reason }: { reason: string }) => {
    const l = ladder();
    if (l.level !== 1) throw "You already gave a reason.";
    if (reason.trim().length < 50) throw "Write at least 50 characters.";
    l.reason = reason.trim();
    l.waitStarted = Date.now();
    return ladderView();
  },
  ladder_continue: () => {
    const l = ladder();
    if (l.level !== 1 || l.waitStarted === null || Date.now() < l.waitStarted + 5 * 60_000) throw "The wait isn't over.";
    l.level = 2;
    l.paragraph = MOCK_PARAGRAPH;
    return ladderView();
  },
  ladder_retype: ({ text }: { text: string }) => {
    const l = ladder();
    if (l.level !== 2 || text.trim() !== l.paragraph) throw "Not an exact match. Check it and try again.";
    l.level = 3;
    return ladderView();
  },
  ladder_request: () => {
    const l = ladder();
    if (l.level !== 3) throw "Finish the earlier steps first.";
    if (l.retryAt && l.retryAt > Date.now()) throw `The next request opens in ${Math.ceil((l.retryAt - Date.now()) / 60_000)} min.`;
    l.outcome = null;
    l.note = null;
    l.third = { kind: l.partner ? "partner" : "solo", at: Date.now() };
    return ladderView();
  },
  ladder_finish_solo: () => {
    const l = ladder();
    if (l.third?.kind !== "solo" || Date.now() < l.third.at + 30 * 60_000) throw "The cooldown isn't over.";
    const view = ladderView();
    endUnlocked();
    return { ...view, outcome: "approved" };
  },
  ladder_cancel: () => {
    ladder().third = null;
  },
  emergency_unlock: ({ reason }: { reason: string }) => {
    const last = Number(state.settings.get("emergency_used_at") ?? 0);
    if (last && Date.now() < last + 7 * 86_400_000) throw "The emergency unlock is back later this week.";
    if (!reason.trim()) throw "Say what the emergency is.";
    endUnlocked();
    state.settings.set("emergency_used_at", String(Date.now()));
  },
  stats_overview: ({ from, to }: { from: string; to: string }) => statsOverview(from, to),
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

function guardStatus(): GuardStatus {
  const g = state.guard;
  const on = g.installed && !!state.session;
  const blocked = state.distractions.filter((d) => d.kind === "site" && !d.value.includes("/") && !d.allow.length).length;
  return { installed: g.installed, running: g.installed, hostsBlocked: on ? blocked : 0, restarts: g.restarts.length, lastRestartAt: g.restarts.at(-1) ?? null };
}

function statsOverview(from: string, to: string): StatsOverview {
  const reset = state.settings.get("daily_reset_time") ?? "04:00";
  const today = todayKey(new Date(), reset);
  const goalMin = Number(state.settings.get("daily_goal_min")) || 120;
  const restMask = Number(state.settings.get("rest_days_mask")) || 0;
  const days: Record<string, Required<MockDay> & { sessions: number }> = {};
  const day = (k: string) => (days[k] ??= { focusMin: 0, brokenAt: null, attempts: 0, productiveMin: 0, distractingMin: 0, sessions: 0 });
  for (const [k, d] of Object.entries(state.statsDays)) Object.assign(day(k), { ...d, brokenAt: d.brokenAt ?? null, sessions: d.focusMin ? 1 : 0 });
  for (const [start, ms] of state.finished) {
    const d = day(todayKey(new Date(start), reset));
    d.focusMin += Math.floor(ms / 60_000);
    d.sessions += 1;
  }
  if (state.session) {
    const d = day(today);
    d.focusMin += Math.floor(view().elapsedMs / 60_000);
    d.attempts += state.session.attempts;
    d.sessions += 1;
  }
  const keys = Object.keys(days).filter((k) => days[k]!.sessions > 0).sort();
  const started = keys[0] ?? null;
  const statusOf = (k: string): DayStatus => {
    const d = days[k];
    const rest = (restMask & (1 << fromKey(k).getDay())) !== 0;
    const when = k < today ? -1 : k === today ? 0 : 1;
    return dayStatus(d?.focusMin ?? 0, !!d?.brokenAt, rest, goalMin, when, started === null || k < started);
  };
  const history: DayStatus[] = [];
  for (let k = [started ?? from, from].sort()[0]!; k <= today; k = addDays(k, 1)) history.push(statusOf(k));
  const [currentStreak, longestStreak] = streaks(history);
  const list: StatsOverview["days"] = [];
  for (let k = from; k <= to; k = addDays(k, 1)) {
    const d = days[k];
    list.push({
      date: k,
      status: statusOf(k),
      focusMin: d?.focusMin ?? 0,
      sessions: d?.sessions ?? 0,
      attempts: d?.attempts ?? 0,
      brokenAt: d?.brokenAt ?? null,
      productiveMin: d?.productiveMin ?? 0,
      distractingMin: d?.distractingMin ?? 0,
    });
  }
  const sum = (f: (x: (typeof list)[number]) => number) => list.reduce((a, x) => a + f(x), 0);
  const count = (s: DayStatus) => list.filter((x) => x.status === s).length;
  const productiveMin = sum((x) => x.productiveMin);
  const distractingMin = sum((x) => x.distractingMin);
  return {
    from,
    to,
    goalMin,
    restMask,
    currentStreak,
    longestStreak,
    days: list,
    kept: count("kept"),
    broken: count("broken"),
    missed: count("missed"),
    focusMin: sum((x) => x.focusMin),
    attempts: sum((x) => x.attempts),
    tempted: clone(state.tempted),
    productiveMin,
    neutralMin: Math.round(productiveMin * 0.4),
    distractingMin,
    idleMin: Math.round(productiveMin * 0.15),
  };
}

const MOCK_PARAGRAPH = "I set this time aside when my head was clear. Leaving now trades that plan for a feeling that will pass in minutes.";

interface MockLadder {
  sessionId: number;
  level: 1 | 2 | 3;
  reason: string | null;
  waitStarted: number | null;
  paragraph: string | null;
  third: { kind: "partner" | "solo"; at: number } | null;
  outcome: LadderView["outcome"];
  note: string | null;
  retryAt: number | null;
  partner: string | null;
  /** The partner approved; the next view ends the session, as the real poll does. */
  approved?: boolean;
}

function ladder(): MockLadder {
  if (!state.session) throw "No session is running.";
  if (mockLadder?.sessionId !== state.session.id) {
    mockLadder = { sessionId: state.session.id, level: 1, reason: null, waitStarted: null, paragraph: null, third: null, outcome: null, note: null, retryAt: null, partner: null };
  }
  return mockLadder;
}

function refuse(outcome: "denied" | "expired", note: string | null) {
  const l = mockLadder!;
  Object.assign(l, { third: null, outcome, note, retryAt: Date.now() + 15 * 60_000, level: 2, paragraph: MOCK_PARAGRAPH });
}

function ladderView(): LadderView {
  const l = mockLadder!;
  const now = Date.now();
  const last = Number(state.settings.get("emergency_used_at") ?? 0);
  return {
    level: l.level,
    reason: l.reason,
    waitLeftMs: l.waitStarted === null ? null : Math.max(0, l.waitStarted + 5 * 60_000 - now),
    paragraph: l.paragraph,
    stage: l.third?.kind ?? "none",
    partner: l.partner,
    expiresAt: l.third?.kind === "partner" ? l.third.at + 30 * 60_000 : null,
    requestedAt: l.third?.kind === "partner" ? l.third.at : null,
    soloLeftMs: l.third?.kind === "solo" ? Math.max(0, l.third.at + 30 * 60_000 - now) : null,
    outcome: l.outcome,
    note: l.note,
    retryAt: l.retryAt && l.retryAt > now ? l.retryAt : null,
    notice: null,
    emergencyNextAt: last && now < last + 7 * 86_400_000 ? last + 7 * 86_400_000 : null,
  };
}

function endUnlocked() {
  finishSession();
  mockLadder = null;
  bus.emit(EV.session, null);
}

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
  ...trackerControls,
  /** The partner answers the pending unlock request. */
  partnerAnswers(approve: boolean, note: string | null = null) {
    if (mockLadder?.third?.kind !== "partner") return;
    if (approve) mockLadder.approved = true;
    else refuse("denied", note);
  },
  /** Someone accepted the invite. */
  partnerJoins(email = "friend@example.com", name: string | null = "Alex") {
    state.cloud.partner = { email, name, status: "active", since: new Date().toISOString() };
    state.cloud.invite = null;
    bus.emit(EV.cloud, null);
  },
  /** Per-day history for Stats: date key -> focus, a broken seal, attempts, activity. */
  statsDays(days: Record<string, MockDay>, tempted: MockState["tempted"] = []) {
    Object.assign(state.statsDays, days);
    state.tempted = tempted;
  },
  /** Tampering breaks the running seal (clock, guard, extension). */
  tamper(kind: "clock" | "guard" | "extension", detail: string) {
    if (!state.session || state.session.broken) return;
    state.session.broken = true;
    bus.emit(EV.tick, view());
    bus.emit("sanctum://tamper", { kind, detail });
  },
  /** Protection: the next install is declined at the UAC prompt, or the guard brought Sanctum back. */
  guard(patch: { decline?: boolean; restartedAt?: number }) {
    if (patch.decline !== undefined) state.guard.decline = patch.decline;
    if (patch.restartedAt) state.guard.restarts.push(patch.restartedAt);
  },
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
  const h = handlers[cmd] ?? gcalHandlers[cmd] ?? trackerHandlers[cmd];
  // Window and tray commands have nothing to do outside Tauri.
  if (!h) return undefined as T;
  return h(args ?? {}) as T;
}
