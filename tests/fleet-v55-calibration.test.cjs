const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('../scripts/fleet-real-day-validation.cjs');
const vr = load('lib/fleet-visit-recognition.ts');
const si = load('lib/fleet-stop-intelligence.ts');
const gd = load('lib/fleet-job-review-guidance.ts');
const dayMod = load('lib/fleet-intelligence-day.ts');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/\r\n/g, '\n');
const DAY = '2026-10-02';
const at = (hms, day = DAY) => new Date(Date.parse(`${day}T${hms}+07:00`)).toISOString();
const minutesToHms = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:00`;
const hm = s => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
const SITE = { latitude: 13.6951596, longitude: 100.5895867 };
const OTHER = { latitude: 13.6818969, longitude: 100.7468694 };
const north = (p, m) => ({ latitude: p.latitude + m / 111_000, longitude: p.longitude });
const o = (hms, where, speedKph, verified = true, day = DAY) => ({ timestamp: at(hms, day), latitude: where.latitude, longitude: where.longitude, speedKph, verified });
const park = (where, start, end, verified = true, day = DAY) => { const out = []; for (let m = hm(start); m <= hm(end); m++) out.push(o(minutesToHms(m), north(where, (m % 3) * 2), 0, verified, day)); return out; };
const FAR = north(SITE, 9000);
const booking = (o2 = {}) => ({ id: 'B', booking_date: DAY, pickup_time: null, vehicle_id: null, vehicle: '64-5956', vehicle_registration: '64-5956', driver_id: null, job_order_number: null, pickup: 'Port', dropoff: 'Airport', pickup_lat: SITE.latitude, pickup_lng: SITE.longitude, dropoff_lat: OTHER.latitude, dropoff_lng: OTHER.longitude, updated_at: '2026-10-06T18:00:00Z', ...o2 });
const evidence = observations => ({ observedPoints: observations.filter(p => p.verified).map(({ verified, ...p }) => p), reportedPoints: observations.filter(p => !p.verified).map(({ verified, ...p }) => p), gps: { timeline: [] }, provider: { arithmetic: { status: 'fail' }, segments: [] } });
const jobsFor = (bookings, observations, reg = '64-5956') => dayMod.suggestDayJobs('V', reg, DAY, bookings, evidence(observations));

test('real-day finding: a booking that also names another registration-like vehicle is flagged, and type words or short text are not', () => {
  const rows = [booking({ id: 'X1', vehicle: '63-3543', vehicle_registration: '64-5956' }), booking({ id: 'X2', vehicle: 'EIGHTEEN_WHEELER' }), booking({ id: 'X3', vehicle: '6' }), booking({ id: 'X4', vehicle: 'กระบะ' }), booking({ id: 'X5', vehicle: '64-5956' }), booking({ id: 'X6', vehicle: null, vehicle_registration: '64-5956' }), booking({ id: 'X7', vehicle: '61-2835-64-0096', vehicle_registration: '64-5956' })];
  const jobs = Object.fromEntries(jobsFor(rows, []).map(j => [j.jobId, j]));
  assert.equal(jobs.X1.bookingVehicleConflict, '63-3543'); assert.equal(jobs.X7.bookingVehicleConflict, '61-2835-64-0096');
  for (const id of ['X2', 'X3', 'X4', 'X5', 'X6']) assert.equal(jobs[id].bookingVehicleConflict, null, id);
});

test('real-day finding: the same route booked twice for one vehicle and day is flagged as a possible duplicate, and both share one visit instead of owning it', () => {
  const obs = [o('08:50:00', FAR, 60), ...park(north(SITE, 30), '09:00', '09:50'), o('09:52:00', FAR, 60)];
  const jobs = jobsFor([booking({ id: 'D1' }), booking({ id: 'D2' }), booking({ id: 'U1', pickup: 'Other', dropoff: 'Elsewhere', pickup_lat: 14.5, pickup_lng: 100.1 })], obs);
  const byId = Object.fromEntries(jobs.map(j => [j.jobId, j]));
  assert.equal(byId.D1.possibleDuplicateBooking, true); assert.equal(byId.D2.possibleDuplicateBooking, true); assert.equal(byId.U1.possibleDuplicateBooking, false);
  assert.equal(byId.D1.visitRecognition.pickup.summary, 'competing_candidates'); assert.ok(byId.D1.visitRecognition.pickup.candidates[0].reasons.includes('shared_with_another_job'));
  assert.equal(byId.D1.workOrder, null, 'duplicates never get an invented work order');
});

test('real-day finding: a vehicle that barely moved cannot be matched to far-away jobs, and the office is told to check the vehicle assignment', () => {
  const parked = [...park(north(SITE, 10), '00:00', '23:00')];
  const [job] = jobsFor([booking({ id: 'P1', vehicle: '3ฒน-9565', vehicle_registration: '64-5956', pickup_lat: 13.9, pickup_lng: 100.9, dropoff_lat: 14.1, dropoff_lng: 100.7 })], parked);
  assert.equal(job.visitRecognition.pickup.candidates.length, 0); assert.equal(job.visitRecognition.delivery.candidates.length, 0);
  const g = gd.buildReviewGuidance(job);
  assert.equal(g.actions[0], 'check_vehicle_assignment'); assert.ok(g.missing.includes('vehicle_text_conflict')); assert.ok(g.missing.includes('no_pickup_evidence'));
});

test('real-day finding: the same vehicle stops at the same place on two days while the booked points differ by kilometres; repeated evidence stays an unverified candidate', () => {
  const place = north(SITE, 7000);
  const dayOne = si.detectStopClusters([o('08:10:00', FAR, 60, true, '2026-10-05'), ...park(place, '08:20', '09:37', true, '2026-10-05'), o('09:40:00', FAR, 60, true, '2026-10-05')]);
  const dayTwo = si.detectStopClusters([o('07:50:00', FAR, 60, true, '2026-10-26'), ...park(north(place, 8), '08:00', '10:35', true, '2026-10-26'), o('10:40:00', FAR, 60, true, '2026-10-26')]);
  const shared = si.aggregateSharedCandidates([...dayOne.map(cluster => ({ vehicleKey: '68-7154', day: '2026-10-05', cluster })), ...dayTwo.map(cluster => ({ vehicleKey: '68-7154', day: '2026-10-26', cluster }))]);
  assert.equal(shared.length, 1); assert.equal(shared[0].days, 2); assert.equal(shared[0].vehicles, 1); assert.equal(shared[0].status, 'candidate_unverified');
  const oct5Booked = north(place, 7300);
  const r = vr.recogniseJobVisits({ observations: [o('08:10:00', FAR, 60), ...park(place, '08:20', '09:37'), o('09:40:00', FAR, 60)], pickup: { point: oct5Booked, verified: false, radiusM: 150 }, delivery: { point: null, verified: false, radiusM: 150 } });
  assert.equal(r.pickup.candidates.length, 0, 'a booked point 7 km from the real stop finds nothing: a radius change cannot fix this');
});

test('guidance names what is missing and what a person could do, and never claims confirmation', () => {
  const obs = [o('08:50:00', FAR, 60, false), ...park(north(SITE, 250), '09:00', '10:00', false), o('10:02:00', FAR, 60, false)];
  const [job] = jobsFor([booking({ id: 'G1' })], obs);
  const g = gd.buildReviewGuidance(job);
  for (const m of ['no_work_order', 'no_pickup_time', 'no_vehicle_id', 'positions_unverified', 'booked_point_unreviewed', 'no_delivery_evidence']) assert.ok(g.missing.includes(m), m);
  assert.ok(g.actions.includes('verify_location_pin')); assert.ok(g.actions.includes('check_paperwork_or_driver')); assert.ok(g.actions.length <= 4);
  const complete = gd.buildReviewGuidance({ bookingAssignment: 'stable_vehicle_id', pickupTime: '09:00:00', workOrder: 'WO', scheduledPickup: {}, scheduledDelivery: {}, visitRecognition: null });
  assert.deepEqual(complete.actions, ['nothing_to_review_yet']); assert.deepEqual(complete.missing, []);
  const thai = /[฀-๿]/; for (const k of Object.keys(gd.MISSING_EVIDENCE_COPY)) assert.ok(thai.test(gd.MISSING_EVIDENCE_COPY[k][1]), k); for (const k of Object.keys(gd.REVIEW_ACTION_COPY)) assert.ok(thai.test(gd.REVIEW_ACTION_COPY[k][1]), k);
  assert.doesNotMatch(JSON.stringify(Object.values(gd.REVIEW_ACTION_COPY)), /confirmed by EES|automatically confirm/i);
});

test('analysis-only options leave production defaults unchanged and stay inside the hard cap', () => {
  const obs = [o('08:50:00', FAR, 60), ...park(north(SITE, 550), '09:00', '09:50'), o('09:52:00', FAR, 60)];
  const base = { observations: obs, pickup: { point: SITE, verified: false, radiusM: 150 }, delivery: { point: null, verified: false, radiusM: 150 } };
  assert.equal(vr.recogniseJobVisits(base).pickup.searchZoneM, 600); assert.equal(vr.recogniseJobVisits(base).pickup.candidates.length, 1);
  assert.equal(vr.recogniseJobVisits({ ...base, options: { searchZoneUnverifiedM: 300 } }).pickup.candidates.length, 0);
  assert.equal(vr.recogniseJobVisits({ ...base, options: { searchZoneUnverifiedM: 5000 } }).pickup.searchZoneM, 1000, 'never above 1000 m');
  assert.equal(vr.recogniseJobVisits({ ...base, options: { minVisitMinutes: 60 } }).pickup.candidates.length, 0);
  assert.equal(vr.recogniseJobVisits({ ...base, options: { searchZoneUnverifiedM: 450 } }).pickup.candidates.length, 0, 'a 550 m stop is outside a 450 m zone');
});

test('the calibration script is read only, allowlisted, bounded, cached and prints no coordinates', () => {
  const s = read('scripts/fleet-calibration-readonly.cjs');
  assert.match(s, /webapi\.forthtrack\.com/); assert.match(s, /\/authorizationserver\/token/); assert.match(s, /parkingTrip/); assert.match(s, /at_most_14_vehicle_days/); assert.match(s, /cacheFile/);
  assert.doesNotMatch(s, /\.insert\(|\.update\(|\.upsert\(|\.delete\(|SUPABASE_SERVICE_ROLE|service_role|method:\s*['"](PUT|PATCH|DELETE)/);
  assert.doesNotMatch(s, /centroid|latitude|longitude|pickup_lat|pickup_lng/, 'no coordinates in the output');
  assert.match(s, /init\?\.method === 'POST'/); assert.match(s, /endpoint_not_authorized/);
});

test('the review UI shows best and competing candidates, missing evidence and actions without any write path', () => {
  const cmp = read('components/fleet-job-timeline.tsx');
  for (const needle of ['Best candidate', 'Competing candidate', 'Missing evidence', 'Suggested review actions (these change nothing)', 'data-review-guidance', 'buildReviewGuidance']) assert.ok(cmp.includes(needle), needle);
  assert.doesNotMatch(cmp, /fetch\(|localStorage|\.insert\(|\.update\(|\.upsert\(/);
});
