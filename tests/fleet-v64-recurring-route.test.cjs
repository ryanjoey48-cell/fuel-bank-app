const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const { load } = require('../scripts/fleet-real-day-validation.cjs');
const dayModule = load('lib/fleet-intelligence-day.ts');
const intelligence = load('lib/fleet-intelligence.ts');
const playback = load('lib/forth-playback-access.ts');
const stopIntel = load('lib/fleet-stop-intelligence.ts');
const locEvidence = load('lib/fleet-location-evidence.ts');
const recurring = load('lib/fleet-recurring-areas.ts');
const mapLocations = load('lib/forth-gps-map-locations.ts');
const siteMatch = load('lib/fleet-location-match.ts');

class ApiError extends Error { constructor(status, message) { super(message); this.status = status; } }
const compile = (file, mocks) => {
  const module = { exports: {} };
  const out = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('require', 'module', 'exports', out)(name => { if (!(name in mocks)) throw Error('unmocked ' + name); return mocks[name]; }, module, module.exports);
  return module.exports;
};
const session = compile('lib/fleet-intelligence-session.ts', { 'server-only': {} });

const registry = [{ id: 'v-a', vehicle_reg: 'AA-1', active: true }, { id: 'v-b', vehicle_reg: 'BB-2', active: true }, { id: 'v-dup1', vehicle_reg: 'DUP-3', active: true }, { id: 'v-dup2', vehicle_reg: 'DUP-3', active: true }, { id: 'v-off', vehicle_reg: 'OFF-4', active: false }];
const stopPoints = (lat, lng, day, startHour, n = 8) => Array.from({ length: n }, (_, i) => ({ timestamp: `${day}T${String(startHour).padStart(2, '0')}:${String(i).padStart(2, '0')}:00+07:00`, latitude: lat, longitude: lng, speedKph: 0 }));
const evidence = (vehicleId, registration, day, points, missing = 0) => ({ ...dayModule.buildProviderDay({ vehicleId, registration, deviceId: 'dev-' + vehicleId, day, capturedAt: '2026-11-04T00:00:00Z', reportRows: [], logRows: [] }), observedPoints: points, reportedPoints: [], journeyLedger: { totals: { missingMinutes: missing } } });

function route(userId, { admin = false, failDirectory = false, failPins = false } = {}) {
  const source = { from: table => {
    const chain = { select: () => chain, order: () => chain, eq: () => chain, in: () => chain, limit: async () => table === 'vehicles' ? { data: registry, error: null } : table === 'ees_location_map_pins' ? (failPins ? { data: null, error: { message: 'denied' } } : { data: [{ location_id: 'loc-1', latitude: 13.7003, longitude: 100.6003 }], error: null }) : { data: [], error: null } };
    if (table === 'ees_locations') chain.in = async () => ({ data: [{ id: 'loc-1', name: 'Confirmed site' }], error: null });
    return chain; } };
  const server = compile('lib/fleet-recurring-server.ts', { 'server-only': {}, '@/lib/fleet-intelligence-session': session,
    './fleet-intelligence-session': session, './fleet-location-evidence': locEvidence, './fleet-stop-intelligence': stopIntel, './fleet-recurring-areas': recurring, './fleet-location-match': siteMatch, './fleet-driver-attribution': load('lib/fleet-driver-attribution.ts'),
    './forth-locations-import-server': { loadBundledForthPinnedLocationsCsv: async () => { if (failDirectory) throw new Error('csv'); return 'csv'; } },
    './forth-gps-map-locations': { ...mapLocations, buildForthGpsMapPayloadFromCsv: () => ({ validation: { status: 'ready' }, locations: [{ id: 'L1', name: 'Forth factory', latitude: 13.7002, longitude: 100.6002, groupLayer: 'Customer', locationType: null }] }) } });
  const mocks = {
    'next/server': { NextResponse: { json: (body, options) => new Response(JSON.stringify(body), options) } },
    '@/lib/admin-user-management-server': { AdminApiError: ApiError },
    '@/lib/fleet-operations-auth': { requireFleetOfficeAccess: async request => { if (request.headers.get('x-denied')) throw new ApiError(Number(request.headers.get('x-denied')), 'Denied'); return { user: { id: userId }, access: { role: admin ? 'admin' : 'office' } }; } },
    '@/lib/authorization': { hasPermission: (access, permission) => permission === 'business:read' || (permission === 'fleet:history_playback' && access.role === 'admin') },
    '@/lib/forth-playback-access': playback, '@/lib/fleet-intelligence': intelligence, '@/lib/fleet-recurring-server': server,
    '@/lib/fleet-evidence-server': { createFleetSourceClient: () => source }
  };
  return compile('app/api/admin/forth-tracking/evidence/recurring/route.ts', mocks);
}
const get = (r, q = 'from=2026-10-01&to=2026-10-31', headers = {}) => r.GET(new Request(`http://localhost/api/x?${q}`, { headers }));
const seed = (userId, reg, id, day, lat = 13.7, lng = 100.6) => session.rememberProviderDay(userId, evidence(id, reg, day, stopPoints(lat, lng, day, 9)));

