const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { load } = require('../scripts/fleet-real-day-validation.cjs');
const L = load('lib/fleet-distance-ledger.ts');
const R = load('lib/fleet-mileage-report.ts');
const dayMod = load('lib/fleet-intelligence-day.ts');
// Synthetic, clearly labelled inputs: they exercise the accounting rules, they are not live results.
const base = { vehicleId: 'v', registration: 'REG', day: '2026-11-03', timeZone: 'Asia/Bangkok', gpsKm: null, fuelOdometer: [], weeklyOdometer: [], fuelPurchase: null, bookings: [] };
const prov = (o = {}) => ({ km: 289.2, reconciled: true, complete: false, segments: 17, openSegments: 1, capturedAt: '2026-11-06T01:00:00Z', expiresAt: '2026-11-06T01:30:00Z', ...o });
const ledger = o => L.buildVehicleDayLedger({ ...base, ...o });

test('1: genuine provider distance appears with its provenance, source and time zone', () => {
  const d = ledger({ provider: prov() });
  assert.equal(d.provider.km, 289.2); assert.equal(d.provider.source, 'forth_parkingTrip_report'); assert.equal(d.timeZone, 'Asia/Bangkok');
  assert.equal(d.provider.capturedAt, '2026-11-06T01:00:00Z'); assert.equal(d.provider.expiresAt, '2026-11-06T01:30:00Z'); assert.equal(d.provider.segments, 17);
});

test('2: an open report segment or unverified coverage never yields an accountable total or a balance', () => {
  const open = ledger({ provider: prov({ complete: true, openSegments: 1 }) });
  assert.equal(open.provider.state, 'reconciled_incomplete'); assert.equal(open.accountability.accountableKm, null); assert.equal(open.accountability.state, 'unresolved_coverage_unverified');
  assert.equal(open.attribution.unattributedKm, null); assert.equal(open.attribution.attributedShare, null);
  assert.equal(ledger({ provider: prov({ complete: false, openSegments: 0 }) }).accountability.state, 'unresolved_coverage_unverified');
});

test('3: cumulative and interval distances cannot be mixed: odometer spans never feed provider km and the semantics are labelled', () => {
  const d = ledger({ provider: prov(), fuelOdometer: [{ id: '1', km: 615524 }], weeklyOdometer: [{ id: '2', km: 615000, baseline: null }] });
  assert.equal(d.provider.km, 289.2); assert.equal(d.odometer.fuelLogs, 1); assert.equal(d.odometer.weekly, 1);   // counts only: no odometer value becomes a daily distance
  const ids = L.FORTH_DISTANCE_SEMANTICS.map(f => f.id);
  assert.ok(ids.includes('day_scoped_independent') && ids.includes('multi_day_additive') && ids.includes('log_distance_increments'));
  assert.equal(L.FORTH_DISTANCE_SEMANTICS.find(f => f.id === 'day_scoped_independent').status, 'confirmed');
  // Upgraded by the 6 Nov device comparison (3 device-days): the unit and increment semantics are confirmed and match Forth's documentation,
  // but the app still never derives GPS distance from this field (see the next assertions and forth-gps-health.test.cjs).
  assert.equal(L.FORTH_DISTANCE_SEMANTICS.find(f => f.id === 'log_distance_increments').status, 'confirmed');
  assert.equal(L.FORTH_DISTANCE_SEMANTICS.find(f => f.id === 'report_distance_method').status, 'derived');       // appears coordinate-based, undocumented by Forth
  assert.equal(L.FORTH_DISTANCE_SEMANTICS.find(f => f.id === 'position_source_label').status, 'unknown');       // meaning of the label is still unknown
  assert.ok(L.FORTH_QUESTIONS.length >= 5);
});

