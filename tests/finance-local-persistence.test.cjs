const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");
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

test("local Finance envelope round-trips and marks diary-linked jobs", () => {
  const centre = load("lib/finance-demo-centre.ts");
  const persist = load("lib/finance-local-persistence.ts");
  let state = centre.createFixtureInitialState();
  state = centre.upsertDiaryBooking(state, {
    id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    booking_id: "BK-FINANCE-LOCAL-TEST-001",
    client_id: "client-test",
    client_name: "EES Finance Local Test Customer",
    booking_date: "2026-10-20",
    pickup_time: "09:00",
    pickup: "Test Depot",
    dropoff: "Test Yard",
    driver: "Test Driver",
    vehicle_registration: "TEST-01",
    job_order_number: ""
  });
  const job = state.bookings.find((item) => item.id === "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee");
  assert.equal(job.origin, "booking_diary_local_test");
  assert.equal(job.workOrderConfirmed, false);
  assert.equal(persist.countDiaryLinkedFinanceJobs(state), 1);

  const envelope = persist.createFinanceLocalStoreEnvelope(
    { owner: state, previous_demo: centre.createEmptyOwnerState() },
    "office",
    "owner",
    "2026-11-02T00:00:00.000Z"
  );
  assert.equal(envelope.kind, "ees_finance_local_test");
  assert.equal(envelope.version, 2);
  assert.equal(envelope.activeWorkspace, "owner");
  const parsed = persist.parseFinanceLocalStoreJson(JSON.stringify(envelope));
  assert.ok(parsed);
  assert.equal(parsed.workspaces.owner.bookings[0].id, job.id);
});

test("legacy workbook collections are separated from customer prices and invalidate simulated billing", () => {
  const centre = load("lib/finance-demo-centre.ts");
  const persist = load("lib/finance-local-persistence.ts");
  const state = centre.createSourceState();
  const legacyJob = state.bookings.find((item) => item.id === "source-r2");
  legacyJob.price = {
    amount: legacyJob.source.totalCollected,
    source: "workbook",
    label: "Workbook: total amount collected",
    reason: null,
    confirmed: true
  };
  delete legacyJob.collection;
  state.batches.push({
    id: "SIM-BATCH-LEGACY",
    clientId: legacyJob.clientId,
    week: "2026-01-05",
    jobIds: [legacyJob.id],
    draft: true,
    approvedBy: "approver",
    rejectedReason: null,
    packReady: true
  });
  const raw = {
    kind: "ees_finance_local_test",
    version: 2,
    savedAt: "2026-11-02T00:00:00.000Z",
    role: "finance",
    activeWorkspace: "previous_demo",
    workspaces: { owner: centre.createEmptyOwnerState(), previous_demo: state },
    state,
    note: "LOCAL TEST"
  };
  const parsed = persist.parseFinanceLocalStoreJson(JSON.stringify(raw));
  assert.ok(parsed);
  const migratedJob = parsed.workspaces.previous_demo.bookings.find((item) => item.id === "source-r2");
  assert.equal(migratedJob.collection.amount, legacyJob.source.totalCollected);
  assert.equal(migratedJob.collection.confirmed, true);
  assert.equal(migratedJob.price, null);
  assert.equal(migratedJob.source.historicalTrn, "TRN010/2026");
  const batch = parsed.workspaces.previous_demo.batches.find((item) => item.id === "SIM-BATCH-LEGACY");
  assert.deepEqual(batch.jobIds, ["source-r2"]);
  assert.equal(batch.draft, false);
  assert.equal(batch.approvedBy, null);
  assert.equal(batch.packReady, false);
  assert.match(batch.rejectedReason, /not customer prices/);
});

test("office can record parking expense after WO without waiting for pricing screen", () => {
  const centre = load("lib/finance-demo-centre.ts");
  let state = centre.createFixtureInitialState();
  const manual = state.bookings.find((item) => item.id === "manual-mass-1");
  assert.ok(manual);
  state = centre.applyAction(state, { type: "set_returned_work_order", jobId: manual.id, workOrder: "LOCAL-WO-KEEP" }, "office");
  state = centre.applyAction(state, { type: "add_expense", jobId: manual.id, kind: "parking", amount: 50, reference: "PARK-TEST-1" }, "office");
  const job = state.bookings.find((item) => item.id === manual.id);
  assert.equal(job.expenses.length, 1);
  assert.equal(job.expenses[0].kind, "parking");
  assert.throws(
    () => centre.applyAction(state, { type: "add_expense", jobId: manual.id, kind: "toll", amount: 10, reference: "TOLL" }, "approver"),
    /DEMO_ROLE_REQUIRED/
  );
});

