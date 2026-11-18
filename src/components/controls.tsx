import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode, type RefObject } from "react";
import { ChevronIcon } from "./icons";
import { native } from "../lib/native";
import { DUR, EASE, gsap, useGSAP } from "../lib/gsap";
import { useMotion } from "../lib/useMotion";

/**
 * A hit area of at least 24x24 around a smaller control (WCAG 2.5.8), without changing what it
 * looks like: an invisible `before:` box centered on it. The control must not clip overflow.
 */
export const HIT = "relative before:absolute before:left-1/2 before:top-1/2 before:h-[max(100%,24px)] before:w-[max(100%,24px)] before:-translate-x-1/2 before:-translate-y-1/2 before:content-['']";

/** On/off switch from Setup.dc.html (32x18 track, white knob, cobalt when on), with a 24px-tall
 *  hit area (HIT). */
export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`${HIT} box-border flex h-[18px] w-8 shrink-0 rounded-full p-[2px] transition-colors duration-ui ease-ui ${
        checked ? "justify-end bg-sealed hover:brightness-110" : "justify-start bg-line-input hover:bg-check-line"
      }`}
    >
      <span className="h-[14px] w-[14px] rounded-full bg-sealed-on" />
    </button>
  );
}

/** The one checkbox box (M8): 16px, a check-line edge, the sealed fill when ticked. */
const CHECK_BOX = "box-border flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] p-0 text-sealed-on transition-colors duration-ui ease-ui";
const checkTone = (done: boolean, partial: boolean) =>
  done ? "border border-sealed bg-sealed" : partial ? "border border-sealed bg-sealed/25" : "border-[1.5px] border-check-line";

/** The tick draws itself (motion spec §10.1); a partly done routine shows a small square instead. */
function CheckGlyph({ done, partial }: { done: boolean; partial: boolean }) {
  if (partial && !done) return <span className="h-[6px] w-[6px] rounded-[2px] bg-sealed" />;
  return (
    <svg viewBox="0 0 12 12" fill="none" aria-hidden="true" className="h-[10px] w-[10px]">
      <path
        data-check={done ? "on" : "off"}
        d="M2.5 6.3l2.4 2.4L9.6 3.8"
        pathLength={1}
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={`[stroke-dasharray:1] transition-[stroke-dashoffset] duration-enter ease-ui ${done ? "[stroke-dashoffset:0]" : "[stroke-dashoffset:1]"}`}
      />
    </svg>
  );
}

/**
 * The box alone, for a control that is a checkbox as a whole (a chip, a "Don't ask again" row) or
 * a read-only mark. Hidden from assistive tech: the control around it carries the state.
 */
export function CheckMark({ done, partial = false, className = "" }: { done: boolean; partial?: boolean; className?: string }) {
  return (
    <span aria-hidden="true" data-check-box className={`${CHECK_BOX} ${checkTone(done, partial)} ${className}`}>
      <CheckGlyph done={done} partial={partial} />
    </span>
  );
}

/**
 * The app's one checkbox: a `role="checkbox"` button with the 16px box, the `check-pop` when
 * ticked, and a 24px hit area (HIT). `checked` is what assistive tech hears ("mixed" for a routine
 * part way through); `done` and `partial` are what it shows (by default, `checked === true`).
 */
export function Check({
  checked,
  done = checked === true,
  partial = false,
  label,
  onToggle,
  className = "",
  ...rest
}: {
  checked: boolean | "mixed";
  done?: boolean;
  partial?: boolean;
  label?: string;
  onToggle: () => void;
  className?: string;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick" | "role" | "type" | "className" | "aria-checked">) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={onToggle}
      className={`check-pop ${HIT} ${CHECK_BOX} ${checkTone(done, partial)} ${done ? "hover:brightness-110" : partial ? "hover:bg-sealed/35" : "hover:border-muted"} ${className}`}
      {...rest}
    >
      <CheckGlyph done={done} partial={partial} />
    </button>
  );
}

/**
 * A text field's box: the `line-input` border (3:1 in every theme), radius 6 like every control.
 * Keyboard focus comes from the one focus-ring rule in styles.css; never strip the outline.
 */
