const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const { load } = require('../scripts/fleet-real-day-validation.cjs');
class ApiError extends Error { constructor(status, message) { super(message); this.status = status; } }
function route({ denied = 0, missingVehicle = false, dayFails = false, mileageFails = false } = {}) {
  const calls = [];
  const source = { checkpoints: [{ id: 'fuel-1', source: 'fuel_logs', observationDate: '2026-11-03', odometerKm: 100, raw: { private: 'omit' } }], completeSourceRead: true };
  const mocks = {
    'next/server': { NextResponse: { json: (body, options) => new Response(JSON.stringify(body), options) } },
    '@supabase/supabase-js': { createClient: (_url, _key, config) => { calls.push({ config }); return { from(table) { calls.push({ table }); return { select: () => ({ eq: () => ({ single: async () => ({ data: missingVehicle ? null : { id: 'v', vehicle_reg: 'EES-1' }, error: null }) }) }) }; } }; } },
    '@/lib/admin-user-management-server': { AdminApiError: ApiError, getBearerToken: () => 'request-token' },
    '@/lib/fleet-operations-auth': { requireFleetOfficeAccess: async () => { if (denied) throw new ApiError(denied, 'Denied'); return { user: { id: 'office-user' }, access: { userId: 'office-user', role: 'admin', status: 'active' } }; } },
    '@/lib/authorization': load('lib/authorization.ts'), '@/lib/forth-playback-access': load('lib/forth-playback-access.ts'),
    '@/lib/fleet-intelligence-session': { recalledProviderDay: () => null },
    '@/lib/fleet-intelligence-day': load('lib/fleet-intelligence-day.ts'),
    '@/lib/fleet-job-movement': load('lib/fleet-job-movement.ts'),
    '@/lib/fleet-location-priority': load('lib/fleet-location-priority.ts'),
    '@/lib/fleet-intelligence': load('lib/fleet-intelligence.ts'),
    '@/lib/fleet-intelligence-mileage': { checkpointIntervals: () => [] },
    '@/lib/fleet-evidence-view': load('lib/fleet-evidence-view.ts'),
    '@/lib/fleet-intelligence-ees-source': {
      readEesBookingRange: async () => [],
      readEesFleetDay: async scope => { calls.push({ day: scope }); if (dayFails) throw Error('ees_snapshot_unavailable'); return { bookings: [] }; },
      readEesMileageEvidence: async scope => { calls.push({ mileage: scope }); if (mileageFails) throw Error('mileage_snapshot_unavailable'); return source; }
    }
  };
  const module = { exports: {} };
  const compiled = ts.transpileModule(fs.readFileSync('app/api/admin/forth-tracking/evidence/route.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('require', 'module', 'exports', 'process', compiled)(name => { if (!(name in mocks)) throw Error(name); return mocks[name]; }, module, module.exports, { env: { NEXT_PUBLIC_SUPABASE_URL: 'https://example.invalid', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'public-test-key' } });
  return { GET: module.exports.GET, calls };
}
const request = (query = 'vehicleId=v&from=2026-11-01&to=2026-11-03') => new Request(`http://localhost/api/admin/forth-tracking/evidence?${query}`);

test('evidence rejects unauthenticated and unauthorized callers before reading sources', async () => {
  for (const denied of [401, 403]) { const r = route({ denied }); assert.equal((await r.GET(request())).status, denied); assert.equal(r.calls.length, 0); }
});
test('evidence rejects malformed, reversed and oversized periods before source reads', async () => {
  for (const query of ['vehicleId=v&from=2026-02-30&to=2026-03-01', 'vehicleId=v&from=2026-11-04&to=2026-11-03', 'vehicleId=v&from=2026-01-01&to=2026-11-03']) {
    const r = route(); assert.equal((await r.GET(request(query))).status, 400); assert.equal(r.calls.length, 0);
  }
});
test('evidence resolves registration on server, keeps user authorization and strips raw checkpoints', async () => {
  const r = route(); const response = await r.GET(request('vehicleId=v&from=2026-11-01&to=2026-11-03&registration=ATTACKER'));
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'private, no-store');
  const body = await response.json(); assert.equal(body.registration, 'EES-1'); assert.equal(body.mileage.checkpoints[0].raw, undefined);
  assert.deepEqual(r.calls.find(c => c.mileage).mileage.registrations, ['EES-1']);
  const config = r.calls.find(c => c.config).config; assert.equal(config.global.headers.Authorization, 'Bearer request-token');
  assert.throws(() => config.global.fetch('https://example.invalid', { method: 'POST' }), /read_only_source/);
});
test('partial source failures remain null while the other source survives', async () => {
  for (const option of ['dayFails', 'mileageFails']) {
    const response = await route({ [option]: true }).GET(request()); const body = await response.json();
    assert.equal(body[option === 'dayFails' ? 'day' : 'mileage'], null);
    assert.notEqual(body[option === 'dayFails' ? 'mileage' : 'day'], null);
  }
});
test('unknown vehicle identities cannot reach evidence adapters', async () => {
  const r = route({ missingVehicle: true }); assert.equal((await r.GET(request())).status, 404); assert.equal(r.calls.some(c => c.day || c.mileage), false);
});
