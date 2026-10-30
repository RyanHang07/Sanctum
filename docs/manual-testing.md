# Manual testing: what the automated tests can't cover

These features have unit tests, but nobody has tried them yet in a real browser, on real Windows hardware, against the live services, or on a Mac. Tick them off as they're checked, and add new ones as they come up.

## Updates and releases

- [ ] **0.1.2 → 0.2.0:** after the v0.2.0 draft is published, Setup › General › About › Check for updates finds 0.2.0 and installs it.
- [ ] **Automatic publishing:** the next `v*` tag publishes the release by itself (not as a draft), and its notes are that version's CHANGELOG section.
- [ ] **One-click updates (from 0.3.0):**
  - A little after Sanctum starts, the update downloads in the background and "Sanctum x is ready." appears, and **Restart to update** installs and restarts it.
  - While sealed, the button waits; it works once the seal ends.
  - "Later" hides the note until the next start.
- [ ] **Recap and update stacked:** the weekly recap and the update note stack bottom right without overlapping.

## Browser extension

- [ ] **0.2.2 → 0.3.0:** after Sanctum updates to 0.3.0, a manual reload on the extensions page brings in 0.3.0. Check the version shown there.
- [ ] **Self-reload (0.3.0 → the next version):** after the next Sanctum update, the extension reloads itself with no click. Check the version on the extensions page.
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

- [ ] **Email logo:**
  - Redeploy `notify`, `invite` and `unlock-respond` so emails use the sanctum-desktop logo address. The deploy was blocked by a permission setting; allow it, or deploy them yourself.
  - Paste `supabase/templates/confirmation.html` and `supabase/templates/magic_link.html` into Supabase › Auth › Email Templates.
- [ ] **New address:**
  - `sanctum-desktop.vercel.app` serves the home page, docs, changelog, /legal and /partner.
  - Sign-in redirects back there. Supabase Auth's URL settings need the new address.
- [ ] **Updated settings:** the GitHub variable `SANCTUM_PARTNER_URL`, the Supabase secret `PARTNER_APP_URL`, Google's OAuth consent screen links, and the Search Console property all use the new address.

## macOS (no Mac on hand)

- [x] **CI:** the macOS workflow passes (compiles, Rust tests pass, unsigned `Sanctum.app` built).
- [ ] **On a real Mac:** the app opens (right-click › Open the first time), the main window works, and the tray icon appears. Protection, Windows Hello, Do Not Disturb and app blocking are expected to say they aren't there yet.
