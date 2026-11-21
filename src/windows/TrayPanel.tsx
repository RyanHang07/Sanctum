import { useEffect, useMemo, useRef, useState } from "react";
import { Mark } from "../components/Mark";
import { AnimatedMark } from "../components/AnimatedMark";
import { Check } from "../components/controls";
import { ChevronIcon, PlusIcon } from "../components/icons";
import { Kbd } from "../components/Button";
import { broadcast, errorText, EVENTS, native, onNative } from "../lib/native";
import { agendaFor, longTime, shortTime, todayKey, type AgendaItem } from "../lib/planner";
import { useStore } from "../state/store";
import { clock, countdown } from "../lib/time";
import { durationsMin } from "../theme/tokens";
import type { NextCheckin, Profile, Routine, RoutineCheck, SessionView, Todo } from "../lib/types";

// The tray panel (SPEC 4.0.1, design/screens/Tray.dc.html): a 340px frameless window above the
// tray. Sealed: the timer, Compact, and Open. Open: profile and length, then Enter focus. Then
// today's next items (checkable), an add row, and the next check-in. Hides on blur (Rust).
// It's its own window with its own state, so it only listens; Enter focus and Break the seal
// are sent to the main window, which owns the session.
// Redesign (v0.4, S8): the sealed timer is accent text on the panel (`sealed-text`, never
// `sealed-on`, which is for text on the accent fill). The seal reads as a ruler: the accent fill
// is progress, and the scale's ticks are neutral (minor in `line`, quarter hours in `muted`),
// because the second color marks only goals and kept days. Open is the enabled green (2026-11-20).
// Motion is CSS only (motion spec 12): the fill glides, and reduced motion drops the glide.

/** The seal's scale: a tick every 5 minutes, a major one every quarter hour. */
export function sealTicks(plannedMinutes: number): { at: number; major: boolean }[] {
  const total = Math.max(1, Math.round(plannedMinutes));
  const out: { at: number; major: boolean }[] = [];
  for (let m = 0; m <= total; m += 5) out.push({ at: m / total, major: m % 15 === 0 });
  return out;
}

interface TrayData {
  session: SessionView | null;
  profiles: Profile[];
  routines: Routine[];
  todos: Todo[];
  checks: RoutineCheck[];
  next: NextCheckin | null;
}

/** How long a failed save shows in the footer. */
const FAILED_MS = 4200;

const EMPTY: TrayData ={ session: null, profiles: [], routines: [], todos: [], checks: [], next: null };

async function load(resetTime?: string): Promise<TrayData> {
  const today = todayKey(new Date(), resetTime ?? useStore.getState().settings.dailyResetTime);
  const [session, profiles, routines, todos, checks, next] = await Promise.all([
    native.getSession(),
    native.listProfiles(),
    native.listRoutines(),
    native.listTodos(today, today),
    native.listRoutineChecks(today, today),
    native.nextCheckin().catch(() => null),
  ]);
  return { session, profiles, routines, todos, checks, next };
}

/**
 * The tray is its own window and loads no settings: it reads the daily reset itself (on opening,
 * on planner events, and when shown), so "today" starts when the main window's does.
 */
export async function syncTrayReset(): Promise<void> {
  const raw = await native.getSetting("daily_reset_time").catch(() => null);
  if (!raw || !/^([01]\d|2[0-3]):([0-5]\d)$/.test(raw)) return;
  const settings = useStore.getState().settings;
  if (settings.dailyResetTime !== raw) useStore.setState({ settings: { ...settings, dailyResetTime: raw } });
}

const field =
  "h-control w-full cursor-pointer appearance-none rounded-control border border-line-input bg-raised pl-[10px] pr-[26px] text-meta text-text transition-colors duration-ui ease-ui hover:border-check-line focus-visible:border-sealed";

