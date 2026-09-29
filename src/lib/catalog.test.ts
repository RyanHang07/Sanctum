import catalog from "../data/catalog.json";
import { WORK_TYPES, rulesForWorkTypes, sampleProfiles } from "./catalog";
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

  it("expands work types into valid, de-duplicated rules", () => {
    const rules = rulesForWorkTypes(["DSA practice", "Coding"]);
    const keys = rules.map((r) => `${r.kind}:${r.value}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain("launch_url:https://leetcode.com/problemset/");
    expect(keys).toContain("launch_app:code.exe");
    expect(keys).toContain("app:discord.exe"); // always sealed
    expect(keys).toContain("domain:tiktok.com"); // always sealed
    expect(keys.filter((k) => k === "launch_app:code.exe")).toHaveLength(1);
    for (const r of rules) {
      if (r.kind === "domain") expect(normalizeDomain(r.value)).toBe(r.value);
      if (r.kind === "app" || r.kind === "launch_app") expect(r.value).toMatch(/^[a-z0-9_.-]+\.exe$/);
      if (r.kind === "launch_url") expect(r.value).toMatch(/^https:\/\//);
    }
    expect(() => rulesForWorkTypes(["Juggling"])).toThrow("Unknown work type");
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
