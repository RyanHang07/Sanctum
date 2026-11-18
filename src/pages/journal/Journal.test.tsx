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
import { dayPrompt, firstWords, PROMPTS, promptDoc, promptsFor, writtenText, STARTER_PROMPTS } from "../../lib/journalPrompts";
import { flushJournal } from "../../state/journal";
import { fromKey } from "../../lib/planner";
import { gsap } from "../../lib/gsap";
import { moment, seek, setReducedMotion } from "../../test/motion";
import { PROTECTION } from "./JournalSetup";
import { monthsBack } from "./LookBack";

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
  it("is the page on first visit (no dialog): one screen, the lock, and Start writing", async () => {
    const page = render(<JournalPage />);
    let setup = within(await screen.findByRole("region", { name: "Journal setup" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("button", { name: "Journal settings" })).toBeNull();
    // No prompts step on first run (2026-11-17): just the lock, with one line on what it does.
    expect(setup.queryByRole("tablist", { name: "Themes" })).toBeNull();
    expect(setup.getByRole("heading", { level: 3 })).toHaveTextContent("Lock Your Journal (Optional)");
    expect(setup.getByTestId("journal-protection")).toHaveTextContent(PROTECTION);
    expect(setup.getByRole("radiogroup", { name: "Lock" })).toBeInTheDocument();
    // Left before Start writing: not done, so it shows again.
    page.unmount();
    expect(useJournal.getState().setup.done).toBe(false);
    await act(async () => void render(<JournalPage />));
    setup = within(await screen.findByRole("region", { name: "Journal setup" }));
    expect(setup.getByRole("button", { name: "Start writing" })).toBeInTheDocument();
  });

  it("starts with the starter prompts and a PIN, writes a page, relocks on leaving, and unlocks with the PIN", async () => {
    const page = render(<JournalPage />);
    const dialog = within(await screen.findByRole("region", { name: "Journal setup" }));
    // The lock says plainly what it does and doesn't do.
    expect(dialog.getByTestId("journal-protection")).toHaveTextContent(PROTECTION);
    fireEvent.click(dialog.getByRole("radio", { name: /A journal PIN/ }));
    fireEvent.change(dialog.getByLabelText("New PIN"), { target: { value: "4821" } });
    fireEvent.change(dialog.getByLabelText("PIN again"), { target: { value: "4821" } });
    await act(async () => fireEvent.click(dialog.getByRole("button", { name: "Start writing" })));
    // Prompts weren't asked: a new journal offers the starter set.
    expect(useJournal.getState().setup).toMatchObject({ done: true, prompts: STARTER_PROMPTS });
    expect(mockJournal.lock).toBe("pin");

    // Today's page opens blank, with one of the picks offered above it.
    const doc = await screen.findByLabelText(/^Journal, /);
    expect(doc.textContent).toBe("");
    const offered = dayPrompt(useJournal.getState().setup, todayKey())!;
    expect(screen.getByTestId("journal-offer")).toHaveTextContent(`Try: ${offered.text}`);
    // Another offers the next pick; using it puts it on the page, and the offer goes.
    fireEvent.click(screen.getByRole("button", { name: "Another prompt" }));
    const next = dayPrompt(useJournal.getState().setup, todayKey(), 1)!;
    expect(screen.getByTestId("journal-offer")).toHaveTextContent(next.text);
    act(() => void fireEvent.click(screen.getByRole("button", { name: "Use it" })));
    expect(doc).toHaveTextContent(next.text);
    expect(screen.queryByTestId("journal-offer")).toBeNull();

    // Writing under the prompt saves the page.
    vi.useFakeTimers();
    act(() => void editorOf().chain().focus("end").insertContent("Shipped the refactor").run());
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
    const page = render(<JournalPage />);
    expect(await screen.findByLabelText(/^Journal, /)).not.toHaveTextContent("What went well?");
    expect(screen.getByTestId("journal-offer")).toHaveTextContent("Try: What went well?");
    // One pick: nothing else to offer.
    expect(screen.queryByRole("button", { name: "Another prompt" })).toBeNull();
    act(() => void fireEvent.click(screen.getByRole("button", { name: "Use it" })));
    expect(screen.getByLabelText(/^Journal, /)).toHaveTextContent("What went well?");
    page.unmount();
    await act(async () => void (await flushJournal()));
    expect(await native.journalWritten("2000-01-01", "2100-01-01")).toEqual([]);
  });

  it("offers nothing when no prompts are picked, and a saved page opens as it was", async () => {
    const t = todayKey();
    const old = JSON.stringify(promptDoc(PROMPTS.slice(0, 2)));
    mockJournal.days.set(addDays(t, -1), { date: addDays(t, -1), doc: old, body: `\nKept`, updatedAt: Date.now() });
    await act(() => useJournal.getState().saveSetup({ done: true, prompts: [], perDay: 0 }));
    await act(async () => void render(<JournalPage />));
    await screen.findByLabelText(/^Journal, /);
    expect(screen.queryByTestId("journal-offer")).toBeNull();
    const strip = screen.getByRole("tablist", { name: "Days" });
    fireEvent.click(strip.querySelector<HTMLElement>(`[data-day="${addDays(t, -1)}"]`)!);
    await waitFor(() => expect(screen.getByLabelText(/^Journal, /)).toHaveTextContent(PROMPTS[1]!.text));
  });

  it("says the setup and locked headlines from headlines.ts, and themes are a segmented tablist", async () => {
    const page = render(<JournalPage />);
    const first = within(await screen.findByRole("region", { name: "Journal setup" }));
    // One H1 on the page (its title); the setup's headline sits under it.
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(first.getByRole("heading", { level: 2 })).toHaveTextContent(HEADLINE.journalSetup);
    await act(async () => fireEvent.click(first.getByRole("button", { name: "Start writing" })));
    // Prompts live in Journal settings, one click from the Try line.
    const scrolled = vi.fn();
    Element.prototype.scrollIntoView = scrolled;
    await act(async () => fireEvent.click(await screen.findByRole("button", { name: "Change prompts" })));
    const setup = within(screen.getByRole("dialog", { name: "Journal settings" }));
    // One scrolling dialog, opened at the prompts: the prompts, then the lock, and no steps.
    expect(scrolled).toHaveBeenCalled();
    expect(scrolled.mock.contexts[0]).toBe(setup.getByTestId("journal-prompts"));
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    const headings = setup.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual([HEADLINE.journalPrompts, "Lock Your Journal (Optional)"]);
    expect(setup.getByRole("radiogroup", { name: "Lock" })).toBeInTheDocument();
    expect(setup.queryByRole("button", { name: "Next" })).toBeNull();
    expect(setup.queryByRole("button", { name: "Back" })).toBeNull();
    expect(setup.getByRole("button", { name: "Save" })).toBeInTheDocument();
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
    await act(async () => void render(<JournalPage />));
    expect(await screen.findByRole("heading", { name: HEADLINE.journalLocked })).toBeInTheDocument();
    expect(screen.getByTestId("journal-protection")).toHaveTextContent(PROTECTION);
    // Locked: no way into older pages.
    expect(screen.queryByRole("button", { name: "Older pages" })).toBeNull();
  });

  it("marks kept and missed days in the strip, with a neutral dot where a page was written", async () => {
    const t = todayKey();
    mockControls.statsDays({ [addDays(t, -3)]: { focusMin: 130 }, [addDays(t, -2)]: { focusMin: 10 }, [addDays(t, -1)]: { focusMin: 125 } });
    mockJournal.days.set(addDays(t, -1), { date: addDays(t, -1), doc: null, body: "Wrote", updatedAt: Date.now() });
    await act(() => useJournal.getState().saveSetup({ done: true, prompts: [], perDay: 0 }));
    await act(async () => void render(<JournalPage />));
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
    await act(async () => void render(<JournalPage />));
    const mood = within(await screen.findByRole("radiogroup", { name: "Mood" }));
    await act(async () => fireEvent.click(mood.getByRole("radio", { name: "Good" })));
    const t = (await native.listTrackers()).find((x) => x.name === "Mood")!;
    expect(t.kind).toBe("scale");
    expect((await native.trackerEntries(0, Date.now() + 1)).filter((e) => e.trackerId === t.id).map((e) => e.value)).toEqual([8]);
    expect(mood.getByRole("radio", { name: "Good" })).toHaveAttribute("aria-checked", "true");
  });
});

