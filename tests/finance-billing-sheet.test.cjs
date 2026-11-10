const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const path = require('node:path');
const { createRequire } = require('node:module');
function load(file, customRequire) {
  const mod = { exports: {} };
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  new Function('module', 'exports', 'require', js)(mod, mod.exports, customRequire || createRequire(path.resolve(file)));
  return mod.exports;
}
const f = load('lib/finance-demo-centre.ts');
const authorization = load('lib/authorization.ts');
const intake = load('lib/finance-intake-access.ts', (name) => {
  if (name === '@/lib/authorization') return authorization;
  if (name === '@/lib/finance-demo-centre') return f;
  return createRequire(path.resolve('lib/finance-intake-access.ts'))(name);
});

// Isolated fixtures only — never real EES work orders, customers or charges.
const receipts = (amounts = {}) => ({ amounts: Object.fromEntries(f.ADMIN_RECEIPT_FIELDS.map((kind) => [kind, amounts[kind] ?? null])), notes: '' });
const seed = (id, client, date, extra = {}) => ({ id, booking_id: `BK-FIXTURE-${id}`, client_id: `fixture-${client}`, client_name: `Fixture ${client}`, booking_date: date, pickup: `Pickup ${id}`, dropoff: `Delivery ${id}`, vehicle_registration: `FX-${id}`, driver: `Driver ${id}`, ...extra });
function fixtureState() {
  let s = f.createEmptyOwnerState();
  s = f.linkDiaryWorkOrder(s, seed('a1', 'A', '2026-01-19'), 'FX-101', 'admin', receipts({ parking: 40, toll: 0 }));
  s = f.linkDiaryWorkOrder(s, seed('a2', 'A', '2026-01-20', { customer_job_number: 'CJ-9' }), 'FX-102', 'admin', receipts());
  s = f.linkDiaryWorkOrder(s, seed('a3', 'A', '2026-01-21'), 'FX-103.1', 'admin', receipts({ overtime: 150.5 }));
  s = f.linkDiaryWorkOrder(s, seed('b1', 'B', '2026-01-19'), 'FX-201', 'admin', receipts());
  s = f.upsertDiaryBooking(s, seed('a4', 'A', '2026-01-22')); // linked but no green-paper WO yet
  return s;
}
const act = (s, action, actor = 'finance') => f.applyAction(s, action, actor);
const sheetOf = (s) => s.billingSheets[s.billingSheets.length - 1];
const startSheet = (s, client = 'fixture-A') => act(s, { type: 'sheet_create', clientId: client });

test('customers offered are only those with Admin-linked green-paper work orders', () => {
  const customers = f.sheetCustomers(fixtureState());
  assert.deepEqual(customers.map((c) => [c.client, c.workOrders]), [['Fixture A', 3], ['Fixture B', 1]]);
});

test('typing work orders in paper order builds a numbered list that is not the WO, TRN or invoice number', () => {
  let s = startSheet(fixtureState());
  const id = sheetOf(s).id;
  for (const wo of ['FX-103.1', 'WO FX-101', ' FX-102 ']) s = act(s, { type: 'sheet_add_paper', sheetId: id, workOrder: wo });
  const sheet = sheetOf(s);
  assert.deepEqual(sheet.jobIds, ['a3', 'a1', 'a2']);
  assert.equal(f.sheetRowTotals(s, sheet, 'a3').position, 1);
  assert.match(sheet.draftReference, /^DRAFT-\d{4}-001$/);
  assert.equal(sheet.officialTrn, null);
  assert.ok(!sheet.jobIds.includes('1'));
});

