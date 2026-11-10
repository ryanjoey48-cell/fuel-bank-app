const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const filename = path.resolve(__dirname, "../lib/fleet-geofence-engine.ts");
const loaded = new Module(filename, module);
loaded.filename = filename;
loaded._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText, filename);
const { evaluateVehicleGeofences, initialVehicleGeofenceState, geofenceDistanceMeters } = loaded.exports;

const start = Date.parse("2026-10-31T00:00:00Z");
const zone = { locationId: "ees-depot", latitude: 13.7, longitude: 100.6, radiusMeters: 150,
  entryDwellMs: 60_000, exitDwellMs: 60_000, hysteresisMeters: 25, active: true };
const point = { inside: { latitude: 13.7, longitude: 100.6 }, outside: { latitude: 13.71, longitude: 100.6 },
  jitter: { latitude: 13.7015, longitude: 100.6 } };
function observation(minutes, where = "inside", overrides = {}) {
  return { vehicleKey: "gps:42", registration: "78-6996", sourceAt: new Date(start + minutes * 60_000).toISOString(),
    detectedAt: new Date(start + minutes * 60_000 + 10_000).toISOString(), ...point[where],
    gpsVerified: true, trackerConnected: true, ...overrides };
}
function step(state, minutes, where, overrides, zones = [zone]) {
  return evaluateVehicleGeofences(state, observation(minutes, where, overrides), zones);
}

test("entry and exit require two verified source observations and preserve visit duration", () => {
  let result = step(initialVehicleGeofenceState("gps:42"), 0);
  assert.equal(result.state.phase, "ENTRY_CANDIDATE");
  result = step(result.state, 1);
  assert.equal(result.state.phase, "INSIDE");
  assert.equal(result.events[0].type, "arrival");
  assert.equal(result.events[0].occurredAt, observation(0).sourceAt);
  assert.equal(result.events[0].confirmedLatitude, point.inside.latitude);
  assert.equal(result.events[0].confirmedLongitude, point.inside.longitude);
  const persisted = JSON.parse(JSON.stringify(result.state));
  result = step(persisted, 2);
  assert.deepEqual(result.events, []);
  result = step(result.state, 3, "outside");
  assert.equal(result.state.phase, "EXIT_CANDIDATE");
  result = step(result.state, 4, "outside");
  assert.equal(result.state.phase, "DEPARTED");
  assert.equal(result.events[0].type, "departure");
  assert.equal(result.events[0].durationSeconds, 180);
  assert.equal(result.events[0].visitKey, persisted.visitKey);
  assert.notEqual(result.events[0].eventKey, `${persisted.visitKey}:arrival`);
});

test("duplicate and out-of-order source reports cannot repeat an arrival", () => {
  const candidate = step(initialVehicleGeofenceState("gps:42"), 0).state;
  const arrived = step(candidate, 1);
  assert.equal(arrived.events.length, 1);
  for (const minute of [1, 0]) {
    const replay = step(arrived.state, minute);
    assert.equal(replay.ignored, "duplicate_or_out_of_order");
    assert.deepEqual(replay.events, []);
    assert.deepEqual(replay.state, arrived.state);
  }
});

test("stale, unverified, offline and missing coordinates suspend evidence without departure", () => {
  const arrived = step(step(initialVehicleGeofenceState("gps:42"), 0).state, 1).state;
  for (const overrides of [
    { gpsVerified: false }, { trackerConnected: false }, { latitude: null, longitude: null },
    { detectedAt: new Date(start + 22 * 60_000).toISOString() }
  ]) {
    const result = step(arrived, 2, "outside", overrides);
    assert.equal(result.state.phase, "UNCERTAIN");
    assert.equal(result.state.stable, "INSIDE");
    assert.deepEqual(result.events, []);
  }
  const agedSameReport = step(arrived, 1, "inside", { detectedAt: new Date(start + 25 * 60_000).toISOString() });
  assert.equal(agedSameReport.state.phase, "UNCERTAIN");
  assert.equal(agedSameReport.ignored, null);
  const repeat = step(agedSameReport.state, 1, "inside", { detectedAt: new Date(start + 26 * 60_000).toISOString() });
  assert.equal(repeat.ignored, "duplicate_or_out_of_order");
});

