import { createClient } from "@supabase/supabase-js";

// Your Supabase project, from partner/.env.local or the host's environment (see
// docs/self-hosting.md). The publishable key is public by design; RLS guards the data.
const url = import.meta.env.VITE_SUPABASE_URL ?? "";
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "";

/** False until the Supabase project is set; the page then says so instead of failing. */
export const configured = !!url && !!key;

export const supabase = createClient(url || "http://localhost:54321", key || "unset", { auth: { flowType: "pkce", detectSessionInUrl: true, persistSession: true } });

/** Calls an Edge Function and returns its JSON, or throws its error message. */
export async function call<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    const ctx = (error as { context?: Response }).context;
    const msg = ctx ? ((await ctx.json().catch(() => null)) as { error?: string } | null)?.error : null;
    throw new Error(msg ?? error.message);
  }
  return data as T;
}
