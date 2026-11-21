import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NotesPage } from "./NotesPage";
import { NoteWindow, noteWindowTitle } from "../../windows/NoteWindow";
import { useNotes } from "../../state/notes";
import { useStore } from "../../state/store";
import { MOCK_NOTES_CHANNEL, resetMockBackend } from "../../lib/mockBackend";
import { EVENTS, native } from "../../lib/native";
import { noteIdFromView, windowLabel } from "../../lib/noteWindows";
import { bus } from "../../lib/bus";

// A note in its own window (2026-11-20).

const initial = useStore.getState();
const initialNotes = useNotes.getState();

beforeEach(() => {
  resetMockBackend();
  useStore.setState(initial, true);
  useNotes.setState(initialNotes, true);
});

afterEach(() => vi.restoreAllMocks());

describe("note windows", () => {
  it("reads the note id from the window's hash", () => {
    expect(noteIdFromView("note/12")).toBe(12);
    for (const v of ["", "tray", "note/", "note/x", "note/0", "notes/3"]) expect(noteIdFromView(v)).toBeNull();
    expect(windowLabel()).toBe("main");
    expect(noteWindowTitle({ title: "  " })).toBe("Note");
    expect(noteWindowTitle({ title: "Books" })).toBe("Books");
  });

  it("opens a note in its own window and shows a placeholder in its place", async () => {
    const n = await native.saveNote({ title: "Launch plan", body: "ship it" });
    const open = vi.spyOn(native, "noteWindowOpen");
    render(<NotesPage />);
    const button = await screen.findByRole("button", { name: "Open in new window" });
    expect(button.getAttribute("title")).toBe("Open in new window");
    await act(async () => fireEvent.click(button));
    expect(open).toHaveBeenCalledWith(n.id, expect.any(String), null);
    // No second editor while the note has its own window.
    await screen.findByText("Open in its own window.");
    expect(screen.queryByLabelText("Title")).toBeNull();
    expect(screen.getByLabelText("In its own window")).toBeTruthy();
    // Bring it forward asks for the same window again (the app focuses it).
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Bring it forward" })));
    expect(open).toHaveBeenCalledTimes(2);
    expect(await native.noteWindowList()).toEqual([n.id]);
  });

  it("shows the editor again with the latest text once the window closes", async () => {
    const n = await native.saveNote({ title: "Draft", body: "one" });
    render(<NotesPage />);
    await act(async () => fireEvent.click(await screen.findByRole("button", { name: "Open in new window" })));
    await screen.findByText("Open in its own window.");
    // The note's window saves a new title, then closes.
    await native.saveNote({ id: n.id, title: "Final", body: "two" });
    await act(async () => void (await native.noteWindowClose(n.id)));
    await waitFor(() => expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("Final"));
    expect(screen.queryByText("Open in its own window.")).toBeNull();
    expect(screen.queryByLabelText("In its own window")).toBeNull();
  });

  it("starts with the windows already open", async () => {
    const n = await native.saveNote({ title: "Already out", body: "" });
    await native.noteWindowOpen(n.id);
    render(<NotesPage />);
    await screen.findByText("Open in its own window.");
  });

  it("deleting a note closes its window", async () => {
    const n = await native.saveNote({ title: "Gone soon", body: "" });
    await native.noteWindowOpen(n.id);
    await native.deleteNote(n.id);
    expect(await native.noteWindowList()).toEqual([]);
  });
});

