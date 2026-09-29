import { useEffect, useState, type ReactNode } from "react";
import { ChevronIcon } from "./icons";
import { native } from "../lib/native";

/** On/off switch from Setup.dc.html (32x18 track, white knob, cobalt when on). */
export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`box-border flex h-[18px] w-8 shrink-0 rounded-full p-[2px] transition-colors duration-ui ease-ui ${
        checked ? "justify-end bg-sealed hover:brightness-110" : "justify-start bg-line-input hover:bg-check-line"
      }`}
    >
      <span className="h-[14px] w-[14px] rounded-full bg-sealed-on" />
    </button>
  );
}

/** Compact select used in Setup rows (26px, 12px text). */
export function MiniSelect<T extends string | number>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <label className="relative flex items-center">
      <select
        aria-label={label}
        value={String(value)}
        onChange={(e) => {
          const hit = options.find((o) => String(o.value) === e.target.value);
          if (hit) onChange(hit.value);
        }}
        className="h-[26px] cursor-pointer appearance-none rounded-control border border-line-input bg-transparent pl-2 pr-6 text-meta text-text outline-none transition-colors duration-ui ease-ui hover:border-check-line hover:bg-raised focus-visible:border-sealed"
      >
        {options.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronIcon size={10} className="pointer-events-none absolute right-2 text-muted" />
    </label>
  );
}

/** Centered dialog over a scrim (radius 12, shadow only on dialogs). */
export function Dialog({
  label,
  onClose,
  width = 420,
  top = 170,
  children,
}: {
  label: string;
  onClose: () => void;
  width?: number;
  top?: number;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-40 animate-fade-in bg-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        style={{ width, top }}
        className="absolute left-1/2 flex -translate-x-1/2 animate-rise-in flex-col overflow-hidden rounded-dialog border border-line-input bg-panel shadow-dialog"
      >
        {children}
      </div>
    </div>
  );
}

const iconCache = new Map<string, Promise<string | null>>();

/** App icon from the exe or shortcut, fetched once per path. Falls back to a lettered tile. */
export function AppIcon({ path, label, size = 16 }: { path: string | null | undefined; label?: string; size?: number }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    setSrc(null);
    if (!path) return;
    let live = true;
    let p = iconCache.get(path);
    if (!p) {
      p = native.appIcon(path).catch(() => null);
      iconCache.set(path, p);
    }
    void p.then((s) => live && setSrc(s));
    return () => {
      live = false;
    };
  }, [path]);
  if (src) return <img src={src} width={size} height={size} alt="" aria-hidden="true" className="shrink-0" draggable={false} />;
  return (
    <span
      aria-hidden="true"
      data-testid="app-icon-fallback"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.6) }}
      className="flex shrink-0 items-center justify-center rounded-[4px] border border-line-input bg-raised font-semibold leading-none text-muted"
    >
      {label?.trim()[0]?.toUpperCase() ?? ""}
    </span>
  );
}
