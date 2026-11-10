const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/\r\n/g, '\n');
const code = sql => sql.split('\n').filter(l => !l.trim().startsWith('--')).map(l => l.replace(/--.*$/, '')).join('\n');
const TABLES = ['bank_transfers', 'drivers', 'fuel_logs', 'oil_change_baselines', 'oil_change_history', 'shipments', 'trip_fuel_logs', 'trip_journeys', 'vehicle_safety_assets',
  'vehicle_safety_inspection_items', 'vehicle_safety_inspections', 'vehicle_safety_issues', 'vehicle_safety_requirements', 'vehicles', 'weekly_mileage'];
const SEQUENCES = ['bank_transfers_id_seq', 'drivers_id_seq', 'fuel_logs_id_seq', 'weekly_mileage_id_seq'];

test('Stage 0 SQL names the production target explicitly and says which project is NOT the target', () => {
  const sql = read('docs/stage0-anon-revoke-review-only.sql');
  assert.match(sql, /REVIEW ONLY\. NOT EXECUTED/);
  assert.match(sql, /hafoaurzfgkkwpvzedvd/); assert.match(sql, /CONFIRMED PRODUCTION/); assert.match(sql, /Fuel Tracker App/);
  assert.match(sql, /NOT the target\s*:\s*"EES Development"/);
});

test('Stage 0 revokes anon only: 15 tables and 4 sequences, nothing else, no RLS or policy or data statement', () => {
  const c = code(read('docs/stage0-anon-revoke-review-only.sql'));
  const sectionA = c.slice(0, c.indexOf('grant all on table'));
  const revokes = [...sectionA.matchAll(/^revoke all on (table|sequence) public\.(\w+) from (\w+);/gm)];
  assert.equal(revokes.length, 19);
  assert.deepEqual(revokes.filter(m => m[1] === 'table').map(m => m[2]).sort(), [...TABLES].sort());
  assert.deepEqual(revokes.filter(m => m[1] === 'sequence').map(m => m[2]).sort(), [...SEQUENCES].sort());
  assert.ok(revokes.every(m => m[3] === 'anon'), 'only the anon role is touched');
  assert.doesNotMatch(c, /\brevoke\b[^;]*\bfrom\s+(authenticated|service_role|postgres|public)\b/i, 'signed-in and server access are untouched');
  assert.doesNotMatch(c, /\bgrant\b[^;]*\bto\s+(authenticated|service_role|public)\b/i, 'nothing is granted to any other role');
  assert.doesNotMatch(c, /row level security|create policy|drop policy|alter (table|default|function)|create (table|function|extension)|drop (table|function)|truncate table|insert into|update public|delete from|set role|\bcommit\b/i);
});

test('rollback mirrors the revokes one for one and restores exactly the audited privileges', () => {
  const sql = read('docs/stage0-anon-revoke-review-only.sql'); const c = code(sql);
  const grants = [...c.matchAll(/^grant (all on table|usage, select, update on sequence) public\.(\w+) to anon;/gm)];
  assert.equal(grants.length, 19);
  assert.deepEqual(grants.filter(m => m[1].includes('table')).map(m => m[2]).sort(), [...TABLES].sort());
  assert.deepEqual(grants.filter(m => m[1].includes('sequence')).map(m => m[2]).sort(), [...SEQUENCES].sort());
  assert.match(sql, /relacl = \{postgres=arwdDxtm\/postgres,anon=arwdDxtm\/postgres,authenticated=arwdDxtm\/postgres,service_role=arwdDxtm\/postgres\}/);
  assert.match(sql, /anon=rwU/); assert.match(sql, /SECTION B: ROLLBACK/);
  assert.doesNotMatch(c, /to (authenticated|service_role)\b/);
});

test('the change is guarded: it asserts the audited state before, the result after, and the restored state after rollback; both sections end in ROLLBACK', () => {
  const sql = read('docs/stage0-anon-revoke-review-only.sql'); const c = code(sql);
  assert.equal((sql.match(/^rollback;/gm) ?? []).length, 2); assert.equal((sql.match(/^begin;/gm) ?? []).length, 2);
  for (const label of ['BEFORE (audited state)', 'AFTER REVOKE', 'AFTER ROLLBACK (audited state restored)']) assert.ok(c.includes(label), label);
  assert.match(c, /lock_timeout = '5s'/); assert.match(c, /no active admin in account_access/); assert.match(c, /not the audited database/);
  assert.match(c, /has_table_privilege\(r, format\('public\.%I', t\), p\)/); assert.match(c, /has_sequence_privilege\('anon'/);
  for (const priv of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']) assert.ok(c.includes(`'${priv}'`), priv);
  let depth = 0; for (const ch of c) { if (ch === '(') depth++; else if (ch === ')') depth--; assert.ok(depth >= 0); } assert.equal(depth, 0);
  c.split('\n').forEach((line, i) => assert.equal((line.match(/'/g) ?? []).length % 2, 0, `unbalanced quote on code line ${i + 1}`));
});

test('the 15 tables are the same set across the audit, the RLS remediation and Stage 0', () => {
  const rls = code(read('docs/rls-remediation-review-only.sql'));
  const fromRls = [...rls.matchAll(/^revoke all on table public\.(\w+) from anon;/gm)].map(m => m[1]).sort();
  assert.deepEqual(fromRls, [...TABLES].sort());
});

test('the environment fingerprint is read-only and covers what decides whether Development mirrors production', () => {
  const sql = read('docs/stage0-environment-fingerprint-readonly.sql'); const c = code(sql);
  assert.match(sql, /READ ONLY/); assert.doesNotMatch(c, /\b(insert|update|delete|truncate|grant|revoke|alter|create|drop)\b\s/i);
  assert.ok(/^\s*select /i.test(c.trim()));
  for (const needle of ['public_table_names_md5', 'rls_disabled_tables', 'anon_privileges_on_the_15', 'policy_count_total', 'helper_functions', 'account_access_role_check', 'default_privileges_public', 'anon_executable_security_definer_functions', 'booking_diary_key_columns', 'signup_trigger_present']) assert.ok(c.includes(needle), needle);
});

test('the preflight report states the target, the unverified Development project, the dependency findings and requires explicit approval', () => {
  const report = read('reports/2026-11-06-stage0-preflight.md');
  for (const needle of ['hafoaurzfgkkwpvzedvd', 'CONFIRMED PRODUCTION', 'wpmnjfncaoogssgpqxek', 'unreachable', 'sb_secret', 'GO / NO-GO', 'does not close', 'diagnose-supabase-api-key', 'rollback', 'explicit approval']) assert.ok(report.toLowerCase().includes(needle.toLowerCase()), needle);
  assert.doesNotMatch(report, /eyJ[A-Za-z0-9_-]{20,}|sb_secret_[A-Za-z0-9]{8,}|sb_publishable_[A-Za-z0-9]{8,}|password\s*[:=]/i, 'no key or credential in the report');
});