test('exact work-order matching: 3628 does not match 3628.1, missing and cross-customer papers are blocked', () => {
  let s = startSheet(fixtureState());
  const sheet = sheetOf(s);
  assert.equal(f.lookupWorkOrderForSheet(s, sheet, 'FX-103').kind, 'not_found');
  assert.equal(f.lookupWorkOrderForSheet(s, sheet, 'FX-103.1').kind, 'match');
  assert.equal(f.lookupWorkOrderForSheet(s, sheet, '').kind, 'empty');
  const other = f.lookupWorkOrderForSheet(s, sheet, 'FX-201');
  assert.equal(other.kind, 'other_customer'); assert.equal(other.job.client, 'Fixture B');
  assert.throws(() => act(s, { type: 'sheet_add_paper', sheetId: sheet.id, workOrder: 'FX-201' }), /FINANCE_WO_OTHER_CUSTOMER:Fixture B/);
  assert.throws(() => act(s, { type: 'sheet_add_paper', sheetId: sheet.id, workOrder: 'NOPE-1' }), /FINANCE_WO_NOT_FOUND/);
  s = act(s, { type: 'sheet_note_missing', sheetId: sheet.id, workOrder: 'NOPE-1' });
  assert.deepEqual(sheetOf(s).missingPapers.map((m) => m.workOrder), ['NOPE-1']);
  assert.ok(f.sheetSummary(s, sheetOf(s)).blockers.includes('missing_papers'));
  assert.throws(() => act(s, { type: 'sheet_note_missing', sheetId: sheet.id, workOrder: 'FX-101' }), /FINANCE_WO_REQUIRED/);
});

test('duplicates are prevented within a list and across billing sheets (one WO cannot reach two TRNs)', () => {
  let s = startSheet(fixtureState());
  const id = sheetOf(s).id;
  s = act(s, { type: 'sheet_add_paper', sheetId: id, workOrder: 'FX-101' });
  assert.throws(() => act(s, { type: 'sheet_add_paper', sheetId: id, workOrder: 'FX-101' }), /FINANCE_WO_ALREADY_IN_LIST:1/);
  assert.throws(() => startSheet(s), /FINANCE_SHEET_ALREADY_OPEN/);
  // Simulate the first sheet already handed to approval, then start a second sheet for the same customer.
  s = JSON.parse(JSON.stringify(s)); s.billingSheets[0].readyForApprovalAt = '2026-01-25T00:00:00.000Z';
  s = startSheet(s);
  const second = sheetOf(s);
  assert.notEqual(second.id, id);
  assert.equal(f.lookupWorkOrderForSheet(s, second, 'FX-101').kind, 'in_other_sheet');
  assert.throws(() => act(s, { type: 'sheet_add_paper', sheetId: second.id, workOrder: 'FX-101' }), /FINANCE_WO_IN_OTHER_SHEET:TRN651\/2026/);
  assert.throws(() => act(s, { type: 'sheet_add_paper', sheetId: id, workOrder: 'FX-102' }), /FINANCE_SHEET_LOCKED/);
});

test('move up/down, drag to position and remove keep the original record untouched', () => {
  let s = startSheet(fixtureState());
  const id = sheetOf(s).id;
  for (const wo of ['FX-101', 'FX-102', 'FX-103.1']) s = act(s, { type: 'sheet_add_paper', sheetId: id, workOrder: wo });
  s = act(s, { type: 'sheet_move_paper', sheetId: id, jobId: 'a3', toIndex: 0 });
  assert.deepEqual(sheetOf(s).jobIds, ['a3', 'a1', 'a2']);
  s = act(s, { type: 'sheet_move_paper', sheetId: id, jobId: 'a3', toIndex: 1 });
  assert.deepEqual(sheetOf(s).jobIds, ['a1', 'a3', 'a2']);
  assert.throws(() => act(s, { type: 'sheet_move_paper', sheetId: id, jobId: 'a3', toIndex: 3 }), /FINANCE_SHEET_ORDER/);
  const before = JSON.stringify(s.bookings.find((j) => j.id === 'a3'));
  s = act(s, { type: 'sheet_remove_paper', sheetId: id, jobId: 'a3' });
  assert.deepEqual(sheetOf(s).jobIds, ['a1', 'a2']);
  assert.equal(JSON.stringify(s.bookings.find((j) => j.id === 'a3')), before);
});

