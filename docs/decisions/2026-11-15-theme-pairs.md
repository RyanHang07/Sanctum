# Second colour review: every theme

Date: 2026-11-15. Source: the resolved runtime palettes (Vite SSR load of src/theme/themes.ts, 76 themes). Read-only; no repo edits.

**Result: 44 pass, 11 watch, 21 flag.**

## Method
- Colour space: OKLCH/OKLab. **Hue** is the OKLCH hue distance between accent (`sealed`) and second colour (`event`). **ΔE** is the Euclidean OKLab distance (0.10 is about the smallest gap that reads as a different colour in small marks).
- **Graphic contrast**: the event against `app` and `panel`; it must reach 3:1. Every theme already passes, because derive() and the OpenCode import both lift `event` to 3:1.
- **Text version (secText)**: `readable(event, [app, panel, tint], 4.5, away)` in 0.04 steps, as palette/themes.ts does for `sealed-text` (tint = event mixed into app at 13% dark / 10% light). The table gives its hex and its contrast on panel.
- **Distinct from broken**: flag when hue < 20° and ΔE < 0.12, or ΔE < 0.085; watch when hue < 30° and ΔE < 0.15, or ΔE < 0.105.
- **Distinct from open**: flag when ΔE < 0.07 and hue < 40°; watch when ΔE < 0.10 and hue < 40°, or when the event is itself a strong green (hue 110–165°, chroma > 0.1).
- **Distinct from accent**: flag when ΔE < 0.08, or when hue < 30° with ΔE < 0.15 (same family); watch when ΔE < 0.10.
- **Too loud**: neon (chroma ≥ 0.185 and lightness ≥ 0.85), or over 14:1 on app and more than twice the accent's contrast, so the decoration outshines what you act on.
- **Swapped**: the accent is near-neutral (chroma < 0.03) while the event is chromatic.
- **Mislabelled**: a "Light" name on a dark scheme.
- Two or more watches make a flag.

## Every theme

