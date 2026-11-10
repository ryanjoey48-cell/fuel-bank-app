/** Read-only Expenses readiness probe. Never calls a mutation/RPC or prints secrets or records. */
const fs = require('node:fs');
const { classifyEesSupabaseUrl, extractSupabaseProjectRef } = require('../lib/ees-database-environment.cjs');
function readEnv(file) {
  const env = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return env;
}
async function readiness(file) {
  const env = readEnv(file), url = env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
  const classification = classifyEesSupabaseUrl(url);
  const report = { environmentFile: file, classification, approvedForExpenses: env.EES_EXPENSES_WRITES === 'approved-safe-environment' && env.EES_EXPENSES_APPROVED_SUPABASE_URL === url, tables: {}, functions: {}, storage: null };
  if (classification !== 'CANDIDATE_STAGING') throw new Error('Readiness probe only accepts the known non-production candidate. Production is never probed.');
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('Candidate server credential is missing.');
  if (key.split('.').length === 3) {
    const claim = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString());
    if (claim.ref && claim.ref !== extractSupabaseProjectRef(url)) throw new Error('Candidate credential/URL mismatch.');
  }
  const get = async path => {
    try { const response = await fetch(`${url}${path}`, { method: 'GET', headers: { apikey: key, Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(12000) }); const body = await response.json().catch(() => ({})); return { status: response.status, body }; }
    catch { return { status: 0, body: { code: 'NETWORK_UNAVAILABLE' } }; }
  };
  const names = ['account_access','driver_accounts','vehicles','booking_diary','expenses_config','expenses_categories','expenses_cost_centres','expenses_entries','expenses_attachments','expenses_audit','expenses_templates','expenses_booking_links','expenses_duplicate_resolutions'];
  await Promise.all(names.map(async name => { const r = await get(`/rest/v1/${name}?select=*&limit=0`); report.tables[name] = { status: r.status, present: r.status === 200 ? true : r.body.code === 'PGRST205' ? false : null, errorCode: r.status === 200 ? null : r.body.code || 'UNAVAILABLE' }; }));
  const api = await get('/rest/v1/');
  for (const name of ['expenses_command','expenses_finish_upload','expenses_role','expenses_register','expenses_duplicate_matches']) report.functions[name] = api.status === 200 ? !!api.body.paths?.[`/rpc/${name}`] : null;
  const bucket = await get('/storage/v1/bucket/expenses-receipts');
  report.storage = { status: bucket.status, private: bucket.status === 200 ? bucket.body.public === false : null, fileSizeLimit: bucket.status === 200 ? bucket.body.file_size_limit : null };
  return report;
}
if (require.main === module) readiness(process.argv[2] || '.env.staging.local').then(report => console.log(JSON.stringify(report, null, 2))).catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { readEnv, readiness };
