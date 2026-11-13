import { MARK_PATHS } from "./AnimatedMark";

/**
 * The torii keyhole mark, theme-aware: torii follows the current text color and the keyhole
 * follows the theme accent (`sealed`) so it updates when themes change.
 */
export function Mark({ size = 18, className = "" }: { size?: number; className?: string }) {
  const p = MARK_PATHS;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 26 26"
      fill="none"
      aria-hidden="true"
      className={`shrink-0 ${className}`}
    >
      <path d={p.beam} fill="currentColor" />
      <rect {...p.nuki} fill="currentColor" />
      <rect {...p.legLeft} fill="currentColor" />
      <rect {...p.legRight} fill="currentColor" />
      <g className="text-sealed">
        <circle {...p.keyCircle} fill="currentColor" />
        <path d={p.keyStem} fill="currentColor" />
      </g>
    </svg>
  );
}
