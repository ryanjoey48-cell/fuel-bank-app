const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

function loadTypeScriptModule(relativePath) {
  const filename = path.join(process.cwd(), relativePath);
  const source = fs.readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true
    },
    fileName: filename
  }).outputText;
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  loaded._compile(output, filename);
  return loaded.exports;
}

const intelligence = loadTypeScriptModule("lib/insurance-intelligence.ts");
const providers = loadTypeScriptModule("lib/insurance-providers.ts");
const renewalQuotes = loadTypeScriptModule("lib/insurance-renewal-quote.ts");

function record(overrides = {}) {
  return {
    id: overrides.id || crypto.randomUUID(),
    vehicle_registration: "TEST-1",
    ownership_holder: null,
    insurer_th: null,
    insurer_en: null,
    policy_number: null,
    insurance_class: null,
    policy_issue_date: null,
    insured_value: null,
    repair_type: null,
    vehicle_make: null,
    vehicle_year: null,
    chassis_number: null,
    compulsory_included: null,
    compulsory_policy_number: null,
    compulsory_policy_issue_date: null,
    compulsory_start_date: null,
    compulsory_expiry_date: null,
    insurance_start_date: null,
    insurance_expiry_date: null,
    registration_date: null,
    registration_expiry_date: null,
    laos_expiry_date: null,
    insurance_premium: null,
    compulsory_insurance_premium: null,
    vehicle_tax: null,
    additional_premium: null,
    total_recorded_cost: null,
    record_status: "current",
    verification_status: "needs_review",
    verified_at: null,
    source: null,
    source_row: null,
    original_insurance_expiry: null,
    import_review_notes: null,
    notes: null,
    insurance_requirement: "unknown",
    insurance_requirement_reason: null,
    insurance_status: "missing",
    days_to_insurance_expiry: null,
    ...overrides
  };
}

test("registration normalization removes presentation differences without changing Thai characters", () => {
  assert.equal(intelligence.normalizeInsuranceRegistration(" ฒอ-8453 "), "ฒอ8453");
  assert.equal(intelligence.normalizeInsuranceRegistration("ฌอ-8453"), "ฌอ8453");
  assert.notEqual(
    intelligence.normalizeInsuranceRegistration("ฒอ-8453"),
    intelligence.normalizeInsuranceRegistration("ฌอ-8453")
  );
});

test("derived application categories cover the 36-record baseline", () => {
  const expected = {
    six_wheel_truck: ["61-2835", "62-1085", "62-4337", "64-0359", "64-5954", "700-6659", "701-5145", "74-8969"],
    other_commercial_vehicle: ["61-6672", "63-3543", "64-5956", "64-8665", "68-7154", "700-4145", "701-1654", "78-6996", "79-2945", "79-5318"],
    pickup: ["3ฒน-9565", "ฒอ8453"],
    passenger_company_car: ["4กข-98", "6กค-782", "ญค-280", "ญม3824"],
    trailer: ["63-0096", "64-2699", "64-8664", "65-6919", "65-6991", "77-5902", "77-8513"],
    insurance_only_asset: ["4ฒล-4565", "61-2836"],
    unknown: ["700-6956", "ภอ6656", "สินค้า"]
  };
  const assets = Object.entries(expected).flatMap(([category, registrations]) =>
    registrations.map((registration) => ({ category, asset: record({ vehicle_registration: registration }) }))
  );
  assert.equal(assets.length, 36);
  for (const { category, asset } of assets) {
    assert.equal(intelligence.getAssetCategory(asset), category, asset.vehicle_registration);
  }
});

test("61-2835 is confirmed through a separate compulsory policy even when main inclusion is false", () => {
  const asset = record({
    vehicle_registration: "61-2835",
    compulsory_included: false,
    compulsory_policy_number: "726-0133-785",
    compulsory_start_date: "2026-06-30",
    compulsory_expiry_date: "2027-06-30"
  });
  assert.equal(intelligence.isSeparateCompulsoryConfirmed(asset), true);
  assert.equal(intelligence.isCompulsoryConfirmed(asset), true);
});

