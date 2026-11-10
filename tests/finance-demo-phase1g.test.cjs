const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
const path = require("node:path");
const { createRequire } = require("node:module");

function load(file) {
  const source = fs.readFileSync(file, "utf8");
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const module = { exports: {} };
  new Function("module", "exports", "require", js)(module, module.exports, createRequire(path.resolve(file)));
  return module.exports;
}
const f = load("lib/finance-demo-centre.ts");
const copy = load("lib/finance-demo-copy.ts").demoCopy;
const run = (state, action, role) => f.applyAction(state, action, role);
function match(state, jobId) {
  for (const doc of state.documents.filter((item) => item.suggestedJobId === jobId)) {
    state = run(state, { type: "confirm_document", documentId: doc.id, jobId, physicalRef: `Demo cabinet / ${doc.id}` }, "office");
  }
  return state;
}

test("20-work-order week has clean, missing, mismatched, priced and ready examples", () => {
  const state = f.createState();
  assert.equal(state.bookings.length, 20);
  assert.equal(new Set(state.bookings.map((item) => item.jobNumber)).size, 20);
  // createState only pre-confirms three walkthrough jobs; remaining WO fields stay blank until office entry.
  assert.deepEqual(
    state.bookings.filter((item) => item.workOrderConfirmed).map((item) => item.id).sort(),
    ["b10", "b14", "b19"]
  );
  assert.equal(state.bookings.filter((item) => f.weekOf(item.date) === "2026-10-05").length, 15);
  assert.equal(state.bookings.filter((item) => f.weekOf(item.date) === "2026-10-12").length, 5);
  assert.deepEqual(f.missingDocs(state, "b2"), ["green_order", "parking", "toll"]);
  assert.deepEqual(f.mismatches(state.bookings.find((item) => item.id === "b3")), ["delivery"]);
  assert.equal(f.ready(state, "b10"), true);
  assert.equal(state.bookings.find((item) => item.id === "b10").price.amount, 2400);
  assert.equal(f.nextAction(state, "b19").key, "set_price");
  assert.equal(f.nextAction(state, "b10").key, "allocate");
});

