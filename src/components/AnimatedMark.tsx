/**
 * The torii keyhole with per-part classes so it can be animated (LogoMotion.dc.html).
 * Path data is copied verbatim from design/logo/sanctum-mark-mono-white.svg; a test keeps
 * them identical, so the mark is never redrawn. Colors come from currentColor.
 */
export const MARK_PATHS = {
  beam: "M1.2 5.2Q13 3.3 24.8 5.2L24.4 8.6Q13 6.8 1.6 8.6Z",
  nuki: { x: 4.4, y: 10.8, width: 17.2, height: 2.4 },
  legLeft: { x: 6, y: 7.4, width: 3.2, height: 16.6 },
  legRight: { x: 16.8, y: 7.4, width: 3.2, height: 16.6 },
  keyCircle: { cx: 13, cy: 16.8, r: 2.6 },
  keyStem: "M12 17.97L11.1 24H14.9L14 17.97Z",
} as const;

/**
 * "build": the pieces assemble (boot splash, held page). "breathe": only the keyhole pulses,
 * the sealed idle loop (sidebar). `keyClass` colors the keyhole, e.g. cobalt on the dark mark.
 */
export function AnimatedMark({
  size = 96,
  rings = false,
  label = "Sanctum",
  mode = "build",
  keyClass = "",
}: {
  size?: number;
  rings?: boolean;
  label?: string;
  mode?: "build" | "breathe";
  keyClass?: string;
}) {
  const p = MARK_PATHS;
  const build = mode === "build";
  return (
    <svg width={size} height={size} viewBox="0 0 26 26" fill="none" role="img" aria-label={label} className="shrink-0 overflow-visible">
      <path className={build ? "held-beam" : undefined} d={p.beam} fill="currentColor" />
      <rect className={build ? "held-nuki" : undefined} {...p.nuki} fill="currentColor" />
      <rect className={build ? "held-leg" : undefined} {...p.legLeft} fill="currentColor" />
      <rect className={build ? "held-leg held-leg-2" : undefined} {...p.legRight} fill="currentColor" />
      {rings ? (
        <>
          <circle className="held-ring" cx={p.keyCircle.cx} cy={p.keyCircle.cy} r={3} stroke="currentColor" strokeWidth={0.5} />
          <circle className="held-ring held-ring-2" cx={p.keyCircle.cx} cy={p.keyCircle.cy} r={3} stroke="currentColor" strokeWidth={0.5} />
        </>
      ) : null}
      <g className={`${build ? "held-key" : "mark-breathe"} ${keyClass}`}>
        <circle {...p.keyCircle} fill="currentColor" />
        <path d={p.keyStem} fill="currentColor" />
      </g>
    </svg>
  );
}
