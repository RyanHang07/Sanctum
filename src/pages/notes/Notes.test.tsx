import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { NotesPage, edited } from "./NotesPage";
import { noteTitle, notePreview, toggleLine, useNotes } from "../../state/notes";
import { useStore } from "../../state/store";
import { isTabLocked } from "../../state/appState";
import { resetMockBackend } from "../../lib/mockBackend";
import { native } from "../../lib/native";

const initial = useStore.getState();
const initialNotes = useNotes.getState();

beforeEach(() => {
  resetMockBackend();
  useStore.setState(initial, true);
  useNotes.setState(initialNotes, true);
});

describe("note helpers", () => {
  it("titles, previews, and ticks checkboxes", () => {
    expect(noteTitle({ title: " Books ", body: "" })).toBe("Books");
    expect(noteTitle({ title: "", body: "- Dune\n- Piranesi" })).toBe("Dune");
    expect(noteTitle({ title: "", body: "" })).toBe("Untitled");
    expect(notePreview({ title: "", body: "Groceries\n\n[ ] eggs" })).toBe("eggs");
    expect(notePreview({ title: "Groceries", body: "[x] eggs" })).toBe("eggs");
    expect(toggleLine("a\n[ ] eggs\n  [x] milk", 1)).toBe("a\n[x] eggs\n  [x] milk");
    expect(toggleLine("a\n[ ] eggs\n  [x] milk", 2)).toBe("a\n[ ] eggs\n  [ ] milk");
    const now = new Date(2026, 8, 30, 15, 0).getTime();
    expect(edited(new Date(2026, 8, 30, 9, 5).getTime(), now)).toBe("9:05 AM");
    expect(edited(new Date(2026, 8, 29, 23, 0).getTime(), now)).toBe("Yesterday");
    expect(edited(new Date(2026, 8, 14, 12, 0).getTime(), now)).toBe("Sep 14");
  });

  it("stays open while sealed", () => {
    expect(isTabLocked("sealed", "notes")).toBe(false);
  });
});

describe("Notes page", () => {
  it("writes a note that saves itself, renders lists and checkboxes, and searches", async () => {
    render(<NotesPage />);
    await act(async () => fireEvent.click(await screen.findByRole("button", { name: "Write a note" })));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Groceries" } });
    const text = screen.getByLabelText("Note text");
    fireEvent.change(text, { target: { value: "- from the market\n[ ] eggs\n[x] milk" } });
    await act(async () => fireEvent.blur(text));
    // Saved without a Save button.
    expect((await native.listNotes())[0]).toMatchObject({ title: "Groceries", body: "- from the market\n[ ] eggs\n[x] milk" });

    const doc = within(screen.getByRole("document", { name: "Note" }));
    expect(doc.getByText("from the market")).toBeInTheDocument();
    await act(async () => fireEvent.click(doc.getByRole("checkbox", { name: "eggs" })));
    expect(doc.getByRole("checkbox", { name: "eggs" })).toHaveAttribute("aria-checked", "true");
    await act(() => useNotes.getState().flush());
    expect((await native.listNotes())[0]!.body).toBe("- from the market\n[x] eggs\n[x] milk");

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "New note" })));
    fireEvent.change(screen.getByLabelText("Note text"), { target: { value: "Book: Piranesi" } });
    await act(() => useNotes.getState().flush());
    const list = within(screen.getByRole("complementary", { name: "All notes" }));
    expect(list.getAllByRole("button").map((b) => b.textContent)).toEqual([expect.stringContaining("Book: Piranesi"), expect.stringContaining("Groceries")]);
    fireEvent.change(screen.getByLabelText("Search notes"), { target: { value: "milk" } });
    expect(list.getAllByRole("button")).toHaveLength(1);
    expect(list.getByRole("button")).toHaveTextContent("Groceries");
  });

  it("pins to the top and deletes", async () => {
    const a = await native.saveNote({ title: "Old idea", body: "x" });
    await native.saveNote({ title: "New idea", body: "y" });
    render(<NotesPage />);
    const list = within(await screen.findByRole("complementary", { name: "All notes" }));
    expect(list.getAllByRole("button")[0]).toHaveTextContent("New idea");
    await act(async () => fireEvent.click(list.getByRole("button", { name: /Old idea/ })));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Pin to top" })));
    expect(list.getAllByRole("button")[0]).toHaveTextContent("Old idea");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Delete note" })));
    expect(list.queryByRole("button", { name: /Old idea/ })).toBeNull();
    expect((await native.listNotes()).map((n) => n.id)).not.toContain(a.id);
  });
});