export const inputClass = (extra = "") =>
  `h-control rounded-control border border-line-input bg-transparent px-[10px] text-body text-text placeholder:text-muted transition-colors duration-ui ease-ui hover:border-check-line ${extra}`;

export interface SegmentOption<T extends string> {
  value: T;
  label: ReactNode;
  title?: string;
}

/** Ids that tie a segmented tab to its panel: `${base}-tab-${value}` and `${base}-panel-${value}`. */
export const tabId = (base: string, value: string) => `${base}-tab-${value}`;
export const panelId = (base: string, value: string) => `${base}-panel-${value}`;

/**
 * One highlight that slides between a row of options, the way the sidebar's indicator glides
 * between pages (motion spec §8). Each option carries `data-indicator-item={key}`; the
 * indicator is an absolutely positioned element at the root's top left (the root is
 * `relative`), moved to the active option's offset and size: x and width, and y and height for
 * a row that wraps. The first placement, a resize, and every move under reduced motion or a
 * hidden window land without a glide. `layoutKey` re-measures when the options change.
 */
export function useSlidingIndicator(
  root: RefObject<HTMLElement | null>,
  indicator: RefObject<HTMLElement | null>,
  active: string | null,
  layoutKey = "",
) {
  const placed = useRef(false);
  const { live } = useMotion(root);
  const place = useRef<(glide: boolean) => void>(() => undefined);
  place.current = (glide) => {
    const el = indicator.current;
    if (!el) return;
    const item = active === null ? null : root.current?.querySelector<HTMLElement>(`[data-indicator-item="${CSS.escape(active)}"]`);
    if (!item) {
      gsap.set(el, { autoAlpha: 0, overwrite: true });
      placed.current = false;
      return;
    }
    const to = { x: item.offsetLeft, y: item.offsetTop, width: item.offsetWidth, height: item.offsetHeight, autoAlpha: 1 };
    // One tween per change; a new one takes over mid-glide (overwrite).
    // Quick and front-loaded (2026-11-17): most of the way in the first frames, then it settles.
    if (glide && live && placed.current) gsap.to(el, { ...to, duration: DUR.enter, ease: EASE.snap, overwrite: true });
    else gsap.set(el, { ...to, overwrite: true });
    placed.current = true;
  };

  // Only a change of option glides; options arriving or changing re-measure in place.
  const last = useRef(active);
  useGSAP(
    () => {
      place.current(last.current !== active);
      last.current = active;
    },
    { scope: root, dependencies: [active, live, layoutKey] },
  );

  // Fonts loading, a window resize or a label change move the options: land there, no glide.
  useEffect(() => {
    const node = root.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    // Mid-glide, a layout change re-aims the glide instead of cutting it short (2026-11-17).
    const ro = new ResizeObserver(() => place.current(!!indicator.current && gsap.isTweening(indicator.current)));
    ro.observe(node);
    for (const child of Array.from(node.children)) ro.observe(child);
    return () => ro.disconnect();
  }, [root, layoutKey]);
}

/** A segmented control's outer height (26px options, 2px padding, 1px border), for a button set beside one. */
export const SEGMENTED_HEIGHT = "h-control";
/** A segmented option's padding and text, shared with a button set beside the control. Roomier since
 *  2026-11-17 so every filter reads as a sturdy control. */
export const SEGMENT_TEXT = "px-[12px] text-meta";

