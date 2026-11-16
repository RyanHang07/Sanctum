# Sanctum second-colour exploration: shared brief for every design agent

Sanctum is a Windows-first desktop focus app and distraction blocker. Its mark is a torii gate with a keyhole. Its screens are Today (home), Week, Stats, Trackers, Notes, Journal and Setup. The voice is serious and declarative.

## What the user decided
- KEEP: the second colour on the active sidebar item (its icon in the second colour), and on Stats, a dashed target line in the second colour.
- DROP: the curved "beam" (the bent line taken from the torii's top beam). Don't use any curved or bent line decoration.
- DROP: italic serif payoffs and single accented words or phrases in headlines. A headline is one plain sentence in one weight and one colour.
- Labels are sentence case, never all caps.
- The second colour is DECORATION. The accent ("sealed") stays the colour of what you act on and what is sealed: Enter focus, + New, ticked boxes, kept bars, the "In progress" state.
- Avoid AI-design tropes: gradient washes as filler, left-border accent cards, emoji, glassmorphism, everything centred.

## The five directions (every screen uses the same five, so they mix and match)
Each file N uses direction N, its font, and its own way of placing the second colour. Keep each one restrained: a few deliberate touches, with ONE bold move per screen.
1. **Stamp** · font **Geist** (the current one). The second colour appears as small square "seal stamps": rounded-square badges with a 2px border in the second colour, a tinted fill, and a short number or word inside (today's minutes, a streak count, a kept day). Stamps sit flat (no rotation).
2. **Ruler** · font **Inter Tight**. The second colour draws thin tick marks, like a ruler or a dial's minute marks: a tick scale that measures the day or the week, with the major ticks in the second colour and minor ticks in the line colour. Progress reads against the ticks.
3. **Glow** · font **Manrope**. One soft radial light of the second colour, low opacity, placed once per screen behind the most important element (as if light falls on it), plus small solid second-colour dots as markers. The glow sits behind the content and never makes a gradient wash across the page.
4. **Ring** · font **Plus Jakarta Sans**. Circular progress rings and arcs: a ring's track in the line colour, its progress arc in the accent, and a second-colour cap, tick or goal marker on the ring. Small rings repeat in lists as compact meters.
5. **Field** · font **Instrument Sans**. One solid block of the second colour's tint (its "tint" value, not the bright colour) holds the most important group on the screen, like a coloured field or index card, with its text in the second-colour text value. Everything else stays neutral.

Numbers (timers, counts, times) stay in **Geist Mono** in every direction. Load fonts with one Google Fonts css2 `<link>` in `<helmet>` (escape `&` as `&amp;`).

## Themes: a "theme" enum tweak in every file (default "Aura")
Options: "Aura", "Night Owl", "Cobalt2 Light", "Sanctum Dark". Values (`sec*` = the second colour; secText is the second colour when used as text):
- Aura: app #15141B, sidebar #101015, panel #1E1D24, raised #28272D, line #3C3B41, text #EDECEE, text2 #C6C5C8, muted #9B9A9E, sealed #FF6767, sealedOn #15141B, sealedText #FF6767, sealedTint #3D2228, sec #FFCA85, secText #FFCA85, secTint #382F2B, secLine #7E664B
- Night Owl: app #011627, sidebar #01111E, panel #0B1F30, raised #152938, line #273A4A, text #D6DEEB, text2 #B0BAC8, muted #8592A1, sealed #F78C6C, sealedOn #011627, sealedText #F78C6C, sealedTint #2B2A33, sec #ECC48D, secText #ECC48D, secTint #243036, secLine #6B6455
- Cobalt2 Light: app #FFFFFF, sidebar #F2F2F2, panel #FFFFFF, raised #F5F5F5, line #D6DBDE, text #193549, text2 #4C6171, muted #66747D, sealed #237D89, sealedOn #FFFFFF, sealedText #007583, sealedTint #E9F2F3, sec #D68000, secText #8F5600, secTint #FBF4E8, secLine #F1D3A6
- Sanctum Dark: app #0B0D12, sidebar #0E1016, panel #12151C, raised #171B24, line #1F2430, text #E6E9EF, text2 #B8BFCC, muted #8A93A6, sealed #2F5BFF, sealedOn #FFFFFF, sealedText #7A95FF, sealedTint #172040, sec #FF8A6B, secText #FF8A6B, secTint #2A1712, secLine #5A2E24

## Files and format
- Work folder: `C:\Users\ryanh\AppData\Local\Temp\claude\11d61149b955f8e0\d83dd682-78ea-4307-a787-8938d72e84c3\scratchpad\gate-canvas\project\`.
- WORKING REFERENCE: `project/Main.dc.html` in that folder. Read it first, and copy its document skeleton, `<helmet>`, sidebar markup, `NAV` list and THEMES/renderVals pattern exactly. It already renders correctly. (Its curved beam SVG is the thing to remove.) `project/Stats.dc.html` shows loops, `<sc-if>`, and the dashed target line.
- Each artboard is ONE self-contained `.dc.html` file: `<script src="./support.js"></script>` in `<head>` exactly; all UI inside `<x-dc>`; a `<script type="text/x-dc" data-dc-script data-props='…'>` block with `class Component extends DCLogic { renderVals() { … } }` (classic JS, no imports). `{{hole}}` is a dotted lookup only, never an expression: compute everything (including per-item style strings) in `renderVals()`. Loops: `<sc-for list="{{items}}" as="item" hint-placeholder-count="N">`. Branches: `<sc-if value="{{flag}}" hint-placeholder-val="{{ false }}">`. Close every element; quote every attribute. No `innerHTML`, no network except the fonts link. Use real `<button>`, `<a href>`, `<input>` + `<label>`; `aria-label` on icon-only buttons; decorative SVG `aria-hidden="true"`.
- data-props: `{"theme":{"editor":"enum","options":["Aura","Night Owl","Cobalt2 Light","Sanctum Dark"],"default":"Aura"},"$preview":{"width":1280,"height":800}}`.
- The root is fluid: `width: 100%; min-height: 800px`, sidebar `flex: 0 0 220px`, main `flex: 999 1 560px; min-width: 0`, all inside a wrapping flex row. Design for 1280×800.
- Sidebar links: Today → `Today-N.dc.html`, Week → `Week-N.dc.html`, Stats → `Stats-N.dc.html`, Trackers → `Trackers-N.dc.html` (N = the file's own direction number); others `#`. The active item: raised background, its icon in `sec`.
- Text must reach 4.5:1 contrast on its background (use `muted` for labels, not anything fainter).
- Real content, no lorem ipsum. Use the sample data in your task.
- DO NOT publish anything and DO NOT edit `canvas.json`, `Main.dc.html`, `Week.dc.html` or `Stats.dc.html`. Only write your own five files. Do not render, screenshot or open them.
- When done, reply with: the five file names, and for each a one-line description of where the second colour appears and what the one bold move is.
