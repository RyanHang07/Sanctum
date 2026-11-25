import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import conf from "../src-tauri/tauri.conf.json";
// @ts-expect-error: a plain .mjs script, no types
import { checkManifest, download, parsePublicKey, parseSignature, updaterConfig, verifySignature } from "./verify-update.mjs";

// The release check (2026-11-24): a release is only good if an installed copy can update from it.

/** A minisign key pair in the form Tauri stores (base64 of the whole minisign file). */
function keyPair(id = randomBytes(8)) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const x = Buffer.from(publicKey.export({ format: "jwk" }).x!, "base64url");
  const text = `untrusted comment: minisign public key: ${id.toString("hex").toUpperCase()}\n${Buffer.concat([Buffer.from("Ed"), id, x]).toString("base64")}\n`;
  return { id, privateKey, pubkey: Buffer.from(text).toString("base64") };
}

/** A .sig as `tauri build` writes it: Ed25519 over the file's BLAKE2b-512, plus the trusted comment. */
function signFile(bytes: Buffer, key: { id: Buffer; privateKey: KeyObject }, trusted = "timestamp:1795584669\tfile:Sanctum_9.9.9_x64-setup.exe\tversion:9.9.9") {
  const sig = sign(null, createHash("blake2b512").update(bytes).digest(), key.privateKey);
  const global = sign(null, Buffer.concat([sig, Buffer.from(trusted)]), key.privateKey);
  const text = `untrusted comment: signature from tauri secret key\n${Buffer.concat([Buffer.from("ED"), key.id, sig]).toString("base64")}\ntrusted comment: ${trusted}\n${global.toString("base64")}\n`;
  return Buffer.from(text).toString("base64");
}

/** Text of a minisign file, so a test can change one line. */
const lines = (b64: string) => Buffer.from(b64, "base64").toString("utf8").split("\n");
const pack = (l: string[]) => Buffer.from(l.join("\n")).toString("base64");

const INSTALLER = Buffer.concat([Buffer.from("MZ"), randomBytes(4096)]);
const VERSION = "9.9.9";
const key = keyPair();

/**
 * Stands in for GitHub: an API asset link answers JSON unless asked for the file, then
 * redirects to it, as api.github.com does; a browser link serves the file directly.
 */
