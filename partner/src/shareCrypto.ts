// COPY of src/lib/shareCrypto.ts (keep them the same). End-to-end encryption for shared notes (v0.2). The app encrypts; the partner site's
// /n/<token>#<key> page decrypts (partner/src/shareCrypto.ts is a copy of this file: keep them
// the same). The key is 32 random bytes, written base64url into the link's #fragment, which a
// browser never sends to any server. AES-256-GCM with a fresh 12-byte IV per message:
// ciphertext = base64url(iv || encrypted bytes, tag included).

const b64url = {
  encode(bytes: Uint8Array): string {
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  },
  decode(text: string): Uint8Array {
    const b = atob(text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4));
    const out = new Uint8Array(b.length);
    for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
    return out;
  },
};

/** Standard base64 (what the app's backend takes for uploads). */
export function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** A new random key, as the text that goes in the link. */
export function newShareKey(): string {
  return b64url.encode(crypto.getRandomValues(new Uint8Array(32)));
}

const importKey = (key: string) => crypto.subtle.importKey("raw", b64url.decode(key) as BufferSource, "AES-GCM", false, ["encrypt", "decrypt"]);

/** Encrypts bytes: iv || ciphertext. */
export async function encryptBytes(key: string, plain: Uint8Array): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await importKey(key), plain as BufferSource));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv);
  out.set(ct, iv.length);
  return out;
}

export async function decryptBytes(key: string, sealed: Uint8Array): Promise<Uint8Array> {
  const iv = sealed.slice(0, 12);
  return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: iv as BufferSource }, await importKey(key), sealed.subarray(12) as BufferSource));
}

/** A JSON value, encrypted, as base64url text. */
export async function encryptJson(key: string, value: unknown): Promise<string> {
  return b64url.encode(await encryptBytes(key, new TextEncoder().encode(JSON.stringify(value))));
}

export async function decryptJson<T>(key: string, cipher: string): Promise<T> {
  return JSON.parse(new TextDecoder().decode(await decryptBytes(key, b64url.decode(cipher)))) as T;
}
