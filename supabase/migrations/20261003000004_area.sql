create function public.district_ranking()
returns table (district text, weighted_count double precision, reports_this_year bigint, rank bigint)
language sql stable set search_path = '' as $$
  with agg as (
    select r.district,
           sum(public.report_weight(r.reported_at)) as wc,
           count(*) filter (where extract(year from r.reported_at at time zone 'Asia/Bangkok')
                                = extract(year from now() at time zone 'Asia/Bangkok')) as ty
      from public.flood_reports r
     where r.district is not null
     group by r.district)
  select a.name_th,
         coalesce(g.wc, 0)::double precision,
         coalesce(g.ty, 0)::bigint,
         rank() over (order by coalesce(g.wc, 0) desc, a.name_th)
    from public.areas a
    left join agg g on g.district = a.name_th
   where a.level = 'district'
$$;

create function public.flood_overview_v1()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'cells', coalesce((
      select jsonb_agg(jsonb_build_array(
               round(extensions.st_y(s.grid_point::extensions.geometry)::numeric, 4),
               round(extensions.st_x(s.grid_point::extensions.geometry)::numeric, 4),
               round(s.weighted_count::numeric, 2)))
        from public.score_reference s
       where s.score_version = 1 and s.weighted_count > 0), '[]'::jsonb),
    'districts', coalesce((
      select jsonb_agg(to_jsonb(d) order by d.rank, d.district) from public.district_ranking() d), '[]'::jsonb),
    'total_reports', (select count(*) from public.flood_reports),
    'first_report_at', (select min(r.reported_at) from public.flood_reports r),
    'data_updated_at', (select max(i.finished_at) from public.ingest_runs i where i.status in ('ok', 'partial'))
  )
$$;

create function public.flood_area_v1(district_name text, subdistrict_name text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  result jsonb;
begin
  if not exists (select 1 from public.areas a where a.level = 'district' and a.name_th = district_name) then
    raise exception 'unknown_area';
  end if;
  if subdistrict_name is not null and not exists (
       select 1 from public.areas a
        where a.level = 'subdistrict' and a.district_th = district_name and a.name_th = subdistrict_name) then
    raise exception 'unknown_area';
  end if;

  with r as (
    select f.reported_at from public.flood_reports f
     where f.district = district_name
       and (subdistrict_name is null or f.subdistrict = subdistrict_name)
  )
  select jsonb_build_object(
    'district', district_name,
    'subdistrict', subdistrict_name,
    'district_rank', (select d.rank from public.district_ranking() d where d.district = district_name),
    'district_count', (select count(*) from public.areas a where a.level = 'district'),
    'report_count', (select count(*) from r),
    'yearly_counts', coalesce((
      select jsonb_agg(jsonb_build_object('year', t.y, 'count', t.n) order by t.y)
        from (select extract(year from r.reported_at at time zone 'Asia/Bangkok')::int as y, count(*) as n
                from r group by 1) t), '[]'::jsonb),
    'monthly_counts', (
      select jsonb_agg(coalesce(c.n, 0) order by m.m)
        from generate_series(1, 12) as m(m)
        left join (select extract(month from r.reported_at at time zone 'Asia/Bangkok')::int as mo, count(*) as n
                     from r group by 1) c on c.mo = m.m),
    'subdistricts', coalesce((
      select jsonb_agg(jsonb_build_object('subdistrict', s.subdistrict, 'count', s.n) order by s.n desc, s.subdistrict)
        from (select f.subdistrict, count(*) as n from public.flood_reports f
               where f.district = district_name and f.subdistrict is not null
               group by 1) s), '[]'::jsonb),
    'latest_report_at', (select max(r.reported_at) from r)
  ) into result;
  return result;
end $$;

create function public.flood_status_v1()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'last_ok_at', (select max(i.finished_at) from public.ingest_runs i where i.status in ('ok', 'partial')),
    'last_run_status', (select i.status from public.ingest_runs i order by i.started_at desc limit 1)
  )
$$;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.flood_score_v1(double precision, double precision) to anon;
grant execute on function public.flood_points_v1(double precision, double precision, int) to anon;
grant execute on function public.flood_overview_v1() to anon;
grant execute on function public.flood_area_v1(text, text) to anon;
grant execute on function public.flood_status_v1() to anon;
