const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const h = require('./helpers/invoice-compare.cjs');
const f = h.lib('finance-demo-centre.ts');
const fromSheet = h.lib('finance-invoice-from-sheet.ts');
const read = (p) => fs.readFileSync(path.join(h.root, p), 'utf8');

const receipts = (a = {}) => ({ amounts: Object.fromEntries(f.ADMIN_RECEIPT_FIELDS.map((k) => [k, a[k] ?? null])), notes: '' });
const seed = (id, date) => ({ id, booking_id: `BK-V12-${id}`, client_id: 'v12-mass', client_name: 'V12 MASS fixture', booking_date: date, pickup: `P ${id}`, dropoff: `D ${id}`, vehicle_registration: `V12-${id}`, driver: `Driver ${id}` });
const act = (s, a, who = 'finance') => f.applyAction(s, a, who);
// Mirrors the owner's MASS batch: 219 → 253 → 220, 2,200 + 10,000 + 5,000, container pickup 200 → 17,400.
function mass() {
  let s = f.createEmptyOwnerState();
  s = f.linkDiaryWorkOrder(s, seed('m1', '2026-10-05'), '219', 'admin', receipts());
  s = f.linkDiaryWorkOrder(s, seed('m2', '2026-10-06'), '253', 'admin', receipts({ container_pickup: 200 }));
  s = f.linkDiaryWorkOrder(s, seed('m3', '2026-10-07'), '220', 'admin', receipts());
  s = act(s, { type: 'sheet_create', clientId: 'v12-mass' });
  const id = s.billingSheets.at(-1).id;
  for (const wo of ['219', '253', '220']) s = act(s, { type: 'sheet_add_paper', sheetId: id, workOrder: wo });
  const job = (wo) => s.bookings.find((b) => f.confirmedWorkOrder(b) === wo).id;
  s = act(s, { type: 'sheet_set_transport', sheetId: id, jobId: job('219'), transport: { amount: 2200, source: 'manual' } });
  s = act(s, { type: 'sheet_set_transport', sheetId: id, jobId: job('253'), transport: { amount: 10000, source: 'manual' } });
  s = act(s, { type: 'sheet_set_transport', sheetId: id, jobId: job('220'), transport: { amount: 5000, source: 'manual' } });
  s = act(s, { type: 'sheet_set_extra', sheetId: id, jobId: job('253'), kind: 'container_pickup', value: { decision: 'bill', amount: 200 } });
  return { s, id, job };
}
const sheetOf = (s, id) => s.billingSheets.find((x) => x.id === id);
const total = (s, id) => f.sheetSummary(s, sheetOf(s, id)).totalSatang;

test('MASS-style batch totals ฿17,400 in order 219 → 253 → 220', () => {
  const { s, id } = mass();
  assert.equal(total(s, id), 1740000);
  assert.deepEqual(sheetOf(s, id).jobIds.map((j) => f.confirmedWorkOrder(s.bookings.find((b) => b.id === j))), ['219', '253', '220']);
});

test('remove a work order: totals drop, the Booking Diary record stays, restore returns the exact position and charges', () => {
  const { s: s0, id, job } = mass();
  let s = act(s0, { type: 'sheet_remove_paper', sheetId: id, jobId: job('253'), reason: 'Added to the wrong invoice' });
  assert.equal(total(s, id), 220000 + 500000);
  assert.deepEqual(sheetOf(s, id).jobIds.length, 2);
  assert.ok(s.bookings.some((b) => b.id === job('253')) && s.bookings.find((b) => b.id === job('253')).diarySource, 'original record untouched');
  assert.equal(sheetOf(s, id).removedPapers.length, 1); assert.equal(sheetOf(s, id).removedPapers[0].line.transport.amount, 10000);
  assert.match(s.audit.at(-1).detail, /Removed WO 253 .*wrong invoice/);
  s = act(s, { type: 'sheet_restore_paper', sheetId: id, jobId: job('253') });
  assert.equal(total(s, id), 1740000, 'original total returns');
  assert.deepEqual(sheetOf(s, id).jobIds.map((j) => f.confirmedWorkOrder(s.bookings.find((b) => b.id === j))), ['219', '253', '220']);
  assert.equal(sheetOf(s, id).lines[job('253')].extras.container_pickup.amount, 200);
  assert.equal((sheetOf(s, id).removedPapers || []).length, 0);
  assert.match(s.audit.at(-1).detail, /Restored WO 253 at position 2/);
  assert.throws(() => act(s, { type: 'sheet_restore_paper', sheetId: id, jobId: job('253') }), /FINANCE_SHEET_PAPER_NOT_FOUND/);
});

test('a removed work order can be re-added by number; the stale restore entry is cleared and a locked sheet refuses edits', () => {
  const { s: s0, id, job } = mass();
  let s = act(s0, { type: 'sheet_remove_paper', sheetId: id, jobId: job('220') });
  s = act(s, { type: 'sheet_add_paper', sheetId: id, workOrder: '220' });
  assert.equal((sheetOf(s, id).removedPapers || []).length, 0);
  assert.equal(sheetOf(s, id).lines[job('220')].transport, null, 'a re-added line starts empty; Restore is what brings charges back');
  const done = act(s0, { type: 'sheet_mark_ready', sheetId: id });
  assert.throws(() => act(done, { type: 'sheet_remove_paper', sheetId: id, jobId: job('220') }), /FINANCE_SHEET_LOCKED/);
  const reopened = act(done, { type: 'sheet_reopen', sheetId: id, reason: 'Edited by owner (local test)' });
  assert.equal(sheetOf(reopened, id).readyForApprovalAt, null);
  assert.equal(total(reopened, id), 1740000);
});