test("trailer description in policy number is flagged but not rewritten", () => {
  const asset = record({ vehicle_registration: "64-8664", policy_number: "หางหัวลาก" });
  const findings = intelligence.buildDataQualityFindings(asset, {
    records: [asset],
    documents: []
  });
  assert.equal(asset.policy_number, "หางหัวลาก");
  assert.ok(findings.some((finding) => finding.code === "description_in_policy"));
});

test("financial averages exclude NULL rather than converting it to zero", () => {
  const priced = record({
    id: "priced",
    verification_status: "verified",
    insurance_premium: 100,
    insured_value: 1000
  });
  const missing = record({
    id: "missing",
    verification_status: "verified",
    insurance_premium: null,
    insured_value: null
  });
  const summary = intelligence.summarizeInsurance({ records: [priced, missing], documents: [] });
  assert.equal(summary.financial.averagePremium, 100);
  assert.equal(summary.financial.averageInsuredValue, 1000);
  assert.equal(summary.financial.premiumCount, 1);
  assert.equal(summary.financial.insuredValueCount, 1);
  assert.equal(summary.financial.premiumToValuePercent, 10);
});

test("financial analytics default to verified records and include provisional values only by explicit option", () => {
  const verified = record({
    id: "verified",
    verification_status: "verified",
    insurance_premium: 100,
    insured_value: 1000
  });
  const provisional = record({
    id: "provisional",
    verification_status: "needs_review",
    insurance_premium: 900,
    insured_value: 9000
  });
  const context = { records: [verified, provisional], documents: [] };
  const protectedSummary = intelligence.summarizeInsurance(context);
  const inclusiveSummary = intelligence.summarizeInsurance(context, {
    includeUnverifiedFinancial: true
  });
  assert.equal(protectedSummary.financial.premiumTotal, 100);
  assert.equal(protectedSummary.financial.insuredValueTotal, 1000);
  assert.equal(inclusiveSummary.financial.premiumTotal, 1000);
  assert.equal(inclusiveSummary.financial.insuredValueTotal, 10000);
});

test("normalized duplicate detection finds separator-only variants", () => {
  const first = record({ id: "one", vehicle_registration: "ฒอ8453" });
  const second = record({ id: "two", vehicle_registration: "ฒอ-8453" });
  const findings = intelligence.buildDataQualityFindings(first, {
    records: [first, second],
    documents: []
  });
  assert.ok(findings.some((finding) => finding.code === "duplicate_registration"));
});

test("current compliance findings include missing insurance expiry and recorded expired vehicle tax", () => {
  const asset = record({
    id: "compliance",
    insurance_expiry_date: null,
    registration_expiry_date: "2020-01-01"
  });
  const findings = intelligence.buildDataQualityFindings(asset, {
    records: [asset],
    documents: []
  });
  assert.ok(findings.some((finding) => finding.code === "missing_expiry"));
  assert.ok(findings.some((finding) => finding.code === "vehicle_tax_expired"));
});

test("insurance-not-required suppresses policy, document and renewal findings but keeps tax compliance", () => {
  const trailer = record({
    id: "trailer",
    vehicle_registration: "64-2699",
    insurance_requirement: "not_required",
    insurance_requirement_reason: "Trailer",
    insurance_expiry_date: "2020-01-01",
    registration_expiry_date: "2020-01-01"
  });
  const findings = intelligence.buildDataQualityFindings(trailer, {
    records: [trailer],
    documents: []
  });
  const codes = new Set(findings.map((finding) => finding.code));
  assert.equal(codes.has("expired_insurance"), false);
  assert.equal(codes.has("missing_insurer"), false);
  assert.equal(codes.has("missing_policy"), false);
  assert.equal(codes.has("missing_main_document"), false);
  assert.equal(codes.has("compulsory_unknown"), false);
  assert.equal(codes.has("vehicle_tax_expired"), true);
  assert.equal(intelligence.renewalBand(trailer), "not_required");
  assert.equal(intelligence.insuranceHistoryStatus(trailer), "NOT_REQUIRED");
});

