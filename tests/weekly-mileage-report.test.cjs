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

const { buildWeeklyMileageComparisonReport, WEEKLY_MILEAGE_REVIEW_THRESHOLD_KM, weeklyMileageComparisonGroup } = loadTypeScriptModule("lib/weekly-mileage-report.ts");

function entry(id, date, registration, odometer, driver = "Driver A", createdAt = `${date}T08:00:00Z`) {
  return { id, week_ending: date, driver_id: `driver-${id}`, driver, vehicle_reg: registration, odometer_reading: odometer, mileage: odometer, created_at: createdAt };
}

function vehicle(id, registration, active = true) {
  return { id, vehicle_reg: registration, registration, active };
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
