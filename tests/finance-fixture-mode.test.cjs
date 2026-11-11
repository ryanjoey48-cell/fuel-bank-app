const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
const path = require("node:path");
const { createRequire } = require("node:module");

function load(file) {
  const source = fs.readFileSync(file, "utf8");
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
  }).outputText;
  const m = { exports: {} };
  new Function("module", "exports", "require", js)(m, m.exports, createRequire(path.resolve(file)));
  return m.exports;
}

const FIXTURE_ENV_KEYS = [
  "NODE_ENV",
  "NEXT_PUBLIC_EES_FINANCE_FIXTURE",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY"
];

function loadFixtureMode(env) {
  const prior = Object.fromEntries(FIXTURE_ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of FIXTURE_ENV_KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  const mod = load("lib/finance-fixture-mode.ts");
  const enabled = mod.isFinanceFixtureMode();
  for (const key of FIXTURE_ENV_KEYS) {
    if (prior[key] === undefined) delete process.env[key];
    else process.env[key] = prior[key];
  }
  return { ...mod, isFinanceFixtureMode: () => enabled };
}

test("Booking Diary always renders the original live page (never fixture shell)", () => {
  const diary = fs.readFileSync("app/(dashboard)/booking-diary/page.tsx", "utf8");
  assert.doesNotMatch(diary, /FinanceFixtureBookingDiary/);
  assert.match(diary, /Reconcile Job|reconcileJob/);
  assert.match(diary, /href=\{`\/finance-centre\?booking=/);
  assert.match(diary, /export default function BookingDiaryPage\(\) \{\s*return <LiveBookingDiaryPage \/>;/);
});

test("upsertDiaryBooking links an original diary row into local finance memory", () => {
  const centre = load("lib/finance-demo-centre.ts");
  const seed = {
    id: "11111111-2222-4333-8444-555555555555",
    booking_id: "BK-LIVE-001",
    client_id: "client-live",
    client_name: "Live Customer",
    booking_date: "2026-10-20",
    pickup_time: "09:00",
    pickup: "Depot A",
    dropoff: "Yard B",
    driver: "Driver Live",
    vehicle_registration: "LIVE-01",
    job_order_number: ""
  };
  let state = centre.createFixtureInitialState();
  state = centre.upsertDiaryBooking(state, seed);
  const job = state.bookings.find((item) => item.id === seed.id);
  assert.ok(job);
  assert.equal(job.jobNumber, "BK-LIVE-001");
  assert.equal(job.workOrderConfirmed, false);
  assert.equal(centre.bookingReference(job), "BK-LIVE-001");
  assert.equal(centre.ready(state, job.id), false);
});

test("production serves the four-section Finance Centre unless LIVE_LOCAL opts into the legacy overview", () => {
  const prior = {
    NODE_ENV: process.env.NODE_ENV,
    LIVE: process.env.NEXT_PUBLIC_EES_FINANCE_LIVE_LOCAL,
    LOCAL: process.env.NEXT_PUBLIC_EES_FINANCE_LOCAL_WORKSPACE
  };
  try {
    process.env.NODE_ENV = "production";
    delete process.env.NEXT_PUBLIC_EES_FINANCE_LIVE_LOCAL;
    delete process.env.NEXT_PUBLIC_EES_FINANCE_LOCAL_WORKSPACE;
    const mode = load("lib/finance-fixture-mode.ts");
    assert.equal(mode.isFinanceCentreLocalWorkspace(), true);
    assert.equal(mode.usesFinanceLocalDemoScreens(), true);
    process.env.NEXT_PUBLIC_EES_FINANCE_LIVE_LOCAL = "1";
    const live = load("lib/finance-fixture-mode.ts");
    assert.equal(live.isFinanceCentreLocalWorkspace(), false);
    assert.equal(live.usesFinanceLocalDemoScreens(), false);
  } finally {
    if (prior.NODE_ENV === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = prior.NODE_ENV;
    if (prior.LIVE === undefined) delete process.env.NEXT_PUBLIC_EES_FINANCE_LIVE_LOCAL; else process.env.NEXT_PUBLIC_EES_FINANCE_LIVE_LOCAL = prior.LIVE;
    if (prior.LOCAL === undefined) delete process.env.NEXT_PUBLIC_EES_FINANCE_LOCAL_WORKSPACE; else process.env.NEXT_PUBLIC_EES_FINANCE_LOCAL_WORKSPACE = prior.LOCAL;
  }
  const page = fs.readFileSync("app/(dashboard)/finance-centre/page.tsx", "utf8");
  assert.match(page, /usesFinanceLocalDemoScreens\(\)\) return <FinanceCentreWorkspace/);
  assert.match(page, /LiveFinanceCentrePage/);
});

test("isFinanceFixtureMode is false in production or when Supabase env is set", () => {
  assert.equal(loadFixtureMode({ NODE_ENV: "production", NEXT_PUBLIC_EES_FINANCE_FIXTURE: "1" }).isFinanceFixtureMode(), false);
  assert.equal(
    loadFixtureMode({
      NODE_ENV: "development",
      NEXT_PUBLIC_EES_FINANCE_FIXTURE: "1",
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co"
    }).isFinanceFixtureMode(),
    false
  );
  assert.equal(
    loadFixtureMode({
      NODE_ENV: "development",
      NEXT_PUBLIC_EES_FINANCE_FIXTURE: "1",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key"
    }).isFinanceFixtureMode(),
    false
  );
  const enabled = loadFixtureMode({
    NODE_ENV: "development",
    NEXT_PUBLIC_EES_FINANCE_FIXTURE: "1"
  });
  assert.equal(enabled.isFinanceFixtureMode(), true);
});

test("dashboardMetrics reports queue counts for source and completed scenarios", () => {
  const centre = load("lib/finance-demo-centre.ts");
  const source = centre.dashboardMetrics(centre.createSourceState());
  assert.ok(source.totalJobs > 0);
  assert.ok(source.nextActions.length > 0);
  assert.equal(typeof source.awaitingPricing, "number");

  const completed = centre.dashboardMetrics(centre.createCompletedScenario());
  assert.equal(completed.approvedPacks, 0);
  assert.equal(completed.weeklyTotals.length, 0);
  assert.equal(completed.nextActions.some((item) => item.key === "complete"), false);
});

test("ready() requires confirmed work order from green sheet", () => {
  const centre = load("lib/finance-demo-centre.ts");
  const state = centre.createFixtureInitialState();
  const manual = state.bookings.find((job) => job.id === "manual-mass-1");
  assert.ok(manual);
  assert.equal(manual.workOrder, "");
  assert.equal(manual.workOrderConfirmed, false);
  assert.equal(centre.ready(state, manual.id), false);
  let next = centre.applyAction(state, { type: "set_returned_work_order", jobId: manual.id, workOrder: "TEST-501" }, "office");
  assert.equal(next.bookings.find((job) => job.id === manual.id).workOrderConfirmed, true);
  assert.throws(
    () => centre.applyAction(next, { type: "set_returned_work_order", jobId: "source-r3", workOrder: "TEST-501" }, "office"),
    /DEMO_DUPLICATE_WO/
  );
  assert.throws(
    () => centre.applyAction(state, { type: "set_returned_work_order", jobId: manual.id, workOrder: "21" }, "office"),
    /DEMO_WO_REQUIRED/
  );
  const metrics = centre.dashboardMetrics(state);
  const manualAction = metrics.nextActions.find((item) => item.jobId === manual.id);
  assert.ok(manualAction);
  assert.equal(manualAction.key, "enter_work_order");
  assert.match(manualAction.displayLabel, /Awaiting green sheet|BK-TEST-MASS-001/);
});

test("reject_draft requires approver role and unlocks batch for re-edit", () => {
  const centre = load("lib/finance-demo-centre.ts");
  const run = (state, action, role) => centre.applyAction(state, action, role);
  function verify(state, jobId) {
    state = run(state, { type: "set_returned_work_order", jobId, workOrder: jobId === "b1" ? "SIM-WO-1001" : "SIM-WO-1004" }, "office");
    for (const doc of state.documents.filter((item) => item.suggestedJobId === jobId)) {
      state = run(state, { type: "confirm_document", documentId: doc.id, jobId, physicalRef: `Cabinet / ${doc.id}` }, "office");
    }
    return run(state, { type: "verify_job", jobId }, "office");
  }
  let state = verify(centre.createState(), "b1");
  state = run(state, { type: "set_price", jobId: "b1", source: "list", amount: 2400 }, "finance");
  state = verify(state, "b4");
  state = run(state, { type: "set_price", jobId: "b4", source: "list", amount: 2400 }, "finance");
  state = run(state, { type: "create_batch", clientId: "sample_a", week: "2026-10-05" }, "finance");
  const batchId = state.batches[0].id;
  state = run(state, { type: "allocate_job", batchId, jobId: "b1" }, "finance");
  state = run(state, { type: "create_draft", batchId }, "finance");
  assert.throws(
    () => run(state, { type: "reject_draft", batchId, reason: "Simulated rejection for walkthrough test" }, "finance"),
    /DEMO_ROLE_REQUIRED/
  );
  state = run(state, { type: "reject_draft", batchId, reason: "Simulated rejection for walkthrough test" }, "approver");
  assert.equal(state.batches[0].draft, false);
  assert.match(state.batches[0].rejectedReason, /Simulated rejection/);
});
