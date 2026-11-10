const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const { load } = require('../scripts/fleet-real-day-validation.cjs');
const report = load('lib/fleet-mileage-report.ts');
const fuel = load('lib/fleet-fuel-view.ts');
const dayMod = load('lib/fleet-intelligence-day.ts');
const range = { from: '2026-11-01', to: '2026-11-03' };
const registry = [{ id: 'a', vehicle_reg: 'AA-1', active: true }, { id: 'b', vehicle_reg: 'BB-2', active: true }, { id: 'c', vehicle_reg: 'CC-3', active: true }];
const fuelRow = (id, date, reg, odometer, extra = {}) => ({ id, date, vehicle_reg: reg, litres: 50, total_cost: 2000, fuel_type: 'diesel', odometer, created_at: `${date}T03:00:00Z`, ...extra });
const weeklyRow = (id, date, reg, km, extra = {}) => ({ id, week_ending: date, vehicle_reg: reg, odometer_reading: km, created_at: `${date}T05:00:00Z`, ...extra });
const pday = (day, km, o = {}) => ({ day, km, reconciled: true, complete: true, gpsKm: null, segments: 3, ...o });
const run = (o = {}) => report.buildMileageReport({ registry, range, fuel: [], weekly: [], bookings: [], providerDays: new Map(), live: null, ...o });
const veh = (r, id) => r.vehicles.find(v => v.vehicleId === id);
const kinds = (r, id) => r.exceptions.filter(e => e.vehicleId === id).map(e => e.kind);

test('1/2: valid provider segments reconcile; duplicate and overlapping report rows are never double counted', () => {
  const row = (s, e, km) => ({ boxId: 'box', plateNo: 'AA-1', rDate: '2026-11-03', startTime: s, endTime: e, sumDistance: km, routingTime: '01:00:00' });
  const total = km => ({ boxId: '', plateNo: 'Total', sumDistance: km });
  const make = rows => dayMod.buildProviderDay({ vehicleId: 'a', registration: 'AA-1', deviceId: 'box', day: '2026-11-03', capturedAt: '2026-11-04T00:00:00Z', reportRows: rows, logRows: [] });
  const ok = make([row('08:00:00', '09:00:00', '10.50'), row('10:00:00', '11:00:00', '4.25'), total('14.75')]);
  assert.equal(ok.sources.providerReported.value, 14.75); assert.equal(ok.provider.arithmetic.status, 'pass');
  const dup = make([row('08:00:00', '09:00:00', '10.50'), row('08:00:00', '09:00:00', '10.50'), total('10.50')]);
  assert.equal(dup.sources.providerReported.value, 10.5); assert.equal(dup.provider.duplicates, 1);
  const overlap = make([row('08:00:00', '10:00:00', '10.50'), row('09:00:00', '11:00:00', '4.25'), total('14.75')]);
  assert.equal(overlap.sources.providerReported.value, null); assert.ok(overlap.provider.issues.includes('overlapping_segments'));
});

test('3: missing GPS stays unknown and no total ever treats unknown as zero', () => {
  const r = run({ providerDays: new Map([['a', [pday('2026-11-01', 100), pday('2026-11-02', 50), pday('2026-11-03', 25)]]]) });
  assert.equal(r.totals.gpsDerivedKm, null); assert.equal(veh(r, 'a').provider.gpsKm, null);
  assert.equal(veh(r, 'b').provider.km, null); assert.equal(veh(r, 'b').provider.coverage, 'none');
  assert.equal(r.totals.providerKmPartial, 175); assert.equal(r.totals.providerContributingVehicles, 1);
  assert.equal(r.totals.providerKmFleet, null);                       // 2 of 3 vehicles unknown: never called the fleet total
});

