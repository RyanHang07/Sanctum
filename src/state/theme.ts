import { create } from "zustand";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { inTauri, native } from "../lib/native";
import { SANCTUM_DARK, applyTheme, type Theme } from "../theme/palette";
import { themeById } from "../theme/themes";

// Which theme shows (v0.3, decided 2026-10-29). New installs follow Windows' light or dark
// with Sanctum Dark and Sanctum Light; picking a theme sets the dark or light pick while
// following, or the one theme when not. Saved in settings (so backups carry it) and cached in
// localStorage, which every window reads before its first paint and hears changes through.

export interface ThemePrefs {
  /** Follow Windows' app mode. */
  follow: boolean;
  /** While following: the theme for dark mode and for light mode. */
  dark: string;
  light: string;
  /** Not following: the one theme. */
  fixed: string;
}

export const DEFAULT_PREFS: ThemePrefs = { follow: true, dark: "sanctum-dark", light: "sanctum-light", fixed: "sanctum-dark" };
/** Before themes, Sanctum was always Sanctum Dark: an existing install keeps it. */
const EXISTING_PREFS: ThemePrefs = { ...DEFAULT_PREFS, follow: false };

const KEY = "theme";
const CACHE = "sanctum-theme";

function parse(raw: string | null | undefined): ThemePrefs | null {
  try {
    const p = JSON.parse(raw ?? "") as Partial<ThemePrefs>;
    const id = (v: unknown, fallback: string) => (typeof v === "string" && themeById(v) ? v : fallback);
    return { follow: p.follow !== false, dark: id(p.dark, DEFAULT_PREFS.dark), light: id(p.light, DEFAULT_PREFS.light), fixed: id(p.fixed, DEFAULT_PREFS.fixed) };
  } catch {
    return null;
  }
}

const systemDark = () => typeof matchMedia === "undefined" || matchMedia("(prefers-color-scheme: dark)").matches;

/** The theme that shows for these prefs, given whether Windows is in dark mode. */
export function resolve(p: ThemePrefs, dark: boolean): Theme {
  return themeById(p.follow ? (dark ? p.dark : p.light) : p.fixed) ?? SANCTUM_DARK;
}

function readCache(): ThemePrefs | null {
  try {
    return parse(localStorage.getItem(CACHE));
  } catch {
    return null;
  }
}

function writeCache(p: ThemePrefs) {
  try {
    localStorage.setItem(CACHE, JSON.stringify(p));
  } catch {
    // no storage: the next start reads settings instead
  }
}

/** The title bar (and native menus) follow along: Windows' own while following, else the theme's. */
function chrome(p: ThemePrefs, t: Theme) {
  if (!inTauri()) return;
  const w = getCurrentWindow();
  void w.setTheme(p.follow ? null : t.scheme).catch(() => undefined);
  if (w.label === "main") void w.setBackgroundColor(t.palette.app!).catch(() => undefined);
}

/** The kept theme goes to the extension too; the main window speaks for every window. */
function toExtension(t: Theme) {
  if (inTauri() && getCurrentWindow().label !== "main") return;
  void native.browserSetTheme(t.id, t.scheme, t.palette).catch(() => undefined);
}

export interface ThemeStore {
  prefs: ThemePrefs;
  /** The theme showing now. */
  theme: Theme;
  /** Hovering a theme card shows it live until the pointer leaves. */
  previewing: string | null;
  load: () => Promise<void>;
  setPrefs: (p: ThemePrefs) => Promise<void>;
  /** Picks a theme: following, it becomes the dark or the light pick; otherwise the one theme. */
  pick: (id: string) => Promise<void>;
  setFollow: (follow: boolean) => Promise<void>;
  preview: (id: string | null) => void;
}

export const useTheme = create<ThemeStore>()((set, get) => {
  const show = (p: ThemePrefs, t = resolve(p, systemDark())) => {
    applyTheme(t);
    chrome(p, t);
    set({ prefs: p, theme: t });
    toExtension(t);
  };
  return {
    prefs: DEFAULT_PREFS,
    theme: SANCTUM_DARK,
    previewing: null,

    load: async () => {
      let p = parse(await native.getSetting(KEY).catch(() => null));
      if (!p) {
        // No choice saved yet: an install from before themes stays on Sanctum Dark.
        const existing = (await native.getSetting("onboarded").catch(() => null)) === "1";
        p = existing ? EXISTING_PREFS : DEFAULT_PREFS;
      }
      writeCache(p);
      show(p);
    },

    setPrefs: async (p) => {
      writeCache(p);
      show(p);
      await native.setSetting(KEY, JSON.stringify(p)).catch(() => undefined);
    },

    pick: async (id) => {
      const t = themeById(id);
      if (!t) return;
      const p = get().prefs;
      set({ previewing: null });
      await get().setPrefs(p.follow ? { ...p, [t.scheme]: id } : { ...p, fixed: id });
    },

    setFollow: async (follow) => {
      const p = get().prefs;
      // Turning following off keeps what shows now; turning it on keeps the picks.
      await get().setPrefs(follow ? { ...p, follow } : { ...p, follow, fixed: get().theme.id });
    },

    preview: (id) => {
      const t = id ? themeById(id) : null;
      set({ previewing: id });
      applyTheme(t ?? get().theme);
    },
  };
});

/**
 * Before the first paint, in every window: the cached choice (or the default), then the
 * saved setting. Follows Windows switching light and dark, and other windows' picks.
 */
export function startTheme() {
  const cached = readCache();
  const p = cached ?? DEFAULT_PREFS;
  const t = resolve(p, systemDark());
  applyTheme(t);
  useTheme.setState({ prefs: p, theme: t });
  chrome(p, t);
  void useTheme.getState().load();

  if (typeof matchMedia !== "undefined") {
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
      const { prefs } = useTheme.getState();
      if (!prefs.follow) return;
      const t2 = resolve(prefs, systemDark());
      applyTheme(t2);
      useTheme.setState({ theme: t2 });
      toExtension(t2);
    });
  }
  // Another window picked a theme: show it here too.
  addEventListener("storage", (e) => {
    if (e.key !== CACHE) return;
    const next = parse(e.newValue);
    if (!next) return;
    const t2 = resolve(next, systemDark());
    applyTheme(t2);
    chrome(next, t2);
    useTheme.setState({ prefs: next, theme: t2 });
  });
}