test('4: duplicate and overlapping provider segments are not double counted; a multi-day (multi-Total) report is refused', () => {
  const row = (s, e, km) => ({ boxId: 'box', plateNo: 'REG', rDate: '2026-11-03 ', startTime: s, endTime: e, sumDistance: km, routingTime: '01:00:00' });
  const make = rows => dayMod.buildProviderDay({ vehicleId: 'v', registration: 'REG', deviceId: 'box', day: '2026-11-03', capturedAt: '2026-11-06T00:00:00Z', reportRows: rows, logRows: [] });
  const dup = make([row('08:00:00', '09:00:00', '10.00'), row('08:00:00', '09:00:00', '10.00'), { boxId: '', plateNo: 'Total', sumDistance: '10' }]); assert.equal(dup.sources.providerReported.value, 10);
  // Shape observed on 6 Nov 2026 for a two-day request: per-day Totals followed by a grand Total (synthetic copy of the structure, not live data).
  const multi = make([row('08:00:00', '09:00:00', '10.00'), { boxId: '', plateNo: 'Total', sumDistance: '10' }, { boxId: '', plateNo: 'Total', sumDistance: '20' }, { boxId: '', plateNo: 'Total', sumDistance: '30' }]);
  assert.equal(multi.sources.providerReported.value, null); assert.ok(multi.provider.issues.includes('missing_or_multiple_total_rows'));
});

test('5: missing GPS stays unknown and a verified GPS km is never invented from provider distance', () => {
  const d = ledger({ provider: prov() }); assert.equal(d.gps.km, null); assert.equal(d.gps.state, 'unknown');
});

test('6/7/8: no confirmation source means nothing is confirmed; no bookings is not "no work"; unallocated is never empty running', () => {
  const found = ledger({ provider: prov({ complete: true, openSegments: 0 }), bookings: [{ id: 'j1', workOrder: 'WO-1' }] });
  assert.equal(found.candidateJobs, 1); assert.equal(found.attribution.confirmedKm, null); assert.equal(found.attribution.confirmationSource, 'not_available');
  assert.equal(found.accountability.state, 'unresolved_no_confirmed_allocation'); assert.equal(found.attribution.unattributedKm, null);
  const none = ledger({ provider: prov(), bookings: [] }); assert.equal(none.bookings.state, 'none_found'); assert.equal(none.bookings.count, 0);
  assert.equal(ledger({ provider: prov(), bookings: null }).bookings.state, 'source_unavailable');
  for (const d of [found, none]) assert.equal(d.emptyRunningKm, null);
});

test('accounting: confirmed + remaining = accountable only for a complete comparable source with confirmed allocations; over-allocation is an error', () => {
  const complete = prov({ complete: true, openSegments: 0, km: 100 });
  const ok = ledger({ provider: complete, confirmedAllocations: [{ jobId: 'a', km: 60 }, { jobId: 'b', km: 15.5 }] });
  assert.equal(ok.accountability.state, 'balanced'); assert.equal(ok.attribution.confirmedKm, 75.5); assert.equal(ok.attribution.unattributedKm, 24.5);
  assert.equal(ok.attribution.confirmedKm + ok.attribution.unattributedKm, ok.accountability.accountableKm); assert.equal(ok.attribution.attributedShare, 0.755);
  assert.equal(ledger({ provider: complete, confirmedAllocations: [] }).attribution.unattributedKm, 100);           // confirmed list supplied and empty: all remaining, still not "empty running"
  assert.equal(ledger({ provider: complete, confirmedAllocations: [{ jobId: 'a', km: 120 }] }).accountability.state, 'overallocated');
  const zero = ledger({ provider: prov({ complete: true, openSegments: 0, km: 0 }), confirmedAllocations: [] }); assert.equal(zero.attribution.attributedShare, null);   // unknown denominator: no percentage
  assert.equal(ledger({ provider: null }).accountability.state, 'no_source');
  assert.equal(ledger({ provider: prov({ reconciled: false, km: null }) }).provider.km, null);
});

