# Backlog

Requested items not yet scheduled into a milestone. Move an item into CHANGELOG.md when it ships.

## Motion and interaction polish
Raised after the Milestone 1 review (2026-09-29).

- **Boot animation.** Logo splash on launch (~2.2s): arch strokes on, baseline draws, keyhole drops in, wordmark settles. Spec: SPEC 4.0.2 and `design/screens/LogoMotion.dc.html`. The held page's `AnimatedMark` (M3) already has the per-part animation classes to reuse. Planned for M12.
- **Sealed idle pulse.** Only the keyhole breathes (3.2s loop) in the sidebar mark and tray icon. SPEC 4.0.2, M12.
- ~~Hover effects on panels and buttons~~: shipped in M2.
- ~~Held page, sound cues, compact timer~~: pulled into M3.

## App picker
- **Store (UWP/MSIX) apps** aren't discovered yet (no Start menu .lnk or App Paths entry). Enumerate `shell:AppsFolder` to include them.

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
- Later: a Ctrl K quick-add bar from anywhere (the Home "Search or command" box).

## Blocking
- **Instant blocking.** Replace the 1s process poll with WMI process-start events (SPEC 4.4 v2).
- **Elevated apps** can't be closed from the user-level app; the elevated watchdog service (M8) should do it.