test('order and charges survive a save/refresh round trip through the local store envelope', () => {
  const p = load('lib/finance-local-persistence.ts', (name) => name === '@/lib/finance-demo-centre' ? f : require(name));
  let s = startSheet(fixtureState());
  const id = sheetOf(s).id;
  for (const wo of ['FX-102', 'FX-101']) s = act(s, { type: 'sheet_add_paper', sheetId: id, workOrder: wo });
  s = act(s, { type: 'sheet_set_transport', sheetId: id, jobId: 'a2', transport: { amount: 2500.5, source: 'manual' } });
  const envelope = p.createFinanceLocalStoreEnvelope({ owner: s, previous_demo: f.createEmptyOwnerState() }, 'finance', 'owner');
  const reopened = p.parseFinanceLocalStoreJson(JSON.stringify(envelope)).workspaces.owner;
  assert.deepEqual(sheetOf(reopened).jobIds, ['a2', 'a1']);
  assert.equal(sheetOf(reopened).lines.a2.transport.amount, 2500.5);
  assert.equal(sheetOf(reopened).draftReference, sheetOf(s).draftReference);
});

test('row and batch totals are decimal-safe and blanks are never treated as approved zeroes', () => {
  let s = startSheet(fixtureState());
  const id = sheetOf(s).id;
  for (const wo of ['FX-101', 'FX-102', 'FX-103.1']) s = act(s, { type: 'sheet_add_paper', sheetId: id, workOrder: wo });
  let sum = f.sheetSummary(s, sheetOf(s));
  assert.equal(sum.missingPrices, 3);
  assert.equal(sum.pendingExtras, 3, 'parking 40, toll 0 (recorded zero) and overtime 150.50 await a Finance decision');
  assert.equal(f.extraStatus(s.bookings.find((j) => j.id === 'a2'), sheetOf(s).lines.a2, 'parking'), 'none', 'unrecorded blank is not pending and not billed');
  s = act(s, { type: 'sheet_set_transport', sheetId: id, jobId: 'a1', transport: { amount: 0.1, source: 'manual' } });
  s = act(s, { type: 'sheet_set_transport', sheetId: id, jobId: 'a2', transport: { amount: 0.2, source: 'manual' } });
  s = act(s, { type: 'sheet_set_extra', sheetId: id, jobId: 'a1', kind: 'parking', value: { decision: 'bill', amount: 40 } });
  s = act(s, { type: 'sheet_set_extra', sheetId: id, jobId: 'a1', kind: 'toll', value: { decision: 'not_billable', amount: null } });
  s = act(s, { type: 'sheet_set_extra', sheetId: id, jobId: 'a3', kind: 'overtime', value: { decision: 'bill', amount: 150.5 } });
  const row1 = f.sheetRowTotals(s, sheetOf(s), 'a1');
  assert.equal(row1.totalSatang, 4010);
  assert.equal(f.sheetRowTotals(s, sheetOf(s), 'a3').totalSatang, null, 'no transport price yet → no row total');
  sum = f.sheetSummary(s, sheetOf(s));
  assert.equal(sum.transportSatang, 30); // 0.1 + 0.2 exactly
  assert.equal(sum.approvedExtrasSatang, 4000 + 15050);
  assert.equal(sum.totalSatang, 4010 + 20);
  assert.equal(sum.missingPrices, 1);
  assert.equal(sum.pendingExtras, 0);
  for (const bad of [-1, 0, 1.001, Number.NaN, 1e12]) assert.throws(() => act(s, { type: 'sheet_set_transport', sheetId: id, jobId: 'a2', transport: { amount: bad, source: 'manual' } }), /FINANCE_AMOUNT_INVALID/);
});

