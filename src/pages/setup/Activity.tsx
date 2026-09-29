import { useCallback, useEffect, useState } from "react";
import { MiniSelect } from "../../components/controls";
import { GlobeIcon, PlusIcon, TextIcon, XIcon } from "../../components/icons";
import { AppListField, Row, Section } from "./parts";
import { startOfToday, useStore } from "../../state/store";
import { errorText, native } from "../../lib/native";
import { normalizeDomain } from "../../lib/rules";
import { minutes } from "../../lib/time";
import { CATEGORIES, type ActivitySummary, type Category, type ClassRule } from "../../lib/types";

// Activity + idle tracking settings and classification rules (SPEC 4.7, 4.8). No mock exists
// for these; they follow Setup.dc.html's section and row patterns.

const IDLE: { value: number; label: string }[] = [1, 2, 3, 5, 10].map((m) => ({ value: m, label: `${m} min` }));
const RETENTION: { value: number; label: string }[] = [7, 30, 90].map((d) => ({ value: d, label: `${d} days` }));
const CATEGORY_OPTIONS = CATEGORIES.map((c) => ({ value: c, label: c[0]!.toUpperCase() + c.slice(1) }));

/** What a typed pattern is: an exe name, a site, or a window-title keyword. */
export function ruleKindOf(input: string): { matchKind: ClassRule["matchKind"]; pattern: string } | null {
  const s = input.trim();
  if (!s) return null;
  if (/^[^\s\\/]+\.exe$/i.test(s)) return { matchKind: "exe", pattern: s.toLowerCase() };
  const domain = !/\s/.test(s) ? normalizeDomain(s) : null;
  return domain ? { matchKind: "domain", pattern: domain } : { matchKind: "title", pattern: s };
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex flex-col gap-[2px]">
      <span className="font-mono text-body text-text">{minutes(value)}</span>
      <span className="text-[11px] text-muted">{label}</span>
    </div>
  );
}

function TodaySummary() {
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
    <div data-testid="activity-today" className="grid grid-cols-4 gap-2 border-b border-line-soft px-[14px] py-3">
      <Stat value={s?.productiveMin ?? 0} label="productive" />
      <Stat value={s?.neutralMin ?? 0} label="neutral" />
      <Stat value={s?.distractingMin ?? 0} label="distracting" />
      <Stat value={s?.idleMin ?? 0} label="idle" />
    </div>
  );
}

export function ActivitySection() {
  const settings = useStore((s) => s.settings);
  const set = useStore((s) => s.setActivitySetting);
  return (
    <Section title="Activity" action={<span className="text-[11px] text-muted">Stays on this PC</span>}>
      <TodaySummary />
      <Row label="Idle after" hint="Idle pauses the seal and doesn't count as focus">
        <MiniSelect label="Idle after" value={settings.idleThresholdMin} options={IDLE} onChange={(v) => set("idleThresholdMin", v)} />
      </Row>
      <Row label="Keep history">
        <MiniSelect label="Keep history" value={settings.retentionDays} options={RETENTION} onChange={(v) => set("retentionDays", v)} />
      </Row>
      <Row label="Counts as present" hint="Never idle while these are in front">
        <AppListField label="Counts as present" saved={settings.passiveApps} placeholder="zoom.exe, teams.exe" onSave={(v) => set("passiveApps", v)} />
      </Row>
      <Row label="Private apps" hint="Titles stored as (private)">
        <AppListField label="Private apps" saved={settings.privateApps} placeholder="1password.exe" onSave={(v) => set("privateApps", v)} />
      </Row>
    </Section>
  );
}

function KindIcon({ kind }: { kind: ClassRule["matchKind"] }) {
  if (kind === "exe") {
    return <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border border-line-input font-mono text-[8px] text-muted">EXE</span>;
  }
  const Icon = kind === "domain" ? GlobeIcon : TextIcon;
  return (
    <span className="flex h-4 w-4 shrink-0 items-center justify-center text-muted">
      <Icon size={14} />
    </span>
  );
}

export function ActivityRulesSection() {
  const showNotice = useStore((s) => s.showNotice);
  const [rules, setRules] = useState<ClassRule[] | null>(null);
  const [draft, setDraft] = useState("");
  const [category, setCategory] = useState<Category>("distracting");

  const reload = useCallback(() => void native.listClassRules().then(setRules).catch(() => setRules([])), []);
  useEffect(reload, [reload]);

  const guard = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      reload();
      return true;
    } catch (e) {
      showNotice({ lead: errorText(e) });
      return false;
    }
  };

  const add = async () => {
    const kind = ruleKindOf(draft);
    if (!kind) return;
    if (await guard(() => native.addClassRule({ ...kind, category }))) setDraft("");
  };

  return (
    <Section title="Activity rules" action={<span className="font-mono text-meta text-muted">{rules?.length ?? ""}</span>}>
      <div className="flex max-h-[176px] flex-col overflow-y-auto py-1" role="list" aria-label="Activity rules">
        {rules?.length === 0 ? <p className="m-0 px-[14px] py-2 text-meta text-faint">Everything counts as neutral.</p> : null}
        {rules?.map((r) => (
          <div key={r.id} role="listitem" className="group flex h-row shrink-0 items-center gap-[10px] px-[14px] transition-colors duration-ui ease-ui hover:bg-line-soft">
            <KindIcon kind={r.matchKind} />
            <span className="min-w-0 grow truncate text-body text-text">{r.pattern}</span>
            {r.source === "catalog" ? <span className="text-[11px] text-faint">default</span> : null}
            <MiniSelect
              label={`Category for ${r.pattern}`}
              value={r.category}
              options={CATEGORY_OPTIONS}
              onChange={(c) => void guard(() => native.setClassRuleCategory(r.id, c))}
            />
            <button
              type="button"
              aria-label={`Remove ${r.pattern}`}
              onClick={() => void guard(() => native.removeClassRule(r.id))}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-control text-muted opacity-0 transition-[opacity,color,background-color] duration-ui ease-ui hover:bg-raised hover:text-text focus-visible:opacity-100 group-hover:opacity-100"
            >
              <XIcon />
            </button>
          </div>
        ))}
      </div>
      <div className="flex h-[38px] items-center gap-[10px] border-t border-line px-[14px]">
        <PlusIcon className="shrink-0 text-faint" />
        <input
          aria-label="Add an activity rule"
          placeholder="App, site, or title keyword"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void add()}
          className="h-9 min-w-0 grow border-none bg-transparent text-body text-text outline-none placeholder:text-faint"
        />
        <MiniSelect label="Category for new rule" value={category} options={CATEGORY_OPTIONS} onChange={setCategory} />
      </div>
    </Section>
  );
}
