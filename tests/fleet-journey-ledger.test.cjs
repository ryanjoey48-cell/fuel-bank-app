const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { load } = require('../scripts/fleet-real-day-validation.cjs');
const jl = load('lib/fleet-journey-ledger.ts');
const dayMod = load('lib/fleet-intelligence-day.ts');
const report = load('lib/fleet-mileage-report.ts');

const DAY = '2026-11-03';
const at = hms => `${DAY}T${hms}+07:00`;
const seg = (id, s, e, km) => ({ id, start: at(s), end: e ? at(e) : null, km });
const pt = (hms, metres, o = {}) => ({ timestampIso: new Date(Date.parse(at(hms))).toISOString(), verifiedGps: false, trailEligible: true, positionQuality: 'no_gps', speedKph: metres > 0 ? 40 : 0, engineOn: true, sourceDistanceRaw: metres, ...o });
const ledgerOf = (segments, points, o = {}) => jl.buildJourneyLedger({ day: DAY, segments, points, gpsIntervals: [], logAvailable: true, ...o });
const job = (jobId, pickupTime, o = {}) => ({ jobId, workOrder: `WO-${jobId}`, pickupTime, bookingAssignment: 'stable_vehicle_id', ...o });
const alloc = (ledger, matches, o = {}) => jl.allocateJourneyDistance({ ledger, matches, providerReconciled: true, providerComplete: false, providerTotalKm: ledger.totals.providerKm, ...o });

test('segmentation follows provider segments: moving, stop and open final; no boundaries invented', () => {
  const L = ledgerOf([seg('a', '08:00:00', '09:00:00', 10), seg('b', '09:30:00', '09:30:00', 0), seg('c', '23:55:00', null, 0)], [pt('08:30:00', 5000), pt('09:00:00', 5000)]);
  assert.deepEqual(L.journeys.map(j => j.kind), ['moving', 'stopped', 'open_final']);
  assert.equal(L.totals.movingJourneys, 1); assert.equal(L.totals.stops, 1); assert.equal(L.totals.openFinal, 1);
  assert.equal(L.journeys[0].minutes, 60); assert.equal(L.journeys[2].end, null); assert.equal(L.journeys[2].minutes, null);
});

test('incremental Distance: each log increment belongs to at most one journey (start, end], never double counted', () => {
  // The 09:00:00 point sits on the boundary between two adjacent segments: it is claimed once, by the segment it ends.
  const L = ledgerOf([seg('a', '08:00:00', '09:00:00', 10), seg('b', '09:00:00', '10:00:00', 4)], [pt('08:30:00', 4000), pt('09:00:00', 6000), pt('09:30:00', 4000)]);
  assert.equal(L.journeys[0].reportedTrailKm, 10); assert.equal(L.journeys[1].reportedTrailKm, 4);
  assert.equal(L.totals.reportedTrailKm, 14);
  assert.equal(L.totals.ambiguousJourneys, 0, 'touching segments are not overlaps');
});

test('duplicate observations are removed once and counted', () => {
  const p = pt('08:30:00', 4000);
  const L = ledgerOf([seg('a', '08:00:00', '09:00:00', 4)], [p, { ...p }, pt('08:40:00', 0)]);
  assert.equal(L.totals.duplicateObservations, 1); assert.equal(L.totals.observations, 2); assert.equal(L.journeys[0].reportedTrailKm, 4);
});

test('missing GPS log: trail and verified km stay unknown; the whole day is missing history, km unknown', () => {
  const L = jl.buildJourneyLedger({ day: DAY, segments: [seg('a', '08:00:00', '09:00:00', 10)], points: [], gpsIntervals: [], logAvailable: false });
  assert.equal(L.totals.reportedTrailKm, null); assert.equal(L.totals.verifiedGpsKm, null); assert.equal(L.journeys[0].reportedTrailKm, null);
  assert.equal(L.missing.length, 1); assert.equal(L.missing[0].minutes, 24 * 60);
  const a = alloc(L, jl.matchJourneysToBookings(DAY, L, []));
  assert.equal(a.missing.km, null);
});

