const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('../scripts/fleet-real-day-validation.cjs');
const di = load('lib/fleet-day-insights.ts');
const rv = load('lib/fleet-day-review.ts');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/\r\n/g, '\n');

const emptyActivity = { movingJourneys: 2, stops: 1, movingMinutes: 300, stoppedMinutes: 20, longestStopMinutes: 20, missingMinutes: 0, coverageShare: 1, firstSegmentStart: null, lastSegmentEnd: null, startedMoving: false, endedMoving: false, observations: 100, verifiedObservations: 100 };
const review = (o = {}) => ({ coverage: 'verified_complete', coverageReasons: [], activity: emptyActivity, insights: [], positionCount: { received: 100, analysed: 100, exactDuplicates: 0, noValidTime: 0, explained: true }, journeyAccess: 'granted', ...o });
let n = 0;
const row = (o = {}) => ({ vehicleId: `v${++n}`, registration: `70-${1000 + n}`, providerKm: 120, providerReconciled: true, segments: 10, capturedAt: '2026-11-07T10:00:00Z', review: review(), ...o });
const ins = (id, evidence = {}, reliability = 'verified_gps') => ({ id, reliability, evidence });

test('evidence status separates not requested, available, partial, no provider data, failed, no device and rate limited', () => {
  assert.equal(rv.evidenceStatusOf(row({ review: null })), 'not_requested');
  assert.equal(rv.evidenceStatusOf(row({ review: review({ coverage: 'not_read' }) })), 'not_requested');
  assert.equal(rv.evidenceStatusOf(row()), 'available');
  assert.equal(rv.evidenceStatusOf(row({ review: review({ coverage: 'restricted' }) })), 'partial');
  assert.equal(rv.evidenceStatusOf(row({ review: review({ coverage: 'provider_distance_only' }) })), 'partial');
  assert.equal(rv.evidenceStatusOf(row({ review: review({ coverage: 'no_positions' }), segments: 0, providerKm: null })), 'no_provider_data');
  assert.equal(rv.evidenceStatusOf(row({ review: null }), 'loading'), 'loading');
  assert.equal(rv.evidenceStatusOf(row({ review: null }), 'queued'), 'queued');
  assert.equal(rv.evidenceStatusOf(row({ review: null }), 'failed'), 'failed');
  assert.equal(rv.evidenceStatusOf(row({ review: null }), 'no_device'), 'no_device');
  assert.equal(rv.evidenceStatusOf(row({ review: null }), 'rate_limited'), 'rate_limited');
});

test('an unread vehicle is never zero kilometres or "no activity": it is "not requested" with unknown distance', () => {
  const r = rv.reviewVehicle(row({ review: null, providerKm: null, providerReconciled: false }));
  assert.equal(r.status, 'not_requested'); assert.equal(r.providerKm, null); assert.equal(r.priority, 'none'); assert.equal(r.verified, 'unknown'); assert.deepEqual(r.exceptions, []);
});

test('priority is deterministic: discrepancies and unexplained evidence are high, stops and unverified are medium, activity is informational', () => {
  const p = insights => rv.reviewVehicle(row({ review: review({ insights }) })).priority;
  assert.equal(p([ins('provider_trail_difference', { differencePct: 25 })]), 'high');
  assert.equal(p([ins('provider_trail_difference', { differencePct: 2 })]), 'medium');
  assert.equal(p([ins('tracking_gap', { missingMinutes: 400 })]), 'high');
  assert.equal(p([ins('tracking_gap', { missingMinutes: 90 })]), 'medium');
  assert.equal(p([ins('long_stop', { longestMinutes: 150 })]), 'medium');
  assert.equal(p([ins('unverified_positions')]), 'medium');
  assert.equal(p([ins('long_distance', { providerKm: 465 }), ins('ends_mid_journey'), ins('many_stops')]), 'info');
  assert.equal(p([]), 'none');
  assert.equal(rv.reviewVehicle(row({ review: review({ positionCount: { received: 100, analysed: 120, exactDuplicates: 0, noValidTime: null, explained: false } }) })).priority, 'high');
  assert.equal(rv.reviewVehicle(row({ review: review({ coverageReasons: ['provider_total_not_reconciled'] }) })).priority, 'high');
});

