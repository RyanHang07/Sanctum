import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as sound from "../lib/sound";
import { gsap } from "../lib/gsap";
import { useStore } from "../state/store";
import { resetMockBackend } from "../lib/mockBackend";
import { HeldPage, heldFacts } from "./HeldPage";
import { SealedAppCard, QuietCard, ParkCard, WelcomeCard, sealTicks, sealRatio } from "../windows/Intercept";
import { CloseDialog, quitOpens } from "../components/CloseDialog";
import { QuietPauseDialog } from "../components/QuietPauseDialog";
import { HEADLINE, PARK_LINES, WELCOME } from "./headlines";
import { clock } from "../lib/time";
import { finish, moment, seek, setReducedMotion, setShown } from "../test/motion";
import type { HeldStats, Intercept, SessionView } from "../lib/types";

// S7 Moments (redesign v0.4.0): the held page, the intercept card, and the dialogs around a seal.

const initial = useStore.getState();
beforeEach(() => {
  resetMockBackend();
  useStore.setState(initial, true);
});

const held: HeldStats = { sessionId: 7, profileId: 1, profileName: "Interview Prep", plannedMinutes: 60, focusMinutes: 60, attempts: 3, broken: false };

describe("the held page", () => {
  it("collapses to the mark, one headline, one fact line and two actions", () => {
    render(<HeldPage held={held} />);
    const page = screen.getByTestId("held-page");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/^Sanctum held\.$/);
    expect(page.querySelector("em")).toBeNull();
    expect(screen.getByTestId("held-fact")).toHaveTextContent(/^1h of Interview Prep, 3 attempts blocked\. /);
    expect(screen.getByRole("button", { name: /^Done/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Enter again/ })).toBeInTheDocument();
    // No eyebrow, no stats row, no Replay; the review is behind "Add a note".
    expect(page).not.toHaveTextContent("Interview Prep · 60 min");
    expect(screen.queryByRole("button", { name: "Replay" })).toBeNull();
    expect(screen.queryByTestId("held-review")).toBeNull();
    // A clean page: the app color, no backdrop.
    expect(page).toHaveClass("bg-app");
    expect(page.className).not.toMatch(/bg-sealed|gradient|blur|shadow/);
  });

  it("opens the review only on request", () => {
    render(<HeldPage held={{ ...held, task: { kind: "todo", id: 1, title: "Essay", date: "2026-11-16" } }} />);
    const add = screen.getByRole("button", { name: "Add a note" });
    expect(add).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(add);
    expect(add).toHaveAttribute("aria-expanded", "true");
    const review = screen.getByTestId("held-review");
    expect(add).toHaveAttribute("aria-controls", review.id);
    expect(review).toContainElement(screen.getByTestId("held-wrap"));
    expect(review).toContainElement(screen.getByTestId("held-task"));
    // No break offer (removed 2026-11-16): Enter again does the job.
    expect(screen.queryByTestId("held-break")).toBeNull();
    fireEvent.click(add);
    expect(screen.queryByTestId("held-review")).toBeNull();
  });

  it("says what the seal did in one sentence", () => {
    expect(heldFacts({ focusMinutes: 60, profileName: "Study", attempts: 1 })).toBe("1h of Study, 1 attempt blocked.");
    expect(heldFacts({ focusMinutes: 25, profileName: "Study", attempts: 0 })).toBe("25m of Study.");
  });

  it("builds as one timeline: the gate, the keyhole seat, then the rings with the chime", () => {
    setReducedMotion(false);
    const play = vi.spyOn(sound, "play").mockImplementation(() => undefined);
    render(<HeldPage held={held} />);
    const tl = moment("held")!;
    expect(tl).toBeDefined();
    expect(tl.labels.key).toBeCloseTo(0.95);
    expect(tl.labels.rings).toBeCloseTo(1.2);
    expect(tl.labels.drain).toBeUndefined();
    expect(tl.duration()).toBeLessThanOrEqual(2.9);
    expect(play).not.toHaveBeenCalled();
    finish(tl);
    expect(play).toHaveBeenCalledWith("held");
    expect(document.querySelector("[data-ring='1']")).toHaveAttribute("r", "5.2");
    expect(document.querySelector("[data-ring='2']")).toHaveAttribute("r", "7.6");
    play.mockRestore();
  });

  it("lands on the final frame at once under reduced motion, chime included", () => {
    const play = vi.spyOn(sound, "play").mockImplementation(() => undefined);
    render(<HeldPage held={held} />);
    expect(moment("held")!.progress()).toBe(1);
    expect(play).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Sanctum held.")).toBeVisible();
    play.mockRestore();
  });

  it("finishes the build when the window is hidden mid-way", () => {
    setReducedMotion(false);
    vi.spyOn(sound, "play").mockImplementation(() => undefined);
    render(<HeldPage held={held} />);
    expect(moment("held")!.progress()).toBeLessThan(1);
    setShown(false);
    expect(moment("held")!.progress()).toBe(1);
    vi.restoreAllMocks();
  });

  it("cleans up on unmount", () => {
    setReducedMotion(false);
    vi.spyOn(sound, "play").mockImplementation(() => undefined);
    const { unmount } = render(<HeldPage held={held} />);
    unmount();
    expect(gsap.globalTimeline.getChildren(true, true, true)).toHaveLength(0);
    vi.restoreAllMocks();
  });

  it("a broken seal cracks the keyhole in the second color instead of ringing", () => {
    setReducedMotion(false);
    const play = vi.spyOn(sound, "play").mockImplementation(() => undefined);
    render(<HeldPage held={{ ...held, broken: true, broke: { kind: "killed", afterMin: 23 } }} />);
    expect(document.querySelector("[data-ring]")).toBeNull();
    const tl = moment("held")!;
    expect(tl.labels.rings).toBeUndefined();
    expect(tl.labels.drain).toBeCloseTo(1.45);
    finish(tl);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/^Seal broken\.$/);
    expect(screen.getByTestId("held-fact")).toHaveTextContent("Sanctum was closed 23 minutes in.");
    expect(play).toHaveBeenCalledWith("broken");
    expect(play).not.toHaveBeenCalledWith("held");
    // The fix sits beside "Add a note"; there is no break offer.
    expect(screen.getByRole("button", { name: "Turn on Protection" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add a note" }));
    expect(screen.queryByTestId("held-break")).toBeNull();
    play.mockRestore();
  });

  it("fills the broken keyhole in the second color and keeps the torii in text", () => {
    render(<HeldPage held={{ ...held, broken: true }} />);
    const key = document.querySelector("[data-part='key']")!;
    expect(key).toHaveAttribute("data-key", "broken");
    expect(key).toHaveClass("text-second");
    expect(key.querySelector("circle")).toHaveAttribute("fill", "currentColor");
    expect(key.querySelector("path")).toHaveAttribute("fill", "currentColor");
    expect(document.querySelector("[data-key='sealed']")).toBeNull();
    expect(document.querySelector("[data-part='beam']")!.parentElement).toHaveClass("text-text");
  });

  it("draws the crack on the broken beat: hidden before it, whole after", () => {
    setReducedMotion(false);
    const play = vi.spyOn(sound, "play").mockImplementation(() => undefined);
    render(<HeldPage held={{ ...held, broken: true }} />);
    const crack = document.querySelector("[data-crack]")!;
    expect(crack).toHaveAttribute("pathLength", "1");
    // The card's own color, so it reads as a split.
    expect(crack).toHaveClass("text-panel");
    const tl = moment("held")!;
    seek(tl, "drain", true);
    expect(Number(crack.getAttribute("stroke-dashoffset"))).toBe(1);
    seek(tl, tl.labels.drain + 0.2, true);
    const mid = Number(crack.getAttribute("stroke-dashoffset"));
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    finish(tl);
    expect(Number(crack.getAttribute("stroke-dashoffset"))).toBe(0);
    play.mockRestore();
  });

  it("the crack is simply there under reduced motion", () => {
    vi.spyOn(sound, "play").mockImplementation(() => undefined);
    render(<HeldPage held={{ ...held, broken: true }} />);
    expect(Number(document.querySelector("[data-crack]")!.getAttribute("stroke-dashoffset"))).toBe(0);
    vi.restoreAllMocks();
  });

  it("a held seal has no crack and keeps the accent keyhole", () => {
    render(<HeldPage held={held} />);
    expect(document.querySelector("[data-crack]")).toBeNull();
    expect(document.querySelector("[data-key='sealed']")).toHaveClass("text-sealed");
  });

  it("sets the card left, with the actions right on their own row", () => {
    render(<HeldPage held={held} />);
    const card = screen.getByTestId("held-card");
    expect(card).toHaveClass("bg-panel", "border-line", "rounded-dialog");
    expect(card.querySelector("[data-rise='1']")).toHaveClass("items-start", "text-left");
    const footer = screen.getByTestId("held-footer");
    expect(footer).toHaveClass("justify-between");
    expect(footer).toContainElement(screen.getByRole("button", { name: /^Done/ }));
    expect(footer).toContainElement(screen.getByRole("button", { name: /^Enter again/ }));
    expect(footer.querySelector("[data-rise='2']")).toHaveClass("ml-auto");
  });

  it("'Add a note' is a real button that rises in last, then opens the review", () => {
    setReducedMotion(false);
    vi.spyOn(sound, "play").mockImplementation(() => undefined);
    render(<HeldPage held={held} />);
    const add = screen.getByRole("button", { name: "Add a note" });
    expect(add.className).not.toMatch(/underline/);
    expect(add).toHaveAttribute("data-rise", "note");
    const tl = moment("held")!;
    // The last beat: after the actions start rising.
    expect(tl.labels.note).toBeGreaterThan(tl.labels.rise + 0.15);
    seek(tl, 0, true);
    expect(Number(gsap.getProperty(add, "opacity"))).toBe(0);
    seek(tl, tl.labels.note, true);
    expect(Number(gsap.getProperty(add, "opacity"))).toBe(0);
    finish(tl);
    expect(Number(gsap.getProperty(add, "opacity"))).toBe(1);
    expect(add.style.opacity).toBe("");
    fireEvent.click(add);
    expect(add).toHaveAttribute("aria-expanded", "true");
    expect(add).toHaveAttribute("aria-controls", screen.getByTestId("held-review").id);
    vi.restoreAllMocks();
  });

  it("'Add a note' wears Done's style and opens its space before its contents cascade in", () => {
    setReducedMotion(false);
    vi.spyOn(sound, "play").mockImplementation(() => undefined);
    render(<HeldPage held={held} />);
    finish(moment("held")!);
    const add = screen.getByRole("button", { name: "Add a note" });
    const done = screen.getByRole("button", { name: /^Done/ });
    // Same variant and size as Done.
    for (const c of ["border", "h-control-lg", "text-text"]) {
      if (done.classList.contains(c)) expect(add).toHaveClass(c);
    }
    fireEvent.click(add);
    const review = screen.getByTestId("held-review");
    const tl = moment("held-review")!;
    expect(tl).toBeDefined();
    // The wrapper grows; it has no padding of its own, so "auto" measures the whole panel.
    const space = review.parentElement!;
    seek(tl, 0, true);
    expect(gsap.getProperty(space, "height")).toBe(0);
    expect(Number(gsap.getProperty(review.firstElementChild!, "opacity"))).toBe(0);
    finish(tl);
    expect(space.style.height).toBe("");
    expect(Number(gsap.getProperty(review.firstElementChild!, "opacity"))).toBe(1);

    // Closing mirrors it: the button reads closed at once, the contents fade, the space folds,
    // and only then does the panel go.
    fireEvent.click(add);
    expect(add).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByTestId("held-review")).toBeInTheDocument();
    const out = moment("held-review-close")!;
    seek(out, out.duration() * 0.99, true);
    expect(Number(gsap.getProperty(space, "height"))).toBeLessThan(5);
    finish(out);
    expect(screen.queryByTestId("held-review")).toBeNull();
    vi.restoreAllMocks();
  });
});

