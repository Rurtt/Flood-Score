-- Keep in sync with lib/bangkok.ts
create function public.in_bangkok(lat double precision, lng double precision)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(lat between 13.49 and 13.96 and lng between 100.32 and 100.94, false)
$$;

-- 0.5 ^ (age_years / 2); future timestamps count as age 0
create function public.report_weight(reported_at timestamptz)
returns double precision language sql stable set search_path = '' as $$
  select power(0.5, greatest(extract(epoch from (now() - reported_at)), 0) / (365.25 * 86400) / 2)
$$;

create function public.weighted_count_at(p extensions.geography)
returns real language sql stable set search_path = '' as $$
  select coalesce(sum(public.report_weight(r.reported_at)), 0)::real
  from public.flood_reports r
  where extensions.st_dwithin(r.geom, p, 300)
$$;

-- One transaction: readers keep seeing the old rows until commit.
create function public.refresh_score_reference()
returns void language plpgsql security definer set search_path = '' as $$
begin
  delete from public.score_reference where score_version = 1;
  insert into public.score_reference (score_version, grid_point, weighted_count)
  select 1, g.pt, public.weighted_count_at(g.pt)
  from (
    select extensions.st_setsrid(extensions.st_makepoint(lng::float8, lat::float8), 4326)::extensions.geography as pt
    from generate_series(13.49, 13.96, 0.0045) as lat,
         generate_series(100.32, 100.94, 0.0046) as lng
  ) g
  -- ponytail: bbox fallback until Plan 2 loads district polygons into public.areas
  where not exists (select 1 from public.areas b where b.level = 'district')
     or exists (select 1 from public.areas a
                where a.level = 'district' and extensions.st_covers(a.geom, g.pt));
end $$;

create function public.flood_score_v1(lat double precision, lng double precision)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  p            extensions.geography;
  v_rc         int;
  v_wc         real;
  v_years      int;
  v_latest     timestamptz;
  v_monthly    jsonb;
  v_ref_n      int;
  v_below      int;
  v_score      int;
  v_first_year int;
  v_updated    timestamptz;
  v_district    text;
  v_subdistrict text;
begin
  if not public.in_bangkok(lat, lng) then
    raise exception 'outside_bangkok';
  end if;
  p := extensions.st_setsrid(extensions.st_makepoint(lng, lat), 4326)::extensions.geography;

  select count(*),
         coalesce(sum(public.report_weight(r.reported_at)), 0),
         count(distinct extract(year from r.reported_at at time zone 'Asia/Bangkok')),
         max(r.reported_at)
    into v_rc, v_wc, v_years, v_latest
    from public.flood_reports r
   where extensions.st_dwithin(r.geom, p, 300);

  select jsonb_agg(coalesce(c.n, 0) order by m.m)
    into v_monthly
    from generate_series(1, 12) as m(m)
    left join (
      select extract(month from r.reported_at at time zone 'Asia/Bangkok')::int as mo, count(*) as n
        from public.flood_reports r
       where extensions.st_dwithin(r.geom, p, 300)
       group by 1
    ) c on c.mo = m.m;

  select count(*), count(*) filter (where s.weighted_count < v_wc)
    into v_ref_n, v_below
    from public.score_reference s
   where s.score_version = 1;

  v_score := case when v_rc = 0 or v_ref_n = 0 then 0
                  else round(100.0 * v_below / v_ref_n)::int end;

  select a.name_th into v_district from public.areas a
   where a.level = 'district' and extensions.st_covers(a.geom, p) order by a.name_th limit 1;
  select a.name_th into v_subdistrict from public.areas a
   where a.level = 'subdistrict' and extensions.st_covers(a.geom, p) order by a.name_th limit 1;

  select extract(year from min(r.reported_at) at time zone 'Asia/Bangkok')::int
    into v_first_year from public.flood_reports r;
  select max(i.finished_at) into v_updated
    from public.ingest_runs i where i.status in ('ok', 'partial');

  return jsonb_build_object(
    'score', v_score,
    'label', case when v_rc = 0 then 'none'
                  when v_score >= 90 then 'very_high'
                  when v_score >= 70 then 'high'
                  when v_score >= 40 then 'medium'
                  else 'low' end,
    'weighted_count', v_wc,
    'report_count', v_rc,
    'years_with_reports', v_years,
    'years_covered', coalesce(extract(year from now() at time zone 'Asia/Bangkok')::int - v_first_year + 1, 0),
    'monthly_counts', v_monthly,
    'latest_report_at', v_latest,
    'data_updated_at', v_updated,
    'district', v_district,
    'subdistrict', v_subdistrict,
    'score_version', 1
  );
end $$;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.flood_score_v1(double precision, double precision) to anon;
