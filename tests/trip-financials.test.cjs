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

const { getTripOperationalDistance, summarizeTripFinancials } = loadTypeScriptModule("lib/trip-financials.ts");

test("financial exclusion keeps operational kilometres and original price but excludes revenue", () => {
  const summary = summarizeTripFinancials([
    { manual_actual_km: 500, original_trip_price: 10000, include_in_financials: true },
    { start_mileage: 1000, end_mileage: 1300, original_trip_price: 6000, include_in_financials: false }
  ]);

  assert.equal(summary.operationalDistanceKm, 800);
  assert.equal(summary.revenueDistanceKm, 500);
  assert.equal(summary.nonChargeableDistanceKm, 300);
  assert.equal(summary.includedRevenue, 10000);
  assert.equal(summary.excludedOriginalRevenue, 6000);
  assert.equal(summary.revenuePerKm, 20);
  assert.equal(summary.revenueGeneratingTrips, 1);
  assert.equal(summary.excludedTrips, 1);
});

test("legacy trips remain financially included and distance fallbacks stay operational", () => {
  assert.equal(getTripOperationalDistance({ google_estimated_km: 186 }), 186);
  const summary = summarizeTripFinancials([{ google_estimated_km: 186, original_trip_price: 5000 }]);
  assert.equal(summary.includedRevenue, 5000);
  assert.equal(summary.revenueDistanceKm, 186);
});

test("migration is additive, defaults existing trips to included, and preserves original prices", () => {
  const migration = fs.readFileSync(path.resolve("supabase/migrations/20260916090000_trip_journey_financial_treatment.sql"), "utf8");
  assert.match(migration, /include_in_financials boolean not null default true/i);
  assert.match(migration, /original_trip_price numeric\(12, 2\)/i);
  assert.doesNotMatch(migration, /update\s+public\.trip_journeys\s+set\s+original_trip_price/i);
  assert.doesNotMatch(migration, /delete\s+from\s+public\.trip_journeys/i);
});

test("trip create/edit UI exposes the simple per-trip financial toggle and excluded badge", () => {
  const page = fs.readFileSync(path.resolve("app/(dashboard)/trip-journey/page.tsx"), "utf8");
  for (const marker of ["include_in_financials", "original_trip_price", "Include financial amount", "Financial amount excluded", "Financial excluded"]) {
    assert.match(page, new RegExp(marker));
  }
  assert.doesNotMatch(page, /financial_exclusion_reason|Exclusion reason|trip-exclusion-reason/);
  assert.match(page, /When turned off, mileage and operational data will still be counted, but the financial amount for this trip will be excluded\./);
  assert.match(page, /selectedTripTab === "overview"[\s\S]*?<FinancialTreatmentFields/);
  assert.match(page, /selectedTripTab === "journey"[\s\S]*?<FinancialTreatmentFields/);
});

test("Efficiency Analysis keeps its operational calculations independent of financial treatment", () => {
  const page = fs.readFileSync(path.resolve("app/(dashboard)/fuel-logs/page.tsx"), "utf8");
  assert.doesNotMatch(page, /include_in_financials/);
  assert.doesNotMatch(page, /Operational calculations include non-chargeable journeys/);
});

test("missing financial columns cannot be silently discarded by the legacy save fallback", () => {
  const data = fs.readFileSync(path.resolve("lib/data.ts"), "utf8");
  const fallbackBlock = data.slice(data.indexOf("function omitTripOptionalColumns"), data.indexOf("const BOOKING_DIARY_ROUTE_COLUMNS"));
  assert.doesNotMatch(fallbackBlock, /include_in_financials|original_trip_price/);
  assert.match(data, /Trip financial treatment is not available in this database yet/);
});
