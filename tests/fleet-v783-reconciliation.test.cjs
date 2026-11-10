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
const R = load('lib/fleet-mileage-reconciliation.ts');
const L = load('lib/fleet-provider-request-log.ts');
const at = (h, m = 0) => `2026-11-02T${String(h - 7).padStart(2, '0')}:${String(m).padStart(2, '0')}:00.000Z`; // Bangkok local time
const seg = (id, h1, h2, km, end = true) => ({ id, start: at(h1), end: end ? at(h2) : null, km });
const tl = (h1, m1, h2, m2, state, km, reason = null) => ({ start: at(h1, m1), end: at(h2, m2), state, reason, km });
const jr = (id, kind, h1, h2, providerKm, gps) => ({ id, kind, start: at(h1), end: at(h2), minutes: (h2 - h1) * 60, providerKm, verifiedGpsKm: gps, reportedTrailKm: null, positionSource: 'gps', issues: [], ambiguous: false, observations: 12 });
function day(over = {}) {
  return {
    day: '2026-11-02', logAvailable: true, reportAvailable: true,
    sources: { providerReported: { value: 50 }, gpsDerived: { value: 65 } },
    provider: { arithmetic: { status: 'pass' }, segments: [seg('S1', 8, 9, 20), seg('S2', 9, 10, 0), seg('S3', 10, 11, 30)] },
    gps: { observedKm: 65, coveredSeconds: 70000, unknownSeconds: 16400, complete: false, observations: 100, verifiedObservations: 100,
      timeline: [tl(8, 0, 9, 0, 'moving', 22), tl(9, 0, 10, 0, 'stopped', 0), tl(10, 0, 11, 0, 'moving', 28), tl(12, 0, 12, 30, 'moving', 10), tl(13, 0, 13, 20, 'moving', 5)] },
    journeyLedger: { journeys: [jr('J1', 'moving', 8, 9, 20, 22), jr('J2', 'stopped', 9, 10, 0, 0), jr('J3', 'moving', 10, 11, 30, 28)], totals: { missingMinutes: 0, duplicateObservations: 3, verifiedGpsKm: 50, outsideReportLogKm: null } }, ...over
  };
}

test('daily reconciliation splits GPS km by where it lies, keeps both source figures, and the terms add up exactly to the difference', () => {
  const d = R.reconcileDay(day());
  assert.deepEqual([d.providerKm, d.gpsKm, d.differenceKm, d.absoluteKm], [50, 65, 15, 15]);
  assert.equal(d.percentOfLarger, 23.08);
  assert.deepEqual([d.attribution.insideMoving.km, d.attribution.insideStopped.km, d.attribution.outsideReport.km, d.attribution.unattributed.km], [50, 0, 15, 0]);
  assert.deepEqual([d.attribution.outsideReport.segments, d.attribution.outsideReport.minutes], [2, 50]);
  assert.deepEqual([d.outsideMovingKm, d.likeForLikeResidualKm], [15, 0]);
  assert.deepEqual(d.outsideWindows.map(w => w.km), [10, 5], 'largest outside windows first');
  assert.deepEqual(Object.keys(d.outsideWindows[0]).sort(), ['end', 'km', 'minutes', 'start'], 'times and km only: no coordinates');
  const a = d.attribution; assert.equal(Math.round((d.outsideMovingKm + d.likeForLikeResidualKm - a.providerUncomparedKm) * 100) / 100, d.differenceKm, 'difference = outside-moving + like-for-like residual - provider km without comparable GPS');
  assert.equal(Math.round((a.insideMoving.km + a.insideStopped.km + a.outsideReport.km + a.unattributed.km) * 100) / 100, d.gpsKm, 'every GPS km is in exactly one bucket: nothing double counted');
  assert.equal(d.status, 'comparable_disagreement'); assert.deepEqual(d.qualifiers, []);
  assert.equal(d.duplicatePositions, 3);
});

