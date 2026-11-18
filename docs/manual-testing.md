# Manual testing: what the automated tests can't cover

These features have unit tests, but nobody has tried them yet in a real browser, on real Windows hardware, against the live services, or on a Mac. Tick them off as they're checked, and add new ones as they come up.

## Updates and releases

- [ ] **0.1.2 → 0.2.0:** v0.2.0 is published (2026-10-29); Setup › About › Check for updates (now Setup › Behavior › About) finds 0.2.0 and installs it.
- [x] **Automatic publishing:** the next `v*` tag publishes the release by itself (not as a draft), and its notes are that version's CHANGELOG section.
- [x] **One-click updates (from 0.3.0):**
  - A little after Sanctum starts, the update downloads in the background and "Sanctum x is ready." appears, and **Restart to update** installs and restarts it.
  - While sealed, the button waits; it works once the seal ends.
  - "Later" hides the note until the next start.
- [ ] **Restart to update saves first:** type in a note, then click Restart to update right away; the words are there after the restart.
- [ ] **Recap and update stacked:** the weekly recap and the update note stack bottom right without overlapping.

## The seal's science (v0.3.1)

Checked in the browser preview on 2026-10-30 (screens and flows, with the mock backend): the goal and plan lines, parking from Home and the park card, the held page's wrap-up, parked list, and break, "Break's over. Next block?", "Last time: …", the Monday card's questions and target, Pause mode's settings and card, the suggestions and their buttons, Sessions' Got done and details, the broken-seal page and its fix, the extension's sealed page (plan, Park) and pause page, and the site's theme preview. What's left needs real Windows, a browser with the extension, or the live services:

- [ ] **Ctrl Alt P:** (2026-10-31: pressed with no visible result, likely outside a seal; recheck inside one. If nothing opens, another app may hold the keys.) While sealed, from another app (VS Code, a browser), Ctrl Alt P opens the park card bottom right with the cursor in it; Enter parks, Esc closes, and focus goes back. After the seal, Ctrl Alt P does nothing in Sanctum and reaches other apps again.
- [ ] **Plan on catches:** with an if-then plan set on the profile (Setup › Profiles, open the profile), the app overlay, the keyword nudge, and the extension's sealed page show "If you're tempted, you said you'd …", and the overlay is tall enough for it.
- [ ] **Park from the extension:** the sealed page's Park box adds a task for today and says so; during quiet hours it's hidden.
- [ ] **Held page:** under Add a note, Done / Partly / No, the rating, and "where I left off" are kept after Done, Esc, or Enter again; the next seal of that task shows "Last time: …" under Enter focus.
- [ ] **Broken seal:** a real broken seal (close Sanctum mid-seal without Protection) shows "Sanctum was closed N minutes in." and Turn on Protection opens Setup › App Guard.

