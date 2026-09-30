import { createClient } from "@supabase/supabase-js";

// Defaults are the public values from .env.example, so a fresh checkout runs as is.
const url = import.meta.env.VITE_SUPABASE_URL ?? "https://phihiaeejhdnfavtianf.supabase.co";
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "sb_publishable_WghC6M04Os0iCSboCEi_gA_qtIpLDdl";

export const supabase = createClient(url, key, { auth: { flowType: "pkce", detectSessionInUrl: true, persistSession: true } });

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
