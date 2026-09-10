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

const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function resolveAlias(request, parent, isMain, options) {
  if (request.startsWith("@/")) {
    const resolved = path.resolve(request.slice(2));
    return originalResolveFilename.call(
      this,
      fs.existsSync(`${resolved}.ts`) ? `${resolved}.ts` : resolved,
      parent,
      isMain,
      options
    );
  }
  return originalResolveFilename.call(this, request, parent, isMain, options);
};

Module._extensions[".ts"] = function transpileTypeScriptDependency(loadedModule, filename) {
  const source = fs.readFileSync(filename, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  loadedModule._compile(compiled, filename);
};

const { buildFuelSpendManagementReport, groupFuelSpendStation } = loadTypeScriptModule("lib/fuel-spend-report.ts");

function fuelLog(overrides = {}) {
  const hasMileage = Object.prototype.hasOwnProperty.call(overrides, "mileage");
  const hasOdometer = Object.prototype.hasOwnProperty.call(overrides, "odometer");
  return {
    id: overrides.id ?? "log-1",
    date: overrides.date ?? "2026-09-01",
    driver_id: overrides.driver_id ?? "driver-1",
    vehicle_id: overrides.vehicle_id ?? null,
    driver: overrides.driver ?? "Driver A",
    vehicle_reg: overrides.vehicle_reg ?? "ABC-123",
    odometer: hasOdometer ? overrides.odometer : hasMileage ? overrides.mileage : 1000,
    mileage: hasMileage ? overrides.mileage : hasOdometer ? overrides.odometer : 1000,
    litres: overrides.litres ?? 10,
    total_cost: overrides.total_cost ?? 300,
    price_per_litre: overrides.price_per_litre ?? 30,
    station: overrides.station ?? null,
    location: overrides.location ?? "Bangchak Rama 2",
    fuel_type: overrides.fuel_type ?? "Diesel",
    payment_method: overrides.payment_method ?? null,
    entry_source: overrides.entry_source ?? "line_message",
    receipt_checked: overrides.receipt_checked ?? true,
    receipt_checked_at: overrides.receipt_checked_at ?? null,
    full_tank: overrides.full_tank ?? null,
    is_full_tank: overrides.is_full_tank ?? null,
    notes: overrides.notes ?? null,
    created_at: overrides.created_at ?? `${overrides.date ?? "2026-09-01"}T08:00:00Z`,
    user_id: overrides.user_id ?? null
  };
}

function report(logs, filters = {}) {
  return buildFuelSpendManagementReport(logs, {
    fromDate: "2026-09-01",
    toDate: "2026-09-07",
    ...filters
  });
}

test("uses weighted average price from total spend divided by total litres", () => {
  const result = report([
    fuelLog({ id: "a", litres: 10, total_cost: 300, price_per_litre: 30 }),
    fuelLog({ id: "b", litres: 30, total_cost: 1500, price_per_litre: 50 })
  ]);

  assert.equal(result.totalSpend, 1800);
  assert.equal(result.totalLitres, 40);
  assert.equal(result.weightedAveragePrice, 45);
});

test("compares against the previous equivalent period", () => {
  const result = report([
    fuelLog({ id: "current", date: "2026-09-02", litres: 10, total_cost: 400 }),
    fuelLog({ id: "previous", date: "2026-08-30", litres: 10, total_cost: 250 })
  ]);

  assert.equal(result.previousTotalSpend, 250);
  assert.equal(result.spendChangeAmount, 150);
  assert.equal(result.spendChangePercent, 60);
});

test("groups stations and excludes LPG from Bangchak regular-fuel compliance", () => {
  const result = report([
    fuelLog({ id: "diesel-bangchak", location: "บางจาก สาขา A", fuel_type: "Diesel" }),
    fuelLog({ id: "diesel-shell", location: "Shell", fuel_type: "Diesel" }),
    fuelLog({ id: "lpg-best", location: "Best LPG", fuel_type: "LPG" })
  ]);

  assert.equal(groupFuelSpendStation("บางจาก สาขา A"), "Bangchak");
  assert.equal(result.bangchakRegularFuelUsagePercent, 50);
  assert.equal(result.qualityCounts.non_bangchak_regular_fuel, 1);
});

test("calculates vehicle distance and efficiency only from valid mileage readings", () => {
  const result = report([
    fuelLog({ id: "first", vehicle_reg: "ABC-123", mileage: 1000, litres: 20, total_cost: 600 }),
    fuelLog({ id: "last", vehicle_reg: "ABC-123", mileage: 1300, litres: 10, total_cost: 300 }),
    fuelLog({ id: "missing", vehicle_reg: "XYZ-999", mileage: null, odometer: null, litres: 10, total_cost: 300 })
  ]);

  const measuredVehicle = result.vehicleRows.find((row) => row.vehicleReg === "ABC-123");
  const missingMileageVehicle = result.vehicleRows.find((row) => row.vehicleReg === "XYZ-999");

  assert.equal(measuredVehicle.distanceTravelled, 300);
  assert.equal(measuredVehicle.kmPerLitre, 10);
  assert.equal(measuredVehicle.fuelCostPerKm, 3);
  assert.equal(missingMileageVehicle.distanceTravelled, null);
  assert.equal(missingMileageVehicle.kmPerLitre, null);
});

test("flags missing data, unchecked receipts, duplicates, mismatches, and price anomalies", () => {
  const result = report([
    fuelLog({ id: "bad-1", vehicle_reg: "", driver: "", mileage: null, odometer: null, litres: 10, total_cost: 800, price_per_litre: 30, receipt_checked: false }),
    fuelLog({ id: "dup-1", date: "2026-09-03", vehicle_reg: "DUP-1", litres: 8, total_cost: 240, price_per_litre: 30 }),
    fuelLog({ id: "dup-2", date: "2026-09-03", vehicle_reg: "DUP-1", litres: 8, total_cost: 240, price_per_litre: 30 })
  ]);

  assert.equal(result.qualityCounts.missing_registration, 1);
  assert.equal(result.qualityCounts.missing_driver, 1);
  assert.equal(result.qualityCounts.missing_mileage, 1);
  assert.equal(result.qualityCounts.unchecked_receipt, 1);
  assert.equal(result.qualityCounts.unusual_price, 1);
  assert.equal(result.qualityCounts.cost_litre_mismatch, 1);
  assert.equal(result.qualityCounts.possible_duplicate, 2);
  assert.equal(result.reconciliationStatus, "Review required");
});

test("returns clean empty-period output without zero efficiency placeholders", () => {
  const result = report([], { fromDate: "2026-10-01", toDate: "2026-10-31" });

  assert.equal(result.totalSpend, 0);
  assert.equal(result.totalLitres, 0);
  assert.equal(result.totalFillUps, 0);
  assert.equal(result.weightedAveragePrice, null);
  assert.deepEqual(result.vehicleRows, []);
  assert.equal(result.reconciliationStatus, "Passed");
});
