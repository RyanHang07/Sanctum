import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button, Kbd } from "./Button";
import { RepeatGlyph } from "../pages/week/editors";
import { usePlanner } from "../state/planner";
import { useStore } from "../state/store";
import { parseQuickAdd } from "../lib/quickAdd";
import { addDays, daysLabel, dayOf, EVERY_DAY, fromKey, hasDay, longTime, todayKey, WEEKDAYS, WEEKDAYS_MASK } from "../lib/planner";

// Quick add (SPEC 4.12): a popover around the add field with quick picks for day, time, length,
// profile, and repeat. Typing "thu 3pm 90m @interview every mon" fills the same picks; a pick
// you click wins over what was typed.

const PANEL_W = 440;
const PANEL_H = 330;
const TIMES = ["08:00", "09:00", "12:00", "15:00", "18:00", "20:00"];
const LENGTHS = [30, 45, 60, 90, 120];

type Picks = Partial<{ date: string; time: string | null; durationMin: number | null; profileId: number | null; daysMask: number | null }>;

function Chip({ on, onClick, children, label }: { on: boolean; onClick: () => void; children: ReactNode; label?: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={label}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`h-6 shrink-0 rounded-full border px-[9px] text-[11px] transition-colors duration-ui ease-ui ${
        on ? "border-sealed-line bg-sealed-tint text-text" : "border-line-input text-muted hover:border-check-line hover:text-text"
      }`}
    >
      {children}
    </button>
  );
}

function PickRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="flex items-center gap-2">
      <span className="w-[54px] shrink-0 text-[11px] font-medium uppercase tracking-[0.06em] text-faint">{label}</span>
      <div className="flex min-w-0 flex-wrap gap-1">{children}</div>
    </div>
  );
}

const shortDay = (key: string) => fromKey(key).toLocaleDateString("en-US", { weekday: "short" });
const fullDay = (key: string) => fromKey(key).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
const lengthLabel = (m: number) => (m < 60 ? `${m}m` : m % 60 ? `${m / 60}h` : `${m / 60}h`);
const timeChip = (t: string) => longTime(t).replace(":00", "").replace(" ", "").toLowerCase();

/** Where the panel goes: over the anchor, kept on screen, flipped up near the bottom. */
function place(anchor: HTMLElement) {
  const r = anchor.getBoundingClientRect();
  const left = Math.max(8, Math.min(r.left - 8, window.innerWidth - PANEL_W - 8));
  const below = r.top - 8 + PANEL_H < window.innerHeight;
  return below ? { left, top: Math.max(8, r.top - 8) } : { left, bottom: Math.max(8, window.innerHeight - r.bottom - 8) };
}

