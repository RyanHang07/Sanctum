# Sanctum working prototype: build contract for every agent

Read these first, in this folder:
- `BRIEF.md`: colours, themes, format rules. Its "five directions" section is history now.
- `C:\Users\ryanh\Documents\GitHub\Sanctum\docs\decisions\2026-11-15-second-colour-and-headlines.md`: the UX decisions. Follow them exactly.
- `project/Today-2.dc.html`, `project/Week-3.dc.html`, `project/Stats-2.dc.html`, `project/Trackers-2.dc.html`: the approved static designs to turn into working screens.
- Format notes beyond BRIEF.md:
  - **Events:** `onClick="{{ fn }}"` (JSX camelCase, a whole-value hole bound to a function from `renderVals()`).
  - **Logic class:** `this.state`, `this.setState`, and React class lifecycle (`componentDidMount`, `componentWillUnmount`), minus `render()`.
  - **Child components:** `<dc-import name="ProtoToday" app="{{app}}" hint-size="100%,800px"></dc-import>` mounts the sibling file `ProtoToday.dc.html`. Every other attribute becomes a prop (kebab→camel). Never self-close it, never use capitalised tags, and don't name a prop `name`.
  - **A child file needs its own `<head>`:** `<meta charset>`, `<title>`, and `<script src="./support.js"></script>`, so it can render alone.
  - **A child's `<helmet>`** (re-run in the importer) contains only the font `<link>` and its `<style>` (keyframes, `body{margin:0}`), and its root sets `font-family` and colour.
  - **Inputs:** `<input>` with `onChange="{{ fn }}"`; read `e.target.value` in the handler.