let server: Server;
let base = "";
let seen: { path: string; accept?: string }[] = [];
beforeAll(async () => {
  server = createServer((req, res) => {
    seen.push({ path: req.url!, accept: req.headers.accept });
    if (req.url === "/repos/o/r/releases/assets/1") {
      if (req.headers.accept === "application/octet-stream") {
        res.writeHead(302, { location: `${base}/blob/1` }).end();
      } else {
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ id: 1, name: "Sanctum_9.9.9_x64-setup.exe" }));
      }
    } else if (req.url === "/blob/1" || req.url === "/o/r/releases/download/v9.9.9/Sanctum_9.9.9_x64-setup.exe") {
      res.writeHead(200, { "content-type": "application/octet-stream" }).end(INSTALLER);
    } else if (req.url === "/page") {
      res.writeHead(200, { "content-type": "text/html" }).end("<!doctype html><p>Sign in</p>");
    } else {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(() => (seen = []));

const HOSTS = ["127.0.0.1"];
function manifest(url: string, signature = signFile(INSTALLER, key), version = VERSION) {
  const entry = { signature, url };
  return { version, notes: "Notes", pub_date: "2026-11-25T05:31:12.746Z", platforms: { "windows-x86_64": entry, "windows-x86_64-nsis": entry } };
}
const check = (m: unknown, opts: Record<string, unknown> = {}) => checkManifest(m, { version: VERSION, pubkey: key.pubkey, hosts: HOSTS, ...opts });

describe("the app's updater settings", () => {
  const u = updaterConfig(conf);

  it("trusts one Ed25519 minisign key, the one its comment names", () => {
    const pub = parsePublicKey(u.pubkey);
    // Minisign prints the id as a little-endian number, so its bytes read reversed.
    const named = lines(u.pubkey)[0]!.split(": ").pop()!.toLowerCase();
    expect(Buffer.from(pub.keyId, "hex").reverse().toString("hex")).toBe(named);
    expect(pub.key.asymmetricKeyType).toBe("ed25519");
  });

  it("reads the latest published release's latest.json, on this repo, over https", () => {
    expect(u.endpoints).toEqual(["https://github.com/ryanhang07/sanctum/releases/latest/download/latest.json"]);
  });

  it("installs passively, so an update needs no clicks in the installer", () => {
    expect(conf.plugins.updater.windows.installMode).toBe("passive");
  });

  it("builds signed update files only when a release asks (it needs the private key)", () => {
    expect((conf.bundle as Record<string, unknown>).createUpdaterArtifacts).toBeFalsy();
  });
});

describe("signatures, checked as tauri-plugin-updater checks them", () => {
  it("accepts a file signed with the trusted key", () => {
    const v = verifySignature(INSTALLER, signFile(INSTALLER, key), key.pubkey);
    expect(v).toEqual({ ok: true, trusted: expect.stringContaining("version:9.9.9") });
  });

  it("rejects a changed file", () => {
    const changed = Buffer.from(INSTALLER);
    changed[100] ^= 1;
    expect(verifySignature(changed, signFile(INSTALLER, key), key.pubkey).error).toMatch(/doesn't match the file/);
  });

  it("rejects a file signed with another key", () => {
    expect(verifySignature(INSTALLER, signFile(INSTALLER, keyPair()), key.pubkey).error).toMatch(/signed with key .*, the app trusts/);
  });

  it("rejects another key that borrows the trusted key's id", () => {
    expect(verifySignature(INSTALLER, signFile(INSTALLER, keyPair(key.id)), key.pubkey).error).toMatch(/doesn't match the file/);
  });

  it("rejects an edited trusted comment (it names the version)", () => {
    const l = lines(signFile(INSTALLER, key));
    l[2] = l[2]!.replace("version:9.9.9", "version:9.9.10");
    expect(verifySignature(INSTALLER, pack(l), key.pubkey).error).toMatch(/trusted comment was changed/);
  });

  it("rejects what isn't a signature", () => {
    for (const bad of ["", "bm90IGEgc2lnbmF0dXJl", Buffer.from("untrusted comment: x\nAAAA\n").toString("base64")]) {
      expect(verifySignature(INSTALLER, bad, key.pubkey).ok, bad).toBe(false);
    }
    expect(() => parseSignature("")).toThrow();
    expect(() => parsePublicKey(Buffer.from("untrusted comment: x\nAAAA\n").toString("base64"))).toThrow(/Ed25519/);
  });
});

describe("latest.json, read the way an installed copy reads it", () => {
  it("updates through a GitHub API asset link (tauri-action v1), asking for the file", async () => {
    expect(await check(manifest(`${base}/repos/o/r/releases/assets/1`))).toEqual([]);
    const asked = seen.filter((s) => s.path.startsWith("/repos/"));
    expect(asked.length).toBeGreaterThan(0);
    for (const s of asked) expect(s.accept).toBe("application/octet-stream");
  });

  it("still updates through a browser download link (what v0.4.4 and earlier publish)", async () => {
    expect(await check(manifest(`${base}/o/r/releases/download/v9.9.9/Sanctum_9.9.9_x64-setup.exe`))).toEqual([]);
  });

  it("an API link without that header gives JSON, not the installer, and the check says so", async () => {
    const json = await download(`${base}/repos/o/r/releases/assets/1`, { accept: "application/json" });
    expect(json.type).toMatch(/json/);
    const noHeader: typeof fetch = (url, init) => fetch(url, { ...init, headers: { ...(init?.headers as object), Accept: "*/*" } });
    const problems = await check(manifest(`${base}/repos/o/r/releases/assets/1`), { fetchImpl: noHeader });
    expect(problems[0]).toMatch(/gave application\/json .* not an installer/);
  });

  it("catches a link to a page instead of an installer", async () => {
    expect((await check(manifest(`${base}/page`)))[0]).toMatch(/gave text\/html/);
  });

  it("catches a missing installer", async () => {
    expect((await check(manifest(`${base}/repos/o/r/releases/assets/2`)))[0]).toMatch(/answered 404/);
  });

  it("catches a latest.json for another version, and a signature for another version", async () => {
    const url = `${base}/repos/o/r/releases/assets/1`;
    expect(await check(manifest(url, undefined, "9.9.8"))).toContain("latest.json says 9.9.8, the release is 9.9.9");
    const old = signFile(INSTALLER, key, "timestamp:1\tfile:Sanctum_9.9.8_x64-setup.exe\tversion:9.9.8");
    expect((await check(manifest(url, old)))[0]).toMatch(/signature is for another version/);
  });

  it("catches a bad signature on the installer", async () => {
    const other = signFile(INSTALLER, keyPair());
    expect((await check(manifest(`${base}/repos/o/r/releases/assets/1`, other)))[0]).toMatch(/signed with key/);
  });

  it("needs the Windows entry, a date, https, and GitHub as the host", async () => {
    const m = manifest(`${base}/repos/o/r/releases/assets/1`);
    expect(await check({ ...m, platforms: {} })).toContain("latest.json has no windows-x86_64 entry");
    expect(await check({ ...m, pub_date: "soon" })).toContain("latest.json has no valid pub_date");
    const plain = manifest("http://github.com/o/r/releases/download/v9.9.9/x.exe");
    expect((await checkManifest(plain, { version: VERSION, pubkey: key.pubkey, fetchImpl: async () => new Response(INSTALLER) }))[0]).toMatch(/isn't https/);
    expect((await checkManifest(manifest("https://example.com/x.exe"), { version: VERSION, pubkey: key.pubkey }))[0]).toMatch(/example\.com isn't an expected host/);
  });
});
