const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('../scripts/fleet-real-day-validation.cjs');
const bi = load('lib/booking-diary-integrity.ts');
const dayMod = load('lib/fleet-intelligence-day.ts');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/\r\n/g, '\n');
let n = 0;
const row = (o = {}) => ({ id: `b${++n}`, booking_date: '2026-10-03', pickup_time: null, vehicle: null, vehicle_registration: '74-8969', vehicle_id: null, driver: null, driver_id: null, job_order_number: null, pickup: 'QMB', dropoff: 'Airport', pickup_lat: null, pickup_lng: null, dropoff_lat: 13.68, dropoff_lng: 100.74, created_at: '2026-10-07T17:36:00Z', ...o });
const fleet = [{ id: 'v1', vehicle_reg: '74-8969' }, { id: 'v2', vehicle_reg: '68-7154' }, { id: 'v3', vehicle_reg: '3ฒล-4565' }, { id: 'v4', vehicle_reg: '3ฒล4565' }];
const flagsOf = (report, id) => report.byId.get(id).flags;

test('vehicle identity: an exact registration resolves to one fleet vehicle; the two 3ฒล-4565 records stay ambiguous and are never guessed', () => {
  assert.deepEqual(bi.resolveVehicleIdentity('74-8969', fleet), { status: 'unique', vehicleId: 'v1', registration: '74-8969' });
  assert.equal(bi.resolveVehicleIdentity(' 74 8969 ', fleet).status, 'unique', 'spaces and hyphens are ignored');
  const amb = bi.resolveVehicleIdentity('3ฒล-4565', fleet);
  assert.equal(amb.status, 'ambiguous'); assert.deepEqual(amb.candidates.sort(), ['v3', 'v4']);
  assert.equal(bi.resolveVehicleIdentity('99-9999', fleet).status, 'not_found'); assert.equal(bi.resolveVehicleIdentity('  ', fleet).status, 'empty'); assert.equal(bi.resolveVehicleIdentity(null, fleet).status, 'empty');
  assert.equal(bi.resolveVehicleIdentity('74-8969', [{ id: 'x', vehicle_reg: '74-8969' }, { id: 'y', vehicle_reg: '74 8969' }]).status, 'ambiguous');
});

test('a booking on the ambiguous registration is flagged, keeps its text, and is not linked to a guessed vehicle', () => {
  const b = row({ vehicle_registration: '3ฒล-4565' }); const r = bi.analyseBookingIntegrity([b], fleet);
  assert.ok(flagsOf(r, b.id).includes('registration_ambiguous_in_fleet')); assert.equal(r.byId.get(b.id).details.vehicleIdentity, 'ambiguous'); assert.equal(b.vehicle_registration, '3ฒล-4565');
  assert.ok(r.byId.get(b.id).attention);
});

test('the vehicle field: a type word is fine; a different registration-like text is flagged with the other text; an equal one is not', () => {
  const rows = [row({ vehicle: 'EIGHTEEN_WHEELER' }), row({ vehicle: '6' }), row({ vehicle: 'กระบะ' }), row({ vehicle: '63-3543' }), row({ vehicle: '74-8969' }), row({ vehicle: '61-2835-64-0096' })];
  const r = bi.analyseBookingIntegrity(rows, fleet);
  const hits = rows.map(x => flagsOf(r, x.id).includes('vehicle_text_differs_from_registration'));
  assert.deepEqual(hits, [false, false, false, true, false, true]);
  assert.equal(r.byId.get(rows[3].id).details.otherRegistrationText, '63-3543');
});

test('legacy rows with the registration only in the vehicle field still resolve; empty rows are flagged missing', () => {
  const legacy = row({ vehicle_registration: null, vehicle: '68-7154' }), empty = row({ vehicle_registration: null, vehicle: 'กระบะ' });
  const r = bi.analyseBookingIntegrity([legacy, empty], fleet);
  assert.equal(r.byId.get(legacy.id).details.vehicleIdentity, 'unique'); assert.ok(!flagsOf(r, legacy.id).includes('missing_registration'));
  assert.ok(flagsOf(r, empty.id).includes('missing_registration'));
});

