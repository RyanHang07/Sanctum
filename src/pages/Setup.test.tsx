import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Setup } from "./Setup";
import { Toast } from "../components/Toast";
import { launchNotice, useStore } from "../state/store";
import { mockControls, resetMockBackend } from "../lib/mockBackend";
import { native } from "../lib/native";
import { sampleProfiles } from "../lib/catalog";
import { GOAL_MINUTES } from "./setup/options";
import { minutes } from "../lib/time";

const initial = useStore.getState();

async function renderSetup(seed = true) {
  if (seed) for (const d of sampleProfiles()) await native.createProfile(d);
  await act(() => useStore.getState().loadProfiles());
  const view = render(
    <>
      <Setup />
      <Toast />
    </>,
  );
  // The side list's status reads (protection, browser, partner, calendar) land inside act.
  await act(async () => void (await new Promise((r) => setTimeout(r, 0))));
  return view;
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
    expect(screen.getByText("What each kind of work opens.")).toBeInTheDocument();
  });

  it("shows one section at a time from the list, each saying what it's for", async () => {
    await renderSetup(false);
    const expected: [string, string, string][] = [
      ["Goals", "Your daily goal and streak.", "Goal and streak"],
      ["App Guard", "Blocks sites and reopens Sanctum.", "Protection"],
      ["Browser Extension", "Seals sites and tabs.", "Browser Extension"],
      ["Partner", "A friend who holds the key.", "Account"],
      ["Calendar", "Two-way sync with Google Calendar.", "Google Calendar"],
      ["Sound and Alerts", "Sounds and notifications.", "Do not disturb"],
      ["Behavior", "How Sanctum starts and closes.", "About"],
      ["Your Data", "Export, back up, or erase.", "Danger Zone"],
    ];
    for (const [tab, blurb, region] of expected) {
      await openTab(tab);
      expect(screen.getByRole("tab", { name: tab })).toHaveAttribute("aria-selected", "true");
      const panel = within(screen.getByRole("tabpanel", { name: tab }));
      expect(panel.getAllByRole("heading", { level: 2, name: tab })[0]).toBeInTheDocument();
      expect(panel.getByText(blurb)).toBeInTheDocument();
      expect(await panel.findByRole("region", { name: region })).toBeInTheDocument();
    }
    // Distractions no longer carries Protection.
    await openTab("Distractions");
    expect(screen.queryByRole("region", { name: "Protection" })).toBeNull();
  });

  it("shows an empty state without profiles", async () => {
    await renderSetup(false);
    expect(screen.getByText("No profiles yet.")).toBeInTheDocument();
  });

  it("New profile creates one and opens it", async () => {
    await renderSetup(false);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "New profile" })));
    // It opens inside Setup's column, the name as the section heading.
    expect(await screen.findByRole("heading", { level: 2, name: "New profile" })).toBeInTheDocument();
    expect(screen.getByLabelText("Profile name")).toHaveValue("New profile");
  });

  it("saves preferences", async () => {
    await renderSetup(false);
    await openTab("Behavior");
    // On login says Today, the screen's name.
    expect(within(screen.getByLabelText("On login")).getByRole("option", { name: "Open Today" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("On login"), { target: { value: "tray" } });
    fireEvent.change(screen.getByLabelText("Close button"), { target: { value: "tray" } });
    fireEvent.click(screen.getByRole("switch", { name: "Go compact when focus starts" }));
    await waitFor(async () => expect(await native.getSetting("on_login")).toBe("tray"));
    expect(await native.getSetting("close_action")).toBe("tray");
    expect(await native.getSetting("compact_on_focus")).toBe("1");
  });

  it("updates the day reset time from Goals", async () => {
    await renderSetup(false);
    await openTab("Goals");
    const field = screen.getByLabelText("Day resets at");
    fireEvent.change(field, { target: { value: "05:30" } });
    await act(async () => fireEvent.blur(field));
    await waitFor(async () => expect(await native.getSetting("daily_reset_time")).toBe("05:30"));
  });
});

