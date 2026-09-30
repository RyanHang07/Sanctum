# Sanctum: Focus Hub + Distraction Blocker (Spec v0.9)

> App name: **Sanctum**. A protected inner room for focused work. This file is the source of truth for Claude Code. Build milestone by milestone, and ask before deviating from decisions marked **Decided**.

## 1. Overview

A Windows-first desktop app that acts as a central hub for productivity while blocking outside distractions. Built first for interview prep (LeetCode, system design, mock interviews, applications) but general enough for any deep work. It boots on login, sits centered on screen, launches my work setup in one click, blocks distracting apps and sites during focus sessions, and makes bypassing a session genuinely hard through escalating friction. It knows what I've been doing (window titles, idle time) and shows it in a stats dashboard with streaks.

The accountability partner (a friend who holds the unlock PIN) is **optional**. The app must be fully usable solo, with the partner feature available to anyone who wants the extra rigor.

### Goals
- Make bypassing a session genuinely hard, not just annoying
- One click from "sitting down" to "working"
- Honest picture of how time was actually spent
- Optional social accountability through a friend who holds the unlock PIN

### Non-goals (v1)
- macOS/Linux (design for it, don't build it)
- Mobile app
- Monetary stakes / payments
- Team or group features
- Notion import or sync (Sanctum replaces it)

## 2. Tech Stack (**Decided** unless noted)

| Layer | Choice |
|---|---|
| Desktop shell | Tauri v2 |
| Frontend | React + TypeScript + Vite + Tailwind |
| Frontend state | Zustand |
| Frontend tests | Vitest |
| Native backend | Rust |
| Local DB | SQLite via `rusqlite` (raw activity data never leaves the machine) |
| Cloud backend | Supabase (Auth, Postgres, Realtime, Edge Functions) |
| Partner web app | Small React + Vite page on Vercel, backed by the same Supabase project |
| Partner email | Brevo transactional email, sent from Supabase Edge Functions |
| Browser extension | Chrome/Edge, Manifest V3 |
| Secrets on device | Windows Credential Manager via `keyring` crate |

### Key Rust crates
- `sysinfo`: process enumeration and killing
- `windows`: `GetForegroundWindow`, `GetWindowTextW`, `GetWindowThreadProcessId`, `GetLastInputInfo`
- `windows-service`: tamper-resistance watchdog service
- `tauri-plugin-autostart`, `tauri-plugin-single-instance`, `tauri-plugin-opener`, `tauri-plugin-deep-link`
- `argon2` is NOT used client-side; PIN hashing happens in a Supabase Edge Function

## 3. Architecture

```
+---------------------------+        +-------------------------+
|  Tauri Desktop App        |        |  Supabase               |
|  React UI                 | <----> |  Auth (Google)          |
|  Rust core:               |  HTTPS |  Postgres (summaries,   |
|   - Blocker (trait)       | + RT   |   partners, requests)   |
|   - ActivityTracker       |        |  Realtime (approvals)   |
|   - IdleDetector          |        |  Edge Functions (PIN)   |
|   - SessionEngine         |        +-----------+-------------+
|   - Local SQLite          |                    ^
+-----+--------------+------+                    |
      |              |                +----------+------------+
      | native msg   | IPC            |  Partner Web App      |
      v              v                |  set PIN, approve/deny|
+-----------+  +-----------------+    +-----------------------+
| Browser   |  | Watchdog Service|
| Extension |  | (elevated)      |
+-----------+  +-----------------+
```

- **Blocker trait** keeps OS-specific code isolated: `trait Blocker { fn block_apps(..); fn block_sites(..); fn unblock_all(); }` with `WindowsBlocker` implemented now.
- **Extension to app** communication via Chrome Native Messaging.
- **Watchdog service** runs elevated, owns the hosts file edits, and relaunches the app if killed during a session.

## 4. Features

### 4.0 App shell, Home, and states (**Decided**, overrides older screen notes below)
- **Shell:** left sidebar (220px, collapsible to a 60px icon rail with Ctrl B, remembered; **Decided** 2026-09-29) with the mark, a state pill, and four tabs: **Today** (Home), **Week**, **Trackers**, **Setup**. Each tab has a shortcut (Ctrl 1, 2, 3, Ctrl ,). A command bar opens with Ctrl K
- **Home = Today.** Daily goals and focus are one screen:
  - Day-only task list: add (Enter), check off, repeating daily items reset each morning. Tasks can carry a profile tag and a time
  - Focus row on one line: **Profile** dropdown, **Duration** dropdown (30, 60, 90, 120 min; 30 is the minimum), a one-line note of what opens/seals, and **Enter focus** (Ctrl Enter)
  - Right column: today's schedule from Google Calendar and today's focus progress + next check-in
  - The Week tab holds everything beyond today
- **App states** (single source of truth in the store, shown in the sidebar pill and a 2px top rule):
  - **Open** (gray): nothing running, all tabs reachable
  - **Sealed** (blue): focus session running. Home swaps the focus row for a session bar (timer, progress, sealed count, End early). The current task is highlighted as "Now". Week, Trackers, and Setup are **locked**; clicking one shows a toast: "Week is locked while you're sealed. End focus to open it." Tasks on Home can still be checked off
  - **In event** (teal): a Google Calendar event is happening now. Home shows the event bar (time left, Open notes, Queue focus at end). Enter focus is held until the event ends unless queued
- Home headline changes by state: Open "Keep your promises. *Or stay mid.*", Sealed "You're sealed in. *Finish what you started.*", In event "<Event> until <time>. *Be all the way there.*"
- Check-ins, the held screen, and sealed-app intercepts appear as dialogs over the current screen, never as separate pages

### 4.0.1 Tray, close behavior, and compact timer (**Decided**)
- **System tray icon** (Tauri `tray-icon` feature). The icon is the Arch mark; a small blue dot appears on it while sealed
  - Left click toggles a **tray panel**: a small frameless window (340px wide) anchored above the tray. Shows the state pill, the timer + progress and Compact / Open Sanctum when sealed, or the Profile + Duration dropdowns and Enter focus when open, the next 3 tasks for today (checkable), an add-task row, and the next check-in. Footer: Break the seal (sealed) or Quit Sanctum (open). Hides on blur
  - Right click opens a native menu: Open Sanctum, Enter focus / Compact timer, Quit
- **Close button:** intercept the window close request
  - First time: show the Close dialog with two choices, **Minimize to tray** (keeps blocking, check-ins, and calendar sync running) or **Quit Sanctum**, plus "Don't ask again" (on by default)
  - The saved choice lives in Setup > Window > Close button and can be changed there
  - While sealed, Quit is disabled in the dialog and the tray; close always goes to the tray. Quitting while sealed is only possible through the break-the-seal ladder
- **Compact focus mode** (toggle with Ctrl M, the Compact button on Home, or the tray panel):
  - Hides the main window and shows a separate small frameless, always-on-top, draggable window (300x58, radius 12). Position is remembered. Double-click or the expand button returns to the full window
  - Contents: progress ring, profile name, minutes left + end time, and the countdown in Geist Mono
  - **Fill shows progress:** the timer background fills left to right with solid cobalt `#2F5BFF` up to p (0 to 1) over the dark panel. The countdown, label, and progress ring are **white** so they read on both the filled and unfilled parts. Border `#1F3482`
  - At 100% it shows "Held." then opens the Session held dialog in the main window
  - Setup > Window > "Go compact when focus starts" (off by default)

### 4.0.2 Sanctum held page, logo motion, sound (**Decided**)
- **Sanctum held** is a full-page takeover of the main window (not a dialog): animated **mesh gradient** background (WebGL/canvas mesh gradient lib, Stripe-style) with a subtle grain, the logo draw animation, "Sanctum *held.*", session stats, and Replay / Done (Esc) / Enter again (Enter). It **stays until dismissed**. Gradient colors follow the chosen accent palette
- **Logo motion** (SVG + CSS, respects prefers-reduced-motion):
  - Boot splash (~2.2s): arch strokes on, baseline draws, dot drops in, wordmark settles
  - Held (~2.9s): same draw + two rings pulse out from the dot, timed with the chime
  - Sealed idle pulse (3.2s loop): only the dot breathes, in the sidebar mark and tray icon
- **Sound: all cues on by default** (enter, blocked tick, held chime, seal broken). Toggle in Setup > Preferences
- **Accent color: Cobalt `#2F5BFF` (Decided).** Chosen to read as discipline. White text on cobalt fills; use `#7A95FF` when cobalt is the text color on dark (contrast). Everything references the `sealed` tokens so it stays a one-line swap

### 4.0.3 Offline and time integrity (**Decided**)
- Blocking, sessions, streaks, trackers, and check-ins all run locally and work fully offline
- **Offline indicator:** a subtle "Offline" tag in the sidebar state pill and the tray panel. Nothing else changes
- **Break the seal while offline:** partner approval can't be reached, so level 3 falls back to the solo 30 min cooldown
- **Google Calendar offline:** edits queue locally and sync on reconnect; last edit wins on conflicts
- **Clock changes:** session timers use a monotonic clock. If the Windows system clock jumps (forward or back) during a session, treat it as tampering: the seal breaks, the streak resets, and the partner is notified

### 4.0.4 Release, startup, extension, uninstall (**Decided**)
- **v1 is a public release.** Ship a signed Windows installer (Tauri bundler, NSIS), code-signed with an OV/EV certificate so SmartScreen doesn't block it, and auto-updates via `tauri-plugin-updater` with signed update manifests hosted on GitHub Releases. Add a crash/error reporter and an opt-in, anonymous usage ping only
- **On login:** open the centered Home window by default. Setup > Preferences > On login: Open Home / Start in tray
- **Browser extension:** Chromium only for v1 (Chrome, Edge, Brave, Arc, Opera from one Manifest V3 build). Publish to the Chrome Web Store and Edge Add-ons. No Firefox yet
- **Uninstall during a session = tamper.** If the watchdog sees the app, the watchdog service, or the extension being removed or disabled while sealed, the seal breaks, the streak resets, and the partner is notified. The extension heartbeats to the app every 30s; a missed heartbeat while sealed counts as disabled

### 4.1 Startup + Window
- Autostart on login (`tauri-plugin-autostart`), single instance only
- Main window centered, fixed size, non-resizable
- During a session: optional fullscreen always-on-top "sealed" overlay showing current block, timer, and next calendar event. Can be minimized to a small centered pill but not closed

### 4.2 Profiles + Launcher
- Profile = name, block list (apps by exe name, domains, title keywords), allowlist mode toggle, launch set (apps + URLs), default duration
- "Start" opens everything in the launch set and begins the session
- Seed profiles: Interview Prep (launches LeetCode/NeetCode, notes, IDE; blocks social + video), Deep Work, Study, Light Work

### 4.3 Google Calendar
- OAuth via loopback redirect + PKCE, scope `calendar.events` (read + write)
- Tokens stored in Windows Credential Manager
- Events with `#focus` or `#focus:<profile>` in the title, or on a calendar named "Focus", auto-start the matching profile at event start and end at event end
- Main screen shows today's schedule with current block highlighted, plus an add button and an expand button
- Expanded view: week grid where you can create, edit, retag and delete events. Assigning a profile to an event adds the `#focus:<profile>` tag and saves back to Google Calendar
- v2: write completed sessions back as events
- **4c decisions (2026-09-29):**
  - Sanctum writes routines and timed items to **its own "Sanctum" calendar**, which it creates; routines become one recurring series each
  - It **reads calendars you choose** in Setup (your main calendar and Sanctum's are on by default)
  - `#focus` events get the **same Enter / Skip prompt** as profile-linked routines, instead of auto-starting
  - Home's **In event** state triggers only for timed events **with at least one other attendee**
  - OAuth client credentials live in a gitignored `src-tauri/.env` and never in the repo or chat
  - Events on your other calendars are **fully editable** from Week (rename, move, retag, delete, create); this needs the full `calendar` scope
  - Checking off a synced item (or one day of a routine) **prefixes that event's title with ✓**
  - First connect **pushes routines and timed items dated today onward**; past items stay local
  - Disconnect signs out and **keeps the Sanctum calendar**; a separate "Remove Sanctum calendar" button deletes it after confirming
- **How 4c syncs (built 2026-09-29):**
  - Local edits go into an outbox (`gcal_outbox`) and are pushed on the next pass, so offline edits wait and go up on reconnect
  - Edits made in Google on the Sanctum calendar come back through an incremental sync token. A local edit still waiting in the outbox wins; otherwise Google's does. Deleting a synced event in Google deletes the item here
  - Other calendars are read as expanded occurrences over a window (last week through six weeks out, plus any week you browse to) and cached in `gcal_events`
  - Calendar events show in Week, List, and Home's Schedule as teal cards without checkboxes; the Today list stays routines and items
  - A bare `#focus` uses the profile picked on Home; `#focus:<profile>` matches a profile by name ("interview-prep" = "Interview Prep")
  - Paused and anytime routines stay local; turning one off removes its series from Google
- **4b scope (decided 2026-09-29):** Chromium only (Firefox to the backlog); Comet is the browser to test and polish first; while sealed, profile title keywords also block matching tabs (URL path or tab title), even on sites that aren't sealed
- **4b site activity (decided 2026-09-29):** the extension also reports the active tab's domain (never the full URL or title) so Activity classifies sites with the existing site rules
- **4b bridge (built 2026-09-29):** the native messaging host is a copy of sanctum.exe run in relay mode, which talks to the running app over a localhost socket guarded by a token file. A browser that has had the extension and runs without it during a seal with sites or keywords is minimized and logged once. Private windows get a Setup warning for now; closing them is in the backlog.

### 4.4 Blocking
- **Apps:** poll processes every 1s, kill matches. v2: WMI process-start events for instant blocking
- **Sites (baseline):** watchdog service writes a marked block section into `C:\Windows\System32\drivers\etc\hosts` and removes it after the session
- **Sites (precise):** extension uses `declarativeNetRequest` for per-URL rules (e.g. block `youtube.com` but allow `youtube.com/watch?v=<allowed>`)
- **Extension scope:** blocking only. It receives rules from the desktop app via native messaging and never reports page titles, URLs, or history back. Nothing from the extension reaches the partner
- **Title keywords:** if foreground window title matches a blocked keyword, minimize it and show a nudge
- **Allowlist mode:** everything not listed is blocked. Updated 2026-09-29 at your request: it only stops new launches. Apps already running when the seal starts stay, and so does anything they start (a dev build run from your editor). A new app outside the profile's launch set and Setup > Always open closes as it opens. Apps sealed by name still close.
- **Sealed app intercept:** when a sealed app launches, kill it and show a centered overlay: "<App> is sealed.", time left, attempt count this session, primary "Back to <last productive app>", secondary "Break the seal". Auto-returns after 5s
- **Title nudge:** a small corner toast when a window is minimized for a sealed keyword
- **Sealed site page:** the extension shows a full-page "<domain> is sealed." with time left and a link back to the profile's main site. The page records nothing

### 4.5 Escalating Friction + Partner Approval
Early unlock requests climb a ladder. Each level must be completed in order:

| Level | Requirement |
|---|---|
| 1 | Type a reason (min 50 chars) + wait 5 minutes (timer resets if you leave the screen) |
| 2 | Retype a random ~300 char paragraph exactly |
| 3 (with partner) | Partner approval from email. The email links to the partner web page, where the partner confirms with **their** PIN and taps Approve or Deny (optional note back). You never type a PIN |
| 3 (solo) | 30 minute cooldown. No skip, timer resets if the app loses focus |

- Approved unlock is a **grace window** (default 10 min), not the end of the session. Asking again the same session starts at level 2
- Partner approval arrives via Supabase Realtime
- Request expires after 30 min. Denied or expired: the seal stands and the next request unlocks after 15 min
- Partner PIN: 3 wrong tries on the approval page locks approvals for 30 min (enforced server-side)
- An approved exit does NOT break the streak
- **Emergency unlock:** 1 per week, skips the ladder, partner is notified if one is set

### 4.6 Accountability Partner (optional)
- **Exactly one partner** per user. Off by default. Can be enabled during onboarding or any time later in settings (but not during an active session)
- Removing a partner requires that partner's approval, so it can't be used as an escape hatch
- App generates an invite link (`/invite/<token>`, single use, 48h expiry)
- Partner opens link, signs in (Google or magic link), sets a 6+ digit PIN
- PIN is sent to an Edge Function, hashed with argon2id, stored server-side. I can never read it
- Partner web app shows: pending unlock requests (with my reason), approve/deny with PIN confirm, PIN reset
- Partner is notified **by email only** on: unlock requests, emergency unlocks, broken sessions, streak loss. **No weekly summary email**
- Emails sent through Brevo's transactional API from an Edge Function. Brevo API key stored as a Supabase secret, never in the desktop app
- Unlock request emails include a link to the approve/deny page on the Vercel app

### 4.7 Activity Tracking (window titles)
- Every 2s record foreground exe name + window title + duration into local SQLite
- Browser activity is tracked from the browser's window title only (the active tab title shows there). The extension is not used for tracking
- Classify each entry as productive / neutral / distracting using per-profile rules plus a global rules table I can edit
- Raw titles never leave the device. Only daily summaries sync (see 5.2)
- Retention: raw entries auto-deleted after 30 days (configurable)

### 4.8 Idle Detection
- Use `GetLastInputInfo`. Idle after 3 min without input (configurable)
- Idle time pauses the focus timer and is excluded from focus minutes. The seal's end time moves later by the idle time, so a 60 min seal is 60 active minutes (**Decided** 2026-09-29)
- Exception: if foreground app is on a "passive allowed" list (e.g. a video call app), don't mark idle
- Returning from idle shows a quick "welcome back" with what you were doing

### 4.9 Stats Dashboard
- **Decided 2026-09-29:** its own sidebar tab, **Stats**, built with the streaks in M5 (onboarding follows). First cut: focus time by day and week against the goal, attempts and what tempted you, and productive vs distracting time. No design screen exists; it reuses Month.dc.html (heatmap, summary row) and Tracking.dc.html (charts).
- Today / week / month views
- Focus minutes vs idle vs distracted
- Top apps and top sites by time, blocked attempts count
- Session history with outcome (completed / unlocked early / broken)
- Timeline view of the day built from activity entries
- "What have I been up to" summary card: plain-language recap generated locally from the day's data

### 4.10 Streaks + Stakes (**Decided**)
- ~~The streak breaks only when: a seal is broken (ended early without approval, force-quit, tamper), OR a non-rest day passes with no completed session~~
- **Changed 2026-09-29 (your call):** a day is **Kept** only when focus minutes reach the daily goal and no seal was broken that day. A non-rest day that misses the goal, or has a broken seal, breaks the streak. Today counts once it's kept and never breaks the streak while in progress
- **Planned rest days** (chosen in Setup > Preferences, e.g. Saturdays) never break the streak and count toward its length
- Stakes: **streak resets**, and **partner is notified** if one is set
- **Changed 2026-09-29:** a new **Stats** tab holds the full streak, heatmap, and stats (4.9). Home keeps the 7-day chip, which opens Stats. Week and Month day marks come later.
- ~~Streak lives **only on Home**~~ (chip with the last 7 days: kept, broken, rest, today). History: marks under each day in **Week** (Kept / Broken with time / Rest day / In progress) and a **Month** view (heatmap shaded by focus minutes, broken days outlined, rest days dashed, hover for details, summary row: current, longest, kept, broken, focused)
- Broken session = session ended early without completing the friction ladder (e.g. app force-killed, watchdog detected tamper)

### 4.11 Onboarding (first run)
1. Welcome + what the app does
2. Profiles: for each profile, pick its work types (e.g. DSA practice, system design, behavioral prep, mock interviews, applications, coding, writing, reading, email/admin, or custom). Work types generate suggested apps/sites to open and to seal, which the user can edit
3. Set daily focus goal (suggest 120 min) and idle threshold (suggest 3 min). Both editable later in settings
4. Optional: connect Google Calendar
5. Optional: create account + invite an accountability partner
6. Enable autostart (on by default) and install the watchdog service (needs one admin prompt)

Added 2026-09-29 (at M5 these become steps; see BACKLOG "M5 onboarding"):
- **Browser extension:** after profiles, detect installed Chromium browsers. For each one, walk through loading the extension and turning on Allow in Incognito, and show it connect live. Skippable; Setup > Browser extension offers it later.
- **Always open:** show the pre-filled list (Claude, music, browsers, terminals, screenshot tools, Docker, password managers). Offer running apps as one-tap additions, and explain that allowlist mode leaves apps already open alone and only stops new launches.

Accounts are optional. Solo users without an account run fully local. An account is required only for the partner feature and cloud summary sync.

### 4.12 Today + Week data (replaces my Notion page; UI per 4.0)
- No Notion integration. Sanctum replaces it as the daily hub
- **Daily goals:** a repeating checklist that resets every day at a set time (default 4:00 AM). Items can link to a profile ("Work session: SQL + DSA" shows an Enter button that starts Interview Prep)
- **Weekly agenda:** todos grouped by day, plus repeating items (e.g. "Weigh" Mon/Thu, "Evening Filmadi meeting" every weekday)
- **Adding a one-time item and a recurring item are visibly different flows** (**Decided** 2026-09-29): Week holds one-time items (`+ Add` per day, `+ New`); recurring items live in their own **Routines** view (Week | Month | Routines) and appear on each day as ↻ cards. Daily goals are routines that repeat every day
- **Focus row** (**Decided** 2026-09-29): a suggested-session card plus two vertical snap wheels (Profile, Duration) and a large Enter focus. When a profile-linked item is scheduled now, the row pre-fills that profile and the time left in the block (rounded to 30/60/90/120), and a toast at its start offers Enter / Skip. Manual picks stick until the next block
- **Home layout** (**Decided** 2026-09-29): Schedule, Focus today, and the task list collapse to their headers (remembered), and a Customize menu shows or hides each panel
- **Quick add** with natural language: "mock interview thu 3pm" creates a timed todo
  - **Decided 2026-09-29:** clicking any add field (Home's Add a task, Week's per-day Add, List's To-do rows) opens a popover around the input with quick picks for day, time, length, profile, and repeat, plus a live preview of what will be created. Typing understands the same things: "thu", "tomorrow", "10/3", "3pm", "90m", "@interview", "every mon wed", "daily", "weekdays". A repeat makes a routine instead of a one-time item
- **Month view (decided 2026-09-29, built in 4d):** a month grid; each day shows its routines done/total and its first items and events, then "+N". Clicking a day opens that week. Streak marks join at M5
- **Two-way Google Calendar sync for todos:**
  - A todo with a time becomes a Google Calendar event (tagged so Sanctum can recognize it)
  - Calendar events show up on their day (as event cards, not checkable todos; see 4.3)
  - Checking a todo marks it done in both places (event title gets a done marker or extended property); deleting on either side removes it on the other
  - Todos without a time stay local only (**Decided** 2026-09-29: untimed daily and weekly items never go to the calendar)
  - **Repeating items with a time sync as one recurring Google Calendar event** (RRULE), not copies (**Decided** 2026-09-29). Checking one off marks only that day's occurrence; editing the time changes the whole series
  - Sync every 2 min while open, plus on focus and right after a local edit (details in 4.3)
- **Systems strip:** quick cards for Journal, Fitness, LeetCode showing the latest stat

### 4.13 Trackers + scheduled check-ins
- **Trackers** are user-defined in setup: name, unit, type (number, yes/no, scale 1 to 10), display (chart, table, or both), optional goal
- Seeded trackers: Weight (lb) and Body fat (%)
- **Check-in modal:** a centered, always-on-top modal that appears at scheduled times (e.g. 8:00 AM Mon/Thu weigh-in, 9:30 PM daily wrap-up). Each check-in has its own days, time, and list of trackers to ask for. Actions: Log, Snooze 15m, Skip today
- **On startup option:** if a scheduled check-in was missed, it pops up when Sanctum boots
- Check-ins never appear during a sealed session; they queue until it ends
- **Fitness trends page:** one chart per tracker (never two metrics on one axis), range toggle 7D / 30D / 90D / 1Y / All, hover tooltip with date and value, change over range, plus a table view of all entries
- Tracker data stays local (SQLite). It is not synced to Supabase or shown to a partner

## 5. Data Model

### 5.1 Local SQLite
- `profiles(id, name, allowlist_mode, default_minutes, created_at)`
- `profile_rules(id, profile_id, kind[app|domain|title|launch_app|launch_url], value)`
- `sessions(id, profile_id, started_at, ended_at, planned_minutes, outcome, source[manual|calendar])`
- `unlock_attempts(id, session_id, level_reached, reason, approved, created_at)`
- `activity(id, ts, exe, title, duration_s, category, session_id)`
- `idle_periods(id, started_at, ended_at, session_id)`
- `classification_rules(id, match_kind[exe|title|domain], pattern, category)`
- `daily_goals(id, name, sort, profile_id nullable, active)`
- `daily_goal_checks(goal_id, date, done_at)`
- `todos(id, title, due_date, due_time nullable, duration_min, repeat_rule nullable, done_at, gcal_event_id nullable, gcal_etag, updated_at)`
- `trackers(id, name, unit, kind[number|bool|scale], display[chart|table|both], goal nullable)`
- `tracker_entries(id, tracker_id, value, logged_at, source[checkin|manual])`
- `checkins(id, name, time, days_mask, tracker_ids json, include_goal_review bool)`
- `settings(key, value)` (includes `checkin_on_startup`, `daily_reset_time`, `gcal_sync_token`)

### 5.2 Supabase (Postgres, RLS on every table)
- `profiles_user(id = auth.uid, display_name, timezone)`
- `partnerships(id, user_id, partner_id, status, created_at)`
- `invites(token, user_id, expires_at, used_at)`
- `pins(user_id, pin_hash, failed_attempts, locked_until)`  (no client read access, Edge Function only)
- `unlock_requests(id, user_id, reason, level, status[pending|approved|denied|expired], created_at, resolved_at)`
- `daily_summaries(user_id, date, focus_min, idle_min, distracted_min, sessions_completed, sessions_broken, top_categories jsonb)`
- `streaks(user_id, current, longest, last_counted_date)`
- `notifications(id, recipient_id, kind, payload jsonb, read_at)`

## 6. Security + Tamper Resistance
- Watchdog service relaunches the app if its process dies mid-session and logs it as a tamper event (counts as broken session)
- Session state persisted to SQLite every 10s so reboots resume the session
- Settings that loosen blocking (remove rule, shorten session, disable autostart) are locked during active sessions
- PIN verification and lockouts are server-side only
- Supabase keys: publishable key in the app, service role only in Edge Functions

## 7. Milestones (build in order)

1. **Scaffold:** Tauri v2 + React/TS/Tailwind + Zustand + Vitest, SQLite wiring, autostart, single instance, centered window
2. **Profiles + Launcher:** CRUD UI, launch set opens apps/URLs
3. **Session engine + app blocking:** timer, `Blocker` trait, `WindowsBlocker` process killing, session persistence
4. **Activity + idle tracking:** foreground polling, `GetLastInputInfo`, local storage, classification rules
4b. **Browser extension (moved up from 8, decided 2026-09-29):** Chromium MV3 extension with native messaging and per-URL `declarativeNetRequest` blocking; no admin needed
4c. **Google Calendar (moved up from 9, decided 2026-09-29):** OAuth, `#focus` auto-start, schedule view
4d. **Today + Week (moved up from 10, decided 2026-09-29):** daily goals, weekly agenda with repeating items, quick add, two-way Google Calendar sync (4.12)
5. **Stats dashboard + streaks + onboarding flow** (local only, solo mode complete at this point)
6. **Supabase (optional account):** auth, partnerships, invite link, partner web app on Vercel, PIN Edge Function, Brevo emails
7. **Friction ladder + approvals:** levels 1 to 3 (solo cooldown and partner paths), Realtime approvals, emergency unlock
8. **Site blocking:** watchdog service + hosts file (the extension shipped in 4b)
9. ~~Google Calendar~~ (moved to 4c)
10. ~~Today page~~ (moved to 4d)
11. **Trackers + check-ins:** tracker setup, scheduled check-in modal, startup option, fitness trends charts + table
12. **Tray, compact timer, held page, logo motion, tamper hardening + polish** (incl. clock-change and uninstall-as-tamper)
13. **Release:** code-signed NSIS installer, auto-updater, extension on Chrome Web Store + Edge Add-ons, crash reporting

Each milestone should end with passing tests and a short note in `CHANGELOG.md`.

## 8. Design Reference

The full mock lives in the "Sanctum Design" canvas (Home, Calendar, Sealed session, Success, Sealed app/site, Onboarding, Today, Check-in, Fitness, Trackers, Logos, Brand sheet). Match it.

### Color tokens (dark first, v2)
| Token | Hex | Use |
|---|---|---|
| app | `#0B0D12` | window background |
| sidebar | `#0E1016` | sidebar |
| panel | `#12151C` | panels, dialogs |
| raised | `#171B24` | selected rows, inputs |
| line | `#1F2430` | borders |
| line-input | `#2A3040` | input and button borders |
| text | `#E6E9EF` | primary text |
| text-2 | `#B8BFCC` | secondary text |
| muted | `#8A93A6` | labels, meta |
| faint | `#5C6477` | hints, shortcuts |
| sealed | `#2F5BFF` (tint `#172040`, line `#1F3482`, text-on-dark `#7A95FF`, on-fill text `#FFFFFF`) | focus state + primary buttons |
| event | `#5FD4C8` (tint `#10262A`, line `#1F4A4A`) | calendar event state |
| held mesh | `#1F3FD9` / `#2F5BFF` / `#6A4CFF` / `#12A8C9` | Sanctum held page only |

Radius 6 controls, 8 panels, 12 dialogs. 32px controls, 34px list rows, 1px borders, shadows only on dialogs. The UI is monochrome; color only ever means a state.

### Type
- **Moments only** (Home headline, sealed dialogs, held dialog, onboarding step titles): Geist 700, letter-spacing -0.03em, bold statement + Instrument Serif italic payoff in `#8C96AB` at 1.12em
- **Page titles:** Geist 600, 20px. **Body:** 13px. **Meta:** 12px
- **UI:** Geist 400/500/600
- **Numbers and timers:** Geist Mono (300 for big timers)

### Voice
- Serious, declarative, no questions. The user is choosing between keeping their word and being mid
- Core strings: "Enter Sanctum", "Sealed until 10:50", "Break the seal", "Sanctum held", "Seal broken", "<App> stays sealed.", "Daily non-negotiables"

### Mark (**Decided**: torii keyhole)
- A bold torii (curved top beam, crossbar, two pillars) with a solid keyhole in the opening. The gate is where you step into the sanctum, the keyhole is the seal behind you
- Source SVGs in `design/logo/`: `sanctum-mark-dark.svg` (light gate, cobalt keyhole), `sanctum-mark-light.svg`, `sanctum-mark-mono-white.svg`, `sanctum-app-icon.svg` (white on cobalt tile), `sanctum-tray.svg`
- 26-unit grid. Clear space: one pillar width on every side. Minimum size 12px
- Motion: pillars rise, top beam settles, crossbar slides in, keyhole drops (boot + held). While sealed, only the keyhole breathes (sidebar + tray)
### Sound cues (Web Audio or bundled files)
- Enter: one low sine tone, 220 Hz, soft swell
- Held (success): rising C major arpeggio (C5 E5 G5 C6), sine + octave shimmer, ~1.6s decay
- Blocked: muted tick
- Seal broken: two notes falling a minor third

## 9. Open Questions
- None right now. Add new questions here as they come up during the build
