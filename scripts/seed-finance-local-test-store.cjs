/**
 * Dev-only helper: seeds .ees-local/finance-test/state.json with one diary-linked
 * Finance overlay. Does not write Booking Diary / production finance tables.
 * Leaves work order unconfirmed for manual green-sheet entry.
 */
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const { createRequire } = require("node:module");

function load(file, resolver) {
  const source = fs.readFileSync(file, "utf8");
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
  }).outputText;
  const m = { exports: {} };
  new Function("module", "exports", "require", js)(m, m.exports, resolver || createRequire(path.resolve(file)));
  return m.exports;
}

const root = process.cwd();
const modules = new Map();
const resolver = (request) => {
  if (request === "@/lib/finance-local-persistence") return modules.get("persist");
  if (request === "@/lib/finance-demo-centre") return modules.get("centre");
  return createRequire(path.join(root, "lib/finance-local-store-server.ts"))(request);
};

modules.set("centre", load(path.join(root, "lib/finance-demo-centre.ts"), resolver));
modules.set("persist", load(path.join(root, "lib/finance-local-persistence.ts"), resolver));
const store = load(path.join(root, "lib/finance-local-store-server.ts"), resolver);
const centre = modules.get("centre");

const bookingId = process.argv[2] || "d4465c3f-76fb-426d-8fff-580349d3298d";

(async () => {
  let state = centre.createFixtureInitialState();
  state = centre.upsertDiaryBooking(state, {
    id: bookingId,
    booking_id: "BK-FINANCE-LOCAL-TEST-001",
    client_id: "finance-local-test",
    client_name: "EES Finance Local Test",
    booking_date: "2026-10-10",
    pickup_time: "",
    pickup: "GLOBAL",
    dropoff: "Coastal Pier",
    driver: "Joey Test",
    vehicle_registration: "1998",
    job_order_number: ""
  });
  const envelope = await store.writeFinanceLocalStore(
    {
      owner: centre.createEmptyOwnerState(),
      previous_demo: state
    },
    "office",
    "previous_demo"
  );
  const job = state.bookings.find((item) => item.id === bookingId);
  console.log(
    JSON.stringify(
      {
        ok: true,
        savedAt: envelope.savedAt,
        path: ".ees-local/finance-test/state.json",
        bookingId,
        jobNumber: job?.jobNumber,
        workOrderConfirmed: job?.workOrderConfirmed === true,
        origin: job?.origin,
        note: "Work order left blank for manual green-sheet entry"
      },
      null,
      2
    )
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
