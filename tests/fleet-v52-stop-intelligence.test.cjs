const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('../scripts/fleet-real-day-validation.cjs');
const si = load('lib/fleet-stop-intelligence.ts');
const lp = load('lib/fleet-location-priority.ts');
const dayMod = load('lib/fleet-intelligence-day.ts');
const jm = load('lib/fleet-job-movement.ts');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/\r\n/g, '\n');
const DAY = '2026-10-26';
const at = hms => new Date(Date.parse(`${DAY}T${hms}+07:00`)).toISOString();
const SITE = { latitude: 13.7, longitude: 100.5 };
const north = (p, m, east = 0) => ({ latitude: p.latitude + m / 111_000, longitude: p.longitude + east / (111_000 * Math.cos(p.latitude * Math.PI / 180)) });
const o = (hms, where, speedKph, verified = true) => ({ timestamp: at(hms), latitude: where.latitude, longitude: where.longitude, speedKph, verified });
const FAR = north(SITE, 6000);
const assess = (observations, opts = {}) => si.assessSiteVisit({ observations, point: opts.point === undefined ? SITE : opts.point, radiusM: opts.radiusM ?? 150, pointVerified: opts.pointVerified ?? false, officeConfirmedAt: opts.office });

// A genuine stop: four observations a few metres apart, speed near zero, one-minute spacing, moving before and after.
const stopAt = (where, startMin, speed = 0, verified = true, step = 1) => [0, 1, 2, 3].map(i => o(`10:${String(startMin + i * step).padStart(2, '0')}:00`, north(where, i * 3), speed, verified));
const around = (where, before = '09:58:00', after = '10:12:00', verified = true) => [o(before, FAR, 60, verified), o(after, FAR, 60, verified)];

test('highway drive-by: one fast observation near the site is a drive-by, not an arrival', () => {
  const a = assess([o('08:09:00', FAR, 70), o('08:10:00', north(SITE, 40), 64), o('08:11:00', FAR, 70)]);
  assert.equal(a.class, 'E_drive_by'); assert.equal(a.stop, null); assert.ok(a.reasons.includes('drove_past_at_speed')); assert.equal(a.driveBys.length, 1);
});

test('a genuine multi-observation stop with verified positions is a GPS-supported probable visit with bounded windows', () => {
  const a = assess([...around(SITE, '10:09:00', '10:14:00'), ...stopAt(north(SITE, 20), 10)]);
  assert.equal(a.class, 'B_gps_supported_probable'); assert.equal(a.algorithmic, true);
  assert.equal(a.stop.observations, 4);
  assert.deepEqual(a.stop.arrivalWindow, { earliest: at('10:09:00'), latest: at('10:10:00') });
  assert.deepEqual(a.stop.departureWindow, { earliest: at('10:13:00'), latest: at('10:14:00') });
  assert.equal(a.stop.dwellMs.min, 3 * 60_000); assert.equal(a.stop.dwellMs.max, 5 * 60_000);
});

test('slow traffic is not a stop: crawling at 6 km/h around the site is slow movement', () => {
  const crawl = [o('10:00:00', north(SITE, 0), 6), o('10:01:00', north(SITE, 12), 7), o('10:02:00', north(SITE, 25), 6), o('10:03:00', north(SITE, 38), 5)];
  const clusters = si.detectStopClusters([o('09:59:00', FAR, 60), ...crawl, o('10:04:00', FAR, 60)]);
  assert.ok(clusters.every(c => c.kind === 'slow_movement'));
  const a = assess([o('09:59:00', FAR, 60), ...crawl, o('10:04:00', FAR, 60)]);
  assert.equal(a.class, 'G_no_usable_evidence'); assert.ok(a.reasons.includes('slow_movement_not_a_stop')); assert.equal(a.stop, null);
});

test('sparse five-minute sampling gives a five-minute window, never an exact arrival', () => {
  const sparse = [o('09:55:00', FAR, 60), o('10:00:00', north(SITE, 30), 0), o('10:05:00', north(SITE, 32), 0), o('10:10:00', north(SITE, 31), 0), o('10:15:00', FAR, 60)];
  const a = assess(sparse);
  assert.equal(a.class, 'B_gps_supported_probable');
  assert.deepEqual(a.stop.arrivalWindow, { earliest: at('09:55:00'), latest: at('10:00:00') });
  assert.equal(a.stop.dwellMs.min, 10 * 60_000); assert.equal(a.stop.dwellMs.max, 20 * 60_000);
  assert.equal(a.stop.tightWindows, true, 'five-minute spacing is within the tolerance');
});

