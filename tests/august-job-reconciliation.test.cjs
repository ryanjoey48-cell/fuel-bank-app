const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

function loadTypeScriptModule(relativePath, mocks = {}) {
  const filename = path.resolve(relativePath);
  const source = fs.readFileSync(filename, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  loaded.require = (request) => mocks[request] ?? Module.prototype.require.call(loaded, request);
  loaded._compile(compiled, filename);
  return loaded.exports;
}

const {
  inAugustWindow,
  isVehicleDescription,
  normalizeComparisonText,
  normalizeRegistrationKey,
  parseRegistrationCell,
  reconcileAugustJobs
} = loadTypeScriptModule("lib/august-job-reconciliation.ts", {
  "@/types/database": {}
});

function boss(overrides = {}) {
  return {
    sourceRowNumber: overrides.sourceRowNumber ?? 2,
    date: overrides.date ?? "2026-08-01",
    client: overrides.client ?? "ACME",
    pickup: overrides.pickup ?? "GOOD YEAR",
    dropoff: overrides.dropoff ?? "สุวรรณภูมิ",
    registrationCell: overrides.registrationCell ?? "64-0359",
    driver: overrides.driver ?? "Somchai",
    jobOrderNumber: overrides.jobOrderNumber ?? "5202",
    pickupTime: overrides.pickupTime ?? "07:00",
    vehicleType: overrides.vehicleType ?? "6 Wheel Truck"
  };
}

function booking(overrides = {}) {
  return {
    id: overrides.id ?? "booking-1",
    booking_id: overrides.booking_id ?? "B001",
    booking_date: overrides.booking_date ?? "2026-08-01",
    pickup_time: overrides.pickup_time ?? "07:00:00",
    client_id: "client-1",
    client: { id: "client-1", name: overrides.clientName ?? "ACME", active: true },
    pickup: overrides.pickup ?? "GOOD YEAR",
    dropoff: overrides.dropoff ?? "Suvarnabhumi",
    pickup_address: "old pickup address",
    dropoff_address: "old dropoff address",
    warehouse_no: overrides.warehouse_no ?? null,
    vehicle: overrides.vehicle ?? "6ล้อ",
    vehicle_registration: overrides.vehicle_registration ?? null,
    trailer_registration: overrides.trailer_registration ?? null,
    driver: overrides.driver ?? "Somchai",
    job_order_number: overrides.job_order_number ?? "5202",
    notes: overrides.notes ?? "keep me",
    created_by: "Original user",
    created_by_user_id: "user-1",
    modified_by: "Original user",
    created_at: "2026-08-09T00:00:00Z",
    updated_at: "2026-08-09T00:00:00Z"
  };
}

const drivers = [
  { name: "Somchai", vehicleRegistration: "64-0359", vehicleType: "6 Wheel Truck" },
  { name: "Dสายัณห์", vehicleRegistration: "78-5318", vehicleType: "6 Wheel Truck" },
  { name: "Buri", vehicleRegistration: "79-2945", vehicleType: "6 + 6 Wheeler" }
];

test("filters strictly to jobs dated 1-7 August 2026", () => {
  assert.equal(inAugustWindow("2026-08-01"), true);
  assert.equal(inAugustWindow("2026-08-07T12:00:00Z"), true);
  assert.equal(inAugustWindow("2026-08-08"), false);
});

test("parses one main registration and main plus trailer", () => {
  assert.deepEqual(parseRegistrationCell("701-5145"), {
    mainRegistration: "701-5145",
    trailerRegistration: null,
    missing: false,
    reason: "Main registration parsed."
  });
  assert.deepEqual(parseRegistrationCell("701-5145 65-6919"), {
    mainRegistration: "701-5145",
    trailerRegistration: "65-6919",
    missing: false,
    reason: "Main and trailer registrations parsed."
  });
});

test("detects missing registration and vehicle description instead of guessing", () => {
  assert.equal(parseRegistrationCell("").missing, true);
  assert.equal(isVehicleDescription("6 ล้อ"), true);
  assert.equal(parseRegistrationCell("6ล้อคอก").missing, true);
});

test("normalizes driver nicknames, route spelling, and registrations for comparison", () => {
  assert.equal(normalizeComparisonText("กม 39"), normalizeComparisonText("กม39"));
  assert.equal(normalizeComparisonText("สุวรรณภูมิ"), normalizeComparisonText("suvarnabhumi"));
  assert.equal(normalizeRegistrationKey(" 701 5145 "), normalizeRegistrationKey("701-5145"));
});

test("updates an existing job only through proposed registration fields", () => {
  const result = reconcileAugustJobs({
    bossRows: [boss()],
    bookingRows: [booking({ vehicle_registration: null })],
    driverRows: drivers
  });
  assert.equal(result.items[0].status, "exact_match");
  assert.equal(result.items[0].existingBooking.id, "booking-1");
  assert.equal(result.items[0].proposedValues.vehicle_registration, "64-0359");
  assert.equal(result.items[0].existingBooking.pickup_address, "old pickup address");
  assert.equal(result.items[0].existingBooking.notes, "keep me");
});

test("upgrades Thai nickname versus English driver identity with route evidence to exact", () => {
  const result = reconcileAugustJobs({
    bossRows: [boss({ pickup: "GOOD YEAR", dropoff: "สุวรรณภูมิ", driver: "วุฒิศักด์", registrationCell: "64-0359" })],
    bookingRows: [booking({ pickup: "Good year", dropoff: "สุวรรณภูมิ", driver: "วุฒิ", vehicle: "6ล้อ", vehicle_registration: null })],
    driverRows: drivers
  });
  assert.equal(result.items[0].status, "exact_match");
  assert.match(result.items[0].evidence.join(","), /driver\/alias/);
});

test("matches formal boss names to Diary nicknames through the auditable alias table", () => {
  const result = reconcileAugustJobs({
    bossRows: [boss({ pickup: "WORLD", dropoff: "กม39", driver: "Dณัฐกิตติ์", registrationCell: "68-7154" })],
    bookingRows: [booking({ pickup: "WORLD", dropoff: "กม 39", driver: "เสมือน", vehicle: "40", vehicle_registration: null })],
    driverRows: [{ name: "Meuan", vehicleRegistration: "68-7154", vehicleType: "18 Wheeler" }]
  });
  assert.equal(result.items[0].status, "exact_match");
});

test("matches Thai and English location aliases only with independent identity evidence", () => {
  const result = reconcileAugustJobs({
    bossRows: [boss({ pickup: "CAL-COMP", dropoff: "สุวรรณภูมิ", driver: "อดิศร", registrationCell: "62-1085" })],
    bookingRows: [booking({ pickup: "แคลคอม", dropoff: "สุวรรณภูมิ", driver: "ศร", vehicle_registration: null })],
    driverRows: [{ name: "Sorn", vehicleRegistration: "62-1085", vehicleType: "6 Wheel Truck" }]
  });
  assert.equal(result.items[0].status, "exact_match");
});

test("repeated same-day routes with different drivers use driver aliases as tie-breakers", () => {
  const result = reconcileAugustJobs({
    bossRows: [boss({ pickup: "INVENTEC", dropoff: "สุวรรณภูมิ", driver: "วีระพันธ์", registrationCell: "701-5145" })],
    bookingRows: [
      booking({ id: "ede", pickup: "INVENTEC", dropoff: "สุวรรณภูมิ", driver: "อี๊ด", vehicle_registration: null }),
      booking({ id: "golf", pickup: "INVENTEC", dropoff: "สุวรรณภูมิ", driver: "กลอฟ", vehicle_registration: null })
    ],
    driverRows: [{ name: "Ede", vehicleRegistration: "701-5145", vehicleType: "6 Wheel Truck" }]
  });
  assert.equal(result.items[0].status, "exact_match");
  assert.equal(result.items[0].existingBooking.id, "ede");
});

test("marks repeated identical same-day routes as probable or conflict rather than route-only exact", () => {
  const result = reconcileAugustJobs({
    bossRows: [boss({ registrationCell: "99-9999", driver: "Unknown", jobOrderNumber: "" })],
    bookingRows: [
      booking({ id: "a", pickup: "QMB", dropoff: "สุวรรณภูมิ", job_order_number: null, driver: "A" }),
      booking({ id: "b", pickup: "QMB", dropoff: "สุวรรณภูมิ", job_order_number: null, driver: "B" })
    ],
    driverRows: drivers
  });
  assert.notEqual(result.items[0].status, "exact_match");
});

test("same date and route without a unique tie-breaker stays conflict", () => {
  const result = reconcileAugustJobs({
    bossRows: [boss({ pickup: "QMB", dropoff: "สุวรรณภูมิ", driver: "Unknown", registrationCell: "99-9999", jobOrderNumber: "" })],
    bookingRows: [
      booking({ id: "left", pickup: "QMB", dropoff: "สุวรรณภูมิ", driver: "ถึง", job_order_number: null }),
      booking({ id: "right", pickup: "QMB", dropoff: "สุวรรณภูมิ", driver: "ถึง", job_order_number: null })
    ],
    driverRows: drivers
  });
  assert.equal(result.items[0].status, "conflict");
});

test("different Thai registration prefixes sharing suffix digits do not create registration evidence", () => {
  const result = reconcileAugustJobs({
    bossRows: [boss({ pickup: "DHL", dropoff: "สุวรรณภูมิ", driver: "Unknown", registrationCell: "น9-565", jobOrderNumber: "" })],
    bookingRows: [booking({ pickup: "DHL", dropoff: "สุวรรณภูมิ", driver: "บิว", vehicle: "กระบะ", vehicle_registration: null })],
    driverRows: [{ name: "Buew", vehicleRegistration: "9565", vehicleType: "4 Wheel Truck" }]
  });
  assert.notEqual(result.items[0].evidence.includes("main registration"), true);
});

test("classifies supported missing diary rows as new jobs", () => {
  const result = reconcileAugustJobs({
    bossRows: [boss({ registrationCell: "78-5318", driver: "Dสายัณห์", pickup: "EASTERN", dropoff: "กม39", jobOrderNumber: "4816" })],
    bookingRows: [],
    driverRows: drivers
  });
  assert.equal(result.items[0].status, "new_job");
});

test("prevents duplicate source rows when rerunning the same import content", () => {
  const row = boss({ sourceRowNumber: 9, registrationCell: "701-5145 65-6919" });
  const result = reconcileAugustJobs({
    bossRows: [row, { ...row }],
    bookingRows: [],
    driverRows: drivers
  });
  assert.equal(result.items[0].status, "new_job");
  assert.equal(result.items[1].status, "duplicate");
});

test("multiple source rows cannot exact-match the same existing Diary candidate automatically", () => {
  const row = boss({ pickup: "IC", dropoff: "TG", driver: "วีระพันธ์", registrationCell: "701-5145" });
  const result = reconcileAugustJobs({
    bossRows: [row, { ...row, sourceRowNumber: 3, jobOrderNumber: "4779" }],
    bookingRows: [booking({ id: "ic", pickup: "IC", dropoff: "TG", driver: "อี๊ด", vehicle_registration: null })],
    driverRows: [{ name: "Ede", vehicleRegistration: "701-5145", vehicleType: "6 Wheel Truck" }]
  });
  assert.deepEqual(result.items.map((item) => item.status), ["conflict", "conflict"]);
});

test("migration is additive and prepares Fuel Log matching through main registration only", () => {
  const migration = fs.readFileSync(path.resolve("supabase/migrations/20260814_booking_vehicle_registration_reconciliation.sql"), "utf8");
  assert.match(migration, /add column if not exists vehicle_registration text/i);
  assert.match(migration, /add column if not exists trailer_registration text/i);
  assert.match(migration, /Fuel Log matching must use this main registration only/i);
  assert.doesNotMatch(migration, /update\s+public\.booking_diary/i);
  assert.doesNotMatch(migration, /delete\s+from\s+public\.booking_diary/i);
});

test("Booking Diary UI carries registrations through create, duplicate, display, and export", () => {
  const page = fs.readFileSync(path.resolve("app/(dashboard)/booking-diary/page.tsx"), "utf8");
  assert.match(page, /vehicle_registration:\s*form\.vehicle_registration/);
  assert.match(page, /trailer_registration:\s*form\.trailer_registration/);
  assert.match(page, /vehicle_registration:\s*booking\.vehicle_registration \?\? booking\.vehicle/);
  assert.match(page, /"Vehicle Registration": booking\.vehicle_registration/);
  assert.match(page, /"Trailer Registration": booking\.trailer_registration/);
  assert.match(page, /handleDriverChange/);
  assert.match(page, /window\.confirm\(copy\.overwriteVehicleRegistration\)/);
});

test("August reconciliation review page exposes date and status filters plus candidate diagnostics", () => {
  const page = fs.readFileSync(path.resolve("app/(dashboard)/admin/august-job-reconciliation/page.tsx"), "utf8");
  assert.match(page, /dateFilter/);
  assert.match(page, /statusFilter/);
  assert.match(page, /dailyTotals/);
  assert.match(page, /Best candidates and why review is needed/);
  assert.match(page, /Bulk approve exact matches/);
});
