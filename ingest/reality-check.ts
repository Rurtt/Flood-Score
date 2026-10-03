// Use the public read key, matching the web application's overview request.
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../lib/database.types.ts";
import { spikeFailures, type DistrictRank } from "./reality.ts";
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_RPC_KEY;
if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_RPC_KEY must be set");
const db = createClient<Database>(url, key, { auth: { persistSession: false } });
const { data, error } = await db.rpc("flood_overview_v1");
if (error) throw new Error(error.message);
const districts = (data as { districts: DistrictRank[] }).districts;
console.log(districts.slice(0, 10).map((d) => `${d.rank}. ${d.district}`).join("\n"));
const failures = spikeFailures(districts);
console.log(failures.length ? `FAIL\n${failures.join("\n")}` : "spike check passed");
if (failures.length) process.exitCode = 1;
