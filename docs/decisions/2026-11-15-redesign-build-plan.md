# Build plan: the second-colour redesign, built by a team of agents

**Date:** 2026-11-15
**Status:** Approved 2026-11-15 (worktree per agent; version v0.4.0; Catppuccin per the theme-pair review: Latte replaces the two "Light" copies). **Wave 0 is built and merged** into `feature/redesign` and `dev` (see "Progress" at the end). Checkpoint A screenshots are still to take; Wave 1 has not started.

**What it builds:** everything decided in these documents:
- [2026-11-15-second-colour-and-headlines.md](2026-11-15-second-colour-and-headlines.md)
- [2026-11-15-motion-spec.md](2026-11-15-motion-spec.md)
- [2026-11-15-design-critique.md](2026-11-15-design-critique.md)
- the "Sanctum Gate Light Screens" design canvas, the visual source of truth

## How the work is split
- **One agent per area, and each owns its files.** No two agents edit the same file in the same wave. If an agent needs a change in a file it doesn't own, it writes a request in its report, and the file's owner or the lead makes the change.
- **Foundations first.** Every screen depends on four foundations: the colour tokens, the type, the motion engine and the aurora. They land and are approved before any screen agent starts, so screen agents build on finished parts instead of guessing.
- **Every agent checks its own work, and a separate agent checks it again.** Each one runs the tests and typecheck, and looks at its screens in the dev preview (mock backend) in Aura, Night Owl, Cobalt2 Light and Sanctum Dark. A reviewer agent then checks each wave against the canvas and the decision log, and the lead (me) merges.
- **Isolation:**
  - Each agent works in its own git worktree, on a branch from `feature/redesign` (made from `dev`).
  - The lead merges each wave back into `feature/redesign`, runs the full suite, and commits there.
  - `dev` gets the result after your review.
  - You push to `main` and tag, as usual.

## The team

### Wave 0: foundations
F1 runs first, alone. F2 and F3 then run in parallel, and F4 and F5 follow once F1 and F3 have landed.

| Agent | Owns | Delivers |
|---|---|---|
| **F1 Tokens and themes** | `src/theme/*`, `design/tokens.*`, `extension/tokens.css`, `extension/theme.js` | <ul><li>A `second` palette slot, defaulting to `event`, with `second-text`, `second-tint` and `second-line` derived like `sealed-*`.</li><li>Hand-picked second colours for the themes the theme-pair review flags.</li><li>The Orng and Catppuccin fixes.</li><li>Passing values for `muted` and `line-input`, with a `scheme` field everywhere.</li><li>themes.test.ts extended so every theme passes 4.5:1 for text and 3:1 for marks.</li><li>The extension receives the new keys.</li></ul> |
| **F2 Type and headlines** | `src/pages/headlines.ts`, the `Headline` component, `src/styles.css` (type section), `extension/fonts`, `extension/blocked.*` (headline only), `design/README.md`, `CLAUDE.md` (headline rule) | <ul><li>Schibsted Grotesk bundled in the app and extension.</li><li>One-sentence headlines from a single source, with no italic payoff and no questions.</li><li>Instrument Serif removed where it was a payoff.</li><li>Sentence-case labels.</li><li>The headline rule updated in the design docs.</li></ul> |
| **F3 Motion engine** | `src/lib/motion.tsx`, a new `src/lib/gsap.ts`, `useMotion`, `<Odometer>`, the `motion` tokens in `extra.json`, `package.json` (gsap, @gsap/react; `motion` removed) | <ul><li>The GSAP setup from the motion spec: CustomEase tokens, Flip, `useMotion(scope)` with reduced motion and hidden-window handling, and the shared `<Odometer>`.</li><li>`Glide` and `useRolling` moved to GSAP.</li><li>Framer Motion removed.</li><li>Vitest helpers (seek timelines, reduced-motion stub).</li></ul> |
| **F4 Aurora** | `src/components/Mesh.tsx` (to become `Aurora.tsx`), the backdrop section of `src/styles.css` | <ul><li>The WebGL northern-lights shader from the canvas: band in the accent, tips in the second colour.</li><li>Top or bottom placement.</li><li>Open, sealed, held and broken intensities.</li><li>Pauses when hidden, a still frame under reduced motion, and a CSS gradient fallback.</li><li>`StateBackdrop` and the held mesh switched to it, with a battery check.</li></ul> |
| **F5 Shell** | `AppShell.tsx`, `Sidebar.tsx`, `CommandBar.tsx`, `Toast.tsx`, `Button.tsx`, `controls.tsx`, `icons.tsx` | <ul><li>The sidebar's active icon in the second colour, with a gliding indicator.</li><li>A content swap between screens with no page-wide fade.</li><li>One focus-ring style everywhere.</li><li>Shared controls updated: segmented tablists, radii 8 and 12, and the lineInput border.</li></ul> |

