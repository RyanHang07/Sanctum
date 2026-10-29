// The extension's service worker against a fake `chrome`: what it does when the browser starts
// with blocking rules left over from a seal (the PC went off mid-seal; v0.1.3 fix).

type Rule = { id: number };

function fakeChrome(opts: { stored?: unknown; dnr?: Rule[]; connectFails?: boolean }) {
  let dynamic = [...(opts.dnr ?? [])];
  const local: Record<string, unknown> = opts.stored ? { rules: opts.stored } : {};
  const listeners: Record<string, ((...a: unknown[]) => unknown)[]> = {};
  const on = (name: string) => ({ addListener: (f: (...a: unknown[]) => unknown) => (listeners[name] ??= []).push(f) });
  const chrome = {
    runtime: {
      getURL: (p: string) => `chrome-extension://id/${p}`,
      getManifest: () => ({ version: "0.1.3" }),
      connectNative: () => {
        if (opts.connectFails) throw new Error("no host");
        return { onMessage: on("port.message"), onDisconnect: on("port.disconnect"), postMessage: () => undefined };
      },
      onMessage: on("runtime.message"),
    },
    extension: { isAllowedIncognitoAccess: async () => false },
    storage: {
      local: { get: async () => ({ ...local }), set: async (v: Record<string, unknown>) => void Object.assign(local, v) },
      session: { get: async () => ({}), set: async () => undefined },
    },
    declarativeNetRequest: {
      getDynamicRules: async () => [...dynamic],
      updateDynamicRules: async ({ removeRuleIds, addRules }: { removeRuleIds: number[]; addRules: Rule[] }) => {
        dynamic = dynamic.filter((r) => !removeRuleIds.includes(r.id)).concat(addRules);
      },
    },
    tabs: { query: async () => [], update: async () => undefined, onUpdated: on("tabs.updated"), onActivated: on("tabs.activated"), onRemoved: on("tabs.removed") },
    windows: { getLastFocused: async () => null, onFocusChanged: on("windows.focus") },
    alarms: { create: () => undefined, onAlarm: on("alarm") },
  };
  return { chrome, dynamic: () => dynamic, local, listeners };
}

async function boot(fake: ReturnType<typeof fakeChrome>) {
  vi.resetModules();
  (globalThis as unknown as { chrome: unknown }).chrome = fake.chrome;
  // @ts-expect-error: plain JS module
  await import("../../extension/background.js");
  // Let the start-up promise chain settle.
  for (let i = 0; i < 10; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
}

const SEALED = (endsAt: number) => ({ sealed: true, sites: [{ domain: "youtube.com" }], keywords: [], endsAt, profile: "Deep Work" });

describe("extension worker after a restart (v0.1.3)", () => {
  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as { chrome?: unknown }).chrome;
  });

  it("clears blocking rules left behind when nothing is sealed", async () => {
    const fake = fakeChrome({ dnr: [{ id: 1 }, { id: 2 }], connectFails: true });
    await boot(fake);
    expect(fake.dynamic()).toEqual([]);
  });

  it("lifts a seal whose time ran out while the PC was off", async () => {
    const fake = fakeChrome({ stored: SEALED(Date.now() - 60 * 60_000), dnr: [{ id: 1 }], connectFails: true });
    await boot(fake);
    expect(fake.dynamic()).toEqual([]);
    expect((fake.local.rules as { sealed: boolean }).sealed).toBe(false);
  });

  it("keeps a seal that's still running, even with Sanctum not up yet", async () => {
    const fake = fakeChrome({ stored: SEALED(Date.now() + 30 * 60_000), connectFails: true });
    await boot(fake);
    expect(fake.dynamic().length).toBeGreaterThan(0);
    expect((fake.local.rules as { sealed: boolean }).sealed).toBe(true);
  });

  it("an offline bridge doesn't count as Sanctum: an expired seal still lifts (v0.1.4)", async () => {
    const fake = fakeChrome({ stored: SEALED(Date.now() + 60_000) });
    await boot(fake);
    const send = (m: unknown) => fake.listeners["port.message"]![0]!(m);
    // Sanctum was there, then quit; the bridge says so.
    await send({ type: "online" });
    await send({ type: "offline" });
    expect(fake.dynamic().length).toBeGreaterThan(0);
    // Past the planned end, the heartbeat lifts it.
    const later = Date.now() + 5 * 60_000;
    vi.spyOn(Date, "now").mockReturnValue(later);
    await fake.listeners["alarm"]![0]!({ name: "heartbeat" });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(fake.dynamic()).toEqual([]);
    vi.restoreAllMocks();
  });

  it("the blocked page's Open re-syncs before navigating", async () => {
    const fake = fakeChrome({ connectFails: true });
    await boot(fake);
    // A stale rule appears after start-up (e.g. restored by the browser late).
    await fake.chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [], addRules: [{ id: 9 }] });
    const reply = await fake.listeners["runtime.message"]![0]!({ type: "resync" }, {});
    expect(reply).toMatchObject({ sealed: false });
    expect(fake.dynamic()).toEqual([]);
  });
});
