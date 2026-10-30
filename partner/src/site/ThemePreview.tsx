import { useState, type CSSProperties } from "react";
import { THEMES } from "../../../src/theme/themes";
import "./theme-preview.css";

// The themes, tried on the site (v0.3, decided 2026-10-29): a small Sanctum window drawn in the
// picked theme, Open or Sealed. Only the window repaints; the site keeps its own light or dark.
// The colours are the app's own (src/theme/themes.ts), so the preview can't drift from the app.

/** The picked theme's colours as `--p-<name>`, scoped to the window. */
const vars = (palette: Record<string, string>) => Object.fromEntries(Object.entries(palette).map(([k, v]) => [`--p-${k}`, v])) as CSSProperties;

const NAV = ["Today", "Week", "Stats", "Notes", "Journal"];
const TASKS: [string, boolean][] = [
  ["Problem set 4", true],
  ["Read chapter 7", false],
  ["Reply to Alex", false],
];

export function ThemePreview() {
  const [id, setId] = useState(THEMES[0]!.id);
  const [sealed, setSealed] = useState(false);
  const theme = THEMES.find((t) => t.id === id) ?? THEMES[0]!;

  return (
    <div className="tp">
      <div className="tp-controls">
        <div className="tp-themes" role="radiogroup" aria-label="Theme">
          {THEMES.map((t) => (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={t.id === id}
              className="tp-chip"
              onClick={() => setId(t.id)}
              style={{ "--chip-app": t.palette.app, "--chip-accent": t.palette.sealed } as CSSProperties}
            >
              <span className="tp-swatch" aria-hidden="true" />
              {t.name}
            </button>
          ))}
        </div>
        <div className="tp-mode" role="group" aria-label="State">
          <button type="button" aria-pressed={!sealed} onClick={() => setSealed(false)}>
            Open
          </button>
          <button type="button" aria-pressed={sealed} onClick={() => setSealed(true)}>
            Sealed
          </button>
        </div>
      </div>

      <div className={`tp-window ${sealed ? "sealed" : ""}`} style={vars(theme.palette)} role="img" aria-label={`Sanctum in ${theme.name}, ${sealed ? "sealed" : "open"}`}>
        <div className="tp-mesh" aria-hidden="true" />
        <aside className="tp-side">
          <img className="tp-mark" src={theme.scheme === "light" ? "/mark-light.svg" : "/mark.svg"} alt="" width={18} height={18} />
          {NAV.map((n, i) => (
            <span key={n} className={i === 0 ? "on" : ""}>
              {n}
            </span>
          ))}
        </aside>
        <div className="tp-main">
          <div className="tp-title">Today</div>
          {sealed ? (
            <div className="tp-sealed">
              <span className="tp-state">Sealed · Deep Work</span>
              <span className="tp-time">47:12</span>
              <span className="tp-sub">left of 60 min · 2 attempts blocked</span>
              <span className="tp-button ghost">End early</span>
            </div>
          ) : (
            <div className="tp-focus">
              <span className="tp-pill">Deep Work</span>
              <span className="tp-pill">60 min</span>
              <span className="tp-button primary">Enter focus</span>
            </div>
          )}
          <div className="tp-list">
            {TASKS.map(([t, done]) => (
              <div key={t} className={`tp-task ${done ? "done" : ""}`}>
                <span className="tp-check" />
                {t}
              </div>
            ))}
            <div className="tp-task event">
              <span className="tp-dot" />
              Team sync · 3:00
            </div>
          </div>
        </div>
      </div>
      <p className="tp-note">
        {theme.name}, {theme.scheme}. Every window follows it: the tray, the compact timer, the browser extension's pages, even the tray icon.
      </p>
    </div>
  );
}
