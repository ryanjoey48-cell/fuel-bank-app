const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");

function loadTypeScriptModule(relativePath) {
  const filename = path.resolve(root, relativePath);
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

function loadWithMocks(relativePath, mocks) {
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(mocks, request)) return mocks[request];
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return loadTypeScriptModule(relativePath);
  } finally {
    Module._load = originalLoad;
  }
}

const forth = loadTypeScriptModule("lib/forth-tracking.ts");
const forthView = loadTypeScriptModule("lib/forth-tracking-view.ts");
const v2View = loadTypeScriptModule("lib/fleet-tracking-v2/view.ts");
const v2Summary = loadTypeScriptModule("lib/fleet-tracking-v2/summary.ts");
const { canShowUnverifiedReportedPosition, getFleetFitPositions, getVisibleMapVehicles } = v2View;
const adapter = loadWithMocks("lib/fleet-tracking-v2/live-adapter.ts", {
  "@/lib/forth-tracking": forth,
  "@/lib/forth-tracking-view": forthView,
  "@/lib/fleet-tracking-v2/view": v2View
});

function record(overrides = {}) {
  return {
    sourceAudit: {},
    gpsDeviceId: "device-1",
    vehicleRegistration: "61-2835",
    reportedDriver: "Forth reported name",
    locationAddressEnglish: "Bangkok depot",
    locationAddressThai: "คลังบางกอก",
    locationPointOfInterest: null,
    latitude: 13.7563,
    longitude: 100.5018,
    coordinateStatus: "valid",
    speed: 0,
    engineOn: false,
    gpsConnectivity: "connected",
    gprsConnectivity: "connected",
    sourceTimestampRaw: "2026-10-25T00:00:00Z",
    lastGpsTimestamp: "2026-10-25T00:00:00.000Z",
    timestampStatus: "current",
    heading: null,
    positionSource: "GPS",
    positionQuality: "gps",
    ...overrides
  };
}

function payload(records, overrides = {}) {
  return { connectionStatus: "connected", fetchedAt: "2026-10-25T00:01:00.000Z", records, error: null, ...overrides };
}

test("incomplete API records remain visible as unknown and never become trusted map positions", () => {
  const result = adapter.adaptForthFleetResponse(payload([{ gpsDeviceId: "partial-device" }]), []);
  assert.equal(result.status, "ready");
  assert.equal(result.records.length, 1);
  const vehicle = result.records[0];
  assert.equal(vehicle.deviceId, "partial-device");
  assert.equal(vehicle.activity, "unavailable");
  assert.equal(vehicle.gpsConfidence, "unavailable");
  assert.equal(vehicle.trackerConnectivity, "unknown");
  assert.equal(vehicle.eesIdentity.status, "unmatched");
  assert.equal(v2View.canFocusVehicle(vehicle), false);
});

test("only a unique EES registration match is linked; duplicate EES or Forth associations stay ambiguous", () => {
  const unique = adapter.adaptForthFleetResponse(payload([record()]), [{ id: "ees-1", vehicle_reg: "61-2835" }]);
  assert.equal(unique.status, "ready");
  assert.equal(unique.records[0].eesIdentity.status, "matched");
  assert.equal(unique.records[0].eesIdentity.vehicleId, "ees-1");
  assert.equal(unique.records[0].eesIdentity.matchedBy, "registration");
  assert.equal(adapter.matchesLiveVehicleSearch(unique.records[0], "device-1"), true);
  assert.equal(adapter.matchesLiveVehicleSearch(unique.records[0], "Forth reported name"), true);

  const duplicateEes = adapter.adaptForthFleetResponse(payload([record()]), [
    { id: "ees-1", vehicle_reg: "61-2835" },
    { id: "ees-2", vehicle_reg: "61-2835" }
  ]);
  assert.equal(duplicateEes.status, "ready");
  assert.equal(duplicateEes.records[0].eesIdentity.status, "ambiguous");
  assert.equal(duplicateEes.records[0].eesIdentity.vehicleId, null);

  const duplicateForth = adapter.adaptForthFleetResponse(payload([
    record({ gpsDeviceId: "device-1" }),
    record({ gpsDeviceId: "device-2" })
  ]), [{ id: "ees-1", vehicle_reg: "61-2835" }]);
  assert.ok(duplicateForth.records.every((vehicle) => vehicle.eesIdentity.status === "ambiguous"));
  assert.notEqual(duplicateForth.records[0].id, duplicateForth.records[1].id);
});