const app: Intercept = { kind: "app", label: "Discord", attempts: 1, profileName: "Interview Prep", elapsedMs: 18 * 60_000, remainingMs: 42 * 60_000, backTo: "VS Code", keyword: null };

describe("the intercept card", () => {
  it("draws the seal ruler like the day ruler: minors every 5, majors every 15, thinning on long seals", () => {
    expect(sealTicks(60).map((t) => t.m)).toEqual([5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]);
    expect(sealTicks(60).filter((t) => t.major).map((t) => t.m)).toEqual([15, 30, 45]);
    expect(sealTicks(180).filter((t) => t.major).map((t) => t.m)).toEqual([60, 120]);
    expect(sealTicks(480).length).toBeLessThan(20);
    expect(sealRatio(18, 42)).toBeCloseTo(0.3);
    expect(sealRatio(0, 0)).toBe(0);
  });

  it("uses the stays headline, with passed majors in the accent and later ones muted", () => {
    render(<SealedAppCard p={app} onBack={vi.fn()} onBreak={vi.fn()} />);
    expect(screen.getByRole("heading")).toHaveTextContent(/^Discord stays sealed\.$/);
    expect(document.querySelector("[data-ic-tick='15']")).toHaveClass("bg-sealed");
    expect(document.querySelector("[data-ic-tick='30']")).toHaveClass("bg-muted");
    expect(document.querySelector("[data-ic-tick='5']")).toHaveClass("bg-line-input");
    expect(screen.getByText("1st attempt this session")).toBeInTheDocument();
  });

  it("fills the ruler to now on one timeline, and lands there under reduced motion", () => {
    render(<SealedAppCard p={app} onBack={vi.fn()} onBreak={vi.fn()} />);
    expect(moment("intercept")!.progress()).toBe(1);
    expect(Number(gsap.getProperty("[data-ic-fill]", "scaleX"))).toBeCloseTo(0.3);
    expect(Number(gsap.getProperty("[data-ic-needle]", "xPercent"))).toBeCloseTo(30);
  });

  it("plays the card in place, then the ruler, when motion is on", () => {
    setReducedMotion(false);
    render(<SealedAppCard p={app} onBack={vi.fn()} onBreak={vi.fn()} />);
    const tl = moment("intercept")!;
    expect(tl.labels.ruler).toBeCloseTo(0.12);
    expect(Number(gsap.getProperty("[data-ic-fill]", "scaleX"))).toBe(0);
    finish(tl);
    expect(Number(gsap.getProperty("[data-ic-fill]", "scaleX"))).toBeCloseTo(0.3);
  });

  it("quiet hours, welcome and park use their one-sentence lines", () => {
    const endsAt = Date.now() + 60 * 60_000;
    const { unmount } = render(<QuietCard p={{ ...app, kind: "quiet", endsAt }} onBack={vi.fn()} onPause={vi.fn()} />);
    expect(screen.getByRole("heading")).toHaveTextContent(HEADLINE.waits("Discord", clock(endsAt)));
    unmount();
    const w = render(<WelcomeCard p={{ ...app, kind: "welcome", idleMs: 5 * 60_000, endsAt }} />);
    expect(WELCOME.some((l) => w.container.textContent!.startsWith(l))).toBe(true);
    w.unmount();
    render(<ParkCard onDone={vi.fn()} />);
    expect(PARK_LINES.some((l) => screen.getByRole("dialog").textContent!.startsWith(l))).toBe(true);
    expect(document.querySelector("em")).toBeNull();
  });
});

