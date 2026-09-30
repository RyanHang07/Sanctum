import { useEffect, useMemo, useState } from "react";
import { Mark } from "../components/Mark";
import { AnimatedMark } from "../components/AnimatedMark";
import { CheckIcon, ChevronIcon, PlusIcon } from "../components/icons";
import { Kbd } from "../components/Button";
import { broadcast, EVENTS, native, onNative } from "../lib/native";
import { agendaFor, longTime, shortTime, todayKey, type AgendaItem } from "../lib/planner";
import { clock, countdown } from "../lib/time";
import { durationsMin } from "../theme/tokens";
import type { NextCheckin, Profile, Routine, RoutineCheck, SessionView, Todo } from "../lib/types";

// The tray panel (SPEC 4.0.1, design/screens/Tray.dc.html): a 340px frameless window above the
// tray. Sealed: the timer, Compact, and Open. Open: profile and length, then Enter focus. Then
// today's next items (checkable), an add row, and the next check-in. Hides on blur (Rust).
// It's its own window with its own state, so it only listens; Enter focus and Break the seal
// are sent to the main window, which owns the session.

interface TrayData {
  session: SessionView | null;
  profiles: Profile[];
  routines: Routine[];
  todos: Todo[];
  checks: RoutineCheck[];
  next: NextCheckin | null;
}

const EMPTY: TrayData = { session: null, profiles: [], routines: [], todos: [], checks: [], next: null };

async function load(): Promise<TrayData> {
  const today = todayKey();
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

const field =
  "h-8 w-full cursor-pointer appearance-none rounded-control border border-line-input bg-raised pl-[10px] pr-[26px] text-meta text-text outline-none transition-colors duration-ui ease-ui hover:border-check-line focus-visible:border-sealed";

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
  const [data, setData] = useState<TrayData>(EMPTY);
  const [profileId, setProfileId] = useState<number | null>(null);
  const [minutes, setMinutes] = useState(60);
  const [draft, setDraft] = useState("");

  const refresh = () => void load().then(setData).catch(() => undefined);
  useEffect(() => {
    refresh();
    const offs = [
      onNative<SessionView | null>(EVENTS.session, (session) => setData((d) => ({ ...d, session }))),
      onNative<SessionView>(EVENTS.tick, (session) => setData((d) => ({ ...d, session }))),
      onNative(EVENTS.planner, refresh),
    ];
    // Shown again from the tray: catch up.
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      offs.forEach((p) => void p.then((off) => off()));
    };
  }, []);

  // Default to the first profile and its length until you pick.
  const profile = data.profiles.find((p) => p.id === profileId) ?? data.profiles[0] ?? null;
  useEffect(() => {
    if (profileId === null && data.profiles[0]) {
      setProfileId(data.profiles[0].id);
      setMinutes(data.profiles[0].defaultMinutes);
    }
  }, [data.profiles, profileId]);

  const today = todayKey();
  const items = useMemo(
    () => (agendaFor([today], data.routines, data.todos, data.checks)[today] ?? []).filter((i) => i.kind !== "event"),
    [data.routines, data.todos, data.checks, today],
  );
  const done = items.filter((i) => i.done).length;
  const shown = [...items.filter((i) => !i.done), ...items.filter((i) => i.done)].slice(0, 3);

  const toggle = async (i: AgendaItem) => {
    if (i.kind === "routine") await native.setRoutineDone(i.id, i.date, !i.done);
    else await native.setTodoDone(i.id, !i.done);
    refresh();
    void broadcast(EVENTS.planner);
  };
  const add = async () => {
    const title = draft.trim();
    if (!title) return;
    setDraft("");
    await native.saveTodo({ title, dueDate: today, dueTime: null, durationMin: null, profileId: null });
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
          className={`flex h-[22px] items-center gap-[6px] rounded-[5px] border px-[7px] text-[11px] ${
            sealed ? "border-sealed-line bg-sealed-tint text-text" : "border-line-input text-text-2"
          }`}
        >
          <span className={`h-[6px] w-[6px] rounded-full ${sealed ? "bg-sealed" : "bg-open"}`} />
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
            <span role="timer" className="font-mono text-[30px] font-medium tracking-[-0.03em] text-sealed-on">
              {countdown(s.remainingMs)}
            </span>
            <span className="truncate pl-3 text-meta text-muted">
              {s.profileName} · until {clock(s.endsAt)}
            </span>
          </div>
          <div className="h-1 overflow-hidden rounded-full bg-line">
            <div className="h-full bg-sealed" style={{ width: `${progress * 100}%` }} />
          </div>
          <div className="flex gap-[6px]">
            <button type="button" onClick={() => void native.showCompact()} className="flex h-8 flex-1 items-center justify-center gap-2 rounded-control border border-line-input bg-raised text-meta text-text transition-colors duration-ui ease-ui hover:border-check-line hover:bg-line">
              Compact timer<span className="font-mono text-[11px] text-faint">Ctrl M</span>
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
          <span className="font-mono text-[11px] text-muted">
            {done}/{items.length}
          </span>
        </div>
        {shown.map((i) => (
          <div key={i.key} className="flex h-8 shrink-0 items-center gap-[10px] px-[14px]">
            <button
              type="button"
              role="checkbox"
              aria-checked={i.done}
              aria-label={i.title}
              onClick={() => void toggle(i)}
              className={`check-pop box-border flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-[4px] ${
                i.done ? "border border-sealed bg-sealed text-sealed-on" : "border-[1.5px] border-check-line hover:border-sealed"
              }`}
            >
              {i.done ? <CheckIcon size={9} /> : null}
            </button>
            <span className={`min-w-0 grow truncate text-meta ${i.done ? "text-faint line-through" : "text-text"}`}>{i.title}</span>
            <span className="font-mono text-[11px] text-muted">{i.time ? shortTime(i.time) : ""}</span>
          </div>
        ))}
        {!items.length ? <p className="m-0 px-[14px] py-2 text-meta text-faint">Nothing planned for today.</p> : null}
        <label className="mt-auto flex h-[34px] shrink-0 items-center gap-2 border-t border-line px-[14px] text-faint focus-within:text-text-2">
          <PlusIcon size={12} />
          <input
            aria-label="Add a task for today"
            placeholder="Add a task for today"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void add()}
            className="min-w-0 grow bg-transparent text-meta text-text outline-none placeholder:text-faint"
          />
        </label>
      </div>

      <div className="flex shrink-0 items-center gap-1 border-t border-line bg-panel-footer px-[10px] py-2">
        <span className="truncate pl-1 text-[11px] text-faint">{data.next ? `Next check-in ${longTime(data.next.time)}` : "No more check-ins today"}</span>
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
          <button type="button" onClick={() => void native.quitApp()} className="ml-auto h-7 rounded-control px-2 text-meta text-muted transition-colors duration-ui ease-ui hover:bg-raised hover:text-text">
            Quit Sanctum
          </button>
        )}
      </div>
    </section>
  );
}
