import { readFileSync } from "node:fs";
import { fireEvent, render, screen } from "@testing-library/react";
import { ThemePreview } from "../../partner/src/site/ThemePreview";
import { THEMES } from "../theme/themes";
import { OPEN, SEALED } from "../pages/headlines";

// The site's theme preview (v0.3, redrawn for v0.4): every app theme, Open or Sealed, drawn with
// the app's own colors, so the site can't show a theme the app doesn't have; and drawn like Today
// is now: flat, the ruler, the fixed top slot, whole minutes left, the seal line.

const dark = THEMES.filter((t) => t.scheme === "dark");
const light = THEMES.filter((t) => t.scheme === "light");

describe("the site's theme preview", () => {
  it("offers every theme, dark and light, and paints the window in the one picked", () => {
    render(<ThemePreview />);
    expect(screen.getAllByRole("radio").map((c) => c.textContent)).toEqual(dark.map((t) => t.name));
    expect(screen.getByRole("radio", { name: "Sanctum Dark" })).toBeChecked();

    fireEvent.click(screen.getByRole("radio", { name: "Nord" }));
    const nord = THEMES.find((t) => t.id === "nord")!;
    const win = screen.getByRole("img", { name: "Sanctum in Nord, open" });
    expect(win.style.getPropertyValue("--p-app")).toBe(nord.palette.app);
    expect(win.style.getPropertyValue("--p-sealed")).toBe(nord.palette.sealed);
    expect(win.style.getPropertyValue("--p-second")).toBe(nord.palette.second);

    // Light lists the rest, and picks a light theme so the window matches the list.
    fireEvent.click(screen.getByRole("button", { name: "Light" }));
    expect(screen.getAllByRole("radio").map((c) => c.textContent)).toEqual(light.map((t) => t.name));
    expect(screen.getByRole("radio", { name: light[0]!.name })).toBeChecked();
    expect(dark.length + light.length).toBe(THEMES.length);
  });

  it("draws Today: the app's headline, the ruler with its goal tick, and the top slot", () => {
    const { container } = render(<ThemePreview />);
    expect(screen.getByText(OPEN[5]!)).toBeInTheDocument();
    expect(container.querySelector(".tp-ruler .tp-tick.goal")).toBeInTheDocument();
    expect(container.querySelector(".tp-card .tp-slot")).toBeInTheDocument();
    expect(screen.getByText("Enter focus")).toBeInTheDocument();
    expect(screen.getByText("Next up")).toBeInTheDocument();
  });

  it("shows the window sealed in whole minutes with the seal line, and a light theme gets the dark-ink mark", () => {
    const { container } = render(<ThemePreview />);
    fireEvent.click(screen.getByRole("button", { name: "Sealed" }));
    expect(screen.getByRole("button", { name: "Sealed" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("47 min")).toBeInTheDocument();
    expect(screen.queryByText(/\d+:\d{2}$/)).toBeNull();
    expect(screen.getByText(SEALED[0]!)).toBeInTheDocument();
    // The same top slot, now the sealed one, and the seal line across the card's foot.
    expect(container.querySelector(".tp-card.sealed .tp-slot .tp-chip-state")).toHaveTextContent("Sealed");
    expect(container.querySelector("[data-seal-line]")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Light" }));
    fireEvent.click(screen.getByRole("radio", { name: "Solarized Light" }));
    expect(screen.getByRole("img", { name: "Sanctum in Solarized Light, sealed" })).toBeInTheDocument();
    expect(container.querySelector(".tp-mark")?.getAttribute("src")).toBe("/mark-light.svg");
  });

  it("is flat: no gradient, glow, or blur in its styles", () => {
    const css = readFileSync("partner/src/site/theme-preview.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(css).not.toMatch(/gradient\(|blur\(|box-shadow|held-\d/);
  });
});
