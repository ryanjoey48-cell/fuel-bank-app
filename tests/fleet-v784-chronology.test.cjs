// V7.8.4: vehicle-day chronology, coverage truth, provider-total explanation and cross-midnight continuity.
// Fixtures only (the real 1–2 Nov 2026 figures are used as regression data for the cross-midnight case). No network, no Forth, no database.
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
const C = load('lib/fleet-day-chronology.ts'), K = load('lib/fleet-coverage-truth.ts'), W = load('lib/fleet-provider-withhold.ts'), X = load('lib/fleet-cross-midnight.ts');
const S = load('lib/fleet-stop-intelligence.ts'), G = load('lib/fleet-visit-grouping.ts');

const DAY = '2026-10-30';
const T = (hm, day = DAY) => `${day}T${hm.length === 5 ? hm + ':00' : hm}+07:00`;
const PAST = Date.parse('2026-11-05T12:00:00+07:00');
const deepFreeze = o => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze); } return o; };
const journey = (id, a, b, km, over = {}) => ({ id, start: T(a), end: b ? T(b) : null, kind: b ? (km > 0 ? 'moving' : 'stopped') : 'open_final', minutes: null, providerKm: km, verifiedGpsKm: null, reportedTrailKm: null, positionSource: 'gps', ambiguous: false, ...over });
const g = (a, b, state, km = null, reason = null, day = DAY) => ({ start: T(a, day), end: T(b, day), state, reason, km });
const stop = (id, a, b, m) => ({ id, firstAt: T(a), lastAt: T(b), observedMinutes: m });
const visit = (id, a, b, stops, joins = [], over = {}) => ({ id, firstAt: T(a), lastAt: T(b), observedMinutes: stops.reduce((n, s) => n + s.observedMinutes, 0), spanMinutes: Math.round((Date.parse(T(b)) - Date.parse(T(a))) / 60000), openStart: false, openEnd: false, stops, joins, ...over });
const join = (from, to, far = 40, speed = 12) => ({ fromStopId: from, toStopId: to, interruptionMinutes: 3, farthestBetweenM: far, maxSpeedBetweenKph: speed, observationsBetween: 2, missingReport: false });

// ---------- chronology
test('movement inside a visit window is nested under the visit, classified from the grouping evidence, and never shown as a departure', () => {
  // 10:06–10:59 visit built from two joined stops; a provider moving segment 10:36:10–10:37:05 lies in the join gap (10:35–10:38).
  const v = visit('V01', '10:06', '10:59', [stop('S01', '10:06', '10:35', 29), stop('S02', '10:38', '10:59', 21)], [join('S01', 'S02')]);
  const r = C.fleetDayChronology({ day: DAY, nowMs: PAST, journeys: [journey('J01', '10:36:10', '10:37:05', 0.4)], gps: [g('00:00', '24:00'.replace('24:00', '23:59'), 'stopped', 0)], visits: [v] });
  const kinds = r.rows.map(x => x.kind); assert.deepEqual(kinds, ['visit', 'movement_in_visit']);
  const visitRow = r.rows[0], mv = r.rows[1].movement;
  assert.equal(r.rows[1].depth, 1); assert.equal(r.rows[1].parentKey, visitRow.key);
  assert.equal(mv.relation, 'within_site_between_stops'); assert.deepEqual([mv.siteEvidence.farthestBetweenM, mv.siteEvidence.maxSpeedBetweenKph], [40, 12]);
  assert.equal(visitRow.departure, 'repositioning_within_site'); assert.equal(visitRow.movementInside, 1);
  // the visit keeps its original window and its honest durations: span 53, supported 50 (a lower bound), bridged 3 (not counted as stay)
  assert.deepEqual([visitRow.start, visitRow.end, visitRow.spanMinutes, visitRow.supportedMinutes, visitRow.bridgedMinutes], [T('10:06'), T('10:59'), 53, 50, 3]);
  assert.doesNotMatch(C.DEPARTURE_COPY.repositioning_within_site[0], /left the site|departed/i);
});

