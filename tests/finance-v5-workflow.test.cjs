const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/invoice-compare.cjs');
const f = h.lib('finance-demo-centre.ts');
const view = h.lib('finance-intake-view.ts');
const invoice = h.lib('finance-invoice-from-sheet.ts');

test('Bangkok date presets handle weeks, leap years and year boundaries without changing the default range', () => {
  assert.deepEqual(view.intakeDateRange('today', '2026-11-09'), { from: '2026-11-09', to: '2026-11-09' });
  assert.deepEqual(view.intakeDateRange('week', '2026-11-08'), { from: '2026-11-02', to: '2026-11-08' });
  assert.deepEqual(view.intakeDateRange('month', '2024-02-20'), { from: '2024-02-01', to: '2024-02-29' });
  assert.deepEqual(view.intakeDateRange('lastMonth', '2026-01-09'), { from: '2025-12-01', to: '2025-12-31' });
});

test('intake search uses customer, route, registration, WO and customer job reference consistently', () => {
  const row = { client_name: 'APL', booking_date: '2026-10-26', pickup: 'Sirtec', dropoff: 'Calcomp', vehicle_registration: '64-8665', driver: 'Fixture driver' };
  for (const q of ['apl', 'CALCOMP', '64-8665', '6424', 'REF-1', '26/10/2026']) assert.equal(view.matchesIntakeSearch(row, q, '6424', 'REF-1'), true);
  assert.equal(view.matchesIntakeSearch(row, 'unrelated', '6424', 'REF-1'), false);
});

test('exact owner APL reconciliation stays 23,110 transport + 1,050 toll = 24,160 across grouping, invoice and reload', () => {
  let s = f.createEmptyOwnerState();
  const values = [['6424', 13110, 320], ['5838', 5000, 365], ['6956', 5000, 365]];
  for (const [wo, , toll] of values) {
    s = f.linkDiaryWorkOrder(s, { id: `v5-${wo}`, booking_id: `FIXTURE-${wo}`, client_id: 'v5-apl', client_name: 'APL isolated fixture', booking_date: '2026-10-26', pickup: 'Fixture pickup', dropoff: 'Fixture delivery', driver: 'Fixture driver' }, wo, 'admin', { amounts: Object.fromEntries(f.ADMIN_RECEIPT_FIELDS.map(k => [k, k === 'toll' ? toll : null])), notes: 'Isolated fixture only' });
  }
  const act = (a) => { s = f.applyAction(s, a, 'finance'); };
  act({ type: 'sheet_create', clientId: 'v5-apl' });
  const id = s.billingSheets.at(-1).id;
  for (const [wo, amount, toll] of values) {
    act({ type: 'sheet_add_paper', sheetId: id, workOrder: wo });
    const jobId = s.bookings.find(j => f.confirmedWorkOrder(j) === wo).id;
    act({ type: 'sheet_set_transport', sheetId: id, jobId, transport: { amount, source: 'manual', overrideReason: 'Owner specified historical manual fixture; not verified contract pricing' } });
    act({ type: 'sheet_set_extra', sheetId: id, jobId, kind: 'toll', value: { decision: 'bill', amount: toll } });
  }
  const original = s.billingSheets.find(x => x.id === id);
  const trn = f.sheetTrnLabel(original);
  const sum = f.sheetSummary(s, original);
  assert.deepEqual([sum.transportSatang, sum.approvedExtrasSatang, sum.totalSatang], [2311000, 105000, 2416000]);
  act({ type: 'sheet_move_paper', sheetId: id, jobId: original.jobIds[2], toIndex: 0 });
  s = JSON.parse(JSON.stringify(s));
  const sheet = s.billingSheets.find(x => x.id === id);
  assert.equal(f.sheetTrnLabel(sheet), trn);
  assert.equal(f.sheetSummary(s, sheet).totalSatang, 2416000);
  const doc = invoice.invoiceFromSheet(s, sheet, invoice.previewProfileForSheet(sheet).profile, '2026-11-09');
  assert.equal(doc.totals.subtotalSatang, 2416000);
  assert.equal(doc.draft, true);
  act({ type: 'sheet_create', clientId: 'v5-apl', additional: true });
  assert.throws(() => f.applyAction(s, { type: 'sheet_add_paper', sheetId: s.billingSheets.at(-1).id, workOrder: '6424' }, 'finance'), /FINANCE_WO_IN_OTHER_SHEET/);
  assert.equal(f.sheetSummary(s, s.billingSheets.find(x => x.id === id)).totalSatang, 2416000);
});
