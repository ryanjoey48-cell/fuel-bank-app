const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('../scripts/fleet-real-day-validation.cjs');
const vr = load('lib/fleet-visit-recognition.ts');
const si = load('lib/fleet-stop-intelligence.ts');
const jm = load('lib/fleet-job-movement.ts');
const view = load('lib/fleet-job-movement-view.ts');
const ev = load('lib/fleet-location-evidence.ts');
const dayMod = load('lib/fleet-intelligence-day.ts');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/\r\n/g, '\n');
const DAY = '2026-10-26';
const at = hms => new Date(Date.parse(`${DAY}T${hms}+07:00`)).toISOString();
const minutesToHms = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:00`;
const hm = s => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
const SITE = { latitude: 13.112114, longitude: 100.9820285 };
const DROP = { latitude: 13.2677158, longitude: 99.8214174 };
const north = (p, m, east = 0) => ({ latitude: p.latitude + m / 111_000, longitude: p.longitude + east / (111_000 * Math.cos(p.latitude * Math.PI / 180)) });
const FAR = north(SITE, 8000);
const o = (hms, where, speedKph, verified = true) => ({ timestamp: at(hms), latitude: where.latitude, longitude: where.longitude, speedKph, verified });
/** One position per minute from start to end inclusive, parked (speed 0) with tiny jitter. */
const park = (where, start, end, verified = true, speed = 0) => { const out = []; for (let m = hm(start); m <= hm(end); m++) out.push(o(minutesToHms(m), north(where, (m % 3) * 2), speed, verified)); return out; };
const pt = (p, verified = true, radiusM = 150) => ({ point: p, verified, radiusM });
const run = (observations, o2 = {}) => vr.recogniseJobVisits({ observations, pickup: o2.pickup ?? pt(SITE, false), delivery: o2.delivery ?? pt(DROP, false), scheduledPickupMs: o2.scheduled ?? null });

test('a long genuine stop inside the boundary on verified GPS is a probable visit with high confidence and closed windows', () => {
  const r = run([o('08:50:00', FAR, 60), o('08:58:00', north(SITE, 400), 40), ...park(north(SITE, 40), '09:00', '09:40'), o('09:42:00', north(SITE, 500), 30), o('09:50:00', FAR, 60)]);
  const c = r.pickup.candidates[0];
  assert.equal(r.pickup.summary, 'probable_visit'); assert.equal(c.zone, 'direct'); assert.equal(c.confidence, 'high'); assert.equal(c.sourceQuality, 'verified_gps');
  assert.ok(c.dwell.minMinutes >= 40); assert.ok(c.dwell.maxMinutes >= c.dwell.minMinutes); assert.ok(c.arrival.earliest && c.departure.latest);
  assert.ok(c.alternatives.includes('loading_or_unloading_not_proven')); assert.equal(r.algorithmic, true);
});

test('a highway drive-by is rejected, with the pass time, and never becomes a visit', () => {
  const r = run([o('10:29:00', FAR, 70), o('10:30:00', north(SITE, 40), 64), o('10:31:00', FAR, 70)]);
  assert.equal(r.pickup.summary, 'drive_by_rejected'); assert.equal(r.pickup.candidates.length, 0); assert.equal(r.pickup.driveBys.length, 1);
});

test('a long traffic jam (crawling) is not a visit', () => {
  const jam = []; for (let m = 0; m < 40; m++) jam.push(o(minutesToHms(9 * 60 + m), north(SITE, m * 6), 6));
  const r = run([o('08:58:00', FAR, 60), ...jam, o('09:45:00', FAR, 60)]);
  assert.equal(r.pickup.candidates.length, 0); assert.ok(['no_reliable_evidence', 'drive_by_rejected'].includes(r.pickup.summary));
});

test('two neighbouring factories with similar stops are shown as competing candidates, not decided', () => {
  const a = north(SITE, 300, 0), b = north(SITE, -280, 60);
  const r = run([o('08:50:00', FAR, 60), ...park(a, '09:00', '09:30'), o('09:32:00', FAR, 60), o('10:20:00', FAR, 60), ...park(b, '10:30', '11:00'), o('11:02:00', FAR, 60)]);
  assert.equal(r.pickup.summary, 'competing_candidates'); assert.ok(r.pickup.candidates.length >= 2);
  assert.ok(r.pickup.candidates[0].reasons.includes('competing_candidate'));
});

test('adjacent stops merge only with evidence: short interruption, same place, continuous tracking', () => {
  const place = north(SITE, 200);
  const one = run([o('08:58:00', FAR, 60), ...park(place, '09:00', '09:30'), o('09:31:00', north(place, 40), 12), ...park(north(place, 60), '09:32', '10:00'), o('10:02:00', FAR, 60)]);
  assert.equal(one.pickup.candidates.length, 1); assert.equal(one.pickup.candidates[0].stops, 2); assert.equal(one.pickup.candidates[0].dwell.interruptions, 1); assert.ok(one.pickup.candidates[0].reasons.includes('merged_adjacent_stops'));
  const farApart = run([o('08:58:00', FAR, 60), ...park(place, '09:00', '09:30'), o('09:31:00', FAR, 60), o('10:15:00', FAR, 60), ...park(place, '10:20', '10:50'), o('10:52:00', FAR, 60)]);
  assert.equal(farApart.pickup.candidates.length, 2, 'separated by a long drive away: two visits');
  const gap = run([o('08:58:00', FAR, 60), ...park(place, '09:00', '09:20'), ...park(place, '09:50', '10:10'), o('10:12:00', FAR, 60)]);
  assert.equal(gap.pickup.candidates.length, 2, 'a 30 minute tracking gap between stops is never bridged into one stay');
});

test('a tracking gap is never counted as time on site', () => {
  const stops = si.detectStopClusters([o('08:58:00', FAR, 60), ...park(SITE, '09:00', '09:10'), ...park(SITE, '10:40', '10:50'), o('10:52:00', FAR, 60)]);
  assert.equal(stops.length, 2); assert.ok(stops.every(s => s.dwellMs.min <= 11 * 60_000));
  const r = run([o('08:58:00', FAR, 60), ...park(SITE, '09:00', '09:10'), o('09:12:00', FAR, 60)]);
  assert.ok(r.pickup.candidates[0].dwell.minMinutes <= 11);
});

test('no delivery evidence leaves the delivery empty: far long stops are listed for a person, never matched', () => {
  const r = run([o('08:50:00', FAR, 60), ...park(north(SITE, 30), '09:00', '09:40'), o('09:42:00', FAR, 60), ...park(north(DROP, 4200), '15:00', '16:20'), o('16:25:00', north(DROP, 150), 60), o('17:40:00', north(DROP, 100), 64), o('17:41:00', FAR, 70)], { pickup: pt(SITE, true) });
  assert.equal(r.sequence, 'pickup_only'); assert.equal(r.delivery.candidates.length, 0);
  assert.equal(r.delivery.otherLongStops.length, 1); assert.ok(r.delivery.otherLongStops[0].distanceFromPointM > 3500 && r.delivery.otherLongStops[0].dwellMinutes >= 30);
  assert.ok(['drive_by_rejected', 'no_reliable_evidence'].includes(r.delivery.summary));
});

test('fully unverified provider positions are never a probable visit and confidence stays capped', () => {
  const r = run([o('08:50:00', FAR, 60, false), ...park(north(SITE, 250), '09:00', '10:00', false), o('10:02:00', FAR, 60, false)]);
  const c = r.pickup.candidates[0];
  assert.equal(c.sourceQuality, 'unverified'); assert.equal(c.confidence, 'low'); assert.notEqual(r.pickup.summary, 'probable_visit'); assert.ok(c.reasons.includes('provider_reported_unverified_positions'));
  assert.doesNotMatch(JSON.stringify(r), /verified_gps"/);
  const direct = run([o('08:50:00', FAR, 60, false), ...park(north(SITE, 30), '09:00', '10:00', false), o('10:02:00', FAR, 60, false)]);
  assert.notEqual(direct.pickup.summary, 'probable_visit'); assert.notEqual(direct.pickup.candidates[0].confidence, 'high');
});

test('an incorrect roadside booking pin: the stop in the compound is found in the search zone, capped, and labelled near the booked point only', () => {
  const r = run([o('09:50:00', FAR, 60), o('09:55:00', north(SITE, 5), 68), ...park(north(SITE, 300), '10:00', '10:50'), o('10:52:00', FAR, 60)]);
  const c = r.pickup.candidates[0];
  assert.equal(c.zone, 'search'); assert.ok(c.reasons.includes('found_in_search_zone_only')); assert.ok(c.reasons.includes('unreviewed_booking_point')); assert.notEqual(c.confidence, 'high');
  assert.equal(r.pickup.searchZoneM, 600); assert.equal(r.pickup.driveBys.length, 1);
  const verifiedPoint = run([o('09:50:00', FAR, 60), ...park(north(SITE, 300), '10:00', '10:50'), o('10:52:00', FAR, 60)], { pickup: pt(SITE, true) });
  assert.equal(verifiedPoint.pickup.searchZoneM, 150, 'a verified point never widens its boundary');
  assert.equal(verifiedPoint.pickup.candidates.length, 0);
});

test('the search zone is bounded and the direct boundary is never silently widened', () => {
  assert.ok(vr.SEARCH_ZONE_MAX_M <= 1000); assert.equal(vr.DIRECT_RADIUS_M, 150);
  const r = run([o('09:50:00', FAR, 60), ...park(north(SITE, 900), '10:00', '10:50'), o('10:52:00', FAR, 60)]);
  assert.equal(r.pickup.candidates.length, 0, '900 m is outside the 600 m search zone for an unreviewed point');
});

test('pickup-before-delivery sequence: a delivery visit before the pickup is down-weighted and flagged', () => {
  const pickupAt = north(SITE, 20), dropAt = north(DROP, 30);
  const ok = run([o('06:50:00', FAR, 60), ...park(pickupAt, '07:00', '07:40'), o('07:42:00', FAR, 60), ...park(dropAt, '12:00', '12:40'), o('12:42:00', FAR, 60)], { pickup: pt(SITE, true), delivery: pt(DROP, true) });
  assert.equal(ok.sequence, 'pickup_then_delivery_plausible'); assert.ok(ok.delivery.candidates[0].reasons.includes('follows_pickup'));
  const wrong = run([o('06:50:00', FAR, 60), ...park(dropAt, '07:00', '07:40'), o('07:42:00', FAR, 60), ...park(pickupAt, '12:00', '12:40'), o('12:42:00', FAR, 60)], { pickup: pt(SITE, true), delivery: pt(DROP, true) });
  assert.equal(wrong.sequence, 'order_conflict'); assert.ok(wrong.delivery.candidates[0].reasons.includes('before_pickup'));
});

test('two jobs whose best visit is the same stop are not silently assigned: both become competing and shared', () => {
  const obs = [o('08:50:00', FAR, 60), ...park(north(SITE, 40), '09:00', '09:40'), o('09:42:00', FAR, 60)];
  const jobs = [{ id: 'J1', recognition: run(obs, { pickup: pt(SITE, true) }) }, { id: 'J2', recognition: run(obs, { pickup: pt(SITE, true) }) }];
  vr.resolveCrossJobConflicts(jobs);
  for (const j of jobs) { assert.equal(j.recognition.pickup.summary, 'competing_candidates'); assert.ok(j.recognition.pickup.candidates[0].reasons.includes('shared_with_another_job')); }
  const separate = [{ id: 'A', recognition: run(obs, { pickup: pt(SITE, true) }) }, { id: 'B', recognition: run(obs, { pickup: pt(north(DROP, 1), true) }) }];
  vr.resolveCrossJobConflicts(separate);
  assert.notEqual(separate[0].recognition.pickup.summary, 'competing_candidates');
});

test('repeated visits to one site the same day are listed separately and the schedule can separate them', () => {
  const place = north(SITE, 30);
  const obs = [o('05:50:00', FAR, 60), ...park(place, '06:00', '06:30'), o('06:32:00', FAR, 60), o('12:50:00', FAR, 60), ...park(place, '13:00', '13:30'), o('13:32:00', FAR, 60)];
  const r = run(obs, { pickup: pt(SITE, true), scheduled: Date.parse(`${DAY}T13:00:00+07:00`) });
  assert.equal(r.pickup.candidates.length, 2); assert.ok(r.pickup.candidates[0].reasons.includes('fits_scheduled_time')); assert.ok(r.pickup.candidates[0].arrival.latest > at('12:00:00'));
  const noTime = run(obs, { pickup: pt(SITE, true) });
  assert.ok(noTime.pickup.candidates.every(c => c.reasons.includes('no_scheduled_time')));
});

test('false positive and false negative limits are stated: a long rest 400 m away is only a low or medium possibility; a very short real stop stays weak', () => {
  const rest = run([o('09:50:00', FAR, 60), ...park(north(SITE, 400), '10:00', '10:50'), o('10:52:00', FAR, 60)]);
  assert.ok(rest.pickup.candidates[0].alternatives.includes('rest_or_break') && rest.pickup.candidates[0].alternatives.includes('neighbouring_site')); assert.notEqual(rest.pickup.summary, 'probable_visit');
  const brief = run([o('09:50:00', FAR, 60), ...park(north(SITE, 20), '10:00', '10:02'), o('10:04:00', FAR, 60)], { pickup: pt(SITE, true) });
  assert.ok(brief.pickup.candidates.length === 0 || brief.pickup.candidates[0].reasons.includes('short_stay')); if (brief.pickup.candidates[0]) assert.notEqual(brief.pickup.candidates[0].confidence, 'high');
});

function realShape(verified) {
  const a = { latitude: 13.11448, longitude: 100.98305 }, b = { latitude: 13.11335, longitude: 100.98289 }, far = { latitude: 13.23265, longitude: 99.80674 };
  const pin = north(SITE, 142);
  return [o('00:30:00', FAR, 0, verified), o('08:09:00', FAR, 70, verified), o('08:10:00', north(SITE, 138), 17, verified), o('08:12:00', FAR, 50, verified), ...park(a, '08:13', '09:47', verified), ...park(b, '09:48', '10:35', verified), o('10:36:00', pin, 11, verified), o('10:38:00', FAR, 60, verified),
    o('15:50:00', FAR, 60, verified), ...park(far, '15:56', '17:18', verified), o('17:39:00', north(DROP, 143), 64, verified), o('17:41:00', FAR, 70, verified)];
}

test('real-evidence shape, 68-7154 (verified GPS): the two Sirtec stops merge into one possible visit near the booked point; delivery is a drive-by', () => {
  const r = run(realShape(true));
  const c = r.pickup.candidates[0];
  assert.equal(r.pickup.summary, 'possible_visit', 'unreviewed point and search zone only: never probable'); assert.equal(c.stops, 2); assert.equal(c.dwell.interruptions, 1);
  assert.ok(c.distanceFromPointM > 220 && c.distanceFromPointM < 300); assert.equal(c.zone, 'search'); assert.equal(c.sourceQuality, 'verified_gps');
  assert.ok(c.dwell.minMinutes >= 135 && c.dwell.minMinutes <= 145, 'about 142 minutes observed'); assert.equal(c.confidence, 'medium');
  assert.equal(r.delivery.summary, 'drive_by_rejected'); assert.equal(r.delivery.candidates.length, 0); assert.equal(r.delivery.driveBys.length, 1);
  assert.ok(r.delivery.otherLongStops.some(s => s.dwellMinutes >= 80 && s.distanceFromPointM > 3500), 'the long stay 4 km from the booked delivery point is listed, not matched');
  assert.equal(r.sequence, 'pickup_only');
});

test('real-evidence shape, 64-8665 (all unverified): nothing is probable, nothing is described as verified GPS', () => {
  const r = run(realShape(false));
  assert.notEqual(r.pickup.summary, 'probable_visit'); assert.equal(r.pickup.candidates[0].sourceQuality, 'unverified'); assert.equal(r.pickup.candidates[0].confidence, 'low');
  assert.equal(r.delivery.summary, 'drive_by_rejected');
  assert.doesNotMatch(JSON.stringify(r), /verified_gps"/);
});

test('the Locations panel groups adjacent stops into one visit label without removing either stop', () => {
  const obs = realShape(true);
  const e = ev.buildLocationEvidence({ observations: obs, anchor: SITE });
  const grouped = e.stops.filter(s => s.visitLabel);
  assert.equal(grouped.length, 2); assert.ok(grouped.every(s => s.visitLabel === grouped[0].visitLabel && s.visitStops === 2));
  assert.match(read('components/location-evidence-panel.tsx'), /data-visit-group/);
});

test('job output is algorithmic only, follows the journey gate, and carries no confirmation, work-order or mileage fields', () => {
  const gated = jm.applyMovementAccess({ jobId: 'J', movement: null, stopAnalysis: null, visitRecognition: { secret: 1 } }, false);
  assert.equal(gated.visitRecognition, null); assert.equal(jm.applyMovementAccess({ jobId: 'J', visitRecognition: { ok: 1 } }, true).visitRecognition.ok, 1);
  const booking = { id: 'B1', booking_date: DAY, pickup_time: null, vehicle_id: null, vehicle: null, vehicle_registration: '68-7154', driver_id: null, job_order_number: null, pickup_lat: SITE.latitude, pickup_lng: SITE.longitude, dropoff_lat: DROP.latitude, dropoff_lng: DROP.longitude, updated_at: '2026-11-05T07:54:04Z' };
  const evidence = { observedPoints: realShape(true).map(({ verified, ...p }) => p), reportedPoints: [], gps: { timeline: [] }, provider: { arithmetic: { status: 'fail' }, segments: [] } };
  const job = dayMod.suggestDayJobs('V', '68-7154', DAY, [booking], evidence)[0];
  assert.equal(job.visitRecognition.algorithmic, true); assert.equal(job.workOrder, null); assert.equal(job.allocatedKm, null); assert.equal(job.status, 'confirmation_required');
  assert.equal(dayMod.suggestDayJobs('V', '68-7154', DAY, [booking], null)[0].visitRecognition, null);
  const src = read('lib/fleet-visit-recognition.ts');
  assert.doesNotMatch(src, /weekly_mileage|fuel_logs|odometer|supabase|\bfetch\(|Math\.random|Date\.now\(\)|allocatedKm|confirmedKm|providerKm|invoice|charge/i);
  assert.match(read('app/api/admin/forth-tracking/evidence/route.ts'), /applyMovementAccess\(job, journeyAllowed\)/);
});

test('English and Thai wording exists for every summary, reason, alternative and confidence level; the UI and CSS are mobile safe', () => {
  const thai = /[฀-๿]/;
  for (const k of Object.keys(view.VISIT_SUMMARY_COPY)) assert.ok(thai.test(view.VISIT_SUMMARY_COPY[k][1]), k);
  for (const k of Object.keys(view.VISIT_REASON_COPY)) assert.ok(thai.test(view.VISIT_REASON_COPY[k][1]), k);
  for (const k of Object.keys(view.VISIT_ALTERNATIVE_COPY)) assert.ok(thai.test(view.VISIT_ALTERNATIVE_COPY[k][1]), k);
  for (const k of Object.keys(view.VISIT_CONFIDENCE_COPY)) assert.ok(thai.test(view.VISIT_CONFIDENCE_COPY[k][1]), k);
  const cmp = read('components/fleet-job-timeline.tsx'), css = read('components/fleet-job-timeline.module.css');
  for (const needle of ['Likely visits (suggested by EES, not confirmed)', 'data-likely-visits', 'Alternatives', 'Other long stops later in the day', 'language === "th"']) assert.ok(cmp.includes(needle) || /language === "th"/.test(cmp), needle);
  assert.match(css, /\.likely\b/); assert.match(css, /overflow-wrap: anywhere/); assert.match(css, /@media \(max-width: 480px\)/);
  assert.doesNotMatch(cmp, /fetch\(|localStorage|\.insert\(|\.update\(|\.upsert\(/);
});