## Architecture: one shell, four child components
- `project/Prototype.dc.html` (the SHELL) owns all state. It draws the sidebar (from Today-2's sidebar), with links replaced by buttons that switch screens. It shows one screen at a time through `<sc-if>` blocks, each with one child: `<dc-import name="ProtoToday" app="{{app}}" hint-size="100%,800px"></dc-import>`, and likewise `ProtoWeek`, `ProtoStats` and `ProtoTrackers`.
- Each CHILD is `project/ProtoToday.dc.html` and so on. It draws only the main content area (no sidebar), is fluid in width, and has `min-height: 800px`. It reads everything from `this.props.app`, declared in `data-props` as `"app":{"editor":null}`, with `$preview` 1060×800. When `app` is missing (the child rendered alone), it falls back to a local `DEFAULT_APP` copy of the sample state below, with no-op handlers, so it still renders. Children keep only purely local UI state, such as Week's shown week offset or an open log-entry form.
- The shell passes ONE object, `app`, built fresh in `renderVals()`: `{ ...state, t, handlers }`.

## The `app` object
```
app = {
  theme: "Aura",                 // shell has the theme enum tweak (Aura, Night Owl, Cobalt2 Light, Sanctum Dark)
  t: { ...palette },             // the theme's colours (keys as in BRIEF.md: app, sidebar, panel, raised, line, text, text2, muted, sealed, sealedOn, sealedText, sealedTint, sec, secText, secTint, secLine)
  screen: "today",               // today | week | stats | trackers
  today: "2026-11-15",           // Sunday
  goal: 120,                     // minutes a day
  minutes: 42,                   // focused today; grows during a session
  session: null,                 // or { profile: "Interview Prep", length: 60, elapsed: 0 } while running
  justKept: false,               // true on the update when minutes first reach goal (drives the one-time pulse)
  profile: "Interview Prep", length: 60,
  week: [                        // Mon 9 .. Sun 15; status: kept | missed | today | future
    { date: "2026-11-09", label: "Mon", num: 9, minutes: 90, status: "missed" },
    { date: "2026-11-10", label: "Tue", num: 10, minutes: 222, status: "kept" },
    { date: "2026-11-11", label: "Wed", num: 11, minutes: 158, status: "kept" },
    { date: "2026-11-12", label: "Thu", num: 12, minutes: 78, status: "missed" },
    { date: "2026-11-13", label: "Fri", num: 13, minutes: 204, status: "kept" },
    { date: "2026-11-14", label: "Sat", num: 14, minutes: 132, status: "kept" },
    { date: "2026-11-15", label: "Sun", num: 15, minutes: 42, status: "today" }   // minutes mirrors app.minutes; status becomes "kept" at goal
  ],
  streak: 11,                    // becomes 12 when today is kept
  items: [                       // routines and tasks; kind: routine | task | event
    { id: "r1", kind: "routine", title: "LeetCode practice", tag: "Interview Prep", date: "2026-11-15", done: true },
    { id: "r2", kind: "routine", title: "Read 20 pages", date: "2026-11-15", done: false },
    { id: "t1", kind: "task", title: "Send the weekly update", date: "2026-11-15", done: false },
    { id: "e1", kind: "event", title: "Mock interview", time: "15:00", date: "2026-11-10" },
    { id: "t2", kind: "task", title: "Book flights", date: "2026-11-10", done: true },
    { id: "e2", kind: "event", title: "Dentist", time: "10:30", date: "2026-11-11" },
    { id: "t3", kind: "task", title: "Renew passport", date: "2026-11-12", done: false },
    { id: "e3", kind: "event", title: "Climbing", time: "18:00", date: "2026-11-14" },
    { id: "t4", kind: "task", title: "Pay rent", date: "2026-11-13", done: true }
  ],
  trackers: [
    { id: "sleep", name: "Sleep", kind: "number", unit: "h", goal: 8, dir: "up", values: [7.2, 6.8, 8.1, 7.5, 8.0, 6.9, 8.0] },
    { id: "weight", name: "Weight", kind: "number", unit: "lb", goal: 170, dir: "down", values: [171.4, 171.2, 171.0, 171.1, 170.9, 170.8, 170.6] },
    { id: "mood", name: "Mood", kind: "scale", unit: "/ 10", goal: 7, dir: "up", values: [6, 7, 7, 5, 8, 7, 7] },
    { id: "workout", name: "Workout", kind: "yesno", values: [1, 1, 0, 1, 1, 0, 1] }
  ],
  tempted: [ { name: "Discord", kind: "App", n: 9 }, { name: "youtube.com", kind: "Site", n: 6 }, { name: "\u201cshorts\u201d", kind: "Keyword", n: 4 }, { name: "Steam", kind: "App", n: 2 } ],
  // handlers (functions): 
  go(screen), startSession(), stopSession(), toggleItem(id), logTracker(id, value), setProfile(name), setLength(min)
}
```

## Behaviour the shell implements
- `startSession()`: sets `session`, then starts `setInterval` at 1000 ms (one prototype minute per real second; clear it in `componentWillUnmount`). Each tick does `minutes += 1`, `session.elapsed += 1`, and `week[6].minutes = minutes`. When `minutes` first reaches `goal`, it sets `justKept: true`, `week[6].status = "kept"` and `streak = 12`, then clears `justKept` 1600 ms later. The session ends itself when `elapsed` reaches `length`.
- `stopSession()`: clears the interval and sets `session: null`.
- `toggleItem(id)`: flips `done` on a routine or task. Events don't toggle.
- `logTracker(id, value)`: replaces today's (last) value.
- `go(screen)`: switches the visible screen. The sidebar highlights it, with the active icon in `sec`.

## Motion (children) – use `<helmet><style>` keyframes and CSS transitions
- The ruler needle and fill: `transition: left 400ms cubic-bezier(.2,.7,.2,1), width 400ms …`, positioned by a percentage computed in `renderVals()`.
- The minutes figure rolls up: render the number in a span with a `key`-free approach. A CSS animation `roll` (translateY 40%→0, opacity .3→1, 300 ms) re-triggers when the value changes; switch an alternating class name (`roll-a`/`roll-b`) by parity of minutes, so each change restarts the animation.
- A major tick brightens briefly when crossed: give the most recently crossed major tick a class with a 600 ms brighten animation (again parity-switched).
- Goal reached (`app.justKept`): the goal tick pulses once (box-shadow glow in `sec`, 1.2 s), and today's cell in the days strip fades its glow in.
- Kept days glow: `box-shadow: 0 0 0 1px secLine, 0 0 12px -2px sec` at about 60% strength on dark themes and 35% on light themes (use 8-digit hex alpha on `sec`).
- Everything respects `@media (prefers-reduced-motion: reduce)` (no animations; transitions become instant).
- During a session, Today shows a live state: the Enter focus button becomes "Stop" (outline), and the focus card shows "Sealed · 12 of 60 min" with an accent progress line. Keep it calm.

## Rules
- Format rules from BRIEF.md and format.md. Events are camelCase attributes bound to functions from `renderVals()`, such as `onClick="{{ item.toggle }}"`. Build per-item handlers in `renderVals()`, for example `items.map(i => ({ ...i, toggle: () => app.toggleItem(i.id) }))`.
- Headline font: Schibsted Grotesk 700 (Google Fonts: `family=Schibsted+Grotesk:wght@600;700;800`) on `h1`/`h2`. Interface text: Geist. Numbers: Geist Mono.
- Write ONLY your own file(s). Never touch `canvas.json` or anyone else's files. Don't publish. Don't render, screenshot or open anything.
- Done items: an accent ticked box, and muted, struck-through text. Past days' unfinished items: a hollow box and dimmed text.
- Report the file name(s) and a short list of what works.
