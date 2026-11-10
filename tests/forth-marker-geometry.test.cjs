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
  FORTH_MARKER_ICON_ANCHOR,
  FORTH_MARKER_ICON_SIZE,
  forthMarkerDiscPxForZoom,
  getForthScreenOverlapGroups,
  forthMarkerAnchorErrorMeters,
  forthMarkerAnchorIsStable,
  forthMetersPerPixelAtEquator,
  planForthMarkerLabels
} = loadTypeScript("lib/forth-marker-geometry.ts");

test("marker icon geometry anchors on the disc centre only", () => {
  assert.deepEqual(FORTH_MARKER_ICON_SIZE, [42, 42]);
  assert.deepEqual(FORTH_MARKER_ICON_ANCHOR, [21, 21]);
  const map = fs.readFileSync(path.join(root, "components/forth-tracking-map.tsx"), "utf8");
  assert.ok(map.includes("forthMarkerIconSizeForZoom"));
  assert.ok(map.includes("forthMarkerIconAnchorForZoom"));
  assert.equal(map.includes("iconSize: [228, 40]"), false);
  const css = fs.readFileSync(path.join(root, "components/forth-tracking-map.module.css"), "utf8");
  // Disc size comes from Leaflet iconSize (zoom-scaled); CSS must not force a fixed 36px box.
  assert.match(css, /\.vehicleMarker\s*\{[\s\S]*?width:\s*100%\s*!important/);
  assert.match(css, /\.vehicleMarkerDot\s*\{[\s\S]*?width:\s*100%/);
  // Leaflet iconAnchor depends on negative margins; !important zero margin breaks geography.
  assert.equal(/margin:\s*0\s*!important/.test(css), false);
});

test("regional and core vehicles retain a recognisable icon while registration labels use spare space", () => {
  for (const zoom of [6, 7, 9, 11, 13, 16]) {
    assert.ok(forthMarkerDiscPxForZoom(zoom) >= 24);
  }
  const labels = planForthMarkerLabels([
    { key: "A", x: 100, y: 100, iconSize: 28, labelWidth: 74, labelHeight: 26, selected: false, reveal: false, priority: 1 },
    { key: "B", x: 225, y: 118, iconSize: 28, labelWidth: 74, labelHeight: 26, selected: false, reveal: false, priority: 1 },
    { key: "C", x: 100, y: 100, iconSize: 28, labelWidth: 74, labelHeight: 26, selected: true, reveal: false, priority: 1 }
  ], { width: 420, height: 260 }, 9);
  assert.equal(labels.find((label) => label.key === "C").visible, true);
  assert.ok(labels.filter((label) => label.visible).length >= 2);
  // Planning changes only label rectangles. Symbol coordinates never enter the result.
  assert.equal(labels.some((label) => "x" in label || "y" in label), false);
});

test("depot / Bangkok stacks keep every on-screen registration visible and fanned", () => {
  const stack = ["64-0359", "64-5954", "61-6672", "ฒอ-8453", "701-5145", "3ฒล4565"].map((key, index) => ({
    key,
    x: 210 + (index % 2),
    y: 140 + (index % 3),
    iconSize: 32,
    labelWidth: 82,
    labelHeight: 24,
    selected: false,
    reveal: false,
    priority: index === 0 ? 2 : 1
  }));
  const labels = planForthMarkerLabels(stack, { width: 640, height: 420 }, 9);
  assert.equal(labels.filter((label) => label.visible).length, stack.length);
  const slots = new Set(labels.map((label) => `${Math.round(label.left)}:${Math.round(label.top)}`));
  assert.equal(slots.size, stack.length, "stacked labels must occupy distinct screen slots");
  const tops = labels.map((label) => label.top);
  assert.ok(Math.max(...tops) - Math.min(...tops) >= 40, "stacked labels must fan vertically so regs stay readable");
});

test("a selected registration never detaches from an offscreen geographic anchor", () => {
  const labels = planForthMarkerLabels([
    { key: "offscreen", x: 900, y: 400, iconSize: 36, labelWidth: 90, labelHeight: 24, selected: true, reveal: false, priority: 9 }
  ], { width: 420, height: 260 }, 15);
  assert.equal(labels[0].visible, false);
});

test("screen-overlap selectors include each connected obscured symbol once", () => {
  const groups = getForthScreenOverlapGroups([
    { key: "A", x: 100, y: 100 },
    { key: "B", x: 110, y: 100 },
    { key: "C", x: 120, y: 100 },
    { key: "D", x: 250, y: 100 }
  ], 12);
  assert.deepEqual(groups, [["A", "B", "C"]]);
  // Square Leaflet icon boxes overlap diagonally even when their centres are
  // farther apart than a circular distance threshold.
  assert.deepEqual(getForthScreenOverlapGroups([
    { key: "NE", x: 130, y: 130 },
    { key: "SW", x: 100, y: 100 },
    { key: "FAR", x: 210, y: 210 }
  ], 38), [["NE", "SW"]]);
});

test("disc-centre alignment stays stable across representative zoom levels", () => {
  const sourcePoint = { x: 400, y: 300 };
  const discCenter = { x: 400.4, y: 299.7 }; // sub-pixel rounding only
  const zooms = [8, 10, 12, 14, 16, 18];
  const errors = zooms.map((zoom) => ({
    zoom,
    errorMeters: forthMarkerAnchorErrorMeters(sourcePoint, discCenter, forthMetersPerPixelAtEquator(zoom))
  }));
  assert.ok(forthMarkerAnchorIsStable(errors));
  // A 96px horizontal drift (old wide-label icon centering) fails at low zoom.
  const drifted = zooms.map((zoom) => ({
    zoom,
    errorMeters: forthMarkerAnchorErrorMeters(sourcePoint, { x: sourcePoint.x + 96, y: sourcePoint.y }, forthMetersPerPixelAtEquator(zoom))
  }));
  assert.equal(forthMarkerAnchorIsStable(drifted), false);
  assert.ok(drifted.find(({ zoom }) => zoom === 8).errorMeters > 5_000);
});

test("basemap init disables Leaflet zoom animation to prevent MapLibre canvas drift", () => {
  const helper = fs.readFileSync(path.join(root, "lib/ees-map-tiles-leaflet.ts"), "utf8");
  assert.ok(helper.includes("zoomAnimation: false"));
  assert.ok(helper.includes("padding: 0"));
  assert.ok(helper.includes("resyncBasemap"));
  assert.ok(helper.includes('map.on("zoomend", resyncBasemap)'));
});
