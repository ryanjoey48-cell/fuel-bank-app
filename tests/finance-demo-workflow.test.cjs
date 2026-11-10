const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");

const source = fs.readFileSync("lib/finance-demo-workflow.ts", "utf8");
const moduleRef = { exports: {} };
new Function("module", "exports", ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(moduleRef, moduleRef.exports);
const { demoJobs, applyDemoAction, demoFinanceReady, demoHasFinalTrnNumber } = moduleRef.exports;
const run = (job, action, actor, amount) => applyDemoAction(job, action, actor, amount);
const paperwork = (initial) => ["receive_order", "receive_parking", "receive_toll"].reduce((job, action) => run(job, action, "office"), initial);

test("fictional booking completes the full simulated workflow without issuing a TRN number", () => {
  let job = paperwork(demoJobs[0]);
  job = run(job, "verify", "office");
  assert.equal(demoFinanceReady(job), true);
  job = run(job, "record_expense", "finance");
  job = run(job, "price_list", "finance");
  job = run(job, "create_batch", "finance");
  job = run(job, "draft_trn", "finance");
  assert.equal(demoHasFinalTrnNumber(job), false);
  job = run(job, "approve", "approver");
  job = run(job, "prepare_pack", "finance");
  assert.equal(job.pack, true);
  assert.equal(job.price, 2400);
  assert.equal(job.expense, 185);
  assert.equal(job.events.length, 10);
  assert.equal(demoJobs[0].events.length, 0);
});

test("missing paperwork blocks verification and every finance handover", () => {
  let job = run(demoJobs[1], "receive_parking", "office");
  assert.throws(() => run(job, "verify", "office"), /DEMO_PAPERWORK_REQUIRED/);
  assert.throws(() => run(job, "record_expense", "finance"), /DEMO_VERIFICATION_REQUIRED/);
  job = paperwork(job);
  job = run(job, "verify", "office");
  assert.equal(job.status, "ready");
});

test("mismatch requires management decision and a separate office recheck", () => {
  let job = run(paperwork(demoJobs[2]), "verify", "office");
  assert.equal(job.status, "discrepancy");
  assert.throws(() => run(job, "resolve", "office"), /DEMO_ROLE_REQUIRED/);
  assert.throws(() => run(job, "record_expense", "finance"), /DEMO_VERIFICATION_REQUIRED/);
  job = run(job, "resolve", "management");
  assert.equal(job.status, "needs_recheck");
  assert.equal(demoFinanceReady(job), false);
  job = run(job, "verify", "office");
  assert.equal(demoFinanceReady(job), true);
});

test("manual price is auditable and approval is reserved for the simulated approver", () => {
  let job = run(paperwork(demoJobs[0]), "verify", "office");
  job = run(job, "record_expense", "finance");
  assert.throws(() => run(job, "manual_price", "finance", 0), /DEMO_AMOUNT_REQUIRED/);
  job = run(job, "manual_price", "finance", 2550);
  assert.equal(job.priceSource, "manual");
  assert.throws(() => run(job, "price_list", "finance"), /DEMO_PRICE_GATE/);
  job = run(run(job, "create_batch", "finance"), "draft_trn", "finance");
  assert.throws(() => run(job, "approve", "finance"), /DEMO_ROLE_REQUIRED/);
  assert.equal(demoHasFinalTrnNumber(run(job, "approve", "approver")), false);
});

test("demo route is local only and does not import Supabase", () => {
  const page = fs.readFileSync("app/finance-demo/page.demo.tsx", "utf8");
  const view = fs.readFileSync("components/finance-demo-workspace.tsx", "utf8");
  assert.match(page, /NODE_ENV === "production"/);
  assert.match(page, /notFound\(\)/);
  assert.doesNotMatch(view, /@\/lib\/supabase|\.from\(|\.rpc\(|fetch\(/);
  assert.match(view, /demo-print/);
  assert.match(view, /language/);
  assert.match(view, /SIMULATED DATA/);
  assert.match(view, /ข้อมูลจำลอง/);
});
