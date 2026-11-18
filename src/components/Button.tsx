import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonVariant = "primary" | "raised" | "ghost" | "tint" | "quiet" | "danger";
export type ButtonSize = "sm" | "md" | "lg" | "cta" | "cell";

// Hover, press, and disabled states for every button in the app (BACKLOG: hover polish, M2).
// Hover only lifts one step on the neutral scale; color still only ever means a state.
const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-sealed text-sealed-on font-semibold enabled:hover:brightness-110 enabled:active:brightness-95",
  raised:
    "border border-line-input bg-raised text-text enabled:hover:border-check-line enabled:hover:bg-line enabled:active:bg-raised",
  ghost:
    "border border-line-input bg-transparent text-text-2 enabled:hover:border-check-line enabled:hover:bg-raised enabled:hover:text-text enabled:active:bg-transparent",
  tint: "border border-sealed-line bg-sealed-tint text-text enabled:hover:border-sealed enabled:active:bg-sealed-tint",
  quiet: "bg-transparent text-muted enabled:hover:bg-raised enabled:hover:text-text",
  /** A step that can't be undone (delete data, delete the account): the broken role, never the accent. */
  danger: "border border-broken-line bg-broken-tint font-medium text-broken-text enabled:hover:border-broken",
};

// Two control heights (tokens): `control` 32 for fields and buttons, `control-sm` 26 for the compact
// ones in settings rows and toolbars. `lg` stays for the moment dialogs' footers; the 52px `cta`
// row is Today's shared row (pickers, Enter focus, the sealed and event cells).
export const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: "h-control-sm px-2 text-meta",
  md: "h-control px-3 text-body",
  lg: "h-9 px-[14px] text-body",
  /** Enter focus on Today: as tall as the pickers beside it. */
  cta: "h-cta px-4 text-[17px] font-semibold",
  /** A secondary box in Today's 52px row (End early, Compact, Queue focus): the cta's height, body text. */
  cell: "h-cta px-3 text-body font-medium",
};

export const buttonClass = (variant: ButtonVariant = "raised", size: ButtonSize = "md", extra = "") =>
  `inline-flex shrink-0 items-center justify-center gap-2 rounded-control transition-[color,background-color,border-color,filter] duration-ui ease-ui disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]} ${BUTTON_SIZES[size]} ${extra}`;

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export function Button({ variant = "raised", size = "md", className = "", type = "button", ...rest }: ButtonProps) {
  return <button type={type} className={buttonClass(variant, size, className)} {...rest} />;
}

/** Monospace shortcut hint inside a button ("Ctrl ↵"). */
export function Kbd({ children, onFill = false }: { children: ReactNode; onFill?: boolean }) {
  return (
    <span className={`font-mono text-micro font-medium ${onFill ? "" : "text-muted"}`}>{children}</span>
  );
}
