begin;
select plan(26);
truncate public.flood_reports, public.ingest_runs, public.score_reference, public.areas; -- rolled back at the end

-- Fixture point in Prawet (13.7167, 100.695). 0.001 deg lat is ~111 m (inside 300 m), 0.004 is ~445 m (outside).

-- one fresh report nearby, one outside 300 m (must not count)
insert into public.flood_reports (source_id, reported_at, geom)
values ('a1', now(), extensions.st_setsrid(extensions.st_makepoint(100.695, 13.7177), 4326)::extensions.geography),
       ('far', now(), extensions.st_setsrid(extensions.st_makepoint(100.695, 13.7207), 4326)::extensions.geography);

-- empty reference (before first refresh) with reports present: score 0, no division by zero
select is((public.flood_score_v1(13.7167, 100.695)->>'score')::int, 0, 'empty reference');
-- a point with no reports nearby (Thon Buri)
select is(public.flood_score_v1(13.72, 100.48)->>'label', 'none', 'no reports gives label none');

-- decay
select ok(abs(public.report_weight(now()) - 1) < 1e-9, 'fresh report weighs 1');
select ok(abs(public.report_weight(now() - interval '730 days 12 hours') - 0.5) < 0.01, 'two-year-old report weighs ~0.5');
select ok(public.report_weight(now() + interval '3 days') <= 1, 'future report weighs at most 1');

-- reference: 10 grid rows with weighted counts 0,0,0,0,0,1,2,3,4,5
insert into public.score_reference (score_version, grid_point, weighted_count)
select 1, extensions.st_setsrid(extensions.st_makepoint(100.5, 13.6 + i * 0.01), 4326)::extensions.geography, w
from unnest(array[0,0,0,0,0,1,2,3,4,5]::real[]) with ordinality as t(w, i);
-- a version-2 row must be ignored
insert into public.score_reference values (2, extensions.st_setsrid(extensions.st_makepoint(100.5, 13.5), 4326)::extensions.geography, 0);

-- report a1 -> wc = 1 -> 5 of 10 below -> 50 -> medium
select is((public.flood_score_v1(13.7167, 100.695)->>'report_count')::int, 1, 'only reports within 300 m count');
select is((public.flood_score_v1(13.7167, 100.695)->>'score')::int, 50, 'wc 1 -> score 50');
select is(public.flood_score_v1(13.7167, 100.695)->>'label', 'medium', '50 is medium');

-- two more -> wc = 3 -> 7 of 10 below -> 70 -> high
insert into public.flood_reports (source_id, reported_at, geom)
select 'a' || i, now(), extensions.st_setsrid(extensions.st_makepoint(100.695, 13.7177), 4326)::extensions.geography
from generate_series(2, 3) i;
select is((public.flood_score_v1(13.7167, 100.695)->>'score')::int, 70, 'wc 3 -> score 70');
select is(public.flood_score_v1(13.7167, 100.695)->>'label', 'high', '70 is high');

-- Bangkok month: 01:00 on 1 Oct in Bangkok is 30 Sep in UTC; must count as October (json index 9)
insert into public.flood_reports (source_id, reported_at, geom)
values ('m1', '2025-10-01 01:00+07', extensions.st_setsrid(extensions.st_makepoint(100.695, 13.7177), 4326)::extensions.geography);
select is((public.flood_score_v1(13.7167, 100.695)->'monthly_counts'->>9)::int,
          case when extract(month from now() at time zone 'Asia/Bangkok') = 10 then 4 else 1 end,
          'Bangkok month: October');
select is(jsonb_array_length(public.flood_score_v1(13.7167, 100.695)->'monthly_counts'), 12, '12 months');
select is((public.flood_score_v1(13.7167, 100.695)->>'years_with_reports')::int,
          case when extract(year from now() at time zone 'Asia/Bangkok') = 2025 then 1 else 2 end,
          'years with reports');

-- no areas rows: area names are null
select ok((public.flood_score_v1(13.7167, 100.695)->'district') = 'null'::jsonb, 'district null without areas');
select ok((public.flood_score_v1(13.7167, 100.695)->'subdistrict') = 'null'::jsonb, 'subdistrict null without areas');

-- input validation
select throws_ok($$select public.flood_score_v1(14.03, 100.62)$$, 'P0001', 'outside_bangkok', 'Rangsit rejected');
select throws_ok($$select public.flood_score_v1(null, 100.6)$$, 'P0001', 'outside_bangkok', 'null input rejected');

-- refresh: idempotent, and not callable by anon
select public.refresh_score_reference();
create temp table c1 as select count(*) as n from public.score_reference where score_version = 1;
select public.refresh_score_reference();
select is((select count(*) from public.score_reference where score_version = 1), (select n from c1), 'refresh idempotent');
select ok((select n from c1) > 0, 'refresh produced rows');
select ok(not has_function_privilege('anon', 'public.refresh_score_reference()', 'execute'), 'anon cannot refresh');

-- only a subdistrict row exists: bbox fallback must still apply
insert into public.areas (level, district_th, name_th, name_en, geom) values
  ('subdistrict', 'ประเวศ', 'หนองบอน', 'Nong Bon',
   extensions.st_geogfromtext('SRID=4326;MULTIPOLYGON(((100.6 13.6,100.8 13.6,100.8 13.8,100.6 13.8,100.6 13.6)))'));
select public.refresh_score_reference();
select ok((select count(*) from public.score_reference where score_version = 1) > 0, 'fallback survives subdistrict-only areas');
select is(public.flood_score_v1(13.7167, 100.695)->>'subdistrict', 'หนองบอน', 'score names subdistrict');
select ok((public.flood_score_v1(13.7167, 100.695)->'district') = 'null'::jsonb, 'district still null');
insert into public.areas (level, district_th, name_th, name_en, geom) values
  ('district', 'ประเวศ', 'ประเวศ', 'Prawet',
   extensions.st_geogfromtext('SRID=4326;MULTIPOLYGON(((100.6 13.6,100.8 13.6,100.8 13.8,100.6 13.8,100.6 13.6)))'));
select is(public.flood_score_v1(13.7167, 100.695)->>'district', 'ประเวศ', 'score names district');

-- concurrent refreshes (hourly ingest vs. load-areas) must not interleave
select ok(pg_get_functiondef('public.refresh_score_reference()'::regprocedure) like '%pg_advisory_xact_lock%',
          'refresh serializes with an advisory lock');
-- service_role inherits an 8 s timeout through PostgREST; refresh needs more on real data
select ok('statement_timeout=120s' = any(p.proconfig), 'refresh may run 120 s')
from pg_proc p where p.oid = 'public.refresh_score_reference()'::regprocedure;

select * from finish();
rollback;