test("insurance-not-required remains in the fleet without reducing insurance compliance totals", () => {
  const trailer = record({
    id: "trailer",
    vehicle_registration: "64-8664",
    insurance_requirement: "not_required",
    insurance_requirement_reason: "Trailer",
    verification_status: "needs_review"
  });
  const insured = record({
    id: "insured",
    verification_status: "verified",
    insurance_requirement: "required",
    insurance_expiry_date: "2099-01-01",
    insurance_premium: 100,
    insured_value: 1000
  });
  const context = { records: [trailer, insured], documents: [] };
  const summary = intelligence.summarizeInsurance(context);
  assert.equal(summary.fleet.total, 2);
  assert.equal(summary.fleet.insuranceNotRequired, 1);
  assert.equal(summary.fleet.awaitingReview, 0);
  assert.equal(summary.insurance.missingDates, 0);
  assert.equal(summary.financial.premiumTotal, 100);
  assert.equal(intelligence.isAwaitingInsuranceReview(trailer, context), false);
});

test("the boss-confirmed seven trailers become not required and leave no insurance review rows", () => {
  const registrations = ["77-5902", "สินค้า", "64-2699", "64-8664", "67-6204", "700-4198", "77-8513"];
  const trailers = registrations.map((vehicle_registration, index) => record({
    id: `trailer-${index}`,
    vehicle_registration,
    vehicle_make: index === 4 || index === 5 ? "Trailer" : null,
    insurance_requirement: "not_required",
    insurance_requirement_reason: "Trailer",
    verification_status: "needs_review",
    insurance_expiry_date: index % 2 === 0 ? "2020-01-01" : null,
    compulsory_expiry_date: null,
    policy_number: index % 2 === 0 ? "source value" : null
  }));
  const context = { records: trailers, documents: [] };
  assert.equal(trailers.filter((asset) => intelligence.isAwaitingInsuranceReview(asset, context)).length, 0);
  assert.ok(trailers.every((asset) => intelligence.renewalBand(asset) === "not_required"));
  assert.ok(trailers.every((asset) => intelligence.insuranceHistoryStatus(asset) === "NOT_REQUIRED"));
  assert.ok(trailers.every((asset) => intelligence.getAssetCategory(asset) === "trailer"));
  assert.equal(intelligence.summarizeInsurance(context).fleet.insuranceNotRequired, 7);
});

test("a normal vehicle with missing insurance still requires review", () => {
  const vehicle = record({
    id: "normal-missing",
    vehicle_registration: "NORMAL-1",
    insurance_requirement: "required",
    verification_status: "needs_review",
    insurance_expiry_date: null
  });
  const context = { records: [vehicle], documents: [] };
  assert.equal(intelligence.isAwaitingInsuranceReview(vehicle, context), true);
  assert.equal(intelligence.renewalBand(vehicle), "unknown");
  assert.ok(intelligence.buildDataQualityFindings(vehicle, context).some((finding) => finding.code === "missing_expiry"));
});

test("known Aioi aliases resolve case-insensitively and punctuation variants group together", () => {
  const aliases = [
    "Aioi Bangkok Insurance",
    "aioi bangkok insurance pcl",
    "Aioi Bangkok Insurance Public Co., Ltd.",
    " AIOI   BANGKOK "
  ];
  for (const alias of aliases) {
    assert.equal(
      providers.canonicalInsurerName(alias, null, "en"),
      "Aioi Bangkok Insurance Public Company Limited"
    );
  }
});

