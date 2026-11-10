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
  buildForthGpsClusterIconHtml,
  forthGpsClusterMaxRadius,
  forthGpsDisableClusteringAtZoom,
  forthGpsClusterIconSize
} = loadTypeScript("lib/forth-gps-map-cluster.ts");

test("Forth GPS clusters use zoom-aware radius and uncluster before street zoom", () => {
  assert.ok(forthGpsClusterMaxRadius(9) >= forthGpsClusterMaxRadius(12));
  assert.ok(forthGpsClusterMaxRadius(12) > forthGpsClusterMaxRadius(14));
  assert.equal(forthGpsDisableClusteringAtZoom(), 15);
  assert.ok(forthGpsClusterMaxRadius(8) >= 60);
  assert.ok(forthGpsClusterIconSize(8)[0] <= 28);
});

test("Forth GPS cluster icons are labelled destinations, not anonymous counts", () => {
  const html = buildForthGpsClusterIconHtml(111, {
    shell: "shell",
    body: "body",
    count: "count",
    tag: "tag"
  });
  assert.match(html, />111</);
  assert.match(html, />GPS</);
  assert.match(html, /class="tag"/);
  assert.equal(buildForthGpsClusterIconHtml(1500, { shell: "s", body: "b", count: "c", tag: "t" }).includes("999+"), true);
  assert.ok(forthGpsClusterIconSize(120)[0] >= forthGpsClusterIconSize(8)[0]);
});

test("fleet map wires custom Forth GPS clustering", () => {
  const map = fs.readFileSync(path.join(root, "components/forth-tracking-map.tsx"), "utf8");
  const css = fs.readFileSync(path.join(root, "components/forth-tracking-map.module.css"), "utf8");
  assert.match(map, /forthGpsClusterIconCreateFunction/);
  assert.match(map, /classNamePrefix:\s*"forth-gps-cluster"/);
  assert.match(map, /forthGpsClusterMaxRadius/);
  assert.match(map, /FORTH_GPS_MAP_PANE/);
  assert.match(map, /vehicleMarkerActivityBadge/);
  assert.match(css, /\.forthGpsClusterTag/);
  assert.match(css, /\.forthGpsClusterBody/);
});
