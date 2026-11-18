import { render, screen } from "@testing-library/react";
import { Sidebar } from "./Sidebar";
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

  it("the notes list button points the way it folds, at a bigger size", () => {
    render(<NotesPage />);
    const button = screen.getByRole("button", { name: /(Hide|Show) notes list/ });
    expectHint(button);
    expect(button.querySelector("svg")).toHaveAttribute("width", "20");
  });
});
