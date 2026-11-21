import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { DevStateToggle, resetDevTools } from "./DevStateToggle";
import { useStore } from "../state/store";
import { useRecap } from "../state/recap";
import { useTrackers } from "../state/trackers";
import { resetMockBackend } from "../lib/mockBackend";
import { useUpdate } from "../state/update";
import { Toast } from "./Toast";
import { HEADLINE } from "../pages/headlines";

const initial = { store: useStore.getState(), recap: useRecap.getState(), trackers: useTrackers.getState(), update: useUpdate.getState() };

beforeEach(() => {
  resetMockBackend();
  resetDevTools();
  useStore.setState(initial.store, true);
  useRecap.setState(initial.recap, true);
  useTrackers.setState(initial.trackers, true);
  useUpdate.setState(initial.update, true);
});

describe("dev tools", () => {
  it("plays the moments and opens the screens that are hard to reach by hand", () => {
    render(<DevStateToggle />);
    fireEvent.click(screen.getByRole("button", { name: "Show dev tools" }));
    const tools = within(screen.getByLabelText("Dev tools"));

    act(() => fireEvent.click(tools.getByRole("button", { name: "Held" })));
    expect(useStore.getState().held).toMatchObject({ broken: false, plannedMinutes: 60 });
    act(() => fireEvent.click(tools.getByRole("button", { name: "Seal broken" })));
    expect(useStore.getState().held).toMatchObject({ broken: true, broke: { kind: "killed" } });

    act(() => fireEvent.click(tools.getByRole("button", { name: "Onboarding" })));
    expect(useStore.getState().onboarding).toBe(true);
    act(() => fireEvent.click(tools.getByRole("button", { name: "Check-in" })));
    expect(useTrackers.getState().prompt).toEqual({ kind: "manual" });
    act(() => fireEvent.click(tools.getByRole("button", { name: "Weekly recap" })));
    expect(useRecap.getState().recap).not.toBeNull();
  });

  it("shows the mini timer at its real size", () => {
    render(<DevStateToggle />);
    fireEvent.click(screen.getByRole("button", { name: "Show dev tools" }));
    fireEvent.click(screen.getByRole("button", { name: "Mini timer" }));
    expect(screen.getByText("Mini timer · 300×58")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close Mini timer" }));
    expect(screen.queryByText("Mini timer · 300×58")).toBeNull();
  });

  it("shows the tray panel at its real size", async () => {
    render(<DevStateToggle />);
    fireEvent.click(screen.getByRole("button", { name: "Show dev tools" }));
    fireEvent.click(screen.getByRole("button", { name: "Tray panel" }));
    expect(screen.getByText("Tray panel · 340×440")).toBeInTheDocument();
    expect(await screen.findByRole("region", { name: "Sanctum tray panel" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close Tray panel" }));
    expect(screen.queryByRole("region", { name: "Sanctum tray panel" })).toBeNull();
  });

  it("shows the notices, one click each, and they dismiss", () => {
    render(
      <>
        <DevStateToggle />
        <Toast />
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Show dev tools" }));
    const tools = within(screen.getByLabelText("Dev tools"));

    act(() => fireEvent.click(tools.getByRole("button", { name: "Notice" })));
    expect(screen.getByRole("status")).toHaveTextContent("Saved.");
    act(() => fireEvent.click(screen.getByRole("status")));
    expect(screen.queryByRole("status")).toBeNull();

    act(() => fireEvent.click(tools.getByRole("button", { name: "Notice with action" })));
    act(() => fireEvent.click(screen.getByRole("button", { name: "Undo" })));
    expect(useStore.getState().notice).toBeNull();

    act(() => fireEvent.click(tools.getByRole("button", { name: "Locked tab" })));
    expect(screen.getByRole("status")).toHaveTextContent("Week is locked while you're sealed.");

    act(() => fireEvent.click(tools.getByRole("button", { name: "Long error" })));
    expect(screen.getByRole("status")).toHaveTextContent("database file is locked");

    act(() => fireEvent.click(tools.getByRole("button", { name: "Update ready" })));
    expect(useUpdate.getState().ready).toMatchObject({ version: "0.4.1" });
    act(() => fireEvent.click(tools.getByRole("button", { name: "Update ready" })));
    expect(useUpdate.getState().later).toBe("0.4.1");
  });

  it("shows the error fallbacks without taking the app down", () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(<DevStateToggle />);
    fireEvent.click(screen.getByRole("button", { name: "Show dev tools" }));
    fireEvent.click(screen.getByRole("button", { name: "Window error" }));
    fireEvent.click(screen.getByRole("button", { name: "Mini timer error" }));
    expect(screen.getAllByRole("alert")).toHaveLength(2);
    expect(screen.getAllByText(HEADLINE.screenBroke)).toHaveLength(2);
    expect(screen.getByLabelText("Dev tools")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close Window error" }));
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    quiet.mockRestore();
  });

  it("shows the intercept cards one at a time", () => {
    render(<DevStateToggle />);
    fireEvent.click(screen.getByRole("button", { name: "Show dev tools" }));
    fireEvent.click(screen.getByRole("button", { name: "Sealed app" }));
    expect(screen.getByRole("alertdialog", { name: "Discord is sealed" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Title nudge" }));
    expect(screen.queryByRole("alertdialog", { name: "Discord is sealed" })).toBeNull();
    expect(screen.getByText("“reddit” stays sealed.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Pause mode" }));
    fireEvent.click(screen.getByRole("button", { name: /Not now/ }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  describe("extension pages", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("shows the popup and the blocked page in each state the preview supports", async () => {
      vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(""))));
      render(<DevStateToggle />);
      fireEvent.click(screen.getByRole("button", { name: "Show dev tools" }));
      fireEvent.click(screen.getByRole("button", { name: "Ext popup" }));
      fireEvent.click(screen.getByRole("button", { name: "Ext blocked" }));
      expect(screen.getByText("Extension popup · 300×230")).toBeInTheDocument();
      expect(screen.getByText("Blocked page · 1280×800 tab at 45%")).toBeInTheDocument();

      const popup = await screen.findByTitle("Extension popup");
      const blocked = await screen.findByTitle("Blocked page");
      expect(popup).toHaveAttribute("src", "http://localhost:5175/popup.html?state=sealed");
      expect(blocked).toHaveAttribute("src", "http://localhost:5175/blocked.html?site=youtube.com&state=sealed");

      const states = within(screen.getByRole("radiogroup", { name: "Extension state" }));
      expect(states.getByRole("radio", { name: "Sealed" })).toHaveAttribute("aria-checked", "true");
      fireEvent.click(states.getByRole("radio", { name: "Offline" }));
      expect(states.getByRole("radio", { name: "Offline" })).toHaveAttribute("aria-checked", "true");
      expect(screen.getByTitle("Extension popup")).toHaveAttribute("src", "http://localhost:5175/popup.html?state=offline");
      expect(screen.getByTitle("Blocked page")).toHaveAttribute("src", "http://localhost:5175/blocked.html?site=youtube.com&state=offline");

      // Pause mode is the blocked page's; the popup shows nothing sealed.
      fireEvent.click(states.getByRole("radio", { name: "Pause" }));
      expect(screen.getByTitle("Extension popup")).toHaveAttribute("src", "http://localhost:5175/popup.html?state=open");
      expect(screen.getByTitle("Blocked page")).toHaveAttribute("src", "http://localhost:5175/blocked.html?site=youtube.com&pause=1&state=open");
    });

    it("says how to start the preview server when it isn't running", async () => {
      vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))));
      render(<DevStateToggle />);
      fireEvent.click(screen.getByRole("button", { name: "Show dev tools" }));
      fireEvent.click(screen.getByRole("button", { name: "Ext blocked" }));
      expect(await screen.findByText("The extension preview server isn't running.")).toBeInTheDocument();
      expect(screen.getByText("npm run ext:preview", { selector: "span" })).toBeInTheDocument();
      expect(screen.queryByTitle("Blocked page")).toBeNull();
    });
  });
});
