import { useEffect, useMemo, useState } from "react";
import { Button } from "../../components/Button";
import { Dialog, MiniSelect } from "../../components/controls";
import { errorText, native, type SessionQuery } from "../../lib/native";
import { addDays, addMonths, todayKey } from "../../lib/planner";
import { clock, minutes } from "../../lib/time";
import type { SessionDetail, SessionOutcome, SessionRow } from "../../lib/types";
import { useStore } from "../../state/store";
import { appLabel, OUTCOME, Segmented } from "./parts";

// Stats › Sessions (v0.3, decided 2026-10-29): every finished session, kept for good. Filter
// by range, outcome, and profile; open one for its details; save the list as CSV.

type Span = "week" | "month" | "all";
const SPANS = [
  { id: "week", label: "7 days" },
  { id: "month", label: "30 days" },
  { id: "all", label: "All time" },
] as const;

const dayLabel = (t: number) => new Date(t).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

function OutcomeTag({ outcome }: { outcome: SessionOutcome }) {
  const tone = outcome === "broken" ? "border-broken-line bg-broken-tint text-broken-text" : outcome === "unlocked_early" ? "border-line-input text-text-2" : "border-sealed-line bg-sealed-tint text-sealed-text";
  return <span className={`whitespace-nowrap rounded-full border px-2 py-[1px] text-[11px] ${tone}`}>{OUTCOME[outcome]}</span>;
}

const RESULT = { done: "Done", partly: "Partly", no: "No" } as const;

