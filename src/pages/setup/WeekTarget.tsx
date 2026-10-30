import { useEffect, useState } from "react";
import { Row } from "./parts";
import { Button } from "../../components/Button";
import { errorText, native } from "../../lib/native";
import { minutes } from "../../lib/time";
import { useStore } from "../../state/store";
import type { WeekTarget } from "../../lib/types";

// Setup › General › Goal and streak (v0.3.1): the week's focus target. Until you set one, it's
// your average over the last four weeks, rounded to the half hour.

export function WeekTargetRow() {
  const [t, setT] = useState<WeekTarget | null>(null);
  const [hours, setHours] = useState("");
  const notice = useStore((s) => s.showNotice);
  const load = () =>
    void native.reviewWeekTarget().then((v) => {
      setT(v);
      setHours(String(v.targetMin / 60));
    }, () => undefined);
  useEffect(load, []);
  if (!t) return null;
  const save = async (min: number | null) => {
    try {
      await native.reviewSetWeekTarget(min);
      load();
    } catch (e) {
      notice({ lead: errorText(e) });
      setHours(String(t.targetMin / 60));
    }
  };
  const commit = () => {
    const h = Number(hours);
    if (!Number.isFinite(h) || h <= 0) return setHours(String(t.targetMin / 60));
    const min = Math.round(h * 2) * 30;
    if (min !== t.targetMin || t.isDefault) void save(min);
  };
  return (
    <Row label="Week's focus target" hint={t.isDefault ? `Your recent average, ${minutes(t.targetMin)}. Home shows the week against it.` : "Home shows the week against it."}>
      {!t.isDefault ? (
        <Button variant="quiet" size="sm" onClick={() => void save(null)}>
          Use my average
        </Button>
      ) : null}
      <input
        type="number"
        min={0.5}
        max={80}
        step={0.5}
        value={hours}
        onChange={(e) => setHours(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && commit()}
        aria-label="Week's focus target, in hours"
        className="h-control w-[72px] rounded-control border border-line-input bg-raised px-2 text-right font-mono text-body text-text outline-none focus:border-sealed-line"
      />
      <span className="text-meta text-muted">hours</span>
    </Row>
  );
}
