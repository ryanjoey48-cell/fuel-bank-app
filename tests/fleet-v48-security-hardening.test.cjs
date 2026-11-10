const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/\r\n/g, '\n');
const code = sql => sql.split('\n').filter(l => !l.trim().startsWith('--')).map(l => l.replace(/--.*$/, '')).join('\n');
const TABLES = ['bank_transfers', 'drivers', 'fuel_logs', 'oil_change_baselines', 'oil_change_history', 'shipments', 'trip_fuel_logs', 'trip_journeys', 'vehicle_safety_assets',
  'vehicle_safety_inspection_items', 'vehicle_safety_inspections', 'vehicle_safety_issues', 'vehicle_safety_requirements', 'vehicles', 'weekly_mileage'];

test('security state marker is honest: only Stage 0 is applied, later stages are pending and production is not claimed secured', () => {
  const s = JSON.parse(read('docs/security-state.json'));
  assert.equal(s.production_project_ref, 'hafoaurzfgkkwpvzedvd');
  assert.equal(s.stage0_anon_revoke, 'applied'); assert.equal(s.stage0_applied_on, '2026-11-06'); assert.ok(fs.existsSync(path.join(__dirname, '..', s.stage0_evidence)), 'Stage 0 evidence report exists');
  assert.equal(s.stage1_office_rls, 'partial'); assert.deepEqual(s.stage1_groups_applied, ['A']); assert.deepEqual(s.stage1_groups_pending, ['B', 'C1', 'C2', 'D']);
  assert.ok(fs.existsSync(path.join(__dirname, '..', s.stage1_evidence)), 'Stage 1 group A evidence report exists');
  for (const k of ['stage1b_tightening', 'stage1c_identity_table_hardening', 'stage2_defaults_and_rpc']) assert.equal(s[k], 'pending', k);
  assert.equal(s.production_secured, false, 'signed-in accounts still have full access until Stage 1');
  assert.match(s.development_rehearsal, /skipped/);
});

test('Stage 1 SQL is review-only, targets production by ref, and ends in exactly one ROLLBACK', () => {
  const sql = read('docs/stage1-rls-review-only.sql');
  assert.match(sql, /REVIEW ONLY\. NOT EXECUTED/); assert.match(sql, /hafoaurzfgkkwpvzedvd/); assert.match(sql, /CONFIRMED PRODUCTION/);
  assert.equal((sql.match(/^rollback;/gm) ?? []).length, 1); assert.equal((sql.match(/^begin;/gm) ?? []).length, 1);
  assert.doesNotMatch(code(sql), /\bcommit\b/i);
});

test('Stage 1 has four policies for each of the 15 tables, all TO authenticated, with RLS enabled once per table', () => {
  const c = code(read('docs/stage1-rls-review-only.sql'));
  for (const t of TABLES) {
    for (const op of ['select', 'insert', 'update', 'delete']) assert.match(c, new RegExp(`create policy ${t}_office_${op} on public\\.${t} for ${op} to authenticated`), `${t} ${op}`);
    assert.equal((c.match(new RegExp(`alter table public\\.${t} enable row level security`, 'g')) ?? []).length, 1, t);
  }
  assert.equal((c.match(/^create policy/gm) ?? []).length, 60);
});

test('Stage 1 policies use only role-helper checks: wrapped in (select ...), never true, never anon/public, never direct account_access subqueries or user_id ownership', () => {
  const c = code(read('docs/stage1-rls-review-only.sql'));
  const policies = c.split(';').filter(s => /create policy/.test(s));
  assert.equal(policies.length, 60);
  for (const p of policies) {
    assert.match(p, /\(select public\.is_office_account\(\)\)/);
    assert.doesNotMatch(p, /\busing \(true\)|with check \(true\)|\bto (anon|public)\b/i);
    assert.doesNotMatch(p, /account_access|auth\.uid\(\)|user_id/i);
    assert.doesNotMatch(p, /(?<!select )public\.(is_office_account|current_account_role)\(\)/, 'unwrapped helper call would run per row');
  }
  const writes = policies.filter(p => /for (insert|update|delete)/.test(p));
  assert.equal(writes.length, 45);
  for (const p of writes) assert.match(p, /\(select public\.current_account_role\(\)\) in \('admin', 'office_staff'\)/, 'read_only must not write');
  const reads = policies.filter(p => /for select/.test(p));
  for (const p of reads) assert.doesNotMatch(p, /current_account_role/, 'read is any active office account');
});

