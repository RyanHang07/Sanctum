import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { AppShell } from "./AppShell";
import { useStore } from "../state/store";
import { usePlanner } from "../state/planner";
import { resetMockBackend } from "../lib/mockBackend";
import { native } from "../lib/native";
import { sampleProfiles } from "../lib/catalog";
import { todayKey } from "../lib/planner";

const initial = useStore.getState();

beforeEach(async () => {
  resetMockBackend();
  useStore.setState(initial, true);
  for (const d of sampleProfiles()) await native.createProfile(d);
  await native.setSetting("onboarded", "1");
});

async function openBar() {
  render(<AppShell />);
  await act(async () => await useStore.getState().loadProfiles());
  await act(async () => fireEvent.keyDown(window, { key: "k", ctrlKey: true }));
  return within(screen.getByRole("dialog", { name: "Command bar" }));
}

describe("Command bar", () => {
  it("opens with Ctrl K, filters, and jumps to a Setup tab with Enter", async () => {
    const bar = await openBar();
    const input = bar.getByRole("combobox", { name: "Search or command" });
    fireEvent.change(input, { target: { value: "distract" } });
    expect(bar.getByRole("option", { name: /Setup › Distractions/ })).toHaveAttribute("aria-selected", "true");
    await act(async () => fireEvent.keyDown(input, { key: "Enter" }));
    expect(screen.queryByRole("dialog", { name: "Command bar" })).toBeNull();
    expect(useStore.getState().activeTab).toBe("setup");
    expect(useStore.getState().setupTab).toBe("distractions");
  });

  it("enters focus with any profile, moving with the arrow keys", async () => {
    const bar = await openBar();
    const input = bar.getByRole("combobox");
    fireEvent.change(input, { target: { value: "enter focus" } });
    const options = bar.getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(expect.arrayContaining([expect.stringContaining("Enter focus: Deep Work")]));
    const deep = options.findIndex((o) => o.textContent?.includes("Deep Work"));
    for (let i = 0; i < deep; i++) fireEvent.keyDown(input, { key: "ArrowDown" });
    await act(async () => fireEvent.keyDown(input, { key: "Enter" }));
    expect(useStore.getState().session?.profileName).toBe("Deep Work");
    await act(() => native.emergencyUnlock("test cleanup"));
  });

  it("adds what you typed as a task, or flags it", async () => {
    let bar = await openBar();
    fireEvent.change(bar.getByRole("combobox"), { target: { value: "reddit.com" } });
    expect(bar.getByRole("option", { name: /Flag “reddit.com” as a distraction/ })).toHaveTextContent("Site or link");
    await act(async () => fireEvent.click(bar.getByRole("option", { name: /Flag “reddit.com”/ })));
    expect(useStore.getState().distractions.map((d) => d.value)).toContain("reddit.com");

    await act(async () => fireEvent.keyDown(window, { key: "k", ctrlKey: true }));
    bar = within(screen.getByRole("dialog", { name: "Command bar" }));
    fireEvent.change(bar.getByRole("combobox"), { target: { value: "Buy stamps" } });
    await act(async () => fireEvent.click(bar.getByRole("option", { name: /Add “Buy stamps” for today/ })));
    expect((await native.listTodos(todayKey(), todayKey())).map((t) => t.title)).toContain("Buy stamps");
    expect(usePlanner.getState().todos.map((t) => t.title)).toContain("Buy stamps");
  });

  it("offers the sealed commands while sealed", async () => {
    const first = await openBar();
    await act(async () => fireEvent.keyDown(first.getByRole("combobox"), { key: "Escape" }));
    expect(screen.queryByRole("dialog", { name: "Command bar" })).toBeNull();
    await act(async () => void (await useStore.getState().enterFocus()));
    await act(async () => fireEvent.keyDown(window, { key: "k", ctrlKey: true }));
    const bar = within(screen.getByRole("dialog", { name: "Command bar" }));
    expect(bar.getByRole("option", { name: /Break the seal/ })).toBeInTheDocument();
    expect(bar.queryByRole("option", { name: /Enter focus:/ })).toBeNull();
    await act(() => native.emergencyUnlock("test cleanup"));
  });
});
