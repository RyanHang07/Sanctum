import { useId } from "react";
import { MARK_PATHS } from "./AnimatedMark";

/** How much the erode takes off each edge, in mark units (a 3.2-wide leg draws about 2.56 wide). */
export const THIN = 0.32;

/**
 * The arches (2026-11-16): the whole mark, large and faint behind every screen. It never moves;
 * screens leave and arrive over it, so between two screens there is a beat where only the arches
 * show. Geometry is MARK_PATHS (design/logo/), never redrawn, and never stretched: the viewBox is
 * cropped to the mark's own extent, the box keeps that ratio and `meet` scales it uniformly.
 *
 * Size and place (2026-11-16): anchored to the bottom and run past it, so the legs carry on below
 * the content area's bottom edge at any window size and their ends are never seen. 106% of its
 * height, its bottom 9% below the edge, so the top bend and its supporting beams sit high on Home
 * (about 3% down). Its centre at 77% across, so it stands well to the right and the right edge
 * crops the end of the beam. Color: the torii in the text token and the keyhole in the
 * accent (the sealed role), both faint enough to read as a watermark on dark and light themes
 * and stay well under any line or panel border.
 *
 * Line weight: every part is drawn a tad thinner than the mark by an erode filter (THIN, in the
 * mark's 26-unit space, off each edge), which shrinks all parts by the same amount and keeps their
 * positions, so the proportions and the paths stay the logo's.
 */
export function Arches() {
  const p = MARK_PATHS;
  const thin = `arches-thin-${useId().replace(/[^\w-]/g, "")}`;
  return (
    // The frame clips the arches to the content area, so they never reach under the sidebar.
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <svg
        data-arches=""
        aria-hidden="true"
        focusable="false"
        // Cropped to the mark's own extent (x 1.2 to 24.8, y 3.3 to 24), so the size and position above are the mark's.
        viewBox="1.2 3.3 23.6 20.7"
        preserveAspectRatio="xMidYMid meet"
        className="pointer-events-none absolute bottom-[-9%] left-[77%] h-[106%] w-auto max-w-none -translate-x-1/2 select-none [aspect-ratio:23.6/20.7]"
      >
        <defs>
          <filter id={thin} x="-5%" y="-5%" width="110%" height="110%">
            <feMorphology operator="erode" radius={THIN} />
          </filter>
        </defs>
        <g data-arches-torii="" filter={`url(#${thin})`} className="text-text opacity-[0.05]">
          <path d={p.beam} fill="currentColor" />
          <rect {...p.nuki} fill="currentColor" />
          <rect {...p.legLeft} fill="currentColor" />
          <rect {...p.legRight} fill="currentColor" />
        </g>
        <g data-arches-key="" filter={`url(#${thin})`} className="text-sealed opacity-[0.08]">
          <circle {...p.keyCircle} fill="currentColor" />
          <path d={p.keyStem} fill="currentColor" />
        </g>
      </svg>
    </div>
  );
}