const session = (endsAt: number): SessionView => ({
  id: 1, profileId: 1, profileName: "Study", plannedMinutes: 60, startedAt: endsAt - 60 * 60_000, endsAt,
  remainingMs: 42 * 60_000 + 14_000, elapsedMs: 18 * 60_000, attempts: 0, sealedCount: 3, broken: false, idle: false,
});

describe("the close dialog", () => {
  it("says when quitting opens while sealed", () => {
    const endsAt = Date.now() + 42 * 60_000;
    act(() => {
      useStore.setState({ session: session(endsAt) });
      useStore.getState().setAppState("sealed");
      useStore.getState().openCloseDialog();
    });
    render(<CloseDialog />);
    expect(screen.getByTestId("close-subtitle")).toHaveTextContent(`Quit opens at ${clock(endsAt)}. Until then, Sanctum keeps running in the tray.`);
    const quit = screen.getByRole("radio", { name: /Quit Sanctum/ });
    expect(quit).toHaveTextContent(`Opens at ${clock(endsAt)}. Quitting before then breaks the seal.`);
    // The reason stays readable: the title drops to muted, no opacity.
    expect(quit.className).not.toMatch(/opacity/);
    expect(screen.getByTestId("close-left")).toHaveTextContent("42:14 left");
  });

  it("asks nothing when open: a statement, not a question", () => {
    act(() => useStore.getState().openCloseDialog());
    render(<CloseDialog />);
    expect(screen.getByTestId("close-subtitle")).toHaveTextContent("Choose what the close button does.");
    expect(screen.queryByTestId("close-left")).toBeNull();
    expect(quitOpens(null).subtitle).toMatch(/keep running in the tray/);
  });
});

describe("the quiet pause dialog", () => {
  it("uses the one-sentence headline", () => {
    act(() => useStore.setState({ quietPauseOpen: true }));
    render(<QuietPauseDialog />);
    expect(screen.getByRole("heading")).toHaveTextContent(/^Fifteen minutes needs a reason\.$/);
  });
});
