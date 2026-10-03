import { z } from "zod";
import { inBangkok } from "../lib/bangkok.ts";

export const TRAFFY_URL = "https://publicapi.traffy.in.th/teamchadchart-stat-api/geojson/v1";
export const PAGE_SIZE = 1000; // API maximum; its default is only 300
const TIMEOUT_MS = 120_000;
const RETRIES = 3;
const BANGKOK_OFFSET_MS = 7 * 3600_000;

export type Window = { start: string; end: string }; // Bangkok dates YYYY-MM-DD, both inclusive
export type FloodRow = {
  source: string;
  source_id: string;
  reported_at: string;
  finished_at: string | null;
  geom: string;
  state: string | null;
};
export type FetchOptions = { fetchFn?: typeof fetch; retryDelayMs?: number };
export type Fetched = { rows: FloodRow[]; rejected: number; total: number; complete: boolean };

// Only the fields we store are parsed; everything else (reporter text, photos, address) is dropped (PDPA).
const featureSchema = z.object({
  geometry: z.object({ type: z.literal("Point"), coordinates: z.array(z.number()).min(2) }),
  properties: z.object({
    ticket_id: z.string().min(1),
    timestamp: z.string(),
    timestamp_finished: z.string().nullish(),
    state: z.string().nullish(),
  }),
});

// The API also answers {"status":"fail"} with HTTP 200; that must be an error, not an empty result.
const pageSchema = z.object({
  status: z.literal("success"),
  total: z.number().int().nonnegative(),
  features: z.array(z.unknown()).max(PAGE_SIZE),
});
const identitySchema = z.object({ properties: z.object({ ticket_id: z.string().min(1) }) });

// Traffy timestamps are Bangkok wall-clock time without an offset, e.g. "2026-09-15 22:44:31".
export function bangkokToIso(ts: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(ts)) return null;
  const local = ts.replace(" ", "T");
  const ms = new Date(`${local}+07:00`).getTime();
  if (Number.isNaN(ms)) return null;
  // Round-trip rejects impossible dates (2026-02-30) that Date would otherwise roll over.
  return new Date(ms + BANGKOK_OFFSET_MS).toISOString().slice(0, 19) === local ? `${local}+07:00` : null;
}

export function bangkokDate(d: Date): string {
  return new Date(d.getTime() + BANGKOK_OFFSET_MS).toISOString().slice(0, 10);
}

export function toRow(feature: unknown): FloodRow | null {
  const parsed = featureSchema.safeParse(feature);
  if (!parsed.success) return null;
  const [lng, lat] = parsed.data.geometry.coordinates;
  const p = parsed.data.properties;
  const reportedAt = bangkokToIso(p.timestamp);
  const finishedAt = p.timestamp_finished == null ? null : bangkokToIso(p.timestamp_finished);
  if (p.timestamp_finished != null && finishedAt === null) return null;
  if (!reportedAt || !inBangkok(lat, lng)) return null;
  return {
    source: "traffy",
    source_id: p.ticket_id,
    reported_at: reportedAt,
    finished_at: finishedAt,
    geom: `SRID=4326;POINT(${lng} ${lat})`,
    state: p.state ?? null,
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchPage(window: Window, offset: number, fetchFn: typeof fetch, retryDelayMs: number) {
  const query = new URLSearchParams({
    problem_type: "น้ำท่วม",
    start: window.start,
    end: window.end,
    limit: String(PAGE_SIZE),
    offset: String(offset),
  });
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetchFn(`${TRAFFY_URL}?${query}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) throw new Error(`Traffy HTTP ${res.status}`);
      const page = pageSchema.safeParse(await res.json());
      if (!page.success) throw new Error("Traffy page rejected");
      return page.data;
    } catch {
      if (attempt >= RETRIES) throw new Error("Traffy fetch failed after 4 attempts");
      await sleep(retryDelayMs * 2 ** attempt);
    }
  }
}

export async function fetchTraffy(window: Window, opts: FetchOptions = {}): Promise<Fetched> {
  const { fetchFn = fetch, retryDelayMs = 1000 } = opts;
  const byId = new Map<string, FloodRow>(); // a ticket can repeat across pages if new reports arrive mid-run
  const seenIds = new Set<string>();
  let rejected = 0;
  let total = 0;
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const page = await fetchPage(window, offset, fetchFn, retryDelayMs);
    total = page.total;
    for (const f of page.features) {
      const identity = identitySchema.safeParse(f);
      if (identity.success) {
        const id = identity.data.properties.ticket_id;
        if (seenIds.has(id)) continue;
        seenIds.add(id);
      }
      const row = toRow(f);
      if (row) byId.set(row.source_id, row);
      else rejected++;
    }
    if (page.features.length < PAGE_SIZE || offset + PAGE_SIZE >= total) break;
  }
  return { rows: [...byId.values()], rejected, total, complete: byId.size + rejected >= total };
}
