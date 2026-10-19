const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const migrationPath = path.resolve("supabase/migrations/20261019120000_ees_locations_office_rls.sql");
const sql = fs.readFileSync(migrationPath, "utf8");

test("Locations RLS hardening alters only the existing Locations policies", () => {
  const alterations = [...sql.matchAll(/alter\s+policy\s+(\w+)\s+on\s+([\w.]+)/gi)];
  assert.deepEqual(alterations.map((match) => [match[1], match[2]]), [
    ["ees_locations_office_read", "public.ees_locations"],
    ["ees_locations_office_insert", "public.ees_locations"],
    ["ees_locations_office_update", "public.ees_locations"],
    ["ees_locations_office_delete", "public.ees_locations"],
    ["ees_location_activity_own", "public.ees_location_user_activity"]
  ]);
  assert.doesNotMatch(sql, /\b(create|drop|alter)\s+table\b/i);
  assert.doesNotMatch(sql, /\b(create|drop)\s+policy\b/i);
  assert.match(sql, /begin\s*;/i);
  assert.match(sql, /commit\s*;/i);
});

test("Location policies retain active-account and role boundaries with an office guard", () => {
  const policies = new Map([...sql.matchAll(/alter\s+policy\s+(\w+)[\s\S]*?(?=alter\s+policy|commit\s*;)/gi)]
    .map((match) => [match[1], match[0].toLowerCase()]));
  const officeRead = policies.get("ees_locations_office_read");
  assert.match(officeRead, /using\s*\([\s\S]*?public\.is_office_account\(\)[\s\S]*?public\.is_account_active\(\)[\s\S]*?current_account_role\(\)\s+in\s*\('admin',\s*'office_staff',\s*'read_only'\)/);
  for (const name of ["ees_locations_office_insert", "ees_locations_office_update", "ees_locations_office_delete"]) {
    const policy = policies.get(name);
    assert.match(policy, /public\.is_office_account\(\)/, `${name} requires an office account`);
    assert.match(policy, /public\.is_account_active\(\)/, `${name} requires an active account`);
    assert.match(policy, /current_account_role\(\)\s+in\s*\('admin',\s*'office_staff'\)/, `${name} keeps the write-role check`);
  }
  assert.match(policies.get("ees_locations_office_insert"), /with\s+check\s*\(/);
  assert.match(policies.get("ees_locations_office_update"), /using\s*\([\s\S]*with\s+check\s*\(/);
  assert.match(policies.get("ees_locations_office_delete"), /using\s*\(/);
});

test("Location activity remains own-row only and restricted to active office accounts", () => {
  const activity = [...sql.matchAll(/alter\s+policy\s+ees_location_activity_own[\s\S]*?commit\s*;/gi)][0]?.[0].toLowerCase();
  assert.ok(activity, "activity policy alteration exists");
  assert.equal((activity.match(/auth\.uid\(\)\s*=\s*user_id/g) ?? []).length, 2);
  assert.equal((activity.match(/public\.is_account_active\(\)/g) ?? []).length, 2);
  assert.equal((activity.match(/public\.is_office_account\(\)/g) ?? []).length, 2);
  assert.match(activity, /using\s*\([\s\S]*with\s+check\s*\(/);
});
