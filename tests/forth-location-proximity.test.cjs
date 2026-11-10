const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");

function load(file, cache = new Map()) {
  file = path.resolve(root, file);
  if (cache.has(file)) return cache.get(file).exports;
  const loaded = new Module(file, module);
  cache.set(file, loaded);
  loaded.filename = file;
  loaded.paths = Module._nodeModulePaths(path.dirname(file));
  loaded.require = (request) => {
    if (request.startsWith("@/") || request.startsWith(".")) {
      const target = request.startsWith("@/") ? path.join(root, request.slice(2)) : path.resolve(path.dirname(file), request);
      const candidate = [target, `${target}.ts`, `${target}.tsx`].find((name) => fs.existsSync(name) && fs.statSync(name).isFile());
      if (candidate) return load(candidate, cache);
    }
    return require(request);
  };
  loaded._compile(
    ts.transpileModule(fs.readFileSync(file, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
    }).outputText,
    file
  );
  return loaded.exports;
}

const {
  classifyForthLocationProximityBand,
  formatForthProximityDistanceMeters,
  summarizeForthLocationProximity,
  FORTH_LOCATION_AT_METERS,
  FORTH_LOCATION_APPROACHING_METERS
} = load("lib/forth-location-proximity.ts");

const LOCATION = { latitude: 13.72, longitude: 100.75 };
const NOW = Date.parse("2026-11-02T08:00:00Z");

function offsetMeters(lat, lng, northMeters, eastMeters) {
  const latDelta = northMeters / 111_320;
  const eastDelta = eastMeters / (111_320 * Math.cos((lat * Math.PI) / 180));
  return { latitude: lat + latDelta, longitude: lng + eastDelta };
}

function vehicle(overrides = {}) {
  const point = offsetMeters(LOCATION.latitude, LOCATION.longitude, overrides.northMeters ?? 0, overrides.eastMeters ?? 0);
  return {
    gpsDeviceId: overrides.gpsDeviceId ?? "dev-1",
    vehicleRegistration: overrides.vehicleRegistration ?? "TEST-1",
    coordinateStatus: overrides.coordinateStatus ?? "valid",
    latitude: overrides.latitude ?? point.latitude,
    longitude: overrides.longitude ?? point.longitude,
    positionQuality: overrides.positionQuality ?? "gps",
    gpsConnectivity: overrides.gpsConnectivity ?? "connected",
    timestampStatus: overrides.timestampStatus ?? "current",
    lastGpsTimestamp: overrides.lastGpsTimestamp === undefined ? "2026-11-02T07:55:00Z" : overrides.lastGpsTimestamp,
    speed: overrides.speed ?? 0,
    engineOn: overrides.engineOn ?? false,
    reportedDriver: null,
    gprsConnectivity: "connected",
    heading: null,
    ...overrides
  };
}

test("defaults keep 100 m at-location and 200 m approaching thresholds", () => {
  assert.equal(FORTH_LOCATION_AT_METERS, 100);
  assert.equal(FORTH_LOCATION_APPROACHING_METERS, 200);
  assert.equal(classifyForthLocationProximityBand(99), "at_location");
  assert.equal(classifyForthLocationProximityBand(100), "at_location");
  assert.equal(classifyForthLocationProximityBand(150), "approaching");
  assert.equal(classifyForthLocationProximityBand(200), "approaching");
  assert.equal(classifyForthLocationProximityBand(201), "outside");
});

test("99 m verified fresh is at-location proximity only", () => {
  const summary = summarizeForthLocationProximity(LOCATION, [vehicle({ northMeters: 99 })], { nowMs: NOW, language: "en" });
  assert.equal(summary.atLocationCount, 1);
  assert.equal(summary.approachingCount, 0);
  assert.equal(summary.active.length, 1);
  assert.equal(summary.active[0].band, "at_location");
  assert.equal(summary.active[0].qualifiesForCustomerProximity, true);
  assert.equal(summary.arrivalsCreated, false);
  assert.equal(summary.geofencesActivated, false);
  assert.equal(summary.notificationsActivated, false);
});

test("150 m verified fresh is approaching", () => {
  const summary = summarizeForthLocationProximity(LOCATION, [vehicle({ northMeters: 150 })], { nowMs: NOW });
  assert.equal(summary.atLocationCount, 0);
  assert.equal(summary.approachingCount, 1);
  assert.equal(summary.active[0].band, "approaching");
});

