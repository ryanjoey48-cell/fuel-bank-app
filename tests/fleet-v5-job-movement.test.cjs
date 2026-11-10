const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('../scripts/fleet-real-day-validation.cjs');
const jm = load('lib/fleet-job-movement.ts');
const view = load('lib/fleet-job-movement-view.ts');
const dayMod = load('lib/fleet-intelligence-day.ts');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/\r\n/g, '\n');
const DAY = '2026-11-03';
const at = hms => new Date(Date.parse(`${DAY}T${hms}+07:00`)).toISOString();
const PICK = { latitude: 13.7, longitude: 100.5 }, DROP = { latitude: 13.8, longitude: 100.6 };
const OFF = { latitude: 13.75, longitude: 100.55 }; // far from both
const near = (p, metresNorth = 0) => ({ latitude: p.latitude + metresNorth / 111_000, longitude: p.longitude });
const pt = (hms, where) => ({ timestamp: at(hms), ...where });
const job = (o = {}) => ({ jobId: 'J1', pickupTime: '09:00', scheduledPickup: PICK, scheduledDelivery: DROP, ...o });
const derive = (verified, o = {}) => jm.deriveJobMovement({ day: DAY, job: job(o.job), verified, reported: o.reported ?? [], office: o.office });
const ev = (m, stage) => m.events.find(e => e.stage === stage);

// A clean journey with 5-minute reporting.
const clean = () => [pt('08:50:00', OFF), pt('08:55:00', near(PICK, 40)), pt('09:00:00', near(PICK, 20)), pt('09:05:00', near(PICK, 30)), pt('09:10:00', OFF),
  pt('09:40:00', OFF), pt('09:50:00', near(DROP, 10)), pt('09:55:00', near(DROP, 20)), pt('10:00:00', OFF)];

test('verified positions at 5-minute cadence give verified arrival and departure at pickup and delivery', () => {
  const m = derive(clean());
  assert.equal(ev(m, 'pickup_arrival').status, 'verified_gps'); assert.equal(ev(m, 'pickup_arrival').at, at('08:55:00')); assert.equal(ev(m, 'pickup_arrival').confidence, 'high');
  assert.equal(ev(m, 'pickup_departure').status, 'verified_gps'); assert.equal(ev(m, 'pickup_departure').at, at('09:05:00'));
  assert.equal(ev(m, 'delivery_arrival').status, 'estimated', 'the previous position was 10 minutes earlier, so the arrival is a window');
  assert.deepEqual(ev(m, 'delivery_arrival').window, { from: at('09:40:00'), to: at('09:50:00') }); assert.ok(ev(m, 'delivery_arrival').reasons.includes('window_wider_than_reporting_interval'));
  assert.equal(ev(m, 'delivery_departure').status, 'verified_gps');
  assert.equal(m.positionTier, 'verified_gps'); assert.equal(m.dwell.pickupMinutes, 10); assert.equal(m.dwell.deliveryMinutes, 5);
});

test('a position gap before arrival makes the time a window, never an exact time; no earlier observation is flagged', () => {
  const m = derive([pt('08:20:00', OFF), pt('08:55:00', near(PICK, 20)), pt('09:00:00', near(PICK, 20)), pt('09:05:00', OFF)]);
  const a = ev(m, 'pickup_arrival'); assert.equal(a.status, 'estimated'); assert.deepEqual(a.window, { from: at('08:20:00'), to: at('08:55:00') }); assert.equal(a.confidence, 'medium');
  const first = derive([pt('08:55:00', near(PICK, 20)), pt('09:05:00', OFF)]);
  assert.equal(ev(first, 'pickup_arrival').status, 'estimated'); assert.equal(ev(first, 'pickup_arrival').window.from, null); assert.ok(ev(first, 'pickup_arrival').reasons.includes('no_observation_before_arrival'));
});

