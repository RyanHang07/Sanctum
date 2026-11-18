# Sanctum site and partner page

Sanctum's public site and the accountability partner's pages (SPEC 4.6), one Vite + React app:

- The site: home (`/`), docs (`/docs`, built from `docs/guide/`), changelog (`/changelog`), privacy (`/privacy`), terms (`/terms`), and license notices (`/legal`).
- The partner's pages: accept an invite (`/invite/<token>`), set or reset the PIN, see who you hold the key for (`/partner`), and approve or deny an early unlock with your PIN (`/approve/<id>`).
- Shared notes: read-only, end-to-end encrypted links (`/n/<token>#<key>`).

```bash
cd partner
npm install
npm run dev
```

It runs on http://localhost:5174, which is where dev builds of Sanctum point invite links. The app's own tests cover this site too, so run `npm ci --prefix partner` from the repo root before `npm test` there (CI does the same).

## Deploy (Vercel)

1. Import the repo in Vercel, set **Root Directory** to `partner`. Vercel detects Vite; `vercel.json` sends every path to the app and keeps the partner and note pages out of search.
2. Add the two variables from `.env.example`, `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` (both are public values).
3. After the first deploy, add the site's URL to Supabase > Authentication > URL
   Configuration > Redirect URLs as `https://<your-site>/**`.
4. Build the desktop app with `SANCTUM_PARTNER_URL=https://<your-site>` so invite links point
   there, and set the `PARTNER_APP_URL` secret in Supabase for email links.

Full setup, including Supabase and email: `docs/self-hosting.md`.
