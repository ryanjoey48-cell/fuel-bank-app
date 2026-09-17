const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const filename = path.resolve("lib/grease-maintenance.ts");
const loaded = new Module(filename, module);
loaded._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
const { greaseStatus, greaseNextDue, greaseTotal, greaseToday, buildGreaseRows } = loaded.exports;

test("annual due dates use calendar years and clamp leap day", () => {
  assert.equal(greaseNextDue("2024-02-29"), "2025-02-28");
  assert.equal(greaseNextDue("2023-03-01"), "2024-03-01");
  assert.equal(greaseNextDue("2025-12-31"), "2026-12-31");
  assert.equal(greaseNextDue("2025-02-29"), null);
});
test("status boundaries include today and exactly 30 days", () => {
  assert.equal(greaseStatus("2025-10-15", "2026-09-14").status, "ok");
  assert.equal(greaseStatus("2025-10-14", "2026-09-14").status, "dueSoon");
  assert.deepEqual(greaseStatus("2025-09-14", "2026-09-14"), { status: "dueSoon", dueDate: "2026-09-14", days: 0 });
  assert.equal(greaseStatus("2025-09-13", "2026-09-14").status, "overdue");
  assert.equal(greaseStatus(null, "2026-09-14").status, "noRecord");
  assert.equal(greaseStatus("2026-09-15", "2026-09-14").status, "noRecord");
});
test("Thailand date changes at 17:00 UTC", () => {
  assert.equal(greaseToday(new Date("2026-09-13T16:59:59Z")), "2026-09-13");
  assert.equal(greaseToday(new Date("2026-09-13T17:00:00Z")), "2026-09-14");
});
test("latest valid service wins regardless of insertion order, voiding, or registration changes", () => {
  const vehicles = [{ id: "v1", vehicle_reg: "NEW-REG", active: true }, { id: "v2", vehicle_reg: "OTHER", active: true }];
  const record = (id, date, extra = {}) => ({ id, vehicle_id: "v1", service_date: date, created_at: "2026-09-14T00:00:00Z", is_void: false, ...extra });
  const records = [record("a", "2025-01-01"), record("b", "2026-01-01"), record("c", "2026-08-01", { is_void: true }), record("d", "2026-12-01"), record("e", "2026-02-30")];
  const drivers = [{ name: "Current", active: true, assigned_vehicle_id: "v1" }, { name: "Old", active: false, assigned_vehicle_id: "v1" }, { name: "Other", active: true, assigned_vehicle_id: "v2" }];
  const rows = buildGreaseRows(vehicles, drivers, records, "2026-09-14");
  assert.equal(rows[0].latest.id, "b"); assert.equal(rows[0].driver, "Current");
  assert.equal(rows[0].dueDate, "2027-01-01"); assert.equal(rows[1].status, "noRecord");
  records[1].is_void = true;
  assert.equal(buildGreaseRows(vehicles, drivers, records, "2026-09-14")[0].latest.id, "a");
  records[1].is_void = false;
  assert.equal(buildGreaseRows(vehicles, drivers, records, "2026-09-14")[0].latest.id, "b");
});
test("same-day services have deterministic latest-record selection", () => {
  const rows = buildGreaseRows([{ id: "v" }], [], [
    { id: "a", vehicle_id: "v", service_date: "2026-01-01", created_at: "2026-01-02T00:00:00Z" },
    { id: "b", vehicle_id: "v", service_date: "2026-01-01", created_at: "2026-01-02T00:00:00Z" },
  ], "2026-09-14");
  assert.equal(rows[0].latest.id, "b");
});
test("costs support optional values, zero quantities, decimal quantities and cent rounding", () => {
  assert.equal(greaseTotal([]), 0);
  assert.equal(greaseTotal([{ quantity: null, unit_cost: 25.5 }, { quantity: 2, unit_cost: null }]), 25.5);
  assert.equal(greaseTotal([{ quantity: 0, unit_cost: 100 }]), 0);
  assert.equal(greaseTotal([{ quantity: 1.5, unit_cost: 10.25 }]), 15.38);
  assert.equal(greaseTotal([{ quantity: 1.01, unit_cost: 0.5 }]), 0.51);
  assert.equal(greaseTotal([{ quantity: 1, unit_cost: 0.1 }, { quantity: 1, unit_cost: 0.2 }]), 0.3);
});
