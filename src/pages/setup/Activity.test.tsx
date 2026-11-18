import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ActivityRulesSection, ActivitySection, ActivityTab, ActivityTodaySection, ruleKindOf } from "./Activity";
import { distractionOf } from "./ActivityRules";
import { useStore } from "../../state/store";
import { connectNativeEvents } from "../../state/events";
import { mockControls, resetMockBackend } from "../../lib/mockBackend";
import { native } from "../../lib/native";
import { catalogClassRules, sampleProfiles } from "../../lib/catalog";
import { Home } from "../Home";
import { WelcomeCard } from "../../windows/Intercept";
import { WELCOME } from "../headlines";
import type { Intercept } from "../../lib/types";

const initial = useStore.getState();
let disconnect = () => {};
beforeEach(async () => {
  resetMockBackend();
  useStore.setState(initial, true);
  disconnect = connectNativeEvents();
  await act(() => useStore.getState().loadSettings());
});
afterEach(() => disconnect());

describe("activity settings", () => {
  it("shows today's split", async () => {
    render(<ActivityTodaySection />);
    expect(screen.getByRole("region", { name: "Today" })).toHaveTextContent("Stays on this PC");
    await waitFor(() => expect(screen.getByTestId("activity-today")).toHaveTextContent("2h 14mProductive"));
    expect(screen.getByTestId("activity-today")).toHaveTextContent("9mIdle");
  });

  it("saves the counting settings, in plain words, to the same keys", async () => {
    render(<ActivitySection />);
    expect(screen.getByLabelText("Count you as away after")).toHaveValue("3");
    expect(screen.getByText("Calls and video")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Count you as away after"), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText("Keep history for"), { target: { value: "90" } });
    const priv = screen.getByLabelText("Hide window titles for");
    fireEvent.change(priv, { target: { value: "1password.exe, signal.exe" } });
    fireEvent.blur(priv);
    const present = screen.getByLabelText("Never away while these are open");
    fireEvent.change(present, { target: { value: "zoom.exe" } });
    fireEvent.blur(present);
    await waitFor(async () => expect(await native.getSetting("idle_threshold_min")).toBe("5"));
    expect(await native.getSetting("activity_retention_days")).toBe("90");
    expect(await native.getSetting("private_apps")).toBe("1password.exe, signal.exe");
    expect(await native.getSetting("passive_apps")).toBe("zoom.exe");
  });

  it("lays out today, the groups, and counting in one column", async () => {
    render(<ActivityTab />);
    const boxes = ["Today", "How apps and sites count", "Counting"];
    const names = screen.getAllByRole("region").map((r) => r.getAttribute("aria-label"));
    expect(names.filter((n) => boxes.includes(n!))).toEqual(boxes);
    await screen.findAllByText("discord.exe");
  });
});

describe("activity rules", () => {
  const group = (name: string) => screen.getByRole("region", { name });
  const own = (name: string) => screen.getByRole("list", { name: `Your ${name.toLowerCase()} apps and sites` });
  const defaults = (name: string) => screen.getByRole("list", { name: `Sanctum's ${name.toLowerCase()} defaults` });
  const rule = async (pattern: string) => (await native.listClassRules()).find((r) => r.pattern === pattern);

  const fold = (name: string) => within(group(name)).getByRole("button", { name: /Sanctum's defaults/ });

  /** Renders the groups with both defaults folds open (closed folds hide their rows). */
  async function renderRules() {
    render(<ActivityRulesSection />);
    await waitFor(() => expect(within(group("Distracting")).getByText("discord.exe")).toBeInTheDocument());
    // Defaults start folded away.
    expect(fold("Productive")).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(fold("Productive"));
    fireEvent.click(fold("Distracting"));
  }

  it("reads what a typed rule is", () => {
    expect(ruleKindOf("Discord.exe")).toEqual({ matchKind: "exe", pattern: "discord.exe" });
    expect(ruleKindOf("https://www.twitch.tv/")).toEqual({ matchKind: "domain", pattern: "twitch.tv" });
    expect(ruleKindOf("Shorts")).toEqual({ matchKind: "title", pattern: "Shorts" });
    expect(ruleKindOf("  ")).toBeNull();
  });

  it("turns a rule into the Distractions entry it blocks as", () => {
    expect(distractionOf({ matchKind: "exe", pattern: "discord.exe" })).toEqual({ kind: "app", value: "discord.exe" });
    expect(distractionOf({ matchKind: "domain", pattern: "twitch.tv" })).toEqual({ kind: "site", value: "twitch.tv" });
    expect(distractionOf({ matchKind: "title", pattern: "Shorts" })).toEqual({ kind: "keyword", value: "shorts" });
  });

  it("groups rules by category and sets Sanctum's defaults apart", async () => {
    await renderRules();
    const catalog = catalogClassRules();
    for (const [name, c] of [
      ["Productive", "productive"],
      ["Distracting", "distracting"],
    ] as const) {
      expect(within(own(name)).queryAllByRole("listitem")).toHaveLength(0);
      expect(within(defaults(name)).getAllByRole("listitem")).toHaveLength(catalog.filter((r) => r.category === c).length);
    }
    expect(within(defaults("Productive")).getByText("leetcode.com")).toBeInTheDocument();
    expect(within(defaults("Distracting")).getByText("discord.exe")).toBeInTheDocument();
    // Neutral has no defaults, so no fold.
    expect(within(group("Neutral")).queryByRole("button", { name: /Sanctum's defaults/ })).toBeNull();
    expect(group("Neutral")).toHaveTextContent("Anything not listed is neutral.");

    // The folds close, hiding the defaults, and open again.
    expect(fold("Productive")).toHaveTextContent(String(catalog.filter((r) => r.category === "productive").length));
    fireEvent.click(fold("Productive"));
    expect(fold("Productive")).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("list", { name: "Sanctum's productive defaults" })).toBeNull();
    fireEvent.click(fold("Productive"));
    expect(fold("Productive")).toHaveAttribute("aria-expanded", "true");
  });

  it("adds to the group it's typed into, above the defaults", async () => {
    await renderRules();
    const input = screen.getByLabelText("Add to Distracting");
    expect(input).toHaveAttribute("placeholder", "Add an app, site or title word");
    fireEvent.change(input, { target: { value: "twitch.tv" } });
    await act(async () => fireEvent.keyDown(input, { key: "Enter" }));
    await within(own("Distracting")).findByText("twitch.tv");
    await waitFor(() => expect(input).toHaveValue(""));
    expect((await rule("twitch.tv"))?.category).toBe("distracting");

    const prod = screen.getByLabelText("Add to Productive");
    fireEvent.change(prod, { target: { value: "Leetcode practice" } });
    await act(async () => fireEvent.keyDown(prod, { key: "Enter" }));
    await within(own("Productive")).findByText("Leetcode practice");
    expect(await rule("Leetcode practice")).toMatchObject({ matchKind: "title", category: "productive" });
  });

  it("moves a rule to another group from the keyboard", async () => {
    await renderRules();
    const toggle = screen.getByRole("button", { name: "Move discord.exe" });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const choices = screen.getByRole("group", { name: "Move discord.exe to" });
    expect(within(choices).queryByRole("button", { name: "Move discord.exe to Distracting" })).toBeNull();
    // Escape closes without moving.
    fireEvent.keyDown(within(choices).getByRole("button", { name: "Move discord.exe to Neutral" }), { key: "Escape" });
    expect(screen.queryByRole("group", { name: "Move discord.exe to" })).toBeNull();
    expect(toggle).toHaveFocus();

    fireEvent.click(toggle);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Move discord.exe to Neutral" })));
    await waitFor(() => expect(within(own("Neutral")).getByText("discord.exe")).toBeInTheDocument());
    expect(within(group("Distracting")).queryByText("discord.exe")).toBeNull();
    expect(screen.getByRole("button", { name: "Move discord.exe" })).toHaveFocus();
    await waitFor(async () => expect(await rule("discord.exe")).toMatchObject({ category: "neutral", source: "user" }));
  });

  it("moves a rule by dragging it to another group", async () => {
    await renderRules();
    const item = within(defaults("Productive")).getByText("leetcode.com").closest("li")!;
    expect(item).toHaveAttribute("draggable", "true");
    const data = { setData: () => {}, getData: () => "", effectAllowed: "", dropEffect: "" };
    fireEvent.dragStart(item, { dataTransfer: data });
    // Its own group isn't a target.
    expect(fireEvent.dragOver(group("Productive"), { dataTransfer: data })).toBe(true);
    expect(fireEvent.dragOver(group("Distracting"), { dataTransfer: data })).toBe(false);
    await act(async () => fireEvent.drop(group("Distracting"), { dataTransfer: data }));
    await waitFor(() => expect(within(own("Distracting")).getByText("leetcode.com")).toBeInTheDocument());
    await waitFor(async () => expect((await rule("leetcode.com"))?.category).toBe("distracting"));
  });

  it("blocks a distracting rule: it joins Distractions and shows as blocked", async () => {
    await renderRules();
    expect(screen.queryByRole("button", { name: "Block leetcode.com" })).toBeNull();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Block discord.exe" })));
    await waitFor(() => expect(useStore.getState().distractions.some((d) => d.kind === "app" && d.value === "discord.exe")).toBe(true));
    expect(useStore.getState().notice).toMatchObject({ lead: "Blocked during focus.", rest: "It's in Distractions now." });
    await waitFor(() => expect(screen.queryByRole("button", { name: "Block discord.exe" })).toBeNull());
    const row = within(defaults("Distracting")).getByText("discord.exe").closest("li")!;
    expect(row).toHaveTextContent("Blocked");
  });

  it("removes a rule", async () => {
    await renderRules();
    fireEvent.click(screen.getByRole("button", { name: "Move discord.exe" }));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Remove discord.exe" })));
    await waitFor(() => expect(screen.queryByText("discord.exe")).toBeNull());
    expect(await rule("discord.exe")).toBeUndefined();
  });

  it("seeds what work types open as productive and what they seal as distracting", () => {
    const rules = catalogClassRules();
    const find = (p: string) => rules.find((r) => r.pattern === p)?.category;
    expect(find("leetcode.com")).toBe("productive");
    expect(find("code.exe")).toBe("productive");
    expect(find("youtube.com")).toBe("distracting");
    expect(find("steam.exe")).toBe("distracting");
  });
});

describe("idle during a seal", () => {
  async function sealed() {
    for (const d of sampleProfiles()) await native.createProfile(d);
    await act(() => useStore.getState().loadProfiles());
    await act(async () => void (await useStore.getState().enterFocus()));
  }

  it("pauses the countdown and moves the end later", async () => {
    await sealed();
    render(<Home />);
    const before = useStore.getState().session!.endsAt;
    act(() => mockControls.goIdle(4 * 60_000));
    const bar = screen.getByTestId("session-bar");
    expect(within(bar).getByTestId("sealed-slot")).toHaveTextContent(/^Paused/);
    expect(bar).toHaveTextContent("Idle, the seal extends until you're back");
    expect(useStore.getState().session!.endsAt).toBeGreaterThanOrEqual(before + 4 * 60_000);
    act(() => mockControls.comeBack());
    expect(within(bar).getByTestId("sealed-slot")).toHaveTextContent(/^Sealed/);
    expect(useStore.getState().session!.idle).toBe(false);
  });

  it("welcomes you back with what you were doing", () => {
    const p: Intercept = {
      kind: "welcome",
      label: "Visual Studio Code",
      attempts: 0,
      profileName: "Deep Work",
      elapsedMs: 0,
      remainingMs: 0,
      backTo: null,
      keyword: null,
      title: "graph.py",
      idleMs: 12 * 60_000,
      endsAt: new Date(2026, 8, 29, 11, 2).getTime(),
    };
    const { rerender } = render(<WelcomeCard p={p} />);
    expect(screen.getByRole("status")).toHaveTextContent(new RegExp(WELCOME.join("|").replace(/\./g, "\\.")));
    expect(screen.getByRole("status")).toHaveTextContent("You were in Visual Studio Code: graph.py.");
    expect(screen.getByRole("status")).toHaveTextContent("12m idle · seal extended to 11:02 AM");
    // Private titles never show.
    rerender(<WelcomeCard p={{ ...p, title: "(private)" }} />);
    expect(screen.getByRole("status")).toHaveTextContent("You were in Visual Studio Code.");
  });
});
