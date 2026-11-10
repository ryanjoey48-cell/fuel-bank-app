const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const { load } = require('../scripts/fleet-real-day-validation.cjs');
const dayModule = load('lib/fleet-intelligence-day.ts');
const intelligence = load('lib/fleet-intelligence.ts');
const view = load('lib/fleet-evidence-view.ts');
const playback = load('lib/forth-playback-access.ts');
const insightsLib = load('lib/fleet-day-insights.ts');
const rv = load('lib/fleet-day-review.ts');
const metrics = load('lib/fleet-provider-metrics.ts');
const rate = load('lib/forth-history-rate-limit.ts');

class ApiError extends Error { constructor(status, message) { super(message); this.status = status; } }
const DAY = '2026-11-03';
const compile = (file, mocks) => {
  const module = { exports: {} };
  const out = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('require', 'module', 'exports', out)(name => { if (!(name in mocks)) throw Error('unmocked ' + name); return mocks[name]; }, module, module.exports);
  return module.exports;
};
// One real, shared, user-keyed session cache for both routes.
const session = compile('lib/fleet-intelligence-session.ts', { 'server-only': {} });

const seg = (s, e, km) => ({ boxId: 'box', plateNo: 'REG', rDate: DAY, startTime: s, endTime: e, sumDistance: km, routingTime: '01:00:00' });
const evidenceFor = (id, reg, day = DAY) => ({ ...dayModule.buildProviderDay({ vehicleId: id, registration: reg, deviceId: 'dev-' + id, day, capturedAt: '2026-11-04T00:00:00Z', reportRows: [seg('08:00:00', '09:00:00', '12.30'), { boxId: '', plateNo: 'Total', sumDistance: '12.30' }], logRows: [] }), journeyLedger: ledger() });
const ledger = () => ({ version: 'v4.4', journeys: [{ id: 'j1', segmentId: 's1', kind: 'stopped', start: `${DAY}T08:00:00+07:00`, end: `${DAY}T11:00:00+07:00`, minutes: 180, providerKm: 0, observations: 10, movingObservations: 0, engineOnObservations: null, reportedTrailKm: null, verifiedGpsKm: null, positionSource: 'no_gps', gapsInside: 0, issues: [], ambiguous: false }], missing: [], outsideReport: [], totals: { outsideReportMinutes: 0, outsideReportLogKm: null, cadenceJitterGaps: 0, providerKm: 0, movingJourneys: 0, stops: 1, openFinal: 0, ambiguousJourneys: 0, reportedTrailKm: null, verifiedGpsKm: null, observations: 10, duplicateObservations: 0, positionSource: 'no_gps', missingMinutes: 0 } });

const baseMocks = (userId, hasPerm) => ({
  'next/server': { NextResponse: { json: (body, options) => new Response(JSON.stringify(body), options) } },
  '@/lib/admin-user-management-server': { AdminApiError: ApiError },
  '@/lib/fleet-operations-auth': { requireFleetOfficeAccess: async request => { if (request.headers.get('x-denied')) throw new ApiError(Number(request.headers.get('x-denied')), 'Denied'); return { user: { id: userId }, access: { role: hasPerm ? 'admin' : 'office' } }; } },
  '@/lib/authorization': { hasPermission: (access, permission) => permission === 'business:read' || (permission === 'fleet:history_playback' && access.role === 'admin') },
  '@/lib/forth-playback-access': playback,
  '@/lib/fleet-intelligence': intelligence,
  '@/lib/fleet-intelligence-day': dayModule,
  '@/lib/fleet-intelligence-session': session,
  '@/lib/fleet-provider-metrics': metrics,
  '@/lib/fleet-provider-request-log': compile('lib/fleet-provider-request-log.ts', { 'node:crypto': require('node:crypto') }),
  '@/lib/fleet-evidence-view': view,
  '@/lib/fleet-day-insights': insightsLib
});

