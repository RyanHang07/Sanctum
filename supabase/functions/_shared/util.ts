// Shared by Sanctum's Edge Functions (SPEC 4.6). The service role key never leaves Supabase.
import { createClient, type SupabaseClient, type User } from "npm:@supabase/supabase-js@2";
import { argon2id } from "npm:hash-wasm@4";

export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

export const fail = (error: string, status = 400) => json({ error }, status);

export function admin(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
}

/** The signed-in caller, from the Authorization header. */
export async function caller(req: Request, db: SupabaseClient): Promise<User | null> {
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) return null;
  const { data } = await db.auth.getUser(jwt);
  return data.user ?? null;
}

export const validPin = (pin: unknown): pin is string => typeof pin === "string" && /^\d{6,12}$/.test(pin);

/** argon2id, encoded with its salt and parameters (OWASP's minimum: 19 MiB, 2 passes). */
export function hashPin(pin: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return argon2id({ password: pin, salt, parallelism: 1, iterations: 2, memorySize: 19456, hashLength: 32, outputType: "encoded" });
}

import type { Email } from "./email.ts";

/** Sends through Brevo when BREVO_API_KEY and BREVO_SENDER are set. Returns whether it went. */
export async function sendEmail(to: string, email: Email): Promise<boolean> {
  const key = Deno.env.get("BREVO_API_KEY");
  const sender = Deno.env.get("BREVO_SENDER");
  if (!key || !sender || !to) return false;
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": key, "Content-Type": "application/json", accept: "application/json" },
    body: JSON.stringify({ sender: { email: sender, name: "Sanctum" }, to: [{ email: to }], subject: email.subject, htmlContent: email.html, textContent: email.text }),
  });
  return res.ok;
}

/** The deployed partner page, without a trailing slash ("" when unset). */
export const partnerSite = () => (Deno.env.get("PARTNER_APP_URL") ?? "").replace(/\/+$/, "");
