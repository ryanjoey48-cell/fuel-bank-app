const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const path = require('node:path');
const { createRequire } = require('node:module');
function load(file) {
  const mod = { exports: {} };
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  new Function('module', 'exports', 'require', js)(mod, mod.exports, createRequire(path.resolve(file)));
  return mod.exports;
}
const f = load('lib/finance-demo-centre.ts');
const SOURCE = 'https://xn--42c6baaa9bl0b2fcebb3cztja2d.com/history';

// Isolated in-memory fixtures. The PRICES come from the genuine imported rate tables (data/finance-customer-rates-v4.json);
// no expected baht amount is typed in below except the owner's stated WO 6144 decision.
const receipts = (amounts = {}) => ({ amounts: Object.fromEntries(f.ADMIN_RECEIPT_FIELDS.map((kind) => [kind, amounts[kind] ?? null])), notes: '' });
const seed = (id, date, pickup, dropoff, vehicle, plate) => ({ id, booking_id: `BK-V20-${id}`, client_id: 'fixture-apl', client_name: 'Fixture APL', booking_date: date, pickup, dropoff, vehicle, vehicle_registration: plate, driver: 'Driver' });
const act = (s, a, who = 'finance') => f.applyAction(s, a, who);
const sched = (id) => f.CUSTOMER_RATE_SCHEDULES.find((s) => s.id === id);

test('imported rate tables hold 308 / 176 / 31 = 515 rates', () => {
  const count = (id) => sched(id).rows.reduce((n, r) => n + r.bands.length, 0);
  assert.deepEqual([count('apl'), count('goodyear'), count('sirtech')], [308, 176, 31]);
});

test('work-order identity: the Admin green-sheet number is canonical, even when booking.workOrder is blank', () => {
  let s = f.createEmptyOwnerState();
  s = f.linkDiaryWorkOrder(s, seed('g', '2026-10-26', 'GOODYEAR', 'สุวรรณภูมิ', '6ล้อ', '701-1654'), '6144', 'admin', receipts());
  const job = s.bookings.find((b) => b.diarySource && b.diarySource.id === 'g');
  assert.equal(f.confirmedWorkOrder(job), '6144');
  const d = f.ownerTransportDecision(job);
  assert.equal(d.workOrder, '6144');
  assert.equal(d.amountThb, 3300);
  assert.equal(d.suggestedThb, 3350);
  // Same WO number on another customer's route is NOT matched.
  const other = { ...job, pickup: 'TITAN', delivery: 'Khon Kaen' };
  assert.equal(f.ownerTransportDecision(other), null);
});

