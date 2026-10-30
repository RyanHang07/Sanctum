import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { DEFAULT_PREFS, resolve, useTheme } from "./theme";
import { AppearanceSection } from "../pages/setup/Appearance";
import { native } from "../lib/native";
import { mockExtension, resetMockBackend } from "../lib/mockBackend";
import { commandsFor } from "../components/CommandBar";

const initial = useTheme.getState();

beforeEach(() => {
  resetMockBackend();
  useTheme.setState(initial, true);
  localStorage.clear();
});

const shown = () => document.documentElement.dataset.theme;

describe("themes (v0.3)", () => {
  it("follows Windows with Sanctum Dark and Sanctum Light, or shows one theme", () => {
    expect(resolve(DEFAULT_PREFS, true).id).toBe("sanctum-dark");
    expect(resolve(DEFAULT_PREFS, false).id).toBe("sanctum-light");
    expect(resolve({ ...DEFAULT_PREFS, follow: false, fixed: "nord" }, false).id).toBe("nord");
    // A theme that no longer exists falls back to Sanctum Dark.
    expect(resolve({ ...DEFAULT_PREFS, follow: false, fixed: "gone" }, true).id).toBe("sanctum-dark");
  });

  it("starts a new install following Windows, and keeps an existing install on Sanctum Dark", async () => {
    await act(() => useTheme.getState().load());
    expect(useTheme.getState().prefs).toEqual(DEFAULT_PREFS);

    await native.setSetting("onboarded", "1");
    await act(() => useTheme.getState().load());
    expect(useTheme.getState().prefs).toMatchObject({ follow: false, fixed: "sanctum-dark" });
    expect(shown()).toBe("sanctum-dark");
  });

  it("picks into the dark or light slot while following, and saves it", async () => {
    await act(() => useTheme.getState().load());
    await act(() => useTheme.getState().pick("dracula"));
    await act(() => useTheme.getState().pick("solarized-light"));
    expect(useTheme.getState().prefs).toMatchObject({ follow: true, dark: "dracula", light: "solarized-light" });
    expect(JSON.parse((await native.getSetting("theme"))!)).toMatchObject({ dark: "dracula", light: "solarized-light" });
    // Other windows read the same choice.
    expect(JSON.parse(localStorage.getItem("sanctum-theme")!)).toMatchObject({ dark: "dracula" });
    // The extension's pages follow what's kept (a hover preview isn't sent).
    useTheme.getState().preview("nord");
    expect(mockExtension.theme?.id).toBe(useTheme.getState().theme.id);
    useTheme.getState().preview(null);
  });

  it("turning following off keeps what shows; a pick then is the one theme", async () => {
    await act(() => useTheme.getState().load());
    const now = useTheme.getState().theme.id;
    await act(() => useTheme.getState().setFollow(false));
    expect(useTheme.getState().prefs).toMatchObject({ follow: false, fixed: now });
    await act(() => useTheme.getState().pick("gruvbox-dark"));
    expect(useTheme.getState().prefs.fixed).toBe("gruvbox-dark");
    expect(shown()).toBe("gruvbox-dark");
  });

  it("Ctrl K switches light and dark, and finds a theme by name", async () => {
    await act(() => useTheme.getState().load());
    const flip = commandsFor("").find((c) => c.id === "theme-flip")!;
    expect(flip.label).toBe(`Switch to ${useTheme.getState().theme.scheme === "dark" ? "light" : "dark"}`);
    const before = useTheme.getState().theme.scheme;
    await act(async () => void (await flip.run()));
    expect(useTheme.getState().theme.scheme).not.toBe(before);
    expect(useTheme.getState().prefs.follow).toBe(false);
    // Back to following, from the same bar.
    await act(async () => void (await commandsFor("").find((c) => c.id === "theme-follow")!.run()));
    expect(useTheme.getState().prefs.follow).toBe(true);

    // Themes only list once you type, and run as a pick.
    expect(commandsFor("").some((c) => c.id.startsWith("theme:"))).toBe(false);
    const dracula = commandsFor("dracula").find((c) => c.label === "Theme: Dracula")!;
    await act(async () => void (await dracula.run()));
    expect(useTheme.getState().prefs.dark).toBe("dracula");
  });

  it("Setup › Appearance previews on hover and keeps a theme on click", async () => {
    await act(() => useTheme.getState().load());
    render(<AppearanceSection />);
    const darkGroup = within(screen.getByRole("radiogroup", { name: "Theme in dark mode" }));
    expect(darkGroup.getByRole("radio", { name: "Sanctum Dark" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radiogroup", { name: "Theme in light mode" })).toBeInTheDocument();

    fireEvent.pointerEnter(darkGroup.getByRole("radio", { name: "Nord" }));
    expect(shown()).toBe("nord");
    fireEvent.pointerLeave(darkGroup.getByRole("radio", { name: "Nord" }));
    expect(shown()).not.toBe("nord");

    await act(async () => fireEvent.click(darkGroup.getByRole("radio", { name: "Tokyo Night" })));
    expect(useTheme.getState().prefs.dark).toBe("tokyo-night");
    expect(darkGroup.getByRole("radio", { name: "Tokyo Night" })).toHaveAttribute("aria-checked", "true");

    // Not following: one list of every theme.
    await act(async () => fireEvent.click(screen.getByRole("switch", { name: "Follow Windows" })));
    expect(within(screen.getByRole("radiogroup", { name: "Theme" })).getAllByRole("radio")).toHaveLength(13);
  });
});
