-- Same refresh body, with an advisory lock so ingest and load-areas never
-- interleave delete/insert. PostgREST's service_role timeout needs more time
-- for a reference refresh on real data.
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
