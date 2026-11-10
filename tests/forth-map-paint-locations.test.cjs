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
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
    }).outputText,
    file
  );
  return loaded.exports;
}

const {
  selectForthMapPaintLocations,
  isEesDepotOrOfficeCategory
} = load("lib/forth-gps-map-locations.ts");

test("default paint policy hides all Forth pins until layer or selection", () => {
  const locations = [{ id: "forth:1" }, { id: "forth:2" }, { id: "forth:3" }];
  assert.deepEqual(selectForthMapPaintLocations(locations, { layerOn: false, selectedId: null }), []);
  assert.deepEqual(
    selectForthMapPaintLocations(locations, { layerOn: false, selectedId: "forth:2" }).map((row) => row.id),
    ["forth:2"]
  );
  assert.equal(
    selectForthMapPaintLocations(locations, { layerOn: true, selectedId: null }).length,
    3
  );
});

test("depot/office overlay recognises Directory categories", () => {
  assert.equal(isEesDepotOrOfficeCategory("Depot"), true);
  assert.equal(isEesDepotOrOfficeCategory("Office"), true);
  assert.equal(isEesDepotOrOfficeCategory("Customer"), false);
});

test("tracking centre defaults customer pin layer off", () => {
  const source = fs.readFileSync(path.join(root, "components/forth-tracking-centre.tsx"), "utf8");
  assert.match(source, /useState\(false\);\s*\n\s*const \[depotOfficeLayerOn/);
  assert.match(source, /selectForthMapPaintLocations/);
  assert.doesNotMatch(
    source,
    /setSelectedLocationId\(location\.id\);\s*\n\s*setLocationsLayerOn\(true\);/
  );
});
