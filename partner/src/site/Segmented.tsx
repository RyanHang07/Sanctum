import { useRef } from "react";
import { useSlidingIndicator } from "./motion";

// The app's segmented control (src/components/controls.tsx, without tabs): an aria-pressed button
// group whose highlight slides between options (180ms, snap ease).

export function Segmented<V extends string>({
  label,
  options,
  value,
  onChange,
  className = "",
}: {
  label: string;
  options: readonly { value: V; label: string }[];
  value: V;
  onChange: (v: V) => void;
  className?: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const indicator = useRef<HTMLSpanElement>(null);
  useSlidingIndicator(root, indicator, value, options.map((o) => o.value).join("|"));
  return (
    <div ref={root} role="group" aria-label={label} className={`segmented ${className}`}>
      <span ref={indicator} className="segmented-indicator" aria-hidden="true" />
      {options.map((o) => (
        <button key={o.value} type="button" data-indicator-item={o.value} aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {/* An invisible medium-weight copy keeps the width the same, picked or not. */}
          <span data-label={o.label}>{o.label}</span>
        </button>
      ))}
    </div>
  );
}
