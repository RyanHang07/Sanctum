/**
 * The frame the daily check-in and the weekly recap share (decided 2026-11-17): the same width,
 * the same place and the same least height, so the two moments read as one kind of thing. A short
 * check-in sits at that height like the recap; a long one grows past it until the window caps it
 * and its questions scroll.
 */
export const MOMENT_DIALOG =
  "absolute left-1/2 top-14 flex min-h-[480px] max-h-[calc(100%-112px)] w-[480px] max-w-[calc(100%-32px)] -translate-x-1/2 animate-rise-in flex-col overflow-hidden rounded-dialog border border-line-input bg-panel shadow-dialog";
