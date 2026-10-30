import type { Category, SessionOutcome } from "../../lib/types";

// Shared by the Stats tabs (v0.3): the category colours (as Overview's "Where time went"),
// outcome words, and a small segmented switch.

export const CATEGORY: Record<Category, { label: string; dot: string }> = {
  productive: { label: "Productive", dot: "bg-sealed" },
  neutral: { label: "Neutral", dot: "bg-check-line" },
  distracting: { label: "Distracting", dot: "bg-broken" },
};

export const OUTCOME: Record<SessionOutcome, string> = {
  completed: "Kept",
  unlocked_early: "Let out early",
  broken: "Broken",
};

/** 45s, 12m, 2h 05m */
export function duration(seconds: number): string {
  const m = Math.round(seconds / 60);
  if (m < 1) return `${Math.max(0, Math.round(seconds))}s`;
  const h = Math.floor(m / 60);
  return h ? `${h}h ${String(m % 60).padStart(2, "0")}m` : `${m}m`;
}

/** A sealed app or site's name for people: "discord.exe" → "discord". */
export const appLabel = (key: string) => key.replace(/\.exe$/i, "");

export function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: readonly { id: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div role="tablist" aria-label={label} className="flex rounded-control border border-line-input p-[2px]">
      {options.map((o) => (
        <button
          key={o.id}
          role="tab"
          aria-selected={value === o.id}
          onClick={() => onChange(o.id)}
          className={`h-[26px] rounded-[4px] px-[10px] text-meta transition-colors duration-ui ease-ui ${
            value === o.id ? "bg-line font-medium text-text" : "text-muted hover:text-text-2"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
