import { useEffect, useMemo, useState } from "react";
import { Button } from "../../components/Button";
import { CheckMark, Dialog, MiniSelect, Switch } from "../../components/controls";
import { ChevronRightIcon } from "../../components/icons";
import { Row, Section } from "./parts";
import { native } from "../../lib/native";
import { daysLabel, EVERY_DAY, hasDay, longTime, WEEKDAYS } from "../../lib/planner";
import { KIND_LABEL, TEMPLATES, trackerMeta } from "../../lib/trackers";
import type { Checkin, Tracker, TrackerDisplay, TrackerDraft, TrackerKind } from "../../lib/types";
import { useTrackers } from "../../state/trackers";
import { usePlanner } from "../../state/planner";
import { useStore } from "../../state/store";
import { OriginLabel } from "../trackers/Origin";
import { useTheme } from "../../state/theme";

// Setup > Trackers (design/screens/Setup.dc.html, SPEC 4.13): custom trackers, the check-ins
// that ask for them, and whether a missed check-in shows at startup.

const field =
  "h-control min-w-0 rounded-control border border-line-input bg-raised px-[10px] text-body text-text transition-colors duration-ui ease-ui placeholder:text-muted hover:border-check-line";

const KINDS = (Object.keys(KIND_LABEL) as TrackerKind[]).map((k) => ({ value: k, label: KIND_LABEL[k] }));
const DISPLAYS: { value: TrackerDisplay; label: string }[] = [
  { value: "both", label: "Chart and table" },
  { value: "chart", label: "Chart" },
  { value: "table", label: "Table" },
];

function Labeled({ label, children, grow = false }: { label: string; children: React.ReactNode; grow?: boolean }) {
  return (
    <label className={`flex flex-col gap-1 ${grow ? "min-w-0 grow" : "shrink-0"}`}>
      <span className="label">{label}</span>
      {children}
    </label>
  );
}

