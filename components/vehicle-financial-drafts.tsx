"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, FileUp, ShieldAlert } from "lucide-react";
import { getAccessToken } from "@/lib/account-management";
import { FINANCIAL_COLUMNS, calculateDraftFinancials, canonicalLpgVehicleIds, parseFinancialValue, previewFinancialDraft, type FinancialField, type LpgTreatment } from "@/lib/vehicle-financial-draft";
import { FinancialWorkbookError, listFinancialWorkbookSheets, MAX_FINANCIAL_FILE_BYTES, parseFinancialWorkbook } from "@/lib/vehicle-financial-draft-import";
import { knownVehicleRegistrationAliases } from "@/lib/vehicle-identity";
import type { Vehicle } from "@/types/database";

type Language = "en" | "th";
type DriverChoice = { id: string; name: string; active: boolean };
type BatchSummary = {
  id: string; reporting_month: string; version: number; status: string; source_file_name: string;
  source_sha256: string; content_hash: string; uploaded_by: string; created_at: string;
  source_totals?: Record<string, unknown>; calculated_totals?: Partial<Record<FinancialField, number | null>>;
  source_controls?: Array<{ kind?: string; sheet?: string; row?: number; values?: unknown[] }>;
  validation_issue_codes?: string[]; validation_ready?: boolean;
  validation_counts?: { expected: number; matched: number; missing: number; duplicate: number };
  expected_vehicle_ids?: string[];
  salary_verification?: unknown;
  validation_snapshot?: { readyForReview?: boolean; fleetRosterConfirmed?: boolean; issues?: Array<{ code: string; row?: number; field?: string }>; reviewWarnings?: Array<{ code: string; field?: string }> };
};
type BatchDetail = {
  batch: BatchSummary & { uploader_name: string };
  entries: Array<Record<string, unknown>>;
  history: Array<Record<string, unknown>>;
  approvals: Array<Record<string, unknown>>;
};
type Annotation = { employeeId?: string; lpgTreatment?: LpgTreatment; assignmentEffectiveFrom?: string; assignmentEffectiveTo?: string };
type DraftMetadata = {
  migrationReady: boolean; writesEnabled: boolean; setupMessage: string | null;
  accountingPolicy?: { status: "draft" | "approved"; evidenceManifestReady: boolean; approvalConflict: boolean };
  vehicles: Array<{ id: string; vehicle_reg: string; active: boolean }>;
  drivers: DriverChoice[]; batches: BatchSummary[];
  published: Array<{ reporting_month: string; vehicle_id: string }>;
};
type SourcePreviewRow = {
  registration: string;
  salary: string | null;
  jobs: string | null;
  tripPayments: string | null;
  expenses: string | null;
  parkingFees: string | null;
  totalReceived: string | null;
  fuel: string | null;
  lpg: string | null;
  maintenance: string | null;
  sourceDashStatus: Record<string, string>;
};
type SourcePreview = {
  reportingMonth: string;
  sourceFile: string;
  sourceSha256: string;
  rowCount: number;
  rows: SourcePreviewRow[];
  sourceFooterTotals: Record<string, string | null>;
  rowSumReconciliation: { caveat: string };
  sourceNotes: string[];
};
type Props = {
  language: Language;
  vehicles: Vehicle[];
  canImport: boolean;
  canReview: boolean;
  canApprove: boolean;
};

