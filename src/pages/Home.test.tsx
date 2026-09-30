import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { Home } from "./Home";
import { useStore } from "../state/store";
import { connectNativeEvents } from "../state/events";
import { mockControls, resetMockBackend } from "../lib/mockBackend";
import { native } from "../lib/native";
import { catalogDistractions, sampleProfiles } from "../lib/catalog";

const initial = useStore.getState();

/** The sample profiles, and the four common distractions onboarding starts with. */
async function withSampleProfiles() {
  for (const d of sampleProfiles()) await native.createProfile(d);
  for (const g of catalogDistractions().filter((g) => ["Discord", "YouTube", "Instagram", "TikTok"].includes(g.label))) {
    for (const item of g.items) await native.addDistraction(item);
  }
  await act(() => useStore.getState().loadProfiles());
  await act(() => useStore.getState().loadDistractions());
}

let disconnect = () => {};
beforeEach(() => {
  resetMockBackend();
  useStore.setState(initial, true);
  disconnect = connectNativeEvents();
});
afterEach(() => disconnect());

describe("Home streak chip", () => {
  it("shows the streak and the last 7 days, and opens Stats", async () => {
    const { addDays, todayKey } = await import("../lib/planner");
    const t = todayKey();
    mockControls.statsDays({ [addDays(t, -2)]: { focusMin: 130 }, [addDays(t, -1)]: { focusMin: 125 } });
    render(<Home />);
    const chip = await screen.findByRole("button", { name: "2 day streak. Open Stats" });
    expect(chip.querySelectorAll("[data-status]")).toHaveLength(7);
    expect(chip.querySelectorAll('[data-status="kept"]')).toHaveLength(2);
    fireEvent.click(chip);
    expect(useStore.getState().activeTab).toBe("stats");
  });
});

