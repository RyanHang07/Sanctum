# Decision log: the theme's second colour, headlines, and live progress

**Date:** 2026-11-15
**Status:** Designing (prototypes on the design canvas; no app code yet)
**Canvas:** "Sanctum Gate Light Screens" (private Design artifact)

## Why

The app read as one note: the accent (`sealed`) did everything and the rest was grey. The headline payoff (Instrument Serif italic, one accented phrase) is a common tell of AI-made interfaces. The theme picker already shows each theme's second colour beside its accent: the `event` colour.

## Decisions

### Colour roles
- **Accent (`sealed`)** is what you act on and what is sealed: Enter focus, + New, Log entry, ticked boxes, the day's progress fill, kept bars on Stats, today's "In progress" state, the keyhole in the mark.
- **Second colour** is decoration, never a call to action. Source: each theme's `event` colour (Aura #FFCA85, Night Owl #ECC48D, Cobalt2 Light #D68000, Sanctum Dark #FF8A6B). Its text value is darkened where it fails 4.5:1 (Cobalt2 Light text #8F5600).
- Open question for build time: `event` also means "you're in an event". If the two meanings collide on a screen, themes get a dedicated `second` slot that defaults to `event`.
- Where the second colour goes, kept everywhere:
  - The active sidebar item's icon.
  - The dashed daily target line on Stats.
  - Goal ticks and goal marks.
  - Kept days.
- Rejected:
  - The curved "beam" from the torii's top beam.
  - Straight two-tone gradient lines.
  - Gradient washes.
  - Using the second colour for Enter focus.

### Headlines
- A headline is one plain sentence, in one weight and one colour. No italic payoff, no accented word or phrase. This replaces the rule in `design/README.md` (Geist bold statement + Instrument Serif italic payoff) once built.
- **Headline font: Schibsted Grotesk** (700). Interface text stays **Geist**; numbers stay **Geist Mono**. Chosen from live research of 19 productivity sites: Inter is the generic default, and distinctive tools use their own grotesk. Schibsted Grotesk gives that look for free.
- Today's fact moves into plain text under the headline ("1h 18m left to reach today's 2 hours"), not a payoff.
- Labels are sentence case, never all caps.

### Screens (chosen directions)
- **Today: Ruler (Today-2).** A full-width ruler of the day under the headline, with minor ticks every 5 minutes and major ticks in the second colour. A needle marks focused time, and a tall goal tick in the second colour marks the goal.
  - The days strip in the top bar keeps its current thickness.
- **Week: Glow (Week-3).** Kept days carry small second-colour dots, and one soft glow sits behind today's column. The headline uses Schibsted Grotesk, like every screen.
- **Stats: Ruler (Stats-2)**, without the "best day" indicator. The dashed second-colour target line stays.
- **Trackers: Ruler (Trackers-2).** Rulers serve as chart axes. Days at goal get a taller second-colour tick and day label.

### Day states (the days strip on Today, and Week)
- **Kept:** the second colour with a soft glow. Completion is the only thing that glows.
- **Today, in progress:** the accent, filling as you focus.
- **Missed:** a hollow outline.
- **Future:** faint.

### Live minutes (during a session, while Today is on screen)
- Each completed minute, the needle glides one tick (ease-out, about 400 ms) and the minutes figure rolls up one digit.
- Crossing a major tick briefly brightens it.
- Reaching the goal lights the goal tick in the second colour with one soft glow pulse, and today in the days strip turns kept, with its glow fading in.
- `prefers-reduced-motion`: values update without motion and the pulse is skipped.

### Done items (Week, and lists everywhere)
- **Done:** an accent ticked box, with the text muted and struck through.
- **Past days:** done items stay struck through. Unfinished items keep a hollow box and dimmed text, so what slipped stays visible.

### Prototype scope (design canvas)
One interactive prototype with shared state:
- A live focus session: Enter focus starts it and Stop ends it. Minutes tick sped up (1 minute per second) with the animation above.
- Ticking routines and tasks on Today and Week.
- Navigation between Today, Week, Stats and Trackers, plus Week's previous and next week.
- Logging a tracker entry, which updates its chart and goal ticks.

## Not decided yet
- Whether the second colour needs its own theme slot (see Colour roles).
- Light-theme glow strength. The prototypes use a lower opacity on light themes.

## Since the first draft (2026-11-15, later)
- The days strip's key (Kept, Missed, Today) appears only while the streak is hovered or focused. Week has no key, because the page is the key.
- Stats: no "best day" mark and no tick-scale legend note. The hover detail has a fixed spot at the end of the legend row.
- The screen keeps a soft moving background: an "aurora" of three blurred lights in the accent and the second colour, veiled toward the page colour. It is stronger while sealed and still under reduced motion. This replaces the open-state mesh's fixed colours.
- The held mesh is redrawn from the theme: accent, second colour and a blend, instead of the fixed held-1..4 tones. A broken seal drains the accent to grey.
- Motion: GSAP is the candidate for the app's choreographed moments (live minutes, goal reached, held build). It is free, plugins included, since April 2025. Not added yet.

## Design gaps found while mocking every page
Found in the current app by the page reviews. Each is fixed as its screen is built.

**Contrast and colour roles**
- **The tray's sealed timer is unreadable in Aura and Night Owl.** It is drawn in `text-sealed-on`, a dark colour, on a dark panel (TrayPanel.tsx).
- **Held page roles are off.**
  - Its text and its "Enter again" button use `sealed-on`, which is near-black in Aura over a dark mesh.
  - The held colours stay dark tones even on light themes.
