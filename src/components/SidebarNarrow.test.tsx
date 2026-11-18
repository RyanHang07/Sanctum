import { act, render, screen } from "@testing-library/react";
import { Sidebar } from "./Sidebar";
import { useStore } from "../state/store";
import { resetMockBackend } from "../lib/mockBackend";
import { NARROW } from "../lib/useMedia";

const initial = useStore.getState();
const real = window.matchMedia;

/** A matchMedia whose NARROW query can be flipped, firing "change" like a resize would. */
function fakeMedia(narrow: boolean) {
  let matches = narrow;
  const listeners = new Set<() => void>();
  window.matchMedia = ((q: string) => ({
    get matches() {
      return q === NARROW ? matches : false;
    },
    media: q,
    addEventListener: (_: string, f: () => void) => listeners.add(f),
    removeEventListener: (_: string, f: () => void) => listeners.delete(f),
  })) as unknown as typeof window.matchMedia;
  return (next: boolean) => {
    matches = next;
    listeners.forEach((f) => f());
  };
}

beforeEach(() => {
  resetMockBackend();
  useStore.setState(initial, true);
});
afterEach(() => {
  window.matchMedia = real;
});

describe("the fold button when the sidebar can't open", () => {
  it("fades away on a narrow window and comes back when there's room", () => {
    const resize = fakeMedia(true);
    render(<Sidebar />);
    const button = screen.getByLabelText("Expand sidebar");
    expect(button).toHaveAttribute("data-unavailable", "true");
    expect(button).toHaveAttribute("aria-hidden", "true");
    expect(button).toHaveClass("opacity-0");
    // It fades without shrinking: a 28x28 target at every width (M12).
    expect(button).toHaveClass("h-7", "w-7");
    expect(button.className).not.toMatch(/scale-75/);
    act(() => resize(false));
    expect(button).not.toHaveAttribute("data-unavailable");
    expect(button).toHaveClass("opacity-100");
    expect(button).not.toHaveAttribute("aria-hidden");
  });
});
