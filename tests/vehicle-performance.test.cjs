const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const os = require("node:os");
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
const utilsPath = path.resolve("lib/utils.ts");
Module._cache[utilsPath] = {
  id: utilsPath,
  filename: utilsPath,
  loaded: true,
  exports: {
    normalizeComparableText(value) {
      return String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
    },
    normalizeVehicleRegistration(value) {
      return String(value ?? "").trim().replace(/\s+/g, " ").toUpperCase();
    }
  }
};

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

const originalTsExtension = Module._extensions[".ts"];
Module._extensions[".ts"] = function transpileTypeScriptDependency(loadedModule, filename) {
  const source = fs.readFileSync(filename, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  loadedModule._compile(compiled, filename);
};

const {
  addAppFuelToImportRows,
  applySavedVehiclePerformanceImportReviews,
  buildVehiclePerformanceSummary,
  buildVehicleMonthlyPerformanceRows,
  buildVehicleMonthlyTrend,
  buildVehiclePerformanceRows,
  calculateVehiclePerformanceMetrics,
  evaluateVehiclePerformanceImportStatus,
  parseVehiclePerformanceWorkbook
} = loadTypeScriptModule("lib/vehicle-performance.ts");
const {
  buildFuelSpendReportVehicleMonthlyFuelRows,
  monthDateRange
} = loadTypeScriptModule("lib/fuel-spend-report.ts");
const {
  canonicalizeKnownVehicleRegistration,
  knownVehicleRegistrationAliases
} = loadTypeScriptModule("lib/vehicle-identity.ts");

function record(overrides) {
  return {
    id: overrides.id ?? `${overrides.vehicle_registration}-${overrides.month}`,
    user_id: "",
    year: overrides.year ?? 2026,
    month: overrides.month ?? 1,
    vehicle_registration: overrides.vehicle_registration ?? "3ฒล-4565",
    salary_cost: overrides.salary_cost ?? 500,
    trip_income: overrides.trip_income ?? 60000,
    other_expenses: overrides.other_expenses ?? 0,
    gross_revenue: overrides.gross_revenue ?? 500,
    lpg_cost: overrides.lpg_cost ?? 0,
    notes: null,
    created_at: "",
    updated_at: "",
    created_by: null,
    updated_by: null
  };
}

function importRow(overrides = {}) {
  return {
    id: overrides.id ?? "row-1",
    status: overrides.status ?? "Ready",
    reason: "",
    year: overrides.year ?? 2026,
    month: overrides.month ?? 1,
    vehicleRegistration: overrides.vehicleRegistration ?? "61-2835",
    canonicalVehicleRegistration: overrides.canonicalVehicleRegistration ?? "61-2835",
    grossRevenue: overrides.grossRevenue ?? 100000,
    salaryCost: overrides.salaryCost ?? 0,
    tripIncome: overrides.tripIncome ?? 0,
    otherExpenses: overrides.otherExpenses ?? 0,
    lpgCost: overrides.lpgCost ?? 0,
    excelFuel: overrides.excelFuel ?? 1000,
    appFuel: null,
    fuelDifference: null,
    calculatedBalance: null,
    fuelLogCount: null,
    fuelMatchMonthStart: null,
    fuelMatchMonthEnd: null,
    existingRecordId: overrides.existingRecordId ?? null,
    sourceSheet: overrides.sourceSheet ?? "2026",
    sourceRowNumber: overrides.sourceRowNumber ?? 2
  };
}

function review(overrides = {}) {
  return {
    id: overrides.id ?? "review-1",
    user_id: "user-1",
    vehicle_id: overrides.vehicle_id ?? null,
    canonical_vehicle_registration: overrides.canonical_vehicle_registration ?? "61-2835",
    canonical_vehicle_registration_key: overrides.canonical_vehicle_registration_key ?? "61-2835",
    imported_vehicle_reference: overrides.imported_vehicle_reference ?? "61-2835",
    source_sheet: overrides.source_sheet ?? "2026",
    source_row_number: overrides.source_row_number ?? 42,
    source_row_key: overrides.source_row_key ?? "2026:42:2026:3:61-2835",
    year: overrides.year ?? 2026,
    month: overrides.month ?? 3,
    review_status: overrides.review_status ?? "approved",
    excel_fuel: overrides.excel_fuel ?? 1000,
    app_fuel_at_review: overrides.app_fuel_at_review ?? 2000,
    fuel_difference_at_review: overrides.fuel_difference_at_review ?? 1000,
    review_note: overrides.review_note ?? "saved review",
    reviewed_by: overrides.reviewed_by ?? "reviewer@example.com",
    reviewed_at: "",
    created_at: "",
    updated_at: ""
  };
}

test("vehicle performance fuel matches exact vehicle, month, and year only", () => {
  const rows = buildVehiclePerformanceRows({
    records: [record({ vehicle_registration: "3ฒล-4565", month: 1 })],
    fuelRows: [
      { vehicleRegistration: "3ฒล-4565", year: 2026, month: 1, fuelSpend: 1000 },
      { vehicleRegistration: "3ฒล-4565", year: 2026, month: 2, fuelSpend: 2000 },
      { vehicleRegistration: "3ฒล-4565", year: 2025, month: 1, fuelSpend: 3000 },
      { vehicleRegistration: "3ฒน-9565", year: 2026, month: 1, fuelSpend: 4000 }
    ]
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].fuelSpend, 1000);
});

test("registration matching preserves Thai prefixes and never uses suffix substring matching", () => {
  const rows = buildVehiclePerformanceRows({
    records: [record({ vehicle_registration: "3ฒล-4565", month: 1, gross_revenue: 100000 })],
    fuelRows: [
      { vehicleRegistration: "4565", year: 2026, month: 1, fuelSpend: 999999 },
      { vehicleRegistration: "3ฒล-4565", year: 2026, month: 1, fuelSpend: 1234 }
    ]
  });

  assert.equal(rows[0].fuelSpend, 1234);
});

test("all-month trend ignores fleet fuel where no performance record exists", () => {
  const trend = buildVehicleMonthlyTrend(
    [record({ vehicle_registration: "61-2835", month: 1, gross_revenue: 10000, salary_cost: 1000, trip_income: 0 })],
    [
      { vehicleRegistration: "61-2835", year: 2026, month: 1, fuelSpend: 2500 },
      { vehicleRegistration: "61-6672", year: 2026, month: 1, fuelSpend: 700000 },
      { vehicleRegistration: "61-6672", year: 2026, month: 2, fuelSpend: 800000 }
    ]
  );

  assert.equal(trend.length, 1);
  assert.equal(trend[0].month, 1);
  assert.equal(trend[0].grossRevenue, 10000);
  assert.equal(trend[0].fuelSpend, 2500);
  assert.equal(trend[0].recordedBalance, 6500);
});

test("vehicle performance metrics use the required recorded balance, margin, and fuel formulas", () => {
  const metrics = calculateVehiclePerformanceMetrics({
    grossRevenue: 100000,
    fuelSpend: 33000,
    lpgCost: 1000,
    salaryCost: 5000,
    tripIncome: 7000,
    otherExpenses: 4000
  });

  assert.equal(metrics.totalDirectCosts, 49000);
  assert.equal(metrics.recordedBalance, 51000);
  assert.equal(metrics.marginPercent, 51);
  assert.equal(metrics.fuelPercent, 33);
});

test("vehicle performance metrics handle zero revenue safely", () => {
  const metrics = calculateVehiclePerformanceMetrics({
    grossRevenue: 0,
    fuelSpend: 100,
    lpgCost: 0,
    salaryCost: 0,
    tripIncome: 0,
    otherExpenses: 0
  });

  assert.equal(metrics.recordedBalance, -100);
  assert.equal(metrics.marginPercent, null);
  assert.equal(metrics.fuelPercent, null);
});

test("vehicle aggregate totals, monthly totals, and dashboard totals reconcile", () => {
  const records = [
    record({ vehicle_registration: "61-2835", month: 1, gross_revenue: 100000, salary_cost: 5000, trip_income: 10000, other_expenses: 1500, lpg_cost: 0 }),
    record({ vehicle_registration: "61-2835", month: 2, gross_revenue: 120000, salary_cost: 5000, trip_income: 12000, other_expenses: 500, lpg_cost: 0 }),
    record({ vehicle_registration: "79-2945", month: 1, gross_revenue: 80000, salary_cost: 4500, trip_income: 9000, other_expenses: 250, lpg_cost: 100 })
  ];
  const fuelRows = [
    { vehicleRegistration: "61-2835", year: 2026, month: 1, fuelSpend: 30000 },
    { vehicleRegistration: "61-2835", year: 2026, month: 2, fuelSpend: 36000 },
    { vehicleRegistration: "79-2945", year: 2026, month: 1, fuelSpend: 22000 }
  ];
  const vehicleRows = buildVehiclePerformanceRows({ records, fuelRows });
  const monthlyRows = buildVehicleMonthlyTrend(records, fuelRows);
  const vehicleSummary = buildVehiclePerformanceSummary(vehicleRows);
  const monthlySummary = buildVehiclePerformanceSummary(monthlyRows);

  assert.equal(vehicleSummary.grossRevenue, 300000);
  assert.equal(vehicleSummary.fuelSpend, 88000);
  assert.equal(vehicleSummary.recordedBalance, 164250);
  assert.deepEqual(vehicleSummary, monthlySummary);
});

test("monthly performance rows preserve missing months instead of plotting zeroes", () => {
  const rows = buildVehicleMonthlyPerformanceRows({
    records: [
      record({ vehicle_registration: "61-2835", month: 1, gross_revenue: 100000, salary_cost: 5000, trip_income: 10000, other_expenses: 1500, lpg_cost: 999 }),
      record({ vehicle_registration: "79-2945", month: 1, gross_revenue: 80000, salary_cost: 4500, trip_income: 9000, other_expenses: 250, lpg_cost: 500 })
    ],
    fuelRows: [
      { vehicleRegistration: "61-2835", year: 2026, month: 1, fuelSpend: 30000 },
      { vehicleRegistration: "79-2945", year: 2026, month: 1, fuelSpend: 22000 }
    ],
    months: [1, 2, 3],
    expectedVehicleCount: 2
  });

  assert.equal(rows[0].status, "complete");
  assert.equal(rows[0].recordCount, 2);
  assert.equal(rows[0].vehicleCount, 2);
  assert.equal(rows[0].recordedBalance, 97750);
  assert.equal(rows[1].status, "missing");
  assert.equal(rows[1].recordCount, 0);
  assert.equal(rows[1].marginPercent, null);
  assert.equal(rows[2].status, "missing");
});

test("vehicle performance status logic follows management thresholds", () => {
  const rows = buildVehiclePerformanceRows({
    records: [
      record({ vehicle_registration: "STRONG-1", gross_revenue: 100000, salary_cost: 13000, trip_income: 0, other_expenses: 0, lpg_cost: 0 }),
      record({ vehicle_registration: "STABLE-1", gross_revenue: 100000, salary_cost: 13700, trip_income: 0, other_expenses: 0, lpg_cost: 0 }),
      record({ vehicle_registration: "MONITOR-1", gross_revenue: 100000, salary_cost: 14000, trip_income: 0, other_expenses: 0, lpg_cost: 0 }),
      record({ vehicle_registration: "NEEDS-1", gross_revenue: 100000, salary_cost: 66000, trip_income: 0, other_expenses: 0, lpg_cost: 0 }),
      record({ vehicle_registration: "FUEL-1", gross_revenue: 100000, salary_cost: 0, trip_income: 0, other_expenses: 0, lpg_cost: 0 })
    ],
    fuelRows: [
      { vehicleRegistration: "STRONG-1", year: 2026, month: 1, fuelSpend: 35000 },
      { vehicleRegistration: "STABLE-1", year: 2026, month: 1, fuelSpend: 35600 },
      { vehicleRegistration: "MONITOR-1", year: 2026, month: 1, fuelSpend: 41000 },
      { vehicleRegistration: "NEEDS-1", year: 2026, month: 1, fuelSpend: 0 },
      { vehicleRegistration: "FUEL-1", year: 2026, month: 1, fuelSpend: 46000 }
    ]
  });
  const statusByVehicle = new Map(rows.map((row) => [row.vehicleRegistration, row.status]));

  assert.equal(statusByVehicle.get("STRONG-1"), "strong");
  assert.equal(statusByVehicle.get("STABLE-1"), "stable");
  assert.equal(statusByVehicle.get("MONITOR-1"), "monitor");
  assert.equal(statusByVehicle.get("NEEDS-1"), "needsAttention");
  assert.equal(statusByVehicle.get("FUEL-1"), "needsAttention");
});

test("Excel preview excludes dummy and total rows, detects duplicates, and maps only exact approved vehicles", () => {
  const preview = parseVehiclePerformanceWorkbook({
    worksheets: [{
      sheetName: "January 2026",
      rows: [
        ["ทะเบียนรถ", "เงินเดือน", "ค่าเที่ยว", "ค่าใช้จ่าย", "รวมรับ", "น้ำมัน", "LPG"],
        ["DUMMY", 1, 2, 3, 4, 5, 6],
        ["3ฒล-4565", 500, 60000, 10, 100000, 1234, 20],
        ["9999", 500, 60000, 10, 100000, 1234, 20],
        ["TOTAL", "", "", "", 100000, 1234, 20]
      ]
    }],
    vehicles: [{ vehicle_reg: "3ฒล-4565" }],
    existingRecords: [record({ id: "existing", vehicle_registration: "3ฒล-4565", month: 1 })],
    fallbackYear: 2026
  });

  assert.equal(preview.filter((row) => row.status === "Skipped").length, 3);
  assert.equal(preview.find((row) => row.vehicleRegistration === "3ฒล-4565").status, "Duplicate");
  assert.equal(preview.find((row) => row.vehicleRegistration === "9999").status, "Vehicle not matched");
});

test("Excel preview maps only explicit legacy registration aliases", () => {
  const preview = parseVehiclePerformanceWorkbook({
    worksheets: [{
      sheetName: "2026",
      rows: [
        [7, "ทะเบียนรถ", "เงินเดือน", "ค่าเที่ยว", "ค่าใช่จ่าย", "รวมรับ", "น้ำมัน", "LPG"],
        [7, "3ฒน-9565", 500, 60000, 10, 100000, 1234, 20],
        [7, "3ฒล-4565", 500, 60000, 10, 100000, 1234, 20],
        [7, "ฒอ-8453", 500, 60000, 10, 100000, 1234, 20],
        [7, "ABC-4565", 500, 60000, 10, 100000, 1234, 20]
      ]
    }],
    vehicles: [{ vehicle_reg: "3ฒน-9565" }, { vehicle_reg: "3ฒล-4565" }, { vehicle_reg: "ฒอ-8453" }],
    existingRecords: [],
    fallbackYear: 2026
  });

  assert.equal(preview.find((row) => row.vehicleRegistration === "3ฒน-9565").canonicalVehicleRegistration, "3ฒน-9565");
  assert.equal(preview.find((row) => row.vehicleRegistration === "3ฒล-4565").canonicalVehicleRegistration, "3ฒล-4565");
  assert.equal(preview.find((row) => row.vehicleRegistration === "ฒอ-8453").canonicalVehicleRegistration, "ฒอ-8453");
  assert.equal(preview.find((row) => row.vehicleRegistration === "ABC-4565").status, "Vehicle not matched");
});

test("known registration corrections canonicalize only confirmed same-vehicle mappings", () => {
  assert.equal(canonicalizeKnownVehicleRegistration("9565"), "3ฒน-9565");
  assert.equal(canonicalizeKnownVehicleRegistration("4565"), "3ฒล-4565");
  assert.equal(canonicalizeKnownVehicleRegistration("8453"), "ฒอ-8453");
  assert.equal(canonicalizeKnownVehicleRegistration("100-6659"), "700-6659");
  assert.equal(canonicalizeKnownVehicleRegistration("5956"), "5956");
  assert.deepEqual(knownVehicleRegistrationAliases("3ฒน-9565").sort(), ["3ฒน-9565", "9565"].sort());
  assert.deepEqual(knownVehicleRegistrationAliases("700-6659").sort(), ["100-6659", "700-6659"].sort());
});

test("Excel preview maps abbreviated historical registrations to full canonical vehicles", () => {
  const preview = parseVehiclePerformanceWorkbook({
    worksheets: [{
      sheetName: "2026",
      rows: [
        [7, "ทะเบียนรถ", "เงินเดือน", "ค่าเที่ยว", "ค่าใช่จ่าย", "รวมรับ", "น้ำมัน", "LPG"],
        [7, "9565", 500, 60000, 10, 100000, 1234, 20],
        [7, "4565", 500, 60000, 10, 100000, 1234, 20],
        [7, "8453", 500, 60000, 10, 100000, 1234, 20]
      ]
    }],
    vehicles: [{ vehicle_reg: "3ฒน-9565" }, { vehicle_reg: "3ฒล-4565" }, { vehicle_reg: "ฒอ-8453" }],
    existingRecords: [],
    fallbackYear: 2026
  });

  assert.equal(preview.find((row) => row.vehicleRegistration === "9565").canonicalVehicleRegistration, "3ฒน-9565");
  assert.equal(preview.find((row) => row.vehicleRegistration === "4565").canonicalVehicleRegistration, "3ฒล-4565");
  assert.equal(preview.find((row) => row.vehicleRegistration === "8453").canonicalVehicleRegistration, "ฒอ-8453");
});

test("Vehicle Performance fuel rows reuse Fuel Spend Report date and cost semantics", () => {
  const rows = buildFuelSpendReportVehicleMonthlyFuelRows([
    { date: "2026-07-01", vehicle_reg: "701-5145", total_cost: 100 },
    { date: "2026-07-31T23:59:59+07:00", vehicle_reg: "701-5145", total_cost: 250 },
    { date: "2026-08-01", vehicle_reg: "701-5145", total_cost: 999 },
    { date: "2026-07-15", vehicle_reg: " 701-5145 ", total_cost: "50.5" }
  ], { year: 2026, month: 7 });

  assert.deepEqual(rows, [{
    vehicleRegistration: "701-5145",
    year: 2026,
    month: 7,
    fuelSpend: 400.5,
    fuelLogCount: 3,
    monthStart: "2026-07-01",
    monthEnd: "2026-07-31"
  }]);
});

test("Fuel Spend Report groups explicit old and corrected registrations under the full vehicle", () => {
  const rows = buildFuelSpendReportVehicleMonthlyFuelRows([
    { date: "2026-05-02", vehicle_reg: "9565", total_cost: 1000 },
    { date: "2026-05-03", vehicle_reg: "3ฒน-9565", total_cost: 2500 },
    { date: "2026-05-04", vehicle_reg: "5956", total_cost: 900 }
  ], { year: 2026, month: 5 });

  const corrected = rows.find((row) => row.vehicleRegistration === "3ฒน-9565");
  assert.equal(corrected?.fuelSpend, 3500);
  assert.equal(corrected?.fuelLogCount, 2);
  assert.equal(rows.some((row) => row.vehicleRegistration === "9565"), false);
  assert.equal(rows.find((row) => row.vehicleRegistration === "5956")?.fuelSpend, 900);
});

test("Fuel Spend Report groups 100-6659 fuel logs under canonical 700-6659", () => {
  const rows = buildFuelSpendReportVehicleMonthlyFuelRows([
    { date: "2026-03-03", vehicle_reg: "700-6659", total_cost: 35430.2 },
    { date: "2026-03-20", vehicle_reg: "100-6659", total_cost: 1600 },
    { date: "2026-03-30", vehicle_reg: "100-6659", total_cost: 19360 },
    { date: "2026-04-01", vehicle_reg: "100-6659", total_cost: 999999 }
  ], { year: 2026, month: 3 });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].vehicleRegistration, "700-6659");
  assert.equal(rows[0].fuelSpend, 56390.2);
  assert.equal(rows[0].fuelLogCount, 3);
});

