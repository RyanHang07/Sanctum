import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { useStore } from "./store";
import { usePlanner } from "./planner";
import { connectNativeEvents } from "./events";
import { mockControls, resetMockBackend } from "../lib/mockBackend";
import { native } from "../lib/native";
import { sampleProfiles } from "../lib/catalog";
import { todayKey } from "../lib/planner";
import { Home } from "../pages/Home";
import { HeldPage } from "../pages/HeldPage";

const initial = useStore.getState();
const initialPlanner = usePlanner.getState();

let disconnect = () => {};
beforeEach(() => {
  resetMockBackend();
  useStore.setState(initial, true);
  usePlanner.setState(initialPlanner, true);
  disconnect = connectNativeEvents();
});
afterEach(() => disconnect());

async function setup() {
  for (const d of sampleProfiles()) await native.createProfile(d);
  await act(() => useStore.getState().loadProfiles());
  const deep = useStore.getState().profiles.find((p) => p.name !== useStore.getState().profiles[0]!.name)!;
  const todo = await native.saveTodo({ title: "Write the essay", dueDate: todayKey(), dueTime: null, durationMin: null, profileId: deep.id });
  await act(() => usePlanner.getState().reload());
  return { deep, todo };
}

describe("a session for a task (v0.1)", () => {
  it("links a Today task, seals for it, and checks it off from the held page", async () => {
    const { deep, todo } = await setup();
    render(<Home />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Focus on Write the essay" })));
    // The task takes the suggestion's place and brings its profile.
    expect(screen.getByTestId("focus-task")).toHaveTextContent("Write the essay");
    expect(useStore.getState().selectedProfileId).toBe(deep.id);
    expect(screen.getByRole("button", { name: "Unlink Write the essay" })).toHaveAttribute("aria-pressed", "true");

    await act(async () => void (await useStore.getState().enterFocus()));
    expect(useStore.getState().session?.task).toMatchObject({ kind: "todo", id: todo.id, title: "Write the essay" });
    expect(useStore.getState().focusTask).toBeNull();
    expect(screen.getByTestId("session-bar")).toHaveTextContent("Write the essay");
    // Sealed, the list can't relink.
    expect(screen.queryByRole("button", { name: /Focus on/ })).toBeNull();

    await act(async () => mockControls.fastForward(24 * 60 * 60_000));
    const held = useStore.getState().held!;
    expect(held.task?.title).toBe("Write the essay");
    render(<HeldPage held={held} />);
    const page = within(screen.getByTestId("held-page"));
    await act(async () => fireEvent.click(page.getByRole("button", { name: "Mark Write the essay done" })));
    expect(page.getByTestId("held-task")).toHaveTextContent("Write the essay is done");
    expect((await native.listTodos(todayKey(), todayKey())).find((t) => t.id === todo.id)?.done).toBe(true);
  });

  it("unlinks from the strip, and a suggested block links its own item", async () => {
    await setup();
    render(<Home />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Focus on Write the essay" })));
    fireEvent.click(screen.getByRole("button", { name: "Unlink task" }));
    expect(screen.queryByTestId("focus-task")).toBeNull();
    expect(useStore.getState().focusTask).toBeNull();

    const item = usePlanner.getState().todos[0]!;
    await act(async () =>
      void (await useStore.getState().enterSuggested({
        item: { key: `todo:${item.id}`, kind: "todo", id: item.id, title: item.title, date: item.dueDate, time: null, durationMin: 30, profileId: item.profileId, done: false },
        state: "now",
        startsAt: Date.now(),
        endsAt: Date.now() + 30 * 60_000,
        profileId: item.profileId!,
        minutes: 30,
      })),
    );
    expect(useStore.getState().session?.task?.title).toBe("Write the essay");
  });
});
