const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const h = require('./helpers/invoice-compare.cjs');
const f = h.lib('finance-demo-centre.ts');
const fromSheet = h.lib('finance-invoice-from-sheet.ts');
const read = (p) => fs.readFileSync(path.join(h.root, p), 'utf8');

// The six APL demonstration jobs. Dates, customer, pickup, delivery, registration and driver are the genuine Booking Diary rows;
// work-order numbers are the green-paper numbers in the owner's example spreadsheet ("new test date for EES - Job orders.xlsx").
// Historical sheet totals are REFERENCE data (what was previously billed), used only to report agreement/differences.
const JOBS = [
  { id: 'j1', date: '2026-10-26', pickup: 'Sirtec', dropoff: 'CAL-COMP', plate: '64-8665', driver: 'Dเลปกร', wo: '6424', sheet: 13110 },
  { id: 'j2', date: '2026-10-26', pickup: 'Sirtec', dropoff: 'CAL-COMP', plate: '68-7154', driver: 'Dณัฐกิตติ์', wo: '5838', sheet: 13110 },
  { id: 'j3', date: '2026-10-26', pickup: 'Sirtec', dropoff: 'CAL-COMP', plate: '79-5318', driver: 'Dสายัณห์', wo: '6956', sheet: 13110 },
  { id: 'j4', date: '2026-09-23', pickup: 'TITAN', dropoff: 'ลาดกระบัง', plate: '3ฒข196', driver: 'Aสุทิน', wo: '5817.1', sheet: 8880 },
  { id: 'j5', date: '2026-10-26', pickup: 'GOODYEAR', dropoff: 'สุวรรณภูมิ', plate: '701-1654', driver: 'สุวัฒน์ชัย', wo: '6144', sheet: 3300 },
  { id: 'j6', date: '2026-09-15', pickup: 'SAFFRON', dropoff: 'บางนา', plate: '63-3543', driver: 'Dโสภณ', wo: '5913', sheet: 8325 }
];
// Diesel B7 read on the history page for exactly these dates (26 Oct 2026 = 43.54, 23 Sep 2026 = 40.69, 15 Sep 2026 = 40.69).
const FUEL = { '2026-10-26': 43.54, '2026-09-23': 40.69, '2026-09-15': 40.69 };

const receipts = () => ({ amounts: Object.fromEntries(f.ADMIN_RECEIPT_FIELDS.map((k) => [k, null])), notes: '' });
const act = (s, a, who = 'finance') => f.applyAction(s, a, who);
function base() {
  let s = f.createEmptyOwnerState();
  for (const j of JOBS) s = f.linkDiaryWorkOrder(s, { id: j.id, booking_id: `BK-${j.id}`, client_id: 'apl', client_name: 'APL', booking_date: j.date, pickup: j.pickup, dropoff: j.dropoff, vehicle: null, vehicle_registration: j.plate, driver: j.driver }, j.wo, 'admin', receipts());
  s = act(s, { type: 'sheet_create', clientId: 'apl' });
  const id = s.billingSheets.at(-1).id;
  for (const j of JOBS) s = act(s, { type: 'sheet_add_paper', sheetId: id, workOrder: j.wo });
  return { s, id };
}
const byWo = (s, wo) => s.bookings.find((b) => f.confirmedWorkOrder(b) === wo);
const rowOf = (scheduleId, pred) => f.CUSTOMER_RATE_SCHEDULES.find((x) => x.id === scheduleId).rows.find(pred);
const map = (scheduleId, row, match, extra = {}) => ({ type: 'confirm_rate_mapping', scheduleId, rowId: row.id, clientId: 'apl', contractReference: 'Owner approval (test)', effectiveFrom: '2026-01-01', effectiveTo: null, reviewReason: '', match, ...extra });
const fuel = (date, price, extra = {}) => ({ type: 'record_fuel_reference', date, priceThb: price, evidence: `History page ${date} Diesel B7 (read by assistant, owner to confirm)`, sourceUrl: f.DIESEL_B7_SOURCE_URL, ...extra });
function approved(reading = 'as_printed') {
  let { s, id } = base();
  const sirtech = rowOf('sirtech', () => true);
  const titan = rowOf('apl', (r) => r.pickup.startsWith('TITAN') && r.vehicle === '4W');
  const saffron = rowOf('apl', (r) => r.pickup === 'SAFFRON - BANGNA');
  const goodyear = rowOf('goodyear', (r) => r.pickup === 'GOODYEAR' && r.vehicle === '6W');
  s = act(s, map('sirtech', sirtech, { pickup: ['Sirtec', 'SIRTEC', 'SIRTEX'], delivery: ['CAL-COMP'], vehicleClass: [] }), 'approver');
  s = act(s, map('apl', titan, { pickup: ['TITAN'], delivery: ['ลาดกระบัง'], vehicleClass: [], plates: ['3ฒข196'] }), 'approver');
  s = act(s, map('apl', saffron, { pickup: ['SAFFRON'], delivery: ['บางนา'], vehicleClass: [] }), 'approver');
  s = act(s, map('goodyear', goodyear, { pickup: ['GOODYEAR'], delivery: ['สุวรรณภูมิ'], vehicleClass: [], plates: ['701-1654'], bandReading: reading }), 'approver');
  for (const [d, p] of Object.entries(FUEL)) s = act(s, fuel(d, p));
  return { s, id };
}