test('telemetry loss: a stop that begins after a gap is only a possible visit; a gap is never a stop by itself', () => {
  const afterGap = [o('09:00:00', FAR, 60), ...stopAt(north(SITE, 10), 30), o('10:10:00', FAR, 60)];
  const a = assess(afterGap);
  assert.equal(a.class, 'D_possible_incomplete_telemetry'); assert.ok(a.reasons.includes('stop_next_to_telemetry_gap'));
  const onlyGap = si.detectStopClusters([o('09:00:00', SITE, 60), o('11:00:00', SITE, 60)]);
  assert.equal(onlyGap.length, 0, 'two readings two hours apart do not make a stop');
  assert.equal(assess([o('09:00:00', FAR, 60), o('11:00:00', FAR, 60)]).class, 'G_no_usable_evidence');
});

test('unverified provider positions can never produce a GPS-supported class (the 64-8665 case)', () => {
  const a = assess([...around(SITE, '10:05:00', '10:16:00', false), ...stopAt(north(SITE, 10), 10, 0, false)]);
  assert.equal(a.class, 'C_provider_reported_probable'); assert.notEqual(a.class, 'B_gps_supported_probable'); assert.equal(a.stop.sourceQuality, 'unverified');
  assert.ok(a.reasons.includes('stop_near_site_unverified_positions'));
  const mixed = assess([...around(SITE, '10:05:00', '10:16:00', true), ...stopAt(north(SITE, 10), 10, 0, true).map((p, i) => ({ ...p, verified: i < 2 }))]);
  assert.equal(mixed.class, 'C_provider_reported_probable', 'a cluster that is partly unverified is not GPS supported');
  assert.ok(mixed.reasons.includes('mixed_source_quality'));
});

test('several stops near the site are ambiguous, and repeated same-day jobs are assessed separately', () => {
  const twice = [...around(SITE, '09:58:00', '10:05:00'), ...stopAt(north(SITE, 15), 10), o('10:08:00', FAR, 60), ...stopAt(north(SITE, 25), 40), o('10:47:00', FAR, 60)];
  const a = assess(twice);
  assert.equal(a.class, 'F_ambiguous_multiple'); assert.equal(a.candidates.length, 2); assert.equal(a.stop, null);
  const other = north(SITE, 4000);
  const second = [o('10:09:00', FAR, 60), ...stopAt(SITE, 10), o('10:16:00', FAR, 60), o('10:29:00', FAR, 60), ...stopAt(other, 30), o('10:36:00', FAR, 60)];
  assert.equal(assess([o('09:58:00', FAR, 60), ...second], { point: SITE }).class, 'B_gps_supported_probable');
  assert.equal(assess([o('09:58:00', FAR, 60), ...second], { point: other }).class, 'B_gps_supported_probable', 'a second job at another site is its own visit');
});

test('a single observation inside the radius is possible only, never an arrival', () => {
  const a = assess([o('09:55:00', FAR, 60), o('10:00:00', north(SITE, 30), 2), o('10:05:00', FAR, 60)]);
  assert.equal(a.class, 'D_possible_incomplete_telemetry'); assert.ok(a.reasons.includes('single_observation_only')); assert.equal(a.stop, null);
});

test('no observations, no point and no nearby positions are G with the reason, never zero-filled', () => {
  assert.deepEqual(assess([]).reasons.filter(r => r !== 'booked_point_unverified'), ['no_observations_at_all']);
  assert.ok(assess([o('10:00:00', FAR, 60)], { point: null }).reasons.includes('no_positions_near_site'));
  assert.equal(assess([o('10:00:00', FAR, 60), o('10:05:00', FAR, 60)]).class, 'G_no_usable_evidence');
});

test('only an office confirmation produces class A; algorithmic classes are always flagged algorithmic', () => {
  assert.equal(assess([], { office: at('10:00:00') }).class, 'A_office_confirmed'); assert.equal(assess([], { office: at('10:00:00') }).algorithmic, false);
  for (const a of [assess([...stopAt(SITE, 10)]), assess([o('10:00:00', SITE, 60)]), assess([])]) { assert.equal(a.algorithmic, true); assert.notEqual(a.class, 'A_office_confirmed'); }
});

