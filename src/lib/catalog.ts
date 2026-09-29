import catalog from "../data/catalog.json";
import type { NewRule, ProfileDraft } from "./types";

interface CatalogItem {
  label: string;
  url?: string;
  app?: string;
  apps?: string[];
  domains?: string[];
}

const items = catalog.items as Record<string, CatalogItem>;
const workTypes = catalog.workTypes as Record<string, { open: string[]; seal: string[] }>;

export const WORK_TYPES: readonly string[] = Object.keys(workTypes);

/** Rules for a set of work types: what they open, what they seal, plus the always-sealed items. */
export function rulesForWorkTypes(types: readonly string[]): NewRule[] {
  const open = new Set<string>();
  const seal = new Set<string>();
  for (const t of types) {
    const wt = workTypes[t];
    if (!wt) throw new Error(`Unknown work type: ${t}`);
    wt.open.forEach((id) => open.add(id));
    wt.seal.forEach((id) => seal.add(id));
  }
  catalog.alwaysSeal.forEach((id) => seal.add(id));

  const rules: NewRule[] = [];
  const seen = new Set<string>();
  const push = (r: NewRule) => {
    const key = `${r.kind}:${r.value}`;
    if (!seen.has(key)) {
      seen.add(key);
      rules.push(r);
    }
  };
  for (const id of open) {
    const it = items[id]!;
    if (it.url) push({ kind: "launch_url", value: it.url, label: it.label });
    if (it.app) push({ kind: "launch_app", value: it.app, label: it.label });
  }
  for (const id of seal) {
    const it = items[id]!;
    it.apps?.forEach((exe) => push({ kind: "app", value: exe, label: it.label }));
    it.domains?.forEach((d) => push({ kind: "domain", value: d, label: it.label }));
  }
  return rules;
}

/** The four sample profiles. Seeded in dev builds only; release builds get profiles from onboarding. */
export function sampleProfiles(): ProfileDraft[] {
  return catalog.sampleProfiles.map((p) => ({
    name: p.name,
    defaultMinutes: p.minutes,
    workTypes: p.workTypes,
    rules: rulesForWorkTypes(p.workTypes),
  }));
}

/** Seed classification rules, mirroring classify::catalog_rules in Rust. */
export function catalogClassRules(): { matchKind: "exe" | "domain"; pattern: string; category: "productive" | "distracting" }[] {
  const out: ReturnType<typeof catalogClassRules> = [];
  const seen = new Set<string>();
  const push = (matchKind: "exe" | "domain", pattern: string, category: "productive" | "distracting") => {
    if (!seen.has(matchKind + pattern)) {
      seen.add(matchKind + pattern);
      out.push({ matchKind, pattern, category });
    }
  };
  const host = (url: string) => new URL(url).hostname.replace(/^www\./, "");
  for (const wt of Object.values(workTypes)) {
    for (const id of wt.open) {
      const it = items[id]!;
      if (it.url) push("domain", host(it.url), "productive");
      if (it.app) push("exe", it.app, "productive");
    }
  }
  const sealIds = [...Object.values(workTypes).flatMap((w) => w.seal), ...catalog.alwaysSeal];
  for (const id of sealIds) {
    const it = items[id]!;
    it.apps?.forEach((a) => push("exe", a, "distracting"));
    it.domains?.forEach((d) => push("domain", d, "distracting"));
  }
  return out;
}

export { items as CATALOG_ITEMS };
