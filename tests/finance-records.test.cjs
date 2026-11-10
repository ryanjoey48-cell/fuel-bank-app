const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const XLSX = require('xlsx');

// Loads TypeScript modules (relative and "@/" imports) so the real lib code is exercised, not a copy.
const cache = new Map();
function loadTs(file) {
  file = path.resolve(file);
  if (cache.has(file)) return cache.get(file).exports;
  const mod = { exports: {} };
  cache.set(file, mod);
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const req = (name) => {
    if (name.startsWith('.') || name.startsWith('@/')) {
      const base = name.startsWith('@/') ? path.resolve(name.slice(2)) : path.resolve(path.dirname(file), name);
      const target = [base, `${base}.ts`].find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
      if (target && target.endsWith('.ts')) return loadTs(target);
      if (target) return require(target);
    }
    return require(name);
  };
  new Function('module', 'exports', 'require', js)(mod, mod.exports, req);
  return mod.exports;
}
const f = loadTs('lib/finance-demo-centre.ts');
const r = loadTs('lib/finance-records.ts');
const x = loadTs('lib/finance-records-export.ts');
const { financeRecordsCopy } = loadTs('lib/finance-records-copy.ts');
const access = loadTs('lib/finance-intake-access.ts');
const read = (file) => fs.readFileSync(file, 'utf8');
const clone = (value) => JSON.parse(JSON.stringify(value));

// ── isolated fixtures: a three-work-order customer shaped like the MASS test batch (never real EES records) ──
const receipts = (amounts = {}) => ({ amounts: Object.fromEntries(f.ADMIN_RECEIPT_FIELDS.map((kind) => [kind, amounts[kind] ?? null])), notes: '' });
const seed = (id, client, date, extra = {}) => ({ id, booking_id: `BK-FX-${id}`, client_id: `fixture-${client}`, client_name: `Fixture ${client}`, booking_date: date, pickup: `Pickup ${id}`, dropoff: `Delivery ${id}`, vehicle: '4W', vehicle_registration: `FX-${id}`, driver: `Driver ${id}`, ...extra });
const act = (s, action) => f.applyAction(s, action, 'finance');
function massState() {
  let s = f.createEmptyOwnerState();
  s = f.linkDiaryWorkOrder(s, seed('m1', 'MASS', '2026-01-05', { customer_job_number: 'CJ-1' }), '253', 'admin', receipts());
  s = f.linkDiaryWorkOrder(s, seed('m2', 'MASS', '2026-01-05'), '220', 'admin', receipts({ parking: 40 }));
  s = f.linkDiaryWorkOrder(s, seed('m3', 'MASS', '2026-01-05'), '219', 'admin', receipts({ container_pickup: 200 }));
  s = f.linkDiaryWorkOrder(s, seed('o1', 'OTHER', '2026-02-10'), '2190', 'admin', receipts());
  s = f.linkDiaryWorkOrder(s, seed('o2', 'OTHER', '2026-02-11'), '1219', 'admin', receipts());
  s = act(s, { type: 'sheet_create', clientId: 'fixture-MASS' });
  const id = s.billingSheets[0].id;
  for (const wo of ['219', '220', '253']) s = act(s, { type: 'sheet_add_paper', sheetId: id, workOrder: wo });
  s = act(s, { type: 'sheet_set_transport', sheetId: id, jobId: 'm3', transport: { amount: 2200, source: 'manual' } });
  s = act(s, { type: 'sheet_set_transport', sheetId: id, jobId: 'm2', transport: { amount: 5000, source: 'manual' } });
  s = act(s, { type: 'sheet_set_transport', sheetId: id, jobId: 'm1', transport: { amount: 10000, source: 'manual' } });
  s = act(s, { type: 'sheet_set_extra', sheetId: id, jobId: 'm3', kind: 'container_pickup', value: { decision: 'bill', amount: 200 } });
  s = act(s, { type: 'sheet_set_extra', sheetId: id, jobId: 'm2', kind: 'parking', value: { decision: 'not_billable', amount: null } });
  return s;
}
const ctx = (filters = r.EMPTY_RECORD_FILTERS, extra = {}) => ({ copy: financeRecordsCopy.en, language: 'en', filters, clientName: (id) => id.replace('fixture-', ''), now: new Date('2026-11-05T05:00:00Z'), ...extra });
const filt = (patch) => ({ ...r.EMPTY_RECORD_FILTERS, ...patch });

