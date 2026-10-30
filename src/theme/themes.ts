import { contrast, mix, onColor, rgb } from "./color";
import { SANCTUM_DARK, type Palette, type Theme } from "./palette";

// The themes (v0.3, decided 2026-10-29): Sanctum Dark (the design tokens) and twelve more, each
// built from its own published colours. A theme names its surfaces, text, accent (which
// becomes the sealed colour), event and broken colours, and the four lights of each mesh
// (held: sealed and the held page; ember: in an event). The rest (tints, lines, accent text,
// text on the accent) is derived so every theme clears the same contrast bar (themes.test.ts).
// Colours only: fonts, spacing, and the mark never change with the theme.

interface Base {
  id: string;
  name: string;
  scheme: "dark" | "light";
  app: string;
  sidebar: string;
  panel: string;
  raised: string;
  line: string;
  lineInput: string;
  text: string;
  text2: string;
  muted: string;
  faint: string;
  /** The theme's accent: the sealed colour. */
  accent: string;
  event: string;
  broken: string;
  held: [string, string, string, string];
  ember: [string, string, string, string];
}

const WHITE = "#FFFFFF";
const BLACK = "#000000";
const rgba = (c: string, a: number) => `rgba(${rgb(c).join(", ")}, ${a})`;

/** `c`, nudged toward `toward` until it reaches `ratio` on every background. */
function readable(c: string, bgs: string[], ratio: number, toward: string): string {
  let out = c;
  for (let t = 0.04; bgs.some((bg) => contrast(out, bg) < ratio) && t <= 1; t += 0.04) out = mix(c, toward, t);
  return out;
}

export function derive(b: Base): Theme {
  const dark = b.scheme === "dark";
  const away = dark ? WHITE : BLACK; // toward more contrast against the surfaces
  // The sealed fill carries text (Enter focus): white or the theme's dark, whichever reads; a
  // mid accent that suits neither is deepened (or lifted) until one does.
  const darkInk = dark ? b.app : b.text;
  let sealed = b.accent;
  let on = onColor(sealed, WHITE, darkInk);
  if (contrast(on, sealed) < 4.5) sealed = readable(sealed, [on], 4.5, on === WHITE ? BLACK : WHITE);
  on = onColor(sealed, WHITE, darkInk);

  const sealedTint = mix(b.app, sealed, dark ? 0.17 : 0.1);
  const sealedText = readable(sealed, [b.app, b.panel, sealedTint], 4.5, away);
  const brokenTint = mix(b.app, b.broken, dark ? 0.14 : 0.09);
  const shade = dark ? "#05060A" : "#12151C";

  const p: Palette = {
    app: b.app,
    sidebar: b.sidebar,
    panel: b.panel,
    "panel-footer": mix(b.panel, b.app, 0.5),
    raised: b.raised,
    line: b.line,
    "line-soft": mix(b.line, b.panel, 0.5),
    "line-input": b.lineInput,
    text: b.text,
    "text-2": b.text2,
    muted: b.muted,
    faint: b.faint,
    payoff: mix(b.text2, b.muted, 0.6),
    sealed,
    "sealed-text": sealedText,
    "sealed-text-hover": mix(sealedText, away, 0.35),
    "sealed-on": on,
    "sealed-tint": sealedTint,
    "sealed-line": mix(b.app, sealed, dark ? 0.45 : 0.35),
    event: readable(b.event, [b.app, b.panel], 3, away),
    "event-tint": mix(b.app, b.event, dark ? 0.13 : 0.1),
    "event-line": mix(b.app, b.event, dark ? 0.4 : 0.35),
    open: b.text,
    "held-1": b.held[0],
    "held-2": b.held[1],
    "held-3": b.held[2],
    "held-4": b.held[3],
    "ember-1": b.ember[0],
    "ember-2": b.ember[1],
    "ember-3": b.ember[2],
    "ember-4": b.ember[3],
    locked: mix(b.faint, b.app, 0.25),
    toast: dark ? mix(b.raised, b.line, 0.3) : b.panel,
    "check-line": mix(b.lineInput, b.muted, 0.3),
    broken: b.broken,
    "broken-tint": brokenTint,
    "broken-text": readable(b.broken, [b.app, b.panel, brokenTint], 4.5, away),
    "broken-line": mix(b.app, b.broken, dark ? 0.4 : 0.35),
    "heat-1": mix(b.panel, sealed, 0.25),
    "heat-2": mix(b.panel, sealed, 0.5),
    "heat-3": mix(b.panel, sealed, 0.8),
    scrim: rgba(shade, dark ? 0.66 : 0.32),
    "shadow-toast": `0 12px 32px ${rgba(shade, dark ? 0.45 : 0.16)}`,
    "shadow-dialog": `0 24px 64px ${rgba(shade, dark ? 0.55 : 0.22)}`,
    "shadow-lift": `0 8px 20px -10px ${rgba(shade, dark ? 0.7 : 0.28)}`,
  };
  return { id: b.id, name: b.name, scheme: b.scheme, palette: p };
}

