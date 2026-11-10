const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('../scripts/fleet-real-day-validation.cjs');
const di = load('lib/fleet-day-insights.ts');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/\r\n/g, '\n');

const D = '2026-10-26';
const at = h => `${D}T${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}:00+07:00`;
let n = 0;
const journey = (kind, from, to, o = {}) => ({ id: `j${++n}`, segmentId: `s${n}`, kind, start: at(from), end: to === null ? null : at(to), minutes: to === null ? null : (to - from) * 60, providerKm: kind === 'moving' ? 20 : 0, observations: 10, movingObservations: kind === 'moving' ? 8 : 0, engineOnObservations: null, reportedTrailKm: null, verifiedGpsKm: null, positionSource: 'gps', gapsInside: 0, issues: [], ambiguous: false, ...o });
const ledger = (journeys, o = {}) => ({ version: 'v4.4', journeys, missing: o.missing ?? [], outsideReport: [], totals: { outsideReportMinutes: 0, outsideReportLogKm: null, cadenceJitterGaps: 0, providerKm: 0, movingJourneys: journeys.filter(j => j.kind === 'moving').length, stops: journeys.filter(j => j.kind === 'stopped').length, openFinal: journeys.filter(j => j.kind === 'open_final').length, ambiguousJourneys: journeys.filter(j => j.ambiguous).length, reportedTrailKm: o.trail ?? null, verifiedGpsKm: null, observations: o.observations ?? 100, duplicateObservations: 0, positionSource: o.source ?? 'gps', missingMinutes: (o.missing ?? []).reduce((s, m) => s + m.minutes, 0) } });
const input = (L, o = {}) => ({ day: D, providerRead: true, providerKm: 120, providerReconciled: true, ledger: L, journeysRestricted: false, observations: 100, verifiedObservations: 100, ...o });
const ids = r => r.insights.map(i => i.id);

test('coverage states keep "not read", "restricted", "no positions", "provider distance only", "unverified" and "verified" distinct', () => {
  assert.equal(di.classifyCoverage(input(null, { providerRead: false })), 'not_read');
  assert.equal(di.classifyCoverage(input(ledger([journey('moving', 6, 9)]), { journeysRestricted: true })), 'restricted');
  assert.equal(di.classifyCoverage(input(null)), 'provider_distance_only');
  assert.equal(di.classifyCoverage(input(ledger([journey('moving', 6, 9)], { observations: 0, source: 'none' }))), 'no_positions');
  assert.equal(di.classifyCoverage(input(ledger([journey('moving', 6, 9, { positionSource: 'no_gps' })], { source: 'no_gps' }))), 'unverified');
  assert.equal(di.classifyCoverage(input(ledger([journey('moving', 6, 9)], { source: 'mixed' }))), 'partly_verified');
  assert.equal(di.classifyCoverage(input(ledger([journey('moving', 6, 9), journey('stopped', 9, 10)]))), 'verified_complete');
  assert.equal(di.classifyCoverage(input(ledger([journey('moving', 6, 9)], { missing: [{ start: at(10), end: at(12), minutes: 120, source: 'log_gap' }] }))), 'verified_incomplete');
  assert.equal(di.classifyCoverage(input(ledger([journey('moving', 6, 9)]), { providerReconciled: false })), 'verified_incomplete', 'an unreconciled provider total is not complete');
});

test('with zero bookings the day still gets activity and insights: bookings are not an input', () => {
  const L = ledger([journey('moving', 6, 9), journey('stopped', 9, 12), journey('moving', 12, 14)]);
  const r = di.buildDayInsights(input(L));
  assert.equal(r.activity.movingJourneys, 2); assert.equal(r.activity.stops, 1); assert.equal(r.activity.movingMinutes, 300); assert.equal(r.activity.stoppedMinutes, 180); assert.equal(r.activity.longestStopMinutes, 180);
  assert.ok(ids(r).includes('long_stop'));
  assert.doesNotMatch(read('lib/fleet-day-insights.ts') + read('components/fleet-day-insights.tsx'), /booking_diary|fetchBooking|BookingSnapshot|workOrder|LedgerJob/);
});

