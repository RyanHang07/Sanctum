import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useStore } from "./store";
import { connectNativeEvents } from "./events";
import { mockControls, resetMockBackend } from "../lib/mockBackend";
import { native, EVENTS } from "../lib/native";
import { bus } from "../lib/bus";
import { sampleProfiles } from "../lib/catalog";
import { AppShell } from "../components/AppShell";
import { BreakSealDialog } from "../components/BreakSealDialog";
import { vi } from "vitest";
import { HeldPage } from "../pages/HeldPage";
import { MARK_PATHS } from "../components/AnimatedMark";
import { SealedAppCard, TitleNudge, ordinal } from "../windows/Intercept";
import { fillStyle } from "../windows/CompactTimer";
import { countdown, joinNames, minutes } from "../lib/time";
import type { Intercept } from "../lib/types";

const initial = useStore.getState();
const REASON = "My interview moved up an hour and I need the laptop for the shared screen.";

async function sealed() {
  for (const d of sampleProfiles()) await native.createProfile(d);
  await act(() => useStore.getState().loadProfiles());
  await act(async () => void (await useStore.getState().enterFocus()));
}

let disconnect = () => {};
beforeEach(() => {
  resetMockBackend();
  useStore.setState(initial, true);
  disconnect = connectNativeEvents();
});
afterEach(() => disconnect());