function providerRoute(userId, { admin = false, vehicles = [{ id: 'veh-1', vehicle_reg: 'AA-1' }], fleetRecords, parkingOk = true } = {}) {
  const calls = { parking: 0, log: 0, fleet: 0 };
  const records = fleetRecords ?? [{ gpsDeviceId: 'dev-veh-1', vehicleRegistration: 'AA-1' }];
  const mocks = { ...baseMocks(userId, admin),
    '@/lib/fleet-evidence-server': { createFleetSourceClient: () => ({ from: () => ({ select: () => ({ eq: (_c, id) => ({ single: async () => { const v = vehicles.find(x => x.id === id); return v ? { data: v, error: null } : { data: null, error: { message: 'none' } }; } }) }) }) }) },
    '@/lib/forth-tracking-server': {
      getForthTrackingFleetData: async () => { calls.fleet++; return { connectionStatus: 'connected', records }; },
      getForthParkingReport: async () => { calls.parking++; return parkingOk ? { ok: true, status: 200, payload: [seg('08:00:00', '09:00:00', '12.30'), { boxId: '', plateNo: 'Total', sumDistance: '12.30' }] } : { ok: false, status: 502 }; },
      getForthLogReport: async () => { calls.log++; return { ok: true, status: 200, payload: [] }; }
    },
    '@/lib/forth-tracking': { matchForthVehicle: (record, list) => ({ status: list.some(v => v.vehicle_reg === record.vehicleRegistration) ? 'matched' : 'unmatched' }) },
    '@/lib/forth-history-live-gate': { isForthHistoryLiveRequestsEnabled: () => true },
    '@/lib/forth-history-rate-limit': rate };
  return { ...compile('app/api/admin/forth-tracking/evidence/provider/route.ts', mocks), calls };
}
function fleetRoute(userId, { admin = false } = {}) {
  const mocks = { ...baseMocks(userId, admin),
    '@/lib/fleet-evidence-server': { createFleetSourceClient: () => ({ from: table => { const result = table === 'vehicles' ? { data: [{ id: 'veh-1', vehicle_reg: 'AA-1', active: true }, { id: 'veh-2', vehicle_reg: 'BB-2', active: false }, { id: 'veh-3', vehicle_reg: 'DUP-3', active: true }, { id: 'veh-4', vehicle_reg: 'DUP-3', active: true }], error: null } : { data: [], error: null }; const chain = { select: () => chain, eq: () => chain, order: () => chain, limit: async () => result }; return chain; } }) } };
  return compile('app/api/admin/forth-tracking/evidence/fleet/route.ts', mocks);
}
let dayCounter = 0; const uniqueDay = () => `2026-08-${String(++dayCounter).padStart(2, '0')}`;
const post = (route, id = 'veh-1', day = DAY, extra = '') => route.POST(new Request(`http://localhost/api/x?vehicleId=${id}&day=${day}${extra}`, { method: 'POST' }));
const getFleet = (route, day = DAY, headers = {}) => route.GET(new Request(`http://localhost/api/x?day=${day}`, { headers }));
const reset = () => { metrics.resetProviderMetricsForTests(); rate.resetForthHistoryRateLimitForTests(); };

test('observability: a miss reads Forth once per report (2 requests), the repeat is a cache hit with no Forth request, and the counters say so', async () => {
  reset(); const route = providerRoute('user-a');
  assert.equal((await post(route)).status, 200); assert.deepEqual([route.calls.parking, route.calls.log], [1, 1]);
  assert.equal((await post(route)).status, 200); assert.deepEqual([route.calls.parking, route.calls.log], [1, 1], 'second read is served from memory');
  const m = metrics.providerMetricsSnapshot();
  assert.equal(m.requests, 2); assert.equal(m.cacheHits, 1); assert.equal(m.cacheMisses, 1); assert.equal(m.providerReads, 1); assert.equal(m.forthRequestsMade, 2); assert.deepEqual(m.recent.map(e => e.outcome), ['provider_read', 'cache_hit']);
});