test('Stage 1 prechecks guard against lock-out and replace the inert policies first', () => {
  const c = code(read('docs/stage1-rls-review-only.sql'));
  assert.match(c, /no administrator or office_staff would keep write access/); assert.match(c, /would lose access: resolve first/);
  assert.match(c, /authenticated cannot execute the role helpers/);
  assert.ok(c.indexOf('$precheck$') < c.indexOf('drop policy'), 'precheck before any change');
  assert.ok(c.indexOf('drop policy if exists vehicles_select_own') < c.indexOf('create policy vehicles_office_select'));
  for (const op of ['delete', 'insert', 'select', 'update']) assert.match(c, new RegExp(`drop policy if exists oil_change_history_${op}_authenticated`));
  assert.match(c, /revoke truncate, references, trigger, maintain on table public\.vehicles from authenticated/);
});

test('Stage 1 is staged: four validation pauses, driver tables last, identity hardening and Stage 2 kept separate and optional', () => {
  const sql = read('docs/stage1-rls-review-only.sql');
  assert.equal((sql.match(/>>> PAUSE: validate group/g) ?? []).length, 5);
  const at = t => sql.indexOf(`create policy ${t}_office_select`);
  assert.ok(at('drivers') < at('weekly_mileage') && at('vehicles') < at('weekly_mileage'), 'mileage triggers read drivers and vehicles, so those are enabled first or together');
  assert.ok(at('bank_transfers') > at('fuel_logs') && at('bank_transfers') > at('weekly_mileage'), 'banking data enabled last');
  const runbook = read('docs/stage1-supervised-runbook.md');
  for (const needle of ['PENDING APPROVAL', 'STOP conditions', 'disable row level security', 'sync_weekly_mileage', 'PRODUCTION-APPROVED', 'one group at a time']) assert.ok(runbook.includes(needle), needle);
  assert.match(sql, /1c\. OPTIONAL/); assert.match(sql, /revoke insert, update, delete, truncate, references, trigger, maintain on table public\.account_access, public\.account_access_audit from authenticated/);
  assert.match(sql, /revoke all on table public\.account_access, public\.account_access_audit from anon/);
  assert.doesNotMatch(code(sql), /\bgrant\b[^;]*account_access/i, 'identity tables are never granted to');
  assert.equal((code(sql).match(/revoke execute on function public\.\w+ from anon/g) ?? []).length, 11);
});

test('Stage 1b (optional tightening) is a separate review-only file that changes only banking read and money deletes', () => {
  const sql = read('docs/stage1b-optional-tightening-review-only.sql'); const c = code(sql);
  assert.match(sql, /REVIEW ONLY\. NOT EXECUTED/); assert.match(sql, /OPTIONAL/); assert.equal((sql.match(/^rollback;/gm) ?? []).length, 1);
  assert.equal((c.match(/^create policy/gm) ?? []).length, 4);
  assert.match(c, /is_account_admin/); assert.doesNotMatch(c, /enable row level security|grant |revoke /i);
});

test('validation harness never persists, refuses to run without a declared target, and covers admin, office_staff, unregistered and anon', () => {
  const sql = read('docs/stage1-validation-harness-review-only.sql'); const c = code(sql);
  assert.match(sql, /REVIEW ONLY\. NOT EXECUTED/); assert.equal((sql.match(/^rollback;/gm) ?? []).length, 1);
  assert.doesNotMatch(c, /\bcommit\s*;/i); assert.match(c, /ees\.harness_target/); assert.match(c, /PRODUCTION-APPROVED/);
  for (const needle of ["'admin'", "'office_staff'", "'unregistered'", "'anon'", 'self_promotion_blocked', 'no_open_policy']) assert.ok(c.includes(needle), needle);
  assert.doesNotMatch(c, /\b(drop table|truncate table|alter table|create policy|\bgrant\b(?! all on harness_result))/i);
});

