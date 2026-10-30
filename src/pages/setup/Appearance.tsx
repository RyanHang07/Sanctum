import type { CSSProperties } from "react";
import { Switch } from "../../components/controls";
import { CheckIcon } from "../../components/icons";
import { Row, Section } from "./parts";
import { useTheme } from "../../state/theme";
import { cssVar, KEYS, type Theme } from "../../theme/palette";
import { THEMES } from "../../theme/themes";

// Setup › Appearance (v0.3): the themes as small windows drawn in their own colours. Hovering
// one shows it across the whole app until the pointer leaves; clicking keeps it. Following
// Windows, there's a pick for dark mode and one for light mode.

/** A theme's colours as variables on one element: everything inside draws in that theme. */
export const themeVars = (t: Theme) => Object.fromEntries(KEYS.map((k) => [cssVar(k), t.palette[k]])) as CSSProperties;

/** A small window in the theme's colours: sidebar, a headline, a list, and Enter focus. */
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

function ThemeCard({ theme, chosen, tag, small }: { theme: Theme; chosen: boolean; tag?: string; small?: boolean }) {
  const { pick, preview } = useTheme();
  return (
    <button
      type="button"
      role="radio"
      aria-checked={chosen}
      aria-label={theme.name}
      onClick={() => void pick(theme.id)}
      onPointerEnter={() => preview(theme.id)}
      onPointerLeave={() => preview(null)}
      onFocus={() => preview(theme.id)}
      onBlur={() => preview(null)}
      className={`flex flex-col gap-2 rounded-panel border p-2 text-left transition-colors duration-ui ease-ui ${
        chosen ? "border-sealed bg-sealed-tint" : "border-line bg-panel hover:border-line-input"
      }`}
    >
      <div style={themeVars(theme)}>
        <Miniature small={small} />
      </div>
      <span className="flex items-center gap-[6px] px-[2px] text-meta">
        <span className={chosen ? "font-medium text-text" : "text-text-2"}>{theme.name}</span>
        <span className="grow" />
        {tag ? <span className="text-[11px] text-muted">{tag}</span> : null}
        {chosen ? <CheckIcon size={12} /> : null}
      </span>
    </button>
  );
}

/** The cards for some themes, one of them chosen. */
export function ThemeGrid({ themes, chosen, label, tag, small = false }: { themes: Theme[]; chosen: string; label: string; tag?: string; small?: boolean }) {
  return (
    <div role="radiogroup" aria-label={label} className={`grid gap-3 ${small ? "grid-cols-[repeat(auto-fill,minmax(122px,1fr))]" : "grid-cols-[repeat(auto-fill,minmax(168px,1fr))]"}`}>
      {themes.map((t) => (
        <ThemeCard key={t.id} theme={t} chosen={t.id === chosen} tag={t.id === chosen ? tag : undefined} small={small} />
      ))}
    </div>
  );
}

export function AppearanceSection() {
  const { prefs, setFollow } = useTheme();
  const dark = THEMES.filter((t) => t.scheme === "dark");
  const light = THEMES.filter((t) => t.scheme === "light");
  return (
    <div className="flex flex-col gap-5">
      <Section title="Theme">
        <Row label="Follow Windows" hint={prefs.follow ? "Light or dark as Windows is set, with a theme for each." : "One theme, whatever Windows is set to."}>
          <Switch checked={prefs.follow} onChange={(v) => void setFollow(v)} label="Follow Windows" />
        </Row>
      </Section>
      {prefs.follow ? (
        <>
          <div className="flex flex-col gap-2">
            <h3 className="m-0 text-body font-semibold">In dark mode</h3>
            <ThemeGrid themes={dark} chosen={prefs.dark} label="Theme in dark mode" />
          </div>
          <div className="flex flex-col gap-2">
            <h3 className="m-0 text-body font-semibold">In light mode</h3>
            <ThemeGrid themes={light} chosen={prefs.light} label="Theme in light mode" />
          </div>
        </>
      ) : (
        <ThemeGrid themes={THEMES} chosen={prefs.fixed} label="Theme" />
      )}
      <p className="m-0 text-meta text-muted">Hover a theme to see it everywhere; click to keep it.</p>
    </div>
  );
}
