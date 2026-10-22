const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");

class TestAdminApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function loadTypeScript(relativePath, mocks = {}) {
  const cache = new Map();
  function load(file) {
    file = path.resolve(root, file);
    if (cache.has(file)) return cache.get(file).exports;
    const loaded = new Module(file, module);
    cache.set(file, loaded);
    loaded.filename = file;
    loaded.paths = Module._nodeModulePaths(path.dirname(file));
    loaded.require = (request) => {
      if (Object.hasOwn(mocks, request)) return mocks[request];
      if (request.startsWith("@/")) {
        const target = path.join(root, request.slice(2));
        const candidate = [target, `${target}.ts`, `${target}.tsx`].find((name) => fs.existsSync(name) && fs.statSync(name).isFile());
        if (candidate) return load(candidate);
      }
      if (request.startsWith(".")) {
        const target = path.resolve(path.dirname(file), request);
        const candidate = [target, `${target}.ts`, `${target}.tsx`].find((name) => fs.existsSync(name) && fs.statSync(name).isFile());
        if (candidate) return load(candidate);
      }
      return require(request);
    };
    const output = ts.transpileModule(fs.readFileSync(file, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
    }).outputText;
    loaded._compile(output, file);
    return loaded.exports;
  }
  return load(relativePath);
}

const { normalizeForthTrackingResponse, normalizeForthRegistration, matchForthVehicle } = loadTypeScript("lib/forth-tracking.ts");
const baseNow = Date.parse("2026-10-21T05:00:00.000Z");

test("normalizes a valid tracking response without inferring movement", () => {
  const [record] = normalizeForthTrackingResponse([{
    gpsID: 1234,
    plateNumber: " 1กข - 2345 ",
    driver: "Driver A",
    IDCard: "not-returned",
    dateTime: "2026-10-21T04:55:00+00:00",
    GPS: "Online",
    GPRS: "Connected",
    Engine: "off",
    Speed: "0.0",
    COG: "180",
    Latitude: "13.7563",
    Longitude: 100.5018,
    positionSource: "GPS",
    Sensor1: "available"
  }], { now: baseNow });

  assert.equal(record.gpsDeviceId, "1234");
  assert.equal(record.vehicleRegistration, "1กข - 2345");
  assert.equal(record.reportedDriver, "Driver A");
  assert.equal(record.coordinateStatus, "valid");
  assert.equal(record.latitude, 13.7563);
  assert.equal(record.longitude, 100.5018);
  assert.equal(record.gpsConnectivity, "connected");
  assert.equal(record.gprsConnectivity, "connected");
  assert.equal(record.engineOn, false);
  assert.equal(record.speed, 0);
  assert.equal(record.timestampStatus, "current");
  assert.equal(record.positionQuality, "gps");
  assert.equal(record.positionSourceRaw, null);
  assert.equal(record.positionSourceShape, "recognized_string");
  assert.deepEqual(record.alternatePositionSourceCandidates, []);
  assert.equal(record.optionalSensors.sensor1, "available");
  assert.equal(Object.hasOwn(record, "IDCard"), false);
  assert.deepEqual(record.sourceAudit.speed, { shape: "string", value: "0.0", truncated: false });
  assert.deepEqual(record.sourceAudit.engine, { shape: "string", value: "off", truncated: false });
  assert.deepEqual(record.sourceAudit.positionTimestamp, { shape: "string", value: "2026-10-21T04:55:00+00:00", truncated: false });
  assert.equal(Object.hasOwn(record.sourceAudit, "IDCard"), false);
  assert.equal(Object.hasOwn(record.sourceAudit, "Sensor1"), false);
});

test("accuracy source snapshots are allowlisted, bounded, and omit unsupported or unsafe driver values", () => {
  const [record, unsafeDriver, longValue, unsupported] = normalizeForthTrackingResponse([
    { gpsID: "device-7", plateNumber: " 1กข-2345 ", driver: " Driver A ", Speed: " 66.0 ", GPS: " ON ", GPRS: "Connected", Engine: "OFF", Latitude: "13.7", Longitude: 100.5, COG: "090", positionSource: " No GPS ", dateTime: "21-10-2026 11:55:00", IDCard: "PRIVATE-ID", Sensor1: "PRIVATE-SENSOR" },
    { driver: "Driver-12345678" },
    { positionSource: "x".repeat(200) + "\u0000\nGPS" },
    { Latitude: { nested: "must not serialize" }, Speed: Number.NaN }
  ], { now: baseNow, sourceTimeZone: "Asia/Bangkok" });

  assert.deepEqual(record.sourceAudit.speed, { shape: "string", value: " 66.0 ", truncated: false });
  assert.deepEqual(record.sourceAudit.engine, { shape: "string", value: "OFF", truncated: false });
  assert.equal(record.sourceAudit.latitude.value, "13.7");
  assert.equal(record.sourceAudit.positionSource.value, " No GPS ");
  assert.equal(unsafeDriver.sourceAudit.driver.shape, "unsupported");
  assert.equal(unsafeDriver.sourceAudit.driver.value, null);
  assert.equal(longValue.sourceAudit.positionSource.truncated, true);
  assert.equal(Array.from(longValue.sourceAudit.positionSource.value).length, 160);
  assert.equal(unsupported.sourceAudit.latitude.shape, "unsupported");
  assert.equal(unsupported.sourceAudit.latitude.value, null);
  assert.equal(JSON.stringify(record.sourceAudit).includes("PRIVATE-ID"), false);
  assert.equal(JSON.stringify(record.sourceAudit).includes("PRIVATE-SENSOR"), false);
  assert.equal(JSON.stringify(unsupported.sourceAudit).includes("must not serialize"), false);
});

test("captures raw unknown positionSource text only when explicitly requested for the diagnostic", () => {
  const [ordinary] = normalizeForthTrackingResponse([{ positionSource: " Vendor-A " }], { now: baseNow });
  const [diagnostic] = normalizeForthTrackingResponse([{ positionSource: " Vendor-A " }], {
    now: baseNow,
    includeDiagnosticUnknownPositionSourceText: true
  });
  const [recognized] = normalizeForthTrackingResponse([{ positionSource: "GPS" }], {
    now: baseNow,
    includeDiagnosticUnknownPositionSourceText: true
  });
  assert.equal(ordinary.positionSourceRaw, null);
  assert.equal(diagnostic.positionSourceRaw, " Vendor-A ");
  assert.equal(recognized.positionSourceRaw, null);
});

test("classifies positionSource presence and type without guessing alternate field mappings", () => {
  const records = normalizeForthTrackingResponse([
    {},
    { positionSource: null },
    { positionSource: "   " },
    { positionSource: 3 },
    { positionSource: false },
    { positionSource: " GPS " },
    { positionSource: "Cellular" },
    { positionSource: { source: "GPS" } },
    { Position_Source: "Wi-Fi" },
    { position: { source: "LBS" } }
  ], { now: baseNow });

  assert.deepEqual(records.map((record) => record.positionSourceShape), [
    "missing", "null", "empty", "number", "boolean",
    "recognized_string", "unrecognized_string", "other", "missing", "missing"
  ]);
  assert.deepEqual(records[8].alternatePositionSourceCandidates, ["recognized_string"]);
  assert.deepEqual(records[9].alternatePositionSourceCandidates, ["recognized_string"]);
  assert.equal(records[8].positionQuality, "unknown");
  assert.equal(records[9].positionQuality, "unknown");
});

test("recognizes canonical source labels across case and separator variants", () => {
  const records = normalizeForthTrackingResponse([
    { positionSource: "GPS" },
    { positionSource: " wifi " },
    { positionSource: "Wi-Fi" },
    { positionSource: "LBS" },
    { positionSource: "Non-GPS" },
    { positionSource: "Non GPS" },
    { positionSource: "GPS signal lost" },
    { positionSource: "Cellular" }
  ], { now: baseNow });

  assert.deepEqual(records.map((record) => record.positionQuality), [
    "gps", "wifi", "wifi", "lbs", "other", "other", "unknown", "unknown"
  ]);
});

test("recognizes the observed No GPS source with case and whitespace variations only", () => {
  const records = normalizeForthTrackingResponse([
    { positionSource: "No GPS" },
    { positionSource: " no gps " },
    { positionSource: "NO   GPS" },
    { positionSource: "No-GPS" },
    { positionSource: "No_GPS" },
    { positionSource: "GPS signal lost" }
  ], { now: baseNow, includeDiagnosticUnknownPositionSourceText: true });

  assert.deepEqual(records.map((record) => record.positionQuality), [
    "no_gps", "no_gps", "no_gps", "unknown", "unknown", "unknown"
  ]);
  assert.deepEqual(records.map((record) => record.positionSourceShape), [
    "recognized_string", "recognized_string", "recognized_string",
    "unrecognized_string", "unrecognized_string", "unrecognized_string"
  ]);
  assert.deepEqual(records.slice(0, 3).map((record) => record.positionSourceRaw), [null, null, null]);
  assert.equal(records[0].positionSource, "No GPS");
  const [ordinary] = normalizeForthTrackingResponse([{ positionSource: "No GPS" }], { now: baseNow });
  assert.equal(ordinary.positionSourceRaw, null);
});

test("accepts missing optional fields and distinguishes missing from invalid coordinates", () => {
  const records = normalizeForthTrackingResponse([
    { gpsID: "A", Latitude: 13.5 },
    { gpsID: "B", Latitude: "north", Longitude: "100" }
  ], { now: baseNow });
  assert.equal(records[0].coordinateStatus, "missing");
  assert.equal(records[0].timestampStatus, "missing");
  assert.equal(records[0].gpsConnectivity, "unknown");
  assert.equal(records[1].coordinateStatus, "invalid");
});

test("normalizes Forth ON/OFF values without conflating GPS signal and GPRS communications", () => {
  const { getForthFleetStatus } = loadTypeScript("lib/forth-tracking-view.ts");
  const [gpsFallback, communicationLost, gpsSignalLost, missingValues] = normalizeForthTrackingResponse([
    {
      dateTime: "21-10-2026 11:59:00",
      GPS: " ON ",
      GPRS: " on ",
      Engine: " OFF ",
      Speed: " 0.0 ",
      Latitude: " 13.7 ",
      Longitude: " 100.5 ",
      positionSource: "GPS signal lost"
    },
    {
      dateTime: "21-10-2026 11:59:00",
      GPS: "ON",
      GPRS: " OFF ",
      Engine: "On",
      Speed: 0,
      Latitude: 13.8,
      Longitude: 100.6,
      positionSource: "GPS"
    },
    {
      dateTime: "21-10-2026 11:59:00",
      GPS: " OFF ",
      GPRS: " ON ",
      Engine: "ON",
      Speed: 0,
      Latitude: 13.85,
      Longitude: 100.65,
      positionSource: "LBS"
    },
    {
      dateTime: "21-10-2026 11:59:00",
      Latitude: 13.9,
      Longitude: 100.7,
      Speed: 0
    }
  ], { now: baseNow, sourceTimeZone: "Asia/Bangkok" });

  assert.equal(gpsFallback.gpsConnectivity, "connected");
  assert.equal(gpsFallback.gprsConnectivity, "connected");
  assert.equal(gpsFallback.positionQuality, "unknown");
  assert.equal(gpsFallback.engineOn, false);
  assert.equal(gpsFallback.speed, 0);
  assert.equal(gpsFallback.coordinateStatus, "valid");
  assert.equal(getForthFleetStatus(gpsFallback), "unknown");

  assert.equal(communicationLost.gpsConnectivity, "connected");
  assert.equal(communicationLost.gprsConnectivity, "disconnected");
  assert.equal(communicationLost.positionQuality, "gps");
  assert.equal(getForthFleetStatus(communicationLost), "stationary");

  assert.equal(gpsSignalLost.gpsConnectivity, "disconnected");
  assert.equal(gpsSignalLost.gprsConnectivity, "connected");
  assert.equal(gpsSignalLost.positionQuality, "lbs");
  assert.equal(getForthFleetStatus(gpsSignalLost), "unknown");

  assert.equal(missingValues.gpsConnectivity, "unknown");
  assert.equal(missingValues.gprsConnectivity, "unknown");
  assert.equal(missingValues.engineOn, null);
  assert.equal(missingValues.positionQuality, "unknown");
  assert.equal(getForthFleetStatus(missingValues), "unknown");
});