const setUp = () => act(() => useJournal.getState().saveSetup({ done: true, prompts: [], perDay: 0 }));
/** A saved page with one paragraph of writing. */
const writePage = (date: string, body: string) =>
  mockJournal.days.set(date, { date, doc: JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: body }] }] }), body, updatedAt: Date.now() });

describe("journal look back (v0.5)", () => {
  it("finds the same day a month and a year back, skipping days a short month lacks", () => {
    expect(monthsBack("2026-11-16", 1)).toBe("2026-10-16");
    expect(monthsBack("2026-11-16", 12)).toBe("2025-11-16");
    expect(monthsBack("2026-01-10", 1)).toBe("2025-12-10");
    expect(monthsBack("2026-03-31", 1)).toBeNull();
    expect(monthsBack("2028-02-29", 12)).toBeNull();
    expect(firstWords(`${PROMPTS[0]!.text}\none two three`, 2)).toBe("one two…");
  });

  it("shows on-this-day lines only when such pages exist, and opens the day", async () => {
    const t = todayKey();
    const month = monthsBack(t, 1);
    const year = monthsBack(t, 12);
    await setUp();
    const view = render(<JournalPage />);
    await screen.findByLabelText(/^Journal, /);
    expect(screen.queryByLabelText("On this day")).toBeNull();
    view.unmount();
    if (!month || !year) return; // today is a day a shorter month lacks
    writePage(month, "Walked by the river after the long review");
    writePage(year, "First week at the new desk");
    await act(async () => void render(<JournalPage />));
    const back = await screen.findByLabelText("On this day");
    expect(back).toHaveTextContent("A month ago: Walked by the river after the long review");
    expect(back).toHaveTextContent("A year ago: First week at the new desk");
    fireEvent.click(within(back).getByRole("button", { name: /A year ago/ }));
    await waitFor(() => expect(screen.getByLabelText(/^Journal, /)).toHaveTextContent("First week at the new desk"));
    expect(screen.getByRole("tablist", { name: "Days" }).querySelector(`[data-day="${year}"]`)).toHaveAttribute("aria-selected", "true");
  });

  it("opens any day from the calendar in Older pages, with its marks, and Escape closes it", async () => {
    const t = todayKey();
    const d = addDays(t, -40);
    writePage(d, "An older page");
    mockControls.statsDays({ [d]: { focusMin: 130 } });
    await setUp();
    await act(async () => void render(<JournalPage />));
    await screen.findByLabelText(/^Journal, /);
    fireEvent.click(screen.getByRole("button", { name: "Older pages" }));
    await screen.findByRole("dialog", { name: "Older pages" });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Older pages" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Older pages" }));
    const panel = await screen.findByRole("dialog", { name: "Older pages" });
    const [ty, tm] = t.split("-").map(Number);
    const [dy, dm] = d.split("-").map(Number);
    for (let i = 0; i < ty! * 12 + tm! - (dy! * 12 + dm!); i++) fireEvent.click(within(panel).getByRole("button", { name: "Previous month" }));
    const cell = await waitFor(() => {
      const c = panel.querySelector<HTMLElement>(`[data-day="${d}"]`);
      expect(c?.querySelector("[data-testid='written-dot']")).not.toBeNull();
      return c!;
    });
    await waitFor(() => expect(cell.querySelector("[data-testid='day-dot']")).toHaveAttribute("data-status", "kept"));
    expect(cell).toHaveAccessibleName(/: kept, page written$/);
    fireEvent.click(cell);
    expect(screen.queryByRole("dialog", { name: "Older pages" })).toBeNull();
    await waitFor(() => expect(screen.getByLabelText(/^Journal, /)).toHaveTextContent("An older page"));
    // The strip moves to the two weeks around it.
    expect(screen.getByRole("tablist", { name: "Days" }).querySelector(`[data-day="${d}"]`)).toHaveAttribute("aria-selected", "true");
  });

  it("searches the pages, lists the date and snippet, and opens the day", async () => {
    const d = addDays(todayKey(), -20);
    writePage(d, "Walked by the river at dusk");
    writePage(addDays(todayKey(), -5), "Nothing about water");
    await setUp();
    await act(async () => void render(<JournalPage />));
    await screen.findByLabelText(/^Journal, /);
    fireEvent.click(screen.getByRole("button", { name: "Older pages" }));
    const panel = await screen.findByRole("dialog", { name: "Older pages" });
    fireEvent.change(within(panel).getByLabelText("Search pages"), { target: { value: "river" } });
    const list = await within(panel).findByRole("list", { name: "Pages found" });
    const hits = within(list).getAllByRole("listitem");
    expect(hits).toHaveLength(1);
    expect(hits[0]).toHaveTextContent(fromKey(d).toLocaleDateString("en-US", { month: "long", day: "numeric" }));
    expect(hits[0]).toHaveTextContent("river");
    fireEvent.change(within(panel).getByLabelText("Search pages"), { target: { value: "ocean" } });
    expect(await within(panel).findByText("No pages match.")).toBeInTheDocument();
    fireEvent.change(within(panel).getByLabelText("Search pages"), { target: { value: "river" } });
    fireEvent.click(within(await within(panel).findByRole("list", { name: "Pages found" })).getAllByRole("listitem")[0]!);
    expect(screen.queryByRole("dialog", { name: "Older pages" })).toBeNull();
    await waitFor(() => expect(screen.getByLabelText(/^Journal, /)).toHaveTextContent("Walked by the river at dusk"));
  });
});

