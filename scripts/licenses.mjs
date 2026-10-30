// Open-source notices (v0.3): every library the app and the site ship, with its version and
// license, for the site's /legal page. Read from what's installed (npm) and locked (Cargo), so
// it matches the build. Run after changing dependencies: npm run notices
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");

/** Production npm packages under `dir` (dependencies and theirs, no dev tools). */
function npmPackages(dir, group) {
  const tree = JSON.parse(execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", ["ls", "--omit=dev", "--all", "--json"], { cwd: dir, encoding: "utf8", shell: process.platform === "win32", maxBuffer: 64 * 1024 * 1024 }));
  const seen = new Map();
  const walk = (deps) => {
    for (const [name, d] of Object.entries(deps ?? {})) {
      if (!d.version || seen.has(`${name}@${d.version}`)) continue;
      const pj = join(dir, "node_modules", name, "package.json");
      let license = "UNKNOWN";
      let url = `https://www.npmjs.com/package/${name}`;
      if (existsSync(pj)) {
        const p = JSON.parse(readFileSync(pj, "utf8"));
        license = typeof p.license === "string" ? p.license : p.license?.type ?? (Array.isArray(p.licenses) ? p.licenses.map((l) => l.type).join(" OR ") : license);
      }
      seen.set(`${name}@${d.version}`, { group, name, version: d.version, license, url });
      walk(d.dependencies);
    }
  };
  walk(tree.dependencies);
  return [...seen.values()];
}

/** Rust crates in the app's lock file (Cargo's own metadata). */
function crates() {
  const meta = JSON.parse(execFileSync("cargo", ["metadata", "--format-version", "1", "--locked", "--manifest-path", join(ROOT, "src-tauri", "Cargo.toml")], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 }));
  return meta.packages
    .filter((p) => p.source) // leaves out Sanctum itself
    .map((p) => ({ group: "App (Rust)", name: p.name, version: p.version, license: p.license ?? (p.license_file ? "See its license file" : "UNKNOWN"), url: `https://crates.io/crates/${p.name}` }));
}

const all = [...npmPackages(ROOT, "App (JavaScript)"), ...crates(), ...npmPackages(join(ROOT, "partner"), "This site")].sort(
  (a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name) || a.version.localeCompare(b.version),
);
const out = join(ROOT, "partner", "src", "site", "notices.json");
writeFileSync(out, JSON.stringify(all) + "\n");
console.log(`${all.length} packages -> partner/src/site/notices.json`);
