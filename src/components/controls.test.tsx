import { useState } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Dialog, HIT, MiniSelect, Segmented, Switch, TabPanel, inputClass } from "./controls";
import { gsap } from "../lib/gsap";
import { setReducedMotion } from "../test/motion";

const OPTIONS = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
] as const;

type V = (typeof OPTIONS)[number]["value"];

function Tabs() {
  const [v, setV] = useState<V>("day");
  return (
    <>
      <Segmented label="Range" options={OPTIONS} value={v} onChange={setV} panels="range" />
      <TabPanel base="range" value={v}>
        Showing {v}
      </TabPanel>
    </>
  );
}

function Filter() {
  const [v, setV] = useState<V>("week");
  return <Segmented label="Show" options={OPTIONS} value={v} onChange={setV} />;
}

describe("Segmented (design critique finding 10)", () => {
  it("is a tablist only when it controls panels, with each tab tied to its panel", () => {
    render(<Tabs />);
    const list = screen.getByRole("tablist", { name: "Range" });
    const tabs = screen.getAllByRole("tab");
    expect(list).toContainElement(tabs[0]!);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(tabs[1]).toHaveAttribute("aria-selected", "false");
    const panel = screen.getByRole("tabpanel");
    expect(tabs[0]).toHaveAttribute("aria-controls", panel.id);
    expect(panel).toHaveAttribute("aria-labelledby", tabs[0]!.id);
    // One tab stop: only the selected tab is in the tab order.
    expect(tabs.map((t) => t.tabIndex)).toEqual([0, -1, -1]);
    expect(tabs[0]).not.toHaveAttribute("aria-pressed");
  });

  it("moves and selects with the arrow keys, Home and End", () => {
    render(<Tabs />);
    const first = screen.getByRole("tab", { name: "Day" });
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Week" })).toHaveAttribute("aria-selected", "true");
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Week" }));
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Showing week");
    fireEvent.keyDown(document.activeElement!, { key: "End" });
    expect(screen.getByRole("tab", { name: "Month" })).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Day" })).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(document.activeElement!, { key: "ArrowLeft" });
    expect(screen.getByRole("tab", { name: "Month" })).toHaveAttribute("aria-selected", "true");
  });

  it("is an aria-pressed button group when it filters, with no tab roles", () => {
    render(<Filter />);
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByRole("tab")).toBeNull();
    expect(screen.getByRole("group", { name: "Show" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Week" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Month" }));
    expect(screen.getByRole("button", { name: "Month" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Week" })).toHaveAttribute("aria-pressed", "false");
  });
});

describe("Segmented's sliding indicator", () => {
  // jsdom has no layout: give each option the offset and width it would have.
  const LEFT: Record<string, number> = { day: 2, week: 40, month: 90 };
  const WIDTH: Record<string, number> = { day: 36, week: 48, month: 56 };
  const saved: Record<string, PropertyDescriptor | undefined> = {};
  const fake = (prop: string, table: Record<string, number>) => {
    saved[prop] = Object.getOwnPropertyDescriptor(HTMLElement.prototype, prop);
    Object.defineProperty(HTMLElement.prototype, prop, {
      configurable: true,
      get(this: HTMLElement) {
        return table[this.getAttribute("data-indicator-item") ?? ""] ?? 0;
      },
    });
  };
  beforeEach(() => {
    fake("offsetLeft", LEFT);
    fake("offsetWidth", WIDTH);
  });
  afterEach(() => {
    for (const [prop, d] of Object.entries(saved)) if (d) Object.defineProperty(HTMLElement.prototype, prop, d);
  });

  const indicator = () => document.querySelector<HTMLElement>("[data-indicator]")!;
  const x = () => Number(gsap.getProperty(indicator(), "x"));
  const width = () => parseFloat(String(gsap.getProperty(indicator(), "width")));

  it("lands on the active option without a glide, with its label readable above it", () => {
    setReducedMotion(false);
    render(<Filter />);
    expect(gsap.isTweening(indicator())).toBe(false);
    expect(x()).toBe(LEFT.week);
    expect(width()).toBe(WIDTH.week);
    expect(indicator().className).toContain("bg-raised");
    const active = screen.getByRole("button", { name: "Week" });
    expect(active.className).toContain("relative");
    expect(active.className).toContain("text-text");
  });

  it("glides to the new option when motion is on", () => {
    setReducedMotion(false);
    render(<Filter />);
    fireEvent.click(screen.getByRole("button", { name: "Month" }));
    const tweens = gsap.getTweensOf(indicator());
    expect(tweens.length).toBeGreaterThan(0);
    expect(x()).toBeLessThan(LEFT.month!); // still on its way
    act(() => tweens.forEach((t) => t.progress(1)));
    expect(x()).toBe(LEFT.month);
    expect(width()).toBe(WIDTH.month);
  });

  it("jumps under reduced motion", () => {
    render(<Tabs />);
    expect(x()).toBe(LEFT.day);
    fireEvent.click(screen.getByRole("tab", { name: "Month" }));
    expect(gsap.isTweening(indicator())).toBe(false);
    expect(x()).toBe(LEFT.month);
  });

  it("re-measures when the options change", () => {
    const { rerender } = render(<Segmented label="Show" options={OPTIONS.slice(0, 2)} value="day" onChange={() => undefined} />);
    expect(x()).toBe(LEFT.day);
    rerender(<Segmented label="Show" options={OPTIONS} value="month" onChange={() => undefined} />);
    expect(x()).toBe(LEFT.month);
    rerender(<Segmented label="Show" options={OPTIONS.slice(0, 2)} value="month" onChange={() => undefined} />);
    expect(Number(gsap.getProperty(indicator(), "opacity"))).toBe(0); // no active option, no highlight
  });
});

describe("fields", () => {
  it("draw their edge with line-input and never remove the focus outline", () => {
    expect(inputClass()).toContain("border-line-input");
    expect(inputClass()).toContain("rounded-control");
    expect(inputClass()).not.toContain("outline-none");
    render(<MiniSelect label="Length" value={25} options={[{ value: 25, label: "25 min" }]} onChange={() => undefined} />);
    const select = screen.getByRole("combobox", { name: "Length" });
    expect(select.className).toContain("border-line-input");
    expect(select.className).not.toContain("outline-none");
  });
});

describe("Dialog keyboard (M10)", () => {
  function Stack() {
    const [outer, setOuter] = useState(false);
    const [inner, setInner] = useState(false);
    return (
      <>
        <button type="button" onClick={() => setOuter(true)}>
          Open outer
        </button>
        {outer ? (
          <Dialog label="Outer" onClose={() => setOuter(false)}>
            <button type="button" onClick={() => setInner(true)}>
              Open inner
            </button>
            <button type="button">Last</button>
          </Dialog>
        ) : null}
        {inner ? (
          <Dialog label="Inner" onClose={() => setInner(false)}>
            <input aria-label="Name" />
          </Dialog>
        ) : null}
      </>
    );
  }

  it("moves focus in, wraps Tab, closes only the topmost on Escape, and gives focus back", () => {
    render(<Stack />);
    const opener = screen.getByRole("button", { name: "Open outer" });
    opener.focus();
    fireEvent.click(opener);
    const first = screen.getByRole("button", { name: "Open inner" });
    const last = screen.getByRole("button", { name: "Last" });
    expect(first).toHaveFocus();
    // Tab wraps inside the dialog, both ways.
    last.focus();
    fireEvent.keyDown(window, { key: "Tab" });
    expect(first).toHaveFocus();
    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    expect(last).toHaveFocus();

    first.focus();
    fireEvent.click(first);
    expect(screen.getByLabelText("Name")).toHaveFocus();
    // One Escape closes the inner dialog only.
    act(() => void fireEvent.keyDown(window, { key: "Escape" }));
    expect(screen.queryByRole("dialog", { name: "Inner" })).toBeNull();
    expect(screen.getByRole("dialog", { name: "Outer" })).toBeInTheDocument();
    expect(first).toHaveFocus();
    act(() => void fireEvent.keyDown(window, { key: "Escape" }));
    expect(screen.queryByRole("dialog", { name: "Outer" })).toBeNull();
    expect(opener).toHaveFocus();
  });
});

describe("Dialog focus when the opener is gone (M1)", () => {
  function Gone({ withFallback }: { withFallback: boolean }) {
    const [item, setItem] = useState(true);
    const [open, setOpen] = useState(false);
    return (
      <main>
        <button type="button" data-fallback="">
          New
        </button>
        {item ? (
          <button type="button" onClick={() => setOpen(true)}>
            Delete item
          </button>
        ) : null}
        {open ? (
          <Dialog
            label="Delete this item"
            alert
            fallback={withFallback ? () => document.querySelector<HTMLElement>("[data-fallback]") : undefined}
            onClose={() => setOpen(false)}
          >
            <button
              type="button"
              onClick={() => {
                setItem(false);
                setOpen(false);
              }}
            >
              Delete
            </button>
          </Dialog>
        ) : null}
      </main>
    );
  }

  const run = async (withFallback: boolean) => {
    render(<Gone withFallback={withFallback} />);
    const opener = screen.getByRole("button", { name: "Delete item" });
    opener.focus();
    fireEvent.click(opener);
    expect(screen.getByRole("alertdialog", { name: "Delete this item" })).toBeInTheDocument();
    act(() => void fireEvent.click(screen.getByRole("button", { name: "Delete" })));
  };

  it("lands on the passed fallback", async () => {
    await run(true);
    await waitFor(() => expect(screen.getByRole("button", { name: "New" })).toHaveFocus());
  });

  it("lands on the main region when there is no fallback, never on body", async () => {
    await run(false);
    await waitFor(() => expect(screen.getByRole("main")).toHaveFocus());
    expect(screen.getByRole("main")).toHaveAttribute("tabindex", "-1");
  });
});

describe("Switch hit area (M13)", () => {
  it("keeps the 32x18 track and adds an invisible 24px-tall hit area", () => {
    render(<Switch label="Sounds" checked={false} onChange={() => undefined} />);
    const sw = screen.getByRole("switch", { name: "Sounds" });
    expect(sw.className).toContain("h-[18px]");
    expect(sw.className).toContain("w-8");
    expect(sw.className).toContain(HIT);
    expect(HIT).toContain("before:h-[max(100%,24px)]");
    expect(HIT).toContain("before:w-[max(100%,24px)]");
  });
});