test('4: no bookings is "no bookings found", not a work claim; unavailable source is null; unmatched jobs are flagged', () => {
  assert.equal(run({ bookings: [] }).totals.bookingsInRange, 0); assert.equal(run({ bookings: null }).totals.bookingsInRange, null);
  const r = run({ bookings: [{ id: 1, booking_date: '2026-11-02', vehicle_registration: 'AA 1' }, { id: 2, booking_date: '2026-11-02', vehicle_registration: 'ZZ-9', job_order_number: 'WO-9' }, { id: 3, booking_date: '2026-10-01', vehicle_registration: 'ZZ-9' }] });
  assert.equal(r.totals.bookingsInRange, 2); assert.equal(r.totals.unmatchedBookings, 1);
  const e = r.exceptions.find(x => x.kind === 'unmatched_booking_job'); assert.ok(e.evidence.includes('work_order:WO-9'));
  assert.equal(r.jobs.length, 2); assert.ok(r.jobs.every(j => j.status === 'unconfirmed' && j.allocatedKm === null));   // jobs never carry kilometres here
  assert.equal(r.jobs.find(j => j.id === '1').vehicleId, 'a'); assert.equal(r.jobs.find(j => j.id === '2').vehicleId, null);
});

test('5/6: purchased litres never become consumption; repeated odometers give flags, never efficiency', () => {
  const r = run({ fuel: [fuelRow(1, '2026-11-03', 'AA-1', 615524, { litres: 54.1 }), fuelRow(2, '2026-11-03', 'AA-1', 615524, { litres: 39.7 })] });
  const v = veh(r, 'a'); assert.equal(Math.round(v.fuel.litres * 100), 9380);
  assert.equal(v.fuelOdometer.repeated, 1); assert.equal(v.fuelOdometer.spanKm, null);   // same-day date-only readings overlap: no distance is claimed, not even 0 km
  assert.equal(v.fuelOdometer.intervals, 0);                 // identical same-day readings collapse into one checkpoint: no interval exists
  assert.ok(!JSON.stringify(r).match(/kmPerLitre|consumed_litres|efficiency/i));   // 'purchased_not_consumed' is a disclaimer label, not a consumption figure
  assert.ok(kinds(r, 'a').includes('repeated_odometer'));
});

test('7: weekly readings without a baseline flag stay unknown (no invented increments)', () => {
  const r = run({ weekly: [weeklyRow(1, '2026-11-01', 'AA-1', 1000), weeklyRow(2, '2026-11-03', 'AA-1', 1400)] });
  const w = veh(r, 'a').weeklyOdometer; assert.equal(w.withKm, 2); assert.equal(w.baselineUnknown, 2); assert.equal(w.spanKm, null); assert.equal(w.latest.km, 1400);
  const known = run({ weekly: [weeklyRow(1, '2026-11-01', 'AA-1', 1000, { is_odometer_baseline: false }), weeklyRow(2, '2026-11-03', 'AA-1', 1400, { is_odometer_baseline: false })] });
  assert.equal(veh(known, 'a').weeklyOdometer.spanKm, 400);         // date-only readings: still review-required, never complete
  assert.ok(kinds(run({ weekly: [weeklyRow(1, '2026-11-01', 'AA-1', 900, { is_odometer_baseline: false }), weeklyRow(2, '2026-11-03', 'AA-1', 800, { is_odometer_baseline: false })] }), 'a').includes('odometer_discrepancy'));
});

test('8: registry duplicates cannot duplicate or inflate fleet totals', () => {
  const dup = [...registry, { id: 'd', vehicle_reg: 'AA 1', active: true }];
  const r = run({ registry: dup, fuel: [fuelRow(1, '2026-11-02', 'AA-1', 1000)], providerDays: new Map([['a', [pday('2026-11-01', 10)]], ['d', [pday('2026-11-01', 10)]]]) });
  assert.equal(r.totals.excludedDuplicates, 2); assert.equal(r.totals.providerKmPartial, null);
  assert.equal(r.totals.fuelRecords, 0); assert.equal(veh(r, 'a').fuel, null); assert.equal(veh(r, 'd').fuelOdometer, null);
  assert.ok(kinds(r, 'a').includes('duplicate_registration_mapping') && kinds(r, 'd').includes('duplicate_registration_mapping'));
  const ids = r.vehicles.map(v => v.vehicleId); assert.equal(new Set(ids).size, ids.length);
});

