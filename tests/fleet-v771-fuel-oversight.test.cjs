const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');
function load(rel, cache = new Map()) {
  const file = path.resolve(root, rel); if (cache.has(file)) return cache.get(file).exports;
  const m = new Module(file, module); cache.set(file, m); m.filename = file; m.paths = Module._nodeModulePaths(path.dirname(file));
  const resolve = base => ['.ts', '.tsx'].map(e => base + e).find(f => fs.existsSync(path.join(root, f)));
  m.require = r => { if (r === 'server-only') return {}; if (r.endsWith('.css')) return {}; if (r === '@/lib/supabase') return { supabase: {} }; if (r === 'next/link') return { __esModule: true, default: p => require('react').createElement('a', { href: p.href }, p.children) };
    if (r.startsWith('@/')) { const f = resolve(r.slice(2)); if (f) return load(f, cache); } if (r.startsWith('.')) { const f = resolve(path.relative(root, path.resolve(path.dirname(file), r))); if (f) return load(f, cache); } return require(r); };
  m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, file); return m.exports;
}
const O = load('lib/fleet-fuel-oversight.ts');

const cov = (id, reg, over = {}) => ({ vehicleId: id, registration: reg, vehicleType: null, registryStatus: 'active', reviewedDays: 0, verifiedDays: 0, partlyVerifiedDays: 0, unverifiedDays: 0, noPositionDays: 0, providerKm: null, providerKmDays: 0, gpsKm: null, gpsKmDays: 0, reviewedDayList: [], unverifiedDayList: [], ...over });
const fuelRow = (id, reg, over = {}) => ({ vehicleId: id, registration: reg, records: 2, litres: 100, costThb: 3500, litresByType: [{ fuelType: 'diesel', records: 2, litres: 100, costThb: 3500 }], reviewRecords: 0, reviewFlags: 0, coverage: { records: 2, withOdometer: 2, withFuelType: 2 }, ...over });
const build = (fuelRows, coverage, status = 'available', calendarDays = 31) => O.buildOversightRows({ fuel: { status, vehicles: fuelRows }, coverage, calendarDays });
const byReg = (rows, reg) => rows.find(r => r.registration === reg);

test('fuel states are distinct: not loaded, unavailable, not attributed, no record found, recorded; and none of them is zero use', () => {
  const coverage = [cov('a', 'A-1'), cov('b', 'B-2'), cov('c', 'C-3')];
  const rows = build([fuelRow('a', 'A-1'), fuelRow('b', 'B-2', { records: 0, litres: null, costThb: 0, litresByType: [] }), fuelRow('c', 'C-3', { records: null, costThb: null, litresByType: null })], coverage);
  assert.equal(byReg(rows, 'A-1').fuelState, 'recorded'); assert.equal(byReg(rows, 'B-2').fuelState, 'no_records'); assert.equal(byReg(rows, 'C-3').fuelState, 'not_attributed');
  assert.equal(build([], coverage, 'not_loaded')[0].fuelState, 'not_loaded'); assert.equal(build([], coverage, 'unavailable')[0].fuelState, 'unavailable'); assert.equal(build([], coverage, 'truncated')[0].fuelState, 'unavailable');
  assert.match(O.FUEL_STATE_COPY.no_records[0], /No fuel record found/); assert.doesNotMatch(O.FUEL_STATE_COPY.no_records.join(' '), /zero|0 L/i);
});

