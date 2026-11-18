import { useEffect, useRef, useState } from "react";
import { BlockRow } from "./BlockRow";
import { DayToggles, TimeSelect, windowSummary } from "./QuietHours";
import { Segmented, Switch } from "../../components/controls";
import { EVENTS, errorText, native, onNative } from "../../lib/native";
import { useStore } from "../../state/store";
import type { PauseConfig, PauseStatus } from "../../lib/types";

// Setup › Distractions › Pause before opening (v0.3.1, decided 2026-10-30): outside seals, a
// flagged app or site waits five seconds ("youtube.com can wait five seconds.") before it opens. A one-second pause
// cut how often an app was opened by about 57% (Grüning et al. 2023). Opt-in; seals and quiet hours
// still block. A row of When it blocks (decided 2026-11-16): the switch turns it on, opening the
// row picks all day or set hours.

type OnMode = Exclude<PauseConfig["mode"], "off">;
const MODES: { value: OnMode; label: string }[] = [
  { value: "all", label: "All day" },
  { value: "hours", label: "These hours" },
];

export function PauseModeSection() {
  const [status, setStatus] = useState<PauseStatus | null>(null);
  const [open, setOpen] = useState(false);
  // The switch turns back on to the mode it last had.
  const lastOn = useRef<OnMode>("all");
  const notice = useStore((s) => s.showNotice);
  useEffect(() => {
    void native.pauseStatus().then(setStatus, () => undefined);
    const off = onNative<PauseStatus>(EVENTS.pause, setStatus);
    return () => void off.then((f) => f());
  }, []);
  if (!status) return null;
  const c = status.config;
  if (c.mode !== "off") lastOn.current = c.mode;
  const save = async (next: PauseConfig) => {
    try {
      setStatus(await native.pauseSave(next));
    } catch (e) {
      notice({ lead: errorText(e) });
    }
  };
  const on = c.mode !== "off";
  const summary = on ? (
    <>
      <span className={`h-[7px] w-[7px] shrink-0 rounded-full ${status.on ? "bg-sealed" : "bg-line-input"}`} />
      <span className="truncate">
        {c.mode === "all" ? "All day" : windowSummary(c)} · {status.on ? "Asking first right now" : "Not asking right now"}
      </span>
    </>
  ) : (
    <span>Off</span>
  );
  return (
    <BlockRow
      title="Pause before opening"
      summary={summary}
      summaryTestId="pause-status"
      open={open}
      onToggle={() => setOpen(!open)}
      control={
        <Switch
          label="Pause before opening"
          checked={on}
          onChange={(v) => {
            void save({ ...c, mode: v ? lastOn.current : "off" });
            if (v) setOpen(true);
          }}
        />
      }
    >
      <p className="m-0 text-meta leading-normal text-muted">
        Outside focus sessions, an app or site from your Distractions list waits five seconds before it opens. Go on lets it be for 15
        minutes. Seals and quiet hours still block outright.
      </p>
      <Segmented label="Pause mode" options={MODES} value={c.mode as OnMode} onChange={(mode) => void save({ ...c, mode })} className="self-start" />
      {c.mode === "hours" ? (
        <div data-testid="pause-hours" className="flex flex-col gap-3">
          <DayToggles label="Pause days" mask={c.daysMask} onToggle={(bit) => void save({ ...c, daysMask: c.daysMask ^ (1 << bit) })} />
          <div className="grid max-w-[360px] grid-cols-2 gap-2">
            <TimeSelect label="From" value={c.start} disabled={false} onChange={(start) => void save({ ...c, start })} />
            <TimeSelect label="Until" value={c.end} disabled={false} onChange={(end) => void save({ ...c, end })} />
          </div>
        </div>
      ) : null}
    </BlockRow>
  );
}