test("Forth fields map independently to communications, freshness, position quality, motion, and engine state", () => {
  const { getForthFleetStatus, getForthMotionReason, summarizeForthFleet } = loadTypeScript("lib/forth-tracking-view.ts");
  const records = normalizeForthTrackingResponse([
    { dateTime: "21-10-2026 11:59:00", GPS: " ON ", GPRS: " ON ", Engine: "OFF", Speed: "12", Latitude: 13.7, Longitude: 100.5, positionSource: " GPS " },
    { dateTime: "21-10-2026 11:59:00", GPS: "ON", GPRS: "ON", Engine: "ON", Speed: "0", Latitude: 13.7, Longitude: 100.5, positionSource: "GPS" },
    { dateTime: "21-10-2026 11:59:00", GPS: "OFF", GPRS: "ON", Engine: "ON", Speed: "0", Latitude: 13.7, Longitude: 100.5, positionSource: "Wi-Fi" },
    { dateTime: "21-10-2026 11:59:00", GPS: "OFF", GPRS: "ON", Engine: "OFF", Speed: "0", Latitude: 13.7, Longitude: 100.5, positionSource: "LBS" },
    { dateTime: "21-10-2026 11:59:00", GPS: "ON", GPRS: "OFF", Engine: "ON", Speed: "4", Latitude: 13.7, Longitude: 100.5, positionSource: "GPS" },
    { dateTime: "21-10-2026 11:59:00", GPS: "ON", GPRS: "ON", Engine: "ON", Speed: "4", Latitude: 13.7, Longitude: 100.5 },
    { dateTime: "21-10-2026 11:59:00", GPS: "ON", GPRS: "ON", Engine: "ON", Latitude: 13.7, Longitude: 100.5, positionSource: "GPS" },
    { dateTime: "21-10-2026 11:44:59", GPS: "ON", GPRS: "ON", Engine: "ON", Speed: "45", Latitude: 13.7, Longitude: 100.5, positionSource: "GPS" },
    { dateTime: "21-10-2026 11:59:00", GPS: "ON", GPRS: "ON", Engine: "ON", Speed: "0", positionSource: "GPS" },
    { dateTime: "21-10-2026 11:59:00", GPS: "ON", GPRS: "ON", Engine: "ON", Speed: "0", Latitude: 13.7, Longitude: 100.5, positionSource: "GPS signal lost" },
    { dateTime: "21-10-2026 11:59:00", GPRS: "ON", Speed: "0", Latitude: 13.7, Longitude: 100.5, positionSource: "GPS" }
  ], { now: baseNow, sourceTimeZone: "Asia/Bangkok" });

  assert.deepEqual(records.map(getForthFleetStatus), [
    "moving", "stationary", "unknown", "unknown", "moving", "unknown",
    "unknown", "unknown", "unknown", "unknown", "unknown"
  ]);
  assert.equal(getForthMotionReason(records[2]), "gps_signal_unavailable");
  assert.equal(records[2].gpsConnectivity, "disconnected");
  assert.equal(records[2].gprsConnectivity, "connected");
  assert.equal(records[2].positionQuality, "wifi");
  assert.equal(records[3].positionQuality, "lbs");
  assert.equal(getForthMotionReason(records[5]), "position_source_unknown");
  assert.equal(getForthMotionReason(records[6]), "speed_unavailable");
  assert.equal(getForthMotionReason(records[7]), "stale_position");
  assert.equal(getForthMotionReason(records[8]), "coordinates_missing");
  assert.equal(records[0].engineOn, false);
  assert.equal(records[1].engineOn, true);
  assert.equal(records[10].gpsConnectivity, "unknown");

  const summary = summarizeForthFleet(records);
  assert.deepEqual(summary.communications, { online: 10, offline: 1, unknown: 0 });
  assert.deepEqual(summary.gpsSignal, { available: 8, unavailable: 2, unknown: 1 });
  assert.deepEqual(summary.positionQuality, { gps: 7, no_gps: 0, wifi: 1, lbs: 1, other: 0, unknown: 2 });
  assert.equal(summary.engineState.off, 2);
  assert.equal(summary.engineState.on, 8);
  assert.equal(summary.engineState.unknown, 1);
});

test("unknown position quality exposes provisional fresh positive speed without changing verified motion", () => {
  const { getForthFleetStatus, isProvisionalReportedMovement, summarizeForthFleet } = loadTypeScript("lib/forth-tracking-view.ts");
  const records = normalizeForthTrackingResponse([
    { dateTime: "21-10-2026 11:59:00", GPS: "ON", GPRS: "ON", Speed: "24", Latitude: 13.7, Longitude: 100.5 },
    { dateTime: "21-10-2026 11:59:00", GPS: "ON", GPRS: "ON", Speed: "0", Latitude: 13.7, Longitude: 100.5 },
    { dateTime: "21-10-2026 11:59:00", GPS: "OFF", GPRS: "ON", Speed: "24", Latitude: 13.7, Longitude: 100.5 },
    { dateTime: "21-10-2026 11:59:00", GPS: "ON", GPRS: "OFF", Speed: "24", Latitude: 13.7, Longitude: 100.5 },
    { dateTime: "21-10-2026 11:44:59", GPS: "ON", GPRS: "ON", Speed: "24", Latitude: 13.7, Longitude: 100.5 },
    { dateTime: "21-10-2026 11:59:00", GPS: "ON", GPRS: "ON", Speed: "24", Latitude: 91, Longitude: 100.5 },
    { dateTime: "21-10-2026 11:59:00", GPS: "ON", GPRS: "ON", Latitude: 13.7, Longitude: 100.5 },
    { dateTime: "21-10-2026 11:59:00", GPS: "ON", GPRS: "ON", Speed: "-1", Latitude: 13.7, Longitude: 100.5 }
  ], { now: baseNow, sourceTimeZone: "Asia/Bangkok" });

  assert.deepEqual(records.map(isProvisionalReportedMovement), [true, false, true, true, false, false, false, false]);
  assert.deepEqual(records.map(getForthFleetStatus), Array(8).fill("unknown"));
  const summary = summarizeForthFleet(records);
  assert.equal(summary.provisionalMotion.reportedMoving, 3);
  assert.deepEqual(summary.motion, { moving: 0, stationary: 0, unknown: 8 });
});

test("No GPS source and GPS signal disagreement stay separate in the 21-vehicle summary", () => {
  const { getForthFleetStatus, getForthMotionReason, isProvisionalReportedMovement, summarizeForthFleet } = loadTypeScript("lib/forth-tracking-view.ts");
  const base = {
    dateTime: "21-10-2026 11:59:00",
    GPS: "ON",
    GPRS: "ON",
    Latitude: 13.7,
    Longitude: 100.5
  };
  const gpsVerifiedStationary = Array.from({ length: 6 }, () => ({ ...base, Engine: "OFF", Speed: "0", positionSource: "GPS" }));
  const noGpsRecords = Array.from({ length: 15 }, (_, index) => ({
    ...base,
    Engine: index < 8 ? "ON" : "OFF",
    Speed: index < 7 ? "24" : "0",
    positionSource: index % 2 === 0 ? "No GPS" : " no gps "
  }));
  const records = normalizeForthTrackingResponse([...gpsVerifiedStationary, ...noGpsRecords], {
    now: baseNow,
    sourceTimeZone: "Asia/Bangkok"
  });
  const summary = summarizeForthFleet(records);

  assert.deepEqual(summary.communications, { online: 21, offline: 0, unknown: 0 });
  assert.deepEqual(summary.positionFreshness, { current: 21, stale: 0, unknown: 0 });
  assert.deepEqual(summary.gpsSignal, { available: 21, unavailable: 0, unknown: 0 });
  assert.deepEqual(summary.positionQuality, { gps: 6, no_gps: 15, wifi: 0, lbs: 0, other: 0, unknown: 0 });
  assert.deepEqual(summary.motion, { moving: 0, stationary: 6, unknown: 15 });
  assert.equal(summary.provisionalMotion.reportedMoving, 7);
  assert.deepEqual(summary.engineState, { on: 8, off: 13, unknown: 0 });
  assert.equal(summary.classificationReason.no_gps_position, 15);
  assert.equal(records[6].gpsConnectivity, "connected");
  assert.equal(records[6].gprsConnectivity, "connected");
  assert.equal(getForthMotionReason(records[6]), "no_gps_position");
  assert.equal(getForthFleetStatus(records[6]), "unknown");
  assert.equal(isProvisionalReportedMovement(records[6]), true);
  assert.equal(getForthFleetStatus(records[14]), "unknown");
  assert.equal(isProvisionalReportedMovement(records[14]), false);
});

test("EES movement stays speed-based when the engine is on while parked", () => {
  const { getForthFleetStatus } = loadTypeScript("lib/forth-tracking-view.ts");
  const [engineOnMoving, engineOnStationary] = normalizeForthTrackingResponse([
    {
      dateTime: "21-10-2026 11:59:00",
      GPS: "ON",
      GPRS: "ON",
      Engine: "ON",
      Speed: "12",
      Latitude: 13.7,
      Longitude: 100.5,
      positionSource: "GPS"
    },
    {
      dateTime: "21-10-2026 11:59:00",
      GPS: "ON",
      GPRS: "ON",
      Engine: "ON",
      Speed: "0",
      Latitude: 13.8,
      Longitude: 100.6,
      positionSource: "GPS"
    }
  ], { now: baseNow, sourceTimeZone: "Asia/Bangkok" });

  assert.equal(getForthFleetStatus(engineOnMoving), "moving");
  assert.equal(getForthFleetStatus(engineOnStationary), "stationary");
});

test("returns only a safe text driver label and omits identifier-like values", () => {
  const [name, identifier] = normalizeForthTrackingResponse([
    { driver: "Driver A" },
    { driver: "Driver 12345" }
  ], { now: baseNow });
  assert.equal(name.reportedDriver, "Driver A");
  assert.equal(identifier.reportedDriver, null);
});

test("missing drivers do not block fleet search or valid map locations", () => {
  const { filterForthFleetRecords, getForthFleetMapRecords } = loadTypeScript("lib/forth-tracking-view.ts");
  const records = normalizeForthTrackingResponse([
    { gpsID: "DEVICE-1", plateNumber: "BUS-1", Latitude: 13.7, Longitude: 100.5 },
    { gpsID: "DEVICE-2", plateNumber: "BUS-2", Latitude: null, Longitude: null }
  ], { now: baseNow });

  assert.equal(records[0].reportedDriver, null);
  assert.equal(filterForthFleetRecords(records, "BUS-1", "all").length, 1);
  assert.equal(getForthFleetMapRecords(records).length, 1);
  assert.equal(getForthFleetMapRecords(records)[0].record.vehicleRegistration, "BUS-1");
});

test("formats relative position age in English and Thai while rejecting invalid timestamps", () => {
  const { formatForthRelativeAge } = loadTypeScript("lib/forth-tracking-view.ts");
  const now = Date.parse("2026-10-21T05:00:00.000Z");
  assert.equal(formatForthRelativeAge("2026-10-21T04:59:25.000Z", now, "en"), "Updated 35 sec ago");
  assert.equal(formatForthRelativeAge("2026-10-21T04:53:00.000Z", now, "en"), "Updated 7 min ago");
  assert.equal(formatForthRelativeAge("2026-10-21T03:00:00.000Z", now, "en"), "Updated 2 hr ago");
  assert.equal(formatForthRelativeAge("2026-10-21T04:59:25.000Z", now, "th"), "อัปเดต 35 วินาทีที่แล้ว");
  assert.equal(formatForthRelativeAge("2026-10-21T05:00:02.000Z", now, "en"), "Updated just now");
  assert.equal(formatForthRelativeAge("not-a-time", now, "en"), null);
  assert.equal(formatForthRelativeAge(null, now, "en"), null);
});

