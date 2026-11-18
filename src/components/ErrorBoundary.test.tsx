import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";
import { ErrorBoundary, RELOAD_SAVE_MS } from "./ErrorBoundary";
import { bus } from "../lib/bus";
import { EVENTS } from "../lib/native";
import { useNotes } from "../state/notes";
import { AppShell } from "./AppShell";
import { useStore } from "../state/store";
import { resetMockBackend } from "../lib/mockBackend";
import { native } from "../lib/native";
import { sampleProfiles } from "../lib/catalog";
import { HEADLINE } from "../pages/headlines";

// Which pages throw on render, per test.
const boom = vi.hoisted(() => ({ home: false, stats: false }));

vi.mock("../pages/Home", async (orig) => {
  const real = await orig<typeof import("../pages/Home")>();
  return {
    ...real,
    Home: () => {
      if (boom.home) throw new Error("Home broke");
      return <real.Home />;
    },
  };
});
vi.mock("../pages/stats/StatsPage", async (orig) => {
  const real = await orig<typeof import("../pages/stats/StatsPage")>();
  return {
    ...real,
    StatsPage: () => {
      if (boom.stats) throw new Error("Stats broke");
      return <real.StatsPage />;
    },
  };
});

function Throws(): never {
  throw new Error("render failed");
}

const initial = useStore.getState();
let quiet: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  // React and the boundary both log a caught render error; keep the run readable.
  quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
  boom.home = false;
  boom.stats = false;
  resetMockBackend();
  useStore.setState(initial, true);
  for (const d of sampleProfiles()) await native.createProfile(d);
  await native.setSetting("onboarded", "1");
});
afterEach(() => quiet.mockRestore());

describe("error boundaries", () => {
  it("a window's render error shows a plain fallback with Reload, not a blank window", async () => {
    const reload = vi.fn();
    const loc = window.location;
    Object.defineProperty(window, "location", { configurable: true, value: { ...loc, reload } });
    try {
      render(
        <ErrorBoundary kind="window">
          <Throws />
        </ErrorBoundary>,
      );
      const alert = screen.getByRole("alert");
      expect(alert).toHaveTextContent(HEADLINE.screenBroke);
      expect(HEADLINE.screenBroke).toBe("Something broke on this screen.");
      fireEvent.click(screen.getByRole("button", { name: "Reload" }));
      await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    } finally {
      Object.defineProperty(window, "location", { configurable: true, value: loc });
    }
  });

  it("Reload saves the typing still waiting first, and a hung save can't hold it", async () => {
    const reload = vi.fn();
    const loc = window.location;
    Object.defineProperty(window, "location", { configurable: true, value: { ...loc, reload } });
    const flush = vi.spyOn(useNotes.getState(), "flush");
    try {
      render(
        <ErrorBoundary kind="page">
          <Throws />
        </ErrorBoundary>,
      );
      fireEvent.click(screen.getByRole("button", { name: "Reload" }));
      await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
      expect(flush).toHaveBeenCalled();

      // A save that never settles: the reload goes after the wait anyway.
      vi.useFakeTimers();
      flush.mockImplementation(() => new Promise<void>(() => undefined));
      reload.mockClear();
      fireEvent.click(screen.getByRole("button", { name: "Reload" }));
      await act(async () => void (await vi.advanceTimersByTimeAsync(RELOAD_SAVE_MS - 100)));
      expect(reload).not.toHaveBeenCalled();
      await act(async () => void (await vi.advanceTimersByTimeAsync(200)));
      expect(reload).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
      flush.mockRestore();
      Object.defineProperty(window, "location", { configurable: true, value: loc });
    }
  });

  it("the main window's fallback still answers the close button: the tray, or quit when that's the setting", async () => {
    const hide = vi.spyOn(native, "hideToTray");
    const quit = vi.spyOn(native, "quitApp").mockResolvedValue(undefined);
    try {
      render(
        <ErrorBoundary kind="window" main>
          <Throws />
        </ErrorBoundary>,
      );
      act(() => useStore.getState().openCloseDialog());
      await act(async () => bus.emit(EVENTS.closeRequested, null));
      expect(hide).toHaveBeenCalledTimes(1);
      // Shortcuts aren't left blocked by a dialog that can't show.
      expect(useStore.getState().closeDialogOpen).toBe(false);

      act(() => useStore.setState({ settings: { ...useStore.getState().settings, closeAction: "quit" } }));
      await act(async () => bus.emit(EVENTS.closeRequested, null));
      await waitFor(() => expect(quit).toHaveBeenCalledTimes(1));
    } finally {
      hide.mockRestore();
      quit.mockRestore();
    }
  });

  it("the compact timer's fallback fits on one line", () => {
    render(
      <ErrorBoundary kind="compact">
        <Throws />
      </ErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(HEADLINE.screenBroke);
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
  });

  it("children render untouched when nothing throws", () => {
    render(
      <ErrorBoundary kind="window">
        <p>Fine</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText("Fine")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("one page failing keeps the sidebar, and another tab starts clean", async () => {
    boom.stats = true;
    render(<AppShell />);
    await act(async () => await useStore.getState().loadProfiles());
    act(() => void useStore.getState().navigate("stats"));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(HEADLINE.screenBroke);
    expect(screen.getByRole("navigation", { name: "Sanctum" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Go to Today" }));
    expect(useStore.getState().activeTab).toBe("today");
    expect(await screen.findByRole("button", { name: /Enter focus/ })).toBeInTheDocument();
  });

  it("mid-seal, a failed page still offers End early", async () => {
    await act(async () => await useStore.getState().loadProfiles());
    await act(async () => void (await useStore.getState().enterFocus()));
    expect(useStore.getState().appState).toBe("sealed");
    boom.home = true;
    render(<AppShell />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("The seal keeps running.");
    expect(screen.getByRole("navigation", { name: "Sanctum" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "End early" }));
    expect(useStore.getState().endEarlyOpen).toBe(true);
    expect(await screen.findByRole("dialog", { name: "Break the seal" })).toBeInTheDocument();
  });
});
