begin;
select plan(7);
truncate public.flood_reports, public.ingest_runs, public.score_reference, public.areas; -- rolled back at the end

insert into public.flood_reports (source_id, reported_at, geom, state)
select 'p' || i, now() - (i || ' days')::interval,
       extensions.st_setsrid(extensions.st_makepoint(100.695, 13.7177), 4326)::extensions.geography, 'finish'
from generate_series(1, 510) i;
insert into public.flood_reports (source_id, reported_at, geom)
values ('far', now(), extensions.st_setsrid(extensions.st_makepoint(100.695, 13.7207), 4326)::extensions.geography);

select is((select count(*)::int from public.flood_points_v1(13.7167, 100.695)), 500, 'capped at 500 rows');
select is((select reported_at from public.flood_points_v1(13.7167, 100.695) limit 1)::date,
          (now() - interval '1 day')::date, 'newest first');
select ok(not exists (select 1 from public.flood_points_v1(13.7167, 100.695) where abs(report_lat - 13.7207) < 1e-6),
          'excludes report outside 300 m');
select is((select count(*)::int from public.flood_points_v1(13.7167, 100.695, 1000) where abs(report_lat - 13.7207) < 1e-6),
          1, 'radius 1000 includes it');
select throws_ok($$select * from public.flood_points_v1(13.7167, 100.695, 50)$$, 'P0001', 'bad_radius', 'radius below 100');
select throws_ok($$select * from public.flood_points_v1(13.7167, 100.695, 5000)$$, 'P0001', 'bad_radius', 'radius above 1000');
select throws_ok($$select * from public.flood_points_v1(14.03, 100.62)$$, 'P0001', 'outside_bangkok', 'outside Bangkok');

select * from finish();
rollback;
