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
const C = load('lib/fleet-coverage-review.ts');
const Q = load('lib/fleet-day-review.ts');
const F = load('lib/fleet-fuel-comparability.ts');
const O = load('lib/fleet-fuel-oversight.ts');
const row = (id, reg, reviewed = [], eligible = true) => ({ vehicleId: id, registration: reg, eligible, reviewedDayList: reviewed });
const NOW = new Date('2026-11-09T05:00:00Z'); // 12:00 in Bangkok

// ---------- coverage counting and plan ----------
test('reviewable days exclude today and the future (Bangkok), and respect the Bangkok date boundary', () => {
  assert.deepEqual(C.reviewableDays('2026-11-07', '2026-11-12', NOW), ['2026-11-07', '2026-11-08']);
  const lateUtc = new Date('2026-11-08T18:30:00Z'); // already 9 Nov 01:30 in Bangkok
  assert.deepEqual(C.reviewableDays('2026-11-07', '2026-11-09', lateUtc), ['2026-11-07', '2026-11-08']);
  assert.deepEqual(C.reviewableDays('2026-11-09', '2026-11-09', NOW), [], 'a period of only today has nothing reviewable');
});

test('coverage is a numerator over eligible vehicle-days: only reviewed days of eligible vehicles inside the period count', () => {
  const days = ['2026-11-01', '2026-11-02', '2026-11-03'];
  const n = C.coverageNumbers([row('a', 'A-1', ['2026-11-01', '2026-11-01', '2026-11-30']), row('b', 'B-2', days), row('x', 'X-9', days, false)], days);
  assert.deepEqual([n.eligibleVehicles, n.eligibleVehicleDays, n.reviewed, n.missing, n.percent], [2, 6, 4, 2, 66.7], 'duplicates, out-of-period days and ineligible vehicles are not counted');
  assert.equal(C.coverageNumbers([], days).percent, null);
});

test('read plan: scopes, caps, duplicates, ineligible vehicles and newest-first order', () => {
  const days = ['2026-11-01', '2026-11-02', '2026-11-03'];
  const rows = [row('a', 'A-1', ['2026-11-03']), row('b', 'B-2'), row('c', 'C-3', [], false)];
  const sel = C.buildReadPlan({ rows, days, scope: 'selected', selectedId: 'a' });
  assert.deepEqual(sel.keys, ['a|2026-11-02', 'a|2026-11-01']); assert.equal(sel.capped, false);
  assert.deepEqual(C.buildReadPlan({ rows, days, scope: 'selected', selectedId: 'c' }).keys, [], 'an ineligible vehicle is never requested');
  assert.deepEqual(C.buildReadPlan({ rows, days, scope: 'selected', selectedId: null }).keys, []);
  const chk = C.buildReadPlan({ rows, days, scope: 'checked', checkedIds: ['b', 'b', 'c'] });
  assert.equal(chk.keys.length, 3); assert.ok(chk.keys.every(k => k.startsWith('b|')), 'duplicate ids collapse and ineligible ones are dropped');
  const many = Array.from({ length: 12 }, (_, i) => row('v' + i, 'V-' + i));
  assert.equal(C.buildReadPlan({ rows: many, days: ['2026-11-01', '2026-11-02', '2026-11-03'], scope: 'checked', checkedIds: many.map(r => r.vehicleId) }).vehicles, C.MAX_CHECKED_VEHICLES, 'a small set only');
  const batch = C.buildReadPlan({ rows: many, days: ['2026-11-01', '2026-11-02', '2026-11-03'], scope: 'batch' });
  assert.equal(batch.keys.length, C.PERIOD_READ_CAP); assert.equal(batch.totalMissing, 36); assert.equal(batch.capped, true);
  assert.equal(C.buildReadPlan({ rows: many, days: ['2026-11-01'], scope: 'batch', limit: 9999 }).keys.length, 12, 'a larger limit cannot exceed the existing safe cap');
  assert.ok(batch.keys[0].endsWith('2026-11-03'), 'newest day first');
});

