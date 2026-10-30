import type { ActivityView, Category, DayView, Recap, SessionDetail, SessionOutcome, SessionRow, Usage } from "./types";

// The browser preview's side of Stats in depth (v0.3; src-tauri/src/insights.rs): a session
// log, an activity log, per-profile exceptions, and the weekly recap. Tests and the dev seed
// fill them through insightControls.

interface ActivityEntry {
  ts: number;
  seconds: number;
  exe: string;
  title: string;
  category: Category;
  sessionId: number | null;
}

interface InsightState {
  sessions: (SessionRow & { blocked: SessionDetail["blocked"]; tamper: SessionDetail["tamper"] })[];
  activity: ActivityEntry[];
  exceptions: { profileId: number; kind: "exe" | "domain"; pattern: string; category: Category }[];
  rules: { kind: "exe" | "domain"; pattern: string; category: Category }[];
  recap: Recap | null;
}

let s: InsightState = fresh();

function fresh(): InsightState {
  return { sessions: [], activity: [], exceptions: [], rules: [], recap: null };
}

export function resetMockInsights() {
  s = fresh();
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Planner date -> local midnight (the preview's day starts at midnight). */
const dayStart = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y!, m! - 1, d!).getTime();
};
const range = (from?: string, to?: string): [number, number] => (from && to ? [dayStart(from), dayStart(to) + 86_400_000] : [0, Number.MAX_SAFE_INTEGER]);

const BROWSERS = new Set(["chrome.exe", "msedge.exe", "brave.exe", "comet.exe", "firefox.exe"]);
export function domainOf(exe: string, title: string): string | null {
  if (!BROWSERS.has(exe) || !title.includes(" — ")) return null;
  const tail = title.split(" — ").pop()!.trim().toLowerCase();
  // Like insights.rs: a domain or an IPv4 address, not "v1.2" or "notes.pdf".
  const ipv4 = /^(\d{1,3}\.){3}\d{1,3}$/.test(tail);
  const domain = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+([a-z]{2,}|xn--[a-z0-9-]+)$/.test(tail) && !/\.(pdf|txt|docx?|xlsx|pptx|png|jpe?g|gif|ts|js|html|csv)$/.test(tail);
  return ipv4 || domain ? tail : null;
}

function usage(entries: ActivityEntry[]): ActivityView {
  const group = (pick: (e: ActivityEntry) => string | null, kind: Usage["kind"]) => {
    const by = new Map<string, Map<Category, number>>();
    for (const e of entries) {
      const key = pick(e);
      if (!key) continue;
      const cats = by.get(key) ?? new Map<Category, number>();
      cats.set(e.category, (cats.get(e.category) ?? 0) + e.seconds);
      by.set(key, cats);
    }
    return [...by.entries()]
      .map(([key, cats]) => ({ kind, key, seconds: [...cats.values()].reduce((a, b) => a + b, 0), category: [...cats.entries()].sort((a, b) => b[1] - a[1])[0]![0] }))
      .sort((a, b) => b.seconds - a.seconds || a.key.localeCompare(b.key));
  };
  return { apps: group((e) => (domainOf(e.exe, e.title) ? null : e.exe), "exe"), sites: group((e) => domainOf(e.exe, e.title), "domain") };
}

