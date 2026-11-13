import { createPortal } from "react-dom";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Switch } from "../../components/controls";
import { CheckIcon } from "../../components/icons";
import { Row, Section } from "./parts";
import { useTheme } from "../../state/theme";
import { cssVar, KEYS, type Theme } from "../../theme/palette";
import { THEMES } from "../../theme/themes";

// Setup › Appearance (v0.3, reworked): themes as a list of titles. Hover/focus shows an
// animated floating preview near the cursor (top-right, clamped) without live-applying the
// theme; clicking selects it.

export const themeVars = (t: Theme) => Object.fromEntries(KEYS.map((k) => [cssVar(k), t.palette[k]])) as CSSProperties;

function Miniature({ small = false }: { small?: boolean }) {
  return (
    <div aria-hidden="true" className={`flex ${small ? "h-[60px]" : "h-[84px]"} overflow-hidden rounded-[6px] border border-line bg-app`}>
      <div className="flex w-[30%] flex-col gap-[5px] bg-sidebar p-[7px]">
        <span className="h-[5px] w-[70%] rounded-full bg-text" />
        <span className="mt-[3px] h-[4px] w-[80%] rounded-full bg-raised" />
        <span className="h-[4px] w-[60%] rounded-full bg-line-input" />
        <span className="h-[4px] w-[70%] rounded-full bg-line-input" />
      </div>
      <div className="flex grow flex-col gap-[6px] p-[7px]">
        <span className="h-[6px] w-[62%] rounded-full bg-text" />
        <div className="flex gap-[5px]">
          <span className="h-[18px] grow rounded-[3px] border border-line bg-panel" />
          <span className="h-[18px] w-[38%] rounded-[3px] bg-sealed" />
        </div>
        <div className="flex flex-col gap-[4px] rounded-[3px] border border-line bg-panel p-[5px]">
          <span className="h-[3px] w-[80%] rounded-full bg-muted" />
          <span className="h-[3px] w-[55%] rounded-full bg-muted" />
          <span className="flex gap-[4px]">
            <span className="h-[3px] w-[18%] rounded-full bg-sealed-text" />
            <span className="h-[3px] w-[18%] rounded-full bg-event" />
          </span>
        </div>
      </div>
    </div>
  );
}

type Hover = { id: string; x: number; y: number };

function clampPreview(x: number, y: number) {
  const w = 220;
  const h = 140;
  const margin = 12;
  const left = Math.min(window.innerWidth - w - margin, Math.max(margin, x + 18));
  const top = Math.min(window.innerHeight - h - margin, Math.max(margin, y - h - 8));
  return { left, top };
}

function FloatingPreview({ hover }: { hover: Hover | null }) {
  const theme = hover ? THEMES.find((t) => t.id === hover.id) : null;
  const reduce = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!hover || !theme) return null;
  const pos = clampPreview(hover.x, hover.y);
  return createPortal(
    <div
      aria-hidden="true"
      className="pointer-events-none fixed z-50 w-[220px]"
      style={{ left: pos.left, top: pos.top }}
    >
      <div
        style={themeVars(theme)}
        className={`rounded-panel border border-line-input bg-panel p-2 shadow-dialog ${reduce ? "" : "animate-rise-in"}`}
      >
        <Miniature />
        <div className="mt-2 px-[2px] text-meta font-medium text-text">{theme.name}</div>
      </div>
    </div>,
    document.body,
  );
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
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-col overflow-hidden rounded-panel border border-line bg-panel">
      {themes.map((theme) => {
        const on = theme.id === chosen;
        return (
          <button
            key={theme.id}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={theme.name}
            onClick={() => void pick(theme.id)}
            onPointerEnter={(e) => {
              setHover({ id: theme.id, x: e.clientX, y: e.clientY });
              preview(theme.id);
            }}
            onPointerMove={(e) => setHover({ id: theme.id, x: e.clientX, y: e.clientY })}
            onPointerLeave={() => {
              setHover(null);
              preview(null);
            }}
            onFocus={(e) => {
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
              setHover({ id: theme.id, x: r.right, y: r.top + r.height / 2 });
              preview(theme.id);
            }}
            onBlur={() => {
              setHover(null);
              preview(null);
            }}
            className={`flex items-center justify-between gap-3 border-b border-line-soft px-[14px] py-[10px] text-left transition-colors duration-ui ease-ui last:border-b-0 ${
              on ? "bg-sealed-tint text-text" : "text-text-2 hover:bg-line-soft hover:text-text"
            }`}
          >
            <span className={`text-body ${on ? "font-medium text-text" : ""}`}>{theme.name}</span>
            <span className="flex items-center gap-2 text-meta text-muted">
              {on ? <span className="text-sealed-text">Selected</span> : null}
              {on ? <CheckIcon size={12} /> : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function ThemeGrid({
  themes,
  chosen,
  label,
}: {
  themes: Theme[];
  chosen: string;
  label: string;
  tag?: string;
  small?: boolean;
}) {
  // Back-compat export (used by onboarding): grid of title cards with floating preview, no live app preview.
  const { pick, preview } = useTheme();
  const [hover, setHover] = useState<Hover | null>(null);
  useEffect(() => () => preview(null), [preview]);
  return (
    <>
      <div role="radiogroup" aria-label={label} className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(168px,1fr))]">
        {themes.map((theme) => {
          const on = theme.id === chosen;
          return (
            <button
              key={theme.id}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={theme.name}
              onClick={() => void pick(theme.id)}
              onPointerEnter={(e) => {
                setHover({ id: theme.id, x: e.clientX, y: e.clientY });
                preview(theme.id);
              }}
              onPointerMove={(e) => setHover({ id: theme.id, x: e.clientX, y: e.clientY })}
              onPointerLeave={() => {
                setHover(null);
                preview(null);
              }}
              onFocus={(e) => {
                const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                setHover({ id: theme.id, x: r.right, y: r.top + r.height / 2 });
                preview(theme.id);
              }}
              onBlur={() => {
                setHover(null);
                preview(null);
              }}
              className={`flex flex-col gap-2 rounded-panel border p-2 text-left transition-colors duration-ui ease-ui ${
                on ? "border-sealed bg-sealed-tint" : "border-line bg-panel hover:border-line-input"
              }`}
            >
              <div style={themeVars(theme)}>
                <Miniature small />
              </div>
              <span className="flex items-center gap-[6px] px-[2px] text-meta">
                <span className={on ? "font-medium text-text" : "text-text-2"}>{theme.name}</span>
                <span className="grow" />
                {on ? <CheckIcon size={12} /> : null}
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
  const { prefs, setFollow, preview } = useTheme();
  const [hover, setHover] = useState<Hover | null>(null);
  const dark = useMemo(() => THEMES.filter((t) => t.scheme === "dark"), []);
  const light = useMemo(() => THEMES.filter((t) => t.scheme === "light"), []);
  useEffect(() => () => preview(null), [preview]);

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
    <div className="flex flex-col gap-5">
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
      <p className="m-0 text-meta text-muted">Hover a theme title to preview it; click to select it.</p>
      <FloatingPreview hover={hover} />
    </div>
  );
}
