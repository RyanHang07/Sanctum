// A partner resets their PIN from the partner page (SPEC 4.6). Hashed with argon2id here.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { admin, caller, cors, fail, hashPin, json, validPin } from "../_shared/util.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const db = admin();
  const user = await caller(req, db);
  if (!user) return fail("Sign in first.", 401);

  const { pin } = await req.json().catch(() => ({}));
  if (!validPin(pin)) return fail("Choose a PIN of 6 to 12 digits.");

  const { data: link } = await db.from("partnerships").select("id").eq("partner_id", user.id).neq("status", "ended").limit(1).maybeSingle();
  if (!link) return fail("Only an accountability partner has a PIN.", 403);

  const { data: current } = await db.from("pins").select("locked_until").eq("user_id", user.id).maybeSingle();
  if (current?.locked_until && new Date(current.locked_until).getTime() > Date.now()) {
    return fail("Approvals are locked after 3 wrong PINs. Try again later.", 423);
  }
  await db.from("pins").upsert({ user_id: user.id, pin_hash: await hashPin(pin), failed_attempts: 0, locked_until: null, updated_at: new Date().toISOString() });
  return json({ ok: true });
});