describe("journal motion (v0.5)", () => {
  it("slides the strip's highlight to the picked day", async () => {
    await setUp();
    await act(async () => void render(<JournalPage />));
    const strip = await screen.findByRole("tablist", { name: "Days" });
    const tabs = Array.from(strip.querySelectorAll<HTMLElement>("[data-day]"));
    tabs.forEach((el, i) => {
      Object.defineProperty(el, "offsetLeft", { configurable: true, get: () => i * 44 });
      Object.defineProperty(el, "offsetWidth", { configurable: true, get: () => 40 });
    });
    const indicator = strip.querySelector<HTMLElement>("[data-indicator]")!;
    fireEvent.click(tabs[3]!);
    await waitFor(() => expect(gsap.getProperty(indicator, "x")).toBe(3 * 44));
    expect(gsap.getProperty(indicator, "width")).toBe(40);
    fireEvent.click(tabs[10]!);
    await waitFor(() => expect(gsap.getProperty(indicator, "x")).toBe(10 * 44));
  });

  it("rises the day in on moving to another day", async () => {
    setReducedMotion(false);
    await setUp();
    await act(async () => void render(<JournalPage />));
    const strip = await screen.findByRole("tablist", { name: "Days" });
    fireEvent.click(strip.querySelector<HTMLElement>(`[data-day="${addDays(todayKey(), -1)}"]`)!);
    const tl = moment("journal-day")!;
    expect(tl).toBeDefined();
    const day = document.querySelector<HTMLElement>("[data-journal-day]")!;
    seek(tl, 0);
    expect(Number(gsap.getProperty(day, "opacity"))).toBe(0);
    expect(gsap.getProperty(day, "y")).toBe(6);
    seek(tl, tl.duration());
    expect(day.style.opacity).toBe("");
    await act(async () => {}); // the picked day's page loads after the motion is checked
  });

  it("lands the day at once under reduced motion", async () => {
    setReducedMotion(true);
    await setUp();
    await act(async () => void render(<JournalPage />));
    const strip = await screen.findByRole("tablist", { name: "Days" });
    fireEvent.click(strip.querySelector<HTMLElement>(`[data-day="${addDays(todayKey(), -1)}"]`)!);
    expect(moment("journal-day")!.progress()).toBe(1);
    await act(async () => {});
  });
});
describe("journal load and lock failures (C1)", () => {
  it("a page that didn't load shows an error and a retry, never a blank editor", async () => {
    const t = todayKey();
    const doc = JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "The real page" }] }] });
    mockJournal.days.set(t, { date: t, doc, body: "The real page", updatedAt: Date.now() });
    await act(() => useJournal.getState().saveSetup({ done: true, prompts: [], perDay: 0 }));
    const get = vi.spyOn(native, "journalGet").mockRejectedValueOnce("The disk is busy.");
    const save = vi.spyOn(native, "journalSave");
    try {
      await act(async () => void render(<JournalPage />));
      expect(await screen.findByText("This page didn't open.")).toBeInTheDocument();
      expect(screen.getByText("The disk is busy.")).toBeInTheDocument();
      expect(screen.queryByLabelText(/^Journal, /)).toBeNull();
      expect(save).not.toHaveBeenCalled();
      await act(async () => fireEvent.click(screen.getByRole("button", { name: "Try again" })));
      expect(await screen.findByLabelText(/^Journal, /)).toHaveTextContent("The real page");
      expect(mockJournal.days.get(t)?.body).toBe("The real page");
    } finally {
      get.mockRestore();
      save.mockRestore();
    }
  });

  it("an unknown lock counts as locked: no page shows until the status loads", async () => {
    await act(() => useJournal.getState().saveSetup({ done: true, prompts: [], perDay: 0 }));
    const status = vi.spyOn(native, "journalStatus").mockRejectedValueOnce("No answer.");
    try {
      await act(async () => void render(<JournalPage />));
      expect(await screen.findByText("The journal didn't open.")).toBeInTheDocument();
      expect(screen.queryByLabelText(/^Journal, /)).toBeNull();
      await act(async () => fireEvent.click(screen.getByRole("button", { name: "Try again" })));
      expect(await screen.findByLabelText(/^Journal, /)).toBeInTheDocument();
    } finally {
      status.mockRestore();
    }
  });

  it("a save refused as locked shows the lock and keeps the typing, saved after unlocking", async () => {
    await act(() => useJournal.getState().saveSetup({ done: true, prompts: [], perDay: 0 }));
    mockJournal.lock = "pin";
    mockJournal.pin = "4821";
    mockJournal.unlocked = true;
    await act(async () => void render(<JournalPage />));
    await screen.findByLabelText(/^Journal, /);
    // The backend locks behind the page's back (the store still thinks it's open).
    mockJournal.unlocked = false;
    act(() => void editorOf().chain().focus("end").insertContent("Kept through the lock").run());
    await act(async () => void (await flushJournal()));
    expect(await screen.findByLabelText("Journal PIN")).toBeInTheDocument();
    expect(useJournal.getState().lock?.unlocked).toBe(false);
    expect(mockJournal.days.get(todayKey())).toBeUndefined();

    fireEvent.change(screen.getByLabelText("Journal PIN"), { target: { value: "4821" } });
    await act(async () => fireEvent.submit(screen.getByLabelText("Journal PIN").closest("form")!));
    expect(await screen.findByLabelText(/^Journal, /)).toHaveTextContent("Kept through the lock");
    expect(mockJournal.days.get(todayKey())?.body).toContain("Kept through the lock");
  });
});