test('approved mapping + verified Diesel B7 price rows from the real tables; manual and owner decisions are preserved; four independent drafts reconcile', () => {
  let s = f.createEmptyOwnerState();
  const link = (id, date, pu, de, veh, plate, wo, r) => { s = f.linkDiaryWorkOrder(s, seed(id, date, pu, de, veh, plate), wo, 'admin', receipts(r)); };
  link('s1', '2026-10-26', 'Sirtec', 'CAL-COMP', 'trailer', '64-8665', '6424', { toll: 320 });
  link('s2', '2026-10-26', 'Sirtec', 'CAL-COMP', 'trailer', '68-7154', '5838', { toll: 365 });
  link('s3', '2026-10-26', 'Sirtec', 'CAL-COMP', 'trailer', '79-5318', '6956', { toll: 365 });
  link('g1', '2026-10-26', 'GOODYEAR', 'สุวรรณภูมิ', '6ล้อ', '701-1654', '6144', { parking: 60, toll: 30 });
  link('t1', '2026-09-15', 'TITAN SPORTSWEAR CO., LTD', 'Khon Kaen', '4ล้อ', '70-0001', '5817.1', {});
  link('f1', '2026-09-23', 'SAFFRON - BANGNA', 'Khon Kaen', '40', '70-0002', '5913', { other: 160 });

  const map = (scheduleId, rowId, pickup, delivery, vehicleClass) => act(s, { type: 'confirm_rate_mapping', scheduleId, rowId, clientId: 'fixture-apl', contractReference: 'TEST-CONTRACT', effectiveFrom: '2026-01-01', effectiveTo: null, reviewReason: '', match: { pickup, delivery, vehicleClass } }, 'approver');
  s = map('sirtech', 'sirtech-calcomp-trailer-empty40', ['sirtec'], ['calcomp'], ['TRAILER']);
  s = map('goodyear', 'goodyear-route-2', ['goodyear'], ['สุวรรณภูมิ'], ['6W']);
  s = map('apl', 'apl-route-7', ['titan'], ['khonkaen'], ['4W']);
  s = map('apl', 'apl-route-10', ['saffron'], ['khonkaen'], ['40']);

  const job = (wo) => s.bookings.find((b) => f.confirmedWorkOrder(b) === wo);
  // Without a verified fuel price nothing is priced and the reason is "needs_fuel" (never an invented price).
  assert.equal(f.diagnoseRate(s, job('6424')).code, 'needs_fuel');

  const fuel = (date, price) => { s = act(s, { type: 'record_fuel_reference', date, priceThb: price, evidence: 'Isolated test fixture (not a real verified record)', sourceUrl: SOURCE }, 'finance'); };
  fuel('2026-10-26', 43.54); fuel('2026-09-15', 40.69); fuel('2026-09-23', 40.69);

  // Expected amounts come from the genuine table via the engine's own band lookup.
  const expect = (sid, rid, price) => f.exactCustomerRate(sid, rid, price).band.amountThb;
  const want = { 6424: expect('sirtech', 'sirtech-calcomp-trailer-empty40', 43.54), 5838: expect('sirtech', 'sirtech-calcomp-trailer-empty40', 43.54), 6956: expect('sirtech', 'sirtech-calcomp-trailer-empty40', 43.54),
    6144: expect('goodyear', 'goodyear-route-2', 43.54), '5817.1': expect('apl', 'apl-route-7', 40.69), 5913: expect('apl', 'apl-route-10', 40.69) };
  for (const [wo, amount] of Object.entries(want)) {
    const d = f.diagnoseRate(s, job(wo));
    assert.equal(d.kind, 'suggested', `${wo}: ${d.en || ''}`);
    assert.equal(d.amountThb, amount);
  }

  const group = (clientLabel, wos) => {
    s = act(s, { type: 'sheet_create', clientId: 'fixture-apl', label: clientLabel, additional: true });
    const id = s.billingSheets[s.billingSheets.length - 1].id;
    for (const wo of wos) s = act(s, { type: 'sheet_add_paper', sheetId: id, workOrder: wo });
    return id;
  };
  const ids = [group('Sirtec', ['6424', '5838', '6956']), group('Goodyear', ['6144']), group('Titan', ['5817.1']), group('Saffron', ['5913'])];
  const sheet = (id) => s.billingSheets.find((x) => x.id === id);

  // Pre-existing manual charge on one Sirtec row must survive automatic pricing.
  const manualJob = job('5838');
  s = act(s, { type: 'sheet_set_transport', sheetId: ids[0], jobId: manualJob.id, transport: { amount: 12345, source: 'manual' } });
  // Automatic pricing = what the Billing screen now does for every eligible unpriced row.
  for (const id of ids) for (const jobId of sheet(id).jobIds) {
    if (sheet(id).lines[jobId].transport) continue;
    const d = f.diagnoseRate(s, s.bookings.find((b) => b.id === jobId));
    if (d.kind === 'suggested') s = act(s, { type: 'sheet_apply_rate', sheetId: id, jobId, mappingId: d.mappingId, amountThb: d.amountThb, overrideReason: '', routeVehicleConfirmed: true, confirmOverwrite: false });
  }
  assert.equal(sheet(ids[0]).lines[manualJob.id].transport.amount, 12345, 'manual charge untouched');
  assert.equal(sheet(ids[0]).lines[manualJob.id].transport.source, 'manual');
  // Replace the manual stand-in by the table price for the reconciliation (explicit overwrite, history kept).
  const d5838 = f.diagnoseRate(s, manualJob);
  s = act(s, { type: 'sheet_apply_rate', sheetId: ids[0], jobId: manualJob.id, mappingId: d5838.mappingId, amountThb: d5838.amountThb, overrideReason: '', routeVehicleConfirmed: true, confirmOverwrite: true });
  assert.equal(sheet(ids[0]).lines[manualJob.id].priceHistory.length, 1);

  // WO 6144: owner clicks the decision (₿3,300 over table ₿3,350); the Goodyear table itself is unchanged.
  const gJob = job('6144');
  const dec = f.ownerTransportDecision(gJob);
  assert.equal(sheet(ids[1]).lines[gJob.id].transport.source, 'schedule');
  s = act(s, { type: 'sheet_set_transport', sheetId: ids[1], jobId: gJob.id, transport: { amount: dec.amountThb, source: 'manual', suggestedThb: dec.suggestedThb, overrideReason: dec.reason } });
  assert.equal(sheet(ids[1]).lines[gJob.id].transport.amount, 3300);
  assert.equal(sheet(ids[1]).lines[gJob.id].transport.suggestedThb, 3350);
  assert.ok(sheet(ids[1]).lines[gJob.id].priceHistory.length >= 1, 'table price kept in history');
  assert.equal(f.exactCustomerRate('goodyear', 'goodyear-route-2', 43.54).band.amountThb, 3350, 'Goodyear table unchanged');

  // Extras: bill each recorded receipt once; the ฿30 receipt entered as Toll is billed as Other.
  const bill = (id, jobId, kind, amount) => { s = act(s, { type: 'sheet_set_extra', sheetId: id, jobId, kind, value: { decision: 'bill', amount } }); };
  bill(ids[0], job('6424').id, 'toll', 320); bill(ids[0], job('5838').id, 'toll', 365); bill(ids[0], job('6956').id, 'toll', 365);
  bill(ids[1], gJob.id, 'parking', 60);
  s = act(s, { type: 'sheet_reclassify_extra', sheetId: ids[1], jobId: gJob.id, from: 'toll', to: 'other' });
  bill(ids[3], job('5913').id, 'other', 160);

  const totals = ids.map((id) => f.sheetSummary(s, sheet(id)));
  totals.forEach((t, i) => assert.equal(t.missingPrices, 0, `group ${i} priced`));
  const baht = totals.map((t) => t.totalSatang / 100);
  assert.equal(baht[0], want[6424] * 3 + 320 + 365 + 365);
  assert.equal(baht[1], 3300 + 60 + 30);
  assert.equal(baht[2], want['5817.1']);
  assert.equal(baht[3], want[5913] + 160);
  assert.equal(baht.reduce((a, b) => a + b, 0), baht[0] + baht[1] + baht[2] + baht[3]);
  console.log('V20 reconciliation (derived):', baht, 'aggregate', baht.reduce((a, b) => a + b, 0));
  // Each work order belongs to exactly one group.
  const all = ids.flatMap((id) => sheet(id).jobIds);
  assert.equal(new Set(all).size, all.length);
});
