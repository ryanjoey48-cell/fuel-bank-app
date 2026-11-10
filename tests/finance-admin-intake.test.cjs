const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const path = require('node:path');
const { createRequire } = require('node:module');
function load(file, customRequire) {
  const mod = { exports: {} };
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  new Function('module','exports','require',js)(mod, mod.exports, customRequire || createRequire(path.resolve(file)));
  return mod.exports;
}
const f = load('lib/finance-demo-centre.ts');
const authorization = load('lib/authorization.ts');
const intakeAccess = load('lib/finance-intake-access.ts', (name) => {
  if (name === '@/lib/authorization') return authorization;
  if (name === '@/lib/finance-demo-centre') return f;
  return createRequire(path.resolve('lib/finance-intake-access.ts'))(name);
});
const receipts = () => ({ amounts: Object.fromEntries(f.ADMIN_RECEIPT_FIELDS.map((kind) => [kind, null])), notes: '' });
const seed = { id: 'isolated-admin-intake', booking_id: 'BK-INTERNAL-FIXTURE', client_id: 'isolated-client', client_name: 'Isolated client', booking_date: '2026-01-19', pickup: 'Fixture pickup', dropoff: 'Fixture delivery', vehicle_registration: 'FIXTURE', driver: 'Fixture driver' };
test('optional THB parsing distinguishes blank, zero and exact decimal values', () => {
  assert.equal(f.parseOptionalReceiptThb('  '), null);
  assert.equal(f.parseOptionalReceiptThb('0'), 0);
  assert.equal(f.parseOptionalReceiptThb('0.00'), 0);
  assert.equal(f.parseOptionalReceiptThb('12.30'), 12.3);
  for (const bad of ['-1', '1.001', '1,000', 'NaN', 'Infinity', '1e3', '1000000000', '.5']) assert.throws(() => f.parseOptionalReceiptThb(bad));
});
test('intake stores receipts and exact WO on one linked job without verifying or creating billable extras', () => {
  const input = receipts(); input.amounts.parking = 0; input.amounts.toll = 35.25;
  const original = f.createEmptyOwnerState();
  const next = f.linkDiaryWorkOrder(original, seed, '003628.1', 'admin', input);
  const reopened = JSON.parse(JSON.stringify(next));
  const job = reopened.bookings[0];
  assert.equal(f.confirmedWorkOrder(job), '003628.1');
  assert.deepEqual(job.adminReceipts, input);
  assert.equal(job.adminReceipts.amounts.overtime, null);
  assert.equal(job.adminReceipts.amounts.parking, 0);
  assert.equal(job.status, 'pending'); assert.equal(job.price, null);
  assert.equal(job.customerCharges?.length || 0, 0);
  assert.equal(job.expenses.length, 0);
  assert.equal(job.diarySource.booking_id, seed.booking_id);
  assert.equal(original.bookings.length, 0);
  assert.throws(() => f.linkDiaryWorkOrder(next, { ...seed, id: 'isolated-second' }, '003628.1', 'admin', input));
});
test('authenticated Super Admin can record local intake without approving or changing diary source data', () => {
  const input = receipts(); input.amounts.parking = null; input.amounts.toll = 0;
  const original = f.createEmptyOwnerState();
  const next = f.linkDiaryWorkOrder(original, seed, 'ISOLATED-TEST-WO-01', 'super_admin', input);
  const envelope = load('lib/finance-local-persistence.ts')
    .createFinanceLocalStoreEnvelope({ owner: next, previous_demo: f.createEmptyOwnerState() }, 'super_admin', 'owner');
  const reopened = envelope.workspaces.owner;
  assert.equal(f.confirmedWorkOrder(reopened.bookings[0]), 'ISOLATED-TEST-WO-01');
  assert.equal(reopened.bookings[0].adminReceipts.amounts.parking, null);
  assert.equal(reopened.bookings[0].adminReceipts.amounts.toll, 0);
  assert.equal(reopened.bookings[0].status, 'pending');
  assert.equal(reopened.bookings[0].price, null);
  assert.equal(reopened.bookings[0].diarySource.booking_id, seed.booking_id);
  assert.equal(original.bookings.length, 0);
  assert.throws(() => f.linkDiaryWorkOrder(reopened, { ...seed, id: 'isolated-next' }, 'ISOLATED-TEST-WO-01', 'super_admin', input));
  assert.throws(() => f.linkDiaryWorkOrder(original, seed, 'ISOLATED-TEST-WO-02', 'office', input), /DEMO_ROLE_REQUIRED/);
  const provider = fs.readFileSync('components/finance-fixture-provider.tsx', 'utf8');
  const workspace = fs.readFileSync('components/finance-centre-workspace.tsx', 'utf8');
  const picker = fs.readFileSync('components/finance-booking-diary-picker.tsx', 'utf8');
  assert.match(provider, /access\?\.role === "super_admin" && access\.status === "active"/);
  assert.match(provider, /access\?\.role === "admin" \|\| canUseSuperAdmin/);
  assert.match(provider, /nextRole === "super_admin" && !canUseSuperAdmin/);
  assert.match(workspace, /canAdd={canAddDiaryWorkOrder && hydrateReady && !accessLoading}/);
  assert.match(picker, /Save & Next Job/);
  assert.match(picker, /Checking account permissions/);
});
test('verified Admin intake authority survives Act as changes without granting non-admins Admin access', () => {
  const activeAdmin = { role: 'admin', status: 'active' };
  const inactiveAdmin = { role: 'admin', status: 'suspended' };
  const activeOffice = { role: 'office_staff', status: 'active' };
  assert.equal(intakeAccess.canUseFinanceAdminIntake(activeAdmin, 'office', false), true);
  assert.equal(intakeAccess.financeActionActor(activeAdmin, 'office', false, 'verify_job'), 'admin');
  assert.equal(intakeAccess.financeActionActor(activeAdmin, 'finance', false, 'set_price'), 'finance');
  assert.equal(intakeAccess.canUseFinanceAdminIntake(inactiveAdmin, 'office', false), false);
  assert.equal(intakeAccess.canUseFinanceAdminIntake(activeOffice, 'office', false), false);
  assert.equal(intakeAccess.canUseFinanceAdminIntake(activeOffice, 'admin', false), false);
  assert.equal(intakeAccess.canUseFinanceAdminIntake(null, 'admin', true), true);
});
test('isolated 18-job intake preserves each diary source and remains pending for manual verification', () => {
  let state = f.createEmptyOwnerState();
  const sources = Array.from({ length: 18 }, (_, index) => ({
    ...seed,
    id: `isolated-job-${index + 1}`,
    booking_id: `BK-FIXTURE-${index + 1}`
  }));
  for (const [index, source] of sources.entries()) {
    state = f.linkDiaryWorkOrder(state, source, `FIXTURE-WO-${String(index + 1).padStart(2, '0')}`, 'admin', receipts());
  }
  assert.equal(state.bookings.length, 18);
  assert.deepEqual(state.bookings.map((job) => job.diarySource.booking_id), sources.map((source) => source.booking_id).reverse());
  assert.ok(state.bookings.every((job) => job.status === 'pending' && job.price === null));
  assert.throws(() => f.linkDiaryWorkOrder(state, { ...seed, id: 'isolated-next' }, 'FIXTURE-WO-01', 'admin', receipts()));
  const available = sources.map(({ id }) => ({ id }));
  assert.equal(f.nextUnlinkedDiaryBookingId(available, new Set(['isolated-job-1', 'isolated-job-2']), 'isolated-job-2'), 'isolated-job-3');
  assert.equal(f.nextUnlinkedDiaryBookingId(available, new Set(sources.slice(0, 17).map(({ id }) => id)), 'isolated-job-18'), null);
});
test('invalid receipt values fail atomically and internal references remain diagnostic only', () => {
  const s = f.createEmptyOwnerState(); const input = receipts(); input.amounts.parking = -1;
  assert.throws(() => f.linkDiaryWorkOrder(s, seed, '003628', 'admin', input));
  assert.equal(s.bookings.length, 0); assert.equal(s.audit.length, 0);
  assert.throws(() => f.linkDiaryWorkOrder(s, seed, '003628', 'office', receipts()), /DEMO_ROLE_REQUIRED/);
  assert.equal(f.officeJobReference('BK-20261103-170037'), '');
  assert.equal(f.officeJobReference('Customer-19'), 'Customer-19');
  const picker = fs.readFileSync('components/finance-booking-diary-picker.tsx','utf8');
  const cards = picker.slice(picker.indexOf('{filtered.map((row)'), picker.indexOf('<aside'));
  assert.doesNotMatch(cards, /row\.booking_id|row\.job_order_number/);
  assert.match(cards, /text-lg font-bold/);
  assert.match(picker, /Save & Next Job/);
  assert.match(picker, /await onAddWorkOrder/);
});
test('source changes revoke verification, handover and price confirmation without changing amounts', () => {
  let s = f.linkDiaryWorkOrder(f.createEmptyOwnerState(), seed, '003628', 'admin', receipts());
  s.bookings[0].status = 'verified'; s.bookings[0].handover = { readyAt: 'fixture', receivedAt: 'fixture' };
  s.bookings[0].price = { amount: 1500, source: 'manual', label: 'Fixture', reason: 'Isolated test only', confirmed: true };
  const next = f.upsertDiaryBooking(s, { ...seed, dropoff: 'Changed fixture delivery' });
  assert.equal(next.bookings[0].status, 'needs_recheck'); assert.equal(next.bookings[0].handover, undefined);
  assert.equal(next.bookings[0].price.confirmed, false); assert.equal(next.bookings[0].price.amount, 1500);
  assert.equal(s.bookings[0].status, 'verified');
});

