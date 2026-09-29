import { useEffect, useState, type ReactNode } from "react";

// Building blocks for Setup sections (design/screens/Setup.dc.html).

export function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={title} className="overflow-hidden rounded-panel border border-line bg-panel">
      <div className="flex h-10 items-center justify-between border-b border-line px-[14px]">
        <h2 className="m-0 text-body font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className={`flex items-center gap-[10px] border-b border-line-soft px-[14px] py-[6px] last:border-b-0 ${hint ? "min-h-12" : "min-h-11"}`}>
      <span className="flex min-w-0 grow flex-col gap-[2px]">
        <span className="text-body">{label}</span>
        {hint ? <span className="text-[11px] text-muted">{hint}</span> : null}
      </span>
      {children}
    </div>
  );
}

/** A list of exe names saved on blur or Enter. */
export function AppListField({ label, saved, placeholder, onSave }: { label: string; saved: string; placeholder: string; onSave: (v: string) => void }) {
  const [value, setValue] = useState(saved);
  useEffect(() => setValue(saved), [saved]);
  return (
    <input
      aria-label={label}
      value={value}
      placeholder={placeholder}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => value !== saved && onSave(value)}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      className="h-[26px] w-[200px] shrink-0 rounded-control border border-line-input bg-transparent px-2 font-mono text-[11px] text-text outline-none transition-colors duration-ui ease-ui placeholder:text-faint hover:border-check-line focus:border-sealed"
    />
  );
}
