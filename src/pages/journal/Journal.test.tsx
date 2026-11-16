import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { Editor } from "@tiptap/react";
import { JournalPage, sessionsLabel } from "./JournalPage";
import { HEADLINE } from "../headlines";
import { useJournal } from "../../state/journal";
import { useStore } from "../../state/store";
import { useNotes } from "../../state/notes";
import { usePlanner } from "../../state/planner";
import { useTrackers } from "../../state/trackers";
import { isTabLocked } from "../../state/appState";
import { mockControls, mockJournal, resetMockBackend } from "../../lib/mockBackend";
import { native } from "../../lib/native";
import { addDays, todayKey } from "../../lib/planner";
import { PROMPTS, promptDoc, promptsFor, writtenText } from "../../lib/journalPrompts";

const initial = { store: useStore.getState(), journal: useJournal.getState(), notes: useNotes.getState(), planner: usePlanner.getState(), trackers: useTrackers.getState() };

beforeEach(() => {
  resetMockBackend();
  useStore.setState(initial.store, true);
  useJournal.setState(initial.journal, true);
  useNotes.setState(initial.notes, true);
  usePlanner.setState(initial.planner, true);
  useTrackers.setState(initial.trackers, true);
});

const editorOf = () => (document.querySelector(".note-doc") as unknown as { editor: Editor }).editor;

describe("journal prompts (v0.2)", () => {
  it("draws the same prompts for a day, different ones across days, in pick order", () => {
    const setup = { done: true, prompts: PROMPTS.slice(0, 8).map((p) => p.id), perDay: 3 };
    const a = promptsFor(setup, "2026-10-29");
    expect(a).toHaveLength(3);
    expect(promptsFor(setup, "2026-10-29")).toEqual(a);
    const order = a.map((p) => setup.prompts.indexOf(p.id));
    expect(order).toEqual([...order].sort((x, y) => x - y));
    const draws = new Set(Array.from({ length: 10 }, (_, i) => promptsFor(setup, `2026-11-${String(i + 1).padStart(2, "0")}`).map((p) => p.id).join()));
    expect(draws.size).toBeGreaterThan(3);
    expect(promptsFor({ ...setup, perDay: 0 }, "2026-10-29")).toHaveLength(8);
    expect(promptsFor({ ...setup, prompts: [] }, "2026-10-29")).toEqual([]);
  });

  it("doesn't count untouched prompts as writing", () => {
    const ps = PROMPTS.slice(0, 2);
    expect(promptDoc(ps).content).toHaveLength(4);
    expect(writtenText(`${ps[0]!.text}\n${ps[1]!.text}`, ps)).toBe("");
    expect(writtenText(`${ps[0]!.text}\nShipped it\n${ps[1]!.text}`, ps)).toBe("Shipped it");
  });

  it("stays open while sealed", () => {
    expect(isTabLocked("sealed", "journal")).toBe(false);
  });
});

