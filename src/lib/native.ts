import { invoke } from "@tauri-apps/api/core";
import type { AppState } from "../state/appState";
import type {
  BreakView,
  PauseConfig,
  PauseStatus,
  PauseSummary,
  FocusPrep,
  SessionResult,
  ActivitySummary,
  BrowserStatus,
  CalEvent,
  Checkin,
  CheckinDue,
  CloudStatus,
  Category,
  ClassRule,
  Distraction,
  DndStatus,
  DistractionSuggestion,
  EventDraft,
  FileInfo,
  GcalCalendar,
  GcalStatus,
  GuardStatus,
  InstalledApp,
  LadderView,
  LaunchReport,
  NewDistraction,
  NewEntry,
  NextCheckin,
  Note,
  NoteDraft,
  NewRule,
  Profile,
  ProfileDraft,
  ProfilePatch,
  PartnerStatus,
  QuietConfig,
  QuietStatus,
  Routine,
  RoutineCheck,
  RoutineDraft,
  SessionView,
  StatsOverview,
  TaskLink,
  Todo,
  TodoDraft,
  Tracker,
  TrackerDraft,
  TrackerEntry,
  UpdateInfo,
  StartupStatus,
  SharedImage,
  JournalDay,
  JournalLock,
  SessionRow,
  SessionDetail,
  SessionOutcome,
  ActivityView,
  DayView,
  Recap,
} from "./types";
import { mockInvoke } from "./mockBackend";

/** Stats › Sessions filters (v0.3). */
export interface SessionQuery {
  from?: string;
  to?: string;
  outcome?: SessionOutcome | null;
  profile?: number | null;
}
import { bus } from "./bus";

/** Events the Rust side emits (src-tauri/src/engine.rs). */
export const EVENTS = {
  session: "sanctum://session",
  tick: "sanctum://tick",
  held: "sanctum://held",
  intercept: "sanctum://intercept",
  endEarly: "sanctum://end-early",
  closeRequested: "sanctum://close-requested",
  /** An update downloaded in the background (v0.3). */
  updateReady: "sanctum://update-ready",
  /** Quitting from the tray or a remembered close: save what's waiting, then quit_app. */
  quit: "sanctum://quit",
  enterFocus: "sanctum://enter-focus",
  gcal: "sanctum://gcal",
  planner: "sanctum://planner",
  browser: "sanctum://browser",
  cloud: "sanctum://cloud",
  checkin: "sanctum://checkin",
  tamper: "sanctum://tamper",
  // v0.3.1: a break started or ended; it ran out ("Next block?"); pause mode's settings changed.
  brk: "sanctum://break",
  breakOver: "sanctum://break-over",
  pause: "sanctum://pause",
  quiet: "sanctum://quiet",
  quietPause: "sanctum://quiet-pause",
} as const;

/** True when running inside the Tauri webview (false in `vite` in a browser and in tests). */
export const inTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Outside Tauri, commands go to the in-memory mock backend. */
function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return inTauri() ? invoke<T>(cmd, args) : mockInvoke<T>(cmd, args);
}

/** Tauri rejects with the Rust error string; normalize for display. */
export const errorText = (e: unknown) => (typeof e === "string" ? e : e instanceof Error ? e.message : String(e));

export interface DbStatus {
  ready: boolean;
  schemaVersion: number;
  tables: string[];
  path: string;
}

