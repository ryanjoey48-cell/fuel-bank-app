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
  FORTH_MONITOR_DISPLAY_DETAILED,
  FORTH_MONITOR_DISPLAY_OPERATIONS,
  normalizeForthMonitorDisplay,
  readForthMonitorDisplay,
  resolveForthMonitorDisplayPreset,
  writeForthMonitorDisplay
} = load("lib/forth-monitor-display.ts");

test("monitor display presets resolve and persist without inventing fields", () => {
  assert.equal(resolveForthMonitorDisplayPreset(FORTH_MONITOR_DISPLAY_OPERATIONS), "operations");
  assert.equal(resolveForthMonitorDisplayPreset(FORTH_MONITOR_DISPLAY_DETAILED), "detailed");
  assert.equal(resolveForthMonitorDisplayPreset(normalizeForthMonitorDisplay({ driver: false, location: false })), "custom");

  const storage = new Map();
  writeForthMonitorDisplay({ setItem: (key, value) => storage.set(key, value) }, FORTH_MONITOR_DISPLAY_OPERATIONS);
  assert.deepEqual(
    readForthMonitorDisplay({ getItem: (key) => storage.get(key) ?? null }),
    FORTH_MONITOR_DISPLAY_OPERATIONS
  );
});
