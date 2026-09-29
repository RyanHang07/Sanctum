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

## 4b Browser extension (decided 2026-09-29, paused while 4d's local half is built)
- MV3 extension in `extension/`: service worker + `declarativeNetRequest` redirect rules + packaged blocked page (SiteBlocked.dc.html). Stable ID pinned with a manifest `key`.
- Native messaging: a tiny `sanctum-bridge.exe` host, registered per-user (HKCU, no admin), relays JSON to the running Sanctum over a named pipe. Messages: seal/unseal rules, 30s heartbeat, blocked-domain events (domain only).
- Registered for every installed Chromium browser (Chrome, Edge, Brave, Comet, Opera, Vivaldi, Arc). Setup shows each browser and whether the extension is connected.
- Incognito: Setup check for "Allow in incognito" with the fix; until allowed, private browser windows are closed while sealed.
- Extension disabled or removed mid-seal: detected by missed heartbeat, then a warning, an attempt logged, and browser windows minimized until it's back. Breaking the seal waits for M12.
- Per-site exceptions: each sealed site in a profile's Seals panel gets an "Allow" list of URL prefixes.
- You: load unpacked once in dev (chrome://extensions > Developer mode > Load unpacked). Store publishing in M13 ($5 Chrome Web Store fee; Edge free).

## 4c Google Calendar (built 2026-09-29)
- See SPEC 4.3. First real connect worked: Sanctum calendar created, routines pushed, events cached. Still to check by hand: edits made in Google flowing back, and the 7-day reconnect.
- Later: publish the Google app (verification) at M13 so sign-ins stop expiring every 7 days.
- Later: drag events between days in Week; edit a whole recurring series from Sanctum (today an edit changes one occurrence).

## 4d Today + Week (complete 2026-09-29)
- Later: a Ctrl K quick-add bar from anywhere (the Home "Search or command" box).

## Blocking
- **Instant blocking.** Replace the 1s process poll with WMI process-start events (SPEC 4.4 v2).
- **Elevated apps** can't be closed from the user-level app; the elevated watchdog service (M8) should do it.
