const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('../scripts/fleet-real-day-validation.cjs');
const ra = load('lib/fleet-recurring-areas.ts');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/\r\n/g, '\n');

// ~111.2 m per 0.001 deg latitude at any longitude.
const BASE = { latitude: 13.7, longitude: 100.6 };
const at = (northM, eastM = 0) => ({ latitude: BASE.latitude + northM / 111_195, longitude: BASE.longitude + eastM / (111_195 * Math.cos(BASE.latitude * Math.PI / 180)) });
const cluster = (pos, minutes, o = {}) => ({ kind: 'stop', centroid: pos, observations: 6, firstAt: o.firstAt ?? '2026-10-05T08:00:00+07:00', lastAt: o.lastAt ?? '2026-10-05T09:00:00+07:00', beforeAt: '2026-10-05T07:55:00+07:00', afterAt: '2026-10-05T09:05:00+07:00',
  arrivalWindow: { earliest: null, latest: o.firstAt ?? '' }, departureWindow: { earliest: '', latest: null }, dwellMs: { min: minutes * 60_000, max: (minutes + 10) * 60_000 }, medianSpeedKph: 0, maxSpeedKph: 1,
  verifiedShare: o.quality === 'unverified' ? 0 : 1, sourceQuality: o.quality ?? 'verified_gps', gapBefore: o.gap ?? false, gapAfter: false, tightWindows: true });
let seq = 0;
const visit = (vehicle, day, pos, minutes, o = {}) => ({ vehicleKey: `veh-${vehicle}`, registration: vehicle, day, dayMissingMinutes: o.missing ?? 0, cluster: cluster(pos, minutes, { firstAt: o.firstAt ?? `${day}T${String(8 + (seq++ % 10)).padStart(2, '0')}:00:00+07:00`, lastAt: o.lastAt ?? `${day}T${String(9 + (seq % 10)).padStart(2, '0')}:00:00+07:00`, quality: o.quality, gap: o.gap }) });

test('repeat days: three visits on three different days make one recurring area; the count is days, not visits', () => {
  const r = ra.analyseRecurringAreas([visit('68-7154', '2026-10-05', at(0), 77), visit('68-7154', '2026-10-12', at(20, 15), 40), visit('68-7154', '2026-10-26', at(-10, 5), 34)]);
  assert.equal(r.areas.length, 1); const a = r.areas[0];
  assert.equal(a.distinctDays, 3); assert.equal(a.visits, 3); assert.equal(a.vehicleDays, 3); assert.equal(a.kind, 'recurring_area'); assert.deepEqual(a.days, ['2026-10-05', '2026-10-12', '2026-10-26']);
  assert.deepEqual([a.stayMinutes.min, a.stayMinutes.median, a.stayMinutes.longestSupported], [34, 40, 77]);
});

test('same-day repeats are not repeat-day evidence: three visits on one day stay one day and are flagged', () => {
  const r = ra.analyseRecurringAreas([visit('A', '2026-10-05', at(0), 20), visit('A', '2026-10-05', at(5), 15), visit('A', '2026-10-05', at(8), 25)]);
  const a = r.areas[0]; assert.equal(a.visits, 3); assert.equal(a.distinctDays, 1); assert.ok(a.flags.includes('same_day_repeats_only')); assert.notEqual(a.kind, 'recurring_area');
});

test('cross-vehicle: two vehicles on the same day count as two vehicles but still one day', () => {
  const r = ra.analyseRecurringAreas([visit('A', '2026-10-05', at(0), 30), visit('B', '2026-10-05', at(10), 45)]);
  const a = r.areas[0]; assert.equal(a.vehicles.length, 2); assert.equal(a.distinctDays, 1); assert.equal(a.vehicleDays, 2); assert.ok(a.flags.includes('multi_vehicle')); assert.notEqual(a.kind, 'recurring_area');
  const two = ra.analyseRecurringAreas([visit('A', '2026-10-05', at(0), 30), visit('B', '2026-10-06', at(10), 45)]);
  assert.equal(two.areas[0].distinctDays, 2); assert.equal(two.areas[0].kind, 'recurring_area');
});

