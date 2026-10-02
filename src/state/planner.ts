import { create } from "zustand";
import { errorText, native } from "../lib/native";
import { addDays, todayKey, type AgendaItem } from "../lib/planner";
import type { Routine, RoutineCheck, RoutineDraft, Todo, TodoDraft } from "../lib/types";
import { useStore } from "./store";

/** How far back Pending looks for unfinished one-time items. */
const PENDING_DAYS = 60;

/** How long a delete can be undone. The item goes at once; the backend delete waits this long. */
export const UNDO_MS = 5000;

/** Deletes waiting out their undo window, so a reload meanwhile doesn't bring them back. */
const deleting = { todos: new Set<number>(), routines: new Set<number>() };

// Routines (recurring) and one-time items (SPEC 4.12). Loaded for a date range that grows to
// cover whatever Home and Week are showing.

export interface PlannerStore {
  routines: Routine[];
  todos: Todo[];
  checks: RoutineCheck[];
  /** Inclusive "YYYY-MM-DD" range the todos and checks cover. */
  range: [string, string] | null;
  loaded: boolean;
  /** Unfinished one-time items from before today (the List view's Pending section). */
  pending: Todo[];

  /** Makes sure [from, to] is loaded (widening the range if needed). */
  ensure: (from: string, to: string) => Promise<void>;
  reload: () => Promise<void>;
  loadPending: () => Promise<void>;
  saveRoutine: (d: RoutineDraft) => Promise<Routine | null>;
  deleteRoutine: (id: number) => Promise<boolean>;
  saveTodo: (d: TodoDraft) => Promise<Todo | null>;
  deleteTodo: (id: number) => Promise<boolean>;
  /** Saves a drag order: routines everywhere, or one day's items. */
  reorderRoutines: (ids: number[]) => Promise<void>;
  reorderTodos: (ids: number[]) => Promise<void>;
  /** Checks an item off (a routine only for that day) or back on. */
  toggle: (item: AgendaItem) => Promise<void>;
}

async function attempt<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (e) {
    useStore.getState().showNotice({ lead: errorText(e) });
    return null;
  }
}

