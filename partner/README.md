# Sanctum partner page

The accountability partner's web page (SPEC 4.6): accept an invite, set a PIN, see who you
hold the key for, release them when they ask. Unlock approvals join in M7.

```bash
cd partner
npm install
npm run dev
```

It runs on http://localhost:5174, which is where dev builds of Sanctum point invite links.

## Deploy (Vercel)

1. Import the repo in Vercel, set **Root Directory** to `partner`. Vercel detects Vite.
2. Add the two variables from `.env.example` (both are public values).
3. After the first deploy, add the site's URL to Supabase > Authentication > URL
   Configuration > Redirect URLs as `https://<your-site>/**`.
4. Build the desktop app with `SANCTUM_PARTNER_URL=https://<your-site>` so invite links point
   there, and set the `PARTNER_APP_URL` secret in Supabase for email links.