test('incorrect roadside booking pin: a fast pass on the pin plus a real stop 300 m away gives a drive-by at the pin and a bounded candidate for office review', () => {
  const compound = north(SITE, 300);
  const day = [o('09:50:00', FAR, 60), o('09:55:00', north(SITE, 5), 68), o('09:56:00', north(SITE, 100), 40), ...stopAt(compound, 10, 0), o('10:20:00', FAR, 60)];
  const a = assess(day);
  assert.equal(a.class, 'E_drive_by');
  const search = si.searchCandidateStops({ observations: day, point: SITE });
  assert.equal(search.bookedPointOnRoad, true); assert.equal(search.searchRadiusM, 1000);
  assert.equal(search.candidates.length, 1); assert.ok(search.candidates[0].distanceFromBookedPointM > 250 && search.candidates[0].distanceFromBookedPointM < 350);
  assert.ok(search.candidates[0].reasons.includes('outside_the_150m_matching_radius')); assert.ok(search.candidates[0].reasons.includes('could_belong_to_a_neighbouring_site'));
  assert.ok(search.candidates[0].weight > 0 && search.candidates[0].weight <= 100);
  assert.ok(search.limitations.some(l => /not customer sites until the office verifies/i.test(l)));
});

test('the candidate search is bounded and never widens the matching radius', () => {
  const far = north(SITE, 1800);
  const day = [o('09:58:00', FAR, 60), ...stopAt(far, 10), o('10:12:00', FAR, 60)];
  assert.equal(si.searchCandidateStops({ observations: day, point: SITE }).candidates.length, 0, 'beyond the 1 km default');
  assert.equal(si.searchCandidateStops({ observations: day, point: SITE, searchRadiusM: 5000 }).searchRadiusM, 2000, 'capped at 2 km');
  assert.equal(assess(day).class, 'G_no_usable_evidence', 'the 150 m assessment is unchanged by the search');
});

test('a nearby unrelated site is a candidate only, never the customer by itself', () => {
  const neighbour = north(SITE, 420);
  const search = si.searchCandidateStops({ observations: [o('09:58:00', FAR, 60), ...stopAt(neighbour, 10), o('10:12:00', FAR, 60)], point: SITE });
  assert.ok(search.candidates[0].reasons.includes('could_belong_to_a_neighbouring_site')); assert.equal(search.candidates[0].reasons.includes('verified'), false);
});

test('cross-vehicle agreement raises interest but never verifies; unverified positions stay unverified', () => {
  const site = north(SITE, 300);
  const clusters = ['V1', 'V2', 'V3'].flatMap((v, i) => si.detectStopClusters([o('09:58:00', FAR, 60, false), ...stopAt(north(site, i * 5), 10, 0, false), o('10:12:00', FAR, 60, false)]).map(cluster => ({ vehicleKey: v, day: `2026-10-2${i}`, cluster })));
  const shared = si.aggregateSharedCandidates(clusters);
  assert.equal(shared.length, 1); assert.equal(shared[0].vehicles, 3); assert.equal(shared[0].days, 3);
  assert.equal(shared[0].status, 'candidate_unverified'); assert.equal(shared[0].verifiedGpsStops, 0); assert.equal(shared[0].unverifiedStops, 3);
  const apart = si.aggregateSharedCandidates([{ vehicleKey: 'V1', day: 'd', cluster: clusters[0].cluster }, { vehicleKey: 'V2', day: 'd', cluster: si.detectStopClusters([o('09:58:00', FAR, 60), ...stopAt(north(SITE, 2500), 10), o('10:12:00', FAR, 60)])[0] }]);
  assert.equal(apart.length, 2, 'stops 2 km apart are separate candidates');
});

