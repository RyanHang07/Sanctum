import { readFileSync } from "node:fs";
import { render, screen, within } from "@testing-library/react";
import { App } from "../../partner/src/App";
import { applyTheme, appTheme } from "../../partner/src/site/theme";
import { THEMES } from "../theme/themes";

// The partner site in the redesign (v0.4, S8): it follows the person's Sanctum theme when the
// link carries one, and the approve page makes "Deny, keep the seal" the primary action.

const root = document.documentElement;

afterEach(() => {
  applyTheme("system");
  sessionStorage.clear();
  history.replaceState(null, "", "/");
});

describe("the site follows the person's Sanctum theme", () => {
  it("paints an app theme's own palette on the page, and takes it off again", () => {
    const nord = appTheme("nord")!;
    applyTheme({ app: "nord" });
    expect(root.style.getPropertyValue("--app")).toBe(nord.palette.app);
    expect(root.style.getPropertyValue("--sealed")).toBe(nord.palette.sealed);
    expect(root.style.getPropertyValue("--second")).toBe(nord.palette.second);
    // The app's sealed-on is the site's on-sealed.
    expect(root.style.getPropertyValue("--on-sealed")).toBe(nord.palette["sealed-on"]);
    expect(root.dataset.appTheme).toBe("nord");
    expect(root.dataset.theme).toBe(nord.scheme);
    applyTheme("system");
    expect(root.style.getPropertyValue("--app")).toBe("");
    expect(root.dataset.appTheme).toBeUndefined();
    expect(root.dataset.theme).toBeUndefined();
  });

  it("reads ?theme=<id> for the visit, a light theme sets the light mark, and unknown values are ignored", () => {
    const light = THEMES.find((t) => t.scheme === "light")!;
    history.replaceState(null, "", `/approve/x?theme=${light.id}`);
    applyTheme();
    expect(root.dataset.appTheme).toBe(light.id);
    expect(root.dataset.theme).toBe("light");
    // Still this visit's theme after moving to another page.
    history.replaceState(null, "", "/partner");
    applyTheme();
    expect(root.dataset.appTheme).toBe(light.id);

    sessionStorage.clear();
    history.replaceState(null, "", "/partner?theme=javascript:alert(1)");
    applyTheme();
    expect(root.dataset.appTheme).toBeUndefined();
    expect(root.style.getPropertyValue("--app")).toBe("");
    // The older light/dark values still work.
    history.replaceState(null, "", "/partner?theme=light");
    applyTheme();
    expect(root.dataset.theme).toBe("light");
    expect(root.dataset.appTheme).toBeUndefined();
  });
});

describe("the approve page", () => {
  it("makes deny the primary, first in both visual and tab order, with one-sentence headlines", async () => {
    history.replaceState(null, "", "/demo/approve");
    render(<App />);
    const heading = await screen.findByRole("heading", { level: 1 });
    expect(heading).toHaveTextContent("Alex wants out early.");
    expect(heading.querySelector("em")).toBeNull();
    const deny = screen.getByRole("button", { name: "Deny, keep the seal" });
    const approve = screen.getByRole("button", { name: "Approve, end it" });
    expect(deny).toHaveClass("primary");
    expect(approve).toHaveClass("ghost");
    expect(approve).not.toHaveClass("primary", "light");
    expect(deny.compareDocumentPosition(approve) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // No reversed order on phones (WCAG 1.3.2).
    expect(readFileSync("partner/src/styles.css", "utf8")).not.toMatch(/column-reverse/);
  });

  it("shows time left in accent text and asks as neutral tally ticks", async () => {
    history.replaceState(null, "", "/demo/approve");
    const { container } = render(<App />);
    await screen.findByRole("heading", { level: 1 });
    expect(container.querySelector("dd.seal-time")).toBeInTheDocument();
    expect(container.querySelectorAll(".tally span")).toHaveLength(2);
    const style = readFileSync("partner/src/styles.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(style).toMatch(/\.tally span \{[^}]*background: var\(--muted\)/);
    expect(style).toMatch(/\.facts dd\.seal-time \{[^}]*color: var\(--sealed-text\)/);
    expect(style).not.toMatch(/outline: none;\s*transition|var\(--faint\)|box-shadow|blur\(/);
  });

  it("follows the link's theme: no light/dark switch, a note naming the theme, a short footer", async () => {
    history.replaceState(null, "", "/demo/approve?theme=nord");
    applyTheme();
    render(<App />);
    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByRole("button", { name: /Use the (light|dark) theme/ })).toBeNull();
    const footer = within(screen.getByRole("contentinfo"));
    expect(footer.getByText(/Matches your Sanctum theme, Nord/)).toBeInTheDocument();
    expect(footer.getAllByRole("link").map((a) => a.textContent)).toEqual(["Privacy", "GitHub"]);
  });

  it("keeps the switch on a plain visit", async () => {
    history.replaceState(null, "", "/demo/approve");
    applyTheme();
    render(<App />);
    await screen.findByRole("heading", { level: 1 });
    expect(screen.getByRole("button", { name: /Use the (light|dark) theme/ })).toBeInTheDocument();
    expect(screen.queryByText(/Matches your Sanctum theme/)).toBeNull();
  });
});

describe("the site's credits", () => {
  it("names Schibsted Grotesk, not Instrument Serif, among the fonts", () => {
    const legal = readFileSync("partner/src/site/LegalPage.tsx", "utf8");
    expect(legal).toMatch(/Geist, Geist Mono, Schibsted Grotesk\) are under the SIL Open Font License/);
    expect(legal).not.toMatch(/Instrument/);
    const notices = readFileSync("partner/src/site/notices.json", "utf8");
    expect(notices).toMatch(/schibsted-grotesk/);
    expect(notices).not.toMatch(/instrument-serif/);
  });
});