const BASES: Base[] = [
  {
    id: "sanctum-light",
    name: "Sanctum Light",
    scheme: "light",
    app: "#F7F8FA",
    sidebar: "#F0F2F5",
    panel: "#FFFFFF",
    raised: "#EEF0F4",
    line: "#E2E5EB",
    lineInput: "#D2D7E0",
    text: "#12151C",
    text2: "#394050",
    muted: "#5D6678",
    faint: "#8A93A6",
    accent: "#2F5BFF",
    event: "#E0502E",
    broken: "#D93036",
    held: ["#1F3FD9", "#2F5BFF", "#6A4CFF", "#12A8C9"],
    ember: ["#C8402A", "#FF8A6B", "#D9466A", "#F2A33A"],
  },
  {
    id: "github-dark",
    name: "GitHub Dark",
    scheme: "dark",
    app: "#0D1117",
    sidebar: "#010409",
    panel: "#161B22",
    raised: "#21262D",
    line: "#30363D",
    lineInput: "#3D444D",
    text: "#E6EDF3",
    text2: "#C9D1D9",
    muted: "#8B949E",
    faint: "#6E7681",
    accent: "#1F6FEB",
    event: "#DB6D28",
    broken: "#F85149",
    held: ["#1F6FEB", "#388BFD", "#8957E5", "#2EA043"],
    ember: ["#BD561D", "#DB6D28", "#DA3633", "#D29922"],
  },
  {
    id: "github-light",
    name: "GitHub Light",
    scheme: "light",
    app: "#F6F8FA",
    sidebar: "#F0F3F6",
    panel: "#FFFFFF",
    raised: "#F6F8FA",
    line: "#D1D9E0",
    lineInput: "#C8D1DA",
    text: "#1F2328",
    text2: "#31373D",
    muted: "#59636E",
    faint: "#818B98",
    accent: "#0969DA",
    event: "#BC4C00",
    broken: "#D1242F",
    held: ["#0969DA", "#218BFF", "#8250DF", "#1A7F37"],
    ember: ["#BC4C00", "#FB8F44", "#CF222E", "#BF8700"],
  },
  {
    id: "dracula",
    name: "Dracula",
    scheme: "dark",
    app: "#282A36",
    sidebar: "#21222C",
    panel: "#2E3040",
    raised: "#383A4A",
    line: "#44475A",
    lineInput: "#4E5168",
    text: "#F8F8F2",
    text2: "#E0E0DA",
    muted: "#A0A6C4",
    faint: "#6272A4",
    accent: "#BD93F9",
    event: "#FFB86C",
    broken: "#FF5555",
    held: ["#BD93F9", "#FF79C6", "#8BE9FD", "#6272A4"],
    ember: ["#FFB86C", "#FF5555", "#FF79C6", "#F1FA8C"],
  },
  {
    id: "one-dark",
    name: "One Dark",
    scheme: "dark",
    app: "#282C34",
    sidebar: "#21252B",
    panel: "#2C313A",
    raised: "#333842",
    line: "#3E4451",
    lineInput: "#4B5263",
    text: "#D7DAE0",
    text2: "#ABB2BF",
    muted: "#949AA5",
    faint: "#5C6370",
    accent: "#61AFEF",
    event: "#D19A66",
    broken: "#E06C75",
    held: ["#61AFEF", "#C678DD", "#56B6C2", "#528BFF"],
    ember: ["#D19A66", "#E06C75", "#C678DD", "#E5C07B"],
  },
  {
    id: "monokai",
    name: "Monokai",
    scheme: "dark",
    app: "#272822",
    sidebar: "#1E1F1C",
    panel: "#2D2E27",
    raised: "#3E3D32",
    line: "#49483E",
    lineInput: "#57564A",
    text: "#F8F8F2",
    text2: "#CFCFC2",
    muted: "#A09F93",
    faint: "#75715E",
    accent: "#66D9EF",
    event: "#FD971F",
    broken: "#F92672",
    held: ["#66D9EF", "#AE81FF", "#A6E22E", "#66D9EF"],
    ember: ["#FD971F", "#F92672", "#E6DB74", "#FD971F"],
  },
  {
    id: "tokyo-night",
    name: "Tokyo Night",
    scheme: "dark",
    app: "#1A1B26",
    sidebar: "#16161E",
    panel: "#1F2335",
    raised: "#24283B",
    line: "#292E42",
    lineInput: "#3B4261",
    text: "#C0CAF5",
    text2: "#A9B1D6",
    muted: "#8890B8",
    faint: "#565F89",
    accent: "#7AA2F7",
    event: "#FF9E64",
    broken: "#F7768E",
    held: ["#7AA2F7", "#BB9AF7", "#7DCFFF", "#2AC3DE"],
    ember: ["#FF9E64", "#F7768E", "#BB9AF7", "#E0AF68"],
  },
  {
    id: "catppuccin-mocha",
    name: "Catppuccin Mocha",
    scheme: "dark",
    app: "#1E1E2E",
    sidebar: "#181825",
    panel: "#24273A",
    raised: "#313244",
    line: "#363A4F",
    lineInput: "#45475A",
    text: "#CDD6F4",
    text2: "#BAC2DE",
    muted: "#9399B2",
    faint: "#6C7086",
    accent: "#CBA6F7",
    event: "#FAB387",
    broken: "#F38BA8",
    held: ["#CBA6F7", "#89B4FA", "#F5C2E7", "#94E2D5"],
    ember: ["#FAB387", "#F38BA8", "#EBA0AC", "#F9E2AF"],
  },
  {
    id: "catppuccin-latte",
    name: "Catppuccin Latte",
    scheme: "light",
    app: "#EFF1F5",
    sidebar: "#E6E9EF",
    panel: "#F7F8FB",
    raised: "#E6E9EF",
    line: "#DCE0E8",
    lineInput: "#CCD0DA",
    text: "#4C4F69",
    text2: "#5C5F77",
    muted: "#63667C",
    faint: "#9CA0B0",
    accent: "#8839EF",
    event: "#FE640B",
    broken: "#D20F39",
    held: ["#8839EF", "#1E66F5", "#EA76CB", "#179299"],
    ember: ["#FE640B", "#D20F39", "#E64553", "#DF8E1D"],
  },
  {
    id: "nord",
    name: "Nord",
    scheme: "dark",
    app: "#2E3440",
    sidebar: "#2A303B",
    panel: "#3B4252",
    raised: "#434C5E",
    line: "#4C566A",
    lineInput: "#56607A",
    text: "#ECEFF4",
    text2: "#E5E9F0",
    muted: "#A9B2C3",
    faint: "#7B88A1",
    accent: "#88C0D0",
    event: "#D08770",
    broken: "#BF616A",
    held: ["#88C0D0", "#81A1C1", "#5E81AC", "#8FBCBB"],
    ember: ["#D08770", "#BF616A", "#B48EAD", "#EBCB8B"],
  },
  {
    id: "gruvbox-dark",
    name: "Gruvbox Dark",
    scheme: "dark",
    app: "#282828",
    sidebar: "#1D2021",
    panel: "#32302F",
    raised: "#3C3836",
    line: "#504945",
    lineInput: "#665C54",
    text: "#EBDBB2",
    text2: "#D5C4A1",
    muted: "#A89984",
    faint: "#7C6F64",
    accent: "#83A598",
    event: "#FE8019",
    broken: "#FB4934",
    held: ["#83A598", "#458588", "#8EC07C", "#D3869B"],
    ember: ["#FE8019", "#FB4934", "#D79921", "#FABD2F"],
  },
  {
    id: "solarized-light",
    name: "Solarized Light",
    scheme: "light",
    app: "#FDF6E3",
    sidebar: "#F5EED9",
    panel: "#FFFBF0",
    raised: "#EEE8D5",
    line: "#E4DDC8",
    lineInput: "#D3CBB5",
    text: "#073642",
    text2: "#3B5359",
    muted: "#586E75",
    faint: "#93A1A1",
    accent: "#268BD2",
    event: "#CB4B16",
    broken: "#DC322F",
    held: ["#268BD2", "#6C71C4", "#2AA198", "#859900"],
    ember: ["#CB4B16", "#DC322F", "#D33682", "#B58900"],
  },
];

/** Every theme, Sanctum's own first. */
export const THEMES: Theme[] = [SANCTUM_DARK, ...BASES.map(derive)];

export const themeById = (id: string | null | undefined): Theme | undefined => THEMES.find((t) => t.id === id);
