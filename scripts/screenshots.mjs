// README screenshots and the hero GIF, from the browser preview on its sample data (the mock
// backend). Starts its own Vite servers, drives Edge through puppeteer-core, and writes PNGs to
// docs/screenshots. The hero's clips go to docs/screenshots/frames, then scripts/make-hero.py.
//   npm run screenshots            (Edge must be installed; set EDGE_PATH if it isn't standard)
//   npm run screenshots -- stats   (only the shots whose names start with these; the hero still runs)
// Stills are taken under reduced motion, so every moment has landed on its end state; the hero's
// clips switch motion back on and slow GSAP and CSS animations alike.
import { createServer } from "vite";
import puppeteer from "puppeteer-core";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";

const ROOT = join(import.meta.dirname, "..");
const OUT = join(ROOT, "docs", "screenshots");
const FRAMES = join(OUT, "frames");
const EDGE = process.env.EDGE_PATH ?? "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const SCALE = 2;
const ONLY = process.argv.slice(2);

mkdirSync(OUT, { recursive: true });
rmSync(FRAMES, { recursive: true, force: true });
mkdirSync(FRAMES, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const app = await createServer({ root: ROOT, server: { port: 1420, strictPort: true }, logLevel: "error" });
await app.listen();
const partner = await createServer({ root: join(ROOT, "partner"), configFile: join(ROOT, "partner", "vite.config.ts"), server: { port: 5174, strictPort: true }, logLevel: "error" });
await partner.listen();
const ext = spawn(process.execPath, [join(ROOT, "scripts", "extension-preview.mjs")], { stdio: "ignore" });

const browser = await puppeteer.launch({ executablePath: EDGE, headless: true, args: ["--hide-scrollbars", "--force-color-profile=srgb"] });

/** A fresh page at the app's size (or another), with motion settled and no dev chrome. */
/** Every page runs at the same moment: Thursday, Oct 1 2026, 10:20 AM local, so times read like a workday. */
const PINNED = new Date(2026, 9, 1, 10, 20, 0).getTime();
async function open(url, { width = 1120, height = 720, reducedMotion = false } = {}) {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument((pinned) => {
    const Real = Date;
    const offset = pinned - Real.now();
    class Pinned extends Real {
      constructor(...a) {
        if (a.length === 0) super(Real.now() + offset);
        else super(...a);
      }
      static now() {
        return Real.now() + offset;
      }
    }
    window.Date = Pinned;
  }, PINNED);
  await page.setViewport({ width, height, deviceScaleFactor: SCALE });
  await motion(page, !reducedMotion);
  await page.goto(url, { waitUntil: "networkidle0" });
  await hideDev(page);
  return page;
}

/** Motion on (the app's moments play) or off (prefers-reduced-motion: every moment lands on its end). */
const motion = (page, on) => page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: on ? "no-preference" : "reduce" }]);

/** Hides the dev-only toggle, its panel and its floating surfaces, so they never show in a shot. */
const hideDev = (page) => page.addStyleTag({ content: "[data-dev-toggle],[data-dev-tools],[data-dev-surfaces]{display:none!important}" });

/** The app's own modules, the same instances the page uses (no HMR in this server). */
const mods = `
  window.__m = {
    store: (await import('/src/state/store.ts')).useStore,
    native: (await import('/src/lib/native.ts')).native,
    gsap: (await import('/src/lib/gsap.ts')).gsap,
    mock: window.__sanctumMock,
  };
`;

/** JPEG for these three (the README and site link them by these names); PNG for the rest. */
const PHOTOS = new Set(["home-sealed", "home-event", "held"]);

async function shot(page, name) {
  if (ONLY.length && !ONLY.some((o) => name.startsWith(o))) return;
  const file = PHOTOS.has(name) ? `${name}.jpg` : `${name}.png`;
  await page.screenshot(PHOTOS.has(name) ? { path: join(OUT, file), type: "jpeg", quality: 90 } : { path: join(OUT, file) });
  console.log(`docs/screenshots/${file}`);
}

/** Hero frames: a still, or a clip recorded in slow motion. */
const still = (page, name) => page.screenshot({ path: join(FRAMES, `${name}.png`) });

/**
 * Records `seconds` of a page in slow motion: CSS animations run at RATE through the DevTools
 * protocol and GSAP's moments through its global timeline, and the screencast streams a frame on
 * every repaint, so the motion is sampled densely. Writes numbered JPEGs and times.json (each
 * frame's moment at real speed, ms). The page needs `mods` loaded, and motion on.
 */
