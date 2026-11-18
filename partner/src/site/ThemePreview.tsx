import { useRef, useState, type CSSProperties } from "react";
import { THEMES } from "../../../src/theme/themes";
import { OPEN, SEALED } from "../../../src/pages/headlines";
import { DUR, EASE, gsap, RISE_FROM, RISE_STAGGER, RISE_TO, useGSAP, useMotion } from "./motion";
import { Segmented } from "./Segmented";
import "./theme-preview.css";

// The themes, tried on the site (v0.3, decided 2026-10-29; redrawn for v0.4): a small Sanctum
// window in the picked theme, Open or Sealed, drawn like Today is now: flat, the headline, the
// day's ruler with the goal tick in the second color, the card's fixed top slot, time left in
// whole minutes, and the seal line drawn across the card on entering focus. Only the window
// repaints; the site keeps its own light or dark. The colors are the app's own
// (src/theme/themes.ts) and so are the headlines (src/pages/headlines.ts).

/** The picked theme's colors as `--p-<name>`, scoped to the window. */
const vars = (palette: Record<string, string>) => Object.fromEntries(Object.entries(palette).map(([k, v]) => [`--p-${k}`, v])) as CSSProperties;

type Scheme = "dark" | "light";
type Mode = "open" | "sealed";

const NAV = ["Today", "Week", "Stats", "Notes", "Journal"];
const TASKS: [string, boolean][] = [
  ["Problem set 4", false],
  ["Read chapter 7", true],
  ["Reply to Alex", false],
];

// The sample day: 1h 20m focused of a 2h goal, on a 3h ruler; sealed 13 of 60 minutes.
const SPAN = 180;
const FOCUSED = 80;
const GOAL = 120;
const PLANNED = 60;
const ELAPSED = 13;
const pct = (m: number) => `${(m / SPAN) * 100}%`;
const TICKS = Array.from({ length: SPAN / 15 + 1 }, (_, i) => i * 15);
const tickKind = (m: number) => (m % 60 === 0 ? "hour" : m % 30 === 0 ? "half" : "minor");

function Ruler() {
  return (
    <div className="tp-ruler" aria-hidden="true">
      <div className="tp-figure" style={{ left: pct(FOCUSED) }}>
        <span className="tp-figure-num">1h 20m</span>
        <span>focused</span>
      </div>
      <div className="tp-goal-label" style={{ left: pct(GOAL) }}>
        Goal <span className="mono">2h</span>
      </div>
      <div className="tp-scale">
        {TICKS.map((m) => (
          <span key={m} className={`tp-tick ${tickKind(m)}`} style={{ left: pct(m) }} />
        ))}
        <span className="tp-tick goal" style={{ left: pct(GOAL) }} />
        <span className="tp-base" />
        <span className="tp-fill" style={{ width: pct(FOCUSED) }} />
        <span className="tp-needle" style={{ left: pct(FOCUSED) }} />
      </div>
      <div className="tp-hours">
        {[0, 60, 120, 180].map((m) => (
          <span key={m} style={{ left: pct(m) }}>
            {m === 0 ? "0" : `${m / 60}h`}
          </span>
        ))}
      </div>
    </div>
  );
}

function Card({ mode }: { mode: Mode }) {
  const sealed = mode === "sealed";
  const root = useRef<HTMLDivElement>(null);
  const first = useRef(true);
  const { run } = useMotion(root);
  // Entering focus: the seal line draws across the card, then gives way to the track beneath,
  // while the cells rise in place. Leaving, the cells rise in. Reduced motion lands at the end.
  useGSAP(
    () => {
      if (first.current) {
        first.current = false;
        return;
      }
      const el = root.current;
      if (!el) return;
      run(() => {
        const tl = gsap.timeline();
        const cells = el.querySelectorAll("[data-cell]");
        if (sealed) {
          tl.fromTo("[data-seal-line]", { autoAlpha: 1, scaleX: 0 }, { scaleX: 1, duration: DUR.state, ease: EASE.glide })
            .to("[data-seal-line]", { autoAlpha: 0, duration: DUR.state, ease: EASE.ui }, `+=${DUR.enter}`)
            .fromTo(cells, RISE_FROM, { ...RISE_TO, stagger: RISE_STAGGER }, 0.1);
        } else {
          tl.fromTo(cells, RISE_FROM, { ...RISE_TO, stagger: RISE_STAGGER });
        }
        return tl;
      });
    },
    { scope: root, dependencies: [sealed] },
  );

  return (
    <div ref={root} className={`tp-card ${sealed ? "sealed" : ""}`}>
      {sealed ? (
        <div className="tp-slot" data-cell="">
          <span className="tp-chip-state">Sealed</span>
          <span className="tp-slot-title">Problem set 4</span>
          <span className="tp-slot-meta">Ends 3:47, 2 attempts blocked</span>
        </div>
      ) : (
        <div className="tp-slot" data-cell="">
          <span className="tp-slot-title">Problem set 4</span>
          <span className="tp-slot-time mono">at 2:00</span>
          <span className="tp-slot-meta">Deep Work, 60 min</span>
        </div>
      )}
      <div className="tp-row">
        <div className="tp-cell" data-cell="">
          <span className="tp-label">Profile</span>
          <span className="tp-box">Deep Work</span>
        </div>
        {sealed ? (
          <>
            <div className="tp-cell" data-cell="">
              <span className="tp-label">Time left</span>
              <span className="tp-box tp-left mono">{PLANNED - ELAPSED} min</span>
            </div>
            <div className="tp-cell" data-cell="">
              <span className="tp-label">
                <span className="mono">{ELAPSED}</span> of <span className="mono">{PLANNED}</span> min
              </span>
              <span className="tp-pair">
                <span className="tp-box tp-quiet">End early</span>
                <span className="tp-box tp-quiet">Compact</span>
              </span>
            </div>
          </>
        ) : (
          <>
            <div className="tp-cell" data-cell="">
              <span className="tp-label">Length</span>
              <span className="tp-box mono">{PLANNED} min</span>
            </div>
            <div className="tp-cell" data-cell="">
              <span className="tp-label">Discord closes when you enter</span>
              <span className="tp-box tp-enter">Enter focus</span>
            </div>
          </>
        )}
      </div>
      {sealed ? (
        <span className="tp-track">
          <span style={{ transform: `scaleX(${ELAPSED / PLANNED})` }} />
        </span>
      ) : null}
      <span data-seal-line="" className="tp-seal-line" />
    </div>
  );
}