test('percentage denominator is the larger figure, symmetric, and unknown stays unknown', () => {
  assert.equal(R.percentOfLarger(100, 80), 20); assert.equal(R.percentOfLarger(80, 100), 20);
  assert.equal(R.percentOfLarger(0, 0), null); assert.equal(R.percentOfLarger(null, 5), null); assert.equal(R.percentOfLarger(5, null), null);
  assert.equal(R.disagrees(100, 94), false, '6 km is over 5 km but under 10% of 100');
  assert.equal(R.disagrees(100, 80), true); assert.equal(R.disagrees(100, 96), false, '4 km is below 5 km'); assert.equal(R.disagrees(30, 36), true, '6 km and 16.7%'); assert.equal(R.disagrees(null, 80), false);
});

test('missing or invalid sources are not compared: no discrepancy is calculated and unknown is never zero', () => {
  const bad = R.reconcileDay(day({ provider: { arithmetic: { status: 'fail' }, segments: [] }, sources: { providerReported: { value: null }, gpsDerived: { value: 90 } } }));
  assert.equal(bad.status, 'not_comparable'); assert.equal(bad.notComparable, 'provider_not_reconciled'); assert.equal(bad.differenceKm, null); assert.equal(bad.percentOfLarger, null); assert.equal(bad.providerKm, null);
  assert.equal(R.reconcileDay(day({ logAvailable: false, gps: { ...day().gps, observedKm: null } })).notComparable, 'gps_log_unavailable');
  assert.equal(R.reconcileDay(day({ reportAvailable: false })).notComparable, 'report_unavailable');
  const noGps = R.reconcileDay(day({ gps: { ...day().gps, observedKm: null } })); assert.equal(noGps.status, 'unknown'); assert.equal(noGps.differenceKm, null); assert.equal(noGps.gpsKm, null);
});

test('qualified comparisons: tracking gap, unverified positions, open final segment, excluded jumps and partial coverage each qualify, and a clean day is comparable', () => {
  const q = over => R.reconcileDay(day(over));
  assert.deepEqual(q({ journeyLedger: { journeys: [], totals: { missingMinutes: 75, duplicateObservations: 0, verifiedGpsKm: 40, outsideReportLogKm: null } } }).qualifiers, ['tracking_gap']);
  assert.deepEqual(q({ gps: { ...day().gps, verifiedObservations: 90 } }).qualifiers, ['unverified_positions']);
  assert.deepEqual(q({ provider: { arithmetic: { status: 'pass' }, segments: [seg('S1', 8, 9, 20), seg('S9', 23, 24, 0, false)] } }).qualifiers, ['open_final_segment']);
  assert.deepEqual(q({ gps: { ...day().gps, timeline: [...day().gps.timeline, tl(13, 0, 14, 0, 'unavailable', null, 'unrealistic_jump')] } }).qualifiers, ['excluded_jump_intervals']);
  assert.deepEqual(q({ gps: { ...day().gps, coveredSeconds: 20000 } }).qualifiers, ['partial_day_coverage']);
  assert.equal(q({ gps: { ...day().gps, coveredSeconds: 20000 } }).status, 'qualified');
  const jump = q({ gps: { ...day().gps, timeline: [...day().gps.timeline, tl(13, 0, 14, 0, 'unavailable', null, 'unrealistic_jump'), tl(15, 0, 15, 30, 'unavailable', null, 'sample_gap')] } });
  assert.deepEqual(jump.excluded.map(e => [e.reason, e.minutes]), [['unrealistic_jump', 60], ['sample_gap', 30]], 'excluded time is listed by the GPS rule\'s own reason, and is not counted as distance');
  assert.equal(jump.gpsKm, 65, 'excluded intervals do not change the GPS figure');
  assert.equal(q({ gps: { ...day().gps, coveredSeconds: 99999 } }).coveragePercent, 100, 'coverage is clamped to one Bangkok day');
});

