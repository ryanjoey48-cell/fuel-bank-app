// V7.8.4: Daily Activity narrative rendering (EN/TH, fixtures), cross-midnight card, Live Fleet matrix, shared URL context, and the language /
// auth-gate fix. Fixtures only: no network, no Forth, no database. The "30 Oct" fixture follows the figures of the earlier screenshot
// (664/664 verified, GPS 116.56 km, trail 119.33 km, provider total withheld, no ledger gap) but is a fixture, not a fresh read.
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
  m.require = r => { if (r === 'server-only') return {}; if (r === '@/lib/supabase') return { supabase: {} }; if (r === 'next/link') return { __esModule: true, default: props => require('react').createElement('a', { href: props.href }, props.children) };
    if (r.startsWith('@/')) { const f = resolve(r.slice(2)); if (f) return load(f, cache); }
    if (r.startsWith('.')) { const f = resolve(path.relative(root, path.resolve(path.dirname(file), r))); if (f) return load(f, cache); }
    return require(r); };
  m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, file); return m.exports;
}
const React = require('react'); const { renderToStaticMarkup } = require('react-dom/server');
const N = load('components/fleet-day-narrative.tsx');
const U = load('lib/fleet-scope-url.ts');
const M = load('lib/fleet-live-matrix.ts');
const view = load('lib/forth-tracking-view.ts');

const D = '2026-10-30';
const T = (hm, day = D) => `${day}T${hm.length === 5 ? hm + ':00' : hm}+07:00`;
const NEXT_MIDNIGHT = (day) => `${new Date(Date.parse(`${day}T00:00:00Z`) + 86400000).toISOString().slice(0, 10)}T00:00:00+07:00`;
const seg = (a, b, state, km = null, reason = null, day = D) => ({ start: T(a, day), end: b === '24:00' ? NEXT_MIDNIGHT(day) : T(b, day), state, reason, km });
const jny = (id, a, b, km, over = {}) => ({ id, segmentId: id, start: T(a), end: b ? T(b) : null, kind: b ? (km > 0 ? 'moving' : 'stopped') : 'open_final', minutes: b ? 1 : null, providerKm: km, observations: 5, movingObservations: 3, engineOnObservations: null, reportedTrailKm: null, verifiedGpsKm: null, positionSource: 'gps', gapsInside: 0, issues: [], ambiguous: false, ...over });
const ledgerOf = (journeys, over = {}) => ({ version: 'v4.4', journeys, missing: [], outsideReport: [], totals: { outsideReportMinutes: 0, outsideReportLogKm: null, cadenceJitterGaps: 3, providerKm: 0, movingJourneys: journeys.filter(j => j.kind === 'moving').length, stops: 0, openFinal: journeys.filter(j => j.kind === 'open_final').length, ambiguousJourneys: 0, reportedTrailKm: 119.33, verifiedGpsKm: null, observations: 664, duplicateObservations: 0, positionSource: 'gps', missingMinutes: 0, ...over }, ...over.ledger });
const providerOf = ({ day = D, journeys, timeline, withheld = true, observations = 664, verified = 664, gpsKm = 116.56 }) => ({
  day, logAvailable: true, journeyLedger: ledgerOf(journeys),
  gps: { observedKm: gpsKm, coveredSeconds: 0, unknownSeconds: 0, complete: false, observations, verifiedObservations: verified, timeline, firstVerifiedAt: null, lastVerifiedAt: null },
  provider: { arithmetic: { status: withheld ? 'not_comparable' : 'pass', reason: 'missing_numeric_evidence', difference: null }, providerAssertedTotalKm: 119.4, segments: journeys.filter(j => j.kind !== 'open_final').map(j => ({ id: j.id, start: j.start, end: j.end, km: j.providerKm })), issues: withheld ? ['overlapping_segments'] : [], duplicates: 0, foreignRows: 0 },
  sources: { providerReported: { value: withheld ? null : 119.4 }, gpsDerived: { value: gpsKm } }
});
// 30 Oct fixture: two visits with movements inside them, a withheld provider total, and only ordinary 10-minute missed reports (no ledger gap)
const timeline30 = [seg('00:00', '08:00', 'stopped', 0), seg('08:00', '08:10', 'unavailable', null, 'sample_gap'), seg('08:10', '10:20', 'stopped', 0), seg('10:20', '10:30', 'unavailable', null, 'sample_gap'), seg('10:30', '10:36:10', 'stopped', 0), seg('10:36:10', '10:37:05', 'moving', 0.4), seg('10:37:05', '13:21:30', 'stopped', 0), seg('13:21:30', '13:23', 'moving', 0.2), seg('13:23', '14:07', 'stopped', 0), seg('14:07', '14:08:30', 'moving', 0.3), seg('14:08:30', '15:55', 'stopped', 0), seg('15:55', '16:05', 'unavailable', null, 'sample_gap'), seg('16:05', '24:00', 'stopped', 0)];
const journeys30 = [jny('J01', '10:36:10', '10:37:05', 0.4), jny('J02', '17:00', '17:40', 25)];
const match = () => ({ status: 'unknown_stopping_area', reasons: [], uncertainty: [], primary: null, alternatives: [] });
const stp = (id, a, b, m) => ({ id, firstAt: T(a), lastAt: T(b), observedMinutes: m, observations: 10, sourceQuality: 'verified_gps', nextToGap: false, matchStatus: 'unknown_stopping_area', matchName: null });
const visit = (id, a, b, stops, joins, openMin) => ({ id, stops, joins, arrivalWindow: { earliest: null, latest: T(a) }, departureWindow: { earliest: T(b), latest: null }, firstAt: T(a), lastAt: T(b), observedMinutes: stops.reduce((n, s) => n + s.observedMinutes, 0), spanMinutes: Math.round((Date.parse(T(b)) - Date.parse(T(a))) / 60000), maxMinutes: null, sourceQuality: 'verified_gps', openStart: false, openEnd: false, nextToGap: false, interruptions: joins.length, observations: 20, match: match(), stopLevelNames: [] });
const visits30 = [visit('V01', '10:06', '10:59', [stp('S01', '10:06', '10:35', 29), stp('S02', '10:38', '10:59', 21)], [{ fromStopId: 'S01', toStopId: 'S02', interruptionMinutes: 3, separationM: 40, observationsBetween: 2, farthestBetweenM: 40, maxSpeedBetweenKph: 12, missingReport: false }]), visit('V02', '13:17', '15:55', [stp('S03', '13:17', '15:55', 158)], [])];
const actions = { selectedId: null, onViewLocation: () => undefined, onViewRoute: () => undefined, onOpenInJourneys: () => undefined };
const html = (lang, over = {}) => renderToStaticMarkup(React.createElement(N.FleetDayNarrative, { language: lang, day: D, provider: providerOf({ journeys: journeys30, timeline: timeline30 }), restricted: false, visits: visits30, previousDay: null, nextDay: null, nextDayRequested: false, actions, ...over })).replace(/<!-- -->/g, '');

