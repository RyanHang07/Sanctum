import { render } from "@testing-library/react";
import { Mark } from "./Mark";

describe("Mark", () => {
  it("renders a theme-aware keyhole mark that follows accent color", () => {
    const { container } = render(<Mark size={18} />);
    const svg = container.querySelector("svg");
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute("width", "18");
    // Torii follows current text color; keyhole follows theme accent.
    expect(svg?.querySelector("path[fill='currentColor']")).toBeInTheDocument();
    const accent = svg?.querySelector("g.text-sealed");
    expect(accent).toBeInTheDocument();
    expect(accent?.querySelector("circle[fill='currentColor']")).toBeInTheDocument();
  });
});
