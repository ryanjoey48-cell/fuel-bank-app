const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");

function loadTs(rel, aliases = {}) {
  const filename = path.join(root, rel);
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.require = (request) => {
    if (aliases[request]) return aliases[request];
    return require(request);
  };
  loaded._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, filename);
  return loaded.exports;
}

const engine = loadTs("lib/fleet-geofence-engine.ts");
const importLib = loadTs("lib/forth-locations-import.ts", {
  "@/lib/fleet-geofence-engine": engine
});
const {
  FORTH_BUNDLED_EXPORT_COUNT,
  FORTH_OWNER_APPROVED_MAPPING_COUNT,
  FORTH_GPS_SOURCE_LABEL,
  validateBundledForthMappingSource,
  validateForthOwnerSelection
} = loadTs("lib/forth-selected-locations.ts", {
  "@/lib/forth-locations-import": importLib
});
const {
  buildForthGpsMapPayloadFromCsv,
  filterForthGpsMapLocations
} = loadTs("lib/forth-gps-map-locations.ts", {
  "@/lib/forth-selected-locations": {
    FORTH_BUNDLED_EXPORT_COUNT,
    FORTH_GPS_SOURCE_LABEL,
    validateBundledForthMappingSource
  },
  "@/lib/forth-locations-import": importLib
});

const csvText = fs.readFileSync(path.join(root, "data/forth-locations/Locations Forth Pinned.csv"), "utf8");

test("owner-approved mapping source validates exactly 466 unique coordinate rows", () => {
  const result = validateBundledForthMappingSource(csvText);
  assert.equal(result.status, "ready");
  assert.equal(result.bundledCount, 466);
  assert.equal(result.uniqueIds, 466);
  assert.equal(result.validCoordinatePairs, 466);
  assert.equal(FORTH_OWNER_APPROVED_MAPPING_COUNT, 466);
  assert.equal(FORTH_BUNDLED_EXPORT_COUNT, 466);
  assert.equal(FORTH_GPS_SOURCE_LABEL, "Forth GPS");
  assert.ok(result.records.every((row) => row.latitude === Number(row.raw["ละติจูด"])));
  assert.ok(result.records.every((row) => row.longitude === Number(row.raw["ลองจิจูด"])));
});

test("empty selection defaults to the full approved 466 set", () => {
  const result = validateForthOwnerSelection({ csvText, selectionText: null });
  assert.equal(result.status, "ready");
  assert.equal(result.selectedCount, 466);
  assert.equal(result.excludedCount, 0);
});

test("refuses a wrong-sized subset instead of inventing rows", () => {
  const ids = importLib.parseForthPinnedLocationsCsv(csvText).slice(0, 50).map((row) => row.forthLocationId).join("\n");
  const result = validateForthOwnerSelection({ csvText, selectionText: ids, requestedCount: 466 });
  assert.equal(result.status, "invalid_selection");
  assert.equal(result.providedCount, 50);
});

test("buildForthGpsMapPayloadFromCsv exposes all 466 Forth GPS map locations", () => {
  const payload = buildForthGpsMapPayloadFromCsv(csvText);
  assert.equal(payload.validation.status, "ready");
  assert.equal(payload.locations.length, 466);
  assert.equal(new Set(payload.locations.map((row) => row.forthLocationId)).size, 466);
  assert.ok(payload.locations.every((row) => row.sourceLabel === "Forth GPS"));
  assert.ok(payload.locations.every((row) => row.pinKind === "forth_gps"));
  assert.ok(payload.groups.length > 0);
});

test("Forth GPS search and group filters work without dropping the source set", () => {
  const payload = buildForthGpsMapPayloadFromCsv(csvText);
  const group = payload.groups[0];
  const byGroup = filterForthGpsMapLocations(payload.locations, { group });
  assert.ok(byGroup.length > 0);
  assert.ok(byGroup.every((row) => row.groupLayer === group));
  const sampleId = payload.locations[0].forthLocationId;
  const byId = filterForthGpsMapLocations(payload.locations, { search: sampleId });
  assert.ok(byId.some((row) => row.forthLocationId === sampleId));
  assert.equal(payload.locations.length, 466);
});

test("corrupt CSV fails mapping validation clearly", () => {
  const broken = csvText.replace(/\n[^\n]+/, "\nbad-row-without-coords");
  const result = validateBundledForthMappingSource(broken);
  assert.equal(result.status, "invalid_source");
});