const RATE = 0.1;
async function record(page, clip, seconds, start) {
  const dir = join(FRAMES, clip);
  mkdirSync(dir, { recursive: true });
  // The clip's first frame: the page as it was before the moment starts.
  const before = await page.screenshot({ type: "jpeg", quality: 95, encoding: "base64" });
  // GSAP first: a page call sent just after Animation.enable can go unanswered in headless Edge.
  await page.evaluate((r) => window.__m.gsap.globalTimeline.timeScale(r), RATE);
  const cdp = await page.createCDPSession();
  await cdp.send("Animation.enable");
  await cdp.send("Animation.setPlaybackRate", { playbackRate: RATE });
  const shots = [];
  let t0 = null;
  cdp.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
    if (t0 !== null) shots.push({ data, t: Math.round((metadata.timestamp * 1000 - t0) * RATE) });
    void cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => undefined);
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 95, everyNthFrame: 1 });
  await sleep(300);
  t0 = Date.now();
  if (start) await start();
  await sleep((seconds * 1000) / RATE);
  await cdp.send("Page.stopScreencast");
  await cdp.send("Animation.setPlaybackRate", { playbackRate: 1 });
  await page.evaluate(() => window.__m.gsap.globalTimeline.timeScale(1));
  await cdp.detach();
  // Nothing may have repainted at the very start: begin on the page as it was.
  if (!shots.length || shots[0].t > 0) shots.unshift({ data: before, t: 0 });
  const times = [];
  shots.forEach((f, i) => {
    writeFileSync(join(dir, `${String(i).padStart(3, "0")}.jpg`), Buffer.from(f.data, "base64"));
    times.push(Math.max(0, f.t));
  });
  writeFileSync(join(dir, "times.json"), JSON.stringify(times));
  console.log(`  ${clip}: ${shots.length} frames`);
}

/** Clicks the first element of `selector` whose text matches. */
const click = (page, selector, text) =>
  page.evaluate(
    (sel, t) => {
      const el = [...document.querySelectorAll(sel)].find((e) => e.textContent?.trim().startsWith(t) || e.getAttribute("aria-label") === t);
      if (!el) throw new Error(`No ${sel} "${t}"`);
      el.click();
    },
    selector,
    text,
  );
const go = async (page, key) => {
  await page.keyboard.down("Control");
  await page.keyboard.press(key);
  await page.keyboard.up("Control");
  await sleep(700);
};
/** Waits until `fn` (run in the page) is true, or fails after `ms`. */
const until = (page, fn, ms = 8000, ...args) => page.waitForFunction(fn, { timeout: ms, polling: 50 }, ...args);
/** Waits for a GSAP moment (by timeline id) to finish, if it's running. */
const settled = (page, id) => until(page, (i) => !window.__m.gsap.getById(i)?.isActive(), 30_000, id);

/** Small windows sit on a dark surface with room around them, like on a desktop, at their own window size. */
const backdrop = (w, h) => `body{background:#07080B!important;display:grid;place-items:center;min-height:100vh;margin:0}#root{width:${w}px;height:${h}px}`;

