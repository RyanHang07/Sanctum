import { native } from "./native";
import { mockJournalExport, resetMockBackend } from "./mockBackend";
import { journalSnippet } from "./mockJournal";

beforeEach(() => resetMockBackend());

const filler = "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau";

describe("the preview's journal search", () => {
  it("matches any case, newest first, and ignores blank queries", async () => {
    await native.journalSave("2026-10-01", null, "Walked by the river.");
    await native.journalSave("2026-10-03", null, "The RIVER was high.");
    await native.journalSave("2026-10-02", null, "Stayed in.");
    expect(await native.journalSearch("river")).toEqual([
      { date: "2026-10-03", snippet: "The RIVER was high." },
      { date: "2026-10-01", snippet: "Walked by the river." },
    ]);
    expect(await native.journalSearch("ocean")).toEqual([]);
    expect(await native.journalSearch("   ")).toEqual([]);
  });

  it("returns at most fifty hits", async () => {
    for (let i = 0; i < 60; i++) await native.journalSave(new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10), null, "same words");
    const hits = await native.journalSearch("words");
    expect(hits).toHaveLength(50);
    expect(hits[0]!.date).toBe("2026-03-01");
  });

  it("cuts snippets at words around the match", () => {
    const s = journalSnippet(`${filler} ${filler} needle ${filler} ${filler}`, "NEEDLE")!;
    expect(s.startsWith("…") && s.endsWith("…")).toBe(true);
    const inner = s.replace(/^…|…$/g, "");
    expect(Array.from(inner).length).toBeLessThanOrEqual(120);
    const words = filler.split(" ");
    expect(inner.split(" ").every((w) => w === "needle" || words.includes(w))).toBe(true);
    expect(journalSnippet("Line one.\n\nLine  two.", "two")).toBe("Line one. Line two.");
    expect(journalSnippet(`${filler} ${filler} last`, "last")).toMatch(/^….*last$/);
    expect(journalSnippet("nothing here", "else")).toBeNull();
  });

  it("refuses search and export while locked", async () => {
    await native.journalSave("2026-10-01", null, "Private.");
    await native.journalSetLock("pin", "4821");
    await native.journalLock();
    await expect(native.journalSearch("private")).rejects.toBe("The journal is locked.");
    await expect(native.journalExport("md")).rejects.toBe("The journal is locked.");
    await native.journalUnlockPin("4821");
    expect(await native.journalSearch("private")).toHaveLength(1);
  });
});

describe("the preview's journal export", () => {
  it("writes Markdown and JSON, oldest first", async () => {
    await native.journalSave("2026-11-02", '{"type":"doc"}', "Second page.");
    await native.journalSave("2026-11-01", null, "First page.\nTwo lines.");
    const f = await native.journalExport("md");
    expect(f.name).toMatch(/^Sanctum journal \d{4}-\d{2}-\d{2}\.md$/);
    expect(mockJournalExport.text).toBe("## Sunday, November 1, 2026\n\nFirst page.\nTwo lines.\n\n## Monday, November 2, 2026\n\nSecond page.\n");
    await native.journalExport("json");
    expect(JSON.parse(mockJournalExport.text!)).toEqual([
      { date: "2026-11-01", doc: null, body: "First page.\nTwo lines.", updatedAt: expect.any(Number) },
      { date: "2026-11-02", doc: '{"type":"doc"}', body: "Second page.", updatedAt: expect.any(Number) },
    ]);
  });
});