test('evidence that ends inside the location leaves the departure missing, not guessed', () => {
  const m = derive([pt('08:50:00', OFF), pt('09:00:00', near(PICK, 20)), pt('09:05:00', near(PICK, 20))]);
  const d = ev(m, 'pickup_departure'); assert.equal(d.status, 'missing'); assert.equal(d.at, null); assert.ok(d.reasons.includes('still_at_location_at_end_of_evidence'));
  assert.equal(m.dwell.pickupMinutes, null, 'time at location needs both arrival and departure');
});

test('a vehicle that never comes within 150 m is missing, with the closest approach and no invented time', () => {
  const m = derive([pt('08:50:00', OFF), pt('09:00:00', near(PICK, 400)), pt('09:10:00', OFF)]);
  assert.equal(ev(m, 'pickup_arrival').status, 'missing'); assert.deepEqual(ev(m, 'pickup_arrival').reasons, ['never_within_radius']);
  assert.ok(m.closestApproachMeters.pickup >= 380 && m.closestApproachMeters.pickup <= 420);
  for (const e of m.events) assert.equal(e.at, null);
});

test('unverified positions are labelled provider-reported at low confidence; verified positions win when both exist', () => {
  const unverified = derive([], { reported: [pt('08:55:00', near(PICK, 20)), pt('09:00:00', near(PICK, 20)), pt('09:05:00', OFF)] });
  const a = ev(unverified, 'pickup_arrival'); assert.equal(a.status, 'provider_reported_unverified'); assert.equal(a.confidence, 'low'); assert.equal(a.source, 'forth_reported_position'); assert.ok(a.reasons.includes('used_unverified_positions'));
  assert.equal(unverified.positionTier, 'reported_unverified');
  const both = derive(clean(), { reported: [pt('07:00:00', near(PICK, 10)), pt('07:05:00', OFF)] });
  assert.equal(ev(both, 'pickup_arrival').status, 'verified_gps'); assert.equal(both.positionTier, 'verified_gps');
});

test('missing coordinates and missing positions are distinguished', () => {
  const noCoords = derive(clean(), { job: { scheduledPickup: null } });
  assert.deepEqual(ev(noCoords, 'pickup_arrival').reasons, ['no_booked_coordinates']);
  const noPositions = derive([]);
  assert.deepEqual(ev(noPositions, 'pickup_arrival').reasons, ['no_position_evidence']); assert.equal(noPositions.positionTier, 'none');
  const noTime = derive(clean(), { job: { pickupTime: null } });
  assert.ok(noTime.issues.includes('scheduled_time_unavailable'));
});

test('pickup and delivery too close together are not told apart', () => {
  const m = derive(clean(), { job: { scheduledDelivery: near(PICK, 200) } });
  assert.ok(m.issues.includes('pickup_and_delivery_locations_overlap'));
  assert.deepEqual(ev(m, 'delivery_arrival').reasons, ['pickup_and_delivery_locations_overlap']);
});

test('several visits to the pickup are ambiguous unless the schedule clearly separates them', () => {
  const twice = [pt('06:00:00', near(PICK, 10)), pt('06:05:00', near(PICK, 10)), pt('06:10:00', OFF), pt('09:00:00', near(PICK, 10)), pt('09:05:00', near(PICK, 10)), pt('09:10:00', OFF)];
  const clear = derive(twice, { job: { pickupTime: '09:00' } });
  assert.equal(ev(clear, 'pickup_arrival').at, at('09:00:00'), '06:00 is three hours from the schedule; 09:00 is on it');
  const close = [pt('08:30:00', near(PICK, 10)), pt('08:35:00', near(PICK, 10)), pt('08:40:00', OFF), pt('09:10:00', near(PICK, 10)), pt('09:15:00', near(PICK, 10)), pt('09:20:00', OFF)];
  const ambiguous = derive(close, { job: { pickupTime: '09:00' } });
  assert.equal(ev(ambiguous, 'pickup_arrival').status, 'missing'); assert.deepEqual(ev(ambiguous, 'pickup_arrival').reasons, ['multiple_visits_need_office_selection']);
  const noSchedule = derive(twice, { job: { pickupTime: null } });
  assert.deepEqual(ev(noSchedule, 'pickup_arrival').reasons, ['multiple_visits_need_office_selection']);
});

