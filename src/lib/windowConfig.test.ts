import conf from "../../src-tauri/tauri.conf.json";

// On Windows, Tauri's native file-drop handler swallows the page's own drag and drop, so drag
// between days, reordering and the Today | Tomorrow tabs need it off (2026-11-20).
describe("window config", () => {
  it("turns off the native file-drop handler on every window", () => {
    for (const w of conf.app.windows) expect(w, w.label).toHaveProperty("dragDropEnabled", false);
  });
});
