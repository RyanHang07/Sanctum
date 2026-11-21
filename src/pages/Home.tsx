import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronIcon, LockIcon, PlusIcon, SearchIcon, XIcon } from "../components/icons";
import { durationsMin } from "../theme/tokens";
import { selectedProfile, useStore, type HomePanel } from "../state/store";
import { usePlanner } from "../state/planner";
import { useAgenda } from "../state/calendar";
import { meetingLabels } from "../lib/calendar";
import { useNow } from "../lib/useNow";
import { native } from "../lib/native";
import { profileNote } from "../lib/rules";
import { BUTTON_SIZES, Button, Kbd } from "../components/Button";
import { Check, HIT, Switch, useSlidingIndicator } from "../components/controls";
import { Odometer } from "../components/Odometer";
import { QuickAddField } from "../components/QuickAdd";
import { PendingTab } from "./week/Pending";
import { TomorrowList, cutoffLabel, marked, useDayTab, useTomorrowItems } from "./Tomorrow";
import { useSwap } from "../lib/useSwap";
import { FADE_WHEN_MORE, useMoreBelow } from "../lib/useMoreBelow";
import { EventMark } from "./week/marks";
import { canMove, drag as dayDrag, moveTo } from "./week/drag";
import { ItemEditor, selectProps, selectable, useClearSelection, useSelectedKey } from "./itemSelect";
import { CounterRow } from "./CounterRow";
import { Glide } from "../lib/motion";
import { DUR, EASE, gsap, useGSAP } from "../lib/gsap";
import { getMoment, useMotion } from "../lib/useMotion";
import { useFocusToday, useWeekOverview } from "../state/session";
import { DayRuler } from "./DayRuler";
import { FocusPicker } from "./FocusPicker";
import { BREAK_TIPS, homeLine, OPEN_DONE, OPEN_IDLE, pick } from "./headlines";
import { SAMPLE_EVENT } from "./placeholders";
import { countdown, joinNames, minutes } from "../lib/time";
import { addDays, blockTimes, canReorder, moveId, msUntilReset, nextUp, openFirst, shortTime, todayKey, type AgendaItem, type Suggestion } from "../lib/planner";
import type { DayStat, StatsOverview, TaskLink } from "../lib/types";

/** A moment as the Today list writes its times: "2:30p" (one format across Today). */
function at(t: number | Date): string {
  const d = new Date(t);
  return shortTime(`${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`);
}

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
    // One read at a time: the poll and the window's focus can't stack slow reads.
    let reading = false;
    const load = () => {
      if (reading) return;
      reading = true;
      void native
        .previewSeal(profileId)
        .then((n) => live && setNames(n))
        .catch(() => live && setNames([]))
        .finally(() => {
          reading = false;
        });
    };
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

/** A day's cell in the strip: 6 by 12, the decided day states. Kept is the second color. */
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
      className="pointer-events-none absolute right-[calc(100%+8px)] top-[-1px] flex h-control items-center gap-[9px] whitespace-nowrap rounded-control border border-line bg-panel px-[10px] text-micro text-muted opacity-0 transition-[clip-path,opacity] duration-state ease-ui [clip-path:inset(0_0_0_100%)] group-hover:opacity-100 group-hover:delay-150 group-hover:[clip-path:inset(0)] group-focus-visible:opacity-100 group-focus-visible:delay-150 group-focus-visible:[clip-path:inset(0)]"
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

/** The card's top slot (2026-11-17): one 44px strip in every state, so the row below never moves
 *  as the card changes state. Open shows what's next, Sealed and In event what the cells don't. */
export const SLOT = "flex h-11 shrink-0 items-center gap-3 rounded-control border pl-3 pr-1";
const CHIP = "shrink-0 rounded-[4px] px-[6px] py-[2px] text-micro font-medium";

