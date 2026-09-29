import type { ReactNode } from "react";
import { ChevronIcon } from "../../components/icons";
import { useStore } from "../../state/store";
import { EVERY_DAY, WEEKDAYS, WEEKDAYS_MASK, WEEKENDS_MASK, hasDay, longTime } from "../../lib/planner";

// Form controls shared by the one-time and routine editors.

const pad = (n: number) => String(n).padStart(2, "0");

/** Every 15 minutes, 5:00 AM to 11:45 PM, then midnight to 4:45 AM. */
export const TIME_OPTIONS: string[] = Array.from({ length: 96 }, (_, i) => {
  const minutes = ((i * 15 + 5 * 60) % (24 * 60));
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
});

export const LENGTH_OPTIONS = [15, 30, 45, 60, 90, 120, 180, 240];

const selectClass =
  "h-control w-full cursor-pointer appearance-none rounded-control border border-line-input bg-raised pl-[10px] pr-7 text-body text-text outline-none transition-colors duration-ui ease-ui hover:border-check-line focus-visible:border-sealed";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-faint">{label}</span>
      <span className="relative flex items-center">
        {children}
        <ChevronIcon size={10} className="pointer-events-none absolute right-[10px] text-muted" />
      </span>
    </label>
  );
}

export function TimeField({ value, onChange, empty = "Anytime" }: { value: string | null; onChange: (v: string | null) => void; empty?: string }) {
  return (
    <Field label="Time">
      <select aria-label="Time" value={value ?? ""} onChange={(e) => onChange(e.target.value || null)} className={selectClass}>
        <option value="">{empty}</option>
        {TIME_OPTIONS.map((t) => (
          <option key={t} value={t}>
            {longTime(t)}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function LengthField({ value, onChange }: { value: number | null; onChange: (v: number | null) => void }) {
  return (
    <Field label="Length">
      <select aria-label="Length" value={value ?? ""} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)} className={selectClass}>
        <option value="">None</option>
        {LENGTH_OPTIONS.map((m) => (
          <option key={m} value={m}>
            {m < 60 ? `${m} min` : `${m / 60} h`}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function ProfileField({ value, onChange }: { value: number | null; onChange: (v: number | null) => void }) {
  const profiles = useStore((s) => s.profiles);
  return (
    <Field label="Focus profile">
      <select aria-label="Focus profile" value={value ?? ""} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)} className={selectClass}>
        <option value="">None</option>
        {profiles.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </Field>
  );
}

/** Weekday chips (M T W T F S S) plus Every day / Weekdays / Weekends presets. */
export function DaysField({ mask, onChange }: { mask: number; onChange: (m: number) => void }) {
  const presets = [
    { label: "Every day", mask: EVERY_DAY },
    { label: "Weekdays", mask: WEEKDAYS_MASK },
    { label: "Weekends", mask: WEEKENDS_MASK },
  ];
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-faint">Repeats on</span>
      <div className="flex items-center gap-[6px]" role="group" aria-label="Days">
        {WEEKDAYS.map((d) => {
          const on = hasDay(mask, d.bit);
          return (
            <button
              key={d.name}
              type="button"
              aria-pressed={on}
              aria-label={d.name}
              onClick={() => onChange(mask ^ (1 << d.bit))}
              className={`h-9 w-9 rounded-full border text-body font-medium transition-colors duration-ui ease-ui ${
                on ? "border-sealed bg-sealed text-sealed-on hover:brightness-110" : "border-line-input text-muted hover:border-check-line hover:text-text"
              }`}
            >
              {d.short}
            </button>
          );
        })}
      </div>
      <div className="flex gap-[6px]">
        {presets.map((p) => (
          <button
            key={p.label}
            type="button"
            aria-pressed={mask === p.mask}
            onClick={() => onChange(p.mask)}
            className={`h-[26px] rounded-full border px-3 text-meta transition-colors duration-ui ease-ui ${
              mask === p.mask ? "border-sealed-line bg-sealed-tint text-text" : "border-line-input text-muted hover:text-text"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function TitleInput({ value, onChange, onSubmit, placeholder, autoFocus = true }: { value: string; onChange: (v: string) => void; onSubmit: () => void; placeholder: string; autoFocus?: boolean }) {
  return (
    <input
      aria-label="Title"
      autoFocus={autoFocus}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => e.key === "Enter" && onSubmit()}
      className="h-10 w-full rounded-control border border-line-input bg-raised px-3 text-[15px] font-medium text-text outline-none transition-colors duration-ui ease-ui placeholder:font-normal placeholder:text-faint hover:border-check-line focus:border-sealed"
    />
  );
}

/** Where a new one-time item goes: Sanctum (a to-do) or straight onto one of your calendars. */
export function SaveToField({ value, options, onChange }: { value: string; options: { value: string; label: string }[]; onChange: (v: string) => void }) {
  return (
    <Field label="Save to">
      <select aria-label="Save to" value={value} onChange={(e) => onChange(e.target.value)} className={selectClass}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}
