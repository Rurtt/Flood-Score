begin;
select plan(16);

insert into public.areas (level, district_th, name_th, name_en, geom) values
  ('district', 'ประเวศ', 'ประเวศ', 'Prawet',
   extensions.st_geogfromtext('SRID=4326;MULTIPOLYGON(((100.6 13.6,100.8 13.6,100.8 13.8,100.6 13.8,100.6 13.6)))')),
  ('district', 'ธนบุรี', 'ธนบุรี', 'Thon Buri',
   extensions.st_geogfromtext('SRID=4326;MULTIPOLYGON(((100.45 13.7,100.5 13.7,100.5 13.75,100.45 13.75,100.45 13.7)))')),
  ('subdistrict', 'ประเวศ', 'หนองบอน', 'Nong Bon',
   extensions.st_geogfromtext('SRID=4326;MULTIPOLYGON(((100.6 13.6,100.7 13.6,100.7 13.7,100.6 13.7,100.6 13.6)))'));

insert into public.flood_reports (source_id, reported_at, geom, district, subdistrict)
select 'pw' || i, now(), extensions.st_setsrid(extensions.st_makepoint(100.65, 13.65), 4326)::extensions.geography, 'ประเวศ', 'หนองบอน'
from generate_series(1, 3) i;
insert into public.flood_reports (source_id, reported_at, geom, district, subdistrict)
values ('tb1', now(), extensions.st_setsrid(extensions.st_makepoint(100.48, 13.72), 4326)::extensions.geography, 'ธนบุรี', null);
insert into public.score_reference values
  (1, extensions.st_setsrid(extensions.st_makepoint(100.65, 13.65), 4326)::extensions.geography, 3),
  (1, extensions.st_setsrid(extensions.st_makepoint(100.48, 13.72), 4326)::extensions.geography, 0);
insert into public.ingest_runs (source, status, started_at, finished_at)
values ('traffy', 'ok', now() - interval '2 hours', now() - interval '1 hour');
insert into public.ingest_runs (source, status, started_at) values ('traffy', 'failed', now());

-- overview
select is(public.flood_overview_v1()->'districts'->0->>'district', 'ประเวศ', 'Prawet ranks first');
select is((public.flood_overview_v1()->'districts'->0->>'reports_this_year')::int, 3, 'reports this year');
select is(jsonb_array_length(public.flood_overview_v1()->'cells'), 1, 'only cells with reports');
select is((public.flood_overview_v1()->>'total_reports')::int, 4, 'total reports');

-- area
select is((public.flood_area_v1('ประเวศ')->>'district_rank')::int, 1, 'area rank');
select is((public.flood_area_v1('ประเวศ')->>'district_count')::int, 2, 'district count from areas');
select is(public.flood_area_v1('ประเวศ')->'subdistricts'->0->>'subdistrict', 'หนองบอน', 'subdistrict ranking');
select is((public.flood_area_v1('ประเวศ', 'หนองบอน')->>'report_count')::int, 3, 'subdistrict filter');
select throws_ok($$select public.flood_area_v1('ประเวท')$$, 'P0001', 'unknown_area', 'misspelt district rejected');
select throws_ok($$select public.flood_area_v1('ประเวศ', 'ไม่มี')$$, 'P0001', 'unknown_area', 'unknown subdistrict rejected');

-- ranking is driven by areas: zero-report district present, unknown district absent
insert into public.areas (level, district_th, name_th, name_en, geom) values
  ('district', 'บางเขน', 'บางเขน', 'Bang Khen',
   extensions.st_geogfromtext('SRID=4326;MULTIPOLYGON(((100.55 13.85,100.6 13.85,100.6 13.9,100.55 13.9,100.55 13.85)))'));
insert into public.flood_reports (source_id, reported_at, geom, district)
values ('rs1', now(), extensions.st_setsrid(extensions.st_makepoint(100.9, 13.9), 4326)::extensions.geography, 'รังสิต');
select is((select (d->>'weighted_count')::float8 from jsonb_array_elements(public.flood_overview_v1()->'districts') d
            where d->>'district' = 'บางเขน'), 0::float8, 'zero-report district listed with weighted_count 0');
select ok((public.flood_area_v1('บางเขน')->>'district_rank') is not null, 'zero-report district has rank');
select is((select count(*) from jsonb_array_elements(public.flood_overview_v1()->'districts') d
            where d->>'district' = 'รังสิต'), 0::bigint, 'district not in areas excluded from ranking');

-- status
select is(public.flood_status_v1()->>'last_run_status', 'failed', 'latest run status');
select ok((public.flood_status_v1()->>'last_ok_at') is not null, 'last ok time');

-- exactly these RPCs are callable by anon
select results_eq(
  $$select p.proname::text collate "default" from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute') order by 1$$,
  $$values ('flood_area_v1'), ('flood_overview_v1'), ('flood_points_v1'), ('flood_score_v1'), ('flood_status_v1')$$,
  'anon can execute only the five read RPCs');

select * from finish();
rollback;
