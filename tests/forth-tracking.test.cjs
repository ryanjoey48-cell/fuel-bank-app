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
  assert.equal(record.positionStatus, "gps");
  assert.equal(record.optionalSensors.sensor1, "available");
  assert.equal(Object.hasOwn(record, "IDCard"), false);
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

test("returns only a safe text driver label and omits identifier-like values", () => {
  const [name, identifier] = normalizeForthTrackingResponse([
    { driver: "Driver A" },
    { driver: "Driver 12345" }
  ], { now: baseNow });
  assert.equal(name.reportedDriver, "Driver A");
  assert.equal(identifier.reportedDriver, null);
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
  assert.equal(ambiguous.positionStatus, "non_gps");
  assert.equal(noGps.gpsConnectivity, "disconnected");
  assert.equal(lostGps.gpsConnectivity, "disconnected");
  assert.equal(lostGps.positionStatus, "non_gps");
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
      { Latitude: 13.7, Longitude: 100.5, dateTime: "2026-10-21T04:55:00Z" },
      { Latitude: "bad", Longitude: 100.5, dateTime: "2026-10-21T04:50:00Z" },
      { Latitude: 13.7, Longitude: null }
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
  assert.equal(result.records[0].sourceTimestampRaw, "2026-10-21 11:55:00");
  assert.equal(result.records[0].lastGpsTimestamp, "2026-10-21T04:55:00.000Z");
  assert.equal(result.fetchedAt, "2026-10-21T05:00:00.000Z");
  assert.equal(Object.hasOwn(result.records[0], "optionalSensors"), false);
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

test("fleet view classification and filters use current GPS data and avoid inferring movement", () => {
  const { getForthFleetStatus, summarizeForthFleet, filterForthFleetRecords, formatForthTrackingTime } = loadTypeScript("lib/forth-tracking-view.ts");
  const records = [
    { vehicleRegistration: "MOVING-1", reportedDriver: "Driver A", gpsDeviceId: "D1", gpsConnectivity: "connected", gprsConnectivity: "connected", timestampStatus: "current", coordinateStatus: "valid", positionStatus: "unknown", speed: 12, lastGpsTimestamp: "2026-10-21T04:59:00.000Z" },
    { vehicleRegistration: "PARKED-1", gpsDeviceId: "D2", gpsConnectivity: "connected", gprsConnectivity: "connected", timestampStatus: "current", coordinateStatus: "valid", positionStatus: "gps", speed: 0, lastGpsTimestamp: "2026-10-21T04:58:00.000Z" },
    { vehicleRegistration: "STALE-1", gpsDeviceId: "D3", gpsConnectivity: "connected", gprsConnectivity: "connected", timestampStatus: "stale", coordinateStatus: "valid", positionStatus: "gps", speed: 50, lastGpsTimestamp: "2026-10-20T04:58:00.000Z" },
    { vehicleRegistration: "UNKNOWN-1", gpsDeviceId: "D4", gpsConnectivity: "unknown", gprsConnectivity: "unknown", timestampStatus: "missing", coordinateStatus: "missing", positionStatus: "unknown", speed: null, lastGpsTimestamp: null }
  ];

  assert.deepEqual(records.map(getForthFleetStatus), ["moving", "parked", "offline_stale", "unknown"]);
  assert.deepEqual(summarizeForthFleet(records), { total: 4, moving: 1, parked: 1, offline_stale: 1, unknown: 1, lastUpdate: "2026-10-21T04:59:00.000Z" });
  assert.equal(filterForthFleetRecords(records, "driver a", "all").length, 1);
  assert.equal(filterForthFleetRecords(records, "", "parked")[0].vehicleRegistration, "PARKED-1");
  const formattedTime = formatForthTrackingTime("2026-10-21T04:59:00.000Z", "en");
  const zoneLabel = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZoneName: "short", hourCycle: "h23" })
    .formatToParts(new Date("2026-10-21T04:59:00.000Z"))
    .find((part) => part.type === "timeZoneName").value;
  assert.ok(formattedTime.includes(zoneLabel));
});

test("classifies lost, stale, ambiguous, invalid, and incomplete GPS records safely", () => {
  const { getForthFleetStatus, summarizeForthFleet } = loadTypeScript("lib/forth-tracking-view.ts");
  const base = {
    gpsConnectivity: "connected",
    gprsConnectivity: "connected",
    timestampStatus: "current",
    coordinateStatus: "valid",
    positionStatus: "gps",
    speed: 10,
    latitude: 13.7,
    longitude: 100.5,
    lastGpsTimestamp: "2026-10-21T04:59:00.000Z"
  };
  const records = [
    { ...base },
    { ...base, gpsConnectivity: "disconnected" },
    { ...base, timestampStatus: "stale", speed: 40, lastGpsTimestamp: "2026-10-21T04:00:00.000Z" },
    { ...base, timestampStatus: "timezone_unconfigured", lastGpsTimestamp: null },
    { ...base, coordinateStatus: "missing", latitude: null },
    { ...base, coordinateStatus: "invalid", latitude: null },
    { ...base, speed: null },
    { ...base, speed: -1 },
    { ...base, speed: Number.NaN },
    { ...base, positionStatus: "non_gps" }
  ];

  assert.deepEqual(records.map(getForthFleetStatus), [
    "moving", "offline_stale", "offline_stale", "unknown", "unknown",
    "unknown", "unknown", "unknown", "unknown", "unknown"
  ]);
  assert.equal(summarizeForthFleet(records).lastUpdate, "2026-10-21T04:59:00.000Z");
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
  assert.equal(mapped[0].key, "GPS-1:0");
});

test("Leaflet map builds visible status markers above tiles, fits locations, and focuses selection", () => {
  const source = fs.readFileSync(path.join(root, "components/forth-tracking-map.tsx"), "utf8");
  const styles = fs.readFileSync(path.join(root, "components/forth-tracking-map.module.css"), "utf8");
  assert.ok(source.includes('import "leaflet/dist/leaflet.css"'));
  assert.ok(source.includes("Leaflet.divIcon("));
  assert.ok(source.includes("Leaflet.marker(position"));
  assert.ok(source.includes('setProperty("z-index", "650")'));
  assert.ok(source.includes('setProperty("z-index", "200")'));
  assert.ok(source.includes("map.fitBounds("));
  assert.ok(source.includes("map.panTo(position"));
  assert.ok(source.includes("setZIndexOffset(selected ? 1000 : 0)"));
  assert.ok(styles.includes(".mapCanvas :global(.leaflet-pane.leaflet-marker-pane)"));
  assert.ok(styles.includes(".vehicleMarkerDot"));
  assert.ok(styles.includes(".vehicleMarkerSelected"));
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
