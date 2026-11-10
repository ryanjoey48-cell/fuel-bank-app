const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const { load } = require('../scripts/fleet-real-day-validation.cjs');
const fuel = load('lib/fleet-fuel-view.ts');
const range = { from: '2026-11-01', to: '2026-11-03' };
const registry = [{ id: 'a', vehicle_reg: 'AA-1' }, { id: 'b', vehicle_reg: 'BB-2' }];
const row = (id, date, reg, extra = {}) => ({ id, date, vehicle_reg: reg, litres: 10, total_cost: 400, fuel_type: 'diesel', odometer: null, created_at: `${date}T03:00:00Z`, ...extra });

test('THB is always two decimals, litres at most two, unknown is a dash never zero', () => {
  assert.equal(fuel.formatThb(2855.1, 'en'), '2,855.10');
  assert.equal(fuel.formatThb(0, 'en'), '0.00');
  assert.equal(fuel.formatThb(null, 'en'), '—');
  assert.equal(fuel.formatThb(52765.1, 'th'), '52,765.10');
  assert.equal(fuel.formatLitres(93.8, 'en'), '93.8');
  assert.equal(fuel.formatLitres(undefined, 'en'), '—');
});

test('each Fuel Log row counts once: duplicates, out-of-range, unmatched and shared registrations are excluded', () => {
  const rows = [row(1, '2026-11-03', 'AA 1', { litres: 54.1, total_cost: 2260 }), row(1, '2026-11-03', 'AA-1', { litres: 54.1, total_cost: 2260 }),
    row(2, '2026-11-03', 'aa-1', { litres: '39.7', total_cost: '595.10' }), row(3, '2026-10-31', 'AA-1'), row(4, '2026-11-02', 'ZZ-9')];
  const s = fuel.summarizeFuelRange(registry, rows, range);
  const a = s.vehicles.find(v => v.vehicleId === 'a');
  assert.equal(a.records, 2); assert.equal(Math.round(a.litres * 100), 9380); assert.equal(Math.round(a.costThb * 100), 285510);
  assert.deepEqual([s.fleet.matchedRecords, s.fleet.duplicateSourceRows, s.fleet.outsideRangeRecords, s.fleet.unmatchedRecords], [2, 1, 1, 1]);
  assert.equal(s.vehicles.find(v => v.vehicleId === 'b').records, 0);
  const dup = fuel.summarizeFuelRange([{ id: 'a', vehicle_reg: 'AA-1' }, { id: 'c', vehicle_reg: 'AA 1' }], rows.slice(0, 1), range);
  assert.ok(dup.vehicles.every(v => v.records === null && v.litres === null));
  assert.equal(dup.fleet.ambiguousRegistrationRecords, 1); assert.equal(dup.fleet.matchedRecords, 0);
  const stable = fuel.summarizeFuelRange([{ id: 'a', vehicle_reg: 'AA-1' }, { id: 'c', vehicle_reg: 'AA 1' }], [row(9, '2026-11-02', 'AA-1', { vehicle_id: 'c' })], range);
  assert.equal(stable.vehicles.find(v => v.vehicleId === 'c').records, 1); assert.equal(stable.vehicles.find(v => v.vehicleId === 'a').records, null);
});

test('date range is inclusive at both Bangkok day boundaries and an unavailable source is never zero', () => {
  const rows = [row(1, '2026-11-01', 'AA-1'), row(2, '2026-11-03', 'AA-1'), row(3, '2026-11-04', 'AA-1'), row(4, '2026-10-31', 'AA-1')];
  assert.equal(fuel.summarizeFuelRange(registry, rows, range).vehicles[0].records, 2);
  assert.equal(fuel.daysInRange('2026-11-01', '2026-11-03'), 3);
  const empty = fuel.summarizeFuelRange(registry, null, range);
  assert.ok(empty.vehicles.every(v => v.records === null && v.costThb === null && v.coverage === null));
  assert.equal(empty.fleet.matchedRecords, 0);
  assert.equal(fuel.summarizeFuelRange(registry, [], range).vehicles[0].records, 0);
});