test("online and activity counter filters match the full fleet summary and attention union", () => {
  const { filterForthFleetRecords, summarizeForthFleet } = loadTypeScript("lib/forth-tracking-view.ts");
  const records = normalizeForthTrackingResponse([
    { plateNumber: "BUS-1", gpsID: "D1", dateTime: "21-10-2026 12:00:00", GPRS: "ON", GPS: "ON", positionSource: "GPS", Speed: "22", Engine: "ON", Latitude: 13.7, Longitude: 100.5 },
    { plateNumber: "BUS-2", gpsID: "D2", dateTime: "21-10-2026 12:00:00", GPRS: "ON", GPS: "ON", positionSource: "GPS", Speed: "0", Engine: "OFF", Latitude: 13.7, Longitude: 100.5 },
    { plateNumber: "BUS-3", gpsID: "D3", dateTime: "21-10-2026 11:44:59", GPRS: "OFF", GPS: "OFF", positionSource: "No GPS", Speed: "0", Engine: "OFF", Latitude: 13.7, Longitude: 100.5 }
  ], { now: baseNow, sourceTimeZone: "Asia/Bangkok" });
  const summary = summarizeForthFleet(records);
  assert.equal(filterForthFleetRecords(records, "", "online").length, summary.communications.online);
  assert.equal(filterForthFleetRecords(records, "", "driving").length, summary.reportedActivity.driving);
  assert.equal(filterForthFleetRecords(records, "", "stopped").length, summary.reportedActivity.stopped);
  assert.equal(filterForthFleetRecords(records, "", "attention").length, summary.needsAttention);
  assert.equal(filterForthFleetRecords(records, "", "stale").length, summary.positionFreshness.stale);
});

test("rejects out-of-range coordinates and treats an empty array as a valid response", () => {
  const [record] = normalizeForthTrackingResponse([{ Latitude: 91, Longitude: 181 }], { now: baseNow });
  assert.equal(record.coordinateStatus, "invalid");
  assert.deepEqual(normalizeForthTrackingResponse([], { now: baseNow }), []);
});

test("distinguishes stale, unconfigured-timezone, and non-GPS positions", () => {
  const [stale, ambiguous, noGps, lostGps] = normalizeForthTrackingResponse([
    { dateTime: "2026-10-21T04:00:00Z", positionSource: "GPS" },
    { dateTime: "2026-10-21T04:55:00", positionSource: "LBS" },
    { GPS: "No GPS", positionSource: "Cellular" },
    { GPS: "Online", positionSource: "GPS signal lost" }
  ], { now: baseNow });
  assert.equal(stale.timestampStatus, "stale");
  assert.equal(ambiguous.timestampStatus, "timezone_unconfigured");
  assert.equal(ambiguous.positionQuality, "lbs");
  assert.equal(noGps.gpsConnectivity, "disconnected");
  assert.equal(lostGps.gpsConnectivity, "connected");
  assert.equal(lostGps.positionQuality, "unknown");
});

test("parses timezone-less Forth timestamps only with a configured source timezone and preserves the source text", () => {
  const sourceTimestamp = " 2026-10-21 11:55:00 ";
  const [unconfigured] = normalizeForthTrackingResponse([{ dateTime: sourceTimestamp }], { now: baseNow });
  assert.equal(unconfigured.timestampStatus, "timezone_unconfigured");
  assert.equal(unconfigured.lastGpsTimestamp, null);
  assert.equal(unconfigured.sourceTimestampRaw, sourceTimestamp);

  const [bangkok] = normalizeForthTrackingResponse([{ dateTime: sourceTimestamp }], {
    now: baseNow,
    sourceTimeZone: "Asia/Bangkok"
  });
  assert.equal(bangkok.lastGpsTimestamp, "2026-10-21T04:55:00.000Z");
  assert.equal(bangkok.timestampStatus, "current");
  assert.equal(bangkok.sourceTimestampRaw, sourceTimestamp);

  const [invalidZone] = normalizeForthTrackingResponse([{ dateTime: "2026-10-21T11:55:00" }], {
    now: baseNow,
    sourceTimeZone: "Not/A_Real_Zone"
  });
  assert.equal(invalidZone.timestampStatus, "timezone_invalid");
  assert.equal(invalidZone.lastGpsTimestamp, null);
});

test("parses Forth DD-MM-YYYY local timestamps in Bangkok and preserves the original value", () => {
  const raw = "21-10-2026 11:55:00";
  const [record] = normalizeForthTrackingResponse([{ dateTime: raw }], {
    now: baseNow,
    sourceTimeZone: "Asia/Bangkok"
  });

  assert.equal(record.sourceTimestampRaw, raw);
  assert.equal(record.lastGpsTimestamp, "2026-10-21T04:55:00.000Z");
  assert.equal(record.timestampStatus, "current");
});

test("validates DD-MM-YYYY calendar fields without swapping day and month", () => {
  const now = Date.parse("2026-11-03T01:05:00.000Z");
  const records = normalizeForthTrackingResponse([
    { dateTime: "03-11-2026 08:00:00" },
    { dateTime: "31-11-2026 08:00:00" },
    { dateTime: "29-02-2026 08:00:00" },
    { dateTime: "03-11-2026 24:00:00" }
  ], { now, sourceTimeZone: "Asia/Bangkok" });

  assert.equal(records[0].lastGpsTimestamp, "2026-11-03T01:00:00.000Z");
  assert.equal(records[0].timestampStatus, "current");
  assert.equal(records[1].timestampStatus, "invalid");
  assert.equal(records[1].lastGpsTimestamp, null);
  assert.equal(records[2].timestampStatus, "invalid");
  assert.equal(records[3].timestampStatus, "invalid");
});

test("converts DD-MM-YYYY local midnight across the UTC day boundary", () => {
  const [record] = normalizeForthTrackingResponse([{ dateTime: "22-10-2026 00:15:00" }], {
    now: Date.parse("2026-10-21T17:25:00.000Z"),
    sourceTimeZone: "Asia/Bangkok"
  });
  assert.equal(record.lastGpsTimestamp, "2026-10-21T17:15:00.000Z");
  assert.equal(record.timestampStatus, "current");
});

test("stale DD-MM-YYYY positions stay out of current activity counts", () => {
  const [record] = normalizeForthTrackingResponse([{
    dateTime: "21-10-2026 11:44:59",
    GPS: "Online",
    GPRS: "Connected",
    Latitude: 13.7,
    Longitude: 100.5,
    positionSource: "GPS",
    Speed: 55
  }], { now: baseNow, sourceTimeZone: "Asia/Bangkok" });
  const { getForthFleetStatus, summarizeForthFleet } = loadTypeScript("lib/forth-tracking-view.ts");

  assert.equal(record.lastGpsTimestamp, "2026-10-21T04:44:59.000Z");
  assert.equal(record.timestampStatus, "stale");
  assert.equal(getForthFleetStatus(record), "unknown");
  const summary = summarizeForthFleet([record]);
  assert.deepEqual(summary.motion, { moving: 0, stationary: 0, unknown: 1 });
  assert.deepEqual(summary.positionFreshness, { current: 0, stale: 1, unknown: 0 });
  assert.equal(summary.classificationReason.stale_position, 1);
  assert.equal(summary.lastVerifiedGpsPosition, "2026-10-21T04:44:59.000Z");
});

test("normalized Forth positions produce accurate fleet counts and latest valid GPS time", () => {
  const records = normalizeForthTrackingResponse([
    { gpsID: "D1", dateTime: "21-10-2026 11:59:00", GPS: "Online", GPRS: "Connected", Latitude: 13.7, Longitude: 100.5, positionSource: "GPS", Speed: 18 },
    { gpsID: "D2", dateTime: "21-10-2026 11:58:00", GPS: "Online", GPRS: "Connected", Latitude: 13.8, Longitude: 100.6, positionSource: "GPS", Speed: 0 },
    { gpsID: "D3", dateTime: "21-10-2026 11:44:59", GPS: "Online", GPRS: "Connected", Latitude: 13.9, Longitude: 100.7, positionSource: "GPS", Speed: 60 },
    { gpsID: "D4", dateTime: "21-10-2026 11:59:00", GPS: "Online", GPRS: "Connected", Speed: 35 }
  ], { now: baseNow, sourceTimeZone: "Asia/Bangkok" });
  const { summarizeForthFleet } = loadTypeScript("lib/forth-tracking-view.ts");

  const summary = summarizeForthFleet(records);
  assert.deepEqual(summary.motion, { moving: 1, stationary: 1, unknown: 2 });
  assert.deepEqual(summary.positionFreshness, { current: 3, stale: 1, unknown: 0 });
  assert.equal(summary.classificationReason.coordinates_missing, 1);
  assert.equal(summary.classificationReason.stale_position, 1);
  assert.equal(summary.lastVerifiedGpsPosition, "2026-10-21T04:59:00.000Z");
});

test("rejects daylight-saving gaps and ambiguities instead of guessing an instant", () => {
  const records = normalizeForthTrackingResponse([
    { dateTime: "2026-11-01T01:30:00" },
    { dateTime: "2026-03-08T02:30:00" }
  ], { now: Date.parse("2026-11-01T08:00:00Z"), sourceTimeZone: "America/New_York" });
  assert.equal(records[0].timestampStatus, "timezone_ambiguous");
  assert.equal(records[1].timestampStatus, "invalid");
});

test("preserves Thai registration characters and matches harmless formatting changes", () => {
  assert.equal(normalizeForthRegistration(" 1กข - 2345 "), "1กข2345");
  const result = matchForthVehicle({ vehicleRegistration: "1กข2345" }, [
    { id: "vehicle-1", vehicle_reg: "1กข - 2345" }
  ]);
  assert.equal(result.status, "matched");
  assert.equal(result.vehicleId, "vehicle-1");
  assert.equal(result.matchedBy, "registration");
});

test("prefers a unique confirmed device ID and flags duplicate registrations for review", () => {
  const preferred = matchForthVehicle({ gpsDeviceId: "GPS-9", vehicleRegistration: "12-3456" }, [
    { id: "vehicle-1", vehicle_reg: "12-3456", forth_gps_id: "GPS-9" },
    { id: "vehicle-2", vehicle_reg: "12-3456", forth_gps_id: "GPS-10" }
  ]);
  assert.equal(preferred.vehicleId, "vehicle-1");
  assert.equal(preferred.matchedBy, "device_id");

  const ambiguous = matchForthVehicle({ vehicleRegistration: "12-3456" }, [
    { id: "bangkok", vehicle_reg: "12-3456", province: "Bangkok" },
    { id: "chiangmai", vehicle_reg: "12 3456", province: "Chiang Mai" }
  ]);
  assert.equal(ambiguous.status, "ambiguous");
  assert.deepEqual(ambiguous.candidateVehicleIds, ["bangkok", "chiangmai"]);
});

test("does not match conflicting known provinces or unmatched registrations", () => {
  const provinceConflict = matchForthVehicle({ vehicleRegistration: "12-3456", province: "Bangkok" }, [
    { id: "vehicle-1", vehicle_reg: "12 3456", province: "Chiang Mai" }
  ]);
  assert.equal(provinceConflict.status, "unmatched");
  const unmatched = matchForthVehicle({ vehicleRegistration: "99-9999" }, [{ id: "vehicle-1", vehicle_reg: "12-3456" }]);
  assert.equal(unmatched.status, "unmatched");
});

function createAuthorizedRoute(diagnostic, { permission = true, authError = null } = {}) {
  let diagnosticCalls = 0;
  const mocks = {
    "next/server": { NextResponse: { json: (body, options = {}) => new Response(JSON.stringify(body), { status: options.status ?? 200, headers: options.headers }) } },
    "@/lib/authorization": { hasPermission: (_access, name) => permission && name === "business:read" },
    "@/lib/admin-user-management-server": {
      AdminApiError: TestAdminApiError,
      createServerSupabaseAdmin: () => ({}),
      requireVerifiedUser: async () => { if (authError) throw authError; return { id: "office-user" }; },
      resolveAccountAccess: async () => ({ role: "office_staff", status: "active" })
    },
    "@/lib/forth-tracking-server": { getForthTrackingDiagnostic: async () => { diagnosticCalls++; return diagnostic; } }
  };
  return { route: loadTypeScript("app/api/admin/forth-tracking/route.ts", mocks), getDiagnosticCalls: () => diagnosticCalls };
}

