import { readFileSync } from "node:fs";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { App } from "../../partner/src/App";
import { applyTheme, appTheme } from "../../partner/src/site/theme";
import { THEMES } from "../theme/themes";

// The partner site in the redesign (v0.4, S8): it follows the person's Sanctum theme when the
// link carries one, and the approve page makes "Deny, keep the seal" the primary action. Since the
// site's own redesign it is flat, moves like the app (site/motion.ts), and its home page says
// what v0.4.0 does.

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

  it("shows time left in whole minutes in accent text and asks as neutral tally ticks", async () => {
    history.replaceState(null, "", "/demo/approve");
    const { container } = render(<App />);
    await screen.findByRole("heading", { level: 1 });
    expect(container.querySelector("dd.seal-time")?.textContent).toMatch(/^\d+ min$/);
    expect(container.querySelectorAll(".tally span")).toHaveLength(2);
    const style = readFileSync("partner/src/styles.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(style).toMatch(/\.tally span \{[^}]*background: var\(--muted\)/);
    expect(style).toMatch(/\.facts dd\.seal-time \{[^}]*color: var\(--sealed-text\)/);
    expect(style).not.toMatch(/outline: none;\s*transition|var\(--faint\)|box-shadow|blur\(/);
  });

  it("follows the link's theme: no light/dark switch, no theme note, a short footer", async () => {
    history.replaceState(null, "", "/demo/approve?theme=nord");
    applyTheme();
    render(<App />);
    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByRole("button", { name: /Use the (light|dark) theme/ })).toBeNull();
    const footer = within(screen.getByRole("contentinfo"));
    expect(screen.queryByText(/Matches your Sanctum theme/)).toBeNull();
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

describe("the site's design language", () => {
  const strip = (f: string) => readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const css = ["partner/src/styles.css", "partner/src/site/site.css", "partner/src/site/docs.css", "partner/src/site/theme-preview.css"].map(strip).join(" ");

  it("is flat: no gradients, glows, blur, or decorative loops, and shadows only on popovers", () => {
    expect(css).not.toMatch(/gradient\(|blur\(|backdrop-filter|infinite|held-\d|--glass/);
    expect(css.match(/box-shadow:[^;]*/g)).toEqual(["box-shadow: var(--shadow-pop)"]);
  });

  it("uses sentence-case labels, nothing under 11px, and never faint for text", () => {
    expect(css).not.toMatch(/text-transform:\s*uppercase/);
    for (const [, px] of css.matchAll(/font-size:\s*([\d.]+)px/g)) expect(Number(px)).toBeGreaterThanOrEqual(11);
    expect(css).not.toMatch(/(^|[^-])color:\s*var\(--faint\)/m);
  });

  it("writes every headline as one plain sentence, with no italic payoff or question", () => {
    for (const f of ["partner/src/site/Home.tsx", "partner/src/site/Docs.tsx", "partner/src/site/Changelog.tsx", "partner/src/site/LegalPage.tsx", "partner/src/App.tsx"]) {
      const src = readFileSync(f, "utf8");
      expect(src).not.toMatch(/<em>/);
      for (const [, text] of src.matchAll(/className="headline"[^>]*>\s*([^<{]+?)\s*</g)) {
        expect(text).toMatch(/^[^.?]+\.$/);
      }
    }
  });

  it("puts gsap in the site at the app's version, and moves on the app's tokens", async () => {
    const root = JSON.parse(readFileSync("package.json", "utf8"));
    const site = JSON.parse(readFileSync("partner/package.json", "utf8"));
    expect(site.dependencies.gsap).toBe(root.dependencies.gsap);
    const motion = await import("../../partner/src/site/motion");
    const app = await import("./gsap");
    expect(motion.DUR).toEqual(app.DUR);
    expect(motion.RISE_FROM).toEqual(app.RISE_FROM);
    expect(motion.RISE_STAGGER).toBe(app.RISE_STAGGER);
  });
});

describe("the home page says what v0.4.0 does", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", () => Promise.reject(new Error("offline")));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("counts every theme, names Today and the weekly recap's switch, and has no middle-dot meta", async () => {
    history.replaceState(null, "", "/");
    const { container } = render(<App />);
    await screen.findByRole("heading", { level: 1, name: "Seal yourself in and finish what you started." });
    const text = container.textContent ?? "";
    expect(text).toContain(`${THEMES.length} themes, each with its own accent and second color`);
    expect(text).not.toMatch(/Thirteen|Home suggests/);
    expect(text).toContain("Today suggests it when it starts");
    expect(text).toContain("A weekly recap, off by default; turn it on in Setup › Goals.");
    expect(text).toContain("App Guard");
    expect(text).not.toContain(" Â· ");
    // The same nine screenshots as before.
    expect(container.querySelectorAll("img.shot")).toHaveLength(9);
  });

  // The docs page is a lazy chunk with every guide inlined; compiling it under a full parallel
  // run took over 10s (2026-11-24), so it loads before the test, which then times the swap alone.
  beforeAll(async () => {
    await import("../../partner/src/site/Docs");
  }, 60_000);

  it("swaps pages inside one frame: the bar stays, the page changes", async () => {
    history.replaceState(null, "", "/");
    render(<App />);
    const bar = await screen.findByRole("banner");
    await act(async () => {
      fireEvent.click(within(bar).getByRole("link", { name: "Docs" }));
    });
    // The docs page loads its guides on demand; under a full parallel run that takes a while.
    expect(await screen.findByRole("heading", { level: 1, name: "How Sanctum works." }, { timeout: 10_000 })).toBeInTheDocument();
    expect(screen.getByRole("banner")).toBe(bar);
    expect(within(bar).getByRole("link", { name: "Docs" })).toHaveAttribute("aria-current", "page");
  }, 20_000);
});

describe("the GitHub star button beside Download", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows the repo's star count once GitHub answers, and the button alone when it can't", async () => {
    const { starCount } = await import("../../partner/src/site/releases");
    expect([starCount(842), starCount(1234), starCount(12_400)]).toEqual(["842", "1.2k", "12k"]);
    vi.resetModules();
    vi.stubGlobal("fetch", (url: string) =>
      Promise.resolve(url.endsWith("/sanctum") ? new Response(JSON.stringify({ stargazers_count: 1234 })) : new Response("[]")),
    );
    const { App: Fresh } = await import("../../partner/src/App");
    history.replaceState(null, "", "/");
    render(<Fresh />);
    const star = await screen.findByRole("link", { name: "Star Sanctum on GitHub, 1234 stars" });
    expect(star).toHaveAttribute("href", "https://github.com/ryanhang07/sanctum");
    expect(within(star).getByTestId("star-count")).toHaveTextContent("1.2k");
    // It sits beside Download in the top bar.
    expect(star.nextElementSibling).toHaveTextContent("Download");
  });
});
