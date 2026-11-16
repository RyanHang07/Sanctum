import { useEffect, useId, useRef, useState } from "react";
import { CheckIcon, ChevronIcon } from "../components/icons";

// The Profile and Length pickers on Today (ProtoToday): a 52px trigger that opens a short list.
// Keyboard: Up or Down on the trigger opens the list on the current choice; in the list the arrows,
// Home and End move, a letter jumps to the next option starting with it, Enter or Space picks,
// Escape closes and returns to the trigger, and Tab closes.

export interface PickerOption<T> {
  value: T;
  label: string;
}

export function FocusPicker<T extends string | number>({
  label,
  options,
  value,
  onChange,
  mono = false,
  className = "",
}: {
  label: string;
  options: readonly PickerOption<T>[];
  value: T | null;
  onChange: (v: T) => void;
  mono?: boolean;
  className?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const want = useRef<number | null>(null);
  const selected = Math.max(0, options.findIndex((o) => o.value === value));
  const current = options.find((o) => o.value === value);

  const option = (i: number) => root.current?.querySelector<HTMLElement>(`[data-opt="${i}"]`) ?? null;
  const show = (at: number) => {
    want.current = at;
    setOpen(true);
  };
  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  };

  // Focus the asked-for option once the list is on screen.
  useEffect(() => {
    if (!open || want.current === null) return;
    option(want.current)?.focus();
    want.current = null;
  });

  // A click anywhere else closes it.
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", away);
    return () => window.removeEventListener("mousedown", away);
  }, [open]);

  const pick = (v: T) => {
    onChange(v);
    close(true);
  };

  const onTriggerKey = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    show(selected);
  };

  const onListKey = (e: React.KeyboardEvent) => {
    const n = options.length;
    const at = Number((e.target as HTMLElement).getAttribute("data-opt") ?? selected);
    const go = (i: number) => {
      e.preventDefault();
      option(((i % n) + n) % n)?.focus();
    };
    if (e.key === "ArrowDown") go(at + 1);
    else if (e.key === "ArrowUp") go(at - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(n - 1);
    else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    } else if (e.key === "Tab") setOpen(false);
    else if (e.key.length === 1 && /\S/.test(e.key)) {
      // Type-ahead: the next option starting with this letter.
      const k = e.key.toLowerCase();
      for (let s = 1; s <= n; s++) {
        const i = (at + s) % n;
        if (options[i]!.label.toLowerCase().startsWith(k)) return go(i);
      }
    }
    // Enter and Space press the focused option, which picks it.
  };

  return (
    <div ref={root} className={`relative flex flex-col gap-[7px] ${className}`}>
      <span id={`${id}-label`} className="label">
        {label}
      </span>
      <button
        ref={trigger}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby={`${id}-label ${id}-value`}
        onClick={() => (open ? close(false) : show(selected))}
        onKeyDown={onTriggerKey}
        className={`flex h-[52px] w-full items-center gap-2 rounded-control border bg-raised px-[14px] text-[15px] text-text transition-colors duration-ui ease-ui hover:border-check-line ${
          open ? "border-muted" : "border-line-input"
        } ${mono ? "font-mono font-medium" : "font-semibold"}`}
      >
        <span id={`${id}-value`} className="min-w-0 grow truncate text-center">
          {current?.label ?? "None"}
        </span>
        <ChevronIcon size={10} className={`shrink-0 text-muted transition-transform duration-ui ease-ui ${open ? "rotate-180" : ""}`} />
      </button>
      {open ? (
        <div
          role="listbox"
          aria-label={label}
          onKeyDown={onListKey}
          className="absolute inset-x-0 top-[calc(100%+6px)] z-30 flex max-h-[320px] animate-fade-in flex-col gap-[2px] overflow-y-auto rounded-panel border border-line-input bg-panel p-1 shadow-toast"
        >
          {options.map((o, i) => {
            const sel = o.value === value;
            return (
              <button
                key={String(o.value)}
                type="button"
                role="option"
                data-opt={i}
                aria-selected={sel}
                tabIndex={-1}
                onClick={() => pick(o.value)}
                className={`flex h-[34px] w-full shrink-0 items-center gap-[10px] rounded-control px-[10px] text-left text-body transition-colors duration-ui ease-ui hover:bg-line-soft ${
                  sel ? "bg-raised font-semibold text-text" : "text-text-2"
                } ${mono ? "font-mono" : ""}`}
              >
                <span className="min-w-0 grow truncate">{o.label}</span>
                <span className={`shrink-0 text-sealed ${sel ? "" : "invisible"}`}>
                  <CheckIcon />
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
