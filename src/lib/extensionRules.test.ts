import { readFileSync } from "node:fs";
import { bare, blockedSite, hostOf, keywordHit, netRules } from "../../extension/rules.js";

// The browser extension's matching (extension/rules.js, 4b).

const rules = {
  sealed: true,
  sites: [
    { domain: "youtube.com", allow: ["youtube.com/@mitocw", "music.youtube.com"] },
    { domain: "reddit.com" },
    { domain: "leetcode.com/discuss" },
  ],
  keywords: ["shorts", "reels"],
};

describe("extension rules", () => {
  it("normalizes URLs", () => {
    expect(bare("https://www.YouTube.com/watch?v=1")).toBe("youtube.com/watch?v=1");
    expect(bare("chrome://extensions")).toBeNull();
    expect(bare("not a url")).toBeNull();
    expect(hostOf("https://m.youtube.com/")).toBe("m.youtube.com");
  });

  it("blocks sealed sites and their subdomains, except allowed pages", () => {
    expect(blockedSite("https://www.youtube.com/watch?v=1", rules)).toBe("youtube.com");
    expect(blockedSite("https://m.youtube.com/", rules)).toBe("youtube.com");
    expect(blockedSite("https://www.youtube.com/@mitocw/videos", rules)).toBeNull();
    expect(blockedSite("https://music.youtube.com/playlist", rules)).toBeNull();
    expect(blockedSite("https://notyoutube.com/", rules)).toBeNull();
    expect(blockedSite("https://old.reddit.com/r/all", rules)).toBe("reddit.com");
    // A site with a path seals only that section.
    expect(blockedSite("https://leetcode.com/discuss/interview", rules)).toBe("leetcode.com/discuss");
    expect(blockedSite("https://leetcode.com/problems/two-sum", rules)).toBeNull();
    expect(blockedSite("https://leetcode.com/discussion", rules)).toBeNull();
    // Nothing while open.
    expect(blockedSite("https://youtube.com/", { ...rules, sealed: false })).toBeNull();
  });

  it("matches keywords in the path or title, not the host", () => {
    expect(keywordHit("https://www.youtube.com/shorts/abc", "", rules)).toBe("shorts");
    expect(keywordHit("https://www.instagram.com/", "Instagram Reels", rules)).toBe("reels");
    expect(keywordHit("https://shorts.example.com/", "Home", rules)).toBeNull();
    expect(keywordHit("https://example.com/", "Nothing here", rules)).toBeNull();
  });

  it("builds redirect and allow rules", () => {
    const r = netRules(rules);
    expect(r.map((x) => [x.id, x.priority, x.action.type])).toEqual([
      [1, 1, "redirect"],
      [2, 2, "allow"],
      [3, 2, "allow"],
      [4, 1, "redirect"],
      [5, 1, "redirect"],
    ]);
    expect(r[0]!.condition.requestDomains).toEqual(["youtube.com"]);
    expect(r[0]!.action.redirect!.extensionPath).toBe("/blocked.html?site=youtube.com");
    expect(r[1]!.condition.urlFilter).toBe("||youtube.com/@mitocw");
    expect(r[4]!.condition.urlFilter).toBe("||leetcode.com/discuss");
    expect(netRules({ ...rules, sealed: false })).toEqual([]);
  });
});

describe("extension assets", () => {
  it("carries the current design tokens (run npm run ext:assets after changing them)", () => {
    const design = readFileSync("design/tokens.css", "utf8").replace(/^@import url\([^)]*\);\s*/m, "");
    const ext = readFileSync("extension/tokens.css", "utf8");
    expect(ext.endsWith(design)).toBe(true);
    expect(ext).not.toContain("fonts.googleapis.com");
    const manifest = JSON.parse(readFileSync("extension/manifest.json", "utf8"));
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.permissions).toContain("nativeMessaging");
  });
});
