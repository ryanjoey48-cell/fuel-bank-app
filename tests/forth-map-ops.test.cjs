const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");

function loadTypeScript(relative) {
  const file = path.join(root, relative);
  const module = new Module(file);
  module.filename = file;
  module.paths = Module._nodeModulePaths(path.dirname(file));
  module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, file);
  return module.exports;
}

const {
  FORTH_BANGKOK_OPS_BOUNDS,
  FORTH_THAILAND_NEIGHBOURS_BOUNDS,
  classifyForthMapOutliers,
  classifyOutsideCoreOperations,
  forthReportedCoordinateClipboardText,
  forthReportedCoordinateMapsUrl,
  isWithinForthBangkokOpsBounds,
  isWithinForthCoreOpsBounds,
  isWithinForthThailandNeighboursBounds
} = loadTypeScript("lib/forth-map-ops.ts");

const {
  forthMarkerAnchorErrorMeters,
  forthMarkerAnchorIsStable,
  forthMetersPerPixelAtEquator
} = loadTypeScript("lib/forth-marker-geometry.ts");

test("Core Operations bounds cover Bangkok–Eastern Seaboard and exclude Phuket", () => {
  assert.ok(isWithinForthCoreOpsBounds(13.7235, 100.7485)); // Lat Krabang
  assert.ok(isWithinForthBangkokOpsBounds(13.7563, 100.5018)); // Bangkok CBD
  assert.ok(isWithinForthCoreOpsBounds(13.082, 100.883)); // Laem Chabang
  assert.ok(isWithinForthCoreOpsBounds(12.68, 101.28)); // Rayong area
  assert.equal(isWithinForthCoreOpsBounds(8.4847, 98.6238), false); // Phuket-area
  assert.equal(isWithinForthCoreOpsBounds(18.584, 99.043), false); // North
  const [[south, west], [north, east]] = FORTH_BANGKOK_OPS_BOUNDS;
  assert.ok(south < north && west < east);
});

test("Thailand & neighbours camera covers Thailand without becoming SE Asia-wide", () => {
  assert.ok(isWithinForthThailandNeighboursBounds(13.75, 100.5));
  assert.ok(isWithinForthThailandNeighboursBounds(8.48, 98.62)); // Phuket still in regional view
  assert.ok(isWithinForthThailandNeighboursBounds(17.97, 102.6)); // Vientiane area
  assert.equal(isWithinForthThailandNeighboursBounds(1.35, 103.8), false); // Singapore excluded
  const [[south, west], [north, east]] = FORTH_THAILAND_NEIGHBOURS_BOUNDS;
  assert.ok(south < north && west < east);
});

test("outside Core Operations is distinct from Fit Fleet majority outliers", () => {
  const points = [
    { key: "bkk", latitude: 13.75, longitude: 100.55 },
    { key: "rayong", latitude: 12.68, longitude: 101.28 },
    { key: "phuket", latitude: 8.48, longitude: 98.62 },
    { key: "north", latitude: 18.58, longitude: 99.04 }
  ];
  const { inside, outside } = classifyOutsideCoreOperations(points);
  assert.ok(inside.includes("bkk"));
  assert.ok(inside.includes("rayong"));
  assert.ok(outside.includes("phuket"));
  assert.ok(outside.includes("north"));
  assert.deepEqual(points.find((point) => point.key === "phuket"), { key: "phuket", latitude: 8.48, longitude: 98.62 });
});

test("marker symbol retains a regional minimum and stays centred on source coordinates", () => {
  const { forthMarkerDiscPxForZoom, forthMarkerIconAnchorForZoom } = loadTypeScript("lib/forth-marker-geometry.ts");
  assert.equal(forthMarkerDiscPxForZoom(6), 28);
  assert.equal(forthMarkerDiscPxForZoom(9), 32);
  assert.equal(forthMarkerDiscPxForZoom(10), 36);
  assert.equal(forthMarkerDiscPxForZoom(11), 36);
  assert.equal(forthMarkerDiscPxForZoom(14), 42);
  assert.deepEqual(forthMarkerIconAnchorForZoom(10), [18, 18]);
  assert.deepEqual(forthMarkerIconAnchorForZoom(14), [21, 21]);
});

