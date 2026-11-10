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
const read = (file) => fs.readFileSync(file, 'utf8');

// Isolated fixtures only — never real EES customers, work orders or numbers.
const receipts = () => ({ amounts: Object.fromEntries(f.ADMIN_RECEIPT_FIELDS.map((kind) => [kind, null])), notes: '' });
const seed = (id, client) => ({ id, booking_id: `BK-FX-${id}`, client_id: `fixture-${client}`, client_name: `Fixture ${client}`, booking_date: '2026-01-19', pickup: 'Pickup', dropoff: 'Delivery', vehicle: '4W', vehicle_registration: `FX-${id}`, driver: 'Fixture driver' });
function stateWith(...customers) {
  let s = f.createEmptyOwnerState();
  customers.forEach((name, index) => { s = f.linkDiaryWorkOrder(s, seed(`j-${name}`, name), `FX-${index + 1}00`, 'admin', receipts()); });
  return s;
}
const create = (s, name, context) => f.applyAction(s, { type: 'sheet_create', clientId: `fixture-${name}` }, 'finance', context);
const act = (s, action) => f.applyAction(s, action, 'finance');
const clone = (value) => JSON.parse(JSON.stringify(value));
const trns = (s) => s.billingSheets.map((sheet) => sheet.simulatedTrn);

test('format and parsing: exact TRN###/2026, series anchored at the owner-stated last issued TRN650/2026', () => {
  assert.deepEqual({ ...f.SIMULATED_TRN_SERIES }, { year: 2026, lastIssued: 650 });
  assert.equal(f.formatSimulatedTrn(651), 'TRN651/2026');
  assert.equal(f.formatSimulatedTrn(5), 'TRN005/2026');
  assert.equal(f.formatSimulatedTrn(1000), 'TRN1000/2026');
  assert.equal(f.simulatedTrnNumber('TRN651/2026'), 651);
  assert.equal(f.simulatedTrnNumber('TRN651/2025'), null);
  assert.equal(f.simulatedTrnNumber('DRAFT-2026-001'), null);
  assert.equal(f.simulatedTrnNumber(undefined), null);
  assert.equal(f.sheetFileReference({ simulatedTrn: 'TRN651/2026', draftReference: 'DRAFT-2026-003' }), 'TRN651-2026');
  assert.equal(f.sheetFileReference({ draftReference: 'DRAFT-2026-001' }), 'DRAFT-2026-001');
});