test("future timestamp cannot poison the persisted source watermark", () => {
  const initial = initialVehicleGeofenceState("gps:42");
  const future = step(initial, 100, "inside", { detectedAt: new Date(start).toISOString() });
  assert.equal(future.state.phase, "UNCERTAIN");
  assert.equal(future.state.lastSourceAt, null);
  assert.equal(step(future.state, 1).state.phase, "ENTRY_CANDIDATE");
});

test("boundary hysteresis and an interrupted exit avoid false departures", () => {
  assert.ok(geofenceDistanceMeters(point.inside, point.jitter) > 150);
  const arrived = step(step(initialVehicleGeofenceState("gps:42"), 0).state, 1).state;
  const jitter = step(arrived, 2, "jitter");
  assert.equal(jitter.state.phase, "INSIDE");
  const exiting = step(jitter.state, 3, "outside");
  assert.equal(exiting.state.phase, "EXIT_CANDIDATE");
  const recovered = step(exiting.state, 4);
  assert.equal(recovered.state.phase, "INSIDE");
  assert.deepEqual(recovered.events, []);
});

test("overlapping geofences use deterministic normalized distance and retain a candidate", () => {
  const other = { ...zone, locationId: "other", latitude: 13.7002 };
  const first = step(initialVehicleGeofenceState("gps:42"), 0, "inside", {}, [other, zone]);
  assert.equal(first.state.locationId, "ees-depot");
  const second = step(first.state, 1, "inside", {}, [other, zone]);
  assert.equal(second.events.length, 1);
  assert.equal(second.events[0].locationId, "ees-depot");
});

test("a long GPS gap inside a zone cannot confirm dwell-based arrival", () => {
  const candidate = step(initialVehicleGeofenceState("gps:42"), 0).state;
  assert.equal(candidate.phase, "ENTRY_CANDIDATE");
  // 09:00 then 11:00 (120 minutes) exceeds the default 5-minute continuity gap.
  const late = step(candidate, 120);
  assert.equal(late.state.phase, "ENTRY_CANDIDATE");
  assert.deepEqual(late.events, []);
  assert.equal(late.state.candidateSince, observation(120).sourceAt);
  const confirmed = step(late.state, 121);
  assert.equal(confirmed.state.phase, "INSIDE");
  assert.equal(confirmed.events[0].type, "arrival");
  assert.equal(confirmed.events[0].occurredAt, observation(120).sourceAt);
});

test("a long GPS gap outside a zone restarts exit dwell instead of confirming departure", () => {
  const arrived = step(step(initialVehicleGeofenceState("gps:42"), 0).state, 1).state;
  const exiting = step(arrived, 2, "outside");
  assert.equal(exiting.state.phase, "EXIT_CANDIDATE");
  const lateOutside = step(exiting.state, 122, "outside");
  assert.equal(lateOutside.state.phase, "EXIT_CANDIDATE");
  assert.deepEqual(lateOutside.events, []);
  assert.equal(lateOutside.state.candidateSince, observation(122, "outside").sourceAt);
  assert.equal(lateOutside.state.stable, "INSIDE");
});

test("a long gap while remaining inside does not invent a departure", () => {
  const arrived = step(step(initialVehicleGeofenceState("gps:42"), 0).state, 1).state;
  const laterInside = step(arrived, 90);
  assert.equal(laterInside.state.phase, "INSIDE");
  assert.equal(laterInside.state.stable, "INSIDE");
  assert.deepEqual(laterInside.events, []);
  assert.equal(laterInside.state.visitKey, arrived.visitKey);
});
