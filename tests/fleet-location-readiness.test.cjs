const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
function load(file) {
  const filename = path.join(root, file);
  const loaded = new Module(filename, module);
  loaded.require = (request) => request === "@/lib/fleet-geofence-engine" ? load("lib/fleet-geofence-engine.ts") : require(request);
  loaded._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, filename);
  return loaded.exports;
}
const { reviewEesLocationReadiness } = load("lib/fleet-location-readiness.ts");
const location = { id: "one", company_name: "Eastern Depot", province: "Chonburi",
  google_maps_url: "https://www.google.com/maps/place/eastern", verification_status: "verified" };

test("a Google Maps URL is never treated as a confirmed coordinate pin", () => {
  const result = reviewEesLocationReadiness([location], []);
  assert.deepEqual(result[0].reasons, ["pin_missing"]);
});

test("manual-confirmed valid destination pin and verified record are ready", () => {
  const pins = [{ location_id: "one", pin_type: "destination", pin_status: "manual_confirmed", latitude: 13.7, longitude: 100.6 }];
  assert.deepEqual(reviewEesLocationReadiness([location], pins), []);
  assert.deepEqual(reviewEesLocationReadiness([location], [{ ...pins[0], latitude: 95 }])[0].reasons, ["pin_missing"]);
});

test("possible duplicate directory records are flagged for human review without merging", () => {
  const result = reviewEesLocationReadiness([location, { ...location, id: "two", company_name: " eastern  depot ",
    verification_status: "needs_check" }], []);
  assert.equal(result.length, 2);
  assert.deepEqual(result[0].duplicateIds, ["two"]);
  assert.ok(result[1].reasons.includes("record_unverified"));
  assert.ok(result[1].reasons.includes("duplicate_candidate"));
});
