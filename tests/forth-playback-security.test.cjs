const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { load } = require('../scripts/fleet-real-day-validation.cjs');
const auth = load('lib/authorization.ts');
const access = load('lib/forth-playback-access.ts');
const audit = load('lib/forth-history-audit.ts');
const gate = load('lib/forth-history-live-gate.ts');
// The route modules are loaded with ONE controlled AdminApiError class (as the other history tests do), so instanceof checks behave exactly as in production.
const Module = require('node:module'), path = require('node:path'), ts = require('typescript');
const root = path.resolve(__dirname, '..');
class AdminApiError extends Error { constructor(status, message) { super(message); this.status = status; } }
const mocks = { 'next/server': { NextResponse: { json: (body, init = {}) => new Response(JSON.stringify(body), init) } },
  '@/lib/admin-user-management-server': { AdminApiError, requireVerifiedUser: async () => { throw new AdminApiError(401, 'Authentication required.'); }, createServerSupabaseAdmin: () => ({}), resolveAccountAccess: async () => null } };
function loadWithMocks(relativePath) {
  const cache = new Map();
  function loadOne(file) {
    file = path.resolve(root, file); if (cache.has(file)) return cache.get(file).exports;
    const loaded = new Module(file, module); cache.set(file, loaded); loaded.filename = file; loaded.paths = Module._nodeModulePaths(path.dirname(file));
    loaded.require = request => {
      if (Object.hasOwn(mocks, request)) return mocks[request];
      for (const [prefix, base] of [['@/', root], ['.', path.dirname(file)]]) if (request.startsWith(prefix)) { const target = prefix === '@/' ? path.join(base, request.slice(2)) : path.resolve(base, request); const hit = [target, `${target}.ts`, `${target}.tsx`].find(n => fs.existsSync(n) && fs.statSync(n).isFile()); if (hit) return loadOne(hit); }
      return require(request);
    };
    loaded._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file); return loaded.exports;
  }
  return loadOne(relativePath);
}
const { createJourneyPlaybackPostHandler } = loadWithMocks('lib/forth-history-playback-route.ts');
const { createJourneyHistoryPostHandler } = loadWithMocks('lib/forth-history-route.ts');
const { createHistoryAuditGetHandler } = loadWithMocks('lib/forth-history-audit-route.ts');

const USERS = { owner: { id: 'u-owner', role: 'super_admin' }, admin: { id: 'u-admin', role: 'admin' }, office: { id: 'u-office', role: 'office_staff' }, readonly: { id: 'u-readonly', role: 'read_only' }, suspended: { id: 'u-suspended', role: 'admin', status: 'suspended' } };
const accessOf = u => ({ userId: u.id, role: u.role, status: u.status ?? 'active' });
const fleetRecord = { gpsDeviceId: '519698', vehicleRegistration: 'ฒอ-8453' };
const logRow = (i, source = 'No GPS') => ({ gpsID: '519698', plateNumber: 'ฒอ-8453', dateTime: `03-11-2026 06:0${i}:00`, GPS: 'ON', GPRS: 'ON', Engine: 'ON', Speed: 30, Latitude: 13.76 + i * 0.001, Longitude: 100.76, COG: 0, positionSource: source, Distance: i ? 110 : 0 });
function build({ user = USERS.admin, enabled = true, allowed = [], fleet = { connectionStatus: 'connected', error: null, records: [fleetRecord] }, log, requireUser, fleetThrows } = {}) {
  const events = [], calls = { fleet: 0, log: 0 };
  const deps = {
    enabled, allowedUserIds: allowed, audit: input => { const e = audit.buildHistoryAuditEvent(input); events.push(e); return e; },
    requireUser: requireUser ?? (async () => ({ id: user.id })), createAdmin: () => ({}), resolveAccess: async () => accessOf(user), checkPermission: auth.hasPermission,
    getFleet: async () => { calls.fleet++; if (fleetThrows) throw new Error(fleetThrows); return fleet; },
    getLog: async () => { calls.log++; return log ?? { ok: true, status: 200, payload: [0, 1, 2, 3].map(i => logRow(i)) }; },
    rateLimitKey: (u, d) => `test:${u}:${d}:${Math.random()}`, beginRateLimit: () => ({ allowed: true, remaining: 5, retryAfterSeconds: null }), releaseRateLimit: () => undefined, sourceTimeZone: 'Asia/Bangkok'
  };
  return { handler: createJourneyPlaybackPostHandler(deps), events, calls, deps };
}
const req = (body = { deviceId: '519698', date: '2026-11-03', startTime: '06:00', endTime: '07:00', language: 'en' }, headers = { 'Content-Type': 'application/json' }) => new Request('https://ees.test/api/admin/forth-tracking/history/playback', { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) });