test('30 Oct fixture (EN): the visit window, the movement inside it and the withheld provider total are each explained, with nothing confirmed', () => {
  const h = html('en');
  assert.match(h, /data-v784-narrative/); assert.match(h, /data-coverage-card/); assert.match(h, /data-provider-withheld/);
  // the summary now lives in ONE place (the operating summary above the narrative): the narrative repeats no headline and no review list
  assert.doesNotMatch(h, /data-day-headline|data-day-review|v784-headline/);
  // the provider total is explained and the three figures stay apart (withheld, GPS 116.56, trail)
  assert.match(h, /116\.56/);
  // chronology: visit window with supported/bridged durations, the movement nested; the 0.2/0.3 km movements in the single-stop visit are site-scale, not a departure
  assert.match(h, /data-chrono-kind="visit"/); assert.match(h, /data-chrono-kind="movement_in_visit"/); assert.match(h, /Possible site visit/); assert.match(h, /Movement within visit/);
  assert.match(h, /supported stationary ≥/); assert.match(h, /between two stops the grouping joined/); assert.match(h, /Site-scale movement \(under 300 m\)/); assert.match(h, /possible repositioning, not a departure/);
  // coverage: separate metrics; zero ledger gaps beside unobserved time is explained, and unobserved is never stationary
  assert.match(h, /provider log gaps over 10 minutes/); assert.match(h, /Every position that arrived is verified, but that does not mean the whole day was tracked/);
  assert.match(h, /only counts spacing over 10 minutes/); assert.match(h, /never counted as stationary/);
  // provider total: reasons and the three separate figures
  assert.match(h, /data-withhold-code="overlapping_segments"/); assert.match(h, /Reported trail \(log\), a different source/); assert.match(h, /119\.33/);
  assert.match(h, /None of them is accepted as the provider total/);
  assert.doesNotMatch(h, /(?<!not )confirmed (visit|delivery|pickup)|delivered|picked up|completed job|speeding|misconduct/i);
});

test('30 Oct fixture (TH): the same narrative renders in Thai', () => {
  const h = html('th');
  for (const s of ['หลักฐานครบถ้วนแค่ไหน', 'เหตุใดจึงระงับยอดรวมรายวันของ Forth', 'อาจเป็นการเข้าสถานที่', 'เคลื่อนที่ภายในการเข้าเยี่ยม', 'ไม่ได้สังเกต', 'ถูกระงับ', 'ไทม์ไลน์กิจกรรม']) assert.ok(h.includes(s), s);
  assert.match(h, /การนับเวลาและคำนิยาม/);
});

test('inspection: a movement that overlaps a visit window is never trimmed away; source and total accounting add up once', () => {
  const h = html('en');
  assert.match(h, /data-bucket="contested"/); assert.match(h, /data-bucket="unobserved"/); assert.match(h, /data-bucket="stationary_bridged"/);
  assert.match(h, /Every second of the elapsed day is counted once/);
});

