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

const {
  getBangkokRouteDeparture,
  parseGoogleDurationSeconds,
  selectRouteWithFallback,
  selectFastestPracticalRoute
} = loadTypeScriptModule("lib/route-planning.ts");

test("route selection ignores SHORTER_DISTANCE and keeps distance and duration from the same fastest route", () => {
  const shorter = {
    distanceMeters: 8000,
    duration: "1200s",
    staticDuration: "780s",
    routeLabels: ["SHORTER_DISTANCE"]
  };
  const recommended = {
    distanceMeters: 13600,
    duration: "1020s",
    staticDuration: "900s",
    routeLabels: ["DEFAULT_ROUTE"]
  };
  const selected = selectFastestPracticalRoute([shorter, recommended]);
  assert.equal(selected, recommended);
  assert.equal(selected.distanceMeters, 13600);
  assert.equal(parseGoogleDurationSeconds(selected.duration), 1020);
});

test("route selection falls back when the only valid route is SHORTER_DISTANCE", () => {
  const shorterOnly = {
    distanceMeters: 8200,
    duration: "1100s",
    staticDuration: "760s",
    routeLabels: ["SHORTER_DISTANCE"]
  };
  const result = selectRouteWithFallback([shorterOnly]);
  assert.equal(result.selectedRoute, shorterOnly);
  assert.equal(result.validRoutes.length, 1);
  assert.equal(result.fallbackRouteUsed, true);
  assert.equal(result.fallbackReason, "only_shorter_distance_routes_available");
  assert.equal(selectFastestPracticalRoute([shorterOnly]), shorterOnly);
});

test("route selection uses fastest valid route and ignores invalid route payloads", () => {
  const missingDistance = { duration: "600s", routeLabels: ["DEFAULT_ROUTE"] };
  const missingDuration = { distanceMeters: 3000, routeLabels: ["DEFAULT_ROUTE"] };
  const slower = { distanceMeters: 10000, duration: "1200s", routeLabels: ["DEFAULT_ROUTE"] };
  const fastest = { distanceMeters: 18000, duration: "900s", routeLabels: ["DEFAULT_ROUTE_ALTERNATE"] };
  const result = selectRouteWithFallback([missingDistance, slower, missingDuration, fastest]);
  assert.equal(result.selectedRoute, fastest);
  assert.equal(result.validRoutes.length, 2);
  assert.equal(result.fallbackRouteUsed, false);
});

test("route selection returns null when Google returns no usable routes", () => {
  assert.deepEqual(selectRouteWithFallback([]), {
    selectedRoute: null,
    validRoutes: [],
    fallbackRouteUsed: false,
    fallbackReason: null
  });
  assert.equal(selectRouteWithFallback([{ distanceMeters: 0, duration: "600s" }]).selectedRoute, null);
});

test("traffic-aware duration is the selection key and DEFAULT_ROUTE wins equal-duration ties", () => {
  const defaultRoute = { distanceMeters: 14000, duration: "900s", routeLabels: ["DEFAULT_ROUTE"] };
  const equalAlternative = { distanceMeters: 12000, duration: "900s", routeLabels: ["DEFAULT_ROUTE_ALTERNATE"] };
  const slowerShortRoute = { distanceMeters: 7000, duration: "1100s", routeLabels: ["DEFAULT_ROUTE_ALTERNATE"] };
  assert.equal(selectFastestPracticalRoute([equalAlternative, defaultRoute, slowerShortRoute]), defaultRoute);
});

test("future Bangkok booking time converts to RFC 3339 UTC while past and invalid values use current traffic", () => {
  const now = new Date("2026-07-21T00:00:00.000Z");
  assert.deepEqual(getBangkokRouteDeparture("2026-07-22", "08:30", now), {
    departureTime: "2026-07-22T01:30:00.000Z",
    timeBasis: "planned_departure"
  });
  assert.deepEqual(getBangkokRouteDeparture("2026-07-20", "08:30", now), {
    departureTime: null,
    timeBasis: "current_traffic"
  });
  assert.deepEqual(getBangkokRouteDeparture("2026-02-30", "08:30", now), {
    departureTime: null,
    timeBasis: "current_traffic"
  });
});

test("shared API requests Routes v2 traffic-aware optimal without distance sorting", () => {
  const api = fs.readFileSync(path.resolve("app/api/distance-estimate/route.ts"), "utf8");
  assert.match(api, /routes\.googleapis\.com\/directions\/v2:computeRoutes/);
  assert.match(api, /routingPreference: "TRAFFIC_AWARE_OPTIMAL"/);
  assert.match(api, /trafficModel: "BEST_GUESS"/);
  assert.match(api, /computeAlternativeRoutes: intermediates\.length === 0/);
  assert.match(api, /regionCode: "TH"/);
  assert.match(api, /units: "METRIC"/);
  assert.match(api, /routes\.distanceMeters/);
  assert.match(api, /routes\.staticDuration/);
  assert.match(api, /fallbackInfo/);
  assert.doesNotMatch(api, /maps\.googleapis\.com\/maps\/api\/directions/);
  assert.doesNotMatch(api, /sort\([^)]*distance/i);
});

test("route metadata migration is idempotent for Booking Diary and Trip Journey", () => {
  const migration = fs.readFileSync(path.resolve("supabase/migrations/20260721130000_add_route_quality_metadata.sql"), "utf8");
  for (const table of ["booking_diary", "trip_journeys"]) {
    assert.match(migration, new RegExp(`alter table if exists public\\.${table}`));
  }
  for (const column of [
    "route_distance_meters",
    "route_duration_seconds",
    "route_static_duration_seconds",
    "route_calculated_at",
    "route_departure_time",
    "route_preference",
    "route_label",
    "route_description",
    "route_polyline",
    "route_traffic_aware",
    "route_source",
    "route_fallback_info"
  ]) {
    assert.match(migration, new RegExp(`add column if not exists ${column}`));
  }
  assert.doesNotMatch(migration, /update\s+public\.booking_diary|delete\s+from\s+public\.booking_diary/i);
});

test("both route consumers send schedule context and persist one exact route snapshot", () => {
  const booking = fs.readFileSync(path.resolve("app/(dashboard)/booking-diary/page.tsx"), "utf8");
  const trip = fs.readFileSync(path.resolve("app/(dashboard)/trip-journey/page.tsx"), "utf8");
  const data = fs.readFileSync(path.resolve("lib/data.ts"), "utf8");
  for (const page of [booking, trip]) {
    assert.match(page, /bookingDate:/);
    assert.match(page, /pickupTime:/);
    assert.match(page, /route_distance_meters/);
    assert.match(page, /route_duration_seconds/);
    assert.match(page, /route_static_duration_seconds/);
    assert.match(page, /route_traffic_aware/);
    assert.match(page, /Refresh route/);
    assert.match(page, /รีเฟรชเส้นทาง/);
    assert.match(page, /setTimeout\(\(\) => \{[\s\S]*900\)/);
  }
  assert.match(data, /route_distance_meters:\s*parseOptionalNumeric\(booking\.route_distance_meters\)/);
  assert.match(data, /route_duration_seconds:\s*parseOptionalNumeric\(booking\.route_duration_seconds\)/);
});
