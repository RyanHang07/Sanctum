import { create } from "zustand";
import { errorText, native } from "../lib/native";
import { addDays, todayKey, type AgendaItem } from "../lib/planner";
import type { Routine, RoutineCheck, RoutineDraft, Todo, TodoDraft } from "../lib/types";
import { useStore } from "./store";
import { onMockReset } from "../lib/mockBackend";

/** How far back Pending looks for unfinished one-time items. */
const PENDING_DAYS = 60;

/** How long a delete can be undone. The item goes at once; the backend delete waits this long. */
export const UNDO_MS = 5000;

/** Deletes waiting out their undo window, so a reload meanwhile doesn't bring them back. */
const deleting = { todos: new Set<number>(), routines: new Set<number>() };
/** Deletes waiting out their undo window, by "todo:<id>" / "routine:<id>". Quitting runs them. */
const undoable = new Map<string, () => Promise<unknown>>();
/** The undo windows' timers, by the same keys, so a reset can stop them. */
const undoTimers = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Only the latest reload sets state: an older one (an `ensure` for another range, or a Google
 * sync) finishing late must not overwrite a newer one.
 */
let reloadGen = 0;
let latestReload: Promise<void> | null = null;
/** Bumped when a local edit starts and when it settles; a reload that spans one is stale. */
let editGen = 0;
let editsInFlight = 0;
/** A reload was dropped for an edit still in flight: run one when the edits settle. */
let reloadAfterEdits = false;
/** Bumped by a reset: an edit started before it settles without touching the new counts. */
let editEpoch = 0;

/** Runs a local edit (optimistic set, then the backend), so reloads around it know. */
async function edit<T>(fn: () => Promise<T>): Promise<T> {
  const epoch = editEpoch;
  editGen++;
  editsInFlight++;
  try {
    return await fn();
  } finally {
    if (epoch === editEpoch) settle();
  }
}

/** An edit settled: reloads see it, and one dropped meanwhile runs now. */
function settle() {
  editsInFlight = Math.max(0, editsInFlight - 1);
  editGen++;
  if (!editsInFlight && reloadAfterEdits) {
    reloadAfterEdits = false;
    void usePlanner.getState().reload();
  }
}

/** Forgets deletes in their undo window and stops their timers (tests: between cases). */
export function resetPlannerPending(): void {
  undoTimers.forEach((t) => clearTimeout(t));
  undoTimers.clear();
  undoable.clear();
  deleting.todos.clear();
  deleting.routines.clear();
  reloadGen++;
  latestReload = null;
  editGen = 0;
  editEpoch++;
  editsInFlight = 0;
  reloadAfterEdits = false;
}
onMockReset(resetPlannerPending);

