# Backlog

Requested items not yet scheduled into a milestone. Move an item into CHANGELOG.md when it ships.

## Motion and interaction polish
Raised after the Milestone 1 review (2026-09-29).

- ~~**Boot animation.**~~ Shipped: the torii keyhole builds on the boot splash (`AnimatedMark`, GSAP since v0.4.0).
- ~~**Sealed idle pulse.**~~ Shipped: only the keyhole breathes in the sidebar mark and tray icon.
- ~~Hover effects on panels and buttons~~: shipped in M2.
- ~~Held page, sound cues, compact timer~~: pulled into M3.

## App picker
- ~~**Store (UWP/MSIX) apps** aren't discovered yet.~~ Shipped: the picker reads packaged apps and launches them through `shell:AppsFolder`.

## Plan changes (2026-09-29)
- M4 next: idle pauses the countdown and extends the seal (SPEC 4.8 updated).
- The browser extension moves up to 4b, right after M4 (SPEC 7 updated). The hosts file and watchdog stay in M8.
- Compact timer keeps remembering its drag (as an offset from top middle).
- Not committed yet, by choice.
- Calendar (9) and Today + Week (10) move up to 4c and 4d, right after the extension. Repeating timed items become one recurring calendar event; untimed items stay in Sanctum (SPEC 4.12, 7 updated).

## 4b Browser extension (built 2026-09-29)
- Built as planned, with these changes:
  - The bridge is a copy of sanctum.exe (`sanctum-bridge.exe` in app data) run in relay mode. It reaches Sanctum over a localhost socket guarded by a token file, not a named pipe.
  - Registered for Comet, Chrome, Edge, and Brave.
  - A missing extension is only enforced for browsers that have connected before, and only while the seal has sites or keywords.
- Still to check by hand: load unpacked in Comet, then seal a site, an Allow page, and a keyword tab; turn the extension off mid-seal.
- Incognito: Setup warns when the extension isn't allowed in private windows. **Later:** close private windows while sealed until it is. Telling private windows apart from outside the browser isn't reliable, so this needs a better signal first.
- Later: Opera, Vivaldi, and Arc registration; Firefox (MV3 plus its own native-messaging registry key).
- Later (M13): ship the extension with the installer and publish it to the Chrome Web Store, keeping the same ID with `extension/.key.pem`. Dev and release builds share one host name, so the last one started owns the registration.

## 4c Google Calendar (built 2026-09-29)
- See SPEC 4.3. First real connect worked: Sanctum calendar created, routines pushed, events cached. Still to check by hand: edits made in Google flowing back, and the 7-day reconnect.
- Later: publish the Google app (verification) at M13 so sign-ins stop expiring every 7 days.
- Later: drag events between days in Week; edit a whole recurring series from Sanctum (today an edit changes one occurrence).

## 4d Today + Week (complete 2026-09-29)
- ~~Later: a Ctrl K quick-add bar from anywhere.~~ Shipped: Ctrl K opens the command bar, which adds tasks.

## M5 onboarding (noted 2026-09-29)
- **Browser extension step.**
  - List the installed browsers from `browser_status`.
  - For each: open `chrome://extensions` (can't be deep-linked; show the steps), copy the folder path, turn on Developer mode, Load unpacked, then Details > Allow in Incognito.
  - Watch `sanctum://browser` and tick each browser off as it connects.
  - After M13, this becomes a Chrome Web Store / Edge Add-ons install link.
- ~~**Always open step.**~~ Dropped: allowlist mode and Always open were removed (SPEC 4.2, 4.4).
- **Try a seal.** An optional 1-minute test seal on a sample site, so the blocked page and an attempt show once before real use.

## M6 follow-ups (noted 2026-09-29)
- **You, in the Supabase dashboard** (Authentication):
  - Add Redirect URLs `http://127.0.0.1:54917/**` and `http://localhost:5174/**`, plus the Vercel URL once deployed.
  - Enable the Google provider with an OAuth client. Its authorized redirect URI is `https://phihiaeejhdnfavtianf.supabase.co/auth/v1/callback`.
  - Supabase's built-in email only reaches the project's team members. For partners' email links, set Brevo as custom SMTP.
- **Brevo:** secrets `BREVO_API_KEY`, `BREVO_SENDER`, `PARTNER_APP_URL`.
- **Vercel:** deploy `partner/` (see partner/README.md), then build the app with `SANCTUM_PARTNER_URL`.
- **Later:**
  - An account + partner step in onboarding.
  - `streak_lost` notifications when a missed day resets the streak.
  - Daily summary and streak sync.
  - Notifications list in the app.

## Blocking
- **Instant blocking.** Replace the 1s process poll with WMI process-start events (SPEC 4.4 v2).
- ~~**Elevated apps** can't be closed from the user-level app.~~ Shipped: with App Guard on, the guard can close flagged apps run as administrator.

## Open real-Windows checks (v0.4.0)
Unit-tested, not yet tried on a real Windows install. The full checklist lives in `docs/manual-testing.md`; these are the v0.4.0 protection and stability changes to try there.
- App Guard: install on a fresh PC and confirm `%ProgramData%\Sanctum\guard` has only SYSTEM and Administrators write access; install over an older guard and see Setup flag it as outdated, then update it.
- Hosts file: with your own entries in it, seal and unseal and confirm every other line is unchanged; seal while the file is locked by another program and confirm nothing is wiped.
- The guard lets go 15 minutes past a seal's planned end (plus idle) when Sanctum can't end it, and stops relaunching after 5 failed tries in a row.
- Clock forward: set the clock ahead mid-seal, before and after closing Sanctum, and confirm the seal holds, End early's waits don't skip, the emergency unlock doesn't come back, and tamper is recorded.
- Offline and signed out with a linked partner: level 3 waits 5 minutes; Sign out is refused while sealed.
- A full or read-only disk at a seal's end: the seal ends and the "wasn't saved" notice shows.
- An update that migrates the database leaves a copy in "Backups before updates", and only the newest 3 are kept.
