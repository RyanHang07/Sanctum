// The sealed-site page (design/screens/SiteBlocked.dc.html): what's sealed and for how long,
// a way back to the page you were on, and the block logged once as an attempt.

import { countdown, siteLabel } from "./rules.js";

const params = new URLSearchParams(location.search);
const site = params.get("site") ?? "";
const keyword = params.get("keyword");

const $ = (id) => document.getElementById(id);
document.title = `${keyword ? `“${keyword}”` : site || "Sealed"} · Sanctum`;

/** Counted once as an attempt, and only while a seal is on (not when the page is showing "open"). */
let reported = false;

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
  // The seal's if-then plan (v0.3.1), and a place to park the thought that brought you here.
  $("plan").hidden = !rules.plan;
  if (rules.plan) $("plan").textContent = `If you're tempted, you said you'd ${rules.plan.trim().replace(/^i(?:'|’)ll\s+/i, "").replace(/[.!]+$/, "")}.`;
  $("park").hidden = !(rules.session && connected);
  $("offline").hidden = connected;
}

async function refresh() {
  state = await chrome.runtime.sendMessage({ type: "state?" }).catch(() => null);
  if (state?.rules?.sealed && !reported) {
    reported = true;
    void chrome.runtime.sendMessage({ type: "blocked", site, keyword });
  }
  render();
}

$("back").addEventListener("click", async () => {
  const rules = state?.rules;
  if (rules && !rules.sealed && site) {
    // Clear any blocking rule left over first, or the site would redirect straight back here.
    await chrome.runtime.sendMessage({ type: "resync" }).catch(() => null);
    location.href = `https://${site}`;
  } else if (state?.back) location.href = state.back;
  else window.close();
});
$("open").addEventListener("click", () => void chrome.runtime.sendMessage({ type: "open-sanctum" }));
$("park").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = $("park-text");
  const text = input.value.trim();
  if (!text) return;
  const ok = await chrome.runtime.sendMessage({ type: "park", text }).catch(() => false);
  $("parked").hidden = false;
  $("parked").textContent = ok ? "Parked. It's on today's list for after the seal." : "Couldn't park it. Sanctum isn't answering.";
  if (ok) input.value = "";
});

void refresh();
setInterval(render, 1000);
setInterval(refresh, 5000);
