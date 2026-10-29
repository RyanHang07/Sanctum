import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { Editor } from "@tiptap/react";
import { NotesPage, edited } from "./NotesPage";
import { noteTitle, notePreview, useNotes } from "../../state/notes";
import { useStore } from "../../state/store";
import { usePlanner } from "../../state/planner";
import { isTabLocked } from "../../state/appState";
import { resetMockBackend } from "../../lib/mockBackend";
import { native } from "../../lib/native";
import { bodyToDoc, docOf } from "../../lib/noteDoc";
import { insertImages, sanctumLinks } from "../../components/editor/extensions";
import { imageId, noteImageUrl } from "../../lib/noteImages";
import { addDays, todayKey } from "../../lib/planner";

const initial = useStore.getState();
const initialNotes = useNotes.getState();
const initialPlanner = usePlanner.getState();

beforeEach(() => {
  resetMockBackend();
  useStore.setState(initial, true);
  useNotes.setState(initialNotes, true);
  usePlanner.setState(initialPlanner, true);
});

/** The open note's editor (TipTap keeps it on its element). */
const editorOf = () => (document.querySelector(".note-doc") as unknown as { editor: Editor }).editor;

describe("note helpers", () => {
  it("titles and previews", () => {
    expect(noteTitle({ title: " Books ", body: "" })).toBe("Books");
    expect(noteTitle({ title: "", body: "- Dune\n- Piranesi" })).toBe("Dune");
    expect(noteTitle({ title: "", body: "" })).toBe("Untitled");
    expect(notePreview({ title: "", body: "Groceries\n\n[ ] eggs" })).toBe("eggs");
    expect(notePreview({ title: "Groceries", body: "[x] eggs" })).toBe("eggs");
    const now = new Date(2026, 8, 30, 15, 0).getTime();
    expect(edited(new Date(2026, 8, 30, 9, 5).getTime(), now)).toBe("9:05 AM");
    expect(edited(new Date(2026, 8, 29, 23, 0).getTime(), now)).toBe("Yesterday");
    expect(edited(new Date(2026, 8, 14, 12, 0).getTime(), now)).toBe("Sep 14");
  });

  it("stays open while sealed", () => {
    expect(isTabLocked("sealed", "notes")).toBe(false);
  });
});

describe("old plain notes become documents (v0.2)", () => {
  it("turns lists, checkboxes, and headings into blocks", () => {
    const doc = bodyToDoc("## Week\n- shipped it\n- two seals broken\n[x] dentist\n[ ] plan\nthoughts\n\n");
    expect(doc.content!.map((b) => b.type)).toEqual(["heading", "bulletList", "taskList", "paragraph"]);
    expect(doc.content![1]!.content).toHaveLength(2);
    expect(doc.content![2]!.content!.map((i) => i.attrs!.checked)).toEqual([true, false]);
    expect(bodyToDoc("").content).toEqual([{ type: "paragraph", content: [] }]);
  });

  it("prefers a saved document, and falls back to the text when it's damaged", () => {
    const saved = JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "hi" }] }] });
    expect(docOf({ doc: saved, body: "x" }).content![0]!.content![0]!.text).toBe("hi");
    expect(docOf({ doc: "{broken", body: "- a" }).content![0]!.type).toBe("bulletList");
  });
});

