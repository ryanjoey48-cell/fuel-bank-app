const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const { load } = require('../scripts/fleet-real-day-validation.cjs');
const jl = load('lib/fleet-journey-ledger.ts');
const quality = load('lib/fleet-booking-quality.ts');
const summary = load('lib/fleet-vehicle-day-summary.ts');
const copy = load('lib/fleet-journey-copy.ts');
const access = load('lib/forth-playback-access.ts');
const auth = load('lib/authorization.ts');
const report = load('lib/fleet-mileage-report.ts');
const fuel = load('lib/fleet-fuel-view.ts');
const dayMod = load('lib/fleet-intelligence-day.ts');

const DAY = '2026-11-03';
const at = hms => `${DAY}T${hms}+07:00`;
const seg = (id, s, e, km) => ({ id, start: at(s), end: e ? at(e) : null, km });
const pt = (hms, metres) => ({ timestampIso: new Date(Date.parse(at(hms))).toISOString(), verifiedGps: false, trailEligible: true, positionQuality: 'no_gps', speedKph: metres > 0 ? 40 : 0, engineOn: true, sourceDistanceRaw: metres });
const ledgerOf = (segments, points = [], o = {}) => jl.buildJourneyLedger({ day: DAY, segments, points, gpsIntervals: [], logAvailable: true, ...o });
const job = (jobId, pickupTime, o = {}) => ({ jobId, workOrder: `WO-${jobId}`, pickupTime, bookingAssignment: 'stable_vehicle_id', ...o });
const analyse = (L, jobs, o = {}) => summary.analyseDay({ day: DAY, journeyLedger: L, providerReconciled: true, providerComplete: false, providerKm: L ? L.totals.providerKm : null, jobs, ...o });
// A log that covers the whole reporting period, so no history is missing and coverage can be claimed complete.
const fullLog = () => { const pts = []; for (let m = 0; m < 24 * 60; m += 5) pts.push(pt(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:00`, 0)); return pts; };

test('reconciliation: unknown, source incomplete, conflicting, awaiting review', () => {
  assert.equal(analyse(null, []).allocation.reconciliation.status, 'unknown');
  const L = ledgerOf([seg('a', '08:00:00', '09:00:00', 10)], fullLog());
  const incomplete = analyse(L, [job('1', '08:10')]);
  assert.equal(incomplete.allocation.reconciliation.status, 'source_incomplete', 'open or unverified coverage is never complete');
  assert.equal(incomplete.allocation.reconciliation.reconciledTotalKm, null);
  const notReconciled = analyse(L, [], { providerReconciled: false });
  assert.equal(notReconciled.allocation.reconciliation.status, 'source_incomplete'); assert.equal(notReconciled.allocation.unallocatedKm, null);
  const same = analyse(L, [job('1', '08:10'), job('2', '08:10')], { providerComplete: true });
  assert.equal(same.allocation.reconciliation.status, 'conflicting_evidence'); assert.ok(same.allocation.reconciliation.reasons.includes('job_conflicts'));
  const clean = analyse(L, [job('1', '08:10')], { providerComplete: true });
  assert.equal(clean.allocation.reconciliation.status, 'awaiting_office_review'); assert.equal(clean.allocation.reconciliation.reconciledTotalKm, null);
});

test('reconciliation: a reconciled total only exists with complete coverage, no gaps, and approved confirmation of every km', () => {
  const L = ledgerOf([seg('a', '08:00:00', '09:00:00', 10), seg('b', '10:00:00', '11:00:00', 5)], fullLog());
  const jobs = [job('1', '08:10'), job('2', '10:10')];
  const both = analyse(L, jobs, { providerComplete: true, confirmed: [{ jobId: '1', journeyId: 'J01' }, { jobId: '2', journeyId: 'J02' }] });
  assert.equal(both.allocation.reconciliation.status, 'complete_verified'); assert.equal(both.allocation.reconciliation.reconciledTotalKm, 15);
  assert.equal(both.allocation.reconciliation.gpsVerified, false, 'complete is not GPS-verified when positions are No GPS');
  const part = analyse(L, jobs, { providerComplete: true, confirmed: [{ jobId: '1', journeyId: 'J01' }] });
  assert.equal(part.allocation.confirmedJobKm, 10);
  assert.notEqual(part.allocation.reconciliation.status, 'complete_verified'); assert.equal(part.allocation.reconciliation.reconciledTotalKm, null);
  const incompleteCoverage = analyse(L, jobs, { providerComplete: false, confirmed: [{ jobId: '1', journeyId: 'J01' }, { jobId: '2', journeyId: 'J02' }] });
  assert.equal(incompleteCoverage.allocation.reconciliation.status, 'source_incomplete', 'all confirmed but coverage unverified is still not complete');
  assert.equal(incompleteCoverage.allocation.reconciliation.reconciledTotalKm, null);
  const gaps = ledgerOf([seg('a', '08:00:00', '09:00:00', 10)], [pt('08:00:10', 0), pt('09:00:00', 10000)]);
  const withGap = analyse(gaps, [job('1', '08:10')], { providerComplete: true, confirmed: [{ jobId: '1', journeyId: 'J01' }] });
  assert.notEqual(withGap.allocation.reconciliation.status, 'complete_verified', 'missing history prevents a complete claim');
});

test('partially allocated: some approved confirmation, other km unresolved', () => {
  const L = ledgerOf([seg('a', '08:00:00', '09:00:00', 10), seg('b', '10:00:00', '11:00:00', 5)], fullLog());
  const r = analyse(L, [job('1', '08:10')], { providerComplete: true, confirmed: [{ jobId: '1', journeyId: 'J01' }] });
  assert.equal(r.allocation.reconciliation.status, 'partially_allocated'); assert.equal(r.allocation.unallocatedKm, 5);
});

test('overlapping confirmations: a job confirmed to two journeys, or to an unsupported journey, is not counted', () => {
  const L = ledgerOf([seg('a', '08:00:00', '09:00:00', 10), seg('b', '10:00:00', '11:00:00', 5)], fullLog());
  const jobs = [job('1', '08:10'), job('2', '10:10')];
  const twice = jl.matchJourneysToBookings(DAY, L, jobs, [{ jobId: '1', journeyId: 'J01' }, { jobId: '1', journeyId: 'J02' }]);
  assert.equal(twice.jobs[0].status, 'needs_review'); assert.ok(twice.jobs[0].reasons.includes('conflicting_confirmations'));
  const a = jl.allocateJourneyDistance({ ledger: L, matches: twice, providerReconciled: true, providerComplete: true, providerTotalKm: 15 });
  assert.equal(a.confirmedJobKm, null, 'a conflicting confirmation confirms nothing'); assert.equal(a.reconciliation.status, 'conflicting_evidence');
  const ghost = jl.matchJourneysToBookings(DAY, L, jobs, [{ jobId: '2', journeyId: 'J99' }]);
  assert.equal(ghost.jobs[1].status, 'needs_review'); assert.ok(ghost.jobs[1].reasons.includes('confirmation_on_unsupported_journey'));
  const shared = jl.matchJourneysToBookings(DAY, L, [job('1', '08:10'), job('3', '08:40', { workOrder: null })], [{ jobId: '1', journeyId: 'J01' }, { jobId: '3', journeyId: 'J01' }]);
  const sa = jl.allocateJourneyDistance({ ledger: L, matches: shared, providerReconciled: true, providerComplete: true, providerTotalKm: 15 });
  assert.equal(sa.confirmedJobKm, 10, 'two jobs on one journey (multi-stop) count its km once');
});

test('duplicated report segments are not journeys twice; zero bookings never means empty running', () => {
  const row = (s, e, km) => ({ boxId: 'box', plateNo: 'AA-1', rDate: DAY, startTime: s, endTime: e, sumDistance: km, routingTime: '01:00:00' });
  const total = km => ({ boxId: '', plateNo: 'Total', sumDistance: km });
  const e = dayMod.buildProviderDay({ vehicleId: 'a', registration: 'AA-1', deviceId: 'box', day: DAY, capturedAt: '2026-11-04T00:00:00Z', reportRows: [row('08:00:00', '09:00:00', '10.50'), row('08:00:00', '09:00:00', '10.50'), total('10.50')], logRows: [] });
  assert.equal(e.journeyLedger.journeys.length, 1); assert.equal(e.journeyLedger.totals.providerKm, 10.5);
  const r = analyse(e.journeyLedger, []);
  assert.equal(r.matches.bookingSource, 'none_found'); assert.equal(r.allocation.supportedRepositioningKm, null); assert.equal(r.allocation.unallocatedKm, 10.5);
});

test('booking data quality: missing time, registration, fleet vehicle, shared rows, same-time, coordinates, work order', () => {
  const registry = [{ id: 'a', vehicle_reg: 'AA-1' }, { id: 'b', vehicle_reg: 'BB-2' }, { id: 'c', vehicle_reg: 'BB 2' }];
  const base = { booking_date: DAY, pickup_time: '09:00:00', job_order_number: 'WO', pickup_lat: 13.7, pickup_lng: 100.5, dropoff_lat: 13.8, dropoff_lng: 100.6 };
  const rows = [
    { id: 1, ...base, vehicle_id: 'a', vehicle_registration: 'AA-1' },
    { id: 2, ...base, vehicle_registration: 'AA-1', pickup_time: null },
    { id: 3, ...base, vehicle_registration: null, vehicle: null },
    { id: 4, ...base, vehicle_registration: 'ZZ-9' },
    { id: 5, ...base, vehicle_registration: 'BB-2' },
    { id: 6, ...base, vehicle_id: 'a', vehicle_registration: 'AA-1', pickup_time: '09:00' },
    { id: 7, ...base, vehicle_id: 'a', vehicle_registration: 'AA-1', booking_date: '2026-11-04', job_order_number: '', pickup_lat: null, dropoff_lng: 'x' }
  ];
  const q = quality.assessBookingQuality(rows, registry);
  const by = id => q.queue.find(r => r.id === String(id));
  assert.ok(by(2).blocking.includes('missing_pickup_time')); assert.ok(by(3).blocking.includes('missing_registration')); assert.ok(by(4).blocking.includes('registration_not_in_fleet'));
  assert.ok(by(5).blocking.includes('registration_shared_by_multiple_fleet_rows'), 'duplicate fleet registration is ambiguous');
  assert.ok(by(1).blocking.includes('same_time_booking') && by(6).blocking.includes('same_time_booking'), '09:00:00 and 09:00 are the same time');
  assert.equal(by(7), undefined, 'a booking that only lacks location/work order is still matchable');
  assert.equal(q.counts.missing_work_order, 1); assert.equal(q.counts.missing_pickup_location, 1); assert.equal(q.counts.missing_dropoff_location, 1);
  assert.equal(q.total, 7); assert.equal(q.matchable + q.notConfidentlyMatchable, 7); assert.equal(q.note, 'absence_of_a_booking_is_not_proof_of_no_work');
  assert.equal(quality.assessBookingQuality([], registry).total, 0);
});

test('vehicle-day summary: unknown stays null, purchases are not consumption, repeated odometers and unknown intervals are flagged', () => {
  const L = ledgerOf([seg('a', '08:00:00', '09:00:00', 10)], fullLog());
  const analysis = analyse(L, [job('1', '08:10')]);
  const base = { day: DAY, providerRead: true, journeyLedger: L, journeysRestricted: false, analysis, providerKm: 10, providerReconciled: true, gpsObservations: 288, gpsVerifiedObservations: 0, fuel: { records: 1, litres: 93.8, costThb: 2855.1 }, fuelOdometer: [{ id: 'f1', km: 50000 }, { id: 'f2', km: 50000 }], weeklyOdometer: [{ id: 'w1', km: 49000, baseline: null }], comparisons: [] };
  const s = summary.buildVehicleDaySummary(base);
  assert.equal(s.reportedKm.value, 10); assert.equal(s.fuel.note, 'purchased_not_consumed'); assert.equal(s.fuel.litres, 93.8);
  assert.ok(s.issues.includes('fuel_purchase_not_consumption')); assert.ok(s.issues.includes('odometer_repeated_reading')); assert.ok(s.issues.includes('odometer_unknown_interval'));
  assert.ok(s.issues.includes('positions_not_verified_gps')); assert.ok(s.issues.includes('open_final_segment_coverage_unverified'));
  assert.equal(s.confirmedKm.value, null); assert.equal(s.confirmedKm.reason, 'no_approved_confirmation_record');
  const unread = summary.buildVehicleDaySummary({ ...base, providerRead: false, journeyLedger: null, providerKm: null, providerReconciled: false, analysis: analyse(null, null), gpsObservations: null, gpsVerifiedObservations: null, fuel: null, fuelOdometer: null, weeklyOdometer: null });
  assert.equal(unread.reportedKm.value, null); assert.equal(unread.candidateKm, null); assert.equal(unread.unallocatedKm, null); assert.equal(unread.fuel.records, null);
  assert.ok(unread.issues.includes('provider_day_not_read')); assert.equal(unread.completeness.status, 'unknown');
  const disagree = summary.buildVehicleDaySummary({ ...base, comparisons: [{ pair: 'forth_provider↔fuel_log_odometer', status: 'review_required', differenceKm: 40 }] });
  assert.ok(disagree.issues.includes('odometer_source_disagrees'));
  const restricted = summary.buildVehicleDaySummary({ ...base, journeyLedger: null, journeysRestricted: true, analysis: analyse(null, null) });
  assert.ok(restricted.issues.includes('journey_detail_restricted')); assert.equal(restricted.reportedKm.value, 10, 'the provider day total stays visible');
});

test('access: only admins (or an explicit allowlist) see journey detail; read-only and office staff do not; others keep the day total', () => {
  const asRole = role => ({ userId: 'u1', role, status: 'active', email: '', displayName: '' });
  const can = (role, env = {}) => access.canViewJourneyDetail({ access: asRole(role), userId: 'u1', checkPermission: auth.hasPermission, env });
  assert.equal(can('admin'), true); assert.equal(can('super_admin'), true);
  assert.equal(can('office_staff'), false); assert.equal(can('read_only'), false);
  assert.equal(can('office_staff', { FORTH_HISTORY_PLAYBACK_ALLOWED_USER_IDS: 'u1u1u1u1u1' }), false, 'unrelated id does not grant');
  assert.equal(access.canViewJourneyDetail({ access: { ...asRole('read_only'), status: 'suspended' }, userId: 'u1', checkPermission: auth.hasPermission, env: {} }), false);
  const day = { journeyLedger: { secret: true }, sources: { providerReported: { value: 289.2 } } };
  const denied = access.applyJourneyAccess(day, false); assert.equal(denied.journeyLedger, null); assert.equal(denied.journeyAccess, 'requires_authorisation'); assert.equal(denied.sources.providerReported.value, 289.2);
  const granted = access.applyJourneyAccess(day, true); assert.deepEqual(granted.journeyLedger, { secret: true }); assert.equal(granted.journeyAccess, 'granted');
});

test('routes enforce the journey gate on the server (not in the UI)', () => {
  for (const f of ['app/api/admin/forth-tracking/evidence/provider/route.ts', 'app/api/admin/forth-tracking/evidence/route.ts', 'app/api/admin/forth-tracking/evidence/mileage/route.ts']) {
    const src = fs.readFileSync(f, 'utf8'); assert.match(src, /canViewJourneyDetail\(/, f); assert.match(src, /hasPermission/, f);
  }
  assert.match(fs.readFileSync('app/api/admin/forth-tracking/evidence/provider/route.ts', 'utf8'), /applyJourneyAccess\(publicProviderDay\(/);
  // Mileage route behaviour with a cached provider day.
  const registry = [{ id: 'a', vehicle_reg: 'AA-1', active: true }];
  const L = ledgerOf([seg('a', '08:00:00', '09:00:00', 10)], fullLog());
  const entry = { storedAt: '2026-11-06T00:00:00Z', expiresAt: '2026-11-06T00:30:00Z', evidence: { provider: { arithmetic: { status: 'pass' }, segments: [{ id: 's', km: 10, end: at('09:00:00') }] }, sources: { providerReported: { value: 10, completeness: 'unknown' }, gpsDerived: { value: null } }, journeyLedger: L } };
  class ApiError extends Error { constructor(status, message) { super(message); this.status = status; } }
  const run = async role => {
    const client = { from: table => { const chain = { select: () => chain, gte: () => chain, lte: () => chain, order: () => chain, limit: async () => table === 'vehicles' ? { data: registry, error: null } : { data: [], error: null } }; return chain; } };
    const mocks = { 'next/server': { NextResponse: { json: (b, o) => new Response(JSON.stringify(b), o) } }, '@/lib/admin-user-management-server': { AdminApiError: ApiError },
      '@/lib/fleet-operations-auth': { requireFleetOfficeAccess: async () => ({ user: { id: 'u1' }, access: { userId: 'u1', role, status: 'active' } }) }, '@/lib/fleet-evidence-server': { createFleetSourceClient: () => client },
      '@/lib/forth-tracking-server': { getForthTrackingFleetData: async () => ({ connectionStatus: 'connected', records: [] }) }, '@/lib/fleet-intelligence': load('lib/fleet-intelligence.ts'),
      '@/lib/fleet-intelligence-session': { recalledProviderDayEntry: (_u, vehicleId, _r, day) => (vehicleId === 'a' && day === DAY ? entry : null) }, 'node:crypto': require('node:crypto'),
      '@/lib/fleet-mileage-report': report, '@/lib/fleet-fuel-view': fuel, '@/lib/authorization': auth, '@/lib/forth-playback-access': access };
    const module = { exports: {} };
    const code = ts.transpileModule(fs.readFileSync('app/api/admin/forth-tracking/evidence/mileage/route.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    new Function('require', 'module', 'exports', code)(n => { if (!(n in mocks)) throw Error(n); return mocks[n]; }, module, module.exports);
    const res = await module.exports.GET(new Request(`http://localhost/api/admin/forth-tracking/evidence/mileage?from=${DAY}&to=${DAY}`));
    return res.json();
  };
  return (async () => {
    const admin = await run('admin'); const office = await run('office_staff'); const readOnly = await run('read_only');
    const rowOf = r => r.ledger.find(l => l.vehicleId === 'a');
    assert.ok(rowOf(admin).journeys, 'admin gets journey allocation'); assert.equal(rowOf(admin).journeysRestricted, false);
    for (const r of [office, readOnly]) { assert.equal(rowOf(r).journeys, null); assert.equal(rowOf(r).journeysRestricted, true); assert.equal(rowOf(r).provider.km, 10, 'the day total is still available'); assert.doesNotMatch(JSON.stringify(r), /"journeyLedger"|reportedTrailKm/); }
    assert.ok(admin.bookingQuality && admin.bookingQuality.total === 0);
  })();
});

