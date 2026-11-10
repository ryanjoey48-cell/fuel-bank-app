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
  loaded._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, file);
  return loaded.exports;
}

const { FORTH_SPEED_WATCH_DEFAULT_LIMIT, getForthSpeedWatchEntries } = load("lib/forth-speed-watch.ts");
const base = { gpsDeviceId: "1", vehicleRegistration: "A", speed: 45, engineOn: true, timestampStatus: "current", lastGpsTimestamp: "2026-10-27T12:00:00Z", coordinateStatus: "valid", latitude: 13.7, longitude: 100.5, gpsConnectivity: "connected", positionQuality: "gps" };

test("speed watch ranks current moving reports, deduplicates latest device and leaves inputs intact", () => {
  const records = [
    { ...base, gpsDeviceId: "1", speed: 99, lastGpsTimestamp: "2026-10-27T11:00:00Z" },
    { ...base, gpsDeviceId: "1", speed: 40 },
    { ...base, gpsDeviceId: "2", vehicleRegistration: "B", speed: 72, positionQuality: "no_gps" },
    { ...base, gpsDeviceId: "3", vehicleRegistration: "C", speed: 88, timestampStatus: "stale" },
    { ...base, gpsDeviceId: "4", vehicleRegistration: "D", speed: 100, engineOn: false },
    { ...base, gpsDeviceId: "5", vehicleRegistration: "E", speed: 0 }
  ];
  const original = structuredClone(records);
  assert.deepEqual(getForthSpeedWatchEntries(records).map(({ key, record, gpsVerified }) => [key, record.speed, gpsVerified]), [["device:2", 72, false], ["device:1", 40, true]]);
  assert.deepEqual(records, original);
});

test("speed watch default limit is five and null returns the full ranking", () => {
  assert.equal(FORTH_SPEED_WATCH_DEFAULT_LIMIT, 5);
  const records = Array.from({ length: 8 }, (_, index) => ({
    ...base,
    gpsDeviceId: String(index + 1),
    vehicleRegistration: `V${index + 1}`,
    speed: 90 - index
  }));
  assert.equal(getForthSpeedWatchEntries(records).length, 5);
  assert.equal(getForthSpeedWatchEntries(records, null).length, 8);
  assert.deepEqual(getForthSpeedWatchEntries(records, 1).map(({ key }) => key), ["device:1"]);
});

test("speed watch ignores invalid speeds and applies the visible limit", () => {
  const records = [{ ...base, speed: NaN }, { ...base, gpsDeviceId: "2", speed: Infinity }, { ...base, gpsDeviceId: "3", speed: 35 }];
  assert.deepEqual(getForthSpeedWatchEntries(records, 0), []);
  assert.deepEqual(getForthSpeedWatchEntries(records, 1).map(({ key }) => key), ["device:3"]);
});

test("Speed Watch has a compact header launcher that opens the existing panel", () => {
  const centre = fs.readFileSync(path.join(root, "components/forth-tracking-centre.tsx"), "utf8");
  assert.match(centre, /ForthSpeedWatchLauncher/);
  assert.match(centre, /forth-float-actions[\s\S]*?<ForthSpeedWatchLauncher/);
  const openHandler = centre.slice(centre.indexOf("const openSpeedWatch"), centre.indexOf("const handleAttentionOpenChange"));
  assert.doesNotMatch(openHandler, /setWorkspaceMode|setSelectedKey|setMapCommand|setCameraMode|clearPlayback/);
  assert.match(openHandler, /setSpeedWatchOpen/);
  assert.match(centre, /onClick=\{openSpeedWatch\}/);
  assert.match(centre, /forth-speed-watch-panel/);
  assert.doesNotMatch(centre, /forth-speed-watch-slot/);
  assert.match(centre, /from "@\/components\/forth-speed-watch"/);
  assert.match(centre, /onFocusMap/);
  const speedWatch = fs.readFileSync(path.join(root, "components/forth-speed-watch.tsx"), "utf8");
  assert.match(speedWatch, /forth-speed-watch-focus/);
  assert.match(speedWatch, /FORTH_SPEED_WATCH_DEFAULT_LIMIT/);
});

test("Speed Watch launcher shows a separate vehicle count badge", () => {
  const React = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  const { ForthSpeedWatchLauncher } = load("components/forth-speed-watch.tsx");
  const records = [{ ...base, speed: 69 }, { ...base, gpsDeviceId: "2", vehicleRegistration: "B", speed: 50 }];
  const markup = renderToStaticMarkup(React.createElement(ForthSpeedWatchLauncher, { records, available: true, language: "en", pressed: false, onClick() {} }));
  assert.match(markup, /forth-speed-watch-launcher-label">Speed watch<\/span>/);
  assert.match(markup, /forth-speed-watch-launcher-badge[^>]*>2<\/strong>/);
  assert.doesNotMatch(markup, /Speed watch<\/span><strong>69/);
});

test("managed Speed Watch panel keeps a clear close action and compact device context", () => {
  const React = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  const { ForthSpeedWatch } = load("components/forth-speed-watch.tsx");
  const record = { ...base, vehicleRegistration: "78-6996", speed: 72 };
  const markup = renderToStaticMarkup(React.createElement(ForthSpeedWatch, {
    records: [record], available: true, language: "en", forceOpen: true,
    onSelect() {}, onClose() {}, confirmedDriverFor: () => "Confirmed driver"
  }));
  assert.match(markup, /forth-speed-watch-heading/);
  assert.match(markup, /aria-label="Close Speed watch"/);
  assert.match(markup, /forth-speed-watch-primary/);
  assert.match(markup, /78-6996/);
  assert.match(markup, /Confirmed driver/);
  assert.match(markup, /Device alert/);
  assert.match(markup, /GPS verified/);
  assert.doesNotMatch(markup, /<button[^>]*class="forth-speed-watch-toggle is-static"/);
});