test('a delivery visit that happened only before the pickup is not used', () => {
  const m = derive([pt('07:00:00', near(DROP, 10)), pt('07:05:00', near(DROP, 10)), pt('07:10:00', OFF), pt('09:00:00', near(PICK, 10)), pt('09:05:00', near(PICK, 10)), pt('09:10:00', OFF)]);
  assert.deepEqual(ev(m, 'delivery_arrival').reasons, ['delivery_before_pickup']); assert.equal(ev(m, 'delivery_arrival').status, 'missing');
});

test('two jobs on the same day get independent timelines from the same positions', () => {
  const positions = [pt('08:55:00', near(PICK, 10)), pt('09:00:00', near(PICK, 10)), pt('09:05:00', OFF), pt('09:25:00', near(DROP, 10)), pt('09:30:00', near(DROP, 10)), pt('09:35:00', OFF),
    pt('13:55:00', near(DROP, 10)), pt('14:00:00', near(DROP, 10)), pt('14:05:00', OFF), pt('14:30:00', near(PICK, 10)), pt('14:35:00', near(PICK, 10)), pt('14:40:00', OFF)];
  const morning = derive(positions, { job: { jobId: 'AM', pickupTime: '09:00' } });
  const afternoon = derive(positions, { job: { jobId: 'PM', pickupTime: '14:00', scheduledPickup: DROP, scheduledDelivery: PICK } });
  assert.equal(ev(morning, 'pickup_arrival').at, at('08:55:00')); assert.equal(ev(morning, 'delivery_arrival').at, at('09:25:00'));
  assert.equal(ev(afternoon, 'pickup_arrival').at, at('13:55:00')); assert.equal(ev(afternoon, 'delivery_arrival').at, at('14:30:00'));
  assert.ok(ev(morning, 'delivery_arrival').reasons.includes('later_visits_at_location'), 'the vehicle returned to the delivery location later in the day');
  assert.notEqual(ev(morning, 'delivery_arrival').confidence, 'high');
});

test('office-confirmed events are labelled as such and override only their own stage', () => {
  const m = derive(clean(), { office: [{ stage: 'pickup_arrival', at: at('08:58:00') }] });
  assert.equal(ev(m, 'pickup_arrival').status, 'office_confirmed'); assert.equal(ev(m, 'pickup_arrival').source, 'office_decision');
  assert.equal(ev(m, 'pickup_departure').status, 'verified_gps');
});

test('no coordinates or raw positions are returned by the timeline', () => {
  const text = JSON.stringify(derive(clean()));
  assert.doesNotMatch(text, /latitude|longitude|13\.7|100\.5/);
});

test('timeline access follows the journey gate: unauthorised callers receive no times', () => {
  const movement = derive(clean());
  const allowed = jm.applyMovementAccess({ jobId: 'J1', movement }, true), denied = jm.applyMovementAccess({ jobId: 'J1', movement }, false), unread = jm.applyMovementAccess({ jobId: 'J1', movement: null }, true);
  assert.equal(allowed.movementAccess, 'granted'); assert.ok(allowed.movement);
  assert.equal(denied.movementAccess, 'requires_authorisation'); assert.equal(denied.movement, null); assert.doesNotMatch(JSON.stringify(denied), /pickup_arrival|08:55/);
  assert.equal(unread.movementAccess, 'not_read');
  const route = read('app/api/admin/forth-tracking/evidence/route.ts');
  assert.match(route, /applyMovementAccess\(job, journeyAllowed\)/); assert.match(route, /jobs: gatedJobs/);
});

