import { useEffect, type ReactNode } from "react";
import { create } from "zustand";
import { useStore } from "../state/store";
import { useTheme } from "../state/theme";
import type { TabId } from "../state/appState";
import { applyTheme, type Palette, type Theme } from "../theme/palette";
import { THEMES, derive, themeById } from "../theme/themes";
import { finishTheme, secondRoles } from "../theme/finish";
import { contrast, toHex } from "../theme/color";
import { HIT } from "./controls";

// Dev builds only (it lives in the dev panel, which main.tsx mounts under import.meta.env.DEV).
// A quick theme creator (2026-11-20): start from a theme, change its key colors, see every screen
// in them live, then copy the palette out as JSON in the shape of src/theme/opencodeThemes.ts.

/** The colors the creator edits, in the order they show. */
export const DRAFT_KEYS = ["app", "panel", "raised", "sidebar", "line", "line-input", "text", "text-2", "muted", "faint", "sealed", "event", "second", "broken", "toast"] as const;
type DraftKey = (typeof DRAFT_KEYS)[number];

const LABELS: Record<DraftKey, string> = {
  app: "App",
  panel: "Panel",
  raised: "Raised",
  sidebar: "Sidebar",
  line: "Line",
  "line-input": "Line input",
  text: "Text",
  "text-2": "Text 2",
  muted: "Muted",
  faint: "Faint",
  sealed: "Sealed (accent)",
  event: "Event",
  second: "Second",
  broken: "Broken",
  toast: "Toast",
};

const SCREENS: { tab: TabId; label: string }[] = [
  { tab: "today", label: "Today" },
  { tab: "week", label: "Week" },
  { tab: "stats", label: "Stats" },
  { tab: "trackers", label: "Trackers" },
  { tab: "notes", label: "Notes" },
  { tab: "journal", label: "Journal" },
  { tab: "setup", label: "Setup" },
];

interface Draft {
  /** The theme the draft started from. */
  baseId: string;
  scheme: "dark" | "light";
  colors: Record<DraftKey, string>;
  /** Rebuild the rest of the palette from the key colors, as real themes are built. */
  derive: boolean;
}

const STORE = "sanctum-dev-theme-draft";

function fromTheme(t: Theme): Draft {
  const colors = Object.fromEntries(DRAFT_KEYS.map((k) => [k, toHex(t.palette[k])])) as Record<DraftKey, string>;
  return { baseId: t.id, scheme: t.scheme, colors, derive: false };
}

function readDraft(): Draft | null {
  try {
    const d = JSON.parse(localStorage.getItem(STORE) ?? "") as Draft;
    if (!d || !themeById(d.baseId) || !d.colors) return null;
    return { ...fromTheme(themeById(d.baseId)!), ...d, colors: { ...fromTheme(themeById(d.baseId)!).colors, ...d.colors } };
  } catch {
    return null;
  }
}

function writeDraft(d: Draft | null) {
  try {
    if (d) localStorage.setItem(STORE, JSON.stringify(d));
    else localStorage.removeItem(STORE);
  } catch {
    // no storage: the draft lasts until reload
  }
}

/** The full palette a draft shows. */
export function draftTheme(d: Draft): Theme {
  const base = themeById(d.baseId) ?? THEMES[0]!;
  const c = d.colors;
  const id = `${base.id}-draft`;
  const name = `${base.name} draft`;
  if (!d.derive) return { id, name, scheme: d.scheme, palette: { ...base.palette, ...c } };
  const p = base.palette;
  const four = (k: string) => [1, 2, 3, 4].map((i) => toHex(p[`${k}-${i}`])) as [string, string, string, string];
  const built = finishTheme(
    derive({
      id,
      name,
      scheme: d.scheme,
      app: c.app,
      sidebar: c.sidebar,
      panel: c.panel,
      raised: c.raised,
      line: c.line,
      lineInput: c["line-input"],
      text: c.text,
      text2: c["text-2"],
      muted: c.muted,
      faint: c.faint,
      accent: c.sealed,
      event: c.event,
      broken: c.broken,
      held: four("held"),
      ember: four("ember"),
    }),
  );
  // finishTheme takes the second color from the event; the draft names its own.
  const palette: Palette = { ...built.palette, ...secondRoles(c.second, c.app, c.panel, d.scheme === "dark") };
  return { ...built, palette };
}

interface CreatorStore {
  draft: Draft | null;
  copied: boolean;
}

const useCreator = create<CreatorStore>()(() => ({ draft: null, copied: false }));

const setDraft = (draft: Draft) => {
  writeDraft(draft);
  useCreator.setState({ draft, copied: false });
  applyTheme(draftTheme(draft));
};

/** Back to the saved theme: the draft is dropped and the app shows what it showed before. */
export function resetThemeCreator() {
  writeDraft(null);
  useCreator.setState({ draft: null, copied: false });
  applyTheme(useTheme.getState().theme);
}

function ratio(a: string | undefined, b: string | undefined) {
  return contrast(toHex(a), toHex(b));
}

/** The creator closes: the saved theme shows again, the draft stays in storage for next time. */
export function closeThemeCreator() {
  useCreator.setState({ draft: null, copied: false });
  applyTheme(useTheme.getState().theme);
}

