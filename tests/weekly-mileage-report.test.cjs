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

const { buildWeeklyMileageComparisonReport, WEEKLY_MILEAGE_REVIEW_THRESHOLD_KM, weeklyMileageComparisonGroup } = loadTypeScriptModule("lib/weekly-mileage-report.ts");
const {
  buildOilChangeAlertRows,
  buildWeeklyDistanceHistoryRows,
  buildWeeklyDistanceHistorySummary,
  buildWeeklyMileageSummary
} = loadTypeScriptModule("lib/operations.ts");

function entry(id, date, registration, odometer, driver = "Driver A", createdAt = `${date}T08:00:00Z`) {
  return { id, week_ending: date, driver_id: `driver-${id}`, driver, vehicle_reg: registration, odometer_reading: odometer, mileage: odometer, created_at: createdAt };
}

function vehicle(id, registration, active = true) {
  return { id, vehicle_reg: registration, registration, active };
}

function serviceVehicle(overrides = {}) {
  return {
    id: overrides.id ?? "vehicle-1",
    vehicle_reg: overrides.vehicle_reg ?? "3ฒน-9565",
    registration: overrides.registration ?? overrides.vehicle_reg ?? "3ฒน-9565",
    vehicle_name: overrides.vehicle_name ?? overrides.vehicle_reg ?? "3ฒน-9565",
    vehicle_type: overrides.vehicle_type ?? "FOUR_WHEEL_TRUCK",
    active: overrides.active ?? true,
    last_oil_change_date: overrides.last_oil_change_date ?? null,
    last_oil_change_odometer: overrides.last_oil_change_odometer ?? null,
    oil_change_interval_km: overrides.oil_change_interval_km ?? null
  };
}

function report(entries, vehicles, selectedWeek = "2026-08-09") {
  return buildWeeklyMileageComparisonReport({ entries, vehicles, drivers: [], selectedWeek });
}

test("uses three distinct reporting dates and compares by vehicle when drivers change", () => {
  const result = report([
    entry("1", "2026-07-26", "AB-123", 954000, "Driver A"),
    entry("2", "2026-08-02", "AB 123", 956551, "Driver A"),
    entry("3", "2026-08-09", "AB123", 957820, "Driver B")
  ], [vehicle("v1", "AB-123")]);
  const row = result.rows[0];
  assert.equal(row.driverName, "Driver B");
  assert.equal(row.currentReadingDate, "2026-08-09");
  assert.equal(row.previousReadingDate, "2026-08-02");
  assert.equal(row.earlierReadingDate, "2026-07-26");
  assert.equal(row.currentDistance, 1269);
  assert.equal(row.previousDistance, 2551);
  assert.equal(row.status, "lower_mileage");
});

test("never compares duplicate records from the selected reporting date", () => {
  const result = report([
    entry("1", "2026-07-26", "A-1", 9000),
    entry("2", "2026-08-02", "A-1", 10000),
    entry("3", "2026-08-09", "A-1", 10500, "Old", "2026-08-09T08:00:00Z"),
    entry("4", "2026-08-09", "A-1", 11200, "Latest", "2026-08-09T09:00:00Z")
  ], [vehicle("v1", "A-1")]);
  assert.equal(result.rows[0].currentOdometer, 11200);
  assert.equal(result.rows[0].previousOdometer, 10000);
  assert.equal(result.rows[0].currentDistance, 1200);
});

test("checks higher and lower mileage at the configurable absolute KM threshold", () => {
  const result = report([
    entry("a1", "2026-07-26", "A", 10000), entry("a2", "2026-08-02", "A", 11000), entry("a3", "2026-08-09", "A", 13000),
    entry("b1", "2026-07-26", "B", 10000), entry("b2", "2026-08-02", "B", 12000), entry("b3", "2026-08-09", "B", 12900),
    entry("c1", "2026-07-26", "C", 10000), entry("c2", "2026-08-02", "C", 11000), entry("c3", "2026-08-09", "C", 12999)
  ], [vehicle("a", "A"), vehicle("b", "B"), vehicle("c", "C")]);
  assert.equal(WEEKLY_MILEAGE_REVIEW_THRESHOLD_KM, 1000);
  assert.equal(result.rows.find((row) => row.vehicleReg === "A").status, "higher_mileage");
  assert.equal(result.rows.find((row) => row.vehicleReg === "B").status, "lower_mileage");
  assert.equal(result.rows.find((row) => row.vehicleReg === "C").status, "normal_range");
  assert.equal(result.notableVariations, 2);
});

