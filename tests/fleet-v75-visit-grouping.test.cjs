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
  m.require = r => { if (r === 'server-only') return {};
    if (r.startsWith('@/')) { const f = resolve(r.slice(2)); if (f) return load(f, cache); }
    if (r.startsWith('.')) { const f = resolve(path.relative(root, path.resolve(path.dirname(file), r))); if (f) return load(f, cache); }
    return require(r); };
  m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, file); return m.exports;
}
const G = load('lib/fleet-visit-grouping.ts');
const S = load('lib/fleet-stop-intelligence.ts');
const BASE = Date.parse('2026-11-04T06:00:00+07:00');
const at = min => new Date(BASE + min * 60_000).toISOString();
const off = (north, east) => ({ latitude: 13.7 + north / 111320, longitude: 100.6 + east / (111320 * Math.cos(13.7 * Math.PI / 180)) });
const obs = (min, north, east, speed = 0, verified = true) => ({ timestamp: at(min), ...off(north, east), speedKph: speed, verified });
const run = points => { const clusters = S.detectStopClusters(points); return { clusters, result: G.groupStopsIntoVisits(clusters, points) }; };
/** Parked for [from, to] minutes with 1-minute cadence at (north, east) and tiny jitter. */
const parked = (from, to, north, east, verified = true) => Array.from({ length: to - from + 1 }, (_, i) => obs(from + i, north + (i % 3), east + (i % 2), 0, verified));
const drive = (from, to, fromNE, toNE, speed = 40) => Array.from({ length: to - from + 1 }, (_, i) => { const f = (i + 1) / (to - from + 2); return obs(from + i, fromNE[0] + (toNE[0] - fromNE[0]) * f, fromNE[1] + (toNE[1] - fromNE[1]) * f, speed); });

test('continuous parking whose positions drift more than 75 m is reported as several stops but is ONE visit, with the joins shown', () => {
  // Same lot: stationary, then positions 100 m east (the detector ends a stop 75 m from its first position), then back.
  const points = [...parked(0, 40, 0, 0), ...parked(41, 80, 0, 100), ...parked(81, 120, 0, 0)];
  const { clusters, result } = run(points);
  const stops = clusters.filter(c => c.kind === 'stop');
  assert.ok(stops.length >= 3, `the detector fragments it into ${stops.length} stops`);
  assert.equal(result.groups.length, 1, 'but the evidence supports one visit');
  assert.equal(result.groups[0].stops.length, stops.length); assert.equal(result.groups[0].joins.length, stops.length - 1);
  for (const j of result.groups[0].joins) { assert.ok(j.interruptionMinutes <= 15); assert.ok(j.farthestBetweenM <= G.VISIT_LEAVE_DISTANCE_M); }
  assert.deepEqual(result.groups[0].stops.map(s => s.id), stops.map((_, i) => 'S0' + (i + 1)), 'original stop ids are kept');
});

test('a genuine exit and later return stay two visits', () => {
  const points = [...parked(0, 40, 0, 0), ...drive(41, 70, [0, 0], [3000, 0]), ...parked(71, 90, 3000, 0), ...drive(91, 120, [3000, 0], [0, 0]), ...parked(121, 170, 0, 0)];
  const { result } = run(points);
  const atLot = result.groups.filter(g => g.centroid.latitude < 13.7 + 500 / 111320);
  assert.equal(atLot.length, 2, 'the lot is visited twice, not once');
  assert.ok(result.splits.some(s => s.reason === 'interruption_too_long' || s.reason === 'left_the_site' || s.reason === 'different_place'));
});

test('two adjacent businesses 400 m apart are never one visit', () => {
  const points = [...parked(0, 30, 0, 0), ...parked(31, 70, 400, 0)];
  const { result } = run(points);
  assert.equal(result.groups.length, 2); assert.ok(result.splits.some(s => s.reason === 'different_place'));
});

test('a short interruption with continuous coverage (slow yard movement) is bridged, and the bridged minutes are NOT counted as observed stationary time', () => {
  const points = [...parked(0, 30, 0, 0), ...Array.from({ length: 8 }, (_, i) => obs(31 + i, 60 + i * 10, 20, 14)), ...parked(39, 70, 150, 20)];
  const { result } = run(points);
  assert.equal(result.groups.length, 1);
  const g = result.groups[0];
  assert.ok(g.spanMinutes > g.observedMinutes, 'span includes the bridged interruption; observed minutes do not');
  assert.equal(g.interruptions, g.stops.length - 1);
});

test('a tracking gap between stops splits them, whatever the distance', () => {
  const points = [...parked(0, 30, 0, 0), ...parked(43, 80, 0, 0)]; // 12 minute recording gap: within 15 min, but not continuous tracking
  const { result } = run(points);
  assert.equal(result.groups.length, 2); assert.ok(result.splits.some(s => s.reason === 'tracking_gap_between'));
  const long = run([...parked(0, 30, 0, 0), ...parked(60, 90, 0, 0)]).result;
  assert.equal(long.groups.length, 2); assert.ok(long.splits.some(s => s.reason === 'interruption_too_long'));
});

