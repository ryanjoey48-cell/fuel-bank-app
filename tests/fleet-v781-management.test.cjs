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
  m.require = r => { if (r === 'server-only') return {}; if (r.endsWith('.css')) return {}; if (r === '@/lib/supabase') return { supabase: { auth: { getSession: async () => ({ data: { session: null } }) } } }; if (r === 'next/link') return { __esModule: true, default: p => require('react').createElement('a', { href: p.href }, p.children) };
    if (r.startsWith('@/')) { const f = resolve(r.slice(2)); if (f) return load(f, cache); } if (r.startsWith('.')) { const f = resolve(path.relative(root, path.resolve(path.dirname(file), r))); if (f) return load(f, cache); } return require(r); };
  m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, file); return m.exports;
}
const O = load('lib/fleet-fuel-oversight.ts');
const cov = (id, reg, over = {}) => ({ vehicleId: id, registration: reg, vehicleType: null, registryStatus: 'active', reviewedDays: 3, verifiedDays: 3, partlyVerifiedDays: 0, unverifiedDays: 0, noPositionDays: 0, providerKm: 120, providerKmDays: 3, gpsKm: 118, gpsKmDays: 3, reviewedDayList: ['2026-11-02', '2026-11-03', '2026-11-04'], unverifiedDayList: [], partlyVerifiedDayList: [], gapDays: [], disagreeDays: [], ...over });
const rowsOf = (coverage, recurringUnknown) => O.buildOversightRows({ fuel: { status: 'not_loaded', vehicles: [] }, coverage, calendarDays: 7, recurringUnknown });
const keys = r => r.issues.map(i => `${i.key}:${i.severity}`);
const fact = (day, over = {}) => ({ day, providerKm: 100, providerReconciled: true, gpsKm: 98, logAvailable: true, observations: 50, verifiedObservations: 50, missingMinutes: 0, ...over });

test('material tracking gaps: 60+ minutes in a day is medium; shorter gaps are normal spacing and raise nothing', () => {
  const rows = rowsOf([cov('a', 'A-1', { gapDays: [{ day: '2026-11-03', minutes: 75 }, { day: '2026-11-02', minutes: 20 }] }), cov('b', 'B-2', { gapDays: [{ day: '2026-11-03', minutes: 59 }] })]);
  assert.ok(keys(rows[0]).includes('tracking_gap_material:medium')); assert.deepEqual(rows[0].issues.find(i => i.key === 'tracking_gap_material').days, ['2026-11-03']);
  assert.equal(rows[0].issues.find(i => i.key === 'tracking_gap_material').evidence.longest_min, 75);
  assert.ok(!keys(rows[1]).some(k => k.startsWith('tracking_gap_material')));
});

test('distance disagreement needs a reconciled day, at least 5 km and 10%; unreconciled or small differences raise nothing and no figure is adjusted', () => {
  const s = O.summarizeCachedDays([fact('2026-11-01', { providerKm: 100, gpsKm: 80 }), fact('2026-11-02', { providerKm: 100, gpsKm: 97 }), fact('2026-11-03', { providerKm: 100, gpsKm: 60, providerReconciled: false }), fact('2026-11-04', { providerKm: 400, gpsKm: 380 })]);
  assert.deepEqual(s.disagreeDays.map(d => d.day), ['2026-11-01']);
  assert.equal(s.providerKm, 600, 'provider km still adds only reconciled days, unchanged by the review rule');
  const r = rowsOf([cov('a', 'A-1', s)])[0]; assert.ok(keys(r).includes('distance_sources_disagree:medium')); assert.equal(r.issues.find(i => i.key === 'distance_sources_disagree').evidence.largest_diff_km, 20);
  assert.equal(O.distancesDisagree(null, 10), false); assert.equal(O.distancesDisagree(10, 14), false);
});

test('GPS verification: a day with no verified position is medium, a partly verified day is information, a fully verified day raises nothing', () => {
  const s = O.summarizeCachedDays([fact('2026-11-01'), fact('2026-11-02', { verifiedObservations: 0 }), fact('2026-11-03', { verifiedObservations: 20 })]);
  assert.deepEqual([s.verifiedDays, s.partlyVerifiedDays, s.unverifiedDays], [1, 1, 1]);
  const r = rowsOf([cov('a', 'A-1', s)])[0];
  assert.ok(keys(r).includes('positions_not_verified:medium') && keys(r).includes('positions_partly_verified:info'));
  assert.deepEqual(r.issues.find(i => i.key === 'positions_not_verified').days, ['2026-11-02']);
  assert.deepEqual(rowsOf([cov('b', 'B-2')])[0].issues, []);
});

test('missing ledger minutes (older snapshot) do not create gaps and old callers without the new fields still work', () => {
  const s = O.summarizeCachedDays([fact('2026-11-01', { missingMinutes: null }), fact('2026-11-02', { missingMinutes: undefined })]);
  assert.deepEqual(s.gapDays, []);
  const legacy = cov('a', 'A-1'); delete legacy.gapDays; delete legacy.disagreeDays; delete legacy.partlyVerifiedDayList;
  assert.deepEqual(rowsOf([legacy])[0].issues, []);
});

