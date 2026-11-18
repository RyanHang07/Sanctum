import { useEffect, useRef, useState } from "react";
import { MOMENT_DIALOG } from "./dialogFrame";
import { createPortal } from "react-dom";
import { Button } from "./Button";
import { Odometer } from "./Odometer";
import { XIcon } from "./icons";
import { useStore } from "../state/store";
import { recapFigures, useRecap } from "../state/recap";
import { errorText, native } from "../lib/native";
import { RECAP, pick } from "../pages/headlines";
import { DUR, EASE, gsap, RISE_STAGGER } from "../lib/gsap";
import { useMotion } from "../lib/useMotion";
import type { Recap } from "../lib/types";

// The weekly recap (v0.3; a dialog since 2026-11-16). It opens the way the check-in does: a
// centered dialog over the scrim, so the week gets a moment of its own. One line of figures (focus
// against the week before, days kept), the week as a strip of bars (layout C, 2026-11-17), and
// one optional line to change; the rest is in
// Stats. Writing one change down still keeps the review (Di Stefano et al. 2014), and a Monday is
// a fresh start (Dai, Milkman & Riis 2014). Closing in any way marks the week seen.

/** Focusable controls inside the dialog, for the Tab wrap. */
const FOCUSABLE = "button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex='-1'])";

const LETTERS = ["M", "T", "W", "T", "F", "S", "S"];
const WEEKDAY = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString("en-US", { weekday: "long" });

/**
 * The week at a glance (layout C, 2026-11-17): a bar per day, its height that day's focus. Kept
 * days fill in the accent, other days in the quiet line color, rest days are a dashed slot. The
 * best day's letter is in the second color. The bars grow up in turn once the dialog is in.
 */
function WeekStrip({ days, best, label }: { days: NonNullable<Recap["daily"]>; best: string | null; label: string }) {
  const root = useRef<HTMLDivElement>(null);
  const { run } = useMotion(root);
  const max = Math.max(...days.map((d) => d.focusMin), 1);
  useEffect(() => {
    const bars = root.current?.querySelectorAll("[data-bar]");
    if (!bars?.length) return;
    run(() =>
      gsap
        .timeline({ id: "recap-strip" })
        .fromTo(bars, { scaleY: 0 }, { scaleY: 1, duration: DUR.state, ease: EASE.glide, stagger: RISE_STAGGER, delay: 0.24, clearProps: "transform" }),
    );
    // Once per recap: the days don't change while it's open.
  }, []);
  return (
    <div ref={root} role="img" aria-label={label} data-testid="recap-strip" className="grid min-h-[120px] flex-1 grid-cols-7 gap-2">
      {days.slice(0, 7).map((d, i) => {
        const rest = d.status === "rest";
        const isBest = d.date === best;
        return (
          <div key={d.date} data-status={d.status} data-best={isBest || undefined} className="flex min-h-0 flex-col items-center gap-[6px]">
            <div className={`relative w-full flex-1 overflow-hidden rounded-[4px] ${rest ? "border border-dashed border-line-input" : "bg-raised"}`}>
              {!rest && d.focusMin > 0 ? (
                <div
                  data-bar=""
                  className={`absolute inset-x-0 bottom-0 origin-bottom rounded-[4px] ${d.status === "kept" ? "bg-sealed" : "bg-check-line"}`}
                  style={{ height: `${Math.max(8, Math.round((d.focusMin / max) * 100))}%` }}
                />
              ) : null}
            </div>
            <span className={`text-meta ${isBest ? "font-medium text-second-text" : "text-muted"}`}>{LETTERS[i]}</span>
          </div>
        );
      })}
    </div>
  );
}