test("Vehicle Performance import maps 100-6659 workbook rows to canonical 700-6659", () => {
  const preview = parseVehiclePerformanceWorkbook({
    worksheets: [{
      sheetName: "March 2026",
      rows: [
        ["ทะเบียนรถ", "เงินเดือน", "ค่าเที่ยว", "ค่าใช้จ่าย", "รวมรับ", "น้ำมัน", "LPG"],
        ["100-6659", 500, 60000, 10, 100000, 56390.2, 20]
      ]
    }],
    vehicles: [{ vehicle_reg: "700-6659" }],
    existingRecords: [],
    fallbackYear: 2026
  });

  const [row] = addAppFuelToImportRows(preview.filter((item) => item.status !== "Skipped"), [
    { vehicleRegistration: "700-6659", year: 2026, month: 3, fuelSpend: 56390.2, fuelLogCount: 21 }
  ]);

  assert.equal(row.vehicleRegistration, "100-6659");
  assert.equal(row.canonicalVehicleRegistration, "700-6659");
  assert.equal(row.appFuel, 56390.2);
  assert.equal(row.status, "Ready");
});

test("Vehicle Performance import debug ranges are monthly even when fuel rows came from an all-year fetch", () => {
  const [januaryFuel] = buildFuelSpendReportVehicleMonthlyFuelRows([
    { date: "2026-01-15", vehicle_reg: "61-2835", total_cost: 350 }
  ], { year: 2026, month: "" });
  const rows = addAppFuelToImportRows(
    [importRow({ month: 1, excelFuel: 350 })],
    [januaryFuel]
  );

  assert.equal(januaryFuel.monthStart, "2026-01-01");
  assert.equal(januaryFuel.monthEnd, "2026-01-31");
  assert.equal(rows[0].fuelMatchMonthStart, "2026-01-01");
  assert.equal(rows[0].fuelMatchMonthEnd, "2026-01-31");
  assert.equal(rows[0].fuelLogCount, 1);
});