test('segments that cross an edge or overlap are never apportioned or double counted; without the ledger nothing is attributed', () => {
  // a GPS interval crossing the end of segment S3 is not inside it: it stays unattributed instead of being split
  const edge = R.reconcileDay(day({ sources: { providerReported: { value: 50 }, gpsDerived: { value: 69 } }, gps: { ...day().gps, observedKm: 69, timeline: [...day().gps.timeline, tl(10, 30, 11, 30, 'moving', 4)] } }));
  assert.equal(edge.attribution.unattributed.km, 4); assert.equal(edge.attribution.outsideReport.km, 15, 'an interval touching a report segment is never outside');
  assert.equal(Math.round((edge.attribution.insideMoving.km + edge.attribution.insideStopped.km + edge.attribution.outsideReport.km + edge.attribution.unattributed.km) * 100) / 100, edge.gpsKm);
  // overlapping report segments: the interval touches both, so it is not outside either
  const overlap = R.reconcileDay(day({ provider: { arithmetic: { status: 'pass' }, segments: [seg('A', 8, 10, 20), seg('B', 9, 11, 30), seg('C', 12, 13, 0)] } }));
  assert.equal(overlap.attribution.outsideReport.km, 5, 'only the 13:00 interval touches no segment (12:00 is touched by C)');
  const noLedger = R.reconcileDay(day({ journeyLedger: null })); assert.equal(noLedger.attribution, null); assert.equal(noLedger.outsideMovingKm, null); assert.equal(noLedger.likeForLikeResidualKm, null);
  const noSegments = R.reconcileDay(day({ provider: { arithmetic: { status: 'pass' }, segments: [] } })); assert.equal(noSegments.attribution, null); assert.deepEqual(noSegments.outsideWindows, []);
  const unknownGps = R.reconcileDay(day({ journeyLedger: { journeys: [{ ...day().journeyLedger.journeys[0], verifiedGpsKm: null }, day().journeyLedger.journeys[2]], totals: day().journeyLedger.totals } }));
  assert.equal(unknownGps.attribution.providerUncomparedKm, 20, 'provider km of a segment with unknown GPS is shown apart, not compared');
  assert.equal(Math.round((unknownGps.outsideMovingKm + unknownGps.likeForLikeResidualKm - unknownGps.attribution.providerUncomparedKm) * 100) / 100, unknownGps.differenceKm);
});

test('position indicators: repeated coordinates, large point-to-point distances and invalid points, with no coordinates in the result', () => {
  const dist = (a, b) => Math.hypot(a.latitude - b.latitude, a.longitude - b.longitude) * 111;
  const pts = [
    { latitude: 13.7, longitude: 100.5, timestamp: at(8, 5) }, { latitude: 13.7, longitude: 100.5, timestamp: at(8, 0) }, { latitude: 13.76, longitude: 100.5, timestamp: at(8, 10) },
    { latitude: NaN, longitude: 100.5, timestamp: at(8, 15) }, { latitude: 13.7, longitude: 100.5, timestamp: 'bad' }
  ];
  const s = R.chordStats(pts, dist);
  assert.equal(s.positions, 3); assert.equal(s.repeatedPositions, 1); assert.equal(s.chordsOver3Km, 1); assert.ok(s.largestChordKm > 6 && s.largestChordKm < 7);
  assert.deepEqual(Object.keys(s).sort(), ['chordsOver3Km', 'largestChordKm', 'positions', 'repeatedPositions']);
  assert.deepEqual(R.chordStats([], dist), { positions: 0, largestChordKm: null, chordsOver3Km: 0, repeatedPositions: 0 });
});

test('period contributions add up to the period difference exactly; days with one source are reported apart, never as zero', () => {
  const rows = [
    R.reconcileDay(day({ day: '2026-11-01', sources: { providerReported: { value: 100 }, gpsDerived: { value: 101 } }, gps: { ...day().gps, observedKm: 101 } })),
    R.reconcileDay(day()),
    R.reconcileDay(day({ day: '2026-11-03', gps: { ...day().gps, observedKm: null }, sources: { providerReported: { value: 70 }, gpsDerived: { value: null } } })),
    R.reconcileDay(day({ day: '2026-11-04', provider: { arithmetic: { status: 'fail' }, segments: [] }, sources: { providerReported: { value: null }, gpsDerived: { value: 12 } }, gps: { ...day().gps, observedKm: 12 } }))
  ];
  const p = R.reconcilePeriod(rows, 7);
  assert.deepEqual([p.comparableDays, p.reviewedDays, p.days], [2, 4, 7]);
  assert.equal(p.differenceKm, 16); assert.equal(p.unattributedKm, 0); assert.equal(p.largest.day, '2026-11-02');
  assert.equal(Math.round(p.contributions.reduce((n, c) => n + c.shareOfPeriod, 0)), 100);
  assert.equal(p.providerKm, 220, 'provider total = reconciled days only (as in Reports)'); assert.equal(p.gpsKm, 178);
  assert.deepEqual([p.onlyOneSource.providerOnlyKm, p.onlyOneSource.gpsOnlyKm, p.onlyOneSource.days], [70, 12, 2]);
  assert.equal(R.reconcilePeriod([], 7).differenceKm, null);
});