test("insurer premium grouping merges known aliases, preserves raw wording and recalculates percentage", () => {
  const input = [
    { insurer_en: "Aioi Bangkok Insurance", insurer_th: "ไอโออิ", insurance_premium: 124972.79 },
    { insurer_en: "Aioi Bangkok Insurance Public Company Limited", insurer_th: null, insurance_premium: 489378.77 },
    { insurer_en: "The Viriyah Insurance Public Company Limited", insurer_th: null, insurance_premium: 220273.73 }
  ];
  const groups = providers.groupInsurerPremiums(input, "en");
  assert.equal(groups.length, 2);
  assert.equal(groups[0].name, "Aioi Bangkok Insurance Public Company Limited");
  assert.equal(groups[0].recordCount, 2);
  assert.equal(groups[0].premiumTotal, 614351.56);
  assert.equal(Number(groups[0].percentage.toFixed(2)), 73.61);
  assert.deepEqual(groups[0].rawNames.filter((name) => name.startsWith("Aioi")), [
    "Aioi Bangkok Insurance",
    "Aioi Bangkok Insurance Public Company Limited"
  ]);
  assert.equal(input[0].insurer_en, "Aioi Bangkok Insurance");
});

test("unrelated insurers are not merged", () => {
  const groups = providers.groupInsurerPremiums([
    { insurer_en: "The Viriyah Insurance Public Company Limited", insurance_premium: 10 },
    { insurer_en: "The Navakij Insurance Public Company Limited", insurance_premium: 20 },
    { insurer_en: "Tokio Marine Safety Insurance (Thailand) PCL", insurance_premium: 30 }
  ]);
  assert.equal(groups.length, 3);
  assert.equal(new Set(groups.map((group) => group.key)).size, 3);
});

test("Insurance UI and reports expose bilingual exemption controls and canonical export contracts", () => {
  const page = fs.readFileSync(path.join(process.cwd(), "app/(dashboard)/insurance/page.tsx"), "utf8");
  const workspace = fs.readFileSync(path.join(process.cwd(), "components/insurance-intelligence-workspace.tsx"), "utf8");
  const profile = fs.readFileSync(path.join(process.cwd(), "components/insurance-profile-insights.tsx"), "utf8");
  const reporting = fs.readFileSync(path.join(process.cwd(), "lib/insurance-reporting.ts"), "utf8");
  assert.match(page, /insurance_requirement: draft\.insurance_requirement/);
  assert.match(page, /ไม่ต้องมีประกัน/);
  assert.match(page, /Insurance Not Required/);
  assert.match(workspace, /InsuranceRequirementReason/);
  assert.match(workspace, /canonicalInsurerName/);
  assert.match(workspace, /Current Premium/);
  assert.match(workspace, /More reports/);
  assert.match(workspace, /assets included/);
  assert.match(workspace, /record\.insurance_premium/);
  assert.match(profile, /Raw insurer wording/);
  assert.match(reporting, /Insurance Not Required/);
  assert.match(reporting, /Management Summary/);
  assert.match(reporting, /totalAssetCount/);
  assert.match(reporting, /canonicalInsurerName/);
});

test("future renewal quote comparison does not overwrite or zero-fill current premium", () => {
  assert.deepEqual(renewalQuotes.compareInsuranceRenewalQuote({
    currentPremium: 10000,
    renewalQuote: 11500,
    renewalInsurer: "Example Insurer",
    renewalDate: "2027-01-01"
  }), {
    currentPremium: 10000,
    renewalQuote: 11500,
    renewalInsurer: "Example Insurer",
    renewalDate: "2027-01-01",
    differenceThb: 1500,
    differencePercent: 15
  });
  const missing = renewalQuotes.compareInsuranceRenewalQuote({ currentPremium: null, renewalQuote: 11500, renewalInsurer: null, renewalDate: null });
  assert.equal(missing.differenceThb, null);
  assert.equal(missing.differencePercent, null);
});
