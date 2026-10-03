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

Pages: `/` (overview + search), `/check?lat=..&lng=..` (point result), `/khet/[district]` (area summary; statically generated per district, revalidated hourly, indexable by search engines). Mobile-first, Thai UI. State lives in the URL so every result is shareable.

Product name: **Flood Score**, Thai tagline "เช็กน้ำท่วมก่อนเช่า". MVP domain `floodscore.vercel.app`; custom domain decided at launch. Mockups of the chosen direction (and the two rejected ones): https://claude.ai/artifact/VvnnoxVY4t9fBwtfrPu1dj

### 7.1 Visual direction: "civic signage" (ป้ายวัดน้ำ)

Looks like a trustworthy public tool, inspired by Bangkok street signage and the red/white water-level staffs on roadsides. Flat base; no extra style blending. Rejected: neumorphism (low contrast), 3D (heavy; MapLibre already uses the GPU), decorative gradients (gradients only where they encode data, i.e. the heatmap), data-journalism and soft-brutalist directions (see mockups).

Style rules:
- Skeuomorphism only in the water-level gauge. Translucent blur only on the search box floating over the map. Line illustrations only in empty / 404 / no-reports states.
- Borders over shadows; card radius 6 px, chip radius 3 px; 4/8 px spacing scale.
- Icons: Lucide only, 2 px stroke. No emoji.
- Motion: one moment only, the gauge water rising over 600 ms when a score loads; everything else 150–200 ms. `prefers-reduced-motion` → no animation.
- Layout: designed at 375 px first; ≥ 1024 px becomes two columns (map left ~60 %, panel right).
- Styling: Tailwind with tokens defined in `@theme`; components use tokens only, never raw hex.

### 7.2 Tokens

| Token | Light | Dark |
| --- | --- | --- |
| `paper` (page) | #EEF2F1 | #0F1A22 |
| `surface` (cards) | #FFFFFF | #16232D |
| `ink` (text, lines) | #10233A | #E3EAEE |
| `muted` | #566673 | #93A3AE |
| `line` | #C9D3D1 | #2A3A45 |
| `water` (gauge fill, links) | #1F5E8C | #6FA8D6 |
| `signal` (brand red) | #C8302B | #E0574F |

Risk colors (light values; dark mode uses one step lighter, each re-checked for contrast):

| Label | Score | Color | Text on chip |
| --- | --- | --- | --- |
| ต่ำ | 0–39 | #3D7A72 | white |
| ปานกลาง | 40–69 | #E0A526 | `ink` (white fails contrast) |
| สูง | 70–89 | #C8302B | white |
| สูงมาก | 90–100 | #8E1B22 | white |
| ไม่มีรายงาน | 0 reports | #8A979F | white; never green, never "ปลอดภัย" |

Typography: Anuphan 700 for headings and score numbers; IBM Plex Sans Thai 400/500 for body at 16 px, line-height 1.6 (Thai vowel marks need the room). Sizes only 12 / 14 / 16 / 20 / 28 / 44. All digits `tabular-nums`. Fonts self-hosted via `next/font` (no external font host in CSP).

Dark mode (in MVP): follows the system by default, toggle in the top bar, choice stored in `localStorage`. A small inline script in `<head>` sets the theme before paint (no flash; allowed in CSP by hash). Map basemap switches to MapTiler `dataviz` / `dataviz-dark`. Both themes must pass WCAG AA (4.5:1 text, 3:1 UI).

### 7.3 Signature component: water-level gauge

Vertical staff with red/white bands every 10 points; water fills to the score. Tick labels at 40 / 70 / 90, the label thresholds, so users see which line the water crossed. Always paired with the big number and label chip; screen readers get "คะแนน 82 จาก 100 ความเสี่ยงสูง". Used only on `/check` (score is per point); area pages use rank instead so the two numbers are never confused. In dark mode the white bands are dimmed. The logo is a small gauge followed by the wordmark "Flood Score"; the gauge alone is the favicon.

### 7.4 Homepage `/`

Mobile, top to bottom:
1. Top bar: logo, "อัปเดต X นาทีก่อน", theme toggle.
2. Heatmap of Bangkok (MapLibre heatmap layer from overview cells), ~55 % of viewport height, with the search box floating on it; legend "น้อย → บ่อย" below.
3. One line: "เช็กว่าที่อยู่ที่จะเช่า น้ำท่วมบ่อยแค่ไหน จากรายงานกว่า 41,000 ครั้งตั้งแต่ปี 2564" (number from data).
4. Top 10 districts: rank, name, proportional bar, report count; each row links to `/khet/...`.
5. Footer: data sources, disclaimer "นำข้อมูลสาธารณะมาจัดแสดงใหม่ ไม่ใช่ประกาศทางการ", link "ดูว่าตอนนี้ท่วมไหม → flood.pop.in.th" (real-time status is their job, not ours).

Desktop: map left, search + top 10 right.

### 7.5 Search and pin confirmation