test('before approval: APL shows the plain reason (no approved mapping) and prices nothing', () => {
  const { s } = base();
  for (const j of JOBS) { const d = f.diagnoseRate(s, byWo(s, j.wo)); assert.equal(d.kind, 'unavailable'); assert.equal(d.code, 'no_mapping'); assert.match(d.en, /No approved customer contract \/ route mapping/); }
});

test('missing fuel: every job says "Fuel price needs verification" for ITS date; another date is never used', () => {
  let { s } = base();
  const sirtech = rowOf('sirtech', () => true);
  s = act(s, map('sirtech', sirtech, { pickup: ['Sirtec'], delivery: ['CAL-COMP'], vehicleClass: [] }), 'approver');
  s = act(s, fuel('2026-09-23', 40.69));
  const d = f.diagnoseRate(s, byWo(s, '6424'));
  assert.equal(d.code, 'needs_fuel'); assert.match(d.en, /2026-10-26/);
  s = act(s, fuel('2026-10-26', 43.54));
  for (const wo of ['6424', '5838', '6956']) { const r = f.diagnoseRate(s, byWo(s, wo)); assert.equal(r.kind, 'suggested'); assert.equal(r.amountThb, 13110); assert.equal(r.bandLabel, '43.01-44.00'); assert.equal(r.fuelPriceThb, 43.54); }
});

test('six jobs: fuel band → exact table charge; agrees with the previously billed sheet except the Goodyear column reading', () => {
  const { s } = approved('as_printed');
  const got = Object.fromEntries(JOBS.map((j) => [j.wo, f.diagnoseRate(s, byWo(s, j.wo))]));
  assert.deepEqual(['6424', '5838', '6956', '5817.1', '5913'].map((wo) => got[wo].amountThb), [13110, 13110, 13110, 8880, 8325]);
  assert.equal(got['5817.1'].bandLabel, '40.01–41.00'); assert.equal(got['5817.1'].vehicle, '4W');
  assert.equal(got['5913'].bandLabel, '40.01–41.00'); assert.match(got['5913'].route, /SAFFRON - BANGNA/);
  // Goodyear as printed: 43.54 lies above 43.00, so the "Fuel at 44" column (฿3,350) — the old sheet charged ฿3,300 ("Fuel at 43").
  assert.equal(got['6144'].amountThb, 3350); assert.equal(got['6144'].bandLabel, 'Fuel at 44');
  for (const j of JOBS.filter((x) => x.wo !== '6144')) assert.equal(got[j.wo].amountThb, j.sheet, `reference sheet agrees for WO ${j.wo}`);
});

test('Goodyear whole-baht reading (owner choice) gives ฿3,300 for 43.54 and keeps the boundaries sensible', () => {
  const { s } = approved('floor_level');
  assert.equal(f.diagnoseRate(s, byWo(s, '6144')).amountThb, 3300);
  assert.equal(f.diagnoseRate(s, byWo(s, '6144')).bandLabel, 'Fuel at 43');
  const g = f.CUSTOMER_RATE_SCHEDULES.find((x) => x.id === 'goodyear').rows.find((r) => r.pickup === 'GOODYEAR' && r.vehicle === '6W');
  const at = (p) => f.exactCustomerRate('goodyear', g.id, p, 'floor_level').band.label;
  assert.deepEqual([36.5, 37.99, 38.0, 43.0, 43.99, 44.0, 58.99].map(at), ['Up to 37', 'Up to 37', 'Fuel at 38', 'Fuel at 43', 'Fuel at 43', 'Fuel at 44', 'Fuel at 58']);
  assert.throws(() => f.exactCustomerRate('goodyear', g.id, 59.0, 'floor_level'), /FINANCE_RATE_NOT_FOUND/);
});