test('records are projections of the saved state: amounts match the billing sheet to the satang and paper order is kept', () => {
  const s = massState();
  const { workOrders, batches } = r.buildFinanceRecords(s);
  const batch = batches[0];
  assert.deepEqual(batch.workOrders.map((row) => row.workOrder), ['219', '220', '253']);
  assert.deepEqual(batch.workOrders.map((row) => row.position), [1, 2, 3]);
  assert.deepEqual(batch.workOrders.map((row) => row.transportSatang), [220000, 500000, 1000000]);
  assert.deepEqual(batch.workOrders.map((row) => row.totalSatang), [240000, 500000, 1000000]);
  assert.equal(batch.totalSatang, 1740000);
  assert.equal(batch.transportSatang, 1720000);
  assert.equal(batch.otherSatang, 20000); // the 200 container charge sits in "Other charges"
  assert.equal(batch.parkingSatang, 0);
  const summary = f.sheetSummary(s, s.billingSheets[0]);
  assert.equal(batch.totalSatang, summary.totalSatang);
  assert.equal(batch.workOrders.reduce((sum, row) => sum + row.totalSatang, 0), batch.totalSatang);
  // a not-billable parking receipt is never counted, and work orders outside any batch carry no amounts
  assert.equal(batch.workOrders[1].parkingSatang, null);
  const unbatched = workOrders.filter((row) => row.status === 'not_batched');
  assert.deepEqual(unbatched.map((row) => row.workOrder).sort(), ['1219', '2190']);
  assert.ok(unbatched.every((row) => row.totalSatang === null && row.trn === null));
  assert.equal(batch.trn, 'TRN651/2026');
});

test('lifecycle comes only from saved state: draft → ready for review → approved; reopen needs correction; never issued locally', () => {
  let s = massState();
  const sheet = () => s.billingSheets[0];
  assert.equal(r.sheetLifecycle(s, sheet()), 'draft');
  s = act(s, { type: 'sheet_mark_ready', sheetId: sheet().id });
  assert.equal(r.sheetLifecycle(s, sheet()), 'ready_for_review');
  s = f.applyAction(s, { type: 'sheet_approve', sheetId: sheet().id }, 'admin');
  assert.equal(r.sheetLifecycle(s, sheet()), 'approved');
  assert.equal(sheet().officialTrn, null);
  s = f.applyAction(s, { type: 'sheet_reopen', sheetId: sheet().id, reason: 'Material correction after management approval' }, 'finance');
  assert.equal(r.sheetLifecycle(s, sheet()), 'needs_correction');
  s = act(s, { type: 'sheet_mark_ready', sheetId: sheet().id });
  assert.equal(r.sheetLifecycle(s, sheet()), 'ready_for_review');
  s = act(s, { type: 'flag_needs_checking', jobId: 'm1', reason: 'Fixture flag' });
  assert.equal(r.sheetLifecycle(s, sheet()), 'needs_correction');
  const seen = new Set(r.buildFinanceRecords(s).batches.map((batch) => batch.status));
  assert.ok(!seen.has('issued'));
  assert.ok(!seen.has('awaiting_approval'));
  // an issued status exists only when an official TRN is present (never produced by local testing)
  const issued = clone(massState()); issued.billingSheets[0].officialTrn = 'TRN650/2026';
  assert.equal(r.sheetLifecycle(issued, issued.billingSheets[0]), 'issued');
});

test('searching work order 219 finds that record first (exact before partial matches)', () => {
  const { workOrders } = r.buildFinanceRecords(massState());
  const hits = r.filterWorkOrders(workOrders, filt({ search: '219' }));
  assert.equal(hits[0].workOrder, '219');
  assert.deepEqual(hits.map((row) => row.workOrder).sort(), ['1219', '219', '2190']); // partial matches follow
  assert.equal(r.filterWorkOrders(workOrders, filt({ search: '219 mass' }))[0].workOrder, '219');
  assert.equal(r.filterWorkOrders(workOrders, filt({ search: '219 mass' })).length, 1);
});