test('observability: a provider failure, a refused device and an invalid request are counted without recording identifiers', async () => {
  reset();
  assert.equal((await post(providerRoute('user-a', { parkingOk: false }), 'veh-1', '2026-11-02')).status, 502);
  assert.equal((await post(providerRoute('user-a', { fleetRecords: [] }), 'veh-1', '2026-11-01')).status, 409, 'no unique Forth device is refused, not guessed');
  assert.equal((await post(providerRoute('user-a'), 'veh-1', '2099-01-01')).status, 400);
  const m = metrics.providerMetricsSnapshot();
  assert.equal(m.providerErrors, 1); assert.equal(m.deviceRefused, 1); assert.equal(m.byStatus['400'], 1); assert.equal(m.forthRequestsMade, 1);
  const text = JSON.stringify(m);
  assert.doesNotMatch(text, /AA-1|veh-1|dev-veh|user-a|latitude|longitude|token|authorization/i);
});

test('observability: a duplicate Forth device is refused with 409 and no report is read', async () => {
  reset(); const route = providerRoute('user-a', { fleetRecords: [{ gpsDeviceId: 'd', vehicleRegistration: 'AA-1' }, { gpsDeviceId: 'd', vehicleRegistration: 'AA-1' }] });
  assert.equal((await post(route, 'veh-1', uniqueDay())).status, 409); assert.deepEqual([route.calls.parking, route.calls.log], [0, 0]);
});

test('observability: the rate limiter is counted and answers 429 with Retry-After', async () => {
  reset(); const route = providerRoute('user-a');
  for (let i = 0; i < 12; i++) assert.equal((await post(route, 'veh-1', `2026-10-${String(10 + i).padStart(2, '0')}`)).status, 200);
  const blocked = await post(route, 'veh-1', '2026-10-30');
  assert.equal(blocked.status, 429); assert.ok(Number(blocked.headers.get('Retry-After')) >= 1);
  assert.equal(metrics.providerMetricsSnapshot().rateLimited, 1);
});

test('observability: the metrics are bounded to a fixed number of recent events', () => {
  reset(); for (let i = 0; i < 200; i++) metrics.recordProviderRead({ outcome: 'cache_hit', status: 200, durationMs: i });
  const m = metrics.providerMetricsSnapshot(); assert.equal(m.recent.length, metrics.MAX_RECENT_EVENTS); assert.equal(m.requests, 200); assert.equal(m.cacheHits, 200);
});

test('diagnostics endpoint: only a caller allowed to see historical journeys can read it; others get 403 and no numbers', async () => {
  reset(); metrics.recordProviderRead({ outcome: 'cache_hit', status: 200, durationMs: 3 });
  const denied = await providerRoute('office-user', { admin: false }).GET(new Request('http://localhost/api/x')); assert.equal(denied.status, 403); assert.doesNotMatch(await denied.text(), /cacheHits/);
  const ok = await providerRoute('admin-user', { admin: true }).GET(new Request('http://localhost/api/x')); assert.equal(ok.status, 200); assert.equal((await ok.json()).metrics.cacheHits, 1);
  assert.equal((await providerRoute('x').GET(new Request('http://localhost/api/x', { headers: { 'x-denied': '401' } }))).status, 401);
});

test('cache isolation: user B never sees user A\'s cached day, even with the same vehicle id and day; a miss costs B its own provider read', async () => {
  reset();
  const a = providerRoute('user-a'); assert.equal((await post(a)).status, 200);
  const b = providerRoute('user-b'); const rb = await post(b); assert.equal(rb.status, 200); assert.equal((await rb.json()).cache.hit, false, 'B does not get A\'s cache');
  assert.deepEqual([b.calls.parking, b.calls.log], [1, 1]);
  assert.ok(session.recalledProviderDay('user-a', 'veh-1', 'AA-1', DAY)); assert.ok(session.recalledProviderDay('user-b', 'veh-1', 'AA-1', DAY));
  assert.equal(session.recalledProviderDay('user-c', 'veh-1', 'AA-1', DAY), null, 'a third user sees nothing');
  assert.equal(session.recalledProviderDay('user-a', 'veh-1', 'WRONG-REG', DAY), null, 'a different registration for the same id is a different key');
});

