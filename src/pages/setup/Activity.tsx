import { useEffect, useState } from "react";
import { AWAY_MINUTES } from "./options";
import { MiniSelect } from "../../components/controls";
import { AppListField, Row, Section } from "./parts";
import { ActivityRulesSection } from "./ActivityRules";
import { CATEGORY } from "../stats/parts";
import { startOfToday, useStore } from "../../state/store";
import { native } from "../../lib/native";
import { minutes } from "../../lib/time";
import type { ActivitySummary } from "../../lib/types";

export { ActivityRulesSection, ruleKindOf } from "./ActivityRules";

// Setup > Activity (SPEC 4.7, 4.8; redesigned 2026-11-16): today's totals, how apps and sites
// count, and the counting settings in plain words. Everything stays on this PC.

const IDLE: { value: number; label: string }[] = AWAY_MINUTES.map((m) => ({ value: m, label: `${m} min` }));
const RETENTION: { value: number; label: string }[] = [7, 30, 90].map((d) => ({ value: d, label: `${d} days` }));

function Figure({ value, label, dot }: { value: number; label: string; dot: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="font-mono text-[18px] leading-none tracking-[-0.01em] text-text">{minutes(value)}</span>
      <span className="flex items-center gap-[6px] text-meta text-muted">
        <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />
        {label}
      </span>
    </div>
  );
}

export function ActivityTodaySection() {
  const [s, setS] = useState<ActivitySummary | null>(null);
  useEffect(() => {
    let live = true;
    const load = () => void native.activitySummary(startOfToday()).then((v) => live && setS(v)).catch(() => {});
    load();
    const t = setInterval(load, 30_000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);
  return (
    <Section title="Today" action={<span className="text-meta text-muted">Stays on this PC</span>}>
      <div className="@container">
      <div data-testid="activity-today" className="grid grid-cols-2 gap-4 px-[14px] py-[14px] @[440px]:grid-cols-4">
        <Figure value={s?.productiveMin ?? 0} label={CATEGORY.productive.label} dot={CATEGORY.productive.dot} />
        <Figure value={s?.neutralMin ?? 0} label={CATEGORY.neutral.label} dot={CATEGORY.neutral.dot} />
        <Figure value={s?.distractingMin ?? 0} label={CATEGORY.distracting.label} dot={CATEGORY.distracting.dot} />
        <Figure value={s?.idleMin ?? 0} label="Idle" dot="bg-line-input" />
      </div>
      </div>
    </Section>
  );
}

/** How Sanctum counts: away time, calls, private titles, and how long history stays. */
export function ActivitySection() {
  const settings = useStore((s) => s.settings);
  const set = useStore((s) => s.setActivitySetting);
  return (
    <Section title="Counting">
      <Row label="Count you as away after" hint="Away time pauses the seal and doesn't count as focus">
        <MiniSelect label="Count you as away after" value={settings.idleThresholdMin} options={IDLE} onChange={(v) => set("idleThresholdMin", v)} />
      </Row>
      <Row label="Never away while these are open" hint="Calls and video">
        <AppListField label="Never away while these are open" saved={settings.passiveApps} placeholder="zoom.exe, teams.exe" onSave={(v) => set("passiveApps", v)} />
      </Row>
      <Row label="Hide window titles for" hint="Their titles are kept as (private)">
        <AppListField label="Hide window titles for" saved={settings.privateApps} placeholder="1password.exe" onSave={(v) => set("privateApps", v)} />
      </Row>
      <Row label="Keep history for">
        <MiniSelect label="Keep history for" value={settings.retentionDays} options={RETENTION} onChange={(v) => set("retentionDays", v)} />
      </Row>
    </Section>
  );
}

/** Setup > Activity: three boxes in one column. */
export function ActivityTab() {
  return (
    <div className="flex flex-col gap-4">
      <ActivityTodaySection />
      <ActivityRulesSection />
      <ActivitySection />
    </div>
  );
}