test("outlier classification flags distant Forth reports without moving coordinates", () => {
  const points = [
    { key: "bkk-1", latitude: 13.75, longitude: 100.55 },
    { key: "bkk-2", latitude: 13.72, longitude: 100.60 },
    { key: "bkk-3", latitude: 13.70, longitude: 100.75 },
    { key: "bkk-4", latitude: 13.68, longitude: 100.80 },
    { key: "phuket", latitude: 8.48, longitude: 98.62 },
    { key: "north", latitude: 18.58, longitude: 99.04 }
  ];
  const { inViewMajority, outliers } = classifyForthMapOutliers(points);
  assert.ok(inViewMajority.includes("bkk-1"));
  assert.ok(outliers.includes("phuket"));
  assert.ok(outliers.includes("north"));
  // Source coordinates are never rewritten by classification.
  assert.deepEqual(points.find((point) => point.key === "phuket"), {
    key: "phuket",
    latitude: 8.48,
    longitude: 98.62
  });
});

test("live Forth snapshot gulf-chain pattern is geographic spread not lat/lng swap", () => {
  const probePath = path.join(root, "tmp/map-validation/probe-coords.json");
  if (!fs.existsSync(probePath)) {
    // Allow CI without a live probe file.
    assert.ok(true);
    return;
  }
  const payload = JSON.parse(fs.readFileSync(probePath, "utf8"));
  const markers = payload.markers || [];
  assert.ok(markers.length >= 10);
  const inThailand = markers.filter((m) => m.lat > 5 && m.lat < 21 && m.lng > 97 && m.lng < 106);
  const ifSwapped = markers.filter((m) => m.lng > 5 && m.lng < 21 && m.lat > 97 && m.lat < 106);
  assert.equal(inThailand.length, markers.length);
  assert.equal(ifSwapped.length, 0);
  const { outliers } = classifyForthMapOutliers(markers.map((m) => ({
    key: String(m.id),
    latitude: m.lat,
    longitude: m.lng
  })));
  // When Full Fleet fits distant reports, outliers should be disclosed rather than relocated.
  assert.ok(outliers.length >= 1);
});

test("anchor stability covers zoom levels 5 through 18", () => {
  const sourcePoint = { x: 500, y: 400 };
  const discCenter = { x: 500.2, y: 399.8 };
  const zooms = [5, 8, 10, 12, 14, 16, 18];
  const errors = zooms.map((zoom) => ({
    zoom,
    errorMeters: forthMarkerAnchorErrorMeters(sourcePoint, discCenter, forthMetersPerPixelAtEquator(zoom))
  }));
  assert.ok(forthMarkerAnchorIsStable(errors));
  const forcedMarginBug = zooms.map((zoom) => ({
    zoom,
    errorMeters: forthMarkerAnchorErrorMeters(sourcePoint, { x: sourcePoint.x + 18, y: sourcePoint.y + 18 }, forthMetersPerPixelAtEquator(zoom))
  }));
  assert.equal(forthMarkerAnchorIsStable(forcedMarginBug), false);
  assert.ok(forcedMarginBug.find(({ zoom }) => zoom === 5).errorMeters > 20_000);
});

test("CSS and map helpers never force Leaflet iconAnchor margins to zero", () => {
  const css = fs.readFileSync(path.join(root, "components/forth-tracking-map.module.css"), "utf8");
  const globals = fs.readFileSync(path.join(root, "app/globals.css"), "utf8");
  assert.equal(/\.vehicleMarker\s*\{[^}]*margin:\s*0\s*!important/.test(css), false);
  assert.equal(/leaflet-marker-icon[^\{]*\{[^}]*margin:\s*0\s*!important/.test(globals), false);
  const map = fs.readFileSync(path.join(root, "components/forth-tracking-map.tsx"), "utf8");
  assert.ok(map.includes('type: "bangkok"') || map.includes("bangkok"));
  assert.ok(map.includes("FORTH_BANGKOK_OPS_BOUNDS"));
  assert.ok(map.includes("zoomAnimation: false") || fs.readFileSync(path.join(root, "lib/ees-map-tiles-leaflet.ts"), "utf8").includes("zoomAnimation: false"));
});

test("external map and clipboard helpers preserve Forth coordinate order", () => {
  const text = forthReportedCoordinateClipboardText(13.7563, 100.5018);
  assert.equal(text, "13.756300, 100.501800");
  const url = forthReportedCoordinateMapsUrl(13.7563, 100.5018);
  assert.match(url, /mlat=13\.7563/);
  assert.match(url, /mlon=100\.5018/);
});
