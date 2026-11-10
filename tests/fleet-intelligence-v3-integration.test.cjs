const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const { load } = require('../scripts/fleet-real-day-validation.cjs');
const view = load('lib/fleet-evidence-view.ts');
const dayModule = load('lib/fleet-intelligence-day.ts');
const { buildProviderDay, suggestDayJobs, dayAttribution } = dayModule;
const day = '2026-11-03';
const seg = (start, end, km, routing = '01:00:00') => ({ boxId: 'box', plateNo: 'REG', rDate: day, startTime: start, endTime: end, sumDistance: km, routingTime: routing });
const providerInput = (rows) => ({ vehicleId: 'v', registration: 'REG', deviceId: 'box', day, capturedAt: '2026-11-04T00:00:00Z', reportRows: rows, logRows: [] });

test('fuel purchases are grouped by recorded type and litres are never combined across types', () => {
  const groups = view.purchasesByFuelType([{ fuelType: 'Diesel', purchasedLitres: 54.1, costThb: 2260 }, { fuelType: 'diesel ', purchasedLitres: 39.7, costThb: 595.1 }, { fuelType: 'LPG', purchasedLitres: 20, costThb: 300 }, { fuelType: null, purchasedLitres: 5, costThb: 10 }]);
  assert.deepEqual(groups.map(g => g.fuelType), ['diesel', 'lpg', 'unrecorded']);
  assert.equal(Math.round(groups[0].purchasedLitres * 100), 9380);
  assert.equal(view.singleFuelTypeLitres(groups), null);
  assert.equal(Math.round(view.singleFuelTypeLitres(groups.slice(0, 1)) * 100), 9380);
  assert.equal(view.singleFuelTypeLitres([{ fuelType: 'unrecorded', records: 1, purchasedLitres: 5, costThb: 1 }]), null);
  assert.equal(view.singleFuelTypeLitres([]), 0);
  assert.equal(view.purchasesByFuelType(null), null);
  assert.equal(view.purchasesByFuelType([{ fuelType: 'diesel', purchasedLitres: null, costThb: 5 }])[0].purchasedLitres, null);
});

test('checkpoint spans stay within one source and are withheld when any interval is unknown', () => {
  const iv = (source, from, to, value, reviewRequired = true) => ({ source, from, to, metric: { value }, reviewRequired });
  const span = view.checkpointSpan([iv('fuel_logs', '2026-11-01', '2026-11-02', 100), iv('fuel_logs', '2026-11-02', '2026-11-03', 50), iv('weekly_mileage', '2026-11-01', '2026-11-08', 999)], 'fuel_logs');
  assert.deepEqual(span, { km: 150, intervals: 2, from: '2026-11-01', to: '2026-11-03', reviewRequired: true });
  assert.equal(view.checkpointSpan([iv('fuel_logs', 'a', 'b', 10), iv('fuel_logs', 'b', 'c', null)], 'fuel_logs'), null);
  assert.equal(view.checkpointSpan([], 'fuel_logs'), null);
  assert.equal(view.checkpointSpan(null, 'weekly_mileage'), null);
});

test('provider segments keep routingTime as a label and give job context without score', () => {
  const evidence = buildProviderDay(providerInput([seg('08:00:00', '09:00:00', '10.00', '01:00:00'), seg('10:00:00', '-', '0.00', 'bad'), { boxId: '', plateNo: 'Total', sumDistance: '10.00' }]));
  assert.equal(evidence.provider.segments[0].routingTime, '01:00:00');
  assert.equal(evidence.provider.segments[1].routingTime, null);
  assert.equal(evidence.provider.segments[0].raw, undefined);
  const job = { id: 'j', booking_date: day, vehicle_id: 'v', vehicle_registration: 'REG', pickup_time: '08:30', job_order_number: 'WO', pickup_lat: null, pickup_lng: null, dropoff_lat: null, dropoff_lng: null };
  const [suggestion] = suggestDayJobs('v', 'REG', day, [job], evidence);
  assert.ok(suggestion.reasons.includes('scheduled_pickup_within_provider_segment'));
  assert.equal(suggestion.score, 40);
  assert.equal(suggestion.status, 'confirmation_required');
  assert.equal(suggestion.allocatedKm, null);
  const [outside] = suggestDayJobs('v', 'REG', day, [{ ...job, pickup_time: '12:00' }], evidence);
  assert.equal(outside.reasons.includes('scheduled_pickup_within_provider_segment'), false);
  const failed = buildProviderDay(providerInput([seg('08:00:00', '09:00:00', '10.00'), { boxId: '', plateNo: 'Total', sumDistance: '99.00' }]));
  assert.equal(suggestDayJobs('v', 'REG', day, [job], failed)[0].reasons.includes('scheduled_pickup_within_provider_segment'), false);
});

