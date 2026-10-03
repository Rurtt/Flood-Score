create extension if not exists postgis with schema extensions;

create table public.flood_reports (
  source       text        not null default 'traffy',
  source_id    text        not null,
  reported_at  timestamptz not null,
  finished_at  timestamptz,
  geom         extensions.geography(Point, 4326) not null,
  district     text,
  subdistrict  text,
  state        text,
  ingested_at  timestamptz not null default now(),
  primary key (source, source_id)
);
create index flood_reports_geom_idx        on public.flood_reports using gist (geom);
create index flood_reports_reported_at_idx on public.flood_reports (reported_at);
create index flood_reports_district_idx    on public.flood_reports (district, subdistrict);

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
  grid_point     extensions.geography(Point, 4326) not null,
  weighted_count real not null
);
create index score_reference_version_idx on public.score_reference (score_version, weighted_count);

-- District/subdistrict polygons, loaded by the ingest (Plan 2).
create table public.areas (
  level        text not null check (level in ('district','subdistrict')),
  district_th  text not null,  -- for a district row this equals name_th
  name_th      text not null,
  name_en      text,
  geom         extensions.geography(MultiPolygon, 4326) not null,
  primary key (level, district_th, name_th)
);
create index areas_geom_idx on public.areas using gist (geom);

alter table public.flood_reports   enable row level security;
alter table public.ingest_runs     enable row level security;
alter table public.score_reference enable row level security;
alter table public.areas           enable row level security;

-- Supabase grants client roles access to new objects by default. Undo that.
revoke all on table public.flood_reports, public.ingest_runs, public.score_reference, public.areas
  from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
