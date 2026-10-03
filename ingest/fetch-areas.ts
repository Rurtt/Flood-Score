// Bangkok administrative boundaries. Data © OpenStreetMap contributors, ODbL.
import { writeFileSync } from "node:fs";
import { toArea, type OsmRelation } from "./areas.ts";

const QUERY = `[out:json][timeout:180];
area["ISO3166-2"="TH-10"]->.bkk;
(relation["boundary"="administrative"]["admin_level"~"^(6|8)$"](area.bkk););
out geom;`;
// Mirrors may serve stale data; accept only the complete 50/180 extract.
const ENDPOINTS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];

for (const url of ENDPOINTS) {
  try {
    const res = await fetch(url, {
      method: "POST",
      body: new URLSearchParams({ data: QUERY }),
      headers: { "User-Agent": "flood-score/0.1 (boundary extract)" },
      signal: AbortSignal.timeout(240_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const areas = ((await res.json()).elements as OsmRelation[]).map(toArea);
    const districts = areas.filter((a) => a.level === "district").length;
    const subdistricts = areas.length - districts;
    if (districts !== 50 || subdistricts !== 180) throw new Error(`got ${districts}/${subdistricts}, expected 50/180`);
    areas.sort((a, b) => a.level.localeCompare(b.level) || a.name_th.localeCompare(b.name_th, "th"));
    writeFileSync("ingest/data/bangkok-areas.json", JSON.stringify(areas));
    console.log(`wrote ${districts} districts, ${subdistricts} subdistricts from ${url}`);
    process.exit(0);
  } catch (e) {
    console.error(`${url}: ${e instanceof Error ? e.message : e}`);
  }
}
process.exit(1);
