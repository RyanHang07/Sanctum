# Sanctum

Windows-first Tauri v2 desktop app: focus hub + distraction blocker.

- `SPEC.md` is the source of truth for features, stack, data model, and milestones. Build milestone by milestone and ask before deviating from anything marked **Decided**.
- `design/` is the visual reference. Before building any screen, open the matching file in `design/screens/` (see `design/README.md` for the screen map) and match its layout, spacing, colors, type, and copy.
- Use the tokens in `design/tokens.css` / `design/tokens.json` via Tailwind theme config. No raw hex in components.
- Headlines follow the rule in `design/README.md` (Geist bold statement + Instrument Serif italic payoff).
- Voice is serious and declarative. No questions in headlines. Reuse the core strings in SPEC.md section 8.
- Tests with Vitest. End each milestone with passing tests and a note in `CHANGELOG.md`.
- The logo is the torii keyhole. Use the SVGs in `design/logo/` for the app icon, tray icon, installer, and in-app mark. Never redraw it.