test('searching by customer finds the batch and its work orders; TRN, customer job no., driver, vehicle and route also match', () => {
  const { workOrders, batches } = r.buildFinanceRecords(massState());
  const byCustomer = r.filterBatches(batches, filt({ search: 'MASS' }));
  assert.equal(byCustomer.length, 1);
  assert.deepEqual(byCustomer[0].matched.map((row) => row.workOrder), ['219', '220', '253']);
  assert.equal(r.filterWorkOrders(workOrders, filt({ search: 'MASS' })).length, 3);
  assert.equal(r.filterWorkOrders(workOrders, filt({ search: 'TRN651' })).length, 3);
  assert.equal(r.filterBatches(batches, filt({ search: 'trn651/2026' })).length, 1);
  assert.deepEqual(r.filterWorkOrders(workOrders, filt({ search: 'CJ-1' })).map((row) => row.workOrder), ['253']);
  assert.deepEqual(r.filterWorkOrders(workOrders, filt({ search: 'Driver m2' })).map((row) => row.workOrder), ['220']);
  assert.deepEqual(r.filterWorkOrders(workOrders, filt({ search: 'FX-m3' })).map((row) => row.workOrder), ['219']);
  assert.deepEqual(r.filterWorkOrders(workOrders, filt({ search: 'Delivery m1' })).map((row) => row.workOrder), ['253']);
  // a work-order-only hit still surfaces its batch, showing just the matching paper
  const one = r.filterBatches(batches, filt({ search: '220' }));
  assert.equal(one.length, 1); assert.deepEqual(one[0].matched.map((row) => row.workOrder), ['220']);
});

test('date filters are inclusive on the transport date; month and customer views work in both views', () => {
  const { workOrders, batches } = r.buildFinanceRecords(massState());
  const count = (patch) => r.filterWorkOrders(workOrders, filt(patch)).length;
  assert.equal(count({ dateFrom: '2026-01-05', dateTo: '2026-01-05' }), 3);
  assert.equal(count({ dateFrom: '2026-01-05' }), 5);
  assert.equal(count({ dateTo: '2026-01-05' }), 3);
  assert.equal(count({ dateFrom: '2026-01-06', dateTo: '2026-02-09' }), 0);
  assert.equal(count({ dateFrom: '2026-02-10', dateTo: '2026-02-11' }), 2); // both end dates included
  assert.equal(count({ month: '2026-01' }), 3);
  assert.equal(count({ month: '2026-02' }), 2);
  assert.equal(count({ client: 'fixture-MASS' }), 3);
  assert.equal(r.filterBatches(batches, filt({ dateFrom: '2026-01-05', dateTo: '2026-01-05' })).length, 1);
  assert.equal(r.filterBatches(batches, filt({ dateFrom: '2026-01-06' })).length, 0);
  assert.equal(r.filterBatches(batches, filt({ month: '2026-01' })).length, 1);
  assert.equal(r.filterBatches(batches, filt({ month: '2026-02' })).length, 0);
  assert.equal(r.filterBatches(batches, filt({ status: 'draft' })).length, 1);
  assert.equal(r.filterBatches(batches, filt({ status: 'issued' })).length, 0);
  assert.equal(count({ status: 'not_batched' }), 2);
  assert.deepEqual(r.recordFacets(workOrders).months, ['2026-02', '2026-01']);
});