**Checkpoint A (you):** I send screenshots of the shell plus the token and type changes in all four themes, the aurora in both placements, and a short motion clip. You approve before Wave 1 starts.

### Wave 1: screens, all in parallel
| Agent | Owns | Delivers (canvas artboard → real screen) |
|---|---|---|
| **S1 Today** | `src/pages/Home.tsx`, `CounterRow.tsx`, `StreakMark.tsx`, `src/state/session.ts` (UI hooks only) | <ul><li>The ruler, with live minutes on the odometer, tick lights and the goal moment.</li><li>The days strip at its current thickness, with the key shown on hover or focus only.</li><li>Entering focus: the seal line, the quiet "End early" button and keyboard pickers.</li></ul> |
| **S2 Week** | `src/pages/week/*` | <ul><li>The Glow direction.</li><li>Day states (kept, missed, today, future).</li><li>Done and past-unfinished items.</li><li>Routine folds.</li><li>The cards' left-edge accents removed.</li></ul> |
| **S3 Stats** | `src/pages/stats/*` | <ul><li>The Ruler direction.</li><li>Bars labelled "Focused", with a second-colour kept mark.</li><li>The dashed target line.</li><li>No best-day mark.</li><li>Hover details in a fixed spot, which also show on keyboard focus.</li></ul> |
| **S4 Trackers and check-in** | `src/pages/trackers/*`, `CheckinDialog.tsx`, `src/pages/setup/Trackers.tsx` | <ul><li>Ruler axes, with ticks for days at goal.</li><li>Logging that rolls the value and grows the goal tick.</li><li>Check-in at its new size, with an inner scroll and dashed goal lines.</li></ul> |
| **S5 Notes and Journal** | `src/pages/notes/*`, `src/pages/journal/*`, `src/components/editor/*` | <ul><li>SVG toolbar icons.</li><li>The journal's day strip with kept and missed days.</li><li>"1 session".</li><li>The setup and locked headlines.</li></ul> |
| **S6 Setup and Onboarding** | `src/pages/Setup.tsx`, `src/pages/setup/*` (except Trackers.tsx), `src/pages/onboarding/*` | <ul><li>Appearance shows the accent and second-colour pair, fixes its theme lists, and scrolls the chosen theme into view.</li><li>The General goal tick.</li><li>Profiles.</li><li>Onboarding with one-sentence step headlines.</li></ul> |
| **S7 Moments** | `HeldPage.tsx`, `windows/Intercept.tsx`, `CloseDialog.tsx`, `BreakSealDialog.tsx`, `QuietPauseDialog.tsx`, the intercept window size in `src-tauri` (`tauri.conf.json`, `engine.rs` `show_intercept`) | <ul><li>Held collapsed to a headline, a fact line and two actions, with "Add a note" behind.</li><li>The GSAP held build, and the broken drain.</li><li>The intercept at 520×360 with its seal ruler.</li><li>The close dialog says when quitting opens.</li></ul> |
| **S8 Small surfaces** | `windows/TrayPanel.tsx`, `windows/CompactTimer.tsx`, `extension/popup.*`, `extension/blocked.*` (except the headline), `partner/src/*` | <ul><li>The tray timer bug fixed.</li><li>The compact timer's held ring.</li><li>The popup and blocked page in the new roles and font.</li><li>The partner site follows the theme, with deny as the primary action.</li></ul> |

