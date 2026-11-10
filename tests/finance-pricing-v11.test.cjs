const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const h = require('./helpers/invoice-compare.cjs');
// h.lib loads the real TS modules through one shared cache, so every module sees the same instances.
const f = h.lib('finance-demo-centre.ts');
const fromSheet = h.lib('finance-invoice-from-sheet.ts');

const SCHEDULES = f.CUSTOMER_RATE_SCHEDULES;
const apl = SCHEDULES.find((s) => s.id === 'apl');
const goodyear = SCHEDULES.find((s) => s.id === 'goodyear');
const sirtech = SCHEDULES.find((s) => s.id === 'sirtech');

// ---------- G1: import ----------
test('import: schedule coverage, unique ids, contiguous two-decimal bands with no gaps or overlaps', () => {
  assert.deepEqual(SCHEDULES.map((s) => [s.id, s.rows.length, s.rows.reduce((n, r) => n + r.bands.length, 0)]), [['goodyear', 8, 176], ['sirtech', 1, 31], ['apl', 14, 308]]);
  const ids = SCHEDULES.flatMap((s) => s.rows.map((r) => r.id));
  assert.equal(new Set(ids).size, ids.length, 'no duplicate rate rows');
  for (const schedule of SCHEDULES) {
    for (const row of schedule.rows) {
      const keys = row.bands.map((b) => b.label);
      assert.equal(new Set(keys).size, keys.length, `${row.id} unique bands`);
      row.bands.forEach((band, i) => {
        assert.ok(Number.isInteger(band.maxSatang) && Number.isInteger(band.amountThb) && band.amountThb > 0);
        if (i > 0) assert.equal(band.minSatang, row.bands[i - 1].maxSatang + 1, `${row.id} band ${i} follows the previous one (no gap/overlap)`);
        if (i > 0) assert.ok(band.amountThb >= row.bands[i - 1].amountThb || row.id === 'never', `${row.id} amounts never fall`);
      });
    }
  }
  assert.equal(apl.rows[0].bands[0].minSatang, 2901); assert.equal(apl.rows[0].bands.at(-1).maxSatang, 5100);
  assert.equal(sirtech.rows[0].bands[0].minSatang, 2901); assert.equal(sirtech.rows[0].bands.at(-1).maxSatang, 6000);
  assert.equal(goodyear.rows[0].bands[0].minSatang, null); assert.equal(goodyear.rows[0].bands[0].maxSatang, 3700); assert.equal(goodyear.rows[0].bands.at(-1).maxSatang, 5800);
});

test('import: brief examples for TRAX 4W/6W are exact', () => {
  const trax4 = apl.rows.find((r) => r.pickup.startsWith('TRAX') && r.vehicle === '4W');
  const trax6 = apl.rows.find((r) => r.pickup.startsWith('TRAX') && r.vehicle === '6W');
  const at = (row, fuel) => f.exactCustomerRate('apl', row.id, fuel).band.amountThb;
  assert.equal(at(trax4, 29.5), 11000); assert.equal(at(trax4, 40), 12100); assert.equal(at(trax4, 39.5), 12100); assert.equal(at(trax4, 43), 12430); assert.equal(at(trax4, 42.5), 12430);
  assert.equal(at(trax6, 30), 15000); assert.equal(at(trax6, 43), 16950);
});

