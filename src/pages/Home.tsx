import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CheckIcon, ChevronIcon, LockIcon, PlusIcon, SearchIcon, XIcon } from "../components/icons";
import { durationsMin } from "../theme/tokens";
import { selectedProfile, useStore, type HomePanel } from "../state/store";
import { usePlanner } from "../state/planner";
import { useAgenda } from "../state/calendar";
import { meetingLabels } from "../lib/calendar";
import { useNow } from "../lib/useNow";
import { errorText, native } from "../lib/native";
import { profileNote } from "../lib/rules";
import { Button, Kbd } from "../components/Button";
import { Switch } from "../components/controls";
import { Odometer } from "../components/Odometer";
import { QuickAddField } from "../components/QuickAdd";
import { PendingTab } from "./week/Pending";
import { CounterRow } from "./CounterRow";
import { Glide } from "../lib/motion";
import { DUR, EASE, gsap, useGSAP } from "../lib/gsap";
import { getMoment, useMotion } from "../lib/useMotion";
import { useFocusToday, useWeekOverview } from "../state/session";
import { DayRuler } from "./DayRuler";
import { FocusPicker } from "./FocusPicker";
import { BREAK_TIPS, homeLine, pick } from "./headlines";
import { SAMPLE_EVENT } from "./placeholders";
import { clock, countdown, joinNames, minutes } from "../lib/time";
import { blockTimes, canReorder, moveId, msUntilReset, openFirst, shortTime, todayKey, type AgendaItem, type Suggestion } from "../lib/planner";
import type { DayStat, StatsOverview, TaskLink } from "../lib/types";

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

/** A day's cell in the strip: 6 by 12, the decided day states. Kept is the second colour. */
function DayCell({ d, today, focused, goal, met }: { d: DayStat; today: boolean; focused: number; goal: number; met: boolean }) {
  const base = "relative box-border block h-3 w-[6px] rounded-[2px]";
  if (today && (d.status === "today" || d.status === "kept")) {
    // Today fills with the accent as you focus; at the goal the kept layer crossfades in over it.
    return (
      <span data-status={met ? "kept" : "today"} data-today-cell className={`${base} border border-sealed`}>
        <span
          className="absolute inset-x-0 bottom-0 h-full origin-bottom rounded-[1px] bg-sealed transition-transform duration-glide ease-glide"
          style={{ transform: `scaleY(${Math.min(1, goal > 0 ? focused / goal : 0)})` }}
        />
        {met ? <span data-cell-kept className="absolute -inset-px rounded-[2px] bg-second ring-1 ring-second-line" /> : null}
      </span>
    );
  }
  const look: Partial<Record<DayStat["status"], string>> = {
    kept: "bg-second ring-1 ring-second-line",
    missed: "border border-muted",
    broken: "bg-broken",
    rest: "border border-dashed border-check-line",
  };
  return <span data-status={d.status} className={`${base} ${look[d.status] ?? "bg-line opacity-50"}`} />;
}

/** The days strip's key: shown only while the streak is hovered or focused, beside it, so the chip never moves. */
function StripKey() {
  const swatch = "relative box-border block h-[10px] w-[6px] overflow-hidden rounded-[2px]";
  return (
    <span
      data-testid="streak-key"
      aria-hidden="true"
      className="pointer-events-none absolute right-[calc(100%+8px)] top-[-1px] flex h-control items-center gap-[9px] whitespace-nowrap rounded-control border border-line bg-panel px-[10px] text-[11px] text-muted opacity-0 transition-[clip-path,opacity] duration-state ease-ui [clip-path:inset(0_0_0_100%)] group-hover:opacity-100 group-hover:delay-150 group-hover:[clip-path:inset(0)] group-focus-visible:opacity-100 group-focus-visible:delay-150 group-focus-visible:[clip-path:inset(0)]"
    >
      <span className="flex items-center gap-1">
        <span className={`${swatch} bg-second ring-1 ring-second-line`} />
        Kept
      </span>
      <span className="flex items-center gap-1">
        <span className={`${swatch} border border-muted`} />
        Missed
      </span>
      <span className="flex items-center gap-1">
        <span className={`${swatch} border border-sealed`}>
          <span className="absolute inset-x-0 bottom-0 h-1/2 bg-sealed" />
        </span>
        Today
      </span>
    </span>
  );
}

