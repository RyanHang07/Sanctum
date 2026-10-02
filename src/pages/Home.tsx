import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CheckIcon, ChevronIcon, LockIcon, PlusIcon, SearchIcon, XIcon } from "../components/icons";
import { durationsMin } from "../theme/tokens";
import { selectedProfile, useStore, type HomePanel } from "../state/store";
import { usePlanner } from "../state/planner";
import { useTrackers } from "../state/trackers";
import { useAgenda } from "../state/calendar";
import { meetingLabels } from "../lib/calendar";
import { useNow } from "../lib/useNow";
import { EVENTS, native, onNative } from "../lib/native";
import { profileNote } from "../lib/rules";
import { Button, Kbd } from "../components/Button";
import { Switch } from "../components/controls";
import { Wheel } from "../components/Wheel";
import { QuickAddField } from "../components/QuickAdd";
import { PendingTab } from "./week/Pending";
import { homeHeadline } from "./headlines";
import { SAMPLE_EVENT } from "./placeholders";
import { clock, countdown, joinNames, minutes } from "../lib/time";
import { addDays, blockTimes, canReorder, longTime, moveId, openFirst, shortTime, todayKey, type AgendaItem, type Suggestion } from "../lib/planner";
import type { DayStatus, StatsOverview, TaskLink } from "../lib/types";

