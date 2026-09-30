import { useEffect, useId, useRef, useState } from "react";
import { ChevronIcon } from "./icons";

// The Home focus card's controls (decided 2026-09-30): a sentence you fill in, "Seal [profile]
// for [length]", sized to own the top of the screen.

export interface ProfileChoice {
  id: number;
  name: string;
  /** "Opens VS Code, LeetCode". */
  note: string;
}

/** The profile in the sentence: a large button that opens a list with what each one opens. */
export function ProfileMenu({ value, options, onChange }: { value: number | null; options: ProfileChoice[]; onChange: (id: number) => void }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const id = useId();
  const current = options.find((o) => o.id === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    setActive(Math.max(0, options.findIndex((o) => o.id === value)));
    list.current?.focus();
    const away = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open, options, value]);

  const pick = (o: ProfileChoice | undefined) => {
    if (!o) return;
    onChange(o.id);
    setOpen(false);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") setActive((a) => Math.min(options.length - 1, a + 1));
    else if (e.key === "ArrowUp") setActive((a) => Math.max(0, a - 1));
    else if (e.key === "Enter" || e.key === " ") pick(options[active]);
    else if (e.key === "Escape") setOpen(false);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div ref={box} className="relative min-w-0">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={id}
        aria-label={`Profile: ${current?.name ?? "none"}`}
        onClick={() => setOpen(!open)}
        className="flex h-12 min-w-0 max-w-full items-center gap-2 rounded-panel border border-line-input px-4 text-[22px] font-semibold tracking-[-0.02em] text-text transition-colors duration-ui ease-ui hover:border-check-line hover:bg-raised"
      >
        <span className="truncate">{current?.name ?? "No profile"}</span>
        <ChevronIcon size={13} className={`shrink-0 text-muted transition-transform duration-ui ease-ui ${open ? "rotate-180" : ""}`} />
      </button>
      {open ? (
        <ul
          ref={list}
          id={id}
          role="listbox"
          aria-label="Profile"
          tabIndex={-1}
          aria-activedescendant={`${id}-${active}`}
          onKeyDown={onKey}
          className="page-in absolute left-0 top-[calc(100%+6px)] z-30 m-0 flex w-[300px] list-none flex-col rounded-panel border border-line-input bg-panel p-1 shadow-dialog outline-none"
        >
          {options.map((o, i) => (
            <li
              key={o.id}
              id={`${id}-${i}`}
              role="option"
              aria-selected={o.id === current?.id}
              onMouseMove={() => setActive(i)}
              onClick={() => pick(o)}
              className={`flex cursor-pointer flex-col gap-[2px] rounded-control px-3 py-2 ${i === active ? "bg-raised" : ""}`}
            >
              <span className={`text-body ${o.id === current?.id ? "font-semibold text-text" : "text-text"}`}>{o.name}</span>
              <span className="truncate text-meta text-muted">{o.note}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** The length in the sentence: − 60 min +. Also a spinbutton for the arrow keys. */
export function LengthStepper({ value, options, onChange }: { value: number; options: readonly number[]; onChange: (m: number) => void }) {
  const i = Math.max(0, options.indexOf(value));
  const step = (d: number) => {
    const next = options[Math.min(options.length - 1, Math.max(0, i + d))];
    if (next !== undefined && next !== value) onChange(next);
  };
  const side = "flex h-full w-9 items-center justify-center text-[18px] text-muted transition-colors duration-ui ease-ui enabled:hover:bg-raised enabled:hover:text-text disabled:opacity-40";
  return (
    <div className="flex h-12 shrink-0 items-stretch overflow-hidden rounded-panel border border-line-input">
      <button type="button" aria-label="Shorter" disabled={i === 0} onClick={() => step(-1)} className={side}>
        −
      </button>
      <span
        role="spinbutton"
        tabIndex={0}
        aria-label="Length"
        aria-valuemin={options[0]}
        aria-valuemax={options[options.length - 1]}
        aria-valuenow={value}
        aria-valuetext={`${value} min`}
        onKeyDown={(e) => {
          if (e.key === "ArrowUp" || e.key === "ArrowRight") step(1);
          else if (e.key === "ArrowDown" || e.key === "ArrowLeft") step(-1);
          else return;
          e.preventDefault();
        }}
        className="flex min-w-[100px] items-center justify-center gap-1 px-2 font-mono text-[24px] font-medium tracking-[-0.02em] text-text outline-none focus-visible:bg-raised"
      >
        {value}
        <span className="text-[13px] text-muted">min</span>
      </span>
      <button type="button" aria-label="Longer" disabled={i === options.length - 1} onClick={() => step(1)} className={side}>
        +
      </button>
    </div>
  );
}
