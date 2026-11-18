import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { DevStateToggle, resetDevTools } from "./DevStateToggle";
import { useStore } from "../state/store";
import { useRecap } from "../state/recap";
import { useTrackers } from "../state/trackers";
import { resetMockBackend } from "../lib/mockBackend";

const initial = { store: useStore.getState(), recap: useRecap.getState(), trackers: useTrackers.getState() };

beforeEach(() => {
  resetMockBackend();
  resetDevTools();
  useStore.setState(initial.store, true);
  useRecap.setState(initial.recap, true);
  useTrackers.setState(initial.trackers, true);
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