/** Carries out every delete still in its undo window (before quitting). */
export async function flushDeletes(): Promise<void> {
  await Promise.allSettled([...undoable.values()].map((commit) => commit()));
}

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
    // Already covered: wait for a reload of it that may still be running.
    if (r && r[0] <= from && r[1] >= to && get().loaded) return latestReload ?? undefined;
    const range: [string, string] = r ? [from < r[0] ? from : r[0], to > r[1] ? to : r[1]] : [from, to];
    set({ range });
    await get().reload();
  },

  reload: async () => {
    const reset = useStore.getState().settings.dailyResetTime;
    const today = todayKey(new Date(), reset);
    const range = get().range ?? [today, addDays(today, 1)];
    const gen = ++reloadGen;
    const edits = editGen;
    const fetched = Promise.all([
      native.listRoutines(),
      native.listTodos(range[0], range[1]),
      native.listRoutineChecks(range[0], range[1]),
    ]).catch(() => [[], [], []] as [Routine[], Todo[], RoutineCheck[]]);
    const done = fetched.then(() => undefined);
    latestReload = done;
    const [routines, todos, checks] = await fetched;
    if (gen !== reloadGen) return;
    if (latestReload === done) latestReload = null;
    // A local edit started or settled while this was in flight: its optimistic state wins, and a
    // fresh read follows once the backend has it.
    if (edits !== editGen || editsInFlight) {
      if (editsInFlight) reloadAfterEdits = true;
      else return get().reload();
      return;
    }
    set({
      routines: routines.filter((r) => !deleting.routines.has(r.id)),
      todos: todos.filter((t) => !deleting.todos.has(t.id)),
      checks: checks.filter((c) => !deleting.routines.has(c.routineId)),
      range,
      loaded: true,
    });
  },

  loadPending: async () => {
    const reset = useStore.getState().settings.dailyResetTime;
    const today = todayKey(new Date(), reset);
    const past = await native.listTodos(addDays(today, -PENDING_DAYS), addDays(today, -1)).catch(() => [] as Todo[]);
    set({ pending: past.filter((t) => !t.done && !deleting.todos.has(t.id)) });
  },

  saveRoutine: async (d) => {
    const r = await edit(() => attempt(() => native.saveRoutine(d)));
    if (r) set({ routines: [...get().routines.filter((x) => x.id !== r.id), r] });
    return r;
  },

  deleteRoutine: async (id) => {
    const r = get().routines.find((x) => x.id === id);
    if (!r) return false;
    const checks = get().checks.filter((c) => c.routineId === id);
    deleting.routines.add(id);
    set({ routines: get().routines.filter((x) => x.id !== id), checks: get().checks.filter((c) => c.routineId !== id) });
    const commit = () => {
      clearTimeout(timer);
      undoable.delete(`routine:${id}`);
      undoTimers.delete(`routine:${id}`);
      deleting.routines.delete(id);
      return attempt(() => native.deleteRoutine(id)).then((ok) => ok === null && void get().reload());
    };
    const timer = setTimeout(() => void commit(), UNDO_MS);
    undoable.set(`routine:${id}`, commit);
    undoTimers.set(`routine:${id}`, timer);
    useStore.getState().showNotice({
      lead: `Deleted “${r.title}”.`,
      ms: UNDO_MS,
      action: {
        label: "Undo",
        run: () => {
          clearTimeout(timer);
          undoable.delete(`routine:${id}`);
          undoTimers.delete(`routine:${id}`);
          deleting.routines.delete(id);
          set({ routines: [...get().routines, r], checks: [...get().checks, ...checks] });
        },
      },
    });
    return true;
  },

  saveTodo: async (d) => {
    const t = await edit(() => attempt(() => native.saveTodo(d)));
    if (t) {
      const reset = useStore.getState().settings.dailyResetTime;
      const today = todayKey(new Date(), reset);
      set({ todos: [...get().todos.filter((x) => x.id !== t.id), t], pending: get().pending.filter((x) => x.id !== t.id) });
      // Moving a pending item to an earlier undone date keeps it pending.
      if (!t.done && t.dueDate < today) set({ pending: [...get().pending, t] });
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
    const commit = () => {
      clearTimeout(timer);
      undoable.delete(`todo:${id}`);
      undoTimers.delete(`todo:${id}`);
      deleting.todos.delete(id);
      return attempt(() => native.deleteTodo(id)).then((ok) => ok === null && void get().reload());
    };
    const timer = setTimeout(() => void commit(), UNDO_MS);
    undoable.set(`todo:${id}`, commit);
    undoTimers.set(`todo:${id}`, timer);
    useStore.getState().showNotice({
      lead: `Deleted “${t.title}”.`,
      ms: UNDO_MS,
      action: {
        label: "Undo",
        run: () => {
          clearTimeout(timer);
          undoable.delete(`todo:${id}`);
          undoTimers.delete(`todo:${id}`);
          deleting.todos.delete(id);
          set({ todos: inTodos ? [...get().todos, inTodos] : get().todos, pending: inPending ? [...get().pending, inPending] : get().pending });
        },
      },
    });
    return true;
  },

  reorderRoutines: (ids) =>
    edit(async () => {
    // Optimistic: the list moves now, and goes back if the backend refuses.
    const before = get().routines;
    const at = new Map(ids.map((id, i) => [id, i]));
    set({ routines: before.map((r) => (at.has(r.id) ? { ...r, sort: at.get(r.id)! } : r)) });
    if ((await attempt(() => native.reorderRoutines(ids).then(() => true))) === null) set({ routines: before });
    }),

  reorderTodos: (ids) =>
    edit(async () => {
    const before = get().todos;
    const at = new Map(ids.map((id, i) => [id, i]));
    set({ todos: before.map((t) => (at.has(t.id) ? { ...t, sort: at.get(t.id)! } : t)) });
    if ((await attempt(() => native.reorderTodos(ids).then(() => true))) === null) set({ todos: before });
    }),

  toggle: (item) =>
    edit(async () => {
    if (item.kind === "routine") {
      const target = Math.max(1, item.sessionsTarget ?? 1);
      const current = Math.min(target, Math.max(0, item.sessionsDone ?? (item.done ? target : 0)));
      // Step up until complete; if already complete, step down by one (undo one session).
      const completed = current < target ? current + 1 : Math.max(0, current - 1);
      const before = get().checks;
      const next = before.filter((c) => !(c.routineId === item.id && c.date === item.date));
      if (completed > 0) next.push({ routineId: item.id, date: item.date, completed });
      set({ checks: next });
      if ((await attempt(() => native.setRoutineProgress(item.id, item.date, completed).then(() => true))) === null) set({ checks: before });
    } else {
      const done = !item.done;
      // Checking off a pending item clears it from Pending.
      set({ todos: get().todos.map((t) => (t.id === item.id ? { ...t, done } : t)), pending: get().pending.filter((t) => !(t.id === item.id && done)) });
      const t = await attempt(() => native.setTodoDone(item.id, done));
      if (!t) set({ todos: get().todos.map((x) => (x.id === item.id ? { ...x, done: !done } : x)) });
    }
    }),
}));

// App-wide state: hot-swapping this module would split it into two copies (the UI reading an
// empty one). Reload the page instead.
import.meta.hot?.accept(() => window.location.reload());
