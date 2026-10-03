-- Database-owned area names replace all incoming report names.
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
create trigger flood_reports_set_area before insert or update on public.flood_reports
for each row execute function public.set_report_area();

create function public.load_areas(payload jsonb)
returns void language plpgsql set search_path = '' set statement_timeout = '120s' as $$
declare
  item jsonb;
  polygon extensions.geometry;
  bad text;
begin
  if payload is null or pg_catalog.jsonb_typeof(payload) <> 'array' then
    raise exception 'bad_payload: expected non-empty array';
  end if;
  if pg_catalog.jsonb_array_length(payload) = 0 then
    raise exception 'bad_payload: expected non-empty array';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('public.refresh_score_reference'));
  -- Writers acquire flood_reports first; keep that order to avoid lock inversion.
  lock table public.flood_reports in share row exclusive mode;
  lock table public.areas in share row exclusive mode;
  drop table if exists pg_temp.new_areas;
  create temporary table new_areas (level text, name_th text, name_en text, g extensions.geometry) on commit drop;
  for item in select value from pg_catalog.jsonb_array_elements(payload) loop
    polygon := null;
    begin
      polygon := extensions.st_multi(extensions.st_buildarea(extensions.st_collect(array(
        select extensions.st_geomfromgeojson(pg_catalog.jsonb_build_object('type', 'LineString', 'coordinates', w.value)::text)
        from pg_catalog.jsonb_array_elements(item->'ways') w))));
    exception when others then
      -- Geometry parser errors belong to the named bad_area contract.
      polygon := null;
    end;
    insert into pg_temp.new_areas values (item->>'level', item->>'name_th', nullif(item->>'name_en', ''), polygon);
  end loop;
  select pg_catalog.string_agg(coalesce(n.name_th, '?'), ', ') into bad from pg_temp.new_areas n
  where n.level is null or n.level not in ('district', 'subdistrict')
    or n.name_th is null or pg_catalog.btrim(n.name_th) = ''
    or n.g is null or extensions.st_isempty(n.g) or not extensions.st_isvalid(n.g)
    or extensions.geometrytype(n.g) <> 'MULTIPOLYGON';
  if bad is not null then raise exception 'bad_area: %', bad; end if;
  select pg_catalog.string_agg(s.name_th, ', ') into bad from pg_temp.new_areas s
  where s.level = 'subdistrict' and not exists (select 1 from pg_temp.new_areas d
    where d.level = 'district' and extensions.st_covers(d.g, extensions.st_pointonsurface(s.g)));
  if bad is not null then raise exception 'orphan_subdistrict: %', bad; end if;
  delete from public.areas where true;
  insert into public.areas (level, district_th, name_th, name_en, geom)
    select 'district', n.name_th, n.name_th, n.name_en, n.g::extensions.geography
    from pg_temp.new_areas n where n.level = 'district';
  insert into public.areas (level, district_th, name_th, name_en, geom)
    select 'subdistrict', p.name_th, s.name_th, s.name_en, s.g::extensions.geography
    from pg_temp.new_areas s cross join lateral (
      select d.name_th from pg_temp.new_areas d where d.level = 'district'
        and extensions.st_covers(d.g, extensions.st_pointonsurface(s.g))
      order by d.name_th limit 1) p where s.level = 'subdistrict';
  update public.flood_reports set geom = geom where true;
end $$;
revoke execute on function public.set_report_area(), public.load_areas(jsonb) from public, anon, authenticated;
grant execute on function public.set_report_area(), public.load_areas(jsonb) to service_role;