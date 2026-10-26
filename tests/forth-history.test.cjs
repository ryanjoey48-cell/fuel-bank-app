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

test("controlled runner requires approvals, exact identity and an atomic claim before a single attempt", async () => {
  const { runControlledHistoryTest } = loadTypeScript("lib/forth-history-controlled-test.ts");
  const now = Date.parse("2026-10-26T10:00:00Z");
  const grant = { id: "synthetic-grant", operatorId: "operator", deploymentId: "preview-id", deviceId: "500001", registration: "3ฒน-9565", date: "2026-10-24", expiresAt: now + 60000, providerApprovalReference: "synthetic-provider-approval", executionApprovalReference: "synthetic-owner-approval" };
  const context = { environment: "preview", deploymentId: "preview-id", grantId: grant.id };
  let consumed = false, reports = 0;
  const deps = {
    now: () => now,
    verifyOfficeUser: async () => ({ id: "operator", businessRead: true }),
    readGrant: async () => grant,
    consumeGrant: async () => { if (consumed) return false; consumed = true; return true; },
    getFleet: async () => ({ connectionStatus: "connected", error: null, records: [{ gpsDeviceId: "500001", vehicleRegistration: "3ฒน-9565" }] }),
    getTrips: async () => { reports++; return { ok: true, payload: [{ boxId: "500001", driver: "Private name", routingTime: "unknown unit" }] }; }
  };
  for (const changed of [{ environment: "production" }, { deploymentId: "other" }]) {
    assert.equal((await runControlledHistoryTest({ ...context, ...changed }, deps)).ok, false);
  }
  for (const changed of [{ operatorId: "other" }, { providerApprovalReference: "" }, { executionApprovalReference: "" }, { date: "2026-10-25" }, { expiresAt: now }]) {
    assert.equal((await runControlledHistoryTest(context, { ...deps, readGrant: async () => ({ ...grant, ...changed }) })).ok, false);
  }
  assert.equal((await runControlledHistoryTest(context, { ...deps, verifyOfficeUser: async () => ({ id: "operator", businessRead: false }) })).ok, false);
  for (const records of [[{ gpsDeviceId: "500001", vehicleRegistration: "other" }], [{ gpsDeviceId: "500001", vehicleRegistration: grant.registration }, { gpsDeviceId: "500001", vehicleRegistration: grant.registration }]]) {
    assert.equal((await runControlledHistoryTest(context, { ...deps, getFleet: async () => ({ connectionStatus: "connected", error: null, records }) })).ok, false);
  }
  assert.equal(reports, 0);
  const results = await Promise.all([runControlledHistoryTest(context, deps), runControlledHistoryTest(context, deps)]);
  assert.equal(reports, 1);
  const success = results.find(result => result.ok);
  assert.equal(success.records[0].routingTime, "unknown unit");
  assert.equal(Object.hasOwn(success.records[0], "driver"), false);
  consumed = false;
  const failing = { ...deps, getTrips: async () => { reports++; throw new Error("private upstream detail"); } };
  assert.equal((await runControlledHistoryTest(context, failing)).code, "test_unavailable");
  assert.equal((await runControlledHistoryTest(context, failing)).code, "grant_unavailable");
  assert.equal(reports, 2);
});