function Btn({ children, onClick, on = false }: { children: ReactNode; onClick: () => void; on?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={on || undefined}
      onClick={onClick}
      className={`h-control-sm rounded-control border px-[10px] text-meta transition-colors duration-ui ease-ui ${
        on ? "border-check-line bg-raised text-text" : "border-line-input text-text-2 hover:border-check-line hover:text-text"
      }`}
    >
      {children}
    </button>
  );
}

export function ThemeCreator({ onClose }: { onClose: () => void }) {
  const saved = useTheme((s) => s.theme);
  const stored = useCreator((s) => s.draft);
  const copied = useCreator((s) => s.copied);
  const tab = useStore((s) => s.activeTab);
  const draft = stored ?? fromTheme(saved);

  // A draft kept from before (this session or localStorage) shows again when the creator opens.
  useEffect(() => {
    const kept = useCreator.getState().draft ?? readDraft();
    if (kept) setDraft(kept);
  }, []);

  const theme = draftTheme(draft);
  const p = theme.palette;
  const pairs: { label: string; fg: string; bg: string }[] = [
    { label: "Text on app", fg: "text", bg: "app" },
    { label: "Text on panel", fg: "text", bg: "panel" },
    { label: "Muted on panel", fg: "muted", bg: "panel" },
    { label: "Text on toast", fg: "text", bg: "toast" },
  ];

  const copy = async () => {
    const json = JSON.stringify({ id: theme.id, name: theme.name, scheme: theme.scheme, palette: Object.fromEntries(Object.entries(p).sort(([a], [b]) => a.localeCompare(b))) }, null, 2);
    try {
      await navigator.clipboard.writeText(json);
      useCreator.setState({ copied: true });
    } catch {
      console.info(json);
    }
  };

  return (
    <div
      aria-label="Theme creator"
      data-dev-theme-creator
      className="fixed right-4 top-12 z-50 flex max-h-[calc(100vh-120px)] w-[320px] flex-col gap-3 overflow-y-auto rounded-panel border border-line-input bg-panel p-3 text-meta shadow-toast"
    >
      <div className="flex items-center justify-between">
        <span className="label">Theme creator</span>
        <button type="button" aria-label="Close theme creator" onClick={onClose} className={`${HIT} px-1 text-muted hover:text-text`}>
          ×
        </button>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-micro text-muted">Start from</span>
        <select
          aria-label="Start from"
          value={draft.baseId}
          onChange={(e) => {
            const t = themeById(e.target.value);
            if (t) setDraft({ ...fromTheme(t), derive: draft.derive });
          }}
          className="h-control-sm rounded-control border border-line-input bg-app px-2 text-meta text-text"
        >
          {THEMES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>

      <div className="flex flex-wrap items-center gap-[6px]">
        <Btn on={draft.scheme === "dark"} onClick={() => setDraft({ ...draft, scheme: "dark" })}>
          Dark
        </Btn>
        <Btn on={draft.scheme === "light"} onClick={() => setDraft({ ...draft, scheme: "light" })}>
          Light
        </Btn>
        <label className="ml-auto flex items-center gap-1 text-text-2">
          <input type="checkbox" checked={draft.derive} onChange={(e) => setDraft({ ...draft, derive: e.target.checked })} />
          Derive the rest
        </label>
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-[6px]">
        {DRAFT_KEYS.map((k) => {
          // Deriving works the toast out from the surfaces.
          const off = draft.derive && k === "toast";
          return (
            <label key={k} className={`flex items-center gap-2 ${off ? "opacity-50" : ""}`}>
              <input
                type="color"
                aria-label={LABELS[k]}
                disabled={off}
                value={off ? toHex(p.toast) : draft.colors[k]}
                onChange={(e) => setDraft({ ...draft, colors: { ...draft.colors, [k]: e.target.value.toUpperCase() } })}
                className="h-[22px] w-[28px] shrink-0 cursor-pointer rounded-control border border-line-input bg-transparent p-0"
              />
              <span className="truncate text-text-2">{LABELS[k]}</span>
            </label>
          );
        })}
      </div>

      <div className="flex flex-col gap-1" aria-label="Contrast">
        <span className="text-micro text-muted">Contrast (4.5 to pass)</span>
        {pairs.map((x) => {
          const r = ratio(p[x.fg], p[x.bg]);
          const pass = r >= 4.5;
          return (
            <div key={x.label} className="flex items-center justify-between font-mono text-micro">
              <span className="text-text-2">{x.label}</span>
              <span className={pass ? "text-text" : "text-broken-text"}>
                {r.toFixed(2)} {pass ? "pass" : "fail"}
              </span>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-[6px]">
        <Btn onClick={resetThemeCreator}>Reset</Btn>
        <Btn onClick={() => void copy()}>{copied ? "Copied" : "Copy JSON"}</Btn>
      </div>

      <div className="flex flex-col gap-[6px]">
        <span className="text-micro text-muted">Screens</span>
        <div className="flex flex-wrap gap-[6px]">
          {SCREENS.map((s) => (
            <Btn key={s.tab} on={tab === s.tab} onClick={() => useStore.getState().navigate(s.tab)}>
              {s.label}
            </Btn>
          ))}
        </div>
      </div>
    </div>
  );
}