- [x] **Pause mode, apps:** (2026-10-31: Discord and Steam, including reopening from the tray; after Go on, the tray app opens freely for 15 minutes, as designed.) with Pause mode on, opening Discord (on the Distractions list) outside a seal minimizes it behind the pause card ("Discord can wait five seconds." since v0.4.0); Go on is greyed for 5 seconds, then restores Discord and leaves it alone for 15 minutes; Not now closes it. Apps run as administrator may not minimize.
- [x] **Pause mode, sites:** (2026-10-31, with listed sites.) a flagged site shows "Still want youtube.com?" before loading; Go on opens it for 15 minutes; with Sanctum closed, sites open normally. Stats › Overview shows "Pauses turned back".
- [ ] **Pause hours:** set hours that start in a minute; the browsers start asking when they begin and stop when they end. (2026-10-31: apps follow the hours; sites still to check.)
- [ ] **Weekly recap:** (off by default since v0.4.0: turn on Weekly recap in Setup › Goals.) The first open of a new week shows the card with the strip of daily bars and the best day marked. "One thing to change this week" saves (with the journal unlocked, it's on today's page; locked, the notice says it's kept with the week), and the week's focus target (Setup › Goals) shows on Stats › Overview.
- [ ] **Partner's weekly summary (live):** with the switch on and a partner linked, the first open of a new week sends one "{you}'s week in focus" email with totals only; the next start that week sends none. Needs `notify` deployed with `weekly_summary`.
- [ ] **Suggestions on real data:** after a few weeks, Stats › Overview's "From your own history" says something true, and each "Use it" does what it says.
- [x] **Do not disturb in quiet hours:** with the switch on, Windows' Do not disturb turns on when quiet hours start and back off when they end (and stays right across a seal inside quiet hours).

- [ ] **Routines come off Google (v0.3.2):** after updating, routines leave the Sanctum calendar on the next sync and every routine is still in Sanctum. "Show on Google Calendar" on one puts it back as a repeating event; turning it off removes it, and the routine stays.
- [ ] **Start over and Google (v0.3.2):** with Google connected, Start over removes the Sanctum calendar from your account. Offline, it stops with Try again and Erase anyway, and nothing is erased until you pick.

- [ ] **Blocked page after hardening (v0.3.2):** in a real browser, a sealed site still lands on the blocked page, counts one attempt, and Back and Park work; a flagged path like reddit.com/r/x works too.

## v0.3.3 (in the installed app)

- [ ] **Day resets at:** change it in Setup › Goals; Today, routines, and the streak roll over at that time, and Today's routines header counts down as it gets close.
- [ ] **Routines more than once a day:** a 2-a-day routine shows 1/2 after one tick and done at 2/2, and undo steps back. With it on Google Calendar, the ✓ appears only at 2/2, and the 1/2 survives the next sync.
- [ ] **Ctrl B:** bolds in notes and the journal, and collapses the sidebar everywhere else.
- [ ] **Notes:** deleting asks first; tables add and remove rows and columns, resize, and hold nested lists under checklist items.
- [ ] **Themes everywhere:** an OpenCode theme reaches the tray icon, compact timer, held page, sidebar mark, and the extension's toolbar icon; the hover preview stays on screen.

## v0.3.4 (extension, after reloading it)

- [ ] With Aura on, the toolbar icon in Comet and Chrome shows the torii on a coral tile, not a blank square.
- [ ] The popup and the blocked page show the keyhole in coral; switching themes recolours it live.
- [ ] On a light theme, the popup mark's torii is dark and readable.

## Browser extension

- [ ] **0.2.2 → 0.3.0:** after Sanctum updates to 0.3.0, a manual reload on the extensions page brings in 0.3.0. Check the version shown there.
- [x] **Self-reload (0.3.0 → the next version):** after the next Sanctum update, the extension reloads itself with no click. Check the version on the extensions page.
- [ ] **Loaded from another folder:** an extension loaded unpacked from a different folder (e.g. the repo) reloads once after an update, then stays on its version without looping.
- [ ] **Self-reload waits for a seal:** during a seal it doesn't reload, and it does once the seal ends.
- [ ] **Browser restart:** after a Sanctum update, does a plain browser restart load the new extension files too? (Expected, not yet confirmed.)
- [x] **Theme on the sealed page and popup:** both draw in the app's theme, and change live when the theme changes.
- [x] **Theme with Sanctum closed:** they keep the last theme after a browser restart, even before Sanctum is running.
- [x] **Installer files:** the installed extension folder includes `theme.js` (it was nearly left out; a test now guards it).

## Today (v0.4.0 redesign)

jsdom has no layout, so these need the real app on Windows:

- [ ] **Entering focus:** press Enter focus; the button's fill shrinks into a thin line along the bottom of the sealed card (not elsewhere on the page), holds, then fades to show the progress track. Try it with the window narrow enough that the card's three boxes wrap to two rows.
- [ ] **Live minutes:** seal for a few minutes with Today open; the needle and fill glide once a minute and the figure rolls, smoothly on an integrated GPU. Passing 30, 60 or 90 minutes lights that tick briefly. Minimize to the tray and come back: the needle is in place with nothing replaying.
- [ ] **Goal reached:** set the goal just above today's minutes (Setup › Goals) and seal; at the goal, the goal tick gains its field and "· kept", today's cell in the streak turns kept, and the streak counts up. Check it reads in Aura, Night Owl, Cobalt2 Light and Sanctum Dark.
- [ ] **Days strip key:** hovering the streak shows Kept, Missed, Today beside it after a short pause without moving the chip; tabbing to it shows the same.
- [ ] **Windows "Show animations" off:** all of the above change at once, with no motion.

## Moments (v0.4.0 redesign)

The intercept window is a real Windows window, and the held build plays on real timing, so these need the installed app:

- [ ] **Intercept window size:** seal a profile with an if-then plan and open a sealed app. The window is 520×360 (logical) and centred, and the card's shadow isn't clipped on any side. Without a plan it is 520×330 with the same margins. Try it at 100%, 125% and 150% display scaling.
- [ ] **Long "Back to" name:** with a long window title in front (VS Code with a long file name), "Back to …" truncates inside the button and the footer doesn't wrap.
- [ ] **Seal ruler:** 18 minutes into a 60-minute seal, the fill and needle run about 30% along the card's top edge and stop there; the 15-minute major is the accent and 30 and 45 are muted. A 3-hour seal shows majors at each hour only.
- [ ] **Intercept motion:** the card appears in place with no slide, the ruler fills after it, and "Returning in" counts down. With Windows' "Show animations" off, all of it shows at once.
- [ ] **Held build:** finish a seal with the window open. The gate builds, the keyhole seats, the rings settle as the chime plays, and the text rises, once, smoothly. Minimize mid-build and come back: the page is whole and nothing replays.
- [ ] **Broken seal:** close Sanctum during a seal and reopen it. "Seal broken." shows the keyhole draining to a broken-colour outline with the falling notes, no rings, and no break lengths under "Add a note".
- [ ] **Held page in four themes:** Aura, Night Owl, Cobalt2 Light and Sanctum Dark; the fact line, "Add a note" and the review panel read clearly, and Enter again's accent stands out from the page.
- [ ] **Close dialog while sealed:** press the window's close button during a seal; it says "Quit opens at" the seal's end time, and the tray choice shows the time left.

## Tray, compact timer, extension and partner site (v0.4.0 redesign)

Check each in Aura, Night Owl, Cobalt2 Light and Sanctum Dark:

- [ ] **Tray, sealed:** click the tray icon during a seal. The time left is readable in the accent's text colour (it was near-black in Aura and Night Owl). The bar below fills in the accent with neutral ticks every 5 minutes and taller ones each quarter hour; the last tick sits at the right end, not past it. The keyhole breathes.
- [ ] **Tray, open:** the pill shows a hollow dot. The foot line ("Next check-in …"), the Ctrl M hint and done items are readable. Tab to the add field: the focus ring wraps the whole row.
- [ ] **Compact timer:** Ctrl M during a seal. The fill and ring move a step each minute, smoothly. Text reads on both sides of the fill's edge, and the line under the name isn't faded. Let a short seal end: the ring closes, the edge turns the second colour (no glow), and it reads "Held. N of N minutes.". End one early through the ladder: "Seal broken." with no second-colour edge.
- [ ] **Windows "Show animations" off:** the tray fill and the compact timer change at once.
- [ ] **Extension, loaded unpacked:** load `extension/` from this branch on the extensions page (reload it if it's already loaded). The popup, sealed and open, matches the tray: accent time left, a small accent tick before "until …", "Nothing is sealed." in Schibsted Grotesk, hollow dots, and a readable connection line. Tab to Open Sanctum: the accent ring shows.
- [ ] **Extension, sealed page:** visit a sealed site. The plan is a plain raised panel, the time left is accent text, and the headline is Schibsted Grotesk (check DevTools › Computed › Rendered fonts says Schibsted Grotesk, from the extension, offline too). Tab into Park: the field shows the accent ring. With Pause mode on, the five ticks go out one per second, the next in the accent, and Go on unlocks at zero.
- [ ] **Partner site, live (needs your go-ahead to deploy first):** after deploying `partner/`, open `/approve/<id>?theme=aura` and `?theme=cobalt2-light` on a phone. The page is in that theme with the matching mark, there's no light/dark switch, and the footer carries no theme note. "Deny, keep the seal" is the filled button and comes first, also for Tab. Without `?theme=` the switch is back. The links in emails won't carry the theme until the notify function and the app send it (see the S8 report).

## v0.4.0 on real Windows (protection, the seal, data)

These fixes have unit tests, but they touch Windows itself, so check them in the installed app with Protection on (Setup › App Guard). Sanctum's data is in `%APPDATA%\app.sanctum.desktop`; the guard's is in `%ProgramData%\Sanctum\guard`.

**Hosts file**

- [ ] **Not UTF-8:** save `C:\Windows\System32\drivers\etc\hosts` as ANSI with a non-ASCII comment (or as UTF-16), copy it aside, then seal. The Sanctum block is added and sites are blocked in every browser; after the seal, `fc /b` against the copy shows no difference.
- [ ] **Read-only:** set the hosts file read-only, then seal. Nothing in the file changes, App Guard shows the guard's last error under the status line, and the seal still runs (the extension still blocks). Clear the attribute, and the next seal blocks again.
- [ ] **Defender:** with Microsoft Defender on, seal and end the seal a few times. Defender doesn't quarantine or revert the hosts file (nothing like "HostsFileHijack" in Protection history); if it does, App Guard's last error says so.

**The guard**

- [ ] **Folder ACL:** run `icacls "%ProgramData%\Sanctum\guard"`. It lists only `NT AUTHORITY\SYSTEM:(OI)(CI)(F)`, `BUILTIN\Administrators:(OI)(CI)(F)` and `BUILTIN\Users:(OI)(CI)(RX)`, none marked `(I)` (inherited). As a standard user, creating a file in that folder is refused.
- [ ] **Outdated guard:** install the guard from v0.3.x, update to v0.4.0, and open Setup › App Guard. It says "From an older Sanctum. Update it."; **Update** asks for admin once and the line goes back to "Sanctum reopens if it's closed while you're sealed." Sanctum never shows the admin prompt on its own.
- [ ] **Relaunches stop:** during a seal, keep `sanctum.exe` from starting (rename it), then kill Sanctum. The guard tries five times, then stops until the next seal (Times it reopened Sanctum stops climbing).
- [ ] **Let go after the end:** kill Sanctum during a short seal and keep it from starting. About 15 minutes after the planned end, the guard takes its block out of the hosts file.

**The seal**

- [ ] **Clock forward, kill, relaunch:** start a 30-minute seal, set the Windows clock 2 hours forward, kill Sanctum in Task Manager, and let the guard (or you) relaunch it. The seal is still on with about the same time left, the hosts block stays, Stats › Sessions shows the session broken with the clock change under "What happened", and End early's 5-minute wait isn't skipped. Set the clock back afterward.
- [ ] **Offline, level 3, with a partner:** with a partner linked, go offline (Wi-Fi off) mid-seal and climb the ladder. At level 3 a 5-minute wait replaces the request; it pauses when Sanctum isn't in front, then **End the session** ends it as unlocked early. Signed out with a partner still linked behaves the same, and signing out during a seal is refused ("Signing out waits until the seal ends.").
- [ ] **Full or read-only database at the end:** during a short seal, make `sanctum.db` and its `-wal` file read-only, or fill the disk. When the seal runs out (and, separately, after End early), the seal ends anyway and the notice says "The seal ended, but it wasn't saved." Give write access back: the session is saved on its own, with its real end time.
- [ ] **Double click on Enter focus:** double-click Enter focus quickly; one session starts (Stats › Sessions shows one).
- [ ] **Do not disturb after a very short seal:** with **Do not disturb while sealed** on (Setup › Sound and Alerts), start a seal and end it within seconds (the emergency unlock works). Windows' Do not disturb ends up as it was before the seal, not left on.

**Data**

- [ ] **Start over with the guard installed:** with Protection on, use Start over (Setup › Your Data › Danger Zone). Setup runs again, the guard stays installed and doesn't treat the PC as sealed, and the hosts file has no Sanctum block.
- [ ] **Restore with the guard installed:** restore a backup in Setup › Your Data. A "before a restore" backup appears first, the app reloads on the restored data, and the guard keeps running without a stale block. Only the three newest "before restore" backups are kept; your own backups are never removed.
- [ ] **Migration on upgrade:** update from v0.3.x to v0.4.0. A `before v<N> <time>` folder appears in `Backups before updates`, the data opens with nothing missing, and only the three newest such folders stay after later updates. With the data folder read-only before an update, Sanctum says it couldn't back up first and leaves the data untouched.
- [ ] **Pruning:** with history older than 90 days, blocked attempts, tamper events and unlock attempts from before then are gone after a launch; Stats › Sessions still lists those sessions with their totals.

**Extension**

- [ ] **2-second handshake:** restart Sanctum and the browser in either order; the browser shows Connected in Setup › Browser Extension within a few seconds. A local process that connects to the bridge's port and sends nothing is dropped after 2 seconds, and the real extension still connects meanwhile.

## Themes (in the installed app)

- [x] **Every theme everywhere:** all 13 look right in every window: main, tray panel, compact timer, the blocked-app overlay, the held page, the boot splash, and dialogs.
- [x] **Follow Windows:** switching Windows between light and dark while Sanctum is open changes the theme live.
- [x] **Title bar:** it follows the theme's light or dark when Follow Windows is off.
- [x] **Tray icon:**
  - On a light taskbar it's the dark mark, and it switches live when the taskbar setting changes.
  - The keyhole still pulses while sealed.
- [x] **Site in your theme:** Setup › Behavior › About › Privacy, Terms and Legal open the site in your theme's light or dark.

## Stats (on real data)

- [x] **Activity:** sites come out right from real browser titles (Chrome, Edge, Brave, Comet).
- [x] **Reclassify:**
  - "everywhere" recounts past days.
  - "only in Study" changes only Study's sessions, and applies live during a Study seal.
- [x] **Day:** the timeline lines up with what you actually did, and broken sessions are outlined.
- [x] **CSV export:** Sessions › Export CSV saves a file that opens in Excel, and the Show button reveals it.
- [ ] **Recap** (with Weekly recap on in Setup › Goals; off, it never appears):
  - It appears once, the first time you open Sanctum in a new week.
  - It doesn't come back after Close.
  - It doesn't appear for a week with no sessions.

## Earlier work, still unchecked

- [ ] **Journal, Windows Hello lock:** unlocking with face, fingerprint or the Windows PIN (no Hello hardware to test on so far).
- [x] **Journal saves before it locks:** words typed just before hiding Sanctum (which locks it) are saved.
- [x] **Quitting saves:** quitting from the tray menu, the close button set to quit, or the tray panel saves unsaved note and journal typing, and pending deletes go through.
- [ ] **Deleting a shared note:** its link stops working right away (live Supabase).
- [ ] **Downtime counts as tamper:** a reboot mid-seal logs "The PC went off"; killing Sanctum without a reboot logs "Sanctum was closed".
- [x] **Partner past requests:** the partner page lists approved, denied and expired requests with real data.

## Live services (your accounts)

- [ ] **Emails:** `notify`, `invite` and `unlock-respond` are redeployed with the sanctum-desktop logo (2026-10-29) and the sign-in templates are pasted. Check a real sign-in email, an invite email, and an unlock request email: the logo shows, and the buttons open sanctum-desktop.vercel.app.
- [ ] **New address:**
  - `sanctum-desktop.vercel.app` serves the home page, docs, changelog, /legal and /partner.
  - Sign-in redirects back there. Supabase Auth's URL settings need the new address.
- [ ] **Updated settings:** the GitHub variable `SANCTUM_PARTNER_URL`, the Supabase secret `PARTNER_APP_URL`, Google's OAuth consent screen links, and the Search Console property all use the new address.

## macOS (no Mac on hand)

- [x] **CI:** the macOS workflow passes (compiles, Rust tests pass, unsigned `Sanctum.app` built).
- [ ] **On a real Mac:** the app opens (right-click › Open the first time), the main window works, and the tray icon appears. Protection, Windows Hello, Do Not Disturb and app blocking are expected to say they aren't there yet.