test("Vehicle Performance import month boundaries cover January through July 2026", () => {
  const expected = [
    [1, "2026-01-01", "2026-01-31"],
    [2, "2026-02-01", "2026-02-28"],
    [3, "2026-03-01", "2026-03-31"],
    [4, "2026-04-01", "2026-04-30"],
    [5, "2026-05-01", "2026-05-31"],
    [6, "2026-06-01", "2026-06-30"],
    [7, "2026-07-01", "2026-07-31"]
  ];

  for (const [month, start, end] of expected) {
    const [row] = addAppFuelToImportRows(
      [importRow({ month, excelFuel: month * 100 })],
      [{ vehicleRegistration: "61-2835", year: 2026, month, fuelSpend: month * 100, fuelLogCount: month }]
    );

    assert.equal(row.year, 2026);
    assert.equal(row.fuelMatchMonthStart, start);
    assert.equal(row.fuelMatchMonthEnd, end);
  }
});

test("Vehicle Performance import uses non-leap and leap February boundaries explicitly", () => {
  assert.deepEqual(monthDateRange(2026, 2), { fromDate: "2026-02-01", toDate: "2026-02-28" });
  assert.deepEqual(monthDateRange(2028, 2), { fromDate: "2028-02-01", toDate: "2028-02-29" });
});

