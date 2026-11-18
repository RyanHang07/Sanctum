import { act, fireEvent, render, screen } from "@testing-library/react";
import { Setup } from "./Setup";
import { useStore } from "../state/store";
import { gsap } from "../lib/gsap";
import { resetMockBackend } from "../lib/mockBackend";
import { finish, moment, seek, setReducedMotion } from "../test/motion";

const initial = useStore.getState();
/** Lets the nav's status loads land before the swap starts, so they don't update outside act(). */
const flushLoads = () => act(async () => {});
beforeEach(() => {
  resetMockBackend();
  useStore.setState(initial, true);
});

describe("Setup's sections swap like screens", () => {
  it("the old section fades out, then the new one rises in", async () => {
    setReducedMotion(false);
    render(<Setup />);
    await flushLoads();
    const panel = screen.getByRole("tabpanel");
    expect(moment("setup-swap")).toBeUndefined(); // the first section just appears
    act(() => useStore.setState({ setupTab: "behaviour" }));
    const tl = moment("setup-swap")!;
    expect(tl).toBeDefined();
    // The list moves at once; the old content is still on screen while it fades.
    expect(screen.getByRole("tab", { name: "Behavior" })).toHaveAttribute("aria-selected", "true");
    expect(panel).toHaveAttribute("aria-label", "Profiles");
    seek(tl, 0.05, true);
    expect(Number(gsap.getProperty(panel, "opacity"))).toBeLessThan(1);
    expect(panel.style.overflow).toBe("hidden");
    finish(tl);
    expect(screen.getByRole("tabpanel")).toHaveAttribute("aria-label", "Behavior");
    expect(Number(gsap.getProperty(panel, "opacity"))).toBe(1);
    expect(panel.style.overflow).toBe("");
    await flushLoads();
  });

  it("swaps at once under reduced motion", async () => {
    setReducedMotion(true);
    render(<Setup />);
    await flushLoads();
    act(() => useStore.setState({ setupTab: "behaviour" }));
    expect(screen.getByRole("tabpanel")).toHaveAttribute("aria-label", "Behavior");
    await flushLoads();
  });

  it("a profile opens in the same column with the same swap, and Profiles brings you back", async () => {
    setReducedMotion(false);
    const p = await act(() => useStore.getState().createProfile({ name: "Deep Work" }));
    act(() => useStore.getState().editProfile(null));
    render(<Setup />);
    await flushLoads();
    act(() => useStore.getState().editProfile(p!.id));
    const tl = moment("setup-swap")!;
    expect(tl).toBeDefined();
    // The list stays, with Profiles still picked; the old content fades first.
    expect(screen.getByRole("tab", { name: "Profiles" })).toHaveAttribute("aria-selected", "true");
    finish(tl);
    const panel = screen.getByRole("tabpanel");
    expect(panel).toHaveAttribute("aria-label", p!.name);
    expect(screen.getByTestId("setup-column")).toContainElement(screen.getByRole("heading", { name: p!.name }));
    act(() => fireEvent.click(screen.getByRole("button", { name: "Profiles" })));
    expect(useStore.getState().editingProfileId).toBeNull();
    finish(moment("setup-swap")!);
    expect(screen.getByRole("tabpanel")).toHaveAttribute("aria-label", "Profiles");
  });

  it("picking another section from the list leaves the profile", async () => {
    setReducedMotion(true);
    const p = await act(() => useStore.getState().createProfile({ name: "Deep Work" }));
    act(() => useStore.getState().editProfile(null));
    render(<Setup />);
    await flushLoads();
    act(() => useStore.getState().editProfile(p!.id));
    act(() => fireEvent.click(screen.getByRole("tab", { name: "Goals" })));
    expect(useStore.getState().editingProfileId).toBeNull();
    expect(screen.getByRole("tabpanel")).toHaveAttribute("aria-label", "Goals");
    await flushLoads();
  });
});
