import { act, render } from "@testing-library/react";
import { PendingTab } from "./Pending";
import { gsap } from "../../lib/gsap";
import { resetMockBackend } from "../../lib/mockBackend";
import { moment, seek, setReducedMotion } from "../../test/motion";

beforeEach(() => resetMockBackend());

describe("Pending opens in two beats", () => {
  it("the panel grows to its height first, then the rows cascade in", () => {
    setReducedMotion(false);
    const { getByRole, getByTestId } = render(<PendingTab />);
    act(() => getByRole("button", { name: "Show pending" }).click());
    const tl = moment("pending-cascade")!;
    expect(tl).toBeDefined();
    const list = getByTestId("pending-tab").querySelector<HTMLElement>("[data-pending-list]")!;
    const first = list.firstElementChild!;
    seek(tl, 0);
    expect(gsap.getProperty(list, "height")).toBe(0);
    expect(Number(gsap.getProperty(first, "opacity"))).toBe(0);
    // Once the panel has grown, the rows are still on their way in.
    seek(tl, 0.17);
    expect(Number(gsap.getProperty(first, "opacity"))).toBeLessThan(0.5);
    seek(tl, tl.duration());
    expect(Number(gsap.getProperty(first, "opacity"))).toBe(1);
    expect(list.style.height).toBe("");
  });

  it("opens at once under reduced motion", () => {
    setReducedMotion(true);
    const { getByRole } = render(<PendingTab />);
    act(() => getByRole("button", { name: "Show pending" }).click());
    expect(moment("pending-cascade")!.progress()).toBe(1);
  });
});
