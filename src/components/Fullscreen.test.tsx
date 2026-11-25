import { act, fireEvent, render } from "@testing-library/react";
import { AppShell } from "./AppShell";
import { useStore } from "../state/store";
import { resetMockBackend } from "../lib/mockBackend";
import { native } from "../lib/native";

const initial = useStore.getState();

beforeEach(async () => {
  resetMockBackend();
  useStore.setState(initial, true);
  await native.setSetting("onboarded", "1");
});

describe("Full screen (2026-11-24)", () => {
  it("F11 fills the screen and gives it back", async () => {
    const spy = vi.spyOn(native, "toggleFullscreen");
    render(<AppShell />);
    await act(async () => await useStore.getState().loadProfiles());
    await act(async () => fireEvent.keyDown(window, { key: "F11" }));
    expect(spy).toHaveBeenCalledTimes(1);
    await act(async () => fireEvent.keyDown(window, { key: "F11" }));
    expect(spy).toHaveBeenCalledTimes(2);
    // Modified F11 is left alone.
    await act(async () => fireEvent.keyDown(window, { key: "F11", ctrlKey: true }));
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });
});
