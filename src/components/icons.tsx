// Stroke icons from design/screens (Sidebar, Home). They inherit color via currentColor.
type P = { size?: number; className?: string };

export const TodayIcon = ({ size = 15 }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5" /><path d="M8.5 12.5l2.3 2.3 4.7-5" /></svg>
);
export const WeekIcon = ({ size = 15 }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="2.5" /><path d="M3.5 10h17M8 3v4M16 3v4" /></svg>
);
export const TrackersIcon = ({ size = 15 }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 17l5-5 4 3 7-8" /></svg>
);
export const StatsIcon = ({ size = 15 }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 20V11M12 20V5M19 20v-6" /></svg>
);
export const NotesIcon = ({ size = 15 }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 3.5h8.5L19 8v12.5H6z" /><path d="M14 3.5V8h5M9 12.5h6M9 16h4" /></svg>
);
/** A closed book with a ribbon: the journal (v0.2). */
export const JournalIcon = ({ size = 15 }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 4.5h11.5v15H6.8A1.8 1.8 0 0 1 5 17.7V6.3A1.8 1.8 0 0 1 6.8 4.5" /><path d="M5 17.5a2 2 0 0 1 2-2h10.5M10 4.5v6l1.8-1.3 1.7 1.3v-6" /></svg>
);
export const SetupIcon = ({ size = 15 }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h4M12 17h8" /><circle cx="16" cy="7" r="2" /><circle cx="10" cy="17" r="2" /></svg>
);
export const LockIcon = ({ size = 12, className }: P) => (
  <svg width={size} height={size} className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
);
export const SearchIcon = ({ size = 13, className }: P) => (
  <svg width={size} height={size} className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
);
export const ChevronIcon = ({ size = 12, className }: P) => (
  <svg width={size} height={size} className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
);
export const PlusIcon = ({ size = 14, className }: P) => (
  <svg width={size} height={size} className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
);
export const CheckIcon = ({ size = 10, weight = 4 }: P & { weight?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={weight} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12l5 5L20 7" /></svg>
);
export const GlobeIcon = ({ size = 14, className }: P) => (
  <svg width={size} height={size} className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.5 2.6 3.6 5.4 3.6 8.5s-1.1 5.9-3.6 8.5c-2.5-2.6-3.6-5.4-3.6-8.5s1.1-5.9 3.6-8.5z" /></svg>
);
export const TextIcon = ({ size = 14, className }: P) => (
  <svg width={size} height={size} className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M5 6h14M12 6v13M9 19h6" /></svg>
);
export const XIcon = ({ size = 12, className }: P) => (
  <svg width={size} height={size} className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
);
/** A window with an arrow out of its corner: open in a new window (note windows, 2026-11-20). */
export const PopOutIcon = ({ size = 13, className }: P) => (
  <svg width={size} height={size} className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M11 4.5H7A2.5 2.5 0 0 0 4.5 7v10A2.5 2.5 0 0 0 7 19.5h10a2.5 2.5 0 0 0 2.5-2.5v-4" /><path d="M14.5 4.5h5v5M19.5 4.5L12 12" /></svg>
);
export const ChevronRightIcon =({ size = 12, className }: P) => (
  <svg width={size} height={size} className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
);
/**
 * A fold button's icon (2026-11-17): the panel, plus a chevron that shows on hover or keyboard
 * focus of the parent `group` and points the way a click goes (right opens, left closes; rotate
 * the whole icon 180° for "close"). Without hover it's the plain panel.
 */
export const FoldIcon = ({ size = 14, className }: P) => (
  <svg width={size} height={size} className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
    <path d="M9.5 4.5v15" />
    <path
      data-fold-hint=""
      d="M13.5 9.5l2.5 2.5-2.5 2.5"
      className="-translate-x-[1.5px] opacity-0 transition-[opacity,transform] duration-enter ease-glide group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:translate-x-0 group-focus-visible:opacity-100 motion-reduce:transition-none"
    />
  </svg>
);