test('first new batch is TRN651/2026, then TRN652, TRN653, TRN654 in strict sequence; official TRN stays unissued', () => {
  let s = stateWith('A', 'B', 'C', 'D');
  assert.equal(f.peekNextSimulatedTrn(s), 'TRN651/2026');
  assert.equal(s.simulatedTrnLast, undefined); // peeking allocates nothing
  for (const name of ['A', 'B', 'C', 'D']) s = create(s, name);
  assert.deepEqual(trns(s), ['TRN651/2026', 'TRN652/2026', 'TRN653/2026', 'TRN654/2026']);
  assert.equal(s.simulatedTrnLast, 654);
  assert.equal(f.peekNextSimulatedTrn(s), 'TRN655/2026');
  for (const sheet of s.billingSheets) {
    assert.match(sheet.simulatedTrn, /^TRN\d{3}\/2026$/);
    assert.equal(sheet.officialTrn, null);
    assert.equal(f.sheetTrnLabel(sheet), sheet.simulatedTrn);
  }
  assert.equal(new Set(trns(s)).size, 4);
  assert.equal(f.hasFinalTrnNumber(s), false);
  // the audit trail names the simulated number and says it is not an issued TRN
  const entry = s.audit.filter((item) => item.action === 'sheet_create')[0];
  assert.equal(entry.subject, 'TRN651/2026');
  assert.match(entry.detail, /simulated TRN651\/2026 \(local test only — not an issued TRN/);
});

test('the same number stays on the same batch: stage changes, papers, prices, ready and reopen never change or consume it', () => {
  let s = create(stateWith('A', 'B'), 'A');
  const id = s.billingSheets[0].id;
  const jobId = 'j-A';
  s = act(s, { type: 'sheet_add_paper', sheetId: id, workOrder: 'FX-100' });
  const check = (label) => {
    assert.equal(s.billingSheets.length, 1, label);
    assert.equal(s.billingSheets[0].simulatedTrn, 'TRN651/2026', label);
    assert.equal(s.simulatedTrnLast, 651, label);
  };
  for (const stage of ['billing', 'documents', 'arrange', 'documents', 'billing', 'arrange']) { s = act(s, { type: 'sheet_set_stage', sheetId: id, stage }); check(`stage ${stage}`); }
  s = act(s, { type: 'sheet_set_transport', sheetId: id, jobId, transport: { amount: 1800, source: 'manual' } }); check('price');
  s = act(s, { type: 'sheet_mark_ready', sheetId: id }); check('ready');
  s = act(s, { type: 'sheet_reopen', sheetId: id, reason: 'Fixture correction' }); check('reopen');
  s = clone(s); check('after save + reload (JSON round trip)');
  // switching stages did not use up a number: the next distinct batch is 652
  s = create(s, 'B');
  assert.deepEqual(trns(s), ['TRN651/2026', 'TRN652/2026']);
});

test('a second batch for the same customer is refused and the refusal consumes no number', () => {
  let s = create(stateWith('A', 'B'), 'A');
  assert.throws(() => create(s, 'A'), /FINANCE_SHEET_ALREADY_OPEN/);
  assert.equal(f.peekNextSimulatedTrn(s), 'TRN652/2026');
  assert.equal(s.simulatedTrnLast, 651);
  s = create(s, 'B');
  assert.equal(s.billingSheets[1].simulatedTrn, 'TRN652/2026');
});

test('numbering survives saving and reloading, and a removed draft number is never handed out again', () => {
  let s = create(create(stateWith('A', 'B', 'C'), 'A'), 'B');
  s = clone(s); // persisted + reloaded
  assert.deepEqual(trns(s), ['TRN651/2026', 'TRN652/2026']);
  // simulate a draft batch being removed/cancelled: the high-water mark remains
  s.billingSheets = s.billingSheets.filter((sheet) => sheet.simulatedTrn !== 'TRN652/2026');
  s = create(s, 'C');
  assert.equal(s.billingSheets.at(-1).simulatedTrn, 'TRN653/2026');
  assert.ok(!trns(s).includes('TRN652/2026'));
  // an older saved state with batches but no stored counter still never repeats a number
  const older = clone(s); delete older.simulatedTrnLast; older.billingSheets[0].simulatedTrn = 'TRN655/2026';
  assert.equal(f.peekNextSimulatedTrn(older), 'TRN656/2026');
});

test('batches created before the numbering existed keep their draft reference and are never renumbered', () => {
  let s = create(stateWith('A', 'B'), 'A');
  // emulate a legacy batch: no simulated TRN, no counter
  delete s.billingSheets[0].simulatedTrn; delete s.simulatedTrnLast;
  const legacyBefore = clone(s.billingSheets[0]);
  s = create(s, 'B');
  assert.deepEqual(s.billingSheets[0], legacyBefore);
  assert.equal(f.sheetTrnLabel(s.billingSheets[0]), legacyBefore.draftReference);
  assert.match(legacyBefore.draftReference, /^DRAFT-\d{4}-001$/);
  assert.equal(s.billingSheets[1].simulatedTrn, 'TRN651/2026');
  assert.match(s.billingSheets[1].draftReference, /^DRAFT-\d{4}-002$/);
  assert.equal(f.sheetTrnLabel(s.billingSheets[1]), 'TRN651/2026');
});

test('numbers are unique across both local workspaces (owner + previous demonstration)', () => {
  const owner = create(stateWith('A', 'B'), 'A');
  const demo = stateWith('X');
  const demoWithSheet = create(demo, 'X', { siblingStates: [owner] });
  assert.equal(demoWithSheet.billingSheets[0].simulatedTrn, 'TRN652/2026');
  const ownerNext = create(owner, 'B', { siblingStates: [demoWithSheet] });
  assert.equal(ownerNext.billingSheets.at(-1).simulatedTrn, 'TRN653/2026');
});

test('a production deployment never allocates simulated TRNs (local workspace flag only)', () => {
  const env = { node: process.env.NODE_ENV, local: process.env.NEXT_PUBLIC_EES_FINANCE_LOCAL_WORKSPACE };
  try {
    process.env.NODE_ENV = 'production'; delete process.env.NEXT_PUBLIC_EES_FINANCE_LOCAL_WORKSPACE;
    assert.equal(f.simulatedTrnAllowed(), false);
    const s = create(stateWith('A'), 'A');
    assert.equal(s.billingSheets[0].simulatedTrn, undefined);
    assert.equal(s.simulatedTrnLast, undefined);
    assert.match(f.sheetTrnLabel(s.billingSheets[0]), /^DRAFT-/);
    process.env.NEXT_PUBLIC_EES_FINANCE_LOCAL_WORKSPACE = '1';
    assert.equal(f.simulatedTrnAllowed(), true);
  } finally {
    if (env.node === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = env.node;
    if (env.local === undefined) delete process.env.NEXT_PUBLIC_EES_FINANCE_LOCAL_WORKSPACE; else process.env.NEXT_PUBLIC_EES_FINANCE_LOCAL_WORKSPACE = env.local;
  }
});

test('Arrange, Customer Billing and TRN & Documents all show the simulated TRN; every document stays DRAFT/TEST', () => {
  const flow = read('components/finance-billing-flow.tsx');
  assert.match(flow, /export function SheetTrnReference/);
  assert.match(flow, /\{clientId && sheet \? \(\s*<SheetTrnReference sheet=\{sheet\} t=\{t\} large \/>/); // shared card above all three stages
  assert.match(flow, /peekNextSimulatedTrn\(state,/); // start card previews the next number without allocating
  assert.match(flow, /DRAFT\/TEST · not issued/);
  const arrange = read('components/finance-arrange-stage.tsx');
  assert.match(arrange, /DRAFT \/ TEST · \{sheetTrnLabel\(sheet\)\}/);
  assert.match(arrange, /DRAFT-paper-order-\$\{sheetFileReference\(sheet\)\}/);
  const sheetStage = read('components/finance-billing-sheet-stage.tsx');
  assert.match(sheetStage, /"DRAFT\/TEST", sheetTrnLabel\(sheet\)/);
  const docs = read('components/finance-trn-documents-stage.tsx');
  assert.match(docs, /DRAFT \/ TEST — NOT AN ISSUED DOCUMENT/);
  assert.match(docs, /sheet\.simulatedTrn \? \([\s\S]*ees-doc-trn[\s\S]*\{sheet\.simulatedTrn\}/);
  assert.match(docs, /Simulated for testing — not issued/);
  // The Draft Invoice tab is the EES invoice; its INVOICE NO. is the simulated TRN (else the draft reference), never an official number.
  assert.match(docs, /invoiceFromSheet\(state, sheet, customerProfile\)/);
  assert.match(read('lib/finance-invoice-from-sheet.ts'), /const invoiceNo = sheet\.simulatedTrn \?\? sheet\.draftReference;/);
  assert.match(docs, /simulatedTrn: sheet\.simulatedTrn \?\? null/);
  assert.match(docs, /Downloads are drafts and do not issue or reserve a number/); // review workspace keeps numbering distinct from issuance
  assert.match(docs, /Official TRN pending/); // official TRN status stays separate from the simulated number
  const pdf = read('lib/finance-trn-pdf.ts');
  assert.match(pdf, /DRAFT \/ TEST — NOT AN ISSUED DOCUMENT/);
  assert.match(pdf, /TRN: \$\{input\.simulatedTrn\}/);
  assert.match(pdf, /\(simulated, not issued\)/);
});

test('no code path writes an official TRN: officialTrn stays null and the simulated allocator lives only in sheet_create', () => {
  const domain = read('lib/finance-demo-centre.ts');
  assert.equal((domain.match(/officialTrn:\s*[^n\s]/g) || []).length, 0);
  assert.equal((domain.match(/\.simulatedTrn\s*=/g) || []).length, 1); // assigned once, in sheet_create
  assert.equal((domain.match(/simulatedTrnLast\s*=/g) || []).length, 1);
  assert.match(domain, /NOT AN OFFICIAL NUMBER ALLOCATOR/);
  assert.match(domain, /proposeOfficialTrn\(authoritativeIssued/); // the official proposal still needs a verified register
  assert.deepEqual(f.proposeOfficialTrn(null, 2026), { status: 'pending_confirmation' });
});
