// The partner opens an invite link (SPEC 4.6): "peek" shows who sent it, "accept" links them
// and sets their PIN (hashed here with argon2id; nobody can read it back).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { admin, caller, cors, fail, hashPin, json, validPin } from "../_shared/util.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const db = admin();
  const user = await caller(req, db);
  if (!user) return fail("Sign in first.", 401);

  const { action, token, pin } = await req.json().catch(() => ({}));
  if (typeof token !== "string" || !token) return fail("That invite link is incomplete.");

  const { data: invite } = await db.from("invites").select("token, user_id, expires_at, used_at").eq("token", token).maybeSingle();
  if (!invite) return fail("That invite doesn't exist.", 404);
  if (invite.used_at) return fail("That invite was already used.", 410);
  if (new Date(invite.expires_at).getTime() < Date.now()) return fail("That invite expired. Ask for a new one.", 410);
  if (invite.user_id === user.id) return fail("You can't be your own partner.");

  const { data: inviter } = await db.from("profiles_user").select("email, display_name").eq("id", invite.user_id).maybeSingle();
  const { data: existingPin } = await db.from("pins").select("user_id").eq("user_id", user.id).maybeSingle();
  const from = inviter?.display_name || inviter?.email || "Someone";

  if (action === "peek") return json({ from, email: inviter?.email ?? null, needsPin: !existingPin });
  if (action !== "accept") return fail("Unknown action.");

  if (!existingPin && !validPin(pin)) return fail("Choose a PIN of 6 to 12 digits.");

  const { error: linkError } = await db.from("partnerships").insert({ user_id: invite.user_id, partner_id: user.id });
  if (linkError) {
    return fail(linkError.code === "23505" ? `${from} already has a partner.` : "Couldn't link you. Try again.", 409);
  }
  await db.from("invites").update({ used_at: new Date().toISOString() }).eq("token", token);
  if (validPin(pin)) {
    await db.from("pins").upsert({ user_id: user.id, pin_hash: await hashPin(pin), failed_attempts: 0, locked_until: null, updated_at: new Date().toISOString() });
  }
  await db.from("notifications").insert({ recipient_id: invite.user_id, kind: "partner_joined", payload: { partner: user.email } });
  return json({ ok: true, from });
});
