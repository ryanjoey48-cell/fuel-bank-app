const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

function read(relativePath) {
  return fs.readFileSync(path.resolve(relativePath), "utf8");
}

function loadTypeScriptModule(relativePath) {
  const filename = path.resolve(relativePath);
  const source = read(relativePath);
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  loaded._compile(compiled, filename);
  return loaded.exports;
}

const authorization = loadTypeScriptModule("lib/authorization.ts");

test("account roles and statuses normalize to explicit allow-listed values", () => {
  assert.equal(authorization.normalizeAccountRole("admin"), "admin");
  assert.equal(authorization.normalizeAccountRole("office-staff"), "office_staff");
  assert.equal(authorization.normalizeAccountRole("read only"), "read_only");
  assert.equal(authorization.normalizeAccountRole("owner"), "office_staff");
  assert.equal(authorization.normalizeAccountStatus("suspended"), "suspended");
  assert.equal(authorization.normalizeAccountStatus("disabled"), "active");
});

test("only active administrators receive admin permissions", () => {
  const admin = { role: "admin", status: "active" };
  const office = { role: "office_staff", status: "active" };
  const readOnly = { role: "read_only", status: "active" };
  const suspendedAdmin = { role: "admin", status: "suspended" };

  assert.equal(authorization.hasPermission(admin, "admin:user_management"), true);
  assert.equal(authorization.hasPermission(admin, "admin:support_tickets"), true);
  assert.equal(authorization.hasPermission(office, "admin:user_management"), false);
  assert.equal(authorization.hasPermission(readOnly, "admin:user_management"), false);
  assert.equal(authorization.hasPermission(suspendedAdmin, "admin:user_management"), false);
  assert.equal(authorization.isActiveAdmin(suspendedAdmin), false);
});

test("admin and staff access to User Management is decided by authoritative access state", () => {
  assert.equal(authorization.hasPermission({ role: "admin", status: "active" }, "admin:user_management"), true);
  assert.equal(authorization.hasPermission({ role: "office_staff", status: "active" }, "admin:user_management"), false);
  assert.equal(authorization.hasPermission({ role: "read_only", status: "active" }, "admin:user_management"), false);
  assert.equal(authorization.hasPermission(null, "admin:user_management"), false);
});