test('real log outages over 10 minutes are missing; 5-minute cadence jitter is not', () => {
  const L = ledgerOf([seg('a', '08:00:00', '10:00:00', 1)], [pt('08:00:10', 0), pt('08:05:11', 100), pt('08:30:00', 900)]);
  assert.equal(L.totals.cadenceJitterGaps, 1);
  assert.ok(L.missing.some(m => m.source === 'log_gap' && m.minutes === 25));
  assert.ok(!L.missing.some(m => m.minutes === 5));
});

test('amber reported coordinates (No GPS) never become verified GPS km', () => {
  const L = ledgerOf([seg('a', '08:00:00', '09:00:00', 10)], [pt('08:30:00', 10000)]);
  assert.equal(L.journeys[0].positionSource, 'no_gps'); assert.equal(L.journeys[0].verifiedGpsKm, null); assert.equal(L.totals.verifiedGpsKm, null);
  // Verified km only from verified GPS intervals fully inside the journey.
  const V = ledgerOf([seg('a', '08:00:00', '09:00:00', 10)], [pt('08:30:00', 10000, { verifiedGps: true, positionQuality: 'gps' })], { gpsIntervals: [{ start: at('08:00:00'), end: at('08:30:00'), km: 4.5 }, { start: at('08:30:00'), end: at('09:00:00'), km: 5.2 }] });
  assert.equal(V.journeys[0].verifiedGpsKm, 9.7);
  const P = ledgerOf([seg('a', '08:00:00', '09:00:00', 10)], [pt('08:30:00', 10000)], { gpsIntervals: [{ start: at('07:50:00'), end: at('08:30:00'), km: 4.5 }] });
  assert.equal(P.journeys[0].verifiedGpsKm, null, 'an interval crossing the journey boundary is not split or guessed');
});

test('open provider segment with distance and overlapping segments stay unresolved, never allocated as observed', () => {
  const L = ledgerOf([seg('a', '08:00:00', '10:00:00', 10), seg('b', '09:00:00', '11:00:00', 4), seg('c', '23:00:00', null, 2)], []);
  assert.ok(L.journeys[0].issues.includes('overlaps_another_segment')); assert.ok(L.journeys[1].ambiguous);
  assert.ok(L.journeys[2].issues.includes('open_segment_with_distance'));
  const m = jl.matchJourneysToBookings(DAY, L, [job('1', '09:30')]);
  assert.equal(m.jobs[0].status, 'needs_review');
  const a = alloc(L, m);
  assert.equal(a.candidateKm, 0); assert.equal(a.unallocatedKm, 16); assert.equal(a.ambiguousKm, 16); assert.equal(a.sumMatchesProvider, true);
});

test('overlapping job candidates (same pickup time) need review; one journey km is never given to two jobs', () => {
  const L = ledgerOf([seg('a', '08:00:00', '10:00:00', 50)], [pt('09:00:00', 50000)]);
  const m = jl.matchJourneysToBookings(DAY, L, [job('1', '08:30'), job('2', '08:30')]);
  assert.deepEqual(m.jobs.map(j => j.status), ['needs_review', 'needs_review']);
  assert.ok(m.jobs[0].reasons.includes('shares_pickup_time_with_another_job'));
  const a = alloc(L, m);
  assert.equal(a.candidateKm, 50, 'counted once, not 100'); assert.equal(a.perJourney.length, 1); assert.deepEqual(a.perJourney[0].jobIds, ['1', '2']);
});

test('multiple jobs on one vehicle-day: each job finds its own journey; unmatched movement stays unallocated', () => {
  const L = ledgerOf([seg('a', '08:00:00', '09:00:00', 30), seg('b', '11:00:00', '12:00:00', 20), seg('c', '15:00:00', '16:00:00', 7.5)], []);
  const m = jl.matchJourneysToBookings(DAY, L, [job('1', '08:10'), job('2', '10:30'), job('3', null)]);
  assert.deepEqual(m.jobs.map(j => [j.status, j.journeyIds]), [['candidate', ['J01']], ['candidate', ['J02']], ['no_journey', []]]);
  assert.ok(m.jobs[1].reasons.includes('pickup_up_to_60_min_before_journey')); assert.ok(m.jobs[2].reasons.includes('no_pickup_time'));
  const a = alloc(L, m);
  assert.equal(a.candidateKm, 50); assert.equal(a.unallocatedKm, 7.5); assert.equal(a.confirmedJobKm, null); assert.equal(a.sumMatchesProvider, true);
});