test('neighbouring factories 200 m apart stay separate areas and each warns that the other is close', () => {
  const r = ra.analyseRecurringAreas([visit('A', '2026-10-05', at(0), 40), visit('A', '2026-10-06', at(5), 40), visit('A', '2026-10-05', at(200), 40), visit('A', '2026-10-06', at(205), 40)]);
  assert.equal(r.areas.length, 2); for (const a of r.areas) { assert.ok(a.flags.includes('could_be_neighbouring_site')); assert.ok(a.nearestOtherAreaM >= 190 && a.nearestOtherAreaM <= 215); assert.equal(a.distinctDays, 2); }
});

test('chained expansion is bounded: ten stops 100 m apart in a line never become one huge area', () => {
  const visits = Array.from({ length: 10 }, (_, i) => visit('A', `2026-10-${String(10 + i).padStart(2, '0')}`, at(i * 100), 30));
  const r = ra.analyseRecurringAreas(visits);
  assert.ok(r.areas.length >= 4, `chain split into ${r.areas.length} areas`);
  for (const a of r.areas) assert.ok(a.radiusM <= 130, `radius ${a.radiusM}`);
  assert.equal(r.areas.reduce((n, a) => n + a.visits, 0), 10, 'no visit is lost or counted twice');
});

test('GPS uncertainty: repeating an unverified stop never makes it verified', () => {
  const r = ra.analyseRecurringAreas([visit('A', '2026-10-05', at(0), 60, { quality: 'unverified' }), visit('A', '2026-10-06', at(3), 60, { quality: 'unverified' }), visit('A', '2026-10-07', at(1), 60, { quality: 'unverified' })]);
  const a = r.areas[0]; assert.deepEqual(a.quality, { verified: 0, mixed: 0, unverified: 3 }); assert.ok(a.flags.includes('unverified_positions')); assert.equal(a.distinctDays, 3);
  assert.match(ra.describeArea(a, 'en').join(' '), /3 of 3 visits used positions that are not verified GPS/);
});

test('missing tracking: a stay next to a gap is flagged and its length is not extended by the gap', () => {
  const r = ra.analyseRecurringAreas([visit('A', '2026-10-05', at(0), 25, { gap: true, missing: 240 }), visit('A', '2026-10-06', at(2), 30)]);
  const a = r.areas[0]; assert.equal(a.visitsNextToGap, 1); assert.ok(a.flags.includes('next_to_tracking_gap')); assert.equal(a.stayMinutes.longestSupported, 30, 'observed minimum only'); assert.equal(a.daysWithKnownMissingTracking, 1);
});

test('short stays only are flagged as possible roadside or traffic, and slow movement is ignored entirely', () => {
  const slow = { ...visit('A', '2026-10-05', at(0), 30), cluster: { ...cluster(at(0), 30), kind: 'slow_movement' } };
  const r = ra.analyseRecurringAreas([visit('A', '2026-10-05', at(500), 4), visit('A', '2026-10-06', at(502), 6), slow]);
  assert.equal(r.sample.slowMovementIgnored, 1); assert.equal(r.areas.length, 1); assert.ok(r.areas[0].flags.includes('short_stays_only_possible_roadside'));
});

test('duplicate evidence is counted once', () => {
  const v = visit('A', '2026-10-05', at(0), 30, { firstAt: '2026-10-05T08:00:00+07:00', lastAt: '2026-10-05T08:40:00+07:00' });
  const r = ra.analyseRecurringAreas([v, { ...v }, { ...v }]);
  assert.equal(r.areas[0].visits, 1); assert.equal(r.sample.duplicatesRemoved, 2); assert.ok(r.areas[0].flags.includes('duplicates_removed'));
});

