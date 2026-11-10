const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const { load } = require('../scripts/fleet-real-day-validation.cjs');
class ApiError extends Error { constructor(status, message) { super(message); this.status = status; } }
const DAY = '2026-10-26';
const at = hms => new Date(Date.parse(`${DAY}T${hms}+07:00`)).toISOString();
const north = (m) => 13.112 + m / 111_000;
const pts = [{ t: '09:58:00', m: 6000, s: 60 }, ...[0, 1, 2, 3].map(i => ({ t: `10:${10 + i}:00`, m: 170 + i * 3, s: 0 })), { t: '10:14:00', m: 6000, s: 60 }].map(p => ({ timestamp: at(p.t), latitude: north(p.m), longitude: 100.982, speedKph: p.s }));
const providerDay = { gps: { observations: pts.length, verifiedObservations: pts.length }, observedPoints: pts, reportedPoints: [] };

function route({ role = 'admin', denied = 0, cached = providerDay, missingVehicle = false } = {}) {
  const calls = { recall: [], tables: [], writes: 0 };
  const mocks = {
    'next/server': { NextResponse: { json: (body, options) => new Response(JSON.stringify(body), options) } },
    '@/lib/admin-user-management-server': { AdminApiError: ApiError },
    '@/lib/fleet-operations-auth': { requireFleetOfficeAccess: async () => { if (denied) throw new ApiError(denied, 'Denied'); return { user: { id: 'user-1' }, access: { userId: 'user-1', role, status: 'active' } }; } },
    '@/lib/authorization': load('lib/authorization.ts'), '@/lib/forth-playback-access': load('lib/forth-playback-access.ts'),
    '@/lib/fleet-evidence-server': { createFleetSourceClient: () => ({ from(table) { calls.tables.push(table); return { select: () => ({ eq: () => ({ single: async () => ({ data: missingVehicle ? null : { id: 'veh-1', vehicle_reg: 'EES-1' }, error: null }) }) }), insert: () => { calls.writes++; }, update: () => { calls.writes++; }, upsert: () => { calls.writes++; } }; } }) },
    '@/lib/fleet-intelligence': load('lib/fleet-intelligence.ts'),
    '@/lib/fleet-intelligence-session': { recalledProviderDay: (...args) => { calls.recall.push(args); return cached; } },
    '@/lib/fleet-location-evidence': load('lib/fleet-location-evidence.ts')
  };
  const module = { exports: {} };
  const compiled = ts.transpileModule(fs.readFileSync('app/api/admin/forth-tracking/evidence/location-stops/route.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('require', 'module', 'exports', 'process', compiled)(name => { if (!(name in mocks)) throw Error(name); return mocks[name]; }, module, module.exports, { env: {} });
  return { POST: module.exports.POST, calls };
}
const post = (body, url = 'http://localhost/api/admin/forth-tracking/evidence/location-stops') => new Request(url, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers: { 'content-type': 'application/json' } });
const good = { vehicleId: 'veh-1', day: DAY, anchor: { latitude: 13.112, longitude: 100.982 } };

test('unauthenticated callers are refused before anything is read', async () => {
  for (const denied of [401, 403]) { const r = route({ denied }); assert.equal((await r.POST(post(good))).status, denied); assert.equal(r.calls.recall.length + r.calls.tables.length, 0); }
});

test('an office account without historical-journey authorisation gets 403, no data and no cache or vehicle read', async () => {
  const r = route({ role: 'office_staff' }); const response = await r.POST(post(good));
  assert.equal(response.status, 403); const text = await response.text();
  assert.match(text, /needs administrator authorisation/); assert.doesNotMatch(text, /latitude|longitude|13\.1|100\.98/);
  assert.equal(r.calls.recall.length, 0); assert.equal(r.calls.tables.length, 0);
});

test('an unread vehicle-day reports not read yet, with no coordinates and no Forth request', async () => {
  const r = route({ cached: null }); const response = await r.POST(post(good)); const body = await response.json();
  assert.equal(response.status, 200); assert.equal(body.status, 'day_not_read'); assert.doesNotMatch(JSON.stringify(body), /latitude|longitude/);
});

test('an authorised caller gets bounded candidate stops from the cached day, scoped to their own user id, with nothing written', async () => {
  const r = route(); const response = await r.POST(post(good)); const body = await response.json();
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(body.status, 'ready'); assert.equal(body.saved, false); assert.equal(body.evidence.mode, 'near_anchor'); assert.equal(body.evidence.stops.length, 1);
  assert.ok(body.evidence.stops[0].distanceFromAnchorM >= 160 && body.evidence.stops[0].distanceFromAnchorM <= 190);
  assert.equal(body.evidence.stops[0].sourceQuality, 'verified_gps');
  assert.deepEqual(r.calls.recall[0], ['user-1', 'veh-1', 'EES-1', DAY], 'the cache is read only for this user, vehicle and day');
  assert.equal(r.calls.writes, 0); assert.deepEqual([...new Set(r.calls.tables)], ['vehicles']);
});

test('a site with no pin gets the day list; an anchor in the URL is ignored; malformed input is rejected before any read', async () => {
  const r = route(); const body = await (await r.POST(post({ vehicleId: 'veh-1', day: DAY }, 'http://localhost/x?anchor=13.1,100.9&latitude=13.1'))).json();
  assert.equal(body.evidence.mode, 'whole_day'); assert.equal(body.evidence.anchorProvided, false);
  for (const bad of [{ day: DAY }, { vehicleId: 'v', day: '2026-02-30' }, { vehicleId: 'v', day: '2099-01-01' }, 'not json']) { const x = route(); assert.equal((await x.POST(post(bad))).status, 400); assert.equal(x.calls.recall.length + x.calls.tables.length, 0); }
  assert.equal((await route({ missingVehicle: true }).POST(post(good))).status, 404);
});

test('edge-of-day stops are labelled as the edge of the data, and only a real gap is called a gap', () => {
  const ev = load('lib/fleet-location-evidence.ts');
  const o = (t, m, s) => ({ timestamp: at(t), latitude: north(m), longitude: 100.982, speedKph: s, verified: true });
  const startOfDay = [0, 1, 2].map(i => o(`00:0${i}:00`, 0, 0)).concat([o('00:05:00', 6000, 60)]);
  const a = ev.buildLocationEvidence({ observations: startOfDay }).stops[0];
  assert.ok(a.notes.includes('at_edge_of_day_data')); assert.ok(!a.notes.includes('next_to_telemetry_gap')); assert.equal(a.nextToTelemetryGap, false);
  const gap = [o('09:00:00', 6000, 60), ...[0, 1, 2].map(i => o(`10:0${i}:00`, 0, 0)), o('10:05:00', 6000, 60)];
  const g = ev.buildLocationEvidence({ observations: gap }).stops[0];
  assert.ok(g.notes.includes('next_to_telemetry_gap')); assert.equal(g.nextToTelemetryGap, true); assert.ok(!g.notes.includes('at_edge_of_day_data'));
});

test('marker clicks focus the matching list entry and the panel reports positions used, not a verified total', () => {
  const read = f => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
  const panel = read('components/location-evidence-panel.tsx'), map = read('components/locations-map.tsx'), dir = read('components/locations-directory.tsx');
  assert.match(map, /\.on\("click", \(\) => onEvidenceMarkerClick\?\.\(m\.id\)\)/); // V6.5: the click handler also recognises the fleet suggestion marker; every other (Stage B) marker still focuses its list entry.
  assert.match(dir, /onEvidenceMarkerClick=\{\(id\) => \{ if \(id === FLEET_SUGGESTION_MARKER_ID\) setFleetFocusTick\(\(tick\) => tick \+ 1\); else setFocusedEvidenceId\(id\); \}\}/); assert.match(dir, /focusId=\{focusedEvidenceId\}/);
  assert.match(panel, /data-focused/); assert.match(panel, /positions used/); assert.match(panel, /recorded/);
});