test('movement during a single GPS stop is "sources disagree": not a departure, and the minutes are contested, never counted twice', () => {
  // 13:17–15:55 is one GPS stop; GPS shows moving intervals near 13:22 and 14:08 (different source boundaries).
  const v = visit('V02', '13:17', '15:55', [stop('S03', '13:17', '15:55', 158)]);
  const gps = [g('00:00', '13:17', 'stopped', 0), g('13:17', '13:21:30', 'stopped', 0), g('13:21:30', '13:23', 'moving', 0.2), g('13:23', '14:07', 'stopped', 0), g('14:07', '14:08:30', 'moving', 0.3), g('14:08:30', '23:59:59', 'stopped', 0)];
  const r = C.fleetDayChronology({ day: DAY, nowMs: PAST, journeys: [], gps, visits: [v] });
  const inside = r.rows.filter(x => x.kind === 'movement_in_visit');
  // 0.2 km and 0.3 km paths are within the grouping's own 300 m site-leave distance: site-scale movement, never a departure.
  assert.equal(inside.length, 2); assert.ok(inside.every(x => x.movement.relation === 'site_scale_movement' && x.movement.source === 'gps_interval'));
  assert.deepEqual(inside.map(x => x.movement.pathKm), [0.2, 0.3]); assert.equal(C.SITE_SCALE_KM, 0.3);
  assert.equal(r.rows[0].departure, 'repositioning_within_site'); assert.equal(r.overlaps.sourcesDisagree, 0);
  assert.equal(r.accounting.buckets.contested, 90 + 90, 'both moving intervals are claimed by the stop as well, counted once as contested');
  // a longer path inside a stop (0.6 km, more than the site-leave distance) stays a genuine disagreement between the sources
  const far = C.fleetDayChronology({ day: DAY, nowMs: PAST, journeys: [], gps: [g('00:00', '13:21:30', 'stopped', 0), g('13:21:30', '13:23', 'moving', 0.6), g('13:23', '23:59:59', 'stopped', 0)], visits: [v] });
  assert.equal(far.rows[1].movement.relation, 'during_stationary_stop'); assert.equal(far.rows[0].departure, 'sources_disagree'); assert.equal(far.overlaps.sourcesDisagree, 1);
  assert.match(C.DEPARTURE_COPY.sources_disagree[0], /not established/); assert.match(C.RELATION_COPY.site_scale_movement[0], /not a departure/);
  assert.match(C.RELATION_COPY.during_stationary_stop[0], /not shown as a departure/);
});

test('additive accounting: every second of the window lands in exactly one bucket; unobserved time is never stationary', () => {
  const v = visit('V01', '10:00', '11:00', [stop('S01', '10:00', '11:00', 60)]);
  const gps = [g('00:00', '09:00', 'stopped', 0), g('09:00', '09:30', 'moving', 20), g('09:30', '10:00', 'stopped', 0), g('10:00', '10:20', 'stopped', 0), g('10:20', '10:30', 'unavailable', null, 'sample_gap'), g('10:30', '11:00', 'stopped', 0), g('11:00', '12:00', 'unavailable', null, 'sample_gap'), g('12:00', '23:59:59', 'stopped', 0)];
  const r = C.fleetDayChronology({ day: DAY, nowMs: PAST, journeys: [journey('J01', '09:00', '09:30', 20)], gps, visits: [v] });
  const b = r.accounting.buckets;
  assert.equal(r.accounting.sumSeconds, r.accounting.windowSeconds, 'nothing counted twice or dropped'); assert.equal(r.accounting.windowSeconds, 86400);
  assert.equal(b.driving, 30 * 60, 'provider segment and GPS moving interval describe the same 30 minutes: counted once');
  assert.equal(b.stationary_bridged, 10 * 60, 'inside the stop but with no position for 10 minutes: bridged, shown apart');
  assert.equal(b.stationary_supported, 50 * 60);
  assert.equal(b.unobserved, 60 * 60, 'the unavailable hour outside any stop is unobserved, not stationary');
  assert.equal(b.contested, 0);
});

test('without a GPS log nothing is "observed"; an in-progress day only counts the elapsed part', () => {
  const noLog = C.fleetDayChronology({ day: DAY, nowMs: PAST, journeys: [journey('J01', '09:00', '09:30', 20)], gps: null, visits: [] });
  assert.equal(noLog.accounting.gpsAvailable, false); assert.equal(noLog.accounting.buckets.driving, 30 * 60); assert.equal(noLog.accounting.buckets.unobserved, 86400 - 30 * 60); assert.equal(noLog.accounting.buckets.observed_other, 0);
  const now = Date.parse(T('06:00')); const part = C.fleetDayChronology({ day: DAY, nowMs: now, journeys: [], gps: [g('00:00', '23:59:59', 'stopped', 0)], visits: [] });
  assert.equal(part.accounting.windowSeconds, 6 * 3600); assert.equal(part.accounting.sumSeconds, 6 * 3600);
});