test('save confirms persisted null/zero receipt values and rejects failed or incomplete acknowledgements', async () => {
  const persistence = load('lib/finance-local-persistence.ts');
  const saver = load('lib/finance-local-save.ts', (name) => name === './finance-local-persistence' ? persistence : require(name));
  const entry = { ...receipts(), customerJobNumber: "000-SOO4565453" }; entry.amounts.parking = 0; entry.amounts.toll = 25.50;
  const owner = f.linkDiaryWorkOrder(f.createEmptyOwnerState(),seed,'003628','admin',entry);
  const spaces = { owner, previous_demo: f.createEmptyOwnerState() };
  const envelope = persistence.createFinanceLocalStoreEnvelope(spaces,'admin','owner');
  const saved = await saver.saveFinanceLocalWorkspace(spaces,'admin','owner',{},async (url,options) => {
    assert.equal(url,'/api/finance-local-store'); const body = JSON.parse(options.body);
    assert.equal(body.workspaces.owner.bookings[0].adminReceipts.amounts.parking,0);
    assert.equal(body.workspaces.owner.bookings[0].adminReceipts.amounts.overtime,null);
    return Response.json({envelope});
  });
  assert.deepEqual(saved.workspaces.owner.bookings[0].adminReceipts,entry);
  await assert.rejects(saver.saveFinanceLocalWorkspace(spaces,'admin','owner',{},async()=>Response.json({error:'fixture disk failure'},{status:500})),/FINANCE_SAVE_FAILED/);
  await assert.rejects(saver.saveFinanceLocalWorkspace(spaces,'admin','owner',{},async()=>Response.json({ok:true})),/FINANCE_SAVE_NOT_CONFIRMED/);
  const wrong=persistence.createFinanceLocalStoreEnvelope({owner:f.createEmptyOwnerState(),previous_demo:spaces.previous_demo},'admin','owner');
  await assert.rejects(saver.saveFinanceLocalWorkspace(spaces,'admin','owner',{},async()=>Response.json({envelope:wrong})),/FINANCE_SAVE_NOT_CONFIRMED/);
});