test("office to management to finance to printable pack scenario enforces every handover", () => {
  let state = f.createState();
  assert.equal(f.nextAction(state, "b1").key, "enter_work_order");
  state = run(state, { type: "set_returned_work_order", jobId: "b1", workOrder: "SIM-WO-1001" }, "office");
  assert.equal(f.nextAction(state, "b1").key, "match_paperwork");
  state = match(state, "b1");
  assert.equal(f.nextAction(state, "b1").key, "verify");
  state = run(state, { type: "verify_job", jobId: "b1" }, "office");
  assert.equal(f.nextAction(state, "b1").key, "set_price");
  state = run(state, { type: "set_returned_work_order", jobId: "b3", workOrder: "SIM-WO-1003" }, "office");
  state = match(state, "b3");
  state = run(state, { type: "verify_job", jobId: "b3" }, "office");
  assert.equal(f.nextAction(state, "b3").role, "management");
  assert.throws(() => run(state, { type: "resolve_discrepancy", jobId: "b3", reason: "Confirmed with dispatch" }, "office"), /DEMO_ROLE_REQUIRED/);
  state = run(state, { type: "resolve_discrepancy", jobId: "b3", reason: "Confirmed original destination with dispatch" }, "management");
  assert.equal(f.nextAction(state, "b3").key, "reverify");
  assert.equal(f.ready(state, "b3"), false);
  state = run(state, { type: "verify_job", jobId: "b3" }, "office");
  state = run(state, { type: "add_expense", jobId: "b1", kind: "driver_trip", amount: 520, reference: "SIM-PAY-001" }, "finance");
  state = run(state, { type: "add_expense", jobId: "b1", kind: "toll", amount: 75, reference: "SIM-TOLL-001" }, "finance");
  state = run(state, { type: "set_price", jobId: "b1", source: "list", amount: 2400 }, "finance");
  state = run(state, { type: "set_price", jobId: "b3", source: "manual", amount: 2700, reason: "Fictional route exception agreed for demonstration" }, "finance");
  assert.equal(f.expenseTotal(state.bookings[0]), 595);
  assert.equal(state.bookings[0].price.amount, 2400);
  state = run(state, { type: "create_batch", clientId: "sample_a", week: "2026-10-05" }, "finance");
  const batchId = state.batches[0].id;
  assert.deepEqual(f.batchIssues(state, state.batches[0]), ["empty"]);
  for (const jobId of ["b10", "b3", "b1"]) state = run(state, { type: "allocate_job", batchId, jobId }, "finance");
  assert.throws(() => run(state, { type: "allocate_job", batchId, jobId: "b1" }, "finance"), /DEMO_ALLOCATION_BLOCKED/);
  state = run(state, { type: "move_job", batchId, jobId: "b1", direction: -1 }, "finance");
  assert.deepEqual(f.batchIssues(state, state.batches[0]), []);
  assert.equal(f.batchTotal(state, state.batches[0]), 7500);
  state = run(state, { type: "create_draft", batchId }, "finance");
  assert.equal(f.nextAction(state, "b1").key, "approve");
  assert.throws(() => run(state, { type: "approve_draft", batchId }, "finance"), /DEMO_ROLE_REQUIRED/);
  state = run(state, { type: "approve_draft", batchId }, "approver");
  assert.equal(f.nextAction(state, "b1").key, "prepare_pack");
  state = run(state, { type: "prepare_pack", batchId }, "finance");
  assert.equal(f.nextAction(state, "b1").key, "complete");
  assert.equal(f.hasFinalTrnNumber(state), false);
  const manifest = f.packManifest(state, state.batches[0]);
  assert.equal(manifest[0].kind, "draft");
  assert.deepEqual(manifest.filter((item) => item.kind === "work_order").map((item) => item.jobId), state.batches[0].jobIds);
  assert.ok(manifest.every((item) => item.kind === "draft" || item.kind === "work_order" || item.label.includes("original Demo cabinet")));
  assert.ok(state.audit.some((item) => item.action === "resolve_discrepancy" && item.actor === "management"));
  assert.ok(state.audit.some((item) => item.action === "approve_draft" && item.actor === "approver"));
});

test("every next action, blocker and error message has English and Thai copy", () => {
  for (const group of ["views", "statuses", "roles", "nextActions", "errors", "batchIssues", "auditActions", "auditDetails"]) {
    assert.deepEqual(Object.keys(copy.en[group]).sort(), Object.keys(copy.th[group]).sort());
    for (const value of Object.values(copy.th[group])) assert.ok(value.length > 0);
  }
  const ui = fs.readFileSync("components/finance-demo-centre.tsx", "utf8");
  assert.match(ui, /nextAction\(state, item\.id\)/);
  assert.match(ui, /batchIssues\(state, batch\)/);
  assert.match(ui, /c\.printWatermark/);
  assert.match(ui, /c\.physical/);
});

test("source reconciliation scenario keeps collected amounts out of customer billing", () => {
  const state = f.createCompletedScenario();
  assert.equal(state.mode, "source");
  assert.equal(state.batches.length, 0);
  assert.deepEqual(state.bookings.filter((item) => item.id === "source-r2" || item.id === "source-r3" || item.id === "source-r4").map((item) => item.collection.confirmed), [true, true, true]);
  assert.ok(state.bookings.filter((item) => item.id === "source-r2" || item.id === "source-r3" || item.id === "source-r4").every((item) => item.price === null));
  assert.equal(f.hasFinalTrnNumber(state), false);
  assert.ok(state.bookings.filter((item) => item.id === "source-r2" || item.id === "source-r3" || item.id === "source-r4").every((item) => item.source.historicalTrn === "TRN010/2026"));
  assert.equal(state.bookings.find((item) => item.id === "source-r2").expenses[0].amount, 200);
  assert.ok(state.audit.some((item) => item.action === "resolve_discrepancy" && item.actor === "management"));
  assert.ok(copy.en.loadScenario && copy.th.loadScenario);
});
