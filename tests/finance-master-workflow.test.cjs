const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const path = require('node:path');
const { createRequire } = require('node:module');
const file = path.resolve('lib/finance-demo-centre.ts');
const mod = { exports: {} };
new Function('module', 'exports', 'require', ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText)(mod, mod.exports, createRequire(file));
const f = mod.exports;
const seed = (id = 'fixture-a') => ({ id, client_id: 'fixture-client', client_name: 'Isolated fixture', booking_date: '2026-01-19', pickup: 'Fixture pickup', dropoff: 'Fixture delivery', driver: 'Fixture driver', vehicle_registration: 'FIXTURE' });
const run = (s, action, role = 'finance') => f.applyAction(s, action, role);
function verified(s, id) {
  const job = s.bookings.find((j) => j.id === id);
  s = run(s, { type: 'set_returned_details', jobId: id, fields: { date: job.date, pickup: job.pickup, delivery: job.delivery, driver: job.driver, vehicle: job.vehicle } }, 'admin');
  s = run(s, { type: 'add_document', jobId: id, kind: 'green_order' }, 'admin');
  const doc = s.documents.find((d) => d.suggestedJobId === id);
  s = run(s, { type: 'confirm_document', jobId: id, documentId: doc.id, physicalRef: 'Isolated fixture cabinet' }, 'admin');
  for (const kind of ['parking', 'toll']) s = run(s, { type: 'waive_document', jobId: id, kind, reason: 'No fixture expense incurred' }, 'admin');
  return run(s, { type: 'verify_job', jobId: id }, 'admin');
}
test('atomic selection preserves exact string identifiers and leaves originals untouched', () => {
  let s = f.createEmptyOwnerState();
  const original = seed();
  s = f.linkDiaryWorkOrder(s, original, '003628.1', 'admin');
  assert.equal(f.confirmedWorkOrder(s.bookings[0]), '003628.1');
  assert.equal(s.bookings[0].status, 'pending');
  assert.equal(original.job_order_number, undefined);
  assert.throws(() => f.linkDiaryWorkOrder(s, seed('b'), '003628.1', 'admin'));
  assert.equal(s.bookings.length, 1);
  assert.throws(() => f.linkDiaryWorkOrder(s, original, '999', 'admin'));
  s = f.linkDiaryWorkOrder(s, seed('b'), '003628', 'admin');
  assert.equal(s.bookings.length, 2);
  assert.throws(() => f.linkDiaryWorkOrder(s, seed('c'), '999', 'finance'));
});
test('handover requires Admin verification and release plus explicit Finance receipt', () => {
  let s = f.linkDiaryWorkOrder(f.createEmptyOwnerState(), seed(), '00123', 'admin');
  assert.throws(() => run(s, { type: 'receive_paper', jobId: 'fixture-a' }));
  assert.throws(() => run(s, { type: 'ready_handover', jobId: 'fixture-a' }, 'admin'));
  s = verified(s, 'fixture-a');
  assert.equal(s.bookings[0].handover, undefined);
  s = run(s, { type: 'ready_handover', jobId: 'fixture-a' }, 'admin');
  assert.equal(s.bookings[0].handover.receivedAt, undefined);
  assert.throws(() => run(s, { type: 'receive_paper', jobId: 'fixture-a' }, 'office'));
  s = run(s, { type: 'receive_paper', jobId: 'fixture-a' });
  assert.ok(s.bookings[0].handover.receivedAt);
});
test('customer paper sequence supports reordering, removal and refresh without deleting jobs', () => {
  let s = f.createEmptyOwnerState();
  for (const [id, wo] of [['fixture-a', '00123'], ['fixture-b', '00124']]) {
    s = f.linkDiaryWorkOrder(s, seed(id), wo, 'admin');
    s = verified(s, id);
    s = run(s, { type: 'ready_handover', jobId: id }, 'admin');
    s = run(s, { type: 'receive_paper', jobId: id });
  }
  s = run(s, { type: 'create_paper_stack', clientId: 'fixture-client', week: '2026-01-19' });
  const stackId = s.paperStacks[0].id;
  s = run(s, { type: 'add_stack_paper', stackId, jobId: 'fixture-b' });
  s = run(s, { type: 'add_stack_paper', stackId, jobId: 'fixture-a' });
  assert.throws(() => run(s, { type: 'add_stack_paper', stackId, jobId: 'fixture-a' }));
  const before = JSON.stringify(s);
  s = run(s, { type: 'move_stack_paper', stackId, jobId: 'fixture-a', direction: -1 });
  assert.deepEqual(JSON.parse(before).paperStacks[0].jobIds, ['fixture-b', 'fixture-a']);
  assert.deepEqual(JSON.parse(JSON.stringify(s)).paperStacks[0].jobIds, ['fixture-a', 'fixture-b']);
  s = run(s, { type: 'remove_stack_paper', stackId, jobId: 'fixture-a' });
  assert.equal(s.bookings.length, 2);
  assert.deepEqual(s.paperStacks[0].jobIds, ['fixture-b']);
});

test('paper stack feeds weekly draft in physical order with decimal-safe customer extras', () => {
  let s = f.createEmptyOwnerState();
  for (const [id, wo] of [['fixture-a', '00123'], ['fixture-b', '00124']]) {
    s = f.linkDiaryWorkOrder(s, seed(id), wo, 'admin');
    s = verified(s, id);
    s = run(s, { type: 'ready_handover', jobId: id }, 'admin');
    s = run(s, { type: 'receive_paper', jobId: id });
    s = run(s, { type: 'set_price', jobId: id, source: 'manual', amount: 100.10, reason: 'Isolated fixture approved quotation' });
  }
  s = run(s, { type: 'add_customer_charge', jobId: 'fixture-a', charge: { category: 'parking', amount: 0.20, evidence: 'Fixture receipt A' } });
  assert.equal(f.customerTotal(s.bookings.find((job) => job.id === 'fixture-a')), 100.30);
  assert.throws(() => run(s, { type: 'add_customer_charge', jobId: 'fixture-a', charge: { category: 'other', amount: 50, evidence: ' fixture receipt a ' } }));
  assert.throws(() => run(s, { type: 'add_customer_charge', jobId: 'fixture-a', charge: { category: 'toll', amount: 0.001, evidence: 'Fixture receipt B' } }));
  s = run(s, { type: 'create_paper_stack', clientId: 'fixture-client', week: '2026-01-19' });
  const stackId = s.paperStacks[0].id;
  for (const id of ['fixture-b', 'fixture-a']) s = run(s, { type: 'add_stack_paper', stackId, jobId: id });
  s = run(s, { type: 'create_batch', clientId: 'fixture-client', week: '2026-01-19' });
  const batchId = s.batches[0].id;
  s = run(s, { type: 'allocate_paper_stack', stackId, batchId });
  assert.deepEqual(s.batches[0].jobIds, ['fixture-b', 'fixture-a']);
  assert.equal(f.batchTotal(s, s.batches[0]), 200.40);
  s = run(s, { type: 'create_draft', batchId });
  assert.equal(s.batches[0].draft, true);
  assert.equal(f.hasFinalTrnNumber(s), false);
  assert.throws(() => run(s, { type: 'add_customer_charge', jobId: 'fixture-a', charge: { category: 'other', amount: 10, evidence: 'Fixture receipt C' } }));
});
