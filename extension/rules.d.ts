// Types for extension/rules.js, so the Vitest suite can import it from TypeScript.

export interface SiteRule {
  domain: string;
  allow?: string[];
}

export interface Rules {
  sealed: boolean;
  profile?: string;
  endsAt?: number | null;
  sites?: SiteRule[];
  keywords?: string[];
}

export function bare(url: string): string | null;
export function hostOf(url: string): string | null;
export function blockedSite(url: string, rules: Rules | null | undefined): string | null;
export function keywordHit(url: string, title: string | null | undefined, rules: Rules | null | undefined): string | null;
export function netRules(rules: Rules | null | undefined): Array<{
  id: number;
  priority: number;
  action: { type: string; redirect?: { extensionPath: string } };
  condition: { requestDomains?: string[]; urlFilter?: string; resourceTypes: string[] };
}>;
export function siteLabel(url: string): string | null;
export function allowedPage(url: string, rules: Rules): boolean;
export function countdown(ms: number): string;
export function sealedSummary(rules: Rules | null | undefined): string;