test('no legal speeding, excessive idling, delivery completion or waiting-charge exception exists', () => {
  const keys = Object.keys(rv.INSIGHT_GROUP).concat(Object.keys(rv.EXCEPTION_COPY));
  for (const k of keys) assert.doesNotMatch(k, /speed|delivery|waiting|charge|complete_job|idling_excess/i, k);
  const lib = read('lib/fleet-day-review.ts') + read('lib/fleet-day-insights.ts');
  assert.doesNotMatch(lib, /booking_diary|fetchBooking|BookingSnapshot|workOrder|LedgerJob/);
});

test('related insights are deduplicated by key and grouped, and the list ranks high before medium before info', () => {
  const dup = rv.reviewVehicle(row({ review: review({ insights: [ins('unverified_positions'), ins('unverified_positions'), ins('long_distance', { providerKm: 400 })] }) }));
  assert.equal(dup.exceptions.filter(e => e.key === 'unverified_positions').length, 1);
  assert.deepEqual(dup.exceptions.map(e => e.key), ['unverified_positions', 'long_distance']);
  assert.equal(rv.INSIGHT_GROUP.unverified_positions, 'tracking_health'); assert.equal(rv.INSIGHT_GROUP.long_distance, 'journey_activity'); assert.equal(rv.INSIGHT_GROUP.ambiguous_segments, 'evidence_integrity');
  const high = row({ registration: 'AAA-1', review: review({ insights: [ins('tracking_gap', { missingMinutes: 500 })] }) }), med = row({ registration: 'BBB-2', review: review({ insights: [ins('long_stop')] }) }), info = row({ registration: 'CCC-3', review: review({ insights: [ins('long_distance')] }) }), none = row({ registration: 'DDD-4' });
  const sorted = rv.sortReviews([none, info, med, high].map(r => rv.reviewVehicle(r)), 'priority').map(r => r.registration);
  assert.deepEqual(sorted, ['AAA-1', 'BBB-2', 'CCC-3', 'DDD-4']);
  assert.deepEqual(rv.sortReviews([med, high].map(r => rv.reviewVehicle(r)), 'registration').map(r => r.registration), ['AAA-1', 'BBB-2']);
});

test('fleet summary never presents a partial sum as the fleet total and never adds conflicting sources', () => {
  const rows = [row({ providerKm: 100 }), row({ providerKm: 50 }), row({ review: null, providerKm: null, providerReconciled: false }), row({ review: review({ coverage: 'unverified' }), providerKm: 30 })];
  const s = rv.summarizeFleetReview(rows.map(r => rv.reviewVehicle(r)));
  assert.equal(s.vehicles, 4); assert.equal(s.withEvidence, 3); assert.equal(s.notRequested, 1); assert.equal(s.verified, 2); assert.equal(s.unverified, 1);
  assert.equal(s.distance.km, 180); assert.equal(s.distance.includedVehicles, 3); assert.equal(s.distance.totalVehicles, 4); assert.equal(s.distance.complete, false);
  const all = rv.summarizeFleetReview([row(), row()].map(r => rv.reviewVehicle(r))); assert.equal(all.distance.complete, true);
  assert.equal(rv.summarizeFleetReview([]).distance.km, null, 'an empty fleet has unknown distance, not zero');
  const unreconciled = rv.summarizeFleetReview([rv.reviewVehicle(row({ providerKm: 99, providerReconciled: false }))]); assert.equal(unreconciled.distance.km, null, 'an unreconciled provider total is not included');
});

test('the read action asks only for unread, unique vehicle-days and is capped; read, queued and no-device vehicles are skipped', () => {
  const a = row({ vehicleId: 'a', review: null }), b = row({ vehicleId: 'b' }), c = row({ vehicleId: 'c', review: null }), dup = row({ vehicleId: 'a', review: null }), d = row({ vehicleId: 'd', review: review({ coverage: 'not_read' }) });
  assert.deepEqual(rv.vehiclesToRead([a, b, c, dup, d], { c: 'queued' }), ['a', 'd']);
  assert.deepEqual(rv.vehiclesToRead([a, c], { a: 'no_device', c: 'done' }), []);
  const many = Array.from({ length: 40 }, (_, i) => row({ vehicleId: `x${i}`, review: null }));
  assert.equal(rv.vehiclesToRead(many).length, rv.FLEET_READ_CAP);
});

