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
  loaded._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }
  }).outputText, file);
  return loaded.exports;
}

const {
  classifyDrivingOutsideCoreOperations,
  classifyDrivingOutsideViewport,
  filterForthMapDisplayRecords,
  getForthDrivingFitPositions,
  getForthDrivingMapRecords,
  isForthMapDrivingCandidate,
  resolveForthMapViewLabel,
  shouldEmphasizeMapVehicle,
  summarizeForthMapGroup
} = load("lib/forth-visual-fleet.ts");

const {
  forthMarkerAnchorErrorMeters,
  forthMarkerAnchorIsStable,
  forthMarkerDiscPxForZoom,
  forthMarkerIconAnchorForZoom,
  forthMetersPerPixelAtEquator
} = load("lib/forth-marker-geometry.ts");

const { sortForthFleetRecords, getForthReportedActivity } = load("lib/forth-tracking-view.ts");

const base = {
  gpsDeviceId: "1",
  vehicleRegistration: "DRV-1",
  speed: 62,
  engineOn: true,
  timestampStatus: "current",
  lastGpsTimestamp: "2026-10-30T04:00:00.000Z",
  coordinateStatus: "valid",
  latitude: 13.75,
  longitude: 100.55,
  gpsConnectivity: "connected",
  gprsConnectivity: "connected",
  positionQuality: "gps"
};

test("driving map filtering uses activity classification, not speed alone", () => {
  const driving = { ...base };
  const conflict = { ...base, vehicleRegistration: "UNC-1", gpsDeviceId: "2", speed: 40, engineOn: false };
  const stopped = { ...base, vehicleRegistration: "STP-1", gpsDeviceId: "3", speed: 0, engineOn: true };
  assert.equal(isForthMapDrivingCandidate(driving), true);
  assert.equal(isForthMapDrivingCandidate(conflict), false);
  assert.equal(getForthReportedActivity(conflict), "uncertain");
  assert.equal(isForthMapDrivingCandidate(stopped), false);
  const filtered = filterForthMapDisplayRecords([driving, conflict, stopped], "driving");
  assert.deepEqual(filtered.map((record) => record.vehicleRegistration), ["DRV-1"]);
});

test("outside-camera driving counts keep source coordinates and never claim disappearance", () => {
  const points = [
    { key: "core", latitude: 13.75, longitude: 100.55 },
    { key: "phuket", latitude: 8.48, longitude: 98.62 },
    { key: "vientiane", latitude: 17.97, longitude: 102.6 }
  ];
  const outsideCore = classifyDrivingOutsideCoreOperations(points);
  assert.deepEqual(outsideCore.inside, ["core"]);
  assert.deepEqual(outsideCore.outside, ["phuket", "vientiane"]);
  assert.deepEqual(points.find((point) => point.key === "phuket"), {
    key: "phuket",
    latitude: 8.48,
    longitude: 98.62
  });

  const viewport = classifyDrivingOutsideViewport(points, ["core"]);
  assert.deepEqual(viewport.outside, ["phuket", "vientiane"]);
  assert.equal(viewport.inside.length + viewport.outside.length, points.length);
});

test("fit all driving uses only driving vehicles with valid Forth coordinates", () => {
  const records = [
    { ...base },
    { ...base, gpsDeviceId: "2", vehicleRegistration: "DRV-2", latitude: 8.48, longitude: 98.62 },
    { ...base, gpsDeviceId: "3", vehicleRegistration: "NO-COORD", coordinateStatus: "missing", latitude: null, longitude: null },
    { ...base, gpsDeviceId: "4", vehicleRegistration: "STOPPED", speed: 0 }
  ];
  const original = structuredClone(records);
  const positions = getForthDrivingFitPositions(records);
  assert.deepEqual(positions.map(({ key, position }) => [key, ...position]), [
    ["device:1", 13.75, 100.55],
    ["device:2", 8.48, 98.62]
  ]);
  assert.equal(getForthDrivingMapRecords(records).length, 2);
  assert.deepEqual(records, original);
});

test("group selection summaries expose registration, speed, activity, GPS confidence and report age", () => {
  const driving = { ...base, vehicleRegistration: "78-1001" };
  const attention = {
    ...base,
    gpsDeviceId: "2",
    vehicleRegistration: "78-1002",
    speed: 0,
    engineOn: true,
    gprsConnectivity: "disconnected",
    gpsConnectivity: "disconnected",
    positionQuality: "no_gps",
    lastGpsTimestamp: "2026-10-29T04:00:00.000Z"
  };
  const map = new Map([
    ["device:1", driving],
    ["device:2", attention]
  ]);
  const summary = summarizeForthMapGroup(map, ["device:1", "device:2"]);
  assert.equal(summary.accent, "mixed");
  assert.equal(summary.drivingCount, 1);
  assert.equal(summary.attentionCount, 1);
  assert.equal(summary.members[0].registration, "78-1001");
  assert.equal(summary.members[0].speed, 62);
  assert.equal(summary.members[0].activityKind, "driving");
  assert.equal(summary.members[0].gpsVerified, true);
  assert.equal(summary.members[0].reportAgeTimestamp, "2026-10-30T04:00:00.000Z");
  assert.equal(summary.members[1].gpsVerified, false);
});

