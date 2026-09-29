/** 38:14. Minutes keep counting past 60 so a 120 min seal reads 119:59, not 1:59:59. */
export function countdown(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** 10:50 AM */
export function clock(t: number | Date): string {
  return new Date(t).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/** 58m, 2h, 2h 40m */
export function minutes(total: number): string {
  const m = Math.max(0, Math.round(total));
  const h = Math.floor(m / 60);
  if (!h) return `${m}m`;
  return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
}

/** Whole minutes elapsed, rounded down (for "18 minutes into Deep Work"). */
export const minutesIn = (ms: number) => Math.floor(Math.max(0, ms) / 60_000);

/** "Discord and Steam", "Discord, Steam, and Zoom" */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}