test("uses like-for-like totals and never counts missing readings as zero", () => {
  const result = report([
    entry("a1", "2026-07-26", "A", 1000), entry("a2", "2026-08-02", "A", 2000), entry("a3", "2026-08-09", "A", 3500),
    entry("b1", "2026-07-26", "B", 1000), entry("b2", "2026-08-02", "B", 5000)
  ], [vehicle("a", "A"), vehicle("b", "B")]);
  assert.equal(result.vehiclesCompared, 1);
  assert.equal(result.comparableDistanceThisWeek, 1500);
  assert.equal(result.comparableDistancePreviousWeek, 1000);
  assert.equal(result.comparableDistanceDifference, 500);
  assert.equal(result.vehiclesMissingThisWeek, 1);
  assert.equal(result.rows.find((row) => row.vehicleReg === "B").currentDistance, null);
});

test("weekly distance history reuses the existing weekly summary distance calculation", () => {
  const entries = [
    entry("a1", "2026-08-02", "A-100", 1000),
    entry("b1", "2026-08-02", "B-200", 5000),
    entry("a2", "2026-08-09", "A 100", 1800),
    entry("b2", "2026-08-09", "B-200", 5700),
    entry("a3-old", "2026-08-16", "A-100", 2200, "Old A", "2026-08-16T08:00:00Z"),
    entry("a3-new", "2026-08-16", "A-100", 2600, "Latest A", "2026-08-16T09:00:00Z"),
    entry("b3", "2026-08-16", "B-200", 6100)
  ];
  const summaryRows = buildWeeklyMileageSummary(entries);
  const historyRows = buildWeeklyDistanceHistoryRows(entries);

  assert.deepEqual(historyRows.map((row) => row.weekEnding), ["2026-08-16", "2026-08-09", "2026-08-02"]);
  for (const historyRow of historyRows) {
    const summaryRow = summaryRows.find((row) => row.weekEnding === historyRow.weekEnding);
    assert.ok(summaryRow);
    assert.equal(historyRow.weeklyDistance, summaryRow.weeklyDistance);
    assert.equal(historyRow.vehicleEntries, summaryRow.comparableVehicles);
  }
  assert.equal(historyRows[0].weeklyDistance, 1200);
  assert.equal(historyRows[0].vehicleEntries, 2);
});

test("weekly distance history summary cards calculate from the displayed rows", () => {
  const rows = [
    { weekEnding: "2026-08-16", vehicleEntries: 2, weeklyDistance: 1200 },
    { weekEnding: "2026-08-09", vehicleEntries: 2, weeklyDistance: 1500 },
    { weekEnding: "2026-08-02", vehicleEntries: 0, weeklyDistance: 0 }
  ];
  const summary = buildWeeklyDistanceHistorySummary(rows);

  assert.equal(summary.totalDistance, 2700);
  assert.equal(summary.averageWeeklyDistance, 900);
  assert.deepEqual(summary.highestWeek, rows[1]);
  assert.deepEqual(summary.lowestWeek, rows[2]);
});

test("weekly distance history reports expected, valid, missing, and highest/lowest distance vehicles", () => {
  const entries = [
    entry("a1", "2026-08-02", "A-100", 1000, "Ann"),
    entry("b1", "2026-08-02", "B-200", 5000, "Ben"),
    entry("a2", "2026-08-09", "A-100", 1800, "Ann"),
    entry("b2", "2026-08-09", "B-200", 5000, "Ben")
  ];
  const rows = buildWeeklyDistanceHistoryRows(entries, [
    { ...vehicle("a", "A-100"), created_at: "2026-01-01T00:00:00Z" },
    { ...vehicle("b", "B-200"), created_at: "2026-01-01T00:00:00Z" },
    { ...vehicle("c", "C-300"), created_at: "2026-08-01T00:00:00Z" },
    { ...vehicle("d", "D-400"), created_at: "2026-08-15T00:00:00Z" }
  ], []);
  const current = rows.find((row) => row.weekEnding === "2026-08-09");

  assert.ok(current);
  assert.equal(current.weeklyDistance, 800);
  assert.equal(current.validVehicleEntries, 2);
  assert.equal(current.expectedVehicleEntries, 3);
  assert.equal(current.missingVehicleCount, 1);
  assert.equal(current.highestDistanceVehicle.vehicleReg, "A-100");
  assert.equal(current.highestDistanceVehicle.distance, 800);
  assert.equal(current.lowestDistanceVehicle.vehicleReg, "B-200");
  assert.equal(current.lowestDistanceVehicle.distance, 0);
  assert.equal(current.vehicleBreakdown.find((row) => row.vehicleReg === "C-300").status, "missing_current");
  assert.equal(current.vehicleBreakdown.some((row) => row.vehicleReg === "D-400"), false);
});