test('deterministic and non-destructive: input order does not matter, inputs are not mutated, every source interval is preserved', () => {
  const v1 = visit('V01', '08:00', '09:00', [stop('S01', '08:00', '09:00', 60)]), v2 = visit('V02', '14:00', '15:00', [stop('S02', '14:00', '15:00', 60)]);
  const journeys = [journey('J02', '11:00', '12:00', 50), journey('J01', '09:10', '09:50', 30), journey('J03', '23:00', null, 0)];
  const gps = [g('00:00', '08:00', 'stopped', 0), g('08:00', '09:00', 'stopped', 0), g('09:10', '09:50', 'moving', 30), g('11:00', '12:00', 'moving', 50), g('12:00', '23:59:59', 'stopped', 0)];
  const a = C.fleetDayChronology(deepFreeze({ day: DAY, nowMs: PAST, journeys, gps, visits: [v1, v2] }));
  const b = C.fleetDayChronology({ day: DAY, nowMs: PAST, journeys: [...journeys].reverse(), gps: [...gps].reverse(), visits: [v2, v1] });
  assert.deepEqual(a, b, 'same result whatever the input order (stable ids and order)');
  assert.deepEqual(a.rows.map(r => r.key), ['visit:V01', 'drive:J01', 'drive:J02', 'visit:V02', 'open:J03']);
  const vr = a.rows.find(r => r.key === 'visit:V01'); assert.deepEqual([vr.start, vr.end], [v1.firstAt, v1.lastAt], 'the visit window is the source window, untrimmed');
  assert.equal(a.rows.find(r => r.key === 'drive:J01').providerKm, 30);
  assert.equal(a.rows.find(r => r.key === 'open:J03').end, null, 'an open provider segment stays open');
});

test('GPS movement the provider report does not contain is shown, marked "not in provider report"; edges and spans are annotated, not hidden', () => {
  const gps = [g('00:00', '01:00', 'moving', 70), g('01:00', '04:00', 'stopped', 0), g('04:00', '23:59:59', 'stopped', 0)];
  const r = C.fleetDayChronology({ day: DAY, nowMs: PAST, journeys: [], gps, visits: [] });
  assert.equal(r.rows.length, 1); assert.deepEqual([r.rows[0].kind, r.rows[0].source, r.rows[0].notInProviderReport, r.rows[0].gpsKm, r.rows[0].providerKm], ['driving', 'gps_interval', true, 70, null]);
  // a provider journey that covers a whole visit window: the visit is flagged, the journey stays a top-level driving row
  const v = visit('V01', '10:00', '10:30', [stop('S01', '10:00', '10:30', 30)]);
  const spans = C.fleetDayChronology({ day: DAY, nowMs: PAST, journeys: [journey('J01', '09:50', '10:40', 12)], gps: [g('00:00', '23:59:59', 'stopped', 0)], visits: [v] });
  assert.equal(spans.rows.find(x => x.kind === 'visit').departure, 'sources_disagree'); assert.equal(spans.overlaps.spans, 1);
  assert.equal(spans.rows.find(x => x.key === 'drive:J01').overlapsVisit.relation, 'spans_visit');
});

test('material unobserved runs (over 10 minutes) get a row; ordinary missed reports (up to 10 minutes) are counted in coverage, not listed', () => {
  const gps = [g('00:00', '08:00', 'stopped', 0), g('08:00', '08:10', 'unavailable', null, 'sample_gap'), g('08:10', '09:00', 'stopped', 0), g('09:00', '09:25', 'unavailable', null, 'missing_samples'), g('09:25', '09:40', 'unavailable', null, 'sample_gap'), g('09:40', '23:59:59', 'stopped', 0)];
  const r = C.fleetDayChronology({ day: DAY, nowMs: PAST, journeys: [], gps, visits: [], providerLogGaps: [{ start: T('09:20'), end: T('09:50'), minutes: 30 }] });
  const unknown = r.rows.filter(x => x.kind === 'unknown');
  assert.equal(unknown.length, 1); assert.deepEqual([Date.parse(unknown[0].start), Date.parse(unknown[0].end), unknown[0].minutes, unknown[0].reasons], [Date.parse(T('09:00')), Date.parse(T('09:50')), 50, ['gps_spacing', 'provider_log_gap']]);
});

