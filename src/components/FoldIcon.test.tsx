import { render, screen } from "@testing-library/react";
import { Sidebar, StatePill } from "./Sidebar";
import { NotesPage } from "../pages/notes/NotesPage";
import { useStore } from "../state/store";
import { resetMockBackend } from "../lib/mockBackend";

const initial = useStore.getState();
beforeEach(() => {
  resetMockBackend();
  useStore.setState(initial, true);
});

/** The hover hint: hidden at rest, shown when its button is hovered or focused by keyboard. */
function expectHint(button: HTMLElement) {
  expect(button).toHaveClass("group");
  const hint = button.querySelector("[data-fold-hint]")!;
  expect(hint).not.toBeNull();
  expect(hint.getAttribute("class")).toContain("opacity-0");
  expect(hint.getAttribute("class")).toContain("group-hover:opacity-100");
  expect(hint.getAttribute("class")).toContain("group-focus-visible:opacity-100");
}

describe("fold buttons show what a click does", () => {
  it("the sidebar's button points the way it folds", () => {
    render(<Sidebar />);
    const button = screen.getByLabelText(/(Collapse|Expand) sidebar/);
    expectHint(button);
  });

  it("the notes sidebar button points the way it folds, boxed, with hover text", () => {
    render(<NotesPage />);
    const button = screen.getByRole("button", { name: /(Collapse|Expand) notes sidebar/ });
    expectHint(button);
    expect(button.querySelector("svg")).toHaveAttribute("width", "14");
    expect(button).toHaveClass("!px-0");
    expect(button).toHaveClass("h-control", "w-control");
    expect(button).toHaveAttribute("title", "Collapse notes sidebar");
  });
});

describe("the sidebar's state pill", () => {
  it("draws Open as the enabled green, like the tray and the extension", () => {
    render(<Sidebar />);
    const dot = screen.getByTestId("state-pill").querySelector("span > span") as HTMLElement;
    expect(dot).toHaveClass("bg-ok");
  });

  it("shows the extra line in the state's own font, quieter, shortening to fit", () => {
    render(<StatePill state="open" meta="Quiet to 8:00 AM" />);
    const meta = screen.getByTestId("state-meta");
    expect(meta).toHaveTextContent("Quiet to 8:00 AM");
    expect(meta).toHaveClass("text-meta", "font-medium", "text-muted", "truncate", "min-w-0");
    expect(meta).not.toHaveClass("font-mono");
    expect(meta).toHaveAttribute("title", "Quiet to 8:00 AM");
  });
});