test('mixed fuel types are never added; unrecorded type is never defaulted; malformed numbers stay unknown', () => {
  const s = fuel.summarizeFuelRange(registry, [row(1, '2026-11-02', 'AA-1'), row(2, '2026-11-02', 'AA-1', { fuel_type: 'lpg' }), row(3, '2026-11-02', 'BB-2', { fuel_type: null }), row(4, '2026-11-03', 'BB-2', { litres: 'abc' })], range);
  const a = s.vehicles.find(v => v.vehicleId === 'a'), b = s.vehicles.find(v => v.vehicleId === 'b');
  assert.equal(a.litres, null); assert.deepEqual(a.litresByType.map(g => g.fuelType), ['diesel', 'lpg']);
  const unrecorded = b.litresByType.find(g => g.fuelType === 'unrecorded'), malformed = b.litresByType.find(g => g.fuelType === 'diesel');
  assert.equal(b.litres, null); assert.equal(unrecorded.litres, 10); assert.equal(malformed.litres, null); assert.equal(malformed.costThb, 400);
});

test('odometer intervals: missing readings, decrease, identical readings and implausible jumps never become distance', () => {
  const rows = [row(1, '2026-11-01', 'AA-1', { odometer: 1000 }), row(2, '2026-11-02', 'AA-1'), row(3, '2026-11-03', 'AA-1', { odometer: 1250 })];
  const v = fuel.summarizeFuelRange(registry, rows, range).vehicles[0];
  assert.equal(v.coverage.withOdometer, 2); assert.equal(v.latestOdometer.km, 1250);
  assert.equal(v.intervals.length, 1); assert.equal(v.intervals[0].km, 250); assert.equal(v.intervals[0].recordsWithoutOdometer, 1);
  assert.equal(Math.round(v.intervals[0].purchasedLitresByType[0].litres), 20); assert.equal(v.intervals[0].efficiency.status, 'unknown');
  assert.equal(v.intervals[0].efficiency.reason, 'full_tank_evidence_unavailable');
  const bad = (a, b, days = 1) => fuel.fuelIntervals([fuel.toTransaction(row(1, '2026-11-01', 'AA-1', { odometer: a })), fuel.toTransaction(row(2, `2026-11-0${1 + days}`, 'AA-1', { odometer: b }))])[0];
  assert.equal(bad(500, 400).km, null); assert.equal(bad(500, 400).withheld, 'odometer_decrease_requires_review');
  assert.equal(bad(500, 500).withheld, 'identical_odometer_review'); assert.equal(bad(500, 500).km, 0);
  assert.equal(bad(0, 9000).withheld, 'implausible_odometer_jump');
  assert.equal(fuel.fuelIntervals([fuel.toTransaction(row(1, '2026-11-01', 'AA-1', { odometer: 5 }))]).length, 0);
  assert.ok(v.intervals[0].reviewRequired);
});

test('three-source comparison only compares identical observation periods', () => {
  const s = (source, km, a, b, complete = true) => ({ source, km, periodStart: a, periodEnd: b, complete });
  assert.equal(fuel.compareSources(s('forth_provider', 100, '2026-11-03', '2026-11-03'), s('fuel_log_odometer', 700, '2026-10-27', '2026-11-03')).reason, 'different_observation_periods');
  assert.equal(fuel.compareSources(s('forth_provider', null, 'x', 'x'), s('weekly_odometer', 1, 'x', 'x')).reason, 'missing_distance');
  assert.equal(fuel.compareSources(s('forth_provider', 100, 'd', 'd', false), s('forth_gps', 100, 'd', 'd')).status, 'incomplete');
  assert.equal(fuel.compareSources(s('forth_provider', 100, 'd', 'd'), s('forth_gps', 130, 'd', 'd')).status, 'review_required');
  assert.equal(fuel.compareSources(s('forth_provider', 100, 'd', 'd'), s('forth_gps', 102, 'd', 'd')).status, 'within_tolerance');
});

