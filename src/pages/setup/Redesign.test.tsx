import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { AppearanceSection } from "./Appearance";
import { TrackersTab } from "./Trackers";
import { Setup } from "../Setup";
import { useStore } from "../../state/store";
import { useTheme } from "../../state/theme";
import { useTrackers } from "../../state/trackers";
import { resetMockBackend } from "../../lib/mockBackend";
import { native } from "../../lib/native";
import { themeById } from "../../theme/themes";

// The second-colour redesign in Setup (S6): Appearance's pairs, lists and scroll, the General
// goal tick, Setup's sentence-case nav, and the tracker time picker following the theme.

const initial = useStore.getState();
const initialTheme = useTheme.getState();
const initialTrackers = useTrackers.getState();

beforeEach(() => {
  resetMockBackend();
  useStore.setState(initial, true);
  useTheme.setState(initialTheme, true);
  useTrackers.setState(initialTrackers, true);
  localStorage.clear();
});

const radioNames = (group: string) => within(screen.getByRole("radiogroup", { name: group })).getAllByRole("radio").map((r) => r.getAttribute("aria-label"));

describe("Setup › Appearance", () => {
  it("lists Catppuccin Latte with the light themes and leaves out the retired copies", async () => {
    await act(() => useTheme.getState().load());
    render(<AppearanceSection />);
    const dark = radioNames("Theme in dark mode");
    const light = radioNames("Theme in light mode");
    expect(light).toContain("Catppuccin Latte");
    expect(dark).not.toContain("Catppuccin Latte");
    for (const name of [...dark, ...light]) expect(name).not.toMatch(/Catppuccin (Frappe|Macchiato) Light/);
    expect(new Set([...dark, ...light]).size).toBe(dark.length + light.length);
  });

  it("marks Latte chosen when the saved light theme is a retired Catppuccin copy", async () => {
    await act(() => useTheme.getState().setPrefs({ follow: true, dark: "sanctum-dark", light: "catppuccin-frappe-light", fixed: "sanctum-dark" }));
    render(<AppearanceSection />);
    const light = within(screen.getByRole("radiogroup", { name: "Theme in light mode" }));
    expect(light.getByRole("radio", { name: "Catppuccin Latte" })).toHaveAttribute("aria-checked", "true");
  });

  it("shows each theme's accent and second colour, in the row and in the preview", async () => {
    await act(() => useTheme.getState().load());
    render(<AppearanceSection />);
    const dark = within(screen.getByRole("radiogroup", { name: "Theme in dark mode" }));
    const nord = dark.getByRole("radio", { name: "Nord" });
    expect(nord.querySelector("[data-pair] .bg-sealed")).not.toBeNull();
    expect(nord.querySelector("[data-pair] .bg-second")).not.toBeNull();

    fireEvent.focus(nord);
    const card = document.querySelector<HTMLElement>("[data-theme-preview]")!;
    const theme = themeById("nord")!;
    expect(card).toHaveTextContent("Nord");
    expect(card).toHaveTextContent("Dark");
    expect(card).toHaveTextContent(`Accent${theme.palette.sealed}`);
    expect(card).toHaveTextContent(`Second colour${theme.palette.second}`);
    fireEvent.blur(nord);
    expect(document.querySelector("[data-theme-preview]")).toBeNull();
  });

  it("opens scrolled so the chosen theme sits mid-view", async () => {
    const spy = vi.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = spy;
    try {
      await act(() => useTheme.getState().setPrefs({ follow: false, dark: "sanctum-dark", light: "sanctum-light", fixed: "tokyonight" }));
      render(<AppearanceSection />);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.contexts[0]).toHaveAttribute("data-theme-id", "tokyonight");
      expect(spy.mock.calls[0]![0]).toMatchObject({ block: "center" });

      // Picking another theme keeps the list where it is.
      await act(async () => fireEvent.click(screen.getByRole("radio", { name: "Nord" })));
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });
});

describe("Setup › General and the nav", () => {
  it("puts the goal tick in the second colour beside the daily goal", async () => {
    useStore.setState({ setupTab: "general" });
    render(<Setup />);
    const goal = screen.getByRole("combobox", { name: "Daily focus goal" });
    const tick = goal.closest("label")!.parentElement!.querySelector("[data-goal-tick]")!;
    expect(tick).toHaveAttribute("aria-hidden", "true");
    expect(tick).toHaveClass("bg-second");
    expect(tick.className).not.toMatch(/shadow|blur|glow/);
  });

  it("labels the nav groups in sentence case, readable, and swaps tabs without a page fade", () => {
    render(<Setup />);
    const header = screen.getByText("Connections");
    expect(header).toHaveClass("label");
    expect(header.className).not.toMatch(/uppercase|text-faint/);
    expect(screen.getByRole("tabpanel").className).not.toContain("page-in");
  });
});

describe("Setup › Trackers", () => {
  it("gives the check-in time picker the theme's scheme, light or dark", async () => {
    await native.saveTracker({ name: "Weight", kind: "number", unit: "lb" });
    await act(() => useTheme.getState().setPrefs({ follow: false, dark: "sanctum-dark", light: "sanctum-light", fixed: "sanctum-light" }));
    render(<TrackersTab />);
    const section = within(await screen.findByRole("region", { name: "Check-ins" }));
    await act(async () => fireEvent.click(section.getByRole("button", { name: "New check-in" })));
    const time = section.getByLabelText("Time");
    expect(time.style.colorScheme).toBe("light");
    expect(time.className).not.toContain("color-scheme:dark");

    await act(() => useTheme.getState().setPrefs({ follow: false, dark: "sanctum-dark", light: "sanctum-light", fixed: "sanctum-dark" }));
    expect(time.style.colorScheme).toBe("dark");
  });
});
