const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");

const source = fs.readFileSync("lib/job-verification.ts", "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const loaded = { exports: {} };
new Function("module", "exports", compiled)(loaded, loaded.exports);
const { evaluateVerification, verificationCopy, verificationErrorMessage } = loaded.exports;
const expected = { booking_date: "2026-10-29", client_id: "customer-a", pickup: "Depot", dropoff: "Port", driver: "Demo Driver", vehicle_registration: "DEMO-001", job_order_number: "SIM-JOB-001" };
const complete = () => ({ green_job_order: { required: true, received: true, reference: "paper-1", not_applicable_reason: "" }, parking_receipt: { required: true, received: true, reference: "photo-2", not_applicable_reason: "" }, toll_receipt: { required: true, received: true, reference: "photo-3", not_applicable_reason: "" } });

test("matching job with complete paperwork is ready for finance", () => {
  assert.deepEqual(evaluateVerification({ expected, observed: { ...expected }, documents: complete() }), { status: "verified", missingDocuments: [], mismatches: [], incompleteFields: [], financeReady: true });
});
test("missing signed order or receipt blocks finance", () => {
  const docs = complete(); docs.green_job_order.reference = ""; docs.toll_receipt.received = false;
  const result = evaluateVerification({ expected, observed: { ...expected }, documents: docs });
  assert.equal(result.status, "missing_paperwork"); assert.deepEqual(result.missingDocuments, ["green_job_order", "toll_receipt"]); assert.equal(result.financeReady, false);
});
test("field mismatch escalates even with complete documents", () => {
  const result = evaluateVerification({ expected, observed: { ...expected, dropoff: "Warehouse" }, documents: complete() });
  assert.equal(result.status, "discrepancy"); assert.deepEqual(result.mismatches, ["dropoff"]); assert.equal(result.financeReady, false);
});
test("incomplete booking and unexplained not-applicable receipt cannot be finance ready", () => {
  const docs = complete(); docs.parking_receipt = { required: false, received: false, reference: "", not_applicable_reason: "" };
  assert.equal(evaluateVerification({ expected, observed: { ...expected }, documents: docs }).financeReady, false);
  docs.parking_receipt.not_applicable_reason = "No parking incurred";
  const missingCustomer = { ...expected, client_id: "" };
  const result = evaluateVerification({ expected: missingCustomer, observed: { ...missingCustomer }, documents: docs });
  assert.equal(result.status, "incomplete_booking"); assert.deepEqual(result.incompleteFields, ["client_id"]);
  const invalidOrder = complete(); invalidOrder.green_job_order.required = false; invalidOrder.green_job_order.received = false; invalidOrder.green_job_order.not_applicable_reason = "No order needed";
  assert.equal(evaluateVerification({ expected, observed: { ...expected }, documents: invalidOrder }).financeReady, false);
});
test("management resolution requires explicit capability and leaves job blocked pending recheck", () => {
  const sql = fs.readFileSync("supabase/migrations/20261030100000_finance_verification_foundation.sql", "utf8");
  assert.match(sql, /capability='management_reviewer'/);
  assert.match(sql, /set status='needs_recheck',handover_status='blocked'/);
  assert.match(sql, /create trigger finance_invalidate_booking after update/);
  assert.match(sql, /create trigger finance_booking_deleted before delete/);
  assert.match(sql, /DOCUMENT_NOT_APPLICABLE_REASON_REQUIRED/);
  assert.match(sql, /v_booking\.client_id is null/);
  assert.match(sql, /current_account_role\(\) not in \('admin','office_staff'\)/);
  assert.match(sql, /revoke all on public\.finance_role_grants, public\.finance_job_verifications/);
  assert.doesNotMatch(sql, /grant (insert|update|delete|all) on public\.finance_/i);
});
test("English and Thai labels cover key workflow states", () => {
  for (const language of ["en", "th"]) {
    for (const key of ["title", "documents", "green", "parking", "toll", "missing", "incomplete", "mismatch", "verified", "resolved", "ready", "history", "permissionError", "documentReasonError"]) assert.ok(verificationCopy[language][key]);
    assert.equal(verificationErrorMessage("MANAGEMENT_REVIEW_PERMISSION_REQUIRED", language), verificationCopy[language].permissionError);
    assert.equal(verificationErrorMessage("OPEN_DISCREPANCY_REQUIRES_MANAGEMENT", language), verificationCopy[language].openDiscrepancyError);
  }
});
test("Booking Diary persistence remains in its existing module and new pages avoid unrelated data writes", () => {
  const diary = fs.readFileSync("app/(dashboard)/booking-diary/page.tsx", "utf8");
  const page = fs.readFileSync("app/(dashboard)/job-verification/page.tsx", "utf8");
  const overview = fs.readFileSync("app/(dashboard)/finance-centre/page.tsx", "utf8");
  assert.match(diary, /saveBookingDiaryEntry/); assert.match(diary, /deleteBookingDiaryEntry/);
  assert.match(diary, /href=\{`\/finance-centre\?booking=\$\{encodeURIComponent\(booking.id\)\}&section=reconciliation`\}/);
  assert.match(page, /finance_submit_verification/); assert.match(page, /finance_resolve_discrepancy/);
  assert.doesNotMatch(page + overview, /\.from\("(?:fuel_logs|maintenance_records|vehicle_monthly_performance|forth_)/);
  assert.doesNotMatch(overview, /\.insert\(|\.update\(|\.delete\(|\.rpc\(/);
});