/** "the Protein routine", "the Protein and Water routines". */
const routineNames = (names: string[]) =>
  names.length <= 1 ? `the ${names[0]} routine` : `the ${names.slice(0, -1).join(", ")} and ${names.at(-1)} routines`;

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function TrackerEditor({ start, used, onDone }: { start: TrackerDraft; used: boolean; onDone: () => void }) {
  const { saveTracker, deleteTracker } = useTrackers();
  const [d, setD] = useState<TrackerDraft>(start);
  // Deleting asks first (2026-11-24), and says what it takes: the entries, and a counter routine's
  // link, since a routine counting into this tracker becomes a plain routine.
  const [asking, setAsking] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const entryCount = useTrackers((s) => (d.id === undefined ? 0 : s.entries.filter((e) => e.trackerId === d.id).length));
  // One string from the store, so the selector's value is stable between renders.
  const counterNames = usePlanner((s) => (d.id === undefined ? "" : s.routines.filter((r) => r.trackerId === d.id).map((r) => r.title).join("\n")));
  const counters = useMemo(() => (counterNames ? counterNames.split("\n") : []), [counterNames]);
  const remove = async () => {
    setDeleting(true);
    const ok = await deleteTracker(d.id!);
    setDeleting(false);
    if (!ok) return;
    setAsking(false);
    if (counters.length) {
      useStore.getState().showNotice({ lead: `${start.name} deleted.`, rest: `${cap(routineNames(counters))} ${counters.length > 1 ? "are" : "is"} a plain routine now.` });
    }
    onDone();
  };
  const [goal, setGoal] = useState(start.goal != null ? String(start.goal) : "");
  const save = async () => {
    const g = goal.trim() === "" ? null : Number(goal);
    if (await saveTracker({ ...d, goal: g !== null && Number.isFinite(g) ? g : null })) onDone();
  };
  return (
    <div
      className="flex flex-col gap-3 border-b border-line-soft bg-panel-footer px-[14px] py-3"
      onKeyDown={(e) => e.key === "Enter" && e.target instanceof HTMLInputElement && void save()}
    >
      <div className="flex flex-wrap items-end gap-2">
        <Labeled label="Name" grow>
          <input aria-label="Tracker name" autoFocus value={d.name} placeholder="Weight, Sleep, Journal…" onChange={(e) => setD({ ...d, name: e.target.value })} className={field} />
        </Labeled>
        <Labeled label={used ? "Type (fixed once logged)" : "Type"}>
          {used ? (
            <span className="flex h-control items-center text-body text-text-2">{KIND_LABEL[d.kind]}</span>
          ) : (
            <MiniSelect label="Tracker type" value={d.kind} options={KINDS} onChange={(kind) => setD({ ...d, kind })} />
          )}
        </Labeled>
        {d.kind === "number" ? (
          <Labeled label="Unit">
            <input aria-label="Unit" value={d.unit ?? ""} maxLength={12} placeholder="lb, %, h" onChange={(e) => setD({ ...d, unit: e.target.value })} className={`${field} w-[80px]`} />
          </Labeled>
        ) : null}
        {d.kind === "number" || d.kind === "scale" ? (
          <Labeled label="Goal (optional)">
            <input aria-label="Goal" inputMode="decimal" value={goal} placeholder="—" onChange={(e) => setGoal(e.target.value)} className={`${field} w-[80px] font-mono`} />
          </Labeled>
        ) : null}
        {d.kind !== "text" ? (
          <Labeled label="Show as">
            <MiniSelect label="Show as" value={d.display ?? "both"} options={DISPLAYS} onChange={(display) => setD({ ...d, display })} />
          </Labeled>
        ) : null}
      </div>
      {asking ? (
        // The same confirm as deleting a note (2026-11-24): what goes, what changes, no undo.
        <Dialog label="Delete this tracker" alert onClose={() => (deleting ? null : setAsking(false))} width={420}>
          <div data-testid="tracker-delete" className="flex flex-col gap-4 p-5">
            <div className="flex flex-col gap-2">
              <h2 className="m-0 text-[16px] font-semibold text-text">Delete this tracker</h2>
              <dl className="m-0 grid grid-cols-[64px_1fr] gap-x-3 gap-y-1 text-body">
                <dt className="text-danger-text">Deletes</dt>
                <dd className="m-0 text-text-2">
                  {start.name}
                  {entryCount ? `, and its ${entryCount} ${entryCount === 1 ? "entry" : "entries"}` : ""}
                </dd>
                {counters.length ? (
                  <>
                    <dt className="text-muted">Changes</dt>
                    <dd className="m-0 text-text-2">{`${cap(routineNames(counters))} stop${counters.length > 1 ? "" : "s"} counting and become${counters.length > 1 ? "" : "s"} a plain routine`}</dd>
                  </>
                ) : null}
              </dl>
              <p className="m-0 text-body text-muted">This cannot be undone.</p>
            </div>
            <div className="flex items-center justify-end gap-2">
              <Button variant="quiet" onClick={() => setAsking(false)} disabled={deleting}>
                Cancel
              </Button>
              <Button variant="danger" onClick={() => void remove()} disabled={deleting}>
                {deleting ? "Deleting…" : "Delete"}
              </Button>
            </div>
          </div>
        </Dialog>
      ) : null}
      <div className="flex items-center gap-2">
        {d.id !== undefined ? (
          <Button variant="danger-plain" size="sm" onClick={() => setAsking(true)}>
            {used ? "Delete with its entries" : "Delete"}
          </Button>
        ) : null}
        <Button variant="ghost" size="sm" className="ml-auto" onClick={onDone}>
          Cancel
        </Button>
        <Button variant="primary" size="sm" onClick={() => void save()}>
          {d.id !== undefined ? "Save" : "Add tracker"}
        </Button>
      </div>
    </div>
  );
}

