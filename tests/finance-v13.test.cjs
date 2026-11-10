const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const h = require('./helpers/invoice-compare.cjs');
const f = h.lib('finance-demo-centre.ts');
const read = (p) => fs.readFileSync(path.join(h.root, p), 'utf8');

// Fixture jobs are shaped like the real APL Booking Diary rows seen in Admin Intake (Sirtec → CAL-COMP / GOODYEAR → สุวรรณภูมิ / TRAX → ลาดกระบัง)
// but are isolated test data: the work-order numbers are made-up fixtures, never real green-paper numbers.
const receipts = (a = {}) => ({ amounts: Object.fromEntries(f.ADMIN_RECEIPT_FIELDS.map((k) => [k, a[k] ?? null])), notes: '' });
const seed = (id, date, pickup, dropoff, vehicle, plate) => ({ id, booking_id: `BK-V13-${id}`, client_id: 'v13-apl', client_name: 'APL (fixture)', booking_date: date, pickup, dropoff, vehicle, vehicle_registration: plate, driver: `Driver ${id}` });
const act = (s, a, who = 'finance') => f.applyAction(s, a, who);
function base() {
  let s = f.createEmptyOwnerState();
  s = f.linkDiaryWorkOrder(s, seed('s1', '2026-10-05', 'Sirtec', 'CAL-COMP', '40', '68-7154'), 'FX-S1', 'admin', receipts({ parking: 40, toll: 60 }));
  s = f.linkDiaryWorkOrder(s, seed('s2', '2026-10-05', 'SIRTEX', 'CAL-COMP', '40"', '63-3543'), 'FX-S2', 'admin', receipts());
  s = f.linkDiaryWorkOrder(s, seed('g1', '2026-10-03', 'Good year', 'สุวรรณภูมิ', '6ล้อ', '62-4337'), 'FX-G1', 'admin', receipts());
  s = f.linkDiaryWorkOrder(s, seed('g2', '2026-10-03', 'GOODYEAR', 'สุวรรณภูมิ', 'กระบะ', '70-1654'), 'FX-G2', 'admin', receipts());
  s = f.linkDiaryWorkOrder(s, seed('t1', '2026-08-13', 'TRAX', 'ลาดกระบัง', 'กระบะ', '3ฒข-196'), 'FX-T1', 'admin', receipts());
  s = act(s, { type: 'sheet_create', clientId: 'v13-apl' });
  const id = s.billingSheets.at(-1).id;
  for (const wo of ['FX-S1', 'FX-S2', 'FX-G1', 'FX-G2', 'FX-T1']) s = act(s, { type: 'sheet_add_paper', sheetId: id, workOrder: wo });
  return { s, id };
}
const job = (s, wo) => s.bookings.find((b) => f.confirmedWorkOrder(b) === wo);
const fuel = (date, price, extra = {}) => ({ type: 'record_fuel_reference', date, priceThb: price, evidence: `History page ${date} Diesel B7 (fixture)`, sourceUrl: f.DIESEL_B7_SOURCE_URL, ...extra });
const sirtechMap = (extra = {}) => ({ type: 'confirm_rate_mapping', scheduleId: 'sirtech', rowId: 'sirtech-calcomp-trailer-empty40', clientId: 'v13-apl', contractReference: 'Fixture Sirtech approval', effectiveFrom: '2026-01-01', effectiveTo: null, reviewReason: '', match: { pickup: ['sirtec', 'sirtex'], delivery: ['cal-comp'], vehicleClass: ['40'] }, ...extra });
const goodyearMap = (extra = {}) => ({ type: 'confirm_rate_mapping', scheduleId: 'goodyear', rowId: 'goodyear-route-2', clientId: 'v13-apl', contractReference: 'Fixture Goodyear approval', effectiveFrom: '2026-01-01', effectiveTo: null, reviewReason: '', match: { pickup: ['goodyear', 'good year'], delivery: ['สุวรรณภูมิ'], vehicleClass: ['6W'] }, ...extra });

