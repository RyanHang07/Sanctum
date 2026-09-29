import { vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("MODE", "development");
});
afterEach(() => vi.unstubAllEnvs());

describe("dev seed", () => {
  it("seeds the sample profiles exactly once, even when startup runs twice", async () => {
    // Fresh module graph so the single-flight promise and the mock backend start clean.
    const { seedDevProfiles } = await import("./devSeed");
    const { native } = await import("./native");
    await Promise.all([seedDevProfiles(), seedDevProfiles()]);
    await seedDevProfiles();
    const names = (await native.listProfiles()).map((p) => p.name);
    expect(names).toEqual(["Interview Prep", "Deep Work", "Study", "Light Work"]);
    expect(await native.getSetting("dev_seeded")).toBe("1");
  });
});