describe("Profile detail", () => {
  async function openDeepWork() {
    await renderSetup();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /Deep Work/ })));
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
    expect(seals.getByText("1 app · 1 site · 0 keywords")).toBeInTheDocument();
    expect(seals.getByText("Discord, youtube.com")).toBeInTheDocument();
    await act(async () => fireEvent.click(seals.getByRole("button", { name: "Edit distractions" })));
    expect(useStore.getState().setupTab).toBe("distractions");
    expect(screen.getByRole("region", { name: "What Sanctum blocks" })).toHaveTextContent("Discord");
  });

  it("names each seal once, and the Add a URL field has no stray key mark", async () => {
    await native.addDistraction({ kind: "app", value: "discord.exe", label: "Discord" });
    await native.addDistraction({ kind: "site", value: "discord.com", label: "Discord" });
    await act(() => useStore.getState().loadDistractions());
    await openDeepWork();
    const seals = within(screen.getByRole("region", { name: "Seals" }));
    expect(seals.getByTestId("seal-names")).toHaveTextContent(/^Discord$/);
    const opens = screen.getByRole("region", { name: "Opens" });
    expect(opens).not.toHaveTextContent("↵");
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
    // A confirm before something that can't be undone: an alertdialog with a declarative title.
    const dialog = screen.getByRole("alertdialog", { name: "Delete Deep Work" });
    expect(within(dialog).getByRole("heading", { level: 1 })).toHaveTextContent("This deletes Deep Work.");
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
  const blocks = () => within(screen.getByRole("region", { name: "What Sanctum blocks" }));
  const rows = () => screen.queryAllByTestId("distraction-row").map((r) => r.textContent);

  it("adds sites, links, keywords and apps from one field, and apps from the picker, into one list", async () => {
    await openDistractions();
    const field = screen.getByLabelText("Add an app, site, link or keyword");
    fireEvent.change(field, { target: { value: "https://www.twitch.tv/" } });
    expect(screen.getByText("Site or link ↵")).toBeInTheDocument();
    await act(async () => fireEvent.keyDown(field, { key: "Enter" }));
    fireEvent.change(field, { target: { value: "reddit.com/r/all" } });
    await act(async () => fireEvent.keyDown(field, { key: "Enter" }));
    fireEvent.change(field, { target: { value: "Shorts" } });
    expect(screen.getByText("Keyword ↵")).toBeInTheDocument();
    await act(async () => fireEvent.keyDown(field, { key: "Enter" }));
    fireEvent.change(field, { target: { value: "discord.exe" } });
    expect(screen.getByText("App ↵")).toBeInTheDocument();
    await act(async () => fireEvent.keyDown(field, { key: "Enter" }));
    expect(field).toHaveValue("");

    fireEvent.click(screen.getByRole("button", { name: "Pick an app" }));
    const dialog = await screen.findByRole("dialog", { name: "Add an app" });
    await act(async () => fireEvent.click(await within(dialog).findByRole("option", { name: /Steam/ })));
    fireEvent.click(within(dialog).getByRole("button", { name: "Done" }));

    // One list, each row tagged with its kind and its detail.
    expect(rows()).toEqual(["AppDiscorddiscord.exe", "AppSteamsteam.exe", "Keywordshortsin any title", "Sitereddit.com/r/allAllow a page", "Sitetwitch.tvAllow a page"]);
    expect(useStore.getState().distractions.map((d) => `${d.kind}:${d.value}`)).toEqual([
      "app:discord.exe",
      "app:steam.exe",
      "keyword:shorts",
      "site:reddit.com/r/all",
      "site:twitch.tv",
    ]);
  });

  it("filters the list by kind, with counts", async () => {
    await native.addDistraction({ kind: "app", value: "discord.exe", label: "Discord" });
    await native.addDistraction({ kind: "site", value: "youtube.com" });
    await native.addDistraction({ kind: "site", value: "x.com" });
    await act(() => useStore.getState().loadDistractions());
    await openDistractions();
    const filter = within(blocks().getByRole("group", { name: "Show" }));
    expect(filter.getByRole("button", { name: "All 3" })).toHaveAttribute("aria-pressed", "true");
    await act(async () => fireEvent.click(filter.getByRole("button", { name: "Sites 2" })));
    expect(rows()).toEqual(["Sitex.comAllow a page", "Siteyoutube.comAllow a page"]);
    await act(async () => fireEvent.click(filter.getByRole("button", { name: "Apps 1" })));
    expect(rows()).toEqual(["AppDiscorddiscord.exe"]);
    await act(async () => fireEvent.click(filter.getByRole("button", { name: "Keywords 0" })));
    expect(rows()).toEqual([]);
    expect(blocks().getByText(/Keywords block any window or tab/)).toBeInTheDocument();
  });

  it("suggests from your week first, then common distractions, in one row of chips", async () => {
    await openDistractions();
    const suggested = within(await screen.findByRole("group", { name: "Suggested" }));
    const chips = suggested.getAllByTestId("suggestion").map((c) => c.textContent);
    expect(chips.slice(0, 3)).toEqual(["League of Legends3h 4m last week", "reddit.com1h 36m last week", "Spotify41m last week"]);
    await act(async () => fireEvent.click(suggested.getByRole("button", { name: "Add League of Legends" })));
    expect(blocks().getByText("League of Legends")).toBeInTheDocument();
    await waitFor(() => expect(suggested.queryByRole("button", { name: "Add League of Legends" })).toBeNull());

    // A common distraction adds everything it covers.
    await act(async () => fireEvent.click(suggested.getByRole("button", { name: "Add YouTube" })));
    expect(blocks().getAllByText("YouTube").length).toBeGreaterThan(0);
    expect(useStore.getState().distractions.some((d) => d.kind === "site" && d.value === "youtube.com")).toBe(true);
  });

  it("dismisses a suggestion and remembers it", async () => {
    await openDistractions();
    const suggested = within(await screen.findByRole("group", { name: "Suggested" }));
    await act(async () => fireEvent.click(suggested.getByRole("button", { name: "Dismiss Spotify" })));
    expect(suggested.queryByRole("button", { name: "Add Spotify" })).toBeNull();
    await waitFor(async () => expect(JSON.parse((await native.getSetting("distraction_suggestions_dismissed"))!)).toMatchObject({ "app:spotify.exe": { minutes: 41 } }));
  });

  it("keeps a suggestion dismissed three days ago away no longer", async () => {
    const old = Date.now() - 3 * 24 * 60 * 60_000 - 1000;
    const recent = Date.now() - 60_000;
    await native.setSetting(
      "distraction_suggestions_dismissed",
      JSON.stringify({ "app:spotify.exe": { at: old, minutes: 41 }, "app:leagueclient.exe": { at: recent, minutes: 184 } }),
    );
    await openDistractions();
    const suggested = within(await screen.findByRole("group", { name: "Suggested" }));
    expect(suggested.getByRole("button", { name: "Add Spotify" })).toBeInTheDocument();
    expect(suggested.queryByRole("button", { name: "Add League of Legends" })).toBeNull();
  });

  it("keeps pages under a flagged site open, and removes", async () => {
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
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Remove youtube.com" })));
    expect(useStore.getState().distractions).toEqual([]);
  });

  it("lets you add but not remove while sealed", async () => {
    await native.addDistraction({ kind: "app", value: "discord.exe", label: "Discord" });
    await act(() => useStore.getState().loadDistractions());
    await openDistractions();
    act(() => useStore.getState().setAppState("sealed"));
    expect(screen.getByText(/Removing waits until the seal ends/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove Discord" })).toBeDisabled();
    const field = screen.getByLabelText("Add an app, site, link or keyword");
    fireEvent.change(field, { target: { value: "reddit.com" } });
    await act(async () => fireEvent.keyDown(field, { key: "Enter" }));
    expect(useStore.getState().distractions).toHaveLength(2);
  });

  it("says when it blocks: always in focus sessions, quiet hours and pause open to edit", async () => {
    await act(() => useStore.getState().loadQuiet());
    await openDistractions();
    const when = within(screen.getByRole("region", { name: "When it blocks" }));
    const focus = within(when.getByRole("region", { name: "During focus sessions" }));
    expect(focus.getByText("Always")).toBeInTheDocument();
    expect(focus.queryByRole("switch")).toBeNull();

    const quiet = within(when.getByRole("region", { name: "Quiet hours" }));
    expect(quiet.getByTestId("quiet-status")).toHaveTextContent("Off");
    expect(quiet.queryByRole("group", { name: "Quiet days" })).toBeNull();
    const toggle = quiet.getByRole("button", { name: /Quiet hours/, expanded: false });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(quiet.getByRole("group", { name: "Quiet days" })).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(quiet.queryByRole("group", { name: "Quiet days" })).toBeNull();

    const pause = within(await when.findByRole("region", { name: "Pause before opening" }));
    expect(pause.getByTestId("pause-status")).toHaveTextContent("Off");
    await act(async () => fireEvent.click(pause.getByRole("switch", { name: "Pause before opening" })));
    // Turning it on opens it, to pick all day or set hours.
    expect(pause.getByRole("group", { name: "Pause mode" })).toBeInTheDocument();
    expect(pause.getByTestId("pause-status")).toHaveTextContent("All day · Asking first right now");
  });
});

describe("Setup's list", () => {
  it("is one vertical tablist: one Tab stop, arrows, Home and End, each tab controlling the panel", async () => {
    await renderSetup(false);
    const tabs = screen.getAllByRole("tab");
    const panel = screen.getByRole("tabpanel");
    expect(tabs.filter((t) => t.tabIndex === 0)).toEqual([screen.getByRole("tab", { name: "Profiles" })]);
    for (const t of tabs) expect(t).toHaveAttribute("aria-controls", panel.id);
    // The group headers sit outside the tab semantics.
    const list = screen.getByRole("tablist", { name: "Setup" });
    for (const h of Array.from(list.querySelectorAll(".label"))) expect(h).toHaveAttribute("role", "presentation");

    const key = (k: string) => act(async () => fireEvent.keyDown(document.activeElement!, { key: k }));
    tabs[0]!.focus();
    await key("ArrowDown");
    expect(screen.getByRole("tab", { name: "Distractions" })).toHaveAttribute("aria-selected", "true");
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Distractions" }));
    expect(screen.getByRole("tab", { name: "Distractions" }).tabIndex).toBe(0);
    expect(screen.getByRole("tab", { name: "Profiles" }).tabIndex).toBe(-1);
    await key("End");
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Your Data" }));
    await key("ArrowDown");
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Profiles" }));
    await key("ArrowUp");
    expect(screen.getByRole("tab", { name: "Your Data" })).toHaveAttribute("aria-selected", "true");
    await key("Home");
    expect(screen.getByRole("tab", { name: "Profiles" })).toHaveAttribute("aria-selected", "true");
  });

  it("narrows the list when the page is about 800px or less", async () => {
    await renderSetup(false);
    const nav = screen.getByRole("navigation", { name: "Setup sections" });
    expect(nav.className).toContain("w-[184px]");
    expect(nav.className).toContain("@max-[800px]/setup:w-[136px]");
    // The query is on Setup's own width (a container), not the window's.
    let el: HTMLElement | null = nav;
    while (el && !el.classList.contains("@container/setup")) el = el.parentElement;
    expect(el).not.toBeNull();
  });

  it("never repeats a section's name as its first box's title, and keeps the box's actions", async () => {
    await act(() => useStore.getState().loadSettings());
    await renderSetup(false);
    for (const [tab, action] of [
      ["Profiles", "New profile"],
      ["Browser Extension", null],
      ["Trackers", "New tracker"],
      ["Behavior", "Run setup again"],
      ["Your Data", "Open folder"],
    ] as const) {
      await openTab(tab);
      const panel = within(screen.getByRole("tabpanel", { name: tab }));
      const box = await panel.findByRole("region", { name: tab });
      expect(panel.getAllByRole("heading", { name: tab })).toHaveLength(1);
      expect(within(box).queryByRole("heading", { name: tab })).toBeNull();
      if (action) expect(within(within(box).getByTestId("section-actions")).getByRole("button", { name: action })).toBeInTheDocument();
    }
  });

  it("groups the sections into Focus, Protection, Tracking, and App, in order", async () => {
    await renderSetup(false);
    const nav = within(screen.getByRole("navigation", { name: "Setup sections" }));
    expect(nav.getAllByRole("tab").map((t) => t.getAttribute("aria-label"))).toEqual([
      "Profiles",
      "Distractions",
      "Goals",
      "App Guard",
      "Browser Extension",
      "Partner",
      "Trackers",
      "Activity",
      "Calendar",
      "Appearance",
      "Sound and Alerts",
      "Behavior",
      "Your Data",
    ]);
    const headers = Array.from(screen.getByRole("navigation", { name: "Setup sections" }).querySelectorAll(".label")).map((h) => h.textContent);
    expect(headers).toEqual(["Focus", "Protection", "Tracking", "App"]);
    // General is gone; its settings live in Goals, Sound and Alerts, Behavior, and Your Data.
    expect(nav.queryByRole("tab", { name: "General" })).toBeNull();
  });

  it("counts the lists beside their names", async () => {
    await renderSetup();
    const profiles = screen.getByRole("tab", { name: "Profiles" });
    expect(within(profiles).getByTestId("nav-count")).toHaveTextContent(String(useStore.getState().profiles.length));
    // No count where there's nothing to count.
    expect(within(screen.getByRole("tab", { name: "Distractions" })).queryByTestId("nav-count")).toBeNull();
  });

  it("puts a dot only on a connection that needs something", async () => {
    await renderSetup(false);
    const browser = screen.getByRole("tab", { name: "Browser Extension" });
    // The extension isn't connected in Comet yet: red (danger), and a description for readers.
    await waitFor(() => expect(browser).toHaveAttribute("data-attention", "true"));
    const dot = browser.querySelector("[data-tone]")!;
    expect(dot).toHaveAttribute("data-tone", "attention");
    expect(dot).toHaveClass("bg-danger");
    expect(browser).toHaveAttribute("aria-description", "Needs attention");
    // Off and fine stay quiet.
    for (const name of ["Profiles", "Partner", "Calendar"]) expect(screen.getByRole("tab", { name }).querySelector("[data-tone]")).toBeNull();
  });
});

describe("General, split", () => {
  it("Goals holds the goal and streak; Behavior holds startup and About; Sound and Alerts holds Do not disturb", async () => {
    await act(() => useStore.getState().loadSettings());
    await renderSetup(false);
    await openTab("Goals");
    let panel = within(screen.getByRole("tabpanel", { name: "Goals" }));
    expect(panel.getByLabelText("Daily focus goal")).toBeInTheDocument();
    // The same goal list first run offers.
    expect(within(panel.getByLabelText("Daily focus goal")).getAllByRole("option").map((o) => o.textContent)).toEqual(GOAL_MINUTES.map(minutes));
    expect(panel.getByRole("group", { name: "Rest days" })).toBeInTheDocument();
    expect(panel.queryByLabelText("On login")).toBeNull();

    await openTab("Behavior");
    panel = within(screen.getByRole("tabpanel", { name: "Behavior" }));
    expect(panel.getByLabelText("On login")).toBeInTheDocument();
    expect(panel.getByRole("button", { name: "Run setup again" })).toBeInTheDocument();
    expect(await panel.findByRole("region", { name: "About" })).toBeInTheDocument();
    expect(panel.queryByRole("region", { name: "Sounds" })).toBeNull();

    await openTab("Sound and Alerts");
    panel = within(screen.getByRole("tabpanel", { name: "Sound and Alerts" }));
    expect(panel.getByRole("region", { name: "Sounds" })).toBeInTheDocument();
    expect(await panel.findByRole("switch", { name: "Do not disturb while sealed" })).toBeInTheDocument();
    expect(panel.queryByRole("region", { name: "Your Data" })).toBeNull();
  });

  it("keeps every hint short and readable", async () => {
    await act(() => useStore.getState().loadSettings());
    await renderSetup(false);
    for (const tab of ["Goals", "Sound and Alerts", "Behavior", "Your Data"]) {
      await openTab(tab);
      const panel = screen.getByRole("tabpanel", { name: tab });
      await waitFor(() => expect(panel.querySelectorAll("section").length).toBeGreaterThan(0));
      expect(panel.innerHTML).not.toMatch(/text-\[1[01]px\]/);
    }
  });

  it("sets one style for every sound, with each sound in a fold", async () => {
    await act(() => useStore.getState().loadSettings());
    await renderSetup(false);
    await openTab("Sound and Alerts");
    const sounds = within(screen.getByRole("region", { name: "Sounds" }));
    // The defaults differ per cue, so no one style is pressed.
    const every = within(sounds.getByRole("group", { name: "Every sound" }));
    expect(every.getAllByRole("button").filter((b) => b.getAttribute("aria-pressed") === "true")).toHaveLength(0);
    expect(sounds.queryByRole("group", { name: "Enter focus sound" })).toBeNull();
    await act(async () => fireEvent.click(every.getByRole("button", { name: "Latch" })));
    expect(Object.values(useStore.getState().settings.soundStyles)).toEqual(Array(6).fill("latch"));
    expect(every.getByRole("button", { name: "Latch" })).toHaveAttribute("aria-pressed", "true");

    const fold = sounds.getByRole("button", { name: "Each sound" });
    expect(fold).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(fold);
    expect(fold).toHaveAttribute("aria-expanded", "true");
    const enter = within(sounds.getByRole("group", { name: "Enter focus sound" }));
    await act(async () => fireEvent.click(enter.getByRole("button", { name: "Deep" })));
    expect(useStore.getState().settings.soundStyles.enter).toBe("deep");
    expect(every.getAllByRole("button").filter((b) => b.getAttribute("aria-pressed") === "true")).toHaveLength(0);
  });
});

describe("Your Data's danger zone", () => {
  it("ends Your Data, with Start over and Delete account together", async () => {
    await native.cloudSignInEmail("me@example.com");
    await renderSetup(false);
    await openTab("Your Data");
    const panel = screen.getByRole("tabpanel", { name: "Your Data" });
    const zone = await within(panel).findByRole("region", { name: "Danger Zone" });
    const sections = Array.from(panel.querySelectorAll("section"));
    expect(sections.at(-1)).toBe(zone);
    expect(sections.map((s) => s.getAttribute("aria-label"))).toEqual(["Your Data", "Danger Zone"]);
    const start = within(zone).getByRole("button", { name: "Start over" });
    const del = await within(zone).findByRole("button", { name: "Delete account" });
    expect(start.compareDocumentPosition(del) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("leaves Delete account out while signed out", async () => {
    await renderSetup(false);
    await openTab("Your Data");
    const zone = within(await screen.findByRole("region", { name: "Danger Zone" }));
    expect(zone.getByRole("button", { name: "Start over" })).toBeInTheDocument();
    await act(async () => undefined);
    expect(zone.queryByRole("button", { name: "Delete account" })).toBeNull();
  });
});

describe("Account", () => {
  it("signs in, invites a partner, and asks to remove them", async () => {
    await renderSetup(false);
    await openTab("Partner");
    const account = within(await screen.findByRole("region", { name: "Account" }));
    expect(account.getByTestId("partner-status")).toHaveTextContent("No partner. Early unlocks need only you.");
    // No partner reads red: the dot and the words (2026-11-20).
    expect(account.getByTestId("partner-status")).toHaveAttribute("data-tone", "attention");
    expect(account.getByText("No partner.")).toHaveClass("text-danger-text");
    expect(account.getByText("Sign in to add a partner")).toBeInTheDocument();
    fireEvent.change(account.getByLabelText("Email for a sign-in link"), { target: { value: "me@example.com" } });
    await act(async () => fireEvent.click(account.getByRole("button", { name: "Email me a link" })));
    expect(await account.findByText("Signed in as me@example.com")).toBeInTheDocument();

    await act(async () => fireEvent.click(within(account.getByTestId("partner-status")).getByRole("button", { name: "Invite a partner" })));
    expect(account.getByTestId("partner-status")).toHaveTextContent("Invite open.");
    expect(account.getByTestId("invite-link")).toHaveTextContent("/invite/");
    expect(account.getByText(/Expires in 48 hours/)).toBeInTheDocument();

    await act(async () => mockControls.partnerJoins("alex@example.com", "Alex"));
    expect(await account.findByText("Partner: Alex")).toBeInTheDocument();
    expect(account.getByTestId("partner-status")).toHaveTextContent("Alex approves your early unlocks.");
    expect(account.getByTestId("partner-status")).toHaveAttribute("data-tone", "ok");
    await act(async () => fireEvent.click(account.getByRole("button", { name: "Ask to remove" })));
    expect(account.getByTestId("partner-status")).toHaveTextContent("Waiting for Alex to release you.");
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
    await openTab("Goals");
    fireEvent.change(screen.getByLabelText("Daily focus goal"), { target: { value: "90" } });
    const rest = within(screen.getByRole("group", { name: "Rest days" }));
    fireEvent.click(rest.getByRole("button", { name: "Sat" }));
    fireEvent.click(rest.getByRole("button", { name: "Sun" }));
    expect(rest.getByRole("button", { name: "Sat" })).toHaveAttribute("aria-pressed", "true");
    await waitFor(async () => expect(await native.getSetting("rest_days_mask")).toBe(String((1 << 6) | 1)));
    expect(await native.getSetting("daily_goal_min")).toBe("90");
  });

  it("the weekly recap switch starts off and turns the card on", async () => {
    await renderSetup(false);
    await openTab("Goals");
    const sw = await screen.findByRole("switch", { name: "Weekly recap" });
    expect(sw).toHaveAttribute("aria-checked", "false");
    fireEvent.click(sw);
    expect(sw).toHaveAttribute("aria-checked", "true");
    await waitFor(async () => expect(await native.getSetting("weekly_recap")).toBe("1"));
  });
});

describe("Start with Windows (v0.1.4)", () => {
  it("shows Windows' startup switch and changes it", async () => {
    await renderSetup(false);
    await openTab("Behavior");
    const sw = await screen.findByRole("switch", { name: "Start with Windows" });
    await waitFor(() => expect(sw).toHaveAttribute("aria-checked", "true"));
    await act(async () => fireEvent.click(sw));
    await waitFor(() => expect(sw).toHaveAttribute("aria-checked", "false"));
    expect((await native.startupStatus()).enabled).toBe(false);
  });
});

describe("Email the invite", () => {
  it("emails the open invite link to a friend", async () => {
    await renderSetup(false);
    await openTab("Partner");
    const account = within(await screen.findByRole("region", { name: "Account" }));
    await act(async () => fireEvent.click(account.getByRole("button", { name: "Continue with Google" })));
    await act(async () => fireEvent.click(await account.findByRole("button", { name: "Invite a partner" })));
    const field = await account.findByLabelText("Partner's email");
    fireEvent.change(field, { target: { value: "not an email" } });
    await act(async () => fireEvent.click(account.getByRole("button", { name: "Email it" })));
    expect(screen.getByText(/That doesn't look like an email address/)).toBeInTheDocument();
    fireEvent.change(field, { target: { value: "alex@example.com" } });
    await act(async () => fireEvent.click(account.getByRole("button", { name: "Email it" })));
    expect(account.getByText(/Sent to alex@example.com/)).toBeInTheDocument();
  });
});

describe("Browser Extension", () => {
  it("shows setup steps until a browser connects, then its status", async () => {
    await renderSetup(false);
    await openTab("Browser Extension");
    const section = within(await screen.findByRole("region", { name: "Browser Extension" }));
    expect(section.getByText("Comet")).toBeInTheDocument();
    expect(section.queryByText("Edge")).toBeNull(); // not installed
    expect(section.getAllByText("Extension not loaded.")).toHaveLength(2);
    // No status line: a short description and the guide, and each browser's own dot (red: not connected).
    expect(section.queryByTestId("browser-status")).toBeNull();
    expect(section.getByTestId("extension-intro")).toHaveTextContent("Seals sites and keyword tabs inside your browser.");
    const site = vi.spyOn(native, "openSite");
    fireEvent.click(section.getByRole("button", { name: "How to use it" }));
    expect(site).toHaveBeenCalledWith("docs/extension", expect.any(String));
    expect(section.getAllByText("Not connected").map((t) => t.querySelector("[data-tone]"))).toEqual(expect.arrayContaining([expect.anything()]));
    for (const dot of section.getAllByText("Not connected").map((t) => t.querySelector("[data-tone]")!)) expect(dot).toHaveClass("bg-danger");
    const tab = () => screen.getByRole("tab", { name: "Browser Extension" }).querySelector("[data-tone]");
    expect(tab()).toHaveAttribute("data-tone", "attention");
    expect(section.getByTestId("extension-dir")).toHaveTextContent("extension");

    await act(async () => mockControls.extension("comet.exe", { connected: true, incognito: false }));
    expect(await section.findByText("v0.1.0 · Off in private windows")).toBeInTheDocument();
    expect(section.queryByTestId("extension-dir")).toBeNull();
    // One browser connected: the side list's dot turns green.
    await waitFor(() => expect(tab()).toHaveAttribute("data-tone", "ok"));
    expect(section.getByText("Connected").querySelector("[data-tone]")).toHaveClass("bg-ok");
    fireEvent.click(section.getByRole("button", { name: "Show steps" }));
    expect(section.getByTestId("extension-dir")).toBeInTheDocument();

    await act(async () => mockControls.extension("comet.exe", { incognito: true }));
    expect(await section.findByText("v0.1.0")).toBeInTheDocument();
    await act(async () => mockControls.extension("comet.exe", { connected: false, missing: true }));
    expect(await section.findByText("Extension removed. Its windows stay minimized.")).toBeInTheDocument();
    expect(tab()).toHaveAttribute("data-tone", "attention");
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
