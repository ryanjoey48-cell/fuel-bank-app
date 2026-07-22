const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

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

const { detectDispatchConflicts } = loadTypeScriptModule("lib/dispatch.ts");

function booking(overrides) {
  return {
    id: overrides.id,
    booking_date: "2026-07-22",
    pickup_time: Object.prototype.hasOwnProperty.call(overrides, "pickup_time") ? overrides.pickup_time : "09:00",
    driver: Object.prototype.hasOwnProperty.call(overrides, "driver") ? overrides.driver : "Somchai",
    vehicle: Object.prototype.hasOwnProperty.call(overrides, "vehicle") ? overrides.vehicle : "61-2835",
    estimated_duration_minutes: Object.prototype.hasOwnProperty.call(overrides, "estimated_duration_minutes") ? overrides.estimated_duration_minutes : 90,
    route_duration_seconds: Object.prototype.hasOwnProperty.call(overrides, "route_duration_seconds") ? overrides.route_duration_seconds : null
  };
}

test("detects driver overlap", () => {
  const conflicts = detectDispatchConflicts([
    booking({ id: "a", pickup_time: "09:00", driver: "Somchai", vehicle: "A", estimated_duration_minutes: 90 }),
    booking({ id: "b", pickup_time: "10:00", driver: "Somchai", vehicle: "B", estimated_duration_minutes: 60 })
  ]);
  assert.equal(conflicts.filter((conflict) => conflict.kind === "driver" && conflict.severity === "confirmed").length, 2);
});

test("detects vehicle overlap", () => {
  const conflicts = detectDispatchConflicts([
    booking({ id: "a", pickup_time: "09:00", driver: "A", vehicle: "61-2835", estimated_duration_minutes: 90 }),
    booking({ id: "b", pickup_time: "10:00", driver: "B", vehicle: "61 2835", estimated_duration_minutes: 60 })
  ]);
  assert.equal(conflicts.filter((conflict) => conflict.kind === "vehicle" && conflict.severity === "confirmed").length, 2);
});

test("different drivers and vehicles do not conflict", () => {
  const conflicts = detectDispatchConflicts([
    booking({ id: "a", pickup_time: "09:00", driver: "A", vehicle: "A", estimated_duration_minutes: 90 }),
    booking({ id: "b", pickup_time: "09:15", driver: "B", vehicle: "B", estimated_duration_minutes: 90 })
  ]);
  assert.equal(conflicts.length, 0);
});

test("adjacent jobs are clear without a turnaround buffer and conflict with buffer", () => {
  const jobs = [
    booking({ id: "a", pickup_time: "09:00", estimated_duration_minutes: 60 }),
    booking({ id: "b", pickup_time: "10:00", estimated_duration_minutes: 60 })
  ];
  assert.equal(detectDispatchConflicts(jobs, { turnaroundBufferMinutes: 0 }).length, 0);
  assert.equal(detectDispatchConflicts(jobs, { turnaroundBufferMinutes: 30 }).length, 4);
});

test("missing pickup time does not produce a conflict", () => {
  const conflicts = detectDispatchConflicts([
    booking({ id: "a", pickup_time: null }),
    booking({ id: "b", pickup_time: "09:30" })
  ]);
  assert.equal(conflicts.length, 0);
});

test("missing duration produces possible nearby conflict", () => {
  const conflicts = detectDispatchConflicts([
    booking({ id: "a", pickup_time: "09:00", estimated_duration_minutes: null }),
    booking({ id: "b", pickup_time: "10:00", estimated_duration_minutes: 90 })
  ]);
  assert.equal(conflicts.every((conflict) => conflict.severity === "possible"), true);
  assert.equal(conflicts.length, 4);
});

test("unassigned bookings do not conflict", () => {
  const conflicts = detectDispatchConflicts([
    booking({ id: "a", pickup_time: "09:00", driver: "", vehicle: "", estimated_duration_minutes: 90 }),
    booking({ id: "b", pickup_time: "09:30", driver: "", vehicle: "", estimated_duration_minutes: 90 })
  ]);
  assert.equal(conflicts.length, 0);
});

test("editing an existing booking does not conflict with itself", () => {
  const conflicts = detectDispatchConflicts([
    booking({ id: "a", pickup_time: "09:00", estimated_duration_minutes: 90 }),
    booking({ id: "a", pickup_time: "09:15", estimated_duration_minutes: 90 })
  ]);
  assert.equal(conflicts.length, 0);
});
