import { Segmented, Switch } from "../../components/controls";
import { Row, Section } from "./parts";
import { CUES, preview, STYLES, type Style } from "../../lib/sound";
import { useStore } from "../../state/store";

// Setup › General › Sounds (decided 2026-09-30): on or off, the volume, and a style per cue,
// auditioned right here. Picking a style plays it. Each cue's styles are the shared segmented
// control (a pressed-button group), like every other switch between a few options.

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

export function SoundsSection() {
  const settings = useStore((s) => s.settings);
  const { setSounds, setSoundVolume, setSoundStyle } = useStore();
  return (
    <Section title="Sounds" action={<Switch label="Sounds" checked={settings.sounds} onChange={setSounds} />}>
      <Row label="Volume" hint={settings.sounds ? undefined : "Sounds are off; you can still listen here"}>
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
      {CUES.map((c) => (
        <Row key={c.id} label={c.label} hint={c.hint}>
          <Segmented<Style>
            label={`${c.label} sound`}
            options={OPTIONS}
            value={settings.soundStyles[c.id]}
            onChange={(id) => {
              setSoundStyle(c.id, id);
              preview(c.id, id);
            }}
          />
        </Row>
      ))}
    </Section>
  );
}
