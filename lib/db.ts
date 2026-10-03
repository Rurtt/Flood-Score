import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

// Server-only. This key maps to the `anon` role, which can execute the five read RPCs and nothing else.
// Never expose it through a NEXT_PUBLIC_* variable.
export function getDb(): SupabaseClient<Database> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_RPC_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_RPC_KEY must be set");
  return createClient<Database>(url, key, { auth: { persistSession: false } });
}