test('the day provider payload never carries raw positions to the browser, and job suggestions derive movement server-side', () => {
  const stripped = dayMod.publicProviderDay({ a: 1, observedPoints: [1], reportedPoints: [2] });
  assert.deepEqual(Object.keys(stripped), ['a']);
  const evidence = { observedPoints: clean(), reportedPoints: [], gps: { timeline: [] }, provider: { arithmetic: { status: 'fail' }, segments: [] } };
  const booking = { id: 'B1', booking_date: DAY, pickup_time: '09:00', vehicle_id: 'V1', vehicle: null, vehicle_registration: '70-0001', driver_id: null, job_order_number: 'WO-1', pickup_lat: PICK.latitude, pickup_lng: PICK.longitude, dropoff_lat: DROP.latitude, dropoff_lng: DROP.longitude, updated_at: '2026-11-02T10:00:00Z' };
  const jobs = dayMod.suggestDayJobs('V1', '70-0001', DAY, [booking], evidence);
  assert.equal(jobs[0].movement.events.length, 4); assert.equal(jobs[0].movement.events[0].status, 'verified_gps'); assert.equal(jobs[0].bookingUpdatedAt, '2026-11-02T10:00:00Z');
  assert.equal(dayMod.suggestDayJobs('V1', '70-0001', DAY, [booking], null)[0].movement, null, 'a day that was not read has no movement');
});

test('review queue puts ambiguous jobs first, leaves clean jobs out and never changes data', () => {
  const clean1 = { jobId: 'OK', workOrder: 'WO-OK', pickupTime: '09:00', scheduledPickup: PICK, scheduledDelivery: DROP, movement: jm.deriveJobMovement({ day: DAY, job: job({ jobId: 'OK' }), verified: [pt('08:50:00', OFF), pt('08:55:00', near(PICK, 10)), pt('09:00:00', near(PICK, 10)), pt('09:05:00', OFF), pt('09:20:00', OFF), pt('09:25:00', near(DROP, 10)), pt('09:30:00', near(DROP, 10)), pt('09:35:00', OFF)], reported: [] }) };
  const missingOne = { jobId: 'MISS', workOrder: 'WO-MISS', pickupTime: '10:00', scheduledPickup: PICK, scheduledDelivery: DROP, movement: derive([pt('10:00:00', OFF)], { job: { jobId: 'MISS' } }) };
  const ambiguous = { jobId: 'AMB', workOrder: 'WO-AMB', pickupTime: '11:00', scheduledPickup: PICK, scheduledDelivery: DROP, movement: derive([], { job: { jobId: 'AMB' } }) };
  const matches = [{ jobId: 'OK', status: 'confirmed', journeyIds: ['J01'], reasons: [], workOrder: null, pickupTime: null }, { jobId: 'MISS', status: 'no_journey', journeyIds: [], reasons: [], workOrder: null, pickupTime: null }, { jobId: 'AMB', status: 'needs_review', journeyIds: [], reasons: [], workOrder: null, pickupTime: null }];
  const queue = view.buildReviewQueue([clean1, missingOne, ambiguous], matches);
  assert.deepEqual(queue.map(q => q.jobId), ['AMB', 'MISS']); assert.equal(queue[0].priority, 1); assert.equal(queue[1].priority, 2);
  assert.ok(!queue.some(q => q.jobId === 'OK'), 'a confirmed job with verified times needs no review');
  const unread = view.buildReviewQueue([{ ...clean1, movement: null }], matches);
  assert.ok(unread[0].reasons.includes('movement_not_read'));
});

test('bilingual wording exists for every stage, status and reason', () => {
  for (const s of ['pickup_arrival', 'pickup_departure', 'delivery_arrival', 'delivery_departure']) assert.ok(view.MOVEMENT_STAGE_COPY[s][0] && view.MOVEMENT_STAGE_COPY[s][1]);
  for (const s of ['verified_gps', 'provider_reported_unverified', 'office_confirmed', 'estimated', 'missing']) assert.ok(view.MOVEMENT_STATUS_COPY[s][0] && /[฀-๿]/.test(view.MOVEMENT_STATUS_COPY[s][1]));
  for (const r of Object.keys(view.MOVEMENT_REASON_COPY)) assert.ok(/[฀-๿]/.test(view.MOVEMENT_REASON_COPY[r][1]), r);
  assert.equal(view.formatBangkokTime(at('09:05:00'), 'en'), '09:05');
});

