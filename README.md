# Sanctum

A focus hub and distraction blocker for Windows. Pick a profile, enter focus, and Sanctum seals you in: it opens what the work needs, closes what you flagged, blocks distracting sites and tabs, and holds the seal until the time is up. Breaking out early takes real effort, or a friend's approval.

Built with Tauri v2, React, and Rust. Windows 10 and 11.

## What it does

- **Profiles.** Each kind of work opens its apps and links and runs for 30 to 120 minutes.
- **One Distractions list.** Flag apps, sites, links, and title keywords once. Every seal blocks them, and they count as distracting time.
- **A seal that holds.** Flagged apps close as they open. The browser extension blocks sites and keyword tabs, and Protection blocks sites in every browser through the hosts file. The seal survives restarts, and Sanctum comes back if it's closed.
- **Break the seal, on purpose.** A reason and a wait, retyping a paragraph, then a 30-minute cooldown or your partner's approval. One emergency unlock a week.
- **Today and Week.** Tasks and routines, synced two ways with Google Calendar, and focus blocks that start the right profile.
- **Stats and streaks.** Focus time against a daily goal, kept, broken, and rest days, and where the time went.
- **Trackers and check-ins.** Custom numbers, yes/no, 1 to 10 scales, or notes, asked for on a schedule, with charts.
- **Optional accountability partner.** A friend holds a PIN, approves early exits, and hears when a seal breaks.

Everything except the account and partner runs locally and works offline. Activity, trackers, and history stay on your PC.

## Install

Download the latest `Sanctum_x.y.z_x64-setup.exe` from [Releases](https://github.com/ryanhang07/sanctum/releases) and run it. It installs for your user, with no admin prompt.

Sanctum isn't code-signed, so Windows SmartScreen may show "Windows protected your PC". Click **More info**, then **Run anyway**. Sanctum updates itself from Releases (Setup › General › About).

Then, in the app:

1. **Browser extension** (Setup › Connections › Browser extension). Open `chrome://extensions` (or `edge://extensions`, `brave://extensions`), turn on **Developer mode**, click **Load unpacked**, and pick the folder Setup shows. Then open **Details** and turn on **Allow in Incognito**. Chrome, Edge, Brave, and Comet are supported.
2. **Protection** (Setup › Distractions › Protection). Turn it on with one admin approval. It installs the Sanctum Guard service, which blocks flagged sites in every browser while sealed and reopens Sanctum if it's closed mid-seal.

## Build from source

Requirements: Windows 10 or 11, [Node.js 22](https://nodejs.org), [Rust](https://rustup.rs) (stable, MSVC), and the [WebView2 runtime](https://developer.microsoft.com/microsoft-edge/webview2/) (preinstalled on Windows 11).

```powershell
git clone https://github.com/ryanhang07/sanctum.git
cd sanctum
npm install
npm run tauri dev
```

Dev builds keep their own database (`sanctum-dev.db`) and seed sample profiles. `npm run dev` runs the UI alone in a browser against an in-memory mock of the Rust side.

```powershell
npm test               # frontend tests (Vitest)
npm run test:rust      # Rust tests
npm run typecheck
npm run tauri build    # the NSIS installer, in src-tauri/target/release/bundle/nsis
```

### Optional services

Google Calendar sync and the account and partner features need your own keys. Without them those features say they aren't set up, and everything else works. Copy `src-tauri/.env.example` to `src-tauri/.env` and follow [docs/self-hosting.md](docs/self-hosting.md).

## Project layout

| Path | What |
|---|---|
| `src/` | The React UI: pages, components, state (Zustand), and a mock backend for browser dev and tests |
| `src-tauri/` | The Rust app: session engine, blocker, activity tracking, calendar sync, guard service, SQLite |
| `extension/` | The Chromium MV3 extension, talking to the app through native messaging |
| `partner/` | The partner's web page (Vite), deployed separately |
| `supabase/` | Database migrations and Edge Functions for the account and partner |
| `design/` | The design reference: screens, tokens, and the logo |
| `SPEC.md` | What Sanctum does and why, milestone by milestone |

## Contributing

Issues and pull requests are welcome. For a bug, include what Setup › General › About › **Copy diagnostics** gives you. Keep changes in the voice and design of the app (see `design/README.md`), with tests.

## License

[MIT](LICENSE)
