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
const openTab = (name: string) => act(async () => fireEvent.click(screen.getByRole("tab", { name })));

beforeEach(() => {
  resetMockBackend();
  useStore.setState(initial, true);
});

describe("Setup overview", () => {
  it("lists profiles with their work types and length, in tabs", async () => {
    await renderSetup();
    expect(screen.getByRole("tab", { name: "Profiles" })).toHaveAttribute("aria-selected", "true");
    const list = screen.getByRole("region", { name: "Profiles" });
    const row = within(list).getByRole("button", { name: /Interview Prep/ });
    expect(row).toHaveTextContent("DSA practice");
    expect(row).toHaveTextContent("60 min");
    expect(screen.getByText("What each kind of work opens, and how long it runs.")).toBeInTheDocument();
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
    await openTab("General");
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

  it("changes the default duration, adds URLs, and rejects junk", async () => {
    const p = await openDeepWork();
    await act(async () => fireEvent.change(screen.getByLabelText("Default duration"), { target: { value: "120" } }));
    expect(useStore.getState().profiles.find((x) => x.id === p.id)!.defaultMinutes).toBe(120);
    const url = screen.getByLabelText("Add a URL");
    fireEvent.change(url, { target: { value: "docs.rs" } });
    await act(async () => fireEvent.keyDown(url, { key: "Enter" }));
    expect(within(screen.getByRole("region", { name: "Opens" })).getByText("docs.rs")).toBeInTheDocument();
    expect(url).toHaveValue("");
    fireEvent.change(url, { target: { value: "not a url" } });
    await act(async () => fireEvent.keyDown(url, { key: "Enter" }));
    expect(screen.getByRole("status")).toHaveTextContent("not a url is not a URL.");
    expect(screen.queryByRole("switch", { name: "Allowlist mode" })).toBeNull();
  });

  it("points seals to the one Distractions list", async () => {
    await native.addDistraction({ kind: "app", value: "discord.exe", label: "Discord" });
    await native.addDistraction({ kind: "site", value: "youtube.com" });
    await act(() => useStore.getState().loadDistractions());
    await openDeepWork();
    const seals = within(screen.getByRole("region", { name: "Seals" }));
    expect(seals.getByText("1 apps · 1 sites · 0 keywords")).toBeInTheDocument();
    expect(seals.getByText("Discord, youtube.com")).toBeInTheDocument();
    await act(async () => fireEvent.click(seals.getByRole("button", { name: "Edit distractions" })));
    expect(useStore.getState().setupTab).toBe("distractions");
    expect(screen.getByRole("region", { name: "Apps" })).toHaveTextContent("Discord");
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

  it("adds an app to open from the installed-app picker", async () => {
    await openDeepWork();
    const opens = screen.getByRole("region", { name: "Opens" });
    fireEvent.click(within(opens).getByRole("button", { name: "Add app" }));
    const dialog = await screen.findByRole("dialog", { name: "Add an app to open" });
    // VS Code already opens with this profile.
    expect(await within(dialog).findByRole("option", { name: /Visual Studio Code/ })).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("Search apps"), { target: { value: "spot" } });
    await act(async () => fireEvent.click(within(dialog).getByRole("option", { name: /Spotify/ })));
    expect(within(dialog).getByRole("option", { name: /Spotify/ })).toBeDisabled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Done" }));
    expect(within(opens).getByText("spotify.exe")).toBeInTheDocument();
  });

  it("groups the picker into Running now and All apps", async () => {
    await openDeepWork();
    fireEvent.click(within(screen.getByRole("region", { name: "Opens" })).getByRole("button", { name: "Add app" }));
    const dialog = await screen.findByRole("dialog", { name: "Add an app to open" });
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

describe("Distractions", () => {
  async function openDistractions() {
    await renderSetup(false);
    await openTab("Distractions");
  }

  it("flags sites, links, and keywords from one field, and apps from the picker", async () => {
    await openDistractions();
    const field = screen.getByLabelText("Flag a site, link, or keyword");
    fireEvent.change(field, { target: { value: "https://www.twitch.tv/" } });
    expect(screen.getByText("Site or link ↵")).toBeInTheDocument();
    await act(async () => fireEvent.keyDown(field, { key: "Enter" }));
    fireEvent.change(field, { target: { value: "reddit.com/r/all" } });
    await act(async () => fireEvent.keyDown(field, { key: "Enter" }));
    fireEvent.change(field, { target: { value: "Shorts" } });
    expect(screen.getByText("Keyword ↵")).toBeInTheDocument();
    await act(async () => fireEvent.keyDown(field, { key: "Enter" }));
    expect(field).toHaveValue("");
    const sites = within(screen.getByRole("region", { name: "Sites and links" }));
    expect(sites.getByText("twitch.tv")).toBeInTheDocument();
    expect(sites.getByText("reddit.com/r/all")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Keywords" })).getByText("shorts")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Add an app" }));
    const dialog = await screen.findByRole("dialog", { name: "Flag an app" });
    await act(async () => fireEvent.click(await within(dialog).findByRole("option", { name: /Steam/ })));
    fireEvent.click(within(dialog).getByRole("button", { name: "Done" }));
    expect(within(screen.getByRole("region", { name: "Apps" })).getByText("Steam")).toBeInTheDocument();
    expect(useStore.getState().distractions.map((d) => `${d.kind}:${d.value}`)).toEqual([
      "app:steam.exe",
      "keyword:shorts",
      "site:reddit.com/r/all",
      "site:twitch.tv",
    ]);
  });

  it("flags from your week and from common distractions", async () => {
    await openDistractions();
    const week = within(await screen.findByRole("region", { name: "From your week" }));
    expect(week.getByText("League of Legends")).toBeInTheDocument();
    expect(week.getByText("3h 4m")).toBeInTheDocument();
    await act(async () => fireEvent.click(week.getByRole("button", { name: "Flag League of Legends" })));
    expect(within(screen.getByRole("region", { name: "Apps" })).getByText("League of Legends")).toBeInTheDocument();
    await waitFor(() => expect(week.queryByText("League of Legends")).toBeNull());

    const common = within(screen.getByRole("region", { name: "Common distractions" }));
    await act(async () => fireEvent.click(common.getByRole("button", { name: "Flag YouTube" })));
    expect(within(screen.getByRole("region", { name: "Sites and links" })).getByText("YouTube")).toBeInTheDocument();
  });

  it("keeps pages under a flagged site open, and unflags", async () => {
    await native.addDistraction({ kind: "site", value: "youtube.com" });
    await act(() => useStore.getState().loadDistractions());
    await openDistractions();
    fireEvent.click(screen.getByRole("button", { name: "Allow a page on youtube.com" }));
    const input = screen.getByLabelText("Page on youtube.com to allow");
    fireEvent.change(input, { target: { value: "twitch.tv/x" } });
    await act(async () => fireEvent.keyDown(input, { key: "Enter" }));
    expect(screen.getByRole("status")).toHaveTextContent("twitch.tv/x is not a page on youtube.com.");
    fireEvent.change(input, { target: { value: "https://www.youtube.com/@mitocw" } });
    await act(async () => fireEvent.keyDown(input, { key: "Enter" }));
    expect(screen.getByText("youtube.com/@mitocw")).toBeInTheDocument();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Stop allowing youtube.com/@mitocw" })));
    expect(screen.queryByText("youtube.com/@mitocw")).toBeNull();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Unflag youtube.com" })));
    expect(useStore.getState().distractions).toEqual([]);
  });

  it("lets you add but not remove while sealed", async () => {
    await native.addDistraction({ kind: "app", value: "discord.exe", label: "Discord" });
    await act(() => useStore.getState().loadDistractions());
    await openDistractions();
    act(() => useStore.getState().setAppState("sealed"));
    expect(screen.getByText(/Removing waits until the seal ends/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Unflag Discord" })).toBeDisabled();
    const field = screen.getByLabelText("Flag a site, link, or keyword");
    fireEvent.change(field, { target: { value: "reddit.com" } });
    await act(async () => fireEvent.keyDown(field, { key: "Enter" }));
    expect(useStore.getState().distractions).toHaveLength(2);
  });
});

describe("Account", () => {
  it("signs in, invites a partner, and asks to remove them", async () => {
    await renderSetup(false);
    await openTab("Connections");
    const account = within(await screen.findByRole("region", { name: "Account" }));
    expect(account.getByText(/Optional. An account lets a friend/)).toBeInTheDocument();
    fireEvent.change(account.getByLabelText("Email for a sign-in link"), { target: { value: "me@example.com" } });
    await act(async () => fireEvent.click(account.getByRole("button", { name: "Email me a link" })));
    expect(await account.findByText("Signed in as me@example.com")).toBeInTheDocument();

    await act(async () => fireEvent.click(account.getByRole("button", { name: "Invite a partner" })));
    expect(account.getByTestId("invite-link")).toHaveTextContent("/invite/");
    expect(account.getByText(/Expires in 48 hours/)).toBeInTheDocument();

    await act(async () => mockControls.partnerJoins("alex@example.com", "Alex"));
    expect(await account.findByText("Partner: Alex")).toBeInTheDocument();
    await act(async () => fireEvent.click(account.getByRole("button", { name: "Ask to remove" })));
    expect(account.getByText("Waiting for Alex to release you")).toBeInTheDocument();
    await act(async () => fireEvent.click(account.getByRole("button", { name: "Keep partner" })));
    expect(account.getByText("Partner: Alex")).toBeInTheDocument();

    await act(async () => fireEvent.click(account.getByRole("button", { name: "Sign out" })));
    expect(await account.findByRole("button", { name: "Continue with Google" })).toBeInTheDocument();
  });
});

describe("Streak settings", () => {
  it("saves the daily goal and rest days", async () => {
    await act(() => useStore.getState().loadSettings());
    await renderSetup(false);
    await openTab("General");
    fireEvent.change(screen.getByLabelText("Daily focus goal"), { target: { value: "90" } });
    const rest = within(screen.getByRole("group", { name: "Rest days" }));
    fireEvent.click(rest.getByRole("button", { name: "Sat" }));
    fireEvent.click(rest.getByRole("button", { name: "Sun" }));
    expect(rest.getByRole("button", { name: "Sat" })).toHaveAttribute("aria-pressed", "true");
    await waitFor(async () => expect(await native.getSetting("rest_days_mask")).toBe(String((1 << 6) | 1)));
    expect(await native.getSetting("daily_goal_min")).toBe("90");
  });
});

describe("Browser extension", () => {
  it("shows setup steps until a browser connects, then its status", async () => {
    await renderSetup(false);
    await openTab("Connections");
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
