// Checks a release the way an installed copy of Sanctum will use it (2026-11-24): latest.json
// names this version, every installer link downloads an installer when asked the way the
// updater asks (Accept: application/octet-stream, as GitHub API asset links need since
// tauri-action v1), and each signature verifies against the updater key in tauri.conf.json.
//
// Usage: node scripts/verify-update.mjs v0.4.4
//   Finds the release for that tag (drafts too, with GITHUB_TOKEN) and checks its latest.json.
//   For a published release it also reads the public endpoint without a token, as the app does.

import { createHash, createPublicKey, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const OCTET = "application/octet-stream";

/** Tauri stores minisign keys and signatures as base64 of the whole minisign text file. */
function minisignLines(b64, what) {
  const text = Buffer.from(String(b64 ?? ""), "base64").toString("utf8");
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (!lines[0]?.startsWith("untrusted comment:")) throw new Error(`${what} isn't a minisign file`);
  return lines;
}

/** The updater's public key: its id and the Ed25519 key. */
export function parsePublicKey(b64) {
  const raw = Buffer.from(minisignLines(b64, "The public key")[1] ?? "", "base64");
  if (raw.length !== 42 || raw.subarray(0, 2).toString() !== "Ed") throw new Error("The public key isn't an Ed25519 minisign key");
  const key = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: raw.subarray(10).toString("base64url") }, format: "jwk" });
  return { keyId: raw.subarray(2, 10).toString("hex"), key };
}

/** A .sig as latest.json carries it. */
export function parseSignature(b64) {
  const lines = minisignLines(b64, "The signature");
  const raw = Buffer.from(lines[1] ?? "", "base64");
  const trustedLine = lines[2] ?? "";
  if (raw.length !== 74 || !trustedLine.startsWith("trusted comment: ")) throw new Error("The signature is malformed");
  return {
    alg: raw.subarray(0, 2).toString(),
    keyId: raw.subarray(2, 10).toString("hex"),
    sig: raw.subarray(10),
    trusted: trustedLine.slice("trusted comment: ".length),
    globalSig: Buffer.from(lines[3] ?? "", "base64"),
  };
}