test('an unknown tracking gap is never counted as a stay or as inactivity', () => {
  const L = ledger([journey('moving', 6, 8), journey('stopped', 8, 9)], { missing: [{ start: at(9), end: at(20), minutes: 660, source: 'log_gap' }] });
  const r = di.buildDayInsights(input(L, { providerKm: 5 }));
  assert.equal(r.activity.stoppedMinutes, 60, 'gap minutes are not added to the stop');
  assert.ok(ids(r).includes('tracking_gap')); assert.ok(!ids(r).includes('long_stop')); assert.ok(!ids(r).includes('mostly_stationary'), 'a poorly covered day is unknown, not inactive');
  assert.equal(r.insights.find(i => i.id === 'tracking_gap').reliability, 'unknown');
});

test('inactivity is only claimed with good coverage and little distance', () => {
  const parked = ledger([journey('stopped', 0, 23.5)]);
  assert.ok(ids(di.buildDayInsights(input(parked, { providerKm: 2 }))).includes('mostly_stationary'));
  assert.ok(!ids(di.buildDayInsights(input(parked, { providerKm: 80 }))).includes('mostly_stationary'), 'it drove 80 km');
  assert.ok(!ids(di.buildDayInsights(input(ledger([journey('stopped', 0, 3)]), { providerKm: 0 }))).includes('mostly_stationary'), 'three tracked hours is not a day');
});

test('long distance uses the reconciled provider total only and never invents a figure', () => {
  const L = ledger([journey('moving', 5, 18)]);
  assert.ok(ids(di.buildDayInsights(input(L, { providerKm: 412 }))).includes('long_distance'));
  assert.ok(!ids(di.buildDayInsights(input(L, { providerKm: 412, providerReconciled: false }))).includes('long_distance'));
  assert.ok(!ids(di.buildDayInsights(input(L, { providerKm: null }))).includes('long_distance'));
  assert.ok(ids(di.buildDayInsights(input(null, { providerKm: 412 }))).includes('long_distance'), 'distance is the one thing the total can support without a ledger');
});

test('a restricted caller gets no journey detail from the insights, only the provider distance', () => {
  const L = ledger([journey('stopped', 8, 12)]);
  const r = di.buildDayInsights(input(L, { journeysRestricted: true, providerKm: 350 }));
  assert.equal(r.coverage, 'restricted'); assert.equal(r.activity.stops, null); assert.equal(r.activity.firstSegmentStart, null); assert.deepEqual(ids(r), ['long_distance']);
});

test('unverified positions are flagged and never upgraded to verified', () => {
  const r = di.buildDayInsights(input(ledger([journey('moving', 6, 9, { positionSource: 'no_gps' }), journey('stopped', 9, 10, { positionSource: 'no_gps' })], { source: 'no_gps' }), { verifiedObservations: 0 }));
  const u = r.insights.find(i => i.id === 'unverified_positions'); assert.ok(u); assert.equal(u.reliability, 'provider_reported'); assert.equal(r.coverage, 'unverified');
  for (const i of r.insights) assert.notEqual(i.reliability, 'verified_gps');
});

test('a day that begins or ends while moving shows the departure or return as unknown, never invented', () => {
  const r = di.buildDayInsights(input(ledger([journey('moving', 0, 3), journey('stopped', 3, 4), journey('moving', 4, 24)])));
  assert.equal(r.activity.startedMoving, true); assert.ok(ids(r).includes('starts_mid_journey')); assert.ok(ids(r).includes('ends_mid_journey'));
  const settled = di.buildDayInsights(input(ledger([journey('stopped', 0, 6), journey('moving', 6, 8), journey('stopped', 8, 24)])));
  assert.ok(!ids(settled).includes('starts_mid_journey')); assert.ok(!ids(settled).includes('ends_mid_journey'));
});

test('provider total versus trail distance is flagged only past the tolerance', () => {
  const near = ledger([journey('moving', 6, 9)], { trail: 120.5 }), far = ledger([journey('moving', 6, 9)], { trail: 150 });
  assert.ok(!ids(di.buildDayInsights(input(near))).includes('provider_trail_difference'));
  const f = di.buildDayInsights(input(far)).insights.find(i => i.id === 'provider_trail_difference');
  assert.ok(f); assert.equal(f.evidence.differencePct, 25);
});

