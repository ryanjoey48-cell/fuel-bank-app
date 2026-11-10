const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const h = require('./helpers/invoice-compare.cjs');
const f = h.lib('finance-demo-centre.ts');
const fromSheet = h.lib('finance-invoice-from-sheet.ts');
const read = (p) => fs.readFileSync(path.join(h.root, p), 'utf8');
const act = (s, a, who = 'finance') => f.applyAction(s, a, who);
const receipts = (a = {}) => ({ amounts: Object.fromEntries(f.ADMIN_RECEIPT_FIELDS.map((k) => [k, a[k] ?? null])), notes: '' });
const job = (s, wo) => s.bookings.find((b) => f.confirmedWorkOrder(b) === wo);

function goodyear() {
  let s = f.createEmptyOwnerState();
  s = f.linkDiaryWorkOrder(s, { id: 'g', booking_id: 'G', client_id: 'apl', client_name: 'APL', booking_date: '2026-10-26', pickup: 'GOODYEAR', dropoff: 'สุวรรณภูมิ', vehicle_registration: '701-1654', driver: 'D' }, '6144', 'admin', receipts({ parking: 60, toll: 30 }));
  s = act(s, { type: 'sheet_create', clientId: 'apl' }); const id = s.billingSheets.at(-1).id;
  s = act(s, { type: 'sheet_add_paper', sheetId: id, workOrder: '6144' });
  s = act(s, { type: 'sheet_set_transport', sheetId: id, jobId: job(s, '6144').id, transport: { amount: 3300, source: 'manual' } });
  return { s, id };
}
const total = (s, id) => f.sheetSummary(s, s.billingSheets.find((x) => x.id === id)).totalSatang;

test('Goodyear ฿30 recorded under Toll is billed once as Other; the invoice does not call it a toll', () => {
  let { s, id } = goodyear(); const jb = job(s, '6144');
  s = act(s, { type: 'sheet_set_extra', sheetId: id, jobId: jb.id, kind: 'parking', value: { decision: 'bill', amount: 60 } });
  s = act(s, { type: 'sheet_reclassify_extra', sheetId: id, jobId: jb.id, from: 'toll', to: 'other', note: 'Verified category is Other' });
  const sheet = s.billingSheets.find((x) => x.id === id); const extras = sheet.lines[jb.id].extras;
  assert.deepEqual([extras.other.decision, extras.other.amount, extras.toll.decision, extras.toll.amount], ['bill', 30, 'not_billable', null]);
  assert.equal(jb.adminReceipts.amounts.toll, 30, 'the Admin receipt evidence is untouched');
  assert.equal(total(s, id), 339000, '฿3,300 + ฿60 + ฿30, the ฿30 counted once');
  const doc = fromSheet.invoiceFromSheet(s, sheet, fromSheet.previewProfileForSheet(sheet).profile, '2026-11-06');
  const descriptions = doc.lines.filter((l) => l.kind === 'extra').map((l) => l.description);
  assert.deepEqual(descriptions.map((d) => /TOLL/i.test(d)), [false], 'no TOLL line on the invoice');
  assert.ok(descriptions.some((d) => /OTHER/i.test(d)));
  assert.equal(doc.totals.subtotalSatang, 339000);
  assert.match(s.audit.at(-1).detail, /billed as other .* counted once/);
  // validations: target category must be free; cannot reclassify onto an existing charge
  assert.throws(() => act(s, { type: 'sheet_reclassify_extra', sheetId: id, jobId: jb.id, from: 'parking', to: 'other' }), /FINANCE_EXTRA_EXISTS/);
  assert.throws(() => act(s, { type: 'sheet_reclassify_extra', sheetId: id, jobId: jb.id, from: 'overtime', to: 'overnight' }), /FINANCE_AMOUNT_INVALID/);
});

test('a billed extra keeps its category when the work order moves to another invoice group', () => {
  let { s, id } = goodyear(); const jb = job(s, '6144');
  s = act(s, { type: 'sheet_reclassify_extra', sheetId: id, jobId: jb.id, from: 'toll', to: 'other' });
  s = act(s, { type: 'sheet_create', clientId: 'apl', additional: true }); const other = s.billingSheets.at(-1).id;
  s = act(s, { type: 'sheet_move_to_group', fromSheetId: id, toSheetId: other, jobId: jb.id, reason: 'Wrong invoice' });
  const moved = s.billingSheets.find((x) => x.id === other).lines[jb.id].extras;
  assert.deepEqual([moved.other.amount, moved.toll.decision], [30, 'not_billable']);
  assert.equal(total(s, other), 333000); assert.equal(total(s, id), 0);
});