test("proposed Preview scope fails closed outside the exact branch and short test window", () => {
  const preview = loadTypeScript("lib/forth-history-preview-test.ts", {
    "@/lib/forth-history-contract": contracts,
    "@/lib/forth-tracking": { normalizeForthRegistration: (value) => (value ?? "").replace(/[\s-]/g, "").toUpperCase() }
  });
  const now = Date.parse("2026-10-26T10:00:00Z");
  const environment = {
    VERCEL_ENV: "preview",
    VERCEL_GIT_COMMIT_REF: "codex/fleet-tracking-v2-history-integration",
    FORTH_HISTORY_PREVIEW_TEST_ENABLED: "true",
    FORTH_HISTORY_PREVIEW_TEST_USER_ID: "11111111-1111-4111-8111-111111111111",
    FORTH_HISTORY_PREVIEW_TEST_DEVICE_ID: "500001",
    FORTH_HISTORY_PREVIEW_TEST_REGISTRATION: "3ฒน-9565",
    FORTH_HISTORY_PREVIEW_TEST_DATE: "2026-10-24",
    FORTH_HISTORY_PREVIEW_TEST_EXPIRES_AT: "2026-10-26T10:10:00Z"
  };
  assert.deepEqual(preview.resolveForthHistoryPreviewTestScope(environment, now), {
    userId: environment.FORTH_HISTORY_PREVIEW_TEST_USER_ID,
    deviceId: "500001", date: "2026-10-24", registration: "3ฒน-9565"
  });
  assert.equal(preview.resolveForthHistoryPreviewTestScope({ ...environment, VERCEL_ENV: "production" }, now), null);
  assert.equal(preview.resolveForthHistoryPreviewTestScope({ ...environment, VERCEL_GIT_COMMIT_REF: "main" }, now), null);
  assert.equal(preview.resolveForthHistoryPreviewTestScope({ ...environment, FORTH_HISTORY_PREVIEW_TEST_ENABLED: "false" }, now), null);
  assert.equal(preview.resolveForthHistoryPreviewTestScope({ ...environment, FORTH_HISTORY_PREVIEW_TEST_EXPIRES_AT: "2026-10-26T10:30:00Z" }, now), null);
  assert.equal(preview.resolveForthHistoryPreviewTestScope(environment, Date.parse("2026-10-26T10:11:00Z")), null);
});

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
  assert.deepEqual(contracts.parseForthTripsResponse([]), { ok: true, records: [] });
  assert.deepEqual(contracts.parseForthTripsResponse([null]), { ok: false, error: "invalid_response" });
  assert.deepEqual(contracts.parseForthTripsResponse([{ boxId: "500001", rDate: "20261024", routingTime: "unknown unit" }]).records[0].routingTime, "unknown unit");
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

