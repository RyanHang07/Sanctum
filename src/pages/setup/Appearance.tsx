import { createPortal } from "react-dom";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from "react";
import { Switch } from "../../components/controls";
import { CheckIcon } from "../../components/icons";
import { Section, Row } from "./parts";
import { useTheme } from "../../state/theme";
import { useReducedMotion } from "../../lib/useMotion";
import { cssVar, KEYS, type Theme } from "../../theme/palette";
import { THEMES, themeById } from "../../theme/themes";

// Setup › Appearance (v0.3, reworked; redesign 2026-11-15, design/gate-canvas/project/
// SetupAppearance.dc.html): themes as two lists of titles, each row carrying the theme's accent
// and second colour as a small pair. Hover or focus shows a floating preview near the row (the
// theme in miniature, then its pair with the values) without live-applying the theme; clicking
// selects it. The list opens scrolled so the chosen theme sits mid-view.

export const themeVars = (t: Theme) => Object.fromEntries(KEYS.map((k) => [cssVar(k), t.palette[k]])) as CSSProperties;

/** A saved id of a retired theme (Catppuccin Frappe Light, Macchiato Light) marks its replacement. */
export const canonicalId = (id: string) => themeById(id)?.id ?? id;

/** The theme's accent and second colour, side by side. Drawn in that theme's own colours. */
export function PairSwatch({ theme }: { theme: Theme }) {
  return (
    <span aria-hidden="true" data-pair className="flex shrink-0 overflow-hidden rounded-[3px] border border-line">
      <span style={themeVars(theme)} className="flex">
        <span className="h-3 w-3 bg-sealed" />
        <span className="h-3 w-3 bg-second" />
      </span>
    </span>
  );
}

function Miniature({ small = false }: { small?: boolean }) {
  return (
    <div aria-hidden="true" className={`flex ${small ? "h-[60px]" : "h-[84px]"} overflow-hidden rounded-[6px] border border-line bg-app`}>
      <div className="flex w-[30%] flex-col gap-[5px] bg-sidebar p-[7px]">
        <span className="h-[5px] w-[70%] rounded-full bg-text" />
        <span className="mt-[3px] flex h-[6px] w-[84%] items-center rounded-[3px] bg-raised px-[2px]">
          <span className="h-1 w-1 rounded-[1px] bg-second" />
        </span>
        <span className="h-[4px] w-[60%] rounded-full bg-line" />
        <span className="h-[4px] w-[70%] rounded-full bg-line" />
      </div>
      <div className="flex grow flex-col gap-[6px] p-[7px]">
        <span className="h-[6px] w-[62%] rounded-full bg-text" />
        <div className="flex gap-[5px]">
          <span className="h-[18px] grow rounded-[3px] border border-line bg-panel" />
          <span className="h-[18px] w-[38%] rounded-[3px] bg-sealed" />
        </div>
        <div className="relative flex h-[22px] items-end gap-[3px] rounded-[3px] border border-line bg-panel px-[5px] py-1">
          <span className="h-[50%] w-[10%] rounded-[1px] bg-sealed" />
          <span className="h-[80%] w-[10%] rounded-[1px] bg-sealed" />
          <span className="h-[35%] w-[10%] rounded-[1px] bg-muted" />
          <span className="h-[95%] w-[10%] rounded-[1px] bg-sealed" />
          <span className="h-[60%] w-[10%] rounded-[1px] bg-sealed" />
          <span className="absolute inset-x-1 top-[7px] border-t border-dashed border-second" />
        </div>
      </div>
    </div>
  );
}

type Hover = { id: string; x: number; y: number };

const PREVIEW_W = 236;
const PREVIEW_H = 196;

function clampPreview(x: number, y: number) {
  const margin = 12;
  const left = Math.min(window.innerWidth - PREVIEW_W - margin, Math.max(margin, x + 18));
  const top = Math.min(window.innerHeight - PREVIEW_H - margin, Math.max(margin, y - PREVIEW_H - 8));
  return { left, top };
}