test('partial samples are disclosed: one reviewed day cannot show repeat evidence and says so', () => {
  const r = ra.analyseRecurringAreas([visit('A', '2026-10-05', at(0), 30), visit('B', '2026-10-05', at(2000), 30)]);
  assert.equal(r.sample.days, 1); assert.equal(r.sample.vehicles, 2); assert.equal(r.sample.vehicleDays, 2);
  assert.ok(r.limits.some(l => /Fewer than two reviewed days/.test(l))); assert.ok(r.limits.some(l => /already read in this session/.test(l)));
  assert.equal(ra.analyseRecurringAreas([]).areas.length, 0);
});

test('directory matching never infers a depot or customer from movement alone', () => {
  const visits = [visit('A', '2026-10-05', at(0), 600), visit('A', '2026-10-06', at(0), 600), visit('B', '2026-10-07', at(0), 600)];
  const none = ra.analyseRecurringAreas(visits).areas[0]; assert.equal(none.kind, 'recurring_area'); assert.equal(none.placeHint, 'no_match'); assert.notEqual(none.kind, 'likely_depot_area');
  const forth = ra.analyseRecurringAreas(visits, [{ id: 'f1', name: 'Some factory', ...at(30), source: 'forth_saved_location', category: 'Customer' }]).areas[0];
  assert.equal(forth.placeHint, 'near_unverified_directory_point'); assert.equal(forth.kind, 'possible_customer_area'); assert.equal(forth.matches[0].source, 'forth_saved_location');
  const pin = ra.analyseRecurringAreas(visits, [{ id: 'p1', name: 'Confirmed site', ...at(40), source: 'office_confirmed_pin', category: null }]).areas[0]; assert.equal(pin.placeHint, 'near_directory_location');
  const depot = ra.analyseRecurringAreas(visits, [{ id: 'd1', name: 'EES depot', ...at(10), source: 'forth_saved_location', category: 'Depot' }]).areas[0]; assert.equal(depot.placeHint, 'near_depot_or_office'); assert.equal(depot.kind, 'likely_depot_area');
  const many = ra.analyseRecurringAreas(visits, [{ id: 'f1', name: 'One', ...at(30), source: 'forth_saved_location' }, { id: 'f2', name: 'Two', ...at(-40), source: 'forth_saved_location' }]).areas[0]; assert.equal(many.placeHint, 'multiple_plausible'); assert.equal(many.matches.length, 2);
  const far = ra.analyseRecurringAreas(visits, [{ id: 'f3', name: 'Far', ...at(900), source: 'forth_saved_location' }]).areas[0]; assert.equal(far.placeHint, 'no_match');
});

test('movement patterns: a repeated A-to-B sequence on two days is found; the first or last stop of a day is not assumed to be a depot', () => {
  const day = (d, vehicle) => [visit(vehicle, d, at(0), 30, { firstAt: `${d}T08:00:00+07:00`, lastAt: `${d}T08:30:00+07:00` }), visit(vehicle, d, at(5000), 30, { firstAt: `${d}T11:00:00+07:00`, lastAt: `${d}T11:30:00+07:00` }), visit(vehicle, d, at(0), 20, { firstAt: `${d}T15:00:00+07:00`, lastAt: `${d}T15:20:00+07:00` })];
  const r = ra.analyseRecurringAreas([...day('2026-10-05', 'A'), ...day('2026-10-06', 'B')]);
  assert.equal(r.areas.length, 2);
  const seqPattern = r.patterns.find(p => p.kind === 'repeated_sequence'); assert.ok(seqPattern); assert.equal(seqPattern.days, 2); assert.equal(seqPattern.vehicles, 2);
  const back = r.patterns.find(p => p.kind === 'return_to_area'); assert.ok(back); assert.equal(back.days, 2);
  for (const a of r.areas) assert.notEqual(a.kind, 'likely_depot_area');
  assert.equal(ra.analyseRecurringAreas(day('2026-10-05', 'A')).patterns.length, 0, 'one day is not a pattern');
});