test('day attribution never confirms jobs and keeps reconciled provider km unattributed', () => {
  const evidence = buildProviderDay(providerInput([seg('08:00:00', '09:00:00', '12.30'), { boxId: '', plateNo: 'Total', sumDistance: '12.30' }]));
  const jobs = suggestDayJobs('v', 'REG', day, [{ id: 'j', booking_date: day, vehicle_id: 'v', pickup_time: '08:30' }], evidence);
  assert.deepEqual(dayAttribution(evidence, jobs), { providerKm: 12.3, confirmedAssignments: 0, confirmedJobKm: null, unconfirmedSuggestions: 1, unattributedProviderKm: 12.3, confirmationStore: 'not_available' });
  assert.equal(dayAttribution(null, null).providerKm, null);
  assert.equal(dayAttribution(null, null).unconfirmedSuggestions, null);
  const failed = buildProviderDay(providerInput([seg('08:00:00', '09:00:00', '12.30'), { boxId: '', plateNo: 'Total', sumDistance: '50' }]));
  assert.equal(dayAttribution(failed, []).unattributedProviderKm, null);
});

class ApiError extends Error { constructor(status, message) { super(message); this.status = status; } }
function fleetRoute({ recalled = () => null, fuelRows = [], fuelError = null, vehicles = [{ id: 'a', vehicle_reg: 'AA-1' }, { id: 'b', vehicle_reg: 'BB-2' }], denied = 0 } = {}) {
  const calls = [];
  const query = (table) => {
    const result = table === 'vehicles' ? { data: vehicles, error: null } : { data: fuelError ? null : fuelRows, error: fuelError };
    const chain = { select: () => chain, eq: (...a) => { calls.push({ table, eq: a }); return chain; }, order: () => chain, limit: async () => result };
    return chain;
  };
  const mocks = {
    'next/server': { NextResponse: { json: (body, options) => new Response(JSON.stringify(body), options) } },
    '@/lib/admin-user-management-server': { AdminApiError: ApiError },
    '@/lib/fleet-operations-auth': { requireFleetOfficeAccess: async () => { if (denied) throw new ApiError(denied, 'Denied'); return { user: { id: 'office' } }; } },
    '@/lib/fleet-evidence-server': { createFleetSourceClient: () => { calls.push('client'); return { from: table => { calls.push({ table }); return query(table); } }; } },
    '@/lib/fleet-intelligence-session': { recalledProviderDay: recalled },
    '@/lib/fleet-intelligence-day': dayModule,
    '@/lib/fleet-intelligence': load('lib/fleet-intelligence.ts'),
    '@/lib/fleet-evidence-view': view,
    // V6.1: per-vehicle insights are gated by the same server-side journey authorisation (default here: not authorised).
    '@/lib/authorization': { hasPermission: () => false },
    '@/lib/forth-playback-access': load('lib/forth-playback-access.ts'),
    '@/lib/fleet-day-insights': load('lib/fleet-day-insights.ts')
  };
  const module = { exports: {} };
  const compiled = ts.transpileModule(fs.readFileSync('app/api/admin/forth-tracking/evidence/fleet/route.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('require', 'module', 'exports', compiled)(name => { if (!(name in mocks)) throw Error(name); return mocks[name]; }, module, module.exports);
  return { GET: module.exports.GET, calls };
}
const fleetRequest = (d = day) => new Request(`http://localhost/api/admin/forth-tracking/evidence/fleet?day=${d}`);

test('fleet report rejects unauthorized, malformed and future dates before source reads', async () => {
  for (const denied of [401, 403]) { const r = fleetRoute({ denied }); assert.equal((await r.GET(fleetRequest())).status, denied); assert.equal(r.calls.length, 0); }
  for (const bad of ['2026-02-30', 'x', '2099-01-01']) { const r = fleetRoute(); assert.equal((await r.GET(fleetRequest(bad))).status, 400); assert.equal(r.calls.length, 0); }
});

test('fleet report keeps fuel types separate, counts unknown vehicles and withholds incomplete fleet km', async () => {
  const evidence = buildProviderDay({ ...providerInput([{ ...seg('08:00:00', '09:00:00', '12.30'), plateNo: 'AA-1' }, { boxId: '', plateNo: 'Total', sumDistance: '12.30' }]), vehicleId: 'a', registration: 'AA-1' });
  const fuelRows = [{ id: 1, vehicle_reg: 'AA 1', litres: 50, total_cost: 1500, fuel_type: 'diesel' }, { id: 2, vehicle_reg: 'AA-1', litres: '20.5', total_cost: 300, fuel_type: 'LPG' }, { id: 3, vehicle_reg: 'ZZ-9', litres: 10, total_cost: 100, fuel_type: 'diesel' }];
  const r = fleetRoute({ fuelRows, recalled: (_u, id) => id === 'a' ? evidence : null });
  const response = await r.GET(fleetRequest()); assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  const body = await response.json();
  const a = body.rows.find(row => row.vehicleId === 'a'), b = body.rows.find(row => row.vehicleId === 'b');
  assert.equal(a.metric.value, 12.3); assert.equal(a.purchasedLitres, null); assert.equal(a.fuelExplanation, 'mixed_fuel_types'); assert.equal(a.purchaseCostThb, 1800);
  assert.deepEqual(a.fuelByType.map(g => [g.fuelType, g.purchasedLitres]), [['diesel', 50], ['lpg', 20.5]]);
  assert.equal(b.metric, null); assert.equal(b.explanation, 'not_read_in_this_session'); assert.equal(b.purchasedLitres, 0); assert.equal(b.fuelExplanation, 'no_purchases_recorded');
  assert.equal(body.summary.totalKm, null); assert.equal(body.summary.reportedVehicles, 1); assert.equal(body.summary.vehiclesWithUsableRecords, 1); assert.equal(body.summary.vehiclesWithoutRecords, 1);
  assert.equal(body.fuel.matchedRecords, 2); assert.equal(body.fuel.unmatchedRecords, 1); assert.equal(body.fuel.vehiclesWithPurchases, 1);
  assert.deepEqual(body.fuel.byType.map(g => g.fuelType), ['diesel', 'lpg']);
});

test('fleet report never turns an unavailable Fuel Log source or duplicate registration into zero', async () => {
  const unavailable = await (await fleetRoute({ fuelError: { code: '42501' } }).GET(fleetRequest())).json();
  assert.equal(unavailable.fuel, null); assert.equal(unavailable.rows[0].purchasedLitres, null); assert.equal(unavailable.rows[0].fuelExplanation, 'fuel_source_unavailable');
  const duplicate = await (await fleetRoute({ vehicles: [{ id: 'a', vehicle_reg: 'AA-1' }, { id: 'c', vehicle_reg: 'AA 1' }], fuelRows: [{ id: 1, vehicle_reg: 'AA-1', litres: 5, total_cost: 5, fuel_type: 'diesel' }] }).GET(fleetRequest())).json();
  assert.ok(duplicate.rows.every(row => row.purchasedLitres === null && row.fuelExplanation === 'registration_not_unique'));
  assert.equal(duplicate.fuel.unmatchedRecords, 1);
});