**Shared files.** No screen agent edits these: `src/state/store.ts`, `src/lib/native.ts`, `src/styles.css`, `src/theme/*`, `headlines.ts`. A screen agent that needs a change there asks for it in its report, and the lead makes it between waves. Each screen agent adds its own CHANGELOG lines in a fragment file (`changelog.d/<agent>.md`), which the lead merges into `CHANGELOG.md`. That avoids conflicts.

### Wave 2: verification and integration
| Agent | Does |
|---|---|
| **R1 Visual reviewer** | <ul><li>Screenshots every screen in all four themes from the dev preview and compares each with its canvas artboard.</li><li>Reports mismatches, with a screenshot and the file:line.</li></ul> |
| **R2 Accessibility and contrast** | <ul><li>Runs the contrast tests across all ~80 themes, plus keyboard and focus walks.</li><li>Checks for reduced motion and screen-reader labels.</li><li>Reruns the impeccable audit checklist.</li></ul> |
| **R3 Motion reviewer** | <ul><li>Checks each moment against the motion spec: timings, eases, cleanup on unmount, pausing when hidden.</li><li>Uses Vitest timeline-seek tests and a frame-time check of the aurora.</li></ul> |
| **Lead (me)** | <ul><li>Merges the worktrees.</li><li>Runs `npm test`, `tsc` and `cargo test`, with CI on Windows and macOS.</li><li>Writes the CHANGELOG and adds hardware and live items to `docs/manual-testing.md`.</li><li>Bumps the version.</li><li>Gives you the merge and tag commands.</li></ul> |

**Checkpoint B (you):** every screen in four themes, the R1–R3 reports, and the manual-testing list. You approve the merge to `dev`.

## The brief every agent gets
1. **Inputs:**
   - the decision log, the motion spec and the critique;
   - its canvas artboard(s), exported as source;
   - its owned paths and the files it must not touch.
2. **Rules:**
   - CLAUDE.md (tokens only, no raw hex, Vitest).
   - The graphify rule (`graphify query` before reading code).
   - Never handle secrets, and scan for them before committing.
   - No pushes to `main`.
3. **Done means:**
   - tests and typecheck pass;
   - the new behaviour has tests;
   - screenshots in four themes match the artboard;
   - text passes 4.5:1 and marks 3:1;
   - reduced motion is handled;
   - there's a CHANGELOG fragment;
   - a manual-testing entry exists if hardware or live checks are needed.
4. **Report:**
   - the files changed;
   - what's done, what isn't, and why;
   - requests for shared files;
   - any differences from the artboard and the reason for each.

## Order and rough size
1. **Wave 0:** F1 first, then F2 and F3 in parallel, then F4 and F5. Checkpoint A.
2. **Wave 1:** S1–S8 in parallel, with the lead merging as each finishes.
3. **Wave 2:** R1–R3 in parallel, then integration and Checkpoint B.

About 16 agent runs. Wave 1 is the biggest and runs eight at once, so usage limits may pause it. Agents resume where they stopped, as they did earlier today.

## Risks and how they're handled
- **WebGL in the app's web views** (WebView2 on Windows, WKWebView on macOS). F4 ships a CSS fallback and a test where WebGL is missing. The aurora is also checked on battery.
- **Removing Framer Motion** touches several components. F3 replaces `Glide` and `useRolling` behind the same API first, then removes the package once the tests pass.
- **About 80 themes.** F1's contrast test runs on every theme, so a bad pair fails CI rather than shipping.
- **Extension font size.** Schibsted Grotesk adds about 40 KB, subset to Latin.
- **The partner site is a live, outward-facing change.** S8 builds it, but deploying it needs your separate go-ahead.