export const native = {
  dbStatus: () => call<DbStatus | null>("db_status"),
  getSetting: (key: string) => call<string | null>("get_setting", { key }),
  setSetting: (key: string, value: string) => call<void>("set_setting", { key, value }),
  setAppState: (state: AppState) => call<void>("set_app_state", { state }),
  hideToTray: () => call<void>("hide_to_tray"),
  quitApp: () => call<void>("quit_app"),
  /** Quits through the main window, so it saves first (the tray panel's Quit). */
  requestQuit: () => call<void>("request_quit"),
  showCompact: () => call<void>("show_compact"),
  showMain: () => call<void>("show_main"),

  listProfiles: () => call<Profile[]>("list_profiles"),
  createProfile: (draft: ProfileDraft) => call<Profile>("create_profile", { draft }),
  updateProfile: (id: number, patch: ProfilePatch) => call<Profile>("update_profile", { id, patch }),
  deleteProfile: (id: number) => call<void>("delete_profile", { id }),
  addRule: (profileId: number, rule: NewRule) => call<Profile>("add_rule", { profileId, rule }),
  removeRule: (ruleId: number) => call<Profile>("remove_rule", { ruleId }),
  listDistractions: () => call<Distraction[]>("list_distractions"),
  addDistraction: (item: NewDistraction) => call<Distraction[]>("add_distraction", { item }),
  removeDistraction: (id: number) => call<Distraction[]>("remove_distraction", { id }),
  addDistractionAllow: (id: number, prefix: string) => call<Distraction[]>("add_distraction_allow", { id, prefix }),
  removeDistractionAllow: (id: number) => call<Distraction[]>("remove_distraction_allow", { id }),
  distractionSuggestions: () => call<DistractionSuggestion[]>("distraction_suggestions"),
  listInstalledApps: (refresh = false) => call<InstalledApp[]>("list_installed_apps", { refresh }),
  appIcon: (path: string) => call<string | null>("app_icon", { path }),
  launchProfile: (id: number) => call<LaunchReport>("launch_profile", { id }),

  getSession: () => call<SessionView | null>("get_session"),
  previewSeal: (profileId: number) => call<string[]>("preview_seal", { profileId }),
  exportData: (format: "json" | "csv") => call<FileInfo>("export_data", { format }),
  backupCreate: () => call<FileInfo>("backup_create"),
  backupList: () => call<FileInfo[]>("backup_list"),
  backupRestore: (path: string) => call<void>("backup_restore", { path }),
  /** Shows a file in Explorer; "" opens the backups folder. */
  dataReveal: (path: string) => call<void>("data_reveal", { path }),
  /** The guard closing sealed apps run as administrator. */
  guardCloseElevated: (enabled: boolean) => call<boolean>("guard_close_elevated", { enabled }),
  dndStatus: () => call<DndStatus>("dnd_status"),
  dndSetEnabled: (enabled: boolean) => call<DndStatus>("dnd_set_enabled", { enabled }),
  quietStatus: () => call<QuietStatus>("quiet_status"),
  quietSave: (config: QuietConfig) => call<QuietStatus>("quiet_save", { config }),
  quietPause: (reason: string) => call<QuietStatus>("quiet_pause", { reason }),
  quietResume: () => call<QuietStatus>("quiet_resume"),
  interceptQuietPause: () => call<void>("intercept_quiet_pause"),
  startSession: (profileId: number, minutes: number, task: TaskLink | null = null, goal: string | null = null, plan: string | null = null) =>
    call<SessionView>("start_session", { profileId, minutes, task, goal, plan }),
  // The seal's science (v0.3.1, src-tauri/src/focus.rs).
  focusPrepare: (profileId: number, task: TaskLink | null) => call<FocusPrep>("focus_prepare", { profileId, task }),
  pauseStatus: () => call<PauseStatus>("pause_status"),
  pauseSave: (config: PauseConfig) => call<PauseStatus>("pause_save", { config }),
  pauseAnswer: (goOn: boolean) => call<void>("pause_answer", { goOn }),
  pauseSummary: (from: string, to: string) => call<PauseSummary>("pause_summary", { from, to }),
  breakStart: (minutes: number, profileId: number | null, nextMinutes: number) => call<BreakView>("break_start", { minutes, profileId, nextMinutes }),
  breakEnd: () => call<void>("break_end"),
  breakStatus: () => call<BreakView | null>("break_status"),
  focusPark: (text: string) => call<Todo>("focus_park", { text }),
  focusWrap: (sessionId: number, result: SessionResult | null, rating: number | null, leftOff: string | null) =>
    call<void>("focus_wrap", { sessionId, result, rating, leftOff }),
  ladderOpen: () => call<LadderView>("ladder_open"),
  ladderView: () => call<LadderView>("ladder_view"),
  ladderReason: (reason: string) => call<LadderView>("ladder_reason", { reason }),
  ladderContinue: () => call<LadderView>("ladder_continue"),
  ladderRetype: (text: string) => call<LadderView>("ladder_retype", { text }),
  ladderRequest: () => call<LadderView>("ladder_request"),
  ladderFinishSolo: () => call<LadderView>("ladder_finish_solo"),
  ladderCancel: () => call<void>("ladder_cancel"),
  emergencyUnlock: (reason: string) => call<void>("emergency_unlock", { reason }),
  focusMinutesSince: (since: number) => call<number>("focus_minutes_since", { since }),
  interceptReturn: () => call<void>("intercept_return"),
  interceptHide: () => call<void>("intercept_hide"),
  interceptBreak: () => call<void>("intercept_break"),

  listClassRules: () => call<ClassRule[]>("list_class_rules"),
  addClassRule: (rule: Pick<ClassRule, "matchKind" | "pattern" | "category">) => call<ClassRule>("add_class_rule", { rule }),
  setClassRuleCategory: (id: number, category: Category) => call<void>("set_class_rule_category", { id, category }),
  removeClassRule: (id: number) => call<void>("remove_class_rule", { id }),
  activitySummary: (since: number) => call<ActivitySummary>("activity_summary", { since }),
  statsOverview: (from: string, to: string) => call<StatsOverview>("stats_overview", { from, to }),
  // Stats in depth (v0.3). Dates are planner days; no range means all time.
  statsSessions: (q: SessionQuery) => call<SessionRow[]>("stats_sessions", { ...q }),
  statsSession: (id: number) => call<SessionDetail | null>("stats_session", { id }),
  statsSessionsCsv: (q: SessionQuery) => call<FileInfo>("stats_sessions_csv", { ...q }),
  statsActivity: (from: string, to: string) => call<ActivityView>("stats_activity", { from, to }),
  /** Sets an app's or site's category everywhere, or only in one profile; returns entries recounted. */
  statsReclassify: (kind: "exe" | "domain", pattern: string, category: Category, profile: number | null) =>
    call<number>("stats_reclassify", { kind, pattern, category, profile }),
  statsDay: (date: string) => call<DayView>("stats_day", { date }),
  statsRecap: () => call<Recap | null>("stats_recap"),

  listRoutines: () => call<Routine[]>("list_routines"),
  saveRoutine: (draft: RoutineDraft) => call<Routine>("save_routine", { draft }),
  deleteRoutine: (id: number) => call<void>("delete_routine", { id }),
  listRoutineChecks: (from: string, to: string) => call<RoutineCheck[]>("list_routine_checks", { from, to }),
  setRoutineDone: (id: number, date: string, done: boolean) => call<void>("set_routine_done", { id, date, done }),
  listTodos: (from: string, to: string) => call<Todo[]>("list_todos", { from, to }),
  saveTodo: (draft: TodoDraft) => call<Todo>("save_todo", { draft }),
  setTodoDone: (id: number, done: boolean) => call<Todo>("set_todo_done", { id, done }),
  deleteTodo: (id: number) => call<void>("delete_todo", { id }),
  reorderRoutines: (ids: number[]) => call<void>("reorder_routines", { ids }),
  reorderTodos: (ids: number[]) => call<void>("reorder_todos", { ids }),

  gcalStatus: () => call<GcalStatus>("gcal_status"),
  gcalConnect: () => call<GcalStatus>("gcal_connect"),
  gcalCancelConnect: () => call<void>("gcal_cancel_connect"),
  gcalDisconnect: () => call<GcalStatus>("gcal_disconnect"),
  gcalRemoveCalendar: () => call<GcalStatus>("gcal_remove_calendar"),
  gcalCalendars: () => call<GcalCalendar[]>("gcal_calendars"),
  gcalSetSelected: (id: string, selected: boolean) => call<void>("gcal_set_selected", { id, selected }),
  gcalEvents: (from: string, to: string) => call<CalEvent[]>("gcal_events", { from, to }),
  gcalSyncNow: () => call<void>("gcal_sync_now"),
  gcalSaveEvent: (draft: EventDraft) => call<void>("gcal_save_event", { draft }),
  gcalDeleteEvent: (calendarId: string, eventId: string, seriesId: string | null = null) => call<void>("gcal_delete_event", { calendarId, eventId, seriesId }),
  gcalOpen: (url: string) => call<void>("gcal_open", { url }),

  listTrackers: () => call<Tracker[]>("list_trackers"),
  saveTracker: (draft: TrackerDraft) => call<Tracker>("save_tracker", { draft }),
  deleteTracker: (id: number) => call<void>("delete_tracker", { id }),
  trackerEntries: (from: number, to: number) => call<TrackerEntry[]>("tracker_entries", { from, to }),
  logEntries: (items: NewEntry[], checkinId: number | null = null) => call<TrackerEntry[]>("log_entries", { items, checkinId }),
  deleteTrackerEntry: (id: number) => call<void>("delete_tracker_entry", { id }),
  listCheckins: () => call<Checkin[]>("list_checkins_cmd"),
  saveCheckin: (checkin: Checkin) => call<Checkin>("save_checkin_cmd", { checkin }),
  deleteCheckin: (id: number) => call<void>("delete_checkin_cmd", { id }),
  checkinPending: () => call<CheckinDue | null>("checkin_pending"),
  checkinAnswer: (id: number, date: string, outcome: "logged" | "skipped" | "snoozed") => call<void>("checkin_answer", { id, date, outcome }),
  nextCheckin: () => call<NextCheckin | null>("next_checkin"),

  listNotes: () => call<Note[]>("list_notes"),
  saveNote: (draft: NoteDraft) => call<Note>("save_note", { draft }),
  pinNote: (id: number, pinned: boolean) => call<Note>("pin_note", { id, pinned }),
  deleteNote: (id: number) => call<void>("delete_note", { id }),
  resetAll: () => call<void>("reset_all"),
  appVersion: () => call<string>("app_version"),
  updateCheck: () => call<UpdateInfo | null>("update_check"),
  startupStatus: () => call<StartupStatus>("startup_status"),
  setStartup: (on: boolean) => call<StartupStatus>("set_startup", { on }),
  saveNoteImage: (data: string, mime: string) => call<number>("save_note_image", { data, mime }),
  shareNote: (id: number, hours: number, key: string) => call<{ url: string; expiresAt: number }>("share_note", { id, hours, key }),
  updateNoteShare: (id: number, cipher: string, images: SharedImage[]) => call<number[]>("update_note_share", { id, cipher, images }),
  stopNoteShare: (id: number) => call<void>("stop_note_share", { id }),
  journalStatus: () => call<JournalLock>("journal_status"),
  journalGet: (date: string) => call<JournalDay | null>("journal_get", { date }),
  journalSave: (date: string, doc: string | null, body: string) => call<JournalDay | null>("journal_save", { date, doc, body }),
  journalWritten: (from: string, to: string) => call<string[]>("journal_written", { from, to }),
  journalSetLock: (kind: JournalLock["lock"], pin: string | null = null) => call<JournalLock>("journal_set_lock", { kind, pin }),
  journalUnlockPin: (pin: string) => call<JournalLock>("journal_unlock_pin", { pin }),
  journalUnlockHello: () => call<JournalLock>("journal_unlock_hello"),
  journalLock: () => call<void>("journal_lock"),
  updateInstall: () => call<void>("update_install"),
  /** A downloaded update waiting for its click (v0.3). */
  updateReady: () => call<UpdateInfo | null>("update_ready"),
  /** Installs the downloaded update (downloading it now if needed) and restarts. */
  updateApply: () => call<void>("update_apply"),
  /** A page on Sanctum's site (privacy, terms, legal, docs, changelog, partner), in your light or dark. */
  openSite: (page: string, scheme: string) => call<void>("open_site", { page, scheme }),
  diagnostics: () => call<string>("diagnostics"),
  guardStatus: () => call<GuardStatus>("guard_status"),
  guardInstall: () => call<GuardStatus>("guard_install"),
  guardUninstall: () => call<GuardStatus>("guard_uninstall"),

  browserStatus: () => call<BrowserStatus>("browser_status"),

  cloudStatus: () => call<CloudStatus>("cloud_status"),
  cloudSignInGoogle: () => call<CloudStatus>("cloud_sign_in_google"),
  cloudSignInEmail: (email: string) => call<CloudStatus>("cloud_sign_in_email", { email }),
  cloudCancelSignIn: () => call<void>("cloud_cancel_sign_in"),
  cloudSignOut: () => call<CloudStatus>("cloud_sign_out"),
  cloudDeleteAccount: () => call<CloudStatus>("cloud_delete_account"),
  cloudPartner: () => call<PartnerStatus>("cloud_partner"),
  cloudCreateInvite: () => call<PartnerStatus>("cloud_create_invite"),
  cloudEmailInvite: (email: string) => call<PartnerStatus>("cloud_email_invite", { email }),
  cloudCancelInvite: () => call<PartnerStatus>("cloud_cancel_invite"),
  cloudRequestRemoval: (cancel: boolean) => call<PartnerStatus>("cloud_request_removal", { cancel }),
  browserOpenExtensionDir: () => call<void>("browser_open_extension_dir"),
  /** The kept theme, for the extension's sealed page and popup (v0.3). */
  browserSetTheme: (id: string, scheme: string, palette: Record<string, string>) => call<void>("browser_set_theme", { id, scheme, palette }),
};

/** Sends an event to every Sanctum window (the tray panel tells the main window things). */
export async function broadcast(event: string, payload: unknown = null): Promise<void> {
  if (!inTauri()) return void bus.emit(event, payload);
  const { emit } = await import("@tauri-apps/api/event");
  await emit(event, payload);
}

export async function onNative<T>(event: string, handler: (payload: T) => void): Promise<() => void> {
  if (!inTauri()) return bus.on(event, handler as (p: unknown) => void);
  const { listen } = await import("@tauri-apps/api/event");
  return listen<T>(event, (e) => handler(e.payload));
}
