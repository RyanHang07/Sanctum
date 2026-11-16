import { readFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import { Headline } from "./Onboarding";
import { ONBOARDING } from "../headlines";

describe("<Headline> (2026-11-15 headline rule)", () => {
  it("renders one sentence with no italic payoff", () => {
    render(<Headline title={ONBOARDING.browser} sub="The extension blocks your distracting sites." />);
    const h = screen.getByRole("heading", { level: 1 });
    expect(h).toHaveTextContent("Seal the browser too.");
    expect(h.querySelector("em")).toBeNull();
  });

  it("still takes the old lead and payoff, joined into plain text", () => {
    render(<Headline lead="Set the" payoff="bar." sub="A day keeps your streak when you reach the goal." />);
    const h = screen.getByRole("heading", { level: 1 });
    expect(h.textContent).toBe("Set the bar.");
    expect(h.querySelector("em")).toBeNull();
  });
});

describe("shared type styles", () => {
  const css = readFileSync("src/styles.css", "utf8");

  it("sets headlines in Schibsted Grotesk, bundled Latin only, with no serif payoff", () => {
    expect(css).toMatch(/\.headline \{\s*@apply font-headline/);
    expect(css).toContain("schibsted-grotesk-latin-wght-normal.woff2");
    expect(css).not.toMatch(/instrument-serif|font-serif|text-payoff/);
  });

  it("keeps labels sentence case", () => {
    const label = css.slice(css.indexOf(".label {"), css.indexOf("}", css.indexOf(".label {")));
    expect(label).toContain("text-transform: none");
    expect(label).not.toMatch(/uppercase|text-faint/);
  });
});