export function ThemePreview() {
  const [scheme, setScheme] = useState<Scheme>("dark");
  const [id, setId] = useState(THEMES[0]!.id);
  const [mode, setMode] = useState<Mode>("open");
  const list = THEMES.filter((t) => t.scheme === scheme);
  const theme = THEMES.find((t) => t.id === id) ?? THEMES[0]!;
  const sealed = mode === "sealed";

  const pickScheme = (s: Scheme) => {
    setScheme(s);
    if (theme.scheme !== s) setId(THEMES.find((t) => t.scheme === s)!.id);
  };

  return (
    <div className="tp">
      <div className="tp-controls">
        <div className="tp-switches">
          <Segmented
            label="Themes"
            options={[
              { value: "dark", label: "Dark" },
              { value: "light", label: "Light" },
            ]}
            value={scheme}
            onChange={pickScheme}
          />
          <Segmented
            label="State"
            options={[
              { value: "open", label: "Open" },
              { value: "sealed", label: "Sealed" },
            ]}
            value={mode}
            onChange={setMode}
          />
        </div>
        <div className="tp-themes" role="radiogroup" aria-label={scheme === "dark" ? "Dark themes" : "Light themes"}>
          {list.map((t) => (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={t.id === id}
              className="tp-chip"
              onClick={() => setId(t.id)}
              style={{ "--chip-accent": t.palette.sealed, "--chip-second": t.palette.second } as CSSProperties}
            >
              <span className="tp-swatch" aria-hidden="true">
                <i />
                <i />
              </span>
              {t.name}
            </button>
          ))}
        </div>
      </div>

      <div className={`tp-window ${sealed ? "sealed" : ""}`} style={vars(theme.palette)} role="img" aria-label={`Sanctum in ${theme.name}, ${mode}`}>
        <aside className="tp-side">
          <img className="tp-mark" src={theme.scheme === "light" ? "/mark-light.svg" : "/mark.svg"} alt="" width={18} height={18} />
          {NAV.map((n, i) => (
            <span key={n} className={i === 0 ? "on" : ""}>
              {n}
            </span>
          ))}
        </aside>
        <div className="tp-main">
          <div className="tp-date">Tuesday, November 18</div>
          <div className="tp-headline">{sealed ? SEALED[0] : OPEN[5]}</div>
          <Ruler />
          <Card mode={mode} />
          <div className="tp-list">
            {TASKS.map(([t, done]) => (
              <div key={t} className={`tp-task ${done ? "done" : ""}`}>
                <span className="tp-check">
                  {done ? (
                    <svg viewBox="0 0 12 12" width="10" height="10" fill="none" aria-hidden="true">
                      <path d="M2.5 6.3l2.4 2.4L9.6 3.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  ) : null}
                </span>
                {t}
              </div>
            ))}
            <div className="tp-next">
              <span className="tp-dot" />
              <span className="tp-next-label">Next up</span>
              <span className="tp-next-title">Team sync</span>
              <span className="tp-next-in">
                in <span className="mono">42m</span>
              </span>
            </div>
          </div>
        </div>
      </div>
      <p className="tp-note">
        {theme.name}, one of {list.length} {scheme} themes.
      </p>
    </div>
  );
}
