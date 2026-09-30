import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Setup } from "./Setup";
import { Toast } from "../components/Toast";
import { launchNotice, useStore } from "../state/store";
import { mockControls, resetMockBackend } from "../lib/mockBackend";
import { native } from "../lib/native";
import { sampleProfiles } from "../lib/catalog";

const initial = useStore.getState();

async function renderSetup(seed = true) {
  if (seed) for (const d of sampleProfiles()) await native.createProfile(d);
  await act(() => useStore.getState().loadProfiles());
  return render(
    <>
      <Setup />
      <Toast />
    </>,
  );
}

const profile = (name: string) => useStore.getState().profiles.find((p) => p.name === name)!;

beforeEach(() => {
  resetMockBackend();
  useStore.setState(initial, true);
});

describe("Setup overview", () => {
  it("lists profiles with their work types and seal counts", async () => {
    await renderSetup();
    const list = screen.getByRole("region", { name: "Profiles" });
    const row = within(list).getByRole("button", { name: /Interview Prep/ });
    expect(row).toHaveTextContent("DSA practice");
    expect(row).toHaveTextContent(`seals ${profile("Interview Prep").rules.filter((r) => ["app", "domain", "title"].includes(r.kind)).length}`);
  });

  it("shows an empty state without profiles", async () => {
    await renderSetup(false);
    expect(screen.getByText("No profiles yet. Onboarding sets them up, or create one now.")).toBeInTheDocument();
  });

  it("New profile creates one and opens it", async () => {
    await renderSetup(false);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "New profile" })));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("New profile");
    expect(screen.getByLabelText("Profile name")).toHaveValue("New profile");
  });

  it("saves preferences", async () => {
    await renderSetup(false);
    fireEvent.change(screen.getByLabelText("On login"), { target: { value: "tray" } });
    fireEvent.change(screen.getByLabelText("Close button"), { target: { value: "tray" } });
    fireEvent.click(screen.getByRole("switch", { name: "Go compact when focus starts" }));
    await waitFor(async () => expect(await native.getSetting("on_login")).toBe("tray"));
    expect(await native.getSetting("close_action")).toBe("tray");
    expect(await native.getSetting("compact_on_focus")).toBe("1");
  });
});

