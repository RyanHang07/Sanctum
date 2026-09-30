import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { Onboarding } from "./Onboarding";
import { useStore } from "../../state/store";
import { resetMockBackend } from "../../lib/mockBackend";
import { native } from "../../lib/native";

const initial = useStore.getState();

beforeEach(() => {
  resetMockBackend();
  useStore.setState(initial, true);
});

const next = () => act(async () => fireEvent.click(screen.getByRole("button", { name: /Continue|Start using Sanctum/ })));

describe("Onboarding", () => {
  it("opens on a first run only", async () => {
    await act(() => useStore.getState().checkOnboarding());
    expect(useStore.getState().onboarding).toBe(true);

    useStore.setState({ onboarding: false });
    await native.createProfile({ name: "Deep Work" });
    await native.setSetting("onboarded", "");
    await act(() => useStore.getState().checkOnboarding());
    expect(useStore.getState().onboarding).toBe(false);
    expect(await native.getSetting("onboarded")).toBe("1");
  });

  it("walks the seven steps, creates the picked profiles, and flags distractions", async () => {
    await act(() => useStore.getState().loadSettings());
    useStore.setState({ onboarding: true });
    render(<Onboarding />);
    expect(screen.getByText("Step 1 of 7 · Welcome")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("Optional"), { target: { value: "Ryan" } });
    await next();

    // Profiles: Interview Prep starts with its sample work; clear Study entirely.
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Define Interview Prep.");
    expect(screen.getByRole("checkbox", { name: "DSA practice" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText(/LeetCode/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "Mock interviews" }));
    fireEvent.click(screen.getByRole("tab", { name: "Study" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Reading & courses" }));
    expect(screen.getByText("Nothing yet")).toBeInTheDocument();
    await next();

    // Distractions: the common four start picked; drop TikTok, add Reddit and a keyword.
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Name your distractions.");
    expect(screen.getByRole("checkbox", { name: "Discord" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("checkbox", { name: "TikTok" }));
    const field = screen.getByLabelText("Add a site, link, or keyword");
    fireEvent.change(field, { target: { value: "reddit.com" } });
    fireEvent.keyDown(field, { key: "Enter" });
    fireEvent.change(field, { target: { value: "shorts" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(screen.getByText("Also: reddit.com, shorts")).toBeInTheDocument();
    await next();

    // Goals.
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Daily focus goal" })).getByRole("radio", { name: "1h 30m" }));
    fireEvent.click(screen.getByRole("button", { name: "Sun" }));
    await next();

    // Calendar and Browser can be skipped.
    expect(screen.getByRole("button", { name: "Connect Google Calendar" })).toBeInTheDocument();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Skip" })));
    expect(await screen.findByRole("region", { name: "Browser extension" })).toBeInTheDocument();
    await next();

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("You're set. Stay in it.");
    expect(screen.getByText(/Discord, YouTube, Instagram, reddit.com, shorts/)).toBeInTheDocument();
    await next();

    const profiles = await native.listProfiles();
    expect(profiles.map((p) => p.name)).toEqual(["Interview Prep", "Deep Work", "Light Work"]);
    expect(profiles[0]!.workTypes).toContain("Mock interviews");
    const flags = (await native.listDistractions()).map((d) => `${d.kind}:${d.value}`);
    expect(flags).toEqual(expect.arrayContaining(["app:discord.exe", "site:reddit.com", "keyword:shorts"]));
    expect(flags.some((f) => f.includes("tiktok"))).toBe(false);
    expect(await native.getSetting("daily_goal_min")).toBe("90");
    expect(await native.getSetting("rest_days_mask")).toBe("1");
    expect(await native.getSetting("display_name")).toBe("Ryan");
    expect(await native.getSetting("onboarded")).toBe("1");
    expect(useStore.getState().onboarding).toBe(false);
    expect(useStore.getState().profiles).toHaveLength(3);
    expect(useStore.getState().distractions.length).toBe(flags.length);
  });
});