const copy = {
  en: {
    title: "V4 monthly financial drafts",
    subtitle: "Review source figures in a versioned draft. This workflow does not change live Vehicle Performance totals.",
    period: "Reporting month", upload: "Choose Excel or CSV", sheets: "Source sheets", roster: "Vehicles expected for this month",
    confirmRoster: "I confirm this is the complete fleet roster for the selected month", rosterConfirmed: "Complete monthly fleet roster confirmed",
    employee: "Month-specific employee", employeeUnassigned: "Unknown / not assigned", lpg: "LPG treatment",
    lpgIncluded: "Included in Fuel", lpgSeparate: "Separate expense", lpgUnknown: "Unknown",
    controls: "Declared source totals (excluding DUMMY)", formula: "Unverified source note",
    formulaHelp: "A reference is retained for review but does not authorize balance or margin calculations.",
    ownerRequest: "Owner explicitly requested a Jan–Jul correction", ownerEvidence: "Owner approval evidence / reason",
    initialBaseline: "Propose an initial historical baseline (no V4 version exists)",
    baseVersion: "Approved base version", sepVerified: "September salary verified against source", sepEvidence: "September payroll evidence",
    preview: "Review import preview", save: "Save immutable draft", localDraft: "Local draft preview", noFile: "Choose a source workbook to begin.",
    noSheets: "Choose at least one sheet.", noRoster: "Select the vehicles expected in this reporting month.",
    warning: "Source revenue and expense relationships are not independently verified. Balance and margin stay withheld until an approved server accounting policy exists.",
    warningHistory: "Historical rows are not changed. Jan–Jul ฒอ-8453 uses LPG included in Fuel; corrections require owner evidence and independent review. An initial baseline can be proposed only for an empty V4 month.",
    august: "August 2026 read-only preview", september: "September 2026 read-only preview",
    noSource: "No V4 draft has been saved for this month.",
    augustSalary: "August salary rows reconcile to the report control excluding DUMMY.",
    septemberSalary: "September salary remains provisional pending independent payroll verification.",
    formulaPlaceholder: "Optional source report name or page", inactive: "inactive",
    reconciliation: "Reconciliation", imported: "Imported", declared: "Source control", status: "Status", unknown: "Unknown",
    registration: "Registration", salary: "Salary", jobs: "Jobs", trips: "Trip Payments", expenses: "Expenses", parking: "Parking Fees",
    revenue: "Total Received", fuel: "Fuel", maintenance: "Maintenance", balance: "Recorded balance", directCost: "Direct cost",
    lpgWarning: "Fuel includes LPG; no LPG amount is added again.", separateLpg: "LPG is a separate expense and is added once.",
    rows: "Imported rows", excluded: "Excluded source rows", excludedEvidence: "Excluded source values and report controls", issues: "Review warnings", validationErrors: "Validation errors", noIssues: "No validation warnings.",
    current: "Saved report versions", none: "No persisted report versions yet.", statusDraft: "Draft", statusNeedsReview: "Needs Review", statusValidated: "Validated",
    statusReview: "In Review", statusApproved: "Approved", statusPublished: "Published", sourceFile: "Source file", version: "Version",
    validate: "Validate draft", sendReview: "Submit for review", approve: "Approve", reason: "Review reason", saveSuccess: "Draft saved with its source provenance.",
    reviewSuccess: "Review status updated.", disabledPublication: "Read-only preview · saving, review, approval and publication are disabled.", requiresMigration: "Persistence is waiting for the reviewed Phase 2 database migration. You can still inspect a local preview.",
    permission: "Your account can preview this flow, but does not have import permission.",
    empty: "—", amounts: "Amount (THB)", calculate: "Calculate from source rows", monthChoice: "Select month",
    reportStatus: "Month status", sourceHash: "Source SHA-256", sheetWarning: "Parser notes",
    viewDetails: "View rows and audit history", hideDetails: "Hide details", uploader: "Uploaded by", history: "Audit history", rowsSaved: "Saved vehicle rows", matched: "Matched", expected: "Expected", missing: "Missing", duplicates: "Duplicates", reviewer: "Reviewer", sourceRow: "Source row", sourceSheet: "Source sheet", detailsLoading: "Loading saved details…", policyUnverified: "Accounting relationships are unverified. Balance and margin are withheld.", contentHash: "Draft content SHA-256",
    assignmentPeriod: "Verified assignment dates for this month", effectiveFrom: "Effective from", effectiveTo: "Effective to", salaryAllocationReview: "Multi-vehicle salary allocations are checked against restricted HR records and require independent administrator review.",
    readOnlySource: "Read-only source preview · excluded from live KPIs, rankings and margins",
    financialAccessRequired: "Monthly financial drafts and source previews require financial-management access.",
    sourcePreviewLoading: "Loading authorized source previews…",
    sourcePreviewUnavailable: "Authorized source previews are temporarily unavailable.",
    matchCount: "matched to existing EES vehicle records", matchPending: "EES vehicle matching is not available yet", matchMissing: "Review vehicle registration match",
    sourceFooter: "Printed source report totals", unresolvedDashes: "Unresolved source dashes remain unknown", sourceReconcile: "Row subtotals match printed controls when dashes are treated as zero; dash cells remain unknown unless a confirmed rule applies.",
    augustSalaryVerified: "August salary rows reconcile to the report control excluding DUMMY.", septemberSalaryProvisional: "September salary rows remain provisional pending independent payroll verification.",
    sourceLpgRule: "Only ฒอ-8453 has LPG. August and September LPG is separate from Fuel; other confirmed non-LPG vehicles show zero LPG.", sourceDash: "Source dash; figure not stated", confirmedZero: "Confirmed zero", resolvedSourceNote: "Zero confirmed by report note",
    policyStatus: "V4 accounting policy", policyDraft: "Draft — balances remain disabled", policyApproved: "Previously approved policy record detected", policyEvidencePending: "Accounting-policy activation remains disabled for this release.", policyApprovalConflict: "An immutable approval exists with different evidence. A new policy version requires review.", approvePolicy: "Approve v4-accounting-draft-3", policyApprovalFailed: "The policy was not approved. Check admin access, the verified evidence manifest and the saved policy version.",
  },
  th: {
    title: "ฉบับร่างการเงินรายเดือน V4",
    subtitle: "ตรวจสอบตัวเลขจากแหล่งข้อมูลในฉบับร่างที่มีเวอร์ชัน ขั้นตอนนี้ไม่เปลี่ยนยอด Vehicle Performance ที่ใช้งานอยู่",
    period: "เดือนรายงาน", upload: "เลือก Excel หรือ CSV", sheets: "ชีตต้นทาง", roster: "รถที่คาดว่าจะอยู่ในเดือนนี้",
    confirmRoster: "ขอยืนยันว่ารายชื่อรถนี้ครบถ้วนสำหรับเดือนที่เลือก", rosterConfirmed: "ยืนยันรายชื่อรถประจำเดือนครบถ้วนแล้ว",
    employee: "พนักงานประจำเดือน", employeeUnassigned: "ไม่ทราบ / ยังไม่กำหนด", lpg: "วิธีบันทึก LPG",
    lpgIncluded: "รวมอยู่ใน Fuel", lpgSeparate: "ค่าใช้จ่ายแยก", lpgUnknown: "ไม่ทราบ",
    controls: "ยอดรวมตามรายงาน (ไม่รวม DUMMY)", formula: "บันทึกแหล่งข้อมูลที่ยังไม่ยืนยัน",
    formulaHelp: "เก็บแหล่งอ้างอิงไว้ตรวจสอบเท่านั้น ไม่อนุญาตให้คำนวณยอดคงเหลือหรืออัตรากำไร",
    ownerRequest: "เจ้าของร้องขอการแก้ไขเดือน ม.ค.–ก.ค. โดยชัดแจ้ง", ownerEvidence: "หลักฐาน / เหตุผลการอนุมัติจากเจ้าของ",
    initialBaseline: "เสนอข้อมูลฐานย้อนหลังครั้งแรก (ยังไม่มีเวอร์ชัน V4)",
    baseVersion: "เวอร์ชันฐานที่อนุมัติแล้ว", sepVerified: "ตรวจสอบเงินเดือนกันยายนกับแหล่งข้อมูลแล้ว", sepEvidence: "หลักฐานเงินเดือนกันยายน",
    preview: "ตรวจสอบตัวอย่างนำเข้า", save: "บันทึกฉบับร่างถาวร", localDraft: "ตัวอย่างฉบับร่างในเครื่อง", noFile: "เลือกไฟล์รายงานเพื่อเริ่มต้น",
    noSheets: "เลือกอย่างน้อยหนึ่งชีต", noRoster: "เลือกยานพาหนะที่คาดว่าจะมีในเดือนรายงานนี้",
    warning: "ยังไม่ยืนยันความสัมพันธ์ระหว่างรายรับและค่าใช้จ่าย จึงงดยอดคงเหลือและอัตรากำไรจนกว่าจะมีนโยบายบัญชีที่อนุมัติจากเซิร์ฟเวอร์",
    warningHistory: "ข้อมูลย้อนหลังจะไม่ถูกเปลี่ยน เดือน ม.ค.–ก.ค. ของ ฒอ-8453 ถือว่า LPG รวมอยู่ใน Fuel การแก้ไขต้องมีหลักฐานจากเจ้าของและการตรวจทานอิสระ เสนอข้อมูลฐานย้อนหลังได้เฉพาะเดือน V4 ที่ยังไม่มีเวอร์ชัน",
    august: "ตัวอย่างอ่านอย่างเดียว: สิงหาคม 2026", september: "ตัวอย่างอ่านอย่างเดียว: กันยายน 2026",
    noSource: "ยังไม่มีการบันทึกฉบับร่าง V4 สำหรับเดือนนี้",
    augustSalary: "ยอดเงินเดือนเดือนสิงหาคมตรงกับยอดควบคุมในรายงาน ไม่รวม DUMMY",
    septemberSalary: "เงินเดือนเดือนกันยายนยังเป็นข้อมูลชั่วคราว รอการตรวจสอบบัญชีเงินเดือนโดยอิสระ",
    formulaPlaceholder: "ชื่อรายงานหรือหน้าต้นทาง (ไม่บังคับ)", inactive: "ไม่ใช้งาน",
    reconciliation: "การกระทบยอด", imported: "ยอดนำเข้า", declared: "ยอดต้นทาง", status: "สถานะ", unknown: "ไม่ทราบ",
    registration: "ทะเบียนรถ", salary: "เงินเดือน", jobs: "จำนวนงาน", trips: "ค่าเที่ยว", expenses: "ค่าใช้จ่าย", parking: "ค่าจอดรถ",
    revenue: "รายรับรวม", fuel: "น้ำมัน", maintenance: "ซ่อมบำรุง", balance: "ยอดคงเหลือที่บันทึก", directCost: "ต้นทุนตรง",
    lpgWarning: "Fuel รวม LPG แล้ว ค่า LPG ยังไม่ทราบและจะไม่นำมาบวกซ้ำ", separateLpg: "LPG เป็นค่าใช้จ่ายแยกและจะนับหนึ่งครั้ง",
    rows: "แถวนำเข้า", excluded: "แถวต้นทางที่ไม่รวม", excludedEvidence: "ค่าต้นทางที่ไม่นำมาคำนวณและยอดควบคุมจากรายงาน", issues: "คำเตือนที่ต้องตรวจสอบ", validationErrors: "ข้อผิดพลาดจากการตรวจสอบ", noIssues: "ไม่มีคำเตือนจากการตรวจสอบ",
    current: "เวอร์ชันรายงานที่บันทึกแล้ว", none: "ยังไม่มีเวอร์ชันรายงานที่บันทึกถาวร", statusDraft: "ฉบับร่าง", statusNeedsReview: "ต้องตรวจสอบ", statusValidated: "ตรวจสอบข้อมูลแล้ว",
    statusReview: "กำลังตรวจทาน", statusApproved: "อนุมัติแล้ว", statusPublished: "เผยแพร่แล้ว", sourceFile: "ไฟล์ต้นทาง", version: "เวอร์ชัน",
    validate: "ตรวจสอบความถูกต้องของฉบับร่าง", sendReview: "ส่งตรวจทาน", approve: "อนุมัติ", reason: "เหตุผลการตรวจทาน", saveSuccess: "บันทึกฉบับร่างพร้อมที่มาของข้อมูลแล้ว",
    reviewSuccess: "อัปเดตสถานะการตรวจทานแล้ว", disabledPublication: "ตัวอย่างอ่านอย่างเดียว · ปิดการบันทึก การตรวจทาน การอนุมัติ และการเผยแพร่",
    requiresMigration: "การบันทึกถาวรรอการตรวจสอบและอนุมัติ migration ฐานข้อมูล Phase 2 ยังสามารถตรวจตัวอย่างในเครื่องได้",
    permission: "บัญชีของคุณตรวจตัวอย่างได้ แต่ไม่มีสิทธิ์นำเข้าข้อมูล", empty: "—", amounts: "จำนวนเงิน (บาท)",
    calculate: "คำนวณจากแถวต้นทาง", monthChoice: "เลือกเดือน", reportStatus: "สถานะเดือน", sourceHash: "SHA-256 ต้นทาง", sheetWarning: "หมายเหตุจากการอ่านไฟล์",
    viewDetails: "ดูแถวและประวัติการตรวจสอบ", hideDetails: "ซ่อนรายละเอียด", uploader: "ผู้นำเข้าข้อมูล", history: "ประวัติการตรวจสอบ", rowsSaved: "แถวรถที่บันทึก", matched: "จับคู่แล้ว", expected: "คาดหมาย", missing: "ขาดหาย", duplicates: "ซ้ำ", reviewer: "ผู้ตรวจทาน", sourceRow: "แถวต้นทาง", sourceSheet: "ชีตต้นทาง", detailsLoading: "กำลังโหลดรายละเอียด…", policyUnverified: "ยังไม่ยืนยันความสัมพันธ์ทางบัญชี จึงงดยอดคงเหลือและอัตรากำไร", contentHash: "SHA-256 เนื้อหาฉบับร่าง",
    assignmentPeriod: "วันที่การกำหนดงานที่ยืนยันแล้วในเดือนนี้", effectiveFrom: "มีผลตั้งแต่", effectiveTo: "มีผลถึง", salaryAllocationReview: "ระบบตรวจสอบการจัดสรรเงินเดือนหลายคันกับข้อมูล HR แบบจำกัดสิทธิ์ และต้องให้ผู้ดูแลระบบตรวจทานโดยอิสระ",
    readOnlySource: "ตัวอย่างจากต้นฉบับแบบอ่านอย่างเดียว · ไม่รวมใน KPI อันดับ และอัตรากำไรที่ใช้งานจริง",
    financialAccessRequired: "ฉบับร่างการเงินรายเดือนและตัวอย่างรายงานต้องใช้สิทธิ์ฝ่ายการเงิน",
    sourcePreviewLoading: "กำลังโหลดตัวอย่างรายงานที่ได้รับอนุญาต…",
    sourcePreviewUnavailable: "ตัวอย่างรายงานที่ได้รับอนุญาตไม่พร้อมใช้งานชั่วคราว",
    matchCount: "รายการตรงกับข้อมูลรถ EES", matchPending: "ยังไม่สามารถตรวจสอบทะเบียนกับรถ EES ได้", matchMissing: "โปรดตรวจสอบทะเบียนรถที่ไม่ตรง",
    sourceFooter: "ยอดรวมจากท้ายรายงานต้นฉบับ", unresolvedDashes: "เครื่องหมายขีดที่ยังไม่ระบุจำนวนเงินคงเป็นค่าไม่ทราบ", sourceReconcile: "ยอดรวมแถวตรงกับยอดควบคุมเมื่อถือว่าขีดเป็นศูนย์เพื่อคำนวณเท่านั้น ช่องที่เป็นขีดยังคงไม่ทราบหากไม่มีกฎยืนยัน",
    augustSalaryVerified: "ยอดเงินเดือนตรงกับยอดควบคุมในรายงาน ไม่รวม DUMMY", septemberSalaryProvisional: "ตัวเลขเงินเดือนเดือนกันยายนยังเป็นข้อมูลชั่วคราวและรอการตรวจสอบบัญชีเงินเดือน",
    sourceLpgRule: "มีเฉพาะ ฒอ-8453 ที่ใช้ LPG เดือนสิงหาคมและกันยายนแสดง LPG แยกจาก Fuel รถคันอื่นที่ยืนยันว่าไม่ใช้ LPG แสดงเป็นศูนย์", sourceDash: "ต้นฉบับเป็นขีด ไม่ได้ระบุตัวเลข", confirmedZero: "ยืนยันเป็นศูนย์", resolvedSourceNote: "หมายเหตุในรายงานยืนยันว่าเป็นศูนย์",
    policyStatus: "นโยบายบัญชี V4", policyDraft: "ฉบับร่าง — ปิดการคำนวณยอดคงเหลือ", policyApproved: "พบข้อมูลนโยบายที่เคยอนุมัติแล้ว", policyEvidencePending: "ปิดการเปิดใช้นโยบายบัญชีไว้สำหรับรุ่นนี้", policyApprovalConflict: "มีหลักฐานการอนุมัติแบบแก้ไขไม่ได้ที่ไม่ตรงกับชุดหลักฐานปัจจุบัน ต้องตรวจทานเวอร์ชันนโยบายใหม่", approvePolicy: "อนุมัติ v4-accounting-draft-3", policyApprovalFailed: "ยังไม่อนุมัตินโยบาย โปรดตรวจสอบสิทธิ์ผู้ดูแลระบบ ชุดหลักฐานที่ตรวจสอบแล้ว และเวอร์ชันนโยบายที่บันทึกไว้",
  }
} as const;

