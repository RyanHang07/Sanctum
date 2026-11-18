import { useState } from "react";
import { Button } from "../../components/Button";
import { Switch } from "../../components/controls";
import { ChevronIcon } from "../../components/icons";
import { BlockRow } from "./BlockRow";
import { TIME_OPTIONS } from "../week/fields";
import { errorText, native } from "../../lib/native";
import { DEFAULT_QUIET, quietError, quietSummary } from "../../lib/quiet";
import { WEEKDAYS, longTime } from "../../lib/planner";
import { clock } from "../../lib/time";
import { useStore } from "../../state/store";
import type { QuietConfig } from "../../lib/types";

// Setup › Distractions › Quiet hours (v0.1, decided 2026-09-30): the Distractions list blocked on a
// schedule, outside focus sessions. Soft: a 15-minute pause with a reason, and streaks don't move.
// A row of When it blocks (decided 2026-11-16): a summary until you open it.

const selectClass =
  "h-control w-full cursor-pointer appearance-none rounded-control border border-line-input bg-raised pl-[10px] pr-7 text-body text-text transition-colors duration-ui ease-ui hover:border-check-line focus-visible:border-sealed disabled:cursor-not-allowed disabled:opacity-50";

export function TimeSelect({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  disabled: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="label">{label}</span>
      <span className="relative flex items-center">
        <select aria-label={label} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} className={selectClass}>
          {TIME_OPTIONS.map((t) => (
            <option key={t} value={t}>
              {longTime(t)}
            </option>
          ))}
        </select>
        <ChevronIcon size={10} className="pointer-events-none absolute right-[10px] text-muted" />
      </span>
    </label>
  );
}

const DAY_NAMES = /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat)(,|$)/;

/** "11:00 PM to 7:00 AM, every night": the window, then its days. */
export function windowSummary(c: Pick<QuietConfig, "daysMask" | "start" | "end">): string {
  const days = quietSummary({ enabled: true, ...c });
  return `${longTime(c.start)} to ${longTime(c.end)}, ${DAY_NAMES.test(days) ? days : days.charAt(0).toLowerCase() + days.slice(1)}`;
}

/** Seven round day toggles, shared with Pause before opening. */
export function DayToggles({ label, mask, disabled = false, onToggle }: { label: string; mask: number; disabled?: boolean; onToggle: (bit: number) => void }) {
  return (
    <div role="group" aria-label={label} className="flex gap-1">
      {WEEKDAYS.map((d) => {
        const on = (mask & (1 << d.bit)) !== 0;
        return (
          <button
            key={d.name}
            type="button"
            aria-pressed={on}
            aria-label={d.name}
            disabled={disabled}
            onClick={() => onToggle(d.bit)}
            className={`h-[30px] w-[30px] rounded-full border text-meta font-medium transition-colors duration-ui ease-ui disabled:cursor-not-allowed disabled:opacity-50 ${
              on ? "border-sealed bg-sealed text-sealed-on hover:brightness-110" : "border-line-input text-muted hover:border-check-line hover:text-text"
            }`}
          >
            {d.short}
          </button>
        );
      })}
    </div>
  );
}

export function QuietHoursSection() {
  const quiet = useStore((s) => s.quiet);
  const apply = useStore((s) => s.applyQuiet);
  const notice = useStore((s) => s.showNotice);
  const [open, setOpen] = useState(false);
  const c = quiet?.config ?? DEFAULT_QUIET;
  // Mid-window the schedule holds; the way out is the pause, which asks why.
  const locked = !!quiet?.on;

  const save = async (next: QuietConfig) => {
    const err = quietError(next);
    if (err) return notice({ lead: err });
    try {
      apply(await native.quietSave(next));
    } catch (e) {
      notice({ lead: errorText(e) });
    }
  };
  const resume = async () => apply(await native.quietResume());

  let summary: React.ReactNode;
  if (quiet?.on && quiet.endsAt) {
    summary = (
      <>
        <span className="h-[7px] w-[7px] shrink-0 rounded-full bg-sealed" />
        <span>
          On now until <span className="font-mono text-text-2">{clock(quiet.endsAt)}</span>
        </span>
      </>
    );
  } else if (quiet?.pausedUntil) {
    summary = (
      <span>
        Paused until <span className="font-mono text-text-2">{clock(quiet.pausedUntil)}</span>
      </span>
    );
  } else {
    summary = <span className="truncate">{c.enabled ? windowSummary(c) : "Off"}</span>;
  }

  return (
    <BlockRow
      title="Quiet hours"
      summary={summary}
      summaryTestId="quiet-status"
      open={open}
      onToggle={() => setOpen(!open)}
      control={
        <>
          {quiet?.pausedUntil ? (
            <Button variant="quiet" size="sm" onClick={() => void resume()}>
              Resume now
            </Button>
          ) : null}
          <Switch
            label="Quiet hours"
            checked={c.enabled}
            onChange={(v) => {
              if (locked) return;
              void save({ ...c, enabled: v });
              if (v) setOpen(true);
            }}
          />
        </>
      }
    >
      <p className="m-0 text-meta leading-normal text-muted">
        Your Distractions list stays blocked on a schedule, outside focus sessions. Pause it for 15 minutes from the tray with a reason. Streaks don't change.
      </p>
      {/* Off, the schedule still edits, but reads as set aside. */}
      <div data-testid="quiet-schedule" className={`flex flex-col gap-3 transition-opacity duration-ui ease-ui ${c.enabled ? "" : "opacity-50"}`}>
        <div className="flex flex-col gap-1">
          <span className="label">Starts on</span>
          <DayToggles label="Quiet days" mask={c.daysMask} disabled={locked} onToggle={(bit) => void save({ ...c, daysMask: c.daysMask ^ (1 << bit) })} />
        </div>
        <div className="grid max-w-[360px] grid-cols-2 gap-2">
          <TimeSelect label="From" value={c.start} disabled={locked} onChange={(start) => void save({ ...c, start })} />
          <TimeSelect label="Until" value={c.end} disabled={locked} onChange={(end) => void save({ ...c, end })} />
        </div>
      </div>
      {locked ? <p className="m-0 text-micro text-muted">The schedule can change after this window ends.</p> : null}
    </BlockRow>
  );
}