test('permission architecture: only super_admin and admin hold fleet:history_playback; business:read does not imply it', () => {
  for (const role of ['super_admin', 'admin']) assert.equal(auth.hasPermission({ role, status: 'active' }, 'fleet:history_playback'), true, role);
  for (const role of ['office_staff', 'read_only']) { assert.equal(auth.hasPermission({ role, status: 'active' }, 'fleet:history_playback'), false, role); assert.equal(auth.hasPermission({ role, status: 'active' }, 'business:read'), true, role); }
  assert.equal(auth.hasPermission({ role: 'admin', status: 'suspended' }, 'fleet:history_playback'), false);
  assert.equal(auth.hasPermission(null, 'fleet:history_playback'), false);
  assert.equal(auth.ROLE_PERMISSIONS.super_admin.includes('admin:user_management'), true);                       // existing administrator powers are unchanged
  assert.equal(auth.ROLE_PERMISSIONS.admin.includes('admin:security_settings'), true);
});

test('access decision: administrators allowed by role, others only if explicitly allowlisted, suspended and unknown denied', () => {
  const decide = (u, allowedUserIds = []) => access.decideHistoricalPlaybackAccess({ access: accessOf(u), userId: u.id, checkPermission: auth.hasPermission, allowedUserIds });
  assert.deepEqual({ ...decide(USERS.owner) }, { allowed: true, basis: 'role_permission' }); assert.deepEqual({ ...decide(USERS.admin) }, { allowed: true, basis: 'role_permission' });
  assert.deepEqual({ ...decide(USERS.office) }, { allowed: false, reason: 'playback_permission_required' }); assert.deepEqual({ ...decide(USERS.readonly) }, { allowed: false, reason: 'playback_permission_required' });
  assert.deepEqual({ ...decide(USERS.suspended) }, { allowed: false, reason: 'no_office_access' });
  assert.deepEqual({ ...access.decideHistoricalPlaybackAccess({ access: null, userId: 'x', checkPermission: auth.hasPermission, allowedUserIds: ['x'] }) }, { allowed: false, reason: 'no_office_access' });   // an allowlist never overrides a missing or suspended account
  assert.deepEqual({ ...decide(USERS.office, ['u-office']) }, { allowed: true, basis: 'explicit_allowlist' });
  assert.deepEqual({ ...decide(USERS.readonly, ['u-readonly']) }, { allowed: true, basis: 'explicit_allowlist' });
  assert.equal(decide(USERS.office, ['someone-else']).allowed, false);
  assert.deepEqual(access.parsePlaybackAllowlist(undefined), []); assert.deepEqual(access.parsePlaybackAllowlist('A1B2C3D4-0000, <script>, 12 ,A1B2C3D4-0000'), ['a1b2c3d4-0000']);
  assert.equal(access.parsePlaybackAllowlist(Array.from({ length: 80 }, (_, i) => `deadbeef-${i.toString(16).padStart(4, '0')}`).join(',')).length, 25);
});

test('playback route: authorised administrators succeed with a correlation id and a sanitized audit event', async () => {
  for (const user of [USERS.owner, USERS.admin]) {
    const { handler, events, calls } = build({ user }); const response = await handler(req()); const body = await response.json();
    assert.equal(response.status, 200); assert.equal(body.status, 'ready'); assert.equal(body.verifiedCount, 0); assert.ok(body.trailEligibleCount > 0);
    assert.equal(response.headers.get('cache-control'), 'private, no-store'); assert.match(response.headers.get('x-correlation-id'), /^[0-9a-f-]{36}$/);
    assert.equal(events.length, 1); const e = events[0];
    assert.equal(e.outcome, 'authorised_ready'); assert.equal(e.userId, user.id); assert.equal(e.role, user.role); assert.equal(e.accessBasis, 'role_permission'); assert.equal(e.action, 'playback_points');
    assert.equal(e.deviceId, '519698'); assert.equal(e.date, '2026-11-03'); assert.deepEqual(e.window, { startTime: '06:00', endTime: '07:00' }); assert.equal(e.observationCount, 4); assert.equal(e.correlationId, response.headers.get('x-correlation-id'));
    assert.ok(calls.log === 1);
  }
});