test('queue: one at a time by default, deduplicated, per-vehicle state, and a failure for one vehicle does not block the others', async () => {
  let active = 0, maxActive = 0; const calls = []; const states = {};
  const worker = async id => { active++; maxActive = Math.max(maxActive, active); calls.push(id); await new Promise(r => setTimeout(r, 5)); active--; return { status: id === 'bad' ? 502 : id === 'nodev' ? 409 : 200 }; };
  const out = await rv.runReadQueue(['a', 'bad', 'a', 'nodev', 'c'], worker, { onState: (id, s) => { states[id] = s; } });
  assert.equal(maxActive, 1); assert.deepEqual(calls, ['a', 'bad', 'nodev', 'c'], 'duplicate ids are requested once');
  assert.deepEqual(out.map(o => o.result), ['done', 'failed', 'no_device', 'done']); assert.deepEqual(states, { a: 'done', bad: 'failed', nodev: 'no_device', c: 'done' });
  maxActive = 0; await rv.runReadQueue(['p', 'q', 'r', 's'], worker, { concurrency: 10 }); assert.ok(maxActive <= 2, 'concurrency is clamped');
});

test('queue: a rate-limit or access response stops safely, leaves the rest not requested, and a thrown error is a per-vehicle failure', async () => {
  const states = {}; const calls = [];
  const out = await rv.runReadQueue(['a', 'b', 'c', 'd'], async id => { calls.push(id); return { status: id === 'b' ? 429 : 200 }; }, { onState: (id, s) => { states[id] = s; } });
  assert.deepEqual(calls, ['a', 'b']); assert.equal(states.b, 'rate_limited'); assert.equal(states.c, 'idle'); assert.equal(states.d, 'idle'); assert.equal(out.at(-1).result, 'rate_limited');
  const out2 = await rv.runReadQueue(['x', 'y'], async id => { if (id === 'x') throw new Error('network'); return { status: 200 }; });
  assert.deepEqual(out2.map(o => o.result), ['failed', 'done']);
  const out3 = await rv.runReadQueue(['u', 'v'], async id => ({ status: id === 'u' ? 503 : 200 })); assert.deepEqual(out3.map(o => o.result), ['unavailable']);
});

test('queue: aborting stops without starting more provider reads', async () => {
  const controller = new AbortController(); const calls = [];
  const out = await rv.runReadQueue(['a', 'b', 'c'], async (id, signal) => { calls.push(id); if (id === 'a') controller.abort(); await new Promise(r => setTimeout(r, 5)); if (signal.aborted) throw new Error('aborted'); return { status: 200 }; }, { signal: controller.signal });
  assert.deepEqual(calls, ['a']); assert.equal(out[0].result, 'aborted');
});

test('the default review day is the previous Bangkok calendar day, including around UTC midnight', () => {
  assert.equal(rv.previousBangkokDay(new Date('2026-11-07T10:00:00Z')), '2026-11-06');
  assert.equal(rv.previousBangkokDay(new Date('2026-11-06T17:30:00Z')), '2026-11-06', '00:30 on 7 Nov in Bangkok: yesterday is 6 Nov');
  assert.equal(rv.previousBangkokDay(new Date('2026-11-06T16:30:00Z')), '2026-11-05', '23:30 on 6 Nov in Bangkok: yesterday is 5 Nov');
  assert.equal(rv.previousBangkokDay(new Date('2026-01-01T00:30:00+07:00')), '2025-12-31');
});

test('every status, priority, group and exception copy exists in Thai; unknown text exists for every insight', () => {
  const thai = /[฀-๿]/;
  for (const k of Object.keys(rv.STATUS_COPY)) assert.match(rv.STATUS_COPY[k][1], thai, k);
  for (const k of Object.keys(rv.PRIORITY_COPY).filter(k => k !== 'none')) assert.match(rv.PRIORITY_COPY[k][1], thai, k);
  for (const k of Object.keys(rv.GROUP_COPY)) assert.match(rv.GROUP_COPY[k][1], thai, k);
  for (const k of Object.keys(rv.EXCEPTION_COPY)) for (const f of ['title', 'unknown', 'action']) assert.match(rv.EXCEPTION_COPY[k][f][1], thai, `${k}.${f}`);
  for (const id of Object.keys(di.INSIGHT_COPY)) { assert.ok(rv.INSIGHT_UNKNOWN[id], id); assert.match(rv.INSIGHT_UNKNOWN[id][1], thai, id); assert.ok(rv.INSIGHT_GROUP[id], id); }
});