function Details({ id, onClose, onOpenDay }: { id: number; onClose: () => void; onOpenDay: (key: string) => void }) {
  const [d, setD] = useState<SessionDetail | null | undefined>(undefined);
  useEffect(() => void native.statsSession(id).then(setD, () => setD(null)), [id]);
  const s = d?.session;
  return (
    <Dialog label="Session" onClose={onClose} width={460}>
      <div className="flex flex-col gap-4 p-5">
        {d === undefined ? <p className="m-0 text-body text-muted">Opening…</p> : null}
        {d === null ? <p className="m-0 text-body text-muted">That session isn't in the history.</p> : null}
        {s ? (
          <>
            <div className="flex items-center gap-2">
              <h2 className="m-0 text-[16px] font-semibold">{s.profileName}</h2>
              <OutcomeTag outcome={s.outcome} />
            </div>
            <dl className="m-0 grid grid-cols-[120px_1fr] gap-y-2 text-body">
              <dt className="text-muted">When</dt>
              <dd className="m-0">
                {dayLabel(s.startedAt)}, {clock(s.startedAt)} to {clock(s.endedAt)}
              </dd>
              <dt className="text-muted">Focus</dt>
              <dd className="m-0 font-mono">
                {minutes(s.focusMin)} <span className="text-muted">of {minutes(s.plannedMin)} planned</span>
              </dd>
              <dt className="text-muted">Away (idle)</dt>
              <dd className="m-0 font-mono">{minutes(s.idleMin)}</dd>
              {s.task ? (
                <>
                  <dt className="text-muted">Task</dt>
                  <dd className="m-0">{s.task}</dd>
                </>
              ) : null}
              {s.goal ? (
                <>
                  <dt className="text-muted">For</dt>
                  <dd className="m-0">{s.goal}</dd>
                </>
              ) : null}
              {s.result ? (
                <>
                  <dt className="text-muted">Got done</dt>
                  <dd className="m-0">
                    {RESULT[s.result]}
                    {s.focusRating ? <span className="text-muted"> · focus {s.focusRating} of 5</span> : null}
                  </dd>
                </>
              ) : null}
              {s.plan ? (
                <>
                  <dt className="text-muted">If tempted</dt>
                  <dd className="m-0">{s.plan}</dd>
                </>
              ) : null}
              {s.leftOff ? (
                <>
                  <dt className="text-muted">Left off</dt>
                  <dd className="m-0">{s.leftOff}</dd>
                </>
              ) : null}
            </dl>
            <div className="flex flex-col gap-1">
              <span className="text-meta font-medium text-text-2">Blocked</span>
              {d!.blocked.length ? (
                d!.blocked.map((b) => (
                  <span key={`${b.what}:${b.kind}`} className="flex justify-between text-body">
                    <span>{appLabel(b.what)}</span>
                    <span className="font-mono text-muted">×{b.count}</span>
                  </span>
                ))
              ) : (
                <span className="text-meta text-muted">Nothing tried to get in.</span>
              )}
            </div>
            {d!.unlocks.length || d!.tamper.length ? (
              <div className="flex flex-col gap-1">
                <span className="text-meta font-medium text-text-2">What happened</span>
                {[...d!.unlocks, ...d!.tamper]
                  .sort((a, b) => a.at - b.at)
                  .map((m) => (
                    <span key={`${m.at}:${m.what}`} className="flex gap-3 text-body">
                      <span className="w-16 shrink-0 font-mono text-muted">{clock(m.at)}</span>
                      <span>{m.what}</span>
                    </span>
                  ))}
              </div>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => onOpenDay(todayKey(new Date(s.startedAt)))}>
                See that day
              </Button>
              <Button variant="primary" size="sm" onClick={onClose}>
                Done
              </Button>
            </div>
          </>
        ) : null}
      </div>
    </Dialog>
  );
}

export function SessionsTab({ onOpenDay }: { onOpenDay: (key: string) => void }) {
  const profiles = useStore((s) => s.profiles);
  const showNotice = useStore((s) => s.showNotice);
  const [span, setSpan] = useState<Span>("week");
  const [outcome, setOutcome] = useState<SessionOutcome | "">("");
  const [profile, setProfile] = useState<number>(0);
  const [rows, setRows] = useState<SessionRow[] | null>(null);
  const [open, setOpen] = useState<number | null>(null);

  const today = todayKey();
  const query: SessionQuery = useMemo(
    () => ({
      ...(span === "all" ? {} : { from: span === "week" ? addDays(today, -6) : addMonths(today, -1), to: today }),
      outcome: outcome || null,
      profile: profile || null,
    }),
    [span, outcome, profile, today],
  );
  useEffect(() => {
    let live = true;
    setRows(null);
    void native.statsSessions(query).then(
      (r) => live && setRows(r),
      () => live && setRows([]),
    );
    return () => {
      live = false;
    };
  }, [query]);

  const totals = useMemo(() => {
    const list = rows ?? [];
    return {
      count: list.length,
      focus: list.reduce((a, r) => a + r.focusMin, 0),
      kept: list.filter((r) => r.outcome === "completed").length,
      broken: list.filter((r) => r.outcome === "broken").length,
      // Kept counts the time; got done counts the work (v0.3.1).
      done: list.filter((r) => r.result === "done").length,
      answered: list.filter((r) => r.result).length,
    };
  }, [rows]);

  const exportCsv = async () => {
    try {
      const f = await native.statsSessionsCsv(query);
      showNotice({ lead: "Saved.", rest: f.name, action: { label: "Show", run: () => void native.dataReveal(f.path) } });
    } catch (e) {
      showNotice({ lead: errorText(e) });
    }
  };

  // Group rows by day, newest first.
  const groups = useMemo(() => {
    const out: { day: string; rows: SessionRow[] }[] = [];
    for (const r of rows ?? []) {
      const day = dayLabel(r.startedAt);
      if (out.at(-1)?.day === day) out.at(-1)!.rows.push(r);
      else out.push({ day, rows: [r] });
    }
    return out;
  }, [rows]);

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Segmented label="Range" value={span} options={SPANS} onChange={setSpan} />
        <MiniSelect
          label="Outcome"
          value={outcome}
          options={[{ value: "", label: "Every outcome" }, ...(Object.keys(OUTCOME) as SessionOutcome[]).map((o) => ({ value: o, label: OUTCOME[o] }))]}
          onChange={setOutcome}
        />
        <MiniSelect label="Profile" value={profile} options={[{ value: 0, label: "Every profile" }, ...profiles.map((p) => ({ value: p.id, label: p.name }))]} onChange={setProfile} />
        <span className="grow" />
        <Button variant="ghost" size="sm" disabled={!rows?.length} onClick={() => void exportCsv()}>
          Export CSV
        </Button>
      </div>

      <div className="grid shrink-0 grid-cols-5 gap-3" role="list" aria-label="Totals">
        {[
          ["Sessions", String(totals.count)],
          ["In focus", minutes(totals.focus)],
          ["Kept", String(totals.kept)],
          ["Got done", totals.answered ? `${totals.done} of ${totals.answered}` : "–"],
          ["Broken", String(totals.broken)],
        ].map(([label, value]) => (
          <div key={label} role="listitem" className="flex flex-col gap-[2px] rounded-panel border border-line bg-panel px-[14px] py-[10px]">
            <span className="text-meta text-muted">{label}</span>
            <span className="font-mono text-[18px] text-text">{value}</span>
          </div>
        ))}
      </div>

      <section aria-label="Sessions" className="min-h-0 grow overflow-y-auto rounded-panel border border-line bg-panel">
        {rows === null ? <p className="m-0 p-[14px] text-body text-muted">Loading…</p> : null}
        {rows?.length === 0 ? <p className="m-0 p-[14px] text-body text-muted">No sessions here yet. They show up once a seal ends.</p> : null}
        {groups.map((g) => (
          <div key={g.day}>
            <div className="sticky top-0 z-[1] border-b border-line bg-panel-footer px-[14px] py-[6px] text-meta font-medium text-text-2">{g.day}</div>
            {g.rows.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setOpen(r.id)}
                aria-label={`${r.profileName}, ${clock(r.startedAt)}, ${OUTCOME[r.outcome]}`}
                className="flex h-row w-full items-center gap-3 border-b border-line-soft px-[14px] text-left text-body transition-colors duration-ui ease-ui last:border-b-0 hover:bg-line-soft"
              >
                <span className="w-[74px] shrink-0 font-mono text-meta text-muted">{clock(r.startedAt)}</span>
                <span className="min-w-0 grow truncate">
                  {r.profileName}
                  {r.task ? <span className="text-muted"> · {r.task}</span> : null}
                </span>
                <span className="w-[92px] shrink-0 text-right font-mono text-meta">
                  {minutes(r.focusMin)}
                  <span className="text-faint"> / {minutes(r.plannedMin)}</span>
                </span>
                <span className="w-[48px] shrink-0 text-right font-mono text-meta text-muted">{r.attempts ? `×${r.attempts}` : ""}</span>
                <span className="flex w-[104px] shrink-0 justify-end">
                  <OutcomeTag outcome={r.outcome} />
                </span>
              </button>
            ))}
          </div>
        ))}
      </section>
      {open !== null ? <Details id={open} onClose={() => setOpen(null)} onOpenDay={(k) => (setOpen(null), onOpenDay(k))} /> : null}
    </>
  );
}