test('status semantics: draft amounts are never counted as billed; only an issued TRN counts as billed', () => {
  const s = massState();
  const rec = r.buildFinanceRecords(s);
  const k = r.summarizeRecords(r.filterWorkOrders(rec.workOrders, r.EMPTY_RECORD_FILTERS), r.filterBatches(rec.batches, r.EMPTY_RECORD_FILTERS));
  assert.equal(k.workOrders, 5);
  assert.equal(k.draftBatches, 1);
  assert.equal(k.issuedTrns, 0);
  assert.equal(k.billedSatang, 0);
  assert.equal(k.draftValueSatang, 1740000);
  assert.equal(k.needsAttention, 0);
  const issued = clone(s); issued.billingSheets[0].officialTrn = 'TRN650/2026';
  const rec2 = r.buildFinanceRecords(issued);
  const k2 = r.summarizeRecords(r.filterWorkOrders(rec2.workOrders, r.EMPTY_RECORD_FILTERS), r.filterBatches(rec2.batches, r.EMPTY_RECORD_FILTERS));
  assert.equal(k2.issuedTrns, 1); assert.equal(k2.billedSatang, 1740000); assert.equal(k2.draftValueSatang, 0);
  const flagged = act(s, { type: 'flag_needs_checking', jobId: 'm1', reason: 'Fixture flag' });
  const rec3 = r.buildFinanceRecords(flagged);
  assert.equal(r.summarizeRecords(rec3.workOrders, r.filterBatches(rec3.batches, r.EMPTY_RECORD_FILTERS)).needsAttention, 1);
});

test('reopening a record never changes a financial amount and is recorded in the history', () => {
  let s = act(massState(), { type: 'sheet_mark_ready', sheetId: 'SHEET-1' });
  const before = r.buildFinanceRecords(s);
  const money = (rec) => JSON.stringify([rec.workOrders.map((row) => [row.workOrder, row.transportSatang, row.parkingSatang, row.tollSatang, row.otherSatang, row.totalSatang]), rec.batches.map((b) => [b.trn, b.totalSatang])]);
  s = act(s, { type: 'sheet_reopen', sheetId: 'SHEET-1', reason: 'Fixture correction' });
  assert.equal(money(r.buildFinanceRecords(s)), money(before));
  assert.equal(r.buildFinanceRecords(s).batches[0].status, 'needs_correction');
  const history = r.batchActivity(s, s.billingSheets[0]);
  assert.ok(history.some((entry) => entry.action === 'sheet_mark_ready'));
  const reopen = history.find((entry) => entry.action === 'sheet_reopen');
  assert.match(reopen.detail, /Fixture correction/);
  // an issued record cannot be reopened through the sheet action
  const issued = clone(s); issued.billingSheets[0].officialTrn = 'TRN650/2026'; issued.billingSheets[0].readyForApprovalAt = null;
  assert.equal(r.sheetLifecycle(issued, issued.billingSheets[0]), 'issued');
});

test('record detail carries booking, admin entry, receipts, billable decisions, final price, paper order and history', () => {
  const s = massState();
  const d = r.workOrderDetail(s, 'm3');
  assert.equal(d.record.workOrder, '219');
  assert.equal(d.original.pickup, 'Pickup m3');
  assert.match(d.bookingReference, /^BK-/);
  assert.equal(d.receipts.find((item) => item.kind === 'container_pickup').satang, 20000);
  assert.deepEqual(d.billable.find((item) => item.kind === 'container_pickup'), { kind: 'container_pickup', decision: 'billed', satang: 20000, note: '' });
  assert.equal(d.transport.satang, 220000); assert.equal(d.transport.source, 'manual');
  assert.equal(d.record.totalSatang, 240000);
  assert.equal(d.batch.trn, 'TRN651/2026');
  assert.equal(r.workOrderDetail(s, 'm2').billable.find((item) => item.kind === 'parking').decision, 'not_billable');
  assert.equal(r.workOrderDetail(s, 'o1').batch, null);
  const own = r.workOrderActivity(s, d.record);
  assert.ok(own.length >= 1 && own.every((entry, i, all) => i === 0 || all[i - 1].step < entry.step));
  assert.ok(r.batchActivity(s, s.billingSheets[0]).some((entry) => entry.action === 'sheet_create'));
});

