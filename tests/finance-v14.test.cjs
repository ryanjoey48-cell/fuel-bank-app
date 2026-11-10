const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const h = require('./helpers/invoice-compare.cjs');
const f = h.lib('finance-demo-centre.ts');
const ev = h.lib('finance-pricing-evidence.ts');
const fromSheet = h.lib('finance-invoice-from-sheet.ts');
const read = (p) => fs.readFileSync(path.join(h.root, p), 'utf8');

// Six genuine APL diary jobs (date, pickup, delivery, registration, driver) with the green-paper numbers from the owner's brief.
const JOBS = [
  ['2026-10-26', 'Sirtec', 'CAL-COMP', '64-8665', 'Dเลปกร', '6424'], ['2026-10-26', 'Sirtec', 'CAL-COMP', '68-7154', 'Dณัฐกิตติ์', '5838'], ['2026-10-26', 'Sirtec', 'CAL-COMP', '79-5318', 'Dสายัณห์', '6956'],
  ['2026-09-23', 'TITAN', 'ลาดกระบัง', '3ฒข196', 'Aสุทิน', '5817.1'], ['2026-10-26', 'GOODYEAR', 'สุวรรณภูมิ', '701-1654', 'สุวัฒน์ชัย', '6144'], ['2026-09-15', 'SAFFRON', 'บางนา', '63-3543', 'Dโสภณ', '5913']
];
const receipts = (a = {}) => ({ amounts: Object.fromEntries(f.ADMIN_RECEIPT_FIELDS.map((k) => [k, a[k] ?? null])), notes: '' });
const act = (s, a, who = 'finance') => f.applyAction(s, a, who);
function base() {
  let s = f.createEmptyOwnerState();
  JOBS.forEach(([date, p, d, plate, driver, wo], i) => { s = f.linkDiaryWorkOrder(s, { id: 'j' + i, booking_id: 'BK' + i, client_id: 'apl', client_name: 'APL', booking_date: date, pickup: p, dropoff: d, vehicle: null, vehicle_registration: plate, driver }, wo, 'admin', receipts(wo === '6424' ? { toll: 320 } : {})); });
  s = act(s, { type: 'sheet_create', clientId: 'apl' });
  const id = s.billingSheets.at(-1).id;
  for (const j of JOBS) s = act(s, { type: 'sheet_add_paper', sheetId: id, workOrder: j[5] });
  return { s, id };
}
const job = (s, wo) => s.bookings.find((b) => f.confirmedWorkOrder(b) === wo);
const row = (sid, pred) => f.CUSTOMER_RATE_SCHEDULES.find((x) => x.id === sid).rows.find(pred);
const map = (sid, r, match) => ({ type: 'confirm_rate_mapping', scheduleId: sid, rowId: r.id, clientId: 'apl', contractReference: 'Owner approval (test)', effectiveFrom: '2026-01-01', effectiveTo: null, reviewReason: '', match });
const fuel = (date, price, extra = {}) => ({ type: 'record_fuel_reference', date, priceThb: price, evidence: `History page ${date} Diesel B7 (proposed reading)`, sourceUrl: f.DIESEL_B7_SOURCE_URL, ...extra });
function mapped() {
  let { s, id } = base();
  s = act(s, map('sirtech', row('sirtech', () => true), { pickup: ['Sirtec', 'SIRTEC', 'SIRTEX'], delivery: ['CAL-COMP'], vehicleClass: [] }), 'approver');
  s = act(s, map('apl', row('apl', (r) => r.pickup.startsWith('TITAN') && r.vehicle === '4W'), { pickup: ['TITAN'], delivery: ['ลาดกระบัง'], vehicleClass: [], plates: ['3ฒข196'] }), 'approver');
  s = act(s, map('apl', row('apl', (r) => r.pickup === 'SAFFRON - BANGNA'), { pickup: ['SAFFRON'], delivery: ['บางนา'], vehicleClass: [] }), 'approver');
  s = act(s, map('goodyear', row('goodyear', (r) => r.pickup === 'GOODYEAR' && r.vehicle === '6W'), { pickup: ['GOODYEAR'], delivery: ['สุวรรณภูมิ'], vehicleClass: [], plates: ['701-1654'] }), 'approver');
  return { s, id };
}
const PROPOSED = { '2026-10-26': 43.54, '2026-09-23': 40.69, '2026-09-15': 40.69 };

