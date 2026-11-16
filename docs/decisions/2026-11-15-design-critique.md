⚠️ DEGRADED: single-context (impeccable playbooks followed by hand inside one sub-agent; detector and launcher not run because they download a binary that is not approved; mocks reviewed from source because their runtime is not available; dev server at localhost:1420 was unreachable, so the comparison with the current app used `src/` read-only)

# Sanctum new mockups: impeccable critique and audit

Target: 21 `*.dc.html` files in `scratchpad/gate-canvas/project/` (canvas "Sanctum Gate Light Screens").
Brief: `docs/decisions/2026-11-15-second-colour-and-headlines.md`. Context: SPEC.md (overview, 4.0 to 4.0.2, section 8), design/README.md.
Mode: Operate (app surfaces). Held, HeldBroken and Intercept are judged as Experience-like moments inside an Operate app.
Contrast figures come from a WCAG calculation over the THEMES values (identical in all 21 files). Aurora and held-mesh backgrounds are estimated by compositing the blob colour, its opacity and the veil, so they are approximate. Stacked blobs would be darker than the estimate.

---

## Scores

### Design health (Nielsen, 0 to 4)

| # | Heuristic | Score | Key issue |
|---|-----------|-------|-----------|
| 1 | Visibility of system status | 3 | The live ruler, sealed pill and day states are strong. The days-strip key and Stats day details only appear on hover. |
| 2 | Match system / real world | 3 | Plain, serious copy. Some old odd lines remain: "Held. Nice.", "1 sessions", and the contradictory "Protection reopens it" / "Turn on Protection". |
| 3 | User control and freedom | 3 | Esc on the Log entry form and Held, Snooze on Check-in. The custom Profile and Length menus have no Esc and no arrow keys. |
| 4 | Consistency and standards | 2 | "Kept" is drawn in two colours. The second colour has about ten meanings. There are three Today headlines, two mood scales, three `lineInput` definitions, and two kinds of segmented-control semantics. |
| 5 | Error prevention | 2 | Leaving a seal is a weightless "Stop". The partner page makes "Approve, end it" the filled primary. Delete note uses the same X glyph as close. |
| 6 | Recognition rather than recall | 3 | Labels and shortcuts are visible. The second colour's meaning has to be learned page by page and is never explained. |
| 7 | Flexibility and efficiency | 3 | Ctrl 1 to 4, Ctrl Enter, Esc and the command bar entry are shown. There is no keyboard path to Stats day details. |
| 8 | Aesthetic and minimalist design | 2 | Today shows the same progress fact three times. Held is a form at the peak moment. |
| 9 | Error recovery | 2 | The Trackers validation error is drawn in the accent, which is blue or teal in two themes. HeldBroken's recovery copy contradicts itself. |
| 10 | Help and documentation | 2 | Setup rows carry good inline descriptions. Nothing explains the colour roles or day states except a hover-only key. |
| **Total** | | **25/40** | **Acceptable** (significant improvements needed) |

### Audit health (0 to 4)

| # | Dimension | Score | Key finding |
|---|-----------|-------|-------------|
| 1 | Accessibility | 2 | Inputs use `outline: none` with no replacement in 9 files. Only 2 of 21 files define `:focus-visible`. Text over the held mesh falls to 3.7:1. Cobalt2 Light `muted` fails on raised, the sidebar, sealedTint and the aurora. |
| 2 | Performance | 3 | Three 620 to 900px layers with `filter: blur(110px)` animate forever on every screen, with `will-change` left on, in an app that stays open all day. Held adds four blobs and `feTurbulence`. |
| 3 | Theming | 2 | Tokens are consistent, but light themes are detected with `t.app === "#FFFFFF"`, there are raw light hexes (`#C3CBD0`, `#E9ECEE`), three different `lineInput` formulas, and theme-name branches (`theme === "Cobalt2 Light"`). |
| 4 | Responsive (window sizes) | 2 | The Appearance theme list sits in an `overflow: hidden` panel with no scroll, so the light group is cut off. Week's `minmax(128px)` columns clip below about 1000px. The Intercept card (420px) still sits in a 480px window. |
| 5 | Implementation integrity | 3 | A coherent, product-specific system (rulers, ticks, the torii mark, sealed states). A few generic tells: a hero-metric tile row, eyebrows, a lock-in-tinted-square icon, and Unicode toolbar glyphs. |
| **Total** | | **12/20** | **Acceptable** |

---

## Top 10 prioritised findings