test('journey rows show the report\'s own segment km, GPS inside only when known, and never invent a provider per-segment figure', () => {
  const d = day({ journeyLedger: { journeys: [
    { id: 'J1', kind: 'moving', start: at(8), end: at(9), minutes: 60, providerKm: 20, verifiedGpsKm: 25, reportedTrailKm: 21, positionSource: 'gps', issues: [], ambiguous: false, observations: 12 },
    { id: 'J2', kind: 'moving', start: at(10), end: at(11), minutes: 60, providerKm: 30, verifiedGpsKm: null, reportedTrailKm: null, positionSource: 'mixed', issues: ['log_gap_inside'], ambiguous: false, observations: 9 },
    { id: 'J3', kind: 'stopped', start: at(9), end: at(10), minutes: 60, providerKm: 0, verifiedGpsKm: 0, reportedTrailKm: 0, positionSource: 'gps', issues: [], ambiguous: false, observations: 5 },
    { id: 'J4', kind: 'moving', start: at(12), end: at(12, 0), minutes: 0, providerKm: 0, verifiedGpsKm: null, reportedTrailKm: null, positionSource: 'none', issues: [], ambiguous: false, observations: 0 }
  ], totals: { missingMinutes: 0, duplicateObservations: 0, verifiedGpsKm: 25, outsideReportLogKm: null } } });
  const rows = R.journeyRows(d);
  assert.deepEqual(rows.map(r => [r.id, r.providerKm, r.gpsKm, r.unexplainedKm]), [['J1', 20, 25, 5], ['J2', 30, null, null]]);
});

test('copy: statuses, qualifiers, exclusions and the method note exist in English and Thai and never accuse', () => {
  for (const map of [R.RECON_STATUS_COPY, R.QUALIFIER_COPY, R.NOT_COMPARABLE_COPY, R.EXCLUDED_COPY]) for (const [k, [en, th]] of Object.entries(map)) assert.ok(en && /[฀-๿]/.test(th), k);
  assert.match(R.METHOD_COPY[0], /larger of the two/); assert.match(R.METHOD_COPY[0], /not proof of travelled kilometres/); assert.ok(/[฀-๿]/.test(R.METHOD_COPY[1]));
  assert.doesNotMatch(JSON.stringify(R.QUALIFIER_COPY) + JSON.stringify(R.RECON_STATUS_COPY) + R.METHOD_COPY.join(' '), /fraud|tamper|misconduct|theft|stolen|faulty/i);
});