describe("journal page (v0.2)", () => {
  it("is the page on first visit (no dialog), and starts over if left part way", async () => {
    const page = render(<JournalPage />);
    let setup = within(await screen.findByRole("region", { name: "Journal setup" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("button", { name: "Journal settings" })).toBeNull();
    fireEvent.click(setup.getByRole("button", { name: "Set it up" }));
    // Left before the end: not done, so it starts over.
    page.unmount();
    expect(useJournal.getState().setup.done).toBe(false);
    render(<JournalPage />);
    setup = within(await screen.findByRole("region", { name: "Journal setup" }));
    expect(setup.getByRole("button", { name: "Set it up" })).toBeInTheDocument();
  });

  it("sets up evening prompts and a PIN, writes a page, relocks on leaving, and unlocks with the PIN", async () => {
    const page = render(<JournalPage />);
    const dialog = within(await screen.findByRole("region", { name: "Journal setup" }));
    fireEvent.click(dialog.getByRole("button", { name: "Set it up" }));
    fireEvent.click(dialog.getByRole("button", { name: /Evening reflection/ }));
    fireEvent.change(dialog.getByLabelText("Prompts a day"), { target: { value: "0" } });
    fireEvent.click(dialog.getByRole("button", { name: "Next" }));
    fireEvent.click(dialog.getByRole("radio", { name: /A journal PIN/ }));
    fireEvent.change(dialog.getByLabelText("New PIN"), { target: { value: "4821" } });
    fireEvent.change(dialog.getByLabelText("PIN again"), { target: { value: "4821" } });
    await act(async () => fireEvent.click(dialog.getByRole("button", { name: "Open today" })));
    expect(useJournal.getState().setup).toMatchObject({ done: true, perDay: 0 });
    expect(mockJournal.lock).toBe("pin");

    // Today's page starts from the prompts.
    const doc = await screen.findByLabelText(/^Journal, /);
    expect(doc).toHaveTextContent("What went well?");
    expect(doc).toHaveTextContent("What tempted me, and when?");

    // Writing under a prompt saves the page.
    vi.useFakeTimers();
    act(() => void editorOf().chain().focus().setTextSelection(editorOf().state.doc.child(0).nodeSize + 1).insertContent("Shipped the refactor").run());
    await act(async () => void (await vi.advanceTimersByTimeAsync(800)));
    vi.useRealTimers();
    await waitFor(async () => expect((await native.journalGet(todayKey()))?.body).toContain("Shipped the refactor"));

    // Leaving the Journal locks it; the page is refused while locked.
    page.unmount();
    await waitFor(() => expect(mockJournal.unlocked).toBe(false));
    await expect(native.journalGet(todayKey())).rejects.toBe("The journal is locked.");
    const again = render(<JournalPage />);
    const pin = await screen.findByLabelText("Journal PIN");
    fireEvent.change(pin, { target: { value: "1111" } });
    await act(async () => fireEvent.submit(pin.closest("form")!));
    expect(await screen.findByText("That isn't the PIN.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Journal PIN"), { target: { value: "4821" } });
    await act(async () => fireEvent.submit(screen.getByLabelText("Journal PIN").closest("form")!));
    expect(await screen.findByLabelText(/^Journal, /)).toHaveTextContent("Shipped the refactor");

    // Words typed just before it locks are saved before the lock lands.
    act(() => void editorOf().chain().focus("end").insertContent(" Tired.").run());
    again.unmount();
    await waitFor(() => expect(mockJournal.unlocked).toBe(false));
    expect(mockJournal.days.get(todayKey())?.body).toContain("Tired.");
  });

  it("leaves no page when only the prompts are there", async () => {
    await act(() => useJournal.getState().saveSetup({ done: true, prompts: ["refl-well"], perDay: 0 }));
    render(<JournalPage />);
    expect(await screen.findByLabelText(/^Journal, /)).toHaveTextContent("What went well?");
    expect(await native.journalWritten("2000-01-01", "2100-01-01")).toEqual([]);
  });

  it("says the setup and locked headlines from headlines.ts, and themes are a segmented tablist", async () => {
    const page = render(<JournalPage />);
    const setup = within(await screen.findByRole("region", { name: "Journal setup" }));
    expect(setup.getByRole("heading", { level: 1 })).toHaveTextContent(HEADLINE.journalSetup);
    fireEvent.click(setup.getByRole("button", { name: "Set it up" }));
    expect(setup.getByRole("heading", { level: 2 })).toHaveTextContent(HEADLINE.journalPrompts);
    const themes = setup.getByRole("tablist", { name: "Themes" });
    const tabs = within(themes).getAllByRole("tab");
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    fireEvent.click(tabs[1]!);
    expect(tabs[1]).toHaveAttribute("aria-selected", "true");
    expect(setup.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", tabs[1]!.id);
    page.unmount();

    mockJournal.lock = "pin";
    mockJournal.pin = "4821";
    await act(() => useJournal.getState().saveSetup({ done: true, prompts: [], perDay: 0 }));
    render(<JournalPage />);
    expect(await screen.findByRole("heading", { name: HEADLINE.journalLocked })).toBeInTheDocument();
  });

  it("marks kept and missed days in the strip, with a neutral dot where a page was written", async () => {
    const t = todayKey();
    mockControls.statsDays({ [addDays(t, -3)]: { focusMin: 130 }, [addDays(t, -2)]: { focusMin: 10 }, [addDays(t, -1)]: { focusMin: 125 } });
    mockJournal.days.set(addDays(t, -1), { date: addDays(t, -1), doc: null, body: "Wrote", updatedAt: Date.now() });
    await act(() => useJournal.getState().saveSetup({ done: true, prompts: [], perDay: 0 }));
    render(<JournalPage />);
    const strip = await screen.findByRole("tablist", { name: "Days" });
    const day = (k: string) => strip.querySelector<HTMLElement>(`[data-day="${k}"]`)!;
    await waitFor(() => expect(day(addDays(t, -3)).querySelector("[data-testid='day-dot']")).toHaveAttribute("data-status", "kept"));
    expect(day(addDays(t, -2)).querySelector("[data-testid='day-dot']")).toHaveAttribute("data-status", "missed");
    expect(day(addDays(t, -2))).toHaveAccessibleName(/: missed$/);
    expect(day(addDays(t, -1))).toHaveAccessibleName(/: kept, page written$/);
    expect(day(addDays(t, -1)).querySelector("[data-testid='written-dot']")).not.toBeNull();
    expect(day(addDays(t, -3)).querySelector("[data-testid='written-dot']")).toBeNull();
    // Before any history, a day has no mark.
    expect(day(addDays(t, -10)).querySelector("[data-testid='day-dot']")).toBeNull();
    // Weekday letters are sentence-cased text, not forced to capitals.
    expect(strip.querySelector(".uppercase")).toBeNull();
  });

  it("counts one session as one", () => {
    expect(sessionsLabel(1, false)).toBe("session");
    expect(sessionsLabel(0, false)).toBe("sessions");
    expect(sessionsLabel(3, true)).toBe("sessions · a seal broke");
    expect(sessionsLabel(1, true)).toBe("session · a seal broke");
  });

  it("takes a one-tap mood into the Mood tracker", async () => {
    await act(() => useJournal.getState().saveSetup({ done: true, prompts: [], perDay: 0 }));
    render(<JournalPage />);
    const mood = within(await screen.findByRole("radiogroup", { name: "Mood" }));
    await act(async () => fireEvent.click(mood.getByRole("radio", { name: "Good" })));
    const t = (await native.listTrackers()).find((x) => x.name === "Mood")!;
    expect(t.kind).toBe("scale");
    expect((await native.trackerEntries(0, Date.now() + 1)).filter((e) => e.trackerId === t.id).map((e) => e.value)).toEqual([8]);
    expect(mood.getByRole("radio", { name: "Good" })).toHaveAttribute("aria-checked", "true");
  });
});
