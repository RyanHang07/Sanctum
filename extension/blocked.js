// The sealed-site page: says what's sealed and for how long, and logs the block once.

const params = new URLSearchParams(location.search);
const site = params.get("site") ?? "";
const keyword = params.get("keyword");

const $ = (id) => document.getElementById(id);
$("what").textContent = keyword ? `“${keyword}”` : site || "This site";
document.title = `${keyword ? keyword : site} · Sealed`;

void chrome.runtime.sendMessage({ type: "blocked", site, keyword });

const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
function countdown(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

let rules = null;

function render() {
  if (!rules) return;
  if (!rules.sealed) {
    // The seal is over: offer the site back.
    $("chip").hidden = true;
    document.querySelector("h1").innerHTML = "";
    document.querySelector("h1").append("You're open again. ", Object.assign(document.createElement("em"), { textContent: "Go on." }));
    $("body").textContent = site ? `${site} opens normally now.` : "Sites open normally now.";
    $("back").textContent = site ? `Open ${site}` : "Go back";
    return;
  }
  if (rules.endsAt) {
    $("chip").hidden = false;
    $("until").textContent = `Sealed until ${clock(rules.endsAt)}`;
    const body = $("body");
    body.textContent = `You're in ${rules.profile ?? "a focus session"} for `;
    body.append(Object.assign(document.createElement("span"), { className: "mono", textContent: countdown(rules.endsAt - Date.now()) }));
    body.append(keyword ? ` more. Pages about “${keyword}” wait until then.` : " more. Scrolling is how mid happens.");
  }
}

async function refresh() {
  rules = await chrome.runtime.sendMessage({ type: "rules?" }).catch(() => null);
  render();
}

$("back").addEventListener("click", () => {
  if (rules && !rules.sealed && site) location.href = `https://${site}`;
  else if (history.length > 1) history.back();
  else location.href = "about:blank";
});
$("open").addEventListener("click", () => void chrome.runtime.sendMessage({ type: "open-sanctum" }));

void refresh();
setInterval(render, 1000);
setInterval(refresh, 5000);
