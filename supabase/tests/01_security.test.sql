begin;
select plan(16);

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

-- new functions must not be executable by default
create function public.zz_probe() returns int language sql as $$ select 1 $$;
select ok(not has_function_privilege('anon', 'public.zz_probe()', 'execute'), 'new functions not executable by anon');

-- catch-all: covers tables added by later migrations too
select is_empty($$
  select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f')
     and (has_table_privilege('anon', c.oid, 'select, insert, update, delete, truncate, references, trigger')
       or has_table_privilege('authenticated', c.oid, 'select, insert, update, delete, truncate, references, trigger'))
$$, 'anon/authenticated hold no privilege on any public table or view');
select is_empty($$
  select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'S'
     and (has_sequence_privilege('anon', c.oid, 'usage, select, update')
       or has_sequence_privilege('authenticated', c.oid, 'usage, select, update'))
$$, 'anon/authenticated hold no privilege on any public sequence');

select * from finish();
rollback;
