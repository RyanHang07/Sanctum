// Drag between days (v0.1): one-time items and single-day events on your own calendars move;
// routines repeat, so they stay put. The move saves like an edit (events go to Google).
// Pending (no day yet) is a drop target too: an item dropped there is parked on that week.

import { usePlanner } from "../../state/planner";
import { useCalendar } from "../../state/calendar";
import type { AgendaItem } from "../../lib/planner";
import type { Todo } from "../../lib/types";

/** What's being dragged right now (one drag at a time, across days and Pending). */
export const drag: { item: AgendaItem | null } = { item: null };

export const todoItem = (t: Todo): AgendaItem => ({
  key: `todo:${t.id}`,
  kind: "todo",
  id: t.id,
  title: t.title,
  date: t.dueDate,
  time: t.dueTime,
  durationMin: t.durationMin,
  profileId: t.profileId,
  done: t.done,
  order: t.sort,
  undated: t.undated,
});

/** Items that can move to another day. */
export function canMove(i: AgendaItem): boolean {
  if (i.kind === "todo") return true;
  if (i.kind === "event") return !!i.event?.writable && i.event.date === i.event.endDate;
  return false;
}

const findTodo = (id: number) => {
  const { todos, pending } = usePlanner.getState();
  return todos.find((x) => x.id === id) ?? pending.find((x) => x.id === id);
};

/** Saves an item on a new day, keeping everything else. A pending item gets its day. */
export async function moveTo(item: AgendaItem, date: string): Promise<boolean> {
  if ((item.date === date && !item.undated) || !canMove(item)) return false;
  if (item.kind === "todo") {
    const t = findTodo(item.id);
    if (!t) return false;
    return !!(await usePlanner.getState().saveTodo({ id: t.id, title: t.title, dueDate: date, dueTime: t.dueTime, durationMin: t.durationMin, profileId: t.profileId, undated: false }));
  }
  const e = item.event!;
  return useCalendar.getState().saveEvent({ calendarId: e.calendarId, eventId: e.eventId, title: e.title, date, time: e.time, durationMin: e.durationMin });
}

/** Parks a one-time item on a week with no day yet (Pending). */
export async function parkOn(item: AgendaItem, week: string): Promise<boolean> {
  if (item.kind !== "todo" || (item.undated && item.date === week)) return false;
  const t = findTodo(item.id);
  if (!t) return false;
  return !!(await usePlanner.getState().saveTodo({ id: t.id, title: t.title, dueDate: week, dueTime: null, durationMin: t.durationMin, profileId: t.profileId, undated: true }));
}

export function dragProps(item: AgendaItem) {
  if (!canMove(item)) return {};
  return {
    draggable: true,
    onDragStart: (ev: React.DragEvent) => {
      drag.item = item;
      ev.dataTransfer?.setData("text/plain", item.title);
      if (ev.dataTransfer) ev.dataTransfer.effectAllowed = "move";
    },
    onDragEnd: () => {
      drag.item = null;
    },
  };
}
