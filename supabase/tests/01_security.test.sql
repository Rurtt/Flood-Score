begin;
select plan(13);

-- RLS on every table
select ok((select relrowsecurity from pg_class where oid = 'public.flood_reports'::regclass), 'RLS on flood_reports');
select ok((select relrowsecurity from pg_class where oid = 'public.ingest_runs'::regclass), 'RLS on ingest_runs');
select ok((select relrowsecurity from pg_class where oid = 'public.score_reference'::regclass), 'RLS on score_reference');
select ok((select relrowsecurity from pg_class where oid = 'public.areas'::regclass), 'RLS on areas');

-- no table privileges for client roles
select ok(not has_table_privilege('anon', 'public.flood_reports', 'select'), 'anon cannot select flood_reports');
select ok(not has_table_privilege('anon', 'public.flood_reports', 'insert'), 'anon cannot insert flood_reports');
select ok(not has_table_privilege('authenticated', 'public.flood_reports', 'select'), 'authenticated cannot select flood_reports');
select ok(not has_table_privilege('anon', 'public.ingest_runs', 'select'), 'anon cannot select ingest_runs');
select ok(not has_table_privilege('anon', 'public.score_reference', 'select'), 'anon cannot select score_reference');
select ok(not has_table_privilege('anon', 'public.areas', 'select'), 'anon cannot select areas');
select ok(not has_table_privilege('authenticated', 'public.areas', 'update'), 'authenticated cannot update areas');

-- the actual behaviour, not just the catalog
set local role anon;
select throws_ok($$select * from public.flood_reports$$, '42501', null, 'anon select is denied');
reset role;

-- PDPA: no free-text reporter columns
select hasnt_column('public', 'flood_reports', 'description', 'no reporter text stored');

select * from finish();
rollback;