test("admin user APIs verify the signed-in caller server-side before reads or mutations", () => {
  const listRoute = read("app/api/admin/users/route.ts");
  const patchRoute = read("app/api/admin/users/[id]/route.ts");
  const resetRoute = read("app/api/admin/users/[id]/password-reset/route.ts");
  const meRoute = read("app/api/admin/me/route.ts");
  const server = read("lib/admin-user-management-server.ts");

  assert.match(listRoute, /requireAdminAccess\(request\)/);
  assert.match(listRoute, /admin\.auth\.admin\.listUsers/);
  assert.match(listRoute, /pageSize/);
  assert.match(server, /Administrator permission required/);
  assert.match(patchRoute, /requireAdminAccess\(request\)/);
  assert.match(patchRoute, /getTargetUser\(actor\.admin,\s*targetUserId\)/);
  assert.match(patchRoute, /\.upsert\(updatePayload/);
  assert.match(resetRoute, /requireAdminAccess\(request\)/);
  assert.match(resetRoute, /send_password_reset/);
  assert.match(meRoute, /access\.status === "suspended"/);
  assert.match(meRoute, /status:\s*403/);
});

test("account mutation routes reject unsafe account-management changes", () => {
  const patchRoute = read("app/api/admin/users/[id]/route.ts");
  const server = read("lib/admin-user-management-server.ts");

  assert.match(patchRoute, /ACCOUNT_ROLES as readonly string\[\]/);
  assert.match(patchRoute, /ACCOUNT_STATUSES as readonly string\[\]/);
  assert.match(patchRoute, /Administrators cannot suspend their own signed-in account/);
  assert.match(patchRoute, /final active administrator cannot be demoted or suspended/i);
  assert.match(server, /\^\[0-9a-f-\]\{36\}\$/i);
  assert.match(server, /Invalid user ID/);
});

test("runtime authorization reads roles from account_access, not metadata or a hardcoded email", () => {
  const server = read("lib/admin-user-management-server.ts");
  const authorizationSource = read("lib/authorization.ts");
  const accountMenu = read("components/account-menu.tsx");
  const profile = read("app/(dashboard)/profile/page.tsx");

  assert.match(server, /\.from\(ACCOUNT_ACCESS_TABLE\)/);
  assert.match(server, /User Management setup required/);
  assert.doesNotMatch(server, /user_metadata[^;\n]*role|app_metadata[^;\n]*role|joeryan09@outlook\.com|LEGACY_ADMIN_EMAIL/i);
  assert.doesNotMatch(authorizationSource, /joeryan09@outlook\.com|LEGACY_ADMIN_EMAIL/i);
  assert.match(accountMenu, /USER MANAGEMENT SETUP REQUIRED/);
  assert.match(profile, /User Management setup required/);
});

test("service-role operations stay out of the browser bundle", () => {
  const browserFiles = [
    ...fs.readdirSync(path.resolve("components")).map((file) => `components/${file}`),
    "lib/account-management.ts",
    "lib/use-account-access.ts",
    "app/(dashboard)/admin/users/page.tsx",
    "app/(dashboard)/layout.tsx"
  ].filter((file) => fs.existsSync(path.resolve(file)) && fs.statSync(path.resolve(file)).isFile());

  for (const file of browserFiles) {
    const source = read(file);
    assert.doesNotMatch(source, /SUPABASE_SERVICE_ROLE_KEY|service_role/i, file);
  }
});

test("admin user management UI and translations include required English and Thai labels", () => {
  const page = read("app/(dashboard)/admin/users/page.tsx");
  const client = read("lib/account-management.ts");
  const translations = read("lib/translations.ts");

  assert.match(client, /\/api\/admin\/users/);
  assert.match(page, /setPageSize|pageSize/);
  assert.match(page, /setRoleFilter/);
  assert.match(page, /setStatusFilter/);
  assert.match(page, /setPendingAction/);
  assert.match(translations, /userManagement:\s*"User Management"/);
  assert.match(translations, /title:\s*"จัดการผู้ใช้งาน"/);
  assert.match(translations, /administrator:\s*"ผู้ดูแลระบบ"/);
  assert.match(translations, /officeStaff:\s*"พนักงานสำนักงาน"/);
  assert.match(translations, /readOnly:\s*"ดูอย่างเดียว"/);
  assert.match(translations, /active:\s*"ใช้งานอยู่"/);
  assert.match(translations, /suspended:\s*"ระงับการใช้งาน"/);
});

test("admin access migration creates reviewable access tables without touching bank transfers", () => {
  const migration = read("supabase/migrations/20260723_admin_user_management.sql");
  const verification = read("supabase/verification/20260723_admin_user_management_verification.sql");
  const rollback = read("supabase/rollback/20260723_admin_user_management_rollback.sql");
  const recovery = read("supabase/recovery/20260723_restore_joey_admin.sql");

  assert.match(migration, /create table if not exists public\.account_access/);
  assert.match(migration, /create table if not exists public\.account_access_audit/);
  assert.match(migration, /begin;\s*create extension/i);
  assert.match(migration, /commit;\s*$/i);
  assert.match(migration, /create_default_account_access_for_new_user/);
  assert.match(migration, /after insert on auth\.users/);
  assert.match(migration, /lower\(users\.email\) = 'joeryan09@outlook\.com'/);
  assert.match(migration, /'Joey Ryan', 'admin', 'active'/);
  assert.match(migration, /when public\.account_access\.role = 'admin' then 'admin'/);
  assert.match(migration, /in \('admin', 'administrator'\)/);
  assert.match(migration, /Cannot bootstrap administrator: auth\.users row for joeryan09@outlook\.com was not found/);
  assert.match(migration, /no active administrator remains/);
  assert.match(migration, /public\.is_account_admin\(\)/);
  assert.match(migration, /select account_access\.role\s+from public\.account_access/i);
  assert.doesNotMatch(migration, /current_account_role\(\)[\s\S]*then 'admin'[\s\S]*is_account_active\(\)/i);
  assert.match(migration, /revoke all on function public\.current_account_role\(\) from public/);
  assert.doesNotMatch(migration, /grant execute on function .* to anon/i);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /is_support_ticket_admin/);
  assert.match(migration, /clients_update_admin/);
  assert.doesNotMatch(migration, /delete\s+from\s+public\.bank_transfers|drop\s+table\s+(if exists\s+)?public\.bank_transfers/i);
  assert.match(verification, /bank_transfer_rows_preserved/);
  assert.match(rollback, /drop table if exists public\.account_access_audit/);
  assert.match(rollback, /joeryan09@outlook\.com/);
  assert.match(recovery, /where lower\(users\.email\) = 'joeryan09@outlook\.com'/);
  assert.match(recovery, /on conflict \(user_id\) do update/);
  assert.match(recovery, /role = 'admin'/);
  assert.match(recovery, /status = 'active'/);
  assert.doesNotMatch(recovery, /raw_user_meta_data|encrypted_password|delete\s+from/i);
});