test('a PROPOSED fuel value never prices a job but shows the provisional band and charge', () => {
  let { s } = mapped();
  for (const [d, p] of Object.entries(PROPOSED)) s = act(s, fuel(d, p, { proposed: true }));
  const d = f.diagnoseRate(s, job(s, '6424'));
  assert.equal(d.kind, 'unavailable'); assert.equal(d.code, 'fuel_proposed'); assert.match(d.en, /proposed and awaiting owner verification/);
  assert.equal(d.provisional.amountThb, 13110); assert.equal(d.provisional.bandLabel, '43.01-44.00');
  assert.equal(f.sheetRateSuggestion(s, job(s, '6424')).kind, 'none');
  const calc = ev.fuelCalculation(s, s.billingSheets.at(-1), job(s, '6424'));
  assert.deepEqual([calc.state, calc.fuel.status, calc.fuel.priceThb, calc.band, calc.tableCharge, calc.applied], ['provisional', 'proposed', 43.54, '43.01-44.00', 13110, null]);
  assert.match(calc.note, /Subject to mapping and fuel confirmation/);
  assert.throws(() => act(s, { type: 'sheet_apply_rate', sheetId: s.billingSheets.at(-1).id, jobId: job(s, '6424').id, mappingId: s.rateMappings[0].id, amountThb: 13110, overrideReason: '', routeVehicleConfirmed: true, confirmOverwrite: false }), /FINANCE_RATE_UNAVAILABLE/);
});

test('verify / dispute / correct: audit trail, original evidence kept, saved prices untouched', () => {
  let { s, id } = mapped();
  s = act(s, fuel('2026-10-26', 43.54, { proposed: true }));
  assert.equal(s.fuelReferences[0].status, 'proposed'); assert.equal(s.fuelReferences[0].verifiedBy, null);
  s = act(s, { type: 'verify_fuel_reference', date: '2026-10-26' });
  assert.deepEqual([s.fuelReferences[0].status, s.fuelReferences[0].verifiedBy], ['verified', 'finance']); assert.ok(s.fuelReferences[0].verifiedAt);
  assert.throws(() => act(s, { type: 'verify_fuel_reference', date: '2026-10-26' }), /FINANCE_FUEL_EVIDENCE_GATE/);
  assert.match(s.audit.at(-1).detail, /VERIFIED/);
  const j = job(s, '6424'); const d = f.diagnoseRate(s, j);
  assert.equal(d.kind, 'suggested');
  s = act(s, { type: 'sheet_apply_rate', sheetId: id, jobId: j.id, mappingId: d.mappingId, amountThb: d.amountThb, overrideReason: '', routeVehicleConfirmed: true, confirmOverwrite: false });
  // dispute: stops pricing new jobs, applied price stays
  s = act(s, { type: 'dispute_fuel_reference', date: '2026-10-26', reason: 'Owner will re-read the source page' });
  assert.equal(f.diagnoseRate(s, job(s, '5838')).code, 'fuel_disputed');
  assert.equal(s.billingSheets.find((x) => x.id === id).lines[j.id].transport.amount, 13110);
  assert.throws(() => act(s, { type: 'dispute_fuel_reference', date: '2026-10-26', reason: 'short' }), /FINANCE_FUEL_EVIDENCE_GATE/);
  // correct: original kept and superseded with reason; applied price not repriced
  s = act(s, fuel('2026-10-26', 42.9, { revisionReason: 'Re-read: the page shows 42.90 for this date' }));
  assert.equal(s.fuelReferences.length, 2); assert.ok(s.fuelReferences[0].supersededAt); assert.equal(s.fuelReferences[0].priceThb, 43.54);
  assert.equal(s.billingSheets.find((x) => x.id === id).lines[j.id].transport.amount, 13110);
  assert.equal(s.billingSheets.find((x) => x.id === id).lines[j.id].transport.provenance.fuel.priceThb, 43.54, 'the decision keeps the fuel value it used');
});