test('engine-on during a stop uses the provider engine flag, not zero speed', () => {
  const withFlag = ledger([journey('stopped', 8, 9, { engineOnObservations: 9, observations: 10 })]), withoutFlag = ledger([journey('stopped', 8, 9, { engineOnObservations: null, observations: 10 })]), engineOff = ledger([journey('stopped', 8, 9, { engineOnObservations: 1, observations: 10 })]);
  assert.ok(ids(di.buildDayInsights(input(withFlag))).includes('engine_on_during_stop'));
  assert.ok(!ids(di.buildDayInsights(input(withoutFlag))).includes('engine_on_during_stop'), 'unknown engine state is not idling');
  assert.ok(!ids(di.buildDayInsights(input(engineOff))).includes('engine_on_during_stop'));
});

test('ambiguous segments are excluded from the totals and reported', () => {
  const r = di.buildDayInsights(input(ledger([journey('stopped', 8, 14, { ambiguous: true }), journey('moving', 14, 15)])));
  assert.equal(r.activity.stoppedMinutes, 0); assert.ok(ids(r).includes('ambiguous_segments')); assert.ok(!ids(r).includes('long_stop'));
});

test('every insight carries evidence, a reason, an office action and a reliability, in English and Thai', () => {
  const thai = /[฀-๿]/;
  for (const id of Object.keys(di.INSIGHT_COPY)) { const c = di.INSIGHT_COPY[id]; for (const k of ['title', 'reason', 'action']) { assert.ok(c[k][0].length > 10, `${id}.${k} en`); assert.match(c[k][1], thai, `${id}.${k} th`); } }
  for (const s of Object.keys(di.COVERAGE_COPY)) assert.match(di.COVERAGE_COPY[s][1], thai, s);
  for (const r of Object.keys(di.RELIABILITY_COPY)) assert.match(di.RELIABILITY_COPY[r][1], thai, r);
  const r = di.buildDayInsights(input(ledger([journey('moving', 6, 9), journey('stopped', 9, 12)])));
  for (const i of r.insights) { assert.equal(i.day, D); assert.ok(Object.keys(i.evidence).length > 0); assert.ok(di.INSIGHT_COPY[i.id]); }
});

