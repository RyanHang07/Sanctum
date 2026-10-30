import { useEffect, useState } from "react";
import { Section } from "./parts";
import { TimeSelect } from "./QuietHours";
import { MiniSelect } from "../../components/controls";
import { EVENTS, errorText, native, onNative } from "../../lib/native";
import { WEEKDAYS } from "../../lib/planner";
import { useStore } from "../../state/store";
import type { PauseConfig, PauseStatus } from "../../lib/types";

// Setup › Distractions › Pause mode (v0.3.1, decided 2026-10-30): outside seals, a flagged app or
// site asks "Still want it?" for five seconds before it opens. A one-second pause cut how often
// an app was opened by about 57% (Grüning et al. 2023). Opt-in; seals and quiet hours still block.

const MODES: { value: PauseConfig["mode"]; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "all", label: "All day" },
  { value: "hours", label: "These hours" },
];

export function PauseModeSection() {
  const [status, setStatus] = useState<PauseStatus | null>(null);
  const notice = useStore((s) => s.showNotice);
  useEffect(() => {
    void native.pauseStatus().then(setStatus, () => undefined);
    const off = onNative<PauseStatus>(EVENTS.pause, setStatus);
    return () => void off.then((f) => f());
  }, []);
  if (!status) return null;
  const c = status.config;
  const save = async (next: PauseConfig) => {
    try {
      setStatus(await native.pauseSave(next));
    } catch (e) {
      notice({ lead: errorText(e) });
    }
  };
  const hours = c.mode === "hours";
  return (
    <Section title="Pause mode" action={<MiniSelect label="Pause mode" value={c.mode} options={MODES} onChange={(mode) => void save({ ...c, mode })} />}>
      <div className="flex flex-col gap-3 px-[14px] py-3">
        <p className="m-0 text-meta leading-normal text-muted">
          Outside focus sessions, an app or site from your Distractions list asks "Still want it?" for five seconds before it opens. Go on lets it be for 15
          minutes. Seals and quiet hours still block outright.
        </p>
        {hours ? (
          <div data-testid="pause-hours" className="flex flex-col gap-3">
            <div role="group" aria-label="Pause days" className="flex gap-1">
              {WEEKDAYS.map((d) => {
                const on = (c.daysMask & (1 << d.bit)) !== 0;
                return (
                  <button
                    key={d.name}
                    type="button"
                    aria-pressed={on}
                    aria-label={d.name}
                    onClick={() => void save({ ...c, daysMask: c.daysMask ^ (1 << d.bit) })}
                    className={`h-[30px] w-[30px] rounded-full border text-meta font-medium transition-colors duration-ui ease-ui ${
                      on ? "border-sealed bg-sealed text-sealed-on hover:brightness-110" : "border-line-input text-muted hover:border-check-line hover:text-text"
                    }`}
                  >
                    {d.short}
                  </button>
                );
              })}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <TimeSelect label="From" value={c.start} disabled={false} onChange={(start) => void save({ ...c, start })} />
              <TimeSelect label="Until" value={c.end} disabled={false} onChange={(end) => void save({ ...c, end })} />
            </div>
          </div>
        ) : null}
        <div data-testid="pause-status" className="flex min-h-[22px] items-center gap-2 text-meta text-text-2">
          <span className={`h-[7px] w-[7px] shrink-0 rounded-full ${status.on ? "bg-sealed" : "bg-line-input"}`} />
          {c.mode === "off" ? "Off" : status.on ? "Asking first right now" : "Not asking right now"}
        </div>
      </div>
    </Section>
  );
}
