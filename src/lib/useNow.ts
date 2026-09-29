import { useEffect, useState } from "react";

/** The current time, refreshed every `ms` (for "18m left" and "Synced 3 min ago"). */
export function useNow(ms = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}