test('coordinate priority: loading point > entrance > site location > unverified booking > missing; the booking coordinate is kept alongside', () => {
  const booking = north(SITE, 100);
  const pin = (id, kind, extra = {}) => ({ id, locationId: 'L1', kind, status: 'verified_by_office', latitude: SITE.latitude, longitude: SITE.longitude + (extra.dx ?? 0), ...extra });
  assert.equal(lp.resolveJobPoint({ booking, pins: [pin('d', 'destination'), pin('t', 'truck_entrance'), pin('l', 'loading_point')] }).provenance, 'office_verified_loading_point');
  assert.equal(lp.resolveJobPoint({ booking, pins: [pin('d', 'destination'), pin('t', 'truck_entrance')] }).provenance, 'office_verified_entrance');
  assert.equal(lp.resolveJobPoint({ booking, pins: [pin('d', 'destination')] }).provenance, 'office_verified_site_location');
  const unverified = lp.resolveJobPoint({ booking, pins: [] });
  assert.equal(unverified.provenance, 'booking_coordinate_unverified'); assert.equal(unverified.verified, false); assert.equal(unverified.rank, 4);
  assert.equal(lp.resolveJobPoint({ booking: null, pins: [] }).provenance, 'missing'); assert.equal(lp.resolveJobPoint({ booking: null, pins: [] }).rank, 5);
  const verified = lp.resolveJobPoint({ booking, pins: [pin('l', 'loading_point')] });
  assert.deepEqual(verified.bookingCoordinate, booking, 'the original booking coordinate is carried, never replaced');
  assert.equal(verified.verified, true);
});

test('unreviewed pins are never used; multiple loading bays are ambiguous unless a vehicle class separates them', () => {
  const base = { locationId: 'L1', kind: 'loading_point', status: 'verified_by_office', latitude: SITE.latitude, longitude: SITE.longitude };
  const ignored = lp.resolveJobPoint({ booking: SITE, pins: [{ ...base, id: 'c', status: 'candidate_awaiting_review' }, { ...base, id: 'n', status: 'needs_verification' }, { ...base, id: 'r', status: 'rejected_invalid' }] });
  assert.equal(ignored.provenance, 'booking_coordinate_unverified');
  const bayA = { ...base, id: 'A' }, bayB = { ...base, id: 'B', longitude: SITE.longitude + 0.003 };
  const two = lp.resolveJobPoint({ booking: SITE, pins: [bayA, bayB] });
  assert.equal(two.ambiguous, true); assert.equal(two.point, null); assert.equal(two.alternatives.length, 2);
  const split = lp.resolveJobPoint({ booking: SITE, vehicleClass: '18-wheeler', pins: [{ ...bayA, vehicleClasses: ['6-wheeler'] }, { ...bayB, vehicleClasses: ['18-wheeler'] }] });
  assert.equal(split.ambiguous, false); assert.equal(split.pinId, 'B');
  const sameSpot = lp.resolveJobPoint({ booking: SITE, pins: [bayA, { ...bayA, id: 'A2' }] });
  assert.equal(sameSpot.ambiguous, false, 'two pins at the same spot are one point');
  const fromRow = lp.pinFromDirectoryRow({ id: 'p', location_id: 'L', pin_type: 'truck_entrance', pin_status: 'manual_confirmed', latitude: 1, longitude: 2 });
  assert.equal(fromRow.status, 'verified_by_office'); assert.equal(fromRow.kind, 'truck_entrance');
  assert.equal(lp.pinFromDirectoryRow({ id: 'p', location_id: 'L', pin_type: 'something_else', pin_status: 'x', latitude: 1, longitude: 2 }), null);
});

test('real-evidence replay, 68-7154 shape: moving passes near both sites are drive-bys, with no confirmed arrival', () => {
  const near1 = north(SITE, 138), near2 = { latitude: 13.2677, longitude: 99.8214 }, end = north(near2, 143);
  const obs = [o('08:09:00', FAR, 70), o('08:10:00', near1, 17), o('08:11:00', FAR, 70), o('10:35:00', FAR, 60), o('10:36:00', near1, 11), o('10:37:00', FAR, 60), o('17:39:00', north(end, 5000), 70), o('17:40:00', end, 64), o('17:41:00', north(end, -5000), 70)];
  assert.equal(assess(obs, { point: SITE, pointVerified: false }).class, 'E_drive_by');
  assert.equal(assess(obs, { point: near2, pointVerified: false }).class, 'E_drive_by');
  assert.ok(assess(obs, { point: SITE }).closestApproachM >= 130 && assess(obs, { point: SITE }).closestApproachM <= 145);
});

test('real-evidence replay, 64-8665 shape: unverified passes never read as verified or as arrivals', () => {
  const obs = [o('11:05:00', FAR, 60, false), o('11:06:00', north(SITE, 148), 25, false), o('11:07:00', FAR, 60, false)];
  const a = assess(obs);
  assert.equal(a.class, 'E_drive_by'); assert.notEqual(a.class, 'B_gps_supported_probable');
  const text = JSON.stringify(a); assert.doesNotMatch(text, /verified_gps/);
});

