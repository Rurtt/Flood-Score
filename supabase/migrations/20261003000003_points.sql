create function public.flood_points_v1(lat double precision, lng double precision, radius_m int default 300)
returns table (report_lat double precision, report_lng double precision, reported_at timestamptz, state text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.in_bangkok(lat, lng) then
    raise exception 'outside_bangkok';
  end if;
  if radius_m is null or radius_m < 100 or radius_m > 1000 then
    raise exception 'bad_radius';
  end if;
  return query
    select extensions.st_y(r.geom::extensions.geometry),
           extensions.st_x(r.geom::extensions.geometry),
           r.reported_at,
           r.state
      from public.flood_reports r
     where extensions.st_dwithin(
             r.geom,
             extensions.st_setsrid(extensions.st_makepoint(lng, lat), 4326)::extensions.geography,
             radius_m)
     order by r.reported_at desc
     limit 500;
end $$;

revoke execute on function public.flood_points_v1(double precision, double precision, int) from public, anon, authenticated;
grant execute on function public.flood_points_v1(double precision, double precision, int) to anon;
