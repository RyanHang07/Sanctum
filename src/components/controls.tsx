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

/**
 * A text field's box: the `line-input` border (3:1 in every theme), radius 6 like every control.
 * Keyboard focus comes from the one focus-ring rule in styles.css; never strip the outline.
 */
export const inputClass = (extra = "") =>
  `h-control rounded-control border border-line-input bg-transparent px-[10px] text-body text-text placeholder:text-faint transition-colors duration-ui ease-ui hover:border-check-line ${extra}`;

export interface SegmentOption<T extends string> {
  value: T;
  label: ReactNode;
  title?: string;
}

/** Ids that tie a segmented tab to its panel: `${base}-tab-${value}` and `${base}-panel-${value}`. */
export const tabId = (base: string, value: string) => `${base}-tab-${value}`;
export const panelId = (base: string, value: string) => `${base}-panel-${value}`;

/**
 * Segmented control (design critique finding 10). One look, two meanings:
 * - with `panels` (an id base), it switches what a panel shows: a `tablist` of `tab`s, each
 *   `aria-controls` its `<TabPanel>`. Arrow keys, Home and End move and select (one tab stop).
 * - without, it is a filter or a mode: an `aria-pressed` button group.
 */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  panels,
  className = "",
}: {
  label: string;
  options: readonly SegmentOption<T>[];
  value: T;
  onChange: (v: T) => void;
  panels?: string;
  className?: string;
}) {
  const tabs = panels !== undefined;
  const onKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!tabs) return;
    const i = options.findIndex((o) => o.value === value);
    const last = options.length - 1;
    const next =
      e.key === "ArrowRight" ? (i >= last ? 0 : i + 1) : e.key === "ArrowLeft" ? (i <= 0 ? last : i - 1) : e.key === "Home" ? 0 : e.key === "End" ? last : -1;
    if (next < 0) return;
    e.preventDefault();
    const v = options[next]!.value;
    onChange(v);
    e.currentTarget.querySelector<HTMLElement>(`#${CSS.escape(tabId(panels, v))}`)?.focus();
  };
  return (
    <div
      role={tabs ? "tablist" : "group"}
      aria-label={label}
      onKeyDown={onKey}
      className={`inline-flex shrink-0 gap-[2px] rounded-control border border-line-input p-[2px] ${className}`}
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            title={o.title}
            onClick={() => onChange(o.value)}
            {...(tabs
              ? {
                  role: "tab",
                  id: tabId(panels, o.value),
                  "aria-selected": on,
                  "aria-controls": panelId(panels, o.value),
                  tabIndex: on ? 0 : -1,
                }
              : { "aria-pressed": on })}
            className={`h-[24px] rounded-control px-[10px] text-meta transition-colors duration-ui ease-ui ${
              on ? "bg-raised font-medium text-text" : "text-muted hover:bg-line-soft hover:text-text-2"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** The panel a `Segmented` tab controls. Render only the selected one. */
export function TabPanel({ base, value, className = "", children }: { base: string; value: string; className?: string; children: ReactNode }) {
  return (
    <div role="tabpanel" id={panelId(base, value)} aria-labelledby={tabId(base, value)} tabIndex={0} className={className}>
      {children}
    </div>
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
        className="h-[26px] cursor-pointer appearance-none rounded-control border border-line-input bg-transparent pl-2 pr-6 text-meta text-text transition-colors duration-ui ease-ui hover:border-check-line hover:bg-raised"
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
    <div className="fixed inset-0 z-40 animate-fade-in bg-scrim backdrop-blur-[3px]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
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
