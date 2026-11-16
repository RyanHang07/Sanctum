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

  it("only takes a title, so every step's headline comes from ONBOARDING", () => {
    const source = readFileSync("src/pages/onboarding/Onboarding.tsx", "utf8");
    expect(source).not.toMatch(/<Headline[^>]*\b(lead|payoff)=/);
    const titles = [...source.matchAll(/<Headline title=\{([^}]+)\}/g)].map((m) => m[1]);
    expect(titles).toHaveLength(8);
    for (const t of titles) expect(t).toMatch(/^ONBOARDING\./);
  });

  it("reads every step title as one plain sentence, with no question", () => {
    const all: string[] = [...Object.values(ONBOARDING).flatMap((v) => (typeof v === "string" ? [v] : [])), ONBOARDING.profile("Deep Work")];
    for (const t of all) {
      expect(t).not.toContain("?");
      expect(t.match(/[.!]/g)).toHaveLength(1);
      expect(t.endsWith(".")).toBe(true);
    }
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