function Select<T extends string | number>({ label, value, options, onChange, className = "", mono = false }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; className?: string; mono?: boolean }) {
  return (
    <label className={`relative flex items-center ${className}`}>
      <select
        aria-label={label}
        value={String(value)}
        onChange={(e) => {
          const hit = options.find((o) => String(o.value) === e.target.value);
          if (hit) onChange(hit.value);
        }}
        className={`${field} ${mono ? "font-mono" : ""}`}
      >
        {options.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronIcon size={11} className="pointer-events-none absolute right-[9px] text-muted" />
    </label>
  );
}

export function TrayPanel() {
  const dailyResetTime = useStore((s) => s.settings.dailyResetTime);
  const [data, setData] = useState<TrayData>(EMPTY);
  const [profileId, setProfileId] = useState<number | null>(null);
  const [minutes, setMinutes] = useState(60);
  const [draft, setDraft] = useState("");

  // Only the latest read lands; a session event newer than the read keeps its session.
  const gen = useRef(0);
  const sessionSeen = useRef(0);
  const refresh = () => {
    const g = ++gen.current;
    const seen = sessionSeen.current;
    void load(dailyResetTime)
      .then((d) => {
        if (g !== gen.current) return;
        setData((prev) => (seen !== sessionSeen.current ? { ...d, session: prev.session } : d));
      })
      .catch(() => undefined);
  };
  useEffect(() => {
    void syncTrayReset();
    const offs = [onNative(EVENTS.planner, () => void syncTrayReset())];
    const onFocus = () => void syncTrayReset();
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      offs.forEach((p) => void p.then((off) => off()));
    };
  }, []);
  useEffect(() => {
    refresh();
    const live = (session: SessionView | null) => {
      sessionSeen.current++;
      setData((d) => ({ ...d, session }));
    };
    const offs = [
      onNative<SessionView | null>(EVENTS.session, live),
      onNative<SessionView>(EVENTS.tick, live),
      onNative(EVENTS.planner, refresh),
    ];
    // Shown again from the tray: catch up.
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      offs.forEach((p) => void p.then((off) => off()));
    };
  }, [dailyResetTime]);

  // Default to the first profile and its length until you pick.
  const profile = data.profiles.find((p) => p.id === profileId) ?? data.profiles[0] ?? null;
  useEffect(() => {
    if (profileId === null && data.profiles[0]) {
      setProfileId(data.profiles[0].id);
      setMinutes(data.profiles[0].defaultMinutes);
    }
  }, [data.profiles, profileId]);

  const today = todayKey(new Date(), dailyResetTime);
  const items = useMemo(
    () => (agendaFor([today], data.routines, data.todos, data.checks)[today] ?? []).filter((i) => i.kind !== "event"),
    [data.routines, data.todos, data.checks, today],
  );
  const done = items.filter((i) => i.done).length;
  const shown = [...items.filter((i) => !i.done), ...items.filter((i) => i.done)].slice(0, 3);

  // The tray has no toasts: a failed save shows in the footer for a moment instead.
  const [failed, setFailed] = useState<string | null>(null);
  const failedTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(failedTimer.current), []);
  const fail = (e: unknown) => {
    clearTimeout(failedTimer.current);
    setFailed(errorText(e));
    failedTimer.current = setTimeout(() => setFailed(null), FAILED_MS);
  };

  const toggle = async (i: AgendaItem) => {
    try {
      if (i.kind === "routine") {
        const target = Math.max(1, i.sessionsTarget ?? 1);
        const current = Math.min(target, Math.max(0, i.sessionsDone ?? (i.done ? target : 0)));
        const completed = current < target ? current + 1 : Math.max(0, current - 1);
        await native.setRoutineProgress(i.id, i.date, completed);
      } else {
        await native.setTodoDone(i.id, !i.done);
      }
    } catch (e) {
      // Re-read what's saved, so the check shows as it was.
      refresh();
      fail(e);
      return;
    }
    refresh();
    void broadcast(EVENTS.planner);
  };
  const add = async () => {
    const title = draft.trim();
    if (!title) return;
    try {
      // While sealed, the same field parks the thought (v0.3.1): a task for today, from this seal.
      if (data.session) await native.focusPark(title);
      else await native.saveTodo({ title, dueDate: today, dueTime: null, durationMin: null, profileId: null });
    } catch (e) {
      // The text stays in the field to try again.
      fail(e);
      return;
    }
    // Cleared only once saved, and only if it's still what was sent.
    setDraft((d) => (d.trim() === title ? "" : d));
    refresh();
    void broadcast(EVENTS.planner);
  };

  const s = data.session;
  const sealed = !!s;
  const progress = s ? Math.min(1, s.elapsedMs / (s.plannedMinutes * 60_000)) : 0;

  return (
    <section aria-label="Sanctum tray panel" className="box-border flex h-full flex-col overflow-hidden rounded-dialog border border-line-input bg-panel">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line pl-[14px] pr-3">
        {sealed ? (
          <span className="flex text-text">
            <AnimatedMark size={15} mode="breathe" keyClass="text-sealed" />
          </span>
        ) : (
          <Mark size={15} />
        )}
        <span className="text-body font-semibold">Sanctum</span>
        <span
          className={`flex h-[22px] items-center gap-[6px] rounded-[5px] border px-[7px] text-micro ${
            sealed ? "border-sealed-line bg-sealed-tint text-text" : "border-line-input text-text-2"
          }`}
        >
          <span data-testid="state-dot" className={`box-border h-[6px] w-[6px] rounded-full ${sealed ? "bg-sealed" : "bg-ok"}`} />
          {sealed ? "Sealed" : "Open"}
        </span>
        <button
          type="button"
          aria-label="Open Sanctum"
          onClick={() => void native.showMain()}
          className="ml-auto flex h-7 w-7 items-center justify-center rounded-control text-muted transition-colors duration-ui ease-ui hover:bg-raised hover:text-text"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
          </svg>
        </button>
      </div>

      {s ? (
        <div className="flex flex-col gap-[10px] p-[14px]">
          <div className="flex items-baseline justify-between">
            <span role="timer" className="font-mono text-[30px] font-medium tracking-[-0.03em] text-sealed-text">
              {countdown(s.remainingMs)}
            </span>
            <span className="truncate pl-3 text-meta text-muted">
              {s.profileName} · until {clock(s.endsAt)}
            </span>
          </div>
          <div aria-hidden="true" data-testid="seal-ruler" className="flex flex-col gap-1">
            <div className="h-1 overflow-hidden rounded-full bg-line">
              <div
                className="h-full origin-left rounded-full bg-sealed transition-transform duration-glide ease-glide motion-reduce:transition-none"
                style={{ transform: `scaleX(${progress})` }}
              />
            </div>
            <div className="relative h-[10px]">
              {sealTicks(s.plannedMinutes).map((k) => (
                <span
                  key={k.at}
                  data-major={k.major || undefined}
                  className={`absolute top-0 w-px ${k.major ? "h-[9px] bg-muted" : "h-1 bg-line"}`}
                  style={{ left: `${k.at * 100}%`, marginLeft: k.at === 1 ? -1 : 0 }}
                />
              ))}
            </div>
          </div>
          <div className="flex gap-[6px]">
            <button type="button" onClick={() => void native.showCompact()} className="flex h-8 flex-1 items-center justify-center gap-2 rounded-control border border-line-input bg-raised text-meta text-text transition-colors duration-ui ease-ui hover:border-check-line hover:bg-line">
              Compact timer<span className="font-mono text-micro text-muted">Ctrl M</span>
            </button>
            <button type="button" onClick={() => void native.showMain()} className="flex h-8 flex-1 items-center justify-center rounded-control border border-line-input bg-raised text-meta text-text transition-colors duration-ui ease-ui hover:border-check-line hover:bg-line">
              Open Sanctum
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2 p-[14px]">
          <div className="flex gap-[6px]">
            <Select
              label="Profile"
              className="grow"
              value={profile?.id ?? 0}
              options={data.profiles.length ? data.profiles.map((p) => ({ value: p.id, label: p.name })) : [{ value: 0, label: "No profiles yet" }]}
              onChange={(id) => {
                setProfileId(id);
                const p = data.profiles.find((x) => x.id === id);
                if (p) setMinutes(p.defaultMinutes);
              }}
            />
            <Select label="Duration" className="w-[92px] shrink-0" mono value={minutes} options={durationsMin.map((m) => ({ value: m, label: `${m} min` }))} onChange={setMinutes} />
          </div>
          <button
            type="button"
            disabled={!profile}
            onClick={() => profile && void broadcast(EVENTS.enterFocus, { profileId: profile.id, minutes })}
            className="flex h-8 items-center justify-center gap-2 rounded-control bg-sealed text-body font-semibold text-sealed-on transition-[filter] duration-ui ease-ui enabled:hover:brightness-110 disabled:opacity-50"
          >
            Enter focus
            <Kbd onFill>Ctrl ↵</Kbd>
          </button>
        </div>
      )}

      <div className="flex min-h-0 grow flex-col border-t border-line">
        <div className="flex justify-between px-[14px] pb-1 pt-[10px]">
          <span className="text-meta font-medium">Up next today</span>
          <span className="font-mono text-micro text-muted">
            {done}/{items.length}
          </span>
        </div>
        {shown.map((i) => {
          const multi = i.kind === "routine" && (i.sessionsTarget ?? 1) > 1;
          const label = multi ? `${i.title} ${i.sessionsDone ?? 0}/${i.sessionsTarget}` : i.title;
          return (
            <div key={i.key} className="flex h-8 shrink-0 items-center gap-[10px] px-[14px]">
              <Check
                checked={multi ? "mixed" : i.done}
                done={i.done}
                partial={multi && (i.sessionsDone ?? 0) > 0}
                label={label}
                onToggle={() => void toggle(i)}
              />
              <span className={`min-w-0 grow truncate text-meta ${i.done ? "text-muted line-through" : "text-text"}`}>{i.title}</span>
              {multi ? <span className="font-mono text-micro text-muted">{i.sessionsDone ?? 0}/{i.sessionsTarget}</span> : null}
              <span className="font-mono text-micro text-muted">{i.time ? shortTime(i.time) : ""}</span>
            </div>
          );
        })}
        {!items.length ? <p className="m-0 px-[14px] py-2 text-meta text-muted">Nothing planned for today.</p> : null}
        <label className="focus-ring-within mt-auto flex h-[34px] shrink-0 items-center gap-2 border-t border-line px-[14px] text-muted focus-within:text-text-2">
          <PlusIcon size={12} />
          <input
            aria-label={data.session ? "Park a thought for later" : "Add a task for today"}
            placeholder={data.session ? "Park a thought for later" : "Add a task for today"}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void add()}
            className="focus-ring-off min-w-0 grow bg-transparent text-meta text-text placeholder:text-muted"
          />
        </label>
      </div>

      <div className="flex shrink-0 items-center gap-1 border-t border-line bg-panel-footer px-[10px] py-2">
        {failed ? (
          <span role="status" className="truncate pl-1 text-micro text-broken-text">
            Not saved. {failed}
          </span>
        ) : (
          <span className="truncate pl-1 text-micro text-muted">{data.next ? `Next check-in ${longTime(data.next.time)}` : "No more check-ins today"}</span>
        )}
        {sealed ? (
          <button
            type="button"
            onClick={() => {
              void native.showMain();
              void broadcast(EVENTS.endEarly);
            }}
            className="ml-auto h-7 rounded-control px-2 text-meta text-muted transition-colors duration-ui ease-ui hover:bg-raised hover:text-text"
          >
            Break the seal
          </button>
        ) : (
          <button type="button" onClick={() => void native.requestQuit()} className="ml-auto h-7 rounded-control px-2 text-meta text-muted transition-colors duration-ui ease-ui hover:bg-raised hover:text-text">
            Quit Sanctum
          </button>
        )}
      </div>
    </section>
  );
}
