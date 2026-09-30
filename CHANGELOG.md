# Changelog

## M5 (complete): onboarding and streak marks (2026-09-29)

### Added
- **First-run setup** (Onboarding.dc.html, SPEC 4.11). It opens on a fresh install (no profiles and never finished), and Setup > Preferences > **Run setup again** reopens it. Six steps:
  1. Welcome: your name for Home.
  2. Profiles: work types per profile, with a live list of what opens and what's sealed. A profile with nothing picked is skipped.
  3. Goals: daily focus goal, idle threshold, and rest days.
  4. Calendar: connect Google (skippable).
  5. Browser: extension status with load-unpacked steps, plus Always open (skippable).
  6. Ready: a summary, then **Start using Sanctum**.

  Installs that already have profiles count as set up.
- **Streak marks in Week** (Week.dc.html): Kept, Broken with the time, Missed, Rest day, or In progress under each day.
- **Streak dots in Month.**

### Changed
- Tests: 143 frontend.

## M5 (part 1): Stats and streaks (2026-09-29)

### Added
- **Stats tab** (Ctrl 3; Trackers moves to Ctrl 4). Week or Month, with previous, This week or month, and next. Its summary row shows the current streak, longest streak, days kept, seals broken, and focus time.
  - **Week:** a bar per day against a dashed goal line. Kept bars are cobalt, today is outlined, and missed, broken, and rest days are marked.
  - **Month:** a heatmap after Month.dc.html. Kept days are shaded by focus against the goal, broken days outlined red, missed days flagged, and rest days dashed. Hover any day for details.
  - **What tempted you:** blocked attempts in the range, with the top apps, sites, keywords, and new-app launches.
  - **Where time went:** productive, neutral, distracting, and idle time from the activity tracker.
- **Streaks under the new rule** (`src-tauri/src/stats.rs`, SPEC 4.10 updated).
  - A day is kept when focus reaches the daily goal and no seal broke.
  - A missed goal or a broken seal resets the streak.
  - Planned rest days never break it and count toward it.
  - Today never breaks it while in progress, and a running session counts toward today.
  - Days start at the daily reset time.
- **Home's streak chip is live:** the current streak plus the last 7 days as marks. Click it to open Stats.
- **Setup > Preferences:** a Daily focus goal (30 min to 5 h) and Rest days (weekday toggles).

### Changed
- Tests: 140 frontend and 68 Rust.

## Allowlist mode, safer (2026-09-29)

### Changed
- **Allowlist mode only stops new launches.**
  - Apps already running when you enter focus stay open, and so do the windows and processes they start later: a dev build run from your editor's terminal, a browser's new window.
  - A new app opened from Start, the taskbar, or the desktop that isn't in the profile's launch set or Always open closes as it opens. The overlay shows it, and it counts as an attempt.
  - Apps sealed by name still close, running or not.
- **Always open** (Setup > Preferences) is one list for every profile, shown as chips with Add app. It replaces the Always allowed text field.
  - It starts with Claude, Spotify, Comet, Chrome, Edge, Brave, Firefox, Windows Terminal, Snipping Tool, Lightshot, ShareX, PowerShell, Command Prompt, Docker Desktop, Notepad, Calculator, 1Password, and Bitwarden, and keeps anything you had there.
  - New defaults arrive in batches, each added once, so a later batch reaches existing installs without bringing back anything you removed.
  - These can always start in allowlist mode.
- In allowlist mode the Seals list is no longer dimmed, since those seals still apply.

### Fixed
- Allowlist mode could close Sanctum itself when it ran from a terminal or editor. Sanctum's own process and everything that runs it (in dev: the terminal, npm, cargo) are never touched.
- Tests: 129 frontend and 65 Rust.

## 4b: browser extension (2026-09-29)