test('customer shipment references round-trip blank, alphanumeric and leading-zero text independently of WO and booking ID', () => {
  const persistence = load('lib/finance-local-persistence.ts');
  for (const reference of ['', 'SOO4565453', '0000123', '00-AB/07.5 #ไทย']) {
    const source = structuredClone(seed);
    const before = structuredClone(source);
    const entry = { ...receipts(), customerJobNumber: reference };
    entry.amounts.parking = 0; entry.amounts.toll = 35.25;
    const state = f.linkDiaryWorkOrder(f.createEmptyOwnerState(), source, 'ISOLATED-WO-0007', 'admin', entry);
    const envelope = persistence.createFinanceLocalStoreEnvelope({ owner: state, previous_demo: f.createEmptyOwnerState() }, 'admin', 'owner');
    const job = persistence.parseFinanceLocalStoreJson(JSON.stringify(envelope)).workspaces.owner.bookings[0];
    assert.equal(job.adminReceipts.customerJobNumber, reference || null);
    assert.equal(f.customerJobReference(job), reference);
    assert.equal(f.confirmedWorkOrder(job), 'ISOLATED-WO-0007');
    assert.equal(job.jobNumber, seed.booking_id);
    assert.equal(job.diarySource.booking_id, seed.booking_id);
    assert.deepEqual(source, before);
    assert.equal(job.adminReceipts.amounts.parking, 0);
    assert.equal(job.adminReceipts.amounts.toll, 35.25);
    assert.equal(f.customerJobNumberDiffers(job), false);
    assert.doesNotMatch(f.displayJobLabel(job), /BK-/);
  }
});

