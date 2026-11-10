const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");

function loadTs(relativePath, aliases = {}) {
  const filename = path.join(root, relativePath);
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
const sites = loadTs("lib/ees-depot-sites.ts");
const { classifyDepotProximity, summarizeDepotProximity } = loadTs("lib/ees-depot-proximity.ts", {
  "@/lib/fleet-geofence-engine": engine,
  "@/lib/ees-depot-sites": sites
});

const { EES_LORRY_DEPOT_FORTH_COORDINATES, EES_OFFICE_FORTH_COORDINATES, EES_LORRY_DEPOT_FORTH_LOCATION_ID, EES_OFFICE_FORTH_LOCATION_ID } = sites;

function vehicle(overrides = {}) {
  return {
    vehicleKey: "v1",
    registration: "78-6996",
    latitude: EES_LORRY_DEPOT_FORTH_COORDINATES.latitude,
    longitude: EES_LORRY_DEPOT_FORTH_COORDINATES.longitude,
    lastGpsTimestamp: "2026-11-01T10:00:00Z",
    gpsVerified: true,
    speedKmh: 0,
    activity: "stopped",
    driverName: "Somchai",
    ...overrides
  };
}

test("canonical depot and office Forth IDs stay distinct", () => {
  assert.equal(EES_LORRY_DEPOT_FORTH_LOCATION_ID, "1977073");
  assert.equal(EES_OFFICE_FORTH_LOCATION_ID, "1708908");
  assert.notEqual(EES_LORRY_DEPOT_FORTH_LOCATION_ID, EES_OFFICE_FORTH_LOCATION_ID);
});

test("vehicles inside provisional depot radius are classified as inside_depot", () => {
  const rows = classifyDepotProximity([vehicle()]);
  assert.equal(rows[0].band, "inside_depot");
  assert.ok(rows[0].distanceToDepotMeters != null && rows[0].distanceToDepotMeters < 5);
});

test("office proximity is separate from depot yard", () => {
  const rows = classifyDepotProximity([vehicle({
    latitude: EES_OFFICE_FORTH_COORDINATES.latitude,
    longitude: EES_OFFICE_FORTH_COORDINATES.longitude
  })]);
  assert.equal(rows[0].band, "near_office");
  assert.notEqual(rows[0].band, "inside_depot");
});

test("nearby band uses distance beyond provisional radius without inventing arrival times", () => {
  const rows = classifyDepotProximity([vehicle({
    // ~250 m north of depot pin
    latitude: EES_LORRY_DEPOT_FORTH_COORDINATES.latitude + 0.0023,
    longitude: EES_LORRY_DEPOT_FORTH_COORDINATES.longitude
  })]);
  assert.equal(rows[0].band, "nearby_depot");
  assert.equal(Object.prototype.hasOwnProperty.call(rows[0], "arrivalAt"), false);
});

test("summary counts bands for ops panel badges", () => {
  const rows = classifyDepotProximity([
    vehicle({ vehicleKey: "inside" }),
    vehicle({
      vehicleKey: "office",
      latitude: EES_OFFICE_FORTH_COORDINATES.latitude,
      longitude: EES_OFFICE_FORTH_COORDINATES.longitude
    }),
    vehicle({ vehicleKey: "elsewhere", latitude: 14.0, longitude: 100.5 })
  ]);
  const summary = summarizeDepotProximity(rows);
  assert.equal(summary.insideDepot, 1);
  assert.equal(summary.nearOffice, 1);
  assert.equal(summary.withCoordinates, 3);
});
