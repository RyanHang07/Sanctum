// The sealed-site page (design/screens/SiteBlocked.dc.html): what's sealed and for how long,
// a way back to the page you were on, and the block logged once as an attempt.

import { countdown, siteLabel } from "./rules.js";

const params = new URLSearchParams(location.search);
const site = params.get("site") ?? "";
const keyword = params.get("keyword");

const $ = (id) => document.getElementById(id);
document.title = `${keyword ? `“${keyword}”` : site || "Sealed"} · Sanctum`;

void chrome.runtime.sendMessage({ type: "blocked", site, keyword });

const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

let state = null;

function headline(lead, payoff) {
  const h = document.querySelector("h1");
  h.replaceChildren(`${lead} `, Object.assign(document.createElement("em"), { textContent: payoff }));
}

function render() {
  if (!state) return;
  const { rules, connected, back } = state;
  const backLabel = back ? siteLabel(back) : null;
  if (!rules?.sealed) {
    // The seal is over: offer the site back.
    $("chip").hidden = true;
    headline("You're open", "again.");
    $("body").textContent = site ? `${site} opens normally now.` : "Sites open normally now.";
    $("back").textContent = site ? `Open ${site}` : "Go back";
    return;
  }
  headline(keyword ? `Pages about “${keyword}”` : `${site || "This site"} stays`, keyword ? "stay sealed." : "sealed.");
  $("back").textContent = backLabel ? `Back to ${backLabel}` : "Close this tab";
  const body = $("body");
  if (rules.endsAt) {
    $("chip").hidden = false;
    $("until").textContent = `Sealed until ${clock(rules.endsAt)}`;
    body.replaceChildren(
      `You're in ${rules.profile ?? "a focus session"} for `,
      Object.assign(document.createElement("span"), { className: "mono", textContent: countdown(rules.endsAt - Date.now()) }),
      keyword ? " more. They open again when it ends." : " more. Scrolling is how mid happens.",
    );
  } else {
    body.textContent = "You're sealed in. Scrolling is how mid happens.";
  }
  $("offline").hidden = connected;
}

async function refresh() {
  state = await chrome.runtime.sendMessage({ type: "state?" }).catch(() => null);
  render();
}

$("back").addEventListener("click", () => {
  const rules = state?.rules;
  if (rules && !rules.sealed && site) location.href = `https://${site}`;
  else if (state?.back) location.href = state.back;
  else window.close();
});
$("open").addEventListener("click", () => void chrome.runtime.sendMessage({ type: "open-sanctum" }));

void refresh();
setInterval(render, 1000);
setInterval(refresh, 5000);