test('route: cache-only, authorised for historical journeys, no Forth import, no write, and the response carries no positions', () => {
  const route = read('app/api/admin/forth-tracking/evidence/mileage-reconciliation/route.ts');
  assert.match(route, /export async function GET/); assert.doesNotMatch(route, /export async function (POST|PUT|PATCH|DELETE)/);
  assert.ok(route.indexOf('requireFleetOfficeAccess') < route.indexOf('canViewJourneyDetail') && route.indexOf('canViewJourneyDetail') < route.indexOf('recalledProviderDayEntry'));
  assert.match(route, /recalledProviderDayEntry\(user\.id,/); assert.doesNotMatch(route, /forth-tracking-server|getForth|fetch\(|\.insert\(|\.update\(|\.upsert\(|\.delete\(/);
  assert.match(route, /MAX_DAYS = 62/); assert.match(route, /hi\.start > Date\.now\(\)/);
  const body = route.slice(route.indexOf('rows.push('), route.indexOf('return NextResponse.json({ vehicleId'));
  assert.match(body, /rows\.push\(\{ reconciliation, journeys: journeyRows\(evidence\)/); assert.doesNotMatch(body, /observedPoints[^)]*\}\s*[,)]\s*journeys|reportedPoints/);
  assert.match(route, /registryStatuses\(registry\)\.get\(vehicle\.id\) \?\? "unknown"\) === "duplicate"/, 'a duplicate registration is never reconciled');
});

// ---------- request origin diagnostics ----------
test('request origin: only allow-listed origins are recorded, anything else is "unlabelled", and ids are validated', () => {
  for (const o of L.REQUEST_ORIGINS) assert.equal(L.parseOrigin(o), o);
  for (const bad of [null, undefined, '', 'reports', 'REPORTS_COVERAGE_REVIEW', '<script>', 'a'.repeat(300)]) assert.equal(L.parseOrigin(bad), 'unlabelled');
  assert.equal(L.parseRequestId('abcdef12-3456'), 'abcdef12-3456'); assert.notEqual(L.parseRequestId('short'), 'short'); assert.notEqual(L.parseRequestId('has spaces and ; symbols'), 'has spaces and ; symbols');
  assert.match(L.parseRequestId(null), /^[0-9a-f-]{36}$/);
});

test('request log: a one-way short actor reference, bounded ring, no secrets, and per-origin summary', () => {
  L.resetProviderRequestLogForTests();
  const lines = [];
  const base = { id: 'abcdef12-3456', actor: L.actorRef('user-aaaa'), vehicleRef: 'veh-1', day: '2026-11-02', refresh: false, status: 200, durationMs: 12.6, forthRequests: 2, waitedForInFlight: false, log: (l, p) => lines.push([l, p]) };
  const e1 = L.logProviderRequest({ ...base, origin: 'reports_coverage_review', outcome: 'provider_read' });
  const e2 = L.logProviderRequest({ ...base, origin: 'unlabelled', outcome: 'cache_hit', forthRequests: 0 });
  assert.equal(e1.initiation, 'explicit_user_action'); assert.equal(e2.initiation, 'unlabelled'); assert.equal(e2.cacheHit, true);
  assert.notEqual(L.actorRef('user-aaaa'), L.actorRef('user-bbbb')); assert.equal(L.actorRef('user-aaaa'), L.actorRef('user-aaaa')); assert.doesNotMatch(L.actorRef('user-aaaa'), /user/); assert.equal(L.actorRef('x').length, 12);
  const text = JSON.stringify(lines); assert.doesNotMatch(text, /token|bearer|password|secret|latitude|longitude|plate|deviceId|driver/i);
  assert.equal(lines[0][0], 'fleet_provider_request'); assert.equal(e1.durationMs, 13);
  assert.equal(L.logProviderRequest({ ...base, origin: 'daily_read_button', outcome: 'provider_read', day: 'not-a-date', vehicleRef: 'v'.repeat(500) }).day, 'invalid');
  for (let i = 0; i < 150; i++) L.logProviderRequest({ ...base, origin: 'daily_read_button', outcome: 'cache_hit', forthRequests: 0 });
  assert.equal(L.recentProviderRequests().length, L.MAX_REQUEST_EVENTS);
  const by = L.summariseByOrigin([e1, e2]); assert.deepEqual([by.reports_coverage_review.providerReads, by.unlabelled.cacheHits, by.reports_coverage_review.forthRequests], [1, 1, 2]);
});

test('duplicate in-flight reads: the same user waits for the running read instead of a second Forth call; another user is never blocked or merged', async () => {
  L.resetProviderRequestLogForTests();
  const kA = L.inFlightKey('user-a', 'veh-1', '2026-11-02'), kB = L.inFlightKey('user-b', 'veh-1', '2026-11-02');
  assert.notEqual(kA, kB);
  assert.equal(await L.waitForInFlight(kA), false);
  const release = L.registerInFlight(kA);
  let waiterDone = false; const waiter = L.waitForInFlight(kA).then(v => { waiterDone = true; return v; });
  assert.equal(await L.waitForInFlight(kB), false, 'a different user is not affected');
  await new Promise(r => setTimeout(r, 10)); assert.equal(waiterDone, false, 'still waiting while the first read runs');
  release(); assert.equal(await waiter, true);
  assert.equal(await L.waitForInFlight(kA), false, 'released: the next request proceeds normally');
});

test('provider route wiring: origin and id are read, the wait comes before the rate limit, every exit is logged, and the slot is released in finally', () => {
  const route = read('app/api/admin/forth-tracking/evidence/provider/route.ts');
  assert.match(route, /parseOrigin\(request\.headers\.get\(ORIGIN_HEADER\)\)/); assert.match(route, /actorRef\(user\.id\)/);
  assert.ok(route.indexOf('waitForInFlight(guardKey)') < route.indexOf('beginForthHistoryRateLimit(rateKey)'));
  for (const o of ['"deduplicated_cache_hit"', '"rate_limited"', '"provider_read"', 'failureOutcome({ cancelled']) assert.ok(route.includes(o), o);
  assert.match(route, /finally \{ if \(acquired\) releaseForthHistoryRateLimit\(rateKey\); release\?\.\(\); \}/);
  assert.doesNotMatch(route.slice(route.indexOf('logProviderRequest')), /Authorization|access_token/);
  assert.match(route, /byOrigin: summariseByOrigin\(\)/); assert.match(route, /canViewJourneyDetail[\s\S]*Provider diagnostics need administrator authorisation/);
});

test('every component that can start a historical Forth read is listed, labelled with its own origin, and nothing else can', () => {
  const hits = [];
  const skip = n => n === 'node_modules' || n === '.next';
  const walk = (dir, top) => { for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) { const p2 = dir + '/' + e.name; if (e.isDirectory()) { if (!skip(e.name) && !(top === 'app' && p2 === 'app/api')) walk(p2, top); } else if ((e.name.endsWith('.tsx') || e.name.endsWith('.ts')) && fs.readFileSync(path.join(root, p2), 'utf8').includes('evidence/provider')) hits.push(p2); } };
  walk('components', 'components'); walk('app', 'app');
  assert.deepEqual([...new Set(hits)].sort(), ['components/fleet-day-review.tsx', 'components/fleet-evidence-panel.tsx', 'components/fleet-fuel-report.tsx', 'components/fleet-provider-day-panel.tsx', 'components/location-evidence-panel.tsx']);
  const expected = { 'components/fleet-day-review.tsx': 'reports_day_review_queue', 'components/fleet-evidence-panel.tsx': 'journeys_unread_batch', 'components/fleet-fuel-report.tsx': 'reports_coverage_review', 'components/location-evidence-panel.tsx': 'locations_evidence_panel' };
  for (const [f, o] of Object.entries(expected)) assert.match(read(f), new RegExp(`originHeaders\\("${o}"\\)`), f);
  assert.match(read('components/fleet-provider-day-panel.tsx'), /originHeaders\(refresh \? "daily_refresh_button" : "daily_read_button"\)/);
  const client = read('lib/fleet-request-origin.ts'); for (const o of L.REQUEST_ORIGINS) assert.ok(client.includes(`"${o}"`), o);
});

test('no automatic Forth reads: reading is only inside click handlers or the explicit queue, never in an effect, and navigation, sorting, exceptions, maps and cache-only loads use cache-only routes', () => {
  for (const f of ['components/fleet-fuel-report.tsx', 'components/fleet-day-review.tsx', 'components/fleet-provider-day-panel.tsx', 'components/location-evidence-panel.tsx', 'components/fleet-evidence-panel.tsx']) {
    const src = read(f);
    const effects = [...src.matchAll(/useEffect\(\(\) => \{[^}]{0,400}\}/g)].map(m => m[0]).filter(s => /readDay\(|startReview\(|readIds\(|readUnreadDays\(|evidence\/provider/.test(s));
    assert.deepEqual(effects, [], `${f}: a provider read inside an effect`);
  }
  const cacheOnly = { 'components/fleet-mileage-reconciliation.tsx': ['mileage-reconciliation'], 'components/fleet-visit-map.tsx': ['visit-map'], 'components/fleet-vehicle-investigation.tsx': ['evidence?', 'evidence/day-places'] };
  for (const [f, allowed] of Object.entries(cacheOnly)) { const src = read(f); assert.doesNotMatch(src, /evidence\/provider|history\/playback|method: "POST"/, f); for (const m of src.matchAll(/fetch\(`([^`]+)`/g)) assert.ok(allowed.some(a => m[1].includes(a)), `${f} fetches ${m[1]}`); }
  const centre = read('components/forth-tracking-centre.tsx'); assert.doesNotMatch(centre, /evidence\/provider/);
  const sortFn = read('lib/fleet-fuel-oversight.ts'); assert.doesNotMatch(sortFn, /fetch\(/);
  const recon = read('components/fleet-mileage-reconciliation.tsx'); assert.match(recon, /Forth is not contacted/); assert.equal((recon.match(/fetch\(/g) || []).length, 1);
});

// ---------- UI ----------
test('mileage investigation is reachable from Reports, Daily Activity and Fuel Intelligence and uses the existing route, journey and evidence actions', () => {
  const inv = read('components/fleet-vehicle-investigation.tsx'), ev = read('components/fleet-evidence-panel.tsx'), snap = read('components/fleet-day-snapshot.tsx'), fuel = read('components/fleet-fuel-panel.tsx'), rep = read('components/fleet-fuel-report.tsx'), centre = read('components/forth-tracking-centre.tsx');
  assert.match(inv, /data-explain-issue/); assert.match(inv, /data-explain-mileage/); assert.match(rep, /data-explain-queue/); assert.match(snap, /data-explain-difference/); assert.match(fuel, /data-explain-mileage/);
  assert.match(ev, /journeyAccess === "granted" && vehicleId \? \(\) => setReconOpen\(true\)/, 'offered only to callers allowed to view historical journeys');
  assert.match(ev, /onOpenPlayback\?\.\(\{ day: d, start: "00:00", end: "23:59" \}\)/); assert.match(centre, /openRouteMap\(\{ day: scope\.day, start: "00:00", end: "23:59" \}\)/);
  assert.match(rep, /key=\{`\$\{selectedRow\.vehicleId\}:\$\{from\}:\$\{to\}`\}/);
  const panel = read('components/fleet-mileage-reconciliation.tsx');
  for (const a of ['data-open-route', 'Inspect journeys', 'Open Daily Activity', 'Open original evidence']) assert.ok(panel.includes(a), a);
  assert.doesNotMatch(panel, /history\.(push|replace)State|latitude|longitude/);
});

test('odometer interval explanation shows both records, the bounds, the boundary uncertainty and limitations without accusing', () => {
  const fuel = read('components/fleet-fuel-panel.tsx');
  for (const s of ['Odometer start record', 'Odometer end record', 'Observed odometer difference', 'Boundary uncertainty', 'Forth lower bound', 'Forth upper bound', 'outside the range', 'Source limitations', 'บันทึกเลขไมล์เริ่มต้น', 'ความไม่แน่นอนที่ขอบช่วง', 'ข้อจำกัดของข้อมูล']) assert.ok(fuel.includes(s), s);
  assert.match(fuel, /does not indicate tampering, misuse or an incorrect purchase/); assert.doesNotMatch(fuel.replace(/does not indicate tampering, misuse or an incorrect purchase/, ''), /tamper|fraud|misconduct/i);
  assert.doesNotMatch(fuel, /km\/L [=:]|consumed litres [=:]/);
});

test('English and Thai rendering of the mileage investigation shell, and stacked-card phone layout', () => {
  const React = require('react'); const { renderToString } = require('react-dom/server');
  const { FleetMileageReconciliation } = load('components/fleet-mileage-reconciliation.tsx');
  const el = lang => renderToString(React.createElement(FleetMileageReconciliation, { language: lang, vehicleId: 'v1', registration: '3ฒน-9565', from: '2026-11-01', to: '2026-11-07', focusDay: null, onOpen() {}, onClose() {} })).replace(/<!-- -->/g, '');
  const en = el('en'), th = el('th');
  assert.match(en, /Mileage discrepancy · 3ฒน-9565/); assert.match(en, /Forth is not contacted/); assert.match(th, /ความต่างของระยะทาง · 3ฒน-9565/); assert.match(th, /ไม่ติดต่อ Forth/);
  const src = read('components/fleet-mileage-reconciliation.tsx'); const labelled = (src.match(/<td[^>]*data-label/g) || []).length; assert.ok(labelled >= 12, `cells labelled for phone cards (${labelled})`);
  assert.match(src, /v783-days v782-cards/); assert.match(read('components/fleet-tracking-v73.css'), /\.v783-actions button \{ flex: 1 1 45%; \}/);
  for (const s of ['Contributing days', 'Unexplained', 'Provider distance', 'GPS-derived distance', 'วันที่มีส่วนต่อผลต่าง', 'อธิบายไม่ได้', 'ระยะทางผู้ให้บริการ', 'ระยะทางจาก GPS']) assert.ok(src.includes(s), s);
});
