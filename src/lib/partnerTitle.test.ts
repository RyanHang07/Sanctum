import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { tabTitle } from "../../partner/src/title";

// The partner page's tab titles and icons (v0.1). Lives here so it runs with the app's tests;
// the partner app has no test runner of its own.

describe("partner tab title", () => {
  it("leads with the status, then the brand, and counts what's waiting", () => {
    expect(tabTitle("Sign in")).toBe("Sign in · Sanctum");
    expect(tabTitle(null)).toBe("Sanctum");
    expect(tabTitle("Request from Ryan", 1)).toBe("(1) Request from Ryan · Sanctum");
    expect(tabTitle("Requests waiting", 2)).toBe("(2) Requests waiting · Sanctum");
  });

  it("ships the app icon as the favicon, unchanged, and a dotted copy for waiting", () => {
    const root = resolve(__dirname, "../..");
    const icon = readFileSync(resolve(root, "partner/public/favicon.svg"), "utf8");
    expect(icon).toBe(readFileSync(resolve(root, "design/logo/sanctum-app-icon.svg"), "utf8"));
    const waiting = readFileSync(resolve(root, "partner/public/favicon-waiting.svg"), "utf8");
    expect(waiting.startsWith(icon.slice(0, icon.lastIndexOf("</svg>")))).toBe(true);
    expect(waiting).toContain('fill="#FF8A6B"');
    expect(readFileSync(resolve(root, "partner/index.html"), "utf8")).toContain('href="/favicon.svg"');
  });
});
