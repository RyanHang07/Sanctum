import { create } from "zustand";
import {
  type AppState,
  type CloseAction,
  type OnLogin,
  type TabId,
  isTabLocked,
} from "./appState";
import { errorText, native } from "../lib/native";
import type { CalEvent, Distraction, HeldStats, LaunchReport, NewDistraction, NewRule, Profile, ProfileDraft, ProfilePatch, SessionView } from "../lib/types";
import { play, setSoundsEnabled } from "../lib/sound";
import type { Suggestion } from "../lib/planner";

const TOAST_MS = 3200;
const NOTICE_MS = 4200;

export interface Notice {
  lead: string;
  rest?: string;
}

/** How an early exit ended: the partner approved, the solo cooldown ran out, or the emergency unlock. */
export interface UnlockResult {
  kind: "approved" | "solo" | "emergency";
  partner: string | null;
}

export type SetupTab = "profiles" | "distractions" | "protection" | "trackers" | "tracking" | "calendar" | "browser" | "partner" | "general";

export interface Settings {
  closeAction: CloseAction;
  onLogin: OnLogin;
  displayName: string;
  compactOnFocus: boolean;
  sounds: boolean;
  dailyGoalMin: number;
  /** Planned rest days, a weekday mask (bit 0 = Sunday). Never break the streak. */
  restDaysMask: number;
  /** Minutes without input before you count as idle (SPEC 4.8). */
  idleThresholdMin: number;
  /** Days of raw activity kept (SPEC 4.7). */
  retentionDays: number;
  /** Apps that count as present while in front (calls). Comma-separated exe names. */
  passiveApps: string;
  /** Apps whose window titles are stored as "(private)". */
  privateApps: string;
  /** Sidebar shows as an icon rail. */
  sidebarCollapsed: boolean;
  /** Home panels folded to their headers, and panels hidden via Customize. */
  homeLayout: HomeLayout;
  /** The Week tab reopens on the last view used. */
  weekView: WeekView;
}

export type WeekView = "week" | "list" | "month" | "routines";
const WEEK_VIEWS: readonly WeekView[] = ["week", "list", "month", "routines"];

/** "hint": the "No focus block on your schedule" card above the wheels. */
export type HomePanel = "today" | "schedule" | "progress" | "streak" | "hint";
export interface HomeLayout {
  collapsed: HomePanel[];
  hidden: HomePanel[];
}
const EMPTY_LAYOUT: HomeLayout = { collapsed: [], hidden: [] };

function parseLayout(raw: string | null): HomeLayout {
  try {
    const v = JSON.parse(raw ?? "") as Partial<HomeLayout>;
    return { collapsed: Array.isArray(v.collapsed) ? v.collapsed : [], hidden: Array.isArray(v.hidden) ? v.hidden : [] };
  } catch {
    return EMPTY_LAYOUT;
  }
}

/** Settings stored as plain strings in SQLite, keyed by their setting name. */
export const SETTING_KEYS = {
  idleThresholdMin: "idle_threshold_min",
  retentionDays: "activity_retention_days",
  passiveApps: "passive_apps",
  privateApps: "private_apps",
} as const;
type TextSetting = keyof typeof SETTING_KEYS;

/** Local midnight, for "Focus today". */
export const startOfToday = (now = new Date()) => new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

export interface Store {
  appState: AppState;
  /** When the current seal started. Only used by the dev state toggle, which seals without a session. */
  sealedAt: number | null;
  /** The running focus session (Rust is the source of truth; updated by events). */
  session: SessionView | null;
  /** Set when a session completes: shows the Sanctum held page. */
  held: HeldStats | null;
  /** First-run setup is showing (SPEC 4.11). */
  onboarding: boolean;
  endEarlyOpen: boolean;
  focusTodayMin: number;
  /** What the schedule points at right now (Home's suggested card). */
  suggestion: Suggestion | null;
  /** A block you changed the pickers for; auto-fill leaves it alone until the next block. */
  focusOverrideKey: string | null;
  /** "Interview Prep starts now": shown when a profile-linked block begins. */
  blockPrompt: Suggestion | null;
  /** The meeting behind the In event state (SPEC 4.0), when the calendar put us there. */
  meeting: CalEvent | null;
  /** Enter focus as soon as the meeting ends ("Queue focus at 3:00"). */
  focusQueued: boolean;
  activeTab: TabId;
  /** Tab whose locked toast is showing. */
  lockedToast: TabId | null;
  /** General toast (launch results, errors). */
  notice: Notice | null;
  closeDialogOpen: boolean;

