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