test('fleet review leaks nothing across users: user B\'s fleet report has no evidence for the day only user A read', async () => {
  reset(); const d = uniqueDay(); session.rememberProviderDay('user-a', evidenceFor('veh-1', 'AA-1', d));
  const forA = await (await getFleet(fleetRoute('user-a', { admin: true }), d)).json(); const forB = await (await getFleet(fleetRoute('user-b', { admin: true }), d)).json();
  assert.ok(forA.rows.find(r => r.vehicleId === 'veh-1').review); assert.equal(forB.rows.find(r => r.vehicleId === 'veh-1').review, null);
  assert.equal(forB.rows.find(r => r.vehicleId === 'veh-1').metric, null, 'no provider distance for another user either');
});

test('journey authorisation: an ordinary office account gets "restricted" and the day total only; an authorised admin gets the insights', async () => {
  reset(); const d = uniqueDay(); session.rememberProviderDay('office-u', evidenceFor('veh-1', 'AA-1', d)); session.rememberProviderDay('admin-u', evidenceFor('veh-1', 'AA-1', d));
  const office = (await (await getFleet(fleetRoute('office-u', { admin: false }), d)).json()).rows.find(r => r.vehicleId === 'veh-1').review;
  assert.equal(office.coverage, 'restricted'); assert.equal(office.journeyAccess, 'requires_authorisation'); assert.equal(office.activity.stops, null); assert.equal(office.activity.firstSegmentStart, null);
  const admin = (await (await getFleet(fleetRoute('admin-u', { admin: true }), d)).json()).rows.find(r => r.vehicleId === 'veh-1').review;
  assert.equal(admin.coverage, 'unverified'); assert.equal(admin.activity.stops, 1); assert.ok(admin.insights.some(i => i.id === 'long_stop'));
});

test('no coordinates, device ids or raw points appear in the fleet report or the provider response for any caller', async () => {
  reset(); const d = uniqueDay(); session.rememberProviderDay('admin-u', { ...evidenceFor('veh-1', 'AA-1', d), observedPoints: [{ latitude: 13.7, longitude: 100.5, timestamp: 't' }], reportedPoints: [{ latitude: 13.8, longitude: 100.6, timestamp: 't' }] });
  const fleetText = await (await getFleet(fleetRoute('admin-u', { admin: true }), d)).text();
  assert.doesNotMatch(fleetText, /13\.7|100\.5|13\.8|100\.6|observedPoints|reportedPoints|dev-veh-1/);
  const providerText = await (await post(providerRoute('admin-u', { admin: true }), 'veh-1', d)).text();
  assert.doesNotMatch(providerText, /observedPoints|reportedPoints|13\.7|100\.5/);
});

test('unauthorised requests get no GPS history from either route and never reach Forth', async () => {
  reset(); session.rememberProviderDay('someone', evidenceFor('veh-1', 'AA-1'));
  const p = providerRoute('x'); const denied = await p.POST(new Request(`http://localhost/api/x?vehicleId=veh-1&day=${DAY}`, { method: 'POST', headers: { 'x-denied': '403' } }));
  assert.equal(denied.status, 403); assert.deepEqual([p.calls.fleet, p.calls.parking, p.calls.log], [0, 0, 0]);
  const f = await getFleet(fleetRoute('x'), DAY, { 'x-denied': '401' }); assert.equal(f.status, 401); assert.doesNotMatch(await f.text(), /rows|journey/);
});