try {
  // --- The main window: Open, the screens, then the hero's seal, held and In event ---
  const page = await open("http://localhost:1420/", { reducedMotion: true });
  await until(page, () => !document.querySelector("[data-testid=boot-splash]"), 10_000);
  await page.evaluate(`(async () => { ${mods} })()`);
  await page.evaluate(async () => {
    const { native } = window.__m;
    await native.saveNote({ title: "Books to read", body: "Deep Work, Cal Newport\nFour Thousand Weeks, Oliver Burkeman\nThe Pragmatic Programmer" });
    await native.saveNote({ title: "Weekly review", body: "- Shipped the API refactor\n- Two seals broken on Tuesday, both on YouTube\n- Mornings are the best focus time\n[x] Book the dentist\n[ ] Plan next week's deep work blocks" });
  });
  await sleep(600);
  await shot(page, "home-open");

  // Planning and review.
  await go(page, "2");
  await shot(page, "week");
  await go(page, "3");
  await sleep(500);
  await shot(page, "stats");
  await go(page, "4");
  await shot(page, "trackers");
  await go(page, "5");
  await click(page, "button", "Weekly review");
  await sleep(500);
  await shot(page, "notes");

  // The journal (v0.2): set up with evening prompts, today's page written.
  await page.evaluate(async () => {
    const { native } = window.__m;
    await native.setSetting("journal_setup", JSON.stringify({ done: true, prompts: ["refl-well", "focus-tempted"], perDay: 0 }));
    const h = (text) => ({ type: "heading", attrs: { level: 3 }, content: [{ type: "text", text }] });
    const p = (text) => ({ type: "paragraph", content: [{ type: "text", text }] });
    const doc = {
      type: "doc",
      content: [
        h("What went well?"),
        p("Two seals before lunch, and the API refactor finally merged. Mornings really are the time."),
        h("What tempted me, and when?"),
        p("YouTube right after standup, twice. Sent back both times; the second one I didn't even notice I'd typed it."),
      ],
    };
    const body = doc.content.map((n) => n.content[0].text).join("\n");
    await native.journalSave("2026-10-01", JSON.stringify(doc), body);
  });
  await go(page, "6");
  await sleep(600);
  await shot(page, "journal");

  // Setup: Focus > Distractions, and Protection > App Guard (installed, with quiet hours set).
  await page.evaluate(async () => {
    const { native, store } = window.__m;
    await native.quietSave({ enabled: true, daysMask: 0b0011111, start: "23:00", end: "07:00" });
    await store.getState().loadQuiet();
    await native.guardInstall();
  });
  await go(page, ",");
  await click(page, '[role="tab"]', "Distractions");
  await sleep(700);
  await shot(page, "setup-distractions");
  await click(page, '[role="tab"]', "App Guard");
  await sleep(700);
  await shot(page, "setup-protection");

  await go(page, "1");
  await sleep(600);

  // Hero: Open, Enter focus (the fill fades, the seal line draws along the card's foot).
  await motion(page, true);
  await sleep(300);
  await still(page, "open");
  await record(page, "seal", 1.3, async () => {
    await click(page, "button", "Enter focus");
    // Hold the countdown still while time runs slow, so it doesn't race.
    await page.evaluate(() => window.__m.mock.pauseTicks(true));
  });
  await settled(page, "enter-focus");
  await page.evaluate(() => window.__m.mock.pauseTicks(false));
  await motion(page, false);
  await sleep(800);
  await still(page, "sealed");
  await shot(page, "home-sealed");

  // The overlay a sealed app gets (its own 520 by 330 window), shot alone and for the hero.
  const overlay = await open("http://localhost:1420/#/intercept", { width: 520, height: 330, reducedMotion: true });
  await overlay.evaluate(() => window.__sanctumMock.block("Discord"));
  await until(overlay, () => !!document.querySelector("[role=alertdialog]"));
  await sleep(400);
  await overlay.screenshot({ path: join(FRAMES, "overlay.png"), omitBackground: true });
  await overlay.addStyleTag({ content: backdrop(520, 330) });
  await overlay.setViewport({ width: 640, height: 420, deviceScaleFactor: SCALE });
  await sleep(300);
  await shot(overlay, "blocked-overlay");
  await overlay.close();
  // Back to the main window: a page left in the background stops painting and answering.
  await page.bringToFront();
  // The same attempt, counted on the main window's session (each preview page has its own mock).
  await page.evaluate(() => window.__m.mock.block("Discord"));
  await sleep(300);

  // Hero: the session completes; the gate builds, then "Sanctum held." and its fact line.
  await motion(page, true);
  await record(page, "held", 2.8, () => page.evaluate(() => window.__m.mock.fastForward(121 * 60_000)));
  await settled(page, "held");
  await motion(page, false);
  await sleep(600);
  await still(page, "held");
  await shot(page, "held");
  await page.keyboard.press("Escape");
  await sleep(900);

  // Today after that session: the ruler past an hour, the first routine ticked, Next up below.
  await page.evaluate(() => {
    const label = [...document.querySelectorAll("main *")].find((e) => e.children.length === 0 && e.textContent?.trim() === "Plan the day");
    let row = label;
    while (row && !row.querySelector('[role="checkbox"], input[type="checkbox"]')) row = row.parentElement;
    row?.querySelector('[role="checkbox"], input[type="checkbox"]')?.click();
  });
  await sleep(900);
  await shot(page, "today");

  // In event: a meeting from the calendar holds focus.
  await page.evaluate(() => window.__m.mock.meetingNow(18, "Design review"));
  await sleep(1800);
  await shot(page, "home-event");

  // Compact timer and tray panel: their own small windows, mid-session.
  const startSession = async (p) => {
    await p.evaluate(`(async () => { ${mods} })()`);
    await p.evaluate(async () => {
      const { native } = window.__m;
      const prof = await native.createProfile({ name: "Deep Work" });
      await native.startSession(prof.id, 90);
      window.__m.mock.fastForward(38 * 60_000 + 46_000);
    });
    await sleep(1600);
  };
  const compact = await open("http://localhost:1420/#/compact", { width: 300, height: 58, reducedMotion: true });
  await startSession(compact);
  await compact.addStyleTag({ content: backdrop(300, 58) });
  await compact.setViewport({ width: 420, height: 150, deviceScaleFactor: SCALE });
  await sleep(300);
  await shot(compact, "compact");
  await compact.close();

  const tray = await open("http://localhost:1420/#/tray", { width: 340, height: 440, reducedMotion: true });
  await tray.evaluate(`(async () => { ${mods} })()`);
  await tray.evaluate(async () => {
    const { seedDevProfiles, seedDevPlanner } = await import("/src/lib/devSeed.ts");
    await seedDevProfiles();
    await seedDevPlanner();
    window.dispatchEvent(new Event("focus"));
    return (await window.__m.native.listProfiles()).length;
  }).then((n) => n || console.warn("tray: no profiles seeded"));
  await sleep(800);
  await tray.addStyleTag({ content: backdrop(340, 440) });
  await tray.setViewport({ width: 460, height: 560, deviceScaleFactor: SCALE });
  await sleep(300);
  await shot(tray, "tray");
  await tray.close();

  // Partner page, on a phone.
  const phone = await open("http://localhost:5174/demo/approve", { width: 390, height: 844, reducedMotion: true });
  await sleep(600);
  await shot(phone, "partner-approve");
  await phone.close();

  // The browser extension's sealed page.
  const blocked = await open("http://localhost:5175/blocked.html?site=youtube.com&state=sealed", { reducedMotion: true });
  await sleep(600);
  await shot(blocked, "extension-blocked");
  await blocked.close();
} finally {
  await browser.close();
  await app.close();
  await partner.close();
  ext.kill();
}