test('local preview allocation: a segment belongs to one job, conflicts are reported and the accounting states ignore it', () => {
  const segs = [{ id: 's1', km: 134.68 }, { id: 's2', km: 137.04 }, { id: 's3', km: 0.08 }];
  const p = L.previewAllocation(segs, [{ jobId: 'A', segmentIds: ['s1', 's3'] }, { jobId: 'B', segmentIds: ['s1', 's2', 'nope'] }]);
  assert.deepEqual(p.perJob, { A: 134.76, B: 137.04 }); assert.equal(p.allocatedKm, 271.8); assert.equal(p.conflicts.length, 1); assert.deepEqual(p.unknown, ['nope']); assert.equal(p.previewOnly, true);
  const d = ledger({ provider: prov({ complete: true, openSegments: 0, km: 271.8 }), preview: p });
  assert.equal(d.attribution.confirmedKm, null); assert.equal(d.attribution.preview.allocatedKm, 271.8); assert.equal(d.accountability.state, 'unresolved_no_confirmed_allocation');
  assert.equal(L.previewAllocation(segs, [{ jobId: 'A', segmentIds: ['s1', 's1'] }]).allocatedKm, 134.68);          // the same segment twice for one job counts once
});

test('11: duplicate registrations cannot inflate bucket or fleet totals', () => {
  const registry = [{ id: 'a', vehicle_reg: 'AA-1', active: true }, { id: 'b', vehicle_reg: 'AA 1', active: true }, { id: 'c', vehicle_reg: 'CC-3', active: true }];
  const pd = (day, km) => ({ day, km, reconciled: true, complete: true, gpsKm: null, segments: 2, openSegments: 0 });
  const r = R.buildMileageReport({ registry, range: { from: '2026-11-03', to: '2026-11-03' }, fuel: [], weekly: [], bookings: [], live: null, providerDays: new Map([['a', [pd('2026-11-03', 50)]], ['b', [pd('2026-11-03', 50)]], ['c', [pd('2026-11-03', 10)]]]) });
  const b = R.bucketReport(r, 'day')[0]; assert.equal(b.eligibleVehicles, 1); assert.equal(b.providerKmPartial, 10); assert.equal(b.providerKmFleet, 10); assert.equal(b.reportingVehicles, 1);
  assert.equal(r.ledger.some(x => x.vehicleId === 'a' || x.vehicleId === 'b'), false);                                 // duplicated vehicles get no ledger rows
});

test('12: week, month and day buckets use Asia/Bangkok calendar boundaries and clip to the range', () => {
  assert.equal(R.bucketKey('2026-11-02', 'week'), '2026-11-02');   // Monday
  assert.equal(R.bucketKey('2026-11-08', 'week'), '2026-11-02');   // Sunday belongs to the same week
  assert.equal(R.bucketKey('2026-11-09', 'week'), '2026-11-09'); assert.equal(R.bucketKey('2026-10-31', 'month'), '2026-10'); assert.equal(R.bucketKey('2026-11-01', 'month'), '2026-11');
  const registry = [{ id: 'a', vehicle_reg: 'AA-1', active: true }, { id: 'b', vehicle_reg: 'BB-2', active: true }];
  const pd = (day, km, o = {}) => ({ day, km, reconciled: true, complete: false, gpsKm: null, segments: 2, openSegments: 1, ...o });
  const r = R.buildMileageReport({ registry, range: { from: '2026-10-30', to: '2026-11-04' }, fuel: [], weekly: [], bookings: [], live: null, providerDays: new Map([['a', [pd('2026-10-31', 5), pd('2026-11-03', 7)]]]) });
  const w = R.bucketReport(r, 'week'); assert.deepEqual(w.map(x => [x.key, x.days]), [['2026-10-26', 3], ['2026-11-02', 3]]);   // 30,31 Oct + 1 Nov (Sunday) | 2,3,4 Nov
  assert.equal(w[0].providerKmPartial, 5); assert.equal(w[0].expectedVehicleDays, 6); assert.equal(w[0].reconciledVehicleDays, 1); assert.equal(w[0].status, 'partial'); assert.equal(w[0].providerKmFleet, null);
  const m = R.bucketReport(r, 'month'); assert.deepEqual(m.map(x => x.key), ['2026-10', '2026-11']);
  assert.equal(R.bucketReport(r, 'day').find(x => x.key === '2026-11-04').status, 'not_read');
});