test("weekly distance totals exclude decreased odometers but continue from the new reading", () => {
  const rows = buildWeeklyDistanceHistoryRows([
    entry("a1", "2026-08-02", "A-100", 1000),
    entry("a2", "2026-08-09", "A-100", 900),
    entry("a3", "2026-08-16", "A-100", 1200)
  ]);
  const decreased = rows.find((row) => row.weekEnding === "2026-08-09");
  const afterReset = rows.find((row) => row.weekEnding === "2026-08-16");

  assert.equal(decreased.weeklyDistance, 0);
  assert.equal(decreased.reviewVehicleCount, 1);
  assert.equal(decreased.vehicleBreakdown[0].status, "odometer_decreased");
  assert.equal(afterReset.weeklyDistance, 300);
  assert.equal(afterReset.validVehicleEntries, 1);
});

test("oil change and weekly mileage stay separate for the 05 Sep / 06 Sep regression", () => {
  const [row] = buildOilChangeAlertRows({
    vehicles: [
      serviceVehicle({
        last_oil_change_date: "2026-09-05",
        last_oil_change_odometer: 354500,
        oil_change_interval_km: 10000
      })
    ],
    weeklyMileage: [
      entry("weekly-1", "2026-09-06", "3ฒน-9565", 354781)
    ],
    drivers: []
  });

  assert.equal(row.registration, "3ฒน-9565");
  assert.equal(row.currentOdometer, 354781);
  assert.equal(row.lastWeeklyMileageDate, "2026-09-06");
  assert.equal(row.lastOilChangeDate, "2026-09-05");
  assert.equal(row.lastOilChangeOdometer, 354500);
  assert.equal(row.oilChangeIntervalKm, 10000);
  assert.equal(row.nextOilChangeDueOdometer, 364500);
  assert.equal(row.kmUsedSinceOilChange, 281);
  assert.equal(row.kmRemaining, 9719);
  assert.equal(row.status, "ok");
  assert.deepEqual(row.reviewReasons, []);
});

test("future oil change records do not create a clean service state for older mileage", () => {
  const [row] = buildOilChangeAlertRows({
    vehicles: [
      serviceVehicle({
        last_oil_change_date: "2026-09-07",
        last_oil_change_odometer: 354784,
        oil_change_interval_km: 10000
      })
    ],
    weeklyMileage: [
      entry("weekly-1", "2026-09-06", "3ฒน-9565", 354781)
    ],
    drivers: []
  });

  assert.equal(row.status, "review_required");
  assert.equal(row.nextOilChangeDueOdometer, 364784);
  assert.equal(row.kmUsedSinceOilChange, -3);
  assert.equal(row.kmRemaining, 10003);
  assert.match(row.reviewReasons.join(" "), /latest mileage is older than the oil-change record/i);
});

test("corrected 05 Sep oil change drives the 06 Sep card after duplicate future service is removed", () => {
  const [row] = buildOilChangeAlertRows({
    vehicles: [
      serviceVehicle({
        last_oil_change_date: "2026-09-05",
        last_oil_change_odometer: 354500,
        oil_change_interval_km: 10000
      })
    ],
    weeklyMileage: [
      entry("weekly-1", "2026-09-06", "3ฒน-9565", 354784)
    ],
    drivers: []
  });

  assert.equal(row.lastOilChangeDate, "2026-09-05");
  assert.equal(row.currentOdometer, 354784);
  assert.equal(row.lastWeeklyMileageDate, "2026-09-06");
  assert.equal(row.nextOilChangeDueOdometer, 364500);
  assert.equal(row.kmUsedSinceOilChange, 284);
  assert.equal(row.kmRemaining, 9716);
  assert.equal(row.status, "ok");
  assert.deepEqual(row.reviewReasons, []);
});

