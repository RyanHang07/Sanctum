import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonVariant = "primary" | "raised" | "ghost" | "tint" | "quiet";
export type ButtonSize = "sm" | "md" | "lg" | "cta";

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
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-[26px] px-2 text-meta",
  md: "h-control px-3 text-body",
  lg: "h-9 px-[14px] text-body",
  /** The Home focus button: the same height as the wheel boxes beside it (80px window + border). */
  cta: "h-[82px] px-6 text-[18px] tracking-[-0.01em]",
};

export const buttonClass = (variant: ButtonVariant = "raised", size: ButtonSize = "md", extra = "") =>
  `inline-flex shrink-0 items-center justify-center gap-2 rounded-control transition-[color,background-color,border-color,filter] duration-ui ease-ui disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]} ${SIZES[size]} ${extra}`;

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
    <span className={`font-mono text-[11px] font-medium ${onFill ? "opacity-70" : "text-faint"}`}>{children}</span>
  );
}