test('keys: a vehicle-day key round-trips and malformed keys are rejected', () => {
  assert.deepEqual(C.parseKey(C.dayKey('342f-1', '2026-11-04')), { vehicleId: '342f-1', day: '2026-11-04' });
  for (const bad of ['', 'nopipe', '|2026-11-04', 'a|2026-1-4', 'a|', 'x'.repeat(81) + '|2026-11-04']) assert.equal(C.parseKey(bad), null, bad);
});

test('progress: queued, failed and cancelled days are never reviewed; cancelling keeps finished results and is labelled cancelled', () => {
  const keys = ['a|2026-11-01', 'a|2026-11-02', 'a|2026-11-03', 'a|2026-11-04'];
  const states = { [keys[0]]: 'done', [keys[1]]: 'failed', [keys[2]]: 'loading', [keys[3]]: 'queued' };
  const during = C.countReads(keys, states); assert.deepEqual([during.done, during.failed, during.reading, during.queued], [1, 1, 1, 1]);
  const after = C.finalizeStates(keys, states, true);
  assert.deepEqual(keys.map(k => after[k]), ['done', 'failed', 'cancelled', 'cancelled']);
  assert.deepEqual(keys.map(k => C.finalizeStates(keys, states, false)[k]), ['done', 'failed', 'idle', 'idle'], 'a halted (not user-cancelled) run leaves the rest not started');
  assert.equal(C.countReads(keys, after).cancelled, 2);
  // coverage never comes from these states: only from the server cache
  assert.equal(C.coverageNumbers([row('a', 'A-1', [])], ['2026-11-01']).reviewed, 0);
});

