import { useState } from "react";
import { Button, Kbd } from "../../components/Button";
import { Dialog, Switch } from "../../components/controls";
import { DaysField, LengthField, ProfileField, SaveToField, TimeField, TitleInput } from "./fields";
import { usePlanner } from "../../state/planner";
import { useCalendar } from "../../state/calendar";
import { useStore } from "../../state/store";
import { EVERY_DAY, addDays, fromKey, longTime, todayKey, weekStart } from "../../lib/planner";
import { focusTagText, readFocusTag, writeFocusTag } from "../../lib/calendar";
import { native } from "../../lib/native";
import type { CalEvent, Profile, Routine, Todo } from "../../lib/types";

// One-time items and routines are created in visibly different places (SPEC 4.12):
// a light card on a day for one-time items, a full editor with weekday chips for routines.

const RepeatGlyph = ({ className = "" }: { className?: string }) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
    <path d="M17 2l3 3-3 3" />
    <path d="M4 11V9a4 4 0 0 1 4-4h12" />
    <path d="M7 22l-3-3 3-3" />
    <path d="M20 13v2a4 4 0 0 1-4 4H4" />
  </svg>
);
export { RepeatGlyph };

/** Calendars you can add events to from Sanctum (not Sanctum's own, which is for items). */
function useWritableCalendars() {
  const connected = useCalendar((s) => !!s.status?.connected);
  const calendars = useCalendar((s) => s.calendars);
  return connected ? calendars.filter((c) => c.writable && !c.sanctum) : [];
}

const SANCTUM = "sanctum";

const fieldClass = "h-control rounded-control border border-line-input bg-raised px-[10px] text-body text-text outline-none [color-scheme:dark] focus:border-sealed";

/**
 * The date, or (Pending) no day yet: parked on this week or next. `week` is the Monday it's
 * parked on, or null when it has a day.
 */
