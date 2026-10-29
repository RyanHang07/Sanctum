import { inTauri, native } from "./native";
import { mockNoteImageUrl } from "./mockBackend";

// Images in notes (v0.2). A document refers to an image as "noteimg:<id>"; the window loads it
// from Sanctum's private scheme (src-tauri/src/note_images.rs), or, in the browser preview,
// from the mock's copy.

export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
const PREFIX = "noteimg:";

/** "noteimg:12" -> 12, also from the URL it was shown at (copy and paste within Sanctum). */
export function imageId(src: string | null | undefined): number | null {
  const m = /noteimg(?::|\.localhost\/|:\/\/localhost\/)(\d+)$/.exec(src ?? "");
  return m ? Number(m[1]) : null;
}

/** What an <img> loads for a stored reference; anything else is left as it is. */
export function noteImageUrl(src: string | null | undefined): string | null {
  const id = imageId(src);
  if (id === null) return src ?? null;
  if (!inTauri()) return mockNoteImageUrl(id);
  // WebView2 serves custom schemes as http://<scheme>.localhost; elsewhere <scheme>://localhost.
  return navigator.userAgent.includes("Windows") ? `http://noteimg.localhost/${id}` : `noteimg://localhost/${id}`;
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  // In chunks: a large image would overflow the argument list in one call.
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Saves an image file and returns its reference ("noteimg:12"). */
export async function storeImage(file: Blob): Promise<string> {
  if (!IMAGE_TYPES.includes(file.type)) throw "Use a PNG, JPEG, GIF, or WebP image.";
  const id = await native.saveNoteImage(toBase64(await file.arrayBuffer()), file.type);
  return `${PREFIX}${id}`;
}

/** Opens the file picker for images; resolves with what was chosen (maybe nothing). */
export function pickImages(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = IMAGE_TYPES.join(",");
    input.multiple = true;
    input.onchange = () => resolve([...(input.files ?? [])]);
    input.addEventListener("cancel", () => resolve([]));
    input.click();
  });
}