test('cache expiry: days that left the cache are reported as expired, never silently counted, and are not re-fetched by the helper', () => {
  const prev = new Set(['a|2026-11-01', 'a|2026-11-02']), cur = new Set(['a|2026-11-02']);
  assert.deepEqual(C.expiredSince(prev, cur), ['a|2026-11-01']);
  assert.deepEqual(C.expiredSince(cur, prev), []);
  const src = read('lib/fleet-coverage-review.ts'); assert.doesNotMatch(src, /fetch\(|forth/i.replace ? /fetch\(/ : /fetch\(/);
  const ui = read('components/fleet-fuel-report.tsx');
  assert.match(ui, /data-cache-expired/); assert.match(ui, /not fetched again automatically/);
});

test('the existing queue is reused: one at a time, stops on rate limit, aborts between requests, and collapses duplicate days', async () => {
  const seen = []; const states = {};
  const ids = ['a|2026-11-01', 'a|2026-11-01', 'b|2026-11-01', 'c|2026-11-01', 'd|2026-11-01'];
  let inFlight = 0, maxInFlight = 0;
  const out = await Q.runReadQueue(ids, async id => { inFlight++; maxInFlight = Math.max(maxInFlight, inFlight); seen.push(id); await new Promise(r => setTimeout(r, 2)); inFlight--; return { status: id.startsWith('c') ? 429 : 200 }; }, { concurrency: 1, onState: (id, s) => { states[id] = s; } });
  assert.deepEqual(seen, ['a|2026-11-01', 'b|2026-11-01', 'c|2026-11-01'], 'duplicate requested once, halted at the rate limit, d never requested');
  assert.equal(maxInFlight, 1); assert.equal(states['c|2026-11-01'], 'rate_limited'); assert.equal(states['d|2026-11-01'], 'idle');
  assert.equal(out.length, 3);
  // cancellation between requests: finished work is kept
  const controller = new AbortController(); const done = [];
  const out2 = await Q.runReadQueue(['x|2026-11-01', 'y|2026-11-01', 'z|2026-11-01'], async (id, signal) => { done.push(id); if (id.startsWith('x')) controller.abort(); return { status: 200 }; }, { signal: controller.signal });
  assert.deepEqual(done, ['x|2026-11-01'], 'nothing new starts after Stop'); assert.equal(out2[0].result, 'done', 'the request already in flight still completed and is kept');
});

test('no Forth request on navigation: the provider route is called only from the explicit start button; coverage refresh never reads Forth or fuel', () => {
  const ui = read('components/fleet-fuel-report.tsx');
  assert.equal((ui.match(/evidence\/provider/g) || []).length, 1, 'one call site');
  assert.ok(ui.indexOf('evidence/provider') > ui.indexOf('async function startReview'));
  assert.doesNotMatch(ui, /useEffect\(\(\) => \{ void (startReview|read)\(/);
  const refresh = ui.slice(ui.indexOf('async function refreshCoverage'), ui.indexOf('const coverageRows'));
  assert.doesNotMatch(refresh, /evidence\/(provider|fuel)\b/); assert.match(refresh, /fleet-period/); assert.match(refresh, /period\.current !== stamp/, 'a stale answer for another period is dropped');
  assert.match(ui, /if \(state === "done"\) void refreshCoverage\(false\)/); assert.match(ui, /await refreshCoverage\(true\)/);
  assert.match(ui, /runAbort\.current\?\.abort\(\); setReads\(\{\}\)/, 'changing the period aborts a running review');
  const centre = read('components/forth-tracking-centre.tsx');
  const fn = centre.slice(centre.indexOf('const openFuelOversightVehicle'), centre.indexOf('const openVehicleWorkspace')); assert.doesNotMatch(fn, /fetch\(|startReview|provider/);
});

test('server: coverage is user-scoped (the cache key includes the user), authorised, GET-only and exposes only the earliest expiry', () => {
  const session = read('lib/fleet-intelligence-session.ts'); assert.match(session, /const key = \(userId: string/);
  const route = read('app/api/admin/forth-tracking/evidence/fleet-period/route.ts');
  assert.match(route, /recalledProviderDayEntry\(user\.id,/); assert.match(route, /requireFleetOfficeAccess\(request\)/); assert.doesNotMatch(route, /export async function (POST|PUT|PATCH|DELETE)/); assert.match(route, /earliestExpiresAt/);
  const provider = read('app/api/admin/forth-tracking/evidence/provider/route.ts');
  assert.match(provider, /requireFleetOfficeAccess/); assert.match(provider, /beginForthHistoryRateLimit/); assert.match(provider, /recalledProviderDayEntry\(user\.id/, 'a repeated read is served from this user\'s own cache');
});

// ---------- fuel period comparability ----------
const fd = (day, km, reconciled = true) => ({ day, providerKm: km, reconciled });
const iv = (fromDate, toDate, km, withheld = null) => ({ fromDate, toDate, km, withheld });

test('comparability: complete reviewed days give a RANGE (boundary days are partly outside); unreviewed days are not comparable; nothing becomes zero', () => {
  const all = ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04'].map((d, i) => fd(d, [10, 100, 120, 20][i]));
  const within = F.compareIntervalToForth(iv('2026-11-01', '2026-11-04', 230), all);
  assert.equal(within.status, 'within_range'); assert.deepEqual([within.lowerKm, within.upperKm], [220, 250]);
  const outside = F.compareIntervalToForth(iv('2026-11-01', '2026-11-04', 400), all);
  assert.equal(outside.status, 'outside_range'); assert.equal(outside.gapKm, 150);
  const low = F.compareIntervalToForth(iv('2026-11-01', '2026-11-04', 100), all); assert.equal(low.status, 'outside_range'); assert.equal(low.gapKm, 120);
  const partial = F.compareIntervalToForth(iv('2026-11-01', '2026-11-04', 230), all.slice(0, 3));
  assert.equal(partial.status, 'not_comparable'); assert.equal(partial.reason, 'forth_days_not_reviewed'); assert.deepEqual(partial.missingDays, ['2026-11-04']); assert.equal(partial.reviewedDays, 3);
  assert.equal('lowerKm' in partial, false, 'no figure is produced for an incomplete interval');
});

test('comparability: different interval boundaries, same-day interval, date-only proxy and Bangkok day keys', () => {
  const days = ['2026-11-02', '2026-11-03', '2026-11-04'].map(d => fd(d, 50));
  const a = F.compareIntervalToForth(iv('2026-11-02', '2026-11-04', 60), days); assert.deepEqual([a.lowerKm, a.upperKm], [50, 150], 'only the interior day is certain');
  const b = F.compareIntervalToForth(iv('2026-11-03', '2026-11-03', 20), days); assert.deepEqual([b.lowerKm, b.upperKm], [0, 50], 'a same-day interval: the whole day is a boundary day');
  const c = F.compareIntervalToForth(iv('2026-11-03', '2026-11-04', 30), days); assert.deepEqual([c.lowerKm, c.upperKm], [0, 100], 'adjacent days: no interior day');
  assert.equal(c.boundaryDaysPartlyOutside, true);
  assert.equal(F.daysInclusive('2026-11-01', '2026-11-03').length, 3); assert.deepEqual(F.daysInclusive('2026-12-31', '2027-01-01'), ['2026-12-31', '2027-01-01']);
  assert.equal(F.compareIntervalToForth(iv('2026-11-05', '2026-11-04', 10), days).reason, 'invalid_interval');
});

test('comparability: missing reports, unknown or withheld odometer distance, duplicate Forth days', () => {
  const days = ['2026-11-01', '2026-11-02'].map(d => fd(d, 40));
  assert.equal(F.compareIntervalToForth(iv('2026-11-01', '2026-11-02', 50), [fd('2026-11-01', 40), fd('2026-11-02', 40, false)]).reason, 'forth_day_not_reconciled', 'a missing or non-reconciling report is not used');
  assert.equal(F.compareIntervalToForth(iv('2026-11-01', '2026-11-02', 50), [fd('2026-11-01', 40), fd('2026-11-02', null)]).reason, 'forth_day_not_reconciled', 'unknown Forth km is not zero');
  assert.equal(F.compareIntervalToForth(iv('2026-11-01', '2026-11-02', null), days).reason, 'odometer_unknown');
  assert.equal(F.compareIntervalToForth(iv('2026-11-01', '2026-11-02', null, 'odometer_decrease_requires_review'), days).reason, 'odometer_withheld');
  assert.equal(F.compareIntervalToForth(iv('2026-11-01', '2026-11-02', 60), [...days, fd('2026-11-01', 9999)]).upperKm, 80, 'a duplicate day is counted once');
  assert.equal(F.compareIntervalToForth(iv('2026-11-01', '2026-11-02', 0, 'identical_odometer_review'), days).status, 'within_range', 'identical readings are a 0 km reading, still compared as recorded');
});

test('fuel evidence integration: mixed fuel types, missing costs/quantities and several readings on one day stay as recorded, and purchased litres never enter a comparison', () => {
  const V = load('lib/fleet-fuel-view.ts');
  const reg = [{ id: 'v1', vehicle_reg: 'X-1' }];
  const rows = [
    { id: '1', date: '2026-11-02', vehicle_reg: 'X-1', fuel_type: 'diesel', litres: 50, total_cost: 1750, odometer: 1000, created_at: '2026-11-02T01:00:00Z' },
    { id: '2', date: '2026-11-02', vehicle_reg: 'X-1', fuel_type: 'lpg', litres: 20, total_cost: null, odometer: 1050, created_at: '2026-11-02T08:00:00Z' },
    { id: '3', date: '2026-11-03', vehicle_reg: 'X-1', fuel_type: 'diesel', litres: null, total_cost: 900, odometer: 1250, created_at: '2026-11-03T08:00:00Z' },
    { id: '1', date: '2026-11-02', vehicle_reg: 'X-1', fuel_type: 'diesel', litres: 50, total_cost: 1750, odometer: 1000, created_at: '2026-11-02T01:00:00Z' }
  ];
  const s = V.summarizeFuelRange(reg, rows, { from: '2026-11-01', to: '2026-11-04' });
  const v = s.vehicles[0]; assert.equal(s.fleet.duplicateSourceRows, 1); assert.equal(v.records, 3);
  assert.equal(v.litres, null, 'mixed types: no single litre figure'); assert.deepEqual(v.litresByType.map(g => g.fuelType).sort(), ['diesel', 'lpg']);
  assert.equal(v.costThb, null, 'a missing cost makes the total unknown, never zero'); assert.equal(v.litresByType.find(g => g.fuelType === 'diesel').litres, null, 'a missing quantity keeps that type unknown');
  assert.equal(v.intervals.length, 2); assert.equal(v.intervals[0].km, 50, 'two readings on one day are ordered by entry time');
  const cmp = F.compareIntervalToForth({ fromDate: v.intervals[0].from.date, toDate: v.intervals[0].to.date, km: v.intervals[0].km, withheld: v.intervals[0].withheld }, [fd('2026-11-02', 70)]);
  assert.deepEqual([cmp.status, cmp.lowerKm, cmp.upperKm], ['within_range', 0, 70]);
  assert.doesNotMatch(read('lib/fleet-fuel-comparability.ts').replace(/\/\*[\s\S]*?\*\//g, ''), /litres|consum|km\/L|perLitre/i);
});

// ---------- exception classes ----------
test('exceptions are classified (observed / candidate / insufficient), never High, and never claim a fault, inactivity or a financial discrepancy', () => {
  for (const k of Object.keys(O.OVERSIGHT_ISSUE_COPY)) assert.ok(['observed', 'candidate', 'insufficient'].includes(O.ISSUE_CLASS[k]), k);
  assert.equal(O.ISSUE_CLASS.positions_not_verified, 'observed'); assert.equal(O.ISSUE_CLASS.distance_sources_disagree, 'candidate'); assert.equal(O.ISSUE_CLASS.fuel_without_forth_review, 'insufficient');
  const copy = JSON.stringify(O.OVERSIGHT_ISSUE_COPY);
  assert.match(copy, /does not show a faulty tracker/); assert.match(copy, /not evidence that the vehicle was idle/); assert.match(copy, /not a discrepancy/);
  assert.doesNotMatch(copy, /equipment failure|tracker (is )?broken|stolen|misconduct|fraud|(?<!not a )violation/i);
  for (const c of Object.values(O.CLASS_COPY)) assert.ok(/[฀-๿]/.test(c[1]));
  const cov = (id, reg, over = {}) => ({ vehicleId: id, registration: reg, vehicleType: null, registryStatus: 'active', reviewedDays: 1, verifiedDays: 0, partlyVerifiedDays: 0, unverifiedDays: 1, noPositionDays: 0, providerKm: 10, providerKmDays: 1, gpsKm: 9, gpsKmDays: 1, reviewedDayList: ['2026-11-02'], unverifiedDayList: ['2026-11-02'], ...over });
  const rows = O.buildOversightRows({ fuel: { status: 'not_loaded', vehicles: [] }, coverage: [cov('a', 'A-1', { gapDays: [{ day: '2026-11-02', minutes: 90 }], disagreeDays: [{ day: '2026-11-02', providerKm: 100, gpsKm: 60 }] })], calendarDays: 7 });
  assert.ok(rows[0].issues.every(i => i.severity !== 'high')); assert.equal(rows[0].issues.length, 3, 'three distinct issues, grouped per vehicle, not one per day');
});

// ---------- UI: Thai, responsive, structure ----------
test('Thai and English copy for the review states, and the fuel redesign structure', () => {
  for (const [k, [en, th]] of Object.entries(C.REVIEW_COPY)) { assert.ok(en && /[฀-๿]/.test(th), k); }
  assert.equal(C.reviewText('cacheExpired', 'th'), 'แคชหมดอายุ'); assert.equal(C.reviewText('openInvestigation', 'en'), 'Open investigation');
  for (const k of Object.keys(F.COMPARABILITY_COPY)) assert.ok(/[฀-๿]/.test(F.COMPARABILITY_COPY[k][1]), k);
  assert.match(F.comparabilityText({ status: 'not_comparable', reason: 'forth_days_not_reviewed', coveredDays: 4, reviewedDays: 3, missingDays: ['x'] }, 'th', n => String(n)), /เปรียบเทียบไม่ได้/);
  const panel = read('components/fleet-fuel-panel.tsx');
  assert.ok(panel.indexOf('data-fuel-summary') < panel.indexOf('data-fuel-table') && panel.indexOf('data-fuel-table') < panel.indexOf('data-odometer-details'), 'summary, then transactions, then the secondary odometer comparison');
  assert.match(panel, /<details className="v72-evidence v782-secondary" data-odometer-details>/); assert.doesNotMatch(panel, /km\/L [=:]|consumed litres [=:]/);
  for (const h of ['Fuel type', 'Litres', 'Cost (฿)', 'Odometer (km)', 'Data quality']) assert.ok(panel.includes(`"${h}"`), h);
  assert.match(panel, /Never added across types\. LPG stays separate\./);
  const ev = read('components/fleet-evidence-panel.tsx'); assert.ok(ev.indexOf('<FleetFuelPanel') < ev.indexOf('data-day-evidence'), 'day-by-day evidence is below the fuel review');
});

test('responsive: tables become stacked cards on phones with a label on every cell and 44px-class actions', () => {
  const css = read('components/fleet-tracking-v73.css');
  assert.match(css, /table\.v782-cards tr \{ display: grid/); assert.match(css, /content: attr\(data-label\)/); assert.match(css, /\.v782-actions button \{ flex: 1 1 100%/);
  for (const file of ['components/fleet-fuel-panel.tsx', 'components/fleet-vehicle-investigation.tsx']) {
    const src = read(file); const bodies = src.match(/<td[^>]*>/g) || []; const labelled = bodies.filter(b => /data-label/.test(b)).length;
    assert.ok(labelled >= 5, `${file} labels its cells (${labelled})`);
  }
  assert.doesNotMatch(read('components/fleet-vehicle-investigation.tsx'), /v781-c-(gps|ver|gap)/, 'no critical column is hidden on phones any more');
});

test('Thai rendering of the new Reports panel and the Fuel review shell', () => {
  const React = require('react'); const { renderToString } = require('react-dom/server');
  const { FleetFuelPanel } = load('components/fleet-fuel-panel.tsx');
  const en = renderToString(React.createElement(FleetFuelPanel, { vehicleId: 'v1', registration: '3ฒน-9565', language: 'en' })).replace(/<!-- -->/g, '');
  const th = renderToString(React.createElement(FleetFuelPanel, { vehicleId: 'v1', registration: '3ฒน-9565', language: 'th' })).replace(/<!-- -->/g, '');
  assert.match(en, /Fuel review · 3ฒน-9565/); assert.match(en, /Nothing is read until you do/); assert.match(th, /ตรวจสอบเชื้อเพลิง · 3ฒน-9565/); assert.match(th, /จะไม่มีการอ่านจนกว่าจะกด/);
  const report = read('components/fleet-fuel-report.tsx');
  for (const s of ['Historical coverage review', 'ตรวจความครอบคลุมข้อมูลย้อนหลัง', 'Stop after the current request', 'หยุดหลังคำขอปัจจุบัน', 'cannot be undone', 'ย้อนกลับไม่ได้', 'Bounded batch of recent missing days', 'Selected vehicle']) assert.ok(report.includes(s), s);
});

test('regression: the period chosen in Reports seeds the vehicle workspaces (the seed date check used a broken pattern that always rejected it)', () => {
  const ev = read('components/fleet-evidence-panel.tsx');
  assert.match(ev, /initialScope && \/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$\/\.test\(initialScope\.from\)/);
  assert.doesNotMatch(ev, /\/\^d\{4\}-d\{2\}-d\{2\}\$\//, 'a regex written without backslashes matches the letter d, not digits');
  const panel = read('components/fleet-vehicle-investigation.tsx'); assert.match(panel, /row\.reviewedDays\]\);/, 'the investigation panel reloads (cache-only) when its vehicle gains a reviewed day');
});
