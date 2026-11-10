const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const filename = path.resolve(__dirname, "../lib/fleet-geofence-source.ts");
const loaded = new Module(filename, module);
loaded.require = (request) => {
  if (request === "@/lib/forth-tracking-view") return { isForthGpsPositionVerified: (record) =>
    record.timestampStatus === "current" && record.coordinateStatus === "valid" &&
    record.gpsConnectivity === "connected" && record.positionQuality === "gps" };
  return require(request);
};
loaded._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText, filename);
const { prepareForthGeofenceObservations } = loaded.exports;
const record = { gpsDeviceId: "17", vehicleRegistration: "78-6996", lastGpsTimestamp: "2026-10-31T00:00:00Z",
  latitude: 13.7, longitude: 100.6, timestampStatus: "current", coordinateStatus: "valid",
  gpsConnectivity: "connected", positionQuality: "gps" };

test("stable GPS device identity and verified-source evidence are prepared without coordinate changes", () => {
  const result = prepareForthGeofenceObservations([record], "2026-10-31T00:00:08Z");
  assert.deepEqual(result.skipped, []);
  assert.equal(result.observations[0].vehicleKey, "forth:17");
  assert.equal(result.observations[0].gpsVerified, true);
  assert.equal(result.observations[0].latitude, record.latitude);
  assert.equal(result.observations[0].longitude, record.longitude);
});

test("missing or duplicate GPS device IDs are excluded rather than merging visits", () => {
  const result = prepareForthGeofenceObservations([record, { ...record, vehicleRegistration: "OTHER" },
    { ...record, gpsDeviceId: null }], "2026-10-31T00:00:08Z");
  assert.equal(result.observations.length, 0);
  assert.deepEqual(result.skipped.map((item) => item.reason), ["duplicate_device_id", "duplicate_device_id", "missing_device_id"]);
});

test("unverified vendor positions remain observations but cannot confirm geofence transitions", () => {
  const result = prepareForthGeofenceObservations([{ ...record, positionQuality: "wifi" }], "2026-10-31T00:00:08Z");
  assert.equal(result.observations[0].gpsVerified, false);
});