export function RecapNotice() {
  const { recap, close } = useRecap();
  const navigate = useStore((s) => s.navigate);
  const notice = useStore((s) => s.showNotice);
  const [change, setChange] = useState("");
  // Focus time rolls from the week before to last week once the dialog is up.
  const [rolled, setRolled] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);
  const busy = useRef(false);

  useEffect(() => {
    if (!recap) return;
    setChange("");
    setRolled(false);
    busy.current = false;
    const before = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLElement>("[data-recap-primary]")?.focus();
    const t = window.setTimeout(() => setRolled(true), 240);
    return () => {
      window.clearTimeout(t);
      if (before?.isConnected) before.focus();
    };
  }, [recap]);

  /** Keeps the one line, if written, then closes for the week. */
  const finish = async (then?: () => void) => {
    if (!recap || busy.current) return;
    busy.current = true;
    const line = change.trim();
    if (line) {
      try {
        const week = await native.reviewWeekTarget().then((t) => t.week, () => recap.week);
        const saved = await native.reviewSave(week, null, line);
        notice({ lead: "Kept.", rest: saved.inJournal ? "It's on today's journal page too." : "The journal is locked, so it's kept with the week." });
      } catch (e) {
        notice({ lead: errorText(e) });
      }
    }
    close();
    then?.();
  };

  useEffect(() => {
    if (!recap) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        void finish();
      } else if (e.key === "Tab" && dialog.current) {
        // Focus stays inside while it's open.
        const all = Array.from(dialog.current.querySelectorAll<HTMLElement>(FOCUSABLE));
        const first = all[0];
        const last = all[all.length - 1];
        if (!first || !last) return;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!recap) return null;
  const f = recapFigures(recap);
  const title = pick(RECAP, recap.week);
  const written = change.trim().length > 0;

  return createPortal(
    <div className="fixed inset-0 z-40 animate-fade-in bg-scrim">
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="recap-sub"
        aria-describedby="recap-figures"
        className={MOMENT_DIALOG}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 pb-3 pl-[18px] pr-4 pt-4">
          <div className="flex flex-col gap-1">
            <h1 id="recap-title" className="headline m-0 text-moment-compact">
              {title}
            </h1>
            <span id="recap-sub" className="text-meta text-muted">
              Last week
            </span>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={() => void finish()}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-control text-muted transition-colors duration-ui ease-ui hover:bg-raised hover:text-text"
          >
            <XIcon size={14} />
          </button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto overscroll-contain px-[18px] pb-4 pt-1">
          <div id="recap-figures" className="flex flex-wrap items-end gap-x-[10px] gap-y-1">
            <span role="group" aria-label="Focus time" className="flex items-end gap-2">
              <span className="font-mono text-[30px] font-medium leading-none tracking-[-0.03em] text-text">
                <Odometer text={rolled || !f.focus.previous ? f.focus.value : f.focus.previous} direction={f.focus.direction} />
              </span>
              <span className="pb-[2px] text-body leading-none text-muted">in focus</span>
              {f.focus.delta ? (
                <span title={f.focus.note} className="pb-[2px] font-mono text-body leading-none text-second-text">
                  {f.focus.delta}
                </span>
              ) : null}
            </span>
            <span aria-hidden="true" className="pb-[2px] text-body leading-none text-muted">
              ·
            </span>
            <span role="group" aria-label="Days kept" title={f.kept.note} className="pb-[2px] text-body leading-none text-muted">
              <span className="font-mono text-text">{f.kept.value}</span> days kept
              {/* Plain, not colored: in dark the broken red sat too close to the second color's "+3h". */}
              {recap.broken ? `, ${recap.broken} broken` : null}
            </span>
          </div>
          {recap.daily?.length ? (
            <WeekStrip
              days={recap.daily}
              best={recap.bestDay}
              label={`Focus each day.${recap.bestDay ? ` Best day: ${WEEKDAY(recap.bestDay)}.` : ""}`}
            />
          ) : f.aside ? (
            <span className="flex-1 text-meta text-muted">{f.aside}</span>
          ) : (
            <span className="flex-1" />
          )}
          <label className="flex flex-col gap-[6px]">
            <span className="label">One thing to change this week</span>
            <input
              value={change}
              maxLength={300}
              placeholder="Optional"
              onChange={(e) => setChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void finish();
                }
              }}
              className="h-control rounded-control border border-line-input bg-raised px-3 text-body text-text transition-colors duration-ui ease-ui placeholder:text-muted hover:border-check-line"
            />
          </label>
        </div>
        <div className="flex shrink-0 items-center gap-2 border-t border-line bg-panel-footer px-[18px] py-3">
          <Button variant="ghost" onClick={() => void finish()}>
            {written ? "Save" : "Close"}
          </Button>
          <Button data-recap-primary variant="primary" className="ml-auto px-[14px]" onClick={() => void finish(() => navigate("stats"))}>
            See the week
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
