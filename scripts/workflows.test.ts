import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
// @ts-expect-error: a plain .mjs script, no types
import { sectionFor } from "./release-notes.mjs";

// The build and release pipeline (2026-11-24): the workflows use actions that run on Node 24,
// a tag builds a signed, checked release, and every place that names the version agrees.

const root = join(__dirname, "..");
// Windows checkouts get CRLF line ends.
const read = (p: string) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
const dir = ".github/workflows";
const workflows = Object.fromEntries(readdirSync(join(root, dir)).filter((f) => f.endsWith(".yml")).map((f) => [f, read(`${dir}/${f}`)]));

/** `uses: owner/name@ref` lines, in order. */
const uses = (yml: string) => [...yml.matchAll(/uses:\s*([\w.-]+\/[\w.-]+)@([\w.-]+)/g)].map((m) => ({ action: m[1]!.toLowerCase(), ref: m[2]! }));

/** Each action's first major on Node 24 (GitHub removed Node 20 from its runners on 2026-09-23). */
const NODE24: Record<string, number> = {
  "actions/checkout": 5,
  "actions/setup-node": 5,
  "actions/upload-artifact": 6,
  "swatinem/rust-cache": 2,
  "tauri-apps/tauri-action": 1,
};
/** Not JavaScript actions, so no Node version to keep up with. */
const COMPOSITE = new Set(["dtolnay/rust-toolchain"]);

describe("workflows", () => {
  it("has the three workflows", () => {
    expect(Object.keys(workflows).sort()).toEqual(["ci.yml", "macos.yml", "release.yml"]);
  });

  it("uses only actions on Node 24, and a new action has to be added here first", () => {
    for (const [file, yml] of Object.entries(workflows)) {
      for (const { action, ref } of uses(yml)) {
        if (COMPOSITE.has(action)) continue;
        expect(NODE24, `${file}: ${action} isn't known; add its Node 24 major`).toHaveProperty([action]);
        const major = Number(/^v(\d+)/.exec(ref)?.[1]);
        expect(major, `${file}: ${action}@${ref}`).toBeGreaterThanOrEqual(NODE24[action]!);
      }
    }
  });

  it("pins each action to a major, not a branch, so a push upstream can't change a build", () => {
    for (const [file, yml] of Object.entries(workflows)) {
      for (const { action, ref } of uses(yml)) if (!COMPOSITE.has(action)) expect(ref, `${file}: ${action}`).toMatch(/^v\d+$/);
    }
  });

  it("CI and macOS run the type check or Rust check, both test suites, with the partner site's dependencies", () => {
    expect(workflows["ci.yml"]).toMatch(/run: npm run typecheck/);
    expect(workflows["macos.yml"]).toMatch(/cargo check/);
    for (const f of ["ci.yml", "macos.yml", "release.yml"]) {
      expect(workflows[f], f).toMatch(/run: npm ci\n/);
      expect(workflows[f], f).toMatch(/run: npm ci --prefix partner/);
      expect(workflows[f], f).toMatch(/run: npm test/);
    }
    for (const f of ["ci.yml", "macos.yml"]) expect(workflows[f], f).toMatch(/cargo test --manifest-path src-tauri\/Cargo\.toml --lib/);
  });

  it("CI and macOS can be run by hand on any branch", () => {
    for (const f of ["ci.yml", "macos.yml"]) expect(workflows[f], f).toMatch(/^\s+workflow_dispatch:/m);
  });
});

describe("the release workflow", () => {
  const yml = workflows["release.yml"]!;
  const at = (s: string) => {
    const i = yml.indexOf(s);
    expect(i, s).toBeGreaterThan(-1);
    return i;
  };

  it("publishes for a v* tag, and a run by hand is a draft under a test- tag that can't publish", () => {
    expect(yml).toMatch(/push:\n\s+tags: \["v\*"\]/);
    expect(yml).toMatch(/^\s+workflow_dispatch:/m);
    expect(yml).toMatch(/echo "draft=false"/);
    expect(yml).toMatch(/echo "tag=test-\$\{\{ github\.run_number \}\}"/);
    expect(yml).toMatch(/echo "draft=true"/);
    expect(yml).toMatch(/releaseDraft: \$\{\{ steps\.notes\.outputs\.draft \}\}/);
    expect("test-17").not.toMatch(/^v/);
  });

  it("tests before it builds, then builds, then checks the update, then removes a test draft", () => {
    const order = [at("run: npm test"), at("scripts/release-notes.mjs"), at("tauri-apps/tauri-action@"), at("scripts/verify-update.mjs"), at("Remove the test draft")];
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("only ever deletes a draft from a run by hand, and keeps a failed one", () => {
    const step = yml.slice(at("Remove the test draft"));
    expect(step).toMatch(/if: github\.event_name != 'push' && steps\.release\.outputs\.releaseId != ''/);
    expect(step).not.toMatch(/always\(\)/);
  });

  it("uses tauri-action v1's names, not v0's", () => {
    expect(yml).toMatch(/uploadUpdaterJson: true/);
    for (const old of ["includeUpdaterJson", "includeRelease", "includeDebug", "assetNamePattern", "updaterJsonKeepUniversal"]) {
      expect(yml, old).not.toMatch(new RegExp(`^\\s+${old}:`, "m"));
    }
  });

  it("signs updates with the secret key and builds the update files", () => {
    expect(yml).toMatch(/TAURI_SIGNING_PRIVATE_KEY: \$\{\{ secrets\.TAURI_SIGNING_PRIVATE_KEY \}\}/);
    expect(yml).toMatch(/TAURI_SIGNING_PRIVATE_KEY_PASSWORD: \$\{\{ secrets\.TAURI_SIGNING_PRIVATE_KEY_PASSWORD \}\}/);
    expect(yml).toMatch(/createUpdaterArtifacts":true/);
  });

  it("can write releases and nothing else", () => {
    expect(yml).toMatch(/permissions:\n\s+contents: write\n/);
  });

  it("keeps secrets out of the build's command line", () => {
    expect(yml.slice(at("args:"), at("args:") + 200).split("\n")[0]).not.toMatch(/secrets\./);
  });
});

describe("one version everywhere", () => {
  const json = (p: string) => JSON.parse(read(p));
  const version = json("package.json").version as string;

  it("package.json, the lockfile, Tauri, Cargo, and the extension agree", () => {
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    const lock = json("package-lock.json");
    expect(lock.version).toBe(version);
    expect(lock.packages[""].version).toBe(version);
    expect(json("src-tauri/tauri.conf.json").version).toBe(version);
    expect(/^version = "([^"]+)"/m.exec(read("src-tauri/Cargo.toml"))?.[1]).toBe(version);
    expect(/name = "sanctum"\r?\nversion = "([^"]+)"/.exec(read("src-tauri/Cargo.lock"))?.[1]).toBe(version);
    expect(json("extension/manifest.json").version).toBe(version);
  });

  it("the README names it as the current version", () => {
    expect(read("README.md")).toContain(`(currently ${version})`);
  });

  it("the changelog has its section, so a test run and its tag both get release notes", () => {
    const section = sectionFor(read("CHANGELOG.md"), `v${version}`);
    expect(section, `CHANGELOG.md has no "## v${version}" section`).toBeTruthy();
  });
});