test("Vehicle Performance parser does not convert expense values or Buddhist Era-looking cells into years", () => {
  const preview = parseVehiclePerformanceWorkbook({
    worksheets: [{
      sheetName: "2026",
      rows: [
        [2, "ทะเบียนรถ", "เงินเดือน", "ค่าเที่ยว", "ค่าใช่จ่าย", "รวมรับ", "น้ำมัน", "LPG"],
        [2, "61-2835", 8000, 14850, 2085, 158900, 52960, ""],
        [3, "61-2835", 8000, 14850, "พ.ศ. 2569", 158900, 52960, ""]
      ]
    }],
    vehicles: [{ vehicle_reg: "61-2835" }],
    existingRecords: [],
    fallbackYear: 2026
  }).filter((row) => row.status !== "Skipped");

  assert.equal(preview.length, 2);
  assert.deepEqual(preview.map((row) => row.year), [2026, 2026]);
  assert.deepEqual(preview.map((row) => row.month), [2, 3]);
  assert.equal(preview[0].fuelMatchMonthStart, "2026-02-01");
  assert.equal(preview[0].fuelMatchMonthEnd, "2026-02-28");
  assert.ok(preview.every((row) => row.year !== 2085));
});

test("Vehicle Performance fuel and identity stay registration-based when drivers change", () => {
  const fuelRows = buildFuelSpendReportVehicleMonthlyFuelRows([
    { date: "2026-07-04", vehicle_reg: "79-2945", driver: "Driver A", total_cost: 1200 },
    { date: "2026-07-18", vehicle_reg: "79-2945", driver: "Driver B", total_cost: 2300 },
    { date: "2026-07-20", vehicle_reg: "79-5318", driver: "Driver A", total_cost: 9999 }
  ], { year: 2026, month: 7 });
  const rows = buildVehiclePerformanceRows({
    records: [record({ vehicle_registration: "79-2945", month: 7, gross_revenue: 10000, salary_cost: 0, trip_income: 0 })],
    fuelRows
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].vehicleRegistration, "79-2945");
  assert.equal(rows[0].fuelSpend, 3500);
});

test("Excel fuel is verification only and fuel differences are displayed", () => {
  const [row] = addAppFuelToImportRows([
    importRow({ grossRevenue: 10000, sourceSheet: "January" })
  ], [{ vehicleRegistration: "61-2835", year: 2026, month: 1, fuelSpend: 1250, fuelLogCount: 2 }]);

  assert.equal(row.status, "Historical fuel difference");
  assert.equal(row.appFuel, 1250);
  assert.equal(row.fuelDifference, 250);
  assert.equal(row.calculatedBalance, 8750);
  assert.equal(row.fuelLogCount, 2);
  assert.equal(row.fuelMatchMonthStart, "2026-01-01");
  assert.equal(row.fuelMatchMonthEnd, "2026-01-31");
});

