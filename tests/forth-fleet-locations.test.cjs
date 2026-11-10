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
  loaded._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file);
  return loaded.exports;
}

const {
  filterFleetDirectoryLocations,
  findNearbyVehiclesForLocation,
  haversineDistanceKm,
  joinMappedDirectoryLocations
} = load("lib/forth-fleet-locations.ts");

test("directory join uses confirmed destination pins only and never invents coordinates", () => {
  const locations = [
    { id: "a", company_name: "Alpha Depot", address: "Lat Krabang", destination_type: "Depot", google_maps_url: "https://www.google.com/maps/place/alpha" },
    { id: "b", company_name: "Beta Customer", address: "No pin yet", destination_type: "Customer" },
    { id: "c", company_name: "", address: "Blank company", destination_type: "Warehouse" }
  ];
  const pins = [
    { location_id: "a", pin_type: "destination", pin_status: "manual_confirmed", latitude: 13.72, longitude: 100.75 },
    { location_id: "a", pin_type: "truck_entrance", pin_status: "manual_confirmed", latitude: 13.721, longitude: 100.751 },
    { location_id: "b", pin_type: "destination", pin_status: "manual_confirmed", latitude: 91, longitude: 100 },
    { location_id: "c", pin_type: "destination", pin_status: "manual_confirmed", latitude: 13.7, longitude: 100.5 }
  ];
  const mapped = joinMappedDirectoryLocations(locations, pins);
  assert.equal(mapped.length, 1);
  assert.equal(mapped[0].id, "a");
  assert.equal(mapped[0].category, "Depot");
  assert.equal(mapped[0].latitude, 13.72);
  assert.equal(mapped[0].directoryHref.includes("focus=a"), true);
});

test("location search and category filters keep directory records searchable", () => {
  const mapped = [
    { id: "1", companyName: "Eastern Port", thaiName: "ท่าเรือ", address: "Laem Chabang", province: "Chonburi", category: "Port", googleMapsUrl: null, latitude: 13.08, longitude: 100.88, directoryHref: "/locations?focus=1" },
    { id: "2", companyName: "City Warehouse", thaiName: null, address: "Bangna", province: "Bangkok", category: "Warehouse", googleMapsUrl: null, latitude: 13.66, longitude: 100.64, directoryHref: "/locations?focus=2" }
  ];
  assert.equal(filterFleetDirectoryLocations(mapped, "chonburi", "all").length, 1);
  assert.equal(filterFleetDirectoryLocations(mapped, "", "Warehouse")[0].id, "2");
  assert.equal(filterFleetDirectoryLocations(mapped, "ไม่มี", "Port").length, 0);
});

test("nearby vehicles report straight-line kilometres without inventing arrivals", () => {
  const distance = haversineDistanceKm(13.72, 100.75, 13.73, 100.76);
  assert.ok(distance !== null && distance > 0 && distance < 3);
  const nearby = findNearbyVehiclesForLocation(
    { latitude: 13.72, longitude: 100.75 },
    [
      { gpsDeviceId: "1", vehicleRegistration: "NEAR", coordinateStatus: "valid", latitude: 13.725, longitude: 100.755, positionQuality: "gps", gpsConnectivity: "connected", timestampStatus: "current", lastGpsTimestamp: "2026-10-28T08:00:00Z", speed: 20, engineOn: true, reportedDriver: null },
      { gpsDeviceId: "2", vehicleRegistration: "FAR", coordinateStatus: "valid", latitude: 18.5, longitude: 99.0, positionQuality: "gps", gpsConnectivity: "connected", timestampStatus: "current", lastGpsTimestamp: "2026-10-28T08:00:00Z", speed: 40, engineOn: true, reportedDriver: null },
      { gpsDeviceId: "3", vehicleRegistration: "NO-COORD", coordinateStatus: "missing", latitude: null, longitude: null, positionQuality: "no_gps", gpsConnectivity: "connected", timestampStatus: "current", lastGpsTimestamp: "2026-10-28T08:00:00Z", speed: 0, engineOn: false, reportedDriver: null }
    ],
    { limit: 2, nowMs: Date.parse("2026-10-28T08:05:00Z"), language: "en" }
  );
  assert.equal(nearby.length, 2);
  assert.equal(nearby[0].record.vehicleRegistration, "NEAR");
  assert.ok(nearby[0].distanceKm < nearby[1].distanceKm);
});

test("Fleet Tracking centre mounts Forth GPS locations layer without Directory writes", () => {
  const centre = fs.readFileSync(path.join(root, "components/forth-tracking-centre.tsx"), "utf8");
  assert.match(centre, /ForthGpsLocationsPanel/);
  assert.match(centre, /locationsLayerOn/);
  assert.match(centre, /\/api\/admin\/forth-tracking\/saved-locations/);
  assert.match(centre, /\/api\/locations/);
  assert.match(centre, /\/api\/locations\/map-pins/);
  assert.equal(centre.includes("accessLocations"), false);
  assert.match(centre, /FORTH_GPS_SOURCE_LABEL/);
});