test("201 m is outside active proximity", () => {
  const summary = summarizeForthLocationProximity(LOCATION, [vehicle({ northMeters: 201 })], { nowMs: NOW });
  assert.equal(summary.active.length, 0);
  assert.equal(summary.nearestPlanning[0].band, "outside");
  assert.equal(summary.nearestPlanning[0].exclusionReason, "outside_range");
});

test("8 km is excluded from active proximity and not labelled approaching", () => {
  const summary = summarizeForthLocationProximity(LOCATION, [vehicle({ northMeters: 8000 })], { nowMs: NOW });
  assert.equal(summary.active.length, 0);
  assert.equal(summary.nearestPlanning.length, 1);
  assert.equal(summary.nearestPlanning[0].band, "outside");
  assert.ok(summary.nearestPlanning[0].distanceKm > 7);
  assert.match(formatForthProximityDistanceMeters(summary.nearestPlanning[0].distanceMeters), /km/);
});

test("99 m unverified is not a confirmed proximity event", () => {
  const summary = summarizeForthLocationProximity(
    LOCATION,
    [vehicle({ northMeters: 99, positionQuality: "lbs", gpsConnectivity: "connected" })],
    { nowMs: NOW }
  );
  assert.equal(summary.active.length, 0);
  assert.equal(summary.atLocationCount, 0);
  assert.equal(summary.cautionReports.length, 1);
  assert.equal(summary.cautionReports[0].exclusionReason, "unverified_gps");
  assert.equal(summary.arrivalsCreated, false);
});

test("99 m stale is excluded from active proximity", () => {
  const summary = summarizeForthLocationProximity(
    LOCATION,
    [vehicle({ northMeters: 99, timestampStatus: "stale", lastGpsTimestamp: "2026-11-02T06:00:00Z" })],
    { nowMs: NOW }
  );
  assert.equal(summary.active.length, 0);
  assert.equal(summary.cautionReports[0].exclusionReason, "stale_position");
});

test("missing source time is excluded", () => {
  const summary = summarizeForthLocationProximity(
    LOCATION,
    [vehicle({ northMeters: 50, lastGpsTimestamp: null, timestampStatus: "missing" })],
    { nowMs: NOW }
  );
  assert.equal(summary.active.length, 0);
  assert.equal(summary.cautionReports[0].exclusionReason, "missing_source_time");
});

test("find nearest planning mode still lists distant trucks without activating geofences", () => {
  const summary = summarizeForthLocationProximity(
    LOCATION,
    [
      vehicle({ gpsDeviceId: "near", vehicleRegistration: "NEAR", northMeters: 90 }),
      vehicle({ gpsDeviceId: "mid", vehicleRegistration: "MID", northMeters: 160 }),
      vehicle({ gpsDeviceId: "far", vehicleRegistration: "FAR", northMeters: 8500 })
    ],
    { nowMs: NOW, nearestLimit: 5 }
  );
  assert.equal(summary.active.length, 2);
  assert.equal(summary.nearestPlanning.length, 3);
  assert.equal(summary.nearestPlanning[2].record.vehicleRegistration, "FAR");
  assert.equal(summary.geofencesActivated, false);
  assert.equal(summary.notificationsActivated, false);
});

test("centre and panel keep proximity as read-only map intelligence", () => {
  const centre = fs.readFileSync(path.join(root, "components/forth-tracking-centre.tsx"), "utf8");
  const panel = fs.readFileSync(path.join(root, "components/forth-gps-locations-panel.tsx"), "utf8");
  const proximityLib = fs.readFileSync(path.join(root, "lib/forth-location-proximity.ts"), "utf8");
  assert.match(panel, /summarizeForthLocationProximity/);
  assert.match(panel, /Find nearest vehicles|ค้นหารถใกล้ที่สุด/);
  assert.match(proximityLib, /At location — proximity only/);
  assert.match(proximityLib, /geofencesActivated: false/);
  assert.doesNotMatch(panel, /createArrival|activateGeofence|pushNotification/);
  assert.match(centre, /showFleetOverview|workspaceMode/);
  assert.match(centre, /forth-v21/);
});
