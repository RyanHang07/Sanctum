# Manual testing: what the automated tests can't cover

These features have unit tests, but nobody has tried them yet in a real browser, on real Windows hardware, against the live services, or on a Mac. Tick them off as they're checked, and add new ones as they come up.

## Updates and releases

- [ ] **0.1.2 → 0.2.0:** v0.2.0 is published (2026-10-29); Setup › General › About › Check for updates finds 0.2.0 and installs it.
- [x] **Automatic publishing:** the next `v*` tag publishes the release by itself (not as a draft), and its notes are that version's CHANGELOG section.
- [ ] **One-click updates (from 0.3.0):**
  - A little after Sanctum starts, the update downloads in the background and "Sanctum x is ready." appears, and **Restart to update** installs and restarts it.
  - While sealed, the button waits; it works once the seal ends.
  - "Later" hides the note until the next start.
- [ ] **Restart to update saves first:** type in a note, then click Restart to update right away; the words are there after the restart.
- [ ] **Recap and update stacked:** the weekly recap and the update note stack bottom right without overlapping.

## The seal's science (v0.3.1)

- [ ] **Ctrl Alt P:** while sealed, from another app (VS Code, a browser), Ctrl Alt P opens the park card bottom right with the cursor in it; Enter parks, Esc closes, and focus goes back. After the seal, Ctrl Alt P does nothing in Sanctum and reaches other apps again.
- [ ] **Plan on catches:** with an if-then plan set, the app overlay, the keyword nudge, and the extension's sealed page show "If you're tempted, you said you'd …", and the overlay is tall enough for it.
- [ ] **Park from the extension:** the sealed page's Park box adds a task for today and says so; during quiet hours it's hidden.
- [ ] **Held page:** Done / Partly / No, the rating, and "where I left off" are kept after Done, Esc, or Enter again; the next seal of that task shows "Last time: …".
- [ ] **After a break:** a real broken seal (close Sanctum mid-seal without Protection) shows "Sanctum was closed N minutes in." and Turn on Protection opens Setup › Protection.

- [ ] **Pause mode, apps:** with Pause mode on, opening Discord (on the Distractions list) outside a seal minimizes it behind "Still want Discord?"; Go on is greyed for 5 seconds, then restores Discord and leaves it alone for 15 minutes; Not now closes it. Apps run as administrator may not minimize.
- [ ] **Pause mode, sites:** a flagged site shows "Still want youtube.com?" before loading; Go on opens it for 15 minutes; with Sanctum closed, sites open normally. Stats › Overview shows "Pauses turned back".
- [ ] **Pause hours:** set hours that start in a minute; the browsers start asking when they begin and stop when they end.
- [ ] **Break:** from the held page, a 5-minute break keeps flagged apps and sites closed, Home counts down, and at the end "Break's over. Next block?" starts the same profile and length.

