// @ts-expect-error: a plain .mjs script, no types
import { releaseBody, sectionFor } from "./release-notes.mjs";

const LOG = `# Changelog

## v0.2 (in progress)

- **Journal.** A page a day.

## v0.1.4 (2026-10-30)

- Counters.

### Fixed
- A bug.

## v0.1.3
- Older.
`;

describe("release notes from CHANGELOG.md (v0.2)", () => {
  it("takes the tagged version's section, up to the next version", () => {
    expect(sectionFor(LOG, "v0.1.4")).toBe("- Counters.\n\n### Fixed\n- A bug.");
    expect(sectionFor(LOG, "v0.1.3")).toBe("- Older.");
  });

  it("finds v0.2 for the tag v0.2.0", () => {
    expect(sectionFor(LOG, "v0.2.0")).toBe("- **Journal.** A page a day.");
  });

  it("has nothing for a version without a section, so the release stops", () => {
    expect(sectionFor(LOG, "v0.3.0")).toBeNull();
    expect(releaseBody(LOG, "v0.3.0")).toBeNull();
  });

  it("ends with how to install, which the site's changelog leaves out", () => {
    const body = releaseBody(LOG, "v0.1.4") as string;
    expect(body.startsWith("- Counters.")).toBe(true);
    expect(body).toContain("## Install");
    expect(body).toContain("Run anyway");
  });
});