test('office staff and read-only users are denied server-side without explicit permission, before any Forth request', async () => {
  for (const user of [USERS.office, USERS.readonly]) {
    const { handler, events, calls } = build({ user }); const response = await handler(req()); const body = await response.json();
    assert.equal(response.status, 403); assert.equal(body.status, 'unavailable'); assert.match(body.error, /explicit authorisation/i); assert.equal('points' in body, false);
    assert.deepEqual(calls, { fleet: 0, log: 0 }); assert.equal(events.length, 1); assert.equal(events[0].outcome, 'denied_playback_permission'); assert.equal(events[0].userId, user.id); assert.equal(events[0].httpStatus, 403);
  }
});

test('an explicitly allowlisted office user is allowed and the basis is audited; an allowlist cannot reach a suspended account', async () => {
  const ok = build({ user: USERS.office, allowed: ['u-office'] }); const response = await ok.handler(req()); assert.equal(response.status, 200); assert.equal(ok.events[0].accessBasis, 'explicit_allowlist');
  const suspended = build({ user: USERS.suspended, allowed: ['u-suspended'] }); assert.equal((await suspended.handler(req())).status, 403); assert.deepEqual(suspended.calls, { fleet: 0, log: 0 });
});

test('unauthenticated, invalid device, invalid time range and malformed requests are rejected with fixed messages', async () => {
  const unauth = build({ requireUser: async () => { throw new AdminApiError(401, 'Authentication required.'); } }); const r1 = await unauth.handler(req()); assert.equal(r1.status, 401); assert.equal(unauth.events[0].outcome, 'unauthenticated'); assert.equal(unauth.events[0].userId, null); assert.deepEqual(unauth.calls, { fleet: 0, log: 0 });
  const badDevice = build(); const r2 = await badDevice.handler(req({ deviceId: '000000', date: '2026-11-03', startTime: '06:00', endTime: '07:00' })); assert.equal(r2.status, 404); assert.equal(badDevice.calls.log, 0); assert.equal(badDevice.events[0].outcome, 'rejected_device_not_in_fleet');
  const dup = build({ fleet: { connectionStatus: 'connected', error: null, records: [fleetRecord, fleetRecord] } }); assert.equal((await dup.handler(req())).status, 409); assert.equal(dup.calls.log, 0);
  for (const body of [{ deviceId: '519698', date: '2026-11-03', startTime: '09:00', endTime: '08:00' }, { deviceId: '519698', date: '2026-02-30', startTime: '06:00', endTime: '07:00' }, { deviceId: '', date: '2026-11-03' }, { deviceId: '519698', date: '2026-11-03', startTime: '25:99', endTime: '07:00' }, 'not json', '[]']) {
    const t = build(); const r = await t.handler(req(body)); assert.equal(r.status, 400, JSON.stringify(body)); assert.equal(t.calls.log, 0); assert.equal(t.events[0].outcome, 'rejected_invalid_request');
  }
  const wrongType = build(); assert.equal((await wrongType.handler(req({ deviceId: '519698', date: '2026-11-03' }, { 'Content-Type': 'text/plain' }))).status, 415);
  const big = build(); assert.equal((await big.handler(req('x'.repeat(9000)))).status, 413);
});

test('time-range validation: real Bangkok calendar day, real clock times, never the future, one day only', () => {
  const { forthPlaybackDayRange } = load('lib/forth-journey-playback.ts');
  assert.deepEqual({ ...forthPlaybackDayRange('2026-11-03', '06:00', '07:00') }, { startTime: '20261103060000', endTime: '20261103070059' });
  assert.deepEqual({ ...forthPlaybackDayRange('2026-11-03') }, { startTime: '20261103000000', endTime: '20261103235959' });       // default window is the whole day, never longer
  assert.deepEqual({ ...forthPlaybackDayRange('2026-11-03', '06:00', '06:00') }, { startTime: '20261103060000', endTime: '20261103060059' });   // the end minute is inclusive: a one-minute window is valid
  for (const [d, s, e] of [['2026-02-30', '06:00', '07:00'], ['2026-13-01', '06:00', '07:00'], ['2026-11-03', '06:00', '99:99'], ['2026-11-03', '24:00', '23:59'], ['2026-11-03', '06:60', '07:00'], ['2026-11-03', '09:00', '08:00'], ['2999-01-01', '00:00', '23:59'], ['03-11-2026', '06:00', '07:00'], ['2026-11-03; DROP', '06:00', '07:00']]) assert.equal(forthPlaybackDayRange(d, s, e), null, `${d} ${s}-${e}`);
  assert.equal(forthPlaybackDayRange('2026-11-03', '06:00', '07:00').startTime.slice(0, 8), forthPlaybackDayRange('2026-11-03', '06:00', '07:00').endTime.slice(0, 8));   // start and end are always the same day
});