  profiles: Profile[];
  profilesLoaded: boolean;
  selectedProfileId: number | null;
  /** Profile open in Setup's detail view. */
  editingProfileId: number | null;
  durationMin: number;

  settings: Settings;

  setAppState: (s: AppState) => void;
  /** Returns false (and shows the locked toast) when the tab is locked. */
  navigate: (tab: TabId) => boolean;
  dismissToast: () => void;
  showNotice: (n: Notice) => void;
  setDuration: (m: number) => void;
  openCloseDialog: () => void;
  closeCloseDialog: () => void;
  setCloseAction: (a: CloseAction) => void;
  setOnLogin: (v: OnLogin) => void;
  setCompactOnFocus: (v: boolean) => void;
  setSounds: (v: boolean) => void;
  /** Saves one of the activity settings in SETTING_KEYS. */
  setActivitySetting: <K extends TextSetting>(key: K, value: Settings[K]) => void;
  setDailyGoal: (min: number) => void;
  openOnboarding: () => void;
  /** Reloads what setup changed and returns to Home. */
  closeOnboarding: () => Promise<void>;
  /** Opens setup on a first run: never finished, and no profiles yet. */
  checkOnboarding: () => Promise<void>;
  setRestDays: (mask: number) => void;
  toggleSidebar: () => void;
  setWeekView: (v: WeekView) => void;
  toggleHomeCollapsed: (panel: HomePanel) => void;
  setHomeHidden: (panel: HomePanel, hidden: boolean) => void;
  loadSettings: () => Promise<void>;

  /** Starts a session with the selected profile: seal, open the launch set, play the cue. */
  enterFocus: () => Promise<boolean>;
  loadSession: () => Promise<void>;
  applySession: (s: SessionView | null) => void;
  applyTick: (s: SessionView) => void;
  showHeld: (h: HeldStats) => void;
  dismissHeld: () => void;
  openEndEarly: () => void;
  closeEndEarly: () => void;
  /** How the last early exit went, shown until dismissed (the session is already over). */
  unlockResult: UnlockResult | null;
  setUnlockResult: (r: UnlockResult | null) => void;
  refreshFocusToday: () => Promise<void>;
  /** Follows the schedule: records the suggestion and pre-fills the pickers during a block. */
  applySuggestion: (s: Suggestion | null) => void;
  /** Called when you pick a profile or length yourself. */
  markManualFocus: () => void;
  showBlockPrompt: (s: Suggestion | null) => void;
  /** Uses the suggestion's profile and length, then enters focus. */
  enterSuggested: (s: Suggestion) => Promise<boolean>;
  /** Follows the calendar: In event while a meeting runs, back to open (and any queued focus) after. */
  applyMeeting: (e: CalEvent | null) => void;
  setFocusQueued: (v: boolean) => void;