test("enabled handler rejects malformed, oversized and unexpected request bodies before the fleet lookup", async () => {
  const counters = { fleet: 0, report: 0 };
  const route = loadTypeScript("lib/forth-history-route.ts", routeMocks({ counters }));
  const handler = route.createJourneyHistoryPostHandler({ enabled: true });
  const requests = [
    new Request("http://local.test/history", { method: "POST", headers: { "Content-Type": "text/plain" }, body: "{}" }),
    new Request("http://local.test/history", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" }),
    new Request("http://local.test/history", { method: "POST", headers: { "Content-Type": "application/json" }, body: "x".repeat(8193) })
  ];
  const statuses = [415, 400, 413];
  for (let index = 0; index < requests.length; index += 1) {
    const response = await handler(requests[index]);
    assert.equal(response.status, statuses[index]);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  }
  assert.deepEqual(counters, { fleet: 0, report: 0 });
});

test("enabled journey handler sends only the validated one-device one-day report and returns raw fields", async () => {
  const counters = { fleet: 0, report: 0, request: null };
  const route = loadTypeScript("lib/forth-history-route.ts", routeMocks({
    counters,
    fleet: { connectionStatus: "connected", error: null, records: [{ gpsDeviceId: "500001" }] },
    trips: { ok: true, payload: [{ boxId: "500001", driver: "Private driver", rDate: "20261024", arriveTime: "08:00", routingTime: "00:30" }] }
  }));
  const response = await route.createJourneyHistoryPostHandler({ enabled: true })(request({ deviceId: "500001", date: "2026-10-24", language: "en" }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(counters.request, { deviceId: "500001", forthDate: "20261024", language: "en" });
  const payload = await response.json();
  assert.equal(payload.records[0].arriveTime, "08:00");
  assert.equal(payload.records[0].routingTime, "00:30");
  assert.equal(payload.records[0].destination, null);
  assert.equal(Object.hasOwn(payload.records[0], "driver"), false);
});

test("journey route rejects a returned record for another or unidentified device", async () => {
  for (const boxId of ["500002", undefined]) {
    const counters = { fleet: 0, report: 0 };
    const route = loadTypeScript("lib/forth-history-route.ts", routeMocks({
      counters,
      fleet: { connectionStatus: "connected", error: null, records: [{ gpsDeviceId: "500001" }] },
      trips: { ok: true, payload: [{ boxId, driver: "Private driver", source: "Depot" }] }
    }));
    const response = await route.createJourneyHistoryPostHandler({ enabled: true })(request());
    assert.equal(response.status, 502);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(JSON.stringify(await response.json()).includes("Private driver"), false);
  }
});

test("journey route preserves an empty report and rejects malformed report objects", async () => {
  for (const [payload, status] of [[[], 200], [{ records: [] }, 502], [[null], 502]]) {
    const counters = { fleet: 0, report: 0 };
    const route = loadTypeScript("lib/forth-history-route.ts", routeMocks({
      counters,
      fleet: { connectionStatus: "connected", error: null, records: [{ gpsDeviceId: "500001" }] },
      trips: { ok: true, payload }
    }));
    const response = await route.createJourneyHistoryPostHandler({ enabled: true })(request());
    assert.equal(response.status, status);
    assert.equal(counters.report, 1);
    if (status === 200) assert.deepEqual((await response.json()).records, []);
  }
});

function mockHistoryService(reportResponse) {
  const { createForthTrackingService } = loadTypeScript("lib/forth-tracking-server.ts", {
    "@/lib/forth-tracking": { normalizeForthTrackingResponse: () => [] },
    "@/lib/forth-tracking-view": { summarizeForthFleet: () => ({}) }
  });
  let calls = 0;
  const service = createForthTrackingService({
    environment: {
      FORTH_CLIENT_ID: "synthetic-client", FORTH_CLIENT_SECRET: "synthetic-secret",
      FORTH_USERNAME: "synthetic-user", FORTH_PASSWORD: "synthetic-password",
      FORTH_TOKEN_REQUEST_PROFILE: "oauth-password-basic-v1"
    },
    fetcher: async () => {
      calls += 1;
      if (calls === 1) return Response.json({ access_token: "synthetic-token", expires_in: 3600 });
      return typeof reportResponse === "function" ? reportResponse() : reportResponse;
    }
  });
  return { service, getCalls: () => calls };
}

test("report service rejects unexpected content types and malformed JSON without exposing the body", async () => {
  for (const response of [
    new Response('[{"boxId":"500001"}]', { headers: { "Content-Type": "text/html" } }),
    new Response('[{"boxId":"500001"}]'),
    new Response("private invalid body", { headers: { "Content-Type": "application/json" } })
  ]) {
    const { service, getCalls } = mockHistoryService(response);
    const result = await service.getTripsReport({ deviceId: "500001", forthDate: "20261024", language: "en" });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "invalid_response");
    assert.equal(JSON.stringify(result).includes("private invalid body"), false);
    assert.equal(getCalls(), 2);
  }
  const { service } = mockHistoryService(new Response("[]", { headers: { "Content-Type": "text/json; charset=utf-8" } }));
  assert.deepEqual((await service.getTripsReport({ deviceId: "500001", forthDate: "20261024", language: "th" })).payload, []);
});

test("report service bounds responses without relying on Content-Length", async () => {
  const { service } = mockHistoryService(new Response("x".repeat(1_000_001), {
    headers: { "Content-Type": "application/json" }
  }));
  const result = await service.getTripsReport({ deviceId: "500001", forthDate: "20261024", language: "en" });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "response_too_large");
});

test("report service treats a synthetic fetch timeout as unavailable and never retries", async () => {
  const { service, getCalls } = mockHistoryService(() => { throw new DOMException("synthetic timeout", "TimeoutError"); });
  const result = await service.getTripsReport({ deviceId: "500001", forthDate: "20261024", language: "en" });
  assert.equal(result.ok, false);
  assert.equal(result.status, 503);
  assert.equal(result.error.code, "report_network_error");
  assert.equal(getCalls(), 2);
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
