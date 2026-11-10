/**
 * V8.1 readiness documentation tests — no production writes.
 * Asserts migration/source contracts used by the approval package.
 */
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const migrations = {
  corrections: 'supabase/migrations/20261013130000_ees_hr_v7_read_corrections.sql',
  guards: 'supabase/migrations/20261013140000_ees_hr_v7_workflow_guards.sql',
  people: 'supabase/migrations/20261013150000_ees_hr_v7_people_centre.sql',
  foundation: 'supabase/migrations/20261013100000_ees_hr_v7_foundation.sql',
};

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

test('release_ready migration defines office gate, five triggers, and authenticated grant only', () => {
  const sql = read(migrations.guards);
  assert.match(sql, /create or replace function public\.ees_hr_v7_release_ready\(\)/);
  assert.match(sql, /ees_hr_v7_departure_guard/);
  assert.match(sql, /ees_hr_v7_rule_source_guard/);
  assert.match(sql, /ees_hr_v7_purge_hold_guard/);
  assert.match(sql, /ees_hr_v7_employee_link_guard/);
  assert.match(sql, /ees_hr_v7_driver_guard/);
  assert.match(sql, /profileCompleteness/);
  assert.match(sql, /status is distinct from e\.employment_status/);
  assert.match(sql, /grant execute on function public\.ees_hr_v7_release_ready\(\) to authenticated/i);
  assert.match(sql, /revoke all on function public\.ees_hr_v7_release_ready\(\) from public,anon/i);
  assert.match(sql, /HR_V7_REVIEW_POLICY_APPROVAL_DEFINITION/);
  assert.match(sql, /HR_V7_REVIEW_EMPLOYMENT_SYNC_DEFINITION/);
  assert.match(sql, /HR_V7_REVIEW_NAME_SYNC_DEFINITION/);
});

test('people_ready depends on release_ready at call time', () => {
  const sql = read(migrations.people);
  assert.match(sql, /return public\.ees_hr_v7_release_ready\(\)/);
  assert.match(sql, /ees_hr_incidents/);
  assert.match(sql, /if not public\.ees_people_ready\(\) then raise exception 'HR_RELEASE_REQUIRED'/);
});

test('130300 introduces markers required by release_ready', () => {
  const sql = read(migrations.corrections);
  assert.match(sql, /profileCompleteness/);
  assert.match(sql, /'certificates'/);
});

test('HR admin is role + ees_hr_admins membership, not email string', () => {
  const sql = read(migrations.foundation);
  assert.match(sql, /create or replace function public\.ees_is_hr_admin\(\)/);
  assert.match(sql, /ees_hr_admins h where h\.user_id = auth\.uid\(\) and h\.active/);
  assert.doesNotMatch(sql, /joeryan09@outlook\.com/);
  assert.match(sql, /ees-employee-documents/);
  assert.match(sql, /public\s*=\s*false|public=false/);
  assert.match(sql, /ees_hr_v7_private_bucket_guard/);
  assert.match(sql, /ees_hr_v7_storage_ready/);
});

test('app diagnoses missing release_ready with exact migration dependency', () => {
  const server = read('lib/ees-hr-v7-server.ts');
  assert.match(server, /ees_hr_v7_release_ready/);
  assert.match(server, /20261013140000_ees_hr_v7_workflow_guards\.sql/);
  assert.match(server, /missing_rpc/);
  assert.match(server, /requireVerifiedUser/);
  assert.doesNotMatch(server, /joeryan09@outlook\.com/);
});

test('V8.1 approval package artifacts exist', () => {
  for (const name of [
    'DB_PREFLIGHT_REPORT.md',
    'MIGRATION_EXECUTION_PLAN.md',
    'ROLLBACK_AND_RECOVERY.md',
    'PROPOSED_MIGRATIONS.sql',
    'V8_2_ACTIVATION_CHECKLIST.md',
    'LIVE_INTEGRITY_READ_ONLY.json',
  ]) {
    assert.ok(fs.existsSync(path.join(root, 'output/ees-hr-v8', name)), name);
  }
});

test('latest OpenAPI snapshot still lacks release_ready when present locally', () => {
  const schemaPath = path.join(root, 'output/ees-hr-v7/schema-read-only.json');
  if (!fs.existsSync(schemaPath)) {
    assert.ok(true, 'schema snapshot absent — skip live comparison');
    return;
  }
  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
  assert.equal(schema.projectHost, 'hafoaurzfgkkwpvzedvd.supabase.co');
  const paths = Object.keys(schema.paths || {});
  assert.equal(paths.includes('/rpc/ees_hr_v7_release_ready'), false);
  assert.equal(paths.includes('/rpc/ees_people_ready'), true);
  assert.equal(paths.includes('/rpc/ees_hr_v7_storage_ready'), true);
  assert.ok(schema.definitions?.ees_hr_incidents);
  assert.ok(schema.definitions?.ees_employee_documents);
});
