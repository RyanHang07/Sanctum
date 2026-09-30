# Sanctum cloud (M6)

The optional account and accountability partner (SPEC 4.6, 5.2), on the Supabase project
`Sanctum` (`phihiaeejhdnfavtianf`, free plan, us-west-1).

- `migrations/`: the schema, applied in order. Every table has RLS; `pins` has no policies
  (Edge Functions only).
- `functions/`: Edge Functions, all behind a signed-in JWT.
  - `invite`: `peek` shows who sent an invite; `accept` links the partner and sets their
    PIN (argon2id).
  - `pin-set`: the partner resets their PIN.
  - `notify`: stores a partner notification and emails it through Brevo.
  - `unlock-respond`: the partner approves or denies an early unlock with their PIN (3 wrong
    tries lock approvals for 30 minutes; requests expire after 30 minutes).

Secrets (set in the Supabase dashboard > Edge Functions > Secrets, never in this repo):
- `BREVO_API_KEY`, `BREVO_SENDER`: turn on partner emails. Without them notifications are
  stored, not emailed.
- `PARTNER_APP_URL`: the deployed partner page, linked from emails.