test('no Booking Diary jobs: "none found", every km unallocated, nothing called empty running', () => {
  const L = ledgerOf([seg('a', '08:00:00', '09:00:00', 12.34)], []);
  const m = jl.matchJourneysToBookings(DAY, L, []);
  assert.equal(m.bookingSource, 'none_found');
  const a = alloc(L, m);
  assert.equal(a.unallocatedKm, 12.34); assert.equal(a.supportedRepositioningKm, null); assert.equal(a.repositioningReason, 'no_operational_evidence');
});

test('confirmed km only from an approved confirmation record; temporary office decisions are never saved or counted', () => {
  const L = ledgerOf([seg('a', '08:00:00', '09:00:00', 30), seg('b', '11:00:00', '12:00:00', 20)], []);
  const jobs = [job('1', '08:10'), job('2', '11:15')];
  const temp = jl.temporaryDecisionState({ '1': 'confirm', '2': 'reject', bogus: 'delete' });
  assert.equal(temp.saved, false); assert.equal(temp.storage, 'in_memory_component_state'); assert.deepEqual(temp.decisions, { '1': 'confirm', '2': 'reject' });
  const unconfirmed = alloc(L, jl.matchJourneysToBookings(DAY, L, jobs));
  assert.equal(unconfirmed.confirmedJobKm, null); assert.equal(unconfirmed.confirmationSource, 'not_available');
  // The allocation API has no parameter for office decisions; only a persisted approval list may confirm.
  const withRecord = alloc(L, jl.matchJourneysToBookings(DAY, L, jobs, [{ jobId: '1', journeyId: 'J01' }]));
  assert.equal(withRecord.confirmedJobKm, 30); assert.equal(withRecord.candidateKm, 20); assert.equal(withRecord.confirmationSource, 'approved_store');
});

