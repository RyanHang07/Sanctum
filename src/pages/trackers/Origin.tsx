import { usePlanner } from "../../state/planner";
import { useTrackers } from "../../state/trackers";

// Where a tracker's entries come from (2026-11-24): a counter routine on Today, or tracked
// (a check-in, or logged by hand). Shown wherever trackers are listed, so a routine's tracker
// reads apart from the rest.

export interface TrackerOrigin {
  /** Counter routines counting into it. */
  routines: string[];
  /** Check-ins that ask for it. */
  checkins: string[];
}

export function useTrackerOrigin(trackerId: number): TrackerOrigin {
  const routines = usePlanner((s) => s.routines.filter((r) => r.trackerId === trackerId).map((r) => r.title).join("\n"));
  const checkins = useTrackers((s) => s.checkins.filter((c) => c.trackerIds.includes(trackerId)).map((c) => c.name).join("\n"));
  return { routines: routines ? routines.split("\n") : [], checkins: checkins ? checkins.split("\n") : [] };
}

/** "Protein", "Protein and Water", "3 routines". */
const names = (list: string[], one: string) => (list.length <= 2 ? list.join(" and ") : `${list.length} ${one}s`);

/**
 * One plain word on a raised surface (2026-11-24): "Routine" when a counter routine counts into
 * it, "Tracked" otherwise. The sources' names are in its title.
 */
export function OriginLabel({ trackerId, className = "" }: { trackerId: number; className?: string }) {
  const o = useTrackerOrigin(trackerId);
  const routine = o.routines.length > 0;
  const title = routine
    ? `Counted on Today by ${names(o.routines, "routine")}`
    : o.checkins.length
      ? `Asked for by ${names(o.checkins, "check-in")}`
      : "Logged by hand";
  return (
    <span
      data-testid="tracker-origin"
      data-origin={routine ? "routine" : "tracked"}
      title={title}
      // Text, not text-2: small text-2 on raised falls under 4.5:1 in six light themes (themes.test.ts).
      // The raised surface, with the tables' divider as its edge (2026-11-24).
      className={`flex h-[22px] shrink-0 items-center rounded-[5px] border border-line bg-raised px-[9px] text-meta text-text ${className}`}
    >
      {routine ? "Routine" : "Tracked"}
    </span>
  );
}
