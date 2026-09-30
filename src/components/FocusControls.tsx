import { useEffect, useId, useRef, useState } from "react";
import { ChevronIcon } from "./icons";

// The Home focus row's controls (decided 2026-09-30): a sentence you fill in, "Seal [profile]
// for [length]", beside a large length dial. The dial is the row's presence; the sentence is
// the easy way to set it.

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
        className="flex h-11 min-w-0 max-w-full items-center gap-2 rounded-panel border border-line-input px-3 text-[20px] font-semibold tracking-[-0.02em] text-text transition-colors duration-ui ease-ui hover:border-check-line hover:bg-raised"
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
    <div className="flex h-11 shrink-0 items-stretch overflow-hidden rounded-panel border border-line-input">
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
        className="flex min-w-[92px] items-center justify-center gap-1 px-2 font-mono text-[20px] font-medium tracking-[-0.02em] text-text outline-none focus-visible:bg-raised"
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

const R = 46;
const C = 2 * Math.PI * R;

/**
 * The length as a ring: one quarter per option (30, 60, 90, 120). Click a quarter, or scroll
 * over it, to set the length; the sentence's stepper is the keyboard way in.
 */
export function LengthDial({ value, options, onChange, size = 116 }: { value: number; options: readonly number[]; onChange: (m: number) => void; size?: number }) {
  const n = options.length;
  const i = Math.max(0, options.indexOf(value));
  const gap = 0.012;
  const acc = useRef(0);
  const onWheel = (e: React.WheelEvent) => {
    acc.current += e.deltaY;
    if (Math.abs(acc.current) < 40) return;
    const d = acc.current < 0 ? 1 : -1;
    acc.current = 0;
    const next = options[Math.min(n - 1, Math.max(0, i + d))];
    if (next !== undefined && next !== value) onChange(next);
  };
  return (
    <div data-testid="length-dial" onWheel={onWheel} className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox="0 0 108 108" aria-hidden="true" className="-rotate-90">
        {options.map((m, k) => {
          const on = k <= i;
          const len = C * (1 / n - gap);
          return (
            <circle
              key={m}
              data-minutes={m}
              cx="54"
              cy="54"
              r={R}
              fill="none"
              strokeWidth="8"
              strokeLinecap="butt"
              strokeDasharray={`${len} ${C - len}`}
              strokeDashoffset={-C * (k / n + gap / 2)}
              onClick={() => onChange(m)}
              className={`cursor-pointer transition-[stroke] duration-enter ease-ui ${on ? "stroke-sealed hover:stroke-sealed-text" : "stroke-line hover:stroke-line-input"}`}
            />
          );
        })}
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-mono text-[28px] font-medium leading-none tracking-[-0.03em] text-text">{value}</span>
        <span className="mt-1 text-meta text-muted">min</span>
      </div>
    </div>
  );
}
