"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const h = require("./helpers/invoice-compare.cjs");
const f = h.lib("finance-demo-centre.ts");
const r = h.lib("finance-records.ts");
const access = h.lib("finance-intake-access.ts");
const act = (s, a, who = "admin") => f.applyAction(s, a, who);
const receipts = (toll) => ({ amounts: Object.fromEntries(f.ADMIN_RECEIPT_FIELDS.map((k) => [k, k === "toll" ? toll : null])), notes: "", customerJobNumber: null });
const job = (s, wo) => s.bookings.find((b) => f.confirmedWorkOrder(b) === wo);

function seedSheet() {
  let s = f.createEmptyOwnerState();
  const jobs = [
    ["a1", "6424", "64-8665", 320, 13110],
    ["a2", "5838", "68-7154", 365, 5000],
    ["a3", "6956", "79-5318", 365, 5000]
  ];
  for (const [id, wo, plate, toll] of jobs) {
    s = f.linkDiaryWorkOrder(s, {
      id, booking_id: id, client_id: "apl", client_name: "APL", booking_date: "2026-10-26",
      pickup: "Sirtec", dropoff: "CAL-COMP", vehicle: null, vehicle_registration: plate, driver: "D"
    }, wo, "admin", receipts(toll));
  }
  s = act(s, { type: "sheet_create", clientId: "apl", label: "Sirtec" });
  const sheetId = s.billingSheets.at(-1).id;
  for (const [, wo, , toll, transport] of jobs) {
    const jb = job(s, wo);
    s = act(s, { type: "sheet_add_paper", sheetId, workOrder: wo });
    s = act(s, { type: "sheet_set_transport", sheetId, jobId: jb.id, transport: { amount: transport, source: "manual", overrideReason: "Local APL demo figure — not verified tariff evidence" } });
    s = act(s, { type: "sheet_set_extra", sheetId, jobId: jb.id, kind: "toll", value: { decision: "bill", amount: toll, note: "Demo toll" } });
  }
  return { s, sheetId };
}

test("APL demo figures: transport + tolls total 24,160 with extras 1,050 once; not stored as verified rates", () => {
  const { s, sheetId } = seedSheet();
  const sheet = s.billingSheets.find((item) => item.id === sheetId);
  const summary = f.sheetSummary(s, sheet);
  assert.equal(summary.transportSatang, 2311000);
  assert.equal(summary.approvedExtrasSatang, 105000);
  assert.equal(summary.totalSatang, 2416000);
  for (const id of sheet.jobIds) {
    const line = sheet.lines[id];
    assert.equal(line.transport.source, "manual");
    assert.match(line.transport.overrideReason, /not verified tariff/i);
  }
  const batch = r.buildFinanceRecords(s).batches.find((item) => item.sheetId === sheetId);
  assert.equal(batch.totalSatang, 2416000);
  assert.equal(batch.tollSatang, 105000);
});

test("sheet approval: draft → ready_for_review → approved; finance cannot approve; double-click is idempotent; never issued", () => {
  let { s, sheetId } = seedSheet();
  const sheet = () => s.billingSheets.find((x) => x.id === sheetId);
  assert.equal(r.sheetLifecycle(s, sheet()), "draft");
  assert.throws(() => act(s, { type: "sheet_approve", sheetId }), /FINANCE_SHEET_NOT_READY/);
  s = act(s, { type: "sheet_mark_ready", sheetId });
  assert.equal(r.sheetLifecycle(s, sheet()), "ready_for_review");
  assert.throws(() => act(s, { type: "sheet_approve", sheetId }, "finance"), /DEMO_ROLE_REQUIRED/);
  assert.throws(() => act(s, { type: "sheet_approve", sheetId }, "office"), /DEMO_ROLE_REQUIRED/);
  s = act(s, { type: "sheet_approve", sheetId, note: "Owner reviewed APL demo pack" }, "admin");
  assert.equal(r.sheetLifecycle(s, sheet()), "approved");
  assert.ok(sheet().approvedAt);
  assert.equal(sheet().approvedBy, "admin");
  assert.equal(sheet().officialTrn, null);
  assert.equal(s.audit.filter((e) => e.action === "sheet_approve" && e.subject === f.sheetTrnLabel(sheet())).length, 1);
  const before = sheet().approvedAt;
  s = act(s, { type: "sheet_approve", sheetId }, "admin");
  assert.equal(sheet().approvedAt, before);
  assert.equal(s.audit.filter((e) => e.action === "sheet_approve" && e.subject === f.sheetTrnLabel(sheet())).length, 1);
  assert.throws(() => act(s, { type: "sheet_set_transport", sheetId, jobId: sheet().jobIds[0], transport: { amount: 1, source: "manual" } }), /FINANCE_SHEET_LOCKED/);
  assert.throws(() => act(s, { type: "sheet_reopen", sheetId, reason: "short" }), /FINANCE_REOPEN_AFTER_APPROVAL/);
  s = act(s, { type: "sheet_reopen", sheetId, reason: "Material correction after management approval" });
  assert.equal(r.sheetLifecycle(s, sheet()), "needs_correction");
  assert.equal(sheet().approvedAt, null);
  assert.equal(sheet().readyForApprovalAt, null);
});

test("reject approval returns the sheet for correction with an audit trail", () => {
  let { s, sheetId } = seedSheet();
  s = act(s, { type: "sheet_mark_ready", sheetId });
  assert.throws(() => act(s, { type: "sheet_reject_approval", sheetId, reason: "too short" }, "management"), /FINANCE_REJECT_REASON_REQUIRED/);
  s = act(s, { type: "sheet_reject_approval", sheetId, reason: "Toll evidence incomplete for WO 6424" }, "management");
  const sheet = s.billingSheets.find((x) => x.id === sheetId);
  assert.equal(sheet.readyForApprovalAt, null);
  assert.equal(r.sheetLifecycle(s, sheet), "needs_correction");
  assert.ok(s.audit.some((e) => e.action === "sheet_reject_approval"));
});

test("authenticated Admin is mapped as the approval actor; desk finance role cannot approve through the gate helper", () => {
  assert.equal(access.canApproveFinanceBilling({ role: "admin", status: "active" }, "finance", false), true);
  assert.equal(access.canApproveFinanceBilling({ role: "office", status: "active" }, "finance", false), false);
  assert.equal(access.financeActionActor({ role: "admin", status: "active" }, "finance", false, "sheet_approve"), "admin");
  assert.equal(access.financeActionActor({ role: "office", status: "active" }, "approver", true, "sheet_approve"), "approver");
});