test('ready-for-approval needs prices and no unresolved flags — no separate office check — and never issues a TRN', () => {
  let s = startSheet(fixtureState());
  const id = sheetOf(s).id;
  s = act(s, { type: 'sheet_add_paper', sheetId: id, workOrder: 'FX-102' });
  assert.throws(() => act(s, { type: 'sheet_mark_ready', sheetId: id }), /FINANCE_SHEET_NOT_READY:missing_prices/);
  s = act(s, { type: 'sheet_set_transport', sheetId: id, jobId: 'a2', transport: { amount: 1800, source: 'manual' } });
  assert.equal(s.bookings.find((j) => j.id === 'a2').status === 'verified', false);
  assert.equal(f.sheetSummary(s, sheetOf(s)).blockers.includes('not_verified'), false);
  // A genuine flag still blocks; clearing it (re-verify) unblocks.
  const flagged = act(s, { type: 'flag_needs_checking', jobId: 'a2', reason: 'Vehicle on paper differs' });
  assert.throws(() => act(flagged, { type: 'sheet_mark_ready', sheetId: id }), /FINANCE_SHEET_NOT_READY:needs_checking/);
  s = act(s, { type: 'sheet_mark_ready', sheetId: id });
  assert.ok(sheetOf(s).readyForApprovalAt);
  assert.equal(sheetOf(s).officialTrn, null);
  assert.equal(f.hasFinalTrnNumber(s), false);
  assert.throws(() => act(s, { type: 'sheet_set_transport', sheetId: id, jobId: 'a2', transport: { amount: 1, source: 'manual' } }), /FINANCE_SHEET_LOCKED/);
  s = act(s, { type: 'sheet_reopen', sheetId: id, reason: 'Fix fixture price' });
  assert.equal(sheetOf(s).readyForApprovalAt, null);
});

test('Needs Checking returns the job to office verification and blocks readiness until re-verified', () => {
  let s = startSheet(fixtureState());
  const id = sheetOf(s).id;
  s = act(s, { type: 'sheet_add_paper', sheetId: id, workOrder: 'FX-101' });
  s = act(s, { type: 'flag_needs_checking', jobId: 'a1', reason: 'Vehicle on paper differs' });
  const job = s.bookings.find((j) => j.id === 'a1');
  assert.equal(job.financeCheck.reason, 'Vehicle on paper differs');
  assert.ok(f.sheetSummary(s, sheetOf(s)).needsChecking.includes('a1'));
  assert.throws(() => act(s, { type: 'flag_needs_checking', jobId: 'a1', reason: '' }), /FINANCE_CHECK_REASON_REQUIRED/);
});

test('draft TRN references are stable and unique; official TRN stays pending without an authoritative register', () => {
  let s = startSheet(fixtureState());
  s = startSheet(s, 'fixture-B');
  const [one, two] = s.billingSheets;
  assert.notEqual(one.draftReference, two.draftReference);
  assert.deepEqual(f.proposeOfficialTrn(null, 2026), { status: 'pending_confirmation' });
  assert.deepEqual(f.proposeOfficialTrn(['TRN010/2026', 'TRN042/2026', 'TRN999/2025', 'junk'], 2026), { status: 'proposed', trn: 'TRN043/2026' });
  assert.equal(f.highestLocalTrn([f.createSourceState()]), 'TRN042/2026');
});

test('authenticated Admin can work the Finance desk without role switching; office cannot', () => {
  const access = { role: 'admin', status: 'active' };
  assert.equal(intake.financeActionActor(access, 'office', false, 'sheet_add_paper'), 'admin');
  assert.equal(intake.financeActionActor(null, 'office', false, 'sheet_add_paper'), 'office');
  assert.throws(() => act(fixtureState(), { type: 'sheet_create', clientId: 'fixture-A' }, 'office'), /DEMO_ROLE_REQUIRED/);
  assert.throws(() => act(fixtureState(), { type: 'sheet_create', clientId: 'fixture-A' }, 'approver'), /DEMO_ROLE_REQUIRED/);
  const s = act(fixtureState(), { type: 'sheet_create', clientId: 'fixture-A' }, 'admin');
  assert.equal(s.audit[s.audit.length - 1].actor, 'admin');
});