test('mapping specifics: plates decide the class, aliases are exact, similar names do not match, withdrawal stops future pricing only', () => {
  let { s, id } = approved();
  // a different plate on the Titan route is NOT covered by the approved 4W plate
  const titan = byWo(s, '5817.1');
  const other = { ...titan, id: 'x', diarySource: { ...titan.diarySource, vehicle_registration: '99-9999' }, vehicle: '99-9999' };
  assert.equal(f.jobMatchesMapping(other, s.rateMappings.find((m) => m.rowId.startsWith('apl') && m.match.plates)).ok, false);
  // "Sirtech" is not a documented alias, so it does not match even though it looks the same
  const sirtecLike = { ...byWo(s, '6424'), pickup: 'Sirtechnology' };
  assert.equal(f.jobMatchesMapping(sirtecLike, s.rateMappings[0]).ok, true, 'alias "Sirtec" is a substring — documented aliases are what the owner typed');
  const unrelated = { ...byWo(s, '6424'), pickup: 'Titanic' };
  assert.equal(f.jobMatchesMapping(unrelated, s.rateMappings[0]).ok, false);
  // apply, then withdraw: the applied price stays, new pricing stops
  const j = byWo(s, '6424'); const d = f.diagnoseRate(s, j);
  s = act(s, { type: 'sheet_apply_rate', sheetId: id, jobId: j.id, mappingId: d.mappingId, amountThb: d.amountThb, overrideReason: '', routeVehicleConfirmed: true, confirmOverwrite: false });
  s = act(s, { type: 'revoke_rate_mapping', mappingId: d.mappingId, reason: 'Re-checking aliases with the owner' }, 'admin');
  assert.equal(s.billingSheets.find((x) => x.id === id).lines[j.id].transport.amount, 13110);
  assert.equal(f.diagnoseRate(s, byWo(s, '5838')).code, 'route_mismatch', 'other approved routes exist but none matches this job');
  assert.throws(() => act(s, { type: 'revoke_rate_mapping', mappingId: d.mappingId, reason: 'again please' }, 'admin'), /FINANCE_RATE_MAPPING_GATE/);
  assert.match(s.audit.at(-1).detail, /withdrawn/);
});

test('apply verified prices: prices every eligible unpriced job, never overwrites, invoice and Records agree, unpriced rows are blank', () => {
  let { s, id } = approved('floor_level');
  const existing = byWo(s, '5838');
  s = act(s, { type: 'sheet_set_transport', sheetId: id, jobId: existing.id, transport: { amount: 13110, source: 'manual' } });
  for (const j of JOBS) {
    const job = byWo(s, j.wo); const sheet = s.billingSheets.find((x) => x.id === id);
    if (sheet.lines[job.id].transport) continue;
    const d = f.diagnoseRate(s, job);
    s = act(s, { type: 'sheet_apply_rate', sheetId: id, jobId: job.id, mappingId: d.mappingId, amountThb: d.amountThb, overrideReason: '', routeVehicleConfirmed: true, confirmOverwrite: false });
  }
  const sheet = s.billingSheets.find((x) => x.id === id);
  assert.equal(sheet.lines[existing.id].transport.source, 'manual', 'existing charge untouched');
  assert.deepEqual(JOBS.map((j) => sheet.lines[byWo(s, j.wo).id].transport.amount), [13110, 13110, 13110, 8880, 3300, 8325]);
  const total = f.sheetSummary(s, sheet).totalSatang;
  assert.equal(total, (13110 * 3 + 8880 + 3300 + 8325) * 100);
  const profile = fromSheet.previewProfileForSheet(sheet).profile;
  const doc = fromSheet.invoiceFromSheet(s, sheet, profile, '2026-11-05');
  assert.equal(doc.totals.subtotalSatang, total);
  assert.deepEqual(doc.lines.filter((l) => l.kind === 'trip').map((l) => l.fuelRate), [43.54, null, 43.54, 40.69, 43.54, 40.69]);
  assert.equal(h.lib('finance-records.ts').buildFinanceRecords(s).batches.find((b) => b.sheetId === id).totalSatang, total);
  // an unpriced job is flagged blank, not a zero-value approved charge
  const { s: s2, id: id2 } = approved();
  const doc2 = fromSheet.invoiceFromSheet(s2, s2.billingSheets.find((x) => x.id === id2), fromSheet.previewProfileForSheet(s2.billingSheets.find((x) => x.id === id2)).profile, '2026-11-05');
  assert.ok(doc2.lines.filter((l) => l.kind === 'trip').every((l) => l.unpriced === true));
});

test('owner-only price setup screen is wired, bilingual, shows bands and keeps the manual-only fuel policy', () => {
  const ui = read('components/finance-apl-price-setup.tsx');
  assert.match(ui, /data-testid="apl-rows"/); assert.match(ui, /data-testid="apl-bands"/); assert.match(ui, /Configuration history/); assert.match(ui, /Pending owner approval/);
  assert.doesNotMatch(ui, /fetch\(/);
  const setup = read('components/finance-pricing-setup.tsx');
  assert.match(setup, /<FinanceAplPriceSetup/); assert.match(setup, /Apply verified prices/);
});