/** Verifies `bytes` against a minisign signature, as tauri-plugin-updater does. */
export function verifySignature(bytes, sigB64, pubB64) {
  try {
    const pub = parsePublicKey(pubB64);
    const s = parseSignature(sigB64);
    if (s.keyId !== pub.keyId) return { ok: false, error: `signed with key ${s.keyId}, the app trusts ${pub.keyId}` };
    // "ED" signs the BLAKE2b-512 of the file (what Tauri makes); "Ed" signs the file itself.
    const message = s.alg === "ED" ? createHash("blake2b512").update(bytes).digest() : s.alg === "Ed" ? bytes : null;
    if (!message) return { ok: false, error: `unknown signature algorithm ${s.alg}` };
    if (!verify(null, message, pub.key, s.sig)) return { ok: false, error: "the signature doesn't match the file" };
    if (!verify(null, Buffer.concat([s.sig, Buffer.from(s.trusted)]), pub.key, s.globalSig)) {
      return { ok: false, error: "the signature's trusted comment was changed" };
    }
    return { ok: true, trusted: s.trusted };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Downloads as the updater does. A token is only for drafts, which aren't public. */
export async function download(url, { token, accept = OCTET, fetchImpl = fetch } = {}) {
  const headers = { Accept: accept, "User-Agent": "sanctum-release-check" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetchImpl(url, { headers, redirect: "follow" });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return { bytes: Buffer.from(await res.arrayBuffer()), type: res.headers.get("content-type") ?? "" };
}

/**
 * Everything wrong with a latest.json, or [] when an installed copy will update from it.
 * `hosts` are where installer links may point (GitHub, or a local server in tests).
 */
export async function checkManifest(manifest, { version, pubkey, token, hosts = ["github.com", "api.github.com"], fetchImpl = fetch }) {
  const problems = [];
  if (manifest?.version !== version) problems.push(`latest.json says ${manifest?.version}, the release is ${version}`);
  if (Number.isNaN(Date.parse(manifest?.pub_date ?? ""))) problems.push("latest.json has no valid pub_date");
  const platforms = manifest?.platforms ?? {};
  if (!platforms["windows-x86_64"]) problems.push("latest.json has no windows-x86_64 entry");
  for (const [name, p] of Object.entries(platforms)) {
    let url;
    try {
      url = new URL(p.url);
    } catch {
      problems.push(`${name}: no valid url`);
      continue;
    }
    const local = url.hostname === "127.0.0.1" || url.hostname === "localhost";
    if (url.protocol !== "https:" && !local) problems.push(`${name}: ${url} isn't https`);
    if (!hosts.includes(url.hostname)) {
      problems.push(`${name}: ${url.hostname} isn't an expected host`);
      continue;
    }
    let file;
    try {
      file = await download(p.url, { token, fetchImpl });
    } catch (e) {
      problems.push(`${name}: ${e instanceof Error ? e.message : e}`);
      continue;
    }
    // GitHub API links answer JSON unless asked for the file; a page or JSON here means the updater gets no installer.
    if (file.bytes.subarray(0, 2).toString("latin1") !== "MZ") {
      problems.push(`${name}: the link gave ${file.type || "something"} (${file.bytes.length} bytes), not an installer`);
      continue;
    }
    const v = verifySignature(file.bytes, p.signature, pubkey);
    if (!v.ok) problems.push(`${name}: ${v.error}`);
    else if (!v.trusted.includes(`version:${version}`)) problems.push(`${name}: the signature is for another version (${v.trusted})`);
  }
  return problems;
}

/** The app's updater settings, from tauri.conf.json. */
export function updaterConfig(conf) {
  const u = conf?.plugins?.updater ?? {};
  return { version: conf?.version, pubkey: u.pubkey, endpoints: u.endpoints ?? [] };
}

async function main(tag) {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const conf = JSON.parse(readFileSync(`${root}src-tauri/tauri.conf.json`, "utf8"));
  const { version, pubkey, endpoints } = updaterConfig(conf);
  const repo = process.env.GITHUB_REPOSITORY ?? "RyanHang07/Sanctum";
  const token = process.env.GITHUB_TOKEN || undefined;
  const api = `https://api.github.com/repos/${repo}`;
  const json = async (url, auth) => JSON.parse((await download(url, { token: auth, accept: "application/vnd.github+json" })).bytes.toString("utf8"));

  // Drafts have no tag yet, so look through the list (drafts show only with a token).
  const releases = await json(`${api}/releases?per_page=30`, token);
  const release = releases.find((r) => r.tag_name === tag);
  if (!release) throw new Error(`No release for ${tag}`);
  const asset = release.assets.find((a) => a.name === "latest.json");
  if (!asset) throw new Error(`${tag} has no latest.json`);
  const manifest = JSON.parse((await download(asset.url, { token })).bytes.toString("utf8"));

  const problems = await checkManifest(manifest, { version, pubkey, token: release.draft ? token : undefined });
  console.log(`${tag}${release.draft ? " (draft)" : ""}: latest.json for ${manifest.version}, ${Object.keys(manifest.platforms ?? {}).length} platform entries`);

  // What an installed copy reads: the public endpoint, no token.
  if (!release.draft) {
    for (const endpoint of endpoints) {
      // "latest" can take a few seconds to move to a release published moments ago.
      let live;
      for (let i = 0; i < 6; i++) {
        live = JSON.parse((await download(endpoint, { accept: "application/json" })).bytes.toString("utf8"));
        if (live.version === version) break;
        await new Promise((r) => setTimeout(r, 10_000));
      }
      for (const p of await checkManifest(live, { version, pubkey })) problems.push(`public ${endpoint}: ${p}`);
      console.log(`public endpoint serves ${live.version}`);
    }
  }
  if (problems.length) {
    for (const p of problems) console.error(`::error::${p}`);
    process.exit(1);
  }
  console.log("Installed copies can update to this release.");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const tag = process.argv[2];
  if (!tag) {
    console.error("Usage: node scripts/verify-update.mjs <tag>");
    process.exit(2);
  }
  main(tag).catch((e) => {
    console.error(`::error::${e instanceof Error ? e.message : e}`);
    process.exit(1);
  });
}
