// Dev only: serves extension/ with a stand-in for the chrome.* APIs, so the blocked page and
// the popup can be looked at in any browser, or framed in the app's dev panel. npm run ext:preview, then open
//   http://localhost:5175/blocked.html?site=youtube.com&state=sealed
//   http://localhost:5175/blocked.html?site=example.com&keyword=shorts&state=offline
//   http://localhost:5175/blocked.html?site=youtube.com&pause=1&state=open   (Pause mode)
//   http://localhost:5175/popup.html?state=sealed   (or open, offline)
//
// In a frame (the dev panel), the parent can post { sanctumTheme: { scheme, palette } } to paint
// the page in the app's theme, as the app does over native messaging; the page posts back
// { sanctumPreviewHeight } so the panel can size the popup to its content, as Chrome does.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const ROOT = join(import.meta.dirname, "..", "extension");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".woff2": "font/woff2", ".json": "application/json", ".svg": "image/svg+xml" };

const STUB = `<script>
const q = new URLSearchParams(location.search);
const kind = q.get("state") ?? "sealed";
const endsAt = Date.now() + 32 * 60000 + 14000;
const rules = kind === "open" ? { sealed: false, sites: [], keywords: [] }
  : { sealed: true, session: true, plan: "stand up and stretch", profile: "Deep Work", endsAt, sites: [{ domain: "youtube.com" }, { domain: "reddit.com" }, { domain: "x.com" }], keywords: ["shorts"] };
const answers = { "state?": () => ({ rules, connected: kind !== "offline", back: "https://neetcode.io/practice" }), "rules?": () => rules, park: () => true, "pause-go": () => false };
// The theme, as the background keeps it in storage: none until the parent frame sends one.
let theme;
let firstTheme;
const themed = new Promise((r) => (firstTheme = r));
const changed = [];
const local = {
  get: async () => ({ theme: theme ?? (window.parent === window ? undefined : await Promise.race([themed, new Promise((r) => setTimeout(r, 1500))])) }),
  set: async () => {},
};
window.chrome = {
  runtime: { sendMessage: async (m) => answers[m.type]?.() },
  storage: { local, onChanged: { addListener: (f) => changed.push(f) } },
};
addEventListener("message", (e) => {
  if (e.source !== window.parent || !e.data || typeof e.data.sanctumTheme !== "object") return;
  const old = theme;
  theme = e.data.sanctumTheme;
  firstTheme(theme);
  for (const f of changed) f({ theme: { oldValue: old, newValue: theme } }, "local");
});
if (window.parent !== window) {
  addEventListener("DOMContentLoaded", () => {
    const tell = () => window.parent.postMessage({ sanctumPreviewHeight: Math.ceil(document.body.getBoundingClientRect().height) }, "*");
    new ResizeObserver(tell).observe(document.body);
  });
}
</script>`;

const PORT = Number(process.env.PORT) || 5175;

// blocked.js empties itself in a frame (no clickjacking on the real, web-accessible page). The
// preview is only ever framed by the dev panel, so the guard is switched off here, not in the extension.
const FRAME_GUARD = "if (window.top !== window) {";

createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^[\\/]+/, "");
  if (path.includes("..") || path.includes(".key.pem")) return res.writeHead(404).end();
  try {
    let body = await readFile(join(ROOT, path || "popup.html"));
    const type = TYPES[extname(path)] ?? "application/octet-stream";
    if (type === "text/html") body = Buffer.from(body.toString().replace("<head>", `<head>${STUB}`));
    if (path === "blocked.js") {
      const text = body.toString();
      if (!text.includes(FRAME_GUARD)) console.warn("blocked.js: the frame guard changed; the dev panel's blocked page may stay blank.");
      body = Buffer.from(text.replace(FRAME_GUARD, "if (false) {"));
    }
    // Always fresh: the extension's files change while this runs.
    res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" }).end(body);
  } catch {
    res.writeHead(404).end();
  }
}).listen(PORT, () => console.log(`Extension preview on http://localhost:${PORT}/popup.html?state=sealed`));