test('mixed fuel types stay separate and LPG is never folded into another type', () => {
  const mixed = fuelRow('a', 'A-1', { litres: null, litresByType: [{ fuelType: 'diesel', records: 3, litres: 200, costThb: 6000 }, { fuelType: 'lpg', records: 1, litres: 40, costThb: 800 }] });
  const r = byReg(build([mixed], [cov('a', 'A-1')]), 'A-1');
  assert.deepEqual(r.byType.map(g => g.fuelType), ['diesel', 'lpg']); assert.equal(r.byType.find(g => g.fuelType === 'lpg').litres, 40);
  assert.equal(r.byType.reduce((n, g) => n + g.litres, 0), 240, 'a total is only ever computed from the breakdown, never stored as one figure');
  assert.doesNotMatch(read('components/fleet-fuel-report.tsx'), /litres\s*\+\s*|sum\(.*litres/, 'no cross-type litre sum in the UI');
});

test('missing cost and missing fuel type become information issues; unusual records are medium; nothing becomes zero', () => {
  const rows = build([fuelRow('a', 'A-1', { costThb: null }), fuelRow('b', 'B-2', { coverage: { records: 2, withOdometer: 2, withFuelType: 0 } }), fuelRow('c', 'C-3', { reviewRecords: 2, reviewFlags: 1 })], [cov('a', 'A-1'), cov('b', 'B-2'), cov('c', 'C-3')]);
  const keys = reg => byReg(rows, reg).issues.map(i => i.key + ':' + i.severity);
  assert.ok(keys('A-1').includes('fuel_cost_missing:info')); assert.equal(byReg(rows, 'A-1').costThb, null, 'unknown cost stays null');
  assert.ok(keys('B-2').includes('fuel_type_unrecorded:info'));
  assert.ok(keys('C-3').includes('fuel_unusual_records:medium') && keys('C-3').includes('odometer_intervals_review:info'));
  assert.ok(rows.every(r => r.issues.every(i => i.severity !== 'high')), 'high is reserved: nothing at fleet level justifies it');
});

test('unreviewed Forth days are not-reviewed (never zero driving); reviewed coverage and provider km count only reconciled reviewed days; GPS stays separate', () => {
  const facts = summarizeFacts();
  function summarizeFacts() {
    return O.summarizeCachedDays([
      { day: '2026-10-02', providerKm: 100, providerReconciled: true, gpsKm: 98, logAvailable: true, observations: 50, verifiedObservations: 50 },
      { day: '2026-10-01', providerKm: 40, providerReconciled: false, gpsKm: null, logAvailable: true, observations: 20, verifiedObservations: 0 },
      { day: '2026-10-03', providerKm: 70, providerReconciled: true, gpsKm: 69, logAvailable: true, observations: 30, verifiedObservations: 12 },
      { day: '2026-10-04', providerKm: null, providerReconciled: false, gpsKm: null, logAvailable: false, observations: 0, verifiedObservations: 0 }
    ]);
  }
  assert.equal(facts.reviewedDays, 4); assert.equal(facts.providerKm, 170, 'the unreconciled 40 km day is excluded'); assert.equal(facts.providerKmDays, 2); assert.equal(facts.gpsKm, 167);
  assert.deepEqual([facts.verifiedDays, facts.partlyVerifiedDays, facts.unverifiedDays, facts.noPositionDays], [1, 1, 1, 1]);
  assert.deepEqual(facts.reviewedDayList, ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']); assert.deepEqual(facts.unverifiedDayList, ['2026-10-01']);
  const none = O.summarizeCachedDays([]); assert.equal(none.providerKm, null, 'no reviewed day: unknown, not 0'); assert.equal(none.gpsKm, null);
  const row = byReg(build([fuelRow('a', 'A-1')], [cov('a', 'A-1')]), 'A-1'); assert.equal(row.providerKm, null); assert.equal(row.unreviewedDays, 31);
  assert.ok(row.issues.some(i => i.key === 'fuel_without_forth_review' && i.severity === 'info'));
});

test('fleet summary: eligible vehicles only, duplicate and inactive rows listed apart and never merged, partial km labelled as partial', () => {
  const coverage = [cov('a', 'A-1', { reviewedDays: 3, providerKm: 300, providerKmDays: 3 }), cov('b', 'B-2'), cov('d1', 'D-9', { registryStatus: 'duplicate' }), cov('d2', 'D-9', { registryStatus: 'duplicate' }), cov('i', 'I-5', { registryStatus: 'inactive' }), cov('u', 'U-7', { registryStatus: 'unknown' })];
  const rows = build([fuelRow('a', 'A-1'), fuelRow('b', 'B-2', { records: 0, costThb: 0, litres: null, litresByType: [] }), fuelRow('d1', 'D-9', { records: null, costThb: null, litresByType: null }), fuelRow('d2', 'D-9', { records: null, costThb: null, litresByType: null }), fuelRow('i', 'I-5')], coverage);
  assert.equal(rows.length, 6, 'one row per registry vehicle: duplicates are not merged');
  const s = O.summarizeOversight(rows);
  assert.equal(s.eligibleVehicles, 3); assert.deepEqual(s.excluded, { inactive: 1, duplicate: 2 });
  assert.equal(s.vehiclesWithFuel, 1); assert.equal(s.vehiclesNoRecord, 1); assert.equal(s.vehiclesNotLoaded, 0);
  assert.equal(s.reviewedVehicleDays, 3); assert.equal(s.eligibleVehicleDays, 93); assert.equal(s.providerKm, 300); assert.equal(s.providerKmVehicles, 1);
  assert.equal(O.summarizeOversight(build([], coverage, 'not_loaded')).vehiclesNotLoaded, 3, 'fuel not loaded is its own count, not "no record"');
});

test('personal car or any registry row marked inactive is excluded from eligible totals but stays listable', () => {
  const rows = build([fuelRow('p', 'P-1')], [cov('p', 'P-1', { registryStatus: 'inactive', vehicleType: 'personal_car' })]);
  assert.equal(rows[0].eligible, false); assert.equal(rows[0].vehicleType, 'personal_car');
  assert.equal(O.filterSortRows(rows, { search: '', show: 'all', sort: 'registration' }).length, 0);
  assert.equal(O.filterSortRows(rows, { search: '', show: 'excluded', sort: 'registration' }).length, 1);
});

test('sorting and filtering: highest spend first, unknown last, search ignores spaces and dashes, filters work, and ordering never changes figures', () => {
  const coverage = [cov('a', 'A-1', { reviewedDays: 2, providerKm: 50, providerKmDays: 2 }), cov('b', 'B-2', { reviewedDays: 5, providerKm: 500, providerKmDays: 5 }), cov('c', 'C-3'), cov('d', 'D-4')];
  const rows = build([fuelRow('a', 'A-1', { costThb: 1000 }), fuelRow('b', 'B-2', { costThb: 9000 }), fuelRow('c', 'C-3', { costThb: null }), fuelRow('d', 'D-4', { records: 0, costThb: 0, litres: null, litresByType: [] })], coverage);
  const order = (sort, extra = {}) => O.filterSortRows(rows, { search: '', show: 'all', sort, ...extra }).map(r => r.registration);
  assert.deepEqual(order('spend'), ['B-2', 'A-1', 'D-4', 'C-3'], 'highest spend first; an unknown cost sorts last');
  assert.deepEqual(order('distance').slice(0, 2), ['B-2', 'A-1']); assert.equal(order('missing_evidence')[0] === 'C-3' || order('missing_evidence')[0] === 'D-4', true);
  assert.deepEqual(order('registration'), ['A-1', 'B-2', 'C-3', 'D-4']);
  assert.deepEqual(O.filterSortRows(rows, { search: 'b 2', show: 'all', sort: 'registration' }).map(r => r.registration), ['B-2']);
  assert.deepEqual(O.filterSortRows(rows, { search: '', show: 'with_fuel', sort: 'registration' }).map(r => r.registration), ['A-1', 'B-2', 'C-3']);
  assert.deepEqual(O.filterSortRows(rows, { search: '', show: 'without_fuel', sort: 'registration' }).map(r => r.registration), ['D-4']);
  assert.deepEqual(O.filterSortRows(rows, { search: '', show: 'unreviewed', sort: 'registration' }).map(r => r.registration), ['C-3', 'D-4']);
  assert.equal(JSON.stringify(rows.map(r => r.costThb)), JSON.stringify([1000, 9000, null, 0]), 'sorting does not mutate the rows');
});

test('issue grouping: one group per issue type, one entry per vehicle, medium above info, ineligible vehicles excluded', () => {
  const coverage = [cov('a', 'A-1'), cov('b', 'B-2'), cov('i', 'I-5', { registryStatus: 'inactive' })];
  const rows = build([fuelRow('a', 'A-1', { costThb: null, reviewRecords: 1 }), fuelRow('b', 'B-2', { costThb: null }), fuelRow('i', 'I-5', { costThb: null })], coverage);
  const groups = O.groupOversightIssues(rows);
  const cost = groups.find(g => g.key === 'fuel_cost_missing'); assert.equal(cost.vehicles.length, 2, 'the inactive vehicle is not listed'); assert.deepEqual(cost.vehicles.map(v => v.registration), ['A-1', 'B-2']);
  assert.equal(groups[0].key, 'fuel_unusual_records'); assert.equal(groups[0].severity, 'medium');
  assert.equal(new Set(groups.map(g => g.key)).size, groups.length);
});

test('wrong-period regression stays fixed: the odometer comparison uses only the days inside the span', () => {
  const src = read('components/fleet-operating-history.tsx'), lib = read('lib/fleet-fuel-review.ts');
  assert.match(src, /coveredSum/); assert.doesNotMatch(src, /Math\.abs\(providerSum - s\.km\)/); assert.match(lib, /covered\.reduce/);
});

test('Bangkok date boundaries: the coverage route builds calendar days in Asia/Bangkok, bounds the period to 62 days and never the future', () => {
  const route = read('app/api/admin/forth-tracking/evidence/fleet-period/route.ts');
  assert.match(route, /timeZone: "Asia\/Bangkok"/); assert.match(route, /MAX_DAYS = 62/); assert.match(route, /hi\.start > Date\.now\(\)/); assert.match(route, /status: error instanceof AdminApiError \? error\.status : 503/);
});

test('access and performance: the coverage route is GET-only, needs fleet office access, reads only the user-scoped cache, returns no positions or drivers, and the UI makes exactly three fleet requests (V7.8.1: the third is the cache-only recurring areas)', () => {
  const route = read('app/api/admin/forth-tracking/evidence/fleet-period/route.ts');
  assert.match(route, /requireFleetOfficeAccess\(request\)/); assert.match(route, /recalledProviderDay(Entry)?\(user\.id,/); assert.doesNotMatch(route, /export async function (POST|PUT|PATCH|DELETE)/);
  assert.doesNotMatch(route.replace(/\/\*[\s\S]*?\*\//g, ''), /fetchProvider|forthClient|\.insert\(|\.update\(|\.upsert\(|\.delete\(|latitude|longitude|driver/i);
  // V7.8.1: the only thing taken from the journey ledger is the recorded-missing minutes (a number), never journeys, positions or places.
  assert.deepEqual([...route.matchAll(/journeyLedger[^;]*/g)].map(x => x[0].replace(/\s+/g, ' ').slice(0, 60)).filter(s => !/totals\?: \{ missingMinutes\?: number \}|totals\?\.missingMinutes/.test(s)), []);
  const ui = read('components/fleet-fuel-report.tsx');
  // V7.8.2: plus ONE call site for the explicit, user-started coverage review (the cache-only coverage refresh is a fourth, loop-free call site).
  assert.equal((ui.match(/fetch\(/g) || []).length, 6, 'load: fuel, coverage, recurring; refresh: coverage, recurring; review: provider (one call site each, never per vehicle in a loop)');
  assert.match(ui, /days <= 31 \? fetch\(`\/api\/admin\/forth-tracking\/evidence\/recurring\?/, 'recurring areas are only requested for periods the route accepts');
  assert.match(ui, /Promise\.all\(\[fetch\(`\/api\/admin\/forth-tracking\/evidence\/fuel\?/); assert.match(ui, /fleet-period\?/);
  assert.doesNotMatch(ui, /forth-tracking\/evidence\/history|useEffect\(\(\) => \{ void (read|startReview)\(/);
  assert.equal((ui.match(/forth-tracking\/evidence\/provider/g) || []).length, 1, 'the provider route is reachable only from the explicit start button');
  // sort / search / filter are derived with useMemo and trigger no request
  assert.match(ui, /useMemo\(\(\) => filterSortRows\(rows, \{ search, show, sort \}\)/);
});

test('navigation preserves vehicle and period and starts no read: fuel keeps the report dates, daily opens the chosen day via the existing helper', () => {
  const centre = read('components/forth-tracking-centre.tsx');
  const fn = centre.slice(centre.indexOf('const openFuelOversightVehicle'), centre.indexOf('const openVehicleWorkspace'));
  assert.match(fn, /openReviewedVehicleDay\(registration, scope\.day\)/); assert.match(fn, /setEvidenceScope\(\{ from: scope\.from, to: scope\.to, day: scope\.to \}\)/); assert.match(fn, /goWorkspace\(target === "daily" \? "daily" : target === "journeys" \? "journeys" : "fuel"\)/);
  assert.doesNotMatch(fn, /fetch\(|read\(|load\(/);
  const block = centre.slice(centre.indexOf('<div className="v71-workspace v71-reports-workspace"'));
  assert.ok(block.indexOf('<FleetDayReview') < block.indexOf('<FleetFuelReport') && block.indexOf('<FleetFuelReport') < block.indexOf('<details className="fleet-legacy-reports"'));
});

test('English and Thai rendering of the section and its issue copy', () => {
  const React = require('react'); const { renderToString } = require('react-dom/server');
  const { FleetFuelReport } = load('components/fleet-fuel-report.tsx');
  const en = renderToString(React.createElement(FleetFuelReport, { language: 'en', onVehicle: () => {} })), th = renderToString(React.createElement(FleetFuelReport, { language: 'th', onVehicle: () => {} }));
  assert.match(en, /Fleet fuel &amp; mileage/); assert.match(en, /Nothing is read until you press the button/); assert.match(th, /เชื้อเพลิงและระยะทางกองรถ/); assert.match(th, /จะไม่มีการอ่านจนกว่าจะกดปุ่ม/);
  for (const k of Object.keys(O.OVERSIGHT_ISSUE_COPY)) for (const part of ['title', 'reason', 'action', 'source']) assert.ok(O.OVERSIGHT_ISSUE_COPY[k][part][1].length > 0, k + part);
  for (const k of Object.keys(O.SORT_COPY)) assert.ok(O.SORT_COPY[k][1].length > 0);
});