describe("session lifecycle", () => {
  it("locks tabs, disables the dev toggle, and refuses to unseal without ending", async () => {
    await sealed();
    const s = useStore.getState();
    expect(s.appState).toBe("sealed");
    s.setAppState("open");
    expect(useStore.getState().appState).toBe("sealed");
    expect(useStore.getState().navigate("setup")).toBe(false);
  });

  it("Never mind keeps the seal", async () => {
    await sealed();
    act(() => useStore.getState().openEndEarly());
    render(<BreakSealDialog />);
    fireEvent.click(await screen.findByRole("button", { name: "Never mind, stay sealed" }));
    expect(useStore.getState().endEarlyOpen).toBe(false);
    expect(useStore.getState().appState).toBe("sealed");
  });

  it("break-seal ladder: reason and wait, retype, then the solo cooldown ends the session", async () => {
    await sealed();
    const t0 = Date.now();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(t0);
    try {
      act(() => useStore.getState().openEndEarly());
      render(<BreakSealDialog />);
      const dialog = await screen.findByRole("dialog", { name: "Break the seal" });
      expect(dialog).toHaveTextContent("Interview Prep · 60:00 left");
      expect(dialog).toHaveTextContent("30-minute cooldown");

      // Level 1: 50 characters, then a 5-minute wait.
      const start = within(dialog).getByRole("button", { name: "Start the wait" });
      fireEvent.change(within(dialog).getByLabelText("Reason"), { target: { value: "I want to stop." } });
      expect(start).toBeDisabled();
      expect(dialog).toHaveTextContent("15 / 50");
      fireEvent.change(within(dialog).getByLabelText("Reason"), { target: { value: REASON } });
      await act(async () => fireEvent.click(start));
      expect(screen.getByTestId("ladder-wait")).toHaveTextContent("5:00");
      expect(within(dialog).getByRole("button", { name: "Continue" })).toBeDisabled();
      vi.setSystemTime(t0 + 5 * 60_000);
      await waitFor(() => expect(within(dialog).getByRole("button", { name: "Continue" })).toBeEnabled(), { timeout: 2500 });
      await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "Continue" })));

      // Level 2: exact retype.
      const paragraph = screen.getByTestId("ladder-paragraph").textContent!;
      const box = within(dialog).getByLabelText("Retype the paragraph");
      fireEvent.change(box, { target: { value: paragraph.toLowerCase() } });
      expect(within(dialog).getByRole("button", { name: "Done" })).toBeDisabled();
      fireEvent.change(box, { target: { value: paragraph } });
      await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "Done" })));
      expect(dialog).toHaveTextContent("Reason given, waited 5 minutes");
      expect(dialog).toHaveTextContent("No partner is linked");

      // Level 3 solo: a 30-minute cooldown, then the session ends as unlocked early.
      await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "Start the cooldown" })));
      expect(screen.getByTestId("ladder-cooldown")).toHaveTextContent("30:00");
      vi.setSystemTime(t0 + 36 * 60_000);
      await waitFor(() => expect(within(dialog).getByRole("button", { name: "End the session" })).toBeEnabled(), { timeout: 2500 });
      await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "End the session" })));
      expect(await screen.findByRole("dialog", { name: "Seal lifted" })).toHaveTextContent("Cooldown done. Seal lifted.");
      expect(useStore.getState().session).toBeNull();
      expect(useStore.getState().appState).toBe("open");
    } finally {
      vi.useRealTimers();
    }
  });

  it("break-seal ladder: the partner denies, then approves after the 15-minute wait", async () => {
    await native.cloudSignInEmail("me@example.com");
    mockControls.partnerJoins("jordan@example.com", "Jordan");
    await sealed();
    const t0 = Date.now();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(t0);
    try {
      // Straight to level 3 through the commands; the UI takes it from there.
      await native.ladderOpen();
      await native.ladderReason(REASON);
      vi.setSystemTime(t0 + 5 * 60_000);
      const v = await native.ladderContinue();
      await native.ladderRetype(v.paragraph!);
      act(() => useStore.getState().openEndEarly());
      render(<BreakSealDialog />);
      const dialog = await screen.findByRole("dialog", { name: "Break the seal" });
      await act(async () => fireEvent.click(await within(dialog).findByRole("button", { name: "Ask Jordan" })));
      expect(dialog).toHaveTextContent("Waiting on Jordan");
      expect(dialog).toHaveTextContent(REASON);

      act(() => mockControls.partnerAnswers(false, "Finish the set."));
      await waitFor(() => expect(dialog).toHaveTextContent("said no."), { timeout: 2500 });
      // Denied: back to level 2, and the next request waits 15 minutes.
      expect(dialog).toHaveTextContent("Asking again starts here.");
      await act(async () => {
        const again = await native.ladderRetype(screen.getByTestId("ladder-paragraph").textContent!);
        expect(again.level).toBe(3);
      });
      await expect(native.ladderRequest()).rejects.toMatch(/next request opens in 1[45] min/);
      vi.setSystemTime(t0 + 25 * 60_000);
      await waitFor(() => expect(within(dialog).getByRole("button", { name: "Ask Jordan" })).toBeEnabled(), { timeout: 2500 });
      await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "Ask Jordan" })));

      act(() => mockControls.partnerAnswers(true));
      expect(await screen.findByRole("dialog", { name: "Seal lifted" }, { timeout: 2500 })).toHaveTextContent("Jordan approved. Seal lifted.");
      expect(useStore.getState().session).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("the emergency unlock skips the ladder once a week", async () => {
    await sealed();
    act(() => useStore.getState().openEndEarly());
    render(<BreakSealDialog />);
    const dialog = await screen.findByRole("dialog", { name: "Break the seal" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Emergency unlock" }));
    fireEvent.change(within(dialog).getByLabelText("What's the emergency"), { target: { value: "Family call" } });
    await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "Use it" })));
    expect(await screen.findByRole("dialog", { name: "Seal lifted" })).toHaveTextContent("Emergency unlock used.");
    expect(useStore.getState().session).toBeNull();

    act(() => useStore.getState().setUnlockResult(null));
    await act(async () => void (await useStore.getState().enterFocus()));
    act(() => useStore.getState().openEndEarly());
    const again = await screen.findByRole("dialog", { name: "Break the seal" });
    expect(await within(again).findByText(/Emergency unlock back/)).toBeInTheDocument();
  });

  it("tampering breaks the seal, says why, and keeps it on", async () => {
    await sealed();
    render(<AppShell />);
    // Let startup's session load land first.
    await act(async () => await new Promise((r) => setTimeout(r, 0)));
    await act(async () => mockControls.tamper("clock", "the system clock was set forward 60 min"));
    expect(screen.getByRole("status")).toHaveTextContent(/The seal is broken\.\s*The system clock was set forward 60 min\. It stays on until the planned end\./);
    expect(screen.getByTestId("session-bar")).toHaveTextContent("Seal broken, the streak resets");
    expect(useStore.getState().appState).toBe("sealed");
  });

  it("completing a session shows the held page with stats; Done returns Home", async () => {
    // Midday, so the hour of focus lands inside today whenever the suite runs.
    const noon = new Date();
    noon.setHours(12, 0, 0, 0);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(noon);
    try {
      await sealed();
      render(<AppShell />);
      act(() => mockControls.block());
      await act(async () => mockControls.fastForward(60 * 60_000));
      const page = screen.getByTestId("held-page");
      expect(page).toHaveTextContent("Interview Prep · 60 min");
      expect(page).toHaveTextContent("Sanctum held.");
      expect(page).toHaveTextContent("First one down."); // the day's first session
      expect(page).toHaveTextContent(/1\s*attempt blocked/);
      expect(page).toHaveTextContent(/1h\s*today of 2h/);
      fireEvent.keyDown(window, { key: "Escape" });
      expect(screen.queryByTestId("held-page")).toBeNull();
      expect(useStore.getState().appState).toBe("open");
    } finally {
      vi.useRealTimers();
    }
  });

  it("Enter again on the held page starts the same session", async () => {
    await sealed();
    await act(async () => mockControls.fastForward(60 * 60_000));
    const held = useStore.getState().held!;
    render(<HeldPage held={held} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /Enter again/ })));
    expect(useStore.getState().session?.profileName).toBe("Interview Prep");
    expect(useStore.getState().held).toBeNull();
  });

  it("says when downtime broke the session", () => {
    render(
      <HeldPage held={{ sessionId: 1, profileId: 1, profileName: "Study", plannedMinutes: 30, focusMinutes: 26, attempts: 0, broken: true }} />,
    );
    expect(screen.getByTestId("held-page")).toHaveTextContent(/Held, but the downtime broke it\.|Holding onto distraction is letting go of what really matters\./);
  });

  it("resumes a session reported by the backend on startup", async () => {
    await sealed();
    useStore.setState(initial, true);
    await act(() => useStore.getState().loadSession());
    expect(useStore.getState().appState).toBe("sealed");
  });

  it("follows session events from Rust", async () => {
    await sealed();
    render(<AppShell />);
    act(() => bus.emit(EVENTS.session, null));
    expect(useStore.getState().appState).toBe("open");
  });
});

