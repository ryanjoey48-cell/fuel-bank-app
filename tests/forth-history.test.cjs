const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");

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

const contracts = loadTypeScript("lib/forth-history-contract.ts");

test("journey request accepts only one device and one real calendar day", () => {
  assert.deepEqual(contracts.validateJourneyHistoryRequest({ deviceId: "500001", date: "2026-10-24", language: "th" }), {
    ok: true, deviceId: "500001", date: "2026-10-24", forthDate: "20261024", language: "th"
  });
  for (const invalid of [
    null,
    { deviceId: "500001,500002", date: "2026-10-24" },
    { deviceId: " 500001", date: "2026-10-24" },
    { deviceId: "500001", date: "2026-02-29" },
    { deviceId: "500001", date: "2024-02-29", extra: "ignored? no" },
    { deviceId: "500001", date: "2026-10-24", language: "fr" }
  ]) assert.equal(contracts.validateJourneyHistoryRequest(invalid).ok, false);
});

test("trip adapter keeps Forth source text raw and represents missing optional fields explicitly", () => {
  const result = contracts.parseForthTripsResponse([{
    boxId: "500001", plateNo: "1กข 2345", rDate: "20261024", arriveTime: "08:10",
    source: "Yard A", destination: "Site B", routingTime: "00:42", unusedPrivateField: "discard"
  }]);
  assert.equal(result.ok, true);
  assert.equal(result.records[0].arriveTime, "08:10");
  assert.equal(result.records[0].routingTime, "00:42");
  assert.equal(result.records[0].driver, null);
  assert.equal(Object.hasOwn(result.records[0], "unusedPrivateField"), false);
  assert.deepEqual(contracts.parseForthTripsResponse([{ routingTime: 42 }]), { ok: false, error: "invalid_response" });
  assert.deepEqual(contracts.parseForthTripsResponse({ records: [] }), { ok: false, error: "invalid_response" });
});

test("Trip Details and parking adapters retain source values without duration conversion", () => {
  const tripDetails = contracts.parseForthTripDetailsResponse([{ locationName: "Depot", duration: "00:15:00", arriveTime: "08:00" }]);
  const parking = contracts.parseForthParkingTripsResponse([{ parkingTime: "1.25", sumDistance: "12.4", maxSpeed: "71" }]);
  const engine = contracts.parseForthParkingEngineOverLimitResponse([{ parkingTime: "00:30", engineStatus: "On", latitude: "13.7" }]);
  assert.equal(tripDetails.ok, true);
  assert.equal(tripDetails.records[0].duration, "00:15:00");
  assert.equal(parking.ok, true);
  assert.equal(parking.records[0].parkingTime, "1.25");
  assert.equal(parking.records[0].sumDistance, "12.4");
  assert.equal(engine.ok, true);
  assert.equal(engine.records[0].latitude, "13.7");
});

class TestAdminApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function routeMocks({ requireUser, access = true, fleet, trips, counters }) {
  return {
    "next/server": { NextResponse: { json: (body, init = {}) => new Response(JSON.stringify(body), init) } },
    "@/lib/authorization": { hasPermission: (value) => value === true },
    "@/lib/admin-user-management-server": {
      AdminApiError: TestAdminApiError,
      requireVerifiedUser: requireUser ?? (async () => ({ id: "verified-user" })),
      createServerSupabaseAdmin: () => ({}),
      resolveAccountAccess: async () => access
    },
    "@/lib/forth-history-live-gate": { FORTH_HISTORY_LIVE_REQUESTS_ENABLED: false },
    "@/lib/forth-history-contract": contracts,
    "@/lib/forth-tracking-server": {
      getForthTrackingFleetData: async () => { counters.fleet += 1; return fleet; },
      getForthTripsReport: async (request) => { counters.report += 1; counters.request = request; return trips; }
    }
  };
}