### Added
- **Sanctum's Chromium extension** (`extension/`, Manifest V3, pinned ID `iiapijigajhpjklfkokmjobdfconijag`).
  - While sealed it blocks the profile's sites and their subdomains with `declarativeNetRequest`, and moves tabs that are already open to a packaged blocked page (SiteBlocked.dc.html) with the seal's countdown.
  - Title keywords also block tabs whose path or title matches them.
  - When the seal ends, the page says "You're open again."
- **Allow exceptions.** Each sealed site in a profile's Seals panel gets **Allow a page**, for a subdomain or path that stays open, such as `youtube.com/@mitocw` (migration `0007_browser`, table `site_exceptions`).
- **Native messaging bridge** (`src-tauri/src/bridge.rs`, `browser.rs`).
  - At startup Sanctum copies itself to `sanctum-bridge.exe` in app data and registers it per-user, with no admin, for Comet, Chrome, Edge, and Brave.
  - The browser starts that copy, which relays to the running Sanctum over a localhost socket guarded by a token file.
  - Rules go out when a seal starts, resumes, or ends.
- **Sites blocked in the browser count as attempts** (kind `site`, with only the site or keyword recorded).
- **Missing extension mid-seal.** If a browser that has had the extension runs without it for 5 seconds during a seal with sites or keywords, the gap is logged once as an attempt (kind `extension`). That browser's windows stay minimized until the extension is back.
- **Activity knows the real site.** The extension reports the focused tab's domain (never the URL or title), so browser time is classified by site rules even when the title doesn't name the site.
- **Setup > Browser extension** lists each installed browser with its status (connected and version, not loaded, not allowed in private windows, or running without it). It also gives load-unpacked steps with the folder path, Copy path, and Open folder.

### Fixed
- A crash at launch when the compact timer's window moved before setup finished.

### Changed
- Tests: 127 frontend (extension matching, site exceptions, the Browser extension section) and 63 Rust (rules message, native message framing, site exceptions).

## 4d (complete): quick add and Month (2026-09-29)