test("Excel import marks missing app fuel separately from review thresholds", () => {
  const baseRow = importRow({ month: 5, excelFuel: 86846.9, sourceSheet: "May" });

  const [missing] = addAppFuelToImportRows([baseRow], []);
  const [ready] = addAppFuelToImportRows([{ ...baseRow, excelFuel: 1000 }], [
    { vehicleRegistration: "61-2835", year: 2026, month: 5, fuelSpend: 1099.99, fuelLogCount: 1 }
  ]);
  const [review] = addAppFuelToImportRows([{ ...baseRow, excelFuel: 1000 }], [
    { vehicleRegistration: "61-2835", year: 2026, month: 5, fuelSpend: 1500.01, fuelLogCount: 1 }
  ]);

  assert.equal(missing.status, "Fuel data missing");
  assert.equal(ready.status, "Ready");
  assert.equal(review.status, "Needs review");
});

test("January and February 2026 large fuel differences are historical and importable", () => {
  const [january] = addAppFuelToImportRows([importRow({ month: 1, excelFuel: 50000 })], [
    { vehicleRegistration: "61-2835", year: 2026, month: 1, fuelSpend: 1000, fuelLogCount: 1 }
  ]);
  const [february] = addAppFuelToImportRows([importRow({ month: 2, excelFuel: 52960 })], [
    { vehicleRegistration: "61-2835", year: 2026, month: 2, fuelSpend: 0, fuelLogCount: 0 }
  ]);

  assert.equal(january.status, "Historical fuel difference");
  assert.equal(february.status, "Historical fuel difference");
  assert.equal(january.fuelDifference, -49000);
  assert.equal(february.fuelDifference, -52960);
  assert.equal(january.calculatedBalance, 99000);
  assert.equal(february.calculatedBalance, 100000);
});

test("March through July 2026 keep strict fuel review logic", () => {
  for (const month of [3, 4, 5, 6, 7]) {
    const [missing] = addAppFuelToImportRows([importRow({ month, excelFuel: 1000 })], []);
    const [ready] = addAppFuelToImportRows([importRow({ month, excelFuel: 1000 })], [
      { vehicleRegistration: "61-2835", year: 2026, month, fuelSpend: 1100, fuelLogCount: 1 }
    ]);
    const [warning] = addAppFuelToImportRows([importRow({ month, excelFuel: 1000 })], [
      { vehicleRegistration: "61-2835", year: 2026, month, fuelSpend: 1500, fuelLogCount: 1 }
    ]);
    const [review] = addAppFuelToImportRows([importRow({ month, excelFuel: 1000 })], [
      { vehicleRegistration: "61-2835", year: 2026, month, fuelSpend: 1500.01, fuelLogCount: 1 }
    ]);

    assert.equal(missing.status, "Fuel data missing");
    assert.equal(ready.status, "Ready");
    assert.equal(warning.status, "Fuel warning");
    assert.equal(review.status, "Needs review");
  }
});

test("named March-July exception examples remain manual review rows", () => {
  const rows = addAppFuelToImportRows([
    importRow({ id: "mar-700-6659", month: 3, vehicleRegistration: "700-6659", canonicalVehicleRegistration: "700-6659", excelFuel: 30000 }),
    importRow({ id: "apr-79-2945", month: 4, vehicleRegistration: "79-2945", canonicalVehicleRegistration: "79-2945", excelFuel: 25000 }),
    importRow({ id: "may-79-2945", month: 5, vehicleRegistration: "79-2945", canonicalVehicleRegistration: "79-2945", excelFuel: 10000 }),
    importRow({ id: "jul-700-4145", month: 7, vehicleRegistration: "700-4145", canonicalVehicleRegistration: "700-4145", excelFuel: 10000 })
  ], [
    { vehicleRegistration: "700-6659", year: 2026, month: 3, fuelSpend: 9121, fuelLogCount: 4 },
    { vehicleRegistration: "79-2945", year: 2026, month: 4, fuelSpend: 16000, fuelLogCount: 3 },
    { vehicleRegistration: "79-2945", year: 2026, month: 5, fuelSpend: 18050, fuelLogCount: 5 },
    { vehicleRegistration: "700-4145", year: 2026, month: 7, fuelSpend: 10655.7, fuelLogCount: 2 }
  ]);

  assert.equal(rows.find((row) => row.id === "mar-700-6659").fuelDifference, -20879);
  assert.equal(rows.find((row) => row.id === "apr-79-2945").fuelDifference, -9000);
  assert.equal(rows.find((row) => row.id === "may-79-2945").fuelDifference, 8050);
  assert.equal(Number(rows.find((row) => row.id === "jul-700-4145").fuelDifference.toFixed(2)), 655.7);
  assert.deepEqual(rows.map((row) => row.status), ["Needs review", "Needs review", "Needs review", "Needs review"]);
});

test("61-2835 May 2026 import preview uses matching registration and May fuel logs", () => {
  const preview = parseVehiclePerformanceWorkbook({
    worksheets: [{
      sheetName: "May 2026",
      rows: [
        ["ทะเบียนรถ", "เงินเดือน", "ค่าเที่ยว", "ค่าใช้จ่าย", "รวมรับ", "น้ำมัน", "LPG"],
        ["61-2835", 500, 60000, 10, 100000, 86846.9, 20]
      ]
    }],
    vehicles: [{ vehicle_reg: "61-2835" }],
    existingRecords: [],
    fallbackYear: 2026
  });
  const [row] = addAppFuelToImportRows(preview.filter((item) => item.status !== "Skipped"), [
    { vehicleRegistration: "61-2835", year: 2026, month: 5, fuelSpend: 40000, fuelLogCount: 2 },
    { vehicleRegistration: " 61-2835 ", year: 2026, month: 5, fuelSpend: 46846.9, fuelLogCount: 3 },
    { vehicleRegistration: "61-2835", year: 2026, month: 6, fuelSpend: 999999, fuelLogCount: 1 },
    { vehicleRegistration: "61-2836", year: 2026, month: 5, fuelSpend: 999999, fuelLogCount: 1 }
  ]);

  assert.equal(row.vehicleRegistration, "61-2835");
  assert.equal(row.month, 5);
  assert.equal(row.appFuel, 86846.9);
  assert.equal(row.fuelDifference, 0);
  assert.equal(row.fuelLogCount, 5);
  assert.equal(row.status, "Ready");
});

