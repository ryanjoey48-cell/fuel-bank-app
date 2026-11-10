const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
function loadTypeScript(relative) {
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file).exports;
    const module = new Module(file);
    cache.set(file, module);
    module.filename = file;
    module.paths = Module._nodeModulePaths(path.dirname(file));
    module.require = (request) => {
      if (request.endsWith(".css")) return { default: {} };
      if (request.startsWith("@/")) return load(path.join(root, request.slice(2) + ".ts"));
      return require(request);
    };
    module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }
    }).outputText, file);
    return module.exports;
  }
  return load(path.join(root, relative));
}

const { applyForthMapViewCommand, quickView, markerIcon, stackIcon } = loadTypeScript("components/forth-tracking-map.tsx");

test("individual and shared-location markers keep truck symbols at their geographic anchors", () => {
  const LeafletIcon = { divIcon: (options) => options };
  for (const zoom of [6, 9, 14]) {
    const vehicle = markerIcon(LeafletIcon, "driving", false, false, false, "78-6996", "six_wheeler", null, false, zoom);
    const overlapping = markerIcon(LeafletIcon, "driving", false, false, false, "78-6996", "six_wheeler", null, false, zoom, 3);
    const shared = stackIcon(LeafletIcon, 5, false, true, null, null, zoom);
    assert.match(vehicle.html, /<svg/);
    assert.match(vehicle.html, /78-6996/);
    assert.match(overlapping.html, />×3<\/strong>/);
    assert.match(shared.html, /<svg/);
    assert.match(shared.html, />5<\/strong>/);
    assert.deepEqual(vehicle.iconAnchor, shared.iconAnchor);
    assert.deepEqual(vehicle.iconAnchor, vehicle.iconSize.map((size) => size / 2));
  }
});

test("map quick-view preserves confirmed driver attribution and labels Forth names as unverified", () => {
  const originalDocument = global.document;
  global.document = { createElement: (tag) => ({ tag, textContent: "", children: [], append(...nodes) { this.children.push(...nodes); } }) };
  try {
    const copy = { driving: "Driving", stopped: "Stopped", uncertain: "Uncertain", unavailable: "Unavailable", gpsVerified: "GPS verified", notGpsVerified: "GPS not verified", engineOn: "On", engineOff: "Off", unknownValue: "Unknown" };
    const record = { reportedDriver: "Forth Name", speed: 62, engineOn: true, lastGpsTimestamp: null, locationAddressEnglish: "Bangkok" };
    const driverText = (confirmed) => quickView(record, "ABC-123", "driving", "GPS verified", copy, "en", confirmed).children[2].textContent;
    assert.equal(driverText("Assigned Name"), "Assigned Name · Assigned driver");
    assert.equal(driverText(null), "Forth Name · Forth reported · unverified");
    const preview = quickView({ ...record, reportedDriver: null }, "ABC-123", "driving", "GPS verified", copy, "en", null);
    assert.equal(preview.children[0].children[0].textContent, "ABC-123");
    assert.equal(preview.children[0].children[1].textContent, "62 km/h");
    assert.equal(preview.children[1].textContent, "Driving");
    assert.equal(preview.children[2].textContent, "Driver not confirmed");
    assert.equal(preview.children[3].textContent, "Bangkok");
    assert.equal(preview.children[4].children[1].textContent, "GPS verified");
    assert.equal(preview.children.length, 5);
  } finally {
    global.document = originalDocument;
  }
});
function mapDouble({ inspector = null, toolbar = null } = {}) {
  const flights = [];
  const map = {
    getZoom: () => 9,
    getSize: () => ({ x: 1200, y: 700 }),
    getContainer: () => ({
      getBoundingClientRect: () => ({ top: 0, bottom: 700, left: 0, right: 1200 }),
      closest: () => ({ querySelector: (selector) => {
        const rect = selector.includes("vehicle-card") ? inspector : toolbar;
        return rect ? { getBoundingClientRect: () => rect } : null;
      } })
    }),
    project: (position) => ({ x: position.lng * 1000, y: position.lat * 1000 }),
    unproject: (point) => ({ lat: point.y / 1000, lng: point.x / 1000 }),
    stop: () => undefined,
    flyTo: (center, zoom) => flights.push({ center, zoom }),
    fitBounds: () => { throw new Error("A focus command must not fit the full fleet"); }
  };
  return { map, flights };
}
const Leaflet = { point: (x, y) => ({ x, y }) };

test("a vehicle selected before its marker loads remains eligible for focus", () => {
  const { map, flights } = mapDouble();
  const markers = new Map();
  const command = { type: "focus", sequence: 2, key: "9565" };
  assert.equal(applyForthMapViewCommand(map, Leaflet, command, [], markers, true), false);
  assert.equal(flights.length, 0);

  const reportedPosition = Object.freeze({ lat: 16.12, lng: 99.78 });
  markers.set("9565", { marker: { getLatLng: () => reportedPosition } });
  assert.equal(applyForthMapViewCommand(map, Leaflet, command, [], markers, true), true);
  assert.equal(flights.length, 1);
  assert.equal(flights[0].zoom, 14);
  assert.deepEqual(reportedPosition, { lat: 16.12, lng: 99.78 });
});