function SuggestedCard({ s }: { s: Suggestion | null }) {
  const profiles = useStore((st) => st.profiles);
  const selected = useStore((st) => st.selectedProfileId);
  const duration = useStore((st) => st.durationMin);
  const navigate = useStore((st) => st.navigate);
  const hintHidden = useStore((st) => st.settings.homeLayout.hidden.includes("hint"));
  const setHidden = useStore((st) => st.setHomeHidden);
  const kept = useStore((st) => st.focusTodayMin >= st.settings.dailyGoalMin);
  const reset = useStore((st) => st.settings.dailyResetTime);
  if (!s) {
    const day = todayKey(new Date(), reset);
    // Goal kept: a word for it, and leave to rest or keep going (one line a day).
    if (kept)
      return (
        <div data-testid="suggestion" data-kind="done" className={`${SLOT} border-line-input bg-raised`}>
          <span className={`${CHIP} bg-second-tint text-second-text`}>Kept</span>
          <span className="min-w-0 truncate text-body text-text-2">{pick(OPEN_DONE, day)}</span>
        </div>
      );
    // Dismissable; Customize brings it back. A real block always shows.
    if (hintHidden)
      return (
        <div data-testid="suggestion" data-kind="idle" className={`${SLOT} border-line-input`}>
          <span className="min-w-0 truncate text-body text-muted">{pick(OPEN_IDLE, day)}</span>
        </div>
      );
    return (
      <div data-testid="suggestion" data-kind="hint" className={`${SLOT} border-dashed border-line-input`}>
        <span className="grow truncate text-meta text-muted">No focus block on your schedule. Link a routine or an item to a profile.</span>
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
  // Using a block is choosing its item: the session is for it, so it can be checked off after.
  const use = () => {
    useStore.setState({ selectedProfileId: s.profileId, durationMin: s.minutes, focusOverrideKey: null });
    const i = s.item;
    if (i.kind === "todo" || i.kind === "routine") useStore.getState().setFocusTask({ kind: i.kind, id: i.id, date: i.date, title: i.title });
  };
  return (
    <div data-testid="suggestion" data-kind={s.state} className={`${SLOT} ${s.state === "now" ? "border-sealed bg-sealed-tint" : "border-line-input bg-raised"}`}>
      <span className={`${CHIP} ${s.state === "now" ? "bg-sealed text-sealed-on" : "bg-line text-text-2"}`}>{s.state === "now" ? "Now" : "Next"}</span>
      <span title={s.item.title} className="min-w-0 truncate text-body font-medium text-text">{s.item.title}</span>
      <span className="shrink-0 font-mono text-meta text-muted">{s.state === "now" ? `${at(s.startsAt)} to ${at(s.endsAt)}` : `at ${at(s.startsAt)}`}</span>
      <span className="ml-auto shrink-0 truncate text-meta text-text-2">
        {profile?.name ?? "Unknown profile"} · {s.minutes} min
      </span>
      {applied ? (
        <span className="w-2" />
      ) : (
        <Button variant="tint" size="sm" className="border-sealed!" aria-label={`Use ${profile?.name ?? "this profile"}, ${s.minutes} min`} onClick={use}>
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
    <div data-testid="focus-task" className={`${SLOT} border-sealed-line bg-sealed-tint`}>
      <span className={`${CHIP} bg-sealed text-sealed-on`}>For</span>
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

const BOX = "flex h-cta items-center justify-center rounded-control border border-line-input bg-raised px-3";
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
    <section data-testid="focus-row" aria-label="Focus" className="flex shrink-0 flex-col gap-[14px] rounded-dialog border border-line bg-panel p-[18px]">
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
              className={`relative w-full rounded-control ${BUTTON_SIZES.cta} text-sealed-on transition-[filter] duration-ui ease-ui hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:brightness-100`}
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
    <section data-testid="session-bar" aria-label="Sealed session" className="relative flex shrink-0 flex-col gap-[14px] overflow-hidden rounded-dialog border border-sealed-line bg-sealed-tint p-[18px]">
      {/* The same top slot as Open (2026-11-17), with only what the cells below don't show. */}
      <div data-testid="sealed-slot" className={`${SLOT} border-sealed-line bg-panel`}>
        <span className={`${CHIP} bg-sealed text-sealed-on`}>{session?.idle ? "Paused" : "Sealed"}</span>
        {session?.task ? <span title={session.task.title} className="min-w-0 truncate text-body font-medium text-text">{session.task.title}</span> : null}
        {session?.goal && session.goal !== session.task?.title ? <span title={session.goal} className="min-w-0 truncate text-body font-medium text-text">{session.goal}</span> : null}
        <span className="ml-auto shrink-0 truncate pr-2 text-meta text-text-2">
          {session?.broken
            ? "Seal broken, the streak resets"
            : session?.idle
              ? "Idle, the seal extends until you're back"
              : `Ends ${at(ends)} · ${sealed} ${sealed === 1 ? "app" : "apps"} sealed · ${attempts} ${attempts === 1 ? "attempt" : "attempts"} blocked`}
        </span>
      </div>
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
          {/* Two boxes the size of the fields beside them (decided 2026-11-16). The exit stays
              quiet: neutral text, no accent; ending early is a choice, not the main action. */}
          <div className="grid h-cta grid-cols-2 gap-2">
            <Button size="cell" onClick={openEndEarly} className="w-full text-text-2!">
              End early
            </Button>
            {/* The shortcut shows only while the button has room for it (2026-11-20). */}
            <Button size="cell" onClick={() => void native.showCompact()} className="@container w-full text-text-2!">
              Compact
              <span data-testid="compact-kbd" className="hidden @[150px]:inline">
                <Kbd>Ctrl M</Kbd>
              </span>
            </Button>
          </div>
        </div>
      </div>
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
      <p className="m-0 h-[18px] shrink-0 truncate text-meta leading-[18px] text-text-2">
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
  // Whole minutes, like the sealed timer (M6).
  const leftMin = Math.ceil(left / 60_000);
  const range = `${at(startMs)} to ${at(endMs)}`;
  const until = at(endMs);
  const progress = endMs > startMs ? (now - startMs) / (endMs - startMs) : 0;
  return (
    <section data-testid="event-bar" aria-label="In event" className="relative flex shrink-0 flex-col gap-[14px] overflow-hidden rounded-dialog border border-event-line bg-panel p-[18px]">
      {/* The same top slot as Open (2026-11-17); the time left is in the cell below. */}
      {/* The chip is tinted with plain text (H2): white on the event fill was 2.3:1. The event color
          is the dot; text on event-tint passes 4.5:1 in every theme (5.5:1 at the least). */}
      <div data-testid="event-slot" className={`${SLOT} border-event-line bg-panel`}>
        <span data-event-chip className={`${CHIP} inline-flex items-center gap-[5px] bg-event-tint text-text`}>
          <span aria-hidden="true" className="h-[6px] w-[6px] rounded-full bg-event" />
          In event
        </span>
        <span title={range} className="min-w-0 truncate font-mono text-meta text-text-2">{range}</span>
        {meeting?.htmlLink ? (
          <Button variant="quiet" size="sm" className="ml-auto" onClick={() => void native.gcalOpen(meeting.htmlLink!)}>
            Open in Google
          </Button>
        ) : null}
      </div>
      <div className={ROW}>
        <Field label="Event">
          <span title={e.title} className="truncate text-[15px] font-semibold text-text">{e.title}</span>
        </Field>
        <Field label="Time left">
          <span role="timer" aria-label={`${leftMin} min left`} className="flex items-center gap-[0.35em] font-mono text-[15px] font-medium text-text">
            <Odometer text={String(leftMin)} direction="down" />
            <span aria-hidden="true">min</span>
          </span>
        </Field>
        <div className="flex min-w-0 flex-col gap-[7px]">
          <span className="label truncate">{queued && profile ? `${profile.name} starts when it ends` : "Focus unlocks when it ends"}</span>
          {queued ? (
            <Button variant="ghost" size="cell" className="w-full" onClick={() => setQueued(false)}>
              Cancel queue
            </Button>
          ) : (
            <Button variant="tint" size="cell" className="w-full" disabled={!profile} onClick={() => setQueued(true)}>
              Queue focus at {until}
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
  // In the tabs view, a one-time item can also be dropped on the other day's tab.
  const crossDay = useStore((s) => s.settings.tomorrowTab) && canMove(t);
  const over = drag.over?.key === t.key ? drag.over.after : null;
  const selected = useSelectedKey() === t.key;
  const sel = selectProps(t, selected);
  // A one-time item drags only once it's selected (2026-11-20): a stray press-and-move on
  // another row does nothing. Routines aren't selected; they reorder as before.
  const held = selected || !selectable(t);
  const grabbable = (movable || crossDay) && held;
  return (
    <div
      data-now={current || undefined}
      data-testid="task-row"
      data-key={t.key}
      draggable={grabbable || undefined}
      {...sel}
      onKeyDown={(e) => {
        sel.onKeyDown?.(e);
        // Alt+Up / Alt+Down: the keyboard way to drag.
        if (!movable || !e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
        e.preventDefault();
        drag.nudge(t, e.key === "ArrowUp" ? -1 : 1);
      }}
      onDragStart={(e) => {
        if (!held) return void e.preventDefault();
        // Also the shared drag, so the other day's tab can take it (2026-11-20).
        if (crossDay) dayDrag.item = t;
        if (movable) drag.start(e, t);
        else if (crossDay) {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", t.title);
        }
      }}
      onDragEnd={() => {
        dayDrag.item = null;
        drag.end();
      }}
      onDragOver={(e) => drag.overRow(e, t)}
      onDrop={(e) => drag.drop(e, t)}
      className={`group @container relative flex h-row shrink-0 items-center gap-[10px] border-l-2 px-[14px] transition-colors duration-ui ease-ui hover:bg-raised ${
        current || linked ? "border-l-sealed bg-sealed-tint" : selected ? "border-l-text-2 bg-raised" : "border-l-transparent"
      } ${grabbable && movable ? "cursor-grab active:cursor-grabbing" : grabbable ? "cursor-grab" : ""} ${drag.dragging === t.key ? "opacity-40" : ""}`}
    >
      {over !== null ? <span aria-hidden="true" className={`pointer-events-none absolute inset-x-[14px] h-[2px] rounded-full bg-sealed ${over ? "bottom-0" : "top-0"}`} /> : null}
      {(() => {
        const multi = t.kind === "routine" && (t.sessionsTarget ?? 1) > 1;
        const partial = multi && (t.sessionsDone ?? 0) > 0 && !t.done;
        const label = multi ? `${t.title} (${t.sessionsDone ?? 0} of ${t.sessionsTarget} sessions)` : t.title;
        return (
          <>
            <Check
              checked={multi ? (t.done ? true : partial ? "mixed" : false) : t.done}
              done={t.done}
              partial={partial}
              label={label}
              onToggle={() => void toggle(t)}
            />
            <span title={t.title} className={`min-w-0 grow truncate text-body transition-colors duration-ui ease-ui ${t.done ? "text-muted line-through" : "text-text"}`}>{t.title}</span>
            {multi ? <span className="hidden shrink-0 rounded-[4px] @[220px]:inline border border-line-input px-[6px] py-[1px] font-mono text-micro text-muted">{t.sessionsDone ?? 0}/{t.sessionsTarget}</span> : null}
          </>
        );
      })()}
      {current ? <span className="text-micro font-medium text-sealed-text">Now</span> : null}
      {canLink && !t.done ? (
        // Links the next session to this task (and its profile). Shown on hover, kept while linked.
        <button
          type="button"
          aria-pressed={linked}
          aria-label={linked ? `Unlink ${t.title}` : `Focus on ${t.title}`}
          onClick={() => useStore.getState().setFocusTask(linked ? null : { kind: t.kind as TaskLink["kind"], id: t.id, date: t.date, title: t.title, profileId: t.profileId })}
          className={`${HIT} hidden h-5 shrink-0 items-center rounded-[4px] px-[7px] text-micro font-medium @[340px]:flex transition-[opacity,color,background-color] duration-ui ease-ui focus-visible:opacity-100 ${
            linked ? "bg-sealed text-sealed-on" : "border border-line-input text-text-2 opacity-0 hover:text-text group-hover:opacity-100"
          }`}
        >
          {linked ? "For focus" : "Focus"}
        </button>
      ) : null}
      {/* Narrow rows give the title the room: Focus goes first, then the type, then the time (2026-11-20). */}
      {tag ? <span className="hidden h-5 shrink-0 items-center rounded-[4px] border border-line-input px-[7px] text-micro text-text-2 @[300px]:flex">{tag}</span> : null}
      {/* No time, no time column: the tag sits at the far right. */}
      {t.time ? <span className="hidden w-[46px] shrink-0 text-right font-mono text-micro text-muted @[220px]:block">{shortTime(t.time)}</span> : null}
    </div>
  );
}

function EventRow({ t, now, tag }: { t: AgendaItem; now: number; tag?: string }) {
  const times = blockTimes(t);
  const past = times ? times.endsAt <= now : false;
  const selected = useSelectedKey() === t.key;
  return (
    <div
      data-kind="event"
      {...selectProps(t, selected)}
      className={`@container flex h-row shrink-0 items-center gap-[10px] border-l-2 px-[14px] transition-colors duration-ui ease-ui hover:bg-raised ${selected ? "border-l-text-2 bg-raised" : "border-l-transparent"}`}
    >
      <EventMark size={16} />
      <span title={t.title} className={`min-w-0 grow truncate text-body ${past ? "text-muted" : "text-text-2"}`}>{t.title}</span>
      {tag ? <span className="hidden shrink-0 rounded-[4px] border border-line-input px-[6px] py-[1px] text-micro text-text-2 @[300px]:inline">{tag}</span> : null}
      <span title={t.event?.calendarName ?? "Calendar"} className="hidden max-w-[120px] shrink-0 truncate @[340px]:inline text-micro text-muted">{t.event?.calendarName ?? "Calendar"}</span>
      <span className="hidden w-[46px] shrink-0 text-right font-mono text-micro text-muted @[220px]:block">{t.time ? shortTime(t.time) : "all day"}</span>
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
  // A row dropped on the other day's tab leaves the list mid-drag, so its own dragend never
  // comes and it would stay dimmed when it returns (2026-11-20). Any drag's end clears it.
  useEffect(() => {
    if (!dragging) return;
    const clear = () => {
      held.current = null;
      setDragging(null);
      setOver(null);
    };
    window.addEventListener("dragend", clear, true);
    window.addEventListener("drop", clear);
    return () => {
      window.removeEventListener("dragend", clear, true);
      window.removeEventListener("drop", clear);
    };
  }, [dragging]);
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

/**
 * The tabs variant's header (2026-11-20): Today and Tomorrow as the column's own headings, body
 * size, with one underline that slides to the picked day. Tomorrow carries a second-color dot
 * when anything is before noon, from either tab. Each tab takes a dropped item and moves it to
 * its day.
 */
function DayTabs({ tab, onTab, today, todayDate, tomorrow }: { tab: "today" | "tomorrow"; onTab: (t: "today" | "tomorrow") => void; today: AgendaItem[]; todayDate: string; tomorrow: string }) {
  const next = useTomorrowItems(tomorrow);
  const before = useStore((s) => s.settings.tomorrowMarkBefore);
  // The dot: anything open tomorrow, or (with a cutoff) what starts before it.
  const morning = next.filter((i) => marked(i, before)).length;
  const what = before === null ? "planned" : `before ${cutoffLabel(before)}`;
  const shown = (tab === "today" ? today : next).filter((i) => i.kind !== "event");
  const root = useRef<HTMLDivElement>(null);
  const line = useRef<HTMLSpanElement>(null);
  useSlidingIndicator(root, line, tab);
  // The dot bumps and settles when tomorrow gains something (a day reset, an item added), so the
  // change is noticed; it sits still on first paint (2026-11-20). Reduced motion: it just appears.
  const dot = useRef<HTMLSpanElement>(null);
  const seen = useRef(morning);
  const { run } = useMotion(root);
  // Tomorrow's first load isn't news: until it's in, the dot just takes its place.
  const ready = usePlanner((s) => s.loaded && !!s.range && s.range[1] >= tomorrow);
  const settled = useRef(ready);
  useEffect(() => {
    const was = seen.current;
    seen.current = morning;
    // The render that brings the first load in counts as first paint too.
    const first = !settled.current;
    // Once in, a later reload (a new tomorrow at the reset) is news.
    settled.current ||= ready;
    if (first || !dot.current || morning <= was) return;
    const from = was === 0 ? 0 : 1;
    run(() =>
      gsap
        .timeline({ id: "tomorrow-dot" })
        .fromTo(dot.current, { scale: from }, { scale: 1.6, duration: DUR.ui, ease: EASE.ui })
        .to(dot.current, { scale: 1, duration: DUR.state, ease: EASE.glide, clearProps: "transform" }),
    );
  }, [morning, ready]);
  const [over, setOver] = useState<"today" | "tomorrow" | null>(null);
  const dateOf = (d: "today" | "tomorrow") => (d === "today" ? todayDate : tomorrow);
  const fits = (d: "today" | "tomorrow") => !!dayDrag.item && canMove(dayDrag.item) && dayDrag.item.date !== dateOf(d);
  const tabFor = (d: "today" | "tomorrow", label: string) => (
    <button
      key={d}
      type="button"
      role="tab"
      aria-selected={tab === d}
      data-indicator-item={d}
      onClick={() => onTab(d)}
      onDragOver={(e) => {
        if (!fits(d)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (over !== d) setOver(d);
      }}
      onDragLeave={() => setOver(null)}
      onDrop={(e) => {
        const item = dayDrag.item;
        setOver(null);
        if (!item || !fits(d)) return;
        e.preventDefault();
        dayDrag.item = null;
        void moveTo(item, dateOf(d));
      }}
      className={`relative flex h-10 items-center gap-[6px] rounded-t-control px-[6px] text-body font-semibold transition-colors duration-ui ease-ui ${
        tab === d ? "text-text" : "text-muted hover:text-text-2"
      } ${over === d ? "bg-sealed-tint text-text" : ""}`}
    >
      {label}
      {d === "tomorrow" && morning ? (
        <span ref={dot} data-tomorrow-dot aria-hidden="true" title={`${morning} ${what}`} className="h-[6px] w-[6px] rounded-full bg-second" />
      ) : null}
      {d === "tomorrow" && morning ? <span className="sr-only">, {morning} {what}</span> : null}
    </button>
  );
  return (
    <div className="flex h-10 shrink-0 items-stretch gap-2 px-[8px]">
      <div ref={root} role="tablist" aria-label="Day" className="relative flex items-stretch gap-1">
        {/* The underline: a 2px bar that slides under the picked day. */}
        <span ref={line} aria-hidden="true" className="pointer-events-none absolute bottom-[-1px] left-0 !h-[2px] rounded-full bg-sealed opacity-0" />
        {tabFor("today", "Today")}
        {tabFor("tomorrow", "Tomorrow")}
      </div>
      <span className="grow" />
      <span className="flex items-center pr-[6px] font-mono text-meta text-muted">
        {shown.filter((t) => t.done).length}/{shown.length}
      </span>
    </div>
  );
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
  const dayList = useRef<HTMLDivElement>(null);
  const dayMore = useMoreBelow(dayList);
  const routinesList = useRef<HTMLDivElement>(null);
  const routinesMore = useMoreBelow(routinesList);
  // Tomorrow on Today (a setting, off by default, 2026-11-20): Today | Tomorrow on the list's
  // header; the list swaps like a screen.
  const tomorrowTab = useStore((s) => s.settings.tomorrowTab);
  const dayTab = useDayTab((s) => s.tab);
  const setDayTab = (tab: "today" | "tomorrow") => useDayTab.setState({ tab });
  // Only the dev panel bumps this, to replay the reset refresh without waiting for it.
  const resets = useDayTab((s) => s.resets);
  const tab = tomorrowTab ? dayTab : "today";
  // The day itself is part of the key: at the reset time, tomorrow becomes today and both lists
  // refresh with the same fade and rise (2026-11-20), instead of changing under you.
  const listDay = todayKey(new Date(useNow(30_000)), useStore.getState().settings.dailyResetTime);
  const { ref: daySwap, shown: shownKey } = useSwap<string>(`${tab}|${listDay}|${resets}`, "day-swap");
  const shownTab = shownKey.split("|")[0] as "today" | "tomorrow";
  const { ref: routinesSwap } = useSwap<string>(`${listDay}|${resets}`, "routines-reset");
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

  useClearSelection();
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
        <EventRow t={t} now={now} tag={profiles.find((p) => p.id === t.profileId)?.name} />
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
              className="-ml-1 flex h-6 w-6 items-center justify-center rounded-control text-faint transition-colors duration-ui ease-ui hover:bg-raised hover:text-text-2"
            >
              <ChevronIcon size={10} className={`transition-transform duration-ui ease-ui ${collapsed ? "-rotate-90" : ""}`} />
            </button>
          }
        />
        <div className="border-l border-line">
          {tomorrowTab ? (
            <DayTabs
              tab={dayTab}
              onTab={setDayTab}
              today={day}
              todayDate={todayKey(new Date(), dailyResetTime)}
              tomorrow={addDays(todayKey(new Date(), dailyResetTime), 1)}
            />
          ) : (
            <ColumnHead title="Today" items={day} />
          )}
        </div>
      </div>
      {collapsed ? null : (
        <div className="grid min-h-0 grow grid-cols-2">
          <div
            ref={(el) => {
              routinesList.current = el;
              routinesSwap.current = el;
            }}
            data-testid="routines-column"
            data-more={routinesMore || undefined}
            className={`flex min-h-0 flex-col overflow-y-auto pb-3 pt-1 ${FADE_WHEN_MORE}`}
          >
            {routines.length === 0 ? <p className="m-0 px-[14px] py-3 text-meta text-muted">No routines today.</p> : null}
            {counters.map((t) => (
              <Glide key={t.key}>
                <CounterRow item={t} routine={counterOf(t)!} />
              </Glide>
            ))}
            {listed.map((t) => row(t, routineDrag))}
          </div>
          <div data-testid="day-column" data-more={dayMore || undefined} className="group/day flex min-h-0 flex-col border-l border-line">
            <div ref={daySwap} data-testid="day-swap" className="flex min-h-0 grow flex-col">
              {shownTab === "today" ? (
                <QuickAddField
                  date={todayKey(new Date(), dailyResetTime)}
                  label="Add a task for today"
                  placeholder="Add a task for today"
                  prefix={<PlusIcon className="shrink-0 text-faint" />}
                  className="flex h-[38px] shrink-0 cursor-text items-center gap-[10px] border-b border-line px-[14px] transition-colors duration-ui ease-ui hover:bg-raised"
                />
              ) : null}
              {/* With more below than fits, the list fades out at its foot and the dividers under it
                  step aside (2026-11-20), so a tight column keeps its room and still says so. */}
              <div ref={dayList} data-more={dayMore || undefined} className={`flex min-h-0 grow flex-col overflow-y-auto pb-3 pt-1 ${FADE_WHEN_MORE}`}>
                {shownTab === "tomorrow" ? (
                  <TomorrowList date={addDays(todayKey(new Date(), dailyResetTime), 1)} />
                ) : (
                  <>
                    {day.length === 0 ? <p className="m-0 px-[14px] py-3 text-meta text-muted">Nothing else planned today.</p> : null}
                    {day.map((t) => row(t, dayDrag))}
                  </>
                )}
              </div>
            </div>
            <PendingTab />
          </div>
        </div>
      )}
      {strip && !collapsed ? <NextUpStrip /> : null}
      <ItemEditor />
    </section>
  );
}

/**
 * Next up (decided 2026-11-16): the ruler above measures the day, so the foot of the list looks
 * ahead instead. The next timed routine, item or event today, with a live countdown, leaving out
 * the block the focus card already suggests.
 */
function NextUpStrip() {
  const dailyResetTime = useStore((s) => s.settings.dailyResetTime);
  const suggestion = useStore((s) => s.suggestion);
  const now = useNow(15_000);
  const today = todayKey(new Date(now), dailyResetTime);
  const agenda = useAgenda([today]);
  const next = nextUp(agenda[today] ?? [], now, suggestion?.state === "next" ? suggestion.item.key : null);
  return (
    <div data-testid="next-strip" className="flex h-10 shrink-0 items-center gap-[10px] border-t border-line bg-panel-footer px-[14px] text-meta">
      {next ? (
        <>
          {next.item.kind === "event" ? <EventMark /> : <span aria-hidden="true" className="h-[7px] w-[7px] shrink-0 rounded-full bg-sealed" />}
          <span className="shrink-0 text-muted">Next up</span>
          <span title={next.item.title} className="min-w-0 truncate font-medium text-text">{next.item.title}</span>
          <span className="shrink-0 font-mono text-muted">at {at(next.startsAt)}</span>
          <span className="ml-auto shrink-0 text-muted">
            in <Odometer text={minutes(Math.max(1, Math.ceil((next.startsAt - now) / 60_000)))} direction="down" className="font-mono font-medium text-sealed-text" />
          </span>
        </>
      ) : (
        <span className="text-muted">Nothing else on the clock today.</span>
      )}
    </div>
  );
}

const PANELS: { id: HomePanel; label: string }[] = [
  { id: "today", label: "Today list" },
  { id: "progress", label: "Next up" },
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
            <div key={p.id} className="flex h-control items-center justify-between rounded-control px-2 hover:bg-raised">
              <span className="text-body text-text">{p.label}</span>
              <Switch label={`Show ${p.label}`} checked={!hidden.includes(p.id)} onChange={(v) => setHidden(p.id, !v)} />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Entering focus (motion spec §3; "draw the line", 2026-11-17): driven by state, not the click, so
 * Ctrl Enter, the tray and a scheduled start all play it. Nothing travels across the card:
 *   1. the Enter focus fill fades where it was,
 *   2. the card's border and fill warm from Open's to Sealed's,
 *   3. the seal line draws along the bottom edge, left to right,
 *   4. the top slot, then the cells, fade in place, and the headline settles,
 *   5. the line holds a beat, then fades to the real track beneath.
 * The store's subscription runs inside set(), before React swaps the cards, so it can measure the
 * open card. A session resumed at launch never had an open card, so it plays nothing.
 */
function useEnterFocusMoment(root: React.RefObject<HTMLDivElement | null>, run: ReturnType<typeof useMotion>["run"]) {
  const appState = useStore((s) => s.appState);
  const from = useRef<{ fill: DOMRect | null; border: string; background: string } | null>(null);
  useEffect(
    () =>
      useStore.subscribe((s, p) => {
        if (p.appState !== "sealed" && s.appState === "sealed" && root.current) {
          const card = root.current.querySelector<HTMLElement>("[data-testid=focus-row]");
          if (!card) return;
          const css = getComputedStyle(card);
          from.current = {
            fill: root.current.querySelector("[data-seal-src]")?.getBoundingClientRect() ?? null,
            border: css.borderColor,
            background: css.backgroundColor,
          };
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
      const card = root.current?.querySelector("[data-testid=session-bar]");
      if (!b || !line || !card || !root.current) return;
      // Step 1 needs the old fill on screen for a moment: a stand-in where it was.
      let ghost: HTMLElement | null = null;
      if (b.fill) {
        ghost = document.createElement("div");
        ghost.setAttribute("aria-hidden", "true");
        ghost.className = "pointer-events-none fixed z-[3] rounded-control bg-sealed";
        Object.assign(ghost.style, { left: `${b.fill.left}px`, top: `${b.fill.top}px`, width: `${b.fill.width}px`, height: `${b.fill.height}px` });
        root.current.appendChild(ghost);
      }
      const drop = () => ghost?.remove();
      run(() => {
        const tl = gsap.timeline({ id: "enter-focus", onComplete: drop, onInterrupt: drop }).addLabel("seal", 0);
        if (ghost) tl.to(ghost, { opacity: 0, duration: 0.15, ease: EASE.ui }, "seal");
        return (
          tl
            .from(card, { borderColor: b.border, backgroundColor: b.background, duration: DUR.state, ease: EASE.ui, clearProps: "borderColor,backgroundColor" }, "seal")
            .fromTo(line, { autoAlpha: 1, transformOrigin: "0 50%", scaleX: 0 }, { scaleX: 1, duration: 0.4, ease: EASE.glide }, "seal+=0.05")
            .from("[data-testid=sealed-slot] > *", { opacity: 0, duration: DUR.state, ease: EASE.ui, stagger: 0.04, clearProps: "opacity" }, 0.08)
            .from("[data-sealed-cell]", { opacity: 0, duration: DUR.state, ease: EASE.ui, stagger: 0.04, clearProps: "opacity" }, 0.14)
            .fromTo("[data-headline]", { opacity: 0.4 }, { opacity: 1, duration: DUR.state, ease: EASE.ui, clearProps: "opacity" }, 0.1)
            .addLabel("line", 0.45)
            .to(line, { autoAlpha: 0, duration: 0.4, ease: EASE.ui, clearProps: "transform,opacity,visibility" }, "line+=0.2")
        );
      });
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
  const sealed = appState === "sealed";
  useEnterFocusMoment(root, run);
  const justKept = useGoalMoment(root, run, met);

  return (
    <div ref={root} className="flex h-full flex-col gap-[22px] px-8 pb-[22px] pt-[26px]">
      <div className="flex min-h-control flex-wrap items-center gap-2 text-meta">
        <span className={`min-w-[160px] flex-1 text-body transition-colors duration-drain ease-ui ${open ? "text-muted" : "text-text"}`}>{formatDate(new Date())}</span>
        {/* Sealed, the streak, search and Customize step aside (decided 2026-11-16) and come back
            when the seal ends, the streak already counting it. An event keeps them. */}
        <div
          data-testid="home-tools"
          data-tools
          inert={sealed}
          aria-hidden={sealed || undefined}
          className={`flex items-center gap-2 transition-[opacity,visibility] ease-ui ${sealed ? "invisible opacity-0 duration-ui" : "visible opacity-100 duration-ui"}`}
        >
          {show("streak") ? <StreakChip o={overview} delay={justKept ? 0.95 : 0} /> : null}
          <button
            type="button"
            onClick={useStore.getState().openCommand}
            className="flex h-control w-[200px] items-center gap-2 rounded-control border border-line bg-panel px-[10px] text-body text-muted transition-colors duration-ui ease-ui hover:border-line-input hover:text-text-2"
          >
            <SearchIcon />
            <span className="grow text-left">Search or command</span>
            <span className="font-mono text-micro">Ctrl K</span>
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