test("GPS confidence remains separate from reported driving emphasis", () => {
  const unverifiedDriving = {
    ...base,
    positionQuality: "no_gps",
    gpsConnectivity: "disconnected",
    vehicleRegistration: "EST-1"
  };
  assert.equal(isForthMapDrivingCandidate(unverifiedDriving), true);
  assert.equal(shouldEmphasizeMapVehicle(unverifiedDriving, "driving", false), true);
  assert.equal(shouldEmphasizeMapVehicle(unverifiedDriving, "gps_verified", false), false);
  assert.equal(shouldEmphasizeMapVehicle(unverifiedDriving, "gps_verified", true), true);
});

test("marker anchors stay stable across zoom cycles", () => {
  const errors = [6, 9, 11, 14, 16].map((zoom) => {
    const disc = forthMarkerDiscPxForZoom(zoom);
    const [anchorX, anchorY] = forthMarkerIconAnchorForZoom(zoom);
    assert.equal(anchorX, disc / 2);
    assert.equal(anchorY, disc / 2);
    const metersPerPixel = forthMetersPerPixelAtEquator(zoom);
    return {
      zoom,
      errorMeters: forthMarkerAnchorErrorMeters({ x: 100, y: 100 }, { x: 100, y: 100 }, metersPerPixel)
    };
  });
  assert.equal(forthMarkerAnchorIsStable(errors), true);
  assert.ok(forthMarkerDiscPxForZoom(7) >= 26);
  assert.ok(forthMarkerDiscPxForZoom(9) >= 30);
});

test("Fleet Monitor operations sorting keeps driving first", () => {
  const records = [
    { ...base, gpsDeviceId: "s", vehicleRegistration: "STOP", speed: 0 },
    { ...base, gpsDeviceId: "d", vehicleRegistration: "DRIVE", speed: 55 },
    { ...base, gpsDeviceId: "o", vehicleRegistration: "OFF", gprsConnectivity: "disconnected", speed: 0 }
  ];
  assert.deepEqual(
    sortForthFleetRecords(records, "operations").map((record) => record.vehicleRegistration),
    ["DRIVE", "STOP", "OFF"]
  );
});

test("map view labels stay explicit and list filters do not auto-change map mode in the centre", () => {
  assert.equal(resolveForthMapViewLabel({
    cameraMode: "bangkok",
    mapMode: "reported",
    displayFilter: "all",
    selectedKey: null
  }), "core_operations");
  assert.equal(resolveForthMapViewLabel({
    cameraMode: "bangkok",
    mapMode: "reported",
    displayFilter: "driving",
    selectedKey: null
  }), "driving");
  assert.equal(resolveForthMapViewLabel({
    cameraMode: "selected",
    mapMode: "reported",
    displayFilter: "all",
    selectedKey: "device:1"
  }), "selected");

  const centre = fs.readFileSync(path.join(root, "components/forth-tracking-centre.tsx"), "utf8");
  assert.match(centre, /showDrivingOnMap/);
  assert.match(centre, /mapDisplayFilter/);
  assert.match(centre, /Optional map action/);
  assert.match(centre, /applyFleetFilter\(filter === "driving"/);
  assert.doesNotMatch(centre, /applyFleetFilter\([^\)]*driving[^\)]*\);\s*showDrivingOnMap/);
  assert.match(centre, /copy\.showDrivingOnMap/);
  assert.match(centre, /drivingOutsideArea/);
  assert.match(centre, /returnCoreOps/);
  assert.match(centre, /mapShowingDriving/);
  assert.match(centre, /forth-group-selector/);
  assert.match(centre, /EN|activityDriving|กำลังขับ/);
});

test("click-to-focus and refresh camera preservation remain in the map command path", () => {
  const centre = fs.readFileSync(path.join(root, "components/forth-tracking-centre.tsx"), "utf8");
  const map = fs.readFileSync(path.join(root, "components/forth-tracking-map.tsx"), "utf8");
  assert.match(centre, /focusMap:\s*true/);
  assert.match(centre, /A user selection focuses once; subsequent polling never issues a camera command/);
  assert.match(map, /Routine polling does not pan or zoom the map/);
  assert.match(map, /screenOverlapKeysRef/);
  assert.match(map, /Keep every vehicle marker visible/);
  assert.match(map, /map_overlap/);
  assert.match(map, /vehicleStackAccentDriving/);
  assert.match(map, /vehicleMarkerDrivingBoost/);
});

test("EN and TH copy cover driving map actions", () => {
  const centre = fs.readFileSync(path.join(root, "components/forth-tracking-centre.tsx"), "utf8");
  assert.match(centre, /Show driving on map/);
  assert.match(centre, /แสดงรถที่กำลังขับบนแผนที่/);
  assert.match(centre, /driving vehicles outside this area/);
  assert.match(centre, /คันที่กำลังขับอยู่นอกพื้นที่นี้/);
  assert.match(centre, /Return to Core Operations/);
  assert.match(centre, /กลับไปปฏิบัติการหลัก/);
  assert.match(centre, /Showing: Driving vehicles/);
  assert.match(centre, /กำลังแสดง: รถที่กำลังขับ/);
});
