const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers/invoice-compare.cjs');
const view = h.lib('finance-workspace-view.ts');
const f = h.lib('finance-demo-centre.ts');
const invoice = h.lib('finance-invoice-from-sheet.ts');

test('invoice fitting uses the measured viewport; width, page and manual zoom preserve the original paper ratio', () => {
  assert.equal(view.invoiceDisplayWidth(1000, 700, 'width', 100), 960);
  const fitted = view.invoiceDisplayWidth(1000, 700, 'page', 100);
  assert.ok(fitted * 1056 / 816 <= 660);
  assert.ok(view.invoiceDisplayWidth(390, 600, 'page', 100) <= 350);
  assert.equal(view.invoiceDisplayWidth(1000, 700, 'zoom', 150), 1224);
  assert.equal(view.invoiceDisplayWidth(1000, 700, 'zoom', 1000), 3264);
});

test('an entered amount alone is never presented as verified pricing', () => {
  assert.equal(view.transportEvidenceState(null), 'missing');
  assert.equal(view.transportEvidenceState({ source: 'manual', amount: 3300 }), 'manual');
  assert.equal(view.transportEvidenceState({ source: 'schedule', amount: 3350 }), 'entered');
  assert.equal(view.transportEvidenceState({ source: 'schedule', amount: 3350, provenance: { contractReference: 'fixture' } }), 'verified');
  assert.equal(view.transportEvidenceState({ source: 'schedule', amount: 3300, overrideReason: 'Historical manual exception', provenance: {} }), 'manual');
});

test('WO6144 receipts remain evidence until each is explicitly billed; decisions and audit survive invoice output', () => {
  const receipts = { amounts: Object.fromEntries(f.ADMIN_RECEIPT_FIELDS.map(k => [k, k === 'parking' ? 60 : k === 'toll' ? 30 : null])), notes: 'Isolated fixture' };
  let s = f.linkDiaryWorkOrder(f.createEmptyOwnerState(), { id: 'v6-wo6144', client_id: 'v6-test', client_name: 'Isolated WO6144 fixture', booking_date: '2026-10-26', pickup: 'Fixture pickup', dropoff: 'Fixture delivery' }, '6144', 'admin', receipts);
  const act = a => { s = f.applyAction(s, a, 'finance'); };
  act({ type: 'sheet_create', clientId: 'v6-test' });
  const id = s.billingSheets.at(-1).id;
  act({ type: 'sheet_add_paper', sheetId: id, workOrder: '6144' });
  act({ type: 'sheet_set_transport', sheetId: id, jobId: 'v6-wo6144', transport: { amount: 3300, source: 'manual', overrideReason: 'Historical manual fixture' } });
  const sum = () => f.sheetSummary(s, s.billingSheets.find(g => g.id === id)).totalSatang;
  assert.equal(sum(), 330000, 'receipts alone are not billed');
  act({ type: 'sheet_set_extra', sheetId: id, jobId: 'v6-wo6144', kind: 'parking', value: { decision: 'bill', amount: 60 } });
  assert.equal(sum(), 336000);
  act({ type: 'sheet_set_extra', sheetId: id, jobId: 'v6-wo6144', kind: 'toll', value: { decision: 'bill', amount: 30 } });
  assert.equal(sum(), 339000);
  s = JSON.parse(JSON.stringify(s));
  const sheet = s.billingSheets.find(g => g.id === id);
  assert.equal(sheet.lines['v6-wo6144'].extras.toll.decision, 'bill');
  assert.equal(s.audit.filter(a => a.action === 'sheet_set_extra').length, 2);
  const doc = invoice.invoiceFromSheet(s, sheet, invoice.previewProfileForSheet(sheet).profile, '2026-11-09');
  assert.equal(doc.totals.subtotalSatang, 339000);
  assert.equal(doc.draft, true);
  assert.equal(s.bookings[0].adminReceipts.amounts.toll, 30);
});


test('default reading view caps wide monitors at a readable page and fits narrow screens', () => {
  assert.equal(view.invoiceDisplayWidth(1800, 700, 'auto', 100), 1000);
  assert.equal(view.invoiceDisplayWidth(390, 600, 'auto', 100), 350);
});
