const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('../scripts/fleet-real-day-validation.cjs');

const gate = load('lib/forth-history-live-gate.ts');
const access = load('lib/forth-playback-access.ts');
const auth = load('lib/authorization.ts');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/\r\n/g, '\n');
const stripComments = sql => sql.split('\n').filter(l => !l.trim().startsWith('--')).map(l => l.replace(/--.*$/, '')).join('\n');

const FIFTEEN = ['bank_transfers', 'drivers', 'fuel_logs', 'weekly_mileage', 'shipments', 'vehicles', 'oil_change_baselines', 'oil_change_history', 'trip_journeys', 'trip_fuel_logs',
  'vehicle_safety_requirements', 'vehicle_safety_inspections', 'vehicle_safety_inspection_items', 'vehicle_safety_issues', 'vehicle_safety_assets'];

// ---------------------------------------------------------------- historical location security

test('history gate: closed by default; supervised opens only outside production; production stays blocked unless the office flag is set', () => {
  assert.equal(gate.isForthHistoryLiveRequestsEnabled({}), false);
  assert.equal(gate.isForthHistoryLiveRequestsEnabled({ FORTH_HISTORY_SUPERVISED_SESSION: '1' }), true, 'approved local supervised use');
  assert.equal(gate.isForthHistoryLiveRequestsEnabled({ FORTH_HISTORY_SUPERVISED_SESSION: '1', VERCEL_ENV: 'production' }), false, 'supervised never opens production');
  assert.equal(gate.isForthHistoryLiveRequestsEnabled({ FORTH_HISTORY_SUPERVISED_SESSION: 'true', VERCEL_ENV: 'production' }), false);
  assert.equal(gate.isForthHistoryLiveRequestsEnabled({ VERCEL_ENV: 'production' }), false);
  assert.equal(gate.isForthHistoryLiveRequestsEnabled({ VERCEL_ENV: 'preview' }), false);
  assert.equal(gate.FORTH_HISTORY_LIVE_REQUESTS_ENABLED, false, 'the hard-coded default stays off');
});

test('the local flag is unchanged: only the approved supervised flag is set, and no production or office playback flag exists locally', () => {
  const file = path.join(__dirname, '..', '.env.local');
  if (!fs.existsSync(file)) return;
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(l => /^FORTH_HISTORY/.test(l));
  assert.deepEqual(lines.map(l => l.split('=')[0]), ['FORTH_HISTORY_SUPERVISED_SESSION']);
  assert.ok(!lines.some(l => /OFFICE_PLAYBACK/.test(l)));
  assert.ok(!/FORTH_HISTORY_PLAYBACK_ALLOWED_USER_IDS=\S/.test(fs.readFileSync(file, 'utf8')), 'the explicit allowlist stays empty');
  assert.ok(!fs.existsSync(path.join(__dirname, '..', 'vercel.json')) || !/FORTH_HISTORY/.test(read('vercel.json')), 'no history flag in deployment config');
});

test('who may see historical journeys: admins only; business:read alone grants nothing; suspended and unknown roles are refused', () => {
  const can = (role, status = 'active', env = {}) => access.canViewJourneyDetail({ access: { userId: 'u1', role, status, email: '', displayName: '' }, userId: 'u1', checkPermission: auth.hasPermission, env });
  assert.equal(can('admin'), true); assert.equal(can('super_admin'), true);
  for (const role of ['office_staff', 'read_only']) { assert.equal(auth.hasPermission({ role, status: 'active' }, 'business:read'), true, `${role} keeps business:read`); assert.equal(can(role), false, `${role} must not see history`); }
  assert.equal(can('admin', 'suspended'), false); assert.equal(can('driver'), false); assert.equal(can(undefined), false);
  assert.equal(can('office_staff', 'active', { FORTH_HISTORY_PLAYBACK_ALLOWED_USER_IDS: '' }), false, 'an empty allowlist grants nobody');
});