/** The hovered or focused theme: its miniature, name and scheme, then its accent and second colour. */
export function FloatingPreview({ hover }: { hover: Hover | null }) {
  const reduce = useReducedMotion();
  const theme = hover ? THEMES.find((t) => t.id === hover.id) : null;
  if (!hover || !theme) return null;
  const pos = clampPreview(hover.x, hover.y);
  return createPortal(
    <div aria-hidden="true" data-theme-preview className="pointer-events-none fixed z-50" style={{ left: pos.left, top: pos.top, width: PREVIEW_W }}>
      <div style={themeVars(theme)} className={`rounded-panel border border-line-input bg-panel p-2 shadow-dialog ${reduce ? "" : "animate-rise-in"}`}>
        <Miniature />
        <div className="mt-[9px] flex items-baseline justify-between px-[2px]">
          <span className="text-meta font-medium text-text">{theme.name}</span>
          <span className="text-[11px] text-muted">{theme.scheme === "light" ? "Light" : "Dark"}</span>
        </div>
        <div className="mt-2 grid grid-cols-2 px-[2px]">
          <span className="h-[22px] rounded-l-[6px] bg-sealed" />
          <span className="h-[22px] rounded-r-[6px] bg-second" />
          <span className="flex flex-col gap-px pt-[6px]">
            <span className="text-[11px] text-text">Accent</span>
            <span className="font-mono text-[10.5px] text-muted">{theme.palette.sealed}</span>
          </span>
          <span className="flex flex-col gap-px border-l border-line pl-2 pt-[6px]">
            <span className="text-[11px] text-text">Second colour</span>
            <span className="font-mono text-[10.5px] text-muted">{theme.palette.second}</span>
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Pointer and focus handlers that show the floating preview for a theme. */
function previewHandlers(id: string, setHover: (h: Hover | null) => void, preview: (id: string | null) => void) {
  const clear = () => {
    setHover(null);
    preview(null);
  };
  return {
    onPointerEnter: (e: React.PointerEvent) => {
      setHover({ id, x: e.clientX, y: e.clientY });
      preview(id);
    },
    onPointerMove: (e: React.PointerEvent) => setHover({ id, x: e.clientX, y: e.clientY }),
    onPointerLeave: clear,
    onFocus: (e: React.FocusEvent) => {
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      setHover({ id, x: r.right, y: r.top + r.height / 2 });
      preview(id);
    },
    onBlur: clear,
  };
}

/**
 * On open, scrolls the chosen theme's row to the middle of whatever scrolls it. Instant: this
 * places the list, it isn't a motion. Runs once, so picking a theme never moves the list.
 */
export function useChosenInView(scope: RefObject<HTMLElement | null>, id: string) {
  const first = useRef(id);
  useEffect(() => {
    const row = scope.current?.querySelector<HTMLElement>(`[data-theme-id="${first.current}"]`);
    row?.scrollIntoView?.({ block: "center", inline: "nearest", behavior: "auto" });
  }, [scope]);
}

function ThemeTitleList({
  themes,
  chosen,
  label,
  setHover,
}: {
  themes: Theme[];
  chosen: string;
  label: string;
  setHover: (h: Hover | null) => void;
}) {
  const { pick, preview } = useTheme();
  const want = canonicalId(chosen);
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-col overflow-hidden rounded-panel border border-line bg-panel">
      {themes.map((theme) => {
        const on = theme.id === want;
        return (
          <button
            key={theme.id}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={theme.name}
            data-theme-id={theme.id}
            onClick={() => void pick(theme.id)}
            {...previewHandlers(theme.id, setHover, preview)}
            className={`group flex items-center gap-3 border-b border-line-soft px-[14px] py-[10px] text-left transition-colors duration-ui ease-ui last:border-b-0 ${
              on ? "bg-sealed-tint text-text" : "text-text-2 hover:bg-line-soft hover:text-text"
            }`}
          >
            <PairSwatch theme={theme} />
            <span className={`grow text-body ${on ? "font-medium text-text" : "group-hover:font-medium"}`}>{theme.name}</span>
            {on ? (
              <span className="flex items-center gap-2 text-meta text-sealed-text">
                Selected
                <CheckIcon size={12} />
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/** Onboarding's Look step: title cards with a miniature and the pair, and the same floating preview. */
export function ThemeGrid({ themes, chosen, label }: { themes: Theme[]; chosen: string; label: string; small?: boolean }) {
  const { pick, preview } = useTheme();
  const [hover, setHover] = useState<Hover | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const want = canonicalId(chosen);
  useEffect(() => () => preview(null), [preview]);
  useChosenInView(root, want);
  return (
    <>
      <div ref={root} role="radiogroup" aria-label={label} className="grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-3">
        {themes.map((theme) => {
          const on = theme.id === want;
          return (
            <button
              key={theme.id}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={theme.name}
              data-theme-id={theme.id}
              onClick={() => void pick(theme.id)}
              {...previewHandlers(theme.id, setHover, preview)}
              className={`flex flex-col gap-2 rounded-panel border p-2 text-left transition-colors duration-ui ease-ui ${
                on ? "border-sealed bg-sealed-tint" : "border-line bg-panel hover:border-line-input"
              }`}
            >
              <div style={themeVars(theme)}>
                <Miniature small />
              </div>
              <span className="flex items-center gap-[6px] px-[2px] text-meta">
                <PairSwatch theme={theme} />
                <span className={on ? "font-medium text-text" : "text-text-2"}>{theme.name}</span>
                <span className="grow" />
                {on ? <CheckIcon size={12} className="text-sealed-text" /> : null}
              </span>
            </button>
          );
        })}
      </div>
      <FloatingPreview hover={hover} />
    </>
  );
}

export function AppearanceSection() {
  const { prefs, theme: showing, setFollow, preview } = useTheme();
  const [hover, setHover] = useState<Hover | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const dark = useMemo(() => THEMES.filter((t) => t.scheme === "dark"), []);
  const light = useMemo(() => THEMES.filter((t) => t.scheme === "light"), []);
  useEffect(() => () => preview(null), [preview]);
  useChosenInView(root, showing.id);

  const groups: { id: string; title: string; label: string; themes: Theme[]; chosen: string }[] = prefs.follow
    ? [
        { id: "dark", title: "In dark mode", label: "Theme in dark mode", themes: dark, chosen: prefs.dark },
        { id: "light", title: "In light mode", label: "Theme in light mode", themes: light, chosen: prefs.light },
      ]
    : [
        { id: "dark", title: "Dark themes", label: "Dark themes", themes: dark, chosen: prefs.fixed },
        { id: "light", title: "Light themes", label: "Light themes", themes: light, chosen: prefs.fixed },
      ];

  return (
    <div ref={root} className="flex flex-col gap-5">
      <Section title="Theme">
        <Row label="Follow Windows" hint={prefs.follow ? "Light or dark as Windows is set, with a theme for each." : "One theme, whatever Windows is set to."}>
          <Switch checked={prefs.follow} onChange={(v) => void setFollow(v)} label="Follow Windows" />
        </Row>
      </Section>
      {groups.map((g) => (
        <div key={g.id} className="flex flex-col gap-2">
          <h3 className="m-0 text-body font-semibold">{g.title}</h3>
          <ThemeTitleList themes={g.themes} chosen={g.chosen} label={g.label} setHover={setHover} />
        </div>
      ))}
      <FloatingPreview hover={hover} />
    </div>
  );
}