test('a closed production-style gate stays closed for everyone, including administrators, and makes no Forth request', async () => {
  for (const user of [USERS.owner, USERS.admin]) { const t = build({ user, enabled: false }); const r = await t.handler(req()); const body = await r.json(); assert.equal(r.status, 503); assert.equal(body.code, 'history_live_disabled'); assert.deepEqual(t.calls, { fleet: 0, log: 0 }); assert.equal(t.events[0].outcome, 'denied_gate_closed'); assert.equal('points' in body, false); }
  assert.equal(gate.isForthHistoryLiveRequestsEnabled({ VERCEL_ENV: 'production', FORTH_HISTORY_SUPERVISED_SESSION: '1' }), false);
  assert.equal(gate.isForthHistoryLiveRequestsEnabled({}), false); assert.equal(gate.FORTH_HISTORY_LIVE_REQUESTS_ENABLED, false);
  for (const file of ['vercel.json', '.vercel/project.json']) if (fs.existsSync(file)) assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /FORTH_HISTORY/);
});

test('errors and audit events never leak coordinates, tokens or request content', async () => {
  const thrown = build({ fleetThrows: 'lat 13.76123 lng 100.76 Bearer abc.def.ghi' }); const r = await thrown.handler(req()); const text = await r.text();
  assert.equal(r.status, 500); assert.doesNotMatch(text, /13\.76|100\.76|Bearer|abc\.def/); assert.equal(thrown.events[0].outcome, 'error'); assert.equal(thrown.events[0].reason, 'unexpected_error');
  const upstream = build({ log: { ok: false, status: 502, error: { code: 'report_http_error', message: 'Forth journey history returned an unsuccessful response.' } } }); const u = await upstream.handler(req()); assert.equal(u.status, 502); assert.equal(upstream.events[0].outcome, 'upstream_unavailable');
  const ok = build(); await ok.handler(req()); const serialized = JSON.stringify(ok.events);
  assert.doesNotMatch(serialized, /latitude|longitude|13\.7|100\.76|Bearer|authorization|token|password|secret/i);
  assert.deepEqual(Object.keys(ok.events[0]).sort(), ['accessBasis', 'action', 'at', 'atBangkok', 'correlationId', 'date', 'deviceId', 'httpStatus', 'observationCount', 'outcome', 'reason', 'role', 'userId', 'window'].sort());
});

test('audit builder keeps only allowlisted, validated fields and bounds its memory', () => {
  const e = audit.buildHistoryAuditEvent({ correlationId: 'abcdef12-aaaa', action: 'playback_points', outcome: 'authorised_ready', userId: 'user id with spaces', deviceId: '13.7,100.7; DROP', reason: 'Has Spaces', date: '2026-11-03', window: { startTime: '06:00', endTime: 'late' }, observationCount: -3, token: 'secret', latitude: 13.7, body: '{"x":1}' });
  assert.equal(e.userId, null); assert.equal(e.deviceId, 'invalid'); assert.equal(e.reason, null); assert.equal(e.window, null); assert.equal(e.observationCount, null); assert.equal('token' in e, false); assert.equal('latitude' in e, false); assert.equal('body' in e, false);
  assert.match(e.atBangkok, /Asia\/Bangkok$/); assert.match(e.at, /Z$/);
  audit.resetHistoryAuditForTests(); const lines = []; for (let i = 0; i < 320; i++) audit.recordHistoryAudit({ correlationId: `cid-${String(i).padStart(8, '0')}`, action: 'journey_report', outcome: 'rate_limited' }, line => lines.push(line));
  assert.equal(audit.recentHistoryAudit(1000).length, 300); assert.equal(audit.recentHistoryAudit(1)[0].correlationId, 'cid-00000319'); assert.equal(lines.length, 320); audit.resetHistoryAuditForTests();
  assert.doesNotThrow(() => audit.recordHistoryAudit({ correlationId: 'abcdef12-bbbb', action: 'playback_points', outcome: 'error' }, () => { throw new Error('sink down'); }));
});

