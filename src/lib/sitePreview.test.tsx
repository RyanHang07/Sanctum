import { fireEvent, render, screen } from "@testing-library/react";
import { ThemePreview } from "../../partner/src/site/ThemePreview";
import { THEMES } from "../theme/themes";

// The site's theme preview (v0.3): every app theme, Open or Sealed, drawn with the app's own
// colours, so the site can't show a theme the app doesn't have.

describe("the site's theme preview", () => {
  it("offers every theme and paints the window in the one picked", () => {
    render(<ThemePreview />);
    const chips = screen.getAllByRole("radio");
    expect(chips.map((c) => c.textContent)).toEqual(THEMES.map((t) => t.name));
    expect(screen.getByRole("radio", { name: "Sanctum Dark" })).toBeChecked();

    fireEvent.click(screen.getByRole("radio", { name: "Nord" }));
    const nord = THEMES.find((t) => t.id === "nord")!;
    const win = screen.getByRole("img", { name: "Sanctum in Nord, open" });
    expect(win.style.getPropertyValue("--p-app")).toBe(nord.palette.app);
    expect(win.style.getPropertyValue("--p-sealed")).toBe(nord.palette.sealed);
  });

  it("shows the window sealed, and a light theme gets the dark-ink mark", () => {
    const { container } = render(<ThemePreview />);
    fireEvent.click(screen.getByRole("button", { name: "Sealed" }));
    expect(screen.getByText("47:12")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Solarized Light" }));
    expect(screen.getByRole("img", { name: "Sanctum in Solarized Light, sealed" })).toBeInTheDocument();
    expect(container.querySelector(".tp-mark")?.getAttribute("src")).toBe("/mark-light.svg");
  });
});
