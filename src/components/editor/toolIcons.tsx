// The note toolbar's icons (Notes.dc.html / Journal.dc.html): 14px line icons on a 16px grid,
// 1.4 stroke in the current color, so a tool's hover and pressed colors carry through.
// Formats that read best as letters (B, I, S, H1, H2, 1.) stay letters, as on the artboard.

const PATHS = {
  bullets: "M6.5 4h7 M6.5 8h7 M6.5 12h7 M2.8 4h.4 M2.8 8h.4 M2.8 12h.4",
  checklist: "M2.5 2.8h3.7v3.7h-3.7Z M3.4 4.7l.9.9l1.3-1.6 M8.5 4.6h5 M2.5 9.5h3.7v3.7h-3.7Z M8.5 11.4h5",
  table: "M2.5 3h11v10h-11Z M2.5 6.5h11 M6.2 6.5v6.5 M9.8 6.5v6.5",
  callout: "M2.5 3h11v7.5h-6.5l-3 2.5v-2.5h-1.5Z M8 5v2.6 M8 9.1v.1",
  rowAbove: "M2.5 7.5h11v6h-11Z M2.5 10.5h11 M8 1.5v4 M6 3.5h4",
  rowBelow: "M2.5 2.5h11v6h-11Z M2.5 5.5h11 M8 10.5v4 M6 12.5h4",
  rowDelete: "M1.5 5.5h8v5h-8Z M11.5 6.5l3 3 M14.5 6.5l-3 3",
  colBefore: "M7.5 2.5h6v11h-6Z M10.5 2.5v11 M1.5 8h4 M3.5 6v4",
  colAfter: "M2.5 2.5h6v11h-6Z M5.5 2.5v11 M10.5 8h4 M12.5 6v4",
  colDelete: "M5.5 1.5h5v8h-5Z M6.5 11.5l3 3 M9.5 11.5l-3 3",
  trash: "M2.5 4.5h11 M6.2 4.5V2.8h3.6v1.7 M4 4.5l.7 8.7h6.6l.7-8.7 M6.8 7v4 M9.2 7v4",
} as const;

export type ToolIconName = keyof typeof PATHS | "image";

export function ToolIcon({ name, size = 14 }: { name: ToolIconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" data-icon={name}>
      {name === "image" ? (
        <>
          <circle cx="6" cy="6.2" r="1.1" />
          <path d="M2.5 3h11v10h-11Z M2.5 11l3.5-3.5l3 3l2-2l2.5 2.5" />
        </>
      ) : (
        <path d={PATHS[name]} />
      )}
    </svg>
  );
}