describe("Profile detail", () => {
  async function openDeepWork() {
    await renderSetup();
    fireEvent.click(screen.getByRole("button", { name: /Deep Work/ }));
    return profile("Deep Work");
  }

  it("renames, with a notice when the name is taken", async () => {
    await openDeepWork();
    const name = screen.getByLabelText("Profile name");
    fireEvent.change(name, { target: { value: "Study" } });
    await act(async () => fireEvent.blur(name));
    expect(screen.getByRole("status")).toHaveTextContent("Another profile is already named Study.");
    expect(name).toHaveValue("Deep Work");

    fireEvent.change(name, { target: { value: "Deep Code" } });
    await act(async () => fireEvent.blur(name));
    expect(profile("Deep Code")).toBeTruthy();
  });

  it("changes the default duration and allowlist mode", async () => {
    const p = await openDeepWork();
    await act(async () => fireEvent.change(screen.getByLabelText("Default duration"), { target: { value: "120" } }));
    await act(async () => fireEvent.click(screen.getByRole("switch", { name: "Allowlist mode" })));
    const after = useStore.getState().profiles.find((x) => x.id === p.id)!;
    expect(after.defaultMinutes).toBe(120);
    expect(after.allowlistMode).toBe(true);
    expect(screen.getByText(/Allowlist mode is on/)).toBeInTheDocument();
  });

  it("adds URLs, sites, and title keywords, and rejects junk", async () => {
    await openDeepWork();
    const url = screen.getByLabelText("Add a URL");
    fireEvent.change(url, { target: { value: "docs.rs" } });
    await act(async () => fireEvent.keyDown(url, { key: "Enter" }));
    expect(within(screen.getByRole("region", { name: "Opens" })).getByText("docs.rs")).toBeInTheDocument();
    expect(url).toHaveValue("");

    fireEvent.change(url, { target: { value: "not a url" } });
    await act(async () => fireEvent.keyDown(url, { key: "Enter" }));
    expect(screen.getByRole("status")).toHaveTextContent("not a url is not a URL.");

    const seal = screen.getByLabelText("Add a site or a title keyword");
    fireEvent.change(seal, { target: { value: "https://www.twitch.tv/" } });
    await act(async () => fireEvent.keyDown(seal, { key: "Enter" }));
    fireEvent.change(seal, { target: { value: "Shorts" } });
    await act(async () => fireEvent.keyDown(seal, { key: "Enter" }));
    const seals = within(screen.getByRole("region", { name: "Seals" }));
    expect(seals.getByText("twitch.tv")).toBeInTheDocument();
    expect(seals.getByText("Title keyword")).toBeInTheDocument();
  });

  it("keeps pages under a sealed site open", async () => {
    await openDeepWork();
    const seal = screen.getByLabelText("Add a site or a title keyword");
    fireEvent.change(seal, { target: { value: "youtube.com" } });
    await act(async () => fireEvent.keyDown(seal, { key: "Enter" }));
    fireEvent.click(screen.getByRole("button", { name: "Allow a page on youtube.com" }));
    const input = screen.getByLabelText("Page on youtube.com to allow");
    fireEvent.change(input, { target: { value: "twitch.tv/x" } });
    await act(async () => fireEvent.keyDown(input, { key: "Enter" }));
    expect(screen.getByRole("status")).toHaveTextContent("twitch.tv/x is not a page on youtube.com.");

    fireEvent.change(input, { target: { value: "https://www.youtube.com/@mitocw" } });
    await act(async () => fireEvent.keyDown(input, { key: "Enter" }));
    expect(screen.getByText("youtube.com/@mitocw")).toBeInTheDocument();
    expect(screen.queryByLabelText("Page on youtube.com to allow")).toBeNull();

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Stop allowing youtube.com/@mitocw" })));
    expect(screen.queryByText("youtube.com/@mitocw")).toBeNull();
  });

  it("marks apps that aren't installed and shows a lettered tile for them", async () => {
    const p = await openDeepWork();
    await act(async () => void (await useStore.getState().addRule(p.id, { kind: "launch_app", value: "cursor.exe", label: "Cursor" })));
    const opens = within(screen.getByRole("region", { name: "Opens" }));
    expect(await opens.findByText("cursor.exe · not installed")).toBeInTheDocument();
    // VS Code is installed in the mock, so it isn't marked.
    expect(opens.getByText("code.exe")).toBeInTheDocument();
    const tiles = opens.getAllByTestId("app-icon-fallback").map((t) => t.textContent);
    expect(tiles).toContain("C");
  });

  it("removes a rule", async () => {
    await openDeepWork();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Remove GitHub" })));
    expect(within(screen.getByRole("region", { name: "Opens" })).queryByText("GitHub")).toBeNull();
  });

  it("adds an app from the installed-app picker", async () => {
    await openDeepWork();
    const seals = screen.getByRole("region", { name: "Seals" });
    fireEvent.click(within(seals).getByRole("button", { name: "Add app" }));
    const dialog = await screen.findByRole("dialog", { name: "Add an app to seal" });
    // Discord is already sealed by the sample profile.
    expect(await within(dialog).findByRole("option", { name: /Discord/ })).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("Search apps"), { target: { value: "spot" } });
    await act(async () => fireEvent.click(within(dialog).getByRole("option", { name: /Spotify/ })));
    expect(within(dialog).getByRole("option", { name: /Spotify/ })).toBeDisabled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Done" }));
    expect(within(seals).getByText("spotify.exe")).toBeInTheDocument();
  });

  it("groups the picker into Running now and All apps", async () => {
    await openDeepWork();
    fireEvent.click(within(screen.getByRole("region", { name: "Seals" })).getByRole("button", { name: "Add app" }));
    const dialog = await screen.findByRole("dialog", { name: "Add an app to seal" });
    const running = await within(dialog).findByRole("group", { name: "Running now" });
    // A game started by its launcher shows up under its real exe.
    expect(within(running).getByRole("option", { name: /League of Legends/ })).toHaveTextContent("leagueclient.exe");
    expect(within(within(dialog).getByRole("group", { name: "All apps" })).getByRole("option", { name: /Zoom/ })).toBeInTheDocument();
    // Searching flattens the groups but keeps running apps first.
    fireEvent.change(within(dialog).getByLabelText("Search apps"), { target: { value: "zoom" } });
    expect(within(dialog).queryByRole("group", { name: "Running now" })).toBeNull();
    expect(within(dialog).getAllByRole("option")).toHaveLength(1);
  });

  it("deletes after confirming", async () => {
    const p = await openDeepWork();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = screen.getByRole("dialog", { name: "Delete Deep Work" });
    await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "Delete" })));
    expect(useStore.getState().profiles.some((x) => x.id === p.id)).toBe(false);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Setup");
  });

  it("refuses profile edits while sealed", async () => {
    const p = await openDeepWork();
    act(() => useStore.getState().setAppState("sealed"));
    await act(async () => void (await useStore.getState().updateProfile(p.id, { defaultMinutes: 30 })));
    expect(profile("Deep Work").defaultMinutes).toBe(90);
    expect(useStore.getState().notice?.lead).toBe("Profiles are locked while you're sealed.");
  });
});

