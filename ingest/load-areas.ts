// Replace areas from the committed extract, then recompute the district score grid.
import { readFileSync } from "node:fs";
import { serviceClient } from "./db.ts";

const db = serviceClient();
const payload = JSON.parse(readFileSync("ingest/data/bangkok-areas.json", "utf8"));

let t = Date.now();
const loaded = await db.rpc("load_areas", { payload });
if (loaded.error) throw new Error(`load_areas: ${loaded.error.message}`);
console.log(`load_areas: ${payload.length} areas in ${Date.now() - t} ms`);

t = Date.now();
const refreshed = await db.rpc("refresh_score_reference");
if (refreshed.error) throw new Error(`refresh_score_reference: ${refreshed.error.message}`);
console.log(`refresh_score_reference: ${Date.now() - t} ms`);