test('the analysis is pure: it does not mutate its input or save anything', () => {
  const L = ledger([journey('stopped', 9, 12), journey('moving', 6, 9)]); const before = JSON.stringify(L);
  di.buildDayInsights(input(L)); assert.equal(JSON.stringify(L), before);
  const lib = read('lib/fleet-day-insights.ts'), cmp = read('components/fleet-day-insights.tsx');
  assert.doesNotMatch(lib + cmp, /fetch\(|supabase|\.insert\(|\.update\(|\.delete\(|localStorage|Date\.now\(\)|Math\.random/);
});

test('the Today tab shows the booking-independent view above the existing summary, with the existing summary unchanged', () => {
  const panel = read('components/fleet-evidence-panel.tsx');
  assert.match(panel, /import \{ FleetDayInsights \}/); assert.match(panel, /buildDayInsights\(\{ day: activeDay/);
  assert.ok(panel.indexOf('<FleetDayInsights') < panel.indexOf('<FleetVehicleDaySummary'));
  assert.match(panel, /<FleetVehicleDaySummary summary=\{summary\}/);
  const cmp = read('components/fleet-day-insights.tsx');
  for (const needle of ['data-day-insights', 'Asia/Bangkok', 'Unknown, not counted as a stay', 'Report boundaries, not departure or return times', 'ข้อสังเกต']) assert.ok(cmp.includes(needle), needle);
});

test('position counts reconcile: 921 received, 919 analysed is explained by duplicates and unreadable times, never silently lost', () => {
  const a = di.reconcilePositionCount(921, 919, 2);
  assert.equal(a.explained, true); assert.equal(a.noValidTime, 0);
  const b = di.reconcilePositionCount(921, 917, 2);
  assert.equal(b.noValidTime, 2); assert.equal(b.explained, true);
  const c = di.reconcilePositionCount(100, 120, 0);
  assert.equal(c.explained, false, 'more analysed than received cannot be explained');
  assert.equal(di.reconcilePositionCount(null, 5, 0).explained, null);
  const L = ledger([journey('moving', 6, 9)], { observations: 919 }); L.totals.duplicateObservations = 2;
  const r = di.buildDayInsights(input(L, { receivedObservations: 921 }));
  assert.deepEqual([r.positionCount.received, r.positionCount.analysed, r.positionCount.exactDuplicates, r.positionCount.explained], [921, 919, 2, true]);
  assert.match(read('components/fleet-day-insights.tsx'), /data-position-count/);
});

test('real-day shape (68-7154, 26 Oct): eleven stop segments totalling two minutes are not "many stops"; the open last segment explains the incomplete coverage', () => {
  const js = []; let h = 4.6;
  for (let i = 0; i < 9; i++) { js.push(journey('moving', h, h + 1.2)); h += 1.2; if (i < 8) { js.push(journey('stopped', h, h + 0.003)); h += 0.003; } }
  for (let i = 0; i < 3; i++) js.push(journey('stopped', 23.9 + i * 0.001, 23.9 + i * 0.001 + 0.0005));
  js.push(journey('open_final', 23.97, null, { minutes: null }));
  const L = ledger(js, { observations: 921 }); const r = di.buildDayInsights(input(L, { providerKm: 465.91, receivedObservations: 921, observations: 921, verifiedObservations: 921 }));
  assert.equal(r.coverage, 'verified_incomplete'); assert.deepEqual(r.coverageReasons, ['open_final_segment']);
  assert.ok(!ids(r).includes('many_stops'), 'tiny stops are not many stops'); assert.ok(ids(r).includes('long_distance')); assert.ok(ids(r).includes('ends_mid_journey'));
  const real = ledger(Array.from({ length: 9 }, (_, i) => journey('stopped', i * 2, i * 2 + 0.5)));
  assert.ok(ids(di.buildDayInsights(input(real))).includes('many_stops'));
});

test('coverage reasons are listed only when verified GPS is incomplete, and evidence labels exist in both languages', () => {
  const thai = /[฀-๿]/;
  const gap = ledger([journey('moving', 6, 9)], { missing: [{ start: at(10), end: at(12), minutes: 120, source: 'log_gap' }] });
  assert.deepEqual(di.buildDayInsights(input(gap)).coverageReasons, ['missing_history']);
  assert.deepEqual(di.buildDayInsights(input(ledger([journey('moving', 6, 9)]))).coverageReasons, []);
  assert.deepEqual(di.buildDayInsights(input(null, { providerRead: false })).coverageReasons, []);
  for (const k of Object.keys(di.COVERAGE_REASON_COPY)) assert.match(di.COVERAGE_REASON_COPY[k][1], thai, k);
  const all = Object.keys(di.INSIGHT_COPY).flatMap(id => { const L = ledger([journey('moving', 6, 9)]); return Object.keys(di.buildDayInsights(input(L)).insights.find(i => i.id === id)?.evidence ?? {}); });
  for (const key of ['providerKm', 'longestMinutes', 'missingMinutes', 'differencePct', 'stoppedShare', 'stopsOverFiveMinutes', 'engineFlag']) { assert.ok(di.EVIDENCE_LABELS[key], key); assert.match(di.EVIDENCE_LABELS[key][1], thai, key); }
  assert.equal(di.evidenceLabel('unknownKey', 'en'), 'unknownKey');
  void all;
});

test('a departure at 05:18 is an observed departure; only a segment touching the day boundary leaves the start or return unknown', () => {
  const morning = di.buildDayInsights(input(ledger([journey('moving', 5.3, 12), journey('stopped', 12, 13)])));
  assert.ok(!ids(morning).includes('starts_mid_journey'), 'first move at 05:18 is a real departure');
  assert.ok(!ids(morning).includes('ends_mid_journey'));
  const overnight = di.buildDayInsights(input(ledger([journey('moving', 0, 2), journey('stopped', 2, 20), journey('moving', 20, 24)])));
  assert.ok(ids(overnight).includes('starts_mid_journey')); assert.ok(ids(overnight).includes('ends_mid_journey'));
  const openEnd = di.buildDayInsights(input(ledger([journey('moving', 5.3, 12), journey('open_final', 23.9, null, { minutes: null })])));
  assert.ok(ids(openEnd).includes('ends_mid_journey'), 'an open final segment means the return is not observed');
  const middleMove = di.buildDayInsights(input(ledger([journey('stopped', 0, 6), journey('moving', 6, 18), journey('stopped', 18, 24)])));
  assert.ok(!ids(middleMove).includes('ends_mid_journey'));
});
