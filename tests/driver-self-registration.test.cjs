const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("public Create Account captures required fields and offers only driver or office staff requests", () => {
  const form = read("components/auth-form.tsx");
  for (const field of ["fullName", "email", "phone", "password", "confirmPassword"]) {
    assert.match(form, new RegExp(`\\b${field}\\b`));
  }
  assert.match(form, /password !== confirmPassword/);
  assert.match(form, /registration_type:\s*accountType/);
  assert.match(form, /"driver"\s*\|\s*"office_staff"/);
  assert.doesNotMatch(form, /registration_type:\s*["']admin["']/);
});

test("new public auth users receive a pending typed request but never immediate office access", () => {
  const sql = read("supabase/migrations/20261003100000_universal_account_approval.sql");
  const triggerFunction = sql.slice(
    sql.indexOf("create or replace function public.create_default_account_access_for_new_user"),
    sql.indexOf("create or replace function public.custom_access_token_hook")
  );
  assert.match(triggerFunction, /requested_type in \('driver', 'office_staff'\)/);
  assert.match(triggerFunction, /insert into public\.driver_access_requests/);
  assert.doesNotMatch(triggerFunction, /insert into public\.account_access/);
  assert.match(sql, /create trigger create_default_account_access_for_new_user[\s\S]*?execute function public\.create_default_account_access_for_new_user/);
});

test("pending and unauthorised auth users receive a no-data database role", () => {
  const sql = read("supabase/migrations/20261003100000_universal_account_approval.sql");
  assert.match(sql, /request_status in \('pending', 'rejected'\) or not office_active/);
  assert.match(sql, /jsonb_set\(claims, '\{role\}', to_jsonb\('driver_portal'/);
  assert.match(sql, /revoke all on public\.driver_access_requests from public, anon, authenticated, driver_portal/);
  assert.match(sql, /revoke execute on function public\.custom_access_token_hook.*?authenticated, driver_portal/s);
});

test("approval is atomic, Joey-only, and assigns only the reviewed request type", () => {
  const sql = read("supabase/migrations/20261003100000_universal_account_approval.sql");
  assert.match(sql, /where id = p_request_id and status = 'pending'\s+for update/);
  assert.match(sql, /role = 'admin' and status = 'active'/);
  assert.match(sql, /sole_approver_id constant uuid := '6b36f383-28e0-48aa-99a0-c1e655d6c3f7'/);
  assert.match(sql, /public\.drivers where id::text = p_linked_driver_id and active = true/);
  assert.match(sql, /insert into public\.driver_accounts/);
  assert.match(sql, /delete from public\.account_access where user_id = target\.auth_user_id/);
  assert.match(sql, /target\.requested_account_type = 'office_staff'[\s\S]*?role,[\s\S]*?'office_staff'/);
  assert.match(sql, /grant execute on function public\.review_driver_access_request.*?to service_role/s);
  assert.match(sql, /revoke all on function public\.review_driver_access_request.*?authenticated, driver_portal/s);
});

test("pending driver administration reuses the protected User Management area", () => {
  const page = read("app/(dashboard)/admin/users/page.tsx");
  const listRoute = read("app/api/admin/driver-access-requests/route.ts");
  const reviewRoute = read("app/api/admin/driver-access-requests/[id]/route.ts");
  const panel = read("components/admin/pending-driver-requests.tsx");
  assert.match(page, /<PendingDriverRequests\s*\/>/);
  assert.match(listRoute, /requireAdminAccess\(request\)/);
  assert.match(reviewRoute, /requireAdminAccess\(request\)/);
  assert.match(reviewRoute, /requireAccessRequestApprover\(user\.id\)/);
  assert.match(reviewRoute, /p_reviewed_by:\s*user\.id/);
  assert.doesNotMatch(reviewRoute, /body\.(?:reviewed_by|reviewedBy|user_id|admin_id)/);
  assert.match(reviewRoute, /review_driver_access_request/);
  assert.match(panel, /Pending access requests/);
  assert.match(panel, /request\.requestedAccountType === "driver"/);
  assert.match(panel, /disabled=\{!canReview/);
  assert.match(panel, /"approved"/);
  assert.match(panel, /"rejected"/);
});

test("login routing distinguishes approved, pending, rejected, office, and unknown users", () => {
  const route = read("app/api/auth/login-routing/route.ts");
  const resolver = read("lib/admin-user-management-server.ts");
  const driverIndex = route.indexOf("findActiveDriverAccount");
  const requestIndex = route.indexOf("findDriverAccessRequest");
  const officeIndex = route.indexOf("resolveAccountAccess(admin, user)");
  assert.ok(driverIndex > -1 && requestIndex > driverIndex && officeIndex > requestIndex);
  assert.match(route, /destination:\s*"\/access\/pending"/);
  assert.match(route, /destination:\s*"\/access\/rejected"/);
  assert.match(route, /destination:\s*"\/dashboard"/);
  assert.match(resolver, /if \(!row\) throw new AdminApiError\(403, "Account access is not authorised\."\)/);
});

test("both login pages send pending and rejected drivers to their status page", () => {
  const normalForm = read("components/auth-form.tsx");
  const driverForm = read("components/driver/driver-login-form.tsx");
  const driverServer = read("lib/driver-portal-server.ts");
  assert.match(normalForm, /routing\.accountType !== "office"[\s\S]*?router\.replace\(routing\.destination\)/);
  assert.match(driverServer, /"\/access\/pending"/);
  assert.match(driverServer, /"\/access\/rejected"/);
  assert.match(driverForm, /resolveLoginRouting\(data\.session\.access_token\)/);
  assert.match(driverForm, /router\.replace\(routing\.destination\)/);
});

test("public auth branding uses EES Operations and removes outdated product names", () => {
  const authExperience = [
    read("app/(auth)/login/page.tsx"),
    read("components/auth-form.tsx"),
    read("lib/translations.ts")
  ].join("\n");
  assert.match(authExperience, /EES Operations/);
  assert.match(authExperience, /Logistics Control/);
  assert.match(authExperience, /\/ees-logo\.png|EESLogo/);
  assert.match(authExperience, /\/ees-truck\.png/);
  assert.doesNotMatch(authExperience, /Fleet Finance|Fuel &(?:amp;)? Bank App/);
});

test("pending auth users are excluded from normal office account management", () => {
  const route = read("app/api/admin/users/route.ts");
  assert.match(route, /const row = accessByUserId\.get\(account\.id\);\s+if \(!row\) return \[\];/);
});