test('history routes and the three evidence routes enforce the permission on the server, and errors carry no coordinates', () => {
  for (const f of ['lib/forth-history-playback-route.ts', 'lib/forth-history-route.ts']) assert.match(read(f), /decideHistoricalPlaybackAccess\(/, f);
  for (const f of ['app/api/admin/forth-tracking/evidence/provider/route.ts', 'app/api/admin/forth-tracking/evidence/route.ts', 'app/api/admin/forth-tracking/evidence/mileage/route.ts']) assert.match(read(f), /canViewJourneyDetail\(/, f);
  const denied = access.PLAYBACK_DENIED_MESSAGE; assert.doesNotMatch(denied, /\d{1,3}\.\d{3,}|latitude|longitude|token|Bearer/i);
  const routeSrc = read('lib/forth-history-playback-route.ts'); assert.doesNotMatch(routeSrc, /AdminApiError\([0-9]+,\s*`[^`]*\$\{[^}]*(latitude|longitude|lat|lng)/i);
});

// ---------------------------------------------------------------- review-only SQL (static validation: nothing is executed)

test('RLS remediation proposal: covers exactly the 15 exposed tables, never grants anon, never uses "true" policies, is staged and rolled back', () => {
  const sql = read('docs/rls-remediation-review-only.sql'); const code = stripComments(sql);
  assert.equal((sql.match(/^rollback;/gm) ?? []).length, 1, 'ends in a single ROLLBACK'); assert.match(sql, /REVIEW ONLY\. NOT EXECUTED/);
  for (const t of FIFTEEN) {
    assert.match(code, new RegExp(`revoke all on table public\\.${t} from anon;`), `${t}: stage 0 revoke`);
    assert.match(code, new RegExp(`alter table public\\.${t} enable row level security;`), `${t}: RLS enabled`);
    for (const op of ['select', 'insert', 'update', 'delete']) assert.match(code, new RegExp(`create policy ${t}_office_${op} on public\\.${t} for ${op} to authenticated`), `${t}: ${op} policy`);
    assert.ok(code.indexOf(`create policy ${t}_office_select`) < code.indexOf(`alter table public.${t} enable row level security`), `${t}: policies exist before RLS is enabled`);
  }
  assert.equal((code.match(/create policy/g) ?? []).length, 60);
  assert.doesNotMatch(code, /to anon\b|to public\b|using \(true\)|with check \(true\)|disable row level security|force row level security/i);
  assert.doesNotMatch(code, /profiles/); assert.match(code, /is_office_account\(\)/); assert.match(code, /current_account_role\(\) in \('admin', 'office_staff'\)/);
  assert.match(code, /no active admin in account_access/, 'guards against locking everyone out');
  for (const old of ['vehicles_select_own', 'vehicles_insert_own', 'vehicles_update_own', 'oil_change_baselines_select_authenticated', 'oil_change_history_delete_authenticated']) assert.match(code, new RegExp(`drop policy if exists ${old}`), `${old} is replaced`);
  assert.ok(sql.indexOf('STAGE 0') < sql.indexOf('STAGE 1:') && sql.indexOf('STAGE 1:') < sql.indexOf('STAGE 2 (precautionary)'));
  assert.match(sql, /Stage 0 rollback/); assert.match(sql, /Stage 1 rollback/); assert.match(sql, /Stage 2 rollback/);
});

test('persistence proposal: real identifiers, no profiles or extension, append-only, anon revoked, one ROLLBACK, syntactically balanced', () => {
  const sql = read('docs/fleet-intelligence-persistence-review-only.sql'); const code = stripComments(sql);
  assert.equal((sql.match(/^rollback;/gm) ?? []).length, 1); assert.match(sql, /REVIEW ONLY\. NOT APPLIED/);
  assert.doesNotMatch(code, /\bprofiles\b|create extension|btree_gist|super_admin/);
  assert.match(code, /references public\.booking_diary\(id\)/); assert.match(code, /references public\.vehicles\(id\)/); assert.match(code, /references auth\.users\(id\)/);
  assert.match(code, /decided_role\s+text not null check \(decided_role in \('admin','office_staff'\)\)/, 'only roles the live constraint allows');
  const tables = [...code.matchAll(/create table if not exists public\.(\w+)/g)].map(m => m[1]);
  assert.deepEqual(tables.sort(), ['fleet_confirmation_events', 'fleet_journey_job_confirmations', 'fleet_reconciliation_snapshots', 'forth_history_access_audit']);
  for (const t of tables) { assert.match(code, new RegExp(`alter table public\\.${t} enable row level security`), `${t}: RLS`); assert.match(code, new RegExp(`revoke all on [^;]*public\\.${t}[^;]* from anon, authenticated`), `${t}: default privileges revoked`); }
  for (const t of ['fleet_confirmation_events', 'forth_history_access_audit', 'fleet_reconciliation_snapshots']) {
    assert.match(code, new RegExp(`create trigger \\w+ before update or delete on public\\.${t}`), `${t}: update/delete blocked`);
    assert.match(code, new RegExp(`create trigger \\w+ before truncate on public\\.${t}`), `${t}: truncate blocked`);
  }
  assert.match(code, /unique \(booking_id, version\)/); assert.match(code, /unique \(decided_by, idempotency_key\)/); assert.match(code, /pg_advisory_xact_lock/);
  assert.match(code, /revoke all on function public\.fleet_record_journey_decision\([^)]*\) from public, anon;/);
  // Every non-comment line has balanced quotes (this caught a truncated CHECK in the V4.5 draft) and the whole script balances parentheses.
  code.split('\n').forEach((line, i) => assert.equal((line.match(/'/g) ?? []).length % 2, 0, `unbalanced quote on code line ${i + 1}: ${line.slice(0, 90)}`));
  let depth = 0; for (const ch of code) { if (ch === '(') depth++; else if (ch === ')') depth--; assert.ok(depth >= 0, 'closing parenthesis without an opener'); } assert.equal(depth, 0);
  assert.doesNotMatch(code, /\blatitude\b|\blongitude\b|\blat\b|\blng\b/, 'no coordinates in any persisted column');
});

test('review-only SQL is never wired in: not a migration, not imported by the app, and the superseded drafts say so', () => {
  const migrations = fs.readdirSync(path.join(__dirname, '..', 'supabase', 'migrations'));
  assert.ok(!migrations.some(f => /rls-remediation|fleet-intelligence-persistence|fleet_confirmation|forth_history_access_audit/i.test(f)));
  for (const f of ['supabase/schema.sql', ...migrations.map(m => `supabase/migrations/${m}`)]) { const s = fs.readFileSync(path.join(__dirname, '..', f), 'utf8'); assert.ok(!/fleet_confirmation_events|fleet_journey_job_confirmations|forth_history_access_audit|fleet_reconciliation_snapshots/.test(s), f); }
  const walk = dir => fs.readdirSync(path.join(__dirname, '..', dir), { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
  for (const f of [...walk('app'), ...walk('lib'), ...walk('components')].filter(x => /\.(ts|tsx)$/.test(x))) { const noComments = read(f).replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(l => l.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n'); assert.ok(!/review-only\.sql|fleet_confirmation_events|fleet_record_journey_decision|forth_history_access_audit/.test(noComments), `${f} must not use the proposals in code`); }
  assert.match(read('docs/forth-playback-audit-schema-review-only.sql'), /SUPERSEDED/);
  assert.match(read('docs/fleet-journey-confirmation-persistence-review.md'), /superseded/i);
});

test('the access-control audit documents every exposed table, the proof method and what was not done', () => {
  const doc = read('docs/fleet-intelligence-v47-access-control-audit.md');
  for (const t of FIFTEEN) assert.ok(doc.includes('`' + t + '`'), `${t} in the matrix`);
  for (const needle of ['Demonstrated, urgent exposure', 'no record was read', 'Granted, not attempted', 'Stage 0', 'Stage 1', 'Stage 2', 'inert', 'self-registration']) assert.ok(doc.toLowerCase().includes(needle.toLowerCase()), needle);
  assert.doesNotMatch(doc, /eyJ[A-Za-z0-9_-]{20,}|sb_secret|service_role key|password\s*[:=]/i, 'no credential in the report');
});
