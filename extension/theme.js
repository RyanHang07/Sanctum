// The app's theme on the extension's pages (v0.3). Sanctum sends it over native messaging, the
// background stores it, and this paints the sealed page and the popup in it, following changes
// live. Without one (Sanctum never connected), tokens.css draws Sanctum Dark.

/** The app calls the text on the accent `sealed-on`; tokens.css calls it `--on-sealed`. */
const NAMES = { "sealed-on": "on-sealed" };
const SAFE_NAME = /^[a-z0-9-]{1,32}$/;
const HEX = /^#[0-9A-Fa-f]{6}$/;

export function applyTheme(theme, doc = document) {
  if (!theme || typeof theme.palette !== "object" || !theme.palette) return;
  const root = doc.documentElement;
  for (const [name, value] of Object.entries(theme.palette)) {
    // The app already sends only plain colours; this page checks again.
    if (SAFE_NAME.test(name) && typeof value === "string" && HEX.test(value)) root.style.setProperty(`--${NAMES[name] ?? name}`, value);
  }
  const scheme = theme.scheme === "light" ? "light" : "dark";
  root.style.colorScheme = scheme;
  root.dataset.scheme = scheme;
  // The mark's dark-ink version on light themes (design/logo, never redrawn).
  for (const img of doc.querySelectorAll("img[data-mark]")) img.src = scheme === "light" ? "icons/mark-light.svg" : "icons/mark.svg";
}

if (typeof chrome !== "undefined" && chrome.storage) {
  void chrome.storage.local.get("theme").then(({ theme }) => applyTheme(theme));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.theme) applyTheme(changes.theme.newValue);
  });
}
