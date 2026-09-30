import catalog from "../data/catalog.json";
import { WORK_TYPES, rulesForWorkTypes, sampleProfiles, catalogDistractions } from "./catalog";
import { normalizeDomain } from "./rules";

describe("work-type catalog", () => {
  it("only references items that exist", () => {
    const ids = new Set(Object.keys(catalog.items));
    for (const [name, wt] of Object.entries(catalog.workTypes)) {
      for (const id of [...wt.open, ...wt.seal]) expect(ids.has(id), `${name} -> ${id}`).toBe(true);
    }
    for (const id of catalog.alwaysSeal) expect(ids.has(id)).toBe(true);
    for (const p of catalog.sampleProfiles) for (const t of p.workTypes) expect(WORK_TYPES).toContain(t);
  });

  it("has the onboarding work types", () => {
    expect(WORK_TYPES).toEqual([
      "DSA practice",
      "System design",
      "Behavioral prep",
      "Mock interviews",
      "Applications",
      "Coding",
      "Writing",
      "Reading & courses",
      "Email & admin",
    ]);
  });

  it("expands work types into what they open, de-duplicated", () => {
    const rules = rulesForWorkTypes(["DSA practice", "Coding"]);
    const keys = rules.map((r) => `${r.kind}:${r.value}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain("launch_url:https://leetcode.com/problemset/");
    expect(keys).toContain("launch_app:code.exe");
    expect(keys.filter((k) => k === "launch_app:code.exe")).toHaveLength(1);
    expect(rules.every((r) => r.kind === "launch_app" || r.kind === "launch_url")).toBe(true);
    for (const r of rules) {
      if (r.kind === "launch_app") expect(r.value).toMatch(/^[a-z0-9_.-]+\.exe$/);
      if (r.kind === "launch_url") expect(r.value).toMatch(/^https:\/\//);
    }
    expect(() => rulesForWorkTypes(["Juggling"])).toThrow("Unknown work type");
  });

  it("offers the common distractions by name", () => {
    const groups = catalogDistractions();
    const discord = groups.find((g) => g.label === "Discord")!;
    expect(discord.items.map((i) => `${i.kind}:${i.value}`)).toEqual(expect.arrayContaining(["app:discord.exe"]));
    const tiktok = groups.find((g) => g.label === "TikTok")!;
    expect(tiktok.items.map((i) => `${i.kind}:${i.value}`)).toContain("site:tiktok.com");
    for (const i of groups.flatMap((g) => g.items)) {
      if (i.kind === "site") expect(normalizeDomain(i.value)).toBe(i.value);
      if (i.kind === "app") expect(i.value).toMatch(/^[a-z0-9_.-]+\.exe$/);
    }
  });

  it("defines the four sample profiles with valid durations", () => {
    const drafts = sampleProfiles();
    expect(drafts.map((d) => [d.name, d.defaultMinutes])).toEqual([
      ["Interview Prep", 60],
      ["Deep Work", 90],
      ["Study", 60],
      ["Light Work", 30],
    ]);
    for (const d of drafts) expect(d.rules!.length).toBeGreaterThan(0);
  });
});
