# Flood Score — MVP Design

Date: 2026-10-02
Status: approved in brainstorming, pending written-spec review

## 1. Goal

A web app where a Bangkok renter (student or worker) enters the address of a dorm/condo they are considering and gets a **Flood Score**: how often that spot has flooded compared with the rest of Bangkok, with the evidence behind the number. Answers "does this place flood often, should I move here?" — not "is it flooded right now?" (crowded by existing real-time apps).

Constraints: solo developer + AI agents, ~2 days, MVP only, but production-grade foundation (strong database, strong security). Stack: Next.js on Vercel, Supabase (Postgres + PostGIS), GitHub Actions.

### Success criteria (definition of done)

1. Address/pin anywhere in Bangkok returns score + evidence in < 2 s.
2. Ingest runs hourly and automatically, status green.
3. All tests pass in CI.
4. Supabase security advisor reports no warnings.
5. Spike check passes: Prawet, Lat Krabang, Min Buri, Nong Chok, Bang Khen score high; Thon Buri scores low; Bang Na in between.

### Evidence behind the idea (spike, 2026-10-02)

- Traffy Fondue public API returns flood complaints (`problem_type=น้ำท่วม`) as GeoJSON, no key: 41,731 total since 2021; 13,109 in Sep 2026.
- District ranking for Sep 2026 matched local knowledge 7/7 inside Bangkok (Prawet #1 with 773 reports, Thon Buri #39 with 19).
- Outside Bangkok (Rangsit, Bang Phli) Traffy has almost no data → MVP is Bangkok-only.

## 2. Scope

**MVP (build now)**
1. Homepage overview: Bangkok flood heatmap + top 10 most-flooded districts + one search box.
2. Area pages `/khet/[district]` (optional `?khwaeng=[subdistrict]`): district/subdistrict flood summary.
3. Search address, place name, district or subdistrict (typo-tolerant), or drop pin → Flood Score 0–100 + label + evidence.
4. Map of past flood reports around the point, with 300 m radius ring.
5. Monthly bar chart (which months are risky).
6. Data-source and bias disclaimer; "data updated X ago" indicator.
7. Shareable URLs (`/check?lat=..&lng=..`, `/khet/[district]`).

**Deferred — the design must leave room (see §8)**
- v1.1: optional daily destination (work/university) and "can I get there on a rainy day" route check; GISTDA satellite flood zones; areas outside Bangkok.
- v2: crowd reports with photos, CCTV + AI flood detection.

**Out of scope**: user accounts, Sentry/observability stack, H3/materialized aggregates, building-level answers (e.g. "does the parking flood").

## 3. Architecture

```
Browser (Next.js on Vercel)          -- holds NO Supabase key
   |
Next.js Route Handlers /api/v1/*     -- zod validation, coord rounding, edge cache, rate limit
   |  server-only key with EXECUTE on RPCs only
Supabase Postgres + PostGIS
   - flood_reports, ingest_runs, score_reference
   - RPC flood_score_v1(), flood_points_v1()   <- the only read path
   ^
GitHub Actions (hourly cron)         -- TypeScript ingest, service-role key in GH secret
   |
Traffy Fondue public API
```

One language (TypeScript) across app and ingest; zod schemas and generated DB types are shared.

### Repository layout

```
app/                    Next.js App Router (page + /api/v1 route handlers)
lib/                    shared zod schemas, Bangkok bounds, Supabase server client
ingest/
  sources/traffy.ts     fetch + map Traffy features to flood_reports rows
  run.ts                hourly incremental run
  backfill.ts           one-time historical load
supabase/
  migrations/           all schema changes (no dashboard click-ops)
  tests/                pgTAP tests
.github/workflows/      ingest.yml (cron), ci.yml (PR checks), db-push.yml (manual)
docs/superpowers/specs/ this file
```

## 4. Database

### Tables

```sql
create extension if not exists postgis;

create table public.flood_reports (
  source       text        not null default 'traffy',
  source_id    text        not null,             -- Traffy ticket_id
  reported_at  timestamptz not null,
  finished_at  timestamptz,
  geom         geography(Point, 4326) not null,
  district     text,
  subdistrict  text,
  state        text,
  ingested_at  timestamptz not null default now(),
  primary key (source, source_id)
);
create index flood_reports_geom_idx        on public.flood_reports using gist (geom);
create index flood_reports_reported_at_idx on public.flood_reports (reported_at);

create table public.ingest_runs (
  id            bigint generated always as identity primary key,
  source        text        not null,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  status        text        not null check (status in ('running','ok','partial','failed')),
  window_start  timestamptz,
  window_end    timestamptz,
  rows_upserted int,
  rows_rejected int,
  error         text
);

create table public.score_reference (
  score_version  int  not null,
  grid_point     geography(Point, 4326) not null,
  weighted_count real not null
);
```

Privacy (PDPA): reporter free text, photos, names are **not** stored. Only fields needed for scoring and display.

### Score formula (score_version = 1)

Constants: score radius fixed at 300 m (the reference grid is computed with the same radius, so the percentile is only valid at 300 m), decay half-life 2 years, reference grid 500 m over Bangkok bounds (~6,000 points).

1. `weighted_count(p) = Σ 0.5 ^ (age_years(report) / 2)` over reports within radius of `p` (`ST_DWithin` on geography).
2. `score = round(100 × percent_rank(weighted_count(p)) against score_reference rows of the current score_version)`.
3. Label: 0–39 ต่ำ, 40–69 ปานกลาง, 70–89 สูง, 90–100 สูงมาก.
4. Zero reports nearby → score 0 with text "ไม่มีรายงานใน Traffy" — never "ปลอดภัย".

`refresh_score_reference()` recomputes the grid in one transaction (delete + insert for current version), so readers never see an empty table.

### RPCs (the only read path)

- `flood_score_v1(lat double precision, lng double precision) returns jsonb` — radius fixed at 300 m
  Returns `{score, label, weighted_count, report_count, years_with_reports, years_covered, monthly_counts[12], latest_report_at, data_updated_at, score_version}`.
- `flood_points_v1(lat, lng, radius_m int default 300) returns table(lat, lng, reported_at, state)` — max 500 rows, newest first; radius_m allowed 100–1000.

- `flood_overview_v1() returns jsonb` — heatmap cells (from `score_reference`: grid point + weighted_count) and district ranking `{district, weighted_count, reports_this_year, rank}` for all 50 districts.
- `flood_area_v1(district text, subdistrict text default null) returns jsonb` — rank among districts, yearly counts, monthly counts, subdistrict ranking inside the district, latest report. Unknown names raise an error.

All RPCs: `security definer`, `set search_path = ''`, `stable`; point RPCs raise an error if the point is outside Bangkok bounds (and, for points, if radius is outside 100–1000).

### Security

- RLS enabled on every table; no policies granting `anon`/`authenticated` table access. Revoke all table privileges from `anon`, `authenticated`.
- `grant execute` on the four RPCs to the role used by the web app only.
- Service-role key exists only as a GitHub Actions secret (ingest). Never in Vercel, never `NEXT_PUBLIC_*`.
- Separate Supabase projects for dev and prod.
- Supabase security advisor run before first deploy; all warnings fixed.

## 5. Ingest pipeline

### Hourly run (`ingest/run.ts`, GitHub Actions cron `0 * * * *`)

1. Workflow `concurrency` group prevents overlapping runs.
2. Insert `ingest_runs` row, status `running`.
3. Fetch the last 48 h, one day per request. Timeout 120 s, 3 retries with exponential backoff. If API `total` > returned rows (1,000 cap), split the window and refetch; if still capped, finish as `partial`.
4. Validate each feature with zod (ticket_id, timestamp, coordinates inside Bangkok bounds). Invalid rows are counted in `rows_rejected`, not fatal. If > 20 % rejected → `failed`, nothing written (guards against Traffy format changes).
5. Upsert in batches of 500: `on conflict (source, source_id) do update set state, finished_at`. Idempotent.
6. Call `refresh_score_reference()`.
7. Close the run as `ok` / `partial` / `failed` with error text.

### Backfill (`ingest/backfill.ts`, run once locally or via `workflow_dispatch`)

Load 2021→now from data.bangkok.go.th Traffy CSV (filtered to flood) plus API days not covered by the CSV. Acceptance: flood rows in DB within 5 % of the API's reported `total` (~41.7k).

### Failure handling

| Event | Result |
| --- | --- |
| Traffy down / timeout after retries | run `failed`, GitHub emails owner, existing data untouched; next run's 48 h window fills the gap |
| Traffy format change | zod rejects; > 20 % → run `failed`, bad data never written |
| Supabase down | upsert fails, run `failed`, retried next hour |
| No successful run for > 24 h | UI shows banner "ข้อมูลอัปเดตล่าสุด X ชม. ก่อน" |

Fallback if GitHub Actions proves too hard for the owner: Vercel Cron daily calling the same ingest code (verify plan limits first).

## 6. API (Next.js Route Handlers)

| Route | Calls | Cache |
| --- | --- | --- |
| `GET /api/v1/score?lat&lng` | `flood_score_v1` | `s-maxage=3600, stale-while-revalidate=86400` |
| `GET /api/v1/points?lat&lng` | `flood_points_v1` | same |
| `GET /api/v1/overview` | `flood_overview_v1` | `s-maxage=3600, stale-while-revalidate=86400` |
| `GET /api/v1/area?district&subdistrict` | `flood_area_v1` | same |
| `GET /api/v1/status` | latest successful `ingest_runs` | `s-maxage=300` |

- zod validation; lat/lng rounded to a ~50 m grid before the DB call and cache key, so nearby searches share cache.
- Errors: 400 invalid input (Thai message), 422 outside Bangkok ("ตอนนี้รองรับเฉพาะกรุงเทพ"), 503 database unavailable. No stack traces in responses; details logged server-side.
- Rate limit: Vercel Firewall rule on `/api/*`, ~60 req/min/IP (verify plan support; Upstash as fallback).
- Geocoding: browser calls MapTiler directly with a domain-restricted key.

### Search and typo handling (no AI)

User input is error-prone (misspellings, partial addresses). Handled in three layers, no LLM (cost, latency, confident wrong guesses, prompt-injection surface):

1. District/subdistrict names: client-side fuzzy match (edit distance) against a static list of ~230 names generated from the data, after normalising (strip "เขต", "แขวง", whitespace) and including English names (e.g. "Prawet"). Shows "คุณหมายถึง ประเวศ?". Area matches are listed first in autocomplete.
2. Addresses/place names: geocoder autocomplete (typo-tolerant) as the user types.
3. Human confirmation: before scoring, the resolved point is shown as a draggable pin; the user confirms or drags it. This catches every error the first two layers miss.

## 7. Frontend

Pages: `/` (overview + search), `/check?lat=..&lng=..` (point result), `/khet/[district]` (area summary; statically generated per district, revalidated hourly, indexable by search engines). Mobile-first, Thai UI (Noto Sans Thai or IBM Plex Sans Thai). Visual design done with the ui-ux-pro-max skill during implementation.

- Homepage: heatmap of Bangkok (MapLibre heatmap layer from overview cells), top 10 districts list linking to `/khet/...`, single search box.
- Search box (area fuzzy match + MapTiler geocoding) + tap-to-pin on MapLibre map; draggable pin confirmation before scoring.
- Map: report points + 300 m ring.
- Result card: big score, label, "เสี่ยงกว่า X% ของพื้นที่กรุงเทพ", evidence list, monthly bar chart, disclaimer (source = Traffy, biased toward areas where people report), data-updated time.
- State in URL for sharing (`/check?lat&lng`, `/khet/[district]`).
- Accessibility: risk never conveyed by color alone, full keyboard use, result announced via `aria-live`.
- Security headers in `next.config`: CSP (self + MapTiler domains), HSTS, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`.

## 8. Room for later (extension points)

| Later feature | Where it plugs in |
| --- | --- |
| Crowd reports, CCTV | new `source` values in `flood_reports` + new file in `ingest/sources/` |
| GISTDA flood zones | new `flood_zones` polygon table; new score version |
| Formula changes | bump `score_version`; `/api/v1` stays, `/api/v2` alongside |
| Daily destination / route check | extra optional input + section in result card; layout reserves the slot |
| Outside Bangkok | widen bounds once a data source covers it |

## 9. Testing and CI

| Layer | Tool | Cases |
| --- | --- | --- |
| DB security | pgTAP | anon cannot select/insert any table; only the four RPCs executable |
| Score | pgTAP | fixture data with known answers: decay, percentile, labels, zero-report case, out-of-bounds and bad radius errors |
| Ingest | Vitest | Traffy mapping, zod rejects, > 20 % reject fails run, 1,000-cap split, idempotent upsert |
| API | Vitest | 400 / 422 / 503, no stack leak, cache headers |
| Search | Vitest | fuzzy match: "ประเวท" → ประเวศ, "เขตลาดกระบัง" → ลาดกระบัง, "Prawet" → ประเวศ, nonsense → no match |
| Main flow | Playwright | homepage shows heatmap + top 10 → search → confirm pin → score shown → share link reproduces result; district page loads (fixture data, no live Traffy) |
| Reality check | script | spike districts rank as expected |

CI (`ci.yml`, every PR): lint → typecheck → Vitest → `supabase db reset` + pgTAP → Playwright.
Deploy: Vercel auto-deploys `main`. Prod migrations via manual `db-push.yml` (`supabase db push`), never automatic.

## 10. Open items to verify during implementation

1. Traffy 1,000-row cap: does `start`/`end` accept datetimes for window splitting, or must backfill rely on the CSV?
2. data.bangkok.go.th Traffy CSV license is "not specified" — fine for a course project; ask BMA before a public launch.
3. Vercel Hobby limits: cron frequency, function duration, Firewall rate-limit availability.
4. MapTiler free-tier quota, domain restriction, and Thai address quality; if Thai results are poor, switch geocoder to Longdo Map.
5. Supabase and Vercel MCP servers were not loaded in the brainstorming session; restart Claude Code before implementation.
6. Cut order if time runs short: subdistrict view on area pages first, then static generation of area pages (fall back to on-demand).