### Added
- **Quick add popover.** Clicking any add field (Home's "Add a task for today", Week's per-day **Add**, List's To-do rows) opens a popover over it with the text box and quick picks:
  - Repeat (Once, Daily, Weekdays, Every <day>, then weekday toggles)
  - Day (Today, Tomorrow, the next five days, or the column's day)
  - Time, Length, and Profile
  - A live preview ("Mock interview · Once · Thu, Oct 1 · 3:00 PM · 90 min · Interview Prep").
  Enter adds and keeps it open, cleared, for the next one; Esc or clicking away closes it. A repeat makes a routine instead of a one-time item.
- **Typed quick add** (`src/lib/quickAdd.ts`) fills the same picks. It reads:
  - Days: today, tomorrow, thu, next thu, 10/3
  - Times: 3pm, 3:30pm, 15:00, noon, "at 3"
  - Lengths: 90m, 1.5h, 1h30, "for 45 min"
  - Profiles: @interview (prefix match)
  - Repeats: daily, weekdays, weekends, "every mon wed and fri"
  Anything it doesn't understand stays in the title, and a clicked pick wins over typed text.
- **Month view.** The month as a Monday-first grid with previous / This month / next. Each day shows its routines done/total (a plain count for future days) and its first three items and events, then "+N more". Clicking a day opens that week. Streak marks join at M5.

### Changed
- The inline "+ Add" card in Week is replaced by the quick-add popover. **New** now works in Month too.
- Tests: 119 frontend (quick add parsing, the popover's picks, override, and routine path, the month grid, and Month navigation).

## 4c: Google Calendar (2026-09-29)

### Added
- **Connect Google Calendar in Setup > Connections.** Sign-in opens your browser (loopback redirect on 127.0.0.1 with PKCE). The refresh token is stored in Windows Credential Manager, never in SQLite. The OAuth client is compiled in from the gitignored `src-tauri/.env`. The row shows the account, the last sync, and Reconnect when Google's sign-in expires.
- **Sanctum's own calendar.** On first connect Sanctum creates a "Sanctum" calendar in your time zone, or reuses the one a previous connection made. It then pushes routines (one recurring series each, weekly RRULE) and timed items dated today onward. Anytime and paused routines and untimed items stay local.
- **Two-way sync** (migration `0006_gcal`, `src-tauri/src/gcal/`).
  - Local edits queue in an outbox and go up right away, or on reconnect when offline.
  - Checking an item, or one day of a routine, prefixes that event (or occurrence) with ✓.
  - Edits made in Google come back through an incremental sync token: renames, moves, weekday changes, ✓, and deletes. A pending local edit wins.
  - Syncs run every 2 minutes, after local edits, and when the window regains focus.
- **Choose which calendars show** (main and Sanctum's are on by default). Their events are cached for last week through six weeks out, and for any other week you browse to.
- **Events in Week, List, and Home's Schedule** as teal cards (cobalt when tagged `#focus`), with all-day and multi-day events on each day they cover. The Week legend shows "Synced with Google Calendar", or a link to connect or reconnect.
- **Events are editable from Week:** title, date, time or all day, length, and focus profile (written into the title as `#focus:<profile>`). Delete asks once more, and Open in Google links to the event. Read-only calendars open as a summary. Recurring events are edited one occurrence at a time.
- **New item > Save to** puts a new one-time item straight onto one of your calendars as an event, instead of a Sanctum to-do.
- **`#focus` events drive the focus row** like profile-linked routines: they get the suggested card and the Enter / Skip prompt at their start. A bare `#focus` uses the profile picked on Home; a calendar named "Focus" counts too.
- **In event state from the calendar.** A timed event with at least one other person switches Home to In event, with the real title, time left, Open in Google, and **Queue focus at <end>**. When the meeting ends, Sanctum returns to open and starts the queued focus.
- Dev: the mock backend has a fake Google account, and `__sanctumMock.meetingNow(minutes, title)` starts a meeting.

### Focus row review (same day)
- The wheels show the selected value with half of each neighbor above and below (80px window).
- **Enter focus** is right-aligned (the wheels on the left, the button on the right) and as tall as the wheel boxes. Its 18px label sits at the exact vertical center, with the shortcut hanging just under it.
- The **"No focus block on your schedule"** card can be dismissed (×). Customize > "Empty schedule hint" brings it back; a real block always shows.
- Dev: editing a state module (`store`, `planner`, `calendar`) now reloads the page instead of hot-swapping it, which had left the UI reading an empty copy of the state. Its note ("Opens nothing · seals 1", or "Discord closes when you enter") sits above it in the same label style as Profile and Length.

### Notes
- While the Google app is in Testing, Google expires the sign-in every 7 days and Setup asks you to reconnect. Publishing the app (with Google's verification) is scheduled for M13.
- Tests: 108 frontend (15 new: tags, agenda placement, meetings, Setup connect/disconnect/remove, Week events and editing, In event and queued focus) and 59 Rust (13 new: PKCE, redirect parsing, RRULE round trips, outbox, backfill, event bodies, applying Google edits, the event cache).

## 4d (local half): Today + Week, routines, schedule-driven focus (2026-09-29)

### Added
- **Routines and one-time items in SQLite** (migration `0005_planner`, `planner.rs`).
  - Routines are the spec's `daily_goals`, extended with weekdays, an optional time, a length, and a profile. Checking one off marks only that day (`daily_goal_checks`).
  - One-time items are `todos` on a date, now linkable to a profile.
  - Everything is validated in Rust (names, times, dates, 5-480 min lengths, at least one weekday).
- **Week tab** (from `Week.dc.html`): 7 day columns (Monday first) with previous / This week / next and **+ New**.
  - Each day has an inline **+ Add** card for one-time items; time, length, and profile are optional behind one link.
  - Routine cards carry ↻ and a tinted edge; focus-linked items carry a cobalt edge. Clicking an item opens its editor.
  - Today's column is highlighted.
- **Routines view** (Week | Month | Routines): every recurring item in one list, with days ("Mon Wed Fri", "Weekdays", "Every day"), time, length, profile, and an active switch. **New routine** opens a distinct editor with weekday chips and Every day / Weekdays / Weekends presets. One-time and recurring items are created in visibly different places (SPEC 4.12).
- **Home Today list and Schedule use real data.** Today's routines and items are sorted by time, with profile tags and ↻, and adding from Home creates a one-time item for today. During a seal, the item it belongs to is marked **Now**. Schedule shows today's timed items, with the current one highlighted.
- **The day rolls over at the daily reset time** (4:00 AM by default), so late nights count as the day you started.
- **Schedule-driven focus row.**
  - A **suggested card** shows the block happening now or coming next (NOW / NEXT, title, time, profile, length), with **Use** to apply it.
  - During a profile-linked block, the row pre-fills that profile and the time left, rounded to 30/60/90/120.
  - A prompt at the block's start says "Interview Prep starts now." with Enter focus / Skip.
  - Your manual picks stick for the rest of that block.
- **Focus row redesign:** two vertical **snap wheels** (Profile, Length). A mouse-wheel notch moves one step, drag glides and locks onto the nearest value, and arrow keys and clicks work too. Changes from the schedule scroll into place. **Enter focus** is a 74px target.
- **Home panels** collapse to their header (remembered), and a **Customize** menu shows or hides Today list, Schedule, Focus today, and Streak. With the side panels hidden, the Today list takes the full width.
- Thin dark scrollbars app-wide, replacing Windows' bright default ones.
- Dev builds seed the sample routines from `Home.dc.html` once.

### Review fixes (same day)
- **Enter focus** is a calm 44px button (208px wide) centered exactly on the wheels, with its note ("Discord closes when you enter.") in muted text above. An earlier full-height version read as too loud.
- **The Week tab reopens on the last view used** (`week_view`).
- **Week header is stable:** the title and week navigation are on the left, and **New** and the view tabs (Week | List | Month | Routines) stay pinned on the right. New adapts to the view (a one-time item, or a routine).
- **Hover focus in Week:** the day under the pointer (or being added to) widens and the others dim, with an animated width.
- **List view**, modeled on the user's weekly agenda page. Days flow in two columns, Monday to Thursday then Friday to Sunday. Each day heading has its one-time items as checkboxes, a "To-do" row for quick add, then a **Repeat** group with that day's routines. Today is marked.
- **Pending** (in List view): unfinished one-time items from the last 60 days. Checking one off clears it.

### Decisions made in this slice (review)
- **Month tab:** a placeholder until streaks (M5).
- **Blocks without a length** count as 60 minutes for suggestions.
- **Look-ahead:** "Next" looks up to 12 hours ahead, into tomorrow.
- **Google Calendar sync** for timed items comes with 4c. Untimed items stay local by decision.
- **The browser extension (4b) is paused** while this slice took priority.

## Shell: collapsible sidebar (2026-09-29)
- The sidebar collapses to a 60px icon rail with the panel button or Ctrl B, and the choice is remembered (`sidebar_collapsed`). Collapsed, tab labels move to tooltips ("Week (Ctrl 2)", or "Week is locked while you're sealed"), the state pill becomes its dot (tooltip "Sealed · 42:00"), and locked tabs keep a small lock. Width animates with the shared motion tokens. New `sidebar-rail` size token. SPEC 4.0 updated.

## Milestone 4: Activity + idle tracking (2026-09-29)

### Added
- **Activity tracker** (`activity.rs`). Every 2s it records the foreground app and window title, whenever Sanctum runs, into local SQLite.
  - Consecutive samples of the same window extend one row.
  - After a sleep or long gap it starts a new row instead of stretching the old one across the gap.
  - Rows made during a seal are tagged with the session.
  - Raw activity older than the retention window (30 days by default) is deleted on startup and every hour.
- **Idle detection** via `GetLastInputInfo`, 3 minutes by default. Idle counts from your *last input*, so the threshold minutes are idle too, and the open row is trimmed back to that point. Apps in "Counts as present" (Zoom, Teams, Webex by default) never go idle while in front. Idle stretches are stored in `idle_periods`.
- **Idle extends the seal** (SPEC 4.8, decided 2026-09-29):
  - While idle, the countdown pauses and the end time moves later. The session bar says "Paused … Idle, the seal extends until you're back", and the compact timer says "Paused while you're away".
  - Idle totals persist, so a restart keeps the extension.
  - "In focus" and the daily focus total exclude idle time.
- **Welcome back.** Returning from idle mid-session shows a corner card: what you were in, how long you were away, and the seal's new end time. It never steals focus, and private titles never show.
- **Classification** (`classify.rs`) into productive / neutral / distracting, checked in this order:
  1. The running session's profile rules.
  2. The rules in Setup.
  3. Any profile's opens (productive) and seals (distracting).
  4. Anything else is neutral.

  Within a layer, app rules beat title and site rules. Site rules match browser titles by site name as a whole word ("YouTube" for `youtube.com`). Names under 3 letters (`x.com`) only match the full domain.
- **Rules seeded from the work-type catalog** (once, editable): what work types open is productive, and what they seal is distracting. Deleting a seeded rule sticks.
- **Private windows are redacted.** InPrivate, incognito, and private browser windows, password managers, and apps in "Private apps" are stored with the title `(private)`. The app name and time still count. Classification uses the real title in memory, but only the redacted one is stored.
- **Setup > Activity** (right column): today's productive / neutral / distracting / idle split, idle threshold, history length, "Counts as present", and "Private apps".
- **Setup > Activity rules:** every rule with its category (a select to change it), a "default" tag on catalog rules, remove on hover, and one input that works out whether you typed an app, a site, or a title keyword.

### Fixed
- **Close dialog** option descriptions ran past the card. The M2 rule that keeps button labels on one line also applied to these multi-line option buttons; they wrap again, and so do the Setup profile rows.
- Setup rows with a wrapped hint overflowed their fixed height. Rows now grow with their content.

### Decisions made in this milestone (review)
- **Sanctum's own window counts as neutral.**
- **Idle during downtime** (Sanctum closed) is a gap, not idle; the M3 downtime rule still applies.
- **Sleep and suspend:** the tracker starts a fresh row after any gap over 10s. Sleep mid-session is still measured by the engine's monotonic clock, so it's covered by the tamper review in M12.

## Milestone 3: Session engine + app blocking (2026-09-29)

### Added
- **Session engine** (`session.rs`, `engine.rs`). Enter focus writes a session row and seals in every build. The end time is fixed in wall-clock time when the session starts, and a monotonic clock measures time while it runs, so changing the system clock can't shorten a seal. State is saved every 10s.
  - **Restarts:** after a restart or crash, the seal resumes with the time left. If Sanctum was down for more than 60s, the session is marked broken but the seal still resumes.
  - **Ended while down:** if the session ended while Sanctum wasn't running, it closes as completed (or broken, if the downtime was too long).
  - Migration `0003_sessions` adds session bookkeeping, a `blocked_attempts` table, and default settings.
- **Blocker** (`blocker.rs`). A `Blocker` trait (`set_rules`, `block_apps`, `check_title`, `block_sites`, `unblock_all`) with a sysinfo/Win32 implementation that checks every 1s.
  - Closes sealed apps, counting one attempt per app per check (Discord's five processes count once).
  - Minimizes windows whose title matches a sealed keyword.
  - Apps in the profile's launch set are never closed, and neither are Windows, the shell, input and accessibility tools, or Sanctum and its WebView2.
  - **Allowlist mode** closes only apps with a visible window, keeps the default browser open when the profile opens URLs, and respects Setup > Always allowed (defaults: 1Password, Bitwarden, KeePassXC).
- **Pre-flight warning.** Before sealing, the focus row lists which open apps will close ("Discord closes when you enter."). It refreshes every 4s and when the window regains focus. Those apps close silently at the start, without counting as attempts.
- **Intercept window** (from `Blocked.dc.html`).
  - An always-on-top overlay: "Discord stays *sealed.*" with time elapsed and left, and the attempt number.
  - "Back to <last app>", which also happens on its own after 5s, or on Enter.
  - "Break the seal" opens Sanctum on the End early dialog.
  - Title keywords get a corner nudge instead ("“shorts” stays sealed.").
- **End early** (a stand-in for the M7 ladder). A reason of at least 50 characters, checked in Rust too, is saved as an unlock attempt, and the session is recorded as `unlocked_early`. The copy follows `Unlock.dc.html`: "Break the seal" / "Never mind, stay sealed".
- **Sanctum held page** (from `HeldPage.dc.html`, pulled forward from M12). A full-page takeover with the mesh gradient and grain, the torii build animation with two rings pulsing from the keyhole, stats (in focus, attempts blocked, today vs. goal), and Replay / Done (Esc) / Enter again (Enter). It stays until dismissed. The mark's geometry comes from `design/logo`, and a test keeps it identical.
- **Sound cues** (Web Audio, all on by default): enter, blocked tick, held chime, seal broken. There's a Sounds toggle in Setup. WebView2 runs with autoplay allowed so the cues play without a click.
- **Compact timer** (from `MiniTimer.dc.html`). Cobalt fills with progress while the ring and text stay white. It shows the countdown and "N min left · until 10:50", shows "Held. Nice." at 100% before the held page opens, and can be dragged; its position is remembered. Double-click or the expand button returns to Sanctum. "Go compact when focus starts" works.
- The **Home session bar** has a live countdown, progress, end time, "N apps sealed · N attempts blocked", and a note when downtime has broken the session. The sidebar pill shows the countdown, and "Focus today" shows real minutes against the daily goal (120 min default).

### Decisions made in this milestone (review)
- **Sites are not blocked yet.** Domain rules are saved but only take effect with the watchdog and extension in M8. The session bar counts only enforced app and keyword rules.
- **Held page stats:** the streak line ("6 days straight") waits for M5 and says "Promise kept." for now. "In focus" is the planned length minus downtime until idle tracking arrives in M4.
- **The held page uses the design's CSS mesh** (blurred animated blobs), not a WebGL library. It matches the mock and needs no dependency.
- **The dev state toggle** still fakes Open/Sealed/Event, but is disabled while a real session runs. Rust refuses to unseal a running session.
- **Elevated apps** (run as administrator) can't be closed without the elevated watchdog (M8). They're skipped silently.

### Fixed
- **App icons** had the Windows shortcut arrow baked in, and a few came out generic, because they were read from the `.lnk` itself. Icons now come from the shortcut's icon location (then its target exe, then the shortcut as a last resort), extracted at 48px so they stay sharp at 150–200% display scaling. Old icons without an alpha channel use their mask instead of rendering as opaque squares. Apps in a profile that aren't installed show a lettered tile and "not installed". `cargo test icon_sheet -- --ignored` renders every icon on the machine into one image for checking.
- **App picker noise.** It listed helper exes and leftovers (`Iediag`, `Acrobatinfo`, Windows accessories, SDK tools, installers, dead shortcuts), and launcher exes instead of the app that actually runs.
  - Dropped the App Paths registry source and skipped the Windows system folders and the Startup folder.
  - Shortcuts whose target no longer exists are skipped, and so are installers, updaters, and anything Sanctum may never close.
  - New **Running now** group: apps with a window open right now, under their real exe and file description. Games started by a launcher (e.g. `leagueclient.exe`) and Store apps can now be sealed.
  - The picker rescans each time it opens.
  - On this machine the list went from 50 to 37, all real apps.
- **Compact timer position:** it opens at the top middle of the primary screen. Dragging it saves an offset from that spot, and it snaps back to top middle if the offset would put it off-screen.
- A slow startup `get_session` reply could overwrite a newer session event (for example, bringing a finished session back as sealed). Replies older than the latest event are now ignored.

## Milestone 2: Profiles + Launcher (2026-09-29)

### Added
- **Profiles in SQLite.** Migration `0002_profiles` adds `profiles.work_types` and `profile_rules.label/path/sort`, plus a unique index so a rule can't be added twice. Rust `profiles.rs` handles create, update, delete, and add/remove rule, normalizing values so blocking can match them directly: exe names lowercase, domains as bare hosts (`https://www.YouTube.com/` becomes `youtube.com`), URLs absolute. Durations must be 30, 60, 90, or 120. Names are unique regardless of case.
- **Setup page** built from `Setup.dc.html`. Profiles list with work-type chips and seal counts, New profile, and Preferences (On login, Close button, Go compact when focus starts) saved to settings.
- **Profile detail view** (designed in-system; there is no mock for it). Name, default duration, allowlist mode, an **Opens** panel (apps + URLs), and a **Seals** panel (apps, sites, title keywords). Typing in the Seals input treats anything that looks like a host as a site and everything else as a title keyword. Also Test launch, and Delete with confirmation.
- **Installed-app picker.** Scans Start menu shortcuts (per-user and all-users) plus the App Paths registry key, skipping uninstallers, system folders, and Store app helpers. Squirrel shortcuts (Discord, Slack) resolve to the real exe. Each app shows its icon, extracted from the shortcut or exe as a PNG. The picker searches, allows several picks in a row, and can rescan.
- **Launcher.** `launch_profile` opens a profile's apps (via the saved shortcut, falling back to the app scan) and URLs (default browser). Apps that are already running get focused instead of opened again. Missing apps are reported. The last working launch path is saved per rule.
- **Home uses real profiles.** The profile dropdown comes from the database, picking a profile applies its default duration, and the note is generated ("Opens LeetCode, NeetCode · seals 8"). With no profiles, Home shows an empty state and Enter focus is disabled.
- **Work-type catalog** (`src/data/catalog.json`) mapping the onboarding work types to real rules. Onboarding (M5) will use it.
- **Hover and motion polish** (from BACKLOG). Shared `Button` (primary, raised, ghost, tint, and quiet variants) with hover, press, disabled, and keyboard-focus states. Row hover on lists and rule panels, one shared motion scale (`duration-ui` 120ms, `duration-enter` 180ms, `ease-ui`), dialogs fade and rise in, toasts rise in. All of it respects `prefers-reduced-motion`.
- General toast for launch results and errors, alongside the locked-tab toast.
- Mock backend (`src/lib/mockBackend.ts`) so `npm run dev` in a browser and the Vitest suite exercise the real UI flows without Tauri.

### Decisions made in this milestone (review)
- **Sample profiles are dev-only test data.** Dev builds seed the four sample profiles once. Release builds start with no profiles; onboarding sets them up. Dev builds now use their own `sanctum-dev.db`, so sample data never reaches a real install.
- **Allowlist mode** means "seal everything this profile does not open". While it's on, the Seals list is dimmed but kept, for when it's turned off. Enforcement arrives with blocking in M3/M8.
- **Enter focus** now opens the launch set in every build. Sealing still happens only in dev builds until the session engine lands (M3).
- **Profile edits are refused while sealed**, in both the store and the Rust commands (SPEC 6). Setup is locked while sealed anyway.
- **Store apps (UWP/MSIX)** such as the Microsoft Store versions of Spotify or WhatsApp aren't in the picker yet, because they have no Start menu shortcut or App Paths entry.
- The catalog drops mock items that aren't real apps or sites ("STAR stories doc", "Resume folder", "PDF reader") and maps "Notes" to Notion.

### Fixed
- The dev seed could run twice under React StrictMode, creating "Interview Prep 2" and so on. It now runs once per page load.

## Milestone 1: Scaffold (2026-09-28)

### Added
- Tauri v2 app with React 19, TypeScript, Vite 8, Tailwind 4, Zustand, and Vitest.
- Design tokens wired into Tailwind from `design/tokens.json` (`tailwind.config.ts` via `src/theme/tokens.ts`): colors (`bg-app`, `text-muted`, `border-sealed-line`, …), fonts (`font-sans`, `font-mono`, `font-serif`), radii (`rounded-control|panel|dialog`), sizes (`h-control`, `h-row`, `w-sidebar`), and type (`text-body`, `text-meta`, `text-moment`). `.headline` and `.page-title` follow the headline rule.
- Geist, Geist Mono, and Instrument Serif bundled locally (Fontsource), so the UI renders the same offline.
- Main window: 1120x720, centered, not resizable, app background. App and tray icons generated from `design/logo/`.
- `tauri-plugin-single-instance` (a second launch focuses the running window) and `tauri-plugin-autostart` (launches with `--autostart`). On login, Sanctum opens Home unless the `on_login` setting is `tray`.
- Local SQLite (`rusqlite`, bundled) at `%APPDATA%\app.sanctum.desktop\sanctum.db`. Migrations are embedded SQL files tracked with `PRAGMA user_version`. `0001_init` creates every table in SPEC 5.1 and seeds default settings. The `db_status` command reports readiness, schema version, and tables.
- App shell: shared `Sidebar` (mark, state pill, four tabs with shortcuts), 2px state rule, and Zustand store with the Open / Sealed / In event states. While sealed, Week, Trackers, and Setup lock and clicking one shows "<Tab> is locked while you're sealed. End focus to open it." Dev builds show a state toggle in the bottom right.
- System tray: right-click menu (Open Sanctum, Enter focus or Compact timer, Quit). Quit is disabled while sealed. Left click toggles a stub tray panel window.
- Close behavior: the window close is intercepted. The first time, the Close dialog offers Minimize to tray or Quit Sanctum, with "Don't ask again" on by default. The choice is saved to the `close_action` setting. While sealed, Quit is disabled, and a saved Quit goes to the tray.
- Stub windows: tray panel (340 wide) and compact timer (300x58, always on top, draggable).
- Placeholder Home: headline per state, focus row with Profile and Duration (30, 60, 90, 120), session bar (sealed), event bar (in event), a local-only task list, and schedule and progress cards. Week, Trackers, and Setup are title-only.
- Tests: tokens (json/css parity, Tailwind wiring, window config, no raw hex in components), state machine (tab locks, toast, Quit disabled when sealed, close resolution), Home per state, and Rust tests for migrations, settings, constraints, and close rules.

### Decisions made in this milestone (review)
- Design colors missing from the tokens (`#4A5266` locked tab, `#1A1F2B` toast, `#3A4155` checkbox border, `#E5484D` broken, scrim, toast and dialog shadows) live in `src/theme/extra.json` until they are added to `design/tokens.json`.
- Timestamps in SQLite are unix milliseconds. Dates are `YYYY-MM-DD` and times are `HH:MM`.
- Autostart is registered on first run in release builds only, so dev builds never touch the Run key.
- Enter focus (button, Ctrl Enter, tray menu) seals only in dev builds until the session engine lands in Milestone 3. End early unseals only in dev builds until the break-the-seal ladder lands in Milestone 7.
- The sidebar footer shows the `display_name` setting (hidden when empty) and the app version.
- Pressing close while sealed with no saved choice still shows the Close dialog (with Quit disabled), matching `CloseDialog.dc.html`. A saved choice goes straight to the tray.