test('real pipeline: parked, a short slow move inside the site, parked again is ONE visit with the movement nested; ids are stable under shuffled input', () => {
  const BASE = Date.parse('2026-10-30T10:00:00+07:00'), at = m => new Date(BASE + m * 60_000).toISOString();
  const off = (n, e) => ({ latitude: 13.7 + n / 111320, longitude: 100.6 + e / (111320 * Math.cos(13.7 * Math.PI / 180)) });
  const obs = (m, n, e, sp = 0) => ({ timestamp: at(m), ...off(n, e), speedKph: sp, verified: true });
  const parked = (a, b, n, e) => Array.from({ length: b - a + 1 }, (_, i) => obs(a + i, n + (i % 3), e + (i % 2)));
  const points = [...parked(0, 29, 0, 0), obs(30, 0, 50, 12), obs(31, 0, 100, 12), ...parked(32, 60, 0, 100)];
  const run = pts => { const clusters = S.detectStopClusters(pts); return G.groupStopsIntoVisits(clusters, pts); };
  const a = run(points), b = run([...points].reverse());
  assert.equal(a.groups.length, 1); assert.deepEqual(a.groups.map(x => x.id), b.groups.map(x => x.id)); assert.deepEqual(a.groups[0].stops.map(s => s.id), b.groups[0].stops.map(s => s.id));
  const grp = a.groups[0]; const v = { id: grp.id, firstAt: grp.stops[0].firstAt, lastAt: grp.stops.at(-1).lastAt, observedMinutes: grp.observedMinutes, spanMinutes: grp.spanMinutes, openStart: grp.openStart, openEnd: grp.openEnd, stops: grp.stops, joins: grp.joins };
  const mvStart = at(30.2), mvEnd = at(30.8);
  const r = C.fleetDayChronology({ day: '2026-10-30', nowMs: PAST, journeys: [{ ...journey('J01', '10:30:12', '10:30:48', 0.1), start: mvStart, end: mvEnd }], gps: null, visits: [v] });
  assert.deepEqual(r.rows.map(x => x.kind), ['visit', 'movement_in_visit']);
  assert.ok(['within_site_between_stops', 'during_stationary_stop'].includes(r.rows[1].movement.relation), 'classified from real grouping evidence, never as a departure');
  assert.ok(r.rows[0].supportedMinutes <= r.rows[0].spanMinutes, 'supported stationary minutes never exceed the span');
});

// ---------- coverage truth
test('coverage: 100% of received positions verified does not mean full time coverage, and zero provider log gaps does not mean zero unobserved time', () => {
  const gps = [g('00:00', '08:00', 'stopped', 0), g('08:00', '08:05', 'unavailable', null, 'sample_gap'), g('08:05', '12:00', 'stopped', 0), g('12:00', '12:10', 'unavailable', null, 'sample_gap'), g('12:10', '12:20', 'stopped', 0), g('12:20', '20:00', 'unavailable', null, 'sample_gap'), { start: T('20:00'), end: T('00:00', '2026-10-31'), state: 'stopped', reason: null, km: 0 }];
  const t = K.coverageTruth({ day: DAY, nowMs: PAST, receivedPositions: 664, verifiedPositions: 664, gpsTimeline: gps, ledger: { missingCount: 0, missingMinutes: 0, cadenceJitterGaps: 2, openFinal: 0 }, provider: { read: true, reconciled: false, issues: ['overlapping_segments'] } });
  assert.equal(t.positions.verifiedPct, 100);
  assert.ok(t.time.supportedPct < 100 && t.time.unobservedPct > 0);
  assert.equal(t.flags.verificationIsNotCoverage, true); assert.equal(t.flags.zeroLogGapsButUnobservedTime, true);
  assert.equal(t.providerLogGaps.count, 0); assert.equal(t.time.unobservedSeconds, (5 + 10 + 460) * 60, 'unobserved seconds are reported as measured, not hidden by the zero log-gap count');
  // The ledger reports no spacing over 10 minutes, so the 460-minute run can only be many 5–10-minute spacings back to back (chained), never one outage.
  assert.deepEqual([t.time.short.intervals, t.time.chained.intervals, t.time.long.intervals], [2, 1, 0]); assert.equal(t.time.longestRunSeconds, 460 * 60);
  // With a ledger gap over 10 minutes the same run is an outage.
  const withGap = K.coverageTruth({ day: DAY, nowMs: PAST, receivedPositions: 664, verifiedPositions: 664, gpsTimeline: gps, ledger: { missingCount: 1, missingMinutes: 460, cadenceJitterGaps: 2, openFinal: 0 }, provider: { read: true, reconciled: false, issues: [] } });
  assert.deepEqual([withGap.time.short.intervals, withGap.time.chained.intervals, withGap.time.long.intervals], [2, 0, 1], 'two ordinary missed reports (≤10 min) and one long outage');
  assert.equal(t.time.supportedSeconds + t.time.unobservedSeconds, t.windowSeconds, 'covered and unobserved add up to the window');
  assert.equal(t.provider.state, 'withheld');
});