function TrackersSection() {
  const { trackers, entries } = useTrackers();
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [start, setStart] = useState<TrackerDraft>({ name: "", kind: "number", display: "both" });
  const used = (id: number) => entries.some((e) => e.trackerId === id);
  const taken = new Set(trackers.map((t) => t.name.toLowerCase()));
  const edit = (t: Tracker) => setEditing(editing === t.id ? null : t.id);
  return (
    <Section
      title="Trackers"
      titled={false}
      action={
        <Button variant="ghost" size="sm" onClick={() => (setStart({ name: "", kind: "number", display: "both" }), setEditing(editing === "new" ? null : "new"))}>
          New tracker
        </Button>
      }
    >
      {editing === "new" ? (
        <>
          <div className="flex flex-wrap items-center gap-[6px] border-b border-line-soft px-[14px] py-[10px]">
            <span className="mr-1 text-meta text-muted">Start from</span>
            {TEMPLATES.filter((t) => !taken.has(t.name.toLowerCase())).map((t) => (
              <button
                key={t.name}
                type="button"
                title={t.hint}
                onClick={() => setStart({ name: t.name, kind: t.kind, unit: t.unit, display: t.display })}
                className={`h-control-sm rounded-control border px-2 text-meta transition-colors duration-ui ease-ui ${
                  start.name === t.name ? "border-sealed bg-sealed-tint text-text" : "border-line-input text-text-2 hover:border-check-line hover:text-text"
                }`}
              >
                {t.name}
              </button>
            ))}
          </div>
          <TrackerEditor key={start.name} start={start} used={false} onDone={() => setEditing(null)} />
        </>
      ) : null}
      {trackers.map((t) => (
        <div key={t.id}>
          <button
            type="button"
            aria-expanded={editing === t.id}
            aria-label={`Edit ${t.name}`}
            onClick={() => edit(t)}
            className="@container flex h-10 w-full items-center gap-[10px] border-b border-line-soft px-[14px] text-left transition-colors duration-ui ease-ui hover:bg-raised"
          >
            <span className="min-w-0 truncate text-body">
              {t.name} {t.unit ? <span className="font-mono text-meta text-muted">{t.unit}</span> : null}
            </span>
            <span className="grow" />
            {t.goal !== null ? <span className="hidden shrink-0 font-mono text-meta text-muted @[520px]:inline">goal {t.goal}</span> : null}
            <span className="hidden shrink-0 text-meta text-muted @[440px]:inline">{trackerMeta(t)}</span>
            {/* Routine or Tracked (2026-11-24). */}
            <OriginLabel trackerId={t.id} />
            <ChevronRightIcon size={11} className="text-muted" />
          </button>
          {editing === t.id ? <TrackerEditor start={{ ...t }} used={used(t.id)} onDone={() => setEditing(null)} /> : null}
        </div>
      ))}
      {!trackers.length && editing !== "new" ? (
        <p className="m-0 px-[14px] py-3 text-body text-muted">Nothing tracked yet. Make a tracker for anything: a number, yes or no, a 1 to 10 scale, or a note.</p>
      ) : null}
    </Section>
  );
}

function Days({ mask, onChange }: { mask: number; onChange: (m: number) => void }) {
  return (
    <div role="group" aria-label="Days" className="flex gap-[3px]">
      {WEEKDAYS.map((d) => {
        const on = hasDay(mask, d.bit);
        return (
          <button
            key={d.name}
            type="button"
            aria-label={d.name}
            aria-pressed={on}
            onClick={() => onChange(mask ^ (1 << d.bit))}
            className={`h-control-sm w-control-sm rounded-control border text-meta transition-colors duration-ui ease-ui ${
              on ? "border-sealed bg-sealed-tint text-text" : "border-line-input text-muted hover:border-check-line hover:text-text-2"
            }`}
          >
            {d.short}
          </button>
        );
      })}
    </div>
  );
}

const BLANK: Checkin = { id: 0, name: "", time: "08:00", daysMask: EVERY_DAY, trackerIds: [], includeGoalReview: false };

function CheckinEditor({ start, onDone }: { start: Checkin; onDone: () => void }) {
  const { trackers, saveCheckin, deleteCheckin } = useTrackers();
  const [c, setC] = useState(start);
  // The time picker's native popup follows the theme: light themes get a light one.
  const scheme = useTheme((s) => s.theme.scheme);
  const save = async () => {
    if (await saveCheckin(c)) onDone();
  };
  const toggle = (id: number) => setC({ ...c, trackerIds: c.trackerIds.includes(id) ? c.trackerIds.filter((x) => x !== id) : [...c.trackerIds, id] });
  return (
    <div className="flex flex-col gap-3 border-b border-line-soft bg-panel-footer px-[14px] py-3" onKeyDown={(e) => e.key === "Enter" && e.target instanceof HTMLInputElement && void save()}>
      <div className="flex items-end gap-2">
        <Labeled label="Name" grow>
          <input aria-label="Check-in name" autoFocus value={c.name} placeholder="Morning weigh-in" onChange={(e) => setC({ ...c, name: e.target.value })} className={field} />
        </Labeled>
        <Labeled label="Time">
          <input aria-label="Time" type="time" value={c.time} onChange={(e) => setC({ ...c, time: e.target.value })} style={{ colorScheme: scheme }} className={`${field} w-[112px] font-mono`} />
        </Labeled>
      </div>
      <Days mask={c.daysMask} onChange={(daysMask) => setC({ ...c, daysMask })} />
      <div className="flex flex-col gap-[6px]">
        <span className="label">Asks for</span>
        <div className="flex flex-wrap gap-[6px]">
          {trackers.map((t) => {
            const on = c.trackerIds.includes(t.id);
            return (
              <button
                key={t.id}
                type="button"
                role="checkbox"
                aria-checked={on}
                onClick={() => toggle(t.id)}
                className={`flex h-control-sm items-center gap-[6px] rounded-control border px-2 text-meta transition-colors duration-ui ease-ui ${
                  on ? "border-sealed bg-sealed-tint text-text" : "border-line-input text-text-2 hover:border-check-line"
                }`}
              >
                <CheckMark done={on} />
                {t.name}
              </button>
            );
          })}
          {!trackers.length ? <span className="text-meta text-muted">Make a tracker first, or use the goal review on its own.</span> : null}
        </div>
      </div>
      <div className="flex items-center gap-[10px]">
        <span className="flex grow flex-col gap-[2px]">
          <span className="text-body">Review goals</span>
          <span className="text-micro text-muted">Today’s open tasks, and tomorrow’s top 3</span>
        </span>
        <Switch label="Review goals" checked={c.includeGoalReview} onChange={(includeGoalReview) => setC({ ...c, includeGoalReview })} />
      </div>
      <div className="flex items-center gap-2">
        {c.id ? (
          <Button variant="danger-plain" size="sm" onClick={() => void deleteCheckin(c.id).then((ok) => ok && onDone())}>
            Delete
          </Button>
        ) : null}
        <Button variant="ghost" size="sm" className="ml-auto" onClick={onDone}>
          Cancel
        </Button>
        <Button variant="primary" size="sm" onClick={() => void save()}>
          {c.id ? "Save" : "Add check-in"}
        </Button>
      </div>
    </div>
  );
}