export const insightHandlers: Record<string, (args: Record<string, unknown>) => unknown> = {
  stats_sessions: ({ from, to, outcome, profile }) => {
    const [f, t] = range(from as string | undefined, to as string | undefined);
    return clone(
      s.sessions
        .filter((x) => x.startedAt >= f && x.startedAt < t && (!outcome || x.outcome === outcome) && (profile == null || x.profileId === profile))
        .sort((a, b) => b.startedAt - a.startedAt)
        .map(({ blocked: _b, tamper: _t, ...row }) => row),
    );
  },
  stats_session: ({ id }) => {
    const x = s.sessions.find((r) => r.id === id);
    if (!x) return null;
    const { blocked, tamper, ...session } = x;
    return clone({ session, blocked, unlocks: [], tamper });
  },
  stats_sessions_csv: () => ({ name: "Sanctum sessions.csv", path: "C:\\Users\\you\\Documents\\Sanctum\\Exports\\Sanctum sessions.csv", bytes: 512, modifiedAt: Date.now() }),
  stats_activity: ({ from, to }) => {
    const [f, t] = range(from as string, to as string);
    return usage(s.activity.filter((e) => e.ts >= f && e.ts < t));
  },
  stats_reclassify: ({ kind, pattern, category, profile }) => {
    const k = kind as "exe" | "domain";
    const p = String(pattern).trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
    if (k === "exe" && !p.endsWith(".exe")) throw `${p} is not an app name.`;
    const cat = category as Category;
    const sessionProfile = (id: number | null) => s.sessions.find((x) => x.id === id)?.profileId ?? null;
    if (profile == null) {
      s.rules = [...s.rules.filter((r) => !(r.kind === k && r.pattern === p)), { kind: k, pattern: p, category: cat }];
    } else {
      s.exceptions = [...s.exceptions.filter((r) => !(r.profileId === profile && r.kind === k && r.pattern === p)), { profileId: profile as number, kind: k, pattern: p, category: cat }];
    }
    const excepted = s.exceptions.filter((r) => r.kind === k && r.pattern === p).map((r) => r.profileId);
    let changed = 0;
    for (const e of s.activity) {
      const hit = k === "exe" ? e.exe === p : domainOf(e.exe, e.title) === p;
      const prof = sessionProfile(e.sessionId);
      const applies = profile == null ? prof == null || !excepted.includes(prof) : prof === profile;
      if (hit && applies && e.category !== cat) {
        e.category = cat;
        changed++;
      }
    }
    return changed;
  },
  stats_day: ({ date }): DayView => {
    const f = dayStart(date as string);
    const t = f + 86_400_000;
    const entries = s.activity.filter((e) => e.ts >= f && e.ts < t).sort((a, b) => a.ts - b.ts);
    const blocks: DayView["blocks"] = [];
    for (const e of entries) {
      const end = e.ts + e.seconds * 1000;
      const label = domainOf(e.exe, e.title) ?? e.exe;
      const last = blocks.at(-1);
      if (last && last.category === e.category && e.ts - last.end < 120_000) last.end = Math.max(last.end, end);
      else blocks.push({ start: e.ts, end, category: e.category, label });
    }
    const v = usage(entries);
    return {
      date: date as string,
      hasActivity: t > Date.now() - 30 * 86_400_000,
      blocks,
      sessions: s.sessions.filter((x) => x.startedAt < t && x.endedAt > f).map((x) => ({ id: x.id, start: x.startedAt, end: x.endedAt, profileName: x.profileName, outcome: x.outcome })),
      top: [...v.apps, ...v.sites].sort((a, b) => b.seconds - a.seconds).slice(0, 8),
    };
  },
  stats_recap: () => clone(s.recap),
};

export const insightControls = {
  /** Adds finished sessions (minutes, outcome) and activity for the preview and tests. */
  insightSession(row: Partial<SessionRow> & { startedAt: number; plannedMin: number; outcome?: SessionOutcome }, extra: { blocked?: SessionDetail["blocked"]; tamper?: SessionDetail["tamper"] } = {}) {
    const id = row.id ?? s.sessions.length + 1;
    s.sessions.push({
      id,
      profileId: row.profileId ?? null,
      profileName: row.profileName ?? "Deep Work",
      startedAt: row.startedAt,
      endedAt: row.endedAt ?? row.startedAt + row.plannedMin * 60_000,
      plannedMin: row.plannedMin,
      focusMin: row.focusMin ?? row.plannedMin,
      idleMin: row.idleMin ?? 0,
      outcome: row.outcome ?? "completed",
      attempts: extra.blocked?.reduce((a, b) => a + b.count, 0) ?? 0,
      task: row.task ?? null,
      goal: row.goal ?? null,
      plan: row.plan ?? null,
      result: row.result ?? null,
      focusRating: row.focusRating ?? null,
      leftOff: row.leftOff ?? null,
      blocked: extra.blocked ?? [],
      tamper: extra.tamper ?? [],
    });
    return id;
  },
  insightActivity(entries: ActivityEntry[]) {
    s.activity.push(...entries);
  },
  insightRecap(recap: Recap | null) {
    s.recap = recap;
  },
  insightState: () => s,
};