test("Vehicle Performance fuel aggregation matches registration plus month only", () => {
  const fuelRows = buildFuelSpendReportVehicleMonthlyFuelRows([
    { date: "2026-02-01", vehicle_reg: " 61-2835 ", driver: "Driver A", total_cost: 100 },
    { date: "2026-02-28T23:59:59+07:00", vehicle_reg: "61-2835", driver: "Driver B", total_cost: 200 },
    { date: "2026-03-01", vehicle_reg: "61-2835", driver: "Driver A", total_cost: 999 },
    { date: "2026-02-15", vehicle_reg: "61-2836", driver: "Driver A", total_cost: 999 }
  ], { year: 2026, month: 2 });
  const [row] = addAppFuelToImportRows([importRow({ month: 2, excelFuel: 300 })], fuelRows);

  assert.equal(row.appFuel, 300);
  assert.equal(row.fuelLogCount, 2);
  assert.equal(row.fuelMatchMonthStart, "2026-02-01");
  assert.equal(row.fuelMatchMonthEnd, "2026-02-28");
  assert.equal(row.status, "Ready");
});

test("real .xlsx workbook rows parse into an import preview", () => {
  const XLSX = require("xlsx");
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet([
    [1, "ทะเบียนรถ", "เงินเดือน", "ค่าเที่ยว", "ค่าใช่จ่าย", "รวมรับ", "น้ำมัน", "LPG", "อื่น", "คงเหลือ"],
    [1, "DUMMY", 0, 0, 0, 0, 0, 0, "", ""],
    [1, "61-2835", 500, 60000, 25, 100000, 1234, 20, "", ""],
    [1, "TOTAL", "", "", "", 100000, 1234, 20, "", ""],
    [],
    [2, "ทะเบียนรถ", "เงินเดือน", "ค่าเที่ยว", "ค่าใช่จ่าย", "รวมรับ", "น้ำมัน", "LPG", "อื่น", "คงเหลือ"],
    [2, "61-2835", 600, 61000, 35, 101000, 1300, 30, "", ""]
  ]);
  XLSX.utils.book_append_sheet(workbook, worksheet, "2026");
  const workbookPath = path.join(os.tmpdir(), `vehicle-performance-${Date.now()}.xlsx`);

  try {
    XLSX.writeFile(workbook, workbookPath);
    const loadedWorkbook = XLSX.readFile(workbookPath);
    const worksheets = loadedWorkbook.SheetNames.map((sheetName) => ({
      sheetName,
      rows: XLSX.utils.sheet_to_json(loadedWorkbook.Sheets[sheetName], { header: 1, raw: true, defval: "" })
    }));
    const preview = parseVehiclePerformanceWorkbook({
      worksheets,
      vehicles: [{ vehicle_reg: "61-2835" }],
      existingRecords: [],
      fallbackYear: 2026
    });
    const readyRows = preview.filter((row) => row.vehicleRegistration === "61-2835");

    assert.equal(readyRows.length, 2);
    assert.equal(readyRows[0].status, "Ready");
    assert.equal(readyRows[0].month, 1);
    assert.equal(readyRows[0].grossRevenue, 100000);
    assert.equal(readyRows[0].otherExpenses, 25);
    assert.equal(readyRows[1].month, 2);
    assert.equal(preview.filter((row) => row.status === "Skipped").length, 5);
  } finally {
    if (fs.existsSync(workbookPath)) fs.unlinkSync(workbookPath);
  }
});

test("actual Vehicle Performance import workbook parses expected monthly vehicle rows when present", () => {
  const actualWorkbookPath = "C:\\Users\\User\\Downloads\\Vehicle_Performance_Import_Jan-Jul_2026.xlsx";
  if (!fs.existsSync(actualWorkbookPath)) {
    return;
  }

  const XLSX = require("xlsx");
  const workbook = XLSX.readFile(actualWorkbookPath);
  const worksheets = workbook.SheetNames.map((sheetName) => ({
    sheetName,
    rows: XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, raw: true, defval: "" })
  }));
  const vehicleRegs = new Set();
  for (const worksheet of worksheets) {
    for (const row of worksheet.rows) {
      const registration = String(row[1] ?? "").trim();
      const normalized = registration.toLowerCase();
      if (!registration || normalized === "ทะเบียนรถ" || normalized.includes("dummy") || normalized.includes("total") || registration.includes("รวม")) {
        continue;
      }
      vehicleRegs.add(registration);
    }
  }

  const preview = parseVehiclePerformanceWorkbook({
    worksheets,
    vehicles: Array.from(vehicleRegs, (vehicle_reg) => ({ vehicle_reg })),
    existingRecords: [],
    fallbackYear: 2026
  });
  const vehicleRows = preview.filter((row) => row.status !== "Skipped");
  const months = new Set(vehicleRows.map((row) => row.month));
  const monthRanges = new Map(
    vehicleRows.map((row) => [row.month, `${row.fuelMatchMonthStart}|${row.fuelMatchMonthEnd}`])
  );

  assert.equal(workbook.SheetNames.includes("2026"), true);
  assert.equal(months.size, 7);
  assert.deepEqual(Array.from(new Set(vehicleRows.map((row) => row.year))), [2026]);
  assert.equal(monthRanges.get(1), "2026-01-01|2026-01-31");
  assert.equal(monthRanges.get(2), "2026-02-01|2026-02-28");
  assert.equal(monthRanges.get(3), "2026-03-01|2026-03-31");
  assert.equal(monthRanges.get(4), "2026-04-01|2026-04-30");
  assert.equal(monthRanges.get(5), "2026-05-01|2026-05-31");
  assert.equal(monthRanges.get(6), "2026-06-01|2026-06-30");
  assert.equal(monthRanges.get(7), "2026-07-01|2026-07-31");
  assert.equal(vehicleRows.some((row) => row.year === 2085), false);
  assert.ok(vehicleRows.length >= 130, `Expected at least 130 vehicle rows, got ${vehicleRows.length}`);
  assert.ok(vehicleRows.length <= 160, `Expected at most 160 vehicle rows, got ${vehicleRows.length}`);
});

test("Vehicle Performance import fetches fuel by parsed row month, not whole year", () => {
  const page = fs.readFileSync(path.resolve("app/(dashboard)/vehicle-performance/page.tsx"), "utf8");
  const data = fs.readFileSync(path.resolve("lib/data.ts"), "utf8");
  const helper = fs.readFileSync(path.resolve("lib/vehicle-performance.ts"), "utf8");

  assert.match(page, /fetchVehicleMonthlyFuelSpend\(period\)/);
  assert.match(page, /row\.status === "Ready" \|\| row\.status === "Historical fuel difference"/);
  assert.doesNotMatch(page, /fetchVehicleMonthlyFuelSpend\(\{\s*year:\s*rowYear,\s*month:\s*""\s*\}\)/);
  assert.match(data, /monthDateRange\(filters\.year,\s*filters\.month\)/);
  assert.match(data, /fetchFuelLogsForExport\(\{\s*fromDate:\s*range\.fromDate,\s*toDate:\s*range\.toDate\s*\}\)/);
});