  loadProfiles: () => Promise<void>;
  selectProfile: (id: number) => void;
  editProfile: (id: number | null) => void;
  createProfile: (draft?: Partial<ProfileDraft>) => Promise<Profile | null>;
  updateProfile: (id: number, patch: ProfilePatch) => Promise<Profile | null>;
  deleteProfile: (id: number) => Promise<boolean>;
  addRule: (profileId: number, rule: NewRule) => Promise<Profile | null>;
  removeRule: (ruleId: number) => Promise<Profile | null>;
  /** The one list every seal blocks (Setup > Distractions). */
  distractions: Distraction[];
  loadDistractions: () => Promise<void>;
  /** Flags something; returns false (with a notice) when it's refused. */
  flag: (item: NewDistraction) => Promise<boolean>;
  unflag: (id: number) => Promise<void>;
  allowPage: (id: number, prefix: string) => Promise<boolean>;
  unallowPage: (id: number) => Promise<void>;
  setupTab: SetupTab;
  openSetup: (tab: SetupTab) => void;
  /** The Ctrl K command bar. */
  commandOpen: boolean;
  openCommand: () => void;
  closeCommand: () => void;
  launchProfile: (id: number) => Promise<LaunchReport | null>;
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
/** Bumped on every session change, so a slow get_session reply can't overwrite a newer event. */
let sessionEpoch = 0;
let noticeTimer: ReturnType<typeof setTimeout> | undefined;

/** "Opened LeetCode, NeetCode." + "Focused VS Code. Zoom is not installed." */
export function launchNotice(r: LaunchReport): Notice {
  const parts: string[] = [];
  if (r.focused.length) parts.push(`Focused ${r.focused.join(", ")}.`);
  if (r.missing.length) parts.push(`${r.missing.join(", ")} ${r.missing.length === 1 ? "is" : "are"} not installed.`);
  if (r.failed.length) parts.push(`${r.failed.join(", ")} failed to open.`);
  const lead = r.opened.length ? `Opened ${r.opened.join(", ")}.` : parts.shift() ?? "Nothing to open.";
  return { lead, rest: parts.join(" ") || undefined };
}

export const selectedProfile = (s: Pick<Store, "profiles" | "selectedProfileId">) =>
  s.profiles.find((p) => p.id === s.selectedProfileId) ?? null;

export const useStore = create<Store>()((set, get) => {
  /** Runs a backend call, surfacing errors as a notice. Profile edits are refused while sealed. */
  async function guarded<T>(fn: () => Promise<T>): Promise<T | null> {
    if (get().appState === "sealed") {
      get().showNotice({ lead: "Profiles are locked while you're sealed." });
      return null;
    }
    try {
      return await fn();
    } catch (e) {
      get().showNotice({ lead: errorText(e) });
      return null;
    }
  }

  const replace = (p: Profile) => set({ profiles: get().profiles.map((x) => (x.id === p.id ? p : x)) });

  return {
    appState: "open",
    sealedAt: null,
    session: null,
    held: null,
    onboarding: false,
    endEarlyOpen: false,
    unlockResult: null,
    focusTodayMin: 0,
    suggestion: null,
    focusOverrideKey: null,
    blockPrompt: null,
    meeting: null,
    focusQueued: false,
    activeTab: "today",
    lockedToast: null,
    notice: null,
    closeDialogOpen: false,
    profiles: [],
    profilesLoaded: false,
    selectedProfileId: null,
    editingProfileId: null,
    durationMin: 60,
    settings: {
      closeAction: "ask",
      onLogin: "home",
      displayName: "",
      compactOnFocus: false,
      sounds: true,
      dailyGoalMin: 120,
      restDaysMask: 0,
      idleThresholdMin: 3,
      retentionDays: 30,
      passiveApps: "",
      privateApps: "",
      sidebarCollapsed: false,
      homeLayout: EMPTY_LAYOUT,
      weekView: "week",
    },

    setAppState: (appState) => {
      // A running session owns the seal; only ending it unseals.
      if (get().session && appState !== "sealed") return;
      // Sealing sends you back to Today; the other tabs lock.
      const activeTab = isTabLocked(appState, get().activeTab) ? "today" : get().activeTab;
      const sealed = appState === "sealed";
      set({
        appState,
        activeTab,
        sealedAt: sealed ? (get().sealedAt ?? Date.now()) : null,
        lockedToast: sealed ? get().lockedToast : null,
      });
      void native.setAppState(appState);
    },

    navigate: (tab) => {
      if (isTabLocked(get().appState, tab)) {
        clearTimeout(toastTimer);
        set({ lockedToast: tab, notice: null });
        toastTimer = setTimeout(() => set({ lockedToast: null }), TOAST_MS);
        return false;
      }
      // Clicking Setup again returns to the overview from a profile.
      set({ activeTab: tab, editingProfileId: tab === "setup" && get().activeTab === "setup" ? null : get().editingProfileId });
      return true;
    },

    dismissToast: () => set({ lockedToast: null, notice: null }),
    showNotice: (notice) => {
      clearTimeout(noticeTimer);
      set({ notice, lockedToast: null });
      noticeTimer = setTimeout(() => set({ notice: null }), NOTICE_MS);
    },
    setDuration: (durationMin) => set({ durationMin }),
    openCloseDialog: () => set({ closeDialogOpen: true }),
    closeCloseDialog: () => set({ closeDialogOpen: false }),

    setCloseAction: (closeAction) => {
      set({ settings: { ...get().settings, closeAction } });
      void native.setSetting("close_action", closeAction);
    },
    setOnLogin: (onLogin) => {
      set({ settings: { ...get().settings, onLogin } });
      void native.setSetting("on_login", onLogin);
    },
    setCompactOnFocus: (compactOnFocus) => {
      set({ settings: { ...get().settings, compactOnFocus } });
      void native.setSetting("compact_on_focus", compactOnFocus ? "1" : "0");
    },

    setSounds: (sounds) => {
      set({ settings: { ...get().settings, sounds } });
      setSoundsEnabled(sounds);
      void native.setSetting("sounds", sounds ? "1" : "0");
    },
    openOnboarding: () => set({ onboarding: true }),
    closeOnboarding: async () => {
      await get().loadSettings();
      await get().loadProfiles();
      set({ onboarding: false, activeTab: "today" });
    },
    checkOnboarding: async () => {
      if ((await native.getSetting("onboarded")) === "1") return;
      if ((await native.listProfiles()).length === 0) set({ onboarding: true });
      // Installs from before onboarding already have profiles: count them as set up.
      else await native.setSetting("onboarded", "1");
    },
    setDailyGoal: (dailyGoalMin) => {
      set({ settings: { ...get().settings, dailyGoalMin } });
      void native.setSetting("daily_goal_min", String(dailyGoalMin));
    },
    setRestDays: (restDaysMask) => {
      set({ settings: { ...get().settings, restDaysMask } });
      void native.setSetting("rest_days_mask", String(restDaysMask));
    },
    toggleHomeCollapsed: (panel) => {
      const l = get().settings.homeLayout;
      const collapsed = l.collapsed.includes(panel) ? l.collapsed.filter((p) => p !== panel) : [...l.collapsed, panel];
      const homeLayout = { ...l, collapsed };
      set({ settings: { ...get().settings, homeLayout } });
      void native.setSetting("home_layout", JSON.stringify(homeLayout));
    },
    setHomeHidden: (panel, hide) => {
      const l = get().settings.homeLayout;
      const hidden = hide ? [...new Set([...l.hidden, panel])] : l.hidden.filter((p) => p !== panel);
      const homeLayout = { ...l, hidden };
      set({ settings: { ...get().settings, homeLayout } });
      void native.setSetting("home_layout", JSON.stringify(homeLayout));
    },
    setWeekView: (weekView) => {
      set({ settings: { ...get().settings, weekView } });
      void native.setSetting("week_view", weekView);
    },
    toggleSidebar: () => {
      const sidebarCollapsed = !get().settings.sidebarCollapsed;
      set({ settings: { ...get().settings, sidebarCollapsed } });
      void native.setSetting("sidebar_collapsed", sidebarCollapsed ? "1" : "0");
    },
    setActivitySetting: (key, value) => {
      set({ settings: { ...get().settings, [key]: value } });
      void native.setSetting(SETTING_KEYS[key], String(value));
    },

    loadSettings: async () => {
      const [close, onLogin, name, compact, sounds, goal, idle, retention, passive, priv, collapsed, layout, weekView, rest] = await Promise.all([
        native.getSetting("close_action"),
        native.getSetting("on_login"),
        native.getSetting("display_name"),
        native.getSetting("compact_on_focus"),
        native.getSetting("sounds"),
        native.getSetting("daily_goal_min"),
        native.getSetting(SETTING_KEYS.idleThresholdMin),
        native.getSetting(SETTING_KEYS.retentionDays),
        native.getSetting(SETTING_KEYS.passiveApps),
        native.getSetting(SETTING_KEYS.privateApps),
        native.getSetting("sidebar_collapsed"),
        native.getSetting("home_layout"),
        native.getSetting("week_view"),
        native.getSetting("rest_days_mask"),
      ]);
      setSoundsEnabled(sounds !== "0");
      set({
        settings: {
          closeAction: close === "tray" || close === "quit" ? close : "ask",
          onLogin: onLogin === "tray" ? "tray" : "home",
          displayName: name ?? "",
          compactOnFocus: compact === "1",
          sounds: sounds !== "0",
          dailyGoalMin: Number(goal) || 120,
          restDaysMask: Number(rest) || 0,
          idleThresholdMin: Number(idle) || 3,
          retentionDays: Number(retention) || 30,
          passiveApps: passive ?? "",
          privateApps: priv ?? "",
          sidebarCollapsed: collapsed === "1",
          homeLayout: parseLayout(layout),
          weekView: WEEK_VIEWS.includes(weekView as WeekView) ? (weekView as WeekView) : "week",
        },
      });
    },

    enterFocus: async () => {
      const s = get();
      const profile = selectedProfile(s);
      if (!profile || s.appState !== "open" || s.session) return false;
      try {
        const session = await native.startSession(profile.id, s.durationMin);
        get().applySession(session);
      } catch (e) {
        get().showNotice({ lead: errorText(e) });
        return false;
      }
      play("enter");
      await get().launchProfile(profile.id);
      if (get().settings.compactOnFocus) void native.showCompact();
      return true;
    },

    loadSession: async () => {
      const epoch = sessionEpoch;
      const session = await native.getSession();
      if (epoch === sessionEpoch) get().applySession(session);
    },

    applySession: (session) => {
      sessionEpoch++;
      const cur = get();
      if (session) {
        set({ session, appState: "sealed", sealedAt: session.startedAt, held: null });
        if (isTabLocked("sealed", cur.activeTab)) set({ activeTab: "today" });
      } else {
        set({ session: null, endEarlyOpen: false, ...(cur.session ? { appState: "open" as const, sealedAt: null } : {}) });
      }
      void get().refreshFocusToday();
    },

    applyTick: (session) => {
      if (get().session) set({ session });
    },

    showHeld: (held) => {
      sessionEpoch++;
      set({ held, session: null, appState: "open", sealedAt: null, activeTab: "today", endEarlyOpen: false });
      void get().refreshFocusToday();
    },
    dismissHeld: () => set({ held: null }),

    openEndEarly: () => set({ endEarlyOpen: true }),
    closeEndEarly: () => set({ endEarlyOpen: false }),
    setUnlockResult: (unlockResult) => set({ unlockResult }),

    applySuggestion: (suggestion) => {
      const s = get();
      set({ suggestion });
      if (!suggestion || suggestion.state !== "now" || s.appState !== "open") return;
      if (s.focusOverrideKey === suggestion.item.key) return;
      if (!s.profiles.some((p) => p.id === suggestion.profileId)) return;
      if (s.selectedProfileId !== suggestion.profileId || s.durationMin !== suggestion.minutes) {
        set({ selectedProfileId: suggestion.profileId, durationMin: suggestion.minutes });
      }
    },

    markManualFocus: () => {
      const key = get().suggestion?.item.key;
      if (key) set({ focusOverrideKey: key });
    },

    showBlockPrompt: (blockPrompt) => set({ blockPrompt }),

    enterSuggested: async (s) => {
      set({ blockPrompt: null, selectedProfileId: s.profileId, durationMin: s.minutes, focusOverrideKey: null });
      return get().enterFocus();
    },

    applyMeeting: (e) => {
      const s = get();
      if (e) {
        if (s.meeting?.eventId !== e.eventId || s.meeting.startMs !== e.startMs) set({ meeting: e });
        if (s.appState === "open" && !s.session) get().setAppState("event");
        return;
      }
      if (!s.meeting) return;
      set({ meeting: null });
      if (s.appState !== "event") return;
      get().setAppState("open");
      if (s.focusQueued) {
        set({ focusQueued: false });
        void get().enterFocus();
      }
    },

    setFocusQueued: (focusQueued) => set({ focusQueued }),

    refreshFocusToday: async () => {
      try {
        set({ focusTodayMin: await native.focusMinutesSince(startOfToday()) });
      } catch {
        // Keep the last value.
      }
    },

    loadProfiles: async () => {
      try {
        const profiles = await native.listProfiles();
        const keep = profiles.some((p) => p.id === get().selectedProfileId);
        const first = profiles[0];
        set({
          profiles,
          profilesLoaded: true,
          ...(keep ? {} : { selectedProfileId: first?.id ?? null, durationMin: first?.defaultMinutes ?? get().durationMin }),
        });
      } catch (e) {
        set({ profilesLoaded: true });
        get().showNotice({ lead: errorText(e) });
      }
    },

    selectProfile: (id) => {
      const p = get().profiles.find((x) => x.id === id);
      if (p) set({ selectedProfileId: id, durationMin: p.defaultMinutes });
    },

    editProfile: (editingProfileId) => set({ editingProfileId }),

    createProfile: (draft = {}) =>
      guarded(async () => {
        const p = await native.createProfile({ name: "New profile", ...draft });
        set({ profiles: [...get().profiles, p], selectedProfileId: get().selectedProfileId ?? p.id });
        return p;
      }),

    updateProfile: (id, patch) =>
      guarded(async () => {
        const p = await native.updateProfile(id, patch);
        replace(p);
        if (get().selectedProfileId === id && patch.defaultMinutes) set({ durationMin: p.defaultMinutes });
        return p;
      }),

    deleteProfile: async (id) =>
      (await guarded(async () => {
        await native.deleteProfile(id);
        const profiles = get().profiles.filter((p) => p.id !== id);
        const sel = get().selectedProfileId === id ? profiles[0] ?? null : selectedProfile(get());
        set({
          profiles,
          selectedProfileId: sel?.id ?? null,
          durationMin: sel?.defaultMinutes ?? get().durationMin,
          editingProfileId: get().editingProfileId === id ? null : get().editingProfileId,
        });
        return true;
      })) ?? false,

    addRule: (profileId, rule) =>
      guarded(async () => {
        const p = await native.addRule(profileId, rule);
        replace(p);
        return p;
      }),

    removeRule: (ruleId) =>
      guarded(async () => {
        const p = await native.removeRule(ruleId);
        replace(p);
        return p;
      }),

    distractions: [],
    loadDistractions: async () => {
      try {
        set({ distractions: await native.listDistractions() });
      } catch (e) {
        get().showNotice({ lead: errorText(e) });
      }
    },
    flag: async (item) => {
      try {
        set({ distractions: await native.addDistraction(item) });
        return true;
      } catch (e) {
        get().showNotice({ lead: errorText(e) });
        return false;
      }
    },
    unflag: async (id) => {
      try {
        set({ distractions: await native.removeDistraction(id) });
      } catch (e) {
        get().showNotice({ lead: errorText(e) });
      }
    },
    allowPage: async (id, prefix) => {
      try {
        set({ distractions: await native.addDistractionAllow(id, prefix) });
        return true;
      } catch (e) {
        get().showNotice({ lead: errorText(e) });
        return false;
      }
    },
    unallowPage: async (id) => {
      try {
        set({ distractions: await native.removeDistractionAllow(id) });
      } catch (e) {
        get().showNotice({ lead: errorText(e) });
      }
    },
    commandOpen: false,
    openCommand: () => set({ commandOpen: true }),
    closeCommand: () => set({ commandOpen: false }),
    setupTab: "profiles",
    openSetup: (setupTab) => {
      set({ setupTab, editingProfileId: null });
      get().navigate("setup");
    },

    launchProfile: async (id) => {
      try {
        const report = await native.launchProfile(id);
        get().showNotice(launchNotice(report));
        return report;
      } catch (e) {
        get().showNotice({ lead: errorText(e) });
        return null;
      }
    },
  };
});

// App-wide state: hot-swapping this module would split it into two copies (the UI reading an
// empty one). Reload the page instead.
import.meta.hot?.accept(() => window.location.reload());