test('the timeline UI is wired into the Jobs tab, read-only, mobile-safe and does not persist or call write APIs', () => {
  const panel = read('components/fleet-evidence-panel.tsx'), cmp = read('components/fleet-job-timeline.tsx'), css = read('components/fleet-job-timeline.module.css');
  assert.match(panel, /<FleetJobTimeline /); assert.match(panel, /<FleetJobReviewPanel /); assert.match(panel, /journeyRestricted/);
  for (const needle of ['Office review queue', 'Verified GPS', 'Confirmed to jobs', 'Candidate, pending review', 'Unallocated', 'Unknown coverage', 'The booking creation time is not available', 'language === "th"']) assert.ok(cmp.includes(needle), needle);
  assert.doesNotMatch(cmp, /fetch\(|localStorage|sessionStorage|\.insert\(|\.update\(|\.upsert\(|\.delete\(|supabase|method:\s*["'](POST|PUT|PATCH|DELETE)/);
  assert.match(css, /@media \(max-width: 480px\)/); assert.match(css, /overflow-wrap: anywhere/); assert.doesNotMatch(css, /white-space:\s*nowrap/);
  const lib = read('lib/fleet-job-movement.ts'); assert.doesNotMatch(lib, /\bfetch\(|Math\.random|Date\.now\(\)/);
});

test('unverified coordinates are never treated as verified and the odometer sources are untouched', () => {
  const lib = read('lib/fleet-job-movement.ts') + read('lib/fleet-job-movement-view.ts');
  assert.doesNotMatch(lib, /weekly_mileage|fuel_logs|odometer|supabase/i);
  const unverifiedOnly = derive([], { reported: clean() });
  for (const e of unverifiedOnly.events.filter(x => x.status !== 'missing')) assert.notEqual(e.status, 'verified_gps');
});

// ---- Real-evidence follow-ups (WO 5838 validation): drive-by passes must not become arrivals.
const mv = (hms, where, speedKph) => ({ ...pt(hms, where), speedKph });
test('a brief fast pass within the radius is a drive-by, not an arrival; the pass time is still shown', () => {
  const m = derive([mv('17:35:00', OFF, 60), mv('17:40:00', near(DROP, 100), 62), mv('17:45:00', OFF, 60)], { job: { scheduledPickup: null } });
  const a = ev(m, 'delivery_arrival'); assert.equal(a.status, 'missing'); assert.deepEqual(a.reasons, ['passed_without_stopping']);
  assert.deepEqual(a.window, { from: at('17:40:00'), to: at('17:40:00') }); assert.equal(a.at, null);
  assert.equal(m.visits.delivery[0].kind, 'drive_by'); assert.equal(m.dwell.deliveryMinutes, null);
});
test('a slow or stopped visit stays a visit, and a short visit with no speed reading is not called a drive-by', () => {
  const slow = derive([mv('17:35:00', OFF, 60), mv('17:40:00', near(DROP, 100), 3), mv('17:45:00', OFF, 60)], { job: { scheduledPickup: null } });
  assert.equal(ev(slow, 'delivery_arrival').status, 'verified_gps'); assert.equal(slow.visits.delivery[0].kind, 'stopped_or_slow');
  const noSpeed = derive([pt('17:35:00', OFF), pt('17:40:00', near(DROP, 100)), pt('17:45:00', OFF)], { job: { scheduledPickup: null } });
  assert.notEqual(ev(noSpeed, 'delivery_arrival').status, 'missing', 'without a speed reading a pass is not proven to be a drive-by');
});
test('visit summaries list every visit with times and counts only, so the office can choose when the system cannot', () => {
  const twice = [mv('06:00:00', near(PICK, 10), 2), mv('06:05:00', near(PICK, 10), 2), mv('06:10:00', OFF, 50), mv('13:00:00', near(PICK, 10), 1), mv('13:05:00', near(PICK, 10), 1), mv('13:10:00', OFF, 50)];
  const m = derive(twice, { job: { pickupTime: null } });
  assert.equal(m.visits.pickup.length, 2); assert.deepEqual(m.visits.pickup.map(v => v.observations), [2, 2]);
  assert.deepEqual(ev(m, 'pickup_arrival').reasons, ['multiple_visits_need_office_selection']);
  assert.doesNotMatch(JSON.stringify(m.visits), /latitude|longitude/);
});