test("server local store writes under .ees-local and survives reload", async () => {
  const prior = {
    NODE_ENV: process.env.NODE_ENV,
    NEXT_PUBLIC_EES_FINANCE_LIVE_LOCAL: process.env.NEXT_PUBLIC_EES_FINANCE_LIVE_LOCAL,
    cwd: process.cwd()
  };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ees-finance-local-"));
  process.chdir(tmp);
  process.env.NODE_ENV = "development";
  delete process.env.NEXT_PUBLIC_EES_FINANCE_LIVE_LOCAL;

  try {
    const centre = load(path.join(prior.cwd, "lib/finance-demo-centre.ts"));
    // Re-load server module after chdir by compiling with absolute require of fs paths inside module using process.cwd()
    const serverSource = fs.readFileSync(path.join(prior.cwd, "lib/finance-local-store-server.ts"), "utf8");
    const persistSource = fs.readFileSync(path.join(prior.cwd, "lib/finance-local-persistence.ts"), "utf8");
    const centreSource = fs.readFileSync(path.join(prior.cwd, "lib/finance-demo-centre.ts"), "utf8");
    const transpile = (source) =>
      ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
      }).outputText;

    const modules = new Map();
    const localRequire = (request) => {
      if (request === "@/lib/finance-write-guard") return require("./helpers/invoice-compare.cjs").lib("finance-write-guard.ts");
      if (request === "@/lib/finance-local-persistence") return modules.get("persist");
      if (request === "@/lib/finance-demo-centre") return modules.get("centre");
      return createRequire(path.join(prior.cwd, "lib/finance-local-store-server.ts"))(request);
    };
    const loadNamed = (name, source) => {
      const m = { exports: {} };
      new Function("module", "exports", "require", transpile(source))(m, m.exports, localRequire);
      modules.set(name, m.exports);
      return m.exports;
    };
    loadNamed("centre", centreSource);
    loadNamed("persist", persistSource);
    const store = loadNamed("store", serverSource);

    assert.equal(store.isFinanceLocalStoreEnabled(), true);
    const state = centre.createFixtureInitialState();
    let owner = centre.createEmptyOwnerState();
    for (const [i, customerJobNumber] of ['', 'SOO4565453', '000-AB/09'].entries()) {
      owner = centre.linkDiaryWorkOrder(owner, { id: 'isolated-reference-' + i, booking_id: 'BK-ISOLATED-' + i, booking_date: '2026-01-19', pickup: 'Isolated pickup', dropoff: 'Isolated delivery' }, 'ISOLATED-WO-' + i, 'admin', { amounts: Object.fromEntries(centre.ADMIN_RECEIPT_FIELDS.map((kind) => [kind, null])), notes: '', customerJobNumber });
    }
    const saved = await store.writeFinanceLocalStore(
      { owner, previous_demo: state },
      "office",
      "previous_demo"
    );
    assert.equal(saved.kind, "ees_finance_local_test");
    assert.equal(saved.version, 2);
    const disk = path.join(tmp, ".ees-local", "finance-test", "state.json");
    assert.ok(fs.existsSync(disk));
    const reloaded = await store.readFinanceLocalStore();
    assert.ok(reloaded);
    assert.equal(reloaded.role, "office");
    assert.equal(reloaded.workspaces.previous_demo.bookings.length, state.bookings.length);
    assert.deepEqual(reloaded.workspaces.owner.bookings, JSON.parse(JSON.stringify(owner.bookings)));
    assert.deepEqual(reloaded.workspaces.owner.bookings.map(centre.customerJobReference), ['000-AB/09', 'SOO4565453', '']);
    await store.clearFinanceLocalStore();
    assert.equal(await store.readFinanceLocalStore(), null);
  } finally {
    process.chdir(prior.cwd);
    process.env.NODE_ENV = prior.NODE_ENV;
    if (prior.NEXT_PUBLIC_EES_FINANCE_LIVE_LOCAL === undefined) delete process.env.NEXT_PUBLIC_EES_FINANCE_LIVE_LOCAL;
    else process.env.NEXT_PUBLIC_EES_FINANCE_LIVE_LOCAL = prior.NEXT_PUBLIC_EES_FINANCE_LIVE_LOCAL;
  }
});

test("Booking Diary page still excludes fixture shell swap", () => {
  const diary = fs.readFileSync("app/(dashboard)/booking-diary/page.tsx", "utf8");
  assert.doesNotMatch(diary, /FinanceFixtureBookingDiary/);
  assert.match(diary, /reconcileJob|Reconcile Job/);
});
