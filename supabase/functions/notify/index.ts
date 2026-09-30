// Tells the partner what happened (SPEC 4.6): a broken seal, a lost streak, an emergency
// unlock. Stored as a notification and emailed through Brevo when BREVO_API_KEY and
// BREVO_SENDER are set as Supabase secrets; without them it's stored only.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { admin, caller, cors, fail, json } from "../_shared/util.ts";

const KINDS: Record<string, (who: string, detail: string) => { subject: string; line: string }> = {
  session_broken: (who, d) => ({ subject: `${who} broke a Sanctum seal`, line: `${who} broke a focus seal${d ? ` (${d})` : ""}. Their streak reset.` }),
  streak_lost: (who, d) => ({ subject: `${who} lost their Sanctum streak`, line: `${who}'s streak reset${d ? `: ${d}` : ""}.` }),
  emergency_unlock: (who, d) => ({ subject: `${who} used an emergency unlock`, line: `${who} used their weekly emergency unlock${d ? `: ${d}` : ""}.` }),
};
const DAILY_LIMIT = 20;

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const db = admin();
  const user = await caller(req, db);
  if (!user) return fail("Sign in first.", 401);

  const { kind, detail } = await req.json().catch(() => ({}));
  const make = KINDS[kind];
  if (!make) return fail("Unknown notification.");

  const { data: link } = await db.from("partnerships").select("partner_id").eq("user_id", user.id).neq("status", "ended").maybeSingle();
  if (!link) return json({ ok: true, sent: false, reason: "no partner" });

  const since = new Date(Date.now() - 86_400_000).toISOString();
  const { count } = await db.from("notifications").select("id", { count: "exact", head: true }).eq("payload->>from", user.id).gte("created_at", since);
  if ((count ?? 0) >= DAILY_LIMIT) return fail("Too many notifications today.", 429);

  const { data: me } = await db.from("profiles_user").select("display_name, email").eq("id", user.id).maybeSingle();
  const { data: partner } = await db.from("profiles_user").select("email").eq("id", link.partner_id).maybeSingle();
  const who = me?.display_name || me?.email || "Your friend";
  const text = typeof detail === "string" ? detail.slice(0, 200) : "";
  const { subject, line } = make(who, text);

  const { data: row } = await db
    .from("notifications")
    .insert({ recipient_id: link.partner_id, kind, payload: { from: user.id, who, detail: text } })
    .select("id")
    .single();

  const key = Deno.env.get("BREVO_API_KEY");
  const sender = Deno.env.get("BREVO_SENDER");
  if (!key || !sender || !partner?.email) return json({ ok: true, sent: false, reason: "email not configured" });

  const site = Deno.env.get("PARTNER_APP_URL") ?? "";
  const html = `<div style="font:15px system-ui,sans-serif;color:#111">
<p>${escape(line)}</p>
${site ? `<p><a href="${escape(site)}">Open the partner page</a></p>` : ""}
<p style="color:#666;font-size:13px">You're ${escape(who)}'s accountability partner on Sanctum.</p></div>`;
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": key, "Content-Type": "application/json", accept: "application/json" },
    body: JSON.stringify({ sender: { email: sender, name: "Sanctum" }, to: [{ email: partner.email }], subject, htmlContent: html }),
  });
  if (res.ok && row) await db.from("notifications").update({ emailed: true }).eq("id", row.id);
  return json({ ok: true, sent: res.ok });
});
