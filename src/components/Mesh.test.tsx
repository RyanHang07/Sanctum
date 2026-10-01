import { act, render, screen } from "@testing-library/react";
import { Mesh, STATE_FADE_MS, StateBackdrop } from "./Mesh";

function setVisibility(v: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { value: v, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
}

afterEach(() => setVisibility("visible"));

describe("Mesh", () => {
  it("dims and slows for the sealed and event themes", () => {
    render(
      <>
        <Mesh tone="sealed" />
        <Mesh tone="event" />
      </>,
    );
    expect(screen.getByTestId("mesh-sealed")).toHaveClass("mesh-ambient");
    expect(screen.getByTestId("mesh-event").querySelector(".bg-ember-1")).not.toBeNull();
  });

  it("cross-fades the backdrops between states, then drops the faded one", () => {
    vi.useFakeTimers();
    const { rerender } = render(<StateBackdrop state="sealed" />);
    expect(screen.getByTestId("mesh-sealed")).toHaveClass("state-backdrop-on");
    rerender(<StateBackdrop state="event" />);
    // Both are there while they fade; the sealed one has stopped moving.
    expect(screen.getByTestId("mesh-sealed")).not.toHaveClass("state-backdrop-on");
    expect(screen.getByTestId("mesh-sealed")).toHaveAttribute("data-paused", "true");
    expect(screen.getByTestId("mesh-event")).toHaveClass("state-backdrop-on");
    act(() => vi.advanceTimersByTime(STATE_FADE_MS + 200));
    expect(screen.queryByTestId("mesh-sealed")).toBeNull();
    rerender(<StateBackdrop state="open" />);
    act(() => vi.advanceTimersByTime(STATE_FADE_MS + 200));
    expect(screen.queryByTestId("mesh-event")).toBeNull();
    vi.useRealTimers();
  });

  it("stops moving while the window is out of sight, and resumes when it's back", async () => {
    render(<Mesh tone="held" />);
    const mesh = screen.getByTestId("mesh-held");
    expect(mesh).not.toHaveAttribute("data-paused");
    await act(async () => setVisibility("hidden"));
    expect(mesh).toHaveAttribute("data-paused", "true");
    await act(async () => setVisibility("visible"));
    expect(mesh).not.toHaveAttribute("data-paused");
  });
});