test('temporary review state is never presented as saved, and stale decisions are flagged', () => {
  const panel = fs.readFileSync('components/fleet-job-review-panel.tsx', 'utf8');
  assert.match(panel, /Temporary — not saved/); assert.match(panel, /ชั่วคราว — ไม่ได้บันทึก/); assert.match(panel, /reloading clears them/);
  assert.match(panel, /stale/); assert.match(panel, /fingerprint/);
  assert.doesNotMatch(panel, /fetch\(|supabase|localStorage|sessionStorage|\.insert\(|\.upsert\(|\.update\(/, 'decisions are never written anywhere');
  for (const f of ['components/fleet-vehicle-day-summary.tsx', 'components/fleet-journey-ledger-panel.tsx']) assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /fetch\(|localStorage|sessionStorage/, f);
  // The accountability engine has no way to receive a temporary decision.
  const a = analyse(ledgerOf([seg('a', '08:00:00', '09:00:00', 10)], fullLog()), [job('1', '08:10')], { providerComplete: true });
  assert.equal(a.allocation.confirmedJobKm, null); assert.equal(a.allocation.confirmationSource, 'not_available');
  assert.equal(jl.temporaryDecisionState({ '1': 'confirm' }).saved, false);
});

test('English and Thai: every label exists in both languages, Thai really is Thai, and English has no Thai', () => {
  const thai = /[฀-๿]/;
  const sets = [copy.MATCH_REASON_COPY];
  for (const set of sets) for (const [key, [en, th]] of Object.entries(set)) { assert.ok(en && th, key); assert.match(th, thai, key); assert.doesNotMatch(en, thai, key); }
  const probes = [['matchStatusLabel', ['confirmed', 'candidate', 'needs_review', 'no_journey']], ['reconciliationLabel', ['complete_verified', 'partially_allocated', 'awaiting_office_review', 'conflicting_evidence', 'source_incomplete', 'unknown']],
    ['provenanceLabel', ['forth_parking_report', 'forth_log_distance', 'booking_diary', 'approved_confirmation_record', 'fuel_logs_purchase', 'fuel_log_odometer', 'weekly_mileage_odometer', 'source_comparison', 'ees_derived', 'forth_log_position_source', 'forth_report_segments']],
    ['issueLabel', ['provider_day_not_read', 'open_final_segment_coverage_unverified', 'journey_detail_restricted', 'fuel_purchase_not_consumption', 'odometer_repeated_reading', 'odometer_unknown_interval', 'odometer_source_disagrees', 'no_booking_found_not_proof_of_no_work']],
    ['reconciliationReasonLabel', ['provider_day_not_read', 'provider_coverage_unverified', 'no_confirmation_source', 'candidates_awaiting_review', 'positions_not_verified_gps']], ['positionSourceLabel', ['gps', 'no_gps', 'mixed', 'none', 'unknown']]];
  for (const [fn, keys] of probes) for (const k of keys) { const en = copy[fn](k, 'en'), th = copy[fn](k, 'th'); assert.ok(en && th && en !== th, `${fn}:${k}`); assert.match(th, thai, `${fn}:${k}`); assert.doesNotMatch(en, thai, `${fn}:${k}`); }
  assert.match(copy.matchStatusLabel('candidate', 'en'), /Candidate/); assert.match(copy.reconciliationLabel('awaiting_office_review', 'en'), /Awaiting office review/);
  assert.doesNotMatch(copy.provenanceLabel('forth_parking_report', 'en'), /verified by GPS/i);
});

test('read-only and no business-record writers in the new modules', () => {
  for (const f of ['lib/fleet-journey-ledger.ts', 'lib/fleet-booking-quality.ts', 'lib/fleet-vehicle-day-summary.ts', 'lib/fleet-journey-copy.ts']) {
    const src = fs.readFileSync(f, 'utf8'); assert.doesNotMatch(src, /fetch\(|\.from\(["']|\.insert\(|\.upsert\(|\.update\(|\.delete\(|supabase|process\.env\.[A-Z_]*KEY/, f);
    assert.doesNotMatch(src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, ''), /\blatitude\b|\blongitude\b/, `${f} must not carry coordinates`);
  }
});
