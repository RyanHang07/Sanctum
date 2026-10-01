import { Button } from "../../components/Button";
import { Switch } from "../../components/controls";
import { ChevronIcon } from "../../components/icons";
import { Section } from "./parts";
import { TIME_OPTIONS } from "../week/fields";
import { errorText, native } from "../../lib/native";
import { DEFAULT_QUIET, quietError, quietSummary } from "../../lib/quiet";
import { WEEKDAYS, longTime } from "../../lib/planner";
import { clock } from "../../lib/time";
import { useStore } from "../../state/store";
import type { QuietConfig } from "../../lib/types";

// Setup › Distractions › Quiet hours (v0.1, decided 2026-09-30): the Distractions list blocked on a
// schedule, outside focus sessions. Soft: a 15-minute pause with a reason, and streaks don't move.

const selectClass =
  "h-control w-full cursor-pointer appearance-none rounded-control border border-line-input bg-raised pl-[10px] pr-7 text-body text-text outline-none transition-colors duration-ui ease-ui hover:border-check-line focus-visible:border-sealed disabled:cursor-not-allowed disabled:opacity-50";

function TimeSelect({ label, value, disabled, onChange }: { label: string; value: string; disabled: boolean; onChange: (v: string) => void }) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-faint">{label}</span>
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

export function QuietHoursSection() {
  const quiet = useStore((s) => s.quiet);
  const apply = useStore((s) => s.applyQuiet);
  const notice = useStore((s) => s.showNotice);
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

  let status: React.ReactNode;
  if (quiet?.on && quiet.endsAt) {
    status = (
      <>
        <span className="h-[7px] w-[7px] shrink-0 rounded-full bg-sealed" />
        <span>
          On now until <span className="font-mono text-text">{clock(quiet.endsAt)}</span>
        </span>
      </>
    );
  } else if (quiet?.pausedUntil) {
    status = (
      <>
        <span className="h-[7px] w-[7px] shrink-0 rounded-full bg-line-input" />
        <span className="grow">
          Paused until <span className="font-mono text-text">{clock(quiet.pausedUntil)}</span>
        </span>
        <Button variant="quiet" size="sm" onClick={() => void resume()}>
          Resume now
        </Button>
      </>
    );
  } else {
    status = <span>{c.enabled ? `${quietSummary(c)}, ${longTime(c.start)} to ${longTime(c.end)}` : "Off"}</span>;
  }

  return (
    <Section title="Quiet hours" action={<Switch label="Quiet hours" checked={c.enabled} onChange={(v) => !locked && void save({ ...c, enabled: v })} />}>
      <div className="flex flex-col gap-3 px-[14px] py-3">
        <p className="m-0 text-meta leading-normal text-muted">
          Your Distractions list stays blocked on a schedule, outside focus sessions. Pause it for 15 minutes from the tray with a reason. Streaks don't change.
        </p>
        <div className="flex flex-col gap-1">
          <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-faint">Starts on</span>
          <div role="group" aria-label="Quiet days" className="flex gap-1">
            {WEEKDAYS.map((d) => {
              const on = (c.daysMask & (1 << d.bit)) !== 0;
              return (
                <button
                  key={d.name}
                  type="button"
                  aria-pressed={on}
                  aria-label={d.name}
                  disabled={locked}
                  onClick={() => void save({ ...c, daysMask: c.daysMask ^ (1 << d.bit) })}
                  className={`h-[30px] w-[30px] rounded-full border text-meta font-medium transition-colors duration-ui ease-ui disabled:cursor-not-allowed disabled:opacity-50 ${
                    on ? "border-sealed bg-sealed text-sealed-on hover:brightness-110" : "border-line-input text-muted hover:border-check-line hover:text-text"
                  }`}
                >
                  {d.short}
                </button>
              );
            })}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <TimeSelect label="From" value={c.start} disabled={locked} onChange={(start) => void save({ ...c, start })} />
          <TimeSelect label="Until" value={c.end} disabled={locked} onChange={(end) => void save({ ...c, end })} />
        </div>
        <div data-testid="quiet-status" className="flex min-h-[26px] items-center gap-2 text-meta text-text-2">
          {status}
        </div>
        {locked ? <p className="m-0 text-[11px] text-faint">The schedule can change after this window ends.</p> : null}
      </div>
    </Section>
  );
}
