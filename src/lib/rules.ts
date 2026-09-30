import type { Profile, Rule, RuleKind } from "./types";

export const OPEN_KINDS: readonly RuleKind[] = ["launch_app", "launch_url"];
export const SEAL_KINDS: readonly RuleKind[] = ["app", "domain", "title"];

export const opensOf = (p: Profile) => p.rules.filter((r) => OPEN_KINDS.includes(r.kind));
export const sealsOf = (p: Profile) => p.rules.filter((r) => SEAL_KINDS.includes(r.kind));

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

/** The Seals input takes either a site or a window-title keyword. */
export function classifySealInput(input: string): { kind: "domain" | "title"; value: string } | null {
  const s = input.trim();
  if (!s) return null;
  const domain = !/\s/.test(s) ? normalizeDomain(s) : null;
  return domain ? { kind: "domain", value: domain } : { kind: "title", value: s };
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
  if (r.kind === "app" || r.kind === "launch_app") return r.value.replace(/\.exe$/, "");
  return r.value;
}

/** Secondary text for a rule row. */
export function ruleMeta(r: Rule): string {
  switch (r.kind) {
    case "launch_app":
    case "app":
      return r.value;
    case "launch_url": {
      const bare = r.value.replace(/^https?:\/\//i, "").replace(/^www\./, "").replace(/\/$/, "");
      return bare === ruleLabel(r) ? "" : bare;
    }
    case "domain":
      return r.label ? `Site · ${r.value}` : "Site";
    case "title":
      return "Title keyword";
  }
}

/** Home's one-line note: what the profile opens and how much it seals. */
export function profileNote(p: Profile): string {
  const opens = [...new Set(opensOf(p).map(ruleLabel))];
  const openPart = opens.length ? `Opens ${opens.join(", ")}` : "Opens nothing";
  const sealPart = p.allowlistMode ? "seals everything else" : `seals ${sealsOf(p).length}`;
  return `${openPart} · ${sealPart}`;
}