- **`text-faint` holds real text in many places,** around 3:1 in Aura:
  - setup group headers
  - note dates and "Edited"
  - "Returning in"
  - the tray and popup foot lines
  
  Use `muted` for any text that must be read.
- **Some themes have no real accent and second-colour pair.**
  - Flexoki Light and OpenCode Light use the same colour for both.
  - In Orng and Lucent Orng, the near-white accent and orange event colour look swapped.
  - Catppuccin Frappe Light and Macchiato Light are dark copies listed as dark themes.
  
  Answering the open question, these are the themes that need a `second` slot.

**Old headline and label rules still in the code**
- **Italic payoffs remain:**
  - `<Headline>`
  - HeldPage ("Sanctum *held.*")
  - Intercept cards, WelcomeCard and ParkCard
  - the journal's locked and setup headlines
  - the editor's italic button (Instrument Serif)
  - the extension's `h1 em` and `headline()`
  - the partner site's two-sentence headlines
- **Questions in headlines:** "What should a page ask?" (journal setup) and "Still want youtube.com?" (Pause mode).
- **Uppercase labels:** setup group headers, the journal day strip's weekday letters, "Link works for", "Show in Sanctum", and the held and intercept eyebrows.
- **The extension doesn't bundle Schibsted Grotesk.**
- **Odd copy:**
  - "1 sessions" (journal fact)
  - "Held, but the downtime broke it" (broken seal)
  - "Held. Nice." (compact timer), which is casual against the serious voice

**Layout and behaviour**
- **Intercept window is too tight.** With a plan it is 480×320, and the card (about 310px) clips its shadow. A long "back to" name truncates at 128px.
- **Check-in dialog:**
  - It overflows a 720px-high window (top 120 + max 640).
  - Its sparklines show no goal.
  - Scale and yes/no rows have no history.
- **The close dialog, while sealed,** doesn't say when quitting becomes possible.
- **A broken seal looks the same as a kept one** on the held page: the same mesh, build and rings.
- **The journal day strip has no kept or missed states,** unlike Today and Week.
- **The Appearance list doesn't scroll the chosen theme into view,** and there are 40 dark themes.
- **Profiles have no blocklist of their own.** Seals summarise the shared Distractions list. The profile list and the open profile never show together.
- **The extension popup can't show progress,** because its rules have an end time but no start.
- **Left-border accent cards remain:** the blocked page's plan card, the Intercept plan box, and Week's routine and event edges.
- **Design references are stale:** MiniTimer.dc.html describes an old multi-stop fill, and popup.css has stale colour comments.

## Rollout plan
Build in this order. Each step ships with Vitest coverage and a CHANGELOG entry, with hardware or live checks added to docs/manual-testing.md.
1. **Tokens.**
   - A `second` palette slot that defaults to `event`, with explicit values for the themes listed above.
   - `second-text`, `second-tint` and `second-line` derived like `sealed-*`, passing the 4.5:1 test in themes.test.ts.
   - The extension gets the same keys.
2. **Type.**
   - Schibsted Grotesk joins the bundled fonts (app and extension).
   - `<Headline>` becomes one sentence.
   - headlines.ts and blocked.js `headline()` move from statement plus payoff to single lines.
   - The design/README.md and CLAUDE.md headline rule is updated.
   - Instrument Serif is removed where it was a payoff.
3. **Contrast fixes:** sealed-on roles on the held page and tray, and faint text moved to muted.
4. **Today:** the ruler, the days strip with its hover key, and live minutes. The motion is built with GSAP if approved, otherwise with CSS.
5. **Week, Stats and Trackers**, as prototyped.
6. **Aurora backdrop and theme-derived held mesh** (Mesh.tsx).
7. **The rest, from the canvas mocks:**
   - Notes, Journal, Setup and Onboarding
   - Held, Intercept, Check-in and the close dialog
   - Tray, compact timer, extension and the partner site
   
   Each page's gaps above are fixed as it's built.

## After the impeccable critique and the motion spec (2026-11-15, evening)
- **The second colour is a strict set:**
  - the active sidebar icon
  - dashed target lines
  - goal ticks and marks
  - kept days
  - the ruler's major ticks
  
  Anything about the seal (time left, seal progress, the seal line, when a seal ends) is the accent. Pins, written days, plans and tallies go neutral or accent.
- **Kept on Stats:** bars stay the accent and are labelled "Focused". Kept days get a small second-colour kept mark, matching Today and Week. "Goal missed" becomes "Missed".
- **Glow** is only for kept days, the goal once met, and the held moment.
- **The held page collapses** to the headline, one fact line and two actions (Enter again, Done). "Add a note" opens the review only on request.
- **The aurora is near-still and barely visible while open.** It strengthens and moves a little only while sealed, and pauses when the window is hidden. It's drawn with radial gradients, not blur filters.
- **Leaving a seal** is a quiet "End early", never a big "Stop". On the partner page, deny is never weaker than approve.
- **Motion engine: GSAP** (`gsap`, `@gsap/react`; CustomEase and Flip). It replaces `motion` (Framer Motion) so the app has one animation engine.
  - Spec: the motion spec from this session (its timings live in `src/theme/extra.json` motion tokens: ui 120, enter 180, state 240, glide 400, moment 700, drain 1200, breathe 3200 ms).
  - The aurora and simple hovers stay CSS.
