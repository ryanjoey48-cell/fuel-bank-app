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
  loaded._compile(
    ts.transpileModule(fs.readFileSync(file, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React }
    }).outputText,
    file
  );
  return loaded.exports;
}

const {
  forthVehicleIconCategory,
  forthVehicleIconSvgPaths,
  buildForthVehicleMarkerGlyphHtml,
  forthVehicleIconLabel
} = load("lib/forth-vehicle-icons.ts");

test("vehicle icon categories map confirmed classes", () => {
  assert.equal(forthVehicleIconCategory("four_wheeler"), "four_wheeler");
  assert.equal(forthVehicleIconCategory("six_wheeler"), "six_wheeler");
  assert.equal(forthVehicleIconCategory("six_plus_six_wheeler"), "six_plus_six_wheeler");
  assert.equal(forthVehicleIconCategory("eighteen_wheeler"), "eighteen_wheeler");
  assert.equal(forthVehicleIconCategory("unclassified"), "unclassified");
});

test("each category has a distinct SVG path set", () => {
  const four = forthVehicleIconSvgPaths("four_wheeler");
  const six = forthVehicleIconSvgPaths("six_wheeler");
  const artic = forthVehicleIconSvgPaths("eighteen_wheeler");
  assert.ok(four.includes("<circle"));
  assert.notEqual(four, six);
  assert.notEqual(six, artic);
  assert.match(buildForthVehicleMarkerGlyphHtml("eighteen_wheeler", "truck"), /viewBox="0 0 24 24"/);
  assert.match(forthVehicleIconLabel("four_wheeler", "en"), /pickup/i);
});

test("map markers use vehicle icon helper and trust marks", () => {
  const map = fs.readFileSync(path.join(root, "components/forth-tracking-map.tsx"), "utf8");
  const css = fs.readFileSync(path.join(root, "components/forth-tracking-map.module.css"), "utf8");
  assert.match(map, /buildForthVehicleMarkerGlyphHtml/);
  assert.match(map, /vehicleMarkerTrust/);
  assert.match(css, /\.vehicleMarkerTrust\[data-trust="verified"\]/);
  assert.match(css, /\.vehicleMarkerTrust\[data-trust="stale"\]/);
});