test('per-group dry-run scripts cover each of the 15 tables exactly once, apply the group slice, simulate five callers and can never commit', () => {
  const ids = ['a', 'b', 'c1', 'c2', 'd']; const seen = [];
  for (const id of ids) {
    const sql = read(`docs/stage1-dryrun-group-${id}-review-only.sql`); const c = code(sql);
    assert.match(sql, /REVIEW ONLY\. NOT EXECUTED/); assert.match(sql, /hafoaurzfgkkwpvzedvd/);
    assert.equal((sql.match(/^begin;/gm) ?? []).length, 1); assert.equal((sql.match(/^rollback;/gm) ?? []).length, 1);
    assert.doesNotMatch(c, /\bcommit\s*;/i);
    assert.ok(c.indexOf('$precheck$') < c.indexOf('create policy') && c.indexOf('create policy') < c.indexOf('$dryrun$'), 'precheck, then slice, then harness');
    assert.match(c, /raise exception 'DRYRUN GROUP [A-D12]+ REPORT: FAILS=%/);
    for (const needle of ["'admin'", "'office_staff'", "'unregistered'", "'anon'", "role = 'read_only'", 'PRODUCTION-APPROVED']) assert.ok(c.includes(needle), `${id} ${needle}`);
    assert.doesNotMatch(c, /\b(drop table|truncate table|insert into|delete from)\b/i);
    const tables = [...c.matchAll(/^create policy (\w+)_office_select on public\.(\w+)/gm)].map(m => m[2]);
    assert.equal((c.match(/^create policy/gm) ?? []).length, tables.length * 4);
    seen.push(...tables);
    c.split('\n').forEach((line, i) => assert.equal((line.match(/'/g) ?? []).length % 2, 0, `${id}: unbalanced quote on code line ${i + 1}`));
  }
  assert.deepEqual(seen.sort(), [...TABLES].sort());
  assert.ok(read('docs/stage1-dryrun-group-c1-review-only.sql').indexOf('create policy drivers_office_select') < read('docs/stage1-dryrun-group-c1-review-only.sql').indexOf('create policy weekly_mileage_office_select'));
});

test('group B readiness doc is preparation only, names the scope, the export gap, rollback and the separate approval', () => {
  const d = read('docs/stage1-group-b-readiness.md');
  for (const t of ['oil_change_baselines', 'oil_change_history', 'vehicle_safety_inspections', 'vehicle_safety_inspection_items', 'vehicle_safety_issues', 'trip_journeys']) assert.ok(d.includes(t), t);
  for (const needle of ['PENDING SEPARATE EXPLICIT APPROVAL', 'not verifiable', 'lock_timeout', 'disable row level security', 'no driver-side or server-side workflow', 'Do not commit if', 'groups C1, C2, D']) assert.ok(d.includes(needle), needle);
  assert.doesNotMatch(d, /eyJ[A-Za-z0-9_-]{20,}|sb_secret_[A-Za-z0-9]{8,}|password\s*[:=]/i);
  assert.deepEqual(JSON.parse(read('docs/security-state.json')).stage1_groups_applied, ['A'], 'group B is not applied');
});

test('Stage 0 remains anon-only and the runbook states approval wording, STOP condition, rollback triggers and evidence', () => {
  const rb = read('docs/stage0-supervised-runbook.md');
  for (const needle of ['PENDING APPROVAL', 'hafoaurzfgkkwpvzedvd', 'STOP condition', 'Rollback triggers', 'Evidence to keep', 'with the owner present', 'lock_timeout', 'Driver', 'Server routes', 'security-state.json']) assert.ok(rb.includes(needle), needle);
  assert.doesNotMatch(rb, /eyJ[A-Za-z0-9_-]{20,}|sb_secret_[A-Za-z0-9]{8,}|sb_publishable_[A-Za-z0-9]{8,}|password\s*[:=]/i);
});

test('production connection safety: guards exist, refuse production and unapproved staging, and the dev plan names them', () => {
  const lib = read('lib/ees-database-environment.ts');
  assert.match(lib, /Refusing experimental SQL against confirmed EES production/); assert.match(lib, /Staging operations cannot target confirmed production/);
  assert.match(lib, /Owner-approved staging project reference is required/);
  const plan = read('docs/development-database-isolation-plan.md');
  for (const needle of ['assertNotConfirmedProductionForExperimentalSql', 'assertApprovedStagingTarget', '.env.staging.local', 'Synthetic data only', 'hibernated', 'wpmnjfncaoogssgpqxek']) assert.ok(plan.includes(needle), needle);
  assert.doesNotMatch(plan, /eyJ[A-Za-z0-9_-]{20,}|sb_secret_[A-Za-z0-9]{8,}/);
});

test('driver portal isolation: no browser or driver-facing code reads the sensitive driver and banking tables with an anon-key client', () => {
  const walk = d => fs.readdirSync(path.join(__dirname, '..', d), { withFileTypes: true }).flatMap(e => e.isDirectory() ? (e.name === 'node_modules' ? [] : walk(`${d}/${e.name}`)) : [`${d}/${e.name}`]);
  const files = ['app/driver', 'app/(driver)', 'app/driver-portal'].filter(d => fs.existsSync(path.join(__dirname, '..', d))).flatMap(walk).filter(f => /\.(ts|tsx)$/.test(f));
  for (const f of files) assert.doesNotMatch(read(f), /\.from\(['"](drivers|bank_transfers|fuel_logs|weekly_mileage)['"]\)/, `${f} must not query office tables directly`);
});

test('Fleet persistence readiness and Development plan keep their no-action promises', () => {
  const p = read('docs/fleet-persistence-security-readiness.md');
  assert.match(p, /REVIEW ONLY/); assert.match(p, /account_access/); assert.match(p, /Stage 0/); assert.match(p, /append-only/i); assert.match(p, /no raw GPS track/i);
  const d = read('docs/development-database-isolation-plan.md');
  assert.match(d, /Nothing here switches a connection/); assert.match(d, /Approval checklist/);
});
