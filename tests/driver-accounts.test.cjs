const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const test = require('node:test');
const assert = require('node:assert/strict');

function route({ drivers = [], accounts = [], authError = false, queryError = false, denied = 0 } = {}) {
  const calls = [];
  class AdminApiError extends Error { constructor(status, message) { super(message); this.status = status; } }
  const admin = {
    from(table) {
      calls.push(table);
      return { select() { return this; }, order() { return this; }, range(start, end) {
        return { returns: async () => ({ data: (table === 'drivers' ? drivers : accounts).slice(start, end + 1), error: queryError ? {} : null }) };
      } };
    },
    auth: { admin: { async getUserById(id) {
      calls.push(id);
      return { data: { user: authError ? null : { id, email: `${id}@example.com`, email_confirmed_at: 'confirmed', last_sign_in_at: 'signed-in' } }, error: authError ? {} : null };
    } } }
  };
  const dependencies = {
    'next/server': { NextResponse: { json: (body, options) => ({ body, status: options?.status ?? 200, headers: options?.headers }) } },
    '@/lib/admin-user-management-server': { AdminApiError, requireAdminAccess: async () => {
      if (denied) throw new AdminApiError(denied, 'Access denied');
      return { admin };
    } }
  };
  const source = fs.readFileSync(path.join(__dirname, '../app/api/admin/driver-accounts/route.ts'), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', js)((name) => { assert.ok(dependencies[name]); return dependencies[name]; }, module, module.exports);
  return { ...module.exports, calls };
}
const request = () => new Request('http://localhost/api/admin/driver-accounts');

test('driver listing includes unlinked and inactive drivers with safe normalized Auth fields', async () => {
  const handler = route({ drivers: [
    { id: 26, name: 'Joey Test', vehicle_reg: '1998', active: true },
    { id: 11, name: 'Buew', active: true },
    { id: 4, name: 'Inactive driver', active: false },
    { id: 5, name: 'Inactive login', active: true }
  ], accounts: [
    { id: 'link', driver_id: 26, auth_user_id: 'test', active: true, created_at: 'created' },
    { id: 'inactive-driver-link', driver_id: 4, auth_user_id: 'other', active: true },
    { id: 'inactive-account', driver_id: 5, auth_user_id: 'disabled', active: false }
  ] });
  const response = await handler.GET(request());
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.summary, { total: 4, activeDrivers: 3, withAccount: 3, withoutAccount: 1, activeAccounts: 1 });
  const joey = response.body.drivers.find((row) => row.driverId === '26');
  assert.equal(joey.email, 'test@example.com');
  assert.equal(joey.vehicleRegistration, '1998');
  assert.equal(joey.lastSignInAt, 'signed-in');
  assert.equal(joey.emailConfirmedAt, 'confirmed');
  const buew = response.body.drivers.find((row) => row.driverId === '11');
  for (const key of ['accountId', 'authUserId', 'accountActive', 'email', 'emailConfirmedAt', 'lastSignInAt', 'accountCreatedAt']) assert.equal(buew[key], null);
  assert.equal(response.body.drivers.find((row) => row.driverId === '5').accountActive, false);
  assert.equal(response.headers['Cache-Control'], 'private, no-store');
  assert.equal(handler.dynamic, 'force-dynamic');
  assert.equal(response.body.drivers.some((row) => 'user_metadata' in row), false);
});
test('all drivers are returned beyond the Supabase row limit', async () => {
  const handler = route({ drivers: Array.from({ length: 1101 }, (_, id) => ({ id, name: `Driver ${id}`, active: true })) });
  assert.equal((await handler.GET(request())).body.summary.total, 1101);
});
for (const status of [401, 403]) test(`authorization ${status} prevents any privileged lookup`, async () => {
  const handler = route({ denied: status });
  assert.equal((await handler.GET(request())).status, status);
  assert.deepEqual(handler.calls, []);
});
for (const options of [{ queryError: true }, { authError: true, drivers: [{ id: 26 }], accounts: [{ driver_id: 26, auth_user_id: 'test' }] }]) test('lookup failure is an error, never a false no-account result', async () => {
  const response = await route(options).GET(request());
  assert.equal(response.status, 503);
  assert.ok(response.body.error);
  assert.equal(response.body.drivers, undefined);
});
test('panel is separate, read-only, responsive and uses authenticated fetch', () => {
  const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const panel = read('components/admin/driver-accounts.tsx');
  assert.match(panel, /fetchDriverAccounts/);
  assert.match(panel, /min-\[980px\]:hidden/);
  assert.match(panel, /role="alert"/);
  assert.doesNotMatch(panel, /updateManagedAccount|reviewDriverAccessRequest|password-reset|method:.*(?:PATCH|POST|DELETE)/);
  const page = read('app/(dashboard)/admin/users/page.tsx');
  assert.ok(page.indexOf('<DriverAccounts />') > page.indexOf('<PendingDriverRequests />'));
  assert.ok(page.indexOf('<DriverAccounts />') < page.indexOf('{managedUser ? ('));
  assert.match(read('lib/account-management.ts'), /adminFetch<ManagedDriverAccountResult>\("\/api\/admin\/driver-accounts", \{ cache: "no-store" \}\)/);
});