test('six jobs after verification: bands, charges, Goodyear owner override ฿3,300 with reason, toll not auto-billed', () => {
  let { s, id } = mapped();
  for (const [d, p] of Object.entries(PROPOSED)) { s = act(s, fuel(d, p, { proposed: true })); s = act(s, { type: 'verify_fuel_reference', date: d }); }
  const sheetOf = () => s.billingSheets.find((x) => x.id === id);
  for (const j of JOBS) {
    const jb = job(s, j[5]); const d = f.diagnoseRate(s, jb); assert.equal(d.kind, 'suggested', j[5]);
    if (j[5] === '6144') {
      assert.equal(d.amountThb, 3350);
      assert.throws(() => act(s, { type: 'sheet_apply_rate', sheetId: id, jobId: jb.id, mappingId: d.mappingId, amountThb: 3300, overrideReason: '', routeVehicleConfirmed: true, confirmOverwrite: false }), /FINANCE_OVERRIDE_REASON_REQUIRED/);
      s = act(s, { type: 'sheet_apply_rate', sheetId: id, jobId: jb.id, mappingId: d.mappingId, amountThb: 3300, overrideReason: 'Matches existing EES office billing sheet; Goodyear fuel-band interpretation requires contract confirmation.', routeVehicleConfirmed: true, confirmOverwrite: false });
    } else s = act(s, { type: 'sheet_apply_rate', sheetId: id, jobId: jb.id, mappingId: d.mappingId, amountThb: d.amountThb, overrideReason: '', routeVehicleConfirmed: true, confirmOverwrite: false });
  }
  const amounts = Object.fromEntries(JOBS.map((j) => [j[5], sheetOf().lines[job(s, j[5]).id].transport.amount]));
  assert.deepEqual(amounts, { 6424: 13110, 5838: 13110, 6956: 13110, 5817.1: 8880, 6144: 3300, 5913: 8325 });
  const g = sheetOf().lines[job(s, '6144').id].transport.provenance;
  assert.deepEqual([g.suggestedThb, g.appliedThb, g.bandLabel], [3350, 3300, 'Fuel at 44']);
  assert.match(g.overrideReason, /Matches existing EES office billing sheet/);
  const sum = f.sheetSummary(s, sheetOf());
  assert.equal(sum.transportSatang, 5983500, 'transport subtotal ฿59,835.00');
  assert.equal(sum.totalSatang, 5983500, 'the ฿320 toll receipt is NOT in the total until Finance bills it');
  assert.equal(job(s, '6424').adminReceipts.amounts.toll, 320, 'receipt preserved');
  const withToll = act(s, { type: 'sheet_set_extra', sheetId: id, jobId: job(s, '6424').id, kind: 'toll', value: { decision: 'bill', amount: 320 } });
  assert.equal(f.sheetSummary(withToll, withToll.billingSheets.find((x) => x.id === id)).totalSatang, 6015500, 'if billable: ฿60,155.00');
  // the Goodyear override is specific to WO 6144: another Goodyear job would still be suggested ฿3,350
  const calc = ev.fuelCalculation(s, sheetOf(), job(s, '6144'));
  assert.deepEqual([calc.state, calc.tableCharge, calc.applied], ['applied', 3350, 3300]); assert.ok(calc.overrideReason);
  // invoice agrees
  const doc = fromSheet.invoiceFromSheet(s, sheetOf(), fromSheet.previewProfileForSheet(sheetOf()).profile, '2026-11-05');
  assert.equal(doc.totals.subtotalSatang, 5983500);
});

test('fuel date summary: one row per distinct date with job count, status, band and review notes', () => {
  let { s, id } = mapped();
  const sheet = () => s.billingSheets.find((x) => x.id === id);
  const jobs = () => sheet().jobIds.map((i) => s.bookings.find((b) => b.id === i));
  let rows = ev.fuelDateSummary(s, sheet(), jobs());
  assert.deepEqual(rows.map((r) => [r.date, r.jobCount, r.status]), [['2026-09-15', 1, 'missing'], ['2026-09-23', 1, 'missing'], ['2026-10-26', 4, 'missing']]);
  s = act(s, fuel('2026-10-26', 43.54, { proposed: true }));
  rows = ev.fuelDateSummary(s, sheet(), jobs());
  const r = rows.find((x) => x.date === '2026-10-26');
  assert.equal(r.status, 'proposed'); assert.ok(r.bands.some((b) => /43.01-44.00/.test(b)) && r.bands.some((b) => /Fuel at 44/.test(b)));
  assert.ok(r.discrepancies.some((d) => /not yet verified/.test(d)));
  assert.equal(r.workOrders.length, 4);
});

test('evidence document, CSV, calculation view and owner-confirmation table are wired; no automatic fetching anywhere', () => {
  const stage = read('components/finance-trn-documents-stage.tsx');
  assert.match(stage, /id: "evidence"/); assert.match(stage, /export-evidence-csv/); assert.match(stage, /PRICING EVIDENCE \(INTERNAL\)/);
  assert.match(read('components/finance-billing-sheet-stage.tsx'), /view-fuel-calc/);
  assert.match(read('components/finance-rate-panel.tsx'), /data-testid="fuel-calculation"/);
  assert.match(read('components/finance-apl-price-setup.tsx'), /data-testid="route-confirmation"/);
  const panel = read('components/finance-fuel-prices-panel.tsx');
  assert.match(panel, /Historical Diesel B7 Prices/); assert.match(panel, /fuel-source-link/);
  for (const file of ['components/finance-fuel-prices-panel.tsx', 'components/finance-pricing-setup.tsx', 'components/finance-apl-price-setup.tsx', 'lib/finance-pricing-evidence.ts']) assert.doesNotMatch(read(file), /\bfetch\(|XMLHttpRequest|axios/, file);
});