test('deterministic: shuffled input gives identical areas and ids', () => {
  const visits = [visit('A', '2026-10-05', at(0), 60), visit('B', '2026-10-06', at(10), 30), visit('A', '2026-10-07', at(3000), 20), visit('C', '2026-10-08', at(3010), 45), visit('A', '2026-10-09', at(-2500), 90)];
  const a = ra.analyseRecurringAreas(visits), b = ra.analyseRecurringAreas([...visits].reverse()), c = ra.analyseRecurringAreas([visits[3], visits[0], visits[4], visits[2], visits[1]]);
  const sig = r => JSON.stringify(r.areas.map(x => [x.id, x.visits, x.distinctDays, x.vehicles, Math.round(x.centroid.latitude * 1e5)]));
  assert.equal(sig(a), sig(b)); assert.equal(sig(a), sig(c));
});

test('performance bounds: thousands of visits finish quickly, are capped, and say so', () => {
  const visits = Array.from({ length: 3000 }, (_, i) => visit(`V${i % 21}`, `2026-09-${String(1 + (i % 28)).padStart(2, '0')}`, at((i % 150) * 400, (i % 7) * 400), 10 + (i % 90), { firstAt: `2026-09-${String(1 + (i % 28)).padStart(2, '0')}T${String(i % 24).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00.${String(i % 1000).padStart(3, '0')}+07:00`, lastAt: `2026-09-${String(1 + (i % 28)).padStart(2, '0')}T${String(i % 24).padStart(2, '0')}:${String((i + 30) % 60).padStart(2, '0')}:00.${String(i % 997).padStart(3, '0')}+07:00` }));
  const start = Date.now(); const r = ra.analyseRecurringAreas(visits); const elapsed = Date.now() - start;
  assert.ok(elapsed < 3000, `took ${elapsed} ms`); assert.equal(r.sample.truncated, true); assert.ok(r.sample.visitsAnalysed <= 2000); assert.ok(r.areas.length <= 60); assert.ok(r.limits.some(l => /longest stays were analysed/.test(l)));
});

test('options are configurable and conservative by default', () => {
  assert.equal(ra.DEFAULT_OPTIONS.seedRadiusM, 120); assert.equal(ra.DEFAULT_OPTIONS.maxDiameterM, 250); assert.equal(ra.DEFAULT_OPTIONS.minRecurringDays, 2);
  const visits = [visit('A', '2026-10-05', at(0), 30), visit('A', '2026-10-06', at(300), 30)];
  assert.equal(ra.analyseRecurringAreas(visits).areas.length, 2); assert.equal(ra.analyseRecurringAreas(visits, [], { seedRadiusM: 400, maxDiameterM: 500 }).areas.length, 1);
  assert.equal(ra.analyseRecurringAreas([visit('A', '2026-10-05', at(0), 30), visit('A', '2026-10-06', at(1), 30)], [], { minRecurringDays: 3 }).areas[0].kind, 'one_off_stop');
});

test('English and Thai copy exists for every kind, hint and flag, and the summaries use the real values', () => {
  const thai = /[฀-๿]/;
  for (const k of Object.keys(ra.KIND_COPY)) assert.match(ra.KIND_COPY[k][1], thai, k);
  for (const k of Object.keys(ra.HINT_COPY)) assert.match(ra.HINT_COPY[k][1], thai, k);
  for (const k of Object.keys(ra.FLAG_COPY)) assert.match(ra.FLAG_COPY[k][1], thai, k);
  const a = ra.analyseRecurringAreas([visit('68-7154', '2026-10-05', at(0), 77), visit('64-8665', '2026-10-26', at(10), 34, { quality: 'unverified' })]).areas[0];
  const en = ra.describeArea(a, 'en').join(' '), th = ra.describeArea(a, 'th').join(' ');
  assert.match(en, /2 reviewed days \(2 visits\)/); assert.match(en, /2 vehicles stopped here independently \(64-8665, 68-7154\)/); assert.match(en, /shortest 34 min, typical 55.5 min, longest supported 77 min/); assert.match(en, /1 of 2 visits used positions that are not verified GPS/);
  assert.match(th, thai); assert.match(th, /2 วันที่ตรวจสอบ/); assert.match(th, /77 นาที/);
  assert.doesNotMatch(en + th, /%|confidence|probab/i, 'no invented confidence figures');
});