test('coverage: an in-progress day measures only the elapsed time; a missing GPS log leaves time unknown, not zero', () => {
  const now = Date.parse(T('12:00')); const gps = [g('00:00', '06:00', 'stopped', 0), g('06:00', '12:00', 'unavailable', null, 'sample_gap'), g('12:00', '23:59:59', 'unavailable', null, 'missing_samples')];
  const t = K.coverageTruth({ day: DAY, nowMs: now, receivedPositions: 10, verifiedPositions: 10, gpsTimeline: gps, ledger: null, provider: { read: false, reconciled: false, issues: [] } });
  assert.equal(t.inProgress, true); assert.equal(t.windowSeconds, 12 * 3600); assert.equal(t.time.supportedPct, 50); assert.equal(t.time.unobservedPct, 50, 'the rest of the day (future) is not counted as unobserved');
  assert.equal(t.providerLogGaps, null); assert.equal(t.provider.state, 'not_read');
  const none = K.coverageTruth({ day: DAY, nowMs: PAST, receivedPositions: null, verifiedPositions: null, gpsTimeline: null, ledger: null, provider: { read: false, reconciled: false, issues: [] } });
  assert.equal(none.time, null); assert.equal(none.positions.verifiedPct, null); assert.equal(none.flags.verificationIsNotCoverage, false);
});

test('coverage: the real 2 Nov figures (86.7% time, 193 unobserved minutes, 1,125/1,125 verified)', () => {
  const gps = [g('00:00', '00:00:33', 'unavailable', null, 'missing_samples', '2026-11-02'), g('00:00:33', '04:36:17', 'moving', 304.29, null, '2026-11-02')];
  const t = K.coverageTruth({ day: '2026-11-02', nowMs: Date.parse('2026-11-09T00:00:00+07:00'), receivedPositions: 1125, verifiedPositions: 1125, gpsTimeline: [...gps, { start: T('04:36:17', '2026-11-02'), end: T('23:59:59', '2026-11-02'), state: 'unavailable', reason: 'sample_gap', km: null }], ledger: null, provider: { read: true, reconciled: true, issues: [] } });
  assert.equal(t.positions.verifiedPct, 100); assert.equal(t.provider.state, 'reconciled');
});

