import { useEffect } from "react";
import { create } from "zustand";
import { usePlanner } from "../state/planner";
import type { AgendaItem } from "../lib/planner";
import { EventDialog, OneTimeDialog } from "./week/editors";

// Today's and Tomorrow's one-time items and events (2026-11-20): one click selects a row, so you
// can see which item you have before you drag it; a double-click opens it in the same editor
// Week uses, where it can be changed or deleted. Routines repeat, so they're edited on Week.

interface SelectStore {
  key: string | null;
  editing: AgendaItem | null;
}

export const useItemSelect = create<SelectStore>()(() => ({ key: null, editing: null }));

export const selectable = (i: AgendaItem) => i.kind === "todo" || i.kind === "event";

/** Marks a row as the selected one and makes it select on click and open on double-click. */
interface SelectProps {
  "data-selectable"?: string;
  "data-selected"?: boolean;
  onClick?: (e: React.MouseEvent) => void;
  onDoubleClick?: (e: React.MouseEvent) => void;
  onKeyDown?: (e: React.KeyboardEvent) => void;
}

export function selectProps(item: AgendaItem, selected: boolean): SelectProps {
  if (!selectable(item)) return {};
  return {
    "data-selectable": "",
    "data-selected": selected || undefined,
    onClick: (e: React.MouseEvent) => {
      // The box, Focus and other controls inside the row do their own thing.
      if ((e.target as HTMLElement).closest("button, input, a, [role=checkbox]")) return;
      useItemSelect.setState({ key: item.key });
    },
    onDoubleClick: (e: React.MouseEvent) => {
      if ((e.target as HTMLElement).closest("button, input, a, [role=checkbox]")) return;
      useItemSelect.setState({ key: item.key, editing: item });
    },
    onKeyDown: (e: React.KeyboardEvent) => {
      // Enter on the selected row (its box focused) opens it too.
      if (e.key === "Enter" && selected && !e.altKey) {
        e.preventDefault();
        useItemSelect.setState({ editing: item });
      }
    },
  };
}

/** The selected item, as a key. */
export const useSelectedKey = () => useItemSelect((s) => s.key);

/** Clears the selection on a click anywhere else, or Escape. */
export function useClearSelection() {
  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (useItemSelect.getState().editing) return;
      if (!(e.target as HTMLElement | null)?.closest?.("[data-selectable]")) useItemSelect.setState({ key: null });
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !useItemSelect.getState().editing) useItemSelect.setState({ key: null });
    };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key);
    };
  }, []);
}

/** The editor for the double-clicked item. */
export function ItemEditor() {
  const editing = useItemSelect((s) => s.editing);
  const todo = usePlanner((s) => (editing?.kind === "todo" ? (s.todos.find((t) => t.id === editing.id) ?? s.pending.find((t) => t.id === editing.id)) : undefined));
  if (!editing) return null;
  const close = () => useItemSelect.setState({ editing: null });
  if (editing.kind === "event" && editing.event) return <EventDialog initial={editing.event} date={editing.date} onClose={close} />;
  if (editing.kind === "todo" && todo) return <OneTimeDialog initial={todo} date={editing.date} onClose={close} />;
  return null;
}
