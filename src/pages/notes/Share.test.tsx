import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { NotesPage } from "./NotesPage";
import { useNotes } from "../../state/notes";
import { useStore } from "../../state/store";
import { mockShares, resetMockBackend } from "../../lib/mockBackend";
import { native } from "../../lib/native";
import { decryptBytes, decryptJson, encryptBytes, encryptJson, newShareKey } from "../../lib/shareCrypto";
import { imageIdsIn } from "../../lib/noteImages";

const initial = useStore.getState();
const initialNotes = useNotes.getState();

beforeEach(() => {
  resetMockBackend();
  useStore.setState(initial, true);
  useNotes.setState(initialNotes, true);
});

describe("share crypto (v0.2)", () => {
  it("round-trips with the link's key, and nothing else opens it", async () => {
    const key = newShareKey();
    expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const cipher = await encryptJson(key, { title: "Plan", doc: { type: "doc" } });
    expect(cipher).not.toContain("Plan");
    expect(await decryptJson(key, cipher)).toEqual({ title: "Plan", doc: { type: "doc" } });
    await expect(decryptJson(newShareKey(), cipher)).rejects.toBeTruthy();
    const bytes = new Uint8Array([1, 2, 3, 250]);
    expect([...(await decryptBytes(key, await encryptBytes(key, bytes)))]).toEqual([1, 2, 3, 250]);
    // A fresh IV each time: the same text never encrypts the same way twice.
    expect(await encryptJson(key, "x")).not.toBe(await encryptJson(key, "x"));
  });

  it("finds the images a document shows", () => {
    const doc = { type: "doc", content: [{ type: "image", attrs: { src: "noteimg:4" } }, { type: "paragraph", content: [{ type: "image", attrs: { src: "noteimg:9" } }] }, { type: "image", attrs: { src: "noteimg:4" } }] };
    expect(imageIdsIn(doc)).toEqual([4, 9]);
  });
});

describe("sharing a note (v0.2)", () => {
  it("asks you to sign in first", async () => {
    await native.saveNote({ title: "Plan", body: "secret" });
    render(<NotesPage />);
    await act(async () => fireEvent.click(await screen.findByRole("button", { name: "Share" })));
    expect(await screen.findByText("Sign in to your Sanctum account to share notes.")).toBeInTheDocument();
  });

  it("shares for a day, pushes ciphertext only, follows edits, and stops", async () => {
    await native.cloudSignInEmail("me@example.com");
    await native.saveNote({ title: "Launch plan", body: "- ship it\n[ ] tell the team" });
    render(<NotesPage />);
    await act(async () => fireEvent.click(await screen.findByRole("button", { name: "Share" })));
    const dialog = within(await screen.findByRole("dialog", { name: "Share this note" }));
    await act(async () => fireEvent.click(await dialog.findByRole("button", { name: "1 day" })));

    const share = useNotes.getState().notes[0]!.share!;
    expect(share.url).toMatch(/\/n\/[0-9a-f]{64}#[A-Za-z0-9_-]{43}$/);
    expect(share.expiresAt - Date.now()).toBeGreaterThan(23 * 3_600_000);
    expect(screen.getByRole("textbox", { name: "Share link" })).toHaveValue(share.url);
    // What the server holds: ciphertext, readable only with the key from the link.
    const [stored] = [...mockShares.values()];
    expect(stored!.cipher).not.toContain("Launch plan");
    const opened = await decryptJson<{ title: string; doc: { content: { type: string }[] } }>(share.key, stored!.cipher);
    expect(opened.title).toBe("Launch plan");
    expect(opened.doc.content.map((b) => b.type)).toEqual(["bulletList", "taskList"]);

    // An edit reaches the link after typing pauses.
    vi.useFakeTimers();
    act(() => useNotes.getState().edit(useNotes.getState().notes[0]!.id, { title: "Launch plan v2" }));
    await act(async () => void (await vi.advanceTimersByTimeAsync(1600)));
    vi.useRealTimers();
    await act(async () => void (await new Promise((r) => setTimeout(r, 20))));
    expect((await decryptJson<{ title: string }>(share.key, [...mockShares.values()][0]!.cipher)).title).toBe("Launch plan v2");

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Stop sharing" })));
    expect(useNotes.getState().notes[0]!.share).toBeNull();
    expect(mockShares.size).toBe(0);
    expect(screen.getByRole("button", { name: "Share" })).toBeInTheDocument();
  });
});
