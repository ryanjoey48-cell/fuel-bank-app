const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
function load(file, deps = {}) {
  const module = { exports: {} };
  const js = ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('require', 'module', 'exports', js)((name) => { assert.ok(name in deps, `Missing dependency ${name}`); return deps[name]; }, module, module.exports);
  return module.exports;
}
class AdminApiError extends Error { constructor(status) { super('Denied'); this.status = status; } }
class DriverPortalError extends Error { constructor(status) { super('Denied'); this.status = status; } }
const ops = load('lib/driver-operations.ts');
const arrived = { id: 'arrival', eventType: 'pickup_arrived', eventTime: '2026-10-02T03:00:00Z' };
for (const [serverTime, minutes] of [['2026-10-02T03:29:59Z', 29], ['2026-10-02T03:30:00Z', 30], ['2026-10-02T03:34:00Z', 34]]) {
  test(`waiting boundary uses authoritative timestamp: ${minutes} minutes`, () => assert.equal(ops.pickupWaitMinutes([arrived], serverTime), minutes));
}
test('departure and completion end waiting regardless of browser refresh', () => {
  for (const eventType of ['pickup_departed', 'job_completed']) assert.equal(ops.pickupWaitMinutes([arrived, { eventType, eventTime: '2026-10-02T03:31:00Z' }], '2026-10-02T04:00:00Z'), null);
  assert.equal(ops.pickupWaitMinutes([], '2026-10-02T04:00:00Z'), null);
  assert.equal(ops.pickupWaitMinutes([arrived], 'invalid'), null);
});
test('database alert contract: server clock, 30-minute threshold, permanent deduplication and same-booking lock', () => {
  const sql = read('supabase/migrations/20261005100000_driver_pickup_wait_notifications.sql');
  assert.match(sql, /event_time <= clock_timestamp\(\) - interval '30 minutes'/);
  assert.match(sql, /unique \(recipient_user_id, notification_type, arrival_event_id\)/);
  assert.match(sql, /on conflict \(recipient_user_id, notification_type, arrival_event_id\) do nothing/);
  assert.match(sql, /where id = candidate.booking_id for update/);
  assert.match(sql, /after insert on public.driver_job_events/);
  assert.match(sql, /when \(new.event_type = 'pickup_departed'\)/);
  assert.match(sql, /set resolved_at = greatest\(new.event_time, created_at\)/);
  assert.doesNotMatch(sql, /update public\.driver_job_events|delete from public\.driver_job_events|drop .*append_driver_job_event/i);
});
test('notifications are service-only and retain unread state when resolved', () => {
  const sql = read('supabase/migrations/20261005100000_driver_pickup_wait_notifications.sql');
  assert.match(sql, /enable row level security/);
  assert.match(sql, /grant select .* to service_role/);
  assert.doesNotMatch(sql, /grant .* to authenticated|create policy|grant insert|grant delete/i);
  const resolver = sql.split('create function public.resolve_driver_pickup_wait_notification()')[1].split('create trigger')[0];
  assert.doesNotMatch(resolver, /set read_at|delete from/i);
  assert.match(sql, /where recipient_user_id = p_recipient_user_id and read_at is null/);
});
function notificationRoute(auth) {
  return load('app/api/admin/driver-notifications/route.ts', {
    '@/lib/admin-user-management-server': { AdminApiError, requireAdminAccess: auth },
    '@/lib/driver-portal-server': { DriverPortalError },
    '@/lib/driver-notifications-server': { readOperationalNotifications: () => { throw new Error('Must not read'); } },
    '@/lib/driver-profile-api': { limitedBody: async (request) => new TextEncoder().encode(await request.text()) }
  });
}
test('driver/unauthorized callers cannot query notifications or mark read', async () => {
  const route = notificationRoute(async () => { throw new AdminApiError(403); });
  assert.equal((await route.GET(new Request('http://localhost/api'))).status, 403);
  assert.equal((await route.PATCH(new Request('http://localhost/api', { method: 'PATCH', headers: { Origin: 'http://localhost' }, body: '{"all":true}' }))).status, 403);
});
test('mark-read derives recipient only from verified admin, rejects identity injection', async () => {
  const calls = [];
  const route = notificationRoute(async () => ({ user: { id: 'verified-admin' }, admin: { rpc: async (...args) => { calls.push(args); return { error: null }; } } }));
  const request = (body, origin = 'http://localhost') => new Request('http://localhost/api', { method: 'PATCH', headers: { Origin: origin }, body: JSON.stringify(body) });
  assert.equal((await route.PATCH(request({ all: true, recipient_user_id: 'spoof' }))).status, 400);
  assert.equal((await route.PATCH(request({ all: true }, 'https://evil.test'))).status, 403);
  assert.equal(calls.length, 0);
  assert.equal((await route.PATCH(request({ all: true }))).status, 200);
  assert.deepEqual(calls[0], ['read_driver_operational_notification', { p_recipient_user_id: 'verified-admin', p_notification_id: null }]);
});
test('admin History authorizes before historical data access', async () => {
  const route = load('app/api/admin/driver-operations/history/route.ts', { '@/lib/admin-user-management-server': { AdminApiError, requireAdminAccess: async () => { throw new AdminApiError(403); } }, '@/lib/driver-portal-server': { DriverPortalError }, '@/lib/driver-work-server': { operationsHistory: () => { throw new Error('Must not read'); } } });
  assert.equal((await route.GET(new Request('http://localhost/api?page=0'))).status, 403);
});
test('historical query includes today and has counted, bounded pagination', async () => {
  const calls = [];
  const query = { select(v) { calls.push(['select', v]); return this; }, eq(...v) { calls.push(['eq', ...v]); return this; }, lt(...v) { calls.push(['lt', ...v]); return this; }, order() { return this; }, async range(...v) { calls.push(['range', ...v]); return { data: [], count: 0, error: null }; } };
  const work = load('lib/driver-work-server.ts', { 'server-only': {}, '@/lib/admin-user-management-server': {}, '@/lib/driver-portal-server': { DriverPortalError, bangkokDateKey: () => '2026-10-02', DRIVER_JOB_SELECT: 'id' }, '@/lib/driver-profile-server': {}, '@/lib/driver-operations': ops });
  assert.deepEqual(await work.operationsHistory({ from: () => query }, new URLSearchParams('page=2')), { rows: [], total: 0, page: 2, pageSize: 25, hasMore: false });
  assert.ok(calls.some((c) => c[0] === 'eq' && c[1] === 'event_type' && c[2] === 'job_completed'));
  assert.ok(!calls.some((c) => c[0] === 'lt' && c[1] === 'event_time'));
  assert.ok(calls.some((c) => c[0] === 'range' && c[1] === 50 && c[2] === 74));
});
test('avatar response returns newly signed canonical profile, not a blind success flag', async () => {
  let uploaded = false;
  const profile = { avatarUrl: 'new-own-signed-url', displayName: 'Driver' };
  const route = load('app/api/driver/profile/avatar/route.ts', {
    '@/lib/driver-profile-api': { ownDriver: async () => ({ authUserId: 'own' }), limitedBody: async (r) => new Uint8Array(await r.arrayBuffer()), profileResponse: Response.json, profileError: () => Response.json({}, { status: 500 }) },
    '@/lib/driver-profile-server': { uploadDriverAvatar: async (session, file) => { assert.equal(session.authUserId, 'own'); assert.equal(file.type, 'image/png'); uploaded = true; }, readDriverProfile: async (id) => { assert.equal(id, 'own'); assert.equal(uploaded, true); return profile; } },
    '@/lib/driver-portal-server': { DriverPortalError }
  });
  const body = new FormData(); body.set('avatar', new File(['test-bytes'], 'test.png', { type: 'image/png' }));
  const response = await route.POST(new Request('http://localhost/api', { method: 'POST', body }));
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), profile);
});