test("stale reports and non-GPS positions never focus or appear on the map even when the tracker is connected", () => {
  const result = adapter.adaptForthFleetResponse(payload([
    record({ gpsDeviceId: "fresh-gps" }),
    record({ gpsDeviceId: "stale-gps", timestampStatus: "stale" }),
    record({ gpsDeviceId: "wifi-position", positionQuality: "wifi" })
  ]), []);
  assert.equal(result.status, "ready");
  assert.equal(result.records[0].gpsConfidence, "verified");
  assert.equal(result.records[1].gpsConfidence, "unverified");
  assert.equal(result.records[1].gpsTrust, "stale");
  assert.equal(result.records[1].activity, "unavailable");
  assert.equal(result.records[2].trackerConnectivity, "connected");
  assert.equal(result.records[2].gpsConfidence, "unverified");
  assert.deepEqual(v2View.getMapVehicles(result.records).map((vehicle) => vehicle.id), ["device:fresh-gps"]);
  assert.equal(v2View.canFocusVehicle(result.records[1]), false);
  assert.equal(v2View.canFocusVehicle(result.records[2]), false);
});

test("unconfigured timezone preserves the original timestamp and does not invent activity or GPS confidence", () => {
  const rawTime = "25-10-2026 07:15:00";
  const result = adapter.adaptForthFleetResponse(payload([
    record({ timestampStatus: "timezone_unconfigured", lastGpsTimestamp: null, sourceTimestampRaw: rawTime })
  ]), []);
  assert.equal(result.status, "ready");
  assert.equal(result.records[0].sourceTimestampRaw, rawTime);
  assert.equal(result.records[0].reportFreshness, "timezone_unconfigured");
  assert.equal(result.records[0].activity, "unavailable");
  assert.equal(result.records[0].gpsConfidence, "unavailable");
  assert.equal(v2View.getMapVehicles(result.records).length, 0);
});

test("Forth source failure becomes an unavailable state, never a synthetic fallback", () => {
  const result = adapter.adaptForthFleetResponse({
    connectionStatus: "failed", fetchedAt: null, records: [],
    error: { code: "tracking_http_error", message: "Forth fleet tracking is unavailable." }
  }, []);
  assert.deepEqual(result, { status: "unavailable", message: "Forth fleet tracking is unavailable." });
  const workspace = fs.readFileSync(path.join(root, "components/fleet-tracking-v2/live-workspace.tsx"), "utf8");
  assert.ok(workspace.includes("/api/admin/forth-tracking/vehicles"));
  assert.ok(workspace.includes("No simulated readings are shown"));
  assert.equal(workspace.includes("SYNTHETIC_FLEET"), false);
  assert.equal(workspace.includes("setInterval"), false);
  const fixturePage = fs.readFileSync(path.join(root, "app/(dashboard)/fleet-tracking-v2/fixture/page.tsx"), "utf8");
  assert.ok(fixturePage.includes('process.env.NODE_ENV !== "development"'));
  assert.ok(fixturePage.includes("notFound()"));
  assert.ok(fixturePage.toLowerCase().includes("fixture"));
});

class MockAdminApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function invokeVehiclesRoute({ requireUser, allowed }) {
  const service = { calls: 0 };
  const mocks = {
    "next/server": { NextResponse: { json: (body, init) => new Response(JSON.stringify(body), init) } },
    "@/lib/authorization": { hasPermission: (access, permission) => access.allowed && permission === "business:read" },
    "@/lib/admin-user-management-server": {
      AdminApiError: MockAdminApiError,
      createServerSupabaseAdmin: () => ({}),
      requireVerifiedUser: requireUser,
      resolveAccountAccess: async () => ({ allowed })
    },
    "@/lib/forth-tracking-server": {
      getForthTrackingFleetData: async () => {
        service.calls += 1;
        return payload([]);
      }
    }
  };
  const { GET } = loadWithMocks("app/api/admin/forth-tracking/vehicles/route.ts", mocks);
  const response = await GET(new Request("https://local.test/api/admin/forth-tracking/vehicles"));
  return { response, service };
}

test("protected endpoint rejects missing authentication before requesting Forth", async () => {
  const result = await invokeVehiclesRoute({
    requireUser: async () => { throw new MockAdminApiError(401, "Authentication required."); },
    allowed: true
  });
  assert.equal(result.response.status, 401);
  assert.equal(result.service.calls, 0);
});

