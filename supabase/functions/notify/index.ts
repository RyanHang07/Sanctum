// Tells the partner what happened (SPEC 4.6): an unlock request, a broken seal, a lost streak,
// an emergency unlock. Stored as a notification and emailed through Brevo when BREVO_API_KEY
// and BREVO_SENDER are set as Supabase secrets; without them it's stored only.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { admin, caller, cors, fail, json, partnerSite, sendEmail } from "../_shared/util.ts";
import { renderEmail, type EmailKind } from "../_shared/email.ts";

const KINDS: EmailKind[] = ["session_broken", "streak_lost", "emergency_unlock", "unlock_request"];
const DAILY_LIMIT = 20;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const db = admin();
  const user = await caller(req, db);
  if (!user) return fail("Sign in first.", 401);

  const { kind, detail, requestId, profile, minutesIn } = await req.json().catch(() => ({}));
  if (!KINDS.includes(kind)) return fail("Unknown notification.");

  const { data: link } = await db.from("partnerships").select("partner_id").eq("user_id", user.id).neq("status", "ended").maybeSingle();
  if (!link) return json({ ok: true, sent: false, reason: "no partner" });

  const since = new Date(Date.now() - 86_400_000).toISOString();
  const { count } = await db.from("notifications").select("id", { count: "exact", head: true }).eq("payload->>from", user.id).gte("created_at", since);
  if ((count ?? 0) >= DAILY_LIMIT) return fail("Too many notifications today.", 429);

  const { data: me } = await db.from("profiles_user").select("display_name, email").eq("id", user.id).maybeSingle();
  const { data: partner } = await db.from("profiles_user").select("email").eq("id", link.partner_id).maybeSingle();
  const who = me?.display_name || me?.email || "Your friend";
  const text = typeof detail === "string" ? detail.slice(0, 400) : "";

  const { data: row } = await db
    .from("notifications")
    .insert({ recipient_id: link.partner_id, kind, payload: { from: user.id, who, detail: text } })
    .select("id")
    .single();

  const site = partnerSite();
  const target = kind === "unlock_request" && typeof requestId === "string" && /^[0-9a-f-]{36}$/i.test(requestId) ? `${site}/approve/${requestId}` : `${site}/`;
  const email = renderEmail(kind, {
    who,
    detail: text,
    profile: typeof profile === "string" ? profile.slice(0, 60) : undefined,
    minutesIn: typeof minutesIn === "number" ? Math.max(0, Math.round(minutesIn)) : undefined,
    link: site ? target : undefined,
  });
  const sent = await sendEmail(partner?.email ?? "", email);
  if (sent && row) await db.from("notifications").update({ emailed: true }).eq("id", row.id);
  return json({ ok: true, sent });
});
