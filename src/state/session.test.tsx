import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { useStore } from "./store";
import { connectNativeEvents } from "./events";
import { mockControls, resetMockBackend } from "../lib/mockBackend";
import { native, EVENTS } from "../lib/native";
import { bus } from "../lib/bus";
import { sampleProfiles } from "../lib/catalog";
import { AppShell } from "../components/AppShell";
import { EndEarlyDialog } from "../components/EndEarlyDialog";
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

  it("End early needs 50 characters, then breaks the seal", async () => {
    await sealed();
    act(() => useStore.getState().openEndEarly());
    render(<EndEarlyDialog />);
    const dialog = screen.getByRole("dialog", { name: "Break the seal" });
    const breakBtn = within(dialog).getByRole("button", { name: "Break the seal" });
    expect(dialog).toHaveTextContent("Interview Prep · 60:00 left");
    fireEvent.change(within(dialog).getByLabelText("Reason"), { target: { value: "I want to stop." } });
    expect(breakBtn).toBeDisabled();
    expect(dialog).toHaveTextContent("15 / 50");
    fireEvent.change(within(dialog).getByLabelText("Reason"), { target: { value: REASON } });
    expect(breakBtn).toBeEnabled();
    await act(async () => fireEvent.click(breakBtn));
    const s = useStore.getState();
    expect(s.appState).toBe("open");
    expect(s.session).toBeNull();
    expect(s.notice).toEqual({ lead: "Seal broken.", rest: "Logged with your reason." });
  });

  it("Never mind keeps the seal", async () => {
    await sealed();
    act(() => useStore.getState().openEndEarly());
    render(<EndEarlyDialog />);
    fireEvent.click(screen.getByRole("button", { name: "Never mind, stay sealed" }));
    expect(useStore.getState().endEarlyOpen).toBe(false);
    expect(useStore.getState().appState).toBe("sealed");
  });

  it("completing a session shows the held page with stats; Done returns Home", async () => {
    await sealed();
    render(<AppShell />);
    act(() => mockControls.block());
    await act(async () => mockControls.fastForward(60 * 60_000));
    const page = screen.getByTestId("held-page");
    expect(page).toHaveTextContent("Interview Prep · 60 min");
    expect(page).toHaveTextContent("Sanctum held.");
    expect(page).toHaveTextContent("Promise kept.");
    expect(page).toHaveTextContent(/1\s*attempt blocked/);
    expect(page).toHaveTextContent(/1h\s*today of 2h/);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("held-page")).toBeNull();
    expect(useStore.getState().appState).toBe("open");
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
    expect(screen.getByTestId("held-page")).toHaveTextContent("Held, but the downtime broke it.");
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

  it("warns before closing an app outside the allowlist", () => {
    render(<SealedAppCard p={{ ...payload, kind: "flag", label: "Steam", attempts: 1 }} onBack={() => {}} onBreak={() => {}} />);
    const card = screen.getByRole("alertdialog", { name: "Steam is outside the allowlist" });
    expect(card).toHaveTextContent("Steam isn't part of this session.");
    expect(card).toHaveTextContent("Minimized. Bring it back and it closes.");
    expect(card).toHaveTextContent("1st attempt this sessionAllowlist mode");
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
