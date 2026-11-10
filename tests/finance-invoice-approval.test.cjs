const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
function load(file) {
  const m = { exports: {} };
  new Function("module", "exports", ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText)(m, m.exports);
  return m.exports;
}
const approval = load("lib/finance-invoice-approval.ts");
const packs = load("lib/finance-document-packs.ts");
const approvalCopy = load("lib/finance-invoice-approval-copy.ts").invoiceApprovalCopy;
const packCopy = load("lib/finance-document-packs-copy.ts").documentPackCopy;

const snapshot = {
  client_id: "c1",
  client_name: "Mass",
  week_start: "2026-01-05",
  week_end: "2026-01-11",
  draft_identifier: "DRAFT-ABC",
  revision_number: 1,
  total_thb: 8000,
  line_count: 2,
  missing_green_paper: false,
  lines: [
    { position: 1, booking_id: "b1", work_order_number: "WO-1", amount_thb: 3000, booking_snapshot: {}, pricing_snapshot: { selling_price_thb: 3000 }, paperwork_refs: [{ document_id: "d1", kind: "green_job_order", status: "reviewed", original_filename: "g1.pdf", physical_location: "Shelf A" }] },
    { position: 2, booking_id: "b2", work_order_number: "WO-2", amount_thb: 5000, booking_snapshot: {}, pricing_snapshot: { selling_price_thb: 5000 }, paperwork_refs: [] }
  ]
};

test("review snapshots total with integer satang and reject mismatched lines", () => {
  assert.equal(approval.snapshotTotalCents(snapshot), 800000);
  assert.throws(() => approval.snapshotTotalCents({ ...snapshot, total_thb: 8010 }), /INVALID_REVIEW_TOTAL/);
  assert.throws(() => approval.snapshotTotalCents({ ...snapshot, lines: [snapshot.lines[0]] }), /INVALID_REVIEW_SNAPSHOT/);
});

test("submission gates require finance grant, current draft and no active approval", () => {
  assert.equal(approval.canSubmitDraft({ canFinance: true, draftStatus: "draft", validationStatus: "current", revisionNumber: 1, activeSubmission: null }), true);
  assert.equal(approval.canSubmitDraft({ canFinance: true, draftStatus: "draft", validationStatus: "stale", revisionNumber: 1, activeSubmission: null }), false);
  assert.equal(approval.canSubmitDraft({ canFinance: true, draftStatus: "draft", validationStatus: "current", revisionNumber: 1, activeSubmission: { status: "pending" } }), false);
  assert.equal(approval.canSubmitDraft({ canFinance: true, draftStatus: "draft", validationStatus: "current", revisionNumber: 1, activeSubmission: { status: "approved" } }), false);
  assert.equal(approval.canSubmitDraft({ canFinance: true, draftStatus: "draft", validationStatus: "current", revisionNumber: 1, activeSubmission: { status: "rejected" } }), true);
  assert.equal(approval.canSubmitDraft({ canFinance: false, draftStatus: "draft", validationStatus: "current", revisionNumber: 1, activeSubmission: null }), false);
});

test("approver must differ from preparer and hold an invoice_approver grant", () => {
  const submission = { status: "pending", submitted_by: "finance-a" };
  assert.equal(approval.canDecideSubmission({ canApprove: true, userId: "boss", submission }), true);
  assert.equal(approval.canDecideSubmission({ canApprove: true, userId: "finance-a", submission }), false);
  assert.equal(approval.canDecideSubmission({ canApprove: false, userId: "boss", submission }), false);
  assert.equal(approval.canDecideSubmission({ canApprove: true, userId: "boss", submission: { ...submission, status: "approved" } }), false);
});

test("document packs preserve approved order and block dispatch on holds", () => {
  assert.equal(packs.packMatchesApprovedOrder([{ position: 1, booking_id: "b1" }, { position: 2, booking_id: "b2" }], ["b1", "b2"]), true);
  assert.equal(packs.packMatchesApprovedOrder([{ position: 1, booking_id: "b2" }, { position: 2, booking_id: "b1" }], ["b1", "b2"]), false);
  assert.equal(packs.packDispatchBlocked({ status: "prepared", hold_reasons: [] }), false);
  assert.equal(packs.packDispatchBlocked({ status: "held", hold_reasons: ["missing_paperwork"] }), true);
  const manifest = packs.buildPackManifest(snapshot);
  assert.equal(manifest[0].kind, "draft");
  assert.deepEqual(manifest.filter((item) => item.kind === "work_order").map((item) => item.bookingId), ["b1", "b2"]);
  assert.deepEqual(packs.invoiceLayoutHeadings, ["วันที่", "สถานทีรับ", "สถานที่ส่ง", "ใบงาน", "ค่าจอด", "OT", "เรทน้ำมัน", "AMOUNT"]);
});

test("approval and pack screens expose bilingual copy and never issue TRNs", () => {
  for (const lang of ["en", "th"]) {
    for (const key of ["title", "submit", "approve", "reject", "samePerson", "demoWarning", "layoutNote"]) assert.ok(approvalCopy[lang][key], `approval.${lang}.${key}`);
    for (const key of ["title", "prepare", "invoiceHeading", "coverHeading", "greenChecklist", "dispatchChecklist", "neverSend", "layoutNote"]) assert.ok(packCopy[lang][key], `pack.${lang}.${key}`);
  }
  const approvalPage = fs.readFileSync("app/(dashboard)/invoice-approval/page.tsx", "utf8");
  const packPage = fs.readFileSync("app/(dashboard)/document-packs/page.tsx", "utf8");
  assert.match(approvalPage, /finance_submit_invoice_draft/);
  assert.match(approvalPage, /finance_decide_invoice_submission/);
  assert.match(approvalPage, /invoice_approver/);
  assert.match(packPage, /finance_prepare_document_pack/);
  assert.match(packPage, /c\.invoiceHeading/);
  assert.match(packPage, /coverLayoutHeadings/);
  assert.equal(packCopy.en.invoiceHeading, "ใบแจ้งหนี้/INVOICE");
  assert.doesNotMatch(approvalPage, /service_role|supabaseAdmin|issue_trn|invoice_issuance|TRN629/);
  assert.doesNotMatch(packPage, /service_role|supabaseAdmin|issue_trn|invoice_issuance|TRN629/);
  const migration = fs.readFileSync("supabase/migrations/20261104100000_finance_invoice_approval_packs.sql", "utf8");
  assert.match(migration, /INVOICE_APPROVER_REQUIRED/);
  assert.match(migration, /APPROVER_MUST_DIFFER/);
  assert.doesNotMatch(migration, /trn_number|invoice_number|issue_trn/);
});