function formatDate(d: Date) {
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

export const enterFocus = () => useStore.getState().enterFocus();

/** Running apps the selected profile would close, refreshed while the focus row is visible. */
function useSealPreview(profileId: number | undefined): string[] {
  const [names, setNames] = useState<string[]>([]);
  useEffect(() => {
    if (profileId === undefined) return setNames([]);
    let live = true;
    const load = () =>
      void native
        .previewSeal(profileId)
        .then((n) => live && setNames(n))
        .catch(() => live && setNames([]));
    load();
    const t = setInterval(load, 4000);
    window.addEventListener("focus", load);
    return () => {
      live = false;
      clearInterval(t);
      window.removeEventListener("focus", load);
    };
  }, [profileId]);
  return names;
}

const MARK: Record<DayStatus, string> = {
  kept: "bg-sealed",
  broken: "bg-broken",
  missed: "bg-line-input",
  rest: "border border-dashed border-check-line",
  today: "border border-sealed",
  future: "bg-line",
  none: "bg-line",
};

/** The streak and the last 7 days (SPEC 4.10). Opens Stats. */
function StreakChip() {
  const navigate = useStore((s) => s.navigate);
  const session = useStore((s) => s.session);
  const [o, setO] = useState<StatsOverview | null>(null);
  useEffect(() => {
    let live = true;
    const today = todayKey();
    const load = () =>
      void native
        .statsOverview(addDays(today, -6), today)
        .then((v) => live && setO(v))
        .catch(() => undefined);
    load();
    const off = onNative(EVENTS.held, load);
    const t = setInterval(load, 60_000);
    return () => {
      live = false;
      clearInterval(t);
      void off.then((f) => f());
    };
    // A session starting or ending changes today.
  }, [session?.id]);
  const n = o?.currentStreak ?? 0;
  return (
    <button
      type="button"
      aria-label={`${n} day streak. Open Stats`}
      onClick={() => navigate("stats")}
      className="flex h-control items-center gap-[10px] rounded-control border border-line bg-panel px-[10px] text-meta text-text transition-colors duration-ui ease-ui hover:border-line-input"
    >
      <span className="font-mono font-medium">{n}</span>
      <span className="text-muted">day streak</span>
      <span className="flex gap-[3px]" aria-hidden="true">
        {(o?.days ?? []).map((d) => (
          <span key={d.date} data-status={d.status} className={`box-border h-3 w-[6px] rounded-[2px] ${MARK[d.status]}`} />
        ))}
      </span>
    </button>
  );
}

// --- Focus panel (SPEC 4.12: suggested card + two snap wheels + a large Enter) ---

function SuggestedCard({ s }: { s: Suggestion | null }) {
  const profiles = useStore((st) => st.profiles);
  const selected = useStore((st) => st.selectedProfileId);
  const duration = useStore((st) => st.durationMin);
  const navigate = useStore((st) => st.navigate);
  const hintHidden = useStore((st) => st.settings.homeLayout.hidden.includes("hint"));
  const setHidden = useStore((st) => st.setHomeHidden);
  if (!s) {
    // Dismissable; Customize brings it back. A real block always shows.
    if (hintHidden) return null;
    return (
      <div data-testid="suggestion" className="flex h-11 items-center gap-3 rounded-control border border-dashed border-line-input pl-3 pr-1">
        <span className="grow text-meta text-muted">No focus block on your schedule. Link a routine or an item to a profile and it shows up here.</span>
        <Button variant="quiet" size="sm" onClick={() => navigate("week")}>
          Open Week
        </Button>
        <Button variant="quiet" size="sm" aria-label="Dismiss" className="w-[26px] px-0" onClick={() => setHidden("hint", true)}>
          <XIcon size={10} />
        </Button>
      </div>
    );
  }
  const profile = profiles.find((p) => p.id === s.profileId);
  const applied = selected === s.profileId && duration === s.minutes;
  const use = () => useStore.setState({ selectedProfileId: s.profileId, durationMin: s.minutes, focusOverrideKey: null });
  return (
    <div
      data-testid="suggestion"
      className={`flex h-11 items-center gap-3 rounded-control border px-3 ${s.state === "now" ? "border-sealed-line bg-sealed-tint" : "border-line-input bg-raised"}`}
    >
      <span
        className={`rounded-[4px] px-[6px] py-[2px] font-mono text-[10px] font-medium tracking-[0.06em] ${s.state === "now" ? "bg-sealed text-sealed-on" : "bg-line text-text-2"}`}
      >
        {s.state === "now" ? "NOW" : "NEXT"}
      </span>
      <span className="min-w-0 truncate text-body font-medium text-text">{s.item.title}</span>
      <span className="shrink-0 font-mono text-meta text-muted">
        {s.state === "now" ? `${clock(s.startsAt)} to ${clock(s.endsAt)}` : `at ${clock(s.startsAt)}`}
      </span>
      <span className="ml-auto shrink-0 truncate text-meta text-text-2">
        {profile?.name ?? "Unknown profile"} · {s.minutes} min
      </span>
      {applied ? null : (
        <Button variant="tint" size="sm" onClick={use}>
          Use
        </Button>
      )}
    </div>
  );
}

/** The task the next session is for (v0.1): it takes the suggestion's place until cleared. */
function TaskStrip({ task }: { task: TaskLink }) {
  const clear = () => useStore.getState().setFocusTask(null);
  return (
    <div data-testid="focus-task" className="flex h-11 items-center gap-3 rounded-control border border-sealed-line bg-sealed-tint pl-3 pr-1">
      <span className="rounded-[4px] bg-sealed px-[6px] py-[2px] font-mono text-[10px] font-medium tracking-[0.06em] text-sealed-on">FOR</span>
      <span className="min-w-0 truncate text-body font-medium text-text">{task.title}</span>
      <span className="ml-auto shrink-0 text-meta text-text-2">Check it off when the seal holds</span>
      <Button variant="quiet" size="sm" aria-label="Unlink task" className="w-[26px] px-0" onClick={clear}>
        <XIcon size={10} />
      </Button>
    </div>
  );
}

/** Same task: kind, id, and day. */
const sameTask = (a: Pick<TaskLink, "kind" | "id" | "date">, b: Pick<AgendaItem, "kind" | "id" | "date">) =>
  a.kind === b.kind && a.id === b.id && a.date === b.date;

// --- The state card: Open, Sealed, and In event share one shape (decided 2026-09-30) ---
// A strip on top, then labeled boxes the height of the focus wheels (82px), then the action on
// the right under a small label. Open has the wheels; Sealed and In event fill the same boxes.

const BOX = "flex h-[82px] items-center justify-center rounded-panel border border-line-input bg-raised px-3";
const LABEL = "px-1 text-[11px] font-medium uppercase tracking-[0.06em]";

/** A labeled box the size of a wheel, holding a value instead of a picker. */
function Field({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <span className={`${LABEL} text-faint`}>{label}</span>
      <div className={BOX}>{children}</div>
    </div>
  );
}

/** The 44px strip on top of the Sealed and In event cards, where Open has its suggestion. */
function Strip({ tone, children, progress }: { tone: "sealed" | "event"; children: ReactNode; progress: number }) {
  const bar = tone === "sealed" ? "bg-sealed" : "bg-event";
  const box = tone === "sealed" ? "border-sealed-line bg-sealed-tint" : "border-event-line bg-event-tint";
  return (
    <div className={`relative flex h-11 items-center gap-3 overflow-hidden rounded-control border px-3 ${box}`}>
      <span className="flex min-w-0 grow items-center gap-3 truncate text-meta text-text-2">{children}</span>
      <div className="absolute inset-x-0 bottom-0 h-[2px] bg-line">
        <div className={`h-full transition-[width] duration-enter ease-ui ${bar}`} style={{ width: `${Math.min(100, Math.max(0, progress) * 100)}%` }} />
      </div>
    </div>
  );
}

function FocusPanel() {
  const profiles = useStore((s) => s.profiles);
  const profile = useStore(selectedProfile);
  const duration = useStore((s) => s.durationMin);
  const suggestion = useStore((s) => s.suggestion);
  const task = useStore((s) => s.focusTask);
  const closing = useSealPreview(profile?.id);
  const distractionCount = useStore((s) => s.distractions.length);

  const pickProfile = (id: number) => {
    useStore.getState().selectProfile(id);
    useStore.getState().markManualFocus();
  };
  const pickDuration = (m: number) => {
    useStore.getState().setDuration(m);
    useStore.getState().markManualFocus();
  };
  const profileOptions = useMemo(() => profiles.map((p) => ({ value: p.id, label: p.name })), [profiles]);
  const durationOptions = useMemo(() => durationsMin.map((m) => ({ value: m, label: `${m} min` })), []);

  return (
    <section data-testid="focus-row" aria-label="Focus" className="flex flex-col gap-3 rounded-panel border border-line bg-panel p-3">
      {task ? <TaskStrip task={task} /> : <SuggestedCard s={suggestion} />}
      {profiles.length === 0 ? (
        <div className="flex h-[120px] items-center justify-center gap-2 rounded-control border border-dashed border-line-input text-body text-muted">
          No profiles yet.
          <button type="button" onClick={() => useStore.getState().openSetup("profiles")} className="text-sealed-text transition-colors duration-ui ease-ui hover:text-sealed-text-hover">
            Create one in Setup
          </button>
        </div>
      ) : (
        <div className="flex items-end justify-between gap-6">
          <div className="flex items-end gap-3">
            <Wheel label="Profile" options={profileOptions} value={profile?.id ?? null} onChange={pickProfile} className="w-[220px] shrink-0" />
            <Wheel label="Length" options={durationOptions} value={duration} onChange={pickDuration} className="w-[112px] shrink-0" mono />
          </div>
          {/* Labeled like the wheels: the note sits where their labels do, the button matches their boxes. */}
          <div className="flex w-[280px] min-w-0 shrink flex-col gap-1">
            {profile && closing.length ? (
              <span data-testid="focus-note" title={profileNote(profile, distractionCount)} className={`flex min-w-0 items-center gap-[6px] ${LABEL} text-text-2`}>
                <LockIcon size={10} className="shrink-0 text-sealed" />
                <span className="truncate">
                  {joinNames(closing)} {closing.length === 1 ? "closes" : "close"} when you enter
                </span>
              </span>
            ) : (
              <span data-testid="focus-note" title={profile ? profileNote(profile, distractionCount) : undefined} className={`truncate ${LABEL} text-faint`}>
                {profile ? profileNote(profile, distractionCount) : "Focus"}
              </span>
            )}
            {/* The label sits just above the button's center, so the pair of lines reads as centered. */}
            <Button variant="primary" size="cta" className="relative w-full" disabled={!profile} onClick={() => void enterFocus()}>
              <span data-testid="enter-label" className="-translate-y-[10px] leading-none">Enter focus</span>
              <span className="absolute left-1/2 top-[calc(50%+4px)] -translate-x-1/2 leading-none">
                <Kbd onFill>Ctrl ↵</Kbd>
              </span>
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

function SessionBar() {
  const session = useStore((s) => s.session);
  // The dev state toggle seals without a session; show the plan instead of a countdown.
  const fallbackProfile = useStore(selectedProfile)?.name ?? "No profile";
  const duration = useStore((s) => s.durationMin);
  const sealedAt = useStore((s) => s.sealedAt);
  const openEndEarly = useStore((s) => s.openEndEarly);

  const planned = session?.plannedMinutes ?? duration;
  const remaining = session?.remainingMs ?? planned * 60_000;
  const progress = session ? session.elapsedMs / (planned * 60_000) : 0;
  const ends = session?.endsAt ?? (sealedAt ?? Date.now()) + planned * 60_000;
  const sealed = session?.sealedCount ?? 0;
  const attempts = session?.attempts ?? 0;
  const name = session?.profileName ?? fallbackProfile;

  return (
    <section data-testid="session-bar" aria-label="Sealed session" className="flex flex-col gap-3 rounded-panel border border-sealed-line bg-panel p-3">
      <Strip tone="sealed" progress={progress}>
        <span className="truncate">
          <span className="font-medium text-sealed-text">{session?.idle ? "Paused" : "Sealed"}</span> · {session?.task ? <span className="font-medium text-text">{session.task.title} · </span> : null}
          {name} · {planned} min · ends {clock(ends)}
          {session?.idle ? " · Idle, the seal extends until you're back" : ""}
          {session?.broken ? " · Seal broken, the streak resets" : ""}
        </span>
      </Strip>
      <div className="flex items-end justify-between gap-6">
        <div className="flex items-end gap-3">
          <Field label="Profile" className="w-[220px] shrink-0">
            <span className="truncate text-[15px] font-semibold text-text">{name}</span>
          </Field>
          <Field label="Time left" className="w-[112px] shrink-0">
            <span role="timer" aria-label={`${countdown(remaining)} left`} className="font-mono text-[20px] font-medium tracking-[-0.02em] text-text">
              {countdown(remaining)}
            </span>
          </Field>
        </div>
        <div className="flex w-[280px] min-w-0 shrink flex-col gap-1">
          <span className={`truncate ${LABEL} text-text-2`}>
            {sealed} {sealed === 1 ? "app" : "apps"} sealed · {attempts} {attempts === 1 ? "attempt" : "attempts"} blocked
          </span>
          <div className="flex h-[82px] flex-col gap-[6px]">
            <Button variant="raised" className="h-auto! w-full flex-1" onClick={() => void native.showCompact()}>
              Compact<Kbd>Ctrl M</Kbd>
            </Button>
            <Button variant="ghost" className="h-auto! w-full flex-1" onClick={openEndEarly}>
              End early
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

/** The meeting holding focus (SPEC 4.0, In event): the same card as Open and Sealed, in coral. */
function EventBar() {
  const meeting = useStore((s) => s.meeting);
  const queued = useStore((s) => s.focusQueued);
  const setQueued = useStore((s) => s.setFocusQueued);
  const profile = useStore(selectedProfile);
  const now = useNow(1_000);
  // The dev toggle has no meeting: a sample 60-minute one, 18 minutes from its end.
  const sample = useMemo(() => ({ startMs: Date.now() - 42 * 60_000, endMs: Date.now() + 18 * 60_000 }), []);
  const e = meeting ? meetingLabels(meeting, now) : SAMPLE_EVENT;
  const { startMs, endMs } = meeting ?? sample;
  const left = Math.max(0, endMs - now);
  const progress = endMs > startMs ? (now - startMs) / (endMs - startMs) : 0;
  return (
    <section data-testid="event-bar" aria-label="In event" className="flex flex-col gap-3 rounded-panel border border-event-line bg-panel p-3">
      <Strip tone="event" progress={progress}>
        <span className="truncate">
          <span className="font-medium text-event">In event</span> · {e.range} · {e.left} left
        </span>
        {meeting?.htmlLink ? (
          <button type="button" onClick={() => void native.gcalOpen(meeting.htmlLink!)} className="ml-auto shrink-0 text-sealed-text transition-colors duration-ui ease-ui hover:text-sealed-text-hover">
            Open in Google
          </button>
        ) : null}
      </Strip>
      <div className="flex items-end justify-between gap-6">
        <div className="flex items-end gap-3">
          <Field label="Event" className="w-[220px] shrink-0">
            <span className="truncate text-[15px] font-semibold text-text">{e.title}</span>
          </Field>
          <Field label="Time left" className="w-[112px] shrink-0">
            <span role="timer" aria-label={`${e.left} left`} className="font-mono text-[20px] font-medium tracking-[-0.02em] text-text">
              {countdown(left)}
            </span>
          </Field>
        </div>
        <div className="flex w-[280px] min-w-0 shrink flex-col gap-1">
          <span className={`truncate ${LABEL} text-text-2`}>{queued && profile ? `${profile.name} starts when it ends` : "Focus unlocks when it ends"}</span>
          {queued ? (
            <Button variant="ghost" size="cta" className="w-full text-[15px]" onClick={() => setQueued(false)}>
              Cancel queue
            </Button>
          ) : (
            <Button variant="tint" size="cta" className="w-full text-[15px]" disabled={!profile} onClick={() => setQueued(true)}>
              Queue focus at {e.until}
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}

// --- Panels: collapse to their header (remembered) or hide via Customize ---

/** Today's routines, items, and calendar events. */
function useTodayAgenda(): AgendaItem[] {
  const today = todayKey();
  const days = useMemo(() => [today], [today]);
  return useAgenda(days)[today] ?? [];
}

/** The item a running seal belongs to: its linked task, or a block that is now with the session's profile. */
function useNowKey(items: AgendaItem[]): string | null {
  const session = useStore((s) => s.session);
  if (!session) return null;
  const task = session.task;
  if (task) return items.find((i) => sameTask(task, i))?.key ?? null;
  const now = Date.now();
  return (
    items.find((i) => {
      const t = blockTimes(i);
      return t && i.profileId === session.profileId && t.startsAt <= now && now < t.endsAt;
    })?.key ?? null
  );
}

/** One row: a routine or an item you can check off, focus on, and (untimed) drag into place. */
function TaskRow({ t, current, linked, canLink, tag, drag }: { t: AgendaItem; current: boolean; linked: boolean; canLink: boolean; tag?: string; drag: DragKit }) {
  const toggle = usePlanner((s) => s.toggle);
  const movable = canReorder(t);
  const over = drag.over?.key === t.key ? drag.over.after : null;
  return (
    <div
      data-now={current || undefined}
      data-testid="task-row"
      data-key={t.key}
      draggable={movable || undefined}
      onKeyDown={(e) => {
        // Alt+Up / Alt+Down: the keyboard way to drag.
        if (!movable || !e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
        e.preventDefault();
        drag.nudge(t, e.key === "ArrowUp" ? -1 : 1);
      }}
      onDragStart={movable ? (e) => drag.start(e, t) : undefined}
      onDragEnd={drag.end}
      onDragOver={(e) => drag.overRow(e, t)}
      onDrop={(e) => drag.drop(e, t)}
      className={`group row-in relative flex h-row shrink-0 items-center gap-[10px] border-l-2 px-[14px] transition-colors duration-ui ease-ui hover:bg-line-soft ${
        current || linked ? "border-l-sealed bg-sealed-tint" : "border-l-transparent"
      } ${movable ? "cursor-grab active:cursor-grabbing" : ""} ${drag.dragging === t.key ? "opacity-40" : ""}`}
    >
      {over !== null ? <span aria-hidden="true" className={`pointer-events-none absolute inset-x-[14px] h-[2px] rounded-full bg-sealed ${over ? "bottom-0" : "top-0"}`} /> : null}
      <button
        type="button"
        role="checkbox"
        aria-checked={t.done}
        aria-label={t.title}
        onClick={() => void toggle(t)}
        className={`check-pop box-border flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] p-0 text-sealed-on transition-colors duration-ui ease-ui ${
          t.done ? "border border-sealed bg-sealed hover:brightness-110" : "border-[1.5px] border-check-line bg-transparent hover:border-muted"
        }`}
      >
        {t.done ? <CheckIcon /> : null}
      </button>
      <span className={`min-w-0 grow truncate text-body transition-colors duration-ui ease-ui ${t.done ? "text-faint line-through" : "text-text"}`}>{t.title}</span>
      {current ? <span className="text-[11px] font-medium text-sealed-text">Now</span> : null}
      {canLink && !t.done ? (
        // Links the next session to this task (and its profile). Shown on hover, kept while linked.
        <button
          type="button"
          aria-pressed={linked}
          aria-label={linked ? `Unlink ${t.title}` : `Focus on ${t.title}`}
          onClick={() => useStore.getState().setFocusTask(linked ? null : { kind: t.kind as TaskLink["kind"], id: t.id, date: t.date, title: t.title, profileId: t.profileId })}
          className={`flex h-5 shrink-0 items-center rounded-[4px] px-[7px] text-[11px] font-medium transition-[opacity,color,background-color] duration-ui ease-ui focus-visible:opacity-100 ${
            linked ? "bg-sealed text-sealed-on" : "border border-line-input text-text-2 opacity-0 hover:text-text group-hover:opacity-100"
          }`}
        >
          {linked ? "For focus" : "Focus"}
        </button>
      ) : null}
      {tag ? <span className="flex h-5 shrink-0 items-center rounded-[4px] border border-line-input px-[7px] text-[11px] text-text-2">{tag}</span> : null}
      {/* No time, no time column: the tag sits at the far right. */}
      {t.time ? <span className="w-[46px] shrink-0 text-right font-mono text-[11px] text-muted">{shortTime(t.time)}</span> : null}
    </div>
  );
}

function EventRow({ t, now }: { t: AgendaItem; now: number }) {
  const times = blockTimes(t);
  const past = times ? times.endsAt <= now : false;
  return (
    <div data-kind="event" className="flex h-row shrink-0 items-center gap-[10px] border-l-2 border-l-transparent px-[14px]">
      <span aria-hidden="true" className={`ml-[6px] mr-[5px] h-4 w-[3px] shrink-0 rounded-[2px] ${past ? "bg-line-input" : t.profileId !== null ? "bg-sealed" : "bg-event"}`} />
      <span className={`min-w-0 grow truncate text-body ${past ? "text-faint" : "text-text-2"}`}>{t.title}</span>
      <span className="shrink-0 text-[11px] text-faint">Calendar</span>
      <span className="w-[46px] shrink-0 text-right font-mono text-[11px] text-muted">{t.time ? shortTime(t.time) : "all day"}</span>
    </div>
  );
}

interface DragKit {
  dragging: string | null;
  over: { key: string; after: boolean } | null;
  start: (e: React.DragEvent, t: AgendaItem) => void;
  end: () => void;
  overRow: (e: React.DragEvent, t: AgendaItem) => void;
  drop: (e: React.DragEvent, t: AgendaItem) => void;
  /** Moves an item one place up (-1) or down (1) among the ones it can swap with. */
  nudge: (t: AgendaItem, dir: -1 | 1) => void;
}

/**
 * Drag to reorder untimed, open items within one column. `save` gets the moved item, the one it
 * landed on, and whether it went below it.
 */
function useReorder(items: readonly AgendaItem[], save: (moved: AgendaItem, target: AgendaItem, after: boolean) => void): DragKit {
  // The dragged item lives in a ref too, so drag events between renders see it.
  const held = useRef<AgendaItem | null>(null);
  const [dragging, setDragging] = useState<AgendaItem | null>(null);
  const [over, setOver] = useState<{ key: string; after: boolean } | null>(null);
  const fits = (t: AgendaItem) => held.current !== null && canReorder(t) && t.kind === held.current.kind && t.key !== held.current.key;
  const below = (e: React.DragEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return e.clientY > r.top + r.height / 2;
  };
  return {
    dragging: dragging?.key ?? null,
    over,
    start: (e, t) => {
      held.current = t;
      setDragging(t);
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", t.title);
    },
    end: () => {
      held.current = null;
      setDragging(null);
      setOver(null);
    },
    overRow: (e, t) => {
      if (!fits(t)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      const after = below(e);
      if (over?.key !== t.key || over.after !== after) setOver({ key: t.key, after });
    },
    nudge: (t, dir) => {
      const peers = items.filter((i) => canReorder(i) && i.kind === t.kind);
      const next = peers[peers.findIndex((i) => i.key === t.key) + dir];
      if (!next) return;
      save(t, next, dir > 0);
      // The row moves in the DOM; keep the keyboard on it.
      requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-key="${t.key}"] [role="checkbox"]`)?.focus());
    },
    drop: (e, t) => {
      const moved = held.current;
      if (!fits(t) || !moved) return;
      e.preventDefault();
      save(moved, t, below(e));
      held.current = null;
      setDragging(null);
      setOver(null);
    },
  };
}

function ColumnHead({ title, items, first }: { title: string; items: AgendaItem[]; first?: ReactNode }) {
  const tasks = items.filter((i) => i.kind !== "event");
  return (
    <div className="flex h-10 shrink-0 items-center gap-2 px-[14px]">
      {first}
      <h2 className="m-0 grow text-body font-semibold text-text">{title}</h2>
      <span className="font-mono text-meta text-muted">
        {tasks.filter((t) => t.done).length}/{tasks.length}
      </span>
    </div>
  );
}

/**
 * Today on Home: routines on the left, what belongs to this day on the right (one-time items and
 * calendar events). Timed items run in time order, untimed ones in the order you drag them into,
 * and checked-off items sink to the bottom.
 */
function TodayPanel({ strip }: { strip: boolean }) {
  const all = useTodayAgenda();
  const routines = useMemo(() => openFirst(all.filter((i) => i.kind === "routine")), [all]);
  const day = useMemo(() => openFirst(all.filter((i) => i.kind !== "routine")), [all]);
  const tasks = useMemo(() => all.filter((i) => i.kind !== "event"), [all]);
  const profiles = useStore((s) => s.profiles);
  const nowKey = useNowKey(tasks);
  const focusTask = useStore((s) => s.focusTask);
  const canLink = useStore((s) => s.appState === "open" && !s.session);
  const collapsed = useStore((s) => s.settings.homeLayout.collapsed.includes("today"));
  const toggleCollapsed = useStore((s) => s.toggleHomeCollapsed);
  const now = useNow();

  const routineDrag = useReorder(routines, (moved, target, after) => {
    const ids = [...usePlanner.getState().routines].sort((a, b) => a.sort - b.sort || a.id - b.id).map((r) => r.id);
    void usePlanner.getState().reorderRoutines(moveId(ids, moved.id, target.id, after));
  });
  const dayDrag = useReorder(day, (moved, target, after) => {
    const ids = usePlanner
      .getState()
      .todos.filter((t) => t.dueDate === moved.date)
      .sort((a, b) => a.sort - b.sort || a.id - b.id)
      .map((t) => t.id);
    void usePlanner.getState().reorderTodos(moveId(ids, moved.id, target.id, after));
  });

  const row = (t: AgendaItem, drag: DragKit) =>
    t.kind === "event" ? (
      <EventRow key={t.key} t={t} now={now} />
    ) : (
      <TaskRow
        key={t.key}
        t={t}
        current={t.key === nowKey}
        linked={canLink && focusTask !== null && sameTask(focusTask, t)}
        canLink={canLink}
        tag={profiles.find((p) => p.id === t.profileId)?.name}
        drag={drag}
      />
    );

  return (
    <section aria-label="Today" className={`flex min-h-0 flex-col overflow-hidden rounded-panel border border-line bg-panel ${collapsed ? "" : "h-full"}`}>
      <div className={`grid shrink-0 grid-cols-2 ${collapsed ? "" : "border-b border-line"}`}>
        <ColumnHead
          title="Routines"
          items={routines}
          first={
            <button
              type="button"
              aria-expanded={!collapsed}
              aria-label={collapsed ? "Show Today" : "Collapse Today"}
              onClick={() => toggleCollapsed("today")}
              className="-ml-1 flex h-6 w-6 items-center justify-center rounded-control text-faint transition-colors duration-ui ease-ui hover:bg-line-soft hover:text-text-2"
            >
              <ChevronIcon size={10} className={`transition-transform duration-ui ease-ui ${collapsed ? "-rotate-90" : ""}`} />
            </button>
          }
        />
        <div className="border-l border-line">
          <ColumnHead title="Today" items={day} />
        </div>
      </div>
      {collapsed ? null : (
        <div className="grid min-h-0 grow grid-cols-2">
          <div data-testid="routines-column" className="flex min-h-0 flex-col overflow-y-auto py-1">
            {routines.length === 0 ? <p className="m-0 px-[14px] py-3 text-meta text-faint">No routines today.</p> : null}
            {routines.map((t) => row(t, routineDrag))}
          </div>
          <div data-testid="day-column" className="flex min-h-0 flex-col border-l border-line">
            <QuickAddField
              date={todayKey()}
              label="Add a task for today"
              placeholder="Add a task for today"
              prefix={<PlusIcon className="shrink-0 text-faint" />}
              className="flex h-[38px] shrink-0 cursor-text items-center gap-[10px] border-b border-line px-[14px] transition-colors duration-ui ease-ui hover:bg-line-soft"
            />
            <div className="flex min-h-0 grow flex-col overflow-y-auto py-1">
              {day.length === 0 ? <p className="m-0 px-[14px] py-3 text-meta text-faint">Nothing else planned today.</p> : null}
              {day.map((t) => row(t, dayDrag))}
            </div>
            <PendingTab />
          </div>
        </div>
      )}
      {strip && !collapsed ? <FocusStrip /> : null}
    </section>
  );
}

/** Focus today against the goal, and the next check-in: one line under the list. */
function FocusStrip() {
  const done = useStore((s) => s.focusTodayMin);
  const live = useStore((s) => s.session);
  const goal = useStore((s) => s.settings.dailyGoalMin);
  const next = useTrackers((s) => s.next);
  useEffect(() => {
    const t = setInterval(() => void useTrackers.getState().refreshNext(), 60_000);
    return () => clearInterval(t);
  }, []);
  // Finished sessions from the backend, plus the running one as it ticks.
  const total = done + (live ? Math.floor(live.elapsedMs / 60_000) : 0);
  return (
    <div data-testid="focus-strip" className="flex h-10 shrink-0 items-center gap-3 border-t border-line bg-panel-footer px-[14px] text-meta">
      <span className="shrink-0 text-muted">Focus today</span>
      <div className="h-1 w-[120px] shrink-0 overflow-hidden rounded-full bg-line">
        <div className="h-full bg-sealed transition-[width] duration-enter ease-ui" style={{ width: `${Math.min(100, (total / goal) * 100)}%` }} />
      </div>
      <span className="shrink-0 font-mono text-text">
        {minutes(total)} / {minutes(goal)}
      </span>
      <span className="ml-auto flex min-w-0 items-center gap-[6px]">
        <span className="shrink-0 whitespace-nowrap text-muted">Next check-in</span>
        <span className="truncate text-text">{next ? `${next.name} · ${longTime(next.time)}` : "None today"}</span>
      </span>
    </div>
  );
}

const PANELS: { id: HomePanel; label: string }[] = [
  { id: "today", label: "Today list" },
  { id: "progress", label: "Focus today" },
  { id: "streak", label: "Streak" },
  { id: "hint", label: "Empty schedule hint" },
];

function CustomizeMenu() {
  const hidden = useStore((s) => s.settings.homeLayout.hidden);
  const setHidden = useStore((s) => s.setHomeHidden);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", close);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <Button variant="ghost" aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen(!open)}>
        Customize
      </Button>
      {open ? (
        <div role="menu" aria-label="Customize Home" className="absolute right-0 top-[38px] z-30 flex w-[220px] animate-rise-in flex-col rounded-panel border border-line-input bg-panel p-1 shadow-toast">
          <span className="px-2 pb-1 pt-2 text-[11px] font-medium uppercase tracking-[0.06em] text-faint">Show on Home</span>
          {PANELS.map((p) => (
            <div key={p.id} className="flex h-control items-center justify-between rounded-control px-2 hover:bg-line-soft">
              <span className="text-body text-text">{p.label}</span>
              <Switch label={`Show ${p.label}`} checked={!hidden.includes(p.id)} onChange={(v) => setHidden(p.id, !v)} />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function Home() {
  const appState = useStore((s) => s.appState);
  const hidden = useStore((s) => s.settings.homeLayout.hidden);
  const meeting = useStore((s) => s.meeting);
  const [a, b] = homeHeadline(appState, meeting ? meetingLabels(meeting, Date.now()) : SAMPLE_EVENT);
  const show = (p: HomePanel) => !hidden.includes(p);
  const open = appState === "open";

  return (
    <div className="flex h-full flex-col gap-4 px-7 pb-6 pt-5">
      <div className="flex h-control items-center justify-between">
        <span className={`text-body transition-colors duration-700 ease-ui ${open ? "text-muted" : "text-text"}`}>{formatDate(new Date())}</span>
        {/* Sealed or in an event, the tools step aside and come back when the state returns to Open. */}
        <div
          data-testid="home-tools"
          inert={!open}
          aria-hidden={!open || undefined}
          className={`flex items-center gap-2 transition-[opacity,transform,visibility] duration-500 ease-ui ${open ? "visible opacity-100" : "invisible -translate-y-[6px] opacity-0"}`}
        >
          {show("streak") ? <StreakChip /> : null}
          <button
            type="button"
            onClick={useStore.getState().openCommand}
            className="flex h-control w-[200px] items-center gap-2 rounded-control border border-line bg-panel px-[10px] text-body text-muted transition-colors duration-ui ease-ui hover:border-line-input hover:text-text-2"
          >
            <SearchIcon />
            <span className="grow text-left">Search or command</span>
            <span className="font-mono text-[11px] text-faint">Ctrl K</span>
          </button>
          <CustomizeMenu />
        </div>
      </div>

      <h1 className="headline m-0 text-moment">
        {a} <em>{b}</em>
      </h1>

      {appState === "open" && <FocusPanel />}
      {appState === "sealed" && <SessionBar />}
      {appState === "event" && <EventBar />}

      {show("today") ? (
        <div className="flex min-h-0 grow flex-col">
          <TodayPanel strip={show("progress")} />
        </div>
      ) : null}
    </div>
  );
}