test('schedule-sourced transport must match a live suggestion — no unapproved or stale rates', () => {
  let s = startSheet(fixtureState());
  const id = sheetOf(s).id;
  s = act(s, { type: 'sheet_add_paper', sheetId: id, workOrder: 'FX-101' });
  assert.equal(f.sheetRateSuggestion(s, s.bookings.find((j) => j.id === 'a1')).kind, 'none');
  assert.throws(() => act(s, { type: 'sheet_set_transport', sheetId: id, jobId: 'a1', transport: { amount: 11500, source: 'schedule', mappingId: 'X' } }), /FINANCE_RATE_SUGGESTION_STALE/);
});

test('Finance Centre shows Admin Intake plus the three Finance stages, with older screens only under More tools', () => {
  const workspace = fs.readFileSync('components/finance-centre-workspace.tsx', 'utf8');
  for (const label of ['Admin Intake', 'Arrange Work Orders', 'Customer Billing', 'Invoice & Documents', 'More', 'Rates, Fuel & Legacy Billing', 'Legacy billing', 'Open Booking Diary']) assert.ok(workspace.includes(label), label);
  assert.ok(workspace.includes('<FinanceAdminIntake'), 'Admin Intake is the full-page two-panel picker');
  assert.match(fs.readFileSync('app/(dashboard)/finance-centre/page.tsx', 'utf8'), /initialSection="arrange"/);
  const docs = fs.readFileSync('components/finance-trn-documents-stage.tsx', 'utf8');
  assert.ok(docs.includes('DRAFT / TEST') && docs.includes('Official TRN pending confirmation'));
  assert.ok(!/account\s*(no|number)|swift|iban|ธนาคาร|เลขที่บัญชี|VAT\s*\(?\s*7\s*%|ภาษีมูลค่าเพิ่ม\s*7/i.test(docs), 'no invented bank, account or tax-rate details');
  const arrange = fs.readFileSync('components/finance-arrange-stage.tsx', 'utf8');
  assert.ok(arrange.includes('Enter work order number') && arrange.includes('Add to invoice · paper #') && arrange.includes('Continue to Customer Billing'));
  const intake = fs.readFileSync('components/finance-admin-intake.tsx', 'utf8');
  for (const label of ['Waiting for work order', 'Flag issue', 'Confirm job', 'Date from', 'Vehicle registration', 'Clear filters', 'Save & Next', '+ {t("More charges"']) assert.ok(intake.includes(label), label);
  assert.ok(!/Enter from green paper|Compare and verify/.test(intake), 'no re-typing table or compare gating in Admin Intake');
  const css = fs.readFileSync('app/globals.css', 'utf8');
  assert.match(css, /\.ees-doc \*[\s\S]{0,200}letter-spacing: normal !important;/, 'Thai text never gets letter-spacing in Finance UI/documents');
});

test('Admin intake: "matches" marks the job office-checked; "different" flags it for management without blocking the save', () => {
  let s = fixtureState();
  const base = { workOrder: 'FX-101', receipts: receipts({ parking: 120 }) };
  s = f.applyAction(s, { type: 'admin_save_intake', jobId: 'a1', ...base, check: { result: 'matches', note: '' } }, 'admin');
  let job = s.bookings.find((j) => j.id === 'a1');
  assert.equal(job.status, 'verified'); assert.equal(job.adminReceipts.amounts.parking, 120); assert.equal(job.adminReceipts.amounts.toll, null);
  s = f.applyAction(s, { type: 'admin_save_intake', jobId: 'a2', workOrder: 'FX-102', receipts: receipts(), check: { result: 'different', note: 'Paper shows different truck' } }, 'admin');
  job = s.bookings.find((j) => j.id === 'a2');
  assert.equal(job.status, 'discrepancy'); assert.equal(job.intakeCheck.note, 'Paper shows different truck'); assert.equal(f.confirmedWorkOrder(job), 'FX-102');
  assert.throws(() => f.applyAction(s, { type: 'admin_save_intake', jobId: 'a2', workOrder: 'FX-102', receipts: receipts(), check: { result: 'different', note: '' } }, 'admin'), /FINANCE_INTAKE_NOTE_REQUIRED/);
  // Admin can withdraw their own intake flag.
  s = f.applyAction(s, { type: 'admin_save_intake', jobId: 'a2', workOrder: 'FX-102', receipts: receipts(), check: { result: 'matches', note: '' } }, 'admin');
  assert.equal(s.bookings.find((j) => j.id === 'a2').status, 'verified');
  // Saving without a check leaves the office status alone; the Booking Diary source is never touched.
  const before = JSON.stringify(s.bookings.find((j) => j.id === 'a3').diarySource);
  s = f.applyAction(s, { type: 'admin_save_intake', jobId: 'a3', workOrder: 'FX-103.1', receipts: receipts(), check: null }, 'admin');
  assert.equal(s.bookings.find((j) => j.id === 'a3').status, 'pending');
  assert.equal(JSON.stringify(s.bookings.find((j) => j.id === 'a3').diarySource), before);
});

test('Admin intake blocks a work order already linked to another booking and is Admin-only', () => {
  const s = fixtureState();
  assert.throws(() => f.applyAction(s, { type: 'admin_save_intake', jobId: 'a2', workOrder: 'FX-101', receipts: receipts(), check: null }, 'admin'), /DEMO_DUPLICATE_WO/);
  assert.throws(() => f.applyAction(s, { type: 'admin_save_intake', jobId: 'a2', workOrder: 'FX-102', receipts: receipts(), check: null }, 'finance'), /DEMO_ROLE_REQUIRED/);
  const linked = f.linkDiaryWorkOrder(s, seed('a9', 'A', '2026-01-23'), 'FX-109', 'admin', receipts(), { result: 'different', note: 'Route differs' });
  assert.equal(linked.bookings.find((j) => j.id === 'a9').status, 'discrepancy');
});

test('unapproved receipt amounts are a warning, never counted, and never block approval readiness', () => {
  let s = startSheet(fixtureState());
  const id = sheetOf(s).id;
  s = act(s, { type: 'sheet_add_paper', sheetId: id, workOrder: 'FX-101' });
  const sum = f.sheetSummary(s, sheetOf(s));
  assert.deepEqual(sum.warnings, ['pending_extras']);
  assert.ok(!sum.blockers.includes('pending_extras'));
  assert.equal(sum.approvedExtrasSatang, 0);
  s = act(s, { type: 'sheet_set_extra', sheetId: id, jobId: 'a1', kind: 'other', value: { decision: 'bill', amount: 75, note: 'Loading wait agreed by customer' } });
  assert.equal(sheetOf(s).lines.a1.extras.other.note, 'Loading wait agreed by customer');
  assert.equal(f.sheetSummary(s, sheetOf(s)).approvedExtrasSatang, 7500);
});

test('display helpers: dates, THB, Bangkok time, vehicle plates and test-booking detection', () => {
  const d = load('lib/finance-display.ts');
  assert.equal(d.formatUiDate('2026-01-05'), '05 Jan 2026');
  assert.equal(d.formatDocDate('2026-01-31'), '31/01/2026');
  assert.equal(d.formatPeriod('2026-01-05', '2026-01-31'), '05/01/2026 – 31/01/2026');
  assert.equal(d.formatThb(1234.5), '฿1,234.50'); assert.equal(d.formatThb(null), '—');
  assert.equal(d.formatBangkokTime('2026-11-04T11:49:00Z'), '18:49');
  assert.equal(d.displayVehicle('3ฒน9565'), '3ฒน-9565'); assert.equal(d.displayVehicle('3ฒน-9565'), '3ฒน-9565');
  assert.equal(d.displayVehicle('79-2945'), '79-2945'); assert.equal(d.displayVehicle('1998'), '1998');
  assert.equal(d.isLikelyTestBooking({ driver: 'Joey Test' }), true);
  assert.equal(d.isLikelyTestBooking({ driver: 'ธนกรณ์', client_name: 'MASS' }), false);
  const company = load('lib/ees-company.ts').EES_COMPANY;
  assert.equal(company.nameTh, 'บริษัท เอ็กซ์เพิร์ท เอ็กซ์เพรส เซ็นเดอร์ จำกัด');
  assert.equal(company.phone, '094-6782416');
});