test('booking-provided customer reference is prefilled without confusing it with the diary WO', () => {
  const source = { ...seed, customer_job_number: '000-BOOKING/09', job_order_number: 'DIARY-WO' };
  const before = structuredClone(source);
  const s = f.linkDiaryWorkOrder(f.createEmptyOwnerState(), source, 'GREEN-WO', 'admin', receipts());
  const job = s.bookings[0];
  assert.equal(f.customerJobReference(job), source.customer_job_number);
  assert.equal(job.adminReceipts.originalCustomerJobNumber, source.customer_job_number);
  assert.equal(f.confirmedWorkOrder(job), 'GREEN-WO');
  assert.equal(job.diarySource.job_order_number, 'DIARY-WO');
  assert.deepEqual(source, before);
});

test('different or explicitly cleared reference preserves original and follows management reconciliation', () => {
  for (const entered of ['000-RETURNED/10', '']) {
    const source = { ...seed, customer_job_number: '000-BOOKING/09' };
    let state = f.linkDiaryWorkOrder(f.createEmptyOwnerState(), source, 'GREEN-WO', 'admin', { ...receipts(), customerJobNumber: entered });
    let job = state.bookings[0];
    assert.equal(f.customerJobReference(job), entered);
    assert.equal(job.adminReceipts.originalCustomerJobNumber, '000-BOOKING/09');
    assert.equal(job.diarySource.customer_job_number, '000-BOOKING/09');
    assert.equal(f.customerJobNumberDiffers(job), true);
    state = f.applyAction(state, { type: 'set_returned_details', jobId: seed.id, fields: { client: job.client, date: job.date, pickup: job.pickup, delivery: job.delivery, driver: job.driver, vehicle: job.vehicle } }, 'admin');
    for (const kind of f.requiredDocKinds(state, seed.id)) {
      state = f.applyAction(state, { type: 'add_document', jobId: seed.id, kind }, 'admin');
      const doc = state.documents.at(-1);
      state = f.applyAction(state, { type: 'confirm_document', documentId: doc.id, jobId: seed.id, physicalRef: 'Isolated automated fixture cabinet' }, 'admin');
    }
    state = f.applyAction(state, { type: 'verify_job', jobId: seed.id }, 'admin');
    assert.equal(state.bookings[0].status, 'discrepancy');
    assert.match(state.audit.at(-1).detail, /Customer Job Number/);
    assert.equal(f.ready(state, seed.id), false);
    state = f.applyAction(state, { type: 'resolve_discrepancy', jobId: seed.id, reason: 'Isolated fixture management confirmation of returned customer reference' }, 'management');
    state = f.applyAction(state, { type: 'verify_job', jobId: seed.id }, 'admin');
    assert.equal(state.bookings[0].status, 'verified');
    state = f.upsertDiaryBooking(state, { ...source, notes: 'Isolated refresh' });
    assert.equal(f.customerJobReference(state.bookings[0]), entered);
    assert.equal(state.bookings[0].adminReceipts.originalCustomerJobNumber, '000-BOOKING/09');
    assert.equal(source.customer_job_number, '000-BOOKING/09');
  }
});

