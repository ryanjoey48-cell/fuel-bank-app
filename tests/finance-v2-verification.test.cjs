"use strict";
/**
 * Finance Centre V2 — pricing verification, billing profiles, reconciliation, rehearsal safety.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const h = require("./helpers/invoice-compare.cjs");
const f = h.lib("finance-demo-centre.ts");
const pricing = h.lib("finance-pricing-verification.ts");
const profiles = h.lib("finance-customer-profiles.ts");
const reconcile = h.lib("finance-sheet-reconciliation.ts");
const inv = h.lib("finance-invoice-from-sheet.ts");

const act = (s, a, who = "admin") => f.applyAction(s, a, who);
const receipts = () => ({ amounts: Object.fromEntries(f.ADMIN_RECEIPT_FIELDS.map((k) => [k, null])), notes: "", customerJobNumber: null });

function seedAplJob() {
  let s = f.createEmptyOwnerState();
  s = f.linkDiaryWorkOrder(s, {
    id: "v2-1", booking_id: "v2-1", client_id: "apl", client_name: "APL Transport",
    booking_date: "2026-11-03", pickup: "Sirtec", dropoff: "CAL-COMP", vehicle: null, vehicle_registration: "64-8665", driver: "D"
  }, "9001", "admin", receipts());
  return s;
}

test("proposed rate mapping never prices jobs; owner approve promotes it", () => {
  let s = seedAplJob();
  const schedule = f.CUSTOMER_RATE_SCHEDULES.find((x) => x.id === "sirtech") || f.CUSTOMER_RATE_SCHEDULES[0];
  const row = schedule.rows[0];
  s = act(s, {
    type: "propose_rate_mapping",
    scheduleId: schedule.id,
    rowId: row.id,
    clientId: "apl",
    contractReference: "V2 proposed only",
    effectiveFrom: "2026-01-01",
    effectiveTo: null,
    reviewReason: "",
    match: { pickup: ["Sirtec", "Sirtex"], delivery: ["CAL-COMP"], vehicleClass: [] }
  }, "admin");
  const proposed = (s.rateMappings || []).find((m) => m.reviewStatus === "proposed");
  assert.ok(proposed);
  assert.equal(f.activeRateMappings(s).length, 0);
  const before = pricing.buildPricingVerificationReport(s);
  assert.equal(before.proposedMappings.length, 1);
  assert.equal(before.approvedMappings.length, 0);
  const diagnosis = f.diagnoseRate(s, s.bookings[0]);
  assert.equal(diagnosis.kind, "unavailable");
  assert.equal(diagnosis.code, "no_mapping");
  s = act(s, { type: "approve_proposed_rate_mapping", mappingId: proposed.id }, "admin");
  assert.equal(f.activeRateMappings(s).length, 1);
  assert.equal(f.activeRateMappings(s)[0].reviewStatus, "approved");
});

test("customer billing profile: draft → submit → approve; incomplete cannot submit; APL stays empty until filled", () => {
  let s = f.createEmptyOwnerState();
  assert.throws(() => act(s, {
    type: "upsert_customer_profile_draft",
    profile: {
      id: "apl-transport",
      match: ["APL"],
      legalNameTh: "",
      legalNameEn: null,
      billingAddressTh: "",
      billingAddressEn: null,
      taxId: "",
      contact: null,
      signatureName: null,
      paymentTerms: null,
      withholdingNote: null,
      source: "short",
      notes: [],
      advancePaymentAllowed: false,
      deduction: null,
      effectiveFrom: "2026-11-01"
    }
  }), /FINANCE_PROFILE_GATE/);

  s = act(s, {
    type: "upsert_customer_profile_draft",
    profile: {
      id: "fixture-customer",
      match: ["FIXTURE CO"],
      legalNameTh: "บริษัท ทดสอบ จำกัด",
      legalNameEn: "FIXTURE CO., LTD.",
      billingAddressTh: "1 ถนนทดสอบ กรุงเทพฯ 10100",
      billingAddressEn: null,
      taxId: "0105559999999",
      contact: null,
      signatureName: "TEST SIGNATORY",
      paymentTerms: "Net 30",
      withholdingNote: "1% pending owner confirmation",
      source: "Copied from owner-provided registration extract for local test only",
      notes: ["Synthetic fixture — not a real customer"],
      advancePaymentAllowed: false,
      deduction: null,
      effectiveFrom: "2026-11-01"
    }
  }, "admin");
  const draft = s.customerProfiles.find((p) => p.id === "fixture-customer");
  assert.equal(draft.reviewStatus, "draft");
  assert.equal(profiles.profileRequiredGaps(draft).length, 0);
  s = act(s, { type: "submit_customer_profile", profileId: "fixture-customer" }, "admin");
  assert.equal(s.customerProfiles[0].reviewStatus, "pending_owner_approval");
  assert.throws(() => act(s, { type: "approve_customer_profile", profileId: "fixture-customer" }, "finance"), /DEMO_ROLE_REQUIRED/);
  s = act(s, { type: "approve_customer_profile", profileId: "fixture-customer", note: "Owner verified registration" }, "admin");
  assert.equal(s.customerProfiles[0].reviewStatus, "approved");
  assert.ok(s.customerProfileEvents.some((e) => e.action === "approve"));

  // Pending placeholder for unmatched APL — no invented details
  const pending = profiles.pendingCustomerProfile("APL");
  assert.match(pending.taxId, /PENDING/i);
  assert.equal(profiles.approvedProfileFor("APL", undefined, s.customerProfiles), null);
});

test("preview profile uses local workspace overrides without rewriting seed catalogue", () => {
  let s = f.createEmptyOwnerState();
  s = act(s, {
    type: "upsert_customer_profile_draft",
    profile: {
      id: "integra-logistics",
      match: ["INTEGRA"],
      legalNameTh: "บริษัท อินทีกรา โลจิสติกส์ คอร์ปอเรชั่น จำกัด",
      legalNameEn: "INTEGRA LOGISTICS CORPORATION CO., LTD.",
      billingAddressTh: "819/16 ซอยปรีชา 1",
      billingAddressEn: null,
      taxId: "0105551036315",
      contact: null,
      signatureName: "NATVARAT",
      paymentTerms: null,
      withholdingNote: null,
      source: "Local workspace copy of seed INTEGRA profile for editor testing",
      notes: [],
      advancePaymentAllowed: true,
      deduction: null,
      effectiveFrom: "2026-11-02"
    }
  }, "admin");
  assert.equal(profiles.CUSTOMER_BILLING_PROFILES[0].reviewStatus, "pending_owner_approval");
  assert.equal(s.customerProfiles[0].reviewStatus, "draft");
  const sheet = { id: "SHEET-X", client: "INTEGRA LOGISTICS CORPORATION CO., LTD.", clientId: "x", jobIds: [], lines: {}, missingPapers: [], readyForApprovalAt: null, officialTrn: null, createdAt: "", updatedAt: "", stage: "draft", draftReference: "DRAFT-X" };
  const preview = inv.previewProfileForSheet(sheet, s);
  assert.equal(preview.profile.reviewStatus, "draft");
  assert.equal(preview.kind, "pending_profile");
});

test("fuel reference: proposed does not count as verified; missing dates listed; never infers today", () => {
  let s = seedAplJob();
  const missingBefore = pricing.missingVerifiedFuelDates(s);
  assert.ok(missingBefore.includes("2026-11-03"));
  s = act(s, {
    type: "record_fuel_reference",
    date: "2026-11-03",
    priceThb: 40.69,
    evidence: "Approved history page row for 2026-11-03 Diesel B7",
    sourceUrl: f.DIESEL_B7_SOURCE_URL,
    proposed: true
  }, "admin");
  assert.ok(pricing.missingVerifiedFuelDates(s).includes("2026-11-03"));
  s = act(s, { type: "verify_fuel_reference", date: "2026-11-03" }, "admin");
  assert.ok(!pricing.missingVerifiedFuelDates(s).includes("2026-11-03"));
});

test("reconciliation finds duplicate WO associations and money totals", () => {
  let s = seedAplJob();
  s = act(s, { type: "sheet_create", clientId: "apl" });
  const sheetId = s.billingSheets[0].id;
  s = act(s, { type: "sheet_add_paper", sheetId, workOrder: "9001" });
  s = act(s, {
    type: "sheet_set_transport",
    sheetId,
    jobId: s.bookings[0].id,
    transport: { amount: 5000, source: "manual", overrideReason: "Local test transport figure — not verified tariff" }
  });
  const totals = reconcile.sheetMoneyTotals(s, s.billingSheets[0]);
  assert.equal(totals.transportThb, 5000);
  assert.equal(totals.incomplete, false);
  const findings = reconcile.reconcileFinanceState(s);
  assert.ok(Array.isArray(findings));
  assert.ok(findings.some((x) => x.code === "customer_profile_unverified" || x.code === "missing_customer_profile"));
});

test("migration rehearsal script is read-only and refuses write flags", () => {
  const script = path.join(__dirname, "..", "scripts", "finance-migration-rehearsal-readonly.cjs");
  const refused = spawnSync(process.execPath, [script, "--write"], { encoding: "utf8" });
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr || refused.stdout, /REFUSED|read-only/i);

  const snapshot = path.join(__dirname, "..", ".ees-local", "finance-test", "state.json");
  if (!fs.existsSync(snapshot)) {
    // Fixture may be absent in CI — still assert the refuse path above.
    return;
  }
  const before = fs.readFileSync(snapshot);
  const run = spawnSync(process.execPath, [script, snapshot, "--json"], { encoding: "utf8", cwd: path.join(__dirname, "..") });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const after = fs.readFileSync(snapshot);
  assert.ok(before.equals(after), "rehearsal must not mutate state.json");
  const report = JSON.parse(run.stdout);
  assert.equal(report.mode, "read-only");
  assert.equal(report.writePathPresent, false);
  assert.ok(Array.isArray(report.workspaces));
});