| Theme | Scheme | Accent | Second (event) | Hue | ΔE accent | Event app / panel | secText (on panel) | ΔE / hue to broken | ΔE / hue to open | Verdict | Issues |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Sanctum Dark | dark | `#2F5BFF` | `#FF8A6B` | 130° | 0.41 | 8.42 / 7.91 | `#FF8A6B` 7.91 | 0.14 / 13° | 0.24 / 131° | **watch** | near broken (ΔE 0.14, 13°) |
| Sanctum Light | light | `#2F5BFF` | `#E0502E` | 128° | 0.40 | 3.69 / 3.92 | `#B34025` 5.71 | 0.06 / 10° | 0.47 / 128° | **flag** | reads as an error (ΔE 0.06 from broken) |
| OC-2 | dark | `#FAB283` | `#FCD53A` | 40° | 0.12 | 11.55 / 10.33 | `#FCD53A` 10.33 | 0.29 / 63° | 0.24 / 48° | **pass** | — |
| OC-2 Light | light | `#8D8E5A` | `#A38D0F` | 12° | 0.06 | 3.08 / 3.18 | `#75660B` 5.54 | 0.20 / 66° | 0.15 / 45° | **flag** | too close to the accent (ΔE 0.06) |
| AMOLED | dark | `#FF4081` | `#FFEA00` | 97° | 0.41 | 17.02 / 16.05 | `#FFEA00` 16.05 | 0.41 / 82° | 0.19 / 50° | **flag** | too loud (17.02:1, outshines the accent) |
| AMOLED Light | light | `#FF0080` | `#B87B00` | 72° | 0.25 | 3.14 / 3.37 | `#8C5D00` 5.37 | 0.20 / 54° | 0.19 / 78° | **pass** | — |
| Aura | dark | `#FF6767` | `#FFCA85` | 50° | 0.22 | 12.23 / 11.17 | `#FFCA85` 11.17 | 0.22 / 50° | 0.19 / 94° | **pass** | accent equals broken |
| Aura Light | light | `#C84949` | `#AE823B` | 53° | 0.14 | 3.10 / 3.30 | `#7D5E2A` 5.70 | 0.14 / 53° | 0.15 / 79° | **pass** | — |
| Ayu | dark | `#F2856F` | `#E4A75C` | 38° | 0.09 | 8.80 / 8.05 | `#E4A75C` 8.05 | 0.10 / 39° | 0.17 / 68° | **flag** | near the accent (ΔE 0.09); near broken (ΔE 0.10, 39°); accent equals broken |
| Ayu Light | light | `#8E6C68` | `#BB7F34` | 43° | 0.12 | 3.25 / 3.33 | `#8E6128` 5.31 | 0.12 / 49° | 0.15 / 82° | **pass** | — |
| Carbonfox | dark | `#FF8389` | `#F1C21B` | 72° | 0.20 | 6.86 / 6.06 | `#F1C21B` 6.06 | 0.20 / 72° | 0.20 / 59° | **pass** | accent equals broken |
| Carbonfox Light | light | `#94141B` | `#57460A` | 66° | 0.15 | 3.15 / 5.72 | `#312706` 9.19 | 0.15 / 66° | 0.09 / 57° | **pass** | accent equals broken |
| Catppuccin | dark | `#F38BA8` | `#F4B8E4` | 27° | 0.11 | 10.02 / 8.97 | `#F4B8E4` 8.97 | 0.11 / 27° | 0.20 / 157° | **flag** | same hue family as the accent (27°); near broken (ΔE 0.11, 27°); accent equals broken |
| Catppuccin Light | light | `#D20F39` | `#B27217` | 49° | 0.17 | 3.12 / 3.56 | `#805211` 6.04 | 0.17 / 49° | 0.17 / 72° | **pass** | accent equals broken |
| Catppuccin Frappe | dark | `#F4B8E4` | `#E5C890` | 107° | 0.14 | 7.62 / 6.76 | `#E5C890` 6.76 | 0.17 / 64° | 0.09 / 50° | **pass** | — |
| Catppuccin Frappe Light | dark | `#F4B8E4` | `#E5C890` | 107° | 0.14 | 7.62 / 6.76 | `#E5C890` 6.76 | 0.17 / 64° | 0.09 / 50° | **flag** | mislabelled: a "Light" name on a dark palette, identical to Catppuccin Frappe |
| Catppuccin Macchiato | dark | `#F5BDE6` | `#EED49F` | 109° | 0.13 | 10.20 / 9.02 | `#EED49F` 9.02 | 0.19 / 74° | 0.10 / 53° | **pass** | — |
| Catppuccin Macchiato Light | dark | `#F5BDE6` | `#EED49F` | 109° | 0.13 | 10.20 / 9.02 | `#EED49F` 9.02 | 0.19 / 74° | 0.10 / 53° | **flag** | mislabelled: a "Light" name on a dark palette, identical to Catppuccin Macchiato |
| Cobalt2 | dark | `#2AFFDF` | `#FFC600` | 91° | 0.24 | 8.09 / 7.20 | `#FFC600` 7.20 | 0.37 / 88° | 0.17 / 51° | **pass** | — |
| Cobalt2 Light | light | `#237D89` | `#D68000` | 143° | 0.26 | 3.02 / 3.02 | `#9A5C00` 5.38 | 0.20 / 55° | 0.20 / 79° | **pass** | — |
| Cursor | dark | `#88C0D0` | `#F1B467` | 146° | 0.18 | 9.69 / 8.79 | `#F1B467` 8.79 | 0.25 / 63° | 0.24 / 82° | **pass** | — |
| Cursor Light | light | `#6B959F` | `#DB704B` | 175° | 0.19 | 3.18 / 3.24 | `#A65539` 5.23 | 0.14 / 27° | 0.25 / 125° | **watch** | near broken (ΔE 0.14, 27°) |
| Dracula | dark | `#FF79C6` | `#FFB86C` | 80° | 0.22 | 9.72 / 8.70 | `#FFB86C` 8.70 | 0.21 / 42° | 0.24 / 81° | **pass** | — |
| Dracula Light | light | `#D36694` | `#BC7A3B` | 67° | 0.15 | 3.29 / 3.41 | `#8F5D2D` 5.42 | 0.13 / 51° | 0.19 / 93° | **pass** | — |
| Everforest | dark | `#D699B6` | `#E69875` | 56° | 0.09 | 5.41 / 4.80 | `#E8A080` 5.14 | 0.07 / 25° | 0.13 / 81° | **flag** | reads as an error (ΔE 0.07 from broken); near the accent (ΔE 0.09) |
| Everforest Light | light | `#B25495` | `#D86E21` | 70° | 0.19 | 3.15 / 3.29 | `#A45419` 5.26 | 0.09 / 26° | 0.17 / 67° | **watch** | near broken (ΔE 0.09, 26°) |
| Flexoki | dark | `#8B7EC8` | `#DA702C` | 118° | 0.23 | 5.77 / 5.29 | `#DA702C` 5.29 | 0.09 / 21° | 0.16 / 70° | **watch** | near broken (ΔE 0.09, 21°) |
| Flexoki Light | light | `#BC5215` | `#BC5215` | 0° | 0.00 | 4.69 / 4.77 | `#AD4B13` 5.48 | 0.08 / 17° | 0.18 / 78° | **flag** | identical to the accent; reads as an error (ΔE 0.08 from broken) |
| GitHub | dark | `#39C5CF` | `#E3B341` | 117° | 0.22 | 9.72 / 8.89 | `#E3B341` 8.89 | 0.22 / 58° | 0.19 / 60° | **pass** | — |
| GitHub Light | light | `#1B7C83` | `#9A6700` | 127° | 0.18 | 4.87 / 4.87 | `#946300` 5.19 | 0.16 / 50° | 0.16 / 73° | **pass** | — |
| Gruvbox | dark | `#FB5844` | `#FABD2F` | 53° | 0.23 | 8.69 / 7.67 | `#FABD2F` 7.67 | 0.25 / 53° | 0.10 / 28° | **pass** | accent equals broken |
| Gruvbox Light | light | `#9D0006` | `#B57614` | 42° | 0.22 | 3.33 / 3.57 | `#8A5A0F` 5.60 | 0.22 / 42° | 0.10 / 36° | **pass** | accent equals broken |
| Kanagawa | dark | `#D27E99` | `#D7A657` | 78° | 0.15 | 7.38 / 6.59 | `#D7A657` 6.59 | 0.24 / 50° | 0.10 / 51° | **pass** | — |
| Kanagawa Light | light | `#8E6A76` | `#A37E42` | 81° | 0.11 | 3.11 / 3.44 | `#755B30` 5.87 | 0.18 / 50° | 0.08 / 50° | **pass** | — |
| Lucent Orng | dark | `#FFF7F1` | `#EC5B2B` | 22° | 0.37 | 4.85 / 4.36 | `#EE683C` 4.77 | 0.08 / 21° | 0.29 / 143° | **flag** | swapped roles: near-white accent, orange event; reads as an error (ΔE 0.08 from broken) |
| Lucent Orng Light | light | `#C94D24` | `#EC5B2B` | 0° | 0.08 | 3.21 / 3.35 | `#B34521` 5.38 | 0.09 / 14° | 0.38 / 140° | **flag** | too close to the accent (ΔE 0.08); reads as an error (ΔE 0.09 from broken) |
| Material | dark | `#89DDFF` | `#FFCB6B` | 145° | 0.21 | 8.78 / 7.78 | `#FFCB6B` 7.78 | 0.23 / 62° | 0.10 / 46° | **pass** | — |
| Material Light | light | `#3F7A7E` | `#B88100` | 123° | 0.20 | 3.26 / 3.34 | `#8C6200` 5.35 | 0.17 / 52° | 0.10 / 49° | **pass** | — |
| Matrix | dark | `#C770FF` | `#E6FF57` | 167° | 0.47 | 17.41 / 16.07 | `#E6FF57` 16.07 | 0.41 / 92° | 0.13 / 33° | **flag** | too loud (17.41:1, outshines the accent); leans to open/success (ΔE 0.13) |
| Matrix Light | light | `#8E60AB` | `#818F31` | 166° | 0.24 | 3.16 / 3.38 | `#626D25` 5.35 | 0.25 / 92° | 0.09 / 30° | **watch** | leans to open/success (ΔE 0.09) |
| Mercury | dark | `#8DA4F5` | `#FC9B6F` | 134° | 0.24 | 8.52 / 7.73 | `#FC9B6F` 7.73 | 0.10 / 45° | 0.19 / 113° | **watch** | near broken (ΔE 0.10, 45°) |
| Mercury Light | light | `#697295` | `#A44200` | 132° | 0.19 | 6.25 / 6.25 | `#A44200` 6.25 | 0.14 / 45° | 0.21 / 113° | **pass** | — |
| Monokai | dark | `#FA4989` | `#FD971F` | 59° | 0.22 | 6.81 / 6.01 | `#FD971F` 6.01 | 0.23 / 55° | 0.22 / 65° | **pass** | — |
| Monokai Light | light | `#C84272` | `#B78037` | 69° | 0.18 | 3.22 / 3.32 | `#8B612A` 5.33 | 0.14 / 46° | 0.16 / 72° | **pass** | — |
| Night Owl | dark | `#F78C6C` | `#ECC48D` | 38° | 0.13 | 11.22 / 10.25 | `#ECC48D` 10.25 | 0.24 / 50° | 0.11 / 47° | **pass** | — |
| Night Owl Light | light | `#AA0982` | `#C96765` | 40° | 0.19 | 3.28 / 3.52 | `#994E4D` 5.57 | 0.08 / 4° | 0.22 / 164° | **flag** | reads as an error (ΔE 0.08 from broken) |
| Nord | dark | `#DA878F` | `#D08770` | 25° | 0.05 | 4.39 / 3.89 | `#D99F8D` 4.90 | 0.07 / 24° | 0.15 / 93° | **flag** | too close to the accent (ΔE 0.05); reads as an error (ΔE 0.07 from broken) |
| Nord Light | light | `#B05962` | `#B77763` | 23° | 0.08 | 3.12 / 3.38 | `#8B5A4B` 5.39 | 0.06 / 23° | 0.12 / 156° | **flag** | too close to the accent (ΔE 0.08); reads as an error (ΔE 0.06 from broken) |
| One Dark | dark | `#56B6C2` | `#E5C07B` | 124° | 0.20 | 8.10 / 7.21 | `#E5C07B` 7.21 | 0.21 / 65° | 0.11 / 51° | **pass** | — |
| One Dark Light | light | `#0179AD` | `#C18401` | 161° | 0.28 | 3.06 / 3.14 | `#8B5F01` 5.53 | 0.14 / 48° | 0.16 / 67° | **pass** | — |
| One Dark Pro | dark | `#E06C75` | `#E5C07B` | 65° | 0.21 | 9.23 / 8.22 | `#E5C07B` 8.22 | 0.21 / 65° | 0.11 / 51° | **pass** | accent equals broken |
| One Dark Pro Light | light | `#C74D5A` | `#B08156` | 46° | 0.13 | 3.17 / 3.32 | `#866241` 5.29 | 0.10 / 46° | 0.14 / 90° | **watch** | near broken (ΔE 0.10, 46°) |
| OpenCode | dark | `#9D7CD8` | `#F5A742` | 130° | 0.29 | 9.89 / 9.20 | `#F5A742` 9.20 | 0.17 / 52° | 0.18 / 79° | **pass** | — |
| OpenCode Light | light | `#C58124` | `#C58124` | 0° | 0.00 | 3.21 / 3.21 | `#96621B` 5.17 | 0.16 / 45° | 0.18 / 81° | **flag** | identical to the accent |
| Orng | dark | `#FFF7F1` | `#EC5B2B` | 22° | 0.37 | 5.75 / 5.35 | `#EC5B2B` 5.35 | 0.08 / 21° | 0.29 / 143° | **flag** | swapped roles: near-white accent, orange event; reads as an error (ΔE 0.08 from broken) |
| Orng Light | light | `#C94D24` | `#EC5B2B` | 0° | 0.08 | 3.44 / 3.44 | `#BD4922` 5.07 | 0.09 / 14° | 0.38 / 140° | **flag** | too close to the accent (ΔE 0.08); reads as an error (ΔE 0.09 from broken) |
| Osaka Jade | dark | `#549E6A` | `#E5C736` | 55° | 0.23 | 10.43 / 9.42 | `#E5C736` 9.42 | 0.26 / 68° | 0.23 / 55° | **pass** | — |
| Osaka Jade Light | light | `#3D7A52` | `#9F8D1C` | 54° | 0.15 | 3.02 / 3.20 | `#726614` 5.56 | 0.20 / 70° | 0.15 / 54° | **pass** | — |
| Palenight | dark | `#89DDFF` | `#FFCB6B` | 145° | 0.21 | 9.10 / 8.08 | `#FFCB6B` 8.08 | 0.23 / 62° | 0.10 / 46° | **pass** | — |
| Palenight Light | light | `#167D8A` | `#B88100` | 130° | 0.23 | 3.26 / 3.34 | `#8C6200` 5.35 | 0.17 / 52° | 0.10 / 49° | **pass** | — |
| Rose Pine | dark | `#EBBCBA` | `#F6C177` | 53° | 0.09 | 10.77 / 9.76 | `#F6C177` 9.76 | 0.21 / 70° | 0.37 / 153° | **watch** | near the accent (ΔE 0.09) |
| Rose Pine Light | light | `#866A6A` | `#BB7E2A` | 52° | 0.14 | 3.14 / 3.29 | `#8E6020` 5.25 | 0.14 / 68° | 0.25 / 158° | **pass** | — |
| Shades of Purple | dark | `#FF7AC6` | `#FFD580` | 97° | 0.26 | 13.08 / 11.90 | `#FFD580` 11.90 | 0.26 / 97° | 0.16 / 78° | **pass** | accent equals broken |
| Shades of Purple Light | light | `#99658B` | `#9E812E` | 112° | 0.16 | 3.25 / 3.50 | `#786223` 5.53 | 0.24 / 109° | 0.13 / 73° | **pass** | — |
| Solarized | dark | `#D33682` | `#B58900` | 90° | 0.25 | 4.68 / 4.21 | `#BE971F` 4.91 | 0.18 / 59° | 0.08 / 33° | **watch** | leans to open/success (ΔE 0.08) |
| Solarized Light | light | `#D33682` | `#AE8400` | 90° | 0.25 | 3.19 / 3.33 | `#846400` 5.34 | 0.19 / 59° | 0.08 / 32° | **watch** | leans to open/success (ΔE 0.08) |
| Synthwave '84 | dark | `#B084EB` | `#FEDE5D` | 153° | 0.36 | 11.51 / 10.22 | `#FEDE5D` 10.22 | 0.33 / 73° | 0.16 / 67° | **pass** | — |
| Synthwave '84 Light | light | `#9C27B0` | `#CC7A00` | 104° | 0.32 | 3.17 / 3.25 | `#9B5D00` 5.21 | 0.13 / 36° | 0.19 / 79° | **pass** | — |
| Tokyonight | dark | `#FF9E64` | `#E0AF68` | 25° | 0.06 | 8.55 / 7.69 | `#E0AF68` 7.69 | 0.16 / 65° | 0.12 / 55° | **flag** | too close to the accent (ΔE 0.06) |
| Tokyonight Light | light | `#B15C00` | `#8C6C3E` | 19° | 0.07 | 3.75 / 4.34 | `#705632` 6.13 | 0.16 / 65° | 0.08 / 55° | **flag** | too close to the accent (ΔE 0.07) |
| Vercel | dark | `#8E4EC6` | `#FFB224` | 130° | 0.41 | 11.65 / 10.98 | `#FFB224` 10.98 | 0.25 / 53° | 0.25 / 72° | **pass** | — |
| Vercel Light | light | `#8E4EC6` | `#D67D00` | 117° | 0.31 | 3.09 / 3.09 | `#A35F00` 5.01 | 0.16 / 42° | 0.22 / 81° | **pass** | — |
| Vesper | dark | `#FF8080` | `#FFC799` | 39° | 0.16 | 12.58 / 11.50 | `#FFC799` 11.50 | 0.16 / 39° | 0.17 / 114° | **pass** | accent equals broken |
| Vesper Light | light | `#B30000` | `#A37F62` | 31° | 0.21 | 3.19 / 3.43 | `#7C614A` 5.39 | 0.09 / 39° | 0.11 / 115° | **watch** | near broken (ΔE 0.09, 39°) |
| Zenburn | dark | `#93E0E3` | `#F0DFAF` | 108° | 0.12 | 7.96 / 7.03 | `#F0DFAF` 7.03 | 0.20 / 72° | 0.24 / 54° | **pass** | — |
| Zenburn Light | light | `#547E7E` | `#8F8F5F` | 88° | 0.11 | 3.32 / 3.34 | `#6D6D48` 5.32 | 0.14 / 89° | 0.06 / 36° | **flag** | reads as success/open (ΔE 0.06) |