describe("Home", () => {
  it("shows the focus row with real profiles and Duration (30, 60, 90, 120) when open", async () => {
    await withSampleProfiles();
    render(<Home />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Keep your promises. Or stay mid.");
    // A sentence to fill in: "Seal Interview Prep for 60 min".
    const row = within(screen.getByTestId("focus-row"));
    expect(row.getByRole("button", { name: "Profile: Interview Prep" })).toHaveAttribute("aria-haspopup", "listbox");
    expect(row.getByRole("spinbutton", { name: "Length" })).toHaveAttribute("aria-valuenow", "60");
    fireEvent.click(row.getByRole("button", { name: "Profile: Interview Prep" }));
    const options = within(screen.getByRole("listbox", { name: "Profile" })).getAllByRole("option");
    expect(options.map((o) => o.firstElementChild?.textContent)).toEqual(["Interview Prep", "Deep Work", "Study", "Light Work"]);
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    expect(options[0]).toHaveTextContent("Opens LeetCode, NeetCode");
    expect(screen.getByTestId("focus-row")).toHaveTextContent(`Opens LeetCode, NeetCode, VS Code, Excalidraw, Notion · seals ${useStore.getState().distractions.length}`);
    expect(screen.getByRole("button", { name: /Enter focus/ })).not.toContainElement(screen.getByTestId("focus-note"));
    expect(screen.getByRole("button", { name: /Enter focus/ }).className).toContain("h-[82px]");
    expect(screen.getByRole("button", { name: /Enter focus/ })).toBeEnabled();
  });

  it("switching profile applies its default duration", async () => {
    await withSampleProfiles();
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: /^Profile:/ }));
    fireEvent.click(within(screen.getByRole("listbox", { name: "Profile" })).getByRole("option", { name: /Deep Work/ }));
    expect(screen.queryByRole("listbox", { name: "Profile" })).toBeNull();
    const length = screen.getByRole("spinbutton", { name: "Length" });
    expect(length).toHaveAttribute("aria-valuenow", "90");
    // Arrow keys and the − / + buttons step it.
    fireEvent.keyDown(length, { key: "ArrowUp" });
    expect(useStore.getState().durationMin).toBe(120);
    expect(screen.getByRole("button", { name: "Longer" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Shorter" }));
    expect(useStore.getState().durationMin).toBe(90);
  });

  it("has an empty state with Enter focus disabled when there are no profiles", async () => {
    await act(() => useStore.getState().loadProfiles());
    render(<Home />);
    expect(screen.queryByRole("button", { name: /^Profile:/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Enter focus/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Create one in Setup" }));
    expect(useStore.getState().activeTab).toBe("setup");
  });

  it("warns which open apps will close before entering", async () => {
    await withSampleProfiles();
    render(<Home />);
    // Mock backend: Discord is running and flagged.
    expect(await screen.findByText("Discord closes when you enter")).toBeInTheDocument();
  });

  it("Enter focus seals with a real session and runs the timer", async () => {
    await withSampleProfiles();
    render(<Home />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Enter focus/ }));
    });
    const s = useStore.getState();
    expect(s.appState).toBe("sealed");
    expect(s.session?.plannedMinutes).toBe(60);
    const bar = screen.getByTestId("session-bar");
    expect(within(bar).getByRole("timer")).toHaveTextContent("60:00");
    expect(bar).toHaveTextContent("Sealed · Interview Prep · 60 min");
    expect(bar).toHaveTextContent("0 attempts blocked");
    await act(async () => mockControls.fastForward(18 * 60_000 + 500));
    expect(within(bar).getByRole("timer")).toHaveTextContent("42:00");
    act(() => mockControls.block("Discord"));
    expect(bar).toHaveTextContent("1 attempt blocked");
  });

  it("End early opens the break-the-seal dialog", async () => {
    await withSampleProfiles();
    render(<Home />);
    await act(async () => void (await useStore.getState().enterFocus()));
    fireEvent.click(screen.getByRole("button", { name: "End early" }));
    expect(useStore.getState().endEarlyOpen).toBe(true);
  });

  it("Enter focus opens the launch set and reports it", async () => {
    await withSampleProfiles();
    render(<Home />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Enter focus/ }));
    });
    // Mock backend: VS Code is running, the rest open.
    expect(useStore.getState().notice?.lead).toBe("Opened LeetCode, NeetCode, Excalidraw, Notion.");
    expect(useStore.getState().notice?.rest).toBe("Focused VS Code.");
  });

  it("swaps the focus row for the session bar when sealed", async () => {
    await withSampleProfiles();
    act(() => useStore.getState().setAppState("sealed"));
    render(<Home />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("You’re sealed in. Finish what you started.");
    expect(screen.queryByTestId("focus-row")).toBeNull();
    expect(screen.getByTestId("session-bar")).toHaveTextContent("Sealed · Interview Prep · 60 min");
  });

  it("shows the event bar in an event", () => {
    act(() => useStore.getState().setAppState("event"));
    render(<Home />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Mock interview until 3:00. Be all the way there.");
    expect(screen.getByTestId("event-bar")).toBeInTheDocument();
  });

  it("dismisses the empty schedule hint and brings it back from Customize", async () => {
    await withSampleProfiles();
    render(<Home />);
    expect(screen.getByTestId("suggestion")).toHaveTextContent("No focus block on your schedule.");
    await act(async () => fireEvent.click(within(screen.getByTestId("suggestion")).getByRole("button", { name: "Dismiss" })));
    expect(screen.queryByTestId("suggestion")).toBeNull();
    expect(await native.getSetting("home_layout")).toContain("hint");
    fireEvent.click(screen.getByRole("button", { name: "Customize" }));
    await act(async () => fireEvent.click(screen.getByRole("switch", { name: "Show Empty schedule hint" })));
    expect(screen.getByTestId("suggestion")).toBeInTheDocument();
  });

  it("centers the Enter focus label with the shortcut under it", async () => {
    await withSampleProfiles();
    render(<Home />);
    const button = screen.getByRole("button", { name: /Enter focus/ });
    // Only the label takes part in centering; the shortcut is positioned under it.
    expect(button.firstElementChild).toBe(screen.getByTestId("enter-label"));
    expect(button.lastElementChild!.className).toContain("absolute");
  });
});