export function QuickAddPanel({ anchor, date, initial = "", onClose }: { anchor: HTMLElement; date: string; initial?: string; onClose: () => void }) {
  const profiles = useStore((s) => s.profiles);
  const { saveTodo, saveRoutine } = usePlanner();
  const [text, setText] = useState(initial);
  const [picks, setPicks] = useState<Picks>({});
  const [pos, setPos] = useState(() => place(anchor));
  const ref = useRef<HTMLDivElement>(null);
  const today = todayKey();

  useLayoutEffect(() => setPos(place(anchor)), [anchor]);
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node) && !anchor.contains(e.target as Node)) onClose();
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [anchor, onClose]);

  const parsed = useMemo(() => parseQuickAdd(text, today, profiles), [text, today, profiles]);
  const pick = <K extends keyof Picks>(k: K, v: Picks[K]) => setPicks((p) => ({ ...p, [k]: v }));
  const value = <K extends keyof Picks>(k: K, fallback: NonNullable<Picks[K]> | null) =>
    (k in picks ? picks[k] : (parsed[k as keyof typeof parsed] as Picks[K]) ?? fallback) ?? null;

  const day = value("date", date) as string;
  const time = value("time", null) as string | null;
  const length = value("durationMin", null) as number | null;
  const profileId = value("profileId", null) as number | null;
  const mask = value("daysMask", null) as number | null;
  const title = parsed.title;

  const days = [today, addDays(today, 1), ...Array.from({ length: 5 }, (_, i) => addDays(today, i + 2))];
  if (!days.includes(day)) days.unshift(day);
  const profile = profiles.find((p) => p.id === profileId);

  const preview = [
    mask ? `Routine · ${daysLabel(mask)}` : `Once · ${day === today ? "Today" : day === addDays(today, 1) ? "Tomorrow" : fullDay(day)}`,
    time ? longTime(time) : "anytime",
    length ? `${length} min` : null,
    profile?.name ?? null,
  ]
    .filter(Boolean)
    .join(" · ");

  const add = async () => {
    if (!title) return;
    const ok = mask
      ? await saveRoutine({ title, daysMask: mask, time, durationMin: length, profileId, active: true })
      : await saveTodo({ title, dueDate: day, dueTime: time, durationMin: length, profileId });
    if (ok) {
      // Ready for the next one.
      setText("");
      setPicks({});
    }
  };

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label="Quick add"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
      style={{ ...pos, width: PANEL_W }}
      className="fixed z-50 flex animate-rise-in flex-col gap-3 rounded-panel border border-line-input bg-panel p-2 pb-3 shadow-dialog"
    >
      <input
        aria-label="Quick add"
        autoFocus
        value={text}
        placeholder="Mock interview thu 3pm 90m @interview"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && void add()}
        className="h-9 w-full rounded-control border border-line-input bg-raised px-3 text-body text-text outline-none placeholder:text-faint focus:border-sealed"
      />
      <div className="flex flex-col gap-2 px-1">
        <PickRow label="Repeat">
          <Chip on={!mask} onClick={() => pick("daysMask", null)}>
            Once
          </Chip>
          <Chip on={mask === EVERY_DAY} onClick={() => pick("daysMask", EVERY_DAY)}>
            Daily
          </Chip>
          <Chip on={mask === WEEKDAYS_MASK} onClick={() => pick("daysMask", WEEKDAYS_MASK)}>
            Weekdays
          </Chip>
          <Chip on={mask === 1 << dayOf(day)} onClick={() => pick("daysMask", 1 << dayOf(day))}>
            Every {shortDay(day)}
          </Chip>
        </PickRow>
        {mask ? (
          <PickRow label="On">
            {WEEKDAYS.map((d) => (
              <Chip key={d.name} label={d.name} on={hasDay(mask, d.bit)} onClick={() => pick("daysMask", mask ^ (1 << d.bit) || mask)}>
                {d.short}
              </Chip>
            ))}
          </PickRow>
        ) : (
          <PickRow label="Day">
            {days.map((d) => (
              <Chip key={d} on={d === day} onClick={() => pick("date", d)}>
                {d === today ? "Today" : d === addDays(today, 1) ? "Tomorrow" : shortDay(d)}
              </Chip>
            ))}
          </PickRow>
        )}
        <PickRow label="Time">
          <Chip on={!time} onClick={() => pick("time", null)}>
            Anytime
          </Chip>
          {(time && !TIMES.includes(time) ? [...TIMES, time].sort() : TIMES).map((t) => (
            <Chip key={t} on={t === time} onClick={() => pick("time", t)}>
              {timeChip(t)}
            </Chip>
          ))}
        </PickRow>
        <PickRow label="Length">
          <Chip on={!length} onClick={() => pick("durationMin", null)}>
            None
          </Chip>
          {(length && !LENGTHS.includes(length) ? [...LENGTHS, length].sort((a, b) => a - b) : LENGTHS).map((m) => (
            <Chip key={m} on={m === length} onClick={() => pick("durationMin", m)}>
              {lengthLabel(m)}
            </Chip>
          ))}
        </PickRow>
        <PickRow label="Profile">
          <Chip on={profileId === null} onClick={() => pick("profileId", null)}>
            None
          </Chip>
          {profiles.map((p) => (
            <Chip key={p.id} on={p.id === profileId} onClick={() => pick("profileId", p.id)}>
              {p.name}
            </Chip>
          ))}
        </PickRow>
      </div>
      <div className="flex items-center gap-2 border-t border-line pt-3 pl-1">
        {mask ? <RepeatGlyph className="h-3 w-3 shrink-0 text-sealed-text" /> : null}
        <span data-testid="quick-preview" className="min-w-0 grow truncate text-meta text-text-2">
          {title ? <span className="font-medium text-text">{title}</span> : <span className="text-faint">Type a name</span>}
          {" · "}
          {preview}
        </span>
        <Button variant="primary" size="sm" className="gap-2" disabled={!title} onMouseDown={(e) => e.preventDefault()} onClick={() => void add()}>
          {mask ? "Add routine" : "Add"} <Kbd onFill>↵</Kbd>
        </Button>
      </div>
    </div>,
    document.body,
  );
}

/** An add field that opens the quick-add popover when clicked or focused. */
export function QuickAddField({ date, label, placeholder, className, prefix }: { date: string; label: string; placeholder: string; className: string; prefix?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLLabelElement>(null);
  return (
    <>
      <label ref={ref} className={className}>
        {prefix}
        <input
          aria-label={label}
          readOnly
          placeholder={placeholder}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          className="h-full min-w-0 grow cursor-text border-none bg-transparent text-body text-text outline-none placeholder:text-faint"
        />
      </label>
      {open && ref.current ? <QuickAddPanel anchor={ref.current} date={date} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
