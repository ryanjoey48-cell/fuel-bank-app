const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
const path = require("node:path");
const { createRequire } = require("node:module");
function load(file) { const source = fs.readFileSync(file, "utf8"); const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText; const m = { exports: {} }; new Function("module", "exports", "require", js)(m, m.exports, createRequire(path.resolve(file))); return m.exports; }
const f = load("lib/finance-demo-centre.ts");
const copy = load("lib/finance-demo-copy.ts").demoCopy;
const run = (state, action, role) => f.applyAction(state, action, role);
const fictionalWorkOrders = { b1: "SIM-WO-1001", b2: "SIM-WO-1002", b3: "SIM-WO-1003", b4: "SIM-WO-1004" };
function confirmAll(state, jobId) { for (const doc of state.documents.filter((item) => item.suggestedJobId === jobId)) state = run(state, { type: "confirm_document", documentId: doc.id, jobId, physicalRef: `Cabinet A / ${doc.id}` }, "office"); return state; }
function confirmWo(state, jobId) { const wo = fictionalWorkOrders[jobId]; return wo ? run(state, { type: "set_returned_work_order", jobId, workOrder: wo }, "office") : state; }
function verify(state, jobId) { return run(confirmAll(confirmWo(state, jobId), jobId), { type: "verify_job", jobId }, "office"); }
function price(state, jobId) { return run(state, { type: "set_price", jobId, source: "list", amount: 2400 }, "finance"); }

test("booking, paperwork, finance and two-job weekly draft reach a simulated pack in sequence", () => {
  let state = f.createState();
  assert.equal(state.bookings[0].operationalStatus, "completed");
  state = price(verify(state, "b1"), "b1");
  state = price(verify(state, "b4"), "b4");
  state = run(state, { type: "create_batch", clientId: "sample_a", week: "2026-10-05" }, "finance");
  const id = state.batches[0].id;
  state = run(state, { type: "allocate_job", batchId: id, jobId: "b4" }, "finance");
  state = run(state, { type: "allocate_job", batchId: id, jobId: "b1" }, "finance");
  state = run(state, { type: "move_job", batchId: id, jobId: "b1", direction: -1 }, "finance");
  assert.deepEqual(state.batches[0].jobIds, ["b1", "b4"]);
  assert.equal(f.batchTotal(state, state.batches[0]), 4800);
  state = run(state, { type: "create_draft", batchId: id }, "finance");
  assert.throws(() => run(state, { type: "allocate_job", batchId: id, jobId: "b3" }, "finance"), /DEMO_DRAFT_FROZEN/);
  state = run(state, { type: "approve_draft", batchId: id }, "approver");
  state = run(state, { type: "prepare_pack", batchId: id }, "finance");
  assert.equal(state.batches[0].packReady, true);
  assert.equal(f.hasFinalTrnNumber(state), false);
  const manifest = f.packManifest(state, state.batches[0]);
  assert.equal(manifest[0].kind, "draft");
  assert.equal(manifest[1].kind, "work_order");
  assert.deepEqual(manifest.slice(2, 6).map((item) => item.kind), ["green_order", "parking", "parking", "toll"]);
  assert.equal(manifest[6].label.includes("SIM-WO-1004"), true);
});

test("missing paperwork blocks verification and allocation until staff matches fictional documents", () => {
  let state = f.createState();
  state = confirmWo(state, "b2");
  state = run(state, { type: "verify_job", jobId: "b2" }, "office");
  assert.equal(state.bookings[1].status, "missing_paperwork");
  assert.equal(f.ready(state, "b2"), false);
  assert.deepEqual(f.missingDocs(state, "b2"), ["green_order", "parking", "toll"]);
  state = run(state, { type: "add_document", jobId: "b2", kind: "green_order" }, "office");
  state = run(state, { type: "add_document", jobId: "b2", kind: "toll" }, "office");
  state = verify(state, "b2");
  assert.equal(f.ready(state, "b2"), true);
});

