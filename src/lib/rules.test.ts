import { distractionLabel, exeList, guessDistraction, normalizeAllow, normalizeDomain, normalizeUrl, profileNote, ruleLabel, ruleMeta } from "./rules";
import type { Profile, Rule } from "./types";

const rule = (kind: Rule["kind"], value: string, label: string | null = null): Rule => ({
  id: 1,
  profileId: 1,
  kind,
  value,
  label,
  path: null,
});

describe("rule inputs", () => {
  it("reads exe lists like blocker::parse_always", () => {
    expect(exeList("Claude.exe, spotify.exe; notes.txt\nclaude.exe")).toEqual(["claude.exe", "spotify.exe"]);
    expect(exeList("")).toEqual([]);
  });

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

  it("works out what a typed distraction is, like distractions::guess_kind", () => {
    expect(guessDistraction("Discord.exe")).toBe("app");
    expect(guessDistraction("www.instagram.com")).toBe("site");
    expect(guessDistraction("https://youtube.com/shorts")).toBe("site");
    expect(guessDistraction("Shorts")).toBe("keyword");
    expect(guessDistraction("episode 4")).toBe("keyword");
    expect(guessDistraction("   ")).toBeNull();
    expect(distractionLabel({ kind: "app", value: "steam.exe", label: null })).toBe("Steam");
    expect(distractionLabel({ kind: "site", value: "reddit.com", label: null })).toBe("reddit.com");
  });
});

describe("rule display", () => {
  it("labels and describes each kind", () => {
    expect(ruleLabel(rule("launch_url", "https://www.github.com/"))).toBe("github.com");
    expect(ruleLabel(rule("launch_app", "code.exe", "VS Code"))).toBe("VS Code");
    expect(ruleLabel(rule("launch_app", "steam.exe"))).toBe("steam");
    expect(ruleMeta(rule("launch_app", "code.exe", "VS Code"))).toBe("code.exe");
    expect(ruleMeta(rule("launch_url", "https://leetcode.com/problemset/", "LeetCode"))).toBe("leetcode.com/problemset");
    expect(ruleMeta(rule("launch_url", "https://docs.rs/"))).toBe("");
  });

  it("builds Home's profile note", () => {
    const p: Profile = {
      id: 1,
      name: "Deep Work",
      defaultMinutes: 90,
      workTypes: [],
      createdAt: 0,
      rules: [
        rule("launch_app", "code.exe", "VS Code"),
        rule("launch_url", "https://github.com/", "GitHub"),
      ],
    };
    expect(profileNote(p, 3)).toBe("Opens VS Code, GitHub · seals 3");
    expect(profileNote({ ...p, rules: [] }, 0)).toBe("Opens nothing · seals 0");
  });
});