test('import: Sirtech is a separate +115 schedule and Goodyear keeps its own 4W/6W bases', () => {
  const sir = (fuel) => f.exactCustomerRate('sirtech', sirtech.rows[0].id, fuel).band.amountThb;
  assert.equal(sir(30), 11500); assert.equal(sir(40), 12650); assert.equal(sir(50), 13800); assert.equal(sir(60), 14950);
  sirtech.rows[0].bands.forEach((b, i) => assert.equal(b.amountThb, 11500 + 115 * i));
  assert.equal(sirtech.rows[0].distanceKm, 214); assert.match(sirtech.rows[0].vehicle, /40/); assert.notEqual(sirtech.rows[0].vehicle, '4W'); assert.notEqual(sirtech.rows[0].vehicle, '6W');
  assert.equal(goodyear.rows[0].bands[0].amountThb, 1500); assert.equal(goodyear.rows[1].bands[0].amountThb, 3000);
  assert.ok(goodyear.rules.some((r) => /150/.test(r)) && goodyear.rules.some((r) => /200/.test(r)) && goodyear.rules.some((r) => /waiting/i.test(r)), 'footer parking / waiting conditions retained for review');
});

test('import: source anomalies are flagged, never corrected', () => {
  const dong = apl.rows.find((r) => r.pickup.startsWith('DONG TAI') && r.vehicle === '6W');
  assert.equal(dong.reviewFlags.length, 1); assert.match(dong.reviewFlags[0], /Manual approval/);
  assert.deepEqual(dong.bands.slice(0, 4).map((b) => b.amountThb), [15000, 15150, 15303, 15459]);
  assert.equal(dong.bands.at(-2).amountThb, 18693); assert.equal(dong.bands.at(-1).amountThb, 18694);
  assert.ok(goodyear.reviewNotes.some((n) => /Up to 37/.test(n)), 'Goodyear bracket-label interpretation is noted for approval');
});

