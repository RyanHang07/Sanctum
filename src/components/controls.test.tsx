import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { MiniSelect, Segmented, TabPanel, inputClass } from "./controls";

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
