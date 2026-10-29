import { native } from "../lib/native";
import { flushJournal } from "./journal";
import { useNotes } from "./notes";
import { flushDeletes } from "./planner";

/** Saves what's still waiting (typing in a note or the journal, deletes in their undo window). */
export async function saveEverything(): Promise<void> {
  await Promise.allSettled([useNotes.getState().flush(), flushJournal(), flushDeletes()]);
}

/** Quits once everything waiting is saved. */
export async function quitSaved(): Promise<void> {
  await saveEverything();
  await native.quitApp();
}