test('no booking dependency and no side effects in the library', () => {
  const lib = read('lib/fleet-recurring-areas.ts');
  assert.doesNotMatch(lib, /booking|fetch\(|supabase|localStorage|Date\.now\(\)|Math\.random|\.insert\(|\.update\(/i);
  assert.match(lib, /import \{ metersBetween \} from "\.\/fleet-job-movement"/); assert.match(lib, /import type \{ StopCluster \} from "\.\/fleet-stop-intelligence"/);
  assert.doesNotMatch(lib, /function detectStopClusters|function metersBetween|haversine/i, 'no competing stop or distance calculation');
});

test('short-stop spots (junction or traffic like) are listed after areas with real stays, even when they repeat on more days', () => {
  const real = [visit('A', '2026-10-05', at(0), 80), visit('A', '2026-10-06', at(3), 90)];
  const junction = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08'].map(d => visit('A', d, at(3000), 2));
  const r = ra.analyseRecurringAreas([...junction, ...real]);
  assert.equal(r.areas.length, 2); assert.ok(r.areas[0].stayMinutes.longestSupported >= 80); assert.ok(r.areas[1].flags.includes('short_stays_only_possible_roadside')); assert.equal(r.areas[1].distinctDays, 4);
});

test('the recurring-places panel hides short-stop spots by default with a visible, honest toggle', () => {
  const cmp = read('components/fleet-recurring-areas.tsx');
  for (const needle of ['data-roadside-note', 'short_stays_only_possible_roadside', 'setShowRoadside', 'data-recurring-areas', 'data-recurring-forbidden', 'previousBangkokDay()', "t(\"Recurring places", 'จุดที่เกิดซ้ำ']) assert.ok(cmp.includes(needle), needle);
  assert.doesNotMatch(cmp, /setInterval|evidence\/provider|bookings?\b/i);
  assert.match(cmp, /\/api\/admin\/forth-tracking\/evidence\/recurring/);
  // V6.5: the one POST is the "Review location" handoff to the candidate route; the list itself is a cache-only GET.
  assert.equal((cmp.match(/method: "POST"/g) ?? []).length, 1); assert.match(cmp, /evidence\/recurring\/candidate", \{ method: "POST"/);
});

test('wiring: Reports and the vehicle Journeys tab both use the one component, with one shared drill-down', () => {
  const centre = read('components/forth-tracking-centre.tsx'), panel = read('components/fleet-evidence-panel.tsx');
  assert.match(centre, /<FleetRecurringAreas language=\{language\} onOpenDay=\{openReviewedVehicleDay\} \/>/); assert.match(centre, /<FleetDayReview language=\{language\} onVehicle=\{openReviewedVehicleDay\} \/>/);
  assert.match(panel, /<FleetRecurringAreas key=\{`recurring:\$\{vehicleId\}`\} language=\{language\} vehicleId=\{vehicleId\}/); assert.match(panel, /function openRecurringDay\(day: string\) \{ setScope\(day, day\); setAutoLoadTick/);
  const journeys = panel.slice(panel.indexOf('data-view="journeys"'), panel.indexOf('data-view="fuel"')); assert.ok(journeys.includes('<FleetRecurringAreas'), 'it sits in the Journeys tab; the six tabs are unchanged');
  for (const id of ['"today"', '"jobs"', '"journeys"', '"fuel"', '"health"']) assert.ok(panel.includes(id) || centre.includes(id), id);
});