test('no persistent approval claims in the office review UI', () => {
  const review = fs.readFileSync('components/fleet-job-review-panel.tsx', 'utf8');
  assert.match(review, /Temporary — not saved/); assert.match(review, /reloading clears them/); assert.match(review, /re-check it/);
  assert.doesNotMatch(review, /fetch\(|supabase|\.insert\(|\.update\(|\.upsert\(/);
  const panel = fs.readFileSync('components/fleet-journey-ledger-panel.tsx', 'utf8');
  assert.doesNotMatch(panel, /fetch\(|supabase|\.insert\(|\.upsert\(/);
  assert.match(panel, /no approved confirmation record exists/);
  assert.doesNotMatch(fs.readFileSync('lib/fleet-journey-ledger.ts', 'utf8'), /latitude|longitude|fetch\(|from\(["']/);
});

test('incomplete fleet aggregation: unknown days are counted as unknown, duplicates ignored, partial is never complete', () => {
  const L = ledgerOf([seg('a', '08:00:00', '09:00:00', 10)], []);
  const a = alloc(L, jl.matchJourneysToBookings(DAY, L, []));
  const s = jl.summarizeFleetAllocation([
    { vehicleId: 'v1', registration: 'AA-1', day: DAY, allocation: a },
    { vehicleId: 'v1', registration: 'AA-1', day: DAY, allocation: a },
    { vehicleId: 'v2', registration: 'BB-2', day: DAY, allocation: null }
  ]);
  assert.equal(s.vehicleDays, 2); assert.equal(s.duplicatesIgnored, 1); assert.equal(s.contributingVehicleDays, 1); assert.equal(s.unknownVehicleDays, 1);
  assert.equal(s.providerKmPartial, 10); assert.equal(s.complete, false);
});

test('provider/API failure: no ledger gives no allocation; unavailable bookings stay distinct from none found', () => {
  const m = jl.matchJourneysToBookings(DAY, null, null);
  assert.equal(m.bookingSource, 'unavailable');
  const a = jl.allocateJourneyDistance({ ledger: null, matches: m, providerReconciled: false, providerComplete: false, providerTotalKm: null });
  assert.equal(a.coverage, 'not_read'); assert.equal(a.candidateKm, null); assert.equal(a.unallocatedKm, null); assert.equal(a.sumMatchesProvider, null);
  const L = ledgerOf([seg('a', '08:00:00', '09:00:00', 10)], []);
  const b = jl.allocateJourneyDistance({ ledger: L, matches: jl.matchJourneysToBookings(DAY, L, []), providerReconciled: false, providerComplete: false, providerTotalKm: null });
  assert.equal(b.coverage, 'not_reconciled'); assert.equal(b.unallocatedKm, null);
});

test('mileage report: vehicle-day journey allocation, fuel kept as purchase, fleet journey totals labelled partial', () => {
  const L = ledgerOf([seg('a', '08:00:00', '09:00:00', 30), seg('b', '11:00:00', '12:00:00', 20)], []);
  const registry = [{ id: 'a', vehicle_reg: 'AA-1', active: true }, { id: 'b', vehicle_reg: 'BB-2', active: true }];
  const r = report.buildMileageReport({ registry, range: { from: DAY, to: DAY }, weekly: [], live: null,
    fuel: [{ id: 'f1', date: DAY, vehicle_reg: 'AA-1', litres: 93.8, total_cost: 2855.1, fuel_type: 'lpg', odometer: null, created_at: `${DAY}T03:00:00Z` }],
    bookings: [{ id: 'j1', booking_date: DAY, vehicle_id: 'a', pickup_time: '08:15', job_order_number: 'WO-1' }],
    providerDays: new Map([['a', [{ day: DAY, km: 50, reconciled: true, complete: false, gpsKm: null, segments: 2, openSegments: 1, journeyLedger: L }]]]) });
  const row = r.ledger.find(l => l.vehicleId === 'a');
  assert.equal(row.journeys.allocation.candidateKm, 30); assert.equal(row.journeys.allocation.unallocatedKm, 20);
  assert.equal(row.fuel.note, 'purchased_not_consumed'); assert.equal(row.fuel.litres, 93.8); assert.equal(row.fuel.costThb, 2855.1);
  assert.equal(r.totals.journeyTotals.contributingVehicleDays, 1); assert.equal(r.totals.journeyTotals.complete, false);
});

test('real day: ฒอ-8453 on 3 Nov 2026 (stored Forth data) — journeys, sources kept apart, every provider km once', () => {
  const dir = 'output/fleet-real-validation/1793759758202/';
  if (!fs.existsSync(dir + 'actual-input.json')) return;
  const input = JSON.parse(fs.readFileSync(dir + 'actual-input.json', 'utf8')); const parking = JSON.parse(fs.readFileSync(dir + 'actual-parking.json', 'utf8'));
  const e = dayMod.buildProviderDay({ vehicleId: input.vehicleId, registration: 'ฒอ-8453', deviceId: '519698', day: DAY, capturedAt: '2026-11-06T00:00:00Z', reportRows: parking, logRows: input.forthLog });
  const L = e.journeyLedger;
  assert.equal(L.totals.providerKm, 289.2); assert.equal(L.totals.reportedTrailKm, 289.54); assert.equal(L.totals.verifiedGpsKm, null);
  assert.equal(L.totals.observations, 751); assert.equal(L.totals.positionSource, 'no_gps');
  assert.equal(L.totals.movingJourneys, 11); assert.equal(L.totals.openFinal, 1); assert.equal(L.missing.length, 0);
  const inJourneys = L.journeys.reduce((n, j) => n + Math.round((j.reportedTrailKm ?? 0) * 100), 0);
  assert.equal(inJourneys + Math.round(L.totals.outsideReportLogKm * 100), Math.round(L.totals.reportedTrailKm * 100));
  const a = alloc(L, jl.matchJourneysToBookings(DAY, L, []), { providerTotalKm: e.sources.providerReported.value });
  assert.equal(a.unallocatedKm, 289.2); assert.equal(a.candidateKm, 0); assert.equal(a.sumMatchesProvider, true); assert.equal(a.coverage, 'reconciled_coverage_unverified');
  assert.equal(JSON.stringify(dayMod.publicProviderDay(e).journeyLedger).match(/latitude|longitude/), null, 'no coordinates in the public payload');
});
