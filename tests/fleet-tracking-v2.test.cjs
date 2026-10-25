const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");

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

function readUi() {
  return [
    "app/(dashboard)/fleet-tracking-v2/fixture/page.tsx",
    "components/fleet-tracking-v2/workspace.tsx",
    "components/fleet-tracking-v2/fleet-map.tsx",
    "lib/fleet-tracking-v2/map-engine.ts",
    "lib/fleet-tracking-v2/copy.ts"
  ].map((relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8")).join("\n");
}

const {
  SYNTHETIC_FLEET
} = loadTypeScriptModule("lib/fleet-tracking-v2/synthetic-fleet.ts");
const {
  canFocusVehicle,
  formatReportAge,
  formatReportTime,
  getMapVehicles,
  getMarkerCollisionGroups,
  getMotionState,
  getOperatingAreaPositions,
  getVisibleMarkerLabelKeys,
  matchesVehicleSearch,
  shouldOpenClusterPicker
} = loadTypeScriptModule("lib/fleet-tracking-v2/view.ts");
const { FLEET_TRACKING_V2_MAP_ENGINE } = loadTypeScriptModule("lib/fleet-tracking-v2/map-engine.ts");
const { FLEET_TRACKING_V2_COPY } = loadTypeScriptModule("lib/fleet-tracking-v2/copy.ts");

test("prototype uses 21 labelled sample vehicles and never treats unverified coordinates as map positions", () => {
  assert.equal(SYNTHETIC_FLEET.length, 21);
  assert.ok(SYNTHETIC_FLEET.every((vehicle) => vehicle.sampleTag === "SIMULATED"));
  assert.equal(new Set(SYNTHETIC_FLEET.map((vehicle) => vehicle.registration)).size, 21);
  assert.ok(SYNTHETIC_FLEET.every((vehicle) => !/^70-41\d{2}\x24/.test(vehicle.registration)));
  assert.ok(SYNTHETIC_FLEET.every((vehicle) => ["connected", "disconnected", "unknown"].includes(vehicle.trackerConnectivity)));
  const mapped = getMapVehicles(SYNTHETIC_FLEET);
  assert.equal(mapped.length, 17);
  assert.equal(mapped.some((vehicle) => vehicle.id === "test-19"), false);
  assert.equal(mapped.some((vehicle) => vehicle.id === "test-18"), false);
  assert.equal(mapped.some((vehicle) => vehicle.id === "test-20"), false);
  assert.equal(mapped.some((vehicle) => vehicle.id === "test-21"), false);
  const unverified = SYNTHETIC_FLEET.find((vehicle) => vehicle.id === "test-19");
  assert.equal(canFocusVehicle(unverified), false);
  assert.equal(unverified.gpsQuality, "wifi");
  assert.equal(typeof unverified.latitude, "number");
});

test("depot overlap keeps identical sample coordinates and opens a picker instead of moving points", () => {
  const depot = SYNTHETIC_FLEET.filter((vehicle) => vehicle.scenario === "depot-overlap");
  assert.equal(depot.length, 4);
  assert.deepEqual(depot.map((vehicle) => vehicle.registration), ["3ฒน-9565", "61-2835", "61-6672", "62-1085"]);
  const before = depot.map((vehicle) => [vehicle.latitude, vehicle.longitude]);
  const groups = getMarkerCollisionGroups(depot.map((vehicle) => ({ key: vehicle.id, x: 40, y: 40 })), 28);
  assert.deepEqual(depot.map((vehicle) => [vehicle.latitude, vehicle.longitude]), before);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].length, 4);
  const positions = depot.map((vehicle) => [vehicle.latitude, vehicle.longitude]);
  assert.equal(shouldOpenClusterPicker(positions, 12, 18), true);
  assert.equal(shouldOpenClusterPicker([[13.7, 100.5], [13.8, 100.6]], 12, 18), false);
});


test("map labels appear at the default useful zoom and hide colliding labels", () => {
  const visible = getVisibleMarkerLabelKeys([
    { key: "selected", left: 0, top: 0, width: 90, height: 18, selected: true },
    { key: "overlap", left: 20, top: 2, width: 90, height: 18, selected: false },
    { key: "clear", left: 180, top: 0, width: 90, height: 18, selected: false }
  ], 9);
  assert.equal(visible.has("selected"), true);
  assert.equal(visible.has("clear"), true);
  assert.equal(visible.has("overlap"), false);
  assert.deepEqual([...getVisibleMarkerLabelKeys([
    { key: "selected", left: 0, top: 0, width: 90, height: 18, selected: true },
    { key: "clear", left: 180, top: 0, width: 90, height: 18, selected: false }
  ], 7)], ["selected"]);
});