test('recurring areas come only from this user\'s own cached days and the route never calls Forth', async () => {
  const u = 'user-r1'; seed(u, 'AA-1', 'v-a', '2026-10-05'); seed(u, 'AA-1', 'v-a', '2026-10-12'); seed(u, 'BB-2', 'v-b', '2026-10-12');
  const res = await get(route(u, { admin: true })); assert.equal(res.status, 200); const j = await res.json();
  assert.equal(j.analysis.areas.length, 1); const a = j.analysis.areas[0];
  assert.equal(a.distinctDays, 2); assert.equal(a.visits, 3); assert.deepEqual(a.vehicles, ['AA-1', 'BB-2']); assert.equal(j.vehicleDaysIncluded, 3);
  assert.match(j.note, /Nothing was requested from Forth/);
  const src = fs.readFileSync('app/api/admin/forth-tracking/evidence/recurring/route.ts', 'utf8');
  assert.doesNotMatch(src, /getForth\w+|forth-tracking-server|beginForthHistoryRateLimit/);
});

test('cache isolation: another user sees none of this user\'s days; a third user gets an empty, honest result', async () => {
  seed('user-r2', 'AA-1', 'v-a', '2026-10-05'); seed('user-r2', 'AA-1', 'v-a', '2026-10-06');
  const own = await (await get(route('user-r2', { admin: true }))).json(); assert.equal(own.vehicleDaysIncluded, 2);
  const other = await (await get(route('user-r3', { admin: true }))).json(); assert.equal(other.vehicleDaysIncluded, 0); assert.equal(other.analysis.areas.length, 0); assert.equal(other.analysis.sample.visitsAnalysed, 0);
  assert.ok(other.analysis.limits.some(l => /already read in this session/.test(l)));
});

test('authorisation: an ordinary office account gets 403 and no data, an unauthenticated one gets 401, an authorised admin gets 200', async () => {
  seed('user-r4', 'AA-1', 'v-a', '2026-10-05');
  const office = await get(route('user-r4', { admin: false })); assert.equal(office.status, 403); const text = await office.text(); assert.doesNotMatch(text, /areas|centroid|latitude|AA-1/);
  assert.equal((await get(route('user-r4'), undefined, { 'x-denied': '401' })).status, 401); assert.equal((await get(route('user-r4'), undefined, { 'x-denied': '403' })).status, 403);
  assert.equal((await get(route('user-r4', { admin: true }))).status, 200);
});

test('no raw positions in the response: only area summaries; observed timestamps of points and the position arrays are absent', async () => {
  const u = 'user-r5'; seed(u, 'AA-1', 'v-a', '2026-10-05', 13.7123456, 100.6123456); seed(u, 'AA-1', 'v-a', '2026-10-06', 13.7123456, 100.6123456);
  const text = await (await get(route(u, { admin: true }))).text();
  assert.doesNotMatch(text, /observedPoints|reportedPoints|speedKph|"positions"/); const j = JSON.parse(text);
  assert.ok(Object.keys(j.analysis.areas[0]).every(k => !/points|positions|raw/i.test(k))); assert.ok(j.analysis.areas[0].visitList.length <= 12);
});