/**
 * Segmented control (design critique finding 10). One look, two meanings:
 * - with `panels` (an id base), it switches what a panel shows: a `tablist` of `tab`s, each
 *   `aria-controls` its `<TabPanel>`. Arrow keys, Home and End move and select (one tab stop).
 * - without, it is a filter or a mode: an `aria-pressed` button group.
 * The active option's background is one indicator that slides between options.
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
  const root = useRef<HTMLDivElement>(null);
  const indicator = useRef<HTMLSpanElement>(null);
  const has = options.some((o) => o.value === value);
  useSlidingIndicator(root, indicator, has ? value : null, options.map((o) => o.value).join("|"));
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
      ref={root}
      role={tabs ? "tablist" : "group"}
      aria-label={label}
      onKeyDown={onKey}
      className={`relative inline-flex shrink-0 gap-[2px] rounded-control border border-line-input p-[2px] ${className}`}
    >
      <span
        ref={indicator}
        aria-hidden="true"
        data-indicator=""
        className="pointer-events-none absolute left-0 top-0 rounded-control bg-raised opacity-0"
      />
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            title={o.title}
            data-indicator-item={o.value}
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
            className={`relative h-control-sm rounded-control ${SEGMENT_TEXT} transition-colors duration-ui ease-ui ${
              on ? "font-medium text-text" : "text-muted hover:bg-raised hover:text-text-2"
            }`}
          >
            {/* The width is the medium-weight label's (an invisible ::after copy), picked or not, so
                picking an option never resizes it: a resize re-measures the indicator in place and
                cut the glide short (2026-11-17). */}
            <span
              data-label={typeof o.label === "string" ? o.label : undefined}
              className="inline-flex flex-col after:invisible after:h-0 after:overflow-hidden after:font-medium after:content-[attr(data-label)]"
            >
              {o.label}
            </span>
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
        className="h-control-sm cursor-pointer appearance-none rounded-control border border-line-input bg-transparent pl-2 pr-6 text-meta text-text transition-colors duration-ui ease-ui hover:border-check-line hover:bg-raised"
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

/** Open dialogs, innermost last: Escape closes only the topmost. */
const dialogStack: object[] = [];
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

/**
 * A modal's keyboard: focus moves in on opening (a field's autoFocus wins, else the first
 * control), Tab wraps inside it, Escape closes only the topmost dialog, and focus goes back to
 * where it was on closing. If that control is gone (the dialog deleted what opened it), focus
 * goes to `fallback`, else to the page's main region, never to <body>.
 */
export function useDialogFocus(ref: RefObject<HTMLElement | null>, onClose: () => void, fallback?: () => HTMLElement | null) {
  const close = useRef(onClose);
  close.current = onClose;
  const backup = useRef(fallback);
  backup.current = fallback;
  useEffect(() => {
    const token = {};
    dialogStack.push(token);
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = ref.current;
    if (root && !root.contains(document.activeElement)) (root.querySelector<HTMLElement>(FOCUSABLE) ?? root).focus();
    const onKey = (e: KeyboardEvent) => {
      if (dialogStack[dialogStack.length - 1] !== token) return;
      if (e.key === "Escape") return close.current();
      if (e.key !== "Tab" || !root) return;
      const items = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)];
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (!first || !last) {
        e.preventDefault();
        root.focus();
      } else if (e.shiftKey && (active === first || !root.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !root.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      const i = dialogStack.indexOf(token);
      if (i >= 0) dialogStack.splice(i, 1);
      if (before && before !== document.body && before.isConnected) return before.focus();
      // Wait a frame: the page may still be rendering what replaces the gone control.
      const land = () => {
        if (document.activeElement && document.activeElement !== document.body) return;
        const target = backup.current?.() ?? mainRegion();
        target?.focus();
      };
      if (typeof requestAnimationFrame === "function") requestAnimationFrame(land);
      else land();
    };
  }, [ref]);
}

/** The page's main region, made focusable (not tabbable) so a closing dialog can land there. */
function mainRegion(): HTMLElement | null {
  const main = document.querySelector<HTMLElement>("main");
  if (main && !main.hasAttribute("tabindex")) main.tabIndex = -1;
  return main;
}

/** Centered dialog over a scrim (radius 12, shadow only on dialogs). */
export function Dialog({
  label,
  onClose,
  width = 420,
  top = 170,
  alert = false,
  fallback,
  children,
}: {
  label: string;
  onClose: () => void;
  width?: number;
  top?: number;
  /** A confirm that asks before something can't be undone: `alertdialog`. */
  alert?: boolean;
  /** Where focus lands on closing if the control that opened it is gone. */
  fallback?: () => HTMLElement | null;
  children: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  useDialogFocus(box, onClose, fallback);
  return (
    <div className="fixed inset-0 z-40 animate-fade-in bg-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={box}
        tabIndex={-1}
        role={alert ? "alertdialog" : "dialog"}
        aria-modal="true"
        aria-label={label}
        style={{ width, top }}
        className="absolute left-1/2 flex -translate-x-1/2 animate-rise-in flex-col overflow-hidden rounded-dialog border border-line-input bg-panel shadow-dialog outline-none"
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