test('one approved agreement prices every matching job on any invoice group, including a later booking — no per-job approval', () => {
  let s = f.createEmptyOwnerState();
  [['5838', '2026-10-26'], ['6956', '2026-10-26'], ['7001', '2026-11-03']].forEach(([wo, d], i) => { s = f.linkDiaryWorkOrder(s, { id: 's' + i, booking_id: 'S' + i, client_id: 'apl', client_name: 'APL', booking_date: d, pickup: i === 2 ? 'SIRTEX' : 'Sirtec', dropoff: 'CAL-COMP', vehicle_registration: 'P' + i, driver: 'D' }, wo, 'admin', receipts()); });
  const row = f.CUSTOMER_RATE_SCHEDULES.find((x) => x.id === 'sirtech').rows[0];
  assert.equal(f.diagnoseRate(s, job(s, '5838')).code, 'no_mapping');
  s = act(s, { type: 'confirm_rate_mapping', scheduleId: 'sirtech', rowId: row.id, clientId: 'apl', contractReference: 'One-time approval', effectiveFrom: '2026-01-01', effectiveTo: null, reviewReason: '', match: { pickup: ['Sirtec', 'SIRTEX'], delivery: ['CAL-COMP'], vehicleClass: [] } }, 'approver');
  assert.equal(s.rateMappings.length, 1);
  for (const [date, price] of [['2026-10-26', 43.54], ['2026-11-03', 42.54]]) { s = act(s, { type: 'record_fuel_reference', date, priceThb: price, evidence: `Approved EES history page ${date}`, sourceUrl: f.DIESEL_B7_SOURCE_URL }); }
  const amounts = ['5838', '6956', '7001'].map((wo) => f.diagnoseRate(s, job(s, wo)).amountThb);
  assert.deepEqual(amounts, [13110, 13110, 12995], 'two jobs on one verified date reuse it; the November job uses its own date');
  assert.equal(s.rateMappings.length, 1, 'still one approval');
  // an unrecognised route is the only thing that needs a new approval
  s = f.linkDiaryWorkOrder(s, { id: 'x', booking_id: 'X', client_id: 'apl', client_name: 'APL', booking_date: '2026-11-04', pickup: 'ACME', dropoff: 'Somewhere', vehicle_registration: 'Z', driver: 'D' }, '7002', 'admin', receipts());
  assert.equal(f.diagnoseRate(s, job(s, '7002')).code, 'route_mismatch');
});

test('Goodyear override does not approve a general band reading', () => {
  let { s } = goodyear();
  const row = f.CUSTOMER_RATE_SCHEDULES.find((x) => x.id === 'goodyear').rows.find((r) => r.pickup === 'GOODYEAR' && r.vehicle === '6W');
  s = act(s, { type: 'confirm_rate_mapping', scheduleId: 'goodyear', rowId: row.id, clientId: 'apl', contractReference: 'Goodyear', effectiveFrom: '2026-01-01', effectiveTo: null, reviewReason: '', match: { pickup: ['GOODYEAR'], delivery: ['สุวรรณภูมิ'], vehicleClass: [], plates: ['701-1654'] } }, 'approver');
  assert.notEqual(s.rateMappings[0].match.bandReading, 'floor_level');
  s = act(s, { type: 'record_fuel_reference', date: '2026-10-26', priceThb: 43.54, evidence: 'Approved EES history page 26 Oct', sourceUrl: f.DIESEL_B7_SOURCE_URL });
  assert.equal(f.diagnoseRate(s, job(s, '6144')).amountThb, 3350, 'a manual ฿3,300 on the sheet does not change the table reading');
});

test('simplified billing UI: pricing controls in administrator area, context links, rename-on-demand groups and mandatory missing-price warning', () => {
  const bar = read('components/finance-pricing-bar.tsx');
  for (const text of ['Fuel verification needed', 'View source', 'need attention', 'attention-summary', 'open-price-setup', 'apply-all-suggestions', 'canManagePricing']) assert.match(bar, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  const stage = read('components/finance-billing-sheet-stage.tsx');
  assert.doesNotMatch(stage, /<FinancePricingBar/); assert.doesNotMatch(stage, /<FinanceRatePanel/);
  assert.match(read('components/finance-pricing-admin.tsx'), /<FinancePricingBar/);
  assert.match(stage, /useFinanceVerifiedPrices/); assert.match(stage, /mandatory-pricing-checks/);
  assert.doesNotMatch(stage, /setupOpen/); assert.match(bar, /finance-pricing-admin/); assert.match(stage, /View pricing calculation/); assert.match(stage, /bill-as/);
  assert.doesNotMatch(stage, /<FinancePricingSetup/, 'the heavy set-up is no longer in Customer Billing');
  assert.doesNotMatch(read('components/finance-rate-panel.tsx'), /Approve customer contract/);
  assert.match(read('components/finance-rate-panel.tsx'), /agreement-note/);
  const flow = read('components/finance-billing-flow.tsx');
  assert.match(flow, /data-testid="group-rename"/); assert.doesNotMatch(flow, /Name for the new group/); assert.doesNotMatch(flow, /Name of this group/);
  const docs = read('components/finance-trn-documents-stage.tsx');
  assert.match(docs, /invoice-incomplete/); assert.match(docs, /incomplete-chip/);
});

test('an invoice with an unpriced work order is flagged incomplete, never a ฿0.00 charge', () => {
  let s = f.createEmptyOwnerState();
  s = f.linkDiaryWorkOrder(s, { id: 'u', booking_id: 'U', client_id: 'apl', client_name: 'APL', booking_date: '2026-11-03', pickup: 'A', dropoff: 'B', vehicle_registration: 'Q', driver: 'D' }, '8001', 'admin', receipts());
  s = act(s, { type: 'sheet_create', clientId: 'apl' }); const id = s.billingSheets.at(-1).id; s = act(s, { type: 'sheet_add_paper', sheetId: id, workOrder: '8001' });
  const sheet = s.billingSheets.find((x) => x.id === id);
  assert.equal(f.sheetSummary(s, sheet).missingPrices, 1);
  assert.throws(() => act(s, { type: 'sheet_mark_ready', sheetId: id }), /FINANCE_SHEET_NOT_READY/);
  const doc = fromSheet.invoiceFromSheet(s, sheet, fromSheet.previewProfileForSheet(sheet).profile, '2026-11-06');
  assert.ok(doc.lines.filter((l) => l.kind === 'trip').every((l) => l.unpriced === true));
});