function createFleetDataRoute(fleetData, { permission = true, authError = null } = {}) {
  const mocks = {
    "next/server": { NextResponse: { json: (body, options = {}) => new Response(JSON.stringify(body), { status: options.status ?? 200, headers: options.headers }) } },
    "@/lib/authorization": { hasPermission: (_access, name) => permission && name === "business:read" },
    "@/lib/admin-user-management-server": {
      AdminApiError: TestAdminApiError,
      createServerSupabaseAdmin: () => ({}),
      requireVerifiedUser: async () => { if (authError) throw authError; return { id: "office-user" }; },
      resolveAccountAccess: async () => ({ role: "office_staff", status: "active" })
    },
    "@/lib/forth-tracking-server": { getForthTrackingFleetData: async () => fleetData }
  };
  return loadTypeScript("app/api/admin/forth-tracking/vehicles/route.ts", mocks);
}

function createStatusDiagnosticRoute(result, { permission = true, authError = null } = {}) {
  let calls = 0;
  const mocks = {
    "next/server": { NextResponse: { json: (body, options = {}) => new Response(JSON.stringify(body), { status: options.status ?? 200, headers: options.headers }) } },
    "@/lib/authorization": { hasPermission: (_access, name) => permission && name === "business:read" },
    "@/lib/admin-user-management-server": {
      AdminApiError: TestAdminApiError,
      createServerSupabaseAdmin: () => ({}),
      requireVerifiedUser: async () => { if (authError) throw authError; return { id: "office-user" }; },
      resolveAccountAccess: async () => ({ role: "office_staff", status: "active" })
    },
    "@/lib/forth-tracking-server": { getForthTrackingStatusDiagnostic: async () => { calls++; return result; } }
  };
  return { route: loadTypeScript("app/api/admin/forth-tracking/status-diagnostic/route.ts", mocks), getCalls: () => calls };
}

