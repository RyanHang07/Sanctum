import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ActivityRulesSection, ActivitySection, ruleKindOf } from "./Activity";
import { useStore } from "../../state/store";
import { connectNativeEvents } from "../../state/events";
import { mockControls, resetMockBackend } from "../../lib/mockBackend";
import { native } from "../../lib/native";
import { catalogClassRules, sampleProfiles } from "../../lib/catalog";
import { Home } from "../Home";
import { WelcomeCard } from "../../windows/Intercept";
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
  it("shows today's split and saves idle settings", async () => {
    render(<ActivitySection />);
    await waitFor(() => expect(screen.getByTestId("activity-today")).toHaveTextContent("2h 14mproductive"));
    expect(screen.getByTestId("activity-today")).toHaveTextContent("9midle");
    expect(screen.getByLabelText("Idle after")).toHaveValue("3");
    fireEvent.change(screen.getByLabelText("Idle after"), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText("Keep history"), { target: { value: "90" } });
    const priv = screen.getByLabelText("Private apps");
    fireEvent.change(priv, { target: { value: "1password.exe, signal.exe" } });
    fireEvent.blur(priv);
    await waitFor(async () => expect(await native.getSetting("idle_threshold_min")).toBe("5"));
    expect(await native.getSetting("activity_retention_days")).toBe("90");
    expect(await native.getSetting("private_apps")).toBe("1password.exe, signal.exe");
  });
});

describe("activity rules", () => {
  it("reads what a typed rule is", () => {
    expect(ruleKindOf("Discord.exe")).toEqual({ matchKind: "exe", pattern: "discord.exe" });
    expect(ruleKindOf("https://www.twitch.tv/")).toEqual({ matchKind: "domain", pattern: "twitch.tv" });
    expect(ruleKindOf("Shorts")).toEqual({ matchKind: "title", pattern: "Shorts" });
    expect(ruleKindOf("  ")).toBeNull();
  });

  it("starts from the catalog and can be added to, changed, and trimmed", async () => {
    render(<ActivityRulesSection />);
    const list = await screen.findByRole("list", { name: "Activity rules" });
    await waitFor(() => expect(within(list).getAllByRole("listitem").length).toBe(catalogClassRules().length));
    expect(within(list).getByText("leetcode.com")).toBeInTheDocument();
    expect(screen.getByLabelText("Category for leetcode.com")).toHaveValue("productive");
    expect(screen.getByLabelText("Category for discord.exe")).toHaveValue("distracting");

    const input = screen.getByLabelText("Add an activity rule");
    fireEvent.change(input, { target: { value: "twitch.tv" } });
    await act(async () => fireEvent.keyDown(input, { key: "Enter" }));
    await within(list).findByText("twitch.tv");
    expect(screen.getByLabelText("Category for twitch.tv")).toHaveValue("distracting");

    await act(async () => fireEvent.change(screen.getByLabelText("Category for discord.exe"), { target: { value: "neutral" } }));
    await waitFor(() => expect(screen.getByLabelText("Category for discord.exe")).toHaveValue("neutral"));

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Remove twitch.tv" })));
    await waitFor(() => expect(within(list).queryByText("twitch.tv")).toBeNull());
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
    expect(bar).toHaveTextContent("Paused · Interview Prep");
    expect(bar).toHaveTextContent("Idle, the seal extends until you're back");
    expect(useStore.getState().session!.endsAt).toBeGreaterThanOrEqual(before + 4 * 60_000);
    act(() => mockControls.comeBack());
    expect(bar).toHaveTextContent("Sealed · Interview Prep");
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
    expect(screen.getByRole("status")).toHaveTextContent(/Welcome back\. Pick it up\.|Back in\. Keep going\.|You stepped away\. Step back in\./);
    expect(screen.getByRole("status")).toHaveTextContent("You were in Visual Studio Code: graph.py.");
    expect(screen.getByRole("status")).toHaveTextContent("12m idle · seal extended to 11:02 AM");
    // Private titles never show.
    rerender(<WelcomeCard p={{ ...p, title: "(private)" }} />);
    expect(screen.getByRole("status")).toHaveTextContent("You were in Visual Studio Code.");
  });
});
