import { useCallback, useEffect, useState } from "react";
import { MiniSelect } from "../../components/controls";
import { errorText, native } from "../../lib/native";
import { addDays, todayKey } from "../../lib/planner";
import type { ActivityView, Category, Usage } from "../../lib/types";
import { useStore } from "../../state/store";
import { appLabel, CATEGORY, duration, Segmented } from "./parts";

// Stats › Activity (v0.3, decided 2026-10-29): where the time went by app and by site, for
// today, 7 days, or 30 (as far back as activity is kept). One click sets an app's or site's
// category, everywhere or only in one profile, and recounts the days already kept.

type Span = "today" | "week" | "month";
const SPANS = [
  { id: "today", label: "Today" },
  { id: "week", label: "7 days" },
  { id: "month", label: "30 days" },
] as const;
const CATS: Category[] = ["productive", "neutral", "distracting"];

function Row({ u, total, scope, onSet }: { u: Usage; total: number; scope: number; onSet: (u: Usage, c: Category) => void }) {
  const name = u.kind === "exe" ? appLabel(u.key) : u.key;
  return (
    <div className="relative flex h-row items-center gap-3 border-b border-line-soft px-[14px] last:border-b-0">
      <span className={`h-[6px] w-[6px] shrink-0 rounded-full ${CATEGORY[u.category].dot}`} aria-hidden="true" />
      <span className="min-w-0 grow truncate text-body" title={u.key}>
        {name}
      </span>
      <span className="shrink-0 text-right font-mono text-meta text-text-2">{duration(u.seconds)}</span>
      <MiniSelect
        label={`${name} is${scope ? " (this profile)" : ""}`}
        value={u.category}
        options={CATS.map((c) => ({ value: c, label: CATEGORY[c].label }))}
        onChange={(c) => c !== u.category && onSet(u, c)}
      />
      {/* Its share of the top entry, as a hairline under the row. */}
      <span aria-hidden="true" className={`absolute bottom-0 left-[14px] h-px opacity-60 ${CATEGORY[u.category].dot}`} style={{ width: `calc((100% - 28px) * ${Math.max(0.02, u.seconds / Math.max(1, total))})` }} />
    </div>
  );
}

function List({ title, items, scope, onSet, empty }: { title: string; items: Usage[]; scope: number; onSet: (u: Usage, c: Category) => void; empty: string }) {
  const total = items.reduce((a, u) => a + u.seconds, 0);
  return (
    <section aria-label={title} className="flex min-h-0 flex-col overflow-hidden rounded-panel border border-line bg-panel">
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-line px-[14px]">
        <h2 className="m-0 text-body font-semibold">{title}</h2>
        <span className="font-mono text-meta text-muted">{duration(total)}</span>
      </div>
      <div className="min-h-0 overflow-y-auto">
        {items.length ? items.map((u) => <Row key={`${u.kind}:${u.key}`} u={u} total={items[0]!.seconds} scope={scope} onSet={onSet} />) : <p className="m-0 p-[14px] text-meta text-muted">{empty}</p>}
      </div>
    </section>
  );
}

export function ActivityTab() {
  const profiles = useStore((s) => s.profiles);
  const showNotice = useStore((s) => s.showNotice);
  const [span, setSpan] = useState<Span>("week");
  // 0: everywhere; otherwise a profile, for "only in <profile>".
  const [scope, setScope] = useState(0);
  const [v, setV] = useState<ActivityView | null>(null);
  const today = todayKey();
  const from = span === "today" ? today : addDays(today, span === "week" ? -6 : -29);

  const load = useCallback(() => {
    void native.statsActivity(from, today).then(setV, () => setV({ apps: [], sites: [] }));
  }, [from, today]);
  useEffect(load, [load]);

  const set = async (u: Usage, c: Category) => {
    try {
      const changed = await native.statsReclassify(u.kind, u.key, c, scope || null);
      const where = scope ? `in ${profiles.find((p) => p.id === scope)?.name ?? "that profile"}` : "everywhere";
      showNotice({ lead: `${u.kind === "exe" ? appLabel(u.key) : u.key} is ${CATEGORY[c].label.toLowerCase()} ${where}.`, rest: changed ? `${changed} past entries recounted.` : undefined });
      load();
    } catch (e) {
      showNotice({ lead: errorText(e) });
    }
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Segmented label="Range" value={span} options={SPANS} onChange={setSpan} />
        <span className="grow" />
        <span className="text-meta text-muted">Set a category</span>
        <MiniSelect label="Where a category applies" value={scope} options={[{ value: 0, label: "everywhere" }, ...profiles.map((p) => ({ value: p.id, label: `only in ${p.name}` }))]} onChange={setScope} />
      </div>
      {v ? (
        <div className="grid min-h-0 grow grid-cols-2 gap-4">
          <List title="Apps" items={v.apps} scope={scope} onSet={(u, c) => void set(u, c)} empty="No app time yet in this range." />
          <List title="Sites" items={v.sites} scope={scope} onSet={(u, c) => void set(u, c)} empty="Sites show up when the browser extension is connected." />
        </div>
      ) : (
        <p className="m-0 text-body text-muted">Loading…</p>
      )}
      <p className="m-0 shrink-0 text-meta text-muted">Activity stays on this PC, kept as long as Setup › Activity says (30 days to start). Anything on your Distractions list stays distracting while it's flagged.</p>
    </>
  );
}