test("protected fleet data endpoint requires verified EES business-read access and is no-store", async () => {
  const unauthenticated = createFleetDataRoute({ records: [] }, { authError: new TestAdminApiError(401, "Authentication required.") });
  const noUser = await unauthenticated.GET(new Request("https://ees.test/api/admin/forth-tracking/vehicles"));
  assert.equal(noUser.status, 401);
  assert.equal(noUser.headers.get("cache-control"), "private, no-store");

  const unauthorized = createFleetDataRoute({ records: [] }, { permission: false });
  const denied = await unauthorized.GET(new Request("https://ees.test/api/admin/forth-tracking/vehicles"));
  assert.equal(denied.status, 403);

  const connected = createFleetDataRoute({ connectionStatus: "connected", fetchedAt: "2026-10-21T05:00:00.000Z", records: [{ vehicleRegistration: "1กข2345" }], error: null });
  const response = await connected.GET(new Request("https://ees.test/api/admin/forth-tracking/vehicles"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await response.json(), { connectionStatus: "connected", fetchedAt: "2026-10-21T05:00:00.000Z", records: [{ vehicleRegistration: "1กข2345" }], error: null });
});

test("one-shot status diagnostic requires explicit confirmation and business-read access", async () => {
  const result = { connectionStatus: "connected", recordCount: 2, communications: { online: 2, offline: 0, unknown: 0 } };
  const noPermission = createStatusDiagnosticRoute(result, { permission: false });
  assert.equal((await noPermission.route.GET(new Request("https://ees.test/api/admin/forth-tracking/status-diagnostic?confirm=aggregate-only"))).status, 403);
  assert.equal(noPermission.getCalls(), 0);

  const unauthenticated = createStatusDiagnosticRoute(result, { authError: new TestAdminApiError(401, "Authentication required.") });
  assert.equal((await unauthenticated.route.GET(new Request("https://ees.test/api/admin/forth-tracking/status-diagnostic?confirm=aggregate-only"))).status, 401);
  assert.equal(unauthenticated.getCalls(), 0);

  const noConfirmation = createStatusDiagnosticRoute(result);
  assert.equal((await noConfirmation.route.GET(new Request("https://ees.test/api/admin/forth-tracking/status-diagnostic"))).status, 400);
  assert.equal(noConfirmation.getCalls(), 0);

  const confirmed = createStatusDiagnosticRoute(result);
  const response = await confirmed.route.GET(new Request("https://ees.test/api/admin/forth-tracking/status-diagnostic?confirm=aggregate-only"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await response.json(), result);
  assert.equal(confirmed.getCalls(), 1);
});

test("protected diagnostic rejects unauthenticated and unauthorized EES callers", async () => {
  const unauthenticated = createAuthorizedRoute({ ok: true }, { authError: new TestAdminApiError(401, "Authentication required.") });
  const noUser = await unauthenticated.route.GET(new Request("https://ees.test/api/admin/forth-tracking"));
  assert.equal(noUser.status, 401);
  assert.equal(unauthenticated.getDiagnosticCalls(), 0);

  const unauthorized = createAuthorizedRoute({ ok: true }, { permission: false });
  const denied = await unauthorized.route.GET(new Request("https://ees.test/api/admin/forth-tracking"));
  assert.equal(denied.status, 403);
  assert.equal(unauthorized.getDiagnosticCalls(), 0);
});

test("protected diagnostic returns private no-store results for an authorized office account", async () => {
  const fixture = createAuthorizedRoute({ connectionStatus: "not_configured", authenticationStatus: "protocol_unverified" });
  const response = await fixture.route.GET(new Request("https://ees.test/api/admin/forth-tracking"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await response.json(), { connectionStatus: "not_configured", authenticationStatus: "protocol_unverified" });
  assert.equal(fixture.getDiagnosticCalls(), 1);
});

const credentials = {
  FORTH_CLIENT_ID: "client-test",
  FORTH_CLIENT_SECRET: "secret-test",
  FORTH_USERNAME: "user-test",
  FORTH_PASSWORD: "password-test",
  FORTH_TOKEN_REQUEST_PROFILE: "oauth-password-basic-v1"
};

function makeServerService(environment, fetcher, now = () => baseNow) {
  const { createForthTrackingDiagnosticService } = loadTypeScript("lib/forth-tracking-server.ts");
  return createForthTrackingDiagnosticService({ environment, fetcher, now });
}

function makeFleetService(environment, fetcher, now = () => baseNow) {
  const { createForthTrackingService } = loadTypeScript("lib/forth-tracking-server.ts");
  return createForthTrackingService({ environment, fetcher, now });
}

test("status diagnostic returns aggregate counts only and omits all source identifiers and location data", async () => {
  const calls = [];
  const service = makeFleetService({ ...credentials, FORTH_SOURCE_TIME_ZONE: "Asia/Bangkok" }, async (url, init) => {
    calls.push(String(url));
    if (String(url).endsWith("/token")) return Response.json({ access_token: "mock-access-token", expires_in: 3600 });
    return Response.json([{
      gpsID: "SENSITIVE-DEVICE-ID",
      plateNumber: "PRIVATE-REGISTRATION",
      driver: "Private Driver Name",
      dateTime: "21-10-2026 11:59:00",
      GPS: "ON",
      GPRS: "ON",
      Engine: "ON",
      Speed: "12",
      Latitude: 13.7563,
      Longitude: 100.5018,
      positionSource: "GPS",
      Position_Source: "PRIVATE-SOURCE-VALUE"
    }]);
  });

  const result = await service.diagnoseStatus();
  assert.equal(calls.length, 2);
  assert.equal(result.connectionStatus, "connected");
  assert.equal(result.recordCount, 1);
  assert.deepEqual(result.communications, { online: 1, offline: 0, unknown: 0 });
  assert.deepEqual(result.positionFreshness, { current: 1, stale: 0, unknown: 0 });
  assert.deepEqual(result.positionQuality, { gps: 1, no_gps: 0, wifi: 0, lbs: 0, other: 0, unknown: 0 });
  assert.deepEqual(result.positionSourceShape.canonicalField, {
    missing: 0, null: 0, empty: 0, number: 0, boolean: 0,
    recognized_string: 1, unrecognized_string: 0, other: 0
  });
  assert.equal(result.positionSourceShape.alternateCandidateRecords, 1);
  assert.deepEqual(result.positionSourceShape.alternateCandidateValues, {
    missing: 0, null: 0, empty: 0, number: 0, boolean: 0,
    recognized_string: 0, unrecognized_string: 1, other: 0
  });
  const serialized = JSON.stringify(result);
  for (const sensitive of ["SENSITIVE-DEVICE-ID", "PRIVATE-REGISTRATION", "Private Driver Name", "13.7563", "100.5018", "11:59", "PRIVATE-SOURCE-VALUE", "Position_Source", "mock-access-token", "secret-test", "password-test"]) {
    assert.equal(serialized.includes(sensitive), false);
  }
});

test("status diagnostic returns only bounded sanitized unknown positionSource labels with occurrence counts", async () => {
  const service = makeFleetService({ ...credentials, FORTH_SOURCE_TIME_ZONE: "Asia/Bangkok" }, async (url) => {
    if (String(url).endsWith("/token")) return Response.json({ access_token: "mock-access-token", expires_in: 3600 });
    return Response.json([
      { gpsID: "PRIVATE-ID", plateNumber: "PRIVATE-REG", driver: "PRIVATE-DRIVER", Latitude: 13.7, Longitude: 100.5, positionSource: " Vendor-A " },
      { positionSource: "Vendor-A" },
      { positionSource: "Vendor-B\u0000\nLabel\t " },
      { positionSource: "GPS" },
      { positionSource: "X".repeat(81) },
      { positionSource: 7 },
      { positionSource: false }
    ]);
  });

  const result = await service.diagnoseStatus();
  assert.deepEqual(result.unknownPositionSourceStrings, {
    unknownStringCount: 4,
    returnedUniqueCount: 2,
    notListedOccurrences: 0,
    rejectedOccurrences: 1,
    labels: [
      { label: "Vendor-A", occurrences: 2 },
      { label: "Vendor-B Label", occurrences: 1 }
    ]
  });
  const serialized = JSON.stringify(result);
  for (const sensitive of ["PRIVATE-ID", "PRIVATE-REG", "PRIVATE-DRIVER", "13.7", "100.5", "mock-access-token", "secret-test", "password-test", "\u0000"]) {
    assert.equal(serialized.includes(sensitive), false);
  }
  assert.equal(serialized.includes("X".repeat(81)), false);
  assert.equal(serialized.includes("Vendor-A"), true);
});

test("status diagnostic does not report empty source fields as unrecognized strings", async () => {
  const service = makeFleetService({ ...credentials, FORTH_SOURCE_TIME_ZONE: "Asia/Bangkok" }, async (url) => {
    if (String(url).endsWith("/token")) return Response.json({ access_token: "mock-access-token", expires_in: 3600 });
    return Response.json([{ positionSource: "   " }]);
  });

  const result = await service.diagnoseStatus();
  assert.equal(result.positionSourceShape.canonicalField.empty, 1);
  assert.equal(result.unknownPositionSourceStrings.unknownStringCount, 0);
  assert.deepEqual(result.unknownPositionSourceStrings.labels, []);
});

test("status diagnostic caps unknown source labels at twenty unique entries", async () => {
  const service = makeFleetService({ ...credentials, FORTH_SOURCE_TIME_ZONE: "Asia/Bangkok" }, async (url) => {
    if (String(url).endsWith("/token")) return Response.json({ access_token: "mock-access-token", expires_in: 3600 });
    return Response.json(Array.from({ length: 24 }, (_, index) => ({ positionSource: "Unknown-" + index })));
  });

  const result = await service.diagnoseStatus();
  assert.equal(result.unknownPositionSourceStrings.unknownStringCount, 24);
  assert.equal(result.unknownPositionSourceStrings.returnedUniqueCount, 20);
  assert.equal(result.unknownPositionSourceStrings.notListedOccurrences, 4);
  assert.equal(result.unknownPositionSourceStrings.rejectedOccurrences, 0);
  assert.equal(result.unknownPositionSourceStrings.labels.length, 20);
});

test("does not call Forth until credentials and the verified Basic token profile are configured", async () => {
  for (const profile of ["", "oauth-password-form-v1"]) {
    let calls = 0;
    const service = makeServerService({ ...credentials, FORTH_TOKEN_REQUEST_PROFILE: profile }, async () => { calls++; throw new Error("must not call"); });
    const result = await service();
    assert.equal(calls, 0);
    assert.equal(result.connectionStatus, "not_configured");
    assert.equal(result.authenticationStatus, "protocol_unverified");
    assert.equal(result.error.code, "oauth_protocol_unverified");
  }
});

test("reports authentication failure safely and cools down repeated token attempts", async () => {
  let calls = 0;
  const service = makeServerService(credentials, async (url) => {
    calls++;
    assert.match(String(url), /authorizationserver\/token$/);
    return new Response(JSON.stringify({ error: "bad credentials", error_description: "password-test and secret-test" }), { status: 401 });
  });
  const first = await service();
  const second = await service();
  assert.equal(calls, 1);
  assert.equal(first.authenticationStatus, "rejected");
  assert.equal(first.error.code, "authentication_rejected");
  assert.equal(JSON.stringify(first).includes("secret-test"), false);
  assert.deepEqual(second, first);
});

test("authenticates once, validates tracking data, and returns aggregate counts only", async () => {
  const requests = [];
  const service = makeServerService(credentials, async (url, init) => {
    requests.push({ url: String(url), init });
    if (String(url).endsWith("/token")) {
      assert.equal(String(url), "https://webapi.forthtrack.com/authorizationserver/token");
      assert.equal(init.method, "POST");
      const headers = new Headers(init.headers);
      assert.equal(headers.get("authorization"), `Basic ${Buffer.from("client-test:secret-test", "utf8").toString("base64")}`);
      assert.equal(headers.get("content-type"), "application/x-www-form-urlencoded; charset=utf-8");
      assert.equal(headers.get("accept"), "application/json");
      const body = new URLSearchParams(init.body);
      assert.equal(body.toString(), "grant_type=password&username=user-test&password=password-test");
      assert.equal(body.has("client_id"), false);
      assert.equal(body.has("client_secret"), false);
      assert.equal(body.has("scope"), false);
      return Response.json({ access_token: "bearer-test-token", token_type: "Bearer", expires_in: 3600 });
    }
    assert.match(String(url), /trackingresource\/api\/tracking$/);
    assert.equal(init.method, "GET");
    assert.equal(new Headers(init.headers).get("authorization"), "Bearer bearer-test-token");
    return Response.json([
      { Latitude: 13.7, Longitude: 100.5, dateTime: "2026-10-21T04:55:00Z", GPS: "ON", GPRS: "ON", positionSource: "GPS" },
      { Latitude: "bad", Longitude: 100.5, dateTime: "2026-10-21T04:50:00Z", GPS: "ON", GPRS: "ON", positionSource: "GPS" },
      { Latitude: 13.7, Longitude: null, GPS: "OFF", GPRS: "ON" }
    ]);
  });
  const result = await service();
  const repeatedResult = await service();
  assert.equal(requests.filter((request) => request.url.endsWith("/token")).length, 1);
  assert.equal(requests.filter((request) => request.url.endsWith("/tracking")).length, 2);
  assert.equal(result.connectionStatus, "connected");
  assert.equal(result.authenticationStatus, "authenticated");
  assert.equal(result.trackingRecordCount, 3);
  assert.equal(result.recordsWithValidCoordinates, 1);
  assert.equal(result.recordsWithInvalidCoordinates, 1);
  assert.equal(result.recordsWithMissingCoordinates, 1);
  assert.equal(result.recordsWithMissingOrInvalidCoordinates, 2);
  assert.equal(result.mostRecentGpsUpdateAt, "2026-10-21T04:55:00.000Z");
  assert.equal(repeatedResult.connectionStatus, "connected");
  assert.equal(JSON.stringify(result).includes("bearer-test-token"), false);
});

test("fleet endpoint service exposes normalized vehicle fields only and reuses its OAuth token", async () => {
  const requests = [];
  const service = makeFleetService({ ...credentials, FORTH_SOURCE_TIME_ZONE: "Asia/Bangkok" }, async (url, init) => {
    requests.push(String(url));
    if (String(url).endsWith("/token")) return Response.json({ access_token: "bearer-test-token", token_type: "Bearer", expires_in: 3600 });
    assert.equal(new Headers(init.headers).get("authorization"), "Bearer bearer-test-token");
    return Response.json([{
      gpsID: "device-7",
      plateNumber: "1กข-2345",
      driver: "Driver A",
      IDCard: "private-id",
      IDTransport: "private-transport-id",
      Sensor1: "private-sensor-value",
      Latitude: 13.7,
      Longitude: 100.5,
      GPS: "Online",
      GPRS: "Connected",
      Engine: "On",
      Speed: 42,
      COG: 90,
      dateTime: "2026-10-21 11:55:00",
      positionSource: "GPS"
    }]);
  });

  const result = await service.getFleetData();
  assert.equal(result.connectionStatus, "connected");
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].reportedDriver, "Driver A");
  assert.equal(result.records[0].gprsConnectivity, "connected");
  assert.equal(result.records[0].speed, 42);
  assert.deepEqual(result.records[0].sourceAudit.speed, { shape: "number", value: 42, truncated: false });
  assert.equal(result.records[0].sourceAudit.positionSource.value, "GPS");
  assert.equal(result.records[0].sourceAudit.latitude.value, 13.7);
  assert.equal(result.records[0].sourceTimestampRaw, "2026-10-21 11:55:00");
  assert.equal(result.records[0].lastGpsTimestamp, "2026-10-21T04:55:00.000Z");
  assert.equal(result.fetchedAt, "2026-10-21T05:00:00.000Z");
  assert.equal(Object.hasOwn(result.records[0], "optionalSensors"), false);
  assert.equal(Object.hasOwn(result.records[0], "IDCard"), false);
  assert.equal(JSON.stringify(result).includes("private-id"), false);
  assert.equal(JSON.stringify(result).includes("private-sensor-value"), false);
  assert.equal(JSON.stringify(result).includes("bearer-test-token"), false);
  assert.equal(requests.filter((url) => url.endsWith("/token")).length, 1);

  const disconnected = await service.diagnose();
  assert.equal(disconnected.connectionStatus, "connected");
  assert.equal(requests.filter((url) => url.endsWith("/token")).length, 1);
});

test("accepts an empty vehicle array and distinguishes Forth network failures", async () => {
  let tokenCalls = 0;
  const empty = makeServerService(credentials, async (url) => {
    if (String(url).endsWith("/token")) {
      tokenCalls++;
      return Response.json({ access_token: "token", expires_in: 3600 });
    }
    return Response.json([]);
  });
  const emptyResult = await empty();
  assert.equal(emptyResult.connectionStatus, "connected");
  assert.equal(emptyResult.trackingRecordCount, 0);
  assert.equal(tokenCalls, 1);

  const network = makeServerService(credentials, async (url) => {
    if (String(url).endsWith("/token")) return Response.json({ access_token: "token", expires_in: 3600 });
    throw new TypeError("network unavailable");
  });
  const networkResult = await network();
  assert.equal(networkResult.error.code, "tracking_network_error");
  assert.equal(networkResult.connectionStatus, "failed");
});

test("does not expose invalid JSON or upstream error bodies", async () => {
  const invalidJson = makeServerService(credentials, async (url) => {
    if (String(url).endsWith("/token")) return Response.json({ access_token: "token", expires_in: 3600 });
    return new Response("secret upstream details", { status: 200 });
  });
  const result = await invalidJson();
  assert.equal(result.error.code, "invalid_tracking_response");
  assert.equal(JSON.stringify(result).includes("secret upstream details"), false);

  const httpError = makeServerService(credentials, async (url) => {
    if (String(url).endsWith("/token")) return Response.json({ access_token: "token", expires_in: 3600 });
    return new Response("private error body", { status: 503 });
  });
  const failed = await httpError();
  assert.equal(failed.error.code, "tracking_http_error");
  assert.equal(JSON.stringify(failed).includes("private error body"), false);
});

test("fleet view separates motion from communications and filters activity states", () => {
  const { getForthFleetStatus, summarizeForthFleet, filterForthFleetRecords, formatForthTrackingTime } = loadTypeScript("lib/forth-tracking-view.ts");
  const records = [
    { vehicleRegistration: "MOVING-1", reportedDriver: "Driver A", gpsDeviceId: "D1", gpsConnectivity: "connected", gprsConnectivity: "connected", timestampStatus: "current", coordinateStatus: "valid", positionQuality: "gps", speed: 12, lastGpsTimestamp: "2026-10-21T04:59:00.000Z" },
    { vehicleRegistration: "STATIONARY-1", gpsDeviceId: "D2", gpsConnectivity: "connected", gprsConnectivity: "connected", timestampStatus: "current", coordinateStatus: "valid", positionQuality: "gps", speed: 0, lastGpsTimestamp: "2026-10-21T04:58:00.000Z" },
    { vehicleRegistration: "STALE-1", gpsDeviceId: "D3", gpsConnectivity: "connected", gprsConnectivity: "connected", timestampStatus: "stale", coordinateStatus: "valid", positionQuality: "gps", speed: 50, lastGpsTimestamp: "2026-10-20T04:58:00.000Z" },
    { vehicleRegistration: "UNKNOWN-1", gpsDeviceId: "D4", gpsConnectivity: "unknown", gprsConnectivity: "unknown", timestampStatus: "missing", coordinateStatus: "missing", positionQuality: "unknown", speed: null, lastGpsTimestamp: null }
  ];

  assert.deepEqual(records.map(getForthFleetStatus), ["moving", "stationary", "unknown", "unknown"]);
  const summary = summarizeForthFleet(records);
  assert.deepEqual(summary.motion, { moving: 1, stationary: 1, unknown: 2 });
  assert.deepEqual(summary.communications, { online: 3, offline: 0, unknown: 1 });
  assert.deepEqual(summary.positionFreshness, { current: 2, stale: 1, unknown: 1 });
  assert.equal(summary.lastVerifiedGpsPosition, "2026-10-21T04:59:00.000Z");
  assert.equal(filterForthFleetRecords(records, "driver a", "all").length, 1);
  assert.equal(filterForthFleetRecords(records, "", "stopped")[0].vehicleRegistration, "STATIONARY-1");
  const formattedTime = formatForthTrackingTime("2026-10-21T04:59:00.000Z", "en");
  const zoneLabel = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok", timeZoneName: "short", hourCycle: "h23" })
    .formatToParts(new Date("2026-10-21T04:59:00.000Z"))
    .find((part) => part.type === "timeZoneName").value;
  assert.ok(formattedTime.includes(zoneLabel));
  assert.match(formattedTime, /11:59/);
});

test("accuracy comparisons show allowlisted Forth source fields beside normalized values and distinct timestamps", () => {
  const { getForthAccuracyComparisons, getForthNormalizationWarnings } = loadTypeScript("lib/forth-tracking-view.ts");
  const [record] = normalizeForthTrackingResponse([{
    gpsID: "device-7",
    plateNumber: " 1กข-2345 ",
    driver: " Driver A ",
    Latitude: "13.700000",
    Longitude: "100.500000",
    Speed: "66.0",
    Engine: " ON ",
    COG: "90",
    GPS: "ON",
    GPRS: "Connected",
    positionSource: "No GPS",
    dateTime: "21-10-2026 11:55:00"
  }], { now: baseNow, sourceTimeZone: "Asia/Bangkok" });
  const comparisons = getForthAccuracyComparisons(record, "2026-10-21T05:00:00.000Z");
  const get = (field) => comparisons.find((entry) => entry.field === field);

  assert.equal(get("registration").sourceField, "plateNumber");
  assert.equal(get("registration").source.value, " 1กข-2345 ");
  assert.equal(get("registration").normalized, "1กข-2345");
  assert.equal(get("speed").sourceField, "Speed");
  assert.equal(get("speed").source.value, "66.0");
  assert.equal(get("speed").normalized, "66 km/h");
  assert.equal(get("gps_signal").source.value, "ON");
  assert.equal(get("gps_signal").normalized, "connected");
  assert.equal(get("position_source").source.value, "No GPS");
  assert.equal(get("position_source").normalized, "No GPS (no_gps)");
  assert.equal(get("position_time").source.value, "21-10-2026 11:55:00");
  assert.match(get("position_time").normalized, /GMT\+7.*current.*2026-10-21T04:55:00\.000Z/);
  assert.equal(get("retrieval_time").source, null);
  assert.match(get("retrieval_time").normalized, /2026-10-21T05:00:00\.000Z/);
  assert.equal(get("activity_status").sourceField, null);
  assert.equal(get("activity_status").normalized, "Reported driving; EES derives this from Speed and Engine.");
  assert.deepEqual(getForthNormalizationWarnings(record), []);
});

test("accuracy warnings distinguish missing, invalid, stale and unrecognized source data", () => {
  const { getForthNormalizationWarnings } = loadTypeScript("lib/forth-tracking-view.ts");
  const [missing, invalid, stale] = normalizeForthTrackingResponse([
    {},
    { Speed: "fast", Engine: "maybe", GPS: "maybe", GPRS: "maybe", Latitude: "bad", Longitude: "100.5", COG: "999", positionSource: "Vendor-Q", dateTime: "bad" },
    { Speed: "12", Engine: "ON", Latitude: 13.7, Longitude: 100.5, dateTime: "21-10-2026 11:44:00", positionSource: "GPS" }
  ], { now: baseNow, sourceTimeZone: "Asia/Bangkok" });
  const missingWarnings = getForthNormalizationWarnings(missing);
  assert.ok(missingWarnings.includes("registration_missing"));
  assert.ok(missingWarnings.includes("device_id_missing"));
  assert.ok(missingWarnings.includes("speed_missing"));
  assert.ok(missingWarnings.includes("position_time_unavailable"));
  const invalidWarnings = getForthNormalizationWarnings(invalid);
  assert.ok(invalidWarnings.includes("speed_invalid"));
  assert.ok(invalidWarnings.includes("engine_unavailable"));
  assert.ok(invalidWarnings.includes("coordinates_invalid"));
  assert.ok(invalidWarnings.includes("heading_invalid"));
  assert.ok(invalidWarnings.includes("gps_signal_unknown"));
  assert.ok(invalidWarnings.includes("gprs_unknown"));
  assert.ok(invalidWarnings.includes("position_source_unknown"));
  assert.ok(invalidWarnings.includes("position_time_unavailable"));
  assert.ok(getForthNormalizationWarnings(stale).includes("position_time_stale"));
});

test("reported activity is independent from GPS confidence and summary counts match activity filters", () => {
  const {
    getForthReportedActivity,
    isForthGpsPositionVerified,
    isForthGpsVerifiedDriving,
    summarizeForthFleet,
    filterForthFleetRecords,
    sortForthFleetRecords
  } = loadTypeScript("lib/forth-tracking-view.ts");
  const current = {
    gpsConnectivity: "connected",
    gprsConnectivity: "connected",
    timestampStatus: "current",
    coordinateStatus: "valid",
    positionQuality: "no_gps",
    latitude: 13.7,
    longitude: 100.5,
    lastGpsTimestamp: "2026-10-21T04:59:00.000Z",
    speed: 12,
    engineOn: true
  };
  const records = [
    { ...current, vehicleRegistration: "NO-GPS-DRIVING" },
    { ...current, vehicleRegistration: "STOP-ON", speed: 0, engineOn: true },
    { ...current, vehicleRegistration: "STOP-OFF", speed: 0, engineOn: false },
    { ...current, vehicleRegistration: "STOP-UNKNOWN", speed: 0, engineOn: null },
    { ...current, vehicleRegistration: "STALE", timestampStatus: "stale", speed: 11 },
    { ...current, vehicleRegistration: "NO-SPEED", speed: null },
    {
      ...current,
      vehicleRegistration: "GPS-VERIFIED-DRIVING",
      positionQuality: "gps",
      speed: 30
    },
    { ...current, vehicleRegistration: "GPS-LOST-DRIVING", gpsConnectivity: "disconnected", positionQuality: "gps" },
    { ...current, vehicleRegistration: "GPRS-OFFLINE-DRIVING", gprsConnectivity: "disconnected" },
    { ...current, vehicleRegistration: "NO-COORDINATES-DRIVING", coordinateStatus: "missing", latitude: null, longitude: null },
    { ...current, vehicleRegistration: "INVALID-SPEED", speed: -1 }
  ];

  assert.deepEqual(records.map(getForthReportedActivity), [
    "driving", "stopped_engine_on", "stopped_engine_off", "stopped_engine_unknown",
    "unavailable", "unavailable", "driving", "driving", "driving", "driving", "unavailable"
  ]);
  assert.equal(isForthGpsPositionVerified(records[0]), false);
  assert.equal(isForthGpsVerifiedDriving(records[0]), false);
  assert.equal(isForthGpsPositionVerified(records[6]), true);
  assert.equal(isForthGpsVerifiedDriving(records[6]), true);
  assert.equal(getForthReportedActivity(records[7]), "driving");
  assert.equal(isForthGpsPositionVerified(records[7]), false);
  assert.equal(getForthReportedActivity(records[8]), "driving");
  assert.equal(getForthReportedActivity(records[9]), "driving");
  assert.equal(getForthReportedActivity(records[10]), "unavailable");

  const summary = summarizeForthFleet(records);
  assert.deepEqual(summary.reportedActivity, {
    driving: 5,
    stopped: 3,
    stoppedEngineOn: 1,
    stoppedEngineOff: 1,
    stoppedEngineUnknown: 1,
    unavailable: 3
  });
  assert.deepEqual(summary.positionConfidence, { gpsVerified: 1, notGpsVerified: 10 });
  assert.equal(summary.gpsVerifiedDriving, 1);
  assert.equal(summary.needsAttention, 2);
  assert.equal(summary.currentGpsVerifiedPositions, 1);
  assert.equal(summary.latestCurrentGpsPosition, current.lastGpsTimestamp);
  assert.equal(filterForthFleetRecords(records, "", "all").length, summary.total);
  assert.equal(filterForthFleetRecords(records, "", "driving").length, summary.reportedActivity.driving);
  assert.equal(filterForthFleetRecords(records, "", "stopped").length, summary.reportedActivity.stopped);
  assert.equal(filterForthFleetRecords(records, "", "unavailable").length, summary.reportedActivity.unavailable);
  assert.equal(filterForthFleetRecords(records, "", "attention").length, summary.needsAttention);
  assert.equal(filterForthFleetRecords(records, "", "offline").length, summary.communications.offline);
  assert.equal(filterForthFleetRecords(records, "", "stale").length, summary.positionFreshness.stale);
  assert.equal(filterForthFleetRecords(records, "", "unverified").length, summary.positionConfidence.notGpsVerified);
  assert.equal(filterForthFleetRecords(records, "", "engine_on_stopped").length, summary.reportedActivity.stoppedEngineOn);
  assert.equal(filterForthFleetRecords(records, "NO-GPS", "driving")[0].vehicleRegistration, "NO-GPS-DRIVING");
  assert.deepEqual(
    sortForthFleetRecords(records, "speed_desc").slice(0, 2).map((record) => record.vehicleRegistration),
    ["GPS-VERIFIED-DRIVING", "GPRS-OFFLINE-DRIVING"]
  );

  const offlineAndStale = { ...current, gprsConnectivity: "disconnected", timestampStatus: "stale" };
  assert.equal(summarizeForthFleet([offlineAndStale]).needsAttention, 1);
  assert.equal(filterForthFleetRecords([offlineAndStale], "", "attention").length, 1);
});

test("classifies lost, stale, ambiguous, invalid, and incomplete GPS records safely", () => {
  const { getForthFleetStatus, summarizeForthFleet } = loadTypeScript("lib/forth-tracking-view.ts");
  const base = {
    gpsConnectivity: "connected",
    gprsConnectivity: "connected",
    timestampStatus: "current",
    coordinateStatus: "valid",
    positionQuality: "gps",
    speed: 10,
    latitude: 13.7,
    longitude: 100.5,
    lastGpsTimestamp: "2026-10-21T04:59:00.000Z"
  };
  const records = [
    { ...base },
    { ...base, gpsConnectivity: "disconnected" },
    { ...base, gprsConnectivity: "disconnected" },
    { ...base, timestampStatus: "stale", speed: 40, lastGpsTimestamp: "2026-10-21T04:00:00.000Z" },
    { ...base, timestampStatus: "timezone_unconfigured", lastGpsTimestamp: null },
    { ...base, coordinateStatus: "missing", latitude: null },
    { ...base, coordinateStatus: "invalid", latitude: null },
    { ...base, speed: null },
    { ...base, speed: -1 },
    { ...base, speed: Number.NaN },
    { ...base, positionQuality: "other" }
  ];

  assert.deepEqual(records.map(getForthFleetStatus), [
    "moving", "unknown", "moving", "unknown", "unknown", "unknown",
    "unknown", "unknown", "unknown", "unknown", "unknown"
  ]);
  assert.equal(summarizeForthFleet(records).lastVerifiedGpsPosition, "2026-10-21T04:59:00.000Z");
});

test("map coordinate projection excludes missing, invalid, non-finite, and out-of-range values", () => {
  const { getForthFleetMapRecords } = loadTypeScript("lib/forth-tracking-view.ts");
  const record = (latitude, longitude, coordinateStatus = "valid") => ({
    vehicleRegistration: "BUS-1",
    gpsDeviceId: "GPS-1",
    latitude,
    longitude,
    coordinateStatus
  });
  const mapped = getForthFleetMapRecords([
    record(0, 0),
    record(-90, 180),
    record(null, 100),
    record(13, null),
    record(Number.NaN, 100),
    record(91, 100),
    record(13, -181),
    record(13, 100, "invalid")
  ]);

  assert.deepEqual(mapped.map(({ position }) => position), [[0, 0], [-90, 180]]);
  assert.equal(mapped[0].key, "device:GPS-1");
});

test("fleet selection keys remain stable across data refreshes and match map marker keys", () => {
  const { findForthFleetRecord, getForthFleetMapRecords, getForthFleetRecordKey } = loadTypeScript("lib/forth-tracking-view.ts");
  const selected = { gpsDeviceId: "GPS-700", vehicleRegistration: "700-4145", coordinateStatus: "valid", latitude: 13.7, longitude: 100.5 };
  const other = { gpsDeviceId: "GPS-701", vehicleRegistration: "700-4146", coordinateStatus: "valid", latitude: 13.8, longitude: 100.6 };
  const selectionKey = getForthFleetRecordKey(selected, 0);
  const refreshed = [{ ...other }, { ...selected, latitude: 13.71, longitude: 100.51 }];
  const refreshedMap = getForthFleetMapRecords(refreshed);

  assert.equal(selectionKey, "device:GPS-700");
  assert.equal(findForthFleetRecord(refreshed, selectionKey).vehicleRegistration, "700-4145");
  assert.equal(refreshedMap.find(({ record }) => record.vehicleRegistration === "700-4145").key, selectionKey);
  assert.equal(getForthFleetRecordKey({ vehicleRegistration: " 1กข - 2345 " }, 8), "registration:1กข2345");
});

test("Leaflet map keeps selection focus explicit, clusters overlaps, and preserves manual map navigation on refresh", () => {
  const source = fs.readFileSync(path.join(root, "components/forth-tracking-map.tsx"), "utf8");
  const styles = fs.readFileSync(path.join(root, "components/forth-tracking-map.module.css"), "utf8");
  assert.ok(source.includes('import "leaflet/dist/leaflet.css"'));
  assert.ok(source.includes('import "leaflet.markercluster/dist/MarkerCluster.css"'));
  assert.ok(source.includes("await import(\"leaflet.markercluster\")"));
  assert.ok(source.includes("Leaflet.markerClusterGroup("));
  assert.ok(source.includes("Leaflet.divIcon("));
  assert.ok(source.includes("Leaflet.marker(position"));
  assert.ok(source.includes('setProperty("z-index", "650")'));
  assert.ok(source.includes('setProperty("z-index", "200")'));
  assert.ok(source.includes("map.fitBounds("));
  assert.ok(source.includes("cluster.zoomToShowLayer(marker"));
  assert.ok(source.includes("map.flyTo(position"));
  assert.ok(source.includes("setZIndexOffset(selected ? 1200 : 0)"));
  assert.ok(source.includes("isForthGpsPositionVerified(record)"));
  assert.ok(source.includes("const approximate = !isForthGpsPositionVerified(record)"));
  assert.ok(source.includes("activityLabel(activity, copy)"));
  assert.ok(source.includes("copy.gpsVerified"));
  assert.ok(source.includes("copy.notGpsVerified"));
  assert.ok(source.includes("styles.vehicleMarkerDriving"));
  assert.ok(source.includes("styles.vehicleMarkerStopped"));
  assert.ok(source.includes("styles.vehicleMarkerUnavailable"));
  assert.ok(source.includes("styles.vehicleMarkerApproximate"));
  assert.ok(source.includes("styles.vehicleMarkerOffline"));
  assert.ok(source.includes("copy.notGpsVerified"));
  assert.ok(source.includes("copy.openDetails"));
  assert.ok(source.includes("forth-tracking-popup-action"));
  assert.ok(source.includes("onSelectRef.current(key)"));
  assert.ok(source.includes("initialFitCompleteRef.current"));
  assert.ok(source.includes('command.type === "fit"'));
  assert.ok(styles.includes(".mapCanvas :global(.leaflet-pane.leaflet-marker-pane)"));
  assert.ok(styles.includes(".vehicleMarkerDot"));
  assert.ok(styles.includes(".vehicleMarkerApproximate"));
  assert.ok(styles.includes(".vehicleMarkerOffline::after"));
  assert.ok(styles.includes(".vehicleMarkerSelected"));
  assert.ok(source.includes("iconCreateFunction: (cluster)"));
  assert.ok(source.includes("cluster.refreshClusters()"));
  assert.ok(source.includes("if (clusterNeedsRefresh) {\n      cluster.refreshClusters();"));
  assert.ok(source.includes("if (entry.popupSignature !== popupSignature)"));
  assert.ok(source.includes("if (entry.tooltipSignature !== tooltipSignature)"));
  assert.ok(source.includes("const markerStateChanged = activityChanged || confidenceChanged || entry.offline !== offline"));
  assert.ok(source.includes("export const ForthTrackingMap = memo(function ForthTrackingMap"));
  assert.ok(source.includes('marker.on("focus", () => marker.openTooltip())'));
  assert.ok(source.includes("styles.vehicleClusterQualityApproximate"));
  assert.ok(source.includes("styles.vehicleClusterQualityVerified"));
  assert.ok(styles.includes(".vehicleClusterCounts"));

  const reconcileStart = source.indexOf("// Reconcile markers in place");
  const initialFitStart = source.indexOf("// The fleet is fit once");
  const markerRefreshEffect = source.slice(reconcileStart, initialFitStart);
  assert.equal(/fitFleet\(|fitBounds\(|map\.flyTo\(|map\.panTo\(/.test(markerRefreshEffect), false);
});

test("premium tracking workspace keeps selection and map controls with responsive details and actionable fleet signals", () => {
  const source = fs.readFileSync(path.join(root, "components/forth-tracking-centre.tsx"), "utf8");
  assert.ok(source.includes("onSelect={focusVehicle}"));
  assert.ok(source.includes("onClick={() => onSelect(recordKey)}"));
  assert.ok(source.includes("const FleetVehicleRow = memo(function FleetVehicleRow"));
  assert.ok(source.includes("const recordKeysByReference = useMemo(() =>"));
  assert.equal(source.includes("data.records.indexOf(record)"), false);
  assert.ok(source.includes("setSelectedKey((current) => current && payload.records.some"));
  assert.ok(source.includes("onClick={fitAllVehicles}"));
  assert.ok(source.includes("setMapCommand((current) => ({ type: \"fit\""));
  assert.ok(source.includes("setMapCommand((current) => ({ type: \"focus\""));
  assert.ok(source.includes('xl:grid-cols-[minmax(0,2.35fr)_minmax(300px,0.85fr)]'));
  assert.ok(source.includes('xl:absolute xl:inset-x-auto'));
  assert.ok(source.includes('xl:right-[calc(27%+0.75rem)]'));
  assert.ok(source.includes('id="forth-vehicle-list"'));
  assert.ok(source.includes("aria-label={copy.attention}"));
  assert.ok(source.includes('value="offline"'));
  assert.ok(source.includes('value="stale"'));
  assert.ok(source.includes('filter === "unverified" ? "all" : "unverified"'));
  assert.ok(source.includes('filter === "engine_on_stopped" ? "all" : "engine_on_stopped"'));
  assert.ok(source.includes('value="attention"'));
  assert.ok(source.includes('active={filter === "all"}'));
  assert.ok(source.includes('summary.communications.offline'));
  assert.ok(source.includes('summary.positionConfidence.notGpsVerified'));
  assert.ok(source.includes('label={copy.engineOnStops}'));
  assert.ok(source.includes('label={copy.locationNotGpsVerified}'));
  assert.ok(source.includes('className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 xl:grid-cols-6"'));
  assert.ok(source.includes('records={mapRecords}'));
  assert.ok(source.includes("formatForthRelativeAge(record.lastGpsTimestamp, Date.now(), language)"));
  assert.ok(source.includes("aria-label={accessibleUpdateTime}"));
  assert.ok(source.includes("copy.exactPositionTime"));
  assert.ok(source.includes("onClick={() => applyFleetFilter(filter === \"driving\" ? \"all\" : \"driving\")}"));
  assert.ok(source.includes("summary.latestCurrentGpsPosition"));
  assert.ok(source.includes("summary.positionConfidence.notGpsVerified"));
  assert.ok(source.includes("summary.reportedActivity.stoppedEngineOn"));
  assert.ok(source.includes("copy.mapOfflineLegend"));
  assert.ok(source.includes("selectedRecord.reportedDriver ?"));
  assert.ok(source.includes("copy.locationSection"));
  assert.ok(source.includes("copy.connectionTimingSection"));
  assert.ok(source.includes("copy.sourceSection"));
  assert.ok(source.includes("copy.focusOnMap"));
  assert.ok(source.includes("copy.approximateCoordinatesNote"));
  const inspectorStart = source.indexOf('aria-labelledby="forth-vehicle-details-title"');
  const accuracyStart = source.indexOf('{connected && can("business:read") ?');
  const inspector = source.slice(inspectorStart, accuracyStart);
  assert.equal(inspector.includes("sourceTimestampRaw"), false);
  assert.equal(inspector.includes("selectedRecord.positionSource"), false);
  assert.ok(source.includes("setSelectedKey(null)"));
  assert.ok(source.includes("copy.noGpsSourceNote"));
  assert.ok(source.includes("const [inspectorOpen, setInspectorOpen] = useState(false)"));
  assert.ok(source.includes("{selectedRecord ? ("));
  assert.ok(source.includes("setMobileInspectorOpen(false)"));
});

test("marker labels declutter at fleet zoom and prioritize selected Thai registrations when labels overlap", () => {
  const { getVisibleForthMarkerLabelKeys } = loadTypeScript("lib/forth-tracking-view.ts");
  const placements = [
    { key: "รถ-๑", left: 20, top: 20, width: 110, height: 24, selected: false },
    { key: "รถ-๒", left: 55, top: 22, width: 104, height: 24, selected: true },
    { key: "รถ-๓", left: 260, top: 22, width: 96, height: 24, selected: false }
  ];

  assert.deepEqual([...getVisibleForthMarkerLabelKeys(placements, 7)], []);
  assert.deepEqual([...getVisibleForthMarkerLabelKeys(placements, 8)], ["รถ-๒", "รถ-๓"]);
  assert.deepEqual([...getVisibleForthMarkerLabelKeys(placements, Number.NaN)], []);
});

test("fleet tracking map renders escaped registration labels and activity-specific marker colors", () => {
  const source = fs.readFileSync(path.join(root, "components/forth-tracking-map.tsx"), "utf8");
  const styles = fs.readFileSync(path.join(root, "components/forth-tracking-map.module.css"), "utf8");

  assert.ok(source.includes("styles.vehicleMarkerLabel"));
  assert.ok(source.includes("escapeHtml(registration)"));
  assert.ok(source.includes("getVisibleForthMarkerLabelKeys"));
  assert.ok(source.includes("labelUpdateRef.current()"));
  assert.ok(styles.includes(".vehicleMarkerLabelHidden"));
  assert.ok(styles.includes(".vehicleMarkerStoppedEngineOn"));
  assert.ok(styles.includes(".vehicleMarkerStoppedEngineOff"));
  assert.ok(styles.includes(".vehicleMarkerStoppedEngineUnknown"));
});

test("a failed refresh hides the previous telemetry snapshot and identifies its last successful refresh", () => {
  const source = fs.readFileSync(path.join(root, "components/forth-tracking-centre.tsx"), "utf8");
  assert.ok(source.includes("setData(null);\n          setRequestError(true);"));
  assert.ok(source.includes('const connected = !requestError && data?.connectionStatus === "connected"'));
  assert.ok(source.includes("requestError && lastChecked ?"));
  assert.ok(source.includes("copy.staleSnapshotHidden"));
  assert.ok(source.includes("requestFailureReason === \"authorization\""));
  assert.ok(source.includes("requestFailureReason === \"timeout\""));
  assert.ok(source.includes("requestFailureReason === \"upstream\""));
  assert.ok(source.includes("requestInvalidResponseFailure"));
  assert.ok(source.includes("timedOut ? \"timeout\" : failureReason"));
});

test("status diagnostic UI exposes accessible ready, confirmation, running and prior-attempt states", () => {
  const source = fs.readFileSync(path.join(root, "components/forth-tracking-centre.tsx"), "utf8");
  const runner = fs.readFileSync(path.join(root, "lib/forth-status-diagnostic-client.ts"), "utf8");
  assert.ok(source.includes('can("business:read")'));
  assert.ok(source.includes('useState<StatusDiagnosticUiState>("checking")'));
  assert.ok(source.includes('setStatusDiagnosticState(statusDiagnosticRunner.isAttemptUsed() ? "previously_attempted" : "ready")'));
  assert.ok(source.includes('statusDiagnosticState === "ready"'));
  assert.ok(source.includes('disabled={!diagnosticCanStart || statusDiagnosticConfirmationOpen}'));
  assert.ok(source.includes('setStatusDiagnosticState("awaiting_confirmation")'));
  assert.ok(source.includes('setStatusDiagnosticState("running")'));
  assert.ok(source.includes('setStatusDiagnosticState("completed")'));
  assert.ok(source.includes('role="alertdialog"'));
  assert.ok(source.includes('aria-modal="true"'));
  assert.ok(source.includes("cancelStatusDiagnosticConfirmation"));
  assert.ok(source.includes("diagnosticPreviouslyAttemptedBody"));
  assert.ok(runner.includes("FORTH_STATUS_DIAGNOSTIC_SESSION_KEY"));
  assert.ok(runner.includes('"/api/admin/forth-tracking/status-diagnostic?confirm=aggregate-only"'));
  assert.ok(runner.includes('reason: "already_attempted"'));
  assert.ok(runner.includes("Consume the attempt only immediately before initiating the protected request."));
  assert.ok(source.includes("positionSourceShape"));
  assert.ok(source.includes("unknownPositionSourceStrings"));
  assert.ok(source.includes("diagnosticUnknownSourceNote"));
  assert.ok(source.includes("<code className=\"break-all font-mono text-[11px]\">{entry.label}</code> · {entry.occurrences}"));
  assert.equal(source.includes("window.confirm"), false);
  assert.equal(source.includes("dangerouslySetInnerHTML"), false);
  const openHandler = source.slice(source.indexOf("const openStatusDiagnosticConfirmation"), source.indexOf("const cancelStatusDiagnosticConfirmation"));
  const cancelHandler = source.slice(source.indexOf("const cancelStatusDiagnosticConfirmation"), source.indexOf("useEffect", source.indexOf("const cancelStatusDiagnosticConfirmation")));
  assert.equal(openHandler.includes("statusDiagnosticRunner.run()"), false);
  assert.equal(cancelHandler.includes("statusDiagnosticRunner.run()"), false);
});

test("one-time diagnostic runner starts ready without sending a request", () => {
  const { createForthStatusDiagnosticRunner } = loadTypeScript("lib/forth-status-diagnostic-client.ts");
  let requests = 0;
  const runner = createForthStatusDiagnosticRunner({
    storage: { read: () => null, write: () => assert.fail("must not lock before request confirmation") },
    getAccessToken: async () => "session-token",
    fetcher: async () => { requests++; throw new Error("not expected"); },
    isValidResult: (value) => Boolean(value)
  });
  assert.equal(runner.isAttemptUsed(), false);
  assert.equal(requests, 0);
});

test("cancelling the in-page confirmation leaves the one-time request available", () => {
  const source = fs.readFileSync(path.join(root, "components/forth-tracking-centre.tsx"), "utf8");
  const openHandler = source.slice(source.indexOf("const openStatusDiagnosticConfirmation"), source.indexOf("const cancelStatusDiagnosticConfirmation"));
  const cancelHandler = source.slice(source.indexOf("const cancelStatusDiagnosticConfirmation"), source.indexOf("useEffect", source.indexOf("const cancelStatusDiagnosticConfirmation")));
  const confirmHandler = source.slice(source.indexOf("const runStatusDiagnostic"), source.indexOf("const openStatusDiagnosticConfirmation"));
  assert.ok(openHandler.includes("setStatusDiagnosticConfirmationOpen(true)"));
  assert.ok(cancelHandler.includes("setStatusDiagnosticConfirmationOpen(false)"));
  assert.ok(cancelHandler.includes("statusDiagnosticConfirmationReturnStateRef.current"));
  assert.equal(cancelHandler.includes("statusDiagnosticRunner.run()"), false);
  assert.ok(confirmHandler.includes("if (!statusDiagnosticConfirmationOpen || statusDiagnosticConfirmStartedRef.current) return"));
});

test("existing session lock prevents a repeat and is surfaced by the component", async () => {
  const { createForthStatusDiagnosticRunner } = loadTypeScript("lib/forth-status-diagnostic-client.ts");
  let authCalls = 0;
  let fetchCalls = 0;
  const runner = createForthStatusDiagnosticRunner({
    storage: { read: () => "1", write: () => assert.fail("must retain existing lock") },
    getAccessToken: async () => { authCalls++; return "session-token"; },
    fetcher: async () => { fetchCalls++; return Response.json({}); },
    isValidResult: (value) => Boolean(value)
  });
  assert.equal(runner.isAttemptUsed(), true);
  assert.deepEqual(await runner.run(), { kind: "failed", reason: "already_attempted", attemptUsed: true });
  assert.equal(authCalls, 0);
  assert.equal(fetchCalls, 0);
});

test("duplicate clicks produce one protected request and apply the lock at request initiation", async () => {
  const { createForthStatusDiagnosticRunner, FORTH_STATUS_DIAGNOSTIC_URL } = loadTypeScript("lib/forth-status-diagnostic-client.ts");
  let marker = null;
  let resolveToken;
  let fetchCalls = 0;
  const runner = createForthStatusDiagnosticRunner({
    storage: { read: () => marker, write: (value) => { marker = value; } },
    getAccessToken: () => new Promise((resolve) => { resolveToken = resolve; }),
    fetcher: async (url, init) => {
      fetchCalls++;
      assert.equal(url, FORTH_STATUS_DIAGNOSTIC_URL);
      assert.equal(init.method, "GET");
      assert.equal(init.cache, "no-store");
      assert.equal(new Headers(init.headers).get("authorization"), "Bearer test-session-token");
      assert.equal(marker, "1");
      return Response.json({ safe: true });
    },
    isValidResult: (value) => Boolean(value && value.safe === true)
  });
  const first = runner.run();
  const second = await runner.run();
  assert.deepEqual(second, { kind: "failed", reason: "duplicate", attemptUsed: false });
  assert.equal(fetchCalls, 0);
  assert.equal(marker, null);
  resolveToken("test-session-token");
  assert.deepEqual(await first, { kind: "completed", result: { safe: true } });
  assert.equal(fetchCalls, 1);
  assert.equal(marker, "1");
});

test("EES session failure sends no request and leaves the attempt available", async () => {
  const { createForthStatusDiagnosticRunner } = loadTypeScript("lib/forth-status-diagnostic-client.ts");
  let marker = null;
  let fetchCalls = 0;
  const runner = createForthStatusDiagnosticRunner({
    storage: { read: () => marker, write: (value) => { marker = value; } },
    getAccessToken: async () => null,
    fetcher: async () => { fetchCalls++; return Response.json({}); },
    isValidResult: (value) => Boolean(value)
  });
  assert.deepEqual(await runner.run(), { kind: "failed", reason: "session_unavailable", attemptUsed: false });
  assert.equal(runner.isAttemptUsed(), false);
  assert.equal(marker, null);
  assert.equal(fetchCalls, 0);
});

test("endpoint authentication and API failures are useful and never automatically retried", async () => {
  const { createForthStatusDiagnosticRunner } = loadTypeScript("lib/forth-status-diagnostic-client.ts");
  for (const [status, reason] of [[401, "unauthorized"], [403, "forbidden"], [503, "http_error"]]) {
    let marker = null;
    let fetchCalls = 0;
    const runner = createForthStatusDiagnosticRunner({
      storage: { read: () => marker, write: (value) => { marker = value; } },
      getAccessToken: async () => "session-token",
      fetcher: async () => { fetchCalls++; return new Response("ignored", { status }); },
      isValidResult: (value) => Boolean(value)
    });
    const first = await runner.run();
    assert.equal(first.kind, "failed");
    assert.equal(first.reason, reason);
    assert.equal(first.attemptUsed, true);
    assert.equal(runner.isAttemptUsed(), true);
    assert.deepEqual(await runner.run(), { kind: "failed", reason: "already_attempted", attemptUsed: true });
    assert.equal(fetchCalls, 1);
  }
});

test("successful diagnostic returns sanitized labels and the component displays label counts as text", async () => {
  const { createForthStatusDiagnosticRunner } = loadTypeScript("lib/forth-status-diagnostic-client.ts");
  const result = { labels: [{ label: "Vendor-A", occurrences: 2 }, { label: "Vendor-B", occurrences: 1 }] };
  const runner = createForthStatusDiagnosticRunner({
    storage: { read: () => null, write: () => undefined },
    getAccessToken: async () => "session-token",
    fetcher: async () => Response.json(result),
    isValidResult: (value) => Boolean(value && Array.isArray(value.labels))
  });
  assert.deepEqual(await runner.run(), { kind: "completed", result });
  const source = fs.readFileSync(path.join(root, "components/forth-tracking-centre.tsx"), "utf8");
  assert.ok(source.includes("statusDiagnostic.unknownPositionSourceStrings.labels.map"));
  assert.ok(source.includes("{entry.label}</code> · {entry.occurrences}"));
});

test("network and malformed-response failures consume the attempt without exposing error details", async () => {
  const { createForthStatusDiagnosticRunner } = loadTypeScript("lib/forth-status-diagnostic-client.ts");
  for (const [fetcher, reason] of [
    [async () => { throw new Error("network secret should not surface"); }, "network_error"],
    [async () => new Response("{", { status: 200 }), "invalid_response"]
  ]) {
    let marker = null;
    const runner = createForthStatusDiagnosticRunner({
      storage: { read: () => marker, write: (value) => { marker = value; } },
      getAccessToken: async () => "session-token",
      fetcher,
      isValidResult: (value) => Boolean(value && value.valid === true)
    });
    const outcome = await runner.run();
    assert.equal(outcome.kind, "failed");
    assert.equal(outcome.reason, reason);
    assert.equal(outcome.attemptUsed, true);
    assert.equal(JSON.stringify(outcome).includes("network secret"), false);
  }
});

test("dashboard separates reported activity, GPS confidence, diagnostics and existing request cadence", () => {
  const view = fs.readFileSync(path.join(root, "lib/forth-tracking-view.ts"), "utf8");
  const component = fs.readFileSync(path.join(root, "components/forth-tracking-centre.tsx"), "utf8");
  const map = fs.readFileSync(path.join(root, "components/forth-tracking-map.tsx"), "utf8");
  assert.ok(view.includes("getForthReportedActivity"));
  assert.ok(component.includes("summary.reportedActivity.driving"));
  assert.ok(component.includes("summary.reportedActivity.stopped"));
  assert.ok(component.includes("summary.reportedActivity.stoppedEngineOn"));
  assert.ok(component.includes("summary.positionConfidence.notGpsVerified"));
  assert.ok(component.includes("gpsConfidenceLabel(record, copy)"));
  assert.ok(component.includes("<ActivityPill activity={activity} copy={copy} />"));
  assert.ok(component.includes("summary.currentGpsVerifiedPositions"));
  assert.ok(component.includes("copy.mapConfidence"));
  assert.ok(component.includes("Reported driving · position not GPS-verified"));
  assert.ok(component.includes("ไม่มี GPS · ยังยืนยันตำแหน่งด้วย GPS ไม่ได้"));
  assert.ok(component.includes("value=\"driving\""));
  assert.ok(component.includes("value=\"stopped\""));
  assert.ok(component.includes("sortForthFleetRecords"));
  assert.ok(component.includes("<details className=\"rounded-2xl border border-slate-200 bg-white px-4 py-3 sm:px-5\">"));
  const diagnosticDetailsIndex = component.indexOf("<details className=\"rounded-2xl border border-slate-200 bg-white px-4 py-3 sm:px-5\">");
  assert.ok(component.lastIndexOf('{connected && can("business:read") ? (', diagnosticDetailsIndex) >= 0);
  assert.ok(map.includes("isForthGpsPositionVerified"));
  assert.ok(map.includes("activityLabel(activity, copy)"));
  assert.ok(component.includes("const POLL_INTERVAL_MS = 60_000;"));
  assert.ok(component.includes('can("business:read")'));
});

test("office accuracy review is protected in the UI and reuses the existing normalized fleet response", () => {
  const component = fs.readFileSync(path.join(root, "components/forth-tracking-centre.tsx"), "utf8");
  const server = fs.readFileSync(path.join(root, "lib/forth-tracking-server.ts"), "utf8");
  const panelStart = component.indexOf("{connected && can(\"business:read\") ? (", component.indexOf("accuracyTitle"));
  const panelEnd = component.indexOf("{connected && can(\"business:read\") ? (", panelStart + 1);
  assert.ok(panelStart >= 0);
  assert.ok(panelEnd > panelStart);
  const panel = component.slice(panelStart, panelEnd);
  assert.ok(panel.includes("getForthAccuracyComparisons(record, data.fetchedAt)"));
  assert.ok(panel.includes("getForthNormalizationWarnings(record)"));
  assert.ok(panel.includes("comparison.sourceField"));
  assert.ok(panel.includes("copy.accuracySourceColumn"));
  assert.ok(panel.includes("copy.accuracyNormalizedColumn"));
  assert.ok(panel.includes("copy.accuracyActivityNotMapped"));
  assert.equal(panel.includes("fetch("), false);
  assert.equal(panel.includes("createServerSupabaseAdmin"), false);
  assert.match(server, /sourceAudit:\s*record\.sourceAudit/);
  assert.equal(component.includes('const POLL_INTERVAL_MS = 60_000;'), true);
});

test("Fleet Tracking appears once in the permission-gated Fleet group used by desktop and mobile navigation", () => {
  const source = fs.readFileSync(path.join(root, "components/top-navigation.tsx"), "utf8");
  const fleetGroup = source.slice(source.indexOf('key: "fleet"'), source.indexOf('key: "fuel"'));
  assert.equal(source.split('href: "/fleet-tracking"').length - 1, 1);
  assert.ok(fleetGroup.includes('can("business:read")'));
  assert.ok(fleetGroup.includes('href: "/fleet-tracking"'));
  assert.equal(source.split("groups.map(").length - 1, 2);
  assert.ok(source.includes("routeIsActive(pathname, item.href)"));
});