test('9: incompatible observation periods are never compared as equivalent', () => {
  const r = run({ fuel: [fuelRow(1, '2026-11-01', 'AA-1', 1000), fuelRow(2, '2026-11-03', 'AA-1', 1300)], weekly: [weeklyRow(1, '2026-11-02', 'AA-1', 5000, { is_odometer_baseline: false }), weeklyRow(2, '2026-11-03', 'AA-1', 5200, { is_odometer_baseline: false })],
    providerDays: new Map([['a', [pday('2026-11-01', 100), pday('2026-11-02', 100), pday('2026-11-03', 100)]]]) });
  const c = Object.fromEntries(veh(r, 'a').comparisons.map(x => [x.pair, x]));
  assert.equal(c.provider_vs_fuel_odometer.status, 'incomplete');   // same 3-day span, but odometer observation time is date-only
  assert.equal(c.fuel_vs_weekly_odometer.reason, 'different_observation_periods'); assert.equal(c.fuel_vs_weekly_odometer.differenceKm, null);
  const partial = run({ fuel: [fuelRow(1, '2026-11-01', 'AA-1', 1000), fuelRow(2, '2026-11-03', 'AA-1', 1300)], providerDays: new Map([['a', [pday('2026-11-01', 100)]]]) });
  assert.equal(veh(partial, 'a').comparisons[0].reason, 'missing_distance');
});

test('exceptions: GPS state, missing provider, unusual fuel, odometer review, fleet-level timestamp notes', () => {
  const live = new Map([['AA1', { positionQuality: 'no_gps', timestampStatus: 'stale', lastGpsTimestamp: '2026-11-03T01:00:00Z' }], ['BB2', { positionQuality: 'gps', timestampStatus: 'current', lastGpsTimestamp: null }]]);
  const r = run({ live, fuel: [fuelRow(1, '2026-11-02', 'AA-1', 100, { litres: 72.33, total_cost: 310032 }), fuelRow(2, '2026-11-02', 'AA-1', null, { litres: 0, total_cost: 0 })], weekly: [weeklyRow(1, '2026-11-01', 'AA-1', 10)] });
  assert.ok(kinds(r, 'a').includes('gps_unavailable_or_stale')); assert.ok(!kinds(r, 'b').includes('gps_unavailable_or_stale')); assert.ok(kinds(r, 'c').includes('gps_unavailable_or_stale'));
  assert.equal(r.exceptions.filter(e => e.kind === 'unusual_fuel_purchase').length, 2);
  assert.ok(kinds(r, 'a').includes('provider_distance_missing'));
  const stamps = r.exceptions.filter(e => e.kind === 'missing_observation_timestamp' && e.vehicleId === null); assert.equal(stamps.length, 2);
  assert.ok(r.exceptions.every(e => Array.isArray(e.evidence) && e.detail));
  assert.equal(run({ live: null }).exceptions.some(e => e.kind === 'gps_unavailable_or_stale'), false);   // Forth unavailable: no false GPS claims
});

test('provider exception wording separates unread days from unverified coverage', () => {
  const none = run({}); assert.equal(none.exceptions.find(e => e.kind === 'provider_distance_missing' && e.vehicleId === 'a').detail, 'no_provider_day_read_for_period');
  const some = run({ providerDays: new Map([['a', [pday('2026-11-01', 5, { complete: false })]]]) }); assert.equal(some.exceptions.find(e => e.kind === 'provider_distance_missing' && e.vehicleId === 'a').detail, 'provider_days_reconciled_1_of_3');
  const all = run({ providerDays: new Map([['a', ['2026-11-01', '2026-11-02', '2026-11-03'].map(d => pday(d, 5, { complete: false }))]]) });
  assert.equal(all.exceptions.find(e => e.kind === 'provider_distance_missing' && e.vehicleId === 'a').detail, 'all_days_read_but_full_day_coverage_unverified');
  assert.equal(veh(all, 'a').provider.km, 15); assert.equal(veh(all, 'a').provider.coverage, 'partial'); assert.equal(all.totals.providerKmFleet, null);
  const unreconciled = run({ providerDays: new Map([['a', [pday('2026-11-01', 5, { reconciled: false })]]]) }); assert.equal(veh(unreconciled, 'a').provider.km, null);   // a failed provider reconciliation never contributes km
});

test('inactive vehicles are shown but excluded from fleet aggregates', () => {
  const r = run({ registry: [...registry, { id: 'z', vehicle_reg: '12345', active: false }], providerDays: new Map([['z', [pday('2026-11-01', 500)]]]) });
  assert.equal(r.totals.excludedInactive, 1); assert.equal(r.totals.providerContributingVehicles, 0); assert.equal(r.totals.providerKmPartial, null);
});