### 1. [P1] The second colour has become a per-page garnish with about ten meanings
**Files:** Notes (pin and Unpin toggle, `t.sec` on `secTint`), Journal ("wrote this day" dot), SetupProfiles (plan marker), SetupGeneral (goal tick, plus the Google "connected" sync dot), CloseDialog ("42:14 left" badge), Onboarding (active profile tab dot), ExtPopup (seal end "until 4:30 PM"), ExtBlocked (5-second wait ticks), PartnerApprove (asks-this-week tally), HeldBroken (dot beside "23m"), ProtoToday (3px calendar event bar), ProtoTrackers (every major x-axis tick when there are 13 or fewer points).
**What's wrong:** The brief allows four placements: the active sidebar icon, Stats' dashed target line, goal ticks and goal marks, and kept days. Each mock adds "the one second-colour touch" with its own new meaning: pinned, written, plan, connected, time left, selected, deadline, waiting, tally. The colour stops meaning anything, and in Notes and Onboarding it marks a selected state, which the brief says belongs to the accent. On Trackers, goal days differ from ordinary days only by tick height (11px against 8px), because every major tick is already in the second colour. Today's ruler has the same problem: the major ticks and the goal tick share one colour.
**Fix:** Keep the second colour to the brief's four placements, plus the Today ruler's goal tick. Remove it from the pin (use `text2`), the Journal written dot (use `muted`), the plan marker (none), the sync dot (use `muted`, or the accent if "connected" is a state), the onboarding tab dot (none), the ask tally (`muted`), the wait ticks (`muted`, with the active tick in the accent), the HeldBroken dot (none) and the event bar (none, or `line`). Draw scale ticks in `line` or `muted` on all rulers (Today, Stats, Trackers, Intercept, Tray), so the second colour marks only the goal and kept days. This also settles the brief's open `event` collision before it starts.

### 2. [P1] "Kept" is drawn in two colours
**Files:** ProtoToday and ProtoWeek (kept means second colour plus glow) against ProtoStats (kept bars are filled with the accent, and the legend says "Kept" with an accent swatch).
**What's wrong:** The brief contradicts itself: "kept bars on Stats" sits under the accent, while "Kept days" and "Day states: Kept = the second colour" sit under the second colour. The mocks follow both, so the same word has two colours one click apart. Stats' legend also says "Goal missed" where everywhere else says "Missed".
**Fix:** Resolve it in the brief. Recommended: bars show focused minutes in the accent (legend "Focused"), and a kept day gets the second-colour mark under its label or on its bar's cap, matching Week's dot. Rename "Goal missed" to "Missed".