test("management discrepancy holds finance until separate manager resolution and office recheck", () => {
  let state = verify(f.createState(), "b3");
  assert.deepEqual(f.mismatches(state.bookings[2]), ["delivery"]);
  assert.equal(state.bookings[2].status, "discrepancy");
  assert.throws(() => run(state, { type: "resolve_discrepancy", jobId: "b3", reason: "Confirmed by manager" }, "office"), /DEMO_ROLE_REQUIRED/);
  assert.throws(() => run(state, { type: "add_expense", jobId: "b3", kind: "parking", amount: 85, reference: "SIM" }, "finance"), /DEMO_EXPENSE_GATE/);
  state = run(state, { type: "resolve_discrepancy", jobId: "b3", reason: "Confirmed original destination with dispatch" }, "management");
  assert.equal(state.bookings[2].status, "needs_recheck");
  assert.equal(f.ready(state, "b3"), false);
  state = run(state, { type: "verify_job", jobId: "b3" }, "office");
  assert.equal(f.ready(state, "b3"), true);
  assert.equal(state.audit.at(-1).actor, "office");
});

test("internal expenses remain separate from list and manual customer prices with override history", () => {
  let state = verify(f.createState(), "b1");
  state = run(state, { type: "add_expense", jobId: "b1", kind: "driver_trip", amount: 500, reference: "SIM-PAY-1" }, "finance");
  state = run(state, { type: "add_expense", jobId: "b1", kind: "toll", amount: 100, reference: "SIM-TOLL-1" }, "finance");
  assert.equal(f.expenseTotal(state.bookings[0]), 600);
  assert.equal(state.bookings[0].price, null);
  state = price(state, "b1");
  assert.equal(state.bookings[0].price.amount, 2400);
  assert.throws(() => run(state, { type: "set_price", jobId: "b1", source: "manual", amount: 2600, reason: "short" }, "finance"), /DEMO_PRICE_REASON_REQUIRED/);
  state = run(state, { type: "set_price", jobId: "b1", source: "manual", amount: 2600, reason: "Special customer agreement for demo" }, "finance");
  assert.equal(state.bookings[0].price.source, "manual");
  assert.match(state.audit.at(-1).detail, /previous THB 2400.00/);
  assert.equal(state.bookings[0].price.amount - f.expenseTotal(state.bookings[0]), 2000);
});

test("weekly allocation rejects wrong customer, week, missing price and duplicate work order", () => {
  let state = price(verify(f.createState(), "b1"), "b1");
  state = run(state, { type: "create_batch", clientId: "sample_a", week: "2026-10-05" }, "finance");
  state = run(state, { type: "create_batch", clientId: "sample_b", week: "2026-10-12" }, "finance");
  assert.deepEqual(f.blockers(state, state.batches[1], "b1").slice(0, 2), ["customer", "week"]);
  assert.ok(f.blockers(state, state.batches[0], "b2").includes("pricing"));
  state = run(state, { type: "allocate_job", batchId: state.batches[0].id, jobId: "b1" }, "finance");
  assert.ok(f.blockers(state, state.batches[0], "b1").includes("already_allocated"));
  assert.throws(() => run(state, { type: "allocate_job", batchId: state.batches[0].id, jobId: "b1" }, "finance"), /DEMO_ALLOCATION_BLOCKED/);
});

test("all nine views and key warnings are bilingual; demo stays off production routes and Supabase", () => {
  assert.equal(Object.keys(copy.en.views).length, 9);
  assert.deepEqual(Object.keys(copy.en.views), Object.keys(copy.th.views));
  for (const key of ["missingWarning", "managerHold", "noAutoAdd", "draftNumber", "neverSend", "printWatermark"]) { assert.ok(copy.en[key]); assert.ok(copy.th[key]); }
  const page = fs.readFileSync("app/finance-demo/page.demo.tsx", "utf8");
  const ui = fs.readFileSync("components/finance-demo-centre.tsx", "utf8");
  const config = fs.readFileSync("next.config.ts", "utf8");
  assert.match(page, /NODE_ENV === "production"/);
  assert.match(config, /pageExtensions: process\.env\.NODE_ENV === "production"/);
  assert.equal(fs.existsSync(path.join("app", "finance-demo", "page.tsx")), false);
  assert.doesNotMatch(ui, /@\/lib\/supabase|\.rpc\(|\.from\(|fetch\(/);
  assert.match(ui, /finance-demo-print/);
});