/** "Weight, Body fat · review" */
function asks(c: Checkin, trackers: Tracker[]) {
  const names = c.trackerIds.map((id) => trackers.find((t) => t.id === id)?.name).filter(Boolean);
  if (c.includeGoalReview) names.push("goal review");
  return names.join(", ");
}

function CheckinsSection() {
  const { trackers, checkins } = useTrackers();
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [startup, setStartup] = useState(true);
  useEffect(() => void native.getSetting("checkin_on_startup").then((v) => setStartup(v !== "0")), []);
  return (
    <Section
      title="Check-ins"
      action={
        <Button variant="ghost" size="sm" onClick={() => setEditing(editing === "new" ? null : "new")}>
          New check-in
        </Button>
      }
    >
      {editing === "new" ? <CheckinEditor start={BLANK} onDone={() => setEditing(null)} /> : null}
      {checkins.map((c) => (
        <div key={c.id}>
          <button
            type="button"
            aria-expanded={editing === c.id}
            aria-label={`Edit ${c.name}`}
            onClick={() => setEditing(editing === c.id ? null : c.id)}
            className="flex w-full flex-col gap-1 border-b border-line-soft px-[14px] py-[10px] text-left transition-colors duration-ui ease-ui hover:bg-raised"
          >
            <span className="flex w-full items-baseline justify-between">
              <span className="text-body font-medium">{c.name}</span>
              <span className="font-mono text-meta text-text-2">{longTime(c.time)}</span>
            </span>
            <span className="flex w-full justify-between gap-3 text-meta text-muted">
              <span className="truncate">{asks(c, trackers) || "Nothing yet"}</span>
              <span className="shrink-0">{daysLabel(c.daysMask)}</span>
            </span>
          </button>
          {editing === c.id ? <CheckinEditor start={c} onDone={() => setEditing(null)} /> : null}
        </div>
      ))}
      {!checkins.length && editing !== "new" ? (
        <p className="m-0 border-b border-line-soft px-[14px] py-3 text-body text-muted">No check-ins. Add one to be asked at a set time, like a weigh-in at 8:00 AM on Mondays and Thursdays.</p>
      ) : null}
      <Row label="Check in on startup" hint="Shows a check-in you missed today when Sanctum starts">
        <Switch
          label="Check in on startup"
          checked={startup}
          onChange={(v) => {
            setStartup(v);
            void native.setSetting("checkin_on_startup", v ? "1" : "0");
          }}
        />
      </Row>
    </Section>
  );
}

export function TrackersTab() {
  const load = useTrackers((s) => s.load);
  useEffect(() => void load(), [load]);
  return (
    <div className="flex flex-col gap-4">
      <TrackersSection />
      <CheckinsSection />
      <p className="m-0 text-meta text-muted">Check-ins wait while you’re sealed and appear when the seal ends. Tracker data stays on this PC.</p>
    </div>
  );
}