test("new oil change resets the service baseline without changing weekly mileage logic", () => {
  const [atService] = buildOilChangeAlertRows({
    vehicles: [
      serviceVehicle({
        last_oil_change_date: "2026-09-07",
        last_oil_change_odometer: 364600,
        oil_change_interval_km: 10000
      })
    ],
    weeklyMileage: [
      entry("weekly-1", "2026-09-07", "3ฒน-9565", 364600)
    ],
    drivers: []
  });
  const [afterDriving] = buildOilChangeAlertRows({
    vehicles: [
      serviceVehicle({
        last_oil_change_date: "2026-09-07",
        last_oil_change_odometer: 364600,
        oil_change_interval_km: 10000
      })
    ],
    weeklyMileage: [
      entry("weekly-1", "2026-09-07", "3ฒน-9565", 364600),
      entry("weekly-2", "2026-09-13", "3ฒน-9565", 365100)
    ],
    drivers: []
  });

  assert.equal(atService.nextOilChangeDueOdometer, 374600);
  assert.equal(atService.kmUsedSinceOilChange, 0);
  assert.equal(atService.kmRemaining, 10000);
  assert.equal(afterDriving.kmUsedSinceOilChange, 500);
  assert.equal(afterDriving.kmRemaining, 9500);
});

test("oil change save path no longer writes service odometers into weekly mileage", () => {
  const source = fs.readFileSync(path.resolve("lib/data.ts"), "utf8");
  const saveStart = source.indexOf("export async function saveOilChangeService");
  const saveEnd = source.indexOf("export async function deleteOilChangeService");
  const saveSource = source.slice(saveStart, saveEnd);

  assert.equal(source.includes("syncOilChangeOdometerToWeeklyMileage"), false);
  assert.doesNotMatch(saveSource, /saveWeeklyMileage/);
  assert.doesNotMatch(saveSource, /\.from\("weekly_mileage"\)/);
  assert.match(saveSource, /insertVehicleServiceLogWithSchemaFallback|updateVehicleServiceLogWithSchemaFallback/);
});