test('import: every quoted amount equals the supplied PDF text (runs when the local PDF extraction is present)', { skip: !fs.existsSync(path.resolve('.ees-local/pricing-src/APL_Pricing_pdf.txt')) }, () => {
  const read = (name) => fs.readFileSync(path.resolve('.ees-local/pricing-src', name), 'utf8');
  const num = (x) => Number(x.replace(/,/g, ''));
  // APL
  const lines = read('APL_Pricing_pdf.txt').split('\n').filter((l) => !l.startsWith('==='));
  const merged = [];
  for (let i = 0; i < lines.length; i++) { let l = lines[i]; if (/\| (6W|40'H)$/.test(l) && /^[\d,]+ \|/.test(lines[i + 1] || '')) { l += ' | ' + lines[i + 1]; i++; } merged.push(l); }
  const pdf = new Map();
  for (const l of merged) { const p = l.split(' | '); if (p.length === 14 && /^[\d,]+$/.test(p[3])) { const key = p.slice(0, 3).join('|'); pdf.set(key, [...(pdf.get(key) || []), ...p.slice(3).map(num)]); } }
  assert.equal(pdf.size, 14);
  for (const row of apl.rows) assert.deepEqual(row.bands.map((b) => b.amountThb), pdf.get([row.pickup, row.delivery, row.vehicle].join('|')), row.id);
  // Sirtech
  const sir = read('EES_Sirtech_Pricing_pdf.txt').split('\n').filter((l) => /^[\d,]+( \| [\d,]+)+$/.test(l)).flatMap((l) => l.split(' | ').map(num));
  assert.deepEqual(sirtech.rows[0].bands.map((b) => b.amountThb), sir);
  // Goodyear
  const gy = read('APL_Goodyear_EES_Pricing_pdf.txt').split('\n').filter((l) => /^(4W|6W) \| /.test(l)).map((l) => { const p = l.split(' | '); return [p[0], p.slice(1).map(num)]; });
  goodyear.rows.forEach((row, i) => { assert.equal(gy[i][0], row.vehicle); assert.deepEqual(row.bands.map((b) => b.amountThb), [...gy[i][1], ...gy[i + 8][1]], row.id); });
});

// ---------- D7: boundaries ----------
test('boundaries: inclusive upper edge of each band, per schedule definition, and clear no-match outside', () => {
  const aplRow = apl.rows[0].id;
  assert.equal(f.exactCustomerRate('apl', aplRow, 30).band.label, '29.01–30.00');
  assert.equal(f.exactCustomerRate('apl', aplRow, 30.01).band.label, '30.01–31.00');
  assert.equal(f.exactCustomerRate('apl', aplRow, 40).band.label, '39.01–40.00');
  assert.equal(f.exactCustomerRate('apl', aplRow, 40.01).band.label, '40.01–41.00');
  assert.equal(f.exactCustomerRate('apl', aplRow, 42).band.label, '41.01–42.00');
  assert.equal(f.exactCustomerRate('apl', aplRow, 42.01).band.label, '42.01–43.00');
  assert.equal(f.exactCustomerRate('apl', aplRow, 43).band.label, '42.01–43.00');
  assert.equal(f.exactCustomerRate('apl', aplRow, 43.01).band.label, '43.01–44.00');
  assert.equal(f.exactCustomerRate('apl', aplRow, 50).band.label, '49.01–50.00');
  assert.equal(f.exactCustomerRate('apl', aplRow, 50.01).band.label, '50.01–51.00');
  assert.equal(f.exactCustomerRate('apl', aplRow, 29.01).band.amountThb, 11000);
  assert.throws(() => f.exactCustomerRate('apl', aplRow, 29), /FINANCE_RATE_NOT_FOUND/);
  assert.throws(() => f.exactCustomerRate('apl', aplRow, 51.01), /FINANCE_RATE_NOT_FOUND/);
  const g = goodyear.rows[0].id;
  assert.equal(f.exactCustomerRate('goodyear', g, 36.5).band.label, 'Up to 37');
  assert.equal(f.exactCustomerRate('goodyear', g, 37).band.label, 'Up to 37');
  assert.equal(f.exactCustomerRate('goodyear', g, 37.01).band.label, 'Fuel at 38');
  assert.equal(f.exactCustomerRate('goodyear', g, 40).band.label, 'Fuel at 40');
  assert.equal(f.exactCustomerRate('goodyear', g, 40.01).band.label, 'Fuel at 41');
  assert.equal(f.exactCustomerRate('goodyear', g, 58).band.label, 'Fuel at 58');
  assert.throws(() => f.exactCustomerRate('goodyear', g, 58.01), /FINANCE_RATE_NOT_FOUND/);
  const sir = sirtech.rows[0].id;
  assert.equal(f.exactCustomerRate('sirtech', sir, 50).band.amountThb, 13800);
  assert.equal(f.exactCustomerRate('sirtech', sir, 50.01).band.amountThb, 13915);
  assert.throws(() => f.exactCustomerRate('sirtech', sir, 60.01), /FINANCE_RATE_NOT_FOUND/);
});

// ---------- fixtures ----------
const receipts = (amounts = {}) => ({ amounts: Object.fromEntries(f.ADMIN_RECEIPT_FIELDS.map((kind) => [kind, amounts[kind] ?? null])), notes: '' });
const seed = (id, client, date) => ({ id, booking_id: `BK-FIXTURE-${id}`, client_id: `fixture-${client}`, client_name: `Fixture ${client}`, booking_date: date, pickup: 'GOODYEAR', dropoff: 'Suvarnabhumi Airport', vehicle_registration: `FX-${id}`, vehicle: '4W', driver: `Driver ${id}` });
const act = (s, action, actor = 'finance') => f.applyAction(s, action, actor);
function base() {
  let s = f.createEmptyOwnerState();
  s = f.linkDiaryWorkOrder(s, seed('a1', 'A', '2026-01-19'), 'FX-101', 'admin', receipts({ parking: 40 }));
  s = f.linkDiaryWorkOrder(s, seed('a2', 'A', '2026-01-20'), 'FX-102', 'admin', receipts());
  s = f.linkDiaryWorkOrder(s, seed('b1', 'B', '2026-01-19'), 'FX-201', 'admin', receipts());
  s = act(s, { type: 'sheet_create', clientId: 'fixture-A' });
  const id = s.billingSheets.at(-1).id;
  for (const wo of ['FX-101', 'FX-102']) s = act(s, { type: 'sheet_add_paper', sheetId: id, workOrder: wo });
  return s;
}
const sheetOf = (s) => s.billingSheets.at(-1);
const jobOf = (s, wo) => s.bookings.find((b) => f.confirmedWorkOrder(b) === wo);
const mapping = (extra = {}) => ({ type: 'confirm_rate_mapping', scheduleId: 'goodyear', rowId: 'goodyear-route-1', clientId: 'fixture-A', contractReference: 'Fixture approved contract', effectiveFrom: '2026-01-01', effectiveTo: null, reviewReason: '', ...extra });
const fuel = (date, price, extra = {}) => ({ type: 'record_fuel_reference', date, priceThb: price, evidence: `History page ${date} Diesel B7 (fixture)`, sourceUrl: f.DIESEL_B7_SOURCE_URL, ...extra });

// ---------- G2 / D6: fuel lookup rules ----------
test('fuel: no mapping / no fuel → explained "unavailable", never a fictional price', () => {
  let s = base(); const job = jobOf(s, 'FX-101');
  let d = f.diagnoseRate(s, job);
  assert.equal(d.kind, 'unavailable'); assert.equal(d.code, 'no_mapping'); assert.match(d.en, /review required/);
  s = act(s, mapping(), 'approver');
  d = f.diagnoseRate(s, jobOf(s, 'FX-101'));
  assert.equal(d.code, 'needs_fuel'); assert.match(d.en, /2026-01-19/);
  // fuel recorded for a DIFFERENT day never applies (no carry-forward)
  s = act(s, fuel('2026-01-20', 40.5));
  assert.equal(f.diagnoseRate(s, jobOf(s, 'FX-101')).code, 'needs_fuel');
  assert.equal(f.diagnoseRate(s, jobOf(s, 'FX-102')).kind, 'suggested');
});

test('fuel: reference is validated, role-gated, reusable and auditable', () => {
  let s = base();
  assert.throws(() => act(s, fuel('2026-01-19', 40.5), 'approver'), /DEMO_ROLE_REQUIRED/);
  assert.throws(() => act(s, fuel('2026-01-19', 0)), /FINANCE_FUEL_EVIDENCE_GATE/);
  assert.throws(() => act(s, fuel('2026-01-19', 40.555)), /FINANCE_FUEL_EVIDENCE_GATE/);
  assert.throws(() => act(s, fuel('2026-13-40', 40.5)), /FINANCE_FUEL_EVIDENCE_GATE/);
  assert.throws(() => act(s, fuel('2099-01-01', 40.5)), /FINANCE_FUEL_EVIDENCE_GATE/, 'future dates are not historical');
  assert.throws(() => act(s, fuel('2026-01-19', 40.5, { evidence: 'x' })), /FINANCE_FUEL_EVIDENCE_GATE/);
  assert.throws(() => act(s, fuel('2026-01-19', 40.5, { sourceUrl: 'https://example.com' })), /FINANCE_FUEL_EVIDENCE_GATE/);
  s = act(s, fuel('2026-01-19', 40.5));
  const ref = s.fuelReferences[0];
  assert.deepEqual([ref.date, ref.product, ref.region, ref.priceThb, ref.method, ref.reviewer, ref.supersededAt], ['2026-01-19', 'Diesel B7', 'Bangkok', 40.5, 'manual', 'finance', null]);
  assert.equal(ref.sourceUrl, f.DIESEL_B7_SOURCE_URL); assert.ok(ref.retrievedAt);
  assert.throws(() => act(s, fuel('2026-01-19', 40.5)), /FINANCE_FUEL_DUPLICATE/);
  assert.throws(() => act(s, fuel('2026-01-19', 41.5)), /FINANCE_FUEL_REVISION_REASON_REQUIRED/);
  const revised = act(s, fuel('2026-01-19', 41.5, { revisionReason: 'Source page corrected the value' }));
  assert.equal(revised.fuelReferences.length, 2); assert.ok(revised.fuelReferences[0].supersededAt);
  assert.equal(f.resolveJobFuel(revised, jobOf(revised, 'FX-101')).priceThb, 41.5);
  assert.equal(s.fuelReferences[0].supersededAt, null, 'previous state object was not mutated');
  assert.match(revised.audit.at(-1).detail, /replaces THB 40.50/);
});

// ---------- D / G3: selection ----------
test('selection: contract, date window, route ambiguity and out-of-band are explicit; other customers never match', () => {
  let s = act(base(), mapping(), 'approver');
  s = act(s, fuel('2026-01-19', 42.54)); s = act(s, fuel('2026-01-20', 70));
  const d = f.diagnoseRate(s, jobOf(s, 'FX-101'));
  assert.equal(d.kind, 'suggested'); assert.equal(d.amountThb, 1590); assert.equal(d.bandLabel, 'Fuel at 43'); assert.equal(d.vehicle, '4W'); assert.equal(d.sourcePage, 1);
  assert.equal(f.diagnoseRate(s, jobOf(s, 'FX-102')).code, 'out_of_band');
  assert.equal(f.diagnoseRate(s, jobOf(s, 'FX-201')).code, 'no_mapping', 'customer B has no approved mapping');
  // expired window
  let expired = act(base(), mapping({ effectiveTo: '2026-01-18' }), 'approver');
  assert.equal(f.diagnoseRate(expired, jobOf(expired, 'FX-101')).code, 'mapping_not_effective');
  // two approved routes → manual choice required (an airport job never auto-matches every Suvarnabhumi row)
  s = act(s, fuel('2026-01-20', 42.54, { revisionReason: 'Corrected to the day value (fixture)' }));
  s = act(s, mapping({ rowId: 'goodyear-route-3', contractReference: 'Fixture second route' }), 'approver');
  const amb = f.diagnoseRate(s, jobOf(s, 'FX-101'));
  assert.equal(amb.code, 'ambiguous'); assert.equal(amb.candidates.length, 2);
  assert.equal(f.sheetRateSuggestion(s, jobOf(s, 'FX-101')).kind, 'ambiguous');
});

// ---------- D4 / D5: apply, overwrite, override, history ----------
function readyToApply() {
  let s = act(base(), mapping(), 'approver');
  s = act(s, fuel('2026-01-19', 42.54)); s = act(s, fuel('2026-01-20', 36.5));
  return s;
}
const apply = (s, wo, extra = {}) => act(s, { type: 'sheet_apply_rate', sheetId: sheetOf(s).id, jobId: jobOf(s, wo).id, mappingId: s.rateMappings[0].id, amountThb: extra.amountThb ?? f.diagnoseRate(s, jobOf(s, wo)).amountThb, overrideReason: '', routeVehicleConfirmed: true, confirmOverwrite: false, ...extra });

test('apply: the exact quoted charge is written with full provenance; totals recalc; admin receipts untouched', () => {
  let s = readyToApply();
  assert.throws(() => apply(s, 'FX-101', { routeVehicleConfirmed: false }), /FINANCE_ROUTE_CONFIRM_REQUIRED/);
  s = apply(s, 'FX-101');
  const line = sheetOf(s).lines[jobOf(s, 'FX-101').id].transport;
  assert.equal(line.amount, 1590); assert.equal(line.source, 'schedule');
  const p = line.provenance;
  assert.deepEqual([p.jobDate, p.client, p.workOrder, p.vehicle, p.bandLabel, p.suggestedThb, p.appliedThb, p.overrideReason, p.decidedBy], ['2026-01-19', 'Fixture A', 'FX-101', '4W', 'Fuel at 43', 1590, 1590, null, 'finance']);
  assert.deepEqual([p.fuel.date, p.fuel.priceThb, p.fuel.product, p.fuel.region, p.fuel.method], ['2026-01-19', 42.54, 'Diesel B7', 'Bangkok', 'manual']);
  assert.equal(p.scheduleId, 'goodyear'); assert.equal(p.sourceSha256.length, 64); assert.equal(p.sourcePage, 1); assert.match(p.contractReference, /Fixture approved/);
  assert.equal(jobOf(s, 'FX-101').adminReceipts.amounts.parking, 40, 'Admin receipts preserved');
  const row = f.sheetRowTotals(s, sheetOf(s), jobOf(s, 'FX-101').id);
  assert.equal(row.transportSatang, 159000); assert.equal(row.totalSatang, 159000, 'parking receipt not added until Finance bills it');
  s = apply(s, 'FX-102'); // fuel 36.50 → "Up to 37" band
  assert.equal(sheetOf(s).lines[jobOf(s, 'FX-102').id].transport.amount, 1500);
  assert.equal(f.sheetSummary(s, sheetOf(s)).transportSatang, 159000 + 150000, 'customer batch total follows');
});

test('apply: overwrite needs confirmation, override needs a reason, and every earlier price stays in history', () => {
  let s = readyToApply();
  const id = sheetOf(s).id; const job = jobOf(s, 'FX-101');
  s = act(s, { type: 'sheet_set_transport', sheetId: id, jobId: job.id, transport: { amount: 1234, source: 'manual' } });
  assert.throws(() => apply(s, 'FX-101'), /FINANCE_PRICE_OVERWRITE_CONFIRM/, 'a manually typed price is not silently replaced');
  assert.equal(sheetOf(s).lines[job.id].transport.amount, 1234);
  s = apply(s, 'FX-101', { confirmOverwrite: true });
  assert.equal(sheetOf(s).lines[job.id].priceHistory.length, 1); assert.equal(sheetOf(s).lines[job.id].priceHistory[0].transport.amount, 1234);
  assert.throws(() => apply(s, 'FX-101', { amountThb: 1700, confirmOverwrite: true }), /FINANCE_OVERRIDE_REASON_REQUIRED/);
  const over = apply(s, 'FX-101', { amountThb: 1700, confirmOverwrite: true, overrideReason: 'Customer agreed a special rate' });
  const t = sheetOf(over).lines[job.id].transport;
  assert.equal(t.amount, 1700); assert.equal(t.source, 'manual'); assert.equal(t.provenance.suggestedThb, 1590); assert.equal(t.provenance.appliedThb, 1700); assert.match(t.provenance.overrideReason, /special rate/);
  assert.equal(sheetOf(over).lines[job.id].priceHistory.length, 2);
  // typing over a rate-derived price in the grid also requires a reason
  assert.throws(() => act(s, { type: 'sheet_set_transport', sheetId: id, jobId: job.id, transport: { amount: 1800, source: 'manual' } }), /FINANCE_OVERRIDE_REASON_REQUIRED/);
  const typed = act(s, { type: 'sheet_set_transport', sheetId: id, jobId: job.id, transport: { amount: 1800, source: 'manual', overrideReason: 'Agreed by phone with customer' } });
  assert.equal(sheetOf(typed).lines[job.id].transport.provenance.overrideReason, 'Agreed by phone with customer');
  assert.match(typed.audit.at(-1).detail, /override reason/);
});

test('history: revising a fuel value or schedule later never reprices a saved line', () => {
  let s = apply(readyToApply(), 'FX-101');
  const before = JSON.stringify(sheetOf(s).lines[jobOf(s, 'FX-101').id].transport);
  s = act(s, fuel('2026-01-19', 55, { revisionReason: 'Website revised this day (fixture)' }));
  assert.equal(JSON.stringify(sheetOf(s).lines[jobOf(s, 'FX-101').id].transport), before);
  assert.equal(f.diagnoseRate(s, jobOf(s, 'FX-101')).amountThb, 1770, 're-evaluation shows the new suggestion without applying it');
  const round = JSON.parse(JSON.stringify(s));
  assert.equal(round.billingSheets.at(-1).lines[jobOf(round, 'FX-101').id].transport.provenance.fuel.priceThb, 42.54);
});

// ---------- E: invoice ----------
test('invoice: the confirmed amount, fuel rate and totals flow to the EES invoice draft; Parking/OT only when Finance bills them', () => {
  let s = apply(readyToApply(), 'FX-101');
  s = apply(s, 'FX-102');
  const id = sheetOf(s).id; const job = jobOf(s, 'FX-101');
  s = act(s, { type: 'sheet_set_extra', sheetId: id, jobId: job.id, kind: 'parking', value: { decision: 'bill', amount: 40 } });
  const profile = fromSheet.previewProfileForSheet(sheetOf(s)).profile;
  const doc = fromSheet.invoiceFromSheet(s, sheetOf(s), profile, '2026-11-05');
  const trips = doc.lines.filter((l) => l.kind === 'trip');
  assert.equal(trips.length, 2);
  assert.deepEqual(trips.map((l) => l.amountSatang), [159000, 150000]);
  assert.deepEqual(trips.map((l) => l.fuelRate), [42.54, 36.5]);
  assert.equal(trips[0].parkingSatang, 4000);
  assert.equal(doc.totals.subtotalSatang, 159000 + 150000 + 4000);
  assert.equal(doc.draft, true);
  assert.equal(doc.totals.subtotalSatang, f.sheetSummary(s, sheetOf(s)).totalSatang, 'invoice gross equals the saved Finance sheet total');
});

test('invoice: an override keeps the fuel rate shown and the invoice uses the applied amount', () => {
  let s = apply(readyToApply(), 'FX-101', { amountThb: 1700, overrideReason: 'Special agreed rate (fixture)' });
  const profile = fromSheet.previewProfileForSheet(sheetOf(s)).profile;
  const doc = fromSheet.invoiceFromSheet(s, sheetOf(s), profile, '2026-11-05');
  assert.equal(doc.lines.find((l) => l.kind === 'trip').amountSatang, 170000);
  assert.equal(doc.lines.find((l) => l.kind === 'trip').fuelRate, 42.54);
});

test('safety: pricing never touches MASS data or other customers; the source PDFs stay reachable only through a fixed whitelist', () => {
  const route = fs.readFileSync(path.resolve('app/api/finance-pricing-source/[id]/route.ts'), 'utf8');
  assert.match(route, /SOURCES: Record<string, string>/); assert.doesNotMatch(route, /params.*readFile|join\([^)]*id\)/);
  const s = act(readyToApply(), mapping({ clientId: 'fixture-B', contractReference: 'Fixture B contract' }), 'approver');
  assert.equal(f.diagnoseRate(s, jobOf(s, 'FX-101')).kind, 'suggested');
  assert.equal(s.rateMappings.filter((m) => m.clientId === 'fixture-B').length, 1);
});

test('Finance Records keep the pricing provenance and earlier prices for every work order', () => {
  const records = h.lib('finance-records.ts');
  let s = readyToApply();
  const job = jobOf(s, 'FX-101');
  s = act(s, { type: 'sheet_set_transport', sheetId: sheetOf(s).id, jobId: job.id, transport: { amount: 1234, source: 'manual' } });
  s = apply(s, 'FX-101', { confirmOverwrite: true });
  const detail = records.workOrderDetail(s, job.id);
  assert.equal(detail.transport.satang, 159000);
  assert.equal(detail.transport.provenance.fuel.priceThb, 42.54); assert.equal(detail.transport.provenance.bandLabel, 'Fuel at 43');
  assert.equal(detail.transport.history.length, 1); assert.equal(detail.transport.history[0].transport.amount, 1234);
});