test('journey-report route uses the same explicit permission and audits as a separate action', async () => {
  for (const user of [USERS.office, USERS.readonly]) {
    const events = [], calls = { fleet: 0, trips: 0 };
    const handler = createJourneyHistoryPostHandler({ enabled: true, allowedUserIds: [], audit: i => { events.push(audit.buildHistoryAuditEvent(i)); }, requireUser: async () => ({ id: user.id }), createAdmin: () => ({}), resolveAccess: async () => accessOf(user), checkPermission: auth.hasPermission, getFleet: async () => { calls.fleet++; return { connectionStatus: 'connected', records: [fleetRecord] }; }, getTrips: async () => { calls.trips++; return { ok: true, payload: [] }; } });
    const r = await handler(new Request('https://ees.test/api/admin/forth-tracking/history/journeys', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deviceId: '519698', date: '2026-11-03' }) }));
    assert.equal(r.status, 403); assert.deepEqual(calls, { fleet: 0, trips: 0 }); assert.equal(events[0].action, 'journey_report'); assert.equal(events[0].outcome, 'denied_playback_permission'); assert.ok(r.headers.get('x-correlation-id'));
  }
  const events = []; const closed = createJourneyHistoryPostHandler({ enabled: false, allowedUserIds: [], audit: i => { events.push(audit.buildHistoryAuditEvent(i)); }, requireUser: async () => ({ id: USERS.admin.id }), createAdmin: () => ({}), resolveAccess: async () => accessOf(USERS.admin), checkPermission: auth.hasPermission });
  assert.equal((await closed(new Request('https://ees.test/x', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }))).status, 503); assert.equal(events[0].outcome, 'denied_gate_closed');
});

test('the audit viewer is administrators only and non-durable by declaration', async () => {
  audit.resetHistoryAuditForTests(); audit.recordHistoryAudit({ correlationId: 'abcdef12-cccc', action: 'playback_points', outcome: 'authorised_ready', userId: 'u-admin', deviceId: '519698' }, () => undefined);
  const get = (user, url = 'https://ees.test/api/admin/forth-tracking/history/audit') => createHistoryAuditGetHandler({ requireUser: async () => { if (!user) throw new AdminApiError(401, 'Authentication required.'); return { id: user.id }; }, createAdmin: () => ({}), resolveAccess: async () => accessOf(user ?? USERS.readonly), checkPermission: auth.hasPermission })(new Request(url));
  assert.equal((await get(null)).status, 401); assert.equal((await get(USERS.readonly)).status, 403); assert.equal((await get(USERS.office)).status, 403);
  for (const user of [USERS.owner, USERS.admin]) { const r = await get(user); const body = await r.json(); assert.equal(r.status, 200); assert.equal(body.durable, false); assert.equal(body.events.length, 1); assert.equal(body.events[0].deviceId, '519698'); }
  assert.equal((await (await get(USERS.admin, 'https://ees.test/x?limit=0')).json()).events.length, 1);                                  // an invalid limit falls back to the default
  audit.resetHistoryAuditForTests();
});

test('live tracking is unaffected: the live routes do not use the historical permission, and no business module is touched', () => {
  const live = fs.readFileSync('app/api/admin/forth-tracking/route.ts', 'utf8'); assert.doesNotMatch(live, /history_playback|forth-playback-access|forth-history-audit/);
  const sources = ['lib/forth-playback-access.ts', 'lib/forth-history-audit.ts', 'lib/forth-history-audit-route.ts', 'lib/forth-history-playback-route.ts', 'lib/forth-history-route.ts'].map(f => fs.readFileSync(f, 'utf8')).join('\n');
  assert.doesNotMatch(sources, /\.from\(|from\s+["']@\/lib\/(data|maintenance|vehicle-financial|finance)/); assert.doesNotMatch(sources, /method:\s*["'](PUT|PATCH|DELETE)/);
});

test('Thai users get Thai playback errors; English keeps the fixed server wording; no coordinates in either', () => {
  const { describePlaybackHttpError } = load('lib/forth-journey-playback.ts');
  for (const status of [400, 403, 404, 409, 413, 415, 429, 500, 502, 503]) {
    const th = describePlaybackHttpError(status, 'th');
    assert.equal(typeof th, 'string'); assert.match(th, /[฀-๿]/); assert.doesNotMatch(th, /\d+\.\d{3,}/);
    assert.equal(describePlaybackHttpError(status, 'en'), null);
  }
  assert.match(describePlaybackHttpError(403, 'th'), /ผู้ดูแลระบบ/);
  assert.equal(describePlaybackHttpError(200, 'th'), null);
  const panel = fs.readFileSync('components/forth-journey-playback-panel.tsx', 'utf8');
  assert.match(panel, /describePlaybackHttpError\(response\.status, language\)/);
});
