const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const { createRequire } = require("node:module");

const root = path.resolve(__dirname, "..");
const cache = new Map();
function load(file) {
  const abs = path.resolve(root, file);
  if (cache.has(abs)) return cache.get(abs).exports;
  const source = fs.readFileSync(abs, "utf8");
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
  }).outputText;
  const m = { exports: {} };
  cache.set(abs, m);
  const nodeRequire = createRequire(abs);
  const req = (name) => {
    if (name.startsWith(".") || name.startsWith("@/")) {
      const base = name.startsWith("@/") ? path.resolve(root, name.slice(2)) : path.resolve(path.dirname(abs), name);
      const target = [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.json`].find((c) => fs.existsSync(c) && fs.statSync(c).isFile());
      if (target && (target.endsWith(".ts") || target.endsWith(".tsx"))) return load(path.relative(root, target));
      if (target) return nodeRequire(target);
    }
    return nodeRequire(name);
  };
  new Function("module", "exports", "require", js)(m, m.exports, req);
  return m.exports;
}

test("v1 local Finance store migrates into isolated owner + previous_demo workspaces", () => {
  const centre = load("lib/finance-demo-centre.ts");
  const persist = load("lib/finance-local-persistence.ts");
  const previous = centre.createFixtureInitialState();
  assert.ok(previous.bookings.length >= 15);

  const legacy = {
    kind: "ees_finance_local_test",
    version: 1,
    savedAt: "2026-11-02T13:04:54.013Z",
    role: "finance",
    state: previous,
    note: "legacy"
  };

  const migrated = persist.normalizeFinanceLocalStore(legacy);
  assert.ok(migrated);
  assert.equal(migrated.version, 2);
  assert.equal(migrated.activeWorkspace, "owner");
  assert.equal(migrated.workspaces.owner.bookings.length, 0);
  assert.equal(migrated.workspaces.owner.mode, "owner_walkthrough");
  assert.equal(migrated.workspaces.previous_demo.bookings.length, previous.bookings.length);
  assert.equal(migrated.workspaces.previous_demo.batches.length, previous.batches.length);
  assert.equal(migrated.workspaces.previous_demo.audit.length, previous.audit.length);
  // Owner and previous do not share booking arrays by reference mutation safety of migrate
  assert.notEqual(migrated.workspaces.owner, migrated.workspaces.previous_demo);
});

test("owner walkthrough diary link does not fabricate paperwork rows", () => {
  const centre = load("lib/finance-demo-centre.ts");
  let state = centre.createEmptyOwnerState();
  state = centre.upsertDiaryBooking(state, {
    id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    booking_id: "BK-OWNER-001",
    client_id: "client-owner",
    client_name: "Owner Customer",
    booking_date: "2026-11-03",
    pickup_time: "09:00",
    pickup: "Depot",
    dropoff: "Yard",
    driver: "Driver",
    vehicle_registration: "ABC-1",
    job_order_number: ""
  });
  assert.equal(state.bookings.length, 1);
  assert.equal(state.bookings[0].workOrderConfirmed, false);
  assert.equal(state.documents.length, 0);
  assert.deepEqual(centre.missingDocs(state, state.bookings[0].id), ["green_order", "parking", "toll"]);
});

test("owner and previous demonstration workspaces do not convert historical collections into billing", () => {
  const centre = load("lib/finance-demo-centre.ts");
  const persist = load("lib/finance-local-persistence.ts");
  const previous = centre.createCompletedScenario();
  const owner = centre.createEmptyOwnerState();
  const envelope = persist.createFinanceLocalStoreEnvelope(
    { owner, previous_demo: previous },
    "office",
    "owner",
    "2026-11-03T00:00:00.000Z"
  );
  assert.equal(envelope.workspaces.owner.batches.length, 0);
  assert.equal(envelope.workspaces.previous_demo.batches.length, 0);
  assert.equal(envelope.state.bookings.length, 0);
  const switched = persist.createFinanceLocalStoreEnvelope(
    envelope.workspaces,
    "office",
    "previous_demo",
    "2026-11-03T00:00:00.000Z"
  );
  assert.equal(switched.activeWorkspace, "previous_demo");
  assert.ok(switched.state.bookings.length > 0);
  assert.equal(switched.state.batches.length, 0);
  assert.notEqual(switched.state, envelope.state);
});

test("Finance Centre workspace UI no longer mounts the sticky yellow banner controls", () => {
  const workspace = fs.readFileSync("components/finance-centre-workspace.tsx", "utf8");
  const banner = fs.readFileSync("components/finance-fixture-banner.tsx", "utf8");
  assert.match(workspace, /Test mode — no invoices issued/);
  assert.match(workspace, /Developer tools/);
  assert.match(workspace, /const IS_DEV_BUILD = process\.env\.NODE_ENV !== "production"/);
  assert.match(workspace, /\{IS_DEV_BUILD && params\.get\("dev"\) === "1" \? \(/, 'role switcher and developer drawer render only in development builds opened with ?dev=1');
  assert.match(workspace, /Owner walkthrough/);
  assert.match(workspace, /Previous demonstration data/);
  assert.match(workspace, /Select Booking Diary Jobs|เลือกงานจากสมุดจอง/);
  assert.match(workspace, /Type CLEAR to enable|พิมพ์ CLEAR เพื่อเปิดใช้/);
  assert.match(banner, /return null/);
});

test("owner diary import keeps returned details empty until Admin verification", () => {
  const centre = load("lib/finance-demo-centre.ts");
  let state = centre.createEmptyOwnerState();
  state = centre.upsertDiaryBooking(state, {
    id: "bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    booking_id: "BK-OWNER-002",
    client_id: "client-owner",
    client_name: "Owner Customer",
    booking_date: "2026-11-03",
    pickup_time: "09:00",
    pickup: "Depot A",
    dropoff: "Yard B",
    driver: "Driver One",
    vehicle_registration: "ABC-1",
    job_order_number: ""
  });
  const job = state.bookings[0];
  assert.equal(job.returned.pickup, "");
  assert.equal(job.returned.delivery, "");
  assert.equal(job.workOrderConfirmed, false);
  assert.throws(() => centre.applyAction(state, { type: "set_returned_work_order", jobId: job.id, workOrder: "3628.1" }, "office"), /DEMO_ROLE_REQUIRED/);
  state = centre.applyAction(
    state,
    {
      type: "set_returned_details",
      jobId: job.id,
      fields: { date: "2026-11-03", pickup: "Depot A", delivery: "Yard B", driver: "Driver One", vehicle: "ABC-1" }
    },
    "admin"
  );
  state = centre.applyAction(state, { type: "set_returned_work_order", jobId: job.id, workOrder: "3628.1" }, "admin");
  assert.equal(centre.confirmedWorkOrder(state.bookings[0]), "3628.1");
  assert.equal(centre.mismatches(state.bookings[0]).length, 0);
  state = centre.applyAction(
    state,
    { type: "set_returned_details", jobId: job.id, fields: { pickup: "Laem Chabang Port" } },
    "admin"
  );
  assert.deepEqual(centre.mismatches(state.bookings[0]), ["pickup"]);
});

test("duplicate diary selection upserts instead of creating a second reconciliation record", () => {
  const centre = load("lib/finance-demo-centre.ts");
  const seed = {
    id: "cccccccc-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    booking_id: "BK-OWNER-003",
    client_name: "Owner Customer",
    booking_date: "2026-11-03",
    pickup: "A",
    dropoff: "B"
  };
  let state = centre.createEmptyOwnerState();
  state = centre.upsertDiaryBooking(state, seed);
  state = centre.upsertDiaryBooking(state, seed);
  assert.equal(state.bookings.length, 1);
});

test("Booking Diary Reconcile Job routes into Finance Centre reconciliation", () => {
  const diary = fs.readFileSync("app/(dashboard)/booking-diary/page.tsx", "utf8");
  assert.match(diary, /finance-centre\?booking=\$\{encodeURIComponent\(booking\.id\)\}&section=reconciliation/);
  assert.doesNotMatch(diary, /job-verification\?booking=\$\{encodeURIComponent\(booking\.id\)\}/);
});
