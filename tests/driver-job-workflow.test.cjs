const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const test = require('node:test');
const assert = require('node:assert/strict');
const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
function load(file, dependencies = {}) {
  const module = { exports: {} };
  const js = ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  new Function('require', 'module', 'exports', js)((name) => {
    assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, module, module.exports);
  return module.exports;
}
const portal = load('lib/driver-portal.ts');
const depot = { name: 'Verified depot', address: 'Depot address', placeId: 'depot-place', latitude: 13.7, longitude: 100.7 };
const job = {
  pickupName: 'Pickup', pickupAddress: 'Pickup address', pickupPlaceId: 'places/pickup-place', pickupLat: 13.6, pickupLng: 100.6,
  dropoffName: 'Delivery', dropoffAddress: 'Delivery address', dropoffPlaceId: 'delivery-place', dropoffLat: 13.5, dropoffLng: 100.5,
  locationsVerified: true
};
test('depot route uses verified coordinates, pickup waypoint and delivery destination in order', () => {
  const url = new URL(portal.buildDriverDirectionsUrl(job, 'depot', depot));
  assert.equal(url.pathname, '/maps/dir/');
  assert.equal(url.searchParams.get('api'), '1');
  assert.equal(url.searchParams.get('travelmode'), 'driving');
  assert.equal(url.searchParams.get('origin'), '13.7,100.7');
  assert.equal(url.searchParams.get('waypoints'), '13.6,100.6');
  assert.equal(url.searchParams.get('destination'), '13.5,100.5');
  assert.equal(url.searchParams.get('waypoint_place_ids'), 'pickup-place');
  assert.equal(url.searchParams.get('destination_place_id'), 'delivery-place');
});
test('current route lets Maps resolve current origin, delivery route skips pickup', () => {
  const url = new URL(portal.buildDriverDirectionsUrl(job, 'current', depot));
  assert.equal(url.searchParams.has('origin'), false);
  assert.equal(url.searchParams.get('waypoints'), '13.6,100.6');
  const delivery = new URL(portal.buildDriverDirectionsUrl(job, 'delivery', depot));
  assert.equal(delivery.searchParams.has('origin'), false);
  assert.equal(delivery.searchParams.has('waypoints'), false);
  assert.equal(delivery.searchParams.get('destination'), '13.5,100.5');
});
test('unverified locations use stored addresses, missing route cannot invent stops', () => {
  const url = new URL(portal.buildDriverDirectionsUrl({ ...job, locationsVerified: false }, 'current', depot));
  assert.equal(url.searchParams.get('waypoints'), 'Pickup address');
  assert.equal(url.searchParams.get('destination'), 'Delivery address');
  assert.equal(url.searchParams.has('waypoint_place_ids'), false);
  assert.equal(portal.buildDriverDirectionsUrl({ ...job, dropoffAddress: null, dropoffName: '', dropoffLat: null, dropoffLng: null }, 'current', depot), null);
});
test('pickup to drop-off uses explicit pickup origin without an extra waypoint', () => {
  const url = new URL(portal.buildDriverDirectionsUrl(job, 'pickup-to-dropoff', depot));
  assert.equal(url.searchParams.get('origin'), '13.6,100.6');
  assert.equal(url.searchParams.get('origin_place_id'), 'pickup-place');
  assert.equal(url.searchParams.get('destination'), '13.5,100.5');
  assert.equal(url.searchParams.has('waypoints'), false);
});
test('directions to pickup uses current origin and works without a drop-off', () => {
  const url = new URL(portal.buildDriverDirectionsUrl({ ...job, dropoffName: '', dropoffAddress: null, dropoffLat: null, dropoffLng: null }, 'pickup', depot));
  assert.equal(url.searchParams.has('origin'), false);
  assert.equal(url.searchParams.has('waypoints'), false);
  assert.equal(url.searchParams.get('destination'), '13.6,100.6');
  assert.equal(url.searchParams.get('destination_place_id'), 'pickup-place');
});
test('all existing navigation routes remain supplied to the intent controls without stage gating', () => {
  const source = read('components/driver/driver-job-detail.tsx');
  for (const value of ['depot: depotUrl', 'current: currentUrl', 'pickup: pickupUrl', 'delivery: deliveryUrl', 'pickupToDropoff: pickupToDropoffUrl']) assert.ok(source.includes(value));
  const navigation = source.slice(source.indexOf('<DriverRouteOptions'), source.indexOf('{saveError ?'));
  assert.ok(navigation.includes('defaultDestination')); assert.equal(navigation.includes('stage'), false);
});

function gps(navigator, timers = { setTimeout, clearTimeout }) {
  const source = ts.createSourceFile('detail.tsx', read('components/driver/driver-job-detail.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const helper = source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'optionalLocation');
  assert.ok(helper);
  const js = ts.transpileModule(helper.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  return new Function('navigator', 'setTimeout', 'clearTimeout', `${js}; return optionalLocation();`)(navigator, timers.setTimeout, timers.clearTimeout);
}
test('GPS denial records null coordinates rather than blocking progress', async () => {
  assert.deepEqual(await gps({ geolocation: { getCurrentPosition(_success, error) { error({ code: 1 }); } } }), { latitude: null, longitude: null });
});
test('missing GPS records null coordinates', async () => {
  assert.deepEqual(await gps({}), { latitude: null, longitude: null });
});
test('GPS exceptions record null coordinates', async () => {
  assert.deepEqual(await gps({ geolocation: { getCurrentPosition() { throw new Error('Unavailable'); } } }), { latitude: null, longitude: null });
});
test('unanswered GPS prompt has a fallback timeout and cannot leave the button stuck', async () => {
  let duration;
  assert.deepEqual(await gps({ geolocation: { getCurrentPosition() {} } }, {
    setTimeout(callback, milliseconds) { duration = milliseconds; queueMicrotask(callback); return 1; }, clearTimeout() {}
  }), { latitude: null, longitude: null });
  assert.equal(duration, 8000);
});
test('granted GPS preserves the actual coordinates', async () => {
  assert.deepEqual(await gps({ geolocation: { getCurrentPosition(success) { success({ coords: { latitude: 13.7, longitude: 100.7 } }); } } }), { latitude: 13.7, longitude: 100.7 });
});
class DriverPortalError extends Error { constructor(status, message) { super(message); this.status = status; } }
const session = { sessionId: 'verified-session', driverId: '26', authUserId: 'verified-auth' };
function helpers({ owned = true, rpcError = null, rows = [], queryError = null } = {}) {
  const calls = [];
  const admin = {
    async rpc(name, params) { calls.push({ name, params }); return { data: { id: 'event', event_type: params.p_event_type, event_time: 'server-time', latitude: params.p_latitude, longitude: params.p_longitude }, error: rpcError }; },
    from(table) { calls.push(table); return { select() { return this; }, eq(column, value) { calls.push({ column, value }); return this; }, order: async () => ({ data: rows, error: queryError }) }; }
  };
  const result = load('lib/driver-job-events-server.ts', {
    'server-only': {}, '@/lib/driver-portal': portal,
    '@/lib/admin-user-management-server': { createServerSupabaseAdmin: () => admin },
    '@/lib/driver-portal-server': { DriverPortalError, getAssignedDriverJob: async () => owned ? { id: 'booking' } : null }
  });
  return { ...result, calls };
}
test('event writer derives identity from verified session and discards browser identity/time', async () => {
  const helper = helpers();
  const event = await helper.appendDriverJobEvent(session, 'booking', {
    eventType: 'pickup_arrived', driver_id: 99, auth_user_id: 'spoof', eventTime: 'fake', notes: 'untrusted'
  });
  assert.deepEqual(helper.calls, [{ name: 'append_driver_job_event', params: {
    p_session_id: 'verified-session', p_booking_id: 'booking', p_event_type: 'pickup_arrived', p_latitude: null, p_longitude: null
  } }]);
  assert.equal(event.eventTime, 'server-time');
  assert.equal(event.latitude, null);
  assert.equal('authUserId' in event, false);
});
test('another driver booking is rejected before reads or RPC writes', async () => {
  const helper = helpers({ owned: false });
  await assert.rejects(helper.appendDriverJobEvent(session, 'foreign', { eventType: 'pickup_arrived' }), { status: 404 });
  await assert.rejects(helper.getAssignedDriverJobEvents(session, 'foreign'), { status: 404 });
  assert.deepEqual(helper.calls, []);
});
for (const body of [
  { eventType: 'skip' }, { eventType: 'job_completed', latitude: 100, longitude: 0 },
  { eventType: 'pickup_arrived', latitude: '13', longitude: 100 },
  { eventType: 'pickup_arrived', latitude: 13, longitude: null },
  { eventType: 'pickup_arrived', latitude: NaN, longitude: 100 }
]) test(`invalid progress payload is rejected: ${JSON.stringify(body)}`, async () => {
  const helper = helpers();
  await assert.rejects(helper.appendDriverJobEvent(session, 'booking', body), { status: 400 });
  assert.deepEqual(helper.calls, []);
});
test('valid GPS is optional and passed through without replacing missing coordinates', async () => {
  const helper = helpers();
  const event = await helper.appendDriverJobEvent(session, 'booking', { eventType: 'pickup_arrived', latitude: 0, longitude: 0 });
  assert.equal(event.latitude, 0);
  assert.equal(event.longitude, 0);
});
for (const [code, status] of [['PT401', 401], ['PT404', 404], ['PT409', 409], ['23505', 409], ['PGRST202', 503]]) {
  test(`database ${code} is surfaced as ${status}`, async () => {
    const helper = helpers({ rpcError: { code, message: 'Database error' } });
    await assert.rejects(helper.appendDriverJobEvent(session, 'booking', { eventType: 'pickup_arrived' }), { status });
  });
}
test('event read errors do not masquerade as a new ready job', async () => {
  await assert.rejects(helpers({ queryError: {} }).getAssignedDriverJobEvents(session, 'booking'), { status: 503 });
});
function api({ signedIn = true } = {}) {
  const calls = [];
  const result = load('app/api/driver/jobs/[bookingId]/events/route.ts', {
    'next/server': { NextResponse: { json: (body, options) => ({ body, status: options?.status ?? 200 }) } },
    '@/lib/driver-portal-server': { DriverPortalError, getDriverPortalSession: async () => signedIn ? session : null },
    '@/lib/driver-job-events-server': {
      getAssignedDriverJobEvents: async (...args) => { calls.push(args); return []; },
      appendDriverJobEvent: async (...args) => { calls.push(args); return { id: 'event' }; }
    }
  });
  return { ...result, calls };
}
const context = { params: Promise.resolve({ bookingId: 'booking' }) };
test('driver API requires cookie session for read and write', async () => {
  const handler = api({ signedIn: false });
  assert.equal((await handler.GET(new Request('http://localhost/events'), context)).status, 401);
  assert.equal((await handler.POST(new Request('http://localhost/events', { method: 'POST', headers: { origin: 'http://localhost' }, body: '{}' }), context)).status, 401);
  assert.deepEqual(handler.calls, []);
});
test('cross-origin write cannot reach the progress helper', async () => {
  const handler = api();
  assert.equal((await handler.POST(new Request('http://localhost/events', { method: 'POST', headers: { origin: 'http://evil.example' }, body: '{}' }), context)).status, 403);
  assert.deepEqual(handler.calls, []);
});
test('valid event API invokes helper with server session', async () => {
  const handler = api();
  const result = await handler.POST(new Request('http://localhost/events', { method: 'POST', headers: { origin: 'http://localhost' }, body: JSON.stringify({ eventType: 'pickup_arrived' }) }), context);
  assert.equal(result.status, 201);
  assert.equal(handler.calls[0][0], session);
});

for (const permitted of [true, false]) test(`office event API respects existing business read permission: ${permitted}`, async () => {
  class AdminApiError extends Error { constructor(status, message) { super(message); this.status = status; } }
  let reads = 0;
  const handler = load('app/api/office/bookings/[bookingId]/driver-events/route.ts', {
    'next/server': { NextResponse: { json: (body, options) => ({ body, status: options?.status ?? 200 }) } },
    '@/lib/admin-user-management-server': { AdminApiError, createServerSupabaseAdmin: () => ({}), requireVerifiedUser: async () => ({ id: 'verified-office' }), resolveAccountAccess: async () => ({ role: 'office_staff', status: permitted ? 'active' : 'suspended' }) },
    '@/lib/authorization': { hasPermission: (access, permission) => { assert.equal(permission, 'business:read'); return access.status === 'active'; } },
    '@/lib/driver-portal-server': { DriverPortalError },
    '@/lib/driver-job-events-server': { readDriverJobEvents: async () => { reads++; return []; } }
  });
  const result = await handler.GET(new Request('http://localhost/events'), { params: Promise.resolve({ bookingId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }) });
  assert.equal(result.status, permitted ? 200 : 403);
  assert.equal(reads, permitted ? 1 : 0);
});

test('office event API stops at authoritative driver precedence rejection', async () => {
  class AdminApiError extends Error { constructor(status, message) { super(message); this.status = status; } }
  const handler = load('app/api/office/bookings/[bookingId]/driver-events/route.ts', {
    'next/server': { NextResponse: { json: (body, options) => ({ body, status: options?.status ?? 200 }) } },
    '@/lib/admin-user-management-server': { AdminApiError, createServerSupabaseAdmin: () => ({}), requireVerifiedUser: async () => ({ id: 'verified-driver' }), resolveAccountAccess: async () => { throw new AdminApiError(403, 'Driver accounts must use the driver portal.'); } },
    '@/lib/authorization': { hasPermission: () => { throw new Error('Must not reach office permission check'); } },
    '@/lib/driver-portal-server': { DriverPortalError },
    '@/lib/driver-job-events-server': { readDriverJobEvents: () => { throw new Error('Must not read office data'); } }
  });
  assert.equal((await handler.GET(new Request('http://localhost/events'), context)).status, 403);
});
test('migration enforces serialized sequence, append-only grants, current ownership and server time', () => {
  const sql = read('supabase/migrations/20261003100000_driver_job_events.sql');
  assert.match(sql, /format_type\(atttypid, atttypmod\)/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /unique \(booking_id, event_type\)/);
  assert.match(sql, /where b.id = p_booking_id for update/);
  assert.match(sql, /assigned_driver is distinct from identity.driver_id::text/);
  assert.match(sql, /s.revoked_at is null and s.expires_at > clock_timestamp\(\)/);
  assert.match(sql, /sequence\[existing_count \+ 1\]/);
  assert.match(sql, /expected_event is null or p_event_type <> expected_event/);
  assert.match(sql, /raise sqlstate 'PT409'/);
  assert.match(sql, /event_time timestamptz not null default clock_timestamp\(\)/);
  assert.match(sql, /grant execute.*to service_role/);
  assert.doesNotMatch(sql, /grant (?:insert|update|delete)/i);
  assert.match(sql, /using \(public.is_office_account\(\)\)/);
});
test('driver UI has bilingual sequential controls, optional GPS, timestamps and exact Atip contact', () => {
  const source = read('components/driver/driver-job-detail.tsx');
  assert.match(source, /busy.current/);
  assert.match(source, /labels.actions\[stage\]/);
  assert.match(source, /setTimeout\(\(\) => finish\(null, null\), 8000\)/);
  assert.match(source, /navigator.geolocation.getCurrentPosition/);
  assert.match(source, /dateTime=\{event.eventTime\}/);
  assert.match(source, /tel:\+66657896654/);
  assert.match(source, /Atip Punpanung/);
  for (const label of ['ถึงจุดรับ', 'ออกจากจุดรับ', 'ถึงจุดส่ง', 'จบงาน', 'จากคลัง', 'จากตำแหน่งฉัน']) assert.ok(source.includes(label));
});
