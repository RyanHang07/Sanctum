# Sanctum cloud

The optional account, accountability partner, and shared notes (SPEC 4.6, 5.2), on your own
Supabase project. Setup steps: docs/self-hosting.md.

- `migrations/`: the schema, applied in order (`supabase db push`). Every table has RLS; `pins`
  has no policies (Edge Functions only). The two `note_shares` migrations hold shared notes as
  ciphertext only (the key stays in the link), with images in the private `note-shares` bucket.
- `functions/`: Edge Functions, all behind a signed-in JWT.
  - `invite`: `peek` shows who sent an invite; `accept` links the partner and sets their
    PIN (argon2id).
  - `pin-set`: the partner resets their PIN.
  - `notify`: stores a partner notification and emails it through Brevo.
  - `unlock-respond`: the partner approves or denies an early unlock with their PIN (3 wrong
    tries lock approvals for 30 minutes; requests expire after 30 minutes).
  - `account-delete`: deletes the signed-in account; everything it owns cascades. Data on the
    user's PC is untouched.
  - `_shared/`: code the functions share, including `email.ts`, which also generates
    `templates/` (`npm run email:templates`).
- `templates/`: the sign-in email templates to paste into Authentication > Email Templates.

Secrets (set in the Supabase dashboard > Edge Functions > Secrets, never in this repo):
- `BREVO_API_KEY`, `BREVO_SENDER`: turn on partner emails. Without them notifications are
  stored, not emailed.
- `PARTNER_APP_URL`: the deployed partner page, linked from emails.

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided to the functions by Supabase.