test('exports use exactly the filtered records and exact amounts; blanks stay blank; drafts are marked DRAFT/TEST', () => {
  const s = massState();
  const rec = r.buildFinanceRecords(s);
  const all = r.filterWorkOrders(rec.workOrders, r.EMPTY_RECORD_FILTERS);
  const report = x.buildWorkOrderReport(ctx(), all);
  const i219 = report.rows.findIndex((row) => row[0] === '219');
  assert.deepEqual(report.rows[i219].slice(8, 13), [2200, null, null, 200, 2400]); // blanks are null, not zero
  assert.equal(report.header.length, report.rows[0].length);
  const footer = report.footer[0];
  assert.equal(footer[0], 'Grand total');
  assert.equal(footer[8], 17200); assert.equal(footer[11], 200); assert.equal(footer[12], 17400);
  assert.equal(report.hasDraft, true);
  assert.match(report.fileBase, /^DRAFT-EES-finance-work-order-report-20261105$/);
  assert.match(report.banner[0], /^DRAFT\/TEST/);
  // filtered export: only the MASS work orders
  const mass = r.filterWorkOrders(rec.workOrders, filt({ client: 'fixture-MASS' }));
  const massReport = x.buildWorkOrderReport(ctx(filt({ client: 'fixture-MASS' })), mass);
  assert.equal(massReport.rows.length, 3);
  assert.ok(massReport.banner.some((line) => line.includes('Customer: MASS')));
  // CSV: banner, blank row, header, fixed two-decimal money, blank cells stay empty
  const csv = x.tableToCsvRows(massReport);
  assert.equal(csv[massReport.banner.length].length, 0);
  const header = csv[massReport.banner.length + 1];
  assert.equal(header[8], 'Transport');
  const row219 = csv.find((row) => row[0] === '219');
  assert.deepEqual(row219.slice(8, 13), ['2200.00', '', '', '200.00', '2400.00']);
  assert.equal(csv.at(-1)[12], '17400.00');
});

test('TRN register, customer history and monthly statement are built from the same records', () => {
  const rec = r.buildFinanceRecords(massState());
  const matches = r.filterBatches(rec.batches, r.EMPTY_RECORD_FILTERS);
  const register = x.buildTrnRegister(ctx(), matches);
  assert.equal(register.rows.length, 1);
  assert.equal(register.rows[0][0], 'TRN651/2026');
  assert.equal(register.rows[0][1], 'Simulated (local test)');
  // a batch that only has a draft reference (created before test numbering) is never labelled Official or Simulated
  const legacy = clone(massState()); delete legacy.billingSheets[0].simulatedTrn; delete legacy.simulatedTrnLast;
  const legacyRec = r.buildFinanceRecords(legacy);
  assert.equal(legacyRec.batches[0].trnKind, 'draft_ref');
  assert.equal(x.buildTrnRegister(ctx(), r.filterBatches(legacyRec.batches, r.EMPTY_RECORD_FILTERS)).rows[0][1], 'Draft reference (no TRN number)');
  assert.equal(legacyRec.workOrders.find((row) => row.workOrder === '219').trnKind, 'draft_ref');
  assert.equal(legacyRec.workOrders.find((row) => row.workOrder === '2190').trnKind, null);
  const official = clone(massState()); official.billingSheets[0].officialTrn = 'TRN650/2026';
  assert.equal(r.buildFinanceRecords(official).batches[0].trnKind, 'official');
  assert.equal(register.rows[0][5], 3);
  assert.equal(register.rows[0][10], 17400);
  assert.equal(register.rows[0][11], 'Draft');
  const all = r.filterWorkOrders(rec.workOrders, r.EMPTY_RECORD_FILTERS);
  const history = x.buildCustomerHistory(ctx(), all);
  assert.deepEqual(history.rows.map((row) => row[0]), ['Fixture MASS', 'Fixture MASS', 'Fixture MASS', 'Fixture OTHER', 'Fixture OTHER']); // grouped by customer
  assert.equal(history.footer[0][14], 17400);
  const statement = x.buildMonthlyStatement(ctx(), all, '2026-01');
  assert.equal(statement.rows.length, 4); // three work orders + the customer subtotal
  assert.equal(statement.rows[3][0], 'Subtotal — Fixture MASS');
  assert.equal(statement.rows[3][12], 17400);
  assert.equal(statement.footer[0][12], 17400);
  assert.equal(statement.footer[1][12], 0);      // issued part: nothing is issued
  assert.equal(statement.footer[2][12], 17400);  // draft part: not invoiced
  assert.match(statement.fileBase, /monthly-statement-2026-01-20261105$/);
  assert.ok(x.buildMonthlyStatement(ctx(), all, '2026-03').rows.length === 0);
});