test('vehicle class is read from the diary text, never guessed', () => {
  const c = f.vehicleClassOf;
  assert.deepEqual(['6ล้อ', '6 ล้อ', '6W', 'กระบะ', '4 ล้อ', '40', '40"', "40'", 'พ่วง'].map(c), ['6W', '6W', '6W', '4W', '4W', '40', '40', '40', 'TRAILER']);
  assert.deepEqual(['', null, undefined, '10ล้อ', '68-7154', 'รถบรรทุก'].map(c), [null, null, null, null, null, null]);
});

test('route + vehicle matching: only the approved route and class are priced; others say why', () => {
  let { s } = base();
  assert.equal(f.diagnoseRate(s, job(s, 'FX-S1')).code, 'no_mapping');
  s = act(s, sirtechMap(), 'approver'); s = act(s, goodyearMap(), 'approver');
  // Fuel is missing for the dates → "needs verification" only for jobs whose route/class match
  assert.equal(f.diagnoseRate(s, job(s, 'FX-S1')).code, 'needs_fuel'); assert.match(f.diagnoseRate(s, job(s, 'FX-S1')).en, /Fuel price needs verification/);
  assert.equal(f.diagnoseRate(s, job(s, 'FX-G1')).code, 'needs_fuel');
  assert.equal(f.diagnoseRate(s, job(s, 'FX-G2')).code, 'route_mismatch', '4W pickup truck is not the approved 6W rate');
  assert.match(f.diagnoseRate(s, job(s, 'FX-G2')).en, /none matches this job's route and vehicle class/);
  assert.equal(f.diagnoseRate(s, job(s, 'FX-T1')).code, 'route_mismatch', 'TRAX → ลาดกระบัง matches no approved row');
  // one verified value is reused by every job on that exact date; other dates stay unverified
  s = act(s, fuel('2026-10-05', 40.0));
  for (const wo of ['FX-S1', 'FX-S2']) { const d = f.diagnoseRate(s, job(s, wo)); assert.equal(d.kind, 'suggested'); assert.equal(d.amountThb, 12650); assert.equal(d.bandLabel, '39.01-40.00'); }
  assert.equal(f.diagnoseRate(s, job(s, 'FX-G1')).code, 'needs_fuel', 'no carry-forward from another date');
  s = act(s, fuel('2026-10-03', 42.54));
  const g = f.diagnoseRate(s, job(s, 'FX-G1'));
  assert.deepEqual([g.kind, g.amountThb, g.vehicle, g.bandLabel], ['suggested', 3300, '6W', 'Fuel at 43']);
});

test('fuel band boundaries on the matched Sirtech row (40.00 vs 40.01) and out-of-band behaviour', () => {
  let { s } = base(); s = act(s, sirtechMap(), 'approver');
  s = act(s, fuel('2026-10-05', 40.01));
  assert.equal(f.diagnoseRate(s, job(s, 'FX-S1')).amountThb, 12765);
  s = act(s, fuel('2026-10-05', 40.0, { revisionReason: 'Boundary check of the stored value' }));
  assert.equal(f.diagnoseRate(s, job(s, 'FX-S1')).amountThb, 12650);
  s = act(s, fuel('2026-10-05', 61.0, { revisionReason: 'Out of schedule range check' }));
  assert.equal(f.diagnoseRate(s, job(s, 'FX-S1')).code, 'out_of_band');
});

test('mapping approval validates match lists, dates and duplicates; unrestricted legacy mappings still work', () => {
  const { s } = base();
  assert.throws(() => act(s, sirtechMap({ match: { pickup: [], delivery: [], vehicleClass: [] } }), 'approver'), /FINANCE_RATE_MAPPING_GATE/);
  assert.throws(() => act(s, sirtechMap({ match: { pickup: ['x'], delivery: [], vehicleClass: [] } }), 'approver'), /FINANCE_RATE_MAPPING_GATE/);
  assert.throws(() => act(s, sirtechMap({ match: { pickup: ['sirtec'], delivery: [], vehicleClass: ['10W'] } }), 'approver'), /FINANCE_RATE_MAPPING_GATE/);
  assert.throws(() => act(s, sirtechMap({ effectiveFrom: '2026-02-30' }), 'approver'), /FINANCE_RATE_MAPPING_GATE/);
  const once = act(s, sirtechMap(), 'approver');
  assert.throws(() => act(once, sirtechMap(), 'approver'), /FINANCE_RATE_MAPPING_GATE/, 'no duplicate mapping');
  assert.equal(act(once, sirtechMap({ match: { pickup: ['sirtec'], delivery: ['other'], vehicleClass: ['40'] } }), 'approver').rateMappings.length, 2, 'a different route for the same row is a separate approval');
  const legacy = act(s, { ...sirtechMap(), match: undefined }, 'approver');
  assert.equal(f.diagnoseRate(act(legacy, fuel('2026-10-05', 35)), job(legacy, 'FX-S1')).kind, 'suggested');
});

test('effective dates are respected per mapping', () => {
  let { s } = base(); s = act(s, sirtechMap({ effectiveFrom: '2026-10-06' }), 'approver'); s = act(s, fuel('2026-10-05', 40));
  assert.equal(f.diagnoseRate(s, job(s, 'FX-S1')).code, 'mapping_not_effective');
  s = act(base().s, sirtechMap({ effectiveTo: '2026-10-04' }), 'approver');
  assert.equal(f.diagnoseRate(s, job(s, 'FX-S1')).code, 'mapping_not_effective');
});

test('applying suggestions to several jobs keeps existing prices, never adds receipts, and audits the source', () => {
  let { s, id } = base(); s = act(s, sirtechMap(), 'approver'); s = act(s, fuel('2026-10-05', 40));
  const s2 = job(s, 'FX-S2');
  s = act(s, { type: 'sheet_set_transport', sheetId: id, jobId: s2.id, transport: { amount: 9999, source: 'manual' } });
  const apply = (wo, extra = {}) => { const j = job(s, wo); const d = f.diagnoseRate(s, j); return act(s, { type: 'sheet_apply_rate', sheetId: id, jobId: j.id, mappingId: d.mappingId, amountThb: d.amountThb, overrideReason: '', routeVehicleConfirmed: true, confirmOverwrite: false, ...extra }); };
  s = apply('FX-S1');
  assert.throws(() => apply('FX-S2'), /FINANCE_PRICE_OVERWRITE_CONFIRM/);
  const sheet = s.billingSheets.find((x) => x.id === id);
  assert.equal(sheet.lines[job(s, 'FX-S1').id].transport.amount, 12650);
  assert.equal(sheet.lines[s2.id].transport.amount, 9999);
  assert.equal(f.sheetRowTotals(s, sheet, job(s, 'FX-S1').id).totalSatang, 1265000, 'parking ฿40 and toll ฿60 receipts are not charged');
  const p = sheet.lines[job(s, 'FX-S1').id].transport.provenance;
  assert.deepEqual([p.scheduleId, p.fuel.priceThb, p.fuel.date, p.bandLabel, p.vehicle], ['sirtech', 40, '2026-10-05', '39.01-40.00', 'Trailer + empty 40\' container']);
});

test('pricing set-up UI is wired into Customer Billing with the manual-only fuel policy', () => {
  const setup = read('components/finance-pricing-setup.tsx');
  assert.match(setup, /Fuel price needs verification|setup-apply-all/); assert.match(read('components/finance-pricing-bar.tsx'), /apply-all-suggestions/); assert.match(read('components/finance-fuel-prices-panel.tsx'), /Manual verification only/);
  assert.doesNotMatch(setup, /fetch\(/, 'no automatic fetching of the fuel website');
  // V20: configuration moved out of daily Billing into the owner-only pricing administration page.
  assert.doesNotMatch(read('components/finance-billing-sheet-stage.tsx'), /<FinancePricingSetup/);
  const admin = read('components/finance-pricing-admin.tsx');
  assert.match(admin, /FinanceAplPriceSetup/); assert.match(admin, /does not pull live data/);
  assert.match(admin, /fetch\("\/api\/finance-pricing-admin\/access"/, 'only the local server access check is fetched');
  assert.doesNotMatch(admin, /fetch\((?:DIESEL_B7_SOURCE_URL|["'`]https?:)/, 'no automatic fetching of the fuel website');
});