test("Vehicle Performance exception review UI is manual and importable only after approval", () => {
  const page = fs.readFileSync(path.resolve("app/(dashboard)/vehicle-performance/page.tsx"), "utf8");
  const data = fs.readFileSync(path.resolve("lib/data.ts"), "utf8");
  const helper = fs.readFileSync(path.resolve("lib/vehicle-performance.ts"), "utf8");

  assert.match(page, /View fuel details/);
  assert.match(page, /Approve using App Fuel/);
  assert.match(page, /Mark for correction/);
  assert.match(page, /Edit correction/);
  assert.match(page, /Save correction/);
  assert.match(page, /Resolve correction/);
  assert.match(page, /Fix\/reassign vehicle registration/);
  assert.match(page, /Recalculate Row/);
  assert.match(page, /Recalculate from Fuel Logs/);
  assert.match(page, /status:\s*"Approved"/);
  assert.match(page, /status:\s*"Correction required"/);
  assert.match(page, /"Resolved"/);
  assert.match(page, /Review required again/);
  assert.match(page, /Review history/);
  assert.match(helper, /Previously approved - values have changed/);
  assert.match(page, /row\.status === "Ready" \|\| row\.status === "Historical fuel difference" \|\| row\.status === "Approved"/);
  assert.match(page, /Import exception manually reviewed and approved/);
  assert.match(page, /saveVehiclePerformanceImportReview/);
  assert.match(page, /fetchVehiclePerformanceImportReviews/);
  assert.match(page, /applySavedVehiclePerformanceImportReviews/);
  assert.match(page, /deleteVehiclePerformanceImportReview/);
  assert.match(page, /fetchFuelLogsForExport\(\{\s*fromDate:\s*row\.fuelMatchMonthStart,\s*toDate:\s*row\.fuelMatchMonthEnd\s*\}\)/);
  assert.match(page, /knownVehicleRegistrationAliases/);
  assert.match(page, /Needs Review remaining/);
  assert.match(page, /Corrections required/);
  assert.match(data, /\.from\("vehicle_performance_import_reviews"\)/);
  assert.match(data, /onConflict:\s*"user_id,year,month,canonical_vehicle_registration_key"/);
  assert.match(data, /source_sheet/);
  assert.match(data, /source_row_number/);
  assert.match(data, /source_row_key/);
  assert.match(data, /reviewed_by/);
  assert.match(data, /saveVehiclePerformanceCorrectionAudit/);
  assert.match(data, /\.from\("vehicle_performance_correction_audit"\)/);
  assert.match(data, /dispatchDataChange\("vehicle_performance_import_reviews"\)/);
});

test("Vehicle Performance dashboard layout prioritizes management view and keeps data tools collapsed", () => {
  const page = fs.readFileSync(path.resolve("app/(dashboard)/vehicle-performance/page.tsx"), "utf8");

  assert.match(page, /Revenue, recorded direct costs and vehicle performance/);
  assert.match(page, /<BusinessImpact /);
  assert.match(page, /<ActionQueue /);
  assert.match(page, /Monthly Performance/);
  assert.match(page, /Data Quality/);
  assert.match(page, /Data Management/);
  assert.match(page, /All loaded months/);
  assert.match(page, /Months With Data/);
  assert.match(page, /Vehicles Included/);
  assert.match(page, /Fleet performance/);
  assert.match(page, /vehicles analysed/);
  assert.match(page, /Stable/);
  assert.match(page, /formatCompactBaht\(summary\.grossRevenue\)/);
  assert.match(page, /buildVehicleMonthlyPerformanceRows/);
  assert.match(page, /buildVehiclePerformanceSummary\(rows\)/);
  assert.match(page, /buildVehiclePerformanceSummary\(monthlyTrend\)/);
  assert.match(page, /Advanced data checks/);
  assert.match(page, /reconciliationDebug/);
  assert.match(page, /Data reconciled/);
  assert.match(page, /Summary ↔ vehicle table/);
  assert.match(page, /Vehicles with performance data/);
  assert.match(page, /VEHICLE_PERFORMANCE_STATUS_RULES/);
  assert.match(page, /buildPerformanceManagement/);
  assert.match(page, /trendMetric/);
});

test("Vehicle Performance PDF report uses canonical page sections and avoids net profit wording", () => {
  const page = fs.readFileSync(path.resolve("app/(dashboard)/vehicle-performance/page.tsx"), "utf8");

  assert.match(page, /Download PDF Report/);
  assert.match(page, /buildVehiclePerformancePdfData/);
  assert.match(page, /Vehicle Performance Management Report/);
  assert.match(page, /Recorded Balance after recorded direct costs/);
  assert.match(page, /Monthly Performance/);
  assert.match(page, /Monthly Trend/);
  assert.match(page, /Fleet Health/);
  assert.match(page, /Management Highlights/);
  assert.match(page, /Vehicles to Review/);
  assert.match(page, /Top 5 Vehicles by Recorded Balance/);
  assert.match(page, /Vehicle Performance Table/);
  assert.match(page, /Data Quality/);
  assert.match(page, /Recorded Balance represents revenue remaining after the direct costs recorded in the Fuel Bank system/);
  assert.match(page, /summary\.grossRevenue/);
  assert.match(page, /summary\.fuelSpend/);
  assert.match(page, /summary\.recordedBalance/);
  assert.match(page, /monthlyPerformanceRows/);
  assert.match(page, /sortedRows/);
  assert.doesNotMatch(page, /Net Profit/);
});