- [ ] **Monday card:** the questions save (with the journal unlocked, they're on today's page; locked, the notice says they're kept with the week), and the target shows on Home's focus strip.
- [ ] **Partner's weekly summary (live):** with the switch on and a partner linked, the Monday card's first showing sends one "{you}'s week in focus" email with totals only; the next start that week sends none. Needs `notify` deployed with `weekly_summary`.
- [ ] **Suggestions on real data:** after a few weeks, Stats › Overview's "From your own history" says something true, and each "Use it" does what it says.
- [ ] **Do not disturb in quiet hours:** with the switch on, Windows' Do not disturb turns on when quiet hours start and back off when they end (and stays right across a seal inside quiet hours).

## Browser extension

- [ ] **0.2.2 → 0.3.0:** after Sanctum updates to 0.3.0, a manual reload on the extensions page brings in 0.3.0. Check the version shown there.
- [ ] **Self-reload (0.3.0 → the next version):** after the next Sanctum update, the extension reloads itself with no click. Check the version on the extensions page.
- [ ] **Loaded from another folder:** an extension loaded unpacked from a different folder (e.g. the repo) reloads once after an update, then stays on its version without looping.
- [ ] **Self-reload waits for a seal:** during a seal it doesn't reload, and it does once the seal ends.
- [ ] **Browser restart:** after a Sanctum update, does a plain browser restart load the new extension files too? (Expected, not yet confirmed.)
- [ ] **Theme on the sealed page and popup:** both draw in the app's theme, and change live when the theme changes.
- [ ] **Theme with Sanctum closed:** they keep the last theme after a browser restart, even before Sanctum is running.
- [ ] **Installer files:** the installed extension folder includes `theme.js` (it was nearly left out; a test now guards it).

## Themes (in the installed app)

- [ ] **Every theme everywhere:** all 13 look right in every window: main, tray panel, compact timer, the blocked-app overlay, the held page, the boot splash, and dialogs.
- [ ] **Follow Windows:** switching Windows between light and dark while Sanctum is open changes the theme live.
- [ ] **Title bar:** it follows the theme's light or dark when Follow Windows is off.
- [ ] **Tray icon:**
  - On a light taskbar it's the dark mark, and it switches live when the taskbar setting changes.
  - The keyhole still pulses while sealed.
- [ ] **Site in your theme:** Setup › About › Privacy, Terms and Legal open the site in your theme's light or dark.

## Stats (on real data)

- [ ] **Activity:** sites come out right from real browser titles (Chrome, Edge, Brave, Comet).
- [ ] **Reclassify:**
  - "everywhere" recounts past days.
  - "only in Study" changes only Study's sessions, and applies live during a Study seal.
- [ ] **Day:** the timeline lines up with what you actually did, and broken sessions are outlined.
- [ ] **CSV export:** Sessions › Export CSV saves a file that opens in Excel, and the Show button reveals it.
- [ ] **Recap:**
  - It appears once, the first time you open Sanctum in a new week.
  - It doesn't come back after Close.
  - It doesn't appear for a week with no sessions.

## Earlier work, still unchecked

- [ ] **Journal, Windows Hello lock:** unlocking with face, fingerprint or the Windows PIN (no Hello hardware to test on so far).
- [ ] **Journal saves before it locks:** words typed just before hiding Sanctum (which locks it) are saved.
- [ ] **Quitting saves:** quitting from the tray menu, the close button set to quit, or the tray panel saves unsaved note and journal typing, and pending deletes go through.
- [ ] **Deleting a shared note:** its link stops working right away (live Supabase).
- [ ] **Downtime counts as tamper:** a reboot mid-seal logs "The PC went off"; killing Sanctum without a reboot logs "Sanctum was closed".
- [ ] **Partner past requests:** the partner page lists approved, denied and expired requests with real data.

## Live services (your accounts)

- [ ] **Emails:** `notify`, `invite` and `unlock-respond` are redeployed with the sanctum-desktop logo (2026-10-29) and the sign-in templates are pasted. Check a real sign-in email, an invite email, and an unlock request email: the logo shows, and the buttons open sanctum-desktop.vercel.app.
- [ ] **New address:**
  - `sanctum-desktop.vercel.app` serves the home page, docs, changelog, /legal and /partner.
  - Sign-in redirects back there. Supabase Auth's URL settings need the new address.
- [ ] **Updated settings:** the GitHub variable `SANCTUM_PARTNER_URL`, the Supabase secret `PARTNER_APP_URL`, Google's OAuth consent screen links, and the Search Console property all use the new address.

## macOS (no Mac on hand)

- [x] **CI:** the macOS workflow passes (compiles, Rust tests pass, unsigned `Sanctum.app` built).
- [ ] **On a real Mac:** the app opens (right-click › Open the first time), the main window works, and the tray icon appears. Protection, Windows Hello, Do Not Disturb and app blocking are expected to say they aren't there yet.