- Mobile: tapping the search box opens a full-screen search with the keyboard up. Desktop: dropdown.
- Starts at 2 characters, 250 ms debounce. Results in two groups: area matches first (fuzzy, "คุณหมายถึง ประเวศ?"), then places/addresses from MapTiler.
- Always-visible actions: "ใช้ตำแหน่งปัจจุบัน" (browser geolocation; useful when viewing a dorm in person) and "ปักหมุดบนแผนที่เอง".
- Area result → `/khet/...` directly. Address/place/location → confirm step: map zooms in with a draggable pin and 300 m ring, bottom sheet "หมุดตรงตำแหน่งหอไหม? ลากหมุดเพื่อแก้ได้", primary button "ดูคะแนน" → `/check?lat&lng`.
- Errors inline, never in dialogs: no results ("ไม่พบ ลองพิมพ์ชื่อเขต หรือปักหมุดเอง"); outside Bangkok ("ตอนนี้รองรับเฉพาะกรุงเทพ", pin turns grey, button disabled); location denied ("เปิดสิทธิ์ตำแหน่งในเบราว์เซอร์ หรือพิมพ์ที่อยู่แทน").
- Not in MVP: recent-search history.

### 7.6 Result page `/check?lat&lng`

Mobile, top to bottom:
1. Top bar: "← ค้นใหม่", share button (Web Share API; fallback copies the link and shows toast "คัดลอกลิงก์แล้ว").
2. Place: address, subdistrict/district, "รัศมี 300 ม.", link "ดูภาพรวมเขต… →".
3. Score card (`aria-live`): gauge, big number, label chip, "ท่วมบ่อยกว่า X% ของพื้นที่กรุงเทพ".
4. Evidence: reports within radius, years with reports out of years covered, latest report date.
5. Map: report points (older = lighter), 300 m ring, pin; tapping a point shows date and state.
6. Monthly bar chart; risky months in the risk color, plus a text summary ("ท่วมบ่อยสุด ก.ย.–ต.ค.") for screen readers.
7. Reserved slot for the v1.1 destination/route check (not rendered in MVP).
8. Disclaimer (source Traffy, biased toward areas where people report) + real-time link.

Desktop: map left, panel right.

Zero reports: empty gauge, grey chip "ไม่มีรายงานใน Traffy", text "ไม่ได้แปลว่าไม่เคยท่วม อาจแค่ไม่มีคนแจ้ง", line illustration.

### 7.7 Area page `/khet/[district]`

Header "เขต…", chip "อันดับ N จาก 50 เขต", reports this year; district heat map; yearly bar chart 2564–2569 (trend); monthly chart (same component as `/check`); subdistrict ranking with bars (first to cut, see §10); primary button "เช็กที่อยู่ในเขตนี้" opens search. No gauge. SEO title "น้ำท่วมเขต… บ่อยแค่ไหน | Flood Score".

### 7.8 Shared states

| State | UI |
| --- | --- |
| Loading | skeleton in the shape of the real card (no layout shift); gauge fills when data arrives |
| Data older than 24 h | amber banner "ข้อมูลอัปเดตล่าสุด X ชม. ก่อน" |
| 503 | "ระบบข้อมูลขัดข้องชั่วคราว" + "ลองใหม่" button |
| Unknown district (404) | illustration + search box + "คุณหมายถึง…?" |

Not in MVP: offline mode / PWA.

### 7.9 Accessibility and security

- Risk never conveyed by color alone (label text + gauge position); full keyboard use including the pin (arrow keys move it); visible focus rings; touch targets ≥ 44 px; result announced via `aria-live`.
- Security headers in `next.config`: CSP (self + MapTiler domains + hash of the theme script), HSTS, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`.

## 8. Room for later (extension points)

| Later feature | Where it plugs in |
| --- | --- |
| Crowd reports, CCTV | new `source` values in `flood_reports` + new file in `ingest/sources/` |
| GISTDA flood zones | new `flood_zones` polygon table; new score version |
| Formula changes | bump `score_version`; `/api/v1` stays, `/api/v2` alongside |
| Daily destination / route check | extra optional input + section in result card; layout reserves the slot |
| Outside Bangkok | widen bounds once a data source covers it |
| BMA Drainage Dept. street/canal sensors (as used by flood.pop.in.th) | second `source` if history can be collected; reduces Traffy reporting bias |
| Recent searches | client-only list under the search box |

## 9. Testing and CI

| Layer | Tool | Cases |
| --- | --- | --- |
| DB security | pgTAP | anon cannot select/insert any table; only the four RPCs executable |
| Score | pgTAP | fixture data with known answers: decay, percentile, labels, zero-report case, out-of-bounds and bad radius errors |
| Ingest | Vitest | Traffy mapping, zod rejects, > 20 % reject fails run, 1,000-cap split, idempotent upsert |
| API | Vitest | 400 / 422 / 503, no stack leak, cache headers |
| Search | Vitest | fuzzy match: "ประเวท" → ประเวศ, "เขตลาดกระบัง" → ลาดกระบัง, "Prawet" → ประเวศ, nonsense → no match |
| Main flow | Playwright | homepage shows heatmap + top 10 → search → confirm pin → score shown → share link reproduces result; district page loads (fixture data, no live Traffy) |
| UI | Playwright | screenshots at 375 px and 1280 px in light and dark; zero-report state; outside-Bangkok pin; axe accessibility scan has no violations |
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
7. MapTiler `dataviz` / `dataviz-dark` styles available on the free tier; if not, pick the closest muted light/dark pair.
