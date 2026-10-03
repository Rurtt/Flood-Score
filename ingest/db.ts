import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../lib/database.types.ts";

export type Db = SupabaseClient<Database>;

// Service-role credentials belong only in Actions secrets or local .env.ingest.
export function serviceClient(): Db {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  return createClient<Database>(url, key, { auth: { persistSession: false } });
}
