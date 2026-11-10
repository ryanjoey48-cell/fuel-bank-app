const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const h = require('./helpers/invoice-compare.cjs');
const f = h.lib('finance-demo-centre.ts');
const q = h.lib('finance-intake-query.ts');
const guard = h.lib('finance-write-guard.ts');
const seed = i => ({ id: 'v101-' + i, booking_id: 'BK-' + i, client_id: 'v101-client', client_name: 'Isolated customer', booking_date: '2026-01-19', pickup_time: '08:30', pickup: 'Pickup', dropoff: 'Delivery', driver: 'Driver', vehicle_registration: 'FIXTURE' });
const receipts = { amounts: Object.fromEntries(f.ADMIN_RECEIPT_FIELDS.map(kind => [kind, null])), notes: '' };
const options = { dateFrom: '', dateTo: '', search: '', vehicle: '', customer: '', driver: '', status: 'all', page: 1, pageSize: 50 };
function state() {
  let s = f.linkDiaryWorkOrder(f.createEmptyOwnerState(), seed(1), '101', 'admin', receipts);
  s = f.linkDiaryWorkOrder(s, seed(2), '102', 'admin', receipts);
  s = f.applyAction(s, { type: 'sheet_create', clientId: 'v101-client' }, 'finance');
  s = f.applyAction(s, { type: 'sheet_add_paper', sheetId: s.billingSheets[0].id, workOrder: '101' }, 'finance');
  return f.applyAction(s, { type: 'sheet_set_transport', sheetId: s.billingSheets[0].id, jobId: seed(1).id, transport: { amount: 100, source: 'manual', overrideReason: 'Isolated fixture manual price' } }, 'finance');
}
test('bounded pages reach historical records beyond 1000 without duplication or truncation', () => {
  const rows = Array.from({ length: 1051 }, (_, i) => seed(i));
  const pages = Array.from({ length: 22 }, (_, i) => q.fixtureIntakePage(rows, { ...options, page: i + 1 }, []));
  assert.ok(pages.every(page => page.count === 1051 && page.rows.length <= 50));
  assert.equal(new Set(pages.flatMap(page => page.rows.map(row => row.id))).size, 1051);
  assert.deepEqual(q.intakePageBounds(2, 25), { from: 25, to: 49, pageSize: 25 });
  assert.deepEqual(q.intakePageBounds(-1, 150), { from: 0, to: 49, pageSize: 50 });
});
test('customer, driver, vehicle, date, booking and job reference predicates apply before paging', () => {
  const rows = [seed(1), { ...seed(2), booking_date: '2025-01-01', customer_job_number: '000-ABC' }];
  for (const filter of [{ search: '000-ABC' }, { dateTo: '2025-12-31' }, { search: 'BK-2' }]) assert.equal(q.fixtureIntakePage(rows, { ...options, ...filter }, []).rows[0].id, seed(2).id);
  for (const filter of [{ customer: 'absent' }, { driver: 'absent' }, { vehicle: 'absent' }, { dateFrom: '2027-01-01' }]) assert.equal(q.fixtureIntakePage(rows, { ...options, ...filter }, []).count, 0);
});
test('verification and paperwork filters use saved canonical state', () => {
  const s = state();
  s.bookings[0].status = 'verified';
  const rows = [seed(1), seed(2), seed(3)];
  assert.equal(q.fixtureIntakePage(rows, { ...options, status: 'waiting' }, s.bookings).count, 1);
  assert.equal(q.fixtureIntakePage(rows, { ...options, status: 'verified' }, s.bookings).count, 1);
});
test('PostgREST receives exactly one requested booking page and exact count; failures are not empty successes', async () => {
  const calls = [];
  let error = null;
  const supabase = { from(table) {
    const query = {};
    for (const method of ['select','order','range','gte','lte','ilike','or','in','not']) query[method] = (...args) => { calls.push([table, method, ...args]); return query; };
    query.then = resolve => Promise.resolve({ data: [seed(1)], count: 1051, error }).then(resolve);
    return query;
  } };
  const module = { exports: {} };
  const js = ts.transpileModule(fs.readFileSync('components/finance-booking-diary-picker.tsx','utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  new Function('module','exports','require',js)(module,module.exports,name => name === '@/lib/supabase' ? { supabase, supabaseConfigError: null } : name === '@/lib/finance-intake-query' ? q : {});
  const load = module.exports.loadBookingDiaryIntakePage;
  const result = await load({ ...options, page: 21, dateFrom: '2020-01-01', vehicle: 'FIXTURE', customer: 'Isolated', driver: 'Driver' }, []);
  assert.equal(result.count, 1051);
  assert.deepEqual(calls.filter(call => call[0] === 'booking_diary' && call[1] === 'range'), [['booking_diary','range',1000,1049]]);
  assert.ok(calls.some(call => call[1] === 'select' && call[3].count === 'exact'));
  assert.ok(calls.some(call => call[1] === 'ilike' && call[2] === 'client.name'));
  error = { message: 'Fixture query failure' };
  const failure = await load(options, []);
  assert.equal(failure.error, 'Fixture query failure');
  assert.equal(failure.rows.length, 0);
});
test('server guard rejects cross-group booking and canonical work-order duplicates', () => {
  const previous = state();
  const next = structuredClone(previous);
  next.billingSheets.push({ ...structuredClone(next.billingSheets[0]), id: 'other' });
  assert.throws(() => guard.assertFinanceBillingWrite(previous, next), /FINANCE_DUPLICATE_BILLING/);
  next.billingSheets[1].jobIds = [seed(2).id];
  next.bookings.find(job => job.id === seed(2).id).returned.workOrder = '101';
  assert.throws(() => guard.assertFinanceBillingWrite(previous, next), /FINANCE_DUPLICATE_BILLING/);
});
test('server guard locks approved figures, source receipts, deletion and issuance', () => {
  const previous = state();
  previous.billingSheets[0].readyForApprovalAt = 'fixture';
  previous.billingSheets[0].approvedAt = 'fixture';
  guard.assertFinanceBillingWrite(previous, structuredClone(previous));
  for (const mutate of [s => s.billingSheets[0].lines[seed(1).id].transport.amount++, s => s.billingSheets.pop(), s => s.bookings.find(job => job.id === seed(1).id).adminReceipts.amounts.toll = 50, s => s.billingSheets[0].officialTrn = 'TRN999/2026']) {
    const next = structuredClone(previous); mutate(next);
    assert.throws(() => guard.assertFinanceBillingWrite(previous, next), /LOCKED|ISSUANCE/);
  }
});
test('reopen must be separate, auditable and preserve figures until a later edit', () => {
  let previous = state();
  const id = previous.billingSheets[0].id;
  previous = f.applyAction(previous, { type: 'sheet_mark_ready', sheetId: id }, 'finance');
  previous = f.applyAction(previous, { type: 'sheet_approve', sheetId: id }, 'approver');
  const next = f.applyAction(previous, { type: 'sheet_reopen', sheetId: id, reason: 'Correct isolated fixture amount' }, 'finance');
  guard.assertFinanceBillingWrite(previous, next);
  const changed = f.applyAction(next, { type: 'sheet_set_transport', sheetId: id, jobId: seed(1).id, transport: { amount: 200, source: 'manual' } }, 'finance');
  guard.assertFinanceBillingWrite(next, changed);
  const silent = structuredClone(next); silent.audit = previous.audit;
  assert.throws(() => guard.assertFinanceBillingWrite(previous, silent), /AUDIT_REQUIRED/);
});
test('missing-number paperwork can be flagged, but cannot be confirmed or billed as entered', () => {
  const s = f.linkDiaryWorkOrder(f.createEmptyOwnerState(), seed(1), '', 'admin', receipts, { result: 'different', note: '[Missing Work Order Number] Number unreadable' });
  assert.equal(f.confirmedWorkOrder(s.bookings[0]), '');
  assert.equal(s.bookings[0].status, 'discrepancy');
  assert.equal(q.fixtureIntakePage([seed(1)], { ...options, status: 'flagged' }, s.bookings).count, 1);
  assert.throws(() => f.applyAction(s, { type: 'admin_save_intake', jobId: seed(1).id, workOrder: '', receipts, check: { result: 'matches', note: '' } }, 'admin'), /WO_REQUIRED|INCOMPLETE/);
});
test('Confirm Job refuses incomplete booking facts and does not approve prices', () => {
  const incomplete = f.linkDiaryWorkOrder(f.createEmptyOwnerState(), { ...seed(1), driver: '' }, '101', 'admin', receipts);
  assert.throws(() => f.applyAction(incomplete, { type: 'admin_save_intake', jobId: seed(1).id, workOrder: '101', receipts, check: { result: 'matches', note: '' } }, 'admin'), /INCOMPLETE/);
  assert.equal(incomplete.bookings[0].status, 'pending');
  assert.equal(incomplete.bookings[0].price, null);
});

test('ambiguous legacy paperwork must be corrected before assignment', () => {
 const s = state(); const other = s.bookings.find(job=>job.id===seed(2).id); other.returned.workOrder='101';
 const result=f.lookupWorkOrderForSheet(s,s.billingSheets[0],'101');assert.equal(result.kind,'ambiguous');assert.equal(result.candidates.length,2);
 assert.throws(()=>f.applyAction(s,{type:'sheet_add_paper',sheetId:s.billingSheets[0].id,workOrder:'101'},'finance'),/AMBIGUOUS/);
});
test('receipt corrections revoke verification and record old and new evidence', () => {
 let s=state();s.bookings.find(job=>job.id===seed(2).id).status='verified';
 s=f.applyAction(s,{type:'admin_save_intake',jobId:seed(2).id,workOrder:'102',receipts:{...receipts,amounts:{...receipts.amounts,toll:25}},check:null},'admin');
 assert.equal(s.bookings.find(job=>job.id===seed(2).id).status,'needs_recheck');assert.match(s.audit.at(-1).detail,/before.*after/);
});

test('atomic replacement retries transient Windows locks without altering the previous file', async () => {
 const server=h.lib('finance-local-store-server.ts');let calls=0;let previous='old';const waits=[];
 await server.replaceFinanceFileAtomically('temporary','destination',async()=>{calls++;if(calls<3){assert.equal(previous,'old');throw Object.assign(new Error('locked'),{code:'EPERM'});}previous='new';},async ms=>{waits.push(ms);assert.equal(previous,'old');});
 assert.equal(calls,3);assert.equal(previous,'new');assert.deepEqual(waits,[50,100]);
});
test('persistent replacement failure is bounded and preserves the old state', async () => {
 const server=h.lib('finance-local-store-server.ts');let calls=0;let previous='old';
 await assert.rejects(server.replaceFinanceFileAtomically('temporary','destination',async()=>{calls++;throw Object.assign(new Error('locked'),{code:'EACCES'});},async()=>{}),/locked/);
 assert.equal(calls,21);assert.equal(previous,'old');
});
test('atomic replacement immediately surfaces errors unrelated to a transient lock', async () => {
 const server=h.lib('finance-local-store-server.ts');let waits=0;
 await assert.rejects(server.replaceFinanceFileAtomically('temporary','destination',async()=>{throw Object.assign(new Error('disk failure'),{code:'EIO'});},async()=>{waits++;}),/disk failure/);assert.equal(waits,0);
});