test("protected endpoint enforces business:read before requesting Forth and returns private no-store data when authorized", async () => {
  const denied = await invokeVehiclesRoute({ requireUser: async () => ({ id: "user-1" }), allowed: false });
  assert.equal(denied.response.status, 403);
  assert.equal(denied.service.calls, 0);

  const allowed = await invokeVehiclesRoute({ requireUser: async () => ({ id: "user-1" }), allowed: true });
  assert.equal(allowed.response.status, 200);
  assert.equal(allowed.service.calls, 1);
  assert.equal(allowed.response.headers.get("cache-control"), "private, no-store");
  const body = await allowed.response.json();
  assert.equal(body.connectionStatus, "connected");
});

test("unverified source coordinates stay out of the default map set and remain unchanged after opt-in", () => {
  const result = adapter.adaptForthFleetResponse(payload([
    record({ gpsDeviceId: "fresh-position" }),
    record({ gpsDeviceId: "unverified-position", timestampStatus: "stale" })
  ]), []);
  assert.equal(result.status, "ready");
  const [verified, unverified] = result.records;
  const original = [unverified.latitude, unverified.longitude];
  assert.equal(canShowUnverifiedReportedPosition(unverified), true);
  assert.deepEqual(getVisibleMapVehicles(result.records).map((vehicle) => vehicle.id), [verified.id]);
  assert.deepEqual(getVisibleMapVehicles(result.records, true).map((vehicle) => vehicle.id), [verified.id, unverified.id]);
  assert.deepEqual([unverified.latitude, unverified.longitude], original);
  assert.equal(canShowUnverifiedReportedPosition({ ...unverified, coordinateStatus: "invalid" }), false);
  assert.equal(canShowUnverifiedReportedPosition({ ...unverified, latitude: 95 }), false);
});

test("fleet fit uses only legal coordinates in the operating area and includes unverified reports only after opt-in", () => {
  const result = adapter.adaptForthFleetResponse(payload([
    record({ gpsDeviceId: "verified-depot" }),
    record({ gpsDeviceId: "stale-nearby", latitude: 13.76, longitude: 100.51, timestampStatus: "stale" }),
    record({ gpsDeviceId: "wifi-nearby", latitude: 13.74, longitude: 100.49, positionQuality: "wifi" }),
    record({ gpsDeviceId: "verified-outlier", latitude: 18.7883, longitude: 98.9853 }),
    record({ gpsDeviceId: "invalid-coordinate", latitude: 95, longitude: 181 })
  ]), []);
  assert.equal(result.status, "ready");
  const vehicles = result.records;
  const before = vehicles.map((vehicle) => [vehicle.latitude, vehicle.longitude]);
  const defaultFit = getFleetFitPositions(vehicles);
  assert.equal(defaultFit.length, 1);
  assert.deepEqual(defaultFit[0], [13.7563, 100.5018]);

  const optedInFit = getFleetFitPositions(vehicles, true);
  assert.equal(optedInFit.length, 3);
  assert.ok(optedInFit.some(([latitude, longitude]) => latitude === 13.76 && longitude === 100.51));
  assert.ok(optedInFit.some(([latitude, longitude]) => latitude === 13.74 && longitude === 100.49));
  assert.equal(optedInFit.some(([latitude]) => latitude === 18.7883 || latitude === 95), false);
  assert.deepEqual(vehicles.map((vehicle) => [vehicle.latitude, vehicle.longitude]), before);
  assert.equal(v2View.canFocusVehicle({ ...vehicles[1], gpsTrust: "verified", coordinateStatus: "invalid" }), false);
});

