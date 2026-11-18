import { useEffect, useRef, useState, type ReactNode } from "react";
import { gsap, RISE_FROM, RISE_STAGGER, RISE_TO } from "../../lib/gsap";
import { useMotion } from "../../lib/useMotion";

// Building blocks for Setup sections (design/screens/Setup.dc.html).

/**
 * A box of settings. `titled={false}` is for a box that would repeat its section's name: the
 * name stays its accessible label, and any action sits in a slim bar with no repeated text.
 */
export function Section({
  title,
  action,
  children,
  className = "",
  titled = true,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  titled?: boolean;
}) {
  return (
    <section aria-label={title} className={`overflow-hidden rounded-panel border border-line bg-panel ${className}`}>
      {titled ? (
        <div className="flex h-10 items-center justify-between border-b border-line px-[14px]">
          <h2 className="m-0 text-body font-semibold">{title}</h2>
          {action}
        </div>
      ) : action ? (
        <div data-testid="section-actions" className="flex h-9 items-center justify-end border-b border-line px-[10px]">
          {action}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/** One setting: a body-size label, at most a short one-line hint, and its control. */
export function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className={`flex items-center gap-[10px] border-b border-line-soft px-[14px] py-[6px] last:border-b-0 ${hint ? "min-h-12" : "min-h-11"}`}>
      <span className="flex min-w-0 grow flex-col gap-[2px]">
        <span className="text-body">{label}</span>
        {hint ? <span className="text-meta text-muted">{hint}</span> : null}
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
      className="h-control-sm w-[200px] shrink-0 rounded-control border border-line-input bg-transparent px-2 font-mono text-micro text-text transition-colors duration-ui ease-ui placeholder:text-muted hover:border-check-line focus:border-sealed"
    />
  );
}

/**
 * A Setup section's sections, whose rows rise in as one cascade when it opens (the screens'
 * motion, per row). Reduced motion lands them at once.
 */
export function Cascade({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const { run } = useMotion(ref);
  const done = useRef(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || done.current) return;
    done.current = true;
    // Every section's header and rows, top to bottom.
    const rows = Array.from(el.querySelectorAll(":scope > section > *"));
    if (!rows.length) return;
    run(() => gsap.timeline({ id: "setup-rows" }).fromTo(rows, RISE_FROM, { ...RISE_TO, stagger: RISE_STAGGER }));
  }, [run]);
  return (
    <div ref={ref} data-setup-cascade className="flex flex-col gap-4">
      {children}
    </div>
  );
}