export const usePlanner = create<PlannerStore>()((set, get) => ({
  routines: [],
  todos: [],
  checks: [],
  range: null,
  loaded: false,
  pending: [],

  ensure: async (from, to) => {
    const r = get().range;
    if (r && r[0] <= from && r[1] >= to && get().loaded) return;
    const range: [string, string] = r ? [from < r[0] ? from : r[0], to > r[1] ? to : r[1]] : [from, to];
    set({ range });
    await get().reload();
  },

  reload: async () => {
    const today = todayKey();
    const range = get().range ?? [today, addDays(today, 1)];
    const [routines, todos, checks] = await Promise.all([
      native.listRoutines(),
      native.listTodos(range[0], range[1]),
      native.listRoutineChecks(range[0], range[1]),
    ]).catch(() => [[], [], []] as [Routine[], Todo[], RoutineCheck[]]);
    set({
      routines: routines.filter((r) => !deleting.routines.has(r.id)),
      todos: todos.filter((t) => !deleting.todos.has(t.id)),
      checks: checks.filter((c) => !deleting.routines.has(c.routineId)),
      range,
      loaded: true,
    });
  },

  loadPending: async () => {
    const today = todayKey();
    const past = await native.listTodos(addDays(today, -PENDING_DAYS), addDays(today, -1)).catch(() => [] as Todo[]);
    set({ pending: past.filter((t) => !t.done && !deleting.todos.has(t.id)) });
  },

  saveRoutine: async (d) => {
    const r = await attempt(() => native.saveRoutine(d));
    if (r) set({ routines: [...get().routines.filter((x) => x.id !== r.id), r] });
    return r;
  },

  deleteRoutine: async (id) => {
    const r = get().routines.find((x) => x.id === id);
    if (!r) return false;
    const checks = get().checks.filter((c) => c.routineId === id);
    deleting.routines.add(id);
    set({ routines: get().routines.filter((x) => x.id !== id), checks: get().checks.filter((c) => c.routineId !== id) });
    const timer = setTimeout(() => {
      deleting.routines.delete(id);
      void attempt(() => native.deleteRoutine(id)).then((ok) => ok === null && void get().reload());
    }, UNDO_MS);
    useStore.getState().showNotice({
      lead: `Deleted “${r.title}”.`,
      ms: UNDO_MS,
      action: {
        label: "Undo",
        run: () => {
          clearTimeout(timer);
          deleting.routines.delete(id);
          set({ routines: [...get().routines, r], checks: [...get().checks, ...checks] });
        },
      },
    });
    return true;
  },

  saveTodo: async (d) => {
    const t = await attempt(() => native.saveTodo(d));
    if (t) {
      set({ todos: [...get().todos.filter((x) => x.id !== t.id), t], pending: get().pending.filter((x) => x.id !== t.id) });
      // Moving a pending item to an earlier undone date keeps it pending.
      if (!t.done && t.dueDate < todayKey()) set({ pending: [...get().pending, t] });
    }
    return t;
  },

  deleteTodo: async (id) => {
    const inTodos = get().todos.find((x) => x.id === id);
    const inPending = get().pending.find((x) => x.id === id);
    const t = inTodos ?? inPending;
    if (!t) return false;
    deleting.todos.add(id);
    set({ todos: get().todos.filter((x) => x.id !== id), pending: get().pending.filter((x) => x.id !== id) });
    const timer = setTimeout(() => {
      deleting.todos.delete(id);
      void attempt(() => native.deleteTodo(id)).then((ok) => ok === null && void get().reload());
    }, UNDO_MS);
    useStore.getState().showNotice({
      lead: `Deleted “${t.title}”.`,
      ms: UNDO_MS,
      action: {
        label: "Undo",
        run: () => {
          clearTimeout(timer);
          deleting.todos.delete(id);
          set({ todos: inTodos ? [...get().todos, inTodos] : get().todos, pending: inPending ? [...get().pending, inPending] : get().pending });
        },
      },
    });
    return true;
  },

  reorderRoutines: async (ids) => {
    // Optimistic: the list moves now, and goes back if the backend refuses.
    const before = get().routines;
    const at = new Map(ids.map((id, i) => [id, i]));
    set({ routines: before.map((r) => (at.has(r.id) ? { ...r, sort: at.get(r.id)! } : r)) });
    if ((await attempt(() => native.reorderRoutines(ids).then(() => true))) === null) set({ routines: before });
  },

  reorderTodos: async (ids) => {
    const before = get().todos;
    const at = new Map(ids.map((id, i) => [id, i]));
    set({ todos: before.map((t) => (at.has(t.id) ? { ...t, sort: at.get(t.id)! } : t)) });
    if ((await attempt(() => native.reorderTodos(ids).then(() => true))) === null) set({ todos: before });
  },

  toggle: async (item) => {
    const done = !item.done;
    if (item.kind === "routine") {
      // Optimistic: flip it now, undo if the backend refuses.
      const before = get().checks;
      set({ checks: done ? [...before, { routineId: item.id, date: item.date }] : before.filter((c) => !(c.routineId === item.id && c.date === item.date)) });
      if ((await attempt(() => native.setRoutineDone(item.id, item.date, done).then(() => true))) === null) set({ checks: before });
    } else {
      // Checking off a pending item clears it from Pending.
      set({ todos: get().todos.map((t) => (t.id === item.id ? { ...t, done } : t)), pending: get().pending.filter((t) => !(t.id === item.id && done)) });
      const t = await attempt(() => native.setTodoDone(item.id, done));
      if (!t) set({ todos: get().todos.map((x) => (x.id === item.id ? { ...x, done: !done } : x)) });
    }
  },
}));

// App-wide state: hot-swapping this module would split it into two copies (the UI reading an
// empty one). Reload the page instead.
import.meta.hot?.accept(() => window.location.reload());