test('cross-midnight card: shown only when both days are already read; the 1–2 Nov shape renders GPS-observed km separately; a missing next day asks for nothing', () => {
  const D1 = '2026-11-01', D2 = '2026-11-02';
  const prev = providerOf({ day: D1, journeys: [{ ...jny('J05', '22:24:17', '22:58:24', 32.33), start: T('22:24:17', D1), end: T('22:58:24', D1) }, { ...jny('J06', '23:57:32', null, 0), start: T('23:57:32', D1) }], timeline: [seg('22:23:18', '22:58:24', 'moving', 32.4, null, D1), seg('22:58:24', '23:55:30', 'idling', 0, null, D1), seg('23:55:30', '23:59:33', 'moving', 3.41, null, D1), seg('23:59:33', '24:00', 'unavailable', null, 'missing_samples', D1)], withheld: false });
  const nextP = providerOf({ day: D2, journeys: [{ ...jny('J01', '06:20:38', '08:12:54', 137.67), start: T('06:20:38', D2), end: T('08:12:54', D2) }], timeline: [seg('00:00', '00:00:33', 'unavailable', null, 'missing_samples', D2), seg('00:00:33', '03:31:07', 'moving', 220.29, null, D2), seg('03:31:07', '03:34:08', 'idling', 0, null, D2), seg('03:34:08', '04:36:17', 'moving', 84, null, D2), seg('04:36:17', '06:18:38', 'idling', 0, null, D2), seg('06:18:38', '08:12:54', 'moving', 137.53, null, D2)], withheld: false });
  const withBoth = renderToStaticMarkup(React.createElement(N.FleetDayNarrative, { language: 'en', day: D1, provider: prev, restricted: false, visits: [], previousDay: null, nextDay: nextP, nextDayRequested: true, actions })).replace(/<!-- -->/g, '');
  assert.match(withBoth, /data-cross-midnight="continuation_observed"/); assert.match(withBoth, /307\.7/); assert.match(withBoth, /none found/); assert.match(withBoth, /Forth&#x27;s totals are unchanged|Forth's totals are unchanged/);
  assert.match(withBoth, /Why Forth left it out is not established/);
  const alone = renderToStaticMarkup(React.createElement(N.FleetDayNarrative, { language: 'en', day: D1, provider: prev, restricted: false, visits: [], previousDay: null, nextDay: null, nextDayRequested: false, actions })).replace(/<!-- -->/g, '');
  assert.match(alone, /data-cross-midnight="next_day_not_reviewed"/); assert.match(alone, /Include 2026-11-02 in the range/); assert.doesNotMatch(alone, /307\.7/);
  const th = renderToStaticMarkup(React.createElement(N.FleetDayNarrative, { language: 'th', day: D1, provider: prev, restricted: false, visits: [], previousDay: null, nextDay: nextP, nextDayRequested: true, actions }));
  assert.match(th, /ข้ามเที่ยงคืนไปวันถัดไป/);
});

test('historical authorisation: a restricted caller or an unread day renders nothing; a snapshot without a ledger says so', () => {
  assert.equal(html('en', { restricted: true }), ''); assert.equal(html('en', { provider: null }), '');
  const old = html('en', { provider: { ...providerOf({ journeys: journeys30, timeline: timeline30 }), journeyLedger: null } }); assert.match(old, /predates journey analysis/);
});

test('the narrative and its panel wiring cannot start a Forth read: no fetch, no provider route, no effect; neighbouring days come only from the loaded range', () => {
  const src = read('components/fleet-day-narrative.tsx');
  assert.doesNotMatch(src, /fetch\(|supabase|evidence\/provider|history\/playback|history\/journeys|useEffect|XMLHttpRequest/);
  assert.doesNotMatch(src, /latitude|longitude|coordinates?\b.*=/i);
  const panel = read('components/fleet-evidence-panel.tsx');
  assert.match(panel, /<FleetDayNarrative[^>]*previousDay=\{data\?\.activityDays\?\.find\(d => d\.day === prevDayOf\(activeDay\)\)\?\.provider \?\? null\}[^>]*nextDay=\{data\?\.activityDays\?\.find\(d => d\.day === nextBangkokDay\(activeDay\)\)\?\.provider \?\? null\}/);
  assert.match(panel, /visits=\{dayPlaces\.data\?\.read \? dayPlaces\.data\.visits : null\}/);
  // the original visit table and technical evidence stay available (collapsed), and the old flat timeline is no longer the primary view
  assert.match(panel, /data-daily-visit-details/); assert.match(panel, /data-tracking-evidence/); assert.doesNotMatch(panel, /<FleetDayTimeline/);
});

// ---------- Live Fleet matrix
const base = { gpsDeviceId: 'dev', vehicleRegistration: 'AA-1', timestampStatus: 'current', coordinateStatus: 'valid', latitude: 13.7, longitude: 100.5, speed: 0, engineOn: false, gpsConnectivity: 'connected', gprsConnectivity: 'connected', positionQuality: 'gps' };
const rec = (o = {}) => ({ ...base, ...o });
test('live matrix: every vehicle is in exactly one cell, the cells add up to the tracked total, and verified + unverified equals the total', () => {
  const fleet = [rec(), rec({ speed: 40, engineOn: true }), rec({ positionQuality: 'no_gps' }), rec({ positionQuality: 'no_gps', speed: 30, engineOn: true }), rec({ timestampStatus: 'stale' }), rec({ coordinateStatus: 'missing', latitude: null, longitude: null }), rec({ speed: 40, engineOn: false })];
  const m = M.liveStatusMatrix(fleet);
  assert.equal(m.total, 7); assert.equal(m.partitions, true); assert.equal(Object.values(m.cells).reduce((a, b) => a + b, 0), 7);
  assert.deepEqual(m.cells, { moving_verified: 1, moving_unverified: 1, stationary_verified: 1, stationary_unverified: 1, stale_or_missing: 2, uncertain: 1 });
  assert.equal(m.verified + m.unverified, 7);
  assert.equal(M.liveCellOf(rec({ timestampStatus: 'stale', speed: 62, engineOn: true })), 'stale_or_missing', 'a stale position is never "moving"');
});

test('live matrix: it agrees with the headline summary and the verified filter, and the hidden-by-verified-only count is exact', () => {
  const fleet = [rec(), rec({ speed: 50, engineOn: true }), rec({ positionQuality: 'no_gps', speed: 30, engineOn: true }), rec({ positionQuality: 'no_gps' }), rec({ gpsConnectivity: 'disconnected' }), rec({ timestampStatus: 'stale' })];
  const m = M.liveStatusMatrix(fleet), s = view.summarizeForthFleet(fleet);
  assert.equal(m.verified, s.positionConfidence.gpsVerified); assert.equal(m.unverified, s.positionConfidence.notGpsVerified);
  assert.equal(m.verified, s.currentGpsVerifiedPositions, 'the matrix and the "GPS verified" chip use the same rule');
  assert.equal(m.hiddenByVerifiedOnly.total, fleet.filter(r => !view.isForthGpsPositionVerified(r)).length);
  assert.equal(m.hiddenByVerifiedOnly.withCoordinates, fleet.filter(r => !view.isForthGpsPositionVerified(r) && r.coordinateStatus === 'valid').length);
  assert.ok(m.hiddenByVerifiedOnly.moving >= 1);
  const scoped = M.liveStatusMatrix(fleet.slice(0, 3)); assert.ok(scoped.hiddenByVerifiedOnly.total < m.hiddenByVerifiedOnly.total, 'a smaller scope hides fewer: the note follows the vehicle category in scope');
  assert.deepEqual(M.liveStatusMatrix([]).cells, { moving_verified: 0, moving_unverified: 0, stationary_verified: 0, stationary_unverified: 0, stale_or_missing: 0, uncertain: 0 });
  for (const c of M.LIVE_CELLS) { const [en, th] = M.LIVE_CELL_COPY[c].label; assert.ok(en && /[฀-๿]/.test(th)); }
});

test('live matrix UI: one compact line under the headline counts, partition flag exposed, the hidden note uses the in-scope matrix; no map overlay panel', () => {
  const c = read('components/forth-tracking-centre.tsx');
  assert.match(c, /data-live-matrix/); assert.match(c, /liveStatusMatrix\(fleetRecords\)/); assert.match(c, /liveMatrixInScope\.hiddenByVerifiedOnly\.total/); assert.match(c, /data-hidden-unverified/);
  assert.doesNotMatch(c, /summary\.positionConfidence\.notGpsVerified\} \{language === "th" \? "ซ่อน/, 'the old category-blind hidden count is gone');
});

// ---------- shared context: URL scope, language, auth gate
test('URL scope: valid ranges round-trip; bad, future, reversed or over-62-day ranges are ignored; other parameters survive; dates only', () => {
  const p = q => new URLSearchParams(q); const TODAY = '2026-11-10';
  assert.deepEqual(U.parseScopeParams(p('view=fuel&vehicle=3x&from=2026-11-01&to=2026-11-07'), TODAY), { from: '2026-11-01', to: '2026-11-07', day: '2026-11-07' });
  for (const bad of ['from=2026-11-08&to=2026-11-07', 'from=2026-11-01&to=2026-11-11', 'from=2026-02-30&to=2026-03-01', 'from=abc&to=def', 'from=2026-11-01', '', 'from=2026-08-01&to=2026-10-30']) assert.equal(U.parseScopeParams(p(bad), TODAY), null, bad);
  assert.ok(U.parseScopeParams(p('from=2026-09-10&to=2026-11-10'), TODAY), '62 days is allowed'); assert.equal(U.parseScopeParams(p('from=2026-09-09&to=2026-11-10'), TODAY), null, '63 days is not');
  const u = new URL('https://x.test/fleet-tracking?view=daily&vehicle=68-7154'); const w = U.withScopeParams(u, { from: '2026-11-01', to: '2026-11-07' });
  assert.equal(w.searchParams.get('view'), 'daily'); assert.equal(w.searchParams.get('vehicle'), '68-7154'); assert.equal(w.searchParams.get('from'), '2026-11-01');
  assert.equal(U.withScopeParams(w, null).search, '?view=daily&vehicle=68-7154'); assert.equal(U.withScopeParams(u, { from: 'x', to: 'y' }).search, u.search, 'an invalid scope is never written');
  assert.doesNotMatch(read('lib/fleet-scope-url.ts').replace(/\/\*[\s\S]*?\*\//g, ''), /latitude|longitude|token|Authorization|fetch\(/);
});

test('URL scope wiring: history steps keep the period, changing dates replaces (does not push) history, and reading the URL starts no request', () => {
  const c = read('components/forth-tracking-centre.tsx');
  assert.match(c, /const withScope = withScopeParams\(url, evidenceScope\);/); assert.match(c, /const urlScope = parseScopeParams\(params\);\s*if \(urlScope\) setEvidenceScope\(urlScope\);/);
  assert.match(c, /const popped = parseScopeParams\(query\);/); assert.match(c, /window\.history\.replaceState\(window\.history\.state, "", next\.pathname \+ next\.search\);/);
  const effect = c.slice(c.indexOf('// Keeps the address bar in step with the chosen period'), c.indexOf('// Keeps the address bar in step with the chosen period') + 700); assert.doesNotMatch(effect, /fetch\(|pushState|evidence\/provider/);
});

test('language switching: the session check no longer depends on the display language, so EN/TH cannot unmount the workspaces; the saved language is applied before first paint and saved only on user choice', () => {
  const layout = read('app/(dashboard)/layout.tsx');
  assert.match(layout, /const connectionFailedMessage = useRef\(t\.serviceUnavailable\.connectionFailed\);/); assert.match(layout, /connectionFailedMessage\.current = t\.serviceUnavailable\.connectionFailed;/);
  const deps = layout.match(/\}, \[financePreview, pathname, refresh, retryCount, router[^\]]*\]\);/); assert.ok(deps, 'the auth effect dependency list'); assert.doesNotMatch(deps[0], /serviceUnavailable|language|\bt\b/);
  assert.doesNotMatch(layout.slice(layout.indexOf('const checkSession'), layout.indexOf('void checkSession()')), /t\.serviceUnavailable\.connectionFailed/);
  const lp = read('lib/language-provider.tsx');
  assert.match(lp, /useIsomorphicLayoutEffect\(\(\) => \{\s*const saved = safeLocalStorage\.getItem\(STORAGE_KEY\)/); assert.match(lp, /document\.documentElement\.lang = saved;/);
  const initial = lp.slice(lp.indexOf('useEffect(() => {\n    document.documentElement.lang = language;'), lp.indexOf('const value = useMemo')); assert.doesNotMatch(initial.split('const chooseLanguage')[0], /setItem/, 'the default is never written back over the saved choice');
  assert.match(lp, /const chooseLanguage = useCallback\(\(next: Language\) => \{\s*setLanguage\(next\);\s*safeLocalStorage\.setItem\(STORAGE_KEY, next\);/); assert.match(lp, /setLanguage: chooseLanguage/);
  const root = read('app/layout.tsx'); assert.match(root, /<html lang="en">/, 'the shared root layout is unchanged');
});

// ---------- Reports order, shared period, translation guard, phone styles
test('Reports is management-first: headline figures, then the priority queue with its investigation panel, then the vehicle table, then the controlled review tool', () => {
  const r = read('components/fleet-fuel-report.tsx');
  const at = s => { const i = r.indexOf(s); assert.ok(i > 0, s); return i; };
  assert.ok(at('data-fuel-summary') < at('data-priority-queue')); assert.ok(at('data-priority-queue') < at('<FleetVehicleInvestigation'));
  assert.ok(at('<FleetVehicleInvestigation') < at('<h4>{t("Vehicle comparison"')); assert.ok(at('<h4>{t("Vehicle comparison"') < at('data-coverage-review'));
  assert.ok(at('data-coverage-review') < at('data-fuel-methodology'));
  assert.match(r, /data-needs-review/); assert.match(r, /const needReview = new Set\(groups\.flatMap\(g => g\.vehicles\.filter\(v => v\.severity !== "info"\)/);
  assert.match(r, /not a fault finding/); assert.match(r, /None of them is a finding of fault or misuse/);
  // the exception rules, investigation links and the explain action are all still there
  for (const s of ['data-explain-queue', 'Open Fuel Intelligence', 'Open Daily Activity', 'Investigate vehicle', 'groupOversightIssues(rows)']) assert.ok(r.includes(s), s);
});

test('the period is shared: Reports seeds its dates from the shared scope and reports user edits back, never reading anything by itself', () => {
  const r = read('components/fleet-fuel-report.tsx'), c = read('components/forth-tracking-centre.tsx');
  assert.match(r, /useState\(\(\) => initialScope\?\.from \?\? /); assert.match(r, /useState\(\(\) => initialScope\?\.to \?\? bangkokDateInput\(\)\)/);
  assert.match(r, /if \(event\.target\.value <= to\) onScopeChange\?\.\(\{ from: event\.target\.value, to \}\)/); assert.match(r, /if \(from <= event\.target\.value\) onScopeChange\?\.\(\{ from, to: event\.target\.value \}\)/);
  assert.match(c, /<FleetFuelReport language=\{language\} onVehicle=\{openFuelOversightVehicle\} initialScope=\{evidenceScope\} onScopeChange=\{\(scope\) => setEvidenceScope\(\{ \.\.\.scope, day: scope\.to \}\)\} \/>/);
  const read1 = r.slice(r.indexOf('export function FleetFuelReport'), r.indexOf('export function FleetFuelReport') + 1600); assert.doesNotMatch(read1, /useEffect\(\(\) => \{[^}]*read\(\)/);
});

test('machine translation cannot rewrite the evidence interface: the Fleet Tracking workspace is translate="no" and carries its own language', () => {
  const c = read('components/forth-tracking-centre.tsx');
  assert.match(c, /<main translate="no" lang=\{language\} className=\{`forth-tracking-workspace forth-v21 fleet-v7/);
  assert.equal((c.match(/translate="no"/g) || []).length, 1, 'scoped to the one workspace, not a global switch');
  assert.doesNotMatch(read('app/layout.tsx'), /translate=|notranslate/, 'the shared root layout is not touched');
});

test('phone and wide-desktop styles: narrative stacks on phones with 44px actions, the headline is two columns, and prose is capped on very wide screens', () => {
  const css = read('components/fleet-tracking-v73.css');
  const phone = css.slice(css.indexOf('/* V7.8.4 Daily Activity narrative'));
  assert.match(phone, /@media \(max-width: 760px\) \{[^}]*\.v784-headline \{ grid-template-columns: 1fr 1fr; \}/); assert.match(phone, /\.v784-row \{ grid-template-columns: minmax\(0, 1fr\); \}/);
  assert.match(phone, /\.v784-act button \{ min-height: 44px; \}/); assert.match(phone, /@media \(min-width: 1100px\) \{[^}]*\.v784-day:has\(\.v784-inspector\) \{ grid-template-columns: minmax\(0, 1\.7fr\) minmax\(300px, 1fr\); \}/);
  assert.match(css, /\.v784-coverage p[^{]*\{ max-inline-size: 80ch; \}/); assert.match(css, /\.v784-live-matrix/);
});

test('inspector accessibility: a named region, the heading takes focus on open, and Close returns focus to the control that opened it', () => {
  const n = read('components/fleet-day-narrative.tsx');
  assert.match(n, /role="region" aria-labelledby="v784-inspector-title"/); assert.match(n, /ref=\{headRef\} tabIndex=\{-1\}/);
  assert.match(n, /setTimeout\(\(\) => headRef\.current\?\.focus\(\), 0\)/); assert.match(n, /const el = opener\.current; setSelected\(null\);[^;]*; if \(el\) setTimeout\(\(\) => \{ if \(el\.isConnected\) el\.focus\(\); \}, 0\)/);
  assert.match(n, /aria-pressed=\{selected === r\.key\}/);
});

// ---------- real 30 Oct 2026 pattern (3ฒน-9565): figures from the one authorised read, encoded as a fixture. Times, states and km only; no coordinates.
const R = load('lib/fleet-day-narrative-model.ts'), K = load('lib/fleet-coverage-truth.ts'), C = load('lib/fleet-day-chronology.ts'), W = load('lib/fleet-provider-withhold.ts');
const SN = load('components/fleet-day-snapshot.tsx');
test('real 30 Oct pattern: every unobserved interval is a spacing just over the 5-minute limit or two of them back to back, so there is no outage, and the log gap count is genuinely zero', () => {
  // 48 single spacings of 301–310 s and 17 pairs of ~602 s, separated by observed stopped intervals, over a 24 h day (65 unobserved segments, as read).
  const tl = []; let t = Date.parse(T('00:00')); const END = Date.parse(NEXT_MIDNIGHT(D));
  const push = (sec, state, reason) => { tl.push({ start: new Date(t).toISOString(), end: new Date(t + sec * 1000).toISOString(), state, reason, km: state === 'unavailable' ? null : 0 }); t += sec * 1000; };
  for (let i = 0; i < 48; i++) { push(300, 'stopped', null); push(301 + (i % 10), 'unavailable', 'sample_gap'); }
  for (let i = 0; i < 17; i++) { push(300, 'stopped', null); push(602, 'unavailable', 'sample_gap'); }
  tl.push({ start: new Date(t).toISOString(), end: new Date(END).toISOString(), state: 'stopped', reason: null, km: 0 });
  const NOW = Date.parse('2026-11-11T00:00:00+07:00');
  const c = K.coverageTruth({ day: D, nowMs: NOW, receivedPositions: 664, verifiedPositions: 664, gpsTimeline: tl, ledger: { missingCount: 0, missingMinutes: 0, cadenceJitterGaps: 80, openFinal: 1 }, provider: { read: true, reconciled: false, issues: ['invalid_segment'] } });
  assert.deepEqual([c.time.short.intervals, c.time.chained.intervals, c.time.long.intervals], [48, 17, 0]); assert.equal(c.time.longestRunSeconds, 602);
  assert.equal(c.flags.verificationIsNotCoverage, true); assert.equal(c.flags.zeroLogGapsButUnobservedTime, true); assert.equal(c.positions.verifiedPct, 100);
  const m = C.fleetDayChronology({ day: D, nowMs: NOW, journeys: [], gps: tl, visits: [], providerLogGaps: [], noSpacingOverTenMinutes: true });
  assert.equal(m.rows.filter(r => r.kind === 'unknown').length, 0, 'chained marginal spacings are not listed as unknown intervals (they stay in the coverage figures)');
  assert.ok(C.fleetDayChronology({ day: D, nowMs: NOW, journeys: [], gps: tl, visits: [], providerLogGaps: [{ start: tl[1].start, end: tl[1].end, minutes: 10 }] }).rows.some(r => r.kind === 'unknown'), 'without the log evidence they are still shown');
  assert.equal(m.accounting.sumSeconds, m.accounting.windowSeconds);
});

test('real 30 Oct pattern: the provider total is withheld only by an unreadable row; the listed segments add up exactly to the report total, and all three figures stay separate', () => {
  const e = W.explainProviderTotal({ read: true, arithmeticStatus: 'not_comparable', arithmeticReason: 'missing_numeric_evidence', assertedTotalKm: 119.09, segments: [{ km: 44.61, end: 'x' }, { km: 0.08, end: 'x' }, { km: 17.05, end: 'x' }, { km: 31.75, end: 'x' }, { km: 4.41, end: 'x' }, { km: 0.08, end: 'x' }, { km: 0.08, end: 'x' }, { km: 8.67, end: 'x' }, { km: 12.36, end: 'x' }, { km: 0, end: null }], issues: ['invalid_segment'], reportedTrailKm: 119.33, gpsKm: 116.56 });
  assert.equal(e.state, 'withheld'); assert.deepEqual(e.reasons.map(r => r.code), ['invalid_segment']); assert.equal(e.segmentSumKm, 119.09); assert.equal(e.differenceKm, 0); assert.equal(e.sumMayBeIncomplete, true);
  assert.deepEqual([e.assertedTotalKm, e.reportedTrailKm, e.gpsKm], [119.09, 119.33, 116.56]); assert.equal(e.openSegments, 1);
});

test('real 30 Oct pattern: site-scale movements inside a visit (provider 80 m trips, GPS 29–89 m) are repositioning, not a departure, using the grouping evidence as read', () => {
  // V03 10:06:58–10:59:09: 3 stops, 2 joins (farthest 45 m / 63 m, top speed 9 / 22 km/h); a provider 0.08 km trip 10:36:04–10:37:05 inside the middle stop
  const st = (id, a, b) => ({ id, firstAt: T(a), lastAt: T(b), observedMinutes: 10 });
  const v = { id: 'V03', firstAt: T('10:06:58'), lastAt: T('10:59:09'), observedMinutes: 48, spanMinutes: 52, openStart: false, openEnd: false, stops: [st('S14', '10:06:58', '10:28:03'), st('S15', '10:30:03', '10:43:05'), st('S16', '10:46:05', '10:59:09')],
    joins: [{ fromStopId: 'S14', toStopId: 'S15', interruptionMinutes: 2, farthestBetweenM: 45, maxSpeedBetweenKph: 9, observationsBetween: 1, missingReport: false }, { fromStopId: 'S15', toStopId: 'S16', interruptionMinutes: 2, farthestBetweenM: 63, maxSpeedBetweenKph: 22, observationsBetween: 1, missingReport: false }] };
  const gps = [seg('00:00', '10:28:03', 'idling', 0), seg('10:28:03', '10:30:03', 'moving', 0.045), seg('10:30:03', '10:35:03', 'idling', 0), seg('10:35:03', '10:37:05', 'moving', 0.029), seg('10:37:05', '10:43:05', 'idling', 0), seg('10:43:05', '10:46:05', 'moving', 0.0796), seg('10:46:05', '24:00', 'idling', 0)];
  const r = C.fleetDayChronology({ day: D, nowMs: Date.parse('2026-11-11T00:00:00+07:00'), journeys: [jny('J03', '10:36:04', '10:37:05', 0.08)], gps, visits: [v] });
  const inside = r.rows.filter(x => x.kind === 'movement_in_visit').map(x => [x.movement.source, x.movement.relation, x.movement.pathKm]);
  assert.deepEqual(inside, [['gps_interval', 'within_site_between_stops', 0.045], ['provider_segment', 'site_scale_movement', 0.08], ['gps_interval', 'within_site_between_stops', 0.0796]]);
  assert.equal(r.rows[0].departure, 'repositioning_within_site'); assert.equal(r.overlaps.sourcesDisagree, 0);
  assert.deepEqual([r.rows[0].spanMinutes, r.rows[0].supportedMinutes, r.rows[0].bridgedMinutes], [52, 48, 4]);
});

test('one operating summary: the snapshot carries Forth Withheld, GPS km, time with evidence and the review reasons; the narrative repeats none of it; "Explain the difference" is kept', () => {
  const prov = providerOf({ journeys: journeys30, timeline: timeline30 });
  const model = R.buildDayNarrativeModel({ day: D, provider: prov, visits: visits30, previousDay: null, nextDay: null, nowMs: Date.parse('2026-11-11T00:00:00+07:00') });
  const op = R.operatingSummaryOf(model);
  assert.deepEqual(op.review.map(x => x.code), ['provider_withheld']); assert.equal(op.providerState, 'withheld'); assert.ok(op.timeSupportedPct > 90);
  const insights = { day: D, coverage: 'verified_incomplete', coverageReasons: [], activity: { movingJourneys: 2, stops: 1, movingMinutes: 41, stoppedMinutes: 0, longestStopMinutes: null, missingMinutes: 0, coverageShare: null, firstSegmentStart: null, lastSegmentEnd: null, startedMoving: null, endedMoving: null, observations: 664, verifiedObservations: 664 }, insights: [], positionCount: { received: 664, analysed: 664, exactDuplicates: 0, noValidTime: 0, explained: true } };
  const snap = (lang, over = {}) => renderToStaticMarkup(React.createElement(SN.FleetDaySnapshot, { provider: prov, model: insights, summary: { issues: [] }, registration: '3ฒน-9565', day: D, language: lang, restricted: false, visits: { supported: 2, gpsStops: 4, unknown: 2, gapAffected: 0 }, operating: op, ...over })).replace(/<!-- -->/g, '');
  const en = snap('en'); assert.match(en, /Withheld/); assert.match(en, /no provider km is shown/); assert.match(en, /data-time-evidence/); assert.match(en, /Time with evidence/); assert.match(en, /data-review-item="provider_withheld"/); assert.match(en, /Forth day total is withheld/);
  assert.match(en, /Needs attention<\/dt><dd><b>1</); assert.equal((en.match(/data-day-snapshot/g) || []).length, 1);
  const th = snap('th'); assert.match(th, /ถูกระงับ/); assert.match(th, /เวลาที่มีหลักฐาน/); assert.match(th, /ยอดรวมรายวันของ Forth ถูกระงับ/);
  // reconciled provider km that differ from GPS: the disagreement notice and the Explain action are preserved
  const agree = providerOf({ journeys: journeys30, timeline: timeline30, withheld: false, gpsKm: 20 });
  const ex = renderToStaticMarkup(React.createElement(SN.FleetDaySnapshot, { provider: agree, model: insights, summary: { issues: [] }, registration: '3ฒน-9565', day: D, language: 'en', restricted: false, onExplain: () => undefined, operating: null }));
  assert.match(ex, /data-distance-disagreement/); assert.match(ex, /data-explain-difference/); assert.match(ex, /Explain the difference/);
  // the page builds the model ONCE and hands the same object to both
  const panel = read('components/fleet-evidence-panel.tsx');
  assert.match(panel, /const dayNarrative = useMemo\(\(\) => buildDayNarrativeModel\(/); assert.match(panel, /<FleetDaySnapshot operating=\{operatingSummaryOf\(dayNarrative\)\}/); assert.match(panel, /<FleetDayNarrative model=\{dayNarrative\}/);
});

test("withheld card: when the listed segments add up exactly to the report total, it says so and still withholds (EN and TH)", () => {
  const p = providerOf({ journeys: journeys30, timeline: timeline30 });
  const sum = Math.round(p.provider.segments.reduce((n, x) => n + x.km * 100, 0)) / 100;
  const same = { ...p, provider: { ...p.provider, providerAssertedTotalKm: sum, issues: ["invalid_segment"] } };
  const en = html("en", { provider: same }), th = html("th", { provider: same });
  assert.match(en, /data-sum-matches/); assert.match(en, /add up exactly to the report&#x27;s own total|add up exactly to the report's own total/); assert.match(en, /still withheld/);
  assert.match(th, /data-sum-matches/); assert.match(th, /ต่าง 0.00 กม./);
  assert.doesNotMatch(html("en"), /data-sum-matches/, "not shown when the segments do not add up to the total");
});