describe("the note's own window", () => {
  it("shows the editor for its note, titles the window, and closes on delete", async () => {
    await native.saveNote({ title: "Other", body: "" });
    const n = await native.saveNote({ title: "Groceries", body: "eggs" });
    const close = vi.spyOn(native, "noteWindowClose");
    render(<NoteWindow id={n.id} />);
    const title = (await screen.findByLabelText("Title")) as HTMLInputElement;
    expect(title.value).toBe("Groceries");
    // One note, no list and no new-window button.
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.queryByRole("button", { name: "Open in new window" })).toBeNull();
    expect(screen.getByRole("button", { name: "Pin to top" })).toBeTruthy();
    expect(document.title).toBe("Groceries");
    fireEvent.change(title, { target: { value: "Market" } });
    expect(document.title).toBe("Market");

    fireEvent.click(screen.getByRole("button", { name: "Delete note" }));
    const dialog = await screen.findByRole("alertdialog");
    await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "Delete" })));
    await waitFor(() => expect(close).toHaveBeenCalledWith(n.id));
    expect((await native.listNotes()).map((x) => x.title)).toEqual(["Other"]);
  });

  it("saves what's waiting when asked to close, then closes", async () => {
    const n = await native.saveNote({ title: "Typing", body: "" });
    const close = vi.spyOn(native, "noteWindowClose");
    render(<NoteWindow id={n.id} />);
    fireEvent.change(await screen.findByLabelText("Title"), { target: { value: "Typed" } });
    await act(async () => bus.emit(EVENTS.noteWindowClosing, n.id));
    await waitFor(() => expect(close).toHaveBeenCalledWith(n.id));
    expect((await native.listNotes())[0]!.title).toBe("Typed");
  });
});

describe("sync between windows", () => {
  it("reloads the list when another window changes a note, keeping typing that isn't saved yet", async () => {
    const a = await native.saveNote({ title: "Alpha", body: "" });
    const b = await native.saveNote({ title: "Beta", body: "" });
    render(<NotesPage />);
    await screen.findAllByText("Beta");
    // Typing here in Beta (open), not saved yet.
    act(() => useNotes.getState().edit(b.id, { title: "Beta typed" }));
    // Another window renames Alpha and pins it.
    await native.saveNote({ id: a.id, title: "Alpha renamed", body: "" });
    await native.pinNote(a.id, true);
    act(() => bus.emit(EVENTS.notes, { id: a.id, kind: "pinned", from: `note-${a.id}` }));
    await screen.findByText("Alpha renamed");
    const notes = useNotes.getState().notes;
    expect(notes.map((x) => x.title)).toEqual(["Alpha renamed", "Beta typed"]);
    expect(notes[0]!.pinned).toBe(true);
    await act(() => useNotes.getState().flush());
  });

  it("in the browser preview, a pop-up's edits and delete reach the main window", async () => {
    // The preview's pop-up has its own mock data; it relays each change over a BroadcastChannel.
    const n = await native.saveNote({ title: "Groceries", body: "milk" });
    render(<NotesPage />);
    await waitFor(() => expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("Groceries"));
    const popup = new BroadcastChannel(MOCK_NOTES_CHANNEL);
    try {
      popup.postMessage({ kind: "saved", id: n.id, note: { ...n, title: "Groceries for Sunday", body: "milk, eggs", updatedAt: n.updatedAt + 10 }, from: `note-${n.id}` });
      await waitFor(() => expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("Groceries for Sunday"));
      expect((await native.listNotes())[0]).toMatchObject({ title: "Groceries for Sunday", body: "milk, eggs" });
      popup.postMessage({ kind: "deleted", id: n.id, from: `note-${n.id}` });
      await waitFor(() => expect(useNotes.getState().notes.some((x) => x.id === n.id)).toBe(false));
      // Gone, and no blank note in its place.
      expect(await native.listNotes()).toEqual([]);
      expect(useNotes.getState().notes).toEqual([]);
    } finally {
      popup.close();
    }
  });

  it("drops a note deleted in another window, and ignores its own news", async () => {
    const a = await native.saveNote({ title: "Alpha", body: "" });
    await native.saveNote({ title: "Beta", body: "" });
    render(<NotesPage />);
    await screen.findAllByText("Alpha");
    const list = vi.spyOn(native, "listNotes");
    act(() => bus.emit(EVENTS.notes, { id: a.id, kind: "saved", from: "main" }));
    await new Promise((r) => setTimeout(r, 250));
    expect(list).not.toHaveBeenCalled();
    await native.deleteNote(a.id);
    act(() => bus.emit(EVENTS.notes, { id: a.id, kind: "deleted", from: `note-${a.id}` }));
    await waitFor(() => expect(screen.queryByText("Alpha")).toBeNull());
    expect(useNotes.getState().notes.map((x) => x.title)).toEqual(["Beta"]);
  });
});
