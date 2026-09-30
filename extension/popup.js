// The toolbar popup: sealed or open, time left, what's sealed, and whether Sanctum is connected.

import { countdown, sealedSummary } from "./rules.js";

const $ = (id) => document.getElementById(id);
const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

let state = null;

function render() {
  if (!state) return;
  const { rules, connected } = state;
  const sealed = !!rules?.sealed;
  document.body.dataset.state = sealed ? "sealed" : "open";
  $("state").textContent = sealed ? "Sealed" : "Open";
  $("sealed").hidden = !sealed;
  $("open").hidden = sealed;
  if (sealed) {
    $("timer").textContent = rules.endsAt ? countdown(rules.endsAt - Date.now()) : "—";
    $("until").textContent = rules.endsAt ? `until ${clock(rules.endsAt)}` : "";
    $("profile").textContent = rules.profile ?? "Focus session";
    $("summary").textContent = sealedSummary(rules);
  }
  document.body.dataset.connected = connected ? "yes" : "no";
  $("conn").textContent = connected ? "Connected to Sanctum" : "Sanctum isn't running";
}

async function refresh() {
  state = await chrome.runtime.sendMessage({ type: "state?" }).catch(() => ({ rules: null, connected: false }));
  render();
}

$("open-app").addEventListener("click", () => {
  void chrome.runtime.sendMessage({ type: "open-sanctum" });
  window.close();
});

void refresh();
setInterval(render, 1000);
setInterval(refresh, 4000);