describe("intercept overlay", () => {
  const payload: Intercept = {
    kind: "app",
    label: "Discord",
    attempts: 3,
    profileName: "Interview Prep",
    elapsedMs: 18 * 60_000,
    remainingMs: 32 * 60_000 + 14_000,
    backTo: "VS Code",
    keyword: null,
  };

  it("matches Blocked.dc.html and returns after 5 seconds", () => {
    vi.useFakeTimers();
    const onBack = vi.fn();
    render(<SealedAppCard p={payload} onBack={onBack} onBreak={() => {}} />);
    const card = screen.getByRole("alertdialog", { name: "Discord is sealed" });
    expect(card).toHaveTextContent("Discord stays sealed.");
    expect(card).toHaveTextContent("18 minutes into Interview Prep, 32:14 to go.");
    expect(card).toHaveTextContent("3rd attempt this session");
    expect(card).toHaveTextContent("Returning in 5s");
    expect(screen.getByRole("button", { name: /Back to VS Code/ })).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(5000));
    expect(onBack).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("shows a corner nudge for title keywords", () => {
    render(<TitleNudge p={{ ...payload, kind: "title", label: "Funny cats - YouTube Shorts", keyword: "shorts" }} />);
    expect(screen.getByRole("status")).toHaveTextContent("“shorts” stays sealed.Minimized Funny cats - YouTube Shorts");
  });

  it("uses English ordinals", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "101st"]);
  });
});

describe("compact timer and formatting", () => {
  it("fills cobalt left to right with progress", () => {
    expect(fillStyle(0.36).background).toBe("linear-gradient(90deg, #2F5BFF 0%, #2F5BFF 36.0%, #12151C 36.0%)");
    expect(fillStyle(2).background).toContain("100.0%");
  });

  it("formats time", () => {
    expect(countdown(38 * 60_000 + 14_000)).toBe("38:14");
    expect(countdown(120 * 60_000)).toBe("120:00");
    expect(countdown(999)).toBe("0:01");
    expect(minutes(58)).toBe("58m");
    expect(minutes(160)).toBe("2h 40m");
    expect(minutes(120)).toBe("2h");
    expect(joinNames(["Discord"])).toBe("Discord");
    expect(joinNames(["Discord", "Steam"])).toBe("Discord and Steam");
    expect(joinNames(["Discord", "Steam", "Zoom"])).toBe("Discord, Steam, and Zoom");
  });
});

describe("animated mark", () => {
  it("uses the exact geometry from design/logo (never redrawn)", () => {
    const svg = readFileSync(resolve(__dirname, "../../design/logo/sanctum-mark-mono-white.svg"), "utf8");
    const m = MARK_PATHS;
    expect(svg).toContain(`d="${m.beam}"`);
    expect(svg).toContain(`d="${m.keyStem}"`);
    for (const r of [m.nuki, m.legLeft, m.legRight]) {
      expect(svg).toContain(`x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}"`);
    }
    expect(svg).toContain(`cx="${m.keyCircle.cx}" cy="${m.keyCircle.cy}" r="${m.keyCircle.r}"`);
  });
});
