// The partner approves or denies an early unlock with their PIN (SPEC 4.5). Requests expire
// after 30 minutes; 3 wrong PINs lock approvals for 30 minutes. All checked here, server-side.
// The person sealed in also gets an email with the answer, in case Sanctum is closed.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { argon2Verify } from "npm:hash-wasm@4";
import { admin, caller, cors, fail, json, sendEmail } from "../_shared/util.ts";
import { renderEmail } from "../_shared/email.ts";

const TTL_MS = 30 * 60_000;
const LOCK_MS = 30 * 60_000;
const MAX_TRIES = 3;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const db = admin();
  const user = await caller(req, db);
  if (!user) return fail("Sign in first.", 401);

  const { requestId, approve, pin, note } = await req.json().catch(() => ({}));
  if (typeof requestId !== "string" || typeof approve !== "boolean" || typeof pin !== "string") return fail("Incomplete answer.");

  const { data: request } = await db.from("unlock_requests").select("id, user_id, status, created_at").eq("id", requestId).maybeSingle();
  if (!request) return fail("That request doesn't exist.", 404);
  const { data: link } = await db
    .from("partnerships")
    .select("id")
    .eq("user_id", request.user_id)
    .eq("partner_id", user.id)
    .neq("status", "ended")
    .maybeSingle();
  if (!link) return fail("You're not their partner.", 403);
  if (request.status !== "pending") return fail("That request was already answered.", 409);
  if (new Date(request.created_at).getTime() + TTL_MS < Date.now()) {
    await db.from("unlock_requests").update({ status: "expired", resolved_at: new Date().toISOString() }).eq("id", requestId);
    return fail("That request expired.", 410);
  }

  const { data: stored } = await db.from("pins").select("pin_hash, failed_attempts, locked_until").eq("user_id", user.id).maybeSingle();
  if (!stored) return fail("Set a PIN first.", 403);
  if (stored.locked_until && new Date(stored.locked_until).getTime() > Date.now()) {
    const min = Math.ceil((new Date(stored.locked_until).getTime() - Date.now()) / 60_000);
    return fail(`Too many wrong PINs. Approvals open again in ${min} min.`, 423);
  }
  const ok = await argon2Verify({ password: pin, hash: stored.pin_hash }).catch(() => false);
  if (!ok) {
    const tries = stored.failed_attempts + 1;
    const locked = tries >= MAX_TRIES;
    await db
      .from("pins")
      .update({ failed_attempts: locked ? 0 : tries, locked_until: locked ? new Date(Date.now() + LOCK_MS).toISOString() : null })
      .eq("user_id", user.id);
    return fail(locked ? "Wrong PIN. Approvals are locked for 30 minutes." : `Wrong PIN. ${MAX_TRIES - tries} ${MAX_TRIES - tries === 1 ? "try" : "tries"} left.`, 403);
  }

  await db.from("pins").update({ failed_attempts: 0, locked_until: null }).eq("user_id", user.id);
  const text = typeof note === "string" ? note.trim().slice(0, 280) : "";
  await db
    .from("unlock_requests")
    .update({ status: approve ? "approved" : "denied", note: text || null, resolved_at: new Date().toISOString() })
    .eq("id", requestId)
    .eq("status", "pending");
  const [{ data: sealedIn }, { data: me }] = await Promise.all([
    db.from("profiles_user").select("email").eq("id", request.user_id).maybeSingle(),
    db.from("profiles_user").select("display_name, email").eq("id", user.id).maybeSingle(),
  ]);
  await sendEmail(sealedIn?.email ?? "", renderEmail("unlock_decided", { partner: me?.display_name || me?.email || "Your partner", approved: approve, note: text || undefined })).catch(() => false);
  return json({ ok: true, status: approve ? "approved" : "denied" });
});