test('recurring unknown areas: only unmatched areas visited on several days count; medium from 3 days; known sites and single days are ignored; no coordinates are carried', () => {
  const area = (vehicles, distinctDays, days, status, over = {}) => ({ vehicles, distinctDays, days, siteMatch: status ? { status } : undefined, visitList: days.flatMap(d => vehicles.map(v => ({ registration: v, day: d }))), ...over });
  const u = O.unknownAreasByVehicle([area(['A-1'], 3, ['2026-11-01', '2026-11-02', '2026-11-03'], 'unknown_stopping_area'), area(['B-2'], 2, ['2026-11-01', '2026-11-02'], undefined), area(['C-3'], 4, ['a', 'b', 'c', 'd'], 'likely_directory_match'), area(['D-4'], 1, ['2026-11-01'], 'unknown_stopping_area')]);
  assert.deepEqual(u.map(x => x.registration).sort(), ['A-1', 'B-2']);
  const rows = rowsOf([cov('a', 'A-1'), cov('b', 'B-2'), cov('c', 'C-3')], u);
  assert.ok(keys(rows[0]).includes('recurring_unknown_area:medium')); assert.ok(keys(rows[1]).includes('recurring_unknown_area:info')); assert.deepEqual(rows[2].issues, []);
  assert.doesNotMatch(JSON.stringify(u), /latitude|longitude|centroid/);
});

test('queue grouping: one group per issue, one entry per vehicle, medium before info, dates carried for navigation, nothing is High and no forbidden finding exists', () => {
  const rows = rowsOf([cov('a', 'A-1', { gapDays: [{ day: '2026-11-03', minutes: 90 }], unverifiedDays: 1, unverifiedDayList: ['2026-11-02'] }), cov('b', 'B-2', { gapDays: [{ day: '2026-11-04', minutes: 70 }, { day: '2026-11-02', minutes: 80 }] }), cov('c', 'C-3', { registryStatus: 'inactive', gapDays: [{ day: '2026-11-03', minutes: 120 }] })]);
  const groups = O.groupOversightIssues(rows);
  const gap = groups.find(g => g.key === 'tracking_gap_material');
  assert.deepEqual(gap.vehicles.map(v => v.registration), ['A-1', 'B-2'], 'inactive vehicles are excluded; one entry per vehicle');
  assert.deepEqual(gap.vehicles[1].days, ['2026-11-04', '2026-11-02'].slice(0, 2)); assert.equal(gap.vehicles[1].day, '2026-11-02', 'the longest gap day is the one linked');
  assert.ok(groups.every((g, i) => i === 0 || O.SEVERITY_RANK[groups[i - 1].severity] >= O.SEVERITY_RANK[g.severity]));
  assert.ok(groups.every(g => g.severity !== 'high'));
  assert.deepEqual(Object.keys(O.OVERSIGHT_ISSUE_COPY).filter(k => /speed|misconduct|violation|delivery|job/i.test(k)), []);
  const copy = JSON.stringify(O.OVERSIGHT_ISSUE_COPY); assert.doesNotMatch(copy, /speeding detected|driver misconduct|delivered/i);
  for (const k of Object.keys(O.OVERSIGHT_ISSUE_COPY)) for (const p of ['title', 'reason', 'action', 'source']) assert.ok(/[฀-๿]/.test(O.OVERSIGHT_ISSUE_COPY[k][p][1]), k + p);
});