test('unusual Fuel Log rows are flagged for review but remain in recorded totals unchanged', () => {
  const rows = [row(1, '2026-11-02', 'AA-1', { litres: 63.16, total_cost: 2690 }), row(2, '2026-11-02', 'AA-1', { litres: 72.33, total_cost: 310032 }), row(3, '2026-11-02', 'AA-1', { litres: 0, total_cost: 0 }), row(4, '2026-11-02', 'AA-1', { litres: null, total_cost: 5 }), row(5, '2026-11-02', 'AA-1', { litres: 50, total_cost: 2 })];
  const s = fuel.summarizeFuelRange(registry, rows, range), v = s.vehicles[0];
  const flags = Object.fromEntries(v.transactions.map(t => [t.id, t.reviewFlags]));
  assert.deepEqual(flags, { 1: [], 2: ['price_outside_review_range'], 3: ['zero_litres_and_cost'], 4: ['missing_litres_or_cost'], 5: ['price_outside_review_range'] });
  assert.equal(v.reviewRecords, 4); assert.equal(s.fleet.reviewRecords, 4);
  assert.equal(Math.round(v.transactions[1].pricePerLitre), 4286);
  assert.equal(v.costThb, 312729);                                 // recorded costs are summed exactly as recorded; nothing is corrected or excluded
  assert.equal(v.litres, null);                                    // one record has no litres, so the litre total stays unknown
});

