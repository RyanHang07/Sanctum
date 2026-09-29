// What the Sanctum extension blocks while you're sealed (SPEC 4.4, BACKLOG 4b). Pure functions,
// shared by the service worker and the tests (src/lib/extensionRules.test.ts).
//
// rules = { sealed, profile, endsAt, sites: [{ domain, allow: [prefix] }], keywords: [word] }
// domain: a bare host with an optional path ("youtube.com", "leetcode.com/problemset").
// prefix: a bare host plus path that stays open under its site ("youtube.com/@mitocw").

/** "https://www.YouTube.com/watch?v=1" -> "youtube.com/watch?v=1" (host lowercased, www dropped). */
export function bare(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  return host + u.pathname + u.search;
}

/** The host a URL is on, without www, or null for browser pages. */
export function hostOf(url) {
  const b = bare(url);
  return b ? b.split("/")[0] : null;
}

/** True when `b` (a bare URL) is on `pattern`: same host or a subdomain, and under its path. */
function under(b, pattern) {
  const slash = pattern.indexOf("/");
  const host = slash === -1 ? pattern : pattern.slice(0, slash);
  const path = slash === -1 ? "" : pattern.slice(slash);
  const bSlash = b.indexOf("/");
  const bHost = bSlash === -1 ? b : b.slice(0, bSlash);
  const bPath = bSlash === -1 ? "/" : b.slice(bSlash);
  if (bHost !== host && !bHost.endsWith("." + host)) return false;
  return !path || bPath === path || bPath.startsWith(path.endsWith("/") ? path : path + "/") || bPath.startsWith(path + "?");
}

/** The sealed site a URL falls under (unless an exception keeps it open), or null. */
export function blockedSite(url, rules) {
  if (!rules?.sealed) return null;
  const b = bare(url);
  if (!b) return null;
  for (const site of rules.sites ?? []) {
    if (under(b, site.domain) && !(site.allow ?? []).some((p) => under(b, p))) return site.domain;
  }
  return null;
}

/** The keyword a tab's URL path or title contains, or null. Hosts don't count, only what's after. */
export function keywordHit(url, title, rules) {
  if (!rules?.sealed) return null;
  const b = bare(url);
  if (!b) return null;
  const rest = b.slice(b.indexOf("/") === -1 ? b.length : b.indexOf("/")).toLowerCase();
  const t = (title ?? "").toLowerCase();
  return (rules.keywords ?? []).find((k) => k && (rest.includes(k) || t.includes(k))) ?? null;
}

/** declarativeNetRequest rules: redirect each sealed site to the blocked page, with its exceptions allowed. */
export function netRules(rules) {
  if (!rules?.sealed) return [];
  const out = [];
  let id = 1;
  for (const site of rules.sites ?? []) {
    const slash = site.domain.indexOf("/");
    const condition =
      slash === -1
        ? { requestDomains: [site.domain], resourceTypes: ["main_frame"] }
        : { urlFilter: `||${site.domain}`, resourceTypes: ["main_frame"] };
    out.push({
      id: id++,
      priority: 1,
      action: { type: "redirect", redirect: { extensionPath: `/blocked.html?site=${encodeURIComponent(site.domain)}` } },
      condition,
    });
    for (const prefix of site.allow ?? []) {
      out.push({ id: id++, priority: 2, action: { type: "allow" }, condition: { urlFilter: `||${prefix}`, resourceTypes: ["main_frame"] } });
    }
  }
  return out;
}