test("Vehicle Performance All Months mode has no repeated row edit/delete warning, while month mode keeps actions", () => {
  const page = fs.readFileSync(path.resolve("app/(dashboard)/vehicle-performance/page.tsx"), "utf8");

  assert.match(page, /Select a specific month to edit monthly records/);
  assert.match(page, /month !== "" \? <th className="table-head-cell sticky right-0/);
  assert.match(page, /sourceRecord = matchingRecords\.length === 1 && month !== ""/);
  assert.match(page, /showActions=\{month !== ""\}/);
  assert.doesNotMatch(page, /matchingRecords\.length > 1 \? \(\s*<span[^>]+>\{labels\.selectMonthToEdit\}/);
});

test("approved import reviews persist and make manual exceptions importable", () => {
  const [normal] = addAppFuelToImportRows([importRow({ month: 3, excelFuel: 1000 })], [
    { vehicleRegistration: "61-2835", year: 2026, month: 3, fuelSpend: 2000, fuelLogCount: 2 }
  ]);

  assert.equal(normal.status, "Needs review");

  const [approved] = applySavedVehiclePerformanceImportReviews([normal], [
    review({ month: 3, review_status: "approved", app_fuel_at_review: 2000 })
  ]);

  assert.equal(approved.status, "Approved");
  assert.match(approved.reason, /saved review/);
});

test("correction-required import reviews persist and block import after reload", () => {
  const [normal] = addAppFuelToImportRows([importRow({ month: 4, excelFuel: 1000 })], [
    { vehicleRegistration: "61-2835", year: 2026, month: 4, fuelSpend: 2000, fuelLogCount: 2 }
  ]);
  const [blocked] = applySavedVehiclePerformanceImportReviews([normal], [
    review({ month: 4, review_status: "correction_required", review_note: "needs fuel log correction" })
  ]);

  assert.equal(normal.status, "Needs review");
  assert.equal(blocked.status, "Correction required");
  assert.equal(blocked.reason, "needs fuel log correction");
});

test("corrected March 700-6659 fuel total re-evaluates within ready tolerance", () => {
  const [row] = addAppFuelToImportRows([
    importRow({
      id: "mar-700-6659",
      month: 3,
      vehicleRegistration: "700-6659",
      canonicalVehicleRegistration: "700-6659",
      excelFuel: 56309.2
    })
  ], [
    { vehicleRegistration: "700-6659", year: 2026, month: 3, fuelSpend: 56390.2, fuelLogCount: 21 }
  ]);
  const status = evaluateVehiclePerformanceImportStatus(row);

  assert.equal(row.appFuel, 56390.2);
  assert.equal(Number(row.fuelDifference?.toFixed(2)), 81);
  assert.equal(status.status, "Ready");
});

test("saved approved reviews do not override duplicate existing performance records", () => {
  const duplicate = importRow({
    month: 5,
    status: "Duplicate",
    existingRecordId: "existing-vehicle-month"
  });
  const [reloaded] = applySavedVehiclePerformanceImportReviews([duplicate], [
    review({ month: 5, review_status: "approved", app_fuel_at_review: 2000 })
  ]);

  assert.equal(reloaded.status, "Duplicate");
  assert.equal(reloaded.existingRecordId, "existing-vehicle-month");
});

test("approved import reviews become stale when App Fuel changes", () => {
  const [normal] = addAppFuelToImportRows([importRow({ month: 6, excelFuel: 1000 })], [
    { vehicleRegistration: "61-2835", year: 2026, month: 6, fuelSpend: 2000.02, fuelLogCount: 2 }
  ]);
  const [stale] = applySavedVehiclePerformanceImportReviews([normal], [
    review({ month: 6, review_status: "approved", app_fuel_at_review: 2000 })
  ]);

  assert.equal(stale.status, "Review required again");
  assert.match(stale.reason, /values have changed/);
});

test("approved import reviews become stale when Excel Fuel changes", () => {
  const [normal] = addAppFuelToImportRows([importRow({ month: 6, excelFuel: 1001 })], [
    { vehicleRegistration: "61-2835", year: 2026, month: 6, fuelSpend: 2000, fuelLogCount: 2 }
  ]);
  const [stale] = applySavedVehiclePerformanceImportReviews([normal], [
    review({ month: 6, review_status: "approved", excel_fuel: 1000, app_fuel_at_review: 2000 })
  ]);

  assert.equal(stale.status, "Review required again");
  assert.equal(stale.savedReview.reviewed_by, "reviewer@example.com");
});

test("vehicle performance import review migration stores one durable review per vehicle month", () => {
  const migration = fs.readFileSync(
    path.resolve("supabase/migrations/20260901103000_vehicle_performance_import_reviews.sql"),
    "utf8"
  );

  assert.match(migration, /create table if not exists public\.vehicle_performance_import_reviews/i);
  assert.match(migration, /review_status text not null check \(review_status in \('approved', 'correction_required'\)\)/i);
  assert.match(migration, /canonical_vehicle_registration_key text not null/i);
  assert.match(migration, /source_sheet text/i);
  assert.match(migration, /source_row_number integer/i);
  assert.match(migration, /source_row_key text/i);
  assert.match(migration, /reviewed_by text/i);
  assert.match(migration, /create unique index if not exists vehicle_performance_import_reviews_vehicle_period_key/i);
  assert.match(migration, /user_id,\s*year,\s*month,\s*canonical_vehicle_registration_key/i);
  assert.match(migration, /vehicle_performance_import_reviews_source_row_idx/i);
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /with check \(user_id = auth\.uid\(\)\)/i);
  assert.doesNotMatch(migration, /\bdelete\s+from\s+public\.vehicle_monthly_performance\b/i);
  assert.doesNotMatch(migration, /\bdelete\s+from\s+public\.fuel_logs\b/i);
});

test("vehicle performance correction audit migration stores field-level old and new values", () => {
  const migration = fs.readFileSync(
    path.resolve("supabase/migrations/20260902103000_vehicle_performance_correction_audit.sql"),
    "utf8"
  );

  assert.match(migration, /create table if not exists public\.vehicle_performance_correction_audit/i);
  assert.match(migration, /vehicle_monthly_performance_id uuid references public\.vehicle_monthly_performance/i);
  assert.match(migration, /field_name text not null check/i);
  assert.match(migration, /old_value numeric/i);
  assert.match(migration, /new_value numeric/i);
  assert.match(migration, /reason text/i);
  assert.match(migration, /corrected_by text/i);
  assert.match(migration, /corrected_at timestamptz not null default now\(\)/i);
  assert.match(migration, /with check \(user_id = auth\.uid\(\)\)/i);
});

test("vehicle registration history migration is limited to confirmed mappings", () => {
  const migration = fs.readFileSync(
    path.resolve("supabase/migrations/20260901090000_vehicle_registration_history_identity.sql"),
    "utf8"
  );

  assert.match(migration, /'9565'\s*,\s*'3ฒน-9565'/);
  assert.match(migration, /'4565'\s*,\s*'3ฒล-4565'/);
  assert.match(migration, /'8453'\s*,\s*'ฒอ-8453'/);
  assert.match(migration, /alter table public\.fuel_logs add column if not exists vehicle_id/i);
  assert.match(migration, /alter table public\.weekly_mileage add column if not exists driver_name_snapshot/i);
  assert.match(migration, /update public\.vehicles/i);
  assert.match(migration, /public\.normalize_vehicle_registration_key/i);
  assert.doesNotMatch(migration, /right\(/i);
  assert.doesNotMatch(migration, /substring\(/i);
  assert.doesNotMatch(migration, /\bdelete\s+from\b/i);
});
