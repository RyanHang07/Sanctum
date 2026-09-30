import type { Distraction, DistractionKind, Profile, Rule } from "./types";

/** Everything a profile has is what it opens; seals are the one Distractions list. */
export const opensOf = (p: Profile) => p.rules;

/** Bare host (plus optional path). Mirrors normalize_domain in profiles.rs. */
export function normalizeDomain(input: string): string | null {
  let s = input.trim().toLowerCase();
  const scheme = s.indexOf("://");
  if (scheme >= 0) s = s.slice(scheme + 3);
  if (s.startsWith("www.")) s = s.slice(4);
  s = s.replace(/\/+$/, "");
  const host = s.split("/")[0] ?? "";
  const ok = host.includes(".") && !host.startsWith(".") && !host.endsWith(".") && /^[a-z0-9.-]+$/.test(host);
  return ok ? s : null;
}

/** "a.exe, B.EXE; notes" -> ["a.exe", "b.exe"]. Mirrors blocker::parse_always. */
export function exeList(text: string): string[] {
  const out: string[] = [];
  for (const s of text.split(/[,;\n]/)) {
    const e = s.trim().toLowerCase();
    if (e.endsWith(".exe") && !out.includes(e)) out.push(e);
  }
  return out;
}

/**
 * A page (or section) under a sealed site that stays open. Mirrors profiles::normalize_allow:
 * on the site or a subdomain, and narrower than the whole site.
 */
export function normalizeAllow(domain: string, input: string): string | null {
  const s = normalizeDomain(input);
  if (!s) return null;
  const host = s.split("/")[0] ?? "";
  const site = domain.split("/")[0] ?? domain;
  const onSite = host === site || host.endsWith(`.${site}`);
  return onSite && s !== domain && s.length > site.length ? s : null;
}

/** Anything URL-shaped becomes an absolute https URL; everything else is rejected. */
export function normalizeUrl(input: string): string | null {
  const s = input.trim();
  if (!s || /\s/.test(s)) return null;
  const withScheme = /^https?:\/\//i.test(s) ? s : `https://${s}`;
  try {
    const u = new URL(withScheme);
    return u.hostname.includes(".") ? u.toString() : null;
  } catch {
    return null;
  }
}

/** What a typed distraction is. Mirrors distractions::guess_kind. */
export function guessDistraction(input: string): DistractionKind | null {
  const s = input.trim();
  if (!s) return null;
  if (s.toLowerCase().endsWith(".exe")) return "app";
  if (!/\s/.test(s) && normalizeDomain(s)) return "site";
  return "keyword";
}

/** Display name for a distraction. */
export function distractionLabel(d: Pick<Distraction, "kind" | "value" | "label">): string {
  if (d.label) return d.label;
  if (d.kind === "app") return d.value.replace(/\.exe$/, "").replace(/^./, (c) => c.toUpperCase());
  return d.value;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Display name for a rule. Mirrors launcher::label in Rust. */
export function ruleLabel(r: Rule): string {
  if (r.label) return r.label;
  if (r.kind === "launch_url") return hostOf(r.value);
  if (r.kind === "launch_app") return r.value.replace(/\.exe$/, "");
  return r.value;
}

/** Secondary text for a rule row. */
export function ruleMeta(r: Rule): string {
  switch (r.kind) {
    case "launch_app":
      return r.value;
    case "launch_url": {
      const bare = r.value.replace(/^https?:\/\//i, "").replace(/^www\./, "").replace(/\/$/, "");
      return bare === ruleLabel(r) ? "" : bare;
    }
  }
}

/** Home's one-line note: what the profile opens and how many distractions every seal blocks. */
export function profileNote(p: Profile, distractions: number): string {
  const opens = [...new Set(opensOf(p).map(ruleLabel))];
  const openPart = opens.length ? `Opens ${opens.join(", ")}` : "Opens nothing";
  return `${openPart} · seals ${distractions}`;
}
