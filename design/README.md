# Sanctum Design Reference

These are the source files of the Sanctum design mock. Treat them as the visual spec: match layout, spacing, colors, type, and copy. Do not copy them in as runtime code.

## How to read a screen file
Each `screens/*.dc.html` is one screen at 1120 x 720 (desktop window size).
- The markup between `<x-dc>` tags is the layout. All styling is inline `style="..."`, so every size, color, radius, and gap is right there.
- `{{name}}` is a value filled in by the script at the bottom.
- `<sc-for list="{{items}}" as="x">` means "repeat for each item" (a `.map()` in React).
- `<sc-if value="{{cond}}">` means "render only if true".
- The `<script type="text/x-dc">` block holds a small `renderVals()` function with the sample data and computed styles (e.g. selected vs unselected pill styles). Read it for state logic and sample data.
- `<helmet>` holds font imports and a few global styles.
- `support.js` is the mock tool's runtime and is not included. These files will not render on their own.

## Screen map
Screens share components through `<dc-import name="X">`, which mounts `X.dc.html` (e.g. every tab imports `Sidebar`, and the dialogs import `Home` underneath). Build these as real shared React components.

| File | Screen | Spec section |
|---|---|---|
| `Sidebar.dc.html` | App sidebar: mark, state pill, tabs, locked tabs when sealed | 4.0 |
| `Home.dc.html` | Today/Home. Props: `mode` (`idle`, `focus`, `event`). The `accent` prop is left over from picking colors; build cobalt only. Tasks, focus row (profile + duration dropdowns), schedule, progress | 4.0, 4.12 |
| `HomeFocus.dc.html` | Home in the Sealed state, with the locked-tab toast | 4.0 |
| `HomeEvent.dc.html` | Home while a calendar event is happening | 4.0 |
| `Week.dc.html` | Week tab: 7 day columns with streak marks per day; `which` prop shows last or this week | 4.3, 4.10, 4.12 |
| `Month.dc.html` | Month view: streak heatmap, broken and rest days, summary stats | 4.10 |
| `Tracking.dc.html` | Trackers tab: one chart per metric, range toggle, hover, table | 4.13 |
| `Setup.dc.html` | Setup tab: profiles + work types, trackers, check-ins, connections | 4.2, 4.6, 4.13 |
| `Checkin.dc.html` | Scheduled check-in dialog over Home | 4.13 |
| `Blocked.dc.html` | Sealed app intercept dialog over sealed Home | 4.4 |
| `HeldPage.dc.html` | Full-page Sanctum held: mesh gradient, mark build animation, chime (Web Audio code included). Stays until dismissed | 4.0.2 |
| `SiteBlocked.dc.html` | Extension's sealed site page | 4.4 |
| `Onboarding.dc.html` | First run, profiles step | 4.11 |
| `MiniTimer.dc.html` | Compact always-on-top focus timer: cobalt fill shows progress, white time | 4.0.1 |
| `Tray.dc.html` | Tray icon + tray panel (sealed and open via the `mode` prop) | 4.0.1 |
| `CloseDialog.dc.html` | Close: minimize to tray or quit, with sealed rules | 4.0.1 |
| `Brand.dc.html` | Brand + UI system v2: colors, states, type scale, rules | 8 |
| `Mark.dc.html` | **Final mark: torii keyhole.** Sizes, app icon, tray, lockup, versions. SVG files in `design/logo/` | 8 |
| `LogoMotion.dc.html` | Boot splash, held, and sealed pulse animations for the mark (CSS keyframes included) | 4.0.2 |
| `Accent.dc.html` | Accent options explored. **Cobalt chosen** | 4.0.2 |
| `Unlock.dc.html` | Break the seal ladder with partner approval: waiting / approved / denied (`status` prop) | 4.5 |
| `PartnerApprove.dc.html` | Partner's web approval page (PIN confirm) + the Brevo email | 4.5, 4.6 |

Older screens from v1 of the design are in `design/_archive/` for history only. Do not build from them.

## Tokens
`tokens.css` and `tokens.json` hold the colors and fonts. Wire them into Tailwind (`theme.extend.colors` / `fontFamily`) so components use names, not raw hex.

## Headline rule
Only for moments (Home headline, sealed dialogs, held dialog, onboarding titles): one plain sentence in **Schibsted Grotesk 700**, tight tracking (-0.03em), in one weight and one colour (`text`). No italic payoff, no accented word or phrase, no question. Examples: `Your word is the plan.`, `Sanctum held.`, `Discord stays sealed.`. Every headline string lives in `src/pages/headlines.ts` (the extension's `blocked.js` mirrors its lines). The day's fact goes in plain text under the headline ("1h 18m left to reach today's 2 hours"), never in the headline. Decided 2026-11-15 in `docs/decisions/2026-11-15-second-colour-and-headlines.md`; the Instrument Serif payoffs in the older `screens/*.dc.html` mocks are superseded.

Interface text stays **Geist**; numbers and timers stay **Geist Mono**. Page titles are plain Geist 600 at 20px.

**Labels** (field labels, group headers, list headers) are sentence case, never all caps: Geist 500 at 12px in `muted` (the `.label` class). No `uppercase`, no wide tracking, no `faint` for text that must be read.