class ApiError extends Error { constructor(status, message) { super(message); this.status = status; } }
function route({ denied = 0, fleet = { connectionStatus: 'connected', records: [] }, tableErrors = {} } = {}) {
  const calls = [];
  const client = { from: table => { calls.push(table); const chain = { select: () => chain, gte: () => chain, lte: () => chain, order: () => chain, limit: async () => table === 'vehicles' ? { data: registry, error: null } : tableErrors[table] ? { data: null, error: tableErrors[table] } : { data: [], error: null } }; return chain; } };
  const mocks = { 'next/server': { NextResponse: { json: (b, o) => new Response(JSON.stringify(b), o) } }, '@/lib/admin-user-management-server': { AdminApiError: ApiError },
    '@/lib/fleet-operations-auth': { requireFleetOfficeAccess: async () => { if (denied) throw new ApiError(denied, 'Denied'); return { user: { id: 'u' }, access: { userId: 'u', role: 'admin', status: 'active' } }; } }, '@/lib/fleet-evidence-server': { createFleetSourceClient: () => { calls.push('client'); return client; } },
    '@/lib/forth-tracking-server': { getForthTrackingFleetData: async () => fleet }, '@/lib/fleet-intelligence': load('lib/fleet-intelligence.ts'), '@/lib/fleet-intelligence-session': { recalledProviderDayEntry: () => null }, 'node:crypto': require('node:crypto'),
    '@/lib/fleet-mileage-report': report, '@/lib/fleet-fuel-view': fuel,
    '@/lib/authorization': load('lib/authorization.ts'), '@/lib/forth-playback-access': load('lib/forth-playback-access.ts') };
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync('app/api/admin/forth-tracking/evidence/mileage/route.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('require', 'module', 'exports', code)(n => { if (!(n in mocks)) throw Error(n); return mocks[n]; }, module, module.exports);
  return { GET: module.exports.GET, calls };
}
const req = q => new Request(`http://localhost/api/admin/forth-tracking/evidence/mileage?${q}`);

test('10: auth, date validation and Forth/source failures produce safe, understandable states', async () => {
  for (const denied of [401, 403]) { const r = route({ denied }); assert.equal((await r.GET(req('from=2026-11-01&to=2026-11-03'))).status, denied); assert.equal(r.calls.length, 0); }
  for (const q of ['from=2026-02-30&to=2026-03-01', 'from=2026-11-03&to=2026-11-01', 'from=2026-01-01&to=2026-11-03', 'from=2026-11-01&to=2099-01-01']) { const r = route(); assert.equal((await r.GET(req(q))).status, 400, q); assert.equal(r.calls.length, 0); }
  const down = await (await route({ fleet: { connectionStatus: 'failed', records: [] }, tableErrors: { weekly_mileage: { code: '42501' } } }).GET(req('from=2026-11-01&to=2026-11-03'))).json();
  assert.equal(down.sources.forthFleet, 'unavailable'); assert.equal(down.sources.weeklyMileage, 'unavailable'); assert.equal(down.sources.fuelLogs, 'available');
  assert.equal(down.exceptions.some(e => e.kind === 'gps_unavailable_or_stale'), false); assert.equal(down.vehicles.length, 3);
  assert.ok(down.vehicles.every(v => v.weeklyOdometer.readings === 0));
});

test('11: the report path is read-only and imports no business-record writers', () => {
  const src = ['app/api/admin/forth-tracking/evidence/mileage/route.ts', 'lib/fleet-mileage-report.ts'].map(f => fs.readFileSync(f, 'utf8')).join('\n');
  // No database write calls (the hash .update() used for a read fingerprint is not a database call), no rpc, no non-GET requests.
  assert.doesNotMatch(src, /\.from\([^)]*\)(?:\s*\.\w+\([^)]*\))*?\s*\.(insert|update|upsert|delete)\(|\.rpc\(|method:\s*["'](POST|PUT|PATCH|DELETE)/);
  assert.doesNotMatch(src, /from\s+["'](?:@\/|\.\/|\.\.\/)(?:lib\/)?(?:data|maintenance[\w-]*|vehicle-financial[\w-]*|finance[\w-]*)["']/);
});