### 3. [P1] Sealed things are drawn in the second colour, and the glow rule is broken
**Files:** CloseDialog (the seal's time left in `secText`), ExtPopup (seal end tick), Intercept and Tray (the seal's elapsed ticks in the second colour, and Intercept glows them), SetupProfiles (glowing plan dot), SetupGeneral (glowing goal tick), Journal (glowing today dot), ProtoWeek (second-colour radial glow behind today's in-progress column).
**What's wrong:** The brief says the accent carries what is sealed, and "Completion is the only thing that glows." Six mocks glow things that are not complete. Week's glow puts the kept colour behind a day whose own chip says "In progress" in the accent.
**Fix:** Draw seal timing and seal ends in `sealedText` or the accent. Remove the glow everywhere except kept days, the goal tick once it is met, and the held moment. Re-question Week's "one soft glow behind today": either drop it, or switch it on only once today is kept.

### 4. [P1] Headlines break the decided rule, and Today's headline differs on every page
**Files:** ProtoToday (`headline`, line 393), ExtBlocked (Pause mode h1), Checkin and CloseDialog (Today behind the dialog).
**What's wrong:**
- All three Today headlines are two sentences: "Your word is the plan. Keep it.", "Nothing else right now. Just this." and "Goal met. Go again, or go rest."
- ExtBlocked's Pause headline is a question, "Still want youtube.com?", which the decision log already flags.
- The open-state Today headline has three versions: "Your word is the plan. Keep it." (prototype), "One more block, then rest." (Checkin) and "Head down, the noise can wait." (CloseDialog, sealed).
- The backdrops follow the brief's plain fact line ("1h 18m left to reach today's 2 hours."). The prototype drops that line and puts "1h 18m left" inside the ruler.
**Fix:** Write one sentence per state, one source string per state, used by every backdrop. Examples: Open "Your word is the plan today.", Sealed "Nothing else until 4:30.", Met "Today is kept.", Pause "youtube.com can wait 15 minutes." Decide whether Today carries the plain fact line (the brief says yes) and keep the ruler for the figures.

### 5. [P1] Held, the emotional peak, is a form, and its text fails contrast over the mesh
**Files:** Held, HeldBroken.
**What's wrong:**
- The moment the product exists for asks for about 15 decisions in one view: Mark LeetCode done, Done/Partly/No, Focus 1 to 5, a note, three break lengths, Replay, Done and Enter again. That overloads working memory (cognitive-load checklist: fails single focus, minimal choices and one thing at a time) and dilutes the peak-end payoff.
- An eyebrow ("Interview Prep · 60 min") sits above the headline. Eyebrows are a craft-floor ban.
- Over the mesh centres, `text2` (the eyebrow, "12 days running.", "Take a break…") measures about 3.68:1 in Night Owl, 3.90:1 in Cobalt2 Light and 4.47:1 in Aura. Text placed on the glass panels passes; text on the bare mesh does not.
- The accent "Enter again" button stands only 2.0 to 2.2:1 against the mesh in Sanctum Dark, under the 3:1 needed for a control boundary.
- The SVG `feTurbulence` grain is a craft-floor tell. SPEC decided "subtle grain", so keep it only if it is truly subtle.
**Fix:** Lead with the mark, "Sanctum held.", one fact line and Enter again / Done. Move the review (result, rating, note) into one collapsed "Review this session" row, or a second step that appears after the build animation. Fold the break choices into a single "Take a break" button with a menu. Drop the eyebrow and put "Interview Prep · 60 min" into the fact line. Put all secondary text on the glass, or raise it to `text`. Give the accent button a 1px `text` at 30% ring, or a darker veil behind the actions.

### 6. [P1] Contrast failures in the tokens as they are used
**Files:** all pages over the aurora; Cobalt2 Light and Night Owl in particular; MiniTimer.
**What's wrong (measured):**
- **Cobalt2 Light `muted` fails 4.5:1** on `raised` (4.42), `sidebar` (4.30), `sealedTint` (4.23) and the aurora edge (about 4.36). Muted text sits on all of these: Week meta on raised cards (patched only in Week), the Appearance list, the Today picker labels and Stats' muted text on the aurora.
- **Night Owl `muted`** measures 4.47 on `sealedTint` and about 4.64 at a lit aurora edge.
- Where two aurora lights overlap at an edge, muted text falls to about 3.86 in Night Owl and about 4.30 in Aura. Muted text sits straight on the aurora in several places: Today's "focused" and ruler labels (11px), Week's "Nothing recorded", Stats' range row and Notes' "Edited".
- **Cobalt2 Light `sec` (#D68000) is 3.02:1** on white. That just passes for marks but fails anywhere it renders text. The `open` green (#49A84D) is 3.00.
- **MiniTimer, held:** the second-colour ring sits on the accent fill at 1.4 to 2.2:1, which is invisible. The `opacity: .8` sub-line on the fill drops below 4.5:1 in Cobalt2 Light.
- **Borders:** `line` on `panel` is 1.18 to 1.51:1, so the input and picker boundaries (Today's Profile/Length, Notes search) fail the 3:1 rule for UI components.
**Fix:**
- Add a `muted` that passes on every surface (Cobalt2 Light about #5E6B74), so muted works without `text2` patches.
- Lower the aurora (dark about 0.2/0.22/0.15, light about 0.1) or strengthen the veil's edge stop to `e6`, and keep the 4.5:1 test running against the composited worst case.
- Draw input borders with `lineInput` (a real token at 3:1 or better).
- Draw MiniTimer's held ring in `sealedOn`, and drop the sub-line's opacity.

### 7. [P1] Focus and keyboard behaviour is unspecified or removed
**Files:** inputs with `outline:none` and no focus style in ProtoToday (add task), Notes (search, title), SetupProfiles (4 fields), Checkin (2), Held/HeldBroken (note), Tray (2), ExtBlocked and PartnerApprove. Only ProtoToday (the streak key) and ProtoTrackers define `:focus-visible`.
**What's wrong:**
- Keyboard users lose their place in every text field.
- The Profile and Length pickers are `role="listbox"` made of `<button role="option">`, with no arrow keys, Esc or type-ahead.
- Stats day details are mouse-only (`onMouseEnter` / `onMouseLeave`).
- SetupProfiles shows the row remove button only on hover. The current app reveals these on `focus-visible` (ProfileDetail.tsx:56), so the mock drops that.
- The global ring in `src/styles.css` covers buttons only, not inputs.
- PartnerApprove uses `flex-direction: column-reverse`, so tab order (Deny, then Approve) runs opposite to the visual order.
**Fix:**
- Specify one focus treatment for every control: for inputs, a `sealed` border plus a 2px `sealed` outline at 40% alpha. Add it to the mocks' helmet once.
- Use a native `<select>` or a real listbox pattern (arrows, Home/End, Esc, focus returns to the trigger).
- Mirror hover with `onFocus` on the Stats bars (`tabindex=0`).
- Keep focus-reveal on hidden row actions.
- Fix the partner page's DOM order.

### 8. [P1] Leaving or ending a seal looks too easy, which works against the product's main goal
**Files:** ProtoToday (sealed bar), PartnerApprove.
**What's wrong:**
- The sealed session's only exit is a neutral, full-height "Stop" button, the same size as the timer. The real app says "End early" and goes through the break-the-seal ladder (Home.tsx:395, BreakSealDialog.tsx).
- SPEC's first goal is "Make bypassing a session genuinely hard". The partner page draws "Approve, end it" as the filled primary (`background: t.text`) and "Deny, keep the seal" as the outline.
- The partner page also uses `t.text` for its primary instead of the accent, which breaks the accent-for-actions rule.
**Fix:** Rename to "End early" (or "Break the seal"), make it a quiet ghost button, and show that it opens the ladder. On the partner page, give the two choices equal weight, or make "Deny, keep the seal" the accent primary, since the partner's job is to protect the seal.

### 9. [P2] Gaps listed in the decision log are still in the mocks
**Files and gaps:**
- Journal: `FACTS` still renders "1 sessions".
- MiniTimer: "Held. Nice."
- SetupAppearance: "Catppuccin Frappe Light" and "Catppuccin Macchiato Light" still sit in the dark list. The list still doesn't scroll and doesn't bring the chosen theme into view (the panel is `overflow: hidden`).
- Intercept: the 420px card still sits in a 480×320 window per the comment, so its 64px shadow is clipped.
- SetupProfiles: list and detail are still separate states, so a profile and the list are never shown together.
- ExtBlocked: the question headline (finding 4).
- Week: the glow behind today (finding 3).
- HeldBroken: still uses Held's layout and verbs, with "Replay", "Enter again" and "Take a break, distractions still closed" after a broken seal. Its copy contradicts itself: "Protection reopens it within seconds." followed by a "Turn on Protection" button.
**Fix:** Before the canvas is treated as the build reference, close each one against the "Design gaps" list:
- Journal: "1 session".
- MiniTimer: "Held."
- Appearance: move the two Catppuccin Light themes, give the list `overflow-y: auto` and scroll the chosen theme into view.
- Intercept: a 540×360 window, or a smaller card shadow.
- SetupProfiles: a two-pane layout.
- HeldBroken: remove Replay and the break row, and change the copy to "Sanctum was closed 23 minutes in. With Protection on, it reopens itself."

### 10. [P2] The mocks drift from each other in tokens, controls and sample data
**Files:** across the set.
**What's wrong:**
- `lineInput` has three formulas: `mix(line, text, .12)` (CloseDialog, Checkin), `muted + "66"` (Setup*), and a table value (ExtBlocked, ExtPopup, Tray).
- Light themes are detected with `t.app === "#FFFFFF"`, which will misfire for most light themes.
- Segmented controls are `tablist` in Week and Stats but `aria-pressed` groups in Trackers. Onboarding's profile tabs are `tablist` with no tabpanel.
- Radii: Trackers uses 6 and 8, the rest use 8 and 12.
- Page-title sizes: 22 (Notes, Journal, Setup) against 26 (Week, Stats, Trackers). SPEC says 20.
- Mood: 1 to 5 with names in Journal, 1 to 10 in Check-in and Trackers.
- Durations: 25, 45 and 90 min in Tray and Profiles, against SPEC's 15-minute steps used on Today.
- The "Open" dot: a new third hue (`open`: #61FFCA in Aura) in Tray and ExtPopup, but `text` in the Main sidebar.
- The weekly target: 10h on Stats against 14h 30m in Setup General.
- The plan treatment: a `sealedTint` box in Intercept, a neutral box with a square second-colour mark in ExtBlocked, a glowing round dot in Profiles, and different plan text in each.
**Fix:** Before the rollout's step 1, hoist the shared parts into one token sheet: `lineInput`, `lineSoft`, `isLight` from luminance, and the focus ring. Pick one segmented control (`aria-pressed` group for filters, `tablist` only with tabpanels), one radius scale (6 controls, 8 panels, 12 dialogs per SPEC), one title size, one mood scale, SPEC durations, and drop the `open` colour. Align the sample data so reviewers aren't distracted.

---

## Design specificity verdict

**LLM assessment.** This reads as authored for Sanctum, not as a category template. The ruler (Today), the tick-scaled charts (Stats, Trackers), the seal's ruler along the Intercept card's top edge, the torii mark with a breathing keyhole, "stays sealed" copy and the day-state vocabulary are all specific to this product. Schibsted Grotesk in every heading, set in one weight with no italic payoff, is applied consistently: no `Instrument` or `italic` headline remains, and no all-caps labels remain. That is a real improvement on the AI tell the brief set out to remove.

The generic risk now comes from three places:
- **The aurora.** Three blurred colour blobs behind every screen is the most common AI backdrop. It is decided, so keep it, but it should sit near the edge of perception on Operate screens and come forward only while sealed. At the current opacities it lowers text contrast at the edges (finding 6).
- **Second-colour garnish.** "One small warm dot on every page" (finding 1) is a known pattern of decorative accent use. It reads as a style choice, not as meaning.
- **Template details:**
  - The Stats tile row: four big numbers with small labels, the hero-metric template.
  - The Intercept lock icon in a tinted rounded square.
  - Eyebrows above headlines on Held, Check-in and the Log entry form.
  - Unicode glyph icons (•≡ ☑ ▦ ▣ !) beside drawn SVG icons in the Notes and Journal toolbars.
  - ‹ › glyphs as Week's arrows.
  - The delete icon in Notes is the same X used for close.

**Deterministic scan.** Not run: `impeccable detect` needs the launcher, which downloads a binary that is not approved. The source checks were run by hand (see the audit table). No overlay was injected.

## What's working
- **The ruler language.** Today's day ruler, Stats' axis ruler, Trackers' rulers and the Intercept and Tray seal rulers give the product a visual signature from its own domain: measured time against a promise. It is the strongest move in the set.
- **Accent discipline for actions.** Enter focus, + New, Log entry, Continue, Enter again and the checked boxes all use the accent with `sealedOn`, and `sealedOn` on the accent passes in every theme (4.81 to 7.79). Done items (accent box, muted, struck through) and past slipped items (hollow box, dimmed) follow the brief exactly.
- **Motion that respects the brief.** The live minute glide (400ms ease-out), roll-ups and the single goal pulse all convey state. All but one file ships a `prefers-reduced-motion` block (Intercept has no animation to stop). HeldBroken slows the drift instead of alarming, which is a nice touch.

## Persona red flags
- **Alex (power user):**
  - The Profile and Length pickers can't be driven by keyboard.
  - Stats day details need a mouse.
  - Week's prev/next have no shortcut.
  - Held asks about 15 questions before Enter again. Enter is bound, but Alex has to read past a form to trust it.
- **Sam (keyboard and screen reader):**
  - There is no visible focus in any text field.
  - The Week and Stats tablists have no tabpanels.
  - The Setup section headers are plain spans inside `role="tablist"`.
  - The partner page's tab order is reversed.
  - Held text contrast is 3.7:1 in Night Owl.
  - Meaning by colour alone: the days strip is `aria-hidden` but its button label covers it (good). The Week kept/missed chips carry text (good). Journal's "written" dot and Trackers' "goal day" ticks rely on colour and height only.
- **Project persona, "Tempted mid-session"** (SPEC: the user is choosing between keeping their word and being mid):
  - On Today the exit is a big neutral "Stop".
  - On the partner page, the friend is nudged to "Approve".
  - On Intercept the plan is there, but its treatment differs from the plan in Setup and in the extension, so the "line every catch says back" isn't recognisable as the same thing.

## Minor observations
- Today shows progress three times: the ruler, the days strip's today cell and the "Focus today" bar at the bottom. Drop the bottom strip. This is in line with the "quiet main screens" direction.
- Today names its right-hand list "Today" inside the Today page. "Tasks" or "Day" would avoid the echo.
- The Trackers validation error uses `sealedText`, so it is red in Aura but teal in Cobalt2 Light and blue in Sanctum Dark. Errors need their own role.
- The CloseDialog sealed state explains "Not while sealed" inside a disabled card at `opacity: .55`, so the one line the user needs is the dimmest. Put the reason, with the end time ("Quit opens at 4:12 PM"), in the subtitle.
- The CloseDialog open subtitle and Held's review prompt are questions ("What should the close button do?", "Did … get done?"). These are not headlines, but the voice rule is "no questions". Use "Choose what the close button does." and "Two graph problems:" followed by the choices.
- In the Main prototype, Week, Stats and Trackers stay reachable while sealed. SPEC locks them. That's acceptable for prototype scope, but say so on the canvas.
- PartnerApprove's footer has 6 links on an approval page. Trim it to Privacy and GitHub.

## Questions to consider
- If the second colour only ever meant "kept" (and the goal you keep), would anyone need a key?
- What would Held look like if it asked nothing at all, and the review happened at the evening check-in?
- Should leaving a seal ever be a button the same size as the timer?
- Does the aurora need to move on screens where the user is reading or typing (Notes, Journal, Setup)?

---

## Audit: technical checks (source review)

**Implementation integrity verdict: pass, with drift.** It is one product-specific system. The drift comes from copy-pasted helpers that diverged (`lineInput`, `isLight`, `auroraX`, setup nav) across 21 standalone files.

**Issue counts:** P0 0, P1 8, P2 9, P3 3.

### Accessibility
- **[P1] Inputs without focus indicators** (finding 7). WCAG 2.4.7.
- **[P1] Contrast over the held mesh and the aurora, Cobalt2 muted, Night Owl muted on sealedTint** (finding 6). WCAG 1.4.3 and 1.4.11.
- **[P2] Custom listbox without the keyboard model** (ProtoToday). WCAG 2.1.1, ARIA APG listbox.
- **[P2] Hover-only content.** The Stats details, the Profiles remove button and the streak key. The streak key also opens on focus, which is good. WCAG 1.4.13 and 2.1.1.
- **[P2] Tab semantics.** The Week, Stats and Onboarding tablists have no `tabpanel` or `aria-controls`. The Setup tablist contains non-tab header spans. Journal's day strip uses tabs for 14 dates and should be a radiogroup or a list of buttons with `aria-current`.
- **[P2] Order.** PartnerApprove's `column-reverse` reverses DOM order against visual order. WCAG 1.3.2 and 2.4.3.
- **[P3] Dialog backdrops.** Checkin and CloseDialog render the Today `<h1>` beside the dialog's own `<h1>` with no `inert` or `aria-hidden` on the page behind. Real-app note: mark the background inert.
- **Positive:** the ruler (`role="img"` with a full spoken label), `role="timer"`, `aria-live` on the Stats hover line and tracker values, `role="switch"`, labelled checkboxes, and `aria-current` in the nav.

### Motion and reduced motion
- 20 of 21 files have a `prefers-reduced-motion` block, and the one without (Intercept) has no animation. The aurora and held mesh go still, which matches the brief ("still under reduced motion"). The rule in ProtoWeek and Main (`*{animation:none; transition:none}`) also kills state transitions such as checkbox fills. That is acceptable here because values still update, but prefer removing only the motion (transform and opacity), not colour changes.
- **[P2] Ambient cost.** The aurora animates continuously (46 to 62s loops) on large blurred layers, with `will-change: transform` permanently on. Held runs four blobs with 110 to 130px blur on 14 to 19s loops, plus grain. For a tray app that stays open all day under WebView2, pause the aurora when the window is hidden or unfocused, and drop `will-change` at rest.
- Operate timing is right: 150 to 400ms state transitions, no choreographed page loads. The live-minute choreography matches the brief.

### Theming
- **[P2]** The `isLight = t.app === "#FFFFFF"` hack (Main, Held, Week via luminance, Setup*). Use luminance, or a `scheme` field on the theme.
- **[P2]** `theme === "Cobalt2 Light"` branches for `keyColor` and Week meta are patches for a token that fails. Fix the token (finding 6).
- **[P3]** Raw hexes: light `lineInput` #C3CBD0, `lineSoft` #E9ECEE, the scrims, shadows and the MiniTimer `SEALED_LINE` table.
- **Positive:** every colour except those resolves from one 16-key theme table, identical in all 21 files, and the brief's `secText` darkening for Cobalt2 Light (#8F5600, 6.00:1) is applied wherever the second colour carries text (Today goal label, Stats target label, Week Kept chip, CloseDialog badge).

### Responsive (window sizes)
- **[P1]** The SetupAppearance list can't scroll (finding 9).
- **[P2]** Week's 7×`minmax(128px)` grid sits inside `overflow: hidden`. Below about 1000px of content width, Sunday (today) is clipped first.
- **[P2]** The Intercept window has no room for the card's shadow (finding 9).
- **Positive:** the Today focus row and lists use `auto-fit` grids, the sidebar is a fixed 220px, and long labels ellipsize.

### Consistency across pages
See finding 10, plus findings 1 to 4.

### Recommended actions (impeccable commands)
1. **[P1] `$impeccable colorize`**: restrict the second colour to kept days and the goal; move seal timing to the accent; one glow rule (findings 1 to 3).
2. **[P1] `$impeccable clarify`**: one-sentence headlines and one source string per state; fix "Stop", the partner hierarchy and the HeldBroken copy (findings 4 and 8).
3. **[P1] `$impeccable distill`**: Held down to headline, fact and two actions, with the review deferred; Today's triple progress down to one (finding 5).
4. **[P1] `$impeccable harden`**: focus ring tokens, the keyboard listbox, focus-reveal, contrast-safe `muted` and `lineInput`, and the aurora worst-case test (findings 6 and 7).
5. **[P2] `$impeccable document`**: hoist the shared helpers and tokens; one control, radius and title scale (finding 10).
6. **[P2] `$impeccable polish`**: close the decision-log gaps (finding 9) and the minor observations.

---

## Per-page notes

### Main (shell)
- The sidebar's active icon in the second colour follows the brief.
- The state pill's dot uses `text` when open, and the accent plus `sealedTint` when sealed. Good.
- Shortcuts work for Ctrl 1 to 4 and Ctrl Enter. Ctrl , and Ctrl 5 to 6 are shown but disabled with `aria-disabled` and the title "Not in this prototype". Fine.
- The aurora is drawn here and shows through the screens behind transparent roots. It is stronger while sealed, as the brief says.
- `onKeyDown` sits on a non-focusable div, so shortcuts only fire once something inside has focus. In the real app, bind them on `window`.

### ProtoToday
- Strong: the ruler, the needle glide, the minute roll-up, the goal pulse, the hover/focus key on the streak, and the spoken `aria-label`.
- Problems:
  - The headlines are two sentences (finding 4).
  - "Stop" (finding 8).
  - Triple progress (minor observations).
  - The calendar event bar in the second colour (finding 1).
  - Major ruler ticks in the second colour blur the goal tick (finding 1).
  - The add-task input has no focus style (finding 7).
  - The Profile and Length listbox has no keyboard support (finding 7).
- The 52px Enter focus button is a good, clear primary.

### ProtoWeek
- The day-state vocabulary is exact: kept chip in second colour plus glow, In progress with an accent border, Missed hollow, future faint.
- Done and slipped items follow the brief.
- The left-border accent edges from the old app are gone. Good.
- Problems:
  - The second-colour glow behind the in-progress today (finding 3).
  - Unicode ‹ › arrows.
  - The `tablist` has no panels.
  - The `muted` meta patch is needed only because of the token (finding 6).
  - The List, Month and Routines placeholders are honest.

### ProtoStats
- The dashed second-colour target line and the hour ticks follow the brief, and the best-day mark has been removed as decided.
- Problems:
  - The accent "Kept" bars (finding 2).
  - The hero-metric tile row (verdict).
  - Hover-only details (finding 7).
  - "Goal missed" wording (finding 2).
  - "Seals broken 0" as a tile is defensive. Fold it into the streak tile's subtext.

### ProtoTrackers
- Has the only proper `:focus-visible` rule. The Log entry form handles Esc, uses `role="alert"` for errors and says "Logging replaces it", which is good.
- Problems:
  - Every major x tick is in the second colour when there are 13 or fewer points, so goal days are not distinct (finding 1).
  - The error colour is the accent (minor observations).
  - Radii are 6 and 8 here, against 8 and 12 elsewhere (finding 10).
  - The `aria-pressed` segmented controls differ from Week and Stats (finding 10).
  - The Log form is a popover with `role="dialog"` but no focus trap or return. Fine for a popover, but say which it is.

### Notes
- Clean two-pane layout, and the Schibsted title input fits.
- Problems:
  - The pin and the Unpin toggle use the second colour (finding 1).
  - Delete uses an X (use a trash glyph and confirm or undo).
  - The toolbar mixes Unicode glyphs with SVG.
  - The search and title inputs use `outline:none`.
  - The `@` mention chip in the accent tint is fine, since a link is an action.

### Journal
- The day strip's second-colour "written" dot gives the colour a new meaning (finding 1). The gap the decision log asked for, kept and missed states, is still missing.
- "1 sessions" (finding 9).
- The prompts are questions as h3. They are prompts, not headlines, but consider statement prompts ("What went well." becomes "Went well").
- Mood here is 1 to 5 against 1 to 10 elsewhere (finding 10).
- The facts row is a small metric strip. Acceptable.

### SetupProfiles
- The glowing second-colour plan dot (finding 3).
- 25/60/90 min durations against SPEC (finding 10).
- The list and the open profile are still separate (finding 9).
- The remove button is hover-only (finding 7).
- "Delete" sits beside "Test launch" with identical weight. Separate it, or give it a destructive style with confirmation.
- The breadcrumb "Setup ›" in 22px Schibsted is heavy for a back link. Use 13px `muted`.

### SetupAppearance
- The hover preview labelling the theme pair "Accent" and "Second colour" is the clearest explanation of the colour roles anywhere in the set. Reuse that language.
- No scroll, and the misfiled Catppuccin Light themes (finding 9).
- The preview card is `aria-hidden` and hover-only. Fine, since the radio label carries the name.

### SetupGeneral
- Good inline descriptions, and "Day resets at" copy is excellent.
- The goal tick glows (finding 3).
- The sync "connected" dot is in the second colour (finding 1).
- The 14.5h weekly target conflicts with Stats' 10h (finding 10).
- The volume slider is `aria-hidden` with no input. Specify a real `<input type="range">`.

### Held
- "Sanctum held." is the right headline: one sentence, 88px Schibsted.
- The theme-derived mesh (accent, second colour, blend) follows the brief, and the old `sealedOn` text problem is fixed (text now uses `text` and `text2`).
- Overload, the eyebrow, mesh contrast and grain (finding 5).
- The SPEC's mark build and ring pulse are only implied by the static rings. Note the motion on the canvas.

### HeldBroken
- The drained-to-grey keyhole and the slower drift are a good, unalarming distinction from a kept seal, which closes the "looks the same" gap.
- Layout reuse and the copy contradiction (finding 9).
- The second-colour dot beside "23m" (finding 1).
- "Seal broken." matches the SPEC's core string.

### Intercept
- "Discord stays sealed." is perfect. The seal ruler along the top edge is a lovely, specific detail.
- "That's 3 tries" repeats the "3rd attempt this session" meta line. Cut one.
- The plan box uses `sealedTint`, unlike the extension and Profiles (finding 10).
- The elapsed ticks glow (finding 3).
- The lock icon sits in a tinted square (verdict).
- The 420 card is in a 480 window (finding 9).
- "Returning in 4s" auto-acts. Acceptable because it returns to safety.

### Checkin
- The overflow gap is fixed (`max-height: calc(100% - 160px)`, scrolling body).
- The sparklines now show the goal as a dashed second-colour line, as the brief says.
- The scale and yes/no rows show "Last:" (partial history).
- "Scheduled check-in · 9:00 PM" is an eyebrow (verdict).
- Mood uses `aria-pressed` buttons here and `radio` in Journal. Pick `radiogroup`.
- Backdrop headline (finding 4).
- Close with `aria-label="Close and ask again in 15 minutes"` is honest and good.

### CloseDialog
- The time left is in the second colour (finding 3). The disabled card holds the explanation (minor observations).
- "Minimize" as the accent primary with "Don't ask again" ticked by default matches SPEC.
- Backdrop headline (finding 4).

### Onboarding
- Every step headline is one plain sentence ("Define Interview Prep.", "Seal the browser too.", "You're set."). This is the model for the rest.
- Problems:
  - The second-colour dot on the active profile tab (finding 1).
  - The profile tab names differ from Today's (sample data).
  - 8 steps is long for Jordan. Consider merging Look into Ready, or making it skippable.

### Tray
- The sealed timer now uses `text`, which fixes the unreadable `sealedOn` timer gap.
- Problems:
  - The `open` third hue (finding 10).
  - The quarter-hour ticks in the second colour (finding 1).
  - Durations 25/45/90 (finding 10).
  - The muted foot line on `panelFooter` passes in all themes. Good, the `faint` text has been moved to `muted`.

### MiniTimer
- The two-layer clip technique keeps text readable over the accent fill. Good.
- "Held. Nice." (finding 9).
- The held ring is in the second colour on the accent fill, 1.4 to 2.2:1 (finding 6).
- The held state glows, which is legitimate because it is a completion.

### ExtPopup
- The sealed seal-end tick is in the second colour (finding 3).
- "Nothing is sealed." plus one line is a calm, good open state.
- The `open` hue in the pill (finding 10).

### ExtBlocked
- "youtube.com stays sealed." is good. "Scrolling is how mid happens." carries the brand voice.
- Pause mode's question headline (finding 4).
- The wait ticks are in the second colour (finding 1).
- The plan box is the best of the three plan treatments: neutral, with a small mark. Standardise on it, with the mark in `muted` or removed.

### PartnerApprove
- Hierarchy favours Approve (finding 8). Reversed DOM order (finding 7).
- The ask tally is in the second colour (finding 1).
- "Alex wants out early." is a sharp, plain headline.
- "Works once and expires in 28 minutes. 3 wrong PINs lock approvals for 30 minutes." is excellent error-prevention copy.
- Trim the 6-link footer.

---

## Run notes
- **Target slug:** not computed (`critique-storage` is part of the launcher, which is not approved). **Ignore list:** `.impeccable/critique/ignore.md` was not present in the project.
- **Assessment independence:** degraded. A and B ran in one context. B was reduced to manual source checks because the detector was not run (it needs the unapproved binary).
- **Browser:** opened my own tab (`tab-1`) for http://localhost:1420/. Navigation failed (server unreachable), and the tab was closed. The "seed" tab was not used. The comparison with the current app used `src/` read-only (styles.css focus ring, Home.tsx "End early", ProfileDetail.tsx focus-reveal).
- **Overlay injection:** not attempted. **Live server:** none started.
- **Snapshot persistence and trend:** skipped (launcher not approved).
- **Temp files:** two helper scripts for the contrast maths are in `scratchpad/critique-tools/`. No mockup or repo file was edited.

## Questions for you
1. **Priority:** which should come first?
   - Colour roles (findings 1 to 3)
   - The emotional moments (Held, the partner page, "Stop")
   - Accessibility hardening (focus, contrast)
2. **Kept on Stats** (finding 2): which way should it go?
   - Accent bars plus a second-colour kept mark
   - Second-colour kept bars
   - Leave the bars as they are and rename the legend
3. **Held review:** where should the post-session review go?
   - Keep it on Held, collapsed
   - A second step after the build animation
   - Move it to the evening check-in