test('server: the fleet route stays cache-only and applies the journey authorisation on the server; no Forth call, no raw coordinates', () => {
  const route = read('app/api/admin/forth-tracking/evidence/fleet/route.ts');
  assert.match(route, /canViewJourneyDetail\(/); assert.match(route, /applyJourneyAccess\(/); assert.match(route, /recalledProviderDay\(user\.id,/);
  assert.doesNotMatch(route, /getForth\w+|forth-tracking-server|fetch\(/);
  assert.doesNotMatch(route, /observedPoints|reportedPoints|latitude|longitude/);
  assert.match(route, /Cache-Control": "private, no-store"/);
});

test('cache isolation: provider-day evidence is keyed by the authenticated user, so another user or a guessed id sees nothing', () => {
  const session = read('lib/fleet-intelligence-session.ts');
  assert.match(session, /JSON\.stringify\(\[userId, vehicleId, registration, day\]\)/);
  const provider = read('app/api/admin/forth-tracking/evidence/provider/route.ts');
  assert.match(provider, /recalledProviderDayEntry\(user\.id, vehicleId, vehicle\.data\.vehicle_reg, day\)/); assert.match(provider, /beginForthHistoryRateLimit\(rateKey\)/);
  assert.match(provider, /A unique Forth device association is required/, 'a wrong or duplicate device mapping is refused with 409, not guessed');
  const limit = read('lib/forth-history-rate-limit.ts'); assert.match(limit, /MAX_IN_FLIGHT = 1/); assert.match(limit, /MAX_REQUESTS = 12/);
});

test('UI wiring: the review sits in the Reports stack, the drill-down passes the day, the panel starts on that day, and the map and six tabs are untouched', () => {
  const centre = read('components/forth-tracking-centre.tsx'), panel = read('components/fleet-evidence-panel.tsx'), cmp = read('components/fleet-day-review.tsx');
  // V6.4: the drill-down is one shared function used by the daily review and the recurring places.
  assert.match(centre, /<FleetDayReview language=\{language\} onVehicle=\{openReviewedVehicleDay\}/); assert.match(centre, /const openReviewedVehicleDay = \(registration: string, reviewedDay: string\)/); assert.match(centre, /setReviewDrill\(\{ registration, day: reviewedDay \}\)/);
  assert.match(centre, /initialDay=\{reviewDrill && normaliseRegistration\(reviewDrill\.registration\) === normaliseRegistration\(activeEesVehicle\.vehicle_reg\)/);
  assert.match(centre, /<FleetDailyReport language=\{language\}/, 'the existing fleet comparison report is kept');
  assert.match(panel, /initialDay\?: string/); assert.match(panel, /seed\?\.from \?\? shiftDay\(DAYS_BACK\)/);
  for (const needle of ['data-fleet-day-review', 'data-fleet-summary', 'data-distance-disclosure', 'previousBangkokDay()', 'runReadQueue(', 'concurrency: 1', 'Asia/Bangkok', 'Read this day', 'ตรวจสอบกองรถรายวัน']) assert.ok(cmp.includes(needle), needle);
  assert.doesNotMatch(cmp, /setInterval|setTimeout\(\(\) => void read|localStorage|booking/i, 'no automatic background work and no bookings');
  assert.match(cmp, /useEffect\(\(\) => \{ void loadReport\(day\); \}, \[day, loadReport\]\)/);
});

test('the panel accepts a real YYYY-MM-DD drill-down day (regex regression found in the browser)', () => {
  const panel = read('components/fleet-evidence-panel.tsx');
  const m = panel.match(/const validInitialDay = initialDay && (\/.+?\/)\.test\(initialDay\)/);
  assert.ok(m, 'validation expression present');
  const re = eval(m[1]);
  assert.ok(re.test('2026-10-26')); assert.ok(!re.test('26/10/2026')); assert.ok(!re.test('2026-10-26; drop')); assert.ok(!re.test(''));
});
