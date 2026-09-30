import { classifySealInput, normalizeAllow, normalizeDomain, normalizeUrl, profileNote, ruleLabel, ruleMeta } from "./rules";
import type { Profile, Rule } from "./types";

const rule = (kind: Rule["kind"], value: string, label: string | null = null): Rule => ({
  id: 1,
  profileId: 1,
  kind,
  value,
  label,
  path: null,
  allow: [],
});

describe("rule inputs", () => {
  it("normalizes site exceptions like the Rust side", () => {
    expect(normalizeAllow("youtube.com", "https://www.youtube.com/@mitocw/")).toBe("youtube.com/@mitocw");
    expect(normalizeAllow("youtube.com", "music.youtube.com")).toBe("music.youtube.com");
    expect(normalizeAllow("youtube.com", "youtube.com")).toBeNull();
    expect(normalizeAllow("youtube.com", "notyoutube.com/x")).toBeNull();
    expect(normalizeAllow("reddit.com", "youtube.com/x")).toBeNull();
  });

  it("normalizes domains like the Rust side", () => {
    expect(normalizeDomain("https://www.YouTube.com/")).toBe("youtube.com");
    expect(normalizeDomain("reddit.com/r/all/")).toBe("reddit.com/r/all");
    expect(normalizeDomain("localhost")).toBeNull();
    expect(normalizeDomain("not a site")).toBeNull();
  });

  it("turns anything URL-shaped into an https URL", () => {
    expect(normalizeUrl("leetcode.com/problemset")).toBe("https://leetcode.com/problemset");
    expect(normalizeUrl("http://neetcode.io")).toBe("http://neetcode.io/");
    expect(normalizeUrl("notes")).toBeNull();
    expect(normalizeUrl("two words.com")).toBeNull();
  });

  it("reads the Seals input as a site or a title keyword", () => {
    expect(classifySealInput("www.instagram.com")).toEqual({ kind: "domain", value: "instagram.com" });
    expect(classifySealInput("Shorts")).toEqual({ kind: "title", value: "Shorts" });
    expect(classifySealInput("episode 4")).toEqual({ kind: "title", value: "episode 4" });
    expect(classifySealInput("   ")).toBeNull();
  });
});

describe("rule display", () => {
  it("labels and describes each kind", () => {
    expect(ruleLabel(rule("launch_url", "https://www.github.com/"))).toBe("github.com");
    expect(ruleLabel(rule("launch_app", "code.exe", "VS Code"))).toBe("VS Code");
    expect(ruleLabel(rule("app", "steam.exe"))).toBe("steam");
    expect(ruleMeta(rule("app", "discord.exe", "Discord"))).toBe("discord.exe");
    expect(ruleMeta(rule("domain", "discord.com", "Discord"))).toBe("Site · discord.com");
    expect(ruleMeta(rule("title", "Shorts"))).toBe("Title keyword");
    expect(ruleMeta(rule("launch_url", "https://leetcode.com/problemset/", "LeetCode"))).toBe("leetcode.com/problemset");
    expect(ruleMeta(rule("launch_url", "https://docs.rs/"))).toBe("");
  });

  it("builds Home's profile note", () => {
    const p: Profile = {
      id: 1,
      name: "Deep Work",
      allowlistMode: false,
      defaultMinutes: 90,
      workTypes: [],
      createdAt: 0,
      rules: [
        rule("launch_app", "code.exe", "VS Code"),
        rule("launch_url", "https://github.com/", "GitHub"),
        rule("app", "discord.exe", "Discord"),
        rule("domain", "discord.com", "Discord"),
        rule("title", "Shorts"),
      ],
    };
    expect(profileNote(p)).toBe("Opens VS Code, GitHub · seals 3");
    expect(profileNote({ ...p, rules: [], allowlistMode: true })).toBe("Opens nothing · seals everything else");
  });
});