/** The streak and the last 7 days (SPEC 4.10). Opens Stats. */
function StreakChip({ o, delay }: { o: StatsOverview | null; delay: number }) {
  const navigate = useStore((s) => s.navigate);
  const { minutes: focused, goal, met } = useFocusToday();
  const n = o?.currentStreak ?? 0;
  const days = o?.days ?? [];
  const kept = days.filter((d, i) => d.status === "kept" || (i === days.length - 1 && met)).length;
  const label = `${n} day streak, ${kept} of the last ${days.length || 7} days kept${met ? "" : `, today ${minutes(focused)} of ${minutes(goal)}`}. Open Stats`;
  return (
    <button
      type="button"
      data-testid="streak"
      aria-label={label}
      onClick={() => navigate("stats")}
      className="group relative flex h-control shrink-0 items-center gap-[10px] rounded-control border border-line bg-panel px-[10px] text-meta text-text transition-colors duration-ui ease-ui hover:border-line-input"
    >
      <Odometer text={String(n)} delay={delay} className="font-mono font-medium" />
      <span className="text-muted">day streak</span>
      {/* Never miss twice (v0.3.1): yesterday was missed, so today keeps it alive. */}
      {o?.streakAtRisk && o.days.at(-1)?.status === "today" ? <span className="text-text-2">· keep it today</span> : null}
      <span className="flex items-center gap-[3px]" aria-hidden="true">
        {days.map((d, i) => (
          <DayCell key={d.date} d={d} today={i === days.length - 1} focused={focused} goal={goal} met={met} />
        ))}
      </span>
      <StripKey />
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
        className={`rounded-[4px] px-[6px] py-[2px] text-[11px] font-medium ${s.state === "now" ? "bg-sealed text-sealed-on" : "bg-line text-text-2"}`}
      >
        {s.state === "now" ? "Now" : "Next"}
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
      <span className="rounded-[4px] bg-sealed px-[6px] py-[2px] text-[11px] font-medium text-sealed-on">For</span>
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

// --- The state card: Open, Sealed, and In event share one shape (ProtoToday) ---
// Labeled 52px boxes in a row: Open has the Profile and Length pickers and Enter focus; Sealed
// fills the same slots with the profile, the time left and End early, so entering crossfades in place.

const BOX = "flex h-[52px] items-center justify-center rounded-control border border-line-input bg-raised px-3";
const ROW = "grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] items-end gap-[14px]";

/** A labeled box the size of a picker, holding a value instead. */
function Field({ label, children, className = "", cell }: { label: ReactNode; children: ReactNode; className?: string; cell?: "sealed" | "open" }) {
  return (
    <div data-sealed-cell={cell === "sealed" || undefined} className={`flex min-w-0 flex-col gap-[7px] ${className}`}>
      <span className="label truncate">{label}</span>
      <div className={BOX}>{children}</div>
    </div>
  );
}

/** A thin track along a card's bottom edge, filled to `progress` (a transform, never a width). */
function Track({ progress, tone }: { progress: number; tone: "sealed" | "event" | "open" }) {
  const bar = tone === "sealed" ? "bg-sealed" : tone === "event" ? "bg-event" : "bg-open";
  return (
    <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-[2px] bg-line">
      <span
        data-track
        className={`absolute inset-0 origin-left transition-transform duration-glide ease-glide ${bar}`}
        style={{ transform: `scaleX(${Math.min(1, Math.max(0, progress))})` }}
      />
    </span>
  );
}

/** Where you left off last time on this task or profile, when you wrote it down (v0.3.1). */
function LeftOffLine() {
  const profileId = useStore(selectedProfile)?.id;
  const task = useStore((s) => s.focusTask);
  const leftOff = useStore((s) => s.focusLeftOff);
  useEffect(() => {
    void useStore.getState().prepareFocus();
  }, [profileId, task]);
  if (!leftOff) return null;
  return (
    <p data-testid="left-off" className="m-0 truncate border-t border-line-soft pt-3 text-meta text-text-2" title={leftOff.text}>
      <span className="text-muted">Last time: </span>
      {leftOff.text}
    </p>
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
    <section data-testid="focus-row" aria-label="Focus" className="flex flex-col gap-[14px] rounded-dialog border border-line bg-panel p-[18px]">
      {task ? <TaskStrip task={task} /> : <SuggestedCard s={suggestion} />}
      {profiles.length === 0 ? (
        <div className="flex h-[120px] items-center justify-center gap-2 rounded-control border border-dashed border-line-input text-body text-muted">
          No profiles yet.
          <button type="button" onClick={() => useStore.getState().openSetup("profiles")} className="text-sealed-text transition-colors duration-ui ease-ui hover:text-sealed-text-hover">
            Create one in Setup
          </button>
        </div>
      ) : (
        <div className={ROW}>
          <FocusPicker label="Profile" options={profileOptions} value={profile?.id ?? null} onChange={pickProfile} />
          <FocusPicker label="Length" options={durationOptions} value={duration} onChange={pickDuration} mono />
          <div data-open-cell className="flex min-w-0 flex-col gap-[7px]">
            {profile && closing.length ? (
              <span data-testid="focus-note" title={profileNote(profile, distractionCount)} className="label flex min-w-0 items-center gap-[6px]">
                <LockIcon size={10} className="shrink-0 text-sealed" />
                <span className="truncate">
                  <span className="text-text-2">{joinNames(closing)}</span> {closing.length === 1 ? "closes" : "close"} when you enter
                </span>
              </span>
            ) : (
              <span data-testid="focus-note" title={profile ? profileNote(profile, distractionCount) : undefined} className="label truncate">
                {profile ? profileNote(profile, distractionCount) : "Focus"}
              </span>
            )}
            {/* The fill is its own layer: entering focus, it collapses into the sealed card's seal line. */}
            <button
              type="button"
              disabled={!profile}
              onClick={() => void enterFocus()}
              className="relative h-[52px] w-full rounded-control p-0 text-[17px] font-semibold text-sealed-on transition-[filter] duration-ui ease-ui hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:brightness-100"
            >
              <span data-seal-src aria-hidden="true" className="absolute inset-0 rounded-control bg-sealed" />
              <span data-testid="enter-label" className="relative flex items-center justify-center gap-[10px] leading-none">
                Enter focus <Kbd onFill>Ctrl ↵</Kbd>
              </span>
            </button>
          </div>
        </div>
      )}
      {profiles.length ? <LeftOffLine /> : null}
    </section>
  );
}

/** Park a thought for later (v0.3.1): it becomes a task for today, out of your head and off
 *  the screen. Ctrl Alt P does the same from any app while sealed. */
function ParkField() {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  // Ctrl Alt P is registered as the seal starts; if another app holds it, say so here.
  const [hotkeyFailed, setHotkeyFailed] = useState<string | null>(null);
  useEffect(() => void native.focusParkHotkey().then(setHotkeyFailed, () => undefined), []);
  const park = async () => {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    try {
      await native.focusPark(t);
      setText("");
      void usePlanner.getState().reload();
      useStore.getState().showNotice({ lead: "Parked.", rest: "It's on today's list for after the seal." });
    } catch (e) {
      useStore.getState().showNotice({ lead: errorText(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      data-testid="park"
      onSubmit={(e) => {
        e.preventDefault();
        void park();
      }}
      className="focus-ring-within flex h-8 items-center gap-2 rounded-control border border-line-input bg-raised pl-3 pr-1 transition-colors duration-ui ease-ui focus-within:border-sealed-line"
    >
      <input
        value={text}
        maxLength={200}
        onChange={(e) => setText(e.target.value)}
        placeholder="Park a thought for later"
        aria-label="Park a thought for later"
        className="focus-ring-off min-w-0 flex-1 border-0 bg-transparent text-body text-text placeholder:text-faint"
      />
      {hotkeyFailed ? (
        <span title={hotkeyFailed} className="shrink-0 whitespace-nowrap text-[11px] text-muted">
          Ctrl Alt P is taken by another app
        </span>
      ) : (
        <Kbd>Ctrl Alt P</Kbd>
      )}
      <Button type="submit" variant="quiet" size="sm" disabled={!text.trim() || busy}>
        Park
      </Button>
    </form>
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
  const elapsedMin = session ? Math.floor(session.elapsedMs / 60_000) : 0;
  const leftMin = Math.max(0, Math.ceil(remaining / 60_000));
  const progress = session ? session.elapsedMs / (planned * 60_000) : 0;
  const ends = session?.endsAt ?? (sealedAt ?? Date.now()) + planned * 60_000;
  const sealed = session?.sealedCount ?? 0;
  const attempts = session?.attempts ?? 0;
  const name = session?.profileName ?? fallbackProfile;

  return (
    <section data-testid="session-bar" aria-label="Sealed session" className="relative flex flex-col gap-[14px] overflow-hidden rounded-dialog border border-sealed-line bg-panel p-[18px]">
      <p className="m-0 truncate text-meta text-text-2">
        <span className="font-medium text-sealed-text">{session?.idle ? "Paused" : "Sealed"}</span> · {session?.task ? <span className="font-medium text-text">{session.task.title} · </span> : null}
        {session?.goal && session.goal !== session.task?.title ? <span className="font-medium text-text">{session.goal} · </span> : null}
        {name} · {planned} min · ends {clock(ends)} · {sealed} {sealed === 1 ? "app" : "apps"} sealed · {attempts} {attempts === 1 ? "attempt" : "attempts"} blocked
        {session?.idle ? " · Idle, the seal extends until you're back" : ""}
        {session?.broken ? " · Seal broken, the streak resets" : ""}
      </p>
      <div className={ROW}>
        <Field label="Profile" cell="sealed">
          <span className="truncate text-[15px] font-semibold text-text">{name}</span>
        </Field>
        <Field label="Time left" cell="sealed">
          <span role="timer" aria-label={`${leftMin} min left`} className="flex items-center gap-[0.35em] font-mono text-[15px] font-medium text-sealed-text">
            <Odometer text={String(leftMin)} direction="down" />
            <span aria-hidden="true">min</span>
          </span>
        </Field>
        <div data-sealed-cell className="flex min-w-0 flex-col gap-[7px]">
          <span className="label truncate">
            <span className="font-mono">{elapsedMin}</span> of <span className="font-mono">{planned}</span> min
          </span>
          {/* The exit is quiet: ending early is a choice, not the main action. */}
          <div className="flex h-[52px] items-center gap-2">
            <Button variant="ghost" onClick={openEndEarly}>
              End early
            </Button>
            <Button variant="quiet" onClick={() => void native.showCompact()}>
              Compact<Kbd>Ctrl M</Kbd>
            </Button>
          </div>
        </div>
      </div>
      {session ? <ParkField /> : null}
      <Track progress={progress} tone="sealed" />
      {/* The seal: Enter focus's fill lands here as a line, holds, then shows the track beneath. */}
      <span data-seal-line aria-hidden="true" className="invisible absolute inset-x-0 bottom-0 z-[2] h-[2px] bg-sealed opacity-0" />
    </section>
  );
}

/** A break after a seal (v0.3.1): a calm countdown, your Distractions list still closed, and
 *  the next block one click away. Ending it early is free. */
function BreakBar() {
  const brk = useStore((s) => s.brk)!;
  const now = useNow(1000);
  const left = Math.max(0, brk.until - now);
  const progress = 1 - left / (brk.minutes * 60_000);
  const profileName = useStore((s) => s.profiles.find((p) => p.id === brk.profileId)?.name);
  return (
    <section data-testid="break-bar" aria-label="Break" className="relative flex flex-col gap-[14px] overflow-hidden rounded-dialog border border-line bg-panel p-[18px]">
      <p className="m-0 truncate text-meta text-text-2">
        <span className="font-medium text-text">Break</span> · {pick(BREAK_TIPS, brk.until)} · your Distractions list waits too
      </p>
      <div className={ROW}>
        <Field label="Break left">
          <span role="timer" aria-label={`${countdown(left)} of break left`} className="font-mono text-[15px] font-medium text-text">
            {countdown(left)}
          </span>
        </Field>
        <div className="flex min-w-0 flex-col gap-[6px]">
          <Button variant="primary" className="w-full" onClick={() => void useStore.getState().nextBlock(brk)}>
            Next block{profileName ? `: ${profileName}` : ""}
          </Button>
          <Button variant="ghost" className="w-full" onClick={() => void native.breakEnd()}>
            End break
          </Button>
        </div>
      </div>
      <Track progress={progress} tone="open" />
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
    <section data-testid="event-bar" aria-label="In event" className="relative flex flex-col gap-[14px] overflow-hidden rounded-dialog border border-event-line bg-panel p-[18px]">
      <p className="m-0 flex items-center gap-3 text-meta text-text-2">
        <span className="min-w-0 truncate">
          <span className="font-medium text-event">In event</span> · {e.range} · {e.left} left
        </span>
        {meeting?.htmlLink ? (
          <button type="button" onClick={() => void native.gcalOpen(meeting.htmlLink!)} className="ml-auto shrink-0 text-sealed-text transition-colors duration-ui ease-ui hover:text-sealed-text-hover">
            Open in Google
          </button>
        ) : null}
      </p>
      <div className={ROW}>
        <Field label="Event">
          <span className="truncate text-[15px] font-semibold text-text">{e.title}</span>
        </Field>
        <Field label="Time left">
          <span role="timer" aria-label={`${e.left} left`} className="font-mono text-[15px] font-medium text-text">
            {countdown(left)}
          </span>
        </Field>
        <div className="flex min-w-0 flex-col gap-[7px]">
          <span className="label truncate">{queued && profile ? `${profile.name} starts when it ends` : "Focus unlocks when it ends"}</span>
          {queued ? (
            <Button variant="ghost" className="h-[52px]! w-full text-[15px]" onClick={() => setQueued(false)}>
              Cancel queue
            </Button>
          ) : (
            <Button variant="tint" className="h-[52px]! w-full text-[15px]" disabled={!profile} onClick={() => setQueued(true)}>
              Queue focus at {e.until}
            </Button>
          )}
        </div>
      </div>
      <Track progress={progress} tone="event" />
    </section>
  );
}

// --- Panels: collapse to their header (remembered) or hide via Customize ---

/** Today's routines, items, and calendar events. */
function useTodayAgenda(): AgendaItem[] {
  const dailyResetTime = useStore((s) => s.settings.dailyResetTime);
  const today = todayKey(new Date(), dailyResetTime);
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
      className={`group relative flex h-row shrink-0 items-center gap-[10px] border-l-2 px-[14px] transition-colors duration-ui ease-ui hover:bg-line-soft ${
        current || linked ? "border-l-sealed bg-sealed-tint" : "border-l-transparent"
      } ${movable ? "cursor-grab active:cursor-grabbing" : ""} ${drag.dragging === t.key ? "opacity-40" : ""}`}
    >
      {over !== null ? <span aria-hidden="true" className={`pointer-events-none absolute inset-x-[14px] h-[2px] rounded-full bg-sealed ${over ? "bottom-0" : "top-0"}`} /> : null}
      {(() => {
        const multi = t.kind === "routine" && (t.sessionsTarget ?? 1) > 1;
        const partial = multi && (t.sessionsDone ?? 0) > 0 && !t.done;
        const label = multi ? `${t.title} (${t.sessionsDone ?? 0} of ${t.sessionsTarget} sessions)` : t.title;
        return (
          <>
            <button
              type="button"
              role="checkbox"
              aria-checked={multi ? (t.done ? true : partial ? "mixed" : false) : t.done}
              aria-label={label}
              onClick={() => void toggle(t)}
              className={`check-pop box-border flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] p-0 text-sealed-on transition-colors duration-ui ease-ui ${
                t.done ? "border border-sealed bg-sealed hover:brightness-110" : partial ? "border border-sealed bg-sealed/25 hover:bg-sealed/35" : "border-[1.5px] border-check-line bg-transparent hover:border-muted"
              }`}
            >
              {t.done ? <CheckIcon /> : partial ? <span className="h-[6px] w-[6px] rounded-[2px] bg-sealed" /> : null}
            </button>
            <span className={`min-w-0 grow truncate text-body transition-colors duration-ui ease-ui ${t.done ? "text-faint line-through" : "text-text"}`}>{t.title}</span>
            {multi ? <span className="shrink-0 rounded-[4px] border border-line-input px-[6px] py-[1px] font-mono text-[11px] text-muted">{t.sessionsDone ?? 0}/{t.sessionsTarget}</span> : null}
          </>
        );
      })()}
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
  const routineList = usePlanner((s) => s.routines);
  const routines = useMemo(() => openFirst(all.filter((i) => i.kind === "routine")), [all]);
  // Counters (v0.1.4) sit at the top of Routines, in routine order; the rest list below.
  const counterOf = (i: AgendaItem) => routineList.find((r) => r.id === i.id && r.trackerId !== null);
  const counters = useMemo(
    () => all.filter((i) => i.kind === "routine" && counterOf(i)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [all, routineList],
  );
  const listed = useMemo(() => routines.filter((i) => !counters.includes(i)), [routines, counters]);
  const day = useMemo(() => openFirst(all.filter((i) => i.kind !== "routine")), [all]);
  const tasks = useMemo(() => all.filter((i) => i.kind !== "event"), [all]);
  const profiles = useStore((s) => s.profiles);
  const nowKey = useNowKey(tasks);
  const focusTask = useStore((s) => s.focusTask);
  const canLink = useStore((s) => s.appState === "open" && !s.session);
  const collapsed = useStore((s) => s.settings.homeLayout.collapsed.includes("today"));
  const toggleCollapsed = useStore((s) => s.toggleHomeCollapsed);
  const dailyResetTime = useStore((s) => s.settings.dailyResetTime);
  const now = useNow();
  const resetMs = msUntilReset(new Date(now), dailyResetTime);
  const routinesTitle = resetMs <= 60 * 60_000 ? `Routines reset in ${Math.max(1, Math.ceil(resetMs / 60_000))}m` : "Routines";

  const routineDrag = useReorder(listed, (moved, target, after) => {
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

  // Each row glides to its new place when the list reorders (v0.2).
  const row = (t: AgendaItem, drag: DragKit) => (
    <Glide key={t.key}>
      {t.kind === "event" ? (
        <EventRow t={t} now={now} />
      ) : (
        <TaskRow
        t={t}
        current={t.key === nowKey}
        linked={canLink && focusTask !== null && sameTask(focusTask, t)}
        canLink={canLink}
        tag={profiles.find((p) => p.id === t.profileId)?.name}
        drag={drag}
      />
      )}
    </Glide>
  );

  return (
    <section aria-label="Today" className={`flex min-h-0 flex-col overflow-hidden rounded-panel border border-line bg-panel ${collapsed ? "" : "h-full"}`}>
      <div className={`grid shrink-0 grid-cols-2 ${collapsed ? "" : "border-b border-line"}`}>
        <ColumnHead
          title={routinesTitle}
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
            {counters.map((t) => (
              <Glide key={t.key}>
                <CounterRow item={t} routine={counterOf(t)!} />
              </Glide>
            ))}
            {listed.map((t) => row(t, routineDrag))}
          </div>
          <div data-testid="day-column" className="flex min-h-0 flex-col border-l border-line">
            <QuickAddField
              date={todayKey(new Date(), dailyResetTime)}
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

/** Focus today against the goal: one line under the list, its goal mark in the second colour. */
function FocusStrip() {
  const { minutes: total, goal, met } = useFocusToday();
  return (
    <div data-testid="focus-strip" className="flex h-10 shrink-0 items-center gap-[14px] border-t border-line bg-panel-footer px-[14px] text-meta">
      <span className="shrink-0 text-muted">Focus today</span>
      <div className="relative h-[5px] grow rounded-full bg-raised">
        <div
          className="absolute inset-0 origin-left rounded-full bg-sealed transition-transform duration-glide ease-glide"
          style={{ transform: `scaleX(${Math.min(1, goal > 0 ? total / goal : 0)})` }}
        />
        {met ? <span data-strip-goal-glow className="absolute right-[-3px] top-[-4px] h-[13px] w-2 rounded-[2px] bg-second-tint" /> : null}
        <div className="absolute right-0 top-[-4px] h-[13px] w-[2px] rounded-[1px] bg-second" />
      </div>
      <span className="shrink-0 font-mono text-text [word-spacing:-0.3em]">
        <Odometer text={minutes(total)} /> / {minutes(goal)}
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
          <span className="label px-2 pb-1 pt-2">Show on Home</span>
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

/** A rect relative to another element's box. */
function relRect(el: Element, to: Element) {
  const r = el.getBoundingClientRect();
  const o = to.getBoundingClientRect();
  return { left: r.left - o.left, top: r.top - o.top, width: r.width, height: r.height };
}

/**
 * Entering focus (motion spec §3): driven by state, not the click, so Ctrl Enter, the tray and a
 * scheduled start all play it. The store's subscription runs inside set(), before React swaps the
 * open card for the sealed one, so it can measure the Enter focus fill. A session resumed at launch
 * never had an open card, so it plays nothing.
 */
function useEnterFocusMoment(root: React.RefObject<HTMLDivElement | null>, run: ReturnType<typeof useMotion>["run"]) {
  const appState = useStore((s) => s.appState);
  const from = useRef<ReturnType<typeof relRect> | null>(null);
  useEffect(
    () =>
      useStore.subscribe((s, p) => {
        if (p.appState !== "sealed" && s.appState === "sealed" && root.current) {
          const src = root.current.querySelector("[data-seal-src]");
          from.current = src ? relRect(src, root.current) : null;
        }
      }),
    [root],
  );
  useGSAP(
    () => {
      const b = from.current;
      from.current = null;
      if (appState !== "sealed") {
        // Leaving mid-moment: finish it first, so nothing is left half-way.
        getMoment("enter-focus")?.progress(1);
        return;
      }
      const line = root.current?.querySelector("[data-seal-line]");
      if (!b || !line || !root.current) return;
      const r = relRect(line, root.current);
      run(() =>
        gsap
          .timeline({ id: "enter-focus" })
          .addLabel("seal", 0)
          // The button's fill collapses into the thin seal line along the card's bottom edge.
          .fromTo(
            line,
            { autoAlpha: 1, transformOrigin: "0 0", x: b.left - r.left, y: b.top - r.top, scaleX: b.width / Math.max(1, r.width), scaleY: b.height / Math.max(1, r.height) },
            { x: 0, y: 0, scaleX: 1, scaleY: 1, duration: 0.38, ease: EASE.settle },
            "seal",
          )
          .from("[data-sealed-cell]", { opacity: 0, duration: DUR.state, ease: EASE.ui, stagger: 0.04, clearProps: "opacity" }, 0.08)
          .fromTo("[data-headline]", { opacity: 0.4 }, { opacity: 1, duration: DUR.state, ease: EASE.ui, clearProps: "opacity" }, 0.1)
          .addLabel("line", 0.38)
          // It holds, then fades to show the real track and fill beneath.
          .to(line, { autoAlpha: 0, duration: 0.4, ease: EASE.ui, clearProps: "transform,opacity,visibility" }, "line+=0.2"),
      );
    },
    { scope: root, dependencies: [appState] },
  );
}

/**
 * Goal reached (motion spec §4): the day is kept. Only when the goal is met while Today is on
 * screen; mounting with the goal already met plays nothing, since a late celebration is stale.
 * Ruler, then the goal tick, then the day turns kept, then the streak (its odometer waits).
 */
function useGoalMoment(root: React.RefObject<HTMLDivElement | null>, run: ReturnType<typeof useMotion>["run"], met: boolean) {
  const wasMet = useRef(met);
  const [justKept, setJustKept] = useState(false);
  useGSAP(
    () => {
      const kept = met && !wasMet.current;
      wasMet.current = met;
      if (!kept || !root.current) return;
      setJustKept(true);
      const has = (sel: string) => root.current!.querySelector(sel) !== null;
      run(() => {
        const tl = gsap.timeline({ id: "goal", defaults: { ease: EASE.drift }, onComplete: () => setJustKept(false) });
        tl.addLabel("flare", 0.3);
        if (has("[data-goal-glow]")) {
          tl.fromTo("[data-goal-glow]", { opacity: 0 }, { opacity: 1, duration: 0.35, ease: "power2.out" }, "flare").to("[data-goal-glow]", { opacity: 0.55, duration: DUR.drain, clearProps: "opacity" }, ">");
        }
        if (has("[data-goal-suffix]")) {
          tl.fromTo("[data-goal-suffix]", { clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0% 0 0)", duration: DUR.state, ease: EASE.ui, clearProps: "clipPath" }, "flare");
        }
        tl.fromTo("[data-headline]", { opacity: 0.4 }, { opacity: 1, duration: DUR.state, ease: EASE.ui, clearProps: "opacity" }, 0.4).addLabel("kept", 0.55);
        if (has("[data-today-cell] [data-cell-kept]")) {
          tl.fromTo("[data-today-cell] [data-cell-kept]", { autoAlpha: 0 }, { autoAlpha: 1, duration: DUR.moment, clearProps: "opacity,visibility" }, "kept");
        }
        if (has("[data-strip-goal-glow]")) {
          tl.fromTo("[data-strip-goal-glow]", { opacity: 0 }, { opacity: 1, duration: DUR.drain, clearProps: "opacity" }, "kept");
        }
        return tl;
      });
    },
    { scope: root, dependencies: [met] },
  );
  return justKept;
}

export function Home() {
  const root = useRef<HTMLDivElement>(null);
  const { run } = useMotion(root);
  const brk = useStore((s) => s.brk);
  const appState = useStore((s) => s.appState);
  const hidden = useStore((s) => s.settings.homeLayout.hidden);
  const meeting = useStore((s) => s.meeting);
  const finishing = useStore((s) => s.session !== null && s.session.remainingMs < 5 * 60_000);
  const { minutes: focused, goal, met } = useFocusToday();
  const overview = useWeekOverview();
  // Yesterday was missed and today isn't kept yet: the headline says so.
  const atRisk = !!overview?.streakAtRisk && overview.days.at(-1)?.status === "today";
  const headline = homeLine(appState, meeting ? meetingLabels(meeting, Date.now()) : SAMPLE_EVENT, new Date(), { finishing, goalMet: met, atRisk });
  const show = (p: HomePanel) => !hidden.includes(p);
  const open = appState === "open";
  useEnterFocusMoment(root, run);
  const justKept = useGoalMoment(root, run, met);

  return (
    <div ref={root} className="flex h-full flex-col gap-[22px] px-8 pb-[22px] pt-[26px]">
      <div className="flex min-h-control flex-wrap items-center gap-2 text-meta">
        <span className={`min-w-[160px] flex-1 text-body transition-colors duration-drain ease-ui ${open ? "text-muted" : "text-text"}`}>{formatDate(new Date())}</span>
        {/* The streak stays while sealed, so the day can turn kept on screen. */}
        {show("streak") ? <StreakChip o={overview} delay={justKept ? 0.95 : 0} /> : null}
        {/* Sealed or in an event, search and Customize step aside and come back when the state returns to Open. */}
        <div
          data-testid="home-tools"
          data-tools
          inert={!open}
          aria-hidden={!open || undefined}
          className={`flex items-center gap-2 transition-[opacity,visibility] ease-ui ${open ? "visible opacity-100 duration-ui" : "invisible opacity-0 duration-ui"}`}
        >
          <button
            type="button"
            onClick={useStore.getState().openCommand}
            className="flex h-control w-[200px] items-center gap-2 rounded-control border border-line bg-panel px-[10px] text-body text-muted transition-colors duration-ui ease-ui hover:border-line-input hover:text-text-2"
          >
            <SearchIcon />
            <span className="grow text-left">Search or command</span>
            <span className="font-mono text-[11px]">Ctrl K</span>
          </button>
          <CustomizeMenu />
        </div>
      </div>

      <header className="flex flex-col gap-4">
        <h1 data-headline className="headline m-0 text-moment">
          {headline}
        </h1>
        <DayRuler minutes={focused} goal={goal} />
      </header>

      {appState === "open" && (brk ? <BreakBar /> : <FocusPanel />)}
      {appState === "sealed" && <SessionBar />}
      {appState === "event" && <EventBar />}

      {show("today") ? (
        <div className="flex min-h-[220px] grow flex-col">
          <TodayPanel strip={show("progress")} />
        </div>
      ) : null}
    </div>
  );
}