test('editing: a changed transport charge recalculates everywhere; the original is kept in history and can be restored', () => {
  const { s: s0, id, job } = mass();
  let s = act(s0, { type: 'sheet_set_transport', sheetId: id, jobId: job('219'), transport: { amount: 2500, source: 'manual' } });
  assert.equal(total(s, id), 1770000);
  assert.equal(sheetOf(s, id).lines[job('219')].priceHistory[0].transport.amount, 2200);
  s = act(s, { type: 'sheet_set_transport', sheetId: id, jobId: job('219'), transport: { amount: 2200, source: 'manual', overrideReason: 'Restored earlier price' } });
  assert.equal(total(s, id), 1740000);
  // add, edit and remove a billable charge; blank never becomes a confirmed charge
  s = act(s, { type: 'sheet_set_extra', sheetId: id, jobId: job('219'), kind: 'parking', value: { decision: 'bill', amount: 40 } });
  assert.equal(total(s, id), 1744000);
  s = act(s, { type: 'sheet_set_extra', sheetId: id, jobId: job('219'), kind: 'parking', value: { decision: 'bill', amount: 60 } });
  assert.match(s.audit.at(-1).detail, /bill THB 40.00 → bill THB 60.00/);
  s = act(s, { type: 'sheet_set_extra', sheetId: id, jobId: job('219'), kind: 'parking', value: null });
  assert.equal(total(s, id), 1740000);
  assert.equal(sheetOf(s, id).lines[job('219')].extras.parking, undefined);
  assert.throws(() => act(s, { type: 'sheet_set_extra', sheetId: id, jobId: job('219'), kind: 'toll', value: { decision: 'bill', amount: null } }), /FINANCE_AMOUNT_INVALID/);
});

test('invoice and Finance Records follow the saved sheet to the satang, including after removal', () => {
  const records = h.lib('finance-records.ts');
  const { s: s0, id, job } = mass();
  const profile = fromSheet.previewProfileForSheet(sheetOf(s0, id)).profile;
  const gross = (s) => fromSheet.invoiceFromSheet(s, sheetOf(s, id), profile, '2026-11-05').totals.subtotalSatang;
  assert.equal(gross(s0), 1740000);
  const removed = act(s0, { type: 'sheet_remove_paper', sheetId: id, jobId: job('253') });
  assert.equal(gross(removed), 720000);
  const batch = records.buildFinanceRecords(removed).batches.find((b) => b.sheetId === id);
  assert.equal(batch.totalSatang, 720000);
  assert.equal(records.buildFinanceRecords(act(removed, { type: 'sheet_restore_paper', sheetId: id, jobId: job('253') })).batches.find((b) => b.sheetId === id).totalSatang, 1740000);
  assert.notEqual(records.sheetLifecycle(s0, sheetOf(s0, id)), 'issued', 'a test draft is never an issued sale');
});

test('local owner: an authenticated Admin may approve a rate mapping without switching roles; Finance still may not', () => {
  const { s } = mass();
  const m = { type: 'confirm_rate_mapping', scheduleId: 'goodyear', rowId: 'goodyear-route-1', clientId: 'v12-mass', contractReference: 'Owner local approval', effectiveFrom: '2026-01-01', effectiveTo: null, reviewReason: '' };
  assert.throws(() => act(s, m, 'finance'), /DEMO_ROLE_REQUIRED/);
  assert.equal(act(s, m, 'admin').rateMappings.length, 1);
  const access = h.lib('finance-intake-access.ts');
  assert.equal(access.financeActionActor({ role: 'admin', status: 'active' }, 'finance', false, 'confirm_rate_mapping'), 'admin');
  assert.equal(access.financeActionActor({ role: 'office', status: 'active' }, 'finance', false, 'confirm_rate_mapping'), 'finance');
});

test('status wording is Draft / In Progress / Ready for review / Approved (not issued); management approval is server-gated', () => {
  const copy = h.lib('finance-records-copy.ts').financeRecordsCopy;
  assert.equal(copy.en.status.draft, 'Draft'); assert.equal(copy.en.status.needs_correction, 'In Progress');
  assert.equal(copy.en.status.ready_for_review, 'Ready for review'); assert.match(copy.en.status.approved, /Approved/);
  const docs = read('components/finance-trn-documents-stage.tsx');
  assert.match(docs, /sheet_approve/); assert.match(docs, /data-testid="approve-billing"/);
  assert.match(docs, /Submit for review/); assert.doesNotMatch(docs, /Confirm & finalise draft/);
  for (const phrase of ['Waiting for finance-manager approval', 'Reopen it in TRN']) {
    const screens = ['components/finance-billing-sheet-stage.tsx', 'components/finance-trn-documents-stage.tsx', 'components/finance-billing-flow.tsx'].map(read).join('\n');
    assert.ok(!screens.includes(phrase), phrase);
  }
});

test('invoice-first: documents open on the EES invoice, with the primary download and an Additional documents menu', () => {
  const stage = read('components/finance-trn-documents-stage.tsx');
  assert.match(stage, /useState<DocId>\("invoice"\)/);
  assert.match(stage, /data-testid="download-invoice-pdf"/); assert.match(stage, /data-testid="additional-documents"/);
  assert.match(stage, /Print invoice/); assert.match(stage, /Print full pack/);
  for (const id of ['statement', 'summary', 'breakdown', 'checklist']) assert.match(stage, new RegExp(`id: "${id}"`), 'secondary generators retained');
  assert.match(stage, /<FinanceDocumentViewer/);
  const viewer = read('components/finance-document-viewer.tsx');
  assert.match(viewer, /invoice-zoom-in/); assert.match(viewer, /invoice-fullscreen/);
  assert.match(read('components/finance-centre-workspace.tsx'), /Invoice & Documents/);
});