// ---------- provider total explanation
test('provider total: withheld reasons are listed from the report; the trail and GPS figures stay separate and are never an accepted provider total', () => {
  const e = W.explainProviderTotal({ read: true, arithmeticStatus: 'not_comparable', assertedTotalKm: 119.4, segments: [{ km: 60, end: 'x' }, { km: 59.1, end: 'y' }], issues: ['overlapping_segments', 'invalid_segment'], reportedTrailKm: 119.33, gpsKm: 116.56 });
  assert.equal(e.state, 'withheld'); assert.deepEqual(e.reasons.map(r => r.code), ['overlapping_segments', 'invalid_segment']);
  assert.equal(e.segmentSumKm, 119.1); assert.equal(e.differenceKm, -0.3); assert.equal(e.sumMayBeIncomplete, true);
  assert.equal(e.reportedTrailKm, 119.33); assert.equal(e.gpsKm, 116.56); assert.equal(e.assertedTotalKm, 119.4);
  assert.ok(e.reasons.every(r => r.en && r.th));
  const open = W.explainProviderTotal({ read: true, arithmeticStatus: 'not_comparable', assertedTotalKm: 10, segments: [{ km: 10, end: null }], issues: ['open_segment_with_distance'], reportedTrailKm: null, gpsKm: null });
  assert.equal(open.openSegments, 1); assert.equal(open.reasons[0].code, 'open_segment_with_distance');
  const diff = W.explainProviderTotal({ read: true, arithmeticStatus: 'fail', assertedTotalKm: 100, segments: [{ km: 90, end: 'x' }], issues: [], reportedTrailKm: null, gpsKm: null });
  assert.deepEqual(diff.reasons.map(r => r.code), ['totals_differ']); assert.equal(diff.differenceKm, -10);
  assert.equal(W.explainProviderTotal({ read: true, arithmeticStatus: 'pass', assertedTotalKm: 5, segments: [{ km: 5, end: 'x' }], issues: [], reportedTrailKm: 5.1, gpsKm: 5 }).state, 'accepted');
  assert.equal(W.explainProviderTotal({ read: false, arithmeticStatus: 'pass', assertedTotalKm: null, segments: [], issues: [], reportedTrailKm: null, gpsKm: null }).state, 'not_read');
  assert.equal(W.explainProviderTotal({ read: true, arithmeticStatus: 'not_comparable', assertedTotalKm: null, segments: [], issues: [], reportedTrailKm: null, gpsKm: null }).reasons[0].code, 'missing_numeric_evidence');
});

// ---------- cross-midnight continuity (real 1–2 Nov 2026 figures for 3ฒน-9565)
const D1 = '2026-11-01', D2 = '2026-11-02';
const a1 = { day: D1, journeys: [{ id: 'J05', start: T('22:24:17', D1), end: T('22:58:24', D1), kind: 'moving', providerKm: 32.33 }, { id: 'J06', start: T('23:57:32', D1), end: null, kind: 'open_final', providerKm: 0 }],
  gps: [g('22:23:18', '22:58:24', 'moving', 32.4, null, D1), g('22:58:24', '23:55:30', 'idling', 0, null, D1), g('23:55:30', '23:59:33', 'moving', 3.41, null, D1), g('23:59:33', '23:59:59', 'unavailable', null, 'missing_samples', D1)] };
const b2 = { day: D2, journeys: [{ id: 'J01', start: T('06:20:38', D2), end: T('08:12:54', D2), kind: 'moving', providerKm: 137.67 }, { id: 'J10', start: T('23:59:02', D2), end: null, kind: 'open_final', providerKm: 0 }],
  gps: [g('00:00', '00:00:33', 'unavailable', null, 'missing_samples', D2), g('00:00:33', '03:31:07', 'moving', 220.29, null, D2), g('03:31:07', '03:34:08', 'idling', 0, null, D2), g('03:34:08', '04:36:17', 'moving', 84, null, D2), g('04:36:17', '06:18:38', 'idling', 0, null, D2), g('06:18:38', '08:12:54', 'moving', 137.53, null, D2)] };

test('cross-midnight: the verified 1–2 Nov continuation is found, kept separate, and counted once', () => {
  const r = X.detectCrossMidnight(deepFreeze(a1), deepFreeze(b2), D1);
  assert.equal(r.status, 'continuation_observed'); assert.equal(Date.parse(r.boundary), Date.parse(T('00:00', D2)));
  assert.deepEqual(r.openSegment, { day: D1, start: T('23:57:32', D1) }); assert.equal(r.firstProviderSegmentNextDay, T('06:20:38', D2));
  assert.equal(r.windows.length, 3); assert.deepEqual(r.windows.map(w => w.km), [3.41, 220.29, 84]);
  assert.deepEqual(r.gpsKm, { previousDay: 3.41, nextDay: 304.29, total: 307.7 });
  assert.deepEqual([r.observedStart, r.observedEnd], [T('23:55:30', D1), T('04:36:17', D2)]);
  assert.equal(r.providerAllocation, 'none_found'); assert.equal(r.reliability, 'verified_gps'); assert.equal(r.unobservedInsideMinutes, 1);
  assert.ok(r.limits.includes('provider_totals_unchanged') && r.limits.includes('cause_not_established') && r.limits.includes('sampled_path_estimate'));
  assert.equal(r.edgeIntervals, 0, 'the 06:18:38 start is the same movement as the provider segment starting 06:20:38 (within the 5-minute sampling edge)');
  const dup = X.detectCrossMidnight({ ...a1, gps: [...a1.gps, ...a1.gps] }, { ...b2, gps: [...b2.gps, ...b2.gps] }, D1);
  assert.deepEqual(dup.gpsKm, r.gpsKm, 'passing an interval twice cannot double-count it');
  assert.doesNotMatch(JSON.stringify(r), /latitude|longitude|coordinate/i);
});