class ApiError extends Error { constructor(status, message) { super(message); this.status = status; } }
function fuelRoute({ rows = [], error = null, denied = 0, missingColumns = 0 } = {}) {
  const calls = []; let attempts = 0;
  const client = { from: table => { calls.push({ table }); const chain = { select: s => { calls.push({ select: s }); return chain; }, gte: (...a) => { calls.push({ gte: a }); return chain; }, lte: (...a) => { calls.push({ lte: a }); return chain; }, order: () => chain,
    limit: async () => { if (table === 'vehicles') return { data: registry, error: null }; attempts++; if (attempts <= missingColumns) return { data: null, error: { code: '42703' } }; return error ? { data: null, error } : { data: rows, error: null }; } }; return chain; } };
  const mocks = { 'next/server': { NextResponse: { json: (body, options) => new Response(JSON.stringify(body), options) } },
    '@/lib/admin-user-management-server': { AdminApiError: ApiError }, '@/lib/fleet-operations-auth': { requireFleetOfficeAccess: async () => { if (denied) throw new ApiError(denied, 'Denied'); return { user: { id: 'u' } }; } },
    '@/lib/fleet-evidence-server': { createFleetSourceClient: () => { calls.push('client'); return client; } }, '@/lib/fleet-intelligence': load('lib/fleet-intelligence.ts'), '@/lib/fleet-fuel-view': fuel, '@/lib/fleet-registry-audit': load('lib/fleet-registry-audit.ts') };
  const module = { exports: {} };
  const compiled = ts.transpileModule(fs.readFileSync('app/api/admin/forth-tracking/evidence/fuel/route.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('require', 'module', 'exports', compiled)(n => { if (!(n in mocks)) throw Error(n); return mocks[n]; }, module, module.exports);
  return { GET: module.exports.GET, calls };
}
const req = q => new Request(`http://localhost/api/admin/forth-tracking/evidence/fuel?${q}`);

test('fuel route rejects unauthorized, malformed, reversed, oversized and future ranges before any source read', async () => {
  for (const denied of [401, 403]) { const r = fuelRoute({ denied }); assert.equal((await r.GET(req('from=2026-11-01&to=2026-11-03'))).status, denied); assert.equal(r.calls.length, 0); }
  for (const q of ['from=2026-02-30&to=2026-03-01', 'from=2026-11-03&to=2026-11-01', 'from=2026-01-01&to=2026-11-03', 'from=2026-11-01&to=2099-01-01', 'from=2026-11-01&to=2026-11-03&vehicleId=']) { const r = fuelRoute(); assert.equal((await r.GET(req(q))).status, 400, q); assert.equal(r.calls.length, 0); }
});

test('fuel route reports the actual source rows, falls back on missing optional columns and returns detail only for one vehicle', async () => {
  const rows = [row(1, '2026-11-03', 'AA-1', { litres: 54.1, total_cost: 2260, odometer: 615524 }), row(2, '2026-11-03', 'AA-1', { litres: 39.7, total_cost: 595.1, odometer: 615524 })];
  const r = fuelRoute({ rows, missingColumns: 2 });
  const fleet = await (await r.GET(req('from=2026-11-01&to=2026-11-03'))).json();
  assert.equal(fleet.sourceStatus, 'available'); assert.equal(fleet.capabilities.fullTankConfirmation, 'unsupported_by_deployed_source');
  assert.equal(fleet.vehicles[0].transactions, null); assert.equal(Math.round(fleet.fleet.byType[0].litres * 100), 9380); assert.equal(Math.round(fleet.fleet.costThb * 100), 285510);
  assert.equal(fleet.vehicles[0].reviewFlags, 1);
  const one = await (await fuelRoute({ rows }).GET(req('from=2026-11-01&to=2026-11-03&vehicleId=a'))).json();
  assert.equal(one.vehicles.length, 1); assert.equal(one.vehicles[0].transactions.length, 2); assert.equal(one.fleet, null);
  assert.equal((await fuelRoute({ rows }).GET(req('from=2026-11-01&to=2026-11-03&vehicleId=nope'))).status, 404);
});

test('unavailable or oversized Fuel Logs yield unknown totals, never zero', async () => {
  const down = await (await fuelRoute({ error: { code: '42501' } }).GET(req('from=2026-11-01&to=2026-11-03'))).json();
  assert.equal(down.sourceStatus, 'unavailable'); assert.ok(down.vehicles.every(v => v.records === null && v.costThb === null));
  const big = await (await fuelRoute({ rows: Array.from({ length: 1001 }, (_, i) => row(i, '2026-11-02', 'AA-1')) }).GET(req('from=2026-11-01&to=2026-11-03'))).json();
  assert.equal(big.sourceStatus, 'truncated'); assert.ok(big.vehicles.every(v => v.records === null));
});

test('fuel panel and report are read-only and the Forth service is shared across route bundles', () => {
  const sources = ['app/api/admin/forth-tracking/evidence/fuel/route.ts', 'lib/fleet-fuel-view.ts', 'components/fleet-fuel-panel.tsx', 'components/fleet-fuel-report.tsx'].map(f => fs.readFileSync(f, 'utf8')).join('\n');
  // V7.8.2: the report's explicit coverage review POSTs to the existing bounded provider-day read route (a Forth READ, cache-first). It is the only allowed call and it writes nothing.
  const withoutProviderRead = sources.replace(/evidence\/provider[^\n]*method: "POST"[^\n]*/g, '');
  assert.equal((sources.match(/method:\s*["']POST/g) || []).length, 1);
  assert.doesNotMatch(withoutProviderRead, /\.(insert|update|upsert|delete|rpc)\(|method:\s*["'](POST|PUT|PATCH|DELETE)/);
  assert.doesNotMatch(sources, /from\s+["']@?\/?(?:\.\.\/)?(?:lib\/)?(?:data|vehicle-financial[\w-]*|maintenance[\w-]*|weekly-mileage[\w-]*)["']/);
  assert.match(fs.readFileSync('lib/forth-tracking-server.ts', 'utf8'), /globalThis[\s\S]{0,200}eesForthTrackingService \?\?= createForthTrackingService\(\)/);
});
