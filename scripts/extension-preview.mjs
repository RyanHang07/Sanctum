// Dev only: serves extension/ with a stand-in for the chrome.* APIs, so the blocked page and
// the popup can be looked at in any browser. npm run ext:preview, then open
//   http://localhost:5175/blocked.html?site=youtube.com&state=sealed
//   http://localhost:5175/blocked.html?site=example.com&keyword=shorts&state=offline
//   http://localhost:5175/popup.html?state=sealed   (or open, offline)
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
  : { sealed: true, profile: "Interview Prep", endsAt, sites: [{ domain: "youtube.com" }, { domain: "reddit.com" }, { domain: "x.com" }], keywords: ["shorts"] };
window.chrome = { runtime: { sendMessage: async (m) => m.type === "state?" ? { rules, connected: kind !== "offline", back: "https://neetcode.io/practice" } : m.type === "rules?" ? rules : undefined } };
</script>`;

createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^[\\/]+/, "");
  if (path.includes("..") || path.includes(".key.pem")) return res.writeHead(404).end();
  try {
    let body = await readFile(join(ROOT, path || "popup.html"));
    const type = TYPES[extname(path)] ?? "application/octet-stream";
    if (type === "text/html") body = Buffer.from(body.toString().replace("<head>", `<head>${STUB}`));
    res.writeHead(200, { "Content-Type": type }).end(body);
  } catch {
    res.writeHead(404).end();
  }
}).listen(5175, () => console.log("Extension preview on http://localhost:5175/popup.html?state=sealed"));