test('duplicates: identical driver, vehicle text, route, day and time is a possible double entry; different trucks on one route are not duplicates', () => {
  const same1 = row({ id: 's1', driver: 'A', vehicle: '6', pickup_time: '14:00:00' }), same2 = row({ id: 's2', driver: 'A', vehicle: '6', pickup_time: '14:00:00' });
  const trucks = [row({ id: 't1', driver: 'A', vehicle: '64-0359', pickup_time: '14:00:00' }), row({ id: 't2', driver: 'B', vehicle: '78-6996', pickup_time: '14:00:00' }), row({ id: 't3', driver: 'C', vehicle: '61-2835-64-0096', pickup_time: '14:00:00' })];
  const r = bi.analyseBookingIntegrity([same1, same2, ...trucks.map(t => ({ ...t, pickup: 'Wafertec' }))], fleet);
  assert.ok(flagsOf(r, 's1').includes('possible_duplicate_entry') && flagsOf(r, 's2').includes('possible_duplicate_entry')); assert.equal(r.byId.get('s1').details.duplicateOf, 2);
  for (const t of ['t1', 't2', 't3']) { assert.ok(flagsOf(r, t).includes('same_route_other_truck'), t); assert.ok(!flagsOf(r, t).includes('possible_duplicate_entry'), t); }
});

test('a legitimate repeated trip (same truck, same route and day, different pickup times) gets neither a duplicate nor a separate-truck flag', () => {
  const morning = row({ id: 'm1', driver: 'A', vehicle: '6', pickup_time: '08:00:00' }), evening = row({ id: 'm2', driver: 'A', vehicle: '6', pickup_time: '17:00:00' });
  const r = bi.analyseBookingIntegrity([morning, evening], fleet);
  for (const id of ['m1', 'm2']) { assert.ok(!flagsOf(r, id).includes('possible_duplicate_entry')); assert.ok(!flagsOf(r, id).includes('same_route_other_truck')); }
});

test('type-text vehicles never group unrelated trucks into duplicates', () => {
  const a = row({ id: 'g1', vehicle_registration: null, vehicle: '6ล้อ', driver: 'A' }), b = row({ id: 'g2', vehicle_registration: null, vehicle: '6ล้อ', driver: 'A' });
  const r = bi.analyseBookingIntegrity([a, b], fleet);
  assert.ok(!flagsOf(r, 'g1').includes('possible_duplicate_entry'), 'a vehicle type is not a vehicle');
});

test('conflicting site coordinates: one customer name at places kilometres apart is flagged with the spread; a 200 m difference is not', () => {
  const sirtecA = row({ id: 'c1', pickup: 'Sirtec', pickup_lat: 13.1040552, pickup_lng: 100.9158073 }), sirtecB = row({ id: 'c2', pickup: 'sirtec', pickup_lat: 13.112114, pickup_lng: 100.9820285 });
  const calA = row({ id: 'c3', dropoff: 'CAL-COMP', dropoff_lat: 13.6260471, dropoff_lng: 100.2928746 }), calB = row({ id: 'c4', dropoff: 'CAL-COMP', dropoff_lat: 13.2677158, dropoff_lng: 99.8214174 });
  const near1 = row({ id: 'c5', pickup: 'Near', pickup_lat: 13.7, pickup_lng: 100.5 }), near2 = row({ id: 'c6', pickup: 'Near', pickup_lat: 13.7018, pickup_lng: 100.5 });
  const r = bi.analyseBookingIntegrity([sirtecA, sirtecB, calA, calB, near1, near2], fleet);
  const byName = Object.fromEntries(r.coordinateConflicts.map(c => [c.name.toLowerCase(), c]));
  assert.ok(byName['sirtec'].spreadKm > 6.5 && byName['sirtec'].spreadKm < 8); assert.ok(byName['cal-comp'].spreadKm > 60 && byName['cal-comp'].spreadKm < 75); assert.equal(byName['near'], undefined);
  for (const id of ['c1', 'c2', 'c3', 'c4']) assert.ok(flagsOf(r, id).includes('conflicting_site_coordinates'), id);
  assert.ok(!flagsOf(r, 'c5').includes('conflicting_site_coordinates')); assert.equal(r.coordinateConflicts[0].name.toLowerCase(), 'cal-comp', 'largest spread first');
});

test('information flags explain what is missing without demanding attention', () => {
  const b = row({ driver: 'Nickname', created_at: '2026-10-20T00:00:00Z' }); const r = bi.analyseBookingIntegrity([b], fleet);
  for (const f of ['missing_pickup_time', 'missing_work_order', 'vehicle_id_not_linked', 'driver_not_linked', 'late_entry']) assert.ok(flagsOf(r, b.id).includes(f), f);
  assert.equal(r.byId.get(b.id).attention, false); assert.equal(r.attentionTotal, 0);
  const done = row({ pickup_time: '09:00:00', job_order_number: 'WO-1', vehicle_id: 'v1', driver: 'D', driver_id: 5, created_at: '2026-10-03T05:00:00Z' });
  assert.deepEqual(flagsOf(bi.analyseBookingIntegrity([done], fleet), done.id), []);
});

