import { useEffect, useState } from "react";
import { Button } from "./Button";
import { useStore } from "../state/store";
import { recapLines, useRecap } from "../state/recap";
import { errorText, native } from "../lib/native";
import { minutes } from "../lib/time";
import type { WeekTarget } from "../lib/types";

// The weekly recap card (v0.3): bottom right, once a week, until closed. v0.3.1 adds the review
// (decided 2026-10-30): two optional questions, kept with the week and added to today's journal
// page, and this week's focus target. Reflection improves what comes next (Di Stefano et al.
// 2014), and a Monday is a fresh start (Dai, Milkman & Riis 2014).

const FIELD =
  "w-full resize-none rounded-control border border-line-input bg-raised px-[10px] py-[6px] text-meta text-text outline-none placeholder:text-faint focus:border-sealed-line";

export function RecapNotice() {
  const { recap, close } = useRecap();
  const navigate = useStore((s) => s.navigate);
  const notice = useStore((s) => s.showNotice);
  const [worked, setWorked] = useState("");
  const [change, setChange] = useState("");
  const [target, setTarget] = useState<WeekTarget | null>(null);
  const [hours, setHours] = useState("");
  useEffect(() => {
    if (!recap) return;
    void native.reviewWeekTarget().then((t) => {
      setTarget(t);
      setHours(String(t.targetMin / 60));
    }, () => undefined);
  }, [recap]);
  if (!recap) return null;
  const { lead, lines } = recapLines(recap);

  /** Saves what was written and the target, then closes for the week. */
  const finish = async (then?: () => void) => {
    try {
      const h = Number(hours);
      if (target && Number.isFinite(h) && h > 0 && Math.round(h * 60) !== target.targetMin) await native.reviewSetWeekTarget(Math.round(h * 2) * 30);
      if (worked.trim() || change.trim()) {
        const saved = await native.reviewSave(target?.week ?? recap.week, worked.trim() || null, change.trim() || null);
        notice({ lead: "Kept.", rest: saved.inJournal ? "It's on today's journal page too." : "The journal is locked, so it's kept with the week." });
      }
    } catch (e) {
      notice({ lead: errorText(e) });
    }
    close();
    then?.();
  };

  return (
    <div role="region" aria-label="Last week" className="flex w-[340px] animate-rise-in flex-col gap-3 rounded-panel border border-line-input bg-toast p-[14px] shadow-toast">
      <div className="flex flex-col gap-1">
        <span className="text-body font-medium text-text">{lead}</span>
        {lines.map((l) => (
          <span key={l} className="text-meta text-text-2">
            {l}
          </span>
        ))}
      </div>
      <div className="flex flex-col gap-2 border-t border-line pt-3">
        <textarea rows={2} maxLength={2000} value={worked} onChange={(e) => setWorked(e.target.value)} placeholder="What worked?" aria-label="What worked?" className={FIELD} />
        <textarea rows={2} maxLength={2000} value={change} onChange={(e) => setChange(e.target.value)} placeholder="What will you change?" aria-label="What will you change?" className={FIELD} />
        <label className="flex items-center gap-2 text-meta text-text-2">
          This week's target
          <input
            type="number"
            min={0.5}
            max={80}
            step={0.5}
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            aria-label="This week's target, in hours"
            className="h-7 w-[64px] rounded-control border border-line-input bg-raised px-2 text-right font-mono text-meta text-text outline-none focus:border-sealed-line"
          />
          hours
          {target?.isDefault ? <span className="text-faint">· your recent average</span> : null}
        </label>
        {target && target.focusMin > 0 ? <span className="text-[11px] text-muted">So far this week: {minutes(target.focusMin)}</span> : null}
      </div>
      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={() => void finish()}>
          {worked.trim() || change.trim() ? "Save" : "Close"}
        </Button>
        <Button variant="primary" size="sm" onClick={() => void finish(() => navigate("stats"))}>
          See the week
        </Button>
      </div>
    </div>
  );
}
