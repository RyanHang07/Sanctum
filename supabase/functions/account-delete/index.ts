// Deletes the signed-in account (v0.1, required for Google's OAuth policy). Every row that
// belongs to it goes with it: profile, partner links both ways, invites, PIN, unlock requests,
// and notifications all cascade from auth.users. Data on the user's own PC is untouched.
// Self-contained (no _shared import) so it deploys without the email templates.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const fail = (error: string, status = 400) => json({ error }, status);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return fail("Use POST.", 405);
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data } = jwt ? await db.auth.getUser(jwt) : { data: { user: null } };
  const user = data.user;
  if (!user) return fail("Sign in first.", 401);
  const { confirm } = await req.json().catch(() => ({}));
  if (confirm !== "delete") return fail("Confirm the deletion first.");
  const { error } = await db.auth.admin.deleteUser(user.id);
  if (error) return fail("Couldn't delete the account. Try again.", 500);
  return json({ deleted: true });
});