function formatAmount(satang: number | null, language: Language) {
  if (satang === null) return language === "th" ? "ไม่ทราบ" : "Unknown";
  return new Intl.NumberFormat(language === "th" ? "th-TH" : "en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(satang / 100);
}

function localizedDraftMessage(rawCode: string, language: Language) {
  const code = rawCode.split(":")[0];
  const messages: Record<string, [string, string]> = {
    permission_denied: ["Your account does not have permission for this action.", "บัญชีของคุณไม่มีสิทธิ์ดำเนินการนี้"],
    invalid_import_request: ["Import settings or form fields are invalid.", "การตั้งค่าหรือข้อมูลนำเข้าไม่ถูกต้อง"],
    invalid_import_roster: ["The selected month roster contains an invalid or unavailable vehicle.", "รายชื่อรถประจำเดือนมีข้อมูลไม่ถูกต้องหรือไม่พร้อมใช้งาน"],
    invalid_reporting_month: ["Reporting year or month is invalid.", "ปีหรือเดือนรายงานไม่ถูกต้อง"],
    invalid_source_total: ["A source control total is invalid.", "ยอดควบคุมจากรายงานต้นทางไม่ถูกต้อง"],
    file_required: ["Choose a supported XLSX or CSV source file.", "โปรดเลือกไฟล์ต้นทาง XLSX หรือ CSV ที่รองรับ"],
    historical_owner_admin_required: ["Historical proposals require an administrator and owner evidence.", "ข้อเสนอแก้ไขย้อนหลังต้องดำเนินการโดยผู้ดูแลระบบและมีหลักฐานจากเจ้าของ"],
    storage_not_installed: ["Draft storage is not installed. Persistence remains disabled.", "ยังไม่ได้ติดตั้งที่เก็บฉบับร่าง จึงปิดการบันทึกถาวรไว้"],
    draft_storage_unavailable: ["Monthly financial drafts are temporarily unavailable.", "ฉบับร่างการเงินรายเดือนไม่พร้อมใช้งานชั่วคราว"],
    draft_detail_unavailable: ["Saved draft details are temporarily unavailable.", "รายละเอียดฉบับร่างที่บันทึกไว้ไม่พร้อมใช้งานชั่วคราว"],
    draft_not_found: ["This saved financial draft was not found.", "ไม่พบฉบับร่างการเงินที่บันทึกไว้"],
    invalid_draft_request: ["The requested draft details are invalid.", "คำขอรายละเอียดฉบับร่างไม่ถูกต้อง"],
    invalid_review_request: ["The review request or reason is invalid.", "คำขอหรือเหตุผลการตรวจทานไม่ถูกต้อง"],
    review_transition_conflict: ["This review transition is not allowed for the saved draft state.", "ไม่สามารถเปลี่ยนสถานะการตรวจทานจากสถานะฉบับร่างปัจจุบันได้"],
    review_transition_unavailable: ["Review status could not be updated.", "ไม่สามารถอัปเดตสถานะการตรวจทานได้"],
    file_size_limit: ["File or upload exceeds the allowed size.", "ไฟล์หรือข้อมูลนำเข้ามีขนาดเกินกำหนด"],
    request_too_large: ["Upload request exceeds the allowed size.", "คำขอนำเข้ามีขนาดเกินกำหนด"],
    invalid_content_length: ["Upload size could not be verified.", "ไม่สามารถตรวจสอบขนาดไฟล์นำเข้าได้"],
    request_stream_failed: ["The upload could not be read safely.", "ไม่สามารถอ่านข้อมูลนำเข้าได้อย่างปลอดภัย"],
    malformed_multipart: ["The upload request is malformed.", "รูปแบบคำขออัปโหลดไม่ถูกต้อง"],
    malformed_xlsx: ["The Excel workbook is malformed or could not be read.", "ไฟล์ Excel เสียหายหรือไม่สามารถอ่านได้"],
    malformed_csv: ["The CSV file is malformed or could not be read.", "ไฟล์ CSV เสียหายหรือไม่สามารถอ่านได้"],
    xlsx_archive_limits: ["The Excel archive exceeds safe decompression limits.", "ไฟล์ Excel เกินขีดจำกัดการคลายข้อมูลที่ปลอดภัย"],
    worksheet_limit: ["The workbook has too many worksheets.", "สมุดงานมีจำนวนชีตเกินกำหนด"],
    worksheet_limits: ["A worksheet exceeds safe row, column, or cell limits.", "ชีตมีจำนวนแถว คอลัมน์ หรือเซลล์เกินขีดจำกัดที่ปลอดภัย"],
    workbook_total_limits: ["Selected worksheets exceed safe workbook row or cell limits.", "ชีตที่เลือกมีจำนวนแถวหรือเซลล์รวมเกินขีดจำกัดที่ปลอดภัย"],
    xlsx_signature_mismatch: ["The file extension does not match an XLSX workbook.", "นามสกุลไฟล์ไม่ตรงกับรูปแบบ XLSX"],
    csv_signature_mismatch: ["The file extension does not match a UTF-8 or Thai CSV file.", "นามสกุลไฟล์ไม่ตรงกับรูปแบบ CSV ภาษาไทยหรือ UTF-8"],
    unsupported_csv_encoding: ["CSV encoding is not supported.", "ไม่รองรับรหัสอักขระของไฟล์ CSV"],
    standard_headers_missing: ["The selected sheet does not contain all standard finance columns.", "ชีตที่เลือกไม่มีคอลัมน์การเงินมาตรฐานครบถ้วน"],
    standard_headers_required: ["The report columns do not match the standard monthly financial format.", "คอลัมน์รายงานไม่ตรงกับรูปแบบการเงินรายเดือนมาตรฐาน"],
    unsupported_format: ["Only supported XLSX and CSV files can be imported.", "นำเข้าได้เฉพาะไฟล์ XLSX และ CSV ที่รองรับ"],
    selected_sheet_missing: ["A selected worksheet is missing.", "ไม่พบชีตที่เลือก"],
    formula_cells_present: ["Formula cells were found; verify source values before importing.", "พบเซลล์สูตร โปรดตรวจสอบค่าต้นทางก่อนนำเข้า"],
    unsafe_source_cell: ["A formula, date-formatted, or unsafe text value was withheld.", "งดใช้ค่าที่เป็นสูตร วันที่ หรือข้อความที่ไม่ปลอดภัย"],
    invalid_month: ["Reporting month is invalid.", "เดือนไม่ถูกต้อง"],
    historical_owner_review_required: ["Historical changes require documented owner request.", "การแก้ไขย้อนหลังต้องมีหลักฐานคำขอจากเจ้าของ"],
    historical_approved_base_version_required: ["Historical correction requires an approved base version.", "การแก้ไขย้อนหลังต้องอ้างอิงเวอร์ชันฐานที่อนุมัติแล้ว"],
    historical_baseline_requires_empty_month: ["An initial baseline is allowed only when no V4 version exists for the month.", "เสนอข้อมูลฐานย้อนหลังได้เฉพาะเดือนที่ยังไม่มีเวอร์ชัน V4"],
    historical_baseline_source_required: ["An initial baseline needs a source report reference.", "ข้อมูลฐานย้อนหลังครั้งแรกต้องมีแหล่งอ้างอิงรายงานต้นทาง"],
    invalid_or_duplicate_version: ["Draft version is invalid or already exists.", "เวอร์ชันฉบับร่างไม่ถูกต้องหรือมีอยู่แล้ว"],
    missing_provenance: ["Source file provenance is incomplete.", "ข้อมูลที่มาของไฟล์ต้นทางไม่ครบถ้วน"],
    source_relationships_unverified: ["Accounting relationships are unverified; balance and margin are withheld.", "ยังไม่ยืนยันความสัมพันธ์ทางบัญชี จึงงดยอดคงเหลือและอัตรากำไร"],
    monthly_roster_required: ["Select the expected monthly vehicle roster.", "โปรดเลือกรายชื่อรถประจำเดือน"],
    ambiguous_registration: ["A registration matches more than one vehicle.", "ทะเบียนรถจับคู่กับรถมากกว่าหนึ่งคัน"],
    unknown_registration: ["A registration could not be matched to a canonical vehicle.", "ไม่พบทะเบียนรถในรายชื่อรถมาตรฐาน"],
    post_july_lpg_must_be_separate: ["From August 2026, LPG must be recorded separately.", "ตั้งแต่เดือนสิงหาคม 2026 ต้องบันทึก LPG แยกจาก Fuel"],
    historical_lpg_included_in_fuel_required: ["For ฒอ-8453 in January–July, LPG is included in Fuel.", "เดือนมกราคม–กรกฎาคมของ ฒอ-8453 ให้ถือว่า LPG รวมอยู่ใน Fuel"],
    lpg_treatment_conflicts_with_vehicle_policy: ["LPG treatment conflicts with the owner-confirmed vehicle rule.", "วิธีบันทึก LPG ไม่ตรงกับกฎรถที่เจ้าของยืนยันแล้ว"],
    lpg_recorded_for_non_lpg_vehicle: ["A positive LPG amount was entered for a vehicle confirmed not to use LPG.", "มีการกรอกค่า LPG มากกว่าศูนย์ให้รถที่ยืนยันว่าไม่ใช้ LPG"],
    lpg_canonical_vehicle_ambiguous: ["The canonical LPG vehicle identity matches more than one fleet vehicle.", "ข้อมูลรถ LPG มาตรฐานตรงกับรถในกองยานพาหนะมากกว่าหนึ่งคัน"],
    fleet_roster_confirmation_required: ["Confirm the complete monthly roster before treating non-LPG vehicles as zero.", "ยืนยันรายชื่อรถทั้งหมดของเดือนก่อนกำหนดให้รถที่ไม่ใช้ LPG เป็นศูนย์"],
    duplicate_vehicle_month: ["A vehicle appears more than once for this month.", "พบรถคันเดียวกันมากกว่าหนึ่งแถวในเดือนนี้"],
    missing_vehicle: ["An expected vehicle is missing from the source rows.", "ไม่พบรถที่คาดหมายในแถวต้นทาง"],
    missing_or_invalid_value: ["A required amount or job count is blank or invalid.", "จำนวนเงินหรือจำนวนงานที่จำเป็นว่างหรือไม่ถูกต้อง"],
    lpg_treatment_unverified: ["LPG inclusion treatment is unknown.", "ยังไม่ทราบวิธีรวมค่า LPG"],
    lpg_amount_unknown: ["Separate LPG amount is unknown.", "ยังไม่ทราบจำนวนค่า LPG ที่แยกบันทึก"],
    salary_assignment_unverified: ["Monthly employee assignment or payroll evidence is unverified.", "ยังไม่ยืนยันพนักงานประจำเดือนหรือหลักฐานเงินเดือน"],
    salary_allocation_approval_required: ["One employee is assigned to multiple vehicles; approved allocation is required.", "พนักงานหนึ่งคนถูกกำหนดให้รถหลายคัน ต้องอนุมัติการจัดสรรก่อน"],
    salary_month_base_required: ["Multi-vehicle salary allocation requires verified payroll and assignment evidence.", "การจัดสรรเงินเดือนหลายคันต้องมีหลักฐานเงินเดือนและการกำหนดรถที่ตรวจสอบแล้ว"],
    salary_employee_base_mismatch: ["Vehicle salary allocations must sum exactly to the verified employee-month base.", "ยอดเงินเดือนที่จัดสรรต้องรวมเท่ากับฐานเงินเดือนรายเดือนที่ตรวจสอบแล้ว"],
    salary_assignment_dates_required: ["Multi-vehicle assignments need valid dates within the reporting month.", "การกำหนดรถหลายคันต้องระบุวันที่ที่ถูกต้องภายในเดือนรายงาน"],
    salary_assignment_overlap: ["An employee has overlapping assignments on different vehicles.", "ช่วงเวลาการกำหนดพนักงานให้รถต่างคันทับซ้อนกัน"],
    driver_identity_missing_or_invalid: ["The driver identity is missing or is not a valid BIGINT ID.", "ไม่พบรหัสผู้ขับหรือรหัส BIGINT ไม่ถูกต้อง"],
    employee_profile_missing: ["No HR employee profile is linked to this driver.", "ไม่มีประวัติพนักงาน HR ที่เชื่อมโยงกับผู้ขับรายนี้"],
    employee_identity_ambiguous: ["More than one HR employee profile is linked to this driver.", "มีประวัติพนักงาน HR ที่เชื่อมโยงกับผู้ขับรายนี้มากกว่าหนึ่งรายการ"],
    employee_identity_history_requires_review: ["The driver-to-employee identity changed after this report month and needs review.", "ข้อมูลเชื่อมโยงผู้ขับกับพนักงานมีการแก้ไขหลังเดือนรายงาน จึงต้องตรวจสอบ"],
    monthly_payroll_missing: ["No effective monthly payroll record was found for this report month.", "ไม่พบข้อมูลเงินเดือนรายเดือนที่มีผลในเดือนรายงาน"],
    monthly_thb_payroll_required: ["HR compensation must be monthly and denominated in THB for this comparison.", "ข้อมูลค่าตอบแทน HR ที่ใช้เปรียบเทียบต้องเป็นรายเดือนและสกุลเงินบาท"],
    payroll_changed_during_month: ["HR monthly compensation changed during the report month.", "ข้อมูลเงินเดือน HR มีการเปลี่ยนแปลงระหว่างเดือนรายงาน"],
    employee_month_salary_allocation_mismatch: ["Source salary allocations do not equal the HR monthly base salary.", "ยอดจัดสรรเงินเดือนจากรายงานไม่เท่ากับเงินเดือนฐานรายเดือนของ HR"],
    source_salary_unknown: ["The source salary is unknown and cannot be compared with HR.", "ไม่ทราบเงินเดือนจากรายงาน จึงเปรียบเทียบกับ HR ไม่ได้"],
    source_salary_payroll_mismatch: ["Source salary differs from the effective HR monthly base salary.", "เงินเดือนจากรายงานไม่ตรงกับเงินเดือนฐานรายเดือน HR ที่มีผล"],
    canonical_vehicle_identity_missing: ["A canonical vehicle ID is required for the HR assignment check.", "ต้องมีรหัสรถมาตรฐานเพื่อเปรียบเทียบการกำหนดรถใน HR"],
    source_assignment_dates_missing_or_invalid: ["Valid source assignment dates within the report month are required.", "ต้องระบุวันที่การกำหนดรถจากแหล่งข้อมูลให้ถูกต้องภายในเดือนรายงาน"],
    dated_vehicle_assignment_mismatch: ["Source vehicle and assignment dates do not match the effective HR assignment.", "รถหรือวันที่กำหนดจากรายงานไม่ตรงกับการกำหนดรถ HR ที่มีผล"],
    overlapping_vehicle_assignment: ["HR records show overlapping assignments to different vehicles.", "ข้อมูล HR แสดงการกำหนดผู้ขับให้รถต่างคันทับซ้อนกัน"],
    source_total_required: ["Source control total is required.", "ต้องระบุยอดควบคุมจากรายงานต้นทาง"],
    source_total_mismatch: ["Imported amounts do not reconcile to the declared source total.", "ยอดนำเข้าไม่ตรงกับยอดรวมจากรายงานต้นทาง"],
    august_salary_control_mismatch: ["August salary does not reconcile to the report control excluding DUMMY.", "เงินเดือนเดือนสิงหาคมไม่ตรงกับยอดควบคุมในรายงานโดยไม่รวม DUMMY"],
    september_salary_verification_required: ["September salary requires independent source verification.", "เงินเดือนเดือนกันยายนต้องตรวจสอบกับแหล่งข้อมูล"],
    outside_monthly_roster: ["A matched vehicle is outside the selected month roster.", "รถที่จับคู่แล้วอยู่นอกรายชื่อรถของเดือนนี้"],
    vehicle_month_already_published: ["A vehicle-month already has a publication record.", "มีข้อมูลเผยแพร่ของรถและเดือนนี้แล้ว"],
    column_count: ["A source row does not have the standard number of columns.", "แถวต้นทางมีจำนวนคอลัมน์ไม่ตรงมาตรฐาน"],
    empty_report: ["No financial vehicle rows were found.", "ไม่พบแถวข้อมูลการเงินของรถ"],
    duplicate_import: ["This exact source and reviewed mapping already exists for this month.", "ไฟล์ต้นทางและการจับคู่ชุดนี้มีอยู่ในเดือนนี้แล้ว"],
    version_conflict: ["Another import created this version; refresh the month.", "มีการนำเข้าเวอร์ชันนี้แล้ว โปรดโหลดเดือนใหม่"]
  };
  return messages[code]?.[language === "th" ? 1 : 0] ?? rawCode;
}

function statusLabel(status: string, c: { statusValidated: string; statusNeedsReview: string; statusReview: string; statusApproved: string; statusPublished: string; statusDraft: string }) {
  if (status === "validated") return c.statusValidated;
  if (status === "needs_review") return c.statusNeedsReview;
  if (status === "in_review") return c.statusReview;
  if (status === "approved") return c.statusApproved;
  if (status === "published") return c.statusPublished;
  return c.statusDraft;
}

const readOnlyPreviewColumns = [
  ["Registration", "registration"], ["Salary", "salary"], ["Jobs", "jobs"],
  ["Trip Payments", "tripPayments"], ["Expenses", "expenses"], ["Parking Fees", "parkingFees"],
  ["Total Received", "totalReceived"], ["Fuel", "fuel"], ["LPG", "lpg"], ["Maintenance", "maintenance"]
] as const;
function formatSourceAmount(value: string | null) {
  if (value === null) return null;
  const [whole, fraction] = value.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction === undefined ? grouped : `${grouped}.${fraction}`;
}

function ReadOnlySourcePreview({ report, language, c, vehicleIdsByAlias }: {
  report: SourcePreview;
  language: Language;
  c: typeof copy.en | typeof copy.th;
  vehicleIdsByAlias: Map<string, Set<string>>;
}) {
  const isAugust = report.reportingMonth === "2026-08";
  const label = isAugust ? c.august : c.september;
  const allSourceVehicles = vehicleIdsByAlias.size > 0;
  const matchedRows = report.rows.filter(row => {
    const aliases = knownVehicleRegistrationAliases(row.registration);
    const matches = new Set(aliases.flatMap(alias => [...(vehicleIdsByAlias.get(alias) ?? [])]));
    return matches.size === 1;
  }).length;
  const unresolvedDashes = report.rows.reduce((sum, row) => sum + Object.values(row.sourceDashStatus).filter(value => value === "unresolved_source_dash").length, 0);
  const salaryText = isAugust ? c.augustSalaryVerified : c.septemberSalaryProvisional;
  const totalValue = (field: string) => formatSourceAmount(report.sourceFooterTotals[field as keyof typeof report.sourceFooterTotals] ?? null) ?? "—";

  return <article className="overflow-hidden rounded-xl border border-slate-200 bg-white">
    <div className="border-b border-slate-200 bg-slate-50/80 px-3.5 py-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div><h4 className="text-sm font-bold text-slate-950">{label}</h4><p className="mt-1 text-xs text-slate-600">{report.rowCount} named vehicle rows · {allSourceVehicles ? `${matchedRows}/${report.rowCount} ${c.matchCount}` : c.matchPending}</p></div>
        <span className="inline-flex w-fit rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-amber-900">{c.readOnlySource}</span>
      </div>
      <p className={`mt-2 rounded-lg px-3 py-2 text-xs ${isAugust ? "bg-violet-50 text-violet-950" : "bg-amber-50 text-amber-950"}`}>{salaryText}</p>
      <p className="mt-2 text-xs text-slate-600">{c.sourceLpgRule}</p>
      {allSourceVehicles && matchedRows !== report.rowCount ? <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-900">{c.matchMissing}: {report.rowCount - matchedRows} of {report.rowCount}</p> : null}
    </div>
    <div className="overflow-x-auto">
      <table className="min-w-[1120px] w-full text-xs">
        <thead className="bg-slate-100 text-left text-slate-700"><tr>{readOnlyPreviewColumns.map(([label]) => <th key={label} className="px-2.5 py-2 font-semibold">{label}</th>)}</tr></thead>
        <tbody>
          {report.rows.map(row => {
            const aliases = knownVehicleRegistrationAliases(row.registration);
            const matches = new Set(aliases.flatMap(alias => [...(vehicleIdsByAlias.get(alias) ?? [])]));
            const vehicleMatch = matches.size === 1 ? "matched" : matches.size > 1 ? "ambiguous" : "missing";
            const valueFor = (field: keyof typeof row) => {
              const value = row[field];
              if (typeof value !== "string") return null;
              return formatSourceAmount(value);
            };
            return <tr key={row.registration} className="border-t border-slate-100 align-top">
              {readOnlyPreviewColumns.map(([header, field]) => {
                const raw = valueFor(field as keyof typeof row);
                const dashStatus = row.sourceDashStatus[field as keyof typeof row.sourceDashStatus];
                const label = raw === null ? c.sourceDash : dashStatus === "confirmed_zero_by_owner_rule" ? c.confirmedZero : dashStatus === "zero_confirmed_by_source_note" ? c.resolvedSourceNote : undefined;
                return <td key={`${row.registration}-${header}`} className={`px-2.5 py-2 tabular-nums ${field === "registration" ? "font-semibold text-slate-950" : "text-slate-700"}`} title={label}>
                  {field === "registration" ? <span className="flex flex-col gap-1">{raw}<span className={`w-fit rounded px-1.5 py-0.5 text-[9px] font-semibold ${vehicleMatch === "matched" ? "bg-emerald-50 text-emerald-800" : vehicleMatch === "missing" ? "bg-rose-50 text-rose-800" : "bg-amber-50 text-amber-800"}`}>{!allSourceVehicles ? c.matchPending : vehicleMatch === "matched" ? c.matchCount : c.matchMissing}</span></span> : raw === null ? <span aria-label={c.sourceDash} className="text-amber-800">—</span> : <span>{raw}{dashStatus === "confirmed_zero_by_owner_rule" ? <sup title={c.confirmedZero}>†</sup> : null}</span>}
                </td>;
              })}
            </tr>;
          })}
        </tbody>
        <tfoot className="border-t-2 border-slate-300 bg-slate-50 font-semibold text-slate-900"><tr>
          {readOnlyPreviewColumns.map(([header, field]) => <td key={header} className="px-2.5 py-2 tabular-nums">{field === "registration" ? c.sourceFooter : totalValue(field)}</td>)}
        </tr></tfoot>
      </table>
    </div>
    <div className="space-y-1 px-3.5 py-3 text-[11px] text-slate-600">
      <p>{report.rowSumReconciliation.caveat}</p>
      <p>{c.sourceReconcile} · {c.unresolvedDashes}: {unresolvedDashes}</p>
      {report.sourceNotes.map(note => <p key={note}>{note}</p>)}
      <details className="pt-1"><summary className="cursor-pointer font-semibold text-slate-700">{report.sourceFile} · source SHA-256</summary><p className="mt-1 break-all font-mono text-[10px]">{report.sourceSha256}</p></details>
    </div>
  </article>;
}

function BatchDetailsPanel({ detail, language, copy: c }: { detail: BatchDetail; language: Language; copy: typeof copy.en | typeof copy.th }) {
  const amountFields = ["salary", "trip_payments", "expenses", "parking_fees", "total_received", "fuel", "lpg", "maintenance"];
  const totalsFields: Array<[FinancialField, string]> = [["salary", "salary"], ["jobs", "jobs"], ["tripPayments", "tripPayments"], ["expenses", "expenses"], ["parking", "parking"], ["totalReceived", "totalReceived"], ["fuel", "fuel"], ["lpg", "lpg"], ["maintenance", "maintenance"]];
  const fieldLabels: Record<string, string> = { salary: c.salary, jobs_completed: c.jobs, trip_payments: c.trips, expenses: c.expenses, parking_fees: c.parking, total_received: c.revenue, fuel: c.fuel, lpg: "LPG", maintenance: c.maintenance };
  const display = (value: unknown) => value === null || value === undefined || value === "" ? c.unknown : String(value);
  const createdAt = (value: unknown) => typeof value === "string" ? new Intl.DateTimeFormat(language === "th" ? "th-TH" : "en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : c.unknown;
  return <section aria-label={c.viewDetails} className="mt-3 rounded-xl border border-brand-200 bg-brand-50/40 p-3 text-xs">
    <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      <div><dt className="font-semibold text-slate-600">{c.uploader}</dt><dd className="break-words text-slate-900">{detail.batch.uploader_name}</dd></div>
      <div><dt className="font-semibold text-slate-600">{c.sourceFile}</dt><dd className="break-all text-slate-900">{detail.batch.source_file_name}</dd></div>
      <div><dt className="font-semibold text-slate-600">{c.sourceHash}</dt><dd className="break-all font-mono text-[10px] text-slate-900">{detail.batch.source_sha256}</dd></div>
      <div><dt className="font-semibold text-slate-600">{c.contentHash}</dt><dd className="break-all font-mono text-[10px] text-slate-900">{detail.batch.content_hash}</dd></div>
      <div><dt className="font-semibold text-slate-600">{c.rowsSaved}</dt><dd className="text-slate-900">{detail.entries.length}</dd></div>
    </dl>
    <p className="mt-2 text-xs text-slate-600">{c.rosterConfirmed}: {detail.batch.validation_snapshot?.fleetRosterConfirmed ? (language === "th" ? "ใช่" : "Yes") : (language === "th" ? "ไม่" : "No")}</p>
    {detail.batch.validation_snapshot?.issues?.length ? <section aria-label={c.validationErrors} className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-rose-900"><h5 className="font-semibold">{c.validationErrors}</h5><ul className="mt-1 list-disc pl-5">{detail.batch.validation_snapshot.issues.map((issue,index) => <li key={`${issue.code}-${issue.row ?? index}`}>{localizedDraftMessage(issue.code === "import_parser_issue" ? String(issue.field ?? issue.code) : issue.code, language)}{issue.row ? ` · ${c.sourceRow} ${issue.row}` : ""}{issue.field && issue.code !== "import_parser_issue" ? ` · ${issue.field}` : ""}</li>)}</ul></section> : null}
    {detail.batch.validation_snapshot?.reviewWarnings?.length ? <ul className="mt-3 list-disc rounded-lg bg-amber-50 px-7 py-2 text-amber-900">{detail.batch.validation_snapshot.reviewWarnings.map((warning,index) => <li key={`${warning.code}-${index}`}>{localizedDraftMessage(warning.code, language)}{warning.field ? ` · ${warning.field}` : ""}</li>)}</ul> : null}
    <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200 bg-white"><table className="min-w-[600px] w-full text-left text-[11px]"><caption className="p-2 text-left font-semibold text-slate-700">{c.reconciliation}</caption><thead className="bg-slate-50"><tr><th className="p-2">{c.reconciliation}</th><th className="p-2 text-right">{c.imported}</th><th className="p-2 text-right">{c.declared}</th></tr></thead><tbody>{totalsFields.map(([field, key]) => { const imported = detail.batch.calculated_totals?.[field] ?? null; const declared = parseFinancialValue(detail.batch.source_totals?.[key], field === "jobs"); return <tr key={field} className="border-t border-slate-100"><td className="p-2">{fieldLabels[field] ?? field}</td><td className="p-2 text-right tabular-nums">{field === "jobs" ? imported ?? c.unknown : formatAmount(imported, language)}</td><td className="p-2 text-right tabular-nums">{field === "jobs" ? declared ?? c.unknown : formatAmount(declared, language)}</td></tr>; })}</tbody></table></div>
    {detail.batch.source_controls?.length ? <details className="mt-3 rounded-lg border border-slate-200 bg-white p-2"><summary className="cursor-pointer font-semibold text-slate-700">{c.excludedEvidence} ({detail.batch.source_controls.length})</summary><ul className="mt-2 space-y-1">{detail.batch.source_controls.map((source, index) => <li key={`${source.sheet}-${source.row}-${index}`} className="rounded-md bg-slate-50 p-2"><span className="font-medium">{source.kind === "excluded_dummy" ? c.excluded : c.declared}</span> · {display(source.sheet)} · {c.sourceRow} {display(source.row)}<pre className="mt-1 max-w-full whitespace-pre-wrap break-all text-[10px] text-slate-600">{JSON.stringify(source.values ?? [], null, 2)}</pre></li>)}</ul></details> : null}
    <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="min-w-[1120px] w-full text-left"><caption className="sr-only">{c.rowsSaved}</caption><thead className="bg-slate-50"><tr><th className="p-2">{c.registration}</th><th className="p-2">{c.employee}</th><th className="p-2">{c.assignmentPeriod}</th><th className="p-2">{c.sourceSheet}</th><th className="p-2">{c.sourceRow}</th>{amountFields.map(field => <th key={field} className="p-2">{fieldLabels[field]}</th>)}<th className="p-2">{c.lpg}</th><th className="p-2">{c.sourceFile}</th></tr></thead><tbody>
        {detail.entries.map((entry, index) => <tr key={String(entry.id ?? index)} className="border-t border-slate-100 align-top"><td className="p-2 font-semibold">{display(entry.registration_snapshot ?? entry.registration_source)}</td><td className="p-2">{display(entry.assigned_employee_id)}</td><td className="p-2">{display(entry.assignment_effective_from)} – {display(entry.assignment_effective_to)}</td><td className="p-2">{display(entry.source_sheet)}</td><td className="p-2">{display(entry.source_row)}</td>{amountFields.map(field => <td key={field} className="p-2 tabular-nums">{display(entry[field])}</td>)}<td className="p-2">{display(entry.lpg_treatment)}</td><td className="p-2"><details><summary className="cursor-pointer font-medium text-brand-800">{c.viewDetails}</summary><pre className="mt-1 max-w-xs whitespace-pre-wrap break-all text-[10px] text-slate-600">{JSON.stringify(entry.source_values ?? {}, null, 2)}</pre></details></td></tr>)}
      </tbody></table>
    </div>
    <details className="mt-3 rounded-lg bg-white p-2"><summary className="cursor-pointer font-semibold text-slate-700">{c.salaryAllocationReview}</summary><pre className="mt-1 whitespace-pre-wrap break-all text-[10px] text-slate-600">{JSON.stringify(detail.batch.salary_verification ?? {}, null, 2)}</pre></details>
    <div className="mt-3 grid gap-3 md:grid-cols-2">
      <div><h5 className="font-semibold text-slate-700">{c.history}</h5><ol className="mt-1 space-y-1">{detail.history.map((event, index) => <li key={String(event.id ?? index)} className="rounded-md bg-white p-2"><span className="font-semibold">{display(event.actor_name)}</span> · {display(event.from_status)} → {display(event.to_status)} · {createdAt(event.created_at)}<p className="mt-0.5 break-words text-slate-600">{display(event.reason)}</p><p className="break-all font-mono text-[10px] text-slate-500">{display(event.content_hash)}</p></li>)}</ol></div>
      <div><h5 className="font-semibold text-slate-700">{c.reviewer}</h5><ol className="mt-1 space-y-1">{detail.approvals.length ? detail.approvals.map((approval, index) => <li key={String(approval.id ?? index)} className="rounded-md bg-white p-2"><span className="font-semibold">{display(approval.reviewer_name)}</span> · {display(approval.decision)} · {createdAt(approval.created_at)}<p className="mt-0.5 break-words text-slate-600">{display(approval.reason)}</p><p className="break-all font-mono text-[10px] text-slate-500">{display(approval.content_hash)}</p></li>) : <li className="text-slate-500">{c.none}</li>}</ol></div>
    </div>
    <p className="mt-3 rounded-lg bg-amber-50 px-2.5 py-2 text-amber-900">{c.policyUnverified}</p>
  </section>;
}

export function VehicleFinancialDrafts({ language, vehicles: fallbackVehicles, canImport, canReview, canApprove }: Props) {
  const c = copy[language];
  const [metadata, setMetadata] = useState<DraftMetadata | null>(null);
  const [sourcePreviews, setSourcePreviews] = useState<SourcePreview[] | null>(null);
  const [sourcePreviewError, setSourcePreviewError] = useState(false);
  const [batchDetails, setBatchDetails] = useState<Record<string, BatchDetail | null>>({});
  const [openBatchId, setOpenBatchId] = useState<string | null>(null);
  const [metadataError, setMetadataError] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<ReturnType<typeof parseFinancialWorkbook> | null>(null);
  const [selectedSheets, setSelectedSheets] = useState<string[]>([]);
  const [annotations, setAnnotations] = useState<Record<string, Annotation>>({});
  const [sourceTotals, setSourceTotals] = useState<Partial<Record<FinancialField, string>>>({});
  const [expectedVehicleIds, setExpectedVehicleIds] = useState<string[]>([]);
  const [fleetRosterConfirmed, setFleetRosterConfirmed] = useState(false);
  const [year, setYear] = useState(2026);
  const [month, setMonth] = useState(8);
  const [formulaReference, setFormulaReference] = useState("");
  const [ownerRequested, setOwnerRequested] = useState(false);
  const [initialBaseline, setInitialBaseline] = useState(false);
  const [ownerEvidence, setOwnerEvidence] = useState("");
  const [baseVersion, setBaseVersion] = useState("");
  const [septemberSalaryVerified, setSeptemberSalaryVerified] = useState(false);
  const [septemberSalaryEvidence, setSeptemberSalaryEvidence] = useState("");
  const [preview, setPreview] = useState<ReturnType<typeof previewFinancialDraft> | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [reviewReason, setReviewReason] = useState("");
  const [localHash, setLocalHash] = useState("");

  const vehicleChoices = useMemo(() => metadata?.vehicles?.length ? metadata.vehicles : fallbackVehicles.map(vehicle => ({
    id: vehicle.id, vehicle_reg: vehicle.vehicle_reg, active: vehicle.active
  })), [fallbackVehicles, metadata?.vehicles]);
  const canonicalVehicles = useMemo(() => vehicleChoices.map(vehicle => ({
    id: vehicle.id, registration: vehicle.vehicle_reg, aliases: knownVehicleRegistrationAliases(vehicle.vehicle_reg)
  })), [vehicleChoices]);
  const vehicleIdsByAlias = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const vehicle of canonicalVehicles) for (const alias of [vehicle.registration, ...(vehicle.aliases ?? [])]) {
      const ids = map.get(alias) ?? new Set<string>(); ids.add(vehicle.id); map.set(alias, ids);
    }
    return map;
  }, [canonicalVehicles]);
  const lpgVehicleIds = useMemo(() => new Set(canonicalLpgVehicleIds(canonicalVehicles)), [canonicalVehicles]);
  const driverChoices = metadata?.drivers ?? [];
  const currentMonth = `${year}-${String(month).padStart(2, "0")}`;
  const monthBatches = (metadata?.batches ?? []).filter(batch => batch.reporting_month.startsWith(`${currentMonth}-`));
  const existingVersions = monthBatches.map(batch => batch.version);
  const publishedVehicleIds = (metadata?.published ?? []).filter(item => item.reporting_month.startsWith(`${currentMonth}-`)).map(item => item.vehicle_id);
  const approvedVersions = monthBatches.filter(batch => ["approved", "published"].includes(batch.status));

  const refreshMetadata = useCallback(async () => {
    if (!canReview) return;
    setMetadataError("");
    try {
      const token = await getAccessToken();
      const response = await fetch("/api/vehicle-performance-v4/drafts", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.errorCode ? localizedDraftMessage(data.errorCode, language) : data.error || "Unable to load financial draft metadata.");
      setMetadata(data as DraftMetadata);
    } catch (cause) {
      setMetadataError(cause instanceof Error ? cause.message : localizedDraftMessage("draft_storage_unavailable", language));
    }
  }, [canReview, language]);

  useEffect(() => {
    if (!canReview) {
      setSourcePreviews(null);
      setSourcePreviewError(false);
      return;
    }
    let active = true;
    setSourcePreviews(null);
    setSourcePreviewError(false);
    void (async () => {
      try {
        const token = await getAccessToken();
        const response = await fetch("/api/vehicle-performance-v4/source-previews", {
          headers: { Authorization: `Bearer ${token}` }, cache: "no-store"
        });
        if (!response.ok) throw new Error("source preview unavailable");
        const data = await response.json() as { reports?: SourcePreview[] };
        if (!Array.isArray(data.reports) || data.reports.length !== 2) throw new Error("source preview unavailable");
        if (active) setSourcePreviews(data.reports);
      } catch {
        if (active) setSourcePreviewError(true);
      }
    })();
    return () => { active = false; };
  }, [canReview]);

  useEffect(() => { if (canReview) void refreshMetadata(); }, [canReview, refreshMetadata]);

  async function selectFile(nextFile: File | null) {
    setError(""); setMessage(""); setPreview(null); setParsed(null); setFile(nextFile); setAnnotations({}); setSourceTotals({});
    if (!nextFile) return;
    try {
      if (!/\.(xlsx|csv)$/i.test(nextFile.name)) throw new Error(language === "th" ? "รองรับเฉพาะไฟล์ .xlsx และ .csv" : "Only .xlsx and .csv source files are supported.");
      if (nextFile.size < 1 || nextFile.size > MAX_FINANCIAL_FILE_BYTES) throw new Error(localizedDraftMessage("file_size_limit", language));
      const bytes = new Uint8Array(await nextFile.arrayBuffer());
      const sheetNames = listFinancialWorkbookSheets(bytes);
      const workbook = parseFinancialWorkbook(bytes, sheetNames);
      setParsed(workbook);
      setSelectedSheets(sheetNames.length === 1 ? sheetNames : []);
      const controlRows = workbook.controls;
      if (controlRows.length === 1) {
        const controls = Object.fromEntries(FINANCIAL_COLUMNS.slice(1).map(([field], index) => [field, String(controlRows[0].cells[index + 1] ?? "")]));
        setSourceTotals(controls as Partial<Record<FinancialField, string>>);
      }
      const hash = await crypto.subtle.digest("SHA-256", bytes);
      setLocalHash(Array.from(new Uint8Array(hash)).map(value => value.toString(16).padStart(2, "0")).join(""));
    } catch (cause) { setError(cause instanceof FinancialWorkbookError ? localizedDraftMessage(cause.code, language) : cause instanceof Error ? cause.message : "Unable to read the source workbook."); }
  }

  function rowKey(row: { sheet: string; row: number }) { return `${row.sheet}:${row.row}`; }
  function canonicalVehicleId(row: { cells: unknown[] }) {
    const matches = new Set(knownVehicleRegistrationAliases(String(row.cells[0] ?? "")).flatMap(alias => [...(vehicleIdsByAlias.get(alias) ?? [])]));
    return matches.size === 1 ? [...matches][0] : null;
  }
  function ownerTreatment(row: { cells: unknown[] }): LpgTreatment | null {
    const vehicleId = canonicalVehicleId(row);
    if (!vehicleId) return null;
    if (lpgVehicleIds.has(vehicleId)) {
      if (currentMonth >= "2026-01" && currentMonth <= "2026-07") return "included_in_fuel";
      if (currentMonth >= "2026-08") return "separate";
      return null;
    }
    if (fleetRosterConfirmed && expectedVehicleIds.includes(vehicleId)) return "separate";
    return null;
  }
  function resolveTreatment(row: { cells: unknown[]; sheet: string; row: number }): LpgTreatment {
    const ownerRule = ownerTreatment(row);
    if (ownerRule) return ownerRule;
    const configured = annotations[rowKey(row)]?.lpgTreatment;
    if (configured) return configured;
    return "unknown";
  }

  async function buildPreview(): Promise<ReturnType<typeof previewFinancialDraft> | null> {
    setError(""); setMessage("");
    try {
    if (!file || !parsed) { setError(c.noFile); return null; }
    if (!selectedSheets.length) { setError(c.noSheets); return null; }
    if (!expectedVehicleIds.length) { setError(c.noRoster); return null; }
    const selectedWorkbook = parseFinancialWorkbook(new Uint8Array(await file.arrayBuffer()), selectedSheets, annotations);
    const rows = selectedWorkbook.rows.map(row => ({
      ...row,
      employeeId: annotations[rowKey(row)]?.employeeId || undefined,
      lpgTreatment: resolveTreatment(row)
    }));
    const aliases = (vehicle: { id: string; vehicle_reg: string }) => ({ id: vehicle.id, registration: vehicle.vehicle_reg, aliases: knownVehicleRegistrationAliases(vehicle.vehicle_reg) });
    const monthDrafts = (metadata?.batches ?? []).filter(batch => batch.reporting_month.startsWith(`${currentMonth}-`));
    const approvedBase = monthDrafts.find(batch => Number(batch.version) === Number(baseVersion) && ["approved", "published"].includes(batch.status));
    const input = {
      reportingMonth: currentMonth,
      version: Math.max(0, ...monthDrafts.map(batch => batch.version)) + 1,
      source: { fileName: file.name, sha256: localHash || "", format: file.name.toLowerCase().endsWith(".csv") ? "csv" as const : "xlsx" as const, pdfReviewed: false },
      headers: selectedWorkbook.headers,
      rows,
      vehicles: vehicleChoices.map(aliases),
      expectedVehicleIds,
      fleetRosterConfirmed,
      existingVersions: monthDrafts.map(batch => batch.version),
      publishedVehicleIds,
      sourceTotals,
      historicalCorrection: currentMonth >= "2026-01" && currentMonth <= "2026-07" ? {
        kind: initialBaseline && monthDrafts.length === 0 ? "initial_baseline" as const : "correction" as const,
        explicitlyRequestedByOwner: ownerRequested && Boolean(ownerEvidence.trim()), reason: ownerRequested ? ownerEvidence : "",
        evidenceReference: initialBaseline ? ownerEvidence : undefined,
        baseVersion: Number(baseVersion) || undefined, approvedBaseVersion: approvedBase ? Number(baseVersion) : undefined
      } : undefined,
      septemberSalaryVerification: { verified: septemberSalaryVerified, evidence: septemberSalaryEvidence },
      employeeIds: driverChoices.map(driver => driver.id)
    };
    const result = previewFinancialDraft(input);
    if (selectedWorkbook.issues.length) {
      result.issues.push(...selectedWorkbook.issues.map(code => ({ code: "import_parser_issue", field: code })));
      result.readyForReview = false;
    }
    setPreview(result);
    return result;
    } catch (cause) {
      setError(cause instanceof FinancialWorkbookError ? localizedDraftMessage(cause.code, language) : cause instanceof Error ? cause.message : localizedDraftMessage("malformed_xlsx", language));
      return null;
    }
  }

  async function saveDraft() {
    if (!file) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const latestPreview = await buildPreview();
      if (!latestPreview) return;
      const token = await getAccessToken();
      const form = new FormData();
      form.set("file", file); form.set("year", String(year)); form.set("month", String(month));
      const annotationsWithTreatments = { ...annotations };
      for (const row of parsed?.rows.filter(sourceRow => selectedSheets.includes(sourceRow.sheet)) ?? []) {
        annotationsWithTreatments[rowKey(row)] = { ...annotationsWithTreatments[rowKey(row)], lpgTreatment: resolveTreatment(row) };
      }
      form.set("selectedSheets", JSON.stringify(selectedSheets)); form.set("annotations", JSON.stringify(annotationsWithTreatments));
      form.set("expectedVehicleIds", JSON.stringify(expectedVehicleIds)); form.set("sourceTotals", JSON.stringify(sourceTotals));
      form.set("fleetRosterConfirmed", String(fleetRosterConfirmed));
      form.set("formulaReference", formulaReference); form.set("ownerRequested", String(ownerRequested));
      form.set("initialBaseline", String(initialBaseline));
      form.set("ownerApprovalEvidence", ownerEvidence); form.set("baseVersion", baseVersion);
      form.set("septemberSalaryVerified", String(septemberSalaryVerified)); form.set("septemberSalaryEvidence", septemberSalaryEvidence);
      const response = await fetch("/api/vehicle-performance-v4/drafts", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
      const data = await response.json();
      if (!response.ok) throw new Error(data.errorCode ? localizedDraftMessage(data.errorCode, language) : data.error || "Unable to save draft.");
      setMessage(c.saveSuccess);
      await refreshMetadata();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to save draft."); }
    finally { setBusy(false); }
  }

  async function transition(batch: BatchSummary, action: "validate" | "submit_review" | "approve") {
    setBusy(true); setError(""); setMessage("");
    try {
      const token = await getAccessToken();
      const response = await fetch(`/api/vehicle-performance-v4/drafts/${batch.id}`, {
        method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action, expectedContentHash: batch.content_hash, reason: reviewReason })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.errorCode ? localizedDraftMessage(data.errorCode, language) : data.error || "Unable to update review status.");
      setMessage(c.reviewSuccess); setReviewReason(""); await refreshMetadata();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to update review status."); }
    finally { setBusy(false); }
  }

  async function showBatchDetails(batch: BatchSummary) {
    if (openBatchId === batch.id) { setOpenBatchId(null); return; }
    setOpenBatchId(batch.id);
    if (batchDetails[batch.id]) return;
    setBatchDetails(current => ({ ...current, [batch.id]: null }));
    try {
      const token = await getAccessToken();
      const response = await fetch(`/api/vehicle-performance-v4/drafts/${batch.id}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.errorCode ? localizedDraftMessage(data.errorCode, language) : data.error || "Unable to load saved draft details.");
      setBatchDetails(current => ({ ...current, [batch.id]: data as BatchDetail }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load saved draft details.");
      setOpenBatchId(null);
      setBatchDetails(current => { const next = { ...current }; delete next[batch.id]; return next; });
    }
  }

  const fieldsForControls: FinancialField[] = ["salary", "jobs", "tripPayments", "expenses", "parking", "totalReceived", "fuel", "lpg", "maintenance"];
  const valueLabel = (field: FinancialField) => field === "tripPayments" ? c.trips : field === "totalReceived" ? c.revenue : field === "parking" ? c.parking : field === "jobs" ? c.jobs : field === "lpg" ? "LPG" : c[field as keyof typeof c] ?? field;
  const monthSummaries = useMemo(() => ["2026-08", "2026-09"].map(key => ({ key, batches: (metadata?.batches ?? []).filter(batch => batch.reporting_month.startsWith(`${key}-`)) })), [metadata?.batches]);
  const registrationKey = (value: string) => value.normalize("NFKC").trim().replace(/\s+/g, " ").toUpperCase();
  const employeeVehicles = new Map<string, Set<string>>();
  for (const row of parsed?.rows.filter(sourceRow => selectedSheets.includes(sourceRow.sheet)) ?? []) {
    const employeeId = annotations[rowKey(row)]?.employeeId;
    if (!employeeId) continue;
    const reg = registrationKey(String(row.cells[0] ?? ""));
    const vehicle = vehicleChoices.find(choice => [choice.vehicle_reg, ...knownVehicleRegistrationAliases(choice.vehicle_reg)].some(alias => registrationKey(alias) === reg));
    if (!vehicle) continue;
    const set = employeeVehicles.get(employeeId) ?? new Set<string>();
    set.add(vehicle.id); employeeVehicles.set(employeeId, set);
  }
  const multiVehicleEmployees = [...employeeVehicles.entries()].filter(([, assignedVehicles]) => assignedVehicles.size > 1).map(([employeeId]) => employeeId);

  return <section className="rounded-[1rem] border border-brand-200 bg-[linear-gradient(180deg,#ffffff_0%,#fbf9ff_100%)] p-4 shadow-[0_12px_32px_rgba(76,29,149,0.06)] sm:p-5">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div><p className="text-xs font-semibold uppercase tracking-[0.13em] text-brand-700">Vehicle Performance V4</p><h3 className="mt-1 text-lg font-semibold text-slate-950">{c.title}</h3><p className="mt-1 max-w-3xl text-sm text-slate-600">{c.subtitle}</p></div>
      <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800"><ShieldAlert className="h-3.5 w-3.5" />{c.disabledPublication}</span>
    </div>

    {canReview ? <>
    <div className="mt-4 space-y-3">
      {sourcePreviews?.map(report => <ReadOnlySourcePreview key={report.reportingMonth} report={report} language={language} c={c} vehicleIdsByAlias={vehicleIdsByAlias} />)}
      {!sourcePreviews ? <p role="status" className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">{sourcePreviewError ? c.sourcePreviewUnavailable : c.sourcePreviewLoading}</p> : null}
    </div>

    <div className="mt-4 flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-3 sm:flex-row sm:items-center sm:justify-between">
      <div><p className="text-xs font-semibold text-slate-700">{c.policyStatus} · v4-accounting-draft-3</p><p className="mt-1 text-sm font-semibold text-slate-900">{metadata?.accountingPolicy?.status === "approved" ? c.policyApproved : c.policyDraft}</p>{metadata?.accountingPolicy?.status !== "approved" && !metadata?.accountingPolicy?.approvalConflict ? <p className="mt-1 max-w-3xl text-xs text-slate-600">{c.policyEvidencePending}</p> : null}</div>
      {metadata?.accountingPolicy?.approvalConflict ? <p className="text-xs text-amber-800">{c.policyApprovalConflict}</p> : null}
    </div>

    <div className="mt-4 grid gap-3 md:grid-cols-2">
      {monthSummaries.map(({ key, batches }) => {
        const isAugust = key === "2026-08";
        const label = isAugust ? c.august : c.september;
        const latest = batches[0];
        return <article key={key} className="rounded-xl border border-slate-200 bg-white p-3.5">
          <h4 className="text-sm font-bold text-slate-900">{label}</h4>
          {latest ? <><p className="mt-1 text-xs text-slate-600">{c.status}: {statusLabel(latest.status, c)} · {c.version} {latest.version}</p><p className="mt-1 break-all text-xs text-slate-500">{latest.source_file_name}</p><p className="mt-1 text-xs text-slate-500">{c.sourceHash}: {latest.source_sha256}</p>
            {latest.validation_issue_codes?.length ? <p className="mt-2 text-xs text-amber-800">{c.issues}: {latest.validation_issue_codes.length}</p> : null}
          </> : <p className="mt-1 text-xs leading-5 text-slate-600">{c.noSource}</p>}
          {isAugust ? <p className="mt-2 rounded-lg bg-violet-50 px-2.5 py-2 text-xs text-violet-900">{c.augustSalary}</p> : <p className="mt-2 rounded-lg bg-amber-50 px-2.5 py-2 text-xs text-amber-900">{c.septemberSalary}</p>}
          {!latest ? <p className="mt-2 text-xs text-slate-500">{c.reconciliation}: {c.unknown}</p> : <div className="mt-2 overflow-x-auto"><p className="mb-1 text-xs font-semibold text-slate-700">{c.reconciliation}</p><table className="min-w-[460px] w-full text-[11px]"><thead><tr><th className="p-1 text-left">{c.reconciliation}</th><th className="p-1 text-right">{c.imported}</th><th className="p-1 text-right">{c.declared}</th><th className="p-1 text-left">{c.status}</th></tr></thead><tbody>{fieldsForControls.map(field => {
            const importedValue = latest.calculated_totals?.[field] ?? null;
            const declaredRaw = latest.source_totals?.[field];
            const declaredValue = field === "jobs" ? parseFinancialValue(declaredRaw, true) : parseFinancialValue(declaredRaw, false);
            const issue = (latest.validation_issue_codes ?? []).some(code => code === `source_total_mismatch:${field}` || code === `source_total_required:${field}`);
            const agrees = importedValue !== null && declaredValue !== null && importedValue === declaredValue;
            return <tr key={field} className="border-t border-slate-100"><td className="p-1">{valueLabel(field)}</td><td className="p-1 text-right">{field === "jobs" ? importedValue ?? c.unknown : formatAmount(importedValue, language)}</td><td className="p-1 text-right">{field === "jobs" ? declaredValue ?? c.unknown : formatAmount(declaredValue, language)}</td><td className="p-1">{issue ? c.statusNeedsReview : agrees ? c.statusValidated : c.unknown}</td></tr>;
          })}</tbody></table></div>}
        </article>;
      })}
    </div>

    {metadataError ? <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">{metadataError}</p> : null}
    {metadata && !metadata.migrationReady ? <p className="mt-2 rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-700">{c.requiresMigration}</p> : null}
    {!canImport ? <p className="mt-2 text-xs text-slate-500">{c.permission}</p> : null}

    <details className="mt-4 rounded-xl border border-slate-200 bg-white">
      <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold text-slate-900">{c.upload}</summary>
      <div className="space-y-4 border-t border-slate-100 p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-semibold text-slate-700">{c.period}<div className="mt-1 flex gap-2">
            <select aria-label={c.period} value={year} onChange={event => { setYear(Number(event.target.value)); setPreview(null); setFleetRosterConfirmed(false); }} className="form-input">{Array.from({ length: 16 }, (_, index) => 2020 + index).map(optionYear => <option key={optionYear} value={optionYear}>{optionYear}</option>)}</select>
            <select aria-label={c.monthChoice} value={month} onChange={event => { setMonth(Number(event.target.value)); setPreview(null); setFleetRosterConfirmed(false); }} className="form-input">{Array.from({ length: 12 }, (_, index) => <option key={index + 1} value={index + 1}>{String(index + 1).padStart(2, "0")}</option>)}</select>
          </div></label>
          <label className="text-xs font-semibold text-slate-700">{c.upload}<input type="file" accept=".xlsx,.csv" disabled={!canImport} onChange={event => void selectFile(event.target.files?.[0] ?? null)} className="form-input mt-1 text-xs" /></label>
        </div>
        {file ? <p className="break-all text-xs text-slate-600">{file.name} · {c.sourceHash}: {localHash || c.unknown}</p> : null}

        {parsed ? <fieldset><legend className="text-xs font-semibold text-slate-700">{c.sheets}</legend><div className="mt-1 flex flex-wrap gap-2">{parsed.sheetNames.map(sheet => <label key={sheet} className="flex items-center gap-2 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs"><input type="checkbox" checked={selectedSheets.includes(sheet)} onChange={event => setSelectedSheets(current => event.target.checked ? [...current, sheet] : current.filter(item => item !== sheet))} />{sheet}</label>)}</div></fieldset> : null}

        <div><p className="text-xs font-semibold text-slate-700">{c.roster}</p><div className="mt-1 grid max-h-44 gap-1 overflow-y-auto rounded-lg border border-slate-200 p-2 sm:grid-cols-2">{vehicleChoices.map(vehicle => <label key={vehicle.id} className="flex min-w-0 items-center gap-2 rounded px-1.5 py-1 text-xs text-slate-700"><input type="checkbox" checked={expectedVehicleIds.includes(vehicle.id)} onChange={event => { setExpectedVehicleIds(current => event.target.checked ? [...current, vehicle.id] : current.filter(id => id !== vehicle.id)); setFleetRosterConfirmed(false); setPreview(null); }} /><span className="truncate">{vehicle.vehicle_reg}{vehicle.active ? "" : ` · ${c.inactive}`}</span></label>)}</div><label className="mt-2 flex items-start gap-2 text-xs text-slate-700"><input type="checkbox" checked={fleetRosterConfirmed} onChange={event => { setFleetRosterConfirmed(event.target.checked); setPreview(null); }} /><span>{c.confirmRoster}</span></label><p className="mt-1 text-[11px] text-slate-500">{c.warningHistory}</p></div>

        {parsed?.rows.filter(row => selectedSheets.includes(row.sheet)).length ? <div className="overflow-x-auto rounded-lg border border-slate-200"><table className="min-w-[760px] w-full text-xs"><thead className="bg-slate-50"><tr><th className="p-2 text-left">{c.registration}</th><th className="p-2 text-left">{c.employee}</th><th className="p-2 text-left">{c.lpg}</th><th className="p-2 text-left">{c.salary}</th><th className="p-2 text-left">{c.trips}</th><th className="p-2 text-left">{c.revenue}</th></tr></thead><tbody>
          {parsed.rows.filter(row => selectedSheets.includes(row.sheet)).map(row => <tr key={rowKey(row)} className="border-t border-slate-100"><td className="p-2 font-semibold">{String(row.cells[0] ?? c.unknown)}</td><td className="p-2"><select aria-label={`${c.employee} ${row.cells[0] ?? ""}`} value={annotations[rowKey(row)]?.employeeId ?? ""} onChange={event => setAnnotations(current => ({ ...current, [rowKey(row)]: { ...current[rowKey(row)], employeeId: event.target.value || undefined } }))} className="form-input min-w-40 py-1"><option value="">{c.employeeUnassigned}</option>{driverChoices.map(driver => <option key={driver.id} value={driver.id}>{driver.name}{driver.active ? "" : " · inactive"}</option>)}</select></td><td className="p-2"><select aria-label={`${c.lpg} ${row.cells[0] ?? ""}`} value={resolveTreatment(row)} onChange={event => setAnnotations(current => ({ ...current, [rowKey(row)]: { ...current[rowKey(row)], lpgTreatment: event.target.value as LpgTreatment } }))} className="form-input min-w-40 py-1"><option value="included_in_fuel">{c.lpgIncluded}</option><option value="separate">{c.lpgSeparate}</option><option value="unknown">{c.lpgUnknown}</option></select></td><td className="p-2">{String(row.cells[1] || c.unknown)}</td><td className="p-2">{String(row.cells[3] || c.unknown)}</td><td className="p-2">{String(row.cells[6] || c.unknown)}</td></tr>)}
        </tbody></table></div> : null}

        {parsed?.rows.filter(row => selectedSheets.includes(row.sheet)).length ? <fieldset className="rounded-lg border border-slate-200 p-3"><legend className="px-1 text-xs font-semibold text-slate-700">{c.assignmentPeriod}</legend><div className="grid gap-2 md:grid-cols-2">{parsed.rows.filter(row => selectedSheets.includes(row.sheet)).map(row => <div key={rowKey(row)} className="grid gap-2 rounded-lg bg-slate-50 p-2 sm:grid-cols-[minmax(100px,1fr)_1fr_1fr]"><span className="self-center truncate text-xs font-medium text-slate-700">{String(row.cells[0] ?? c.unknown)} · {driverChoices.find(driver => driver.id === annotations[rowKey(row)]?.employeeId)?.name ?? c.employeeUnassigned}</span><label className="text-[10px] text-slate-600">{c.effectiveFrom}<input type="date" aria-label={`${c.effectiveFrom} ${row.cells[0] ?? ""}`} value={annotations[rowKey(row)]?.assignmentEffectiveFrom ?? ""} onChange={event => { setPreview(null); setAnnotations(current => ({ ...current, [rowKey(row)]: { ...current[rowKey(row)], assignmentEffectiveFrom: event.target.value || undefined } })); }} className="form-input mt-1 py-1 text-xs" /></label><label className="text-[10px] text-slate-600">{c.effectiveTo}<input type="date" aria-label={`${c.effectiveTo} ${row.cells[0] ?? ""}`} value={annotations[rowKey(row)]?.assignmentEffectiveTo ?? ""} onChange={event => { setPreview(null); setAnnotations(current => ({ ...current, [rowKey(row)]: { ...current[rowKey(row)], assignmentEffectiveTo: event.target.value || undefined } })); }} className="form-input mt-1 py-1 text-xs" /></label></div>)}</div></fieldset> : null}
        {multiVehicleEmployees.length ? <fieldset className="rounded-lg border border-amber-200 bg-amber-50 p-3"><legend className="px-1 text-xs font-semibold text-amber-950">{c.salaryAllocationReview}</legend><div className="mt-1 flex flex-wrap gap-2">{multiVehicleEmployees.map(employeeId => <span key={employeeId} className="rounded bg-white px-2 py-1 text-xs text-slate-700">{driverChoices.find(item => item.id === employeeId)?.name ?? employeeId}</span>)}</div></fieldset> : null}

        <div><p className="text-xs font-semibold text-slate-700">{c.controls}</p><div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{fieldsForControls.map(field => <label key={field} className="text-[11px] text-slate-600">{valueLabel(field)}<input inputMode="decimal" value={sourceTotals[field] ?? ""} onChange={event => setSourceTotals(current => ({ ...current, [field]: event.target.value }))} placeholder={c.unknown} className="form-input mt-1 py-1.5 text-xs" /></label>)}</div></div>

        <label className="block text-xs font-semibold text-slate-700">{c.formula}<input value={formulaReference} onChange={event => setFormulaReference(event.target.value)} placeholder={c.formulaPlaceholder} className="form-input mt-1" /><span className="mt-1 block font-normal text-slate-500">{c.formulaHelp}</span></label>

        {currentMonth >= "2026-01" && currentMonth <= "2026-07" ? <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <label className="flex items-center gap-2 text-xs font-semibold text-amber-950"><input type="checkbox" checked={ownerRequested} onChange={event => setOwnerRequested(event.target.checked)} />{c.ownerRequest}</label>
          {monthBatches.length === 0 ? <label className="flex items-center gap-2 text-xs font-semibold text-amber-950"><input type="checkbox" checked={initialBaseline} onChange={event => { setInitialBaseline(event.target.checked); if (event.target.checked) setOwnerRequested(true); }} />{c.initialBaseline}</label> : null}
          <label className="block text-xs text-amber-950">{c.ownerEvidence}<textarea value={ownerEvidence} onChange={event => setOwnerEvidence(event.target.value)} className="form-input mt-1 min-h-16" /></label>
          <label className="block text-xs text-amber-950">{c.baseVersion}<select value={baseVersion} onChange={event => setBaseVersion(event.target.value)} className="form-input mt-1"><option value="">{c.unknown}</option>{approvedVersions.map(batch => <option key={batch.id} value={batch.version}>{batch.version} · {statusLabel(batch.status, c)}</option>)}</select></label>
        </div> : null}

        {currentMonth === "2026-09" ? <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3"><label className="flex items-center gap-2 text-xs font-semibold text-amber-950"><input type="checkbox" checked={septemberSalaryVerified} onChange={event => setSeptemberSalaryVerified(event.target.checked)} />{c.sepVerified}</label><textarea aria-label={c.sepEvidence} value={septemberSalaryEvidence} onChange={event => setSeptemberSalaryEvidence(event.target.value)} placeholder={c.sepEvidence} className="form-input min-h-16" /></div> : null}

        <div className="flex flex-wrap gap-2"><button type="button" onClick={() => void buildPreview()} disabled={!file || busy} className="btn-secondary">{c.calculate}</button><button type="button" onClick={saveDraft} disabled={!metadata?.writesEnabled || !canImport || !metadata?.migrationReady || !preview || busy} className="btn-primary gap-2 disabled:cursor-not-allowed disabled:opacity-50"><FileUp className="h-4 w-4" />{c.save}</button></div>
        {preview ? <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900"><CheckCircle2 className="h-4 w-4 text-brand-700" />{c.localDraft} · {c.reportStatus}: {preview.readyForReview ? c.statusValidated : c.statusNeedsReview}</div>
          <p aria-live="polite" className="mt-1 text-xs text-slate-500">{c.rows}: {preview.rows.length} · {c.excluded}: {preview.excludedRows.length} · {c.expected}: {expectedVehicleIds.length} · {c.matched}: {new Set(preview.rows.flatMap(row => row.vehicleId ? [row.vehicleId] : [])).size} · {c.missing}: {preview.issues.filter(issue => issue.code === "missing_vehicle").length} · {c.duplicates}: {preview.issues.filter(issue => issue.code === "duplicate_vehicle_month").length}</p>
          <p role="status" className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">{c.policyUnverified}</p>
          <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">{c.warning}</p>
          <div className="mt-3 overflow-x-auto"><table className="min-w-[900px] w-full text-xs"><thead><tr>{[c.registration,c.salary,c.jobs,c.trips,c.expenses,c.parking,c.revenue,c.fuel,"LPG",c.maintenance,c.directCost,c.balance].map(label => <th key={label} className="px-2 py-1.5 text-left font-semibold text-slate-600">{label}</th>)}</tr></thead><tbody>
            {preview.rows.map(row => { const metrics = calculateDraftFinancials(row.values, row.lpgTreatment, preview.formula ?? undefined); return <tr key={`${row.raw.sheet}:${row.raw.row}`} className="border-t border-slate-200"><td className="px-2 py-2 font-semibold">{row.registration}{row.vehicleId ? "" : " · ?"}</td><td className="px-2 py-2">{formatAmount(row.values.salary,language)}</td><td className="px-2 py-2">{row.values.jobs ?? c.unknown}</td><td className="px-2 py-2">{formatAmount(row.values.tripPayments,language)}</td><td className="px-2 py-2">{formatAmount(row.values.expenses,language)}</td><td className="px-2 py-2">{formatAmount(row.values.parking,language)}</td><td className="px-2 py-2">{formatAmount(row.values.totalReceived,language)}</td><td className="px-2 py-2">{formatAmount(row.values.fuel,language)}</td><td className="px-2 py-2">{row.lpgTreatment === "included_in_fuel" ? `${c.lpgIncluded} · ${formatAmount(row.values.lpg,language)}` : formatAmount(row.values.lpg,language)}</td><td className="px-2 py-2">{formatAmount(row.values.maintenance,language)}</td><td className="px-2 py-2">{formatAmount(metrics?.directCost ?? null,language)}</td><td className="px-2 py-2">{formatAmount(metrics?.recordedBalance ?? null,language)}</td></tr>; })}
          </tbody></table></div>
          {preview.rows.some(row => row.lpgTreatment === "included_in_fuel") ? <p className="mt-2 rounded-lg bg-violet-50 px-3 py-2 text-xs text-violet-900">{c.lpgWarning}</p> : null}
          {preview.rows.some(row => row.lpgTreatment === "separate") ? <p className="mt-2 rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-700">{c.separateLpg}</p> : null}
          <div className="mt-3 overflow-x-auto"><p className="mb-1 text-xs font-semibold text-slate-700">{c.reconciliation}</p><table className="min-w-[520px] text-xs"><thead><tr><th className="p-1.5 text-left">{c.reconciliation}</th><th className="p-1.5 text-right">{c.imported}</th><th className="p-1.5 text-right">{c.declared}</th><th className="p-1.5 text-left">{c.status}</th></tr></thead><tbody>{fieldsForControls.map(field => <tr key={field} className="border-t border-slate-200"><td className="p-1.5">{valueLabel(field)}</td><td className="p-1.5 text-right">{field === "jobs" ? preview.totals.jobs ?? c.unknown : formatAmount(preview.totals[field] ?? null,language)}</td><td className="p-1.5 text-right">{sourceTotals[field] === undefined || sourceTotals[field] === "" ? c.unknown : field === "jobs" ? String(sourceTotals[field]) : formatAmount(parseFinancialValue(sourceTotals[field],false),language)}</td><td className="p-1.5">{preview.issues.some(issue => issue.field === field && issue.code.includes("total")) ? <span className="text-rose-700">{c.statusNeedsReview}</span> : <span className="text-slate-600">{c.statusValidated}</span>}</td></tr>)}</tbody></table></div>
          <div className="mt-3"><p className="flex items-center gap-1.5 text-xs font-semibold text-amber-900"><AlertTriangle className="h-3.5 w-3.5" />{c.issues}</p>{preview.issues.length ? <ul role="status" className="mt-1 list-disc pl-5 text-xs text-amber-900">{preview.issues.map((issue,index) => <li key={`${issue.code}-${issue.row ?? index}`}>{localizedDraftMessage(issue.code === "import_parser_issue" ? String(issue.field ?? issue.code) : issue.code, language)}{issue.row ? ` · row ${issue.row}` : ""}{issue.field && issue.code !== "import_parser_issue" ? ` · ${issue.field}` : ""}</li>)}</ul> : <p className="mt-1 text-xs text-emerald-800">{c.noIssues}</p>}</div>
        </div> : null}
      </div>
    </details>

    <div className="mt-4 rounded-xl border border-slate-200 bg-white p-3.5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><h4 className="text-sm font-bold text-slate-900">{c.current}</h4><input aria-label={c.reason} value={reviewReason} onChange={event => setReviewReason(event.target.value)} placeholder={c.reason} className="form-input max-w-md py-1.5 text-xs" /></div>
      {(metadata?.batches ?? []).length ? <ul className="mt-3 divide-y divide-slate-100">{metadata!.batches.map(batch => <li key={batch.id} className="flex flex-col gap-2 py-2 text-xs sm:flex-row sm:items-center sm:justify-between"><div><span className="font-semibold text-slate-900">{batch.reporting_month.slice(0,7)} · v{batch.version}</span><span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-700">{statusLabel(batch.status,c)}</span><p className="mt-1 break-all text-slate-500">{batch.source_file_name}</p></div><div className="flex gap-2">{batch.status === "draft" && canReview ? <button type="button" disabled={!metadata?.writesEnabled || busy || !reviewReason.trim()} onClick={() => void transition(batch,"validate")} className="btn-secondary py-1.5 text-xs disabled:opacity-50">{c.validate}</button> : null}{batch.status === "validated" && canReview ? <button type="button" disabled={!metadata?.writesEnabled || busy || !reviewReason.trim()} onClick={() => void transition(batch,"submit_review")} className="btn-secondary py-1.5 text-xs disabled:opacity-50">{c.sendReview}</button> : null}{batch.status === "in_review" && canApprove ? <button type="button" disabled={!metadata?.writesEnabled || busy || !reviewReason.trim()} onClick={() => void transition(batch,"approve")} className="btn-primary py-1.5 text-xs disabled:opacity-50">{c.approve}</button> : null}</div></li>)}</ul> : <p className="mt-2 text-xs text-slate-500">{c.none}</p>}
      {(metadata?.batches ?? []).length ? <div className="mt-3 border-t border-slate-100 pt-3"><h5 className="text-xs font-semibold text-slate-700">{c.viewDetails}</h5><div className="mt-2 flex flex-wrap gap-2">{metadata!.batches.map(batch => <button key={batch.id} type="button" aria-expanded={openBatchId === batch.id} aria-controls={`vehicle-financial-detail-${batch.id}`} onClick={() => void showBatchDetails(batch)} className="btn-secondary py-1.5 text-xs">{openBatchId === batch.id ? c.hideDetails : `${batch.reporting_month.slice(0,7)} · v${batch.version}`}</button>)}</div>{openBatchId && batchDetails[openBatchId] ? <div id={`vehicle-financial-detail-${openBatchId}`}><p className="mt-2 text-xs text-slate-600">{c.expected}: {batchDetails[openBatchId]!.batch.validation_counts?.expected ?? 0} · {c.matched}: {batchDetails[openBatchId]!.batch.validation_counts?.matched ?? 0} · {c.missing}: {batchDetails[openBatchId]!.batch.validation_counts?.missing ?? 0} · {c.duplicates}: {batchDetails[openBatchId]!.batch.validation_counts?.duplicate ?? 0}</p><BatchDetailsPanel detail={batchDetails[openBatchId]!} language={language} copy={c} /></div> : openBatchId && batchDetails[openBatchId] === null ? <p role="status" className="mt-2 text-xs text-slate-500">{c.detailsLoading}</p> : null}</div> : null}
    </div>
    {message ? <p role="status" aria-live="polite" className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{message}</p> : null}{error ? <p role="alert" className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-800">{error}</p> : null}
    </> : <p role="note" className="mt-4 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">{c.financialAccessRequired}</p>}
  </section>;
}