describe("Streak settings", () => {
  it("saves the daily goal and rest days", async () => {
    await act(() => useStore.getState().loadSettings());
    await renderSetup(false);
    fireEvent.change(screen.getByLabelText("Daily focus goal"), { target: { value: "90" } });
    const rest = within(screen.getByRole("group", { name: "Rest days" }));
    fireEvent.click(rest.getByRole("button", { name: "Sat" }));
    fireEvent.click(rest.getByRole("button", { name: "Sun" }));
    expect(rest.getByRole("button", { name: "Sat" })).toHaveAttribute("aria-pressed", "true");
    await waitFor(async () => expect(await native.getSetting("rest_days_mask")).toBe(String((1 << 6) | 1)));
    expect(await native.getSetting("daily_goal_min")).toBe("90");
  });
});

describe("Always open", () => {
  it("starts with the essentials and saves removals", async () => {
    await act(() => useStore.getState().loadSettings());
    await renderSetup(false);
    const prefs = within(screen.getByRole("region", { name: "Preferences" }));
    expect(prefs.getByText("spotify.exe")).toBeInTheDocument();
    expect(prefs.getByText("comet.exe")).toBeInTheDocument();
    fireEvent.click(prefs.getByRole("button", { name: "Remove spotify.exe from Always open" }));
    expect(prefs.queryByText("spotify.exe")).toBeNull();
    await waitFor(async () => expect(await native.getSetting("allowlist_always_allowed")).not.toContain("spotify.exe"));
    expect(await native.getSetting("allowlist_always_allowed")).toContain("claude.exe");
  });
});

describe("Browser extension", () => {
  it("shows setup steps until a browser connects, then its status", async () => {
    await renderSetup(false);
    const section = within(await screen.findByRole("region", { name: "Browser extension" }));
    expect(section.getByText("Comet")).toBeInTheDocument();
    expect(section.queryByText("Edge")).toBeNull(); // not installed
    expect(section.getAllByText("Extension not loaded.")).toHaveLength(2);
    expect(section.getByTestId("extension-dir")).toHaveTextContent("extension");

    await act(async () => mockControls.extension("comet.exe", { connected: true, incognito: false }));
    expect(await section.findByText(/Not allowed in private windows/)).toBeInTheDocument();
    expect(section.queryByTestId("extension-dir")).toBeNull();
    fireEvent.click(section.getByRole("button", { name: "Load in another browser" }));
    expect(section.getByTestId("extension-dir")).toBeInTheDocument();

    await act(async () => mockControls.extension("comet.exe", { incognito: true }));
    expect(await section.findByText("v0.1.0 · Seals sites and keywords")).toBeInTheDocument();
    await act(async () => mockControls.extension("comet.exe", { connected: false, missing: true }));
    expect(await section.findByText(/Its windows stay minimized/)).toBeInTheDocument();
  });
});

describe("launch notice", () => {
  it("summarizes a launch report", () => {
    expect(launchNotice({ opened: ["LeetCode"], focused: ["VS Code"], missing: ["Zoom"], failed: [] })).toEqual({
      lead: "Opened LeetCode.",
      rest: "Focused VS Code. Zoom is not installed.",
    });
    expect(launchNotice({ opened: [], focused: ["VS Code"], missing: [], failed: [] })).toEqual({ lead: "Focused VS Code.", rest: undefined });
    expect(launchNotice({ opened: [], focused: [], missing: [], failed: [] }).lead).toBe("Nothing to open.");
  });
});