test("motion states cover moving, stopped, offline, unknown, stale and missing GPS", () => {
  assert.equal(getMotionState(SYNTHETIC_FLEET.find((vehicle) => vehicle.id === "test-05")), "moving");
  assert.equal(getMotionState(SYNTHETIC_FLEET.find((vehicle) => vehicle.id === "test-06")), "stopped");
  assert.equal(getMotionState(SYNTHETIC_FLEET.find((vehicle) => vehicle.id === "test-21")), "offline");
  assert.equal(getMotionState(SYNTHETIC_FLEET.find((vehicle) => vehicle.id === "test-18")), "unknown");
  assert.equal(getMotionState(SYNTHETIC_FLEET.find((vehicle) => vehicle.id === "test-20")), "unknown");
  assert.ok(matchesVehicleSearch(SYNTHETIC_FLEET[0], "test-01"));
  assert.equal(matchesVehicleSearch(SYNTHETIC_FLEET[0], "3ฒน-9565"), true);
  assert.equal(matchesVehicleSearch(SYNTHETIC_FLEET[0], "xyz"), false);
  assert.equal(formatReportAge(SYNTHETIC_FLEET[0].reportedAt, "en"), "2 minutes ago");
  assert.equal(formatReportAge(null, "en"), null);
  assert.ok(formatReportTime(SYNTHETIC_FLEET[0].reportedAt, "en").includes("GMT+7"));
});

test("initial map frame uses the Greater Bangkok sample operating area, not Chiang Mai", () => {
  const area = getOperatingAreaPositions(SYNTHETIC_FLEET);
  assert.ok(area.length >= 12);
  assert.equal(area.some((position) => position[0] === 18.7883), false);
  assert.equal(canFocusVehicle(SYNTHETIC_FLEET.find((vehicle) => vehicle.id === "test-17")), true);
});

test("English and Thai copy exist and the prototype stays off live Forth, Supabase and Production fleet tracking", () => {
  const ui = readUi();
  const css = fs.readFileSync(path.join(root, "components/fleet-tracking-v2/workspace.module.css"), "utf8");
  const { FLEET_V2_FOCUS_ZOOM } = loadTypeScriptModule("lib/fleet-tracking-v2/view.ts");
  assert.equal(FLEET_TRACKING_V2_MAP_ENGINE, "leaflet");
  assert.equal(FLEET_V2_FOCUS_ZOOM, 12);
  assert.equal(loadTypeScriptModule("lib/fleet-tracking-v2/view.ts").FLEET_V2_LABEL_ZOOM, 8);
  assert.ok(FLEET_TRACKING_V2_COPY.en.testDataBanner.includes("SIMULATED FIXTURE"));
  assert.ok(FLEET_TRACKING_V2_COPY.th.testDataBanner.includes("ข้อมูลจำลอง"));
  assert.ok(FLEET_TRACKING_V2_COPY.en.gpsConfidence);
  assert.ok(FLEET_TRACKING_V2_COPY.en.technicalDetails);
  assert.ok(FLEET_TRACKING_V2_COPY.en.simulatedReading);
  assert.ok(FLEET_TRACKING_V2_COPY.en.identityUnavailable);
  assert.ok(FLEET_TRACKING_V2_COPY.th.tracker);
  assert.ok(FLEET_TRACKING_V2_COPY.en.closeDetails);
  assert.ok(ui.includes("onSelect={selectVehicle}"));
  assert.ok(ui.includes("matching.length === 1"));
  assert.ok(ui.includes("rowExceptionCopy"));
  assert.ok(ui.includes("<details className={styles.technical}>"));
  assert.ok(ui.includes("clusterRow"));
  assert.ok(ui.includes("setSheetOpen(window.matchMedia"));
  assert.ok(ui.includes("canFocusVehicle(vehicle)"));
  assert.ok(ui.includes("setDetailsOpen(false)"));
  assert.ok(ui.includes("FLEET_V2_FOCUS_ZOOM"));
  assert.ok(ui.includes("shouldOpenClusterPicker"));
  assert.ok(css.includes("grid-template-columns: 280px minmax(0, 1fr)"));
  assert.ok(css.includes("position: absolute"));
  assert.ok(css.includes(".bodyRosterOpen"));
  assert.ok(css.includes(".rosterOpen"));
  assert.ok(css.includes(".exception"));
  assert.ok(css.includes(".technical"));
  assert.equal(ui.includes("/api/admin/forth-tracking"), false);
  assert.equal(ui.includes("supabase"), false);
  assert.equal(ui.includes("createClient"), false);
  assert.equal(ui.includes("bindPopup"), false);
  assert.equal(fs.existsSync(path.join(root, "app/(dashboard)/fleet-tracking/page.tsx")), true);
  assert.equal(fs.existsSync(path.join(root, "app/(dashboard)/fleet-tracking-v2/page.tsx")), true);
});