test('day jobs expose the point provenance and classification; the booking coordinate stays on the job', () => {
  const booking = { id: 'B1', booking_date: DAY, pickup_time: null, vehicle_id: null, vehicle: null, vehicle_registration: '68-7154', driver_id: null, job_order_number: null, pickup_lat: SITE.latitude, pickup_lng: SITE.longitude, dropoff_lat: 13.8, dropoff_lng: 100.6, updated_at: '2026-11-05T07:54:04Z', pickup_location_id: 'LOC1', dropoff_location_id: null };
  const evidence = { observedPoints: [{ timestamp: at('08:10:00'), latitude: north(SITE, 100).latitude, longitude: SITE.longitude, speedKph: 17 }], reportedPoints: [], gps: { timeline: [] }, provider: { arithmetic: { status: 'fail' }, segments: [] } };
  const none = dayMod.suggestDayJobs('V', '68-7154', DAY, [booking], evidence)[0];
  assert.equal(none.stopAnalysis.pickup.point.provenance, 'booking_coordinate_unverified'); assert.equal(none.workOrder, null, 'no work-order number is invented');
  assert.deepEqual(none.scheduledPickup, SITE, 'the original booking coordinate is untouched');
  const pins = { LOC1: [{ id: 'p1', locationId: 'LOC1', kind: 'truck_entrance', status: 'verified_by_office', latitude: SITE.latitude + 0.002, longitude: SITE.longitude, radiusMeters: 90 }] };
  const withPin = dayMod.suggestDayJobs('V', '68-7154', DAY, [booking], evidence, { pinsByLocation: pins })[0];
  assert.equal(withPin.stopAnalysis.pickup.point.provenance, 'office_verified_entrance'); assert.equal(withPin.stopAnalysis.pickup.point.radiusMeters, 90);
  assert.deepEqual(withPin.scheduledPickup, SITE);
  assert.equal(dayMod.suggestDayJobs('V', '68-7154', DAY, [booking], null)[0].stopAnalysis, null);
});

test('stop analysis follows the journey gate and carries no distance claims', () => {
  const gated = jm.applyMovementAccess({ jobId: 'J', movement: null, stopAnalysis: { secret: 'coords' } }, false);
  assert.equal(gated.stopAnalysis, null); assert.equal(gated.movementAccess, 'requires_authorisation');
  assert.equal(jm.applyMovementAccess({ jobId: 'J', movement: null, stopAnalysis: { ok: 1 } }, true).stopAnalysis.ok, 1);
  const src = read('lib/fleet-stop-intelligence.ts') + read('lib/fleet-location-priority.ts');
  assert.doesNotMatch(src, /weekly_mileage|fuel_logs|odometer|supabase|\bfetch\(|Math\.random|Date\.now\(\)|allocatedKm|confirmedKm|providerKm/i, 'vehicle-day and job mileage are untouched');
  assert.match(read('lib/fleet-stop-intelligence.ts'), /not unloading time and not billable waiting time/);
});

test('review-only artefacts: the location migration is not executable as written and the Finance concept creates no charges', () => {
  const sql = read('docs/fleet-locations-v51-review-only.sql');
  assert.match(sql, /REVIEW ONLY\. NOT EXECUTED/); assert.match(sql, /hafoaurzfgkkwpvzedvd/); assert.equal((sql.match(/^rollback;/gm) ?? []).length, 1); assert.doesNotMatch(sql.replace(/--.*$/gm, ''), /\bcommit\s*;/i);
  assert.match(sql, /verified_by_office/); assert.match(sql, /candidate_awaiting_review/); assert.match(sql, /loading_point/); assert.match(sql, /radius_meters/); assert.match(sql, /confirmed_by is not null and confirmed_at is not null/);
  assert.doesNotMatch(sql.replace(/--.*$/gm, ''), /\b(insert into|update public|delete from|drop table|truncate)\b/i, 'no data statements');
  const fin = read('docs/fleet-finance-waiting-time-concept.md');
  for (const needle of ['REVIEW ONLY', 'not billable waiting time', 'class A', 'exactly once', 'No customer charge']) assert.ok(fin.includes(needle), needle);
});