test('customer reference carries through Admin handover, Finance receipt, billing and printed draft without re-entry', () => {
  const source = { ...seed, customer_job_number: '000-BOOKING/09' };
  let state = f.linkDiaryWorkOrder(f.createEmptyOwnerState(), source, 'ISOLATED-WO-09', 'admin', { ...receipts(), customerJobNumber: '000-BOOKING/09' });
  const job = state.bookings[0];
  state = f.applyAction(state, { type: 'set_returned_details', jobId: seed.id, fields: { client: job.client, date: job.date, pickup: job.pickup, delivery: job.delivery, driver: job.driver, vehicle: job.vehicle } }, 'admin');
  state = f.applyAction(state, { type: 'add_document', jobId: seed.id, kind: 'green_order' }, 'admin');
  state = f.applyAction(state, { type: 'confirm_document', documentId: state.documents.at(-1).id, jobId: seed.id, physicalRef: 'Isolated cabinet' }, 'admin');
  state = f.applyAction(state, { type: 'verify_job', jobId: seed.id }, 'admin');
  state = f.applyAction(state, { type: 'ready_handover', jobId: seed.id }, 'admin');
  state = f.applyAction(state, { type: 'receive_paper', jobId: seed.id }, 'finance');
  state = f.applyAction(state, { type: 'set_price', jobId: seed.id, source: 'manual', amount: 1500, reason: 'Isolated approved fixture customer price' }, 'finance');
  state = f.applyAction(state, { type: 'create_batch', clientId: job.clientId, week: f.weekOf(job.date) }, 'finance');
  const batchId = state.batches.at(-1).id;
  state = f.applyAction(state, { type: 'allocate_job', batchId, jobId: seed.id }, 'finance');
  state = f.applyAction(state, { type: 'create_draft', batchId }, 'finance');
  const reopened = JSON.parse(JSON.stringify(state));
  assert.equal(f.customerJobReference(reopened.bookings[0]), '000-BOOKING/09');
  assert.equal(reopened.bookings[0].handover.receivedBy, 'finance');
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const print = load('components/finance-demo-print.tsx', (name) => {
    if (name === '@/lib/finance-demo-centre') return f;
    if (name === '@/lib/finance-demo-copy') return load('lib/finance-demo-copy.ts');
    if (name === '@/lib/ees-company') return load('lib/ees-company.ts');
    return require(name);
  });
  const html = renderToStaticMarkup(React.createElement(print.default, { state: reopened, batch: reopened.batches[0], language: 'en', preview: true }));
  assert.match(html, /Customer Job Number/);
  assert.match(html, /000-BOOKING\/09/);
  assert.match(html, /ISOLATED-WO-09/);
});