test('the analysis never mutates its input and counts every booking once', () => {
  const rows = [row({ pickup: 'Sirtec', pickup_lat: 13.1, pickup_lng: 100.9 }), row({ pickup: 'Sirtec', pickup_lat: 13.2, pickup_lng: 100.9 })]; const before = JSON.stringify(rows);
  const r = bi.analyseBookingIntegrity(rows, fleet); assert.equal(JSON.stringify(rows), before); assert.equal(r.total, 2); assert.equal(r.byId.size, 2);
  assert.equal(Object.values(r.counts).every(v => Number.isInteger(v)), true);
});

test('Fleet jobs use the refined classification: duplicates need identical driver, vehicle text and time; different trucks are labelled separately', () => {
  const day = '2026-10-03', base = { booking_date: day, vehicle_id: null, vehicle_registration: '74-8969', job_order_number: null, pickup_lat: null, pickup_lng: null, dropoff_lat: null, dropoff_lng: null, updated_at: '2026-10-07T17:00:00Z', pickup: 'Wafertec', dropoff: 'Airport', pickup_time: '14:00:00' };
  const rows = [{ ...base, id: 'f1', driver: 'A', vehicle: '64-0359' }, { ...base, id: 'f2', driver: 'B', vehicle: '78-6996' }, { ...base, id: 'f3', driver: 'C', vehicle: '6' }, { ...base, id: 'f4', driver: 'C', vehicle: '6' }];
  const jobs = Object.fromEntries(dayMod.suggestDayJobs('V', '74-8969', day, rows, null).map(j => [j.jobId, j]));
  assert.equal(jobs.f1.possibleDuplicateBooking, false); assert.equal(jobs.f1.sameRouteOtherTruck, true); assert.equal(jobs.f2.possibleDuplicateBooking, false);
  assert.equal(jobs.f3.possibleDuplicateBooking, true); assert.equal(jobs.f4.possibleDuplicateBooking, true); assert.equal(jobs.f3.workOrder, null);
});

test('the diary UI shows the checks read-only, bilingual and mobile safe, and the page only gained additive wiring', () => {
  const page = read('app/(dashboard)/booking-diary/page.tsx'), cmp = read('components/booking-integrity-summary.tsx'), lib = read('lib/booking-diary-integrity.ts');
  assert.match(page, /BookingIntegritySummary/); assert.match(page, /analyseBookingIntegrity\(bookings/); assert.match(page, /extraIssues: readonly string\[\] = \[\]/); assert.match(page, /integrityIssues\(booking\.id\)/);
  for (const needle of ['Data checks', 'ตรวจสอบข้อมูล', 'Nothing is changed, merged or deleted', 'data-integrity-summary', 'data-coordinate-conflicts']) assert.ok(cmp.includes(needle), needle);
  assert.doesNotMatch(cmp, /fetch\(|supabase|\.insert\(|\.update\(|\.delete\(|localStorage/); assert.doesNotMatch(lib, /supabase|fetch\(|Date\.now\(\)|Math\.random|\.insert\(|\.update\(|\.delete\(/);
  const thai = /[฀-๿]/; for (const k of Object.keys(bi.INTEGRITY_COPY)) assert.ok(thai.test(bi.INTEGRITY_COPY[k][1]), k);
  assert.match(page, /saveBookingDiaryEntry\(\{/); assert.equal((page.match(/saveBookingDiaryEntry\(/g) ?? []).length, 1, 'the save path is unchanged');
});

test('existing diary behaviour is preserved: duplicate still clears only the job order number, required fields are unchanged', () => {
  const page = read('app/(dashboard)/booking-diary/page.tsx');
  assert.match(page, /setForm\(\{ \.\.\.mapBookingToForm\(booking\), id: "", job_order_number: "" \}\)/);
  assert.match(page, /if \(!form\.booking_date \|\| !form\.pickup\.trim\(\) \|\| !form\.dropoff\.trim\(\)\)/);
  assert.match(page, /isNewBooking && \(!selectedClient \|\| !selectedClient\.active\)/);
});

test('a vehicle type word copied into the registration field by the diary normaliser is "no registration recorded", not "not in the fleet"', () => {
  const typeOnly = row({ vehicle_registration: '6ล้อ', vehicle: '6ล้อ' }), unknownReg = row({ vehicle_registration: '99-9999' });
  const r = bi.analyseBookingIntegrity([typeOnly, unknownReg], fleet);
  assert.ok(flagsOf(r, typeOnly.id).includes('missing_registration')); assert.ok(!flagsOf(r, typeOnly.id).includes('registration_not_in_fleet')); assert.equal(r.byId.get(typeOnly.id).attention, false);
  assert.ok(flagsOf(r, unknownReg.id).includes('registration_not_in_fleet')); assert.equal(r.byId.get(unknownReg.id).attention, true);
});