## Your decisions before the go-ahead
1. **Branching:** one worktree per agent merged into `feature/redesign`, as above, or everyone working on `dev` in turns?
2. **Version:** call this v0.4.0? It's a visual overhaul.
3. **Catppuccin Frappe Light and Macchiato Light:** rename them, or rebuild them as real light themes? The theme-pair review's recommendation comes before Wave 0.
4. **Checkpoints:** are the two above enough, or do you want a look after each screen?

## Progress

### 2026-11-16: the aurora is removed
You asked for a clean look: the WebGL aurora (F4) added friction. `Aurora.tsx`, `lib/aurora.ts`, their tests and the aurora CSS are deleted. Every screen sits on the flat `bg-app`. No screen agent should add a gradient, glow or moving backdrop. Wave 1 runs **two agents at a time** instead of eight.

### Wave 0: done 2026-11-15
F1 tokens, F2 type, F3 motion, F4 aurora and F5 shell are merged. 592 tests pass and `tsc -b` is clean. CHANGELOG.md has the v0.4.0 (in progress) entry. Lead clean-ups done: SPEC.md headline rule, `@fontsource/instrument-serif` removed, ResizeObserver test stub, open-source notices regenerated (gsap and Schibsted Grotesk in, motion and Instrument Serif out).

**Not done yet**
- **Checkpoint A screenshots** in Aura, Night Owl, Cobalt2 Light and Sanctum Dark. Blocked on Node not being on PATH for the app's preview after the machine's home folder was partly wiped.

**Hand-off to Wave 1** (requests from the Wave 0 agents, by owner)
- **All screen agents:**
  - Delete `outline-none` in your files; the global ring now shows anyway. Where a wrapper draws focus, use `focus-ring-off` plus `focus-ring-within`.
  - Swap `text-[11px] font-medium uppercase tracking-[0.06em] text-faint` for `label`.
  - Move segmented controls to `Segmented` in `src/components/controls.tsx`.
  - Stop using `.page-in` / `.row-in`; the lead then deletes those keyframes in styles.css.
- **S1 Today:** `Home.tsx` uses `homeLine(...)` instead of `homeHeadline` and `<em>`.
- **S2–S4:** Stats, Week and Trackers tablists have no tabpanels, so they move to `Segmented`. Trackers also has radius drift (6 and 8).
- **S5 Journal:**
  - `HEADLINE.journalLocked`, `HEADLINE.journalSetup` and `HEADLINE.journalPrompts` (this replaces the question).
  - The weekday letters are no longer uppercase.
  - `NoteToolbar.tsx`: drop `font-serif` on the italic button.
- **S6 Onboarding:** `<Headline title={ONBOARDING.…}>` at each step. Two titles still read as two sentences until this lands.
- **S7 Moments:**
  - HeldPage uses `HEADLINE.held` and `HEADLINE.broken`, and drops the `<em>` and the uppercase eyebrow.
  - The held page is a solid `bg-sealed` field for now, so its `sealed-on` text stays readable. Rework it as a clean page: either keep the accent field or move to `bg-app` with `text`/`muted`, and check contrast in all four themes.
  - Intercept uses `HEADLINE.stays`, `pauseHeadline` (which replaces "Still want…?"), `HEADLINE.waits`, `welcome()` and `PARK_LINES`.
  - BreakSealDialog uses `HEADLINE.partnerDenied` and `partnerExpired`. QuietPauseDialog uses `HEADLINE.quietPause`.
- **S8 Small surfaces:**
  - The partner site's notices and LegalPage credit Schibsted Grotesk (SIL OFL), not Instrument Serif.
- **Lead:**
  - Retire the unused `payoff` colour token.
  - Optionally add the `loop` class to the logo's `.mark-breathe`.
