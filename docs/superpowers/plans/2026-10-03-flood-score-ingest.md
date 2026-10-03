# Flood Score Ingest (Plan 2 of 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Real Traffy flood reports and Bangkok district/subdistrict polygons flow into the Plan 1 database: a one-time backfill (~42.5k reports), an hourly GitHub Actions ingest, and a manual prod migration workflow, all tested.

**Architecture:** TypeScript scripts in `ingest/`, run directly by Node (type stripping, no build step). `traffy.ts` fetches and validates (zod), `pipeline.ts` holds the run logic against a small `Store` object, `store.ts` implements it with supabase-js and the service-role key. The database owns the district contract: a trigger derives `district`/`subdistrict` from `public.areas` on every insert/update, and a service-role-only `load_areas(jsonb)` replaces the polygons atomically from an OSM extract committed in the repo.

**Tech Stack:** Node ≥ 22.18 (runs `.ts` natively), zod 4, `@supabase/supabase-js`, Supabase CLI (pgTAP, advisors), Vitest, GitHub Actions, OpenStreetMap via Overpass (one-time).

**Spec:** `docs/superpowers/specs/2026-10-02-flood-score-design.md` (§4 Database, §5 Ingest, §9 Testing). Plan 1: `docs/superpowers/plans/2026-10-03-flood-score-foundation.md` (merged as #1).

## Facts verified while writing this plan (2026-10-03)

These replace guesses in the spec. Do not re-litigate them; re-probe only if a test against the live API fails.

1. Traffy endpoint `GET https://publicapi.traffy.in.th/teamchadchart-stat-api/geojson/v1?problem_type=น้ำท่วม&start=YYYY-MM-DD&end=YYYY-MM-DD&limit=1000&offset=N`. `end` is inclusive (whole day). Datetimes (`2026-09-15 12:00:00`) also work.
2. **Default page size is 300, `limit` max is 1000.** `offset` paging is exact: Sep 2026 returned 12,328 of 12,328 unique tickets; 2021–2022 returned 10,031 of 10,031. Deep offsets work (offset 42000 in ~12 s).
3. Response: `{status:"success", total, features:[…]}`. On a bad query the API returns **HTTP 200 or 500 with `status:"fail"`** and no `features`. Feature fields used: `geometry.coordinates [lng, lat]`, `properties.ticket_id` (e.g. `2026-YNWKCE`), `timestamp` (`"2026-09-15 22:44:31"`, Bangkok wall-clock, no offset), `timestamp_finished` (same format or null), `state` (Thai, e.g. `เสร็จสิ้น`). Features also carry `description`, `photo_url`, `address` etc., which must never be stored (PDPA).
4. All-time total on 2026-10-03: **42,500**; oldest report 2021-09-16. In a 1,000-row Sep 2026 sample, 0 points fell outside the Bangkok bbox.
5. Overpass (`overpass-api.de`, `overpass.kumi.systems`) returns exactly **50** `admin_level=6` (khet) and **180** `admin_level=8` (khwaeng) relations for `ISO3166-2=TH-10`. The mirror `overpass.private.coffee` returned only 46/155 (stale, missing the eastern districts), so the fetch script must validate counts. Every relation has only `outer` ways (no holes) plus one `admin_centre` way to ignore. Two subdistrict names repeat across districts (บางมด, บางจาก), which `areas`' primary key `(level, district_th, name_th)` already allows.
6. Prototype in local PostGIS: `ST_BuildArea(ST_Collect(ways))` gives 230 valid polygons, every subdistrict's `ST_PointOnSurface` lies in exactly one district, total district area 1,567 km² (Bangkok official: 1,568.7). An open way gives `NULL`.
7. Supabase docs: `service_role` has no own `statement_timeout`, so via PostgREST it inherits `authenticator`'s **8 s**. A function-level `set statement_timeout` works through the REST API.
8. `npx supabase db advisors --local --type security --fail-on warn` exists and currently reports only INFO `rls_enabled_no_policy` (intended: tables have no policies on purpose), so it passes.
9. `npx supabase status -o env` prints `API_URL="…"` and `SERVICE_ROLE_KEY="…"` (with quotes).

## Global Constraints

- Node ≥ 22.18 runs `ingest/*.ts` directly; relative imports use the `.ts` extension; no `enum`, no parameter properties, no `namespace` (type stripping cannot handle them).
- `ingest/` must not import `lib/db.ts` (it imports `server-only`, which throws outside Next). Ingest builds its own client in `ingest/db.ts`.
- Service-role key: env var `SUPABASE_SERVICE_ROLE_KEY`, only in GitHub Actions secrets and the developer's local gitignored `.env.ingest`. Never in `.env.local`, Vercel, or any `NEXT_PUBLIC_*`.
- PDPA: store only `source, source_id, reported_at, finished_at, geom, district, subdistrict, state`. No description, photo, address, or reporter fields.
- `flood_reports.district`/`subdistrict` must equal `areas.name_th`; they are set only by the database trigger from `areas`. Ingest never sends them.
- Hourly window: last 48 h as Bangkok dates (`start` = today − 2 days, `end` = today). Page size 1000. Fetch timeout 120 s, 3 retries with backoff 1 s, 2 s, 4 s.
- Reject rule: if rejected / (valid + rejected) **> 0.2** → run `failed`, nothing written. Exactly 20 % still writes.
- Upsert batches of 500, `on conflict (source, source_id)`.
- Run statuses: `running`, `ok`, `partial`, `failed` (table check constraint). Run script exits 1 only on `failed`.
- All SQL functions: `set search_path = ''`, every object schema-qualified (PostGIS lives in `extensions`).
- `anon`/`authenticated` get no new privileges. New functions are executable by `service_role` only.
- All schema changes are migration files; regenerate `lib/database.types.ts` after each (`npx supabase gen types typescript --local > lib/database.types.ts`); CI diffs it.
- Month/year grouping and Traffy timestamps use `Asia/Bangkok` (UTC+7, no DST).

## Deviations from the spec (approved when the user approves this plan)

1. **Offset paging instead of window splitting** (spec §5.3). Verified exact (Fact 2); splitting is unnecessary. A run is `partial` when unique valid + rejected rows < the API's `total`.
2. **One paged request series per run** instead of one request per day (the paging covers any window size).
3. **Backfill uses the API only, no data.bangkok.go.th CSV** (spec §5 Backfill). The API serves the full history with exact paging (Facts 2, 4), so the CSV and its unclear license (spec §10.2) drop out. Acceptance unchanged: rows within 5 % of the API `total`.
4. **Boundaries from OpenStreetMap** (ODbL, attribution "© OpenStreetMap contributors"), fetched once, committed as `ingest/data/bangkok-areas.json`, loaded by `load_areas(jsonb)`.
5. **District/subdistrict derived by a trigger** on `flood_reports` (Plan 1 follow-up contract). Traffy's own district strings are ignored.
6. **`state` stores Traffy's Thai state text** as-is (the UI shows it as-is).
7. **Refresh skipped when a run upserts 0 rows** (saves the grid recompute on quiet hours).
8. **Function-level `statement_timeout = 120s`** on `refresh_score_reference` and `load_areas` (Fact 7), instead of changing the `service_role` role.

## Review Focus

1. Traffy answers HTTP 200 with `{"status":"fail"}` and no `features` (seen live during planning) → must be a fetch failure (retry, then run `failed`), never "0 reports, ok". Test: Task 4, "status fail is an error".
2. A timestamp that is well-formed but impossible (`2026-02-30 10:00:00`) or garbage → that one feature is rejected; it must not reach Postgres and fail a 500-row batch. Test: Task 4, "impossible date rejected".
3. A ticket that shows up on two pages (a new report arriving mid-paging shifts offsets) → stored once, counted once. Test: Task 4, "duplicate across pages".
4. A report at 00:30 on 1 Oct Bangkok time → `reported_at` 2026-09-30T17:30Z, so the Plan 1 RPCs put it in October. Test: Task 4, "Bangkok offset".
5. Reloading polygons after reports exist → every existing report's `district`/`subdistrict` is recomputed; otherwise renamed areas silently vanish from rankings. Test: Task 2, "reload re-derives existing reports".

## Prerequisites

- Plan 1 merged; start from up-to-date `main`: `git switch main && git pull && git switch -c feat/ingest`.
- Docker Desktop running; `npx supabase start` done; `node -v` ≥ 22.18.
- Internet access for Task 3 (Overpass) and Tasks 6–7 (Traffy).

## File Structure

```
ingest/
  db.ts                 serviceClient(): supabase-js client with the service-role key
  areas.ts              toArea(): OSM relation -> compact area record (pure)
  areas.test.ts
  fetch-areas.ts        one-time: Overpass -> ingest/data/bangkok-areas.json (validates 50/180)
  load-areas.ts         rpc load_areas(payload) + refresh_score_reference, prints timings
  data/bangkok-areas.json  committed OSM extract (~0.9 MB)
  traffy.ts             zod schemas, toRow(), bangkokToIso(), bangkokDate(), fetchTraffy()
  traffy.test.ts
  pipeline.ts           Store type, runIngest(): reject rule, batches, refresh, run status
  pipeline.test.ts
  store.ts              createStore(db): Store over supabase-js
  store.test.ts         integration test against local Supabase (skips without env)
  run.ts                hourly entry (48 h window)
  backfill.ts           one-time entry (2021-01-01 .. today)
  reality.ts            spikeFailures(): spike-district rank rules (pure)
  reality.test.ts
  reality-check.ts      calls flood_overview_v1 with the RPC key, prints failures
supabase/migrations/
  20261004000001_hardening.sql   refresh lock + timeout
  20261004000002_areas_load.sql  set_report_area trigger + load_areas()
supabase/tests/
  01_security.test.sql  (+ catch-all privilege tests)
  02_score.test.sql     (+ isolation, lock/timeout tests)
  03_points.test.sql    (+ isolation)
  04_area.test.sql      (+ isolation)
  05_areas_load.test.sql
.github/workflows/
  ci.yml                (+ permissions, advisors, DB before Vitest)
  ingest.yml            hourly cron + manual run/backfill/load-areas
  db-push.yml           manual prod migrations + advisors
```

---

### Task 1: Database hardening, test isolation, CI security

Plan 1 follow-ups: catch-all privilege test, serialized refresh, advisors in CI, `permissions: contents: read`. Also makes pgTAP tests independent of whatever data the local DB holds (after Task 7 the local DB has 42k real rows; Plan 1 tests assume an empty DB).

**Files:**
- Create: `supabase/migrations/20261004000001_hardening.sql`
- Modify: `supabase/tests/01_security.test.sql`, `supabase/tests/02_score.test.sql`, `supabase/tests/03_points.test.sql`, `supabase/tests/04_area.test.sql`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: Plan 1 `public.refresh_score_reference()` (body in `supabase/migrations/20261003000002_score.sql`).
- Produces: same signature `public.refresh_score_reference() returns void`, now holding `pg_advisory_xact_lock(hashtext('public.refresh_score_reference'))` and `statement_timeout=120s`.

- [ ] **Step 1: Isolate the existing pgTAP files from local data**

In each of `02_score.test.sql`, `03_points.test.sql`, `04_area.test.sql`, insert this line directly after the `select plan(N);` line:

```sql
truncate public.flood_reports, public.ingest_runs, public.score_reference, public.areas; -- rolled back at the end
```

- [ ] **Step 2: Add the failing tests**

In `supabase/tests/02_score.test.sql` change `select plan(24);` to `select plan(26);` and insert before `select * from finish();`:

```sql
-- concurrent refreshes (hourly ingest vs. load-areas) must not interleave
select ok(pg_get_functiondef('public.refresh_score_reference()'::regprocedure) like '%pg_advisory_xact_lock%',
          'refresh serializes with an advisory lock');
-- service_role inherits an 8 s timeout through PostgREST; refresh needs more on real data
select ok('statement_timeout=120s' = any((select p.proconfig from pg_proc p
                                           where p.oid = 'public.refresh_score_reference()'::regprocedure)),
          'refresh may run 120 s');
```

In `supabase/tests/01_security.test.sql` change `select plan(14);` to `select plan(16);` and insert before `select * from finish();`:

```sql
-- catch-all: covers tables added by later migrations too
select is_empty($$
  select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f')
     and (has_table_privilege('anon', c.oid, 'select, insert, update, delete, truncate, references, trigger')
       or has_table_privilege('authenticated', c.oid, 'select, insert, update, delete, truncate, references, trigger'))
$$, 'anon/authenticated hold no privilege on any public table or view');
select is_empty($$
  select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'S'
     and (has_sequence_privilege('anon', c.oid, 'usage, select, update')
       or has_sequence_privilege('authenticated', c.oid, 'usage, select, update'))
$$, 'anon/authenticated hold no privilege on any public sequence');
```

- [ ] **Step 3: Run tests, verify the two refresh tests fail**

Run: `npx supabase test db`
Expected: FAIL in `02_score.test.sql` on "refresh serializes with an advisory lock" and "refresh may run 120 s". The two catch-all tests in `01_security` PASS already (they guard future migrations).

- [ ] **Step 4: Write the migration**

`supabase/migrations/20261004000001_hardening.sql`:

```sql
-- Same body as 20261003000002_score.sql, plus:
--  * an advisory lock so two refreshes (hourly ingest, load-areas) never interleave delete/insert
--  * statement_timeout 120s: via PostgREST, service_role inherits authenticator's 8 s limit
create or replace function public.refresh_score_reference()
returns void language plpgsql security definer
set search_path = '' set statement_timeout = '120s' as $$
begin
  perform pg_advisory_xact_lock(hashtext('public.refresh_score_reference'));
  delete from public.score_reference where score_version = 1;
  insert into public.score_reference (score_version, grid_point, weighted_count)
  select 1, g.pt, public.weighted_count_at(g.pt)
  from (
    select extensions.st_setsrid(extensions.st_makepoint(lng::float8, lat::float8), 4326)::extensions.geography as pt
    from generate_series(13.49, 13.96, 0.0045) as lat,
         generate_series(100.32, 100.94, 0.0046) as lng
  ) g
  -- ponytail: bbox fallback until district polygons are loaded into public.areas
  where not exists (select 1 from public.areas b where b.level = 'district')
     or exists (select 1 from public.areas a
                where a.level = 'district' and extensions.st_covers(a.geom, g.pt));
end $$;
```

(`create or replace` keeps existing grants: `service_role` keeps EXECUTE, `anon` still has none.)

- [ ] **Step 5: Apply and run tests**

Run: `npx supabase db reset && npx supabase test db`
Expected: PASS, all files (`01` 16 tests, `02` 26, `03` 7, `04` 16).

- [ ] **Step 6: Regenerate types (signature unchanged, file should not change)**

Run: `npx supabase gen types typescript --local > lib/database.types.ts && git diff --stat lib/database.types.ts`
Expected: no diff.

- [ ] **Step 7: CI permissions and security advisor**

In `.github/workflows/ci.yml`, add after the `on:` block (top level):

```yaml
permissions:
  contents: read
```

and add after the `pgTAP tests` step:

```yaml
      # Spec success criterion 4. INFO-level "RLS enabled, no policy" is intended (RPC-only reads).
      - name: Security advisor
        run: npx supabase db advisors --local --type security --fail-on warn
```

Run locally: `npx supabase db advisors --local --type security --fail-on warn; echo "exit $?"`
Expected: `exit 0`.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/20261004000001_hardening.sql supabase/tests .github/workflows/ci.yml
git commit -m "feat(db): serialize score refresh, 120s timeout, catch-all privilege tests, advisors in CI"
```

---

### Task 2: District trigger and `load_areas(jsonb)`

**Files:**
- Create: `supabase/migrations/20261004000002_areas_load.sql`
- Create: `supabase/tests/05_areas_load.test.sql`
- Modify: `lib/database.types.ts` (regenerated)

**Interfaces:**
- Consumes: `public.areas (level, district_th, name_th, name_en, geom)` from Plan 1.
- Produces:
  - Trigger `flood_reports_set_area` (BEFORE INSERT OR UPDATE): sets `new.district` = `name_th` of the district polygon covering `new.geom` (or null), `new.subdistrict` = `name_th` of a subdistrict of that district covering it (or null). Incoming values are always overwritten.
  - `public.load_areas(payload jsonb) returns void`, executable by `service_role` only. Payload: JSON array of `{"level": "district"|"subdistrict", "name_th": string, "name_en": string|null, "ways": [[[lng, lat], …], …]}`. Replaces all of `public.areas` in one transaction, derives each subdistrict's `district_th` spatially, then re-derives every report. Errors: `bad_area: <names>` (unknown level, missing name, unbuildable or invalid polygon), `orphan_subdistrict: <names>` (subdistrict inside no district). On error nothing changes.

- [ ] **Step 1: Write the failing tests**

`supabase/tests/05_areas_load.test.sql`:

```sql
begin;
select plan(17);
truncate public.flood_reports, public.ingest_runs, public.score_reference, public.areas; -- rolled back at the end

-- district square 100.6-100.8 x 13.6-13.8 given as two open ways (OSM style); subdistrict = SW quarter
select lives_ok($t$select public.load_areas('[
  {"level":"district","name_th":"ประเวศ","name_en":"Prawet",
   "ways":[[[100.6,13.6],[100.8,13.6],[100.8,13.8]],[[100.8,13.8],[100.6,13.8],[100.6,13.6]]]},
  {"level":"subdistrict","name_th":"หนองบอน","name_en":"Nong Bon",
   "ways":[[[100.6,13.6],[100.7,13.6],[100.7,13.7],[100.6,13.7],[100.6,13.6]]]}
]'::jsonb)$t$, 'load_areas accepts OSM-style ways');
select is((select count(*) from public.areas where level = 'district'), 1::bigint, 'one district loaded');
select is((select district_th from public.areas where level = 'subdistrict'), 'ประเวศ', 'subdistrict parent derived spatially');
select is((select extensions.geometrytype(geom::extensions.geometry) from public.areas where level = 'district'),
          'MULTIPOLYGON', 'stored as MultiPolygon');

-- trigger: Traffy's own strings are ignored, names come from areas
insert into public.flood_reports (source_id, reported_at, geom, district, subdistrict) values
  ('in_sub', now(), extensions.st_setsrid(extensions.st_makepoint(100.65, 13.65), 4326)::extensions.geography, 'ผิด', 'ผิด'),
  ('in_dist', now(), extensions.st_setsrid(extensions.st_makepoint(100.75, 13.75), 4326)::extensions.geography, null, null),
  ('outside', now(), extensions.st_setsrid(extensions.st_makepoint(100.40, 13.90), 4326)::extensions.geography, 'รังสิต', null);
select is((select district from public.flood_reports where source_id = 'in_sub'), 'ประเวศ', 'district from polygon');
select is((select subdistrict from public.flood_reports where source_id = 'in_sub'), 'หนองบอน', 'subdistrict from polygon');
select is((select subdistrict from public.flood_reports where source_id = 'in_dist'), null, 'no subdistrict polygon -> null');
select is((select district from public.flood_reports where source_id = 'outside'), null, 'outside every polygon -> null');

-- upsert-style update also re-derives
update public.flood_reports set district = 'ผิด' where source_id = 'in_sub';
select is((select district from public.flood_reports where source_id = 'in_sub'), 'ประเวศ', 'update cannot set a wrong district');

-- reload replaces everything and re-derives existing reports
select public.load_areas('[
  {"level":"district","name_th":"ประเวศใหม่","name_en":null,
   "ways":[[[100.6,13.6],[100.8,13.6],[100.8,13.8],[100.6,13.8],[100.6,13.6]]]}
]'::jsonb);
select is((select count(*) from public.areas), 1::bigint, 'reload replaces all areas');
select is((select district from public.flood_reports where source_id = 'in_sub'), 'ประเวศใหม่', 'reload re-derives existing reports');
select is((select subdistrict from public.flood_reports where source_id = 'in_sub'), null, 'removed subdistrict cleared');

-- bad input changes nothing
select throws_ok($t$select public.load_areas('[{"level":"district","name_th":"เสีย","name_en":null,"ways":[[[100.6,13.6],[100.7,13.6]]]}]'::jsonb)$t$,
                 'P0001', 'bad_area: เสีย', 'unbuildable polygon rejected');
select throws_ok($t$select public.load_areas('[
  {"level":"district","name_th":"ก","name_en":null,"ways":[[[100.6,13.6],[100.8,13.6],[100.8,13.8],[100.6,13.8],[100.6,13.6]]]},
  {"level":"subdistrict","name_th":"ลอย","name_en":null,"ways":[[[100.3,13.9],[100.4,13.9],[100.4,13.95],[100.3,13.95],[100.3,13.9]]]}
]'::jsonb)$t$, 'P0001', 'orphan_subdistrict: ลอย', 'subdistrict outside every district rejected');
select is((select name_th from public.areas), 'ประเวศใหม่', 'failed load left areas unchanged');

-- privileges
select ok(not has_function_privilege('anon', 'public.load_areas(jsonb)', 'execute'), 'anon cannot load areas');
select ok(has_function_privilege('service_role', 'public.load_areas(jsonb)', 'execute'), 'service_role can load areas');

select * from finish();
rollback;
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npx supabase test db`
Expected: FAIL in `05_areas_load.test.sql` with `function public.load_areas(jsonb) does not exist`.

- [ ] **Step 3: Write the migration**

`supabase/migrations/20261004000002_areas_load.sql`:

```sql
-- Contract from Plan 1: flood_reports.district/subdistrict must equal areas.name_th.
-- The database derives them; ingest never sends them.
create function public.set_report_area()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.district := (select a.name_th from public.areas a
                    where a.level = 'district' and extensions.st_covers(a.geom, new.geom)
                    order by a.name_th limit 1);
  new.subdistrict := (select a.name_th from public.areas a
                       where a.level = 'subdistrict' and a.district_th = new.district
                         and extensions.st_covers(a.geom, new.geom)
                       order by a.name_th limit 1);
  return new;
end $$;

create trigger flood_reports_set_area
  before insert or update on public.flood_reports
  for each row execute function public.set_report_area();

-- Replaces all areas from an OSM extract (see ingest/fetch-areas.ts) in one transaction.
create function public.load_areas(payload jsonb)
returns void language plpgsql
set search_path = '' set statement_timeout = '120s' as $$
declare
  bad text;
begin
  drop table if exists pg_temp.new_areas;
  create temp table new_areas on commit drop as
    select x->>'level' as level,
           x->>'name_th' as name_th,
           nullif(x->>'name_en', '') as name_en,
           extensions.st_multi(extensions.st_buildarea(extensions.st_collect(array(
             select extensions.st_geomfromgeojson(jsonb_build_object('type', 'LineString', 'coordinates', w)::text)
               from jsonb_array_elements(x->'ways') w)))) as g
      from jsonb_array_elements(payload) x;

  select string_agg(coalesce(n.name_th, '?'), ', ') into bad from pg_temp.new_areas n
   where n.level is null or n.level not in ('district', 'subdistrict') or n.name_th is null
      or n.g is null or not extensions.st_isvalid(n.g) or extensions.geometrytype(n.g) <> 'MULTIPOLYGON';
  if bad is not null then
    raise exception 'bad_area: %', bad;
  end if;

  select string_agg(s.name_th, ', ') into bad from pg_temp.new_areas s
   where s.level = 'subdistrict' and not exists (
     select 1 from pg_temp.new_areas d
      where d.level = 'district' and extensions.st_covers(d.g, extensions.st_pointonsurface(s.g)));
  if bad is not null then
    raise exception 'orphan_subdistrict: %', bad;
  end if;

  delete from public.areas;
  insert into public.areas (level, district_th, name_th, name_en, geom)
  select 'district', n.name_th, n.name_th, n.name_en, n.g::extensions.geography
    from pg_temp.new_areas n where n.level = 'district';
  insert into public.areas (level, district_th, name_th, name_en, geom)
  select 'subdistrict', p.name_th, s.name_th, s.name_en, s.g::extensions.geography
    from pg_temp.new_areas s
    cross join lateral (
      select d.name_th from pg_temp.new_areas d
       where d.level = 'district' and extensions.st_covers(d.g, extensions.st_pointonsurface(s.g))
       order by d.name_th limit 1) p
   where s.level = 'subdistrict';

  update public.flood_reports set geom = geom; -- fires set_report_area for every report
end $$;

revoke execute on function public.load_areas(jsonb) from public, anon, authenticated;
grant execute on function public.load_areas(jsonb) to service_role;
```

- [ ] **Step 4: Apply and run tests**

Run: `npx supabase db reset && npx supabase test db`
Expected: PASS, all five files (`05` 17 tests; `04`'s "anon can execute only the five read RPCs" still passes).

- [ ] **Step 5: Regenerate types, run advisor**

Run: `npx supabase gen types typescript --local > lib/database.types.ts && npx supabase db advisors --local --type security --fail-on warn`
Expected: `load_areas` appears in `lib/database.types.ts` under `Functions`; advisor exits 0.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20261004000002_areas_load.sql supabase/tests/05_areas_load.test.sql lib/database.types.ts
git commit -m "feat(db): derive report district from areas by trigger; load_areas(jsonb) for service_role"
```

---

### Task 3: Bangkok boundaries from OSM, loader script, ingest tooling

**Files:**
- Create: `ingest/db.ts`, `ingest/areas.ts`, `ingest/areas.test.ts`, `ingest/fetch-areas.ts`, `ingest/load-areas.ts`
- Create: `ingest/data/bangkok-areas.json` (generated by `fetch-areas.ts`, committed)
- Modify: `tsconfig.json`, `vitest.config.ts`, `package.json`, `.env.example`, `README.md`

**Interfaces:**
- Consumes: `public.load_areas(payload jsonb)` (Task 2), `public.refresh_score_reference()` (Task 1).
- Produces:
  - `ingest/db.ts`: `export type Db = SupabaseClient<Database>`; `export function serviceClient(): Db` (throws `"SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set"`).
  - `ingest/areas.ts`: `export type Area = { level: "district" | "subdistrict"; name_th: string; name_en: string | null; ways: [number, number][][] }`; `export type OsmRelation = { tags: Record<string, string>; members: { type: string; role: string; geometry?: { lat: number; lon: number }[] }[] }`; `export function toArea(r: OsmRelation): Area`.
  - npm scripts `fetch-areas`, `load-areas`.

- [ ] **Step 1: Tooling for `.ts` imports and ingest tests**

`tsconfig.json`: add inside `compilerOptions`:

```json
    "allowImportingTsExtensions": true,
```

`vitest.config.ts` (whole file):

```ts
import { defineConfig } from "vitest/config";

// Integration tests (ingest/store.test.ts) read the local service-role key from .env.ingest when present.
try {
  process.loadEnvFile(".env.ingest");
} catch {
  // optional file; without it the integration suite is skipped
}

export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "ingest/**/*.test.ts"],
  },
});
```

`package.json` `scripts`: add

```json
    "fetch-areas": "node ingest/fetch-areas.ts",
    "load-areas": "node --env-file-if-exists=.env.ingest ingest/load-areas.ts",
```

`.env.example`: replace the last line (`# Never put the service-role key …`) with:

```
# Never put the service-role key in this file, in Vercel, or in any NEXT_PUBLIC_* variable.
# Ingest scripts (npm run ingest / backfill / load-areas) read a separate gitignored file, .env.ingest:
#   SUPABASE_URL=http://127.0.0.1:54321
#   SUPABASE_SERVICE_ROLE_KEY=<SERVICE_ROLE_KEY from `npx supabase status -o env`, local only>
# In production the service-role key lives only in GitHub Actions secrets.
```

- [ ] **Step 2: Write the failing test for `toArea`**

`ingest/areas.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { toArea, type OsmRelation } from "./areas.ts";

const rel = (tags: Record<string, string>): OsmRelation => ({
  tags,
  members: [
    { type: "way", role: "outer", geometry: [{ lat: 13.1234567, lon: 100.7654321 }, { lat: 13.2, lon: 100.8 }] },
    { type: "way", role: "admin_centre", geometry: [{ lat: 1, lon: 1 }] },
    { type: "node", role: "label" },
  ],
});

describe("toArea", () => {
  it("maps a khet relation", () => {
    const a = toArea(rel({ admin_level: "6", "name:th": "เขตประเวศ", "short_name:en": "Prawet" }));
    expect(a).toEqual({ level: "district", name_th: "ประเวศ", name_en: "Prawet", ways: [[[100.765432, 13.123457], [100.8, 13.2]]] });
  });

  it("maps a khwaeng and falls back to name / name:en", () => {
    const a = toArea(rel({ admin_level: "8", name: "แขวง คลองขวาง", "name:en": "Khlong Khwang Subdistrict" }));
    expect(a.level).toBe("subdistrict");
    expect(a.name_th).toBe("คลองขวาง");
    expect(a.name_en).toBe("Khlong Khwang");
  });

  it("strips the District suffix (Bang Rak has no short_name)", () => {
    expect(toArea(rel({ admin_level: "6", name: "เขตบางรัก", "name:en": "Bang Rak District" })).name_en).toBe("Bang Rak");
  });

  it("keeps only outer ways", () => {
    expect(toArea(rel({ admin_level: "6", name: "เขตก" })).ways).toHaveLength(1);
  });
});
```

- [ ] **Step 3: Run test, verify it fails**

Run: `npx vitest run ingest/areas.test.ts`
Expected: FAIL, cannot resolve `./areas.ts`.

- [ ] **Step 4: Implement `areas.ts` and `db.ts`**

`ingest/areas.ts`:

```ts
export type Area = {
  level: "district" | "subdistrict";
  name_th: string;
  name_en: string | null;
  ways: [number, number][][]; // GeoJSON order: [lng, lat]
};

export type OsmRelation = {
  tags: Record<string, string>;
  members: { type: string; role: string; geometry?: { lat: number; lon: number }[] }[];
};

const round6 = (v: number) => Math.round(v * 1e6) / 1e6; // ~0.1 m, keeps the committed file small

export function toArea(r: OsmRelation): Area {
  const t = r.tags;
  return {
    level: t.admin_level === "6" ? "district" : "subdistrict",
    name_th: (t["name:th"] ?? t.name).replace(/^(เขต|แขวง)\s*/, ""),
    name_en: (t["short_name:en"] ?? t["name:en"] ?? "").replace(/ (District|Subdistrict)$/, "") || null,
    ways: r.members
      .filter((m) => m.type === "way" && m.role === "outer" && m.geometry)
      .map((m) => m.geometry!.map((p): [number, number] => [round6(p.lon), round6(p.lat)])),
  };
}
```

`ingest/db.ts`:

```ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../lib/database.types.ts";

export type Db = SupabaseClient<Database>;

// Service-role client for ingest only. The key lives in GitHub Actions secrets (prod) or .env.ingest (local).
export function serviceClient(): Db {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  return createClient<Database>(url, key, { auth: { persistSession: false } });
}
```

- [ ] **Step 5: Run test, verify it passes**

Run: `npx vitest run ingest/areas.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Write the fetch and load scripts**

`ingest/fetch-areas.ts`:

```ts
// One-time: download Bangkok khet (admin_level 6) and khwaeng (8) boundaries from OpenStreetMap
// and write ingest/data/bangkok-areas.json. Data © OpenStreetMap contributors, ODbL.
import { writeFileSync } from "node:fs";
import { toArea, type OsmRelation } from "./areas.ts";

const QUERY = `[out:json][timeout:180];
area["ISO3166-2"="TH-10"]->.bkk;
(relation["boundary"="administrative"]["admin_level"~"^(6|8)$"](area.bkk););
out geom;`;
// Some mirrors serve stale data (one returned 46/155), so every answer is checked against 50/180.
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
```

`ingest/load-areas.ts`:

```ts
// Replace public.areas from the committed OSM extract, then recompute the score grid
// (the grid covers only points inside district polygons).
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
```

- [ ] **Step 7: Generate the extract and load it locally**

```bash
mkdir -p ingest/data
npm run fetch-areas
```
Expected: `wrote 50 districts, 180 subdistricts from https://overpass-api.de/...` and `ingest/data/bangkok-areas.json` ≈ 0.9 MB. If both endpoints fail, wait a few minutes and rerun (Overpass rate-limits).

Create `.env.ingest` with `SUPABASE_URL=http://127.0.0.1:54321` and `SUPABASE_SERVICE_ROLE_KEY=` set to the `SERVICE_ROLE_KEY` value from `npx supabase status -o env` (without quotes). Then:

```bash
npm run load-areas
docker exec supabase_db_Easy_website psql -U postgres -tAc "select level, count(*), round(sum(extensions.st_area(geom))/1e6) from public.areas group by 1 order by 1"
```
Expected: two timing lines, each well under 120000 ms; query prints `district|50|1567` and `subdistrict|180|<≈1567>`. (On Git Bash for Windows, prefix `docker exec` with `MSYS_NO_PATHCONV=1`.)

- [ ] **Step 8: Document the source**

Append to `README.md`:

```markdown
## Data sources

- Flood reports: Traffy Fondue public API (`problem_type=น้ำท่วม`), loaded by `ingest/`.
- District/subdistrict boundaries: © OpenStreetMap contributors, ODbL. Extract committed at
  `ingest/data/bangkok-areas.json`; regenerate with `npm run fetch-areas`, load with `npm run load-areas`.
```

- [ ] **Step 9: Lint, typecheck, test, commit**

Run: `npm run lint && npm run typecheck && npm test`
Expected: all green.

```bash
git add tsconfig.json vitest.config.ts package.json .env.example README.md ingest/db.ts ingest/areas.ts ingest/areas.test.ts ingest/fetch-areas.ts ingest/load-areas.ts ingest/data/bangkok-areas.json
git commit -m "feat(ingest): OSM district/subdistrict extract and load-areas script"
```

---

### Task 4: Traffy source: fetch, page, validate, map

**Files:**
- Create: `ingest/traffy.ts`, `ingest/traffy.test.ts`
- Modify: `package.json`, `package-lock.json` (add `zod`)

**Interfaces:**
- Consumes: `inBangkok(lat, lng)` from `lib/bangkok.ts`.
- Produces (`ingest/traffy.ts`):
  - `export type Window = { start: string; end: string }` (Bangkok dates `YYYY-MM-DD`, both inclusive)
  - `export type FloodRow = { source: string; source_id: string; reported_at: string; finished_at: string | null; geom: string; state: string | null }`
  - `export type FetchOptions = { fetchFn?: typeof fetch; retryDelayMs?: number }`
  - `export type Fetched = { rows: FloodRow[]; rejected: number; total: number; complete: boolean }`
  - `export function bangkokToIso(ts: string): string | null`
  - `export function bangkokDate(d: Date): string`
  - `export function toRow(feature: unknown): FloodRow | null`
  - `export async function fetchTraffy(window: Window, opts?: FetchOptions): Promise<Fetched>`
  - `export const PAGE_SIZE = 1000`

- [ ] **Step 1: Add zod**

Run: `npm install zod@^4.6.5`
Expected: `zod` under `dependencies` in `package.json`.

- [ ] **Step 2: Write the failing tests**

`ingest/traffy.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { bangkokDate, bangkokToIso, fetchTraffy, PAGE_SIZE, toRow } from "./traffy.ts";

const feature = (id: string, over: Record<string, unknown> = {}, coords = [100.62131, 13.84481]) => ({
  type: "Feature",
  geometry: { type: "Point", coordinates: coords },
  properties: {
    ticket_id: id,
    timestamp: "2026-09-15 22:44:31",
    timestamp_finished: "2026-09-16 10:17:31",
    state: "เสร็จสิ้น",
    description: "reporter text that must never be stored",
    photo_url: "https://example.com/p.jpg",
    ...over,
  },
});

describe("bangkokToIso", () => {
  it("adds the Bangkok offset", () => {
    expect(bangkokToIso("2026-09-15 22:44:31")).toBe("2026-09-15T22:44:31+07:00");
  });
  it("Bangkok offset: 00:30 on 1 Oct is 30 Sep in UTC", () => {
    expect(new Date(bangkokToIso("2026-10-01 00:30:00")!).toISOString()).toBe("2026-09-30T17:30:00.000Z");
  });
  it("impossible date rejected", () => {
    expect(bangkokToIso("2026-02-30 10:00:00")).toBeNull();
    expect(bangkokToIso("2026-13-01 10:00:00")).toBeNull();
    expect(bangkokToIso("yesterday")).toBeNull();
  });
});

describe("bangkokDate", () => {
  it("uses the Bangkok calendar day", () => {
    expect(bangkokDate(new Date("2026-10-02T17:30:00Z"))).toBe("2026-10-03");
    expect(bangkokDate(new Date("2026-10-02T16:59:59Z"))).toBe("2026-10-02");
  });
});

describe("toRow", () => {
  it("maps only the allowed fields", () => {
    expect(toRow(feature("2026-YNWKCE"))).toEqual({
      source: "traffy",
      source_id: "2026-YNWKCE",
      reported_at: "2026-09-15T22:44:31+07:00",
      finished_at: "2026-09-16T10:17:31+07:00",
      geom: "SRID=4326;POINT(100.62131 13.84481)",
      state: "เสร็จสิ้น",
    });
  });
  it("allows missing finish time and state", () => {
    const r = toRow(feature("a", { timestamp_finished: null, state: null }));
    expect(r?.finished_at).toBeNull();
    expect(r?.state).toBeNull();
  });
  it("rejects bad features", () => {
    expect(toRow(feature(""))).toBeNull(); // empty ticket id
    expect(toRow(feature("a", { timestamp: "2026-02-30 10:00:00" }))).toBeNull(); // impossible date
    expect(toRow(feature("a", {}, [100.2, 13.7]))).toBeNull(); // west of Bangkok bounds
    expect(toRow(feature("a", {}, [Number.NaN, 13.7]))).toBeNull();
    expect(toRow({ type: "Feature", geometry: null, properties: {} })).toBeNull();
    expect(toRow("junk")).toBeNull();
  });
});

type Page = { status: string; total?: number; features?: unknown[] };
const fakeFetch = (pages: (Page | Error)[]) =>
  vi.fn(async () => {
    const next = pages.shift();
    if (!next) throw new Error("unexpected extra request");
    if (next instanceof Error) throw next;
    return Response.json(next);
  });
const ids = (from: number, n: number) => Array.from({ length: n }, (_, i) => feature(`t${from + i}`));
const w = { start: "2026-09-29", end: "2026-10-01" };

describe("fetchTraffy", () => {
  it("pages with limit/offset until total, encodes the Thai problem type", async () => {
    const fn = fakeFetch([
      { status: "success", total: 2500, features: ids(0, PAGE_SIZE) },
      { status: "success", total: 2500, features: ids(1000, PAGE_SIZE) },
      { status: "success", total: 2500, features: ids(2000, 500) },
    ]);
    const r = await fetchTraffy(w, { fetchFn: fn as unknown as typeof fetch });
    expect(r).toMatchObject({ rejected: 0, total: 2500, complete: true });
    expect(r.rows).toHaveLength(2500);
    const urls = fn.mock.calls.map((c) => new URL(String((c as unknown[])[0])));
    expect(urls.map((u) => u.searchParams.get("offset"))).toEqual(["0", "1000", "2000"]);
    expect(urls[0].searchParams.get("problem_type")).toBe("น้ำท่วม");
    expect(urls[0].searchParams.get("limit")).toBe("1000");
    expect(urls[0].searchParams.get("start")).toBe("2026-09-29");
    expect(urls[0].searchParams.get("end")).toBe("2026-10-01");
  });

  it("duplicate across pages is stored once", async () => {
    const fn = fakeFetch([
      { status: "success", total: 1001, features: ids(0, PAGE_SIZE) },
      { status: "success", total: 1001, features: [feature("t999")] }, // shifted by a new report
    ]);
    const r = await fetchTraffy(w, { fetchFn: fn as unknown as typeof fetch });
    expect(r.rows).toHaveLength(1000);
    expect(r.complete).toBe(false); // 1000 unique < 1001 reported
  });

  it("counts rejected features", async () => {
    const fn = fakeFetch([{ status: "success", total: 3, features: [feature("a"), feature(""), "junk"] }]);
    const r = await fetchTraffy(w, { fetchFn: fn as unknown as typeof fetch });
    expect(r).toMatchObject({ rejected: 2, total: 3, complete: true });
    expect(r.rows).toHaveLength(1);
  });

  it("empty window is complete", async () => {
    const fn = fakeFetch([{ status: "success", total: 0, features: [] }]);
    expect(await fetchTraffy(w, { fetchFn: fn as unknown as typeof fetch })).toEqual({ rows: [], rejected: 0, total: 0, complete: true });
  });

  it("retries then succeeds", async () => {
    const fn = fakeFetch([new Error("ECONNRESET"), { status: "success", total: 1, features: [feature("a")] }]);
    const r = await fetchTraffy(w, { fetchFn: fn as unknown as typeof fetch, retryDelayMs: 0 });
    expect(r.rows).toHaveLength(1);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("status fail is an error after 1 + 3 attempts", async () => {
    const fail = { status: "fail" };
    const fn = fakeFetch([fail, fail, fail, fail]);
    await expect(fetchTraffy(w, { fetchFn: fn as unknown as typeof fetch, retryDelayMs: 0 })).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(4);
  });
});
```

- [ ] **Step 3: Run tests, verify they fail**

Run: `npx vitest run ingest/traffy.test.ts`
Expected: FAIL, cannot resolve `./traffy.ts`.

- [ ] **Step 4: Implement `ingest/traffy.ts`**

```ts
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
  features: z.array(z.unknown()),
});

// Traffy timestamps are Bangkok wall-clock time without an offset, e.g. "2026-09-15 22:44:31".
export function bangkokToIso(ts: string): string | null {
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
  if (!reportedAt || !inBangkok(lat, lng)) return null;
  return {
    source: "traffy",
    source_id: p.ticket_id,
    reported_at: reportedAt,
    finished_at: p.timestamp_finished ? bangkokToIso(p.timestamp_finished) : null,
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
      if (!page.success) throw new Error(`Traffy page rejected: ${page.error.message.slice(0, 300)}`);
      return page.data;
    } catch (e) {
      if (attempt >= RETRIES) throw e;
      await sleep(retryDelayMs * 2 ** attempt);
    }
  }
}

export async function fetchTraffy(window: Window, opts: FetchOptions = {}): Promise<Fetched> {
  const { fetchFn = fetch, retryDelayMs = 1000 } = opts;
  const byId = new Map<string, FloodRow>(); // a ticket can repeat across pages if new reports arrive mid-run
  let rejected = 0;
  let total = 0;
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const page = await fetchPage(window, offset, fetchFn, retryDelayMs);
    total = page.total;
    for (const f of page.features) {
      const row = toRow(f);
      if (row) byId.set(row.source_id, row);
      else rejected++;
    }
    if (page.features.length < PAGE_SIZE || offset + PAGE_SIZE >= total) break;
  }
  return { rows: [...byId.values()], rejected, total, complete: byId.size + rejected >= total };
}
```

- [ ] **Step 5: Run tests, verify they pass**

Run: `npx vitest run ingest/traffy.test.ts`
Expected: PASS (13 tests).

- [ ] **Step 6: Lint, typecheck, commit**

Run: `npm run lint && npm run typecheck`
Expected: no errors.

```bash
git add package.json package-lock.json ingest/traffy.ts ingest/traffy.test.ts
git commit -m "feat(ingest): Traffy fetch with offset paging, retries, zod validation and row mapping"
```

---

### Task 5: Run pipeline and Supabase store

**Files:**
- Create: `ingest/pipeline.ts`, `ingest/pipeline.test.ts`, `ingest/store.ts`, `ingest/store.test.ts`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `fetchTraffy`, `Window`, `FloodRow`, `FetchOptions` (Task 4); `serviceClient`, `Db` (Task 3).
- Produces:
  - `ingest/pipeline.ts`: `export const BATCH_SIZE = 500`; `export const MAX_REJECT_RATE = 0.2`; `export type RunResult = { status: "ok" | "partial" | "failed"; rowsUpserted: number; rowsRejected: number; error: string | null }`; `export type Store = { startRun(window: Window): Promise<number>; upsert(rows: FloodRow[]): Promise<void>; refresh(): Promise<void>; finishRun(id: number, result: RunResult): Promise<void> }`; `export async function runIngest(store: Store, window: Window, opts?: FetchOptions): Promise<RunResult>`.
  - `ingest/store.ts`: `export function createStore(db: Db): Store`.

- [ ] **Step 1: Write the failing pipeline tests**

`ingest/pipeline.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { runIngest, type RunResult, type Store } from "./pipeline.ts";
import type { FloodRow } from "./traffy.ts";

const feature = (id: string) => ({
  type: "Feature",
  geometry: { type: "Point", coordinates: [100.65, 13.7] },
  properties: { ticket_id: id, timestamp: "2026-09-15 22:44:31", timestamp_finished: null, state: "รอรับเรื่อง" },
});
const bad = { type: "Feature", geometry: null, properties: {} };

// Every call returns the same single page; total defaults to its length, so the run is complete.
const traffy = (features: unknown[], total = features.length) =>
  (async () => Response.json({ status: "success", total, features })) as unknown as typeof fetch;

const fakeStore = (over: Partial<Store> = {}) => {
  const upserts: FloodRow[][] = [];
  const finished: RunResult[] = [];
  const store: Store = {
    startRun: vi.fn(async () => 7),
    upsert: vi.fn(async (rows: FloodRow[]) => void upserts.push(rows)),
    refresh: vi.fn(async () => {}),
    finishRun: vi.fn(async (_id: number, r: RunResult) => void finished.push(r)),
    ...over,
  };
  return { store, upserts, finished };
};
const w = { start: "2026-09-29", end: "2026-10-01" };
const many = (n: number) => Array.from({ length: n }, (_, i) => feature(`t${i}`));

describe("runIngest", () => {
  it("upserts in batches of 500, refreshes once, finishes ok", async () => {
    const { store, upserts, finished } = fakeStore();
    const r = await runIngest(store, w, { fetchFn: traffy(many(1200)) });
    expect(upserts.map((b) => b.length)).toEqual([500, 500, 200]);
    expect(store.refresh).toHaveBeenCalledTimes(1);
    expect(r).toEqual({ status: "ok", rowsUpserted: 1200, rowsRejected: 0, error: null });
    expect(store.startRun).toHaveBeenCalledWith(w);
    expect(store.finishRun).toHaveBeenCalledWith(7, r);
    expect(finished).toEqual([r]);
  });

  it("over 20% rejected: failed, nothing written", async () => {
    const { store } = fakeStore();
    const r = await runIngest(store, w, { fetchFn: traffy([...many(7), bad, bad, bad]) });
    expect(r.status).toBe("failed");
    expect(r.rowsRejected).toBe(3);
    expect(r.error).toContain("20%");
    expect(store.upsert).not.toHaveBeenCalled();
    expect(store.refresh).not.toHaveBeenCalled();
  });

  it("exactly 20% rejected still writes", async () => {
    const { store } = fakeStore();
    const r = await runIngest(store, w, { fetchFn: traffy([...many(8), bad, bad]) });
    expect(r).toMatchObject({ status: "ok", rowsUpserted: 8, rowsRejected: 2 });
  });

  it("fewer rows than Traffy total: partial, rows still written", async () => {
    const { store } = fakeStore();
    const r = await runIngest(store, w, { fetchFn: traffy(many(5), 6) });
    expect(r.status).toBe("partial");
    expect(r.rowsUpserted).toBe(5);
    expect(r.error).toContain("6");
  });

  it("no reports: ok without refresh", async () => {
    const { store } = fakeStore();
    const r = await runIngest(store, w, { fetchFn: traffy([]) });
    expect(r).toEqual({ status: "ok", rowsUpserted: 0, rowsRejected: 0, error: null });
    expect(store.refresh).not.toHaveBeenCalled();
  });

  it("Traffy down: failed with the error, run still closed", async () => {
    const { store, finished } = fakeStore();
    const down = (async () => {
      throw new Error("ETIMEDOUT");
    }) as unknown as typeof fetch;
    const r = await runIngest(store, w, { fetchFn: down, retryDelayMs: 0 });
    expect(r).toEqual({ status: "failed", rowsUpserted: 0, rowsRejected: 0, error: "ETIMEDOUT" });
    expect(finished).toHaveLength(1);
  });

  it("database error mid-upsert: failed, counts what was written", async () => {
    let calls = 0;
    const { store } = fakeStore({
      upsert: vi.fn(async () => {
        if (++calls === 2) throw new Error("connection refused");
      }),
    });
    const r = await runIngest(store, w, { fetchFn: traffy(many(1200)) });
    expect(r).toEqual({ status: "failed", rowsUpserted: 500, rowsRejected: 0, error: "connection refused" });
    expect(store.refresh).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npx vitest run ingest/pipeline.test.ts`
Expected: FAIL, cannot resolve `./pipeline.ts`.

- [ ] **Step 3: Implement `ingest/pipeline.ts`**

```ts
import { fetchTraffy, type FetchOptions, type FloodRow, type Window } from "./traffy.ts";

export const BATCH_SIZE = 500;
export const MAX_REJECT_RATE = 0.2; // more than this means Traffy changed its format: write nothing

export type RunResult = {
  status: "ok" | "partial" | "failed";
  rowsUpserted: number;
  rowsRejected: number;
  error: string | null;
};

export type Store = {
  startRun(window: Window): Promise<number>;
  upsert(rows: FloodRow[]): Promise<void>;
  refresh(): Promise<void>;
  finishRun(id: number, result: RunResult): Promise<void>;
};

export async function runIngest(store: Store, window: Window, opts: FetchOptions = {}): Promise<RunResult> {
  const runId = await store.startRun(window);
  let upserted = 0;
  let rejected = 0;
  let result: RunResult;
  try {
    const fetched = await fetchTraffy(window, opts);
    rejected = fetched.rejected;
    const seen = fetched.rows.length + rejected;
    if (seen > 0 && rejected / seen > MAX_REJECT_RATE) {
      result = {
        status: "failed",
        rowsUpserted: 0,
        rowsRejected: rejected,
        error: `rejected ${rejected} of ${seen} features (over 20%); nothing written`,
      };
    } else {
      for (let i = 0; i < fetched.rows.length; i += BATCH_SIZE) {
        const batch = fetched.rows.slice(i, i + BATCH_SIZE);
        await store.upsert(batch);
        upserted += batch.length;
      }
      if (upserted > 0) await store.refresh();
      result = fetched.complete
        ? { status: "ok", rowsUpserted: upserted, rowsRejected: rejected, error: null }
        : {
            status: "partial",
            rowsUpserted: upserted,
            rowsRejected: rejected,
            error: `got ${seen} of ${fetched.total} features Traffy reported`,
          };
    }
  } catch (e) {
    result = { status: "failed", rowsUpserted: upserted, rowsRejected: rejected, error: e instanceof Error ? e.message : String(e) };
  }
  await store.finishRun(runId, result);
  return result;
}
```

- [ ] **Step 4: Run pipeline tests, verify they pass**

Run: `npx vitest run ingest/pipeline.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Write the failing store integration test**

`ingest/store.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { serviceClient, type Db } from "./db.ts";
import { createStore } from "./store.ts";
import type { FloodRow } from "./traffy.ts";

// Runs against local Supabase. CI exports the env; locally it comes from .env.ingest (see vitest.config.ts).
const enabled = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

describe.skipIf(!enabled)("createStore (local Supabase)", () => {
  let db: Db;
  let runId: number | undefined;
  const row = (id: string, state: string): FloodRow => ({
    source: "test", // never 'traffy', so cleanup cannot touch real rows
    source_id: id,
    reported_at: "2026-09-15T22:44:31+07:00",
    finished_at: null,
    geom: "SRID=4326;POINT(100.65 13.65)",
    state,
  });

  beforeAll(() => {
    db = serviceClient();
  });
  afterAll(async () => {
    await db.from("flood_reports").delete().eq("source", "test");
    if (runId !== undefined) await db.from("ingest_runs").delete().eq("id", runId);
  });

  it("refresh_score_reference is callable with the service-role key", async () => {
    await expect(createStore(db).refresh()).resolves.toBeUndefined();
  });

  it("upsert is idempotent and updates state", async () => {
    const store = createStore(db);
    await store.upsert([row("t1", "รอรับเรื่อง"), row("t2", "รอรับเรื่อง")]);
    await store.upsert([row("t1", "เสร็จสิ้น"), row("t2", "รอรับเรื่อง")]);
    const { data, error } = await db
      .from("flood_reports")
      .select("source_id, state, reported_at")
      .eq("source", "test")
      .order("source_id");
    expect(error).toBeNull();
    expect(data).toHaveLength(2);
    expect(data?.[0].state).toBe("เสร็จสิ้น");
    expect(new Date(data![0].reported_at).toISOString()).toBe("2026-09-15T15:44:31.000Z");
  });

  it("records a run from start to finish", async () => {
    const store = createStore(db);
    runId = await store.startRun({ start: "2026-10-01", end: "2026-10-03" });
    await store.finishRun(runId, { status: "partial", rowsUpserted: 5, rowsRejected: 1, error: "x".repeat(5000) });
    const { data } = await db.from("ingest_runs").select("*").eq("id", runId).single();
    expect(data).toMatchObject({ source: "traffy", status: "partial", rows_upserted: 5, rows_rejected: 1 });
    expect(data?.finished_at).not.toBeNull();
    expect(data?.error).toHaveLength(2000);
    expect(new Date(data!.window_start!).toISOString()).toBe("2026-09-30T17:00:00.000Z");
  });
});
```

- [ ] **Step 6: Run it, verify it fails**

Run: `npx vitest run ingest/store.test.ts`
Expected: FAIL, cannot resolve `./store.ts`. (Needs `.env.ingest` from Task 3 Step 7; without it the suite is skipped instead of failing.)

- [ ] **Step 7: Implement `ingest/store.ts`**

```ts
import type { Db } from "./db.ts";
import type { Store } from "./pipeline.ts";

function check(error: { message: string } | null): void {
  if (error) throw new Error(error.message);
}

export function createStore(db: Db): Store {
  return {
    async startRun({ start, end }) {
      const { data, error } = await db
        .from("ingest_runs")
        .insert({
          source: "traffy",
          status: "running",
          window_start: `${start}T00:00:00+07:00`,
          window_end: `${end}T23:59:59+07:00`,
        })
        .select("id")
        .single();
      if (error || !data) throw new Error(error?.message ?? "ingest_runs insert returned no id");
      return data.id;
    },
    async upsert(rows) {
      // district/subdistrict are omitted on purpose: the set_report_area trigger derives them
      const { error } = await db.from("flood_reports").upsert(rows, { onConflict: "source,source_id" });
      check(error);
    },
    async refresh() {
      const { error } = await db.rpc("refresh_score_reference");
      check(error);
    },
    async finishRun(id, r) {
      const { error } = await db
        .from("ingest_runs")
        .update({
          status: r.status,
          finished_at: new Date().toISOString(),
          rows_upserted: r.rowsUpserted,
          rows_rejected: r.rowsRejected,
          error: r.error?.slice(0, 2000) ?? null,
        })
        .eq("id", id);
      check(error);
    },
  };
}
```

- [ ] **Step 8: Run all tests, verify they pass**

Run: `npm test`
Expected: PASS, including 3 tests in `ingest/store.test.ts` (not skipped).

- [ ] **Step 9: CI runs Vitest after the database is up**

In `.github/workflows/ci.yml`, move the `- run: npm test` line so it comes after the "Start database and apply migrations" step, and insert between them:

```yaml
      - name: Export local Supabase env for integration tests
        run: >-
          npx supabase status -o env
          | sed -n 's/^API_URL="\(.*\)"$/SUPABASE_URL=\1/p; s/^SERVICE_ROLE_KEY="\(.*\)"$/SUPABASE_SERVICE_ROLE_KEY=\1/p'
          >> "$GITHUB_ENV"
```

Resulting order of steps: checkout, setup-node, `npm ci`, lint, typecheck, NEXT_PUBLIC grep guard, start database, export env, `npm test`, pgTAP, security advisor, generated types diff.

Verify the sed locally: `npx supabase status -o env | sed -n 's/^API_URL="\(.*\)"$/SUPABASE_URL=\1/p; s/^SERVICE_ROLE_KEY="\(.*\)"$/SUPABASE_SERVICE_ROLE_KEY=\1/p' | cut -c1-40`
Expected: two lines, `SUPABASE_URL=http://127.0.0.1:54321` and `SUPABASE_SERVICE_ROLE_KEY=eyJ…`, no quotes.

- [ ] **Step 10: Lint, typecheck, commit**

Run: `npm run lint && npm run typecheck`

```bash
git add ingest/pipeline.ts ingest/pipeline.test.ts ingest/store.ts ingest/store.test.ts .github/workflows/ci.yml
git commit -m "feat(ingest): run pipeline (reject rule, batches, run status) and Supabase store"
```

---

### Task 6: Entry scripts and workflows

**Files:**
- Create: `ingest/run.ts`, `ingest/backfill.ts`, `.github/workflows/ingest.yml`, `.github/workflows/db-push.yml`
- Modify: `package.json`, `README.md`

**Interfaces:**
- Consumes: `runIngest` (Task 5), `createStore` (Task 5), `serviceClient` (Task 3), `bangkokDate` (Task 4).
- Produces: `node ingest/run.ts` (exit 1 only when the run is `failed`), `node ingest/backfill.ts`; npm scripts `ingest`, `backfill`; workflows `Ingest` (cron + dispatch `task: run | backfill | load-areas`) and `DB push (prod)`.
- GitHub secrets used: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (ingest); `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_ID` (db-push).

- [ ] **Step 1: Entry scripts**

`ingest/run.ts`:

```ts
// Hourly ingest. Re-fetches the last 48 h (Bangkok dates) so one failed hour is filled by the next run.
import { serviceClient } from "./db.ts";
import { runIngest } from "./pipeline.ts";
import { createStore } from "./store.ts";
import { bangkokDate } from "./traffy.ts";

const now = Date.now();
const window = { start: bangkokDate(new Date(now - 2 * 86400_000)), end: bangkokDate(new Date(now)) };
const result = await runIngest(createStore(serviceClient()), window);
console.log(JSON.stringify({ window, ...result }));
if (result.status === "failed") process.exitCode = 1; // red job -> GitHub emails the owner
```

`ingest/backfill.ts`:

```ts
// One-time historical load. Traffy flood data starts in September 2021 and the API pages
// the whole range exactly, so the backfill is one long window through the same pipeline.
import { serviceClient } from "./db.ts";
import { runIngest } from "./pipeline.ts";
import { createStore } from "./store.ts";
import { bangkokDate } from "./traffy.ts";

const window = { start: "2021-01-01", end: bangkokDate(new Date()) };
const t = Date.now();
const result = await runIngest(createStore(serviceClient()), window);
console.log(JSON.stringify({ window, ...result, seconds: Math.round((Date.now() - t) / 1000) }));
if (result.status === "failed") process.exitCode = 1;
```

`package.json` `scripts`: add

```json
    "ingest": "node --env-file-if-exists=.env.ingest ingest/run.ts",
    "backfill": "node --env-file-if-exists=.env.ingest ingest/backfill.ts",
```

- [ ] **Step 2: Smoke-test the hourly run locally**

Run: `npm run ingest`
Expected: one JSON line with `"status":"ok"` (or `"partial"`), `rowsUpserted` in the hundreds or more, exit code 0. Then:

```bash
docker exec supabase_db_Easy_website psql -U postgres -tAc "select status, rows_upserted, rows_rejected from public.ingest_runs order by id desc limit 1; select count(*), count(district) from public.flood_reports;"
```
Expected: the run row matches the JSON; `count(district)` close to `count(*)` (areas were loaded in Task 3; points outside Bangkok's polygons stay null).

Run `npm run ingest` a second time. Expected: `count(*)` the same or slightly higher (new reports only), never doubled.

- [ ] **Step 3: Hourly workflow**

`.github/workflows/ingest.yml`:

```yaml
name: Ingest

on:
  schedule:
    - cron: "0 * * * *"
  workflow_dispatch:
    inputs:
      task:
        description: Script to run
        type: choice
        options: [run, backfill, load-areas]
        default: run

permissions:
  contents: read

# Never two ingests at once; a queued run waits instead of being cancelled.
concurrency:
  group: ingest
  cancel-in-progress: false

jobs:
  ingest:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm

      - run: npm ci --omit=dev

      - name: Run ingest script
        run: node "ingest/$TASK.ts"
        env:
          TASK: ${{ inputs.task || 'run' }}
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
```

- [ ] **Step 4: Prod migration workflow**

`.github/workflows/db-push.yml`:

```yaml
name: DB push (prod)

# Manual only: prod migrations are never automatic (spec §9).
on: workflow_dispatch

permissions:
  contents: read

concurrency:
  group: db-push
  cancel-in-progress: false

jobs:
  push:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    env:
      SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
      SUPABASE_DB_PASSWORD: ${{ secrets.SUPABASE_DB_PASSWORD }}
      SUPABASE_PROJECT_ID: ${{ secrets.SUPABASE_PROJECT_ID }}
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm

      - run: npm ci

      - run: npx supabase link --project-ref "$SUPABASE_PROJECT_ID"

      - run: npx supabase db push

      # Spec success criterion 4: no security advisor warnings on prod
      - run: npx supabase db advisors --linked --type security --fail-on warn
```

- [ ] **Step 5: README**

Append to `README.md`:

~~~markdown
## Ingest

Scripts in `ingest/` run directly with Node ≥ 22.18. Locally they read `.env.ingest` (see `.env.example`).

```bash
npm run load-areas   # replace district/subdistrict polygons, recompute score grid
npm run backfill     # one-time: all Traffy flood reports since 2021 (~10 min)
npm run ingest       # what the hourly job runs: last 48 h
```

In GitHub: **Actions → Ingest** runs hourly. **Run workflow** lets you pick `run`, `backfill` or `load-areas`.
**Actions → DB push (prod)** applies migrations to production (manual only).
A failed ingest turns the job red and GitHub emails the repo owner. GitHub pauses scheduled workflows
after 60 days without commits in a public repo; re-enable it under Actions if that happens.
~~~

- [ ] **Step 6: Lint, typecheck, test, commit**

Run: `npm run lint && npm run typecheck && npm test`

```bash
git add ingest/run.ts ingest/backfill.ts package.json README.md .github/workflows/ingest.yml .github/workflows/db-push.yml
git commit -m "feat(ingest): hourly run and backfill entry points, ingest and db-push workflows"
```

---

### Task 7: Full local backfill, measurements, reality check

Spec success criterion 5 and the Plan 1 follow-up "measure refresh runtime on real data".

**Files:**
- Create: `ingest/reality.ts`, `ingest/reality.test.ts`, `ingest/reality-check.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `public.flood_overview_v1()` (Plan 1; returns `districts: {district, weighted_count, reports_this_year, rank}[]`), env `SUPABASE_URL` + `SUPABASE_RPC_KEY` (the anon key, from `.env.local`).
- Produces: `ingest/reality.ts`: `export type DistrictRank = { district: string; rank: number }`; `export function spikeFailures(districts: DistrictRank[]): string[]`; npm script `reality-check`.

- [ ] **Step 1: Write the failing test**

`ingest/reality.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { spikeFailures, type DistrictRank } from "./reality.ts";

const good: DistrictRank[] = [
  { district: "ประเวศ", rank: 1 },
  { district: "ลาดกระบัง", rank: 2 },
  { district: "หนองจอก", rank: 3 },
  { district: "มีนบุรี", rank: 4 },
  { district: "บางเขน", rank: 9 },
  { district: "บางนา", rank: 20 },
  { district: "ธนบุรี", rank: 45 },
];

describe("spikeFailures", () => {
  it("passes the spike ranking", () => {
    expect(spikeFailures(good)).toEqual([]);
  });
  it("flags each broken rule", () => {
    const bad = good.map((d) =>
      d.district === "บางเขน" ? { ...d, rank: 16 } : d.district === "ธนบุรี" ? { ...d, rank: 35 } : d,
    );
    expect(spikeFailures(bad)).toEqual([
      "บางเขน: rank 16, expected top 15",
      "ธนบุรี: rank 35, expected rank 36 or lower",
    ]);
  });
  it("flags missing districts and an out-of-band middle", () => {
    const f = spikeFailures([
      ...good.filter((d) => d.district !== "ประเวศ" && d.district !== "บางนา"),
      { district: "บางนา", rank: 5 },
    ]);
    expect(f).toContain("ประเวศ: rank missing, expected top 15");
    expect(f).toContain("บางนา: rank 5, expected between 11 and 39");
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run ingest/reality.test.ts`
Expected: FAIL, cannot resolve `./reality.ts`.

- [ ] **Step 3: Implement**

`ingest/reality.ts`:

```ts
// Spec success criterion 5, from the 2026-10-02 spike (Prawet #1, Thon Buri #39 of 50).
// ponytail: fixed rank bands; if real data breaks one, investigate the data before moving a band.
export type DistrictRank = { district: string; rank: number };

const HIGH = ["ประเวศ", "ลาดกระบัง", "มีนบุรี", "หนองจอก", "บางเขน"];

export function spikeFailures(districts: DistrictRank[]): string[] {
  const rank = new Map(districts.map((d) => [d.district, d.rank]));
  const failures: string[] = [];
  const need = (name: string, ok: (r: number) => boolean, rule: string) => {
    const r = rank.get(name);
    if (r === undefined || !ok(r)) failures.push(`${name}: rank ${r ?? "missing"}, expected ${rule}`);
  };
  for (const name of HIGH) need(name, (r) => r <= 15, "top 15");
  need("ธนบุรี", (r) => r >= 36, "rank 36 or lower");
  need("บางนา", (r) => r > 10 && r < 40, "between 11 and 39");
  return failures;
}
```

`ingest/reality-check.ts`:

```ts
// Calls the public read RPC exactly like the web app does (anon key), then checks the spike ranking.
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
```

`package.json` `scripts`: add

```json
    "reality-check": "node --env-file-if-exists=.env.local ingest/reality-check.ts",
```

- [ ] **Step 4: Run test, verify it passes**

Run: `npx vitest run ingest/reality.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Backfill the local database**

Run: `npm run backfill`
Expected (~10 min): JSON line with `"status":"ok"`, `rowsUpserted` ≈ 42,500 (the `total` Traffy reports), `rowsRejected` small.

Check the acceptance rule (within 5 % of the API total):

```bash
docker exec supabase_db_Easy_website psql -U postgres -tAc "select count(*), count(district), min(reported_at), max(reported_at) from public.flood_reports where source = 'traffy'"
```
Expected: `count` ≥ 95 % of the total Traffy reported; `min` in Sep 2021; most rows have a district.

- [ ] **Step 6: Measure (Plan 1 follow-up)**

```bash
npm run load-areas
docker exec supabase_db_Easy_website psql -U postgres -c '\timing on' -c 'select public.refresh_score_reference()' -c 'select public.flood_score_v1(13.7167, 100.695)' -c 'select length(public.flood_overview_v1()::text)'
```
Expected: `load_areas` and `refresh_score_reference` each well under 120 s; `flood_score_v1` under 2 s (spec success criterion 1, DB part); note the overview length in bytes for Plan 3. Write the numbers into the PR description.

If refresh takes more than 60 s, stop and report to the user: the grid query needs work before production (the 120 s cap would be at risk).

- [ ] **Step 7: Reality check**

Make sure `.env.local` has `SUPABASE_URL` and `SUPABASE_RPC_KEY` (the `ANON_KEY` from `npx supabase status -o env`). Run: `npm run reality-check`
Expected: top 10 printed and `spike check passed`. If it fails, report the printed ranks to the user; do not change the bands without the user.

- [ ] **Step 8: pgTAP still green on a full local DB**

Run: `npx supabase test db`
Expected: PASS (the Task 1 truncates isolate the tests from the 42k real rows).

- [ ] **Step 9: Lint, typecheck, test, commit, PR**

Run: `npm run lint && npm run typecheck && npm test`

```bash
git add ingest/reality.ts ingest/reality.test.ts ingest/reality-check.ts package.json
git commit -m "feat(ingest): spike-district reality check"
```

Push and open the PR (`feat/ingest` → `main`) with the measurements from Step 6. CI must be green.

---

### Task 8: Production setup (the user does this; the agent guides)

No code. Each step needs the user's accounts. The agent asks the user to do each step, then verifies what it can.

- [ ] **Step 1: Create the prod Supabase project**

supabase.com → New project, region Southeast Asia (Singapore). Save the database password. From Project Settings collect: project ref (ID), API URL, `service_role` key (or a secret key), anon/publishable key. Create a personal access token at supabase.com/dashboard/account/tokens.

- [ ] **Step 2: GitHub secrets**

Repo → Settings → Secrets and variables → Actions → New repository secret, five times:
`SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_ID`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

- [ ] **Step 3: Migrate prod**

After the PR is merged: Actions → **DB push (prod)** → Run workflow. Expected: green, including the security advisor step.

- [ ] **Step 4: Load areas, then backfill**

Actions → **Ingest** → Run workflow → `load-areas`. Expected: green; log shows `load_areas: 230 areas`.
Then Run workflow → `backfill`. Expected: green in ~10 min; log JSON `"status":"ok"`, `rowsUpserted` within 5 % of Traffy's total.

- [ ] **Step 5: Verify the hourly schedule**

Wait for the next full hour. Expected: an automatic **Ingest** run, green (spec success criterion 2).

- [ ] **Step 6: Reality check against prod**

Locally, with the prod URL and the prod anon/publishable key (safe: it can only call the read RPCs):

```bash
SUPABASE_URL=https://<ref>.supabase.co SUPABASE_RPC_KEY=<anon key> node ingest/reality-check.ts
```
Expected: `spike check passed`.