function DateField({ value, onChange, week, onWeek }: { value: string; onChange: (v: string) => void; week?: string | null; onWeek?: (w: string | null) => void }) {
  const thisWeek = weekStart(todayKey());
  const nextWeek = addDays(thisWeek, 7);
  return (
    <div className="flex flex-col gap-1">
      <span className="flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-faint">Date</span>
        {onWeek ? (
          <label className="flex cursor-pointer items-center gap-[6px] text-[11px] text-muted hover:text-text-2">
            <input type="checkbox" checked={week != null} onChange={(e) => onWeek(e.target.checked ? (value >= nextWeek ? nextWeek : thisWeek) : null)} className="accent-sealed" />
            No day yet
          </label>
        ) : null}
      </span>
      {week != null && onWeek ? (
        <select aria-label="Week" value={week} onChange={(e) => onWeek(e.target.value)} className={`${fieldClass} cursor-pointer`}>
          {/* An item parked on an older week stays there until you choose. */}
          {week < thisWeek ? <option value={week}>Week of {fromKey(week).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</option> : null}
          <option value={thisWeek}>This week</option>
          <option value={nextWeek}>Next week</option>
        </select>
      ) : (
        <input type="date" aria-label="Date" value={value} onChange={(e) => e.target.value && onChange(e.target.value)} className={fieldClass} />
      )}
    </div>
  );
}

/** Title with the focus tag for `profileId`, keeping an existing tag if the profile didn't change. */
function taggedTitle(title: string, profileId: number | null, profiles: Profile[], original?: { tag: string | null; profileId: number | null }) {
  if (original?.tag && profileId === original.profileId) return `${title.trim()} ${original.tag}`;
  return writeFocusTag(title, profiles.find((p) => p.id === profileId) ?? null);
}

/** New or edit a one-time item, with its date (Week's "+ New", or clicking an item). */
export function OneTimeDialog({ initial, date, onClose }: { initial?: Todo; date: string; onClose: () => void }) {
  const { saveTodo, deleteTodo } = usePlanner();
  const saveEvent = useCalendar((s) => s.saveEvent);
  const profiles = useStore((s) => s.profiles);
  const calendars = useWritableCalendars();
  const [title, setTitle] = useState(initial?.title ?? "");
  const [due, setDue] = useState(initial?.dueDate ?? date);
  const [time, setTime] = useState(initial?.dueTime ?? null);
  const [length, setLength] = useState(initial?.durationMin ?? null);
  const [profile, setProfile] = useState(initial?.profileId ?? null);
  const [target, setTarget] = useState(SANCTUM);
  // Pending: the Monday it's parked on, or null when it has a day.
  const [week, setWeek] = useState<string | null>(initial?.undated ? initial.dueDate : null);

  const save = async () => {
    if (!title.trim()) return;
    const ok =
      target === SANCTUM
        ? await saveTodo(
            week
              ? { id: initial?.id, title, dueDate: week, dueTime: null, durationMin: length, profileId: profile, undated: true }
              : { id: initial?.id, title, dueDate: due, dueTime: time, durationMin: length, profileId: profile, undated: false },
          )
        : await saveEvent({ calendarId: target, title: taggedTitle(title, profile, profiles), date: due, time, durationMin: time ? length : null });
    if (ok) onClose();
  };

  return (
    <Dialog label={initial ? "Edit item" : "New item"} onClose={onClose} width={440} top={120}>
      <div className="flex flex-col gap-4 px-[18px] pb-4 pt-[18px]">
        <div className="flex items-baseline justify-between">
          <h1 className="m-0 text-[16px] font-semibold tracking-[-0.01em]">{initial ? "Edit item" : "New item"}</h1>
          <span className="text-meta text-muted">Once</span>
        </div>
        <TitleInput value={title} onChange={setTitle} onSubmit={() => void save()} placeholder="Mock interview" />
        <div className="grid grid-cols-2 gap-3">
          <DateField value={due} onChange={setDue} week={week} onWeek={target === SANCTUM ? setWeek : undefined} />
          {week ? <div /> : <TimeField value={time} onChange={setTime} empty={target === SANCTUM ? "Anytime" : "All day"} />}
          <LengthField value={length} onChange={setLength} />
          <ProfileField value={profile} onChange={setProfile} />
          {!initial && calendars.length ? (
            <div className="col-span-2">
              <SaveToField
                value={target}
                onChange={setTarget}
                options={[{ value: SANCTUM, label: "Sanctum (a to-do)" }, ...calendars.map((c) => ({ value: c.id, label: `${c.summary} (an event)` }))]}
              />
            </div>
          ) : null}
        </div>
      </div>
      <div className="flex items-center gap-2 border-t border-line bg-panel-footer px-[18px] py-3">
        {initial ? (
          <Button variant="ghost" onClick={() => void deleteTodo(initial.id).then((ok) => ok && onClose())}>
            Delete
          </Button>
        ) : null}
        <Button variant="ghost" className="ml-auto" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" className="gap-[10px]" disabled={!title.trim()} onClick={() => void save()}>
          {initial ? "Save" : "Add"}
          <Kbd onFill>↵</Kbd>
        </Button>
      </div>
    </Dialog>
  );
}

/** New or edit a routine: weekday chips, time, length, and a profile (Routines view). */
export function RoutineDialog({ initial, onClose }: { initial?: Routine; onClose: () => void }) {
  const { saveRoutine, deleteRoutine } = usePlanner();
  const [title, setTitle] = useState(initial?.title ?? "");
  const [mask, setMask] = useState(initial?.daysMask ?? EVERY_DAY);
  const [time, setTime] = useState(initial?.time ?? null);
  const [length, setLength] = useState(initial?.durationMin ?? null);
  const [profile, setProfile] = useState(initial?.profileId ?? null);
  const [active, setActive] = useState(initial?.active ?? true);

  const save = async () => {
    if (!title.trim() || !mask) return;
    if (await saveRoutine({ id: initial?.id, title, daysMask: mask, time, durationMin: length, profileId: profile, active })) onClose();
  };

  return (
    <Dialog label={initial ? "Edit routine" : "New routine"} onClose={onClose} width={460} top={96}>
      <div className="flex flex-col gap-4 border-l-2 border-sealed-line px-[18px] pb-4 pt-[18px]">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-panel border border-sealed-line bg-sealed-tint text-sealed-text">
            <RepeatGlyph />
          </span>
          <h1 className="m-0 text-[16px] font-semibold tracking-[-0.01em]">{initial ? "Edit routine" : "New routine"}</h1>
          {initial ? (
            <span className="ml-auto flex items-center gap-2 text-meta text-muted">
              Active
              <Switch label="Active" checked={active} onChange={setActive} />
            </span>
          ) : null}
        </div>
        <TitleInput value={title} onChange={setTitle} onSubmit={() => void save()} placeholder="Gym" />
        <DaysField mask={mask} onChange={setMask} />
        <div className="grid grid-cols-3 gap-3">
          <TimeField value={time} onChange={setTime} />
          <LengthField value={length} onChange={setLength} />
          <ProfileField value={profile} onChange={setProfile} />
        </div>
        {profile !== null && time ? (
          <p className="m-0 text-meta text-muted">Home suggests this profile when it starts, and offers to enter focus.</p>
        ) : null}
      </div>
      <div className="flex items-center gap-2 border-t border-line bg-panel-footer px-[18px] py-3">
        {initial ? (
          <Button variant="ghost" onClick={() => void deleteRoutine(initial.id).then((ok) => ok && onClose())}>
            Delete
          </Button>
        ) : null}
        <Button variant="ghost" className="ml-auto" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" className="gap-[10px]" disabled={!title.trim() || !mask} onClick={() => void save()}>
          <RepeatGlyph />
          {initial ? "Save routine" : "Add routine"}
        </Button>
      </div>
    </Dialog>
  );
}

/**
 * An event on one of your Google calendars (SPEC 4.3, fully editable from Week). Setting a
 * focus profile writes #focus:<profile> into the title, so Google keeps it too.
 */
export function EventDialog({ initial, date, onClose }: { initial?: CalEvent; date: string; onClose: () => void }) {
  const { saveEvent, deleteEvent } = useCalendar();
  const profiles = useStore((s) => s.profiles);
  const homeProfile = useStore((s) => s.selectedProfileId);
  const calendars = useWritableCalendars();
  // A bare #focus uses the profile picked on Home; show that, and keep the bare tag unless changed.
  const tag = readFocusTag(initial?.title ?? "", profiles, homeProfile);
  const original = { tag: focusTagText(initial?.title ?? ""), profileId: tag.profileId };
  const [title, setTitle] = useState(tag.title);
  const [due, setDue] = useState(initial?.date ?? date);
  const [time, setTime] = useState(initial?.time ?? null);
  const [length, setLength] = useState(initial?.durationMin ?? null);
  const [profile, setProfile] = useState<number | null>(tag.profileId);
  const [calendarId, setCalendarId] = useState(initial?.calendarId ?? calendars[0]?.id ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const readOnly = !!initial && !initial.writable;
  // A recurring event edits one occurrence or the whole series (v0.1).
  const inSeries = !!initial?.recurring && !!initial.seriesId && !readOnly;
  const [scope, setScope] = useState<"one" | "all">("one");
  const all = inSeries && scope === "all";
  const heading = initial ? (readOnly ? initial.calendarName : "Edit event") : "New event";

  const save = async () => {
    if (!title.trim() || !calendarId || readOnly) return;
    const ok = await saveEvent({
      calendarId,
      eventId: initial?.eventId,
      title: taggedTitle(title, profile, profiles, initial ? original : undefined),
      date: all ? initial!.date : due,
      time,
      durationMin: time ? length : null,
      seriesId: all ? initial!.seriesId : null,
    });
    if (ok) onClose();
  };
  const remove = async () => {
    if (!confirmDelete) return setConfirmDelete(true);
    if (initial && (await deleteEvent(initial, all))) onClose();
  };

  return (
    <Dialog label={heading} onClose={onClose} width={440} top={120}>
      <div className="flex flex-col gap-4 border-l-2 border-event-line px-[18px] pb-4 pt-[18px]">
        <div className="flex items-baseline justify-between gap-3">
          <h1 className="m-0 text-[16px] font-semibold tracking-[-0.01em]">{heading}</h1>
          <span className="truncate text-meta text-muted">
            {initial ? initial.calendarName : "Google Calendar"}
          </span>
        </div>
        {inSeries ? (
          <div role="radiogroup" aria-label="Apply to" className="flex self-start rounded-control border border-line-input p-[2px]">
            {(
              [
                ["one", "This event"],
                ["all", "All events"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={scope === id}
                onClick={() => {
                  setScope(id);
                  setConfirmDelete(false);
                }}
                className={`h-[26px] rounded-[4px] px-3 text-meta transition-colors duration-ui ease-ui ${scope === id ? "bg-line font-medium text-text" : "text-muted hover:text-text-2"}`}
              >
                {label}
              </button>
            ))}
          </div>
        ) : null}
        {readOnly && initial ? (
          <div className="flex flex-col gap-1">
            <span className="text-[15px] font-medium text-text">{tag.title}</span>
            <span className="text-meta text-muted">
              {fromKey(initial.date).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
              {initial.time ? ` · ${longTime(initial.time)}` : " · All day"}
            </span>
            <span className="text-meta text-faint">This calendar is read-only.</span>
          </div>
        ) : (
          <>
            <TitleInput value={title} onChange={setTitle} onSubmit={() => void save()} placeholder="Mock interview" />
            <div className="grid grid-cols-2 gap-3">
              {all ? (
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-faint">Date</span>
                  <span className="flex h-control items-center text-meta text-muted">Repeats as set in Google</span>
                </div>
              ) : (
                <DateField value={due} onChange={setDue} />
              )}
              <TimeField value={time} onChange={setTime} empty="All day" />
              <LengthField value={length} onChange={setLength} />
              <ProfileField value={profile} onChange={setProfile} />
              {!initial && calendars.length > 1 ? (
                <div className="col-span-2">
                  <SaveToField value={calendarId} onChange={setCalendarId} options={calendars.map((c) => ({ value: c.id, label: c.summary }))} />
                </div>
              ) : null}
            </div>
          </>
        )}
      </div>
      <div className="flex items-center gap-2 border-t border-line bg-panel-footer px-[18px] py-3">
        {initial && !readOnly ? (
          <Button variant="ghost" onClick={() => void remove()}>
            {confirmDelete ? (all ? "Delete every occurrence" : "Delete from Google") : all ? "Delete series" : "Delete"}
          </Button>
        ) : null}
        {initial?.htmlLink ? (
          <Button variant="quiet" onClick={() => void native.gcalOpen(initial.htmlLink!)}>
            Open in Google
          </Button>
        ) : null}
        <Button variant="ghost" className="ml-auto" onClick={onClose}>
          {readOnly ? "Close" : "Cancel"}
        </Button>
        {readOnly ? null : (
          <Button variant="primary" className="gap-[10px]" disabled={!title.trim() || !calendarId} onClick={() => void save()}>
            {initial ? "Save" : "Add"}
            <Kbd onFill>↵</Kbd>
          </Button>
        )}
      </div>
    </Dialog>
  );
}