test('a vehicle driving through the site between two stops is not one visit', () => {
  const points = [...parked(0, 30, 0, 0), obs(31, 40, 0, 45), obs(32, 80, 0, 45), obs(33, 40, 0, 45), ...parked(34, 70, 0, 0)];
  const { result } = run(points);
  assert.equal(result.groups.length, 2); assert.ok(result.splits.some(s => s.reason === 'moving_through'));
});

test('a single position is never a stop or a visit (drive-by), and missing or invalid timestamps are ignored', () => {
  const noisy = [obs(0, 0, 0, 40), { timestamp: 'not a time', ...off(0, 0), speedKph: 0, verified: true }, { timestamp: '', ...off(0, 0), speedKph: 0, verified: true }, obs(5, 3000, 0, 50)];
  assert.equal(run(noisy).result.groups.length, 0);
});

test('day edges: a visit that starts or ends at the edge of the data is open, with unknown arrival or departure and a lower-bound stay', () => {
  const { result } = run([...parked(0, 90, 0, 0)]);
  const g = result.groups[0];
  assert.equal(g.openStart, true); assert.equal(g.openEnd, true); assert.equal(g.arrival.earliest, null); assert.equal(g.departure.latest, null); assert.equal(g.maxMinutes, null);
  assert.ok(g.observedMinutes >= 89, 'the observed minimum is kept as a lower bound, never zero');
  const closed = run([obs(0, 1500, 0, 40), obs(1, 1000, 0, 40), ...parked(10, 50, 0, 0), obs(60, 1500, 0, 40), obs(61, 2000, 0, 40)]).result.groups[0];
  assert.equal(closed.openStart, false); assert.equal(closed.openEnd, false); assert.ok(closed.maxMinutes > closed.observedMinutes);
});

test('unverified positions stay unverified: a mixed visit is "mixed", never "verified"', () => {
  const points = [...parked(0, 40, 0, 0, true), ...parked(41, 80, 0, 100, false)];
  const g = run(points).result.groups;
  assert.equal(g.length, 1); assert.equal(g[0].sourceQuality, 'mixed');
  assert.equal(run(parked(0, 40, 0, 0, false)).result.groups[0].sourceQuality, 'unverified');
});

test('duplicates are removed once, input order does not change the result, and no data is dropped', () => {
  const points = [...parked(0, 40, 0, 0), ...parked(41, 80, 0, 100), ...parked(81, 120, 0, 0)];
  const clusters = S.detectStopClusters(points);
  const a = G.groupStopsIntoVisits(clusters, points);
  const shuffled = [...clusters].reverse().concat([clusters[0]]); // reversed and one duplicate
  const b = G.groupStopsIntoVisits(shuffled, [...points].reverse());
  assert.deepEqual(a.groups, b.groups); assert.equal(b.duplicatesRemoved, 1);
  assert.equal(a.groups.reduce((n, g) => n + g.stops.length, 0), a.stopCount, 'every original stop belongs to exactly one visit');
});

test('thresholds are central and their edges behave: 15 minutes joins, 16 splits; 250 m joins, 300 m splits', () => {
  assert.equal(G.VISIT_MAX_INTERRUPTION_MS, 15 * 60_000); assert.equal(G.VISIT_MAX_SEPARATION_M, 250); assert.equal(G.VISIT_LEAVE_DISTANCE_M, 300); assert.equal(G.VISIT_MAX_SPREAD_M, 300); assert.equal(G.VISIT_MOVING_THROUGH_KPH, 30);
  const stopAt = (first, last, north, east) => ({ kind: 'stop', centroid: off(north, east), observations: 10, firstAt: at(first), lastAt: at(last), beforeAt: at(first - 1), afterAt: at(last + 1), arrivalWindow: { earliest: at(first - 1), latest: at(first) }, departureWindow: { earliest: at(last), latest: at(last + 1) }, dwellMs: { min: (last - first) * 60_000, max: (last - first + 2) * 60_000 }, medianSpeedKph: 0, maxSpeedKph: 1, verifiedShare: 1, sourceQuality: 'verified_gps', gapBefore: false, gapAfter: false, tightWindows: true });
  const filler = (from, to, north, east) => Array.from({ length: to - from + 1 }, (_, i) => obs(from + i, north, east, 3));
  const join = (gapMin, metres) => { const a = stopAt(0, 30, 0, 0), b = stopAt(30 + gapMin, 60 + gapMin, metres, 0); return G.groupStopsIntoVisits([a, b], [...filler(31, 29 + gapMin, 0, 0)]).groups.length; };
  assert.equal(join(5, 100), 1); assert.equal(join(15, 100), 1, 'exactly 15 minutes still joins'); assert.equal(join(16, 100), 2, '16 minutes splits');
  assert.equal(join(5, 250), 1, '250 m joins'); assert.equal(join(5, 260), 2, 'beyond 250 m splits');
});