test('the Excel export is a real .xlsx workbook with numeric money cells that equal the screen totals', () => {
  const rec = r.buildFinanceRecords(massState());
  const all = r.filterWorkOrders(rec.workOrders, filt({ client: 'fixture-MASS' }));
  const table = x.buildWorkOrderReport(ctx(filt({ client: 'fixture-MASS' })), all);
  const workbook = x.tableToWorkbook(XLSX, table);
  const bytes = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  const back = XLSX.read(bytes, { type: 'buffer', cellNF: true });
  const sheet = back.Sheets[back.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
  const headerIndex = rows.findIndex((row) => row[0] === 'Work order');
  assert.ok(headerIndex > 0);
  const data = rows.slice(headerIndex + 1, headerIndex + 4);
  assert.deepEqual(data.map((row) => row[0]), ['219', '220', '253']);
  assert.deepEqual(data.map((row) => row[12]), [2400, 5000, 10000]);
  assert.ok(data.every((row) => typeof row[12] === 'number'));
  assert.equal(rows[headerIndex + 4][12], 17400);
  // money cells carry a two-decimal number format
  const cell = sheet[XLSX.utils.encode_cell({ r: headerIndex + 1, c: 12 })];
  assert.equal(cell.t, 'n'); assert.equal(cell.z, '#,##0.00');
  // a text cell that looks like a formula stays text (no formula injection through exported data)
  const evil = { ...table, rows: [['=1+1', ...table.rows[0].slice(1)]], footer: [] };
  const evilSheet = XLSX.read(XLSX.write(x.tableToWorkbook(XLSX, evil), { type: 'buffer', bookType: 'xlsx' }), { type: 'buffer' });
  const evilCell = evilSheet.Sheets[evilSheet.SheetNames[0]][XLSX.utils.encode_cell({ r: evil.banner.length + 2, c: 0 })];
  assert.equal(evilCell.t, 's'); assert.equal(evilCell.f, undefined);
});

test('the current-table export follows the active view, visible columns and filters', () => {
  const rec = r.buildFinanceRecords(massState());
  const wo = r.filterWorkOrders(rec.workOrders, filt({ month: '2026-01' }));
  const table = x.buildCurrentTableExport(ctx(filt({ month: '2026-01' }), { view: 'workOrders', workOrderColumns: ['workOrder', 'transport', 'total'] }), wo, []);
  assert.deepEqual(table.header, ['Work order', 'Transport', 'Customer total']);
  assert.equal(table.rows.length, 3);
  assert.deepEqual(table.moneyColumns, [1, 2]);
  assert.equal(table.footer[0][2], 17400);
  const batches = x.buildCurrentTableExport(ctx(r.EMPTY_RECORD_FILTERS, { view: 'batches', batchColumns: ['trn', 'total', 'status'] }), [], r.filterBatches(rec.batches, r.EMPTY_RECORD_FILTERS));
  assert.deepEqual(batches.rows, [['TRN651/2026', 17400, 'Draft']]);
});

test('English and Thai copy have identical keys, and the requested Thai terms are present', () => {
  const keys = (value, prefix = '') => Object.entries(value).flatMap(([key, item]) => (item && typeof item === 'object' ? keys(item, `${prefix}${key}.`) : [`${prefix}${key}`])).sort();
  assert.deepEqual(keys(financeRecordsCopy.th), keys(financeRecordsCopy.en));
  const th = financeRecordsCopy.th;
  assert.equal(th.title, 'ประวัติการเงิน');
  assert.equal(th.search.label, 'ค้นหาใบงาน');
  assert.equal(th.export.trnRegister, 'ทะเบียน TRN');
  assert.equal(th.export.customerHistory, 'ประวัติการวางบิลลูกค้า');
  assert.equal(th.status.draft, 'ฉบับร่าง'); assert.equal(th.status.awaiting_approval, 'รออนุมัติ');
  assert.equal(th.status.approved, 'อนุมัติแล้ว (ยังไม่ออก)'); assert.equal(th.status.issued, 'ออกแล้ว');
  assert.equal(th.status.ready_for_review, 'พร้อมตรวจสอบ');
  assert.equal(th.columns.total, 'ยอดรวมลูกค้า'); assert.equal(th.export.button, 'ส่งออก');
  for (const status of r.RECORD_STATUSES) { assert.ok(financeRecordsCopy.en.status[status]); assert.ok(th.statusHint[status]); }
  // Thai exports use Thai headers
  const rec = r.buildFinanceRecords(massState());
  const table = x.buildWorkOrderReport({ ...ctx(), copy: th, language: 'th' }, rec.workOrders);
  assert.equal(table.header[0], 'เลขที่ใบงาน');
  assert.match(table.banner[0], /^ร่าง\/ทดสอบ/);
});

test('activity history is available to authorized users only; Office-only accounts are refused', () => {
  const admin = { role: 'admin', status: 'active' };
  const office = { role: 'office_staff', status: 'active' };
  assert.equal(access.canViewFinanceActivity(admin, 'admin', false), true);
  assert.equal(access.canViewFinanceActivity(office, 'office', false), false);
  assert.equal(access.canViewFinanceActivity(null, 'office', true), false);
  assert.equal(access.canViewFinanceActivity(null, 'finance', true), true);
  assert.equal(access.canViewFinanceActivity(null, 'management', true), true);
  assert.equal(access.canViewFinanceActivity(null, 'finance', false), false); // simulated roles never grant access outside the isolated fixture
  assert.equal(access.canViewFinanceActivity(null, 'super_admin', false), true);
});

test('there is one authoritative documents workflow: older Documents routes open TRN & Documents', () => {
  const workspace = read('components/finance-centre-workspace.tsx');
  assert.match(workspace, /documents: "trn",\s*drafts: "trn",\s*packs: "trn",\s*approval: "trn"/);
  assert.doesNotMatch(workspace, /Legacy invoices & documents/);
  assert.match(read('app/(dashboard)/invoice-approval/page.tsx'), /<FinanceCentreWorkspace initialSection="trn" \/>/);
  assert.match(read('app/(dashboard)/document-packs/page.tsx'), /<FinanceCentreWorkspace initialSection="trn" \/>/);
  assert.match(read('lib/finance-workspace-routes.ts'), /"\/finance-records"/);
  // The menu definitions now live in lib/office-nav.tsx; the assertion is unchanged.
  assert.match(read('components/top-navigation.tsx') + read('lib/office-nav.tsx'), /href: "\/finance-records"/);
});

test('TRN stage shows a concise status chip and keeps the audit detail in an Activity History panel', () => {
  const docs = read('components/finance-trn-documents-stage.tsx');
  assert.doesNotMatch(docs, /Confirmed by owner — draft ready for review/);
  assert.doesNotMatch(docs, /No TRN or invoice issued\./);
  assert.match(docs, /<FinanceStatusChip status=\{lifecycle\}/);
  assert.match(docs, /<FinanceActivityHistory entries=\{batchActivity\(state, sheet\)\} canView=\{canViewActivity\}/);
  assert.match(docs, /DRAFT \/ TEST — NOT AN ISSUED DOCUMENT/);
  const steps = read('components/finance-centre-workspace.tsx');
  assert.doesNotMatch(steps, /currentSheet\.stage !== "arrange"/); // completion is no longer "the page was visited"
  assert.match(steps, /Completion is derived from saved data only/);
});

test('Finance Records page is guarded: local workspace only, no production data is shown or written', () => {
  const page = read('app/(dashboard)/finance-records/page.tsx');
  assert.match(page, /usesFinanceLocalDemoScreens\(\)\) return <FinanceRecordsWorkspace \/>/);
  const workspace = read('components/finance-records-workspace.tsx');
  assert.doesNotMatch(workspace, /supabase/i);          // no database access of its own
  assert.doesNotMatch(workspace, /\.from\(|\.rpc\(|fetch\(/);
  const records = read('lib/finance-records.ts');
  assert.doesNotMatch(records, /supabase|fetch\(|localStorage/);
  assert.match(workspace, /dispatch\(\{ type: "sheet_reopen"/); // the only write is the existing, guarded reopen action
  assert.equal((workspace.match(/dispatch\(/g) || []).length, 1);
});