test("unverified toggle and selection preserve map position; verified selection alone requests focus", () => {
  const workspace = fs.readFileSync(path.join(root, "components/fleet-tracking-v2/live-workspace.tsx"), "utf8");
  const map = fs.readFileSync(path.join(root, "components/fleet-tracking-v2/fleet-map.tsx"), "utf8");
  const toggleStart = workspace.indexOf('<input type="checkbox" checked={showUnverifiedPositions}');
  const toggleEnd = workspace.indexOf("<span>{copy.showUnverified}", toggleStart);
  const toggle = workspace.slice(toggleStart, toggleEnd);
  assert.ok(toggle.includes("setShowUnverifiedPositions(event.target.checked)"));
  assert.doesNotMatch(toggle, /setCommand|flyTo|fitBounds|setView/);

  const selectStart = workspace.indexOf("function selectVehicle(id: string)");
  const selectEnd = workspace.indexOf("function showReportedPositionOnMap()", selectStart);
  const select = workspace.slice(selectStart, selectEnd);
  assert.match(select, /if \(canFocusVehicle\(vehicle\)\)/);
  assert.doesNotMatch(select, /showUnverifiedPositions|canShowUnverifiedReportedPosition/);

  assert.ok(map.includes("const expandCluster = (memberIds: string[]) => onClusterRef.current([...memberIds])"));
  assert.match(map, /fitArea\(map, Leaflet, getFleetFitPositions\(vehicles, showUnverifiedPositions\)\)/);
  assert.match(map, /fittedRef\.current \|\| vehicles\.length === 0/);
  const markerUpdatePosition = map.indexOf("const nextIds = new Set(mapVehicles");
  const markerEffectStart = map.lastIndexOf("useEffect(() => {", markerUpdatePosition);
  const markerEffectEnd = map.indexOf("useEffect(() => {", markerEffectStart + 1);
  const markerEffect = map.slice(markerEffectStart, markerEffectEnd);
  assert.doesNotMatch(markerEffect, /fitBounds|flyTo|setView|fitArea/);
  assert.equal(workspace.includes('useState<Command>({ type: "fit", sequence: 0 })'), true);
  assert.match(workspace, /const visible = useMemo\(\(\) => vehicles\.filter/);
  assert.match(workspace, /<FleetTrackingV2Map vehicles=\{vehicles\}/);
  const refreshStart = workspace.indexOf("const loadLiveData = useCallback");
  const refreshEnd = workspace.indexOf("useEffect(() => {", refreshStart);
  assert.doesNotMatch(workspace.slice(refreshStart, refreshEnd), /setCommand|fitArea/);
});

test("identity presentation prefers one readable type and keeps raw EES classifications in technical details", () => {
  const workspace = fs.readFileSync(path.join(root, "components/fleet-tracking-v2/live-workspace.tsx"), "utf8");
  assert.ok(workspace.includes("getPortalVehicleTypeLabel(value, language)"));
  assert.ok(workspace.includes("vehicle.eesIdentity.vehicleType ?? vehicle.eesIdentity.vehicleCategory"));
  assert.ok(workspace.includes("copy.vehicleTypeRaw"));
  assert.ok(workspace.includes("copy.vehicleCategoryRaw"));
  assert.ok(workspace.includes('vehicleTypeRaw: "Raw EES vehicle type"'));
  assert.ok(workspace.includes('vehicleCategoryRaw: "Raw EES vehicle category"'));
  assert.ok(workspace.includes('vehicleTypeRaw: "ประเภทรถ EES ดิบ"'));
  assert.ok(workspace.includes('vehicleCategoryRaw: "หมวดรถ EES ดิบ"'));
});

test("desktop workspace fills the available height and keeps a three-panel layout before tablet overlay", () => {
  const css = fs.readFileSync(path.join(root, "components/fleet-tracking-v2/live-workspace.module.css"), "utf8");
  assert.ok(css.includes("height: calc(100dvh - 126px)"));
  assert.match(css, /@media \(min-width: 1200px\)[\s\S]*?\.bodyWithInspector\s*\{\s*grid-template-columns: minmax\(250px, 280px\) minmax\(0, 1fr\) minmax\(320px, 350px\)/);
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*?\.body,\s*\.bodyWithInspector\s*\{\s*display: flex/);
  assert.match(css, /\.mapPane\s*\{[^}]*height: clamp\(290px, 46dvh, 460px\)/);
});

test("EES model, type and driver display only for a unique vehicle and one active assignment", () => {
  const registry = [{
    id: "ees-vehicle-1", vehicle_reg: "61-2835", vehicle_name: "Isuzu NPR", vehicle_type: "LORRY",
    vehicle_category: "HEAVY_LORRY"
  }];
  const uniqueAssignment = adapter.attachUniqueActiveDriverAssignments(registry, [
    { id: "driver-1", name: "Confirmed Driver", active: true, assigned_vehicle_id: "ees-vehicle-1" },
    { id: "driver-2", name: "Inactive Driver", active: false, assigned_vehicle_id: "ees-vehicle-1" }
  ]);
  const matched = adapter.adaptForthFleetResponse(payload([record()]), uniqueAssignment);
  assert.equal(matched.status, "ready");
  assert.equal(matched.records[0].eesIdentity.status, "matched");
  assert.equal(matched.records[0].eesIdentity.vehicleModel, "Isuzu NPR");
  assert.equal(matched.records[0].eesIdentity.vehicleType, "LORRY");
  assert.equal(matched.records[0].eesIdentity.assignedDriverName, "Confirmed Driver");
  assert.equal(matched.records[0].sourceRegistration, "61-2835");

  const ambiguousAssignments = adapter.attachUniqueActiveDriverAssignments(registry, [
    { id: "driver-1", name: "Driver One", active: true, assigned_vehicle_id: "ees-vehicle-1" },
    { id: "driver-2", name: "Driver Two", active: true, assigned_vehicle_id: "ees-vehicle-1" }
  ]);
  const ambiguous = adapter.adaptForthFleetResponse(payload([record()]), ambiguousAssignments);
  assert.equal(ambiguous.records[0].eesIdentity.status, "matched");
  assert.equal(ambiguous.records[0].eesIdentity.assignedDriverName, null);
  assert.equal(ambiguous.records[0].eesIdentity.driverAssignmentStatus, "ambiguous");

  const unavailableAssignments = adapter.attachUniqueActiveDriverAssignments(registry, null);
  const unavailable = adapter.adaptForthFleetResponse(payload([record()]), unavailableAssignments);
  assert.equal(unavailable.records[0].eesIdentity.assignedDriverName, null);
  assert.equal(unavailable.records[0].eesIdentity.driverAssignmentStatus, "unavailable");
});

test("Google Maps is offered only for a current, verified source coordinate", () => {
  const fresh = adapter.adaptForthFleetResponse(payload([record()]), []);
  assert.equal(adapter.canOpenVerifiedGoogleMaps(fresh.records[0]), true);
  const stale = adapter.adaptForthFleetResponse(payload([record({ timestampStatus: "stale" })]), []);
  assert.equal(adapter.canOpenVerifiedGoogleMaps(stale.records[0]), false);
  const wifi = adapter.adaptForthFleetResponse(payload([record({ positionQuality: "wifi" })]), []);
  assert.equal(adapter.canOpenVerifiedGoogleMaps(wifi.records[0]), false);
  const timezoneUnknown = adapter.adaptForthFleetResponse(payload([record({ timestampStatus: "timezone_unconfigured", lastGpsTimestamp: null })]), []);
  assert.equal(adapter.canOpenVerifiedGoogleMaps(timezoneUnknown.records[0]), false);
});

test("live fleet summary keeps unknown activity, GPS confidence, and source times separate from zero counts", () => {
  const result = v2Summary.summarizeLiveFleet([
    { activity: "driving", gpsConfidence: "verified", reportFreshness: "current" },
    { activity: "stopped_engine_off", gpsConfidence: "unverified", reportFreshness: "stale" },
    { activity: "uncertain", gpsConfidence: "unverified", reportFreshness: "timezone_unconfigured" },
    { activity: "unavailable", gpsConfidence: "unavailable", reportFreshness: "missing" }
  ]);
  assert.deepEqual(result.activity, { driving: 1, stopped: 1, uncertain: 1, unavailable: 1 });
  assert.deepEqual(result.gps, { verified: 1, unverified: 2, unavailable: 1 });
  assert.deepEqual(result.reports, { current: 1, stale: 1, unknown: 2 });
  assert.deepEqual(v2Summary.summarizeLiveFleet([]), {
    activity: { driving: 0, stopped: 0, uncertain: 0, unavailable: 0 },
    gps: { verified: 0, unverified: 0, unavailable: 0 },
    reports: { current: 0, stale: 0, unknown: 0 }
  });
});

test("live workspace keeps the unverified-position toggle opt-in and provides a map legend", () => {
  const workspace = fs.readFileSync(path.join(root, "components/fleet-tracking-v2/live-workspace.tsx"), "utf8");
  assert.ok(workspace.includes("useState(false)"));
  assert.ok(workspace.includes("Show unverified reported positions"));
  assert.ok(workspace.includes("Unverified reported position"));
  assert.ok(workspace.includes("This is the last position reported by Forth"));
  assert.ok(workspace.includes("https://www.google.com/maps/search/?api=1&query="));
  assert.ok(workspace.includes("copy.journeyHistory"));
  assert.ok(workspace.includes("copy.parkingHistory"));
  assert.ok(workspace.includes("disabled title={copy.historyUnavailable}"));
  assert.ok(workspace.includes("summarizeLiveFleet(vehicles)"));
  assert.equal(workspace.includes("/api/vehicle/trips"), false);
  assert.equal(workspace.includes("/api/vehicle/parkingTrip"), false);
  const liveStyles = fs.readFileSync(path.join(root, "components/fleet-tracking-v2/live-workspace.module.css"), "utf8");
  assert.ok(liveStyles.includes(".bodyWithInspector"));
  assert.ok(liveStyles.includes("@media (max-width: 900px)"));
});
