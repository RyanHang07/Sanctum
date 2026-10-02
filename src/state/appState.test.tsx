import { act, fireEvent, render, screen } from "@testing-library/react";
import { TABS, canQuit, isTabLocked, lockedToast, resolveClose } from "./appState";
import { useStore } from "./store";
import { Sidebar } from "../components/Sidebar";
import { CloseDialog } from "../components/CloseDialog";
import { Toast } from "../components/Toast";
import { EVENT_PAYOFFS, OPEN, SEALED, homeHeadline } from "../pages/headlines";
import { native } from "../lib/native";

const initial = useStore.getState();
beforeEach(() => useStore.setState(initial, true));

describe("state machine", () => {
  it("locks every tab except Today while sealed", () => {
    expect(TABS.filter((t) => isTabLocked("sealed", t.id)).map((t) => t.id)).toEqual(["week", "stats", "trackers", "setup"]);
    expect(isTabLocked("sealed", "today")).toBe(false);
  });

  it("keeps every tab reachable when open or in an event", () => {
    for (const s of ["open", "event"] as const) for (const t of TABS) expect(isTabLocked(s, t.id)).toBe(false);
  });

  it("disables Quit only while sealed", () => {
    expect(canQuit("open")).toBe(true);
    expect(canQuit("event")).toBe(true);
    expect(canQuit("sealed")).toBe(false);
  });

  it("sends a saved Quit to the tray while sealed", () => {
    expect(resolveClose("sealed", "quit")).toBe("tray");
    expect(resolveClose("sealed", "ask")).toBe("ask");
    expect(resolveClose("open", "quit")).toBe("quit");
  });

  it("uses the locked toast copy from the design", () => {
    expect(lockedToast("week")).toEqual({ lead: "Week is locked while you're sealed.", rest: "End focus to open it." });
  });

  it("has a headline for each state, from that state's lines", () => {
    const at = new Date(2026, 9, 1, 14, 0);
    const lines = (l: readonly (readonly [string, string])[]) => l.map((x) => x.join(" "));
    expect([...lines(OPEN), "Half the day is left. Use it."]).toContain(homeHeadline("open", undefined, at).join(" "));
    expect(lines(SEALED)).toContain(homeHeadline("sealed", undefined, at).join(" "));
    const [lead, payoff] = homeHeadline("event", { title: "Mock interview", until: "3:00" }, at);
    expect(lead).toBe("Mock interview until 3:00.");
    expect(EVENT_PAYOFFS).toContain(payoff);
  });
});

describe("store", () => {
  it("sealing returns to Today and blocks navigation with a toast", () => {
    const s = useStore.getState();
    s.navigate("week");
    expect(useStore.getState().activeTab).toBe("week");

    s.setAppState("sealed");
    expect(useStore.getState().activeTab).toBe("today");
    expect(useStore.getState().sealedAt).not.toBeNull();

    expect(useStore.getState().navigate("setup")).toBe(false);
    expect(useStore.getState().activeTab).toBe("today");
    expect(useStore.getState().lockedToast).toBe("setup");

    s.setAppState("open");
    expect(useStore.getState().lockedToast).toBeNull();
    expect(useStore.getState().sealedAt).toBeNull();
    expect(useStore.getState().navigate("setup")).toBe(true);
  });
});

describe("Sidebar", () => {
  it("shows locks and the toast when a locked tab is clicked", () => {
    act(() => useStore.getState().setAppState("sealed"));
    render(
      <>
        <Sidebar />
        <Toast />
      </>,
    );
    expect(screen.getByTestId("state-pill")).toHaveTextContent("Sealed");
    const week = screen.getByRole("button", { name: /Week/ });
    expect(week).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("button", { name: /Today/ })).not.toHaveAttribute("aria-disabled");

    fireEvent.click(week);
    expect(screen.getByRole("status")).toHaveTextContent("Week is locked while you're sealed.End focus to open it.");
  });

  it("has no locks when open", () => {
    render(<Sidebar />);
    expect(screen.getByTestId("state-pill")).toHaveTextContent("Open");
    for (const name of ["Week", "Trackers", "Setup"]) {
      expect(screen.getByRole("button", { name: new RegExp(name) })).not.toHaveAttribute("aria-disabled");
    }
  });
});

describe("Collapsible sidebar", () => {
  it("collapses to an icon rail, keeps navigation and locks, and remembers it", async () => {
    render(<Sidebar pillMeta="42:00" />);
    const nav = screen.getByRole("navigation", { name: "Sanctum" });
    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    expect(nav).toHaveAttribute("data-collapsed", "true");
    expect(screen.queryByText("Sanctum")).toBeNull();
    // Tabs keep working by their accessible names and tooltips.
    fireEvent.click(screen.getByRole("button", { name: "Week" }));
    expect(useStore.getState().activeTab).toBe("week");
    expect(screen.getByRole("button", { name: "Setup" })).toHaveAttribute("title", "Setup (Ctrl ,)");
    expect(await native.getSetting("sidebar_collapsed")).toBe("1");

    act(() => useStore.getState().setAppState("sealed"));
    expect(screen.getByRole("status", { name: "Sealed · 42:00" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Trackers" })).toHaveAttribute("title", "Trackers is locked while you're sealed");

    fireEvent.click(screen.getByRole("button", { name: "Expand sidebar" }));
    expect(nav).not.toHaveAttribute("data-collapsed");
    expect(screen.getByText("Sanctum")).toBeInTheDocument();
  });
});

describe("Close dialog", () => {
  it("disables Quit while sealed", () => {
    act(() => {
      useStore.getState().setAppState("sealed");
      useStore.getState().openCloseDialog();
    });
    render(<CloseDialog />);
    const quit = screen.getByRole("radio", { name: /Quit Sanctum/ });
    expect(quit).toBeDisabled();
    expect(screen.getByRole("radio", { name: /Minimize to tray/ })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(quit);
    expect(screen.getByRole("radio", { name: /Minimize to tray/ })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("button", { name: /Minimize/ })).toBeInTheDocument();
  });

  it("allows Quit when open and remembers the choice", () => {
    act(() => useStore.getState().openCloseDialog());
    render(<CloseDialog />);
    const quit = screen.getByRole("radio", { name: /Quit Sanctum/ });
    expect(quit).toBeEnabled();
    fireEvent.click(quit);
    fireEvent.click(screen.getByRole("button", { name: /^Quit/ }));
    expect(useStore.getState().settings.closeAction).toBe("quit");
    expect(useStore.getState().closeDialogOpen).toBe(false);
  });
});