test('registry integrity: a duplicate registration and an inactive record are flagged, never read, never merged', async () => {
  reset(); const rows = (await (await getFleet(fleetRoute('user-a', { admin: true }), uniqueDay())).json()).rows;
  const by = id => rows.find(r => r.vehicleId === id);
  assert.equal(by('veh-1').registry, 'active'); assert.equal(by('veh-2').registry, 'inactive'); assert.equal(by('veh-3').registry, 'duplicate_registration'); assert.equal(by('veh-4').registry, 'duplicate_registration');
  assert.equal(rows.length, 4, 'nothing is merged or hidden');
  const input = rows.map(r => ({ vehicleId: r.vehicleId, registration: r.registration, providerKm: null, providerReconciled: false, segments: null, capturedAt: null, review: r.review, registry: r.registry }));
  assert.deepEqual(rv.vehiclesToRead(input), ['veh-1'], 'only the active, uniquely registered vehicle is requested');
  const dup = rv.reviewVehicle(input.find(r => r.vehicleId === 'veh-3')); assert.ok(dup.exceptions.some(e => e.key === 'registry_duplicate')); assert.equal(dup.priority, 'medium');
  assert.ok(rv.reviewVehicle(input.find(r => r.vehicleId === 'veh-2')).exceptions.some(e => e.key === 'registry_inactive'));
  const thai = /[฀-๿]/; for (const k of ['registry_duplicate', 'registry_inactive']) for (const f of ['title', 'unknown', 'action']) assert.match(rv.EXCEPTION_COPY[k][f][1], thai, `${k}.${f}`);
});

test('verification is not weakened: an unverified day stays unverified in the fleet review and never reads as verified', async () => {
  reset(); const d = uniqueDay(); session.rememberProviderDay('admin-u', evidenceFor('veh-1', 'AA-1', d));
  const review = (await (await getFleet(fleetRoute('admin-u', { admin: true }), d)).json()).rows.find(r => r.vehicleId === 'veh-1').review;
  const r = rv.reviewVehicle({ vehicleId: 'veh-1', registration: 'AA-1', providerKm: 12.3, providerReconciled: true, segments: 1, capturedAt: null, review });
  assert.equal(r.verified, 'unverified'); assert.ok(review.insights.some(i => i.id === 'unverified_positions' && i.reliability === 'provider_reported'));
});

test('a request the browser cancelled (Stop, date change) is recorded as a cancellation, not as a provider or lookup failure', async () => {
  reset(); const controller = new AbortController();
  const mocks = { ...baseMocks('user-a', false),
    '@/lib/fleet-evidence-server': { createFleetSourceClient: () => ({ from: () => ({ select: () => ({ eq: () => ({ single: async () => { controller.abort(); throw new Error('aborted'); } }) }) }) }) },
    '@/lib/forth-tracking-server': { getForthTrackingFleetData: async () => { throw new Error('must not be reached'); }, getForthParkingReport: async () => { throw new Error('must not be reached'); }, getForthLogReport: async () => { throw new Error('must not be reached'); } },
    '@/lib/forth-tracking': { matchForthVehicle: () => ({ status: 'matched' }) }, '@/lib/forth-history-live-gate': { isForthHistoryLiveRequestsEnabled: () => true }, '@/lib/forth-history-rate-limit': rate };
  const route = compile('app/api/admin/forth-tracking/evidence/provider/route.ts', mocks);
  await route.POST(new Request(`http://localhost/api/x?vehicleId=veh-1&day=${uniqueDay()}`, { method: 'POST', signal: controller.signal }));
  const m = metrics.providerMetricsSnapshot(); assert.equal(m.recent.at(-1).outcome, 'client_cancelled'); assert.equal(m.forthRequestsMade, 0); assert.equal(m.cacheMisses, 0); assert.equal(m.otherErrors, 0);
});
