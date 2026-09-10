const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

function loadTypeScriptModule(relativePath) {
  const filename = path.resolve(relativePath);
  const source = fs.readFileSync(filename, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  loaded._compile(compiled, filename);
  return loaded.exports;
}

const {
  buildVehicleFuelIntervals,
  buildVerifiedFullTankCycles,
  cyclesEndingInPeriod,
  calculateRouteAccuracy,
  calculateVehicleCoverage,
  fuelPurchasedInPeriod,
  getMondaySundayWeek,
  getTripDistanceUsed,
  uniqueLinkedFuelTotals
} = loadTypeScriptModule("lib/fuel-cycles.ts");

function fuel(overrides) {
  return {
    id: overrides.id,
    date: overrides.date,
    driver_id: "",
    driver: overrides.driver ?? "Driver A",
    vehicle_reg: overrides.vehicle_reg ?? "79-5318",
    odometer: overrides.odometer ?? null,
    mileage: overrides.mileage ?? overrides.odometer ?? null,
    litres: overrides.litres ?? 100,
    total_cost: overrides.total_cost ?? 3500,
    price_per_litre: null,
    station: "Shell",
    location: "Shell",
    fuel_type: "diesel",
    payment_method: "company_card",
    entry_source: "line_message",
    receipt_checked: overrides.receipt_checked ?? false,
    receipt_checked_at: null,
    full_tank_confirmed: overrides.full_tank_confirmed ?? false,
    full_tank_confirmed_at: null,
    notes: null,
    created_at: `${overrides.date}T00:00:00Z`,
    user_id: ""
  };
}

function trip(overrides) {
  return {
    id: overrides.id,
    booking_diary_id: overrides.booking_diary_id ?? null,
    booking_id: overrides.booking_id ?? null,
    trip_date: overrides.trip_date ?? "2026-08-10",
    vehicle_reg: overrides.vehicle_reg ?? "79-5318",
    vehicle_type: null,
    driver: overrides.driver ?? "Driver A",
    manual_actual_km: overrides.manual_actual_km ?? null,
    start_mileage: overrides.start_mileage ?? null,
    end_mileage: overrides.end_mileage ?? null,
    actual_distance_km: overrides.actual_distance_km ?? null,
    estimated_distance_km: overrides.estimated_distance_km ?? null,
    google_estimated_km: overrides.google_estimated_km ?? null,
    booking_estimated_km: null,
    manual_estimated_distance_km: null,
    fuel_source: overrides.fuel_source ?? "linked",
    manual_litres_used: null,
    manual_fuel_cost: null,
    linkedFuelLogs: overrides.linkedFuelLogs ?? []
  };
}

test("same vehicle with different drivers still forms one vehicle fuel interval", () => {
  const intervals = buildVehicleFuelIntervals([
    fuel({ id: "a", date: "2026-08-01", driver: "Sayan", mileage: 1000 }),
    fuel({ id: "b", date: "2026-08-02", driver: "Other", mileage: 1300 })
  ]);
  assert.equal(intervals.length, 1);
  assert.equal(intervals[0].distanceKm, 300);
  assert.deepEqual(intervals[0].driverNames.sort(), ["Other", "Sayan"]);
});

test("one fuel log linked to multiple trips is counted only once", () => {
  const shared = fuel({ id: "shared", date: "2026-08-03", litres: 80, total_cost: 2800 });
  const totals = uniqueLinkedFuelTotals([
    trip({ id: "t1", linkedFuelLogs: [shared] }),
    trip({ id: "t2", linkedFuelLogs: [shared] })
  ]);
  assert.deepEqual(totals, { litres: 80, cost: 2800, count: 1 });
});

test("one trip linked to multiple logs does not change exact trip distance source", () => {
  const result = getTripDistanceUsed(trip({
    id: "t1",
    estimated_distance_km: 55,
    linkedFuelLogs: [
      fuel({ id: "a", date: "2026-08-01" }),
      fuel({ id: "b", date: "2026-08-02" })
    ]
  }));
  assert.equal(result.source, "google");
  assert.equal(result.isVerifiedActual, false);
});

test("partial top-ups between two full-tank logs are summed once", () => {
  const cycles = buildVerifiedFullTankCycles([
    fuel({ id: "start", date: "2026-08-01", mileage: 1000, litres: 20, full_tank_confirmed: true }),
    fuel({ id: "partial", date: "2026-08-03", mileage: 1250, litres: 30, total_cost: 900 }),
    fuel({ id: "end", date: "2026-08-05", mileage: 1600, litres: 50, total_cost: 1500, full_tank_confirmed: true })
  ]);
  assert.equal(cycles.length, 1);
  assert.equal(cycles[0].distanceKm, 600);
  assert.equal(cycles[0].litres, 80);
  assert.equal(cycles[0].cost, 2400);
  assert.equal(cycles[0].kmPerLitre, 7.5);
});

test("receipt checked alone does not create a verified full-tank cycle", () => {
  const cycles = buildVerifiedFullTankCycles([
    fuel({ id: "a", date: "2026-08-01", mileage: 1000, receipt_checked: true }),
    fuel({ id: "b", date: "2026-08-02", mileage: 1200, receipt_checked: true })
  ]);
  assert.equal(cycles.length, 0);
});

test("invalid or decreasing odometers fail verification", () => {
  const cycles = buildVerifiedFullTankCycles([
    fuel({ id: "a", date: "2026-08-01", mileage: 1200, full_tank_confirmed: true }),
    fuel({ id: "b", date: "2026-08-02", mileage: 1100, full_tank_confirmed: true })
  ]);
  assert.equal(cycles[0].status, "invalid");
  assert.equal(cycles[0].kmPerLitre, null);
});

test("Monday-Sunday week boundaries are correct", () => {
  assert.deepEqual(getMondaySundayWeek("2026-08-23"), { startDate: "2026-08-17", endDate: "2026-08-23" });
  assert.deepEqual(getMondaySundayWeek("2026-08-19"), { startDate: "2026-08-17", endDate: "2026-08-23" });
});

test("fuel purchased totals include only fuel-log dates inside the selected week", () => {
  const totals = fuelPurchasedInPeriod([
    fuel({ id: "before", date: "2026-08-16", litres: 10, total_cost: 100 }),
    fuel({ id: "inside", date: "2026-08-17", litres: 20, total_cost: 200 }),
    fuel({ id: "end", date: "2026-08-23", litres: 30, total_cost: 300 }),
    fuel({ id: "after", date: "2026-08-24", litres: 40, total_cost: 400 })
  ], "2026-08-17", "2026-08-23");
  assert.deepEqual(totals, { litres: 50, cost: 500, count: 2 });
});

test("a cycle spanning two weeks is assigned by its ending full-tank date", () => {
  const cycles = buildVerifiedFullTankCycles([
    fuel({ id: "start", date: "2026-08-16", mileage: 1000, full_tank_confirmed: true }),
    fuel({ id: "partial", date: "2026-08-18", mileage: 1200, litres: 20 }),
    fuel({ id: "end", date: "2026-08-23", mileage: 1500, litres: 30, full_tank_confirmed: true })
  ]);
  assert.equal(cyclesEndingInPeriod(cycles, "2026-08-17", "2026-08-23").length, 1);
  assert.equal(cyclesEndingInPeriod(cycles, "2026-08-10", "2026-08-16").length, 0);
});

test("manual KM override wins over odometer and Google distance", () => {
  const result = getTripDistanceUsed(trip({ id: "t", manual_actual_km: 88, start_mileage: 1000, end_mileage: 1060, estimated_distance_km: 50 }));
  assert.equal(result.workingKm, 88);
  assert.equal(result.source, "manual");
});

test("odometer actual wins over Google when no manual override exists", () => {
  const result = getTripDistanceUsed(trip({ id: "t", start_mileage: 1000, end_mileage: 1060, estimated_distance_km: 50 }));
  assert.equal(result.workingKm, 60);
  assert.equal(result.source, "odometer");
});

test("Google-only Working KM is excluded from route-accuracy calculations", () => {
  const accuracy = calculateRouteAccuracy([
    trip({ id: "google", estimated_distance_km: 100 }),
    trip({ id: "actual", estimated_distance_km: 100, start_mileage: 1000, end_mileage: 1100 })
  ]);
  assert.equal(accuracy.sampleSize, 1);
  assert.equal(accuracy.accuracyPercent, 100);
});

test("missing actual distance cannot produce route accuracy", () => {
  const accuracy = calculateRouteAccuracy([trip({ id: "google", estimated_distance_km: 100 })]);
  assert.equal(accuracy.sampleSize, 0);
  assert.equal(accuracy.accuracyPercent, null);
});

test("unallocated movement is calculated correctly", () => {
  const coverage = calculateVehicleCoverage({ vehicleReg: "79-5318", odometerDistanceKm: 1000, linkedTripWorkingKm: 650 });
  assert.equal(coverage.otherUnallocatedKm, 350);
  assert.equal(coverage.needsReview, false);
});

test("trip KM exceeding odometer KM creates a Needs Review conflict", () => {
  const coverage = calculateVehicleCoverage({ vehicleReg: "79-5318", odometerDistanceKm: 500, linkedTripWorkingKm: 650 });
  assert.equal(coverage.otherUnallocatedKm, 0);
  assert.equal(coverage.conflictKm, 150);
  assert.equal(coverage.needsReview, true);
  assert.match(coverage.message, /exceeds odometer/);
});