test("oil change service selection orders by service date, not created_at", () => {
  const dataSource = fs.readFileSync(path.resolve("lib/data.ts"), "utf8");
  const pageSource = fs.readFileSync(path.resolve("app/(dashboard)/weekly-mileage/page.tsx"), "utf8");
  const dataSortStart = dataSource.indexOf("function sortServiceLogsByLatest");
  const dataSortEnd = dataSource.indexOf("function normalizeOilChangeVehicleRegKey");
  const pageSortStart = pageSource.indexOf("const compareServiceLogsByLatest");
  const pageSortEnd = pageSource.indexOf("type OilActionMode");
  const dataSortSource = dataSource.slice(dataSortStart, dataSortEnd);
  const pageSortSource = pageSource.slice(pageSortStart, pageSortEnd);

  assert.match(dataSortSource, /serviceDateDiff/);
  assert.doesNotMatch(dataSortSource, /createdAtDiff|createdAtTime/);
  assert.match(pageSortSource, /serviceDateDiff/);
  assert.doesNotMatch(pageSortSource, /createdAtDiff|createdAtTime/);
  assert.doesNotMatch(dataSource, /\.order\("service_date", \{ ascending: false \}\)\s*\.order\("created_at"/);
});

test("requires the immediately previous reporting week for this-week distance", () => {
  const result = report([
    entry("old", "2026-07-26", "78-6996", 100000),
    entry("current", "2026-08-09", "78-6996", 101539)
  ], [vehicle("v1", "78-6996")]);
  const row = result.rows[0];
  assert.equal(row.currentReadingDate, "2026-08-09");
  assert.equal(row.currentOdometer, 101539);
  assert.equal(row.previousReadingDate, null);
  assert.equal(row.currentDistance, null);
  assert.equal(row.previousDistance, null);
  assert.equal(row.status, "missing_previous_week");
  assert.equal(result.vehiclesMissingPreviousWeek, 1);
  assert.equal(result.vehiclesCompared, 0);
});

test("requires the exact earlier reporting week for previous-week comparison", () => {
  const result = report([
    entry("old", "2026-07-19", "A", 1000),
    entry("previous", "2026-08-02", "A", 2000),
    entry("current", "2026-08-09", "A", 2600)
  ], [vehicle("v1", "A")]);
  const row = result.rows[0];
  assert.equal(row.currentDistance, 600);
  assert.equal(row.previousDistance, null);
  assert.equal(row.status, "missing_comparison_data");
  assert.equal(result.vehiclesCompared, 0);
});

test("starts a new odometer baseline without comparing against legacy readings", () => {
  const baseline = {
    ...entry("baseline", "2026-06-07", "79-5318", 8017, "Sayan"),
    is_odometer_baseline: true,
    odometer_note: "Correct odometer series begins here."
  };
  const result = buildWeeklyMileageComparisonReport({
    entries: [
      entry("legacy", "2026-05-31", "79-5318", 939900, "Sayan"),
      baseline,
      entry("next", "2026-06-14", "79-5318", 9749, "Sayan"),
      entry("current", "2026-06-21", "79-5318", 12035, "Sayan")
    ],
    vehicles: [vehicle("v795318", "79-5318")],
    drivers: [],
    selectedWeek: "2026-06-14"
  });
  const row = result.rows[0];
  assert.equal(row.previousReadingDate, "2026-06-07");
  assert.equal(row.previousOdometer, 8017);
  assert.equal(row.isPreviousBaseline, true);
  assert.equal(row.currentDistance, 1732);
  assert.equal(row.previousDistance, null);
  assert.equal(row.status, "missing_comparison_data");
  assert.equal(result.vehiclesCompared, 0);
});

test("reports missing, no change, comparison gaps, and either negative interval as errors", () => {
  const result = report([
    entry("s1", "2026-07-26", "STOP", 1000), entry("s2", "2026-08-02", "STOP", 1200), entry("s3", "2026-08-09", "STOP", 1400),
    entry("e1", "2026-08-02", "ERROR", 5000), entry("e2", "2026-08-09", "ERROR", 4500),
    entry("p1", "2026-07-26", "PRIOR-ERROR", 5000), entry("p2", "2026-08-02", "PRIOR-ERROR", 4500), entry("p3", "2026-08-09", "PRIOR-ERROR", 5000),
    entry("n1", "2026-08-09", "NEW", 200), entry("m1", "2026-08-02", "MISSING", 900)
  ], [vehicle("stop", "STOP"), vehicle("error", "ERROR"), vehicle("prior", "PRIOR-ERROR"), vehicle("new", "NEW"), vehicle("missing", "MISSING")]);
  const statuses = Object.fromEntries(result.rows.map((row) => [row.vehicleReg, row.status]));
  assert.equal(statuses.STOP, "no_movement");
  assert.equal(statuses.ERROR, "odometer_error");
  assert.equal(statuses["PRIOR-ERROR"], "odometer_error");
  assert.equal(statuses.NEW, "missing_previous_week");
  assert.equal(statuses.MISSING, "missing_this_week");
  assert.equal(result.odometerErrors, 2);
});

test("includes genuine active vehicles even when they have no driver or mileage yet", () => {
  const result = report([
    entry("3", "2026-08-02", "ACTIVE", 1000), entry("4", "2026-08-09", "ACTIVE", 1300)
  ], [vehicle("unassigned", "UNASSIGNED", true), vehicle("active", "ACTIVE", true)]);
  assert.deepEqual(result.rows.map((row) => row.vehicleReg).sort(), ["ACTIVE", "UNASSIGNED"]);
  assert.equal(result.totalActiveVehicles, 2);
  assert.equal(result.vehiclesRecordedThisWeek, 1);
});

test("sorts incomplete readings and errors before neutral mileage variations", () => {
  const result = report([
    entry("mp1", "2026-07-26", "PREVIOUS", 1000), entry("mp3", "2026-08-09", "PREVIOUS", 1500),
    entry("er1", "2026-07-26", "ERROR", 1000), entry("er2", "2026-08-02", "ERROR", 2000), entry("er3", "2026-08-09", "ERROR", 1500),
    entry("hi1", "2026-07-26", "HIGH", 1000), entry("hi2", "2026-08-02", "HIGH", 1500), entry("hi3", "2026-08-09", "HIGH", 4000),
    entry("no1", "2026-07-26", "NORMAL", 1000), entry("no2", "2026-08-02", "NORMAL", 2000), entry("no3", "2026-08-09", "NORMAL", 2900),
    entry("mc1", "2026-07-26", "CURRENT", 1000), entry("mc2", "2026-08-02", "CURRENT", 1800)
  ], [vehicle("current", "CURRENT"), vehicle("previous", "PREVIOUS"), vehicle("error", "ERROR"), vehicle("high", "HIGH"), vehicle("normal", "NORMAL")]);
  assert.deepEqual(result.rows.map((row) => row.status), [
    "missing_this_week",
    "missing_previous_week",
    "odometer_error",
    "higher_mileage",
    "normal_range"
  ]);
});

test("groups cannot-compare, more, less, and same rows with largest changes first", () => {
  const result = report([
    entry("ph1", "2026-07-26", "PLUS-HIGH", 1000), entry("ph2", "2026-08-02", "PLUS-HIGH", 2000), entry("ph3", "2026-08-09", "PLUS-HIGH", 5000),
    entry("pl1", "2026-07-26", "PLUS-LOW", 1000), entry("pl2", "2026-08-02", "PLUS-LOW", 2000), entry("pl3", "2026-08-09", "PLUS-LOW", 3100),
    entry("nh1", "2026-07-26", "MINUS-HIGH", 1000), entry("nh2", "2026-08-02", "MINUS-HIGH", 4000), entry("nh3", "2026-08-09", "MINUS-HIGH", 5000),
    entry("nl1", "2026-07-26", "MINUS-LOW", 1000), entry("nl2", "2026-08-02", "MINUS-LOW", 2000), entry("nl3", "2026-08-09", "MINUS-LOW", 2900),
    entry("sa1", "2026-07-26", "SAME", 1000), entry("sa2", "2026-08-02", "SAME", 2000), entry("sa3", "2026-08-09", "SAME", 3000),
    entry("mi2", "2026-08-02", "MISSING", 2000)
  ], [
    vehicle("nl", "MINUS-LOW"), vehicle("ph", "PLUS-HIGH"), vehicle("sa", "SAME"),
    vehicle("mi", "MISSING"), vehicle("pl", "PLUS-LOW"), vehicle("nh", "MINUS-HIGH")
  ]);
  assert.deepEqual(result.rows.map((row) => row.vehicleReg), [
    "MISSING",
    "PLUS-HIGH",
    "PLUS-LOW",
    "MINUS-HIGH",
    "MINUS-LOW",
    "SAME"
  ]);
  assert.deepEqual(result.rows.map(weeklyMileageComparisonGroup), [
    "cannot_compare",
    "more",
    "more",
    "less",
    "less",
    "same"
  ]);
});

test("keeps the management PDF objective, percentage-free, and consistently branded", () => {
  const pdfSource = fs.readFileSync(path.resolve("lib/weekly-mileage-pdf.ts"), "utf8");
  assert.match(pdfSource, /REPORTING WEEK DISTANCE/);
  assert.match(pdfSource, /DIFFERENCE FROM PREVIOUS WEEK/);
  assert.match(pdfSource, /Reporting week:/);
  assert.match(pdfSource, /Opening reading/);
  assert.match(pdfSource, /Closing reading/);
  assert.match(pdfSource, /Reporting week KM/);
  assert.match(pdfSource, /Previous week KM/);
  assert.match(pdfSource, /Weekly summary/);
  assert.match(pdfSource, /More than previous week/);
  assert.match(pdfSource, /Less than previous week/);
  assert.match(pdfSource, /Same as previous week/);
  assert.match(pdfSource, /Cannot compare/);
  assert.match(pdfSource, /Current reading not entered/);
  assert.match(pdfSource, /moreRows\.length/);
  assert.match(pdfSource, /lessRows\.length/);
  assert.match(pdfSource, /sameRows\.length/);
  assert.match(pdfSource, /cannotCompare\.length/);
  assert.match(pdfSource, /#4C1D95/);
  assert.match(pdfSource, /#6D28D9/);
  assert.doesNotMatch(pdfSource, /Similar mileage/);
  assert.doesNotMatch(pdfSource, /Within 1,000 KM/);
  assert.doesNotMatch(pdfSource, /Higher mileage/);
  assert.doesNotMatch(pdfSource, /Lower mileage/);
  assert.doesNotMatch(pdfSource, /No odometer errors/);
  assert.doesNotMatch(pdfSource, /values\[7\].*groupCounts/);
  assert.doesNotMatch(pdfSource, /This week/i);
  assert.doesNotMatch(pdfSource, /Last week/i);
  assert.doesNotMatch(pdfSource, /formatKm\(row\.differenceKm, language, true\)/);
});