test('grouping never uses company names, never reads or writes anything, and has no Booking Diary dependency', () => {
  const src = read('lib/fleet-visit-grouping.ts');
  assert.doesNotMatch(src, /companyKey|\.name\b|booking|fetch\(|supabase|\.from\("|matchStop/i, 'spatial and temporal evidence only');
  assert.match(src, /export function groupStopsIntoVisits\(clusters: readonly StopCluster\[\], observations: readonly StopObservation\[\]\)/);
});

test('V7.5.1 real-data finding: a stationary truck whose next report arrives about 10 minutes later (a few seconds of jitter) is one visit; the missing minutes are not stay time; over 11 minutes still splits', () => {
  assert.equal(G.VISIT_CADENCE_JITTER_MS, 60_000);
  const pts = (from, secs, north, east, n) => Array.from({ length: n }, (_, i) => ({ timestamp: new Date(BASE + from * 60_000 + secs * 1000 + i * 5 * 60_000).toISOString(), ...off(north, east), speedKph: 0, verified: true }));
  const run2 = gapSeconds => {
    const a = pts(0, 0, 0, 0, 6);                                   // 00:00..25:00, every 5 min
    const lastA = Date.parse(a.at(-1).timestamp);
    const b = Array.from({ length: 6 }, (_, i) => ({ timestamp: new Date(lastA + gapSeconds * 1000 + i * 5 * 60_000).toISOString(), ...off(10, 5), speedKph: 0, verified: true }));
    const points = [...a, ...b]; const clusters = S.detectStopClusters(points); return { clusters, result: G.groupStopsIntoVisits(clusters, points) };
  };
  const near = run2(603);   // 10 min 3 s later
  const stops = near.clusters.filter(c => c.kind === 'stop');
  assert.equal(stops.length, 2, 'the detector splits it'); assert.equal(near.result.groups.length, 1, 'but 10 min 3 s of jitter is one visit'); assert.equal(run2(660).result.groups.length, 1, 'exactly 11 minutes still joins'); assert.equal(run2(661).result.groups.length, 2, '11 min 1 s splits');
  { const g = near.result.groups[0]; assert.ok(g.spanMinutes > g.observedMinutes, 'bridged minutes are not counted as stay'); }
  const far = run2(11 * 60 + 30);
  const farStops = far.clusters.filter(c => c.kind === 'stop');
  { assert.equal(farStops.length, 2); assert.ok(far.result.groups.length > 1); assert.ok(far.result.splits.some(s => s.reason === 'tracking_gap_between' || s.reason === 'interruption_too_long')); }
});

test('V7.6.1: the detector separates a missing report (10-11 min) from a material tracking gap (over 11 min), and the join says so', () => {
  const build = gapSeconds => {
    const a = Array.from({ length: 6 }, (_, i) => ({ timestamp: new Date(BASE + i * 300_000).toISOString(), ...off(0, 0), speedKph: 0, verified: true }));
    const last = Date.parse(a.at(-1).timestamp);
    const b = Array.from({ length: 6 }, (_, i) => ({ timestamp: new Date(last + gapSeconds * 1000 + i * 300_000).toISOString(), ...off(10, 5), speedKph: 0, verified: true }));
    return [...a, ...b];
  };
  const missing = build(603); const sm = S.detectStopClusters(missing).filter(c => c.kind === 'stop');
  assert.equal(sm[0].gapAfter, false); assert.equal(sm[0].missingReportAfter, true); assert.equal(sm[1].gapBefore, false); assert.equal(sm[1].missingReportBefore, true);
  const joined = G.groupStopsIntoVisits(sm, missing).groups[0];
  assert.equal(joined.joins[0].missingReport, true); assert.equal(joined.joins[0].largestSpacingMinutes, 10.1); assert.ok(joined.spanMinutes > joined.observedMinutes, 'the unobserved minutes are not stay time');
  assert.ok(joined.stops[0].nextToGap === true && sm[0].gapAfter === false, 'only the day edge counts as a gap; the missing report does not');
  const material = build(700); const sg = S.detectStopClusters(material).filter(c => c.kind === 'stop');
  assert.equal(sg[0].gapAfter, true); assert.equal(sg[0].missingReportAfter, false);
  const split = G.groupStopsIntoVisits(sg, material); assert.equal(split.groups.length, 2); assert.equal(sg[0].gapAfter, true);
  assert.ok(split.splits[0].largestSpacingMinutes >= 11.5);
});