test("vehicle focus reserves the visible inspector area without rewriting the source position", () => {
  const { map, flights } = mapDouble({
    inspector: { width: 360, height: 600, left: 840, right: 1200, top: 120, bottom: 700 },
    toolbar: { bottom: 110 }
  });
  const source = Object.freeze({ lat: 13.75, lng: 100.5 });
  const markers = new Map([["selected", { marker: { getLatLng: () => source } }]]);
  assert.equal(applyForthMapViewCommand(map, Leaflet, { type: "focus", sequence: 1, key: "selected" }, [], markers, true), true);
  // Moving the camera east places the selected marker left of the right-hand card.
  assert.ok(flights[0].center.lng > source.lng);
  assert.ok(flights[0].center.lat < source.lat);
  assert.deepEqual(source, { lat: 13.75, lng: 100.5 });
});

test("explicit vehicle selection uses a local zoom even after a wider or closer camera", () => {
  const { map, flights } = mapDouble();
  const markers = new Map([["truck", { marker: { getLatLng: () => ({ lat: 13.72, lng: 100.64 }) } }]]);
  map.getZoom = () => 18;
  assert.equal(applyForthMapViewCommand(map, Leaflet, { type: "focus", sequence: 1, key: "truck", zoom: 15 }, [], markers, true), true);
  assert.equal(flights[0].zoom, 15);
  map.getZoom = () => 6;
  assert.equal(applyForthMapViewCommand(map, Leaflet, { type: "focus", sequence: 2, key: "truck", zoom: 14 }, [], markers, true), true);
  assert.equal(flights[1].zoom, 14);
});

test("a fit command waits for at least one position", () => {
  const { map, flights } = mapDouble();
  assert.equal(applyForthMapViewCommand(map, Leaflet, { type: "fit", sequence: 1 }, [], new Map(), false), false);
  assert.equal(flights.length, 0);
});

test("Full Fleet fits every distant source position without a regional zoom override", () => {
  const positions = [[13.7, 100.5], [7.9, 98.3], [22.6, 114.1]];
  const calls = [];
  const { map } = mapDouble();
  map.getZoom = () => 4;
  map.fitBounds = (bounds) => calls.push({ type: "fit", bounds });
  map.setView = () => calls.push({ type: "override" });
  const leaflet = { ...Leaflet, latLngBounds: (points) => points };
  assert.equal(applyForthMapViewCommand(map, leaflet, { type: "fit_all", sequence: 1 }, positions, new Map(), false), true);
  assert.deepEqual(calls, [{ type: "fit", bounds: positions }]);
});


test("reported map mode retains all 21 source positions while GPS mode keeps six verified positions", () => {
  const { getForthFleetMapModeRecords, getForthFleetMapRecords, getForthFleetRecordKey, findForthFleetRecord } = loadTypeScript("lib/forth-tracking-view.ts");
  const verifiedIndices = new Set([0, 4, 8, 12, 16, 20]);
  const records = Object.freeze(Array.from({ length: 21 }, (_, index) => Object.freeze({
    gpsDeviceId: index === 20 ? null : `GPS-${index}`,
    vehicleRegistration: index === 20 ? "3ฒน-9565" : `TEST-${index}`,
    latitude: 13.5 + index * 0.01,
    longitude: 100.4 + index * 0.01,
    coordinateStatus: "valid",
    timestampStatus: "current",
    gpsConnectivity: "connected",
    positionQuality: verifiedIndices.has(index) ? "gps" : "no_gps"
  })));
  const reported = getForthFleetMapRecords(getForthFleetMapModeRecords(records, "reported"));
  const gpsOnly = getForthFleetMapRecords(getForthFleetMapModeRecords(records, "gps"));
  assert.equal(reported.length, 21);
  assert.equal(gpsOnly.length, 6);
  reported.forEach(({ record, position }, index) => {
    assert.strictEqual(record, records[index]);
    assert.deepEqual(position, [records[index].latitude, records[index].longitude]);
  });
  gpsOnly.forEach(({ record, position }) => {
    assert.ok(verifiedIndices.has(records.indexOf(record)));
    assert.deepEqual(position, [record.latitude, record.longitude]);
  });

  const selected = records[20];
  const selectedKey = getForthFleetRecordKey(selected, 20);
  assert.equal(selectedKey, "registration:3ฒน9565");
  assert.equal(gpsOnly.find(({ record }) => record === selected).key, selectedKey);
  assert.strictEqual(findForthFleetRecord([...records].reverse(), selectedKey), selected);

  const invalidReports = [...records,
    { ...records[0], gpsDeviceId: "MISSING", coordinateStatus: "missing", latitude: null },
    { ...records[0], gpsDeviceId: "INVALID", coordinateStatus: "invalid", latitude: 91 }
  ];
  assert.equal(getForthFleetMapRecords(getForthFleetMapModeRecords(invalidReports, "reported")).length, 21);
  assert.equal(getForthFleetMapRecords(getForthFleetMapModeRecords(invalidReports, "gps")).length, 6);
});


test("explicit Fit fleet includes every supplied position, including distant reports", () => {
  const { map } = mapDouble();
  const positions = Object.freeze(Array.from({ length: 21 }, (_, index) => Object.freeze(
    index === 20 ? [18.79, 98.98] : [13.75 + index * .001, 100.5 + index * .001]
  )));
  const before = positions.map((position) => [...position]);
  const fitted = [];
  map.fitBounds = (bounds) => fitted.push(bounds);
  const boundsLeaflet = { ...Leaflet, latLngBounds: (coordinates) => coordinates };
  const framing = positions.slice(0, 20);
  assert.equal(applyForthMapViewCommand(map, boundsLeaflet, { type: "fit_all", sequence: 3 }, positions, new Map(), false, framing), true);
  assert.equal(fitted.length, 1);
  assert.deepEqual(fitted[0], before);
  assert.equal(fitted[0].length, 21);
  assert.deepEqual(positions, before);
});