test('the report loads recurring areas as a bounded, tolerated third request and shows severity, dates and an Investigate action for every queue entry', () => {
  const ui = read('components/fleet-fuel-report.tsx');
  assert.match(ui, /recurringResponse\?\.status === 403/); assert.match(ui, /data-recurring-state/); assert.match(ui, /Investigate vehicle/); assert.match(ui, /v781-issue-table/);
  assert.doesNotMatch(ui, /for \(const .* of (rows|coverage)[^)]*\)[^{]*\{[^}]*fetch\(/, 'no request per vehicle');
  assert.match(ui, /key=\{`\$\{selectedRow\.vehicleId\}:\$\{from\}:\$\{to\}`\}/, 'a different vehicle or period remounts the panel');
});

test('investigation panel: one cache-only evidence request, ignores another vehicle, reuses the visit map and driver label, links to the three workspaces, never uses a provider read or coordinates in a URL', () => {
  const src = read('components/fleet-vehicle-investigation.tsx');
  assert.equal((src.match(/fetch\(/g) || []).length, 1); assert.match(src, /evidence\?\$\{new URLSearchParams\(\{ vehicleId: row\.vehicleId, from, to \}\)\}/); assert.match(src, /body\.vehicleId !== row\.vehicleId/);
  assert.doesNotMatch(src, /evidence\/provider|history\/playback|method: "POST"|latitude|longitude/);
  assert.match(src, /<FleetVisitMap key=\{`\$\{row\.vehicleId\}:\$\{day\}`\}/); assert.match(src, /driverLabel\(places\.data\.driver/);
  for (const target of ['"fuel"', '"daily"', '"journeys"']) assert.ok(src.includes(`onOpen(${target}`), target);
  assert.doesNotMatch(src, /km\/L|per litre|consumed fuel/i);
  assert.deepEqual([...src.matchAll(/speeding/gi)].length, 1, 'speeding appears only in the disclaimer, never as a finding');
  assert.match(src, /does not detect speeding or driver conduct/);
  assert.match(src, /not zero driving/); assert.match(src, /purchases, not consumption/);
});

test('investigation panel renders EN and TH shells and states restricted visits honestly', () => {
  const React = require('react'); const { renderToString } = require('react-dom/server');
  const { FleetVehicleInvestigation } = load('components/fleet-vehicle-investigation.tsx');
  const row = { vehicleId: 'v1', registration: '3ฒน-9565', vehicleType: null, registryStatus: 'active', eligible: true, fuelState: 'recorded', records: 2, costThb: 3500, byType: [{ fuelType: 'diesel', records: 1, litres: 80, costThb: 2500 }, { fuelType: 'lpg', records: 1, litres: 30, costThb: 1000 }], calendarDays: 7, reviewedDays: 1, unreviewedDays: 6, verifiedDays: 1, partlyVerifiedDays: 0, unverifiedDays: 0, noPositionDays: 0, providerKm: 120, providerKmDays: 1, gpsKm: 118, issues: [{ key: 'tracking_gap_material', severity: 'medium', evidence: { days: 1, longest_min: 75 }, day: '2026-11-03', days: ['2026-11-03'] }] };
  const html = lang => renderToString(React.createElement(FleetVehicleInvestigation, { language: lang, row, from: '2026-11-01', to: '2026-11-07', onOpen() {}, onClose() {} })).replace(/<!-- -->/g, '');
  const en = html('en'), th = html('th');
  assert.match(en, /3ฒน-9565/); assert.match(en, /Recorded fuel purchases/); assert.match(en, /฿3,500/); assert.match(en, /Fuel Intelligence/); assert.match(en, /Daily Activity/); assert.match(en, /Journeys/); assert.match(en, /purchases, not consumption/);
  assert.match(th, /3ฒน-9565/); assert.match(th, /การซื้อเชื้อเพลิงที่บันทึก/); assert.match(th, /ข้อมูลเชื้อเพลิง/); assert.match(th, /กิจกรรมประจำวัน/); assert.match(th, /เที่ยวรถ/);
  assert.match(en, /LPG|lpg/i, 'LPG is listed as its own type'); assert.match(en, /Material tracking gaps/);
});

test('map fixtures: an all-unverified visit stays "unverified" and is never shown as verified; vehicle and day switching rejects stale answers', () => {
  const M = load('lib/fleet-visit-map.ts');
  const pos = (i) => ({ at: new Date(Date.UTC(2026, 10, 4, 2, i)).toISOString(), latitude: 13.7 + i * 1e-5, longitude: 100.6, verified: false, speedKph: 0, phase: 'during', distanceFromCentreM: 3 });
  const v = M.visitMapView({ base: { vehicleId: 'v1', registration: 'X-1', day: '2026-11-04', visitId: 'V01' }, group: { firstAt: 'a', lastAt: 'b', observedMinutes: 20, spanMinutes: 20, maxMinutes: 25, stops: 1, observations: 3, sourceQuality: 'unverified', openStart: false, openEnd: false, nextToGap: false, interruptions: 0, missingReports: 0, arrival: { earliest: null, latest: 'a' }, departure: { earliest: 'b', latest: null }, spreadM: 0, centroid: { latitude: 13.7, longitude: 100.6 } }, match: { status: 'unknown_stopping_area', reasons: [], uncertainty: ['unverified_gps'], primaryName: null, primaryDistanceM: null }, candidates: [], positions: [pos(1), pos(2), pos(3)] });
  assert.equal(v.status, 'ready'); assert.deepEqual([v.positionCounts.verifiedShown, v.positionCounts.unverifiedShown], [0, 3]); assert.equal(v.visit.sourceQuality, 'unverified');
  const M2 = load('lib/fleet-visit-map.ts'); const base = { vehicleId: 'v1', day: '2026-11-04', visitId: 'V01' };
  assert.equal(M2.mapMatchesRequest({ ...base, vehicleId: 'v2' }, base), false); assert.equal(M2.mapMatchesRequest({ ...base, day: '2026-11-05' }, base), false);
  const comp = read('components/fleet-visit-map.tsx');
  assert.match(comp, /e\.key === "Escape"/); assert.match(comp, /e\.key !== "Tab"/); assert.match(comp, /opener\.current/, 'focus returns to the opener');
  assert.match(comp, /day_not_held/, 'cache expiry has its own message');
});
