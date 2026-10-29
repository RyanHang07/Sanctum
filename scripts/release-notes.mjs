// Release notes from CHANGELOG.md (v0.2 site): the release workflow puts the tagged version's
// section into the GitHub release, and the site's /changelog reads releases from GitHub.
// Usage: node scripts/release-notes.mjs v0.2.0   (prints the notes; fails if there's no section)

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const INSTALL = `## Install

Download the \`-setup.exe\` below and run it. It installs for your user only, no admin needed.

Sanctum isn't code-signed, so Windows SmartScreen may say "Windows protected your PC". Click **More info**, then **Run anyway**.

See the [docs](https://sanctum-partner.vercel.app/docs/install) for the browser extension and Protection.`;

/**
 * The section of `changelog` for `tag`: under "## v0.2.0" or "## v0.2" (a ".0" patch can be
 * left off), up to the next "## ". Its "(in progress)" or date doesn't matter.
 */
export function sectionFor(changelog, tag) {
  const version = tag.replace(/^v/, "");
  const names = [version, version.replace(/\.0$/, "")].map((v) => `v${v}`);
  const lines = changelog.split(/\r?\n/);
  const start = lines.findIndex((l) => names.some((n) => l === `## ${n}` || l.startsWith(`## ${n} `)));
  if (start < 0) return null;
  const end = lines.findIndex((l, i) => i > start && l.startsWith("## "));
  return lines
    .slice(start + 1, end < 0 ? undefined : end)
    .join("\n")
    .trim();
}

/** The whole release body: the changes, then how to install. */
export function releaseBody(changelog, tag) {
  const section = sectionFor(changelog, tag);
  if (!section) return null;
  return `${section}\n\n${INSTALL}\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const tag = process.argv[2];
  const body = tag ? releaseBody(readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8"), tag) : null;
  if (!body) {
    console.error(`CHANGELOG.md has no "## ${tag}" section. Add one before tagging.`);
    process.exit(1);
  }
  process.stdout.write(body);
}
