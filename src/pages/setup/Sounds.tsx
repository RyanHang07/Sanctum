import { useRef, useState } from "react";
import { Segmented, Switch } from "../../components/controls";
import { ChevronIcon } from "../../components/icons";
import { Row, Section } from "./parts";
import { CUES, preview, STYLES, type Style } from "../../lib/sound";
import { DUR, EASE, gsap, RISE_FROM, RISE_STAGGER, RISE_TO, useGSAP } from "../../lib/gsap";
import { useMotion } from "../../lib/useMotion";
import { useStore } from "../../state/store";

// Setup › Sound and Alerts (decided 2026-09-30, regrouped 2026-11-16): on or off, the volume,
// one style for every cue, and a fold to pick a style per cue. Picking a style plays it.

const PLAY = (
  <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true" className="fill-current">
    <path d="M1 0.5v7l6-3.5z" />
  </svg>
);

const OPTIONS = STYLES.map((s) => ({
  value: s.id,
  label: (
    <span className="flex items-center gap-[5px]">
      {PLAY}
      {s.label}
    </span>
  ),
}));

/** The one style every cue shares, or null when they differ. */
export function sharedStyle(styles: Record<string, Style>): Style | null {
  const all = CUES.map((c) => styles[c.id]);
  return all.every((s) => s === all[0]) ? (all[0] ?? null) : null;
}

/** Each cue's own style: opens to its height, then the rows cascade in (as Pending does). */
function EachSound() {
  const styles = useStore((s) => s.settings.soundStyles);
  const setSoundStyle = useStore((s) => s.setSoundStyle);
  const [open, setOpen] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const { run } = useMotion(list);
  useGSAP(
    () => {
      if (!open || !list.current) return;
      const el = list.current;
      run(() =>
        gsap
          .timeline({ id: "sounds-fold" })
          .fromTo(el, { height: 0 }, { height: "auto", duration: DUR.state, ease: EASE.glide, clearProps: "height" })
          .fromTo(Array.from(el.children), RISE_FROM, { ...RISE_TO, stagger: RISE_STAGGER }, "-=0.06"),
      );
    },
    { scope: list, dependencies: [open] },
  );
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={`flex min-h-11 w-full items-center gap-2 border-b border-line-soft px-[14px] text-left text-body transition-colors duration-ui ease-ui last:border-b-0 hover:text-text ${open ? "text-text" : "text-text-2"}`}
      >
        <ChevronIcon size={10} className={`transition-transform duration-ui ease-ui ${open ? "" : "-rotate-90"}`} />
        <span className="grow">Each sound</span>
      </button>
      {open ? (
        <div ref={list} data-testid="each-sound" className="flex flex-col overflow-hidden">
          {CUES.map((c) => (
            <Row key={c.id} label={c.label} hint={c.hint}>
              <Segmented<Style>
                label={`${c.label} sound`}
                options={OPTIONS}
                value={styles[c.id]}
                onChange={(id) => {
                  setSoundStyle(c.id, id);
                  preview(c.id, id);
                }}
              />
            </Row>
          ))}
        </div>
      ) : null}
    </>
  );
}

export function SoundsSection() {
  const settings = useStore((s) => s.settings);
  const { setSounds, setSoundVolume, setSoundStyle } = useStore();
  const shared = sharedStyle(settings.soundStyles);
  const setAll = (id: Style) => {
    for (const c of CUES) setSoundStyle(c.id, id);
    preview("enter", id);
  };
  return (
    <Section title="Sounds" action={<Switch label="Sounds" checked={settings.sounds} onChange={setSounds} />}>
      <Row label="Volume" hint={settings.sounds ? undefined : "Off. Previews still play."}>
        <input
          type="range"
          aria-label="Volume"
          min={0}
          max={100}
          step={5}
          value={settings.soundVolume}
          onChange={(e) => setSoundVolume(Number(e.target.value))}
          className="w-[160px] accent-sealed"
        />
        <span className="w-9 text-right font-mono text-meta text-muted">{settings.soundVolume}</span>
      </Row>
      <Row label="Style" hint={shared ? undefined : "Mixed. Set per sound below."}>
        {/* A value outside the options leaves every button unpressed while the cues differ. */}
        <Segmented<Style> label="Every sound" options={OPTIONS} value={shared ?? ("mixed" as Style)} onChange={setAll} />
      </Row>
      <EachSound />
    </Section>
  );
}
