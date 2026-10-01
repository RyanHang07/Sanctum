import { Switch } from "../../components/controls";
import { Row, Section } from "./parts";
import { CUES, preview, STYLES } from "../../lib/sound";
import { useStore } from "../../state/store";

// Setup › General › Sounds (decided 2026-09-30): on or off, the volume, and a style per cue,
// auditioned right here. Picking a style plays it.

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
          <div role="radiogroup" aria-label={`${c.label} sound`} className="flex rounded-control border border-line-input p-[2px]">
            {STYLES.map((s) => {
              const on = settings.soundStyles[c.id] === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => {
                    setSoundStyle(c.id, s.id);
                    preview(c.id, s.id);
                  }}
                  className={`flex h-[24px] items-center gap-[5px] rounded-[4px] px-[9px] text-meta transition-colors duration-ui ease-ui ${
                    on ? "bg-line font-medium text-text" : "text-muted hover:text-text-2"
                  }`}
                >
                  <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true" className="fill-current">
                    <path d="M1 0.5v7l6-3.5z" />
                  </svg>
                  {s.label}
                </button>
              );
            })}
          </div>
        </Row>
      ))}
    </Section>
  );
}
