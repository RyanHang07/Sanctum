import { readFileSync } from "node:fs";

// The extension's popup and sealed-site page in the redesign's roles (v0.4, S8): each page is
// loaded from its real HTML, its script run against a stand-in chrome, and its CSS read for the
// roles it uses.

type State = { rules: Record<string, unknown> | null; connected: boolean; back?: string | null };

function page(file: "popup.html" | "blocked.html") {
  const html = readFileSync(`extension/${file}`, "utf8");
  document.body.innerHTML = /<body>([\s\S]*)<\/body>/.exec(html)![1]!.replace(/<script[\s\S]*?<\/script>/g, "");
  delete document.body.dataset.state;
  delete document.body.dataset.connected;
}

async function run(script: "popup.js" | "blocked.js", state: State) {
  vi.resetModules();
  const sent: Record<string, unknown>[] = [];
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: {
      sendMessage: async (m: Record<string, unknown>) => {
        sent.push(m);
        return m.type === "state?" ? state : true;
      },
    },
  };
  await import(/* @vite-ignore */ `../../extension/${script}`);
  for (let i = 0; i < 10; i++) await Promise.resolve();
  return sent;
}

const $ = (id: string) => document.getElementById(id)!;
/** A stylesheet without its comments. */
const css = (file: string) => readFileSync(`extension/${file}`, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const SEALED = (over: Record<string, unknown> = {}) => ({ sealed: true, endsAt: Date.now() + 38 * 60_000, profile: "Interview Prep", sites: ["youtube.com"], keywords: [], ...over });

beforeEach(() => vi.useFakeTimers({ toFake: ["setInterval", "Date"] }));
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  history.replaceState(null, "", "/");
});

describe("extension popup", () => {
  it("shows the seal: time left in accent text, the planned end with its accent tick", async () => {
    page("popup.html");
    await run("popup.js", { rules: SEALED(), connected: true });
    expect(document.body.dataset.state).toBe("sealed");
    expect($("timer").textContent).toBe("38:00");
    expect($("until").textContent).toMatch(/^until /);
    expect($("until").parentElement!.hidden).toBe(false);
    expect($("conn").textContent).toBe("Connected to Sanctum");
    const style = css("popup.css");
    expect(style).toMatch(/\.timer \{[^}]*color: var\(--sealed-text\)/);
    expect(style).toMatch(/\.end-tick \{[^}]*background: var\(--sealed\)/);
  });

  it("is green when open, with a plain one-sentence title in the headline font", async () => {
    page("popup.html");
    await run("popup.js", { rules: null, connected: false });
    expect(document.body.dataset.state).toBe("open");
    expect($("open").hidden).toBe(false);
    expect(document.querySelector("#open h1")!.textContent).toBe("Nothing is sealed.");
    expect($("conn").textContent).toBe("Sanctum isn't running");
    const style = css("popup.css");
    expect(style).toMatch(/\.title \{[^}]*font-family: var\(--font-headline\)/);
    // Open is the app's enabled green (2026-11-20), with the default green before a theme arrives.
    expect(style).toMatch(/\.pill \.dot \{[^}]*background: var\(--ok, var\(--open\)\)/);
    expect(style).not.toMatch(/var\(--faint\)|var\(--second/);
  });

  it("hides the end tick when the seal has no end time", async () => {
    page("popup.html");
    await run("popup.js", { rules: SEALED({ endsAt: null }), connected: true });
    expect($("until").parentElement!.hidden).toBe(true);
  });
});

describe("extension sealed-site page", () => {
  it("counts down Pause mode's five seconds as ticks, the next to go out in the accent", async () => {
    history.replaceState(null, "", "/blocked.html?pause=1&site=youtube.com");
    page("blocked.html");
    await run("blocked.js", { rules: null, connected: true });
    const ticks = () => [...$("wait").children].map((t) => t.className);
    expect(document.body.dataset.state).toBe("pause");
    expect($("wait").hidden).toBe(false);
    expect(ticks()).toEqual(["", "", "", "", "next"]);
    expect(($("open") as HTMLButtonElement).disabled).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(ticks()).toEqual(["", "", "", "next", "out"]);
    vi.advanceTimersByTime(4000);
    expect($("wait").hidden).toBe(true);
    expect(($("open") as HTMLButtonElement).disabled).toBe(false);
  });

  it("marks the page sealed, so the keyhole breathes", async () => {
    history.replaceState(null, "", "/blocked.html?site=youtube.com");
    page("blocked.html");
    await run("blocked.js", { rules: SEALED({ plan: "I'll stand up and refill my water" }), connected: true, back: null });
    expect(document.body.dataset.state).toBe("sealed");
    expect($("wait").hidden).toBe(true);
    expect($("plan").textContent).toBe("If you're tempted, you said you'd stand up and refill my water.");
    expect(document.querySelector("#body .mono")!.textContent).toBe("38:00");
  });

  it("uses the new roles: a neutral plan panel, readable foot, a real focus style, no glow", () => {
    const style = css("blocked.css");
    const plan = /\.plan \{([^}]*)\}/.exec(style)![1]!;
    expect(plan).not.toMatch(/border-left/);
    expect(plan).toMatch(/background: var\(--raised\)/);
    expect(/\.foot \{([^}]*)\}/.exec(style)![1]).toMatch(/color: var\(--muted\)/);
    expect(style).not.toMatch(/outline: none|var\(--faint\)|box-shadow|blur\(|gradient/);
    expect(style).toMatch(/button:focus-visible \{[^}]*outline: 2px solid var\(--sealed\)/);
    expect(style).toMatch(/\.mono \{[^}]*color: var\(--sealed-text\)/);
    expect(style).toMatch(/prefers-reduced-motion: reduce[\s\S]*\.keyhole \{ animation: none; \}/);
  });
});

describe("extension fonts", () => {
  it("bundles Schibsted Grotesk as the Latin subset, about 40 KB, and both pages' headlines use it", () => {
    const size = readFileSync("extension/fonts/schibsted-grotesk.woff2").byteLength;
    expect(size).toBeLessThan(60_000);
    expect(css("tokens.css")).toMatch(/--font-headline: "Schibsted Grotesk"/);
    expect(css("blocked.css")).toMatch(/h1 \{[^}]*font-family: var\(--font-headline\)/);
  });
});
