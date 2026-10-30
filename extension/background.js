// Sanctum extension service worker (SPEC 4.4, BACKLOG 4b). Talks to Sanctum through its
// native messaging host, seals sites with declarativeNetRequest, blocks tabs matching the
// profile's keywords, and reports the active tab's domain (never the full URL) for Activity.

import { allowedPage, blockedSite, hostOf, keywordHit, netRules } from "./rules.js";

const HOST = "app.sanctum.bridge";
const RETRY_MS = 5_000;
const BLOCKED_PAGE = chrome.runtime.getURL("blocked.html");

let port = null;
/**
 * The latest rules from Sanctum. Kept in local storage, across worker AND browser restarts: the
 * browser keeps declarativeNetRequest's dynamic rules across a restart too, so this copy has to
 * survive with them or the two disagree (a site "open" here but still redirected; v0.1.3 fix).
 */
const OPEN = { sealed: false, sites: [], keywords: [] };
let rules = OPEN;
/** How long past the session's planned end a seal is held while Sanctum can't be reached. */
const STALE_MS = 2 * 60_000;
let lastDomain = undefined;
/** Heard from Sanctum since the port opened (the bridge alone doesn't count). */
let connected = false;
/** Tab id -> the last page in it that wasn't sealed, for the blocked page's "Back to …". */
let back = {};

async function rememberBack(tab) {
  if (!tab.id || !tab.url || tab.url.startsWith(BLOCKED_PAGE) || !allowedPage(tab.url, rules)) return;
  if (back[tab.id] === tab.url) return;
  back[tab.id] = tab.url;
  await chrome.storage.session.set({ back });
}

const send = (msg) => {
  try {
    port?.postMessage(msg);
  } catch {
    // Disconnected; the retry loop reconnects.
  }
};

async function hello() {
  const incognito = await chrome.extension.isAllowedIncognitoAccess();
  send({ type: "hello", version: chrome.runtime.getManifest().version, incognito });
  lastDomain = undefined;
  await reportActive();
}

function connect() {
  try {
    port = chrome.runtime.connectNative(HOST);
  } catch {
    port = null;
    setTimeout(connect, RETRY_MS);
    return;
  }
  port.onMessage.addListener((msg) => void onMessage(msg));
  port.onDisconnect.addListener(() => {
    port = null;
    connected = false;
    setTimeout(connect, RETRY_MS);
  });
  void hello();
}

async function onMessage(msg) {
  // The bridge says "offline" when Sanctum isn't reachable. That's the one message that must
  // NOT count as hearing from Sanctum, or a seal outlives a closed Sanctum forever (v0.1.4 fix).
  if (msg.type === "offline") {
    connected = false;
    await heal();
    return;
  }
  connected = true;
  if (msg.type === "rules") {
    rules = msg;
    await chrome.storage.local.set({ rules });
    await applyRules();
  } else if (msg.type === "reload") {
    // Sanctum updated and put a newer copy of this extension in its folder (v0.3): load it.
    // The seal's rules and the theme are in storage, so nothing is lost across the reload.
    chrome.runtime.reload();
  } else if (msg.type === "theme") {
    // The app's theme (v0.3): theme.js paints the sealed page and popup with it.
    await chrome.storage.local.set({ theme: msg });
  } else if (msg.type === "online") {
    // The bridge reconnected to Sanctum.
    await hello();
  }
}

/** A seal Sanctum never lifted (it was closed, or the PC went off) and whose time is up. */
const expired = (r) => r.sealed && r.endsAt && Date.now() > r.endsAt + STALE_MS;

/** Lifts a seal that has run out while Sanctum is away, here, rather than hold it forever. */
async function liftIfExpired() {
  if (connected || !expired(rules)) return false;
  rules = OPEN;
  await chrome.storage.local.set({ rules });
  await applyRules();
  return true;
}

/** Updates the site rules and moves open tabs that are now sealed to the blocked page. */
async function applyRules() {
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: existing.map((r) => r.id), addRules: netRules(rules) });
  if (!rules.sealed) return;
  for (const tab of await chrome.tabs.query({})) await checkTab(tab);
}

function blockedUrl(site, keyword) {
  const q = new URLSearchParams({ site });
  if (keyword) q.set("keyword", keyword);
  return `${BLOCKED_PAGE}?${q}`;
}

async function checkTab(tab) {
  if (!tab.id || !tab.url || tab.url.startsWith(BLOCKED_PAGE)) return;
  const site = blockedSite(tab.url, rules);
  const keyword = site ? null : keywordHit(tab.url, tab.title, rules);
  if (site || keyword) await chrome.tabs.update(tab.id, { url: blockedUrl(site ?? hostOf(tab.url) ?? "", keyword) });
}

/** The active tab's domain in the focused window, or null when the browser isn't in front. */
async function reportActive() {
  const win = await chrome.windows.getLastFocused().catch(() => null);
  let domain = null;
  if (win?.focused) {
    const [tab] = await chrome.tabs.query({ active: true, windowId: win.id });
    domain = tab?.url && !tab.url.startsWith(BLOCKED_PAGE) ? hostOf(tab.url) : null;
  }
  if (domain !== lastDomain) {
    lastDomain = domain;
    send({ type: "active", domain });
  }
}

chrome.tabs.onUpdated.addListener((_id, change, tab) => {
  if (change.url || change.title) void checkTab(tab);
  if (change.url || change.status === "complete") void rememberBack(tab);
  if (tab.active && (change.url || change.status === "complete")) void reportActive();
});
chrome.tabs.onActivated.addListener(() => void reportActive());
chrome.tabs.onRemoved.addListener((id) => {
  delete back[id];
  void chrome.storage.session.set({ back });
});
chrome.windows.onFocusChanged.addListener(() => void reportActive());

// The blocked page reports each block, so Sanctum can count it as an attempt.
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type === "blocked") send({ type: "blocked", site: msg.site, keyword: msg.keyword ?? null });
  if (msg?.type === "open-sanctum") send({ type: "open-sanctum" });
  if (msg?.type === "rules?") return Promise.resolve(rules);
  // The blocked page's "Open youtube.com": make sure no stale rule redirects it straight back.
  if (msg?.type === "resync") return applyRules().then(() => rules);
  // The blocked page and the popup: the seal, whether Sanctum is there, and where to go back to.
  if (msg?.type === "state?") return Promise.resolve({ rules, connected, back: sender?.tab?.id ? back[sender.tab.id] ?? null : null });
  return undefined;
});

// A heartbeat keeps Sanctum sure the extension is alive (and the worker awake).
chrome.alarms.create("heartbeat", { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name !== "heartbeat") return;
  send({ type: "ping" });
  void heal();
  lastDomain = undefined;
  void reportActive();
});

/**
 * Keeps the browser's blocking rules matching `rules`: lifts an expired seal, and clears any
 * rule left behind with nothing sealed (e.g. after the PC went off mid-seal).
 */
async function heal() {
  if (await liftIfExpired()) return;
  if (rules.sealed) return;
  const left = await chrome.declarativeNetRequest.getDynamicRules();
  if (left.length) await applyRules();
}

// Start-up: restore the last rules and make the browser's blocking match them before anything
// else, so a restart never leaves a site blocked that this worker thinks is open.
Promise.all([chrome.storage.local.get("rules"), chrome.storage.session.get("back")]).then(async ([local, session]) => {
  if (local.rules) rules = local.rules;
  if (session.back) back = session.back;
  await liftIfExpired();
  await applyRules();
  connect();
});
