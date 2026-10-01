# Self-hosting the optional services

Sanctum runs fully without any of this. Two features need services you set up yourself:

- **Google Calendar sync** needs a Google OAuth client.
- **The account and accountability partner** need a Supabase project, a deployed partner page, and optionally Brevo for email.

All keys go in `src-tauri/.env`, which is gitignored and read when Sanctum is built. Copy `src-tauri/.env.example` to start. Never commit real keys.

## Google Calendar

1. In [Google Cloud Console](https://console.cloud.google.com), create a project and enable the **Google Calendar API**.
2. Under **APIs & Services › OAuth consent screen**, choose **External**, fill in the app name and your email, and add the scopes `openid`, `email`, and `.../auth/calendar`. While the app is in **Testing**, add yourself (and anyone else using your build) as test users. Testing-mode sign-ins expire every 7 days; publishing the app removes that limit.
3. Under **Credentials**, create an **OAuth client ID** of type **Desktop app**. Sanctum signs in through the system browser with a loopback redirect to `127.0.0.1` and PKCE, so no redirect URI needs to be added.
4. Put the client ID and secret in `src-tauri/.env`:

   ```
   GOOGLE_CLIENT_ID=...apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=...
   ```

   Google treats a desktop app's client secret as not confidential, since it ships inside the app. It still stays out of the repo.

5. Rebuild (`npm run tauri dev`), then connect in Setup › Calendar.

## Account and partner (Supabase)

### 1. The project

1. Create a free project at [supabase.com](https://supabase.com).
2. Apply the migrations in `supabase/migrations/` in order: `supabase db push` with the [Supabase CLI](https://supabase.com/docs/guides/cli), or paste each file into the SQL editor.
3. Deploy the Edge Functions in `supabase/functions/` (`invite`, `pin-set`, `notify`, `unlock-respond`, `account-delete`):

   ```powershell
   supabase functions deploy invite
   supabase functions deploy pin-set
   supabase functions deploy notify
   supabase functions deploy unlock-respond
   supabase functions deploy account-delete
   ```

4. In `src-tauri/.env`, add the project URL and **publishable** key (Project Settings › API). The publishable key is public by design; row-level security guards the data. Never use the service role key here.

   ```
   SANCTUM_SUPABASE_URL=https://<project-ref>.supabase.co
   SANCTUM_SUPABASE_KEY=sb_publishable_...
   ```

### 2. Sign-in

In the Supabase dashboard, **Authentication**:

- **URL Configuration › Redirect URLs:** add `http://127.0.0.1:54917/**` (the app's sign-in callback), `http://localhost:5174/**` (the partner page in dev), and your deployed partner page URL with `/**`.
- **Providers › Google** (optional): enable it with a **Web application** OAuth client from Google Cloud. Its authorized redirect URI is `https://<project-ref>.supabase.co/auth/v1/callback`. This is a different client from the Calendar one.
- **Email:** Supabase's built-in email only reaches your project's team members. For partners to get sign-in links, set up custom SMTP (Brevo works on its free plan).

### 3. The partner page

`partner/` is a small Vite app your partner opens from invite and email links.

1. Deploy it to any static host (Vercel, Netlify, Cloudflare Pages). `partner/vercel.json` has the Vercel setup.
2. Set these environment variables on the host, or in `partner/.env.local` for local dev:

   ```
   VITE_SUPABASE_URL=https://<project-ref>.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
   ```

3. Tell the app where it lives, in `src-tauri/.env`:

   ```
   SANCTUM_PARTNER_URL=https://your-partner-page.example
   ```

   Without it, invite links point at `http://localhost:5174` (`npm run dev` in `partner/`).

### 4. Sign-in emails

Under **Authentication › Email Templates**, paste the files from `supabase/templates/` so sign-in emails match the rest of Sanctum:

| Template | File | Subject |
|---|---|---|
| Magic Link | `magic_link.html` | Your Sanctum sign-in link |
| Confirm signup | `confirmation.html` | Confirm your email for Sanctum |

They're generated from `supabase/functions/_shared/email.ts`; run `npm run email:templates` after changing it.

### 5. Public pages

The partner page also serves `/about`, `/privacy`, and `/terms`, the home page, privacy policy, and terms of service links Google's OAuth consent screen asks for. If you run your own copy, change the operator and contact email in `partner/src/Legal.tsx`.

### 6. Email (optional)

Partner notifications (a broken seal, an unlock request, an emergency unlock) are stored either way. Emailing them, emailing invites, and telling you when your partner answers all need these **Edge Function secrets** in the Supabase dashboard (Edge Functions › Secrets), never in the repo:

- `BREVO_API_KEY`: a Brevo API key (not an SMTP key).
- `BREVO_SENDER`: a sender address verified in Brevo.
- `PARTNER_APP_URL`: your deployed partner page, linked from emails.

## Official releases

The release workflow (`.github/workflows/release.yml`) reads the same values from the GitHub repo's settings:

- **Secrets:** `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
- **Variables:** `SANCTUM_SUPABASE_URL`, `SANCTUM_SUPABASE_KEY`, `SANCTUM_PARTNER_URL`.

The signing key pair is for updates only. Generate it once with `npx tauri signer generate -w "$HOME/.tauri/sanctum.key"`, keep the private key and its password as the two secrets above, and put the public key in `src-tauri/tauri.conf.json` under `plugins.updater.pubkey`. Anyone forking Sanctum to publish their own builds needs their own key pair and their own `endpoints` URL there.
