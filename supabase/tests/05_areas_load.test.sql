begin;
select plan(30);
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

select throws_ok($t$select public.load_areas(null)$t$, 'P0001', 'bad_payload: expected non-empty array', 'SQL null rejected');
select throws_ok($t$select public.load_areas('null'::jsonb)$t$, 'P0001', 'bad_payload: expected non-empty array', 'JSON null rejected');
select throws_ok($t$select public.load_areas('{}'::jsonb)$t$, 'P0001', 'bad_payload: expected non-empty array', 'object rejected');
select throws_ok($t$select public.load_areas('[]'::jsonb)$t$, 'P0001', 'bad_payload: expected non-empty array', 'empty array rejected');
select throws_ok($t$select public.load_areas('[{"level":"wrong","name_th":"bad"}]'::jsonb)$t$, 'P0001', 'bad_area: bad', 'unknown level rejected');
select throws_ok($t$select public.load_areas('[{"level":"district","ways":[]}]'::jsonb)$t$, 'P0001', 'bad_area: ?', 'missing name rejected');
select throws_ok($t$select public.load_areas('[{"level":"district","name_th":"broken","ways":{}}]'::jsonb)$t$, 'P0001', 'bad_area: broken', 'malformed ways rejected');
select is((select name_th from public.areas), 'ประเวศใหม่', 'invalid payloads preserve areas');
select ok(not has_function_privilege('authenticated', 'public.load_areas(jsonb)', 'execute'), 'authenticated cannot load areas');
select ok(not has_function_privilege('anon', 'public.set_report_area()', 'execute') and not has_function_privilege('authenticated', 'public.set_report_area()', 'execute'), 'client roles cannot execute trigger function');
select ok(has_function_privilege('service_role', 'public.set_report_area()', 'execute'), 'service role can execute trigger function');
select is((select district from public.flood_reports where source_id = 'in_sub'), 'ประเวศใหม่', 'failed loads preserve report names');
update public.flood_reports set geom = extensions.st_setsrid(extensions.st_makepoint(100.4,13.9),4326)::extensions.geography where source_id = 'in_sub';
select is((select district from public.flood_reports where source_id = 'in_sub'), null, 'moving a report clears its district');
select * from finish();
rollback;