describe("Notes page", () => {
  it("edits blocks, saves the document and its text, and searches the text", async () => {
    render(<NotesPage />);
    await act(async () => fireEvent.click(await screen.findByRole("button", { name: "Write a note" })));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Groceries" } });
    const editor = editorOf();
    await act(async () => {
      editor.chain().focus().insertContent("From the market").run();
      editor.chain().focus().enter().toggleTaskList().insertContent("eggs").run();
      editor.chain().focus().enter().insertContent("milk").run();
    });
    // A checklist rendered as real checkboxes.
    const doc = within(screen.getByLabelText("Note text"));
    expect(doc.getAllByRole("checkbox")).toHaveLength(2);
    await act(() => useNotes.getState().flush());
    const [saved] = await native.listNotes();
    expect(saved).toMatchObject({ title: "Groceries", body: "From the market\neggs\nmilk" });
    // (The editor keeps an empty line at the end, so there's always room to click below.)
    expect(JSON.parse(saved!.doc!).content.map((b: { type: string }) => b.type).slice(0, 2)).toEqual(["paragraph", "taskList"]);

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "New note" })));
    await act(async () => void editorOf().chain().focus().insertContent("Book: Piranesi").run());
    await act(() => useNotes.getState().flush());
    const list = within(screen.getByRole("complementary", { name: "All notes" }));
    expect(list.getAllByRole("button").map((b) => b.textContent)).toEqual([expect.stringContaining("Book: Piranesi"), expect.stringContaining("Groceries")]);
    fireEvent.change(screen.getByLabelText("Search notes"), { target: { value: "milk" } });
    expect(list.getAllByRole("button")).toHaveLength(1);
    expect(list.getByRole("button")).toHaveTextContent("Groceries");
  });

  it("opens an old plain note as blocks, with its checkboxes", async () => {
    await native.saveNote({ title: "Weekly review", body: "- Shipped the refactor\n[x] Book the dentist\n[ ] Plan next week" });
    render(<NotesPage />);
    const doc = within(await screen.findByLabelText("Note text"));
    expect(doc.getByText("Shipped the refactor").closest("ul")).not.toBeNull();
    const boxes = doc.getAllByRole("checkbox");
    expect(boxes.map((b) => (b as HTMLInputElement).checked)).toEqual([true, false]);
  });

  it("moves a block with Alt+Down, and makes tables and callouts from the menu's commands", async () => {
    render(<NotesPage />);
    await act(async () => fireEvent.click(await screen.findByRole("button", { name: "Write a note" })));
    const editor = editorOf();
    await act(async () => {
      editor.chain().focus().insertContent("first").enter().insertContent("second").run();
      editor.commands.setTextSelection(2);
    });
    await act(async () => void fireEvent.keyDown(editor.view.dom, { key: "ArrowDown", altKey: true }));
    expect(editor.getText({ blockSeparator: "|" })).toBe("second|first");
    await act(async () => {
      editor.chain().focus("end").enter().insertTable({ rows: 2, cols: 2, withHeaderRow: true }).run();
    });
    expect(screen.getByLabelText("Note text").querySelector("table")).not.toBeNull();
    await act(async () => void editor.chain().focus("end").enter().insertContent("heads up").wrapIn("callout").run());
    expect(screen.getByLabelText("Note text").querySelector("[data-callout]")).toHaveTextContent("heads up");
  });

  it("has a toolbar: text size for every note (saved), and formats on the selection", async () => {
    render(<NotesPage />);
    await act(async () => fireEvent.click(await screen.findByRole("button", { name: "Write a note" })));
    const tools = within(screen.getByRole("toolbar", { name: "Note tools" }));
    const sized = () => (document.querySelector(".note-editor") as HTMLElement).style.getPropertyValue("--note-size");
    expect(sized()).toBe("14px");
    await act(async () => fireEvent.click(tools.getByRole("button", { name: "Larger text" })));
    await act(async () => fireEvent.click(tools.getByRole("button", { name: "Larger text" })));
    expect(sized()).toBe("16px");
    expect(await native.getSetting("note_font_size")).toBe("16");
    const editor = editorOf();
    await act(async () => void editor.chain().focus().insertContent("loud").selectAll().run());
    await act(async () => fireEvent.click(tools.getByRole("button", { name: "Bold" })));
    expect(screen.getByLabelText("Note text").querySelector("strong")).toHaveTextContent("loud");
    expect(tools.getByRole("button", { name: "Bold" })).toHaveAttribute("aria-pressed", "true");
  });

  it("takes images: stored by Sanctum, referenced in the note, shown from the store", async () => {
    render(<NotesPage />);
    await act(async () => fireEvent.click(await screen.findByRole("button", { name: "Write a note" })));
    const png = new File([new Uint8Array([137, 80, 78, 71, 1, 2, 3])], "whiteboard.png", { type: "image/png" });
    await act(async () => void (await insertImages(editorOf(), [png])));
    const img = screen.getByLabelText("Note text").querySelector("img")!;
    expect(img.getAttribute("src")).toMatch(/^data:image\/png;base64,/);
    expect(img.getAttribute("alt")).toBe("whiteboard");
    await act(() => useNotes.getState().flush());
    expect((await native.listNotes())[0]!.doc).toContain('"src":"noteimg:1"');
    // Not an image file: refused, nothing inserted.
    await act(async () => void (await insertImages(editorOf(), [new File(["<svg/>"], "x.svg", { type: "image/svg+xml" })])));
    expect(screen.getByLabelText("Note text").querySelectorAll("img")).toHaveLength(1);
    // The reference reads back from the URLs it's shown at.
    expect([imageId("noteimg:12"), imageId("http://noteimg.localhost/12"), imageId("https://example.com/a.png")]).toEqual([12, 12, null]);
    expect(noteImageUrl("https://example.com/a.png")).toBe("https://example.com/a.png");
  });

  it("links to Sanctum: tasks, routines, trackers, and days", async () => {
    const day = todayKey();
    await native.saveTodo({ title: "Send the weekly update", dueDate: day, dueTime: null, durationMin: null, profileId: null });
    await act(() => usePlanner.getState().ensure(day, addDays(day, 1)));
    expect(sanctumLinks("weekly").map((l) => l.title)).toEqual(["Send the weekly update"]);
    expect(sanctumLinks("").slice(0, 2).map((l) => l.title)).toEqual(["Today", "Tomorrow"]);
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
    await waitFor(async () => expect((await native.listNotes()).map((n) => n.id)).not.toContain(a.id));
  });
});