test('cross-midnight: only stitched when both days are available; a missing next day is reported, never requested', () => {
  assert.equal(X.detectCrossMidnight(a1, null, D1).status, 'next_day_not_reviewed');
  assert.equal(X.detectCrossMidnight(null, b2, D1).status, 'previous_day_not_reviewed');
  assert.equal(X.detectCrossMidnight(a1, { ...b2, day: '2026-11-03' }, D1).status, 'next_day_not_reviewed', 'a different day is not the next day');
  assert.equal(X.detectCrossMidnight({ ...a1, gps: null }, b2, D1).status, 'gps_unavailable');
  assert.equal(X.nextBangkokDay('2026-12-31'), '2027-01-01');
  assert.match(X.CROSS_MIDNIGHT_COPY.next_day_not_reviewed[0], /Nothing was requested/);
  const src = read('lib/fleet-cross-midnight.ts'); assert.doesNotMatch(src, /fetch\(|supabase|server-only|evidence\/provider/);
});

test('cross-midnight: open segment without unreported movement, movement on one side only, and provider-covered movement are not shown as a crossing', () => {
  const quietB = { ...b2, gps: [g('00:00', '06:18:38', 'stopped', 0, null, D2), g('06:18:38', '08:12:54', 'moving', 137.53, null, D2)] };
  const oneSided = X.detectCrossMidnight(a1, quietB, D1); assert.equal(oneSided.status, 'open_segment_no_continuation', 'movement on the previous day only (nothing unreported after midnight) is not shown as a crossing'); assert.equal(oneSided.windows.length, 0); assert.equal(oneSided.gpsKm, null);
  const quietA = { ...a1, gps: [g('22:23:18', '22:58:24', 'moving', 32.4, null, D1), g('22:58:24', '23:59:59', 'idling', 0, null, D1)] };
  const r = X.detectCrossMidnight(quietA, quietB, D1); assert.equal(r.status, 'open_segment_no_continuation'); assert.equal(r.windows.length, 0);
  const noOpen = X.detectCrossMidnight({ ...quietA, journeys: [a1.journeys[0]] }, quietB, D1); assert.equal(noOpen.status, 'not_applicable');
  const covered = X.detectCrossMidnight(a1, { ...b2, journeys: [{ id: 'J00', start: T('00:00:30', D2), end: T('04:40:00', D2), kind: 'moving', providerKm: 305 }, ...b2.journeys] }, D1);
  assert.notEqual(covered.status, 'continuation_observed', 'when the provider reports the movement, nothing is presented as missing');
});

test('modules are pure: no coordinates, no network, no server-only or database access; copy exists in English and Thai', () => {
  for (const f of ['lib/fleet-day-chronology.ts', 'lib/fleet-coverage-truth.ts', 'lib/fleet-provider-withhold.ts', 'lib/fleet-cross-midnight.ts']) {
    const src = read(f); assert.doesNotMatch(src, /fetch\(|supabase|server-only|latitude|longitude|localStorage|Authorization/, f);
  }
  const pairs = [...Object.values(C.BUCKET_COPY).flatMap(v => [v.label, v.note]), ...Object.values(C.RELATION_COPY), ...Object.values(C.DEPARTURE_COPY), ...K.COVERAGE_DEFINITIONS.flatMap(d => [d.title, d.text]), ...Object.values(K.REASON_COPY), ...Object.values(X.CROSS_MIDNIGHT_COPY), ...Object.values(X.CROSS_MIDNIGHT_LIMITS)];
  for (const [en, th] of pairs) { assert.ok(en.length > 3); assert.match(th, /[฀-๿]/); }
});
