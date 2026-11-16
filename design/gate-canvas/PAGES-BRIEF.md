# Every other page in the new colours: brief for the page-mock agents

Read first:
- `C:\Users\ryanh\Documents\GitHub\Sanctum\docs\decisions\2026-11-15-second-colour-and-headlines.md`: the decisions. Follow them exactly.
- `BRIEF.md` in this folder, for the theme values and file-format rules. Ignore its "five directions" section.
- `PROTO-SPEC.md` in this folder, for the format notes (events, holes, helmet).
- The approved, working style: `project/Main.dc.html` (the prototype shell, with the sidebar and the aurora background) and `project/ProtoToday.dc.html` (the Today screen). Match their look exactly:
  - Headings in Schibsted Grotesk 700, interface text in Geist, numbers in Geist Mono.
  - The accent is for what you act on and what's sealed. The second colour is decoration: goal ticks, kept marks, the active sidebar icon, small markers.
  - Sentence case, and one plain sentence per headline.
  - The soft aurora background behind the content. Copy the shell's `.aurora-a/b/c` CSS and markup and the `auroraA/B/C/Veil` styles from its renderVals, with the theme colours from THEMES.

The user's feedback so far:
- They like the second colour on the active sidebar icon and as dashed target lines.
- They dislike the bent "beam" line.
- They want keys and legends shown only on hover.
- They want the screen background's gentle gradient kept, as a soft aurora.
- They want motion to feel fluid and distinctive.

## What to make
STATIC mockups (not working prototypes). Each page is its own artboard file in `project/`, named after the page, such as `Notes.dc.html`. Each has the "theme" enum tweak (Aura, Night Owl, Cobalt2 Light, Sanctum Dark; default Aura) and THEMES copied from Main.dc.html. Every page shows real content, at its real size:
- A page inside the main window: the sidebar (copy it from Main.dc.html, with the right item active) plus content, 1280×800.
- A separate window, dialog, overlay or extension surface: drawn at its real size, which you find in the code (`src-tauri/tauri.conf.json`, `src/windows/*`, and `extension/` for the extension).

FIDELITY: before drawing a page, read its real React component (read-only) in `C:\Users\ryanh\Documents\GitHub\Sanctum\src\` and its design reference in `design/screens/` if there is one. Use the same labels, controls, order and states; change only colour, type and decoration, per the decisions. If the design reference and the code disagree, follow the code (it is the current app).

For each page, decide where the second colour belongs. Keep it small and decorative, and use ONE notable touch per page. The accent stays on the primary action. Where a moment is emotional (held page, broken seal, intercept), say in your report what motion you'd give it. Describe the motion only: no animation libraries.

Rules: write only your own files. Don't touch canvas.json, Main.dc.html or the Proto*.dc.html files. Don't publish, render or screenshot. When you're done, check each file's script parses (extract the `data-dc-script` JS, prepend `class DCLogic{}`, and run `node --check`).

Report:
- Each file with its width×height.
- One line per page on where the second colour went and the one notable touch.
- One line per page on the motion you'd give it.
- Any place where the real app has a design gap: something inconsistent, missing or unclear that you noticed while reading the code.