test('1 of 21 style coverage: a partial bucket is never presented as the fleet total', () => {
  const registry = Array.from({ length: 21 }, (_, i) => ({ id: `v${i}`, vehicle_reg: `R-${i}`, active: true }));
  const r = R.buildMileageReport({ registry, range: { from: '2026-11-03', to: '2026-11-03' }, fuel: [], weekly: [], bookings: [], live: null, providerDays: new Map([['v0', [{ day: '2026-11-03', km: 289.2, reconciled: true, complete: false, gpsKm: null, segments: 17, openSegments: 1 }]]]) });
  const b = R.bucketReport(r, 'day')[0]; assert.equal(b.reportingVehicles, 1); assert.equal(b.eligibleVehicles, 21); assert.equal(b.providerKmPartial, 289.2); assert.equal(b.providerKmFleet, null);
  assert.equal(r.totals.providerKmFleet, null); assert.equal(r.totals.providerContributingVehicles, 1);
});

test('investigation queue: highest-impact first, one line per vehicle, coverage notes excluded', () => {
  const ex = (kind, vehicleId, registration) => ({ kind, vehicleId, registration, detail: 'x', evidence: [] });
  const q = R.prioritizeExceptions([ex('provider_distance_missing', 'a', 'A'), ex('missing_observation_timestamp', null, null), ex('gps_unavailable_or_stale', 'b', 'B'), ex('unusual_fuel_purchase', 'c', 'C'), ex('repeated_odometer', 'c', 'C'), ex('duplicate_registration_mapping', 'd', 'D')]);
  assert.deepEqual(q.map(x => [x.registration, x.kinds[0]]), [['C', 'unusual_fuel_purchase'], ['D', 'duplicate_registration_mapping'], ['B', 'gps_unavailable_or_stale']]); assert.equal(q[0].count, 2);
});

test('9/10: fuel stays "purchased not consumed" and weekly readings without baseline are counted as unknown, never as a distance', () => {
  const registry = [{ id: 'a', vehicle_reg: 'AA-1', active: true }];
  const r = R.buildMileageReport({ registry, range: { from: '2026-11-01', to: '2026-11-03' }, live: null, providerDays: new Map(), bookings: [],
    fuel: [{ id: 1, date: '2026-11-03', vehicle_reg: 'AA-1', litres: 93.8, total_cost: 2855.1, fuel_type: 'diesel', odometer: 615524, created_at: '2026-11-03T10:00:00Z' }],
    weekly: [{ id: 9, week_ending: '2026-11-03', vehicle_reg: 'AA-1', odometer_reading: 600000, created_at: '2026-11-03T11:00:00Z' }] });
  const d = r.ledger.find(x => x.day === '2026-11-03'); assert.equal(d.fuel.note, 'purchased_not_consumed'); assert.equal(d.fuel.litres, 93.8); assert.equal(d.odometer.weeklyBaselineUnknown, 1);
  assert.ok(!JSON.stringify(r.ledger).match(/kmPerLitre|consumed_litres|efficiency/i));
});

test('13: a provider failure or an unavailable booking source never erases or fabricates ledger evidence', () => {
  const kept = ledger({ provider: prov(), bookings: null }); assert.equal(kept.provider.km, 289.2); assert.equal(kept.bookings.state, 'source_unavailable');
  assert.equal(ledger({ provider: null, bookings: null }).provider.km, null);
});

test('14: the ledger, bucket and queue code is pure and read-only', () => {
  const src = ['lib/fleet-distance-ledger.ts', 'lib/fleet-mileage-report.ts'].map(f => fs.readFileSync(f, 'utf8')).join('\n');
  assert.doesNotMatch(src, /\.(insert|update|upsert|delete|rpc)\(|fetch\(|supabase|localStorage|method:\s*["'](POST|PUT|PATCH|DELETE)/);
});