function request(body = { deviceId: "500001", date: "2026-10-24" }) {
  return new Request("http://local.test/api/admin/forth-tracking/history/journeys", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

test("unauthorized and non-business requests are rejected before any Forth request", async () => {
  const counters = { fleet: 0, report: 0 };
  const authFailure = loadTypeScript("lib/forth-history-route.ts", routeMocks({
    requireUser: async () => { throw new TestAdminApiError(401, "Sign in required."); }, counters
  }));
  const unauthenticated = await authFailure.createJourneyHistoryPostHandler({ enabled: true })(request());
  assert.equal(unauthenticated.status, 401);

  const noBusinessAccess = loadTypeScript("lib/forth-history-route.ts", routeMocks({ access: false, counters }));
  const forbidden = await noBusinessAccess.createJourneyHistoryPostHandler({ enabled: true })(request());
  assert.equal(forbidden.status, 403);
  assert.deepEqual(counters, { fleet: 0, report: 0 });
});

test("default live history route fails closed without contacting Forth", async () => {
  const counters = { fleet: 0, report: 0 };
  const route = loadTypeScript("app/api/admin/forth-tracking/history/journeys/route.ts", routeMocks({ counters }));
  const response = await route.POST(request());
  assert.equal(response.status, 503);
  assert.deepEqual(counters, { fleet: 0, report: 0 });
  assert.equal(response.headers.get("cache-control"), "private, no-store");
});

test("enabled handler rejects arbitrary or duplicate device IDs before requesting a report", async () => {
  const counters = { fleet: 0, report: 0 };
  const route = loadTypeScript("lib/forth-history-route.ts", routeMocks({
    counters,
    fleet: { connectionStatus: "connected", error: null, records: [{ gpsDeviceId: "500001" }, { gpsDeviceId: "500001" }] },
    trips: { ok: true, payload: [] }
  }));
  const handler = route.createJourneyHistoryPostHandler({ enabled: true });
  const ambiguous = await handler(request());
  assert.equal(ambiguous.status, 409);
  assert.equal(counters.report, 0);
  const unmatched = await handler(request({ deviceId: "999999", date: "2026-10-24" }));
  assert.equal(unmatched.status, 404);
  assert.equal(counters.report, 0);
});

test("enabled journey handler sends only the validated one-device one-day report and returns raw fields", async () => {
  const counters = { fleet: 0, report: 0, request: null };
  const route = loadTypeScript("lib/forth-history-route.ts", routeMocks({
    counters,
    fleet: { connectionStatus: "connected", error: null, records: [{ gpsDeviceId: "500001" }] },
    trips: { ok: true, payload: [{ boxId: "500001", rDate: "20261024", arriveTime: "08:00", routingTime: "00:30" }] }
  }));
  const response = await route.createJourneyHistoryPostHandler({ enabled: true })(request({ deviceId: "500001", date: "2026-10-24", language: "en" }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(counters.request, { deviceId: "500001", forthDate: "20261024", language: "en" });
  const payload = await response.json();
  assert.equal(payload.records[0].arriveTime, "08:00");
  assert.equal(payload.records[0].routingTime, "00:30");
  assert.equal(payload.records[0].destination, null);
});

test("existing token service uses a fixed report URL and never returns raw credentials or upstream error bodies", async () => {
  const { createForthTrackingService } = loadTypeScript("lib/forth-tracking-server.ts", {
    "@/lib/forth-tracking": { normalizeForthTrackingResponse: () => [] },
    "@/lib/forth-tracking-view": { summarizeForthFleet: () => ({}) }
  });
  const calls = [];
  const service = createForthTrackingService({
    environment: {
      FORTH_CLIENT_ID: "test-client-id", FORTH_CLIENT_SECRET: "test-client-secret",
      FORTH_USERNAME: "test-user", FORTH_PASSWORD: "test-password", FORTH_TOKEN_REQUEST_PROFILE: "oauth-password-basic-v1"
    },
    fetcher: async (url, init) => {
      calls.push({ url: String(url), init });
      if (calls.length === 1) return Response.json({ access_token: "test-access-token", token_type: "Bearer", expires_in: 3600 });
      return Response.json([{ boxId: "500001", arriveTime: "08:00" }]);
    },
    now: () => Date.parse("2026-10-24T00:00:00Z")
  });
  const invalid = await service.getTripsReport({ deviceId: "500001,500002", forthDate: "20260230", language: "en" });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.status, 400);
  assert.equal(calls.length, 0);
  const result = await service.getTripsReport({ deviceId: "500001", forthDate: "20261024", language: "en" });
  assert.equal(result.ok, true);
  assert.equal(calls[1].url, "https://webapi.forthtrack.com/trackingresource/api/vehicle/trips");
  assert.equal(calls[1].init.method, "POST");
  assert.equal(calls[1].init.cache, "no-store");
  assert.equal(calls[1].init.redirect, "error");
  assert.equal(calls[1].init.headers.Authorization, "Bearer test-access-token");
  assert.deepEqual(JSON.parse(calls[1].init.body), { boxIds: "500001", startDate: "20261024", endDate: "20261024", language: "en" });
  assert.equal(JSON.stringify(result).includes("test-password"), false);
  assert.equal(JSON.stringify(result).includes("test-access-token"), false);

  const rejected = createForthTrackingService({
    environment: {
      FORTH_CLIENT_ID: "test-client-id", FORTH_CLIENT_SECRET: "test-client-secret",
      FORTH_USERNAME: "test-user", FORTH_PASSWORD: "test-password", FORTH_TOKEN_REQUEST_PROFILE: "oauth-password-basic-v1"
    },
    fetcher: async (url) => String(url).endsWith("/token")
      ? Response.json({ access_token: "test-access-token", expires_in: 3600 })
      : new Response("private upstream detail", { status: 403 })
  });
  const denied = await rejected.getTripsReport({ deviceId: "500001", forthDate: "20261024", language: "en" });
  assert.equal(denied.ok, false);
  assert.equal(denied.error.code, "report_auth_rejected");
  assert.equal(JSON.stringify(denied).includes("private upstream detail"), false);
});
