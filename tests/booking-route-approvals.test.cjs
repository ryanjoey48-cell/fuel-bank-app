const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

function loadTypeScriptModule(relativePath, mocks = {}) {
  const filename = path.resolve(relativePath);
  const source = fs.readFileSync(filename, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  loaded.require = (request) => mocks[request] ?? Module.prototype.require.call(loaded, request);
  loaded._compile(compiled, filename);
  return loaded.exports;
}

const bookingMapsModule = loadTypeScriptModule("lib/booking-maps-backfill.ts");
const routeApprovalModule = loadTypeScriptModule("lib/booking-route-approvals.ts", {
  "@/lib/admin-user-management-server": {
    AdminApiError: class AdminApiError extends Error {
      constructor(status, message) {
        super(message);
        this.status = status;
      }
    }
  },
  "@/lib/booking-maps-backfill": bookingMapsModule
});

const { buildRouteApprovalQueueFromRows, normalizeRouteApprovalName } = routeApprovalModule;

function value(overrides, key, fallback) {
  return Object.prototype.hasOwnProperty.call(overrides, key) ? overrides[key] : fallback;
}

function booking(overrides = {}) {
  return {
    id: value(overrides, "id", "booking-1"),
    booking_id: value(overrides, "booking_id", null),
    booking_date: value(overrides, "booking_date", "2026-08-01"),
    job_order_number: value(overrides, "job_order_number", null),
    pickup: value(overrides, "pickup", " Warehouse A "),
    dropoff: value(overrides, "dropoff", "Port B"),
    pickup_address: value(overrides, "pickup_address", "Warehouse A, Bangkok"),
    dropoff_address: value(overrides, "dropoff_address", "Port B, Bangkok"),
    pickup_place_id: value(overrides, "pickup_place_id", "pickup-place"),
    dropoff_place_id: value(overrides, "dropoff_place_id", "dropoff-place"),
    pickup_lat: value(overrides, "pickup_lat", 13.7),
    pickup_lng: value(overrides, "pickup_lng", 100.5),
    dropoff_lat: value(overrides, "dropoff_lat", 13.8),
    dropoff_lng: value(overrides, "dropoff_lng", 100.6),
    estimated_distance_km: value(overrides, "estimated_distance_km", 25),
    route_distance_meters: value(overrides, "route_distance_meters", 25000),
    google_maps_route_url: value(overrides, "google_maps_route_url", null),
    approved_route_id: value(overrides, "approved_route_id", null),
    route_confirmation_status: value(overrides, "route_confirmation_status", null),
    driver: value(overrides, "driver", "Driver"),
    vehicle: value(overrides, "vehicle", "6W"),
    vehicle_registration: value(overrides, "vehicle_registration", "70-1234"),
    client: value(overrides, "client", { name: "Client A" })
  };
}

test("repeat route approval queue groups only matching normalized pickup and drop-off names", () => {
  const queue = buildRouteApprovalQueueFromRows([
    booking({ id: "a", booking_date: "2026-08-01", pickup: " Warehouse A ", dropoff: "Port B" }),
    booking({ id: "b", booking_date: "2026-08-02", pickup: "warehouse   a", dropoff: " PORT B " }),
    booking({ id: "c", booking_date: "2026-08-03", pickup: "Warehouse A", dropoff: "Port C" }),
    booking({ id: "d", booking_date: "2026-08-04", pickup: "Warehouse A", dropoff: "Port C" })
  ], []);

  assert.equal(queue.routes.length, 2);
  assert.deepEqual(queue.routes.map((route) => route.bookingCount), [2, 2]);
  assert.notEqual(queue.routes[0].normalizedDropoff, queue.routes[1].normalizedDropoff);
});

test("google maps matches stay pending until a stored route approval exists", () => {
  const normalizedPickup = normalizeRouteApprovalName("Warehouse A");
  const normalizedDropoff = normalizeRouteApprovalName("Port B");
  const pending = buildRouteApprovalQueueFromRows([
    booking({ id: "a", booking_date: "2026-08-01" }),
    booking({ id: "b", booking_date: "2026-08-02" })
  ], []);

  assert.equal(pending.routes[0].mapsStatus, "matched");
  assert.equal(pending.routes[0].status, "pending");
  assert.equal(pending.summary.repeatRoutesConfirmed, 0);

  const approved = buildRouteApprovalQueueFromRows(pending.routes[0].bookings.map((row) => booking({
    id: row.id,
    booking_date: row.bookingDate,
    approved_route_id: "approval-1",
    route_confirmation_status: "confirmed"
  })), [{
    id: "approval-1",
    normalized_pickup: normalizedPickup,
    normalized_dropoff: normalizedDropoff,
    display_pickup: "Warehouse A",
    display_dropoff: "Port B",
    pickup_canonical_name: "Warehouse A",
    pickup_formatted_address: "Warehouse A, Bangkok",
    pickup_place_id: "pickup-place",
    pickup_lat: 13.7,
    pickup_lng: 100.5,
    dropoff_canonical_name: "Port B",
    dropoff_formatted_address: "Port B, Bangkok",
    dropoff_place_id: "dropoff-place",
    dropoff_lat: 13.8,
    dropoff_lng: 100.6,
    google_distance_km: 25,
    route_distance_meters: 25000,
    google_maps_route_url: null,
    status: "confirmed",
    approved_at: "2026-08-26T00:00:00.000Z",
    approved_by: "admin-1"
  }]);

  assert.equal(approved.routes[0].status, "confirmed");
  assert.equal(approved.summary.repeatRoutesConfirmed, 1);
  assert.equal(approved.summary.bookingsCoveredByConfirmedRoutes, 2);
});

test("missing maps data marks repeat routes as needing review", () => {
  const queue = buildRouteApprovalQueueFromRows([
    booking({ id: "a", booking_date: "2026-08-01", dropoff_place_id: null }),
    booking({ id: "b", booking_date: "2026-08-02", dropoff_place_id: null })
  ], []);

  assert.equal(queue.routes[0].status, "needs_review");
  assert.match(queue.routes[0].needsReviewReasons.join(" "), /Drop-off Maps location/);
  assert.equal(queue.summary.needsReview, 1);
});

test("reopened route approvals stop counting as confirmed", () => {
  const queue = buildRouteApprovalQueueFromRows([
    booking({ id: "a", booking_date: "2026-08-01", approved_route_id: "approval-1", route_confirmation_status: "reopened" }),
    booking({ id: "b", booking_date: "2026-08-02", approved_route_id: "approval-1", route_confirmation_status: "reopened" })
  ], [{
    id: "approval-1",
    normalized_pickup: normalizeRouteApprovalName("Warehouse A"),
    normalized_dropoff: normalizeRouteApprovalName("Port B"),
    display_pickup: "Warehouse A",
    display_dropoff: "Port B",
    pickup_canonical_name: "Warehouse A",
    pickup_formatted_address: "Warehouse A, Bangkok",
    pickup_place_id: "pickup-place",
    pickup_lat: 13.7,
    pickup_lng: 100.5,
    dropoff_canonical_name: "Port B",
    dropoff_formatted_address: "Port B, Bangkok",
    dropoff_place_id: "dropoff-place",
    dropoff_lat: 13.8,
    dropoff_lng: 100.6,
    google_distance_km: 25,
    route_distance_meters: 25000,
    google_maps_route_url: null,
    status: "reopened",
    approved_at: "2026-08-26T00:00:00.000Z",
    approved_by: "admin-1"
  }]);

  assert.equal(queue.routes[0].status, "reopened");
  assert.equal(queue.summary.repeatRoutesConfirmed, 0);
  assert.equal(queue.summary.repeatRoutesRemaining, 1);
});

test("implementation bulk-confirms exact matches and lets future bookings inherit approved routes", () => {
  const server = fs.readFileSync(path.resolve("lib/booking-route-approvals.ts"), "utf8");
  const data = fs.readFileSync(path.resolve("lib/data.ts"), "utf8");

  assert.match(server, /normalizeRouteApprovalName\(booking\.pickup\) === approval\.normalized_pickup/);
  assert.match(server, /normalizeRouteApprovalName\(booking\.dropoff\) === approval\.normalized_dropoff/);
  assert.match(server, /approved_route_id:\s*approval\.id/);
  assert.match(server, /route_confirmation_status:\s*"confirmed"/);
  assert.match(server, /approved_route_id:\s*null/);
  assert.match(server, /route_confirmation_status:\s*status/);
  assert.match(data, /findApprovedRouteForBooking\(cleaned\.pickup/);
  assert.match(data, /\.eq\("status",\s*"confirmed"\)/);
  assert.match(data, /distance_source:\s*routeKm != null \? "approved_route"/);
});

test("route approval migration is additive and does not backfill live booking data by itself", () => {
  const migration = fs.readFileSync(path.resolve("supabase/migrations/20260826120000_add_booking_route_approvals.sql"), "utf8");

  assert.match(migration, /create table if not exists public\.booking_route_approvals/i);
  assert.match(migration, /add column if not exists approved_route_id/i);
  assert.match(migration, /add column if not exists route_confirmation_status/i);
  assert.doesNotMatch(migration, /update\s+public\.booking_diary/i);
  assert.doesNotMatch(migration, /delete\s+from\s+public\.booking_diary/i);
});