`accent equals broken` (in Issues) is not a second-colour failure, but in those 11 themes the accent and the broken state are the same colour (Aura, Ayu, Carbonfox and Carbonfox Light, Catppuccin and Catppuccin Light, Gruvbox and Gruvbox Light, One Dark Pro, Shades of Purple, Vesper). That makes the second colour carry more weight there. It is worth a separate review of `broken`.

## Recommendations (flagged themes)

Each entry gives the source colour, then the graphic hex the app would use (lifted or deepened to 3:1 the same way derive() lifts `event`), its text version (4.5:1), and the new numbers.

| Theme | Current | Recommended (graphic) | Source colour | Text version | App / panel | Hue / ΔE to accent | ΔE to broken | ΔE to open | Why |
|---|---|---|---|---|---|---|---|---|---|
| Sanctum Light | `#E0502E` | **`#C2822E`** (from `#F2A33A`) | Sanctum ember-4 amber | `#8C5E21` 5.62:1 | 3.03 / 3.22 | 163° / 0.38 | 0.16 | 0.48 | #E0502E is 10° and ΔE 0.06 from broken #D93036, so goal ticks read as errors. Amber is the blue accent's complement and keeps the warm note of Sanctum Dark's coral. |
| OC-2 Light | `#A38D0F` | **`#A753AE`** | OC-2 Light purple (its locked colour) | `#934999` 5.55:1 | 4.36 / 4.52 | 145° / 0.23 | 0.23 | 0.37 | Accent #8D8E5A and event #A38D0F are both olive (12°, ΔE 0.06). Purple is the olive's complement and the theme's only other chromatic colour. |
| AMOLED | `#FFEA00` | **`#448AFF`** | Material Blue A200 (the Material accent family AMOLED's pink, red, yellow and cyan come from; not in the resolved palette) | `#448AFF` 5.96:1 | 6.33 / 5.96 | 106° / 0.33 | 0.38 | 0.41 | #FFEA00 is 17:1 on black, about three times the accent's pull, so the decoration outshines what you act on. Blue A200 sits near the pink accent's brightness (6.3:1) and 106° away from it. |
| Ayu | `#E4A75C` | **`#59C2FF`** | Ayu entity blue | `#59C2FF` 8.54:1 | 9.33 / 8.54 | 155° / 0.27 | 0.27 | 0.23 | #E4A75C is close to the coral accent (ΔE 0.09) and to broken #F58572 (ΔE 0.10). Ayu's entity blue is 155° from both. |
| Catppuccin | `#F4B8E4` | **`#B4BEFE`** | Catppuccin Mocha Lavender | `#B4BEFE` 8.21:1 | 9.17 / 8.21 | 85° / 0.16 | 0.16 | 0.19 | Pink #F4B8E4 on a red-pink accent (27°) reads as one colour, and the accent equals broken. Lavender is 85° away and calm. |
| Catppuccin Frappe Light | `#E5C890` | **`#BB7718`** (from `#DF8E1D`) | Catppuccin Latte Yellow, on a rebuilt Latte theme (mauve accent #8839EF) | `#8E5A12` 5.46:1 | 3.22 / 3.43 | 131° / 0.36 | 0.18 | 0.19 | The palette is an exact copy of the dark flavour, so a rename would duplicate it. Remove it and ship one real light theme from Latte: base #EFF1F5, the mauve accent and the yellow second colour. This is the catppuccin-latte entry already in themes.ts BASES, which is currently filtered out. |
| Catppuccin Macchiato Light | `#EED49F` | **`#BB7718`** (from `#DF8E1D`) | Catppuccin Latte Yellow, on a rebuilt Latte theme (mauve accent #8839EF) | `#8E5A12` 5.46:1 | 3.22 / 3.43 | 131° / 0.36 | 0.18 | 0.19 | The palette is an exact copy of the dark flavour, so a rename would duplicate it. Remove it and ship one real light theme from Latte: base #EFF1F5, the mauve accent and the yellow second colour. This is the catppuccin-latte entry already in themes.ts BASES, which is currently filtered out. |
| Everforest | `#E69875` | **`#7FBBB3`** | Everforest blue | `#7FBBB3` 5.09:1 | 5.74 / 5.09 | 164° / 0.14 | 0.19 | 0.08 | Orange #E69875 is ΔE 0.07 from broken #E67E80. Everforest's yellow would sit on the green open colour (ΔE 0.07), so blue. |
| Flexoki Light | `#BC5215` | **`#24837B`** | Flexoki cyan-600 | `#20736C` 5.57:1 | 4.43 / 4.51 | 142° / 0.23 | 0.25 | 0.12 | Accent and event are the same colour (#BC5215, orange-600). Cyan-600 matches the Flexoki dark pick and is 142° from the orange accent. |
| Lucent Orng | `#EC5B2B` | **`#56B6C2`** + accent → `#EC5B2B` | Cyan #56B6C2 (the theme's locked colour) | `#56B6C2` 6.33:1 | 7.05 / 6.33 | 169° / 0.29 | 0.24 | 0.09 | The accent #FFF7F1 is near-white (chroma 0.01), so the orange event carries the theme. Make orange the accent; the second colour becomes the theme's cyan, its complement. |
| Lucent Orng Light | `#EC5B2B` | **`#318795`** | Cyan #318795 (the theme's locked colour) | `#29717D` 5.44:1 | 3.89 / 4.06 | 172° / 0.25 | 0.27 | 0.16 | Accent #C94D24 and event #EC5B2B are the same orange (0°), and both sit 14° from broken. Cyan is 172° away. |
| Matrix | `#E6FF57` | **`#30B3FF`** | Matrix blue (its locked colour) | `#30B3FF` 7.70:1 | 8.35 / 7.70 | 70° / 0.22 | 0.36 | 0.30 | Lime #E6FF57 is 17:1, neon, and leans toward the green open colour in an all-green theme. Blue is 70° from the purple accent at a similar brightness. |
| Night Owl Light | `#C96765` | **`#4876D6`** | Night Owl Light blue | `#3C63B4` 5.44:1 | 3.81 / 4.09 | 79° / 0.25 | 0.31 | 0.16 | Salmon #C96765 is 4° from broken #DE3D3B: an error colour as decoration. Night Owl's blue is 79° from the magenta accent. Its teal would equal the open colour. |
| Nord | `#D08770` | **`#88C0D0`** | Nord nord8 (Frost) | `#88C0D0` 5.53:1 | 6.24 / 5.53 | 156° / 0.17 | 0.22 | 0.09 | nord12 #D08770 is ΔE 0.05 from the pink accent and 0.07 from broken. Frost is Nord's signature and suits aurora tips. |
| Nord Light | `#B77763` | **`#5E81AC`** | Nord nord10 (Frost) | `#4B678A` 5.47:1 | 3.50 / 3.78 | 121° / 0.17 | 0.17 | 0.07 | #B77763 is 23° from the accent and ΔE 0.06 from broken. nord10 is 121° from both. It sits near the grey-teal open colour in lightness (ΔE 0.07, 60° apart), which is acceptable for decoration. |
| OpenCode Light | `#C58124` | **`#9D7CD8`** | OpenCode purple (the dark theme's accent) | `#775EA4` 5.36:1 | 3.33 / 3.33 | 130° / 0.24 | 0.24 | 0.26 | Accent and event are the same amber (#C58124). Purple returns the pair OpenCode dark has, mirrored. |
| Orng | `#EC5B2B` | **`#56B6C2`** + accent → `#EC5B2B` | Cyan #56B6C2 (the theme's locked colour) | `#56B6C2` 7.78:1 | 8.36 / 7.78 | 169° / 0.29 | 0.24 | 0.09 | Same as Lucent Orng: a near-white accent with an orange event. Swap so orange is the accent and use the theme's cyan as the second colour. |
| Orng Light | `#EC5B2B` | **`#318795`** | Cyan #318795 (the theme's locked colour) | `#2B7783` 5.16:1 | 4.17 / 4.17 | 172° / 0.25 | 0.27 | 0.16 | Same as Lucent Orng Light: one orange used twice. Cyan is the complement. |
| Tokyonight | `#E0AF68` | **`#7AA2F7`** | Tokyo Night blue | `#7AA2F7` 6.11:1 | 6.79 / 6.11 | 146° / 0.27 | 0.23 | 0.26 | #E0AF68 is 25° and ΔE 0.06 from the orange accent. Tokyo Night's blue is 146° away. |
| Tokyonight Light | `#8C6C3E` | **`#2E7DE9`** | Tokyo Night Day blue | `#215AA8` 6.07:1 | 3.11 / 3.59 | 159° / 0.31 | 0.30 | 0.26 | #8C6C3E is 19° from the amber accent and low in chroma. Day blue is 159° away. |
| Zenburn Light | `#8F8F5F` | **`#B28C72`** (from `#DFAF8F`) | Zenburn orange (#DFAF8F), deepened | `#806552` 5.36:1 | 3.02 / 3.04 | 140° / 0.15 | 0.14 | 0.12 | Olive #8F8F5F is ΔE 0.06 from the green open colour #5F8F5F. Zenburn's orange, deepened to 3:1, clears accent, broken and open. |

### Watch themes
These pass on numbers but sit near a line. Change them only if they look wrong on the artboard.

| Theme | Current | Suggested | Source | Text | Note |
|---|---|---|---|---|---|
| Sanctum Dark | `#FF8A6B` | `#F2A33A` | Sanctum ember-4 amber | `#F2A33A` 8.76:1 | Optional; #FF8A6B is decided. Coral is 13° from broken #E5484D and saved by lightness alone (ΔE 0.14). Amber would match the Sanctum Light fix. |
| Cursor Light | `#DB704B` | keep | — | `#A65539` | near broken (ΔE 0.14, 27°). Keep: the hue gap or the theme's own identity carries it. |
| Everforest Light | `#D86E21` | `#3A94C5` | Everforest Light blue | `#2C7096` 5.25:1 | Orange #D86E21 is 26° from broken #F85552. Blue clears accent, broken and open by 100° or more. |
| Flexoki | `#DA702C` | `#3AA99F` | Flexoki cyan-400 | `#3AA99F` 6.15:1 | Orange #DA702C is 21° and ΔE 0.09 from red #D14D41. Cyan is 104° from the purple accent; yellow-400 would crowd the green open colour. |
| Matrix Light | `#818F31` | `#268FCC` | Matrix Light blue (its locked colour) | `#1D6D9B` 5.38:1 | Olive #818F31 is ΔE 0.09 from the green open colour, so kept marks read as success. Blue clears it by 93°. |
| Mercury | `#FC9B6F` | keep | — | `#FC9B6F` | near broken (ΔE 0.10, 45°). Keep: the hue gap or the theme's own identity carries it. |
| One Dark Pro Light | `#B08156` | keep | — | `#866241` | near broken (ΔE 0.10, 46°). Keep: the hue gap or the theme's own identity carries it. |
| Rose Pine | `#F6C177` | `#C4A7E7` | Rosé Pine Iris | `#C4A7E7` 7.64:1 | Optional. Gold #F6C177 and the rose accent are both pale (ΔE 0.09), so small marks blur. Iris is 76° away. |
| Solarized | `#B58900` | keep | — | `#BE971F` | leans to open/success (ΔE 0.08). Keep: the hue gap or the theme's own identity carries it. |
| Solarized Light | `#AE8400` | keep | — | `#846400` | leans to open/success (ΔE 0.08). Keep: the hue gap or the theme's own identity carries it. |
| Vesper Light | `#A37F62` | keep | — | `#7C614A` | near broken (ΔE 0.09, 39°). Keep: the hue gap or the theme's own identity carries it. |

Notes on the watch suggestions:
- **Everforest Light → `#3A94C5`**, **Flexoki → `#3AA99F`**: these pair with the flagged dark/light sibling, so a theme family keeps one second colour. Recommended for that reason.
- **Matrix Light → `#268FCC`**: it matches the Matrix fix. Recommended.
- **Sanctum Dark**: `#FF8A6B` is decided. If Sanctum Light moves to amber, consider amber for both so the pair matches.

## Orng and Lucent Orng (dark)
**Recommendation: swap the roles.** Make the orange `#EC5B2B` the accent and use the theme's cyan `#56B6C2` as the second colour.
- Why: the accent `#FFF7F1` has OKLCH chroma 0.01, which is text-white, not a colour. A near-white Enter focus fill reads as a neutral button, and the orange event becomes the most saturated thing on screen, so the decoration looks like the action. Orange is the theme's identity (the name is orng).
- Accent → `#EC5B2B`: 5.75:1 on Orng's app and 4.85:1 on Lucent Orng's app. Text on the fill is the dark app colour (derive's onColor picks it).
- Second → `#56B6C2`: 8.36:1 / 7.78:1 (Orng), 7.05:1 / 6.33:1 (Lucent Orng); text-safe as is; 147° from the new accent.
- Follow-up: the new orange accent is ΔE 0.08 from `broken #E06C75`. Give `broken` a redder value (for example `#E5484D`, Sanctum's), or a broken seal will look like a sealed one.
- The light variants (Orng Light, Lucent Orng Light) already have orange as the accent; they only need the second colour changed to `#318795`.

## Catppuccin Frappe Light and Catppuccin Macchiato Light
**Recommendation: remove both, and ship one real "Catppuccin Latte" in their place.**
- They are scheme "dark", and their palettes are byte-for-byte copies of Catppuccin Frappe and Catppuccin Macchiato, so a rename would just make duplicates.
- Catppuccin has one light flavour (Latte), so rebuilding two light themes from it gives two near-identical themes.
- themes.ts already has a `catppuccin-latte` BASES entry (base `#EFF1F5`, mantle `#E6E9EF`, text `#4C4F69`, Mauve `#8839EF` accent, broken Red `#D20F39`), but THEMES filters it out. Use it, with **Latte Yellow `#DF8E1D` → `#BB7718`** (3.22:1 app / 3.43:1 panel, text `#8E5A12` 5.46:1, 131° from Mauve) as the second colour instead of its current Peach `#FE640B`, which is 23° from Red (ΔE 0.13, a watch).
- The existing "Catppuccin Light" has an app colour of `#F5E0DC` (Rosewater) and accent equal to broken Red. With a real Latte theme added, consider retiring it or folding it into Latte.

## If a dedicated `second` slot is added
This review assumes the open question in the decision log resolves toward a `second` slot that defaults to `event`. The recommendations above set `second` and leave `event` alone (it still marks "you're in an event"), except in Orng and Lucent Orng, where the accent changes.