test('bounds: invalid, reversed, future and over-long ranges are rejected before any read', async () => {
  const r = route('user-r6', { admin: true });
  for (const q of ['from=x&to=y', 'from=2026-10-10&to=2026-10-01', 'from=2026-01-01&to=2026-10-31', 'from=2026-10-01&to=2099-01-01', 'from=2026-10-01&to=2026-10-05&vehicleId=' + 'x'.repeat(90), '']) assert.equal((await get(r, q)).status, 400, q);
  assert.equal((await get(r, 'from=2026-10-01&to=2026-10-31')).status, 200, '31 days is the limit');
});

test('registry integrity: duplicate-registration and inactive records are never analysed', async () => {
  const u = 'user-r7'; session.rememberProviderDay(u, evidence('v-dup1', 'DUP-3', '2026-10-05', stopPoints(13.8, 100.7, '2026-10-05', 9))); session.rememberProviderDay(u, evidence('v-off', 'OFF-4', '2026-10-05', stopPoints(13.9, 100.8, '2026-10-05', 9))); seed(u, 'AA-1', 'v-a', '2026-10-05');
  const j = await (await get(route(u, { admin: true }))).json(); assert.equal(j.vehiclesConsidered, 2); assert.deepEqual(j.analysis.areas.flatMap(a => a.vehicles), ['AA-1']);
  const only = await (await get(route(u, { admin: true }), 'from=2026-10-01&to=2026-10-31&vehicleId=v-a')).json(); assert.equal(only.vehiclesConsidered, 1);
});

test('directory matching is read-only and optional: a failing directory or pin source never blocks the analysis', async () => {
  const u = 'user-r8'; seed(u, 'AA-1', 'v-a', '2026-10-05'); seed(u, 'AA-1', 'v-a', '2026-10-06');
  const ok = await (await get(route(u, { admin: true }))).json(); const a = ok.analysis.areas[0];
  assert.ok(a.matches.length >= 2); assert.ok(a.matches.some(m => m.source === 'forth_saved_location')); assert.ok(a.matches.some(m => m.source === 'office_confirmed_pin')); assert.equal(a.placeHint, 'multiple_plausible'); assert.equal(ok.directory.forthSavedLocations, 1);
  const noDir = await (await get(route(u, { admin: true, failDirectory: true, failPins: true }))).json(); assert.equal(noDir.analysis.areas[0].placeHint, 'no_match'); assert.equal(noDir.directory.forthSavedLocations, null); assert.equal(noDir.directory.officeConfirmedPins, null);
});

test('missing tracking carried through: a day with unknown tracking minutes is reported on the area, and stays are not extended', async () => {
  const u = 'user-r9'; session.rememberProviderDay(u, evidence('v-a', 'AA-1', '2026-10-05', stopPoints(13.7, 100.6, '2026-10-05', 9), 180)); seed(u, 'AA-1', 'v-a', '2026-10-06');
  const a = (await (await get(route(u, { admin: true }))).json()).analysis.areas[0]; assert.equal(a.daysWithKnownMissingTracking, 1); assert.ok(a.stayMinutes.longestSupported <= 8, 'an 8-minute observed stop stays an 8-minute stop');
});

test('the endpoint is a read-only GET and the source client refuses writes', () => {
  const src = fs.readFileSync('app/api/admin/forth-tracking/evidence/recurring/route.ts', 'utf8');
  assert.match(src, /export async function GET/); assert.doesNotMatch(src, /export async function (POST|PUT|PATCH|DELETE)/); assert.doesNotMatch(src, /\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(/); assert.match(src, /"Cache-Control": "private, no-store"/);
  assert.match(fs.readFileSync('lib/fleet-evidence-server.ts', 'utf8'), /read_only_source/);
});
