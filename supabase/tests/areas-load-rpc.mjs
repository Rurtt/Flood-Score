// Run against an empty local Supabase: node --env-file=.env.ingest supabase/tests/areas-load-rpc.mjs
// This intentionally uses PostgREST, whose pg_safeupdate guard differs from psql.
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
assert.ok(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY, 'local URL and service role key required');
const url = new URL(process.env.SUPABASE_URL);
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'RPC regression requires a loopback Supabase URL');
assert.equal(url.port, '54321', 'RPC regression requires local Supabase port 54321');
const db = createClient(url.href, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
async function checked(request) {
  const { data, error } = await request;
  if (error) throw new Error(error.message);
  return data;
}
for (const table of ['areas', 'flood_reports']) {
  assert.equal((await checked(db.from(table).select('*').limit(1))).length, 0, `${table} must be empty for this isolated local test`);
}
const area = name => [{ level: 'district', name_th: name, name_en: null, ways: [[[100.6,13.6],[100.8,13.6],[100.8,13.8],[100.6,13.8],[100.6,13.6]]] }];
try {
  await checked(db.rpc('load_areas', { payload: area('rpc-before') }));
  await checked(db.from('flood_reports').insert({ source_id: 'task-2-rpc', reported_at: new Date().toISOString(), geom: 'SRID=4326;POINT(100.65 13.65)', district: 'wrong' }));
  await checked(db.rpc('load_areas', { payload: area('rpc-after') }));
  const reports = await checked(db.from('flood_reports').select('district,subdistrict').eq('source_id', 'task-2-rpc'));
  assert.deepEqual(reports, [{ district: 'rpc-after', subdistrict: null }]);
  const areas = await checked(db.from('areas').select('name_th'));
  assert.deepEqual(areas, [{ name_th: 'rpc-after' }]);
  console.log('PASS: PostgREST load_areas replaces areas and rederives reports under pg_safeupdate');
} finally {
  await checked(db.from('flood_reports').delete().eq('source_id', 'task-2-rpc'));
  await checked(db.from('areas').delete().in('name_th', ['rpc-before', 'rpc-after']));
}