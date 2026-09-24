"use client";

import { useMemo, useState } from "react";
import {
  ArrowUpDown,
  BarChart3,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  Download,
  Eye,
  FileSpreadsheet,
  FileText,
  PencilLine,
  Search,
  SlidersHorizontal
} from "lucide-react";
import {
  annualInsuranceCost,
  buildDataQualityFindings,
  categoryLabel,
  getAssetCategory,
  insuranceHistoryStatus,
  insuranceRequirement,
  isCompulsoryConfirmed,
  isInsuranceNotRequired,
  matchesInsuranceSearch,
  normalizeInsuranceRegistration,
  premiumToInsuredValue,
  renewalBand,
  summarizeInsurance,
  type AssetCategory,
  type DataQualityFinding,
  type InsuranceAssetRecord,
  type InsuranceDocumentRecord
} from "@/lib/insurance-intelligence";
import {
  canonicalInsurerName,
  groupInsurerPremiums,
  type InsurerSpendGroup
} from "@/lib/insurance-providers";
import {
  buildInsurancePdf,
  downloadInsuranceReport,
  reportTypeLabel,
  type InsuranceReportHistoryRecord,
  type InsuranceReportType
} from "@/lib/insurance-reporting";

type WorkspaceTab = "overview" | "comparison" | "renewals" | "reports";
type StatusFilter = "all" | "current" | "expired" | "expiring";
type CategoryFilter = "all" | AssetCategory | "trucks";
type ComplianceFilter = "all" | "compliant" | "due_soon" | "expired" | "needs_review" | "missing_information" | "not_required";
type RequirementFilter = "all" | "required" | "not_required" | "unknown";
type ComparisonSort = "expiry_asc" | "expiry_desc";

const REPORT_TYPES: InsuranceReportType[] = [
  "executive",
  "renewal",
  "cost",
  "vehicle_detail",
  "asset_register",
  "missing_information",
  "comparison",
  "trailer",
  "expired"
];

const QUALITY_PRIORITY: Record<string, number> = {
  expired_insurance: 1,
  vehicle_tax_expired: 1,
  invalid_policy_dates: 1,
  missing_policy: 2,
  missing_main_document: 2,
  compulsory_expired: 3,
  compulsory_unknown: 3,
  vehicle_tax_due_30: 3,
  missing_compulsory_document: 3,
  missing_expiry: 4,
  missing_chassis: 5,
  missing_make: 5,
  missing_model: 5,
  missing_year: 5
};

const ACTION_QUALITY_CODES = new Set([
  "expired_insurance",
  "compulsory_expired",
  "invalid_policy_dates",
  "missing_policy",
  "missing_insurer",
  "missing_class",
  "missing_expiry",
  "missing_main_document",
  "missing_compulsory_document",
  "compulsory_unknown",
  "vehicle_tax_expired",
  "vehicle_tax_due_30"
]);

const CATEGORY_FILTERS: CategoryFilter[] = [
  "all",
  "trucks",
  "pickup",
  "passenger_company_car",
  "trailer",
  "insurance_only_asset",
  "unknown"
];

function money(value: number | null, language: "en" | "th") {
  if (value == null || !Number.isFinite(value)) {
    return language === "th" ? "ข้อมูลไม่เพียงพอ" : "Insufficient data";
  }
  return new Intl.NumberFormat(language === "th" ? "th-TH" : "en-GB", {
    style: "currency",
    currency: "THB",
    maximumFractionDigits: 2
  }).format(value);
}

function date(value: string | null, language: "en" | "th") {
  if (!value) return language === "th" ? "ไม่ได้บันทึก" : "Not recorded";
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat(language === "th" ? "th-TH" : "en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).format(new Date(year, month - 1, day));
}

function filterLabel(filter: CategoryFilter, language: "en" | "th") {
  if (filter === "all") return language === "th" ? "ทั้งหมด" : "All assets";
  if (filter === "trucks") return language === "th" ? "รถบรรทุก" : "Trucks";
  return categoryLabel(filter, language);
}

function isFilterMatch(record: InsuranceAssetRecord, filter: CategoryFilter) {
  if (filter === "all") return true;
  const category = getAssetCategory(record);
  if (filter === "trucks") {
    return category === "six_wheel_truck" || category === "other_commercial_vehicle";
  }
  return category === filter;
}

function isStatusMatch(record: InsuranceAssetRecord, filter: StatusFilter) {
  if (filter === "all") return true;
  const status = insuranceHistoryStatus(record);
  if (filter === "current") return status === "CURRENT";
  if (filter === "expired") return status === "EXPIRED";
  const days = record.days_to_insurance_expiry;
  return days != null && days >= 0 && days <= 90;
}

function requirementFilterLabel(filter: RequirementFilter, language: "en" | "th") {
  const labels = language === "th"
    ? { all: "ข้อกำหนด", required: "ต้องมีประกัน", not_required: "ไม่ต้องมีประกัน", unknown: "ไม่ทราบ" }
    : { all: "Requirement", required: "Insurance Required", not_required: "Insurance Not Required", unknown: "Unknown" };
  return labels[filter];
}

type PremiumWindow = { days: 30 | 60 | 90; policies: number; recorded: number; missing: number; total: number | null };

function currentPremiumWindow(records: InsuranceAssetRecord[], days: 30 | 60 | 90): PremiumWindow {
  const policies = records.filter((record) => {
    const remaining = record.days_to_insurance_expiry ?? isoDaysFromToday(record.insurance_expiry_date);
    return !isInsuranceNotRequired(record) && remaining != null && remaining >= 0 && remaining <= days;
  });
  const premiums = policies
    .map((record) => record.insurance_premium)
    .filter((value): value is number => value != null && Number.isFinite(value));
  return {
    days,
    policies: policies.length,
    recorded: premiums.length,
    missing: policies.length - premiums.length,
    total: premiums.length || policies.length === 0 ? premiums.reduce((sum, value) => sum + value, 0) : null
  };
}

function isoDaysFromToday(value: string | null) {
  if (!value) return null;
  const target = Date.parse(`${value}T00:00:00+07:00`);
  if (!Number.isFinite(target)) return null;
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" });
  const parts = Object.fromEntries(formatter.formatToParts(new Date()).map((part) => [part.type, part.value]));
  const today = Date.parse(`${parts.year}-${parts.month}-${parts.day}T00:00:00+07:00`);
  return Math.ceil((target - today) / 86400000);
}

function complianceStatus(record: InsuranceAssetRecord, documents: InsuranceDocumentRecord[]): Exclude<ComplianceFilter, "all"> {
  if (isInsuranceNotRequired(record)) return "not_required";
  if (record.verification_status !== "verified") return "needs_review";
  const mainDays = record.days_to_insurance_expiry ?? isoDaysFromToday(record.insurance_expiry_date);
  const compulsoryDays = isoDaysFromToday(record.compulsory_expiry_date);
  const taxDays = isoDaysFromToday(record.registration_expiry_date);
  if ([mainDays, compulsoryDays, taxDays].some((days) => days != null && days < 0)) return "expired";
  if ([mainDays, compulsoryDays, taxDays].some((days) => days != null && days >= 0 && days <= 30)) return "due_soon";
  const hasMainDocument = documents.some((document) => document.insurance_record_id === record.id && document.document_type === "insurance");
  if (!record.policy_number || !record.insurance_expiry_date || !record.insurer_en && !record.insurer_th || !isCompulsoryConfirmed(record) || !hasMainDocument) return "missing_information";
  return "compliant";
}

function findingText(code: string, fallback: string, language: "en" | "th") {
  if (language === "en") return fallback;
  const translations: Record<string, string> = {
    expired_insurance: "ประกันภัยหมดอายุ",
    vehicle_tax_expired: "ภาษีรถหมดอายุ",
    vehicle_tax_due_30: "ภาษีรถหมดอายุภายใน 30 วัน",
    insurance_due_30: "ประกันภัยหมดอายุภายใน 30 วัน",
    insurance_due_60: "ประกันภัยหมดอายุภายใน 60 วัน",
    invalid_policy_dates: "ลำดับวันที่กรมธรรม์ไม่ถูกต้อง",
    missing_insurer: "ไม่มีข้อมูลบริษัทประกัน",
    missing_policy: "ไม่มีเลขกรมธรรม์",
    missing_class: "ไม่มีประเภทประกัน",
    missing_repair: "ไม่มีประเภทการซ่อม",
    missing_make: "ไม่มียี่ห้อรถ",
    missing_model: "ไม่ได้บันทึกรุ่นแยกต่างหาก",
    missing_chassis: "ไม่มีเลขตัวถัง",
    missing_year: "ไม่มีปีรถ",
    missing_insured_value: "ไม่มีทุนประกัน",
    missing_premium: "ไม่มีเบี้ยประกัน",
    compulsory_unknown: "ไม่ทราบสถานะ พ.ร.บ.",
    compulsory_expired: "พ.ร.บ. หมดอายุ",
    duplicate_registration: "ทะเบียนซ้ำหลังปรับรูปแบบ",
    duplicate_chassis: "เลขตัวถังซ้ำ",
    description_in_policy: "เลขกรมธรรม์ต้องตรวจสอบ",
    duplicate_policy: "เลขกรมธรรม์อาจซ้ำ",
    insured_value_invalid: "ทุนประกันผิดปกติ",
    premium_invalid: "เบี้ยประกันผิดปกติ",
    premium_value_ratio: "อัตราเบี้ยต่อทุนผิดปกติ",
    premium_outlier: "เบี้ยประกันแตกต่างจากกลุ่มมาก",
    missing_main_document: "ไม่มีเอกสารกรมธรรม์หลัก",
    missing_compulsory_document: "ไม่มีเอกสาร พ.ร.บ."
  };
  return translations[code] ?? fallback;
}

function compareNullableNumber(a: number | null, b: number | null, direction: 1 | -1) {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return (a - b) * direction;
}

export function InsuranceIntelligenceWorkspace({
  records,
  documents,
  historyRecords = [],
  language,
  onOpenRecord,
  onReviewRecord,
  initialTab = "overview"
}: {
  records: InsuranceAssetRecord[];
  documents: InsuranceDocumentRecord[];
  historyRecords?: InsuranceReportHistoryRecord[];
  language: "en" | "th";
  onOpenRecord: (record: InsuranceAssetRecord) => void;
  onReviewRecord: (record: InsuranceAssetRecord) => void;
  initialTab?: WorkspaceTab;
}) {
  const isThai = language === "th";
  const [tab, setTab] = useState<WorkspaceTab>(initialTab);
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [includeUnverified, setIncludeUnverified] = useState(false);
  const [comparisonSort, setComparisonSort] = useState<ComparisonSort>("expiry_asc");
  const [complianceFilter, setComplianceFilter] = useState<ComplianceFilter>("all");
  const [requirementFilter, setRequirementFilter] = useState<RequirementFilter>("all");
  const [showQualityReview, setShowQualityReview] = useState(false);
  const [selectedReportAssetId, setSelectedReportAssetId] = useState("");
  const [generating, setGenerating] = useState<string | null>(null);
  const [reportMessage, setReportMessage] = useState<string | null>(null);
  const context = useMemo(() => ({ records, documents }), [records, documents]);
  const allSummary = useMemo(() => summarizeInsurance(context), [context]);
  const analyticsRecords = useMemo(
    () => includeUnverified ? records : records.filter((record) => record.verification_status === "verified"),
    [includeUnverified, records]
  );
  const analyticsContext = useMemo(
    () => ({ records: analyticsRecords, documents }),
    [analyticsRecords, documents]
  );
  const summary = useMemo(
    () => summarizeInsurance(analyticsContext, { includeUnverifiedFinancial: includeUnverified }),
    [analyticsContext, includeUnverified]
  );
  const filteredRecords = useMemo(
    () =>
      analyticsRecords.filter(
        (record) =>
          matchesInsuranceSearch(record, query) &&
          isFilterMatch(record, categoryFilter) &&
          isStatusMatch(record, statusFilter)
      ),
    [analyticsRecords, categoryFilter, query, statusFilter]
  );
  const findings = useMemo(
    () =>
      records
        .flatMap((record) =>
          buildDataQualityFindings(record, context).map((finding) => ({
            record,
            finding
          }))
        )
        .sort((a, b) => {
          const priority = (QUALITY_PRIORITY[a.finding.code] ?? 6) - (QUALITY_PRIORITY[b.finding.code] ?? 6);
          if (priority !== 0) return priority;
          const rank = { critical: 0, warning: 1, information: 2 };
          return rank[a.finding.severity] - rank[b.finding.severity];
        }),
    [context, records]
  );
  const findingGroups = useMemo(() => {
    const byRecord = new Map<string, { record: InsuranceAssetRecord; findings: Array<(typeof findings)[number]["finding"]> }>();
    for (const { record, finding } of findings) {
      const group = byRecord.get(record.id) ?? { record, findings: [] };
      group.findings.push(finding);
      byRecord.set(record.id, group);
    }
    return Array.from(byRecord.values()).sort((a, b) => {
      const aPriority = Math.min(...a.findings.map((finding) => QUALITY_PRIORITY[finding.code] ?? 6));
      const bPriority = Math.min(...b.findings.map((finding) => QUALITY_PRIORITY[finding.code] ?? 6));
      return aPriority - bPriority || b.findings.length - a.findings.length;
    });
  }, [findings]);
  const complianceRows = useMemo(() => {
    const searched = records.filter((record) =>
      matchesInsuranceSearch(record, query) &&
      (requirementFilter === "all" || insuranceRequirement(record) === requirementFilter)
    );
    const matching = complianceFilter === "all" ? searched : searched.filter((record) => complianceStatus(record, documents) === complianceFilter);
    return [...matching].sort((a, b) => {
      if (comparisonSort === "expiry_desc") return compareNullableNumber(a.insurance_expiry_date ? Date.parse(a.insurance_expiry_date) : null, b.insurance_expiry_date ? Date.parse(b.insurance_expiry_date) : null, -1);
      return compareNullableNumber(a.insurance_expiry_date ? Date.parse(a.insurance_expiry_date) : null, b.insurance_expiry_date ? Date.parse(b.insurance_expiry_date) : null, 1);
    });
  }, [comparisonSort, complianceFilter, documents, query, records, requirementFilter]);
  const complianceCounts = useMemo(() => {
    const counts = { compliant: 0, due_soon: 0, expired: 0, needs_review: 0, missing_information: 0, not_required: 0 };
    for (const record of records) counts[complianceStatus(record, documents)] += 1;
    return counts;
  }, [documents, records]);
  const upcomingRenewals = useMemo(() => analyticsRecords
    .filter((record) => !isInsuranceNotRequired(record) && record.days_to_insurance_expiry != null && record.days_to_insurance_expiry >= 0)
    .sort((a, b) => (a.days_to_insurance_expiry ?? Number.MAX_SAFE_INTEGER) - (b.days_to_insurance_expiry ?? Number.MAX_SAFE_INTEGER))
    .slice(0, 8), [analyticsRecords]);
  const premiumWindows = useMemo(
    () => ([30, 60, 90] as const).map((days) => currentPremiumWindow(analyticsRecords, days)),
    [analyticsRecords]
  );
  const managementComparisons = useMemo(() => {
    const insuredAnalyticsRecords = analyticsRecords.filter((record) => !isInsuranceNotRequired(record));
    const validPremiums = insuredAnalyticsRecords.filter((record) => record.insurance_premium != null && record.insurance_premium >= 0);
    const validRatios = insuredAnalyticsRecords.filter((record) => premiumToInsuredValue(record) != null);
    const byCategory = new Map<AssetCategory, { spend: number; premiums: number[]; insuredValue: number }>();
    for (const record of insuredAnalyticsRecords) {
      const spend = annualInsuranceCost(record);
      const category = getAssetCategory(record);
      const current = byCategory.get(category) ?? { spend: 0, premiums: [], insuredValue: 0 };
      if (spend != null) current.spend += spend;
      if (record.insurance_premium != null) current.premiums.push(record.insurance_premium);
      if (record.insured_value != null) current.insuredValue += record.insured_value;
      byCategory.set(category, current);
    }
    const premiumSorted = [...validPremiums].sort((a, b) => (b.insurance_premium ?? 0) - (a.insurance_premium ?? 0));
    const ratioSorted = [...validRatios].sort((a, b) => (premiumToInsuredValue(b) ?? 0) - (premiumToInsuredValue(a) ?? 0));
    const renewalExposure = currentPremiumWindow(insuredAnalyticsRecords, 90).total;
    return {
      expensive: premiumSorted.slice(0, 3),
      highestRatio: ratioSorted[0] ?? null,
      lowestRatio: ratioSorted.at(-1) ?? null,
      byInsurer: groupInsurerPremiums(insuredAnalyticsRecords, language).slice(0, 5),
      byCategory: [...byCategory.entries()].sort((a, b) => b[1].spend - a[1].spend),
      renewalExposure
    };
  }, [analyticsRecords, language]);

  const selectedReportAsset = records.find(
    (record) => record.id === selectedReportAssetId
  );

  const generatePdf = async (type: InsuranceReportType) => {
    if (type === "vehicle_detail" && !selectedReportAsset) {
      setReportMessage(
        isThai ? "กรุณาเลือกรถสำหรับรายงานรายคัน" : "Select an asset for the vehicle detail report."
      );
      return;
    }
    setGenerating(`pdf:${type}`);
    setReportMessage(null);
    try {
      const result = await buildInsurancePdf({
        type,
        records: filteredRecords,
        totalAssetCount: records.length,
        documents,
        historyRecords,
        language,
        selectedRecord: selectedReportAsset
      });
      downloadInsuranceReport(result.blob, result.fileName);
      setReportMessage(isThai ? "สร้าง PDF แล้ว" : "PDF generated from the current filters.");
    } catch (error) {
      setReportMessage(
        error instanceof Error ? error.message : isThai ? "สร้าง PDF ไม่สำเร็จ" : "Unable to generate PDF."
      );
    } finally {
      setGenerating(null);
    }
  };

  const exportExcel = async (type: InsuranceReportType) => {
    if (type === "vehicle_detail" && !selectedReportAsset) {
      setReportMessage(
        isThai ? "กรุณาเลือกรถสำหรับรายงานรายคัน" : "Select an asset for the vehicle detail report."
      );
      return;
    }
    setGenerating(`xlsx:${type}`);
    setReportMessage(null);
    try {
      const XLSX = await import("xlsx");
      const source = type === "vehicle_detail" && selectedReportAsset
        ? [selectedReportAsset]
        : type === "trailer"
          ? filteredRecords.filter((record) => getAssetCategory(record) === "trailer")
          : type === "expired"
            ? filteredRecords.filter((record) => insuranceHistoryStatus(record) === "EXPIRED")
            : filteredRecords;
      const rows = source.map((record) => {
        const recordFindings = buildDataQualityFindings(record, context);
        return {
          Registration: record.vehicle_registration,
          NormalizedRegistration: normalizeInsuranceRegistration(record.vehicle_registration),
          Category: categoryLabel(getAssetCategory(record), language),
          Make: record.vehicle_make ?? "",
          Model: "",
          Year: record.vehicle_year ?? "",
          Chassis: record.chassis_number ?? "",
          Insurer: canonicalInsurerName(record.insurer_en, record.insurer_th, language),
          RawInsurerEnglish: record.insurer_en ?? "",
          RawInsurerThai: record.insurer_th ?? "",
          InsuranceRequirement: insuranceRequirement(record),
          InsuranceRequirementReason: record.insurance_requirement_reason ?? "",
          PolicyNumber: record.policy_number ?? "",
          InsuranceClass: record.insurance_class ?? "",
          RepairType: record.repair_type ?? "",
          PolicyStart: record.insurance_start_date ?? "",
          PolicyExpiry: record.insurance_expiry_date ?? "",
          HistoryStatus: insuranceHistoryStatus(record),
          InsuredValue: record.insured_value ?? "",
          Premium: record.insurance_premium ?? "",
          AdditionalPremium: record.additional_premium ?? "",
          CompulsoryStatus: isCompulsoryConfirmed(record) ? "CONFIRMED" : "UNKNOWN",
          CompulsoryPolicy: record.compulsory_policy_number ?? "",
          CompulsoryExpiry: record.compulsory_expiry_date ?? "",
          CompulsoryCost: record.compulsory_insurance_premium ?? "",
          VehicleTax: record.vehicle_tax ?? "",
          VehicleTaxExpiry: record.registration_expiry_date ?? "",
          AnnualInsuranceCost: annualInsuranceCost(record) ?? "",
          PremiumToValuePercent: premiumToInsuredValue(record) ?? "",
          VerificationStatus: record.verification_status,
          CurrentComplianceStatus: complianceFilterLabel(complianceStatus(record, documents), "en"),
          CriticalFindings: recordFindings.filter((finding) => finding.severity === "critical").length,
          WarningFindings: recordFindings.filter((finding) => finding.severity === "warning").length,
          Findings: recordFindings.map((finding) => finding.label).join(" | "),
          Notes: record.notes ?? ""
        };
      });
      const workbook = XLSX.utils.book_new();
      const reportScope = type === "vehicle_detail"
        ? `1 of ${records.length} assets included`
        : `${source.length} of ${records.length} assets included`;
      XLSX.utils.book_append_sheet(
        workbook,
        XLSX.utils.aoa_to_sheet([
          ["Company", "Expert Express Sender Co., Ltd."],
          ["Report", reportTypeLabel(type, language)],
          ["Scope", reportScope],
          ["Filtered", source.length === records.length ? "No" : "Yes"],
          ["Generated", new Date().toISOString()]
        ]),
        "Report Info"
      );
      XLSX.utils.book_append_sheet(
        workbook,
        XLSX.utils.json_to_sheet(rows),
        "Insurance"
      );
      if (type === "vehicle_detail" && selectedReportAsset) {
        const historyRows = historyRecords
          .filter((item) => item.insurance_record_id === selectedReportAsset.id)
          .map((item) => ({
            PolicyNumber: item.policy_number ?? "",
            Insurer: canonicalInsurerName(item.insurer_en, item.insurer_th, language),
            InsuranceClass: item.insurance_class ?? "",
            PolicyIssueDate: item.policy_issue_date ?? "",
            InsuranceStart: item.insurance_start_date ?? "",
            InsuranceExpiry: item.insurance_expiry_date ?? "",
            InsuredValue: item.insured_value ?? "",
            CurrentPremiumAtArchive: item.insurance_premium ?? "",
            ArchivedAt: item.archived_at
          }));
        XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(historyRows), "Policy History");
      }
      XLSX.writeFile(
        workbook,
        `Expert-Express-${type.replace(/_/g, "-")}-${new Date().toISOString().slice(0, 10)}.xlsx`
      );
      setReportMessage(isThai ? "สร้าง Excel แล้ว" : "Excel generated from the current filters.");
    } catch (error) {
      setReportMessage(
        error instanceof Error ? error.message : isThai ? "สร้าง Excel ไม่สำเร็จ" : "Unable to generate Excel."
      );
    } finally {
      setGenerating(null);
    }
  };

  return (
    <section className="overflow-hidden rounded-[24px] border border-slate-200/80 bg-white shadow-[0_16px_40px_rgba(31,27,61,0.05)]">
      <div className="space-y-3 border-b border-slate-200/80 p-4 sm:p-5">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
          <SummaryFilterCard label={isThai ? "รถ/ทรัพย์สินทั้งหมด" : "Total vehicles/assets"} value={records.length} tone="neutral" onClick={() => { setComplianceFilter("all"); setTab("comparison"); }} />
          <SummaryFilterCard label={isThai ? "ปฏิบัติตามครบถ้วน" : "Fully compliant"} value={complianceCounts.compliant} tone="good" onClick={() => { setComplianceFilter("compliant"); setTab("comparison"); }} />
          <SummaryFilterCard label={isThai ? "หมดอายุใน 30 วัน" : "Expiring within 30 days"} value={complianceCounts.due_soon} tone="warn" onClick={() => { setComplianceFilter("due_soon"); setTab("comparison"); }} />
          <SummaryFilterCard label={isThai ? "หมดอายุแล้ว" : "Expired"} value={complianceCounts.expired} tone="danger" onClick={() => { setComplianceFilter("expired"); setTab("comparison"); }} />
          <SummaryFilterCard label={isThai ? "ต้องตรวจสอบ" : "Needs review"} value={complianceCounts.needs_review} tone="review" onClick={() => { setComplianceFilter("needs_review"); setTab("comparison"); }} />
          <SummaryFilterCard label={isThai ? "ไม่ต้องมีประกัน" : "Insurance Not Required"} value={complianceCounts.not_required} tone="neutral" onClick={() => { setComplianceFilter("not_required"); setRequirementFilter("not_required"); setTab("comparison"); }} />
        </div>
        <div className="flex flex-col gap-2 rounded-xl border border-amber-200 bg-amber-50/60 px-3.5 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div><p className="text-[10px] font-bold uppercase tracking-[.14em] text-amber-800">{isThai ? "ต้องดำเนินการ" : "Action Required"}</p><p className="mt-1 text-sm font-semibold text-slate-800">{isThai ? `${complianceCounts.expired} กรมธรรม์หมดอายุ • ${complianceCounts.due_soon} รายการหมดอายุใน 30 วัน • ${complianceCounts.needs_review} รายการต้องตรวจสอบ` : `${complianceCounts.expired} policies expired • ${complianceCounts.due_soon} expire within 30 days • ${complianceCounts.needs_review} records need review`}</p></div>
          <button type="button" onClick={() => { setShowQualityReview(true); setTab("overview"); }} className="shrink-0 text-xs font-bold text-amber-900 underline-offset-4 hover:underline">{isThai ? "ดูประเด็น" : "View issues"} →</button>
        </div>
      </div>
      <div className="flex flex-col gap-3 border-b border-slate-200/80 p-3 sm:p-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1">
          {(
            [
              ["overview", isThai ? "ภาพรวม" : "Overview", BarChart3],
              ["comparison", isThai ? "รถและการปฏิบัติตาม" : "Vehicles", SlidersHorizontal],
              ["renewals", isThai ? "การต่ออายุ" : "Renewals", CalendarClock],
              ["reports", isThai ? "รายงาน" : "Reports", FileText]
            ] as Array<[WorkspaceTab, string, typeof BarChart3]>
          ).map(([key, label, Icon]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={
                tab === key
                  ? "inline-flex min-h-10 items-center gap-2 rounded-lg bg-white px-3 text-sm font-bold text-slate-950 shadow-sm"
                  : "inline-flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm font-semibold text-slate-500 transition hover:text-slate-900"
              }
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </div>
        <details className="relative self-start lg:self-auto">
          <summary className="cursor-pointer list-none rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50">{isThai ? "ตัวกรองขั้นสูง" : "Advanced filters"}</summary>
          <div className="absolute right-0 z-30 mt-2 w-[290px] rounded-xl border border-slate-200 bg-white p-3 shadow-xl">
            <label className="flex cursor-pointer items-start gap-2 text-xs font-semibold leading-5 text-slate-600"><input type="checkbox" checked={includeUnverified} onChange={(event) => setIncludeUnverified(event.target.checked)} className="mt-0.5 h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500" /><span>{isThai ? "รวมรายการรอตรวจในการวิเคราะห์" : "Include awaiting-review records in analytics"}</span></label>
          </div>
        </details>
      </div>

      {tab === "overview" && (
        <div className="space-y-5 p-4 sm:p-5">
          <section>
            <div className="flex items-end justify-between gap-3"><SectionHeading title={isThai ? "การต่ออายุที่ใกล้ที่สุด" : "Upcoming Renewals"} note={includeUnverified ? (isThai ? "รวมรายการรอตรวจตามตัวกรองขั้นสูง" : "Includes awaiting-review records through Advanced filters.") : (isThai ? "เฉพาะรายการที่ตรวจสอบแล้ว" : "Verified records only.")} /><button type="button" onClick={() => setTab("renewals")} className="shrink-0 text-xs font-bold text-violet-700 hover:underline">{isThai ? "ดูทั้งหมด" : "View all renewals"} →</button></div>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              {premiumWindows.map((window) => <MetricCard key={window.days} label={isThai ? `${window.days} วันข้างหน้า` : `Next ${window.days} days`} value={money(window.total, language)} helper={window.missing > 0 ? (isThai ? `${window.missing} กรมธรรม์ไม่มีข้อมูลเบี้ยปัจจุบัน` : `${window.missing} ${window.missing === 1 ? "policy has" : "policies have"} no recorded current premium`) : (isThai ? `${window.policies} กรมธรรม์ · บันทึกเบี้ยครบ` : `${window.policies} ${window.policies === 1 ? "policy" : "policies"} · all current premiums recorded`)} />)}
            </div>
            <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200"><table className="min-w-[640px] w-full text-left text-xs"><thead className="bg-slate-50 text-slate-500"><tr><th className="px-3 py-2.5">{isThai ? "รถ" : "Vehicle"}</th><th className="px-3 py-2.5">{isThai ? "วันหมดอายุประกัน" : "Insurance expiry"}</th><th className="px-3 py-2.5">{isThai ? "เหลือเวลา" : "Days remaining"}</th><th className="px-3 py-2.5 text-right">{isThai ? "เบี้ยปัจจุบัน" : "Current Premium"}</th></tr></thead><tbody className="divide-y divide-slate-100">{upcomingRenewals.map((record) => <tr key={record.id} className="hover:bg-slate-50"><td className="px-3 py-2.5"><button type="button" onClick={() => onOpenRecord(record)} className="font-bold text-slate-900 hover:underline">{record.vehicle_registration}</button><span className="ml-2 text-slate-400">{record.vehicle_make}</span></td><td className="px-3 py-2.5 text-slate-600">{date(record.insurance_expiry_date, language)}</td><td className="px-3 py-2.5 font-semibold text-slate-700">{record.days_to_insurance_expiry} {isThai ? "วัน" : "days"}</td><td className="px-3 py-2.5 text-right font-semibold text-slate-700">{money(record.insurance_premium, language)}</td></tr>)}</tbody></table></div>
          </section>

          <section>
            <SectionHeading title={isThai ? "ภาพรวมการเงิน" : "Financial Overview"} note={includeUnverified ? (isThai ? "รวมรายการรอตรวจตามที่เลือก ค่า NULL ไม่ถูกแทนด้วยศูนย์" : "Includes provisional records by explicit choice. NULL values are not treated as zero.") : (isThai ? "เฉพาะรายการที่ตรวจสอบแล้ว ค่า NULL ไม่ถูกแทนด้วยศูนย์" : "Verified records only. NULL values are not treated as zero.")} />
            <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4"><MetricCard label={isThai ? "ค่าใช้จ่ายรวม" : "Total recorded spend"} value={money(summary.financial.totalSpend, language)} strong /><MetricCard label={isThai ? "ทุนประกันกองรถ" : "Fleet insured value"} value={money(summary.financial.insuredValueTotal, language)} /><MetricCard label={isThai ? "เบี้ยเฉลี่ย" : "Average premium"} value={money(summary.financial.averagePremium, language)} /><MetricCard label={isThai ? "เบี้ยปัจจุบันที่หมดอายุใน 90 วัน" : "Current premiums expiring within 90 days"} value={money(managementComparisons.renewalExposure, language)} helper={premiumWindows[2].missing > 0 ? (isThai ? `${premiumWindows[2].missing} รายการไม่มีข้อมูลเบี้ย` : `${premiumWindows[2].missing} premiums not recorded`) : undefined} /></div>
            <div className="mt-2 grid gap-x-6 gap-y-2 rounded-xl bg-slate-50 px-4 py-3 text-xs sm:grid-cols-2 xl:grid-cols-3"><FinancialLine label={isThai ? "เบี้ยประกันหลัก" : "Main insurance"} value={money(summary.financial.premiumTotal, language)} /><FinancialLine label={isThai ? "ค่า พ.ร.บ." : "Compulsory"} value={money(summary.financial.compulsoryTotal, language)} /><FinancialLine label={isThai ? "ภาษีรถ" : "Vehicle tax"} value={money(summary.financial.vehicleTaxTotal, language)} /><FinancialLine label={isThai ? "เบี้ยเพิ่ม" : "Additional premiums"} value={money(summary.financial.additionalPremiumTotal, language)} /><FinancialLine label={isThai ? "ทุนประกันเฉลี่ย" : "Average insured value"} value={money(summary.financial.averageInsuredValue, language)} /><FinancialLine label={isThai ? "อัตราเบี้ย / ทุน" : "Premium / insured value"} value={summary.financial.premiumToValuePercent == null ? (isThai ? "ข้อมูลไม่เพียงพอ" : "Insufficient data") : `${summary.financial.premiumToValuePercent.toFixed(2)}%`} /></div>
          </section>

          <section>
            <SectionHeading title={isThai ? "ข้อมูลเชิงบริหาร" : "Management Insights"} note={isThai ? "ข้อเท็จจริงจากค่าที่บันทึกและใช้ได้เท่านั้น" : "Deterministic facts from valid recorded values only."} />
            <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              <InsightStat label={isThai ? "เบี้ยสูงสุด" : "Highest insurance premium"} primary={managementComparisons.expensive[0]?.vehicle_registration ?? (isThai ? "ข้อมูลไม่เพียงพอ" : "Insufficient data")} secondary={managementComparisons.expensive[0] ? money(managementComparisons.expensive[0].insurance_premium, language) : ""} />
              <InsightStat label={isThai ? "อัตราเบี้ยต่อทุนสูงสุด" : "Highest premium-to-value ratio"} primary={managementComparisons.highestRatio?.vehicle_registration ?? (isThai ? "ข้อมูลไม่เพียงพอ" : "Insufficient data")} secondary={managementComparisons.highestRatio ? `${premiumToInsuredValue(managementComparisons.highestRatio)?.toFixed(2)}% · ${isThai ? "ค่าเฉลี่ยกองรถ" : "fleet average"} ${summary.financial.premiumToValuePercent?.toFixed(2) ?? "—"}%` : ""} advisory={Boolean(managementComparisons.highestRatio)} language={language} />
              <InsightStat label={isThai ? "บริษัทประกันที่มีเบี้ยรวมสูงสุด" : "Largest insurer by premium"} primary={managementComparisons.byInsurer[0]?.name ?? (isThai ? "ข้อมูลไม่เพียงพอ" : "Insufficient data")} secondary={managementComparisons.byInsurer[0] ? money(managementComparisons.byInsurer[0].premiumTotal, language) : ""} />
              <InsightStat label={isThai ? "ประเภทรถที่มีค่าใช้จ่ายสูงสุด" : "Most expensive vehicle type"} primary={managementComparisons.byCategory[0] ? categoryLabel(managementComparisons.byCategory[0][0], language) : (isThai ? "ข้อมูลไม่เพียงพอ" : "Insufficient data")} secondary={managementComparisons.byCategory[0] ? money(managementComparisons.byCategory[0][1].spend, language) : ""} />
            </div>
          </section>

          <ManagementComparisons comparisons={managementComparisons} language={language} />

          <section className="rounded-xl border border-slate-200 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h3 className="text-sm font-bold text-slate-950">{isThai ? "การตรวจสอบคุณภาพข้อมูล" : "Data Quality Review"}</h3><p className="mt-1 text-sm text-slate-600">{isThai ? `${allSummary.quality.affectedAssets} คันต้องตรวจสอบ · ${allSummary.quality.critical} ประเด็นวิกฤต · ${allSummary.quality.warning} คำเตือน` : `${allSummary.quality.affectedAssets} vehicles require review · ${allSummary.quality.critical} critical issues · ${allSummary.quality.warning} warnings`}</p></div><button type="button" onClick={() => setShowQualityReview((current) => !current)} className="btn-secondary min-h-9 text-xs">{showQualityReview ? (isThai ? "ซ่อนรายการ" : "Hide records") : (isThai ? "ตรวจสอบรายการ" : "Review records")} →</button></div>
            {showQualityReview && <div className="mt-4 grid gap-4 xl:grid-cols-2"><QualityGroup title={isThai ? "ต้องดำเนินการ" : "Action Required"} groups={findingGroups.map((group) => ({ ...group, findings: group.findings.filter((finding) => ACTION_QUALITY_CODES.has(finding.code)) })).filter((group) => group.findings.length > 0)} language={language} onOpenRecord={onOpenRecord} action /><QualityGroup title={isThai ? "ปรับปรุงข้อมูล" : "Data Improvement"} groups={findingGroups.map((group) => ({ ...group, findings: group.findings.filter((finding) => !ACTION_QUALITY_CODES.has(finding.code)) })).filter((group) => group.findings.length > 0)} language={language} onOpenRecord={onOpenRecord} /></div>}
          </section>
        </div>
      )}

      {tab === "comparison" && (
        <div className="p-4 sm:p-5">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <label className="relative min-w-0 flex-1 xl:max-w-md"><span className="sr-only">{isThai ? "ค้นหาทะเบียนรถ" : "Search vehicle registration"}</span><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} className="form-input w-full pl-9" placeholder={isThai ? "ค้นหาทะเบียนรถ" : "Search vehicle registration"} /></label>
            <div className="flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1">{(["all", "compliant", "due_soon", "expired", "needs_review", "missing_information", "not_required"] as ComplianceFilter[]).map((filter) => <button key={filter} type="button" onClick={() => setComplianceFilter(filter)} className={complianceFilter === filter ? "rounded-lg bg-white px-3 py-2 text-xs font-bold text-slate-900 shadow-sm" : "rounded-lg px-3 py-2 text-xs font-semibold text-slate-500 hover:text-slate-900"}>{complianceFilterLabel(filter, language)}</button>)}</div>
            <label className="text-xs font-semibold text-slate-600"><span className="sr-only">{isThai ? "กรองข้อกำหนดประกัน" : "Filter insurance requirement"}</span><select className="form-input min-h-9 py-1.5 text-xs" value={requirementFilter} onChange={(event) => setRequirementFilter(event.target.value as RequirementFilter)}>{(["all", "required", "not_required", "unknown"] as RequirementFilter[]).map((filter) => <option key={filter} value={filter}>{requirementFilterLabel(filter, language)}</option>)}</select></label>
            <label className="flex items-center gap-2 text-xs font-semibold text-slate-600"><ArrowUpDown className="h-4 w-4" /><select className="form-input min-h-9 py-1.5 text-xs" value={comparisonSort} onChange={(event) => setComparisonSort(event.target.value as ComparisonSort)}><option value="expiry_asc">{isThai ? "หมดอายุใกล้สุด" : "Expiry: soonest"}</option><option value="expiry_desc">{isThai ? "หมดอายุไกลสุด" : "Expiry: latest"}</option></select></label>
          </div>
          <p className="mt-3 text-xs text-slate-500">{complianceRows.length} {isThai ? "รายการ" : "vehicles/assets"}</p>
          <div className="mt-3 max-h-[650px] overflow-auto rounded-xl border border-slate-200">
            <table className="min-w-[1080px] w-full text-left text-xs">
              <thead className="sticky top-0 z-10 bg-slate-50 font-bold uppercase tracking-[.08em] text-slate-500 shadow-[0_1px_0_rgba(148,163,184,.25)]"><tr><th className="px-3 py-3">{isThai ? "รถ" : "Vehicle"}</th><th className="px-3 py-3">{isThai ? "ประเภทรถ" : "Vehicle Type"}</th><th className="px-3 py-3">{isThai ? "ประกันหลัก" : "Main Insurance"}</th><th className="px-3 py-3">{isThai ? "พ.ร.บ." : "Compulsory Insurance"}</th><th className="px-3 py-3">{isThai ? "ภาษีรถ" : "Vehicle Tax"}</th><th className="px-3 py-3 text-right">{isThai ? "เบี้ย" : "Premium"}</th><th className="px-3 py-3">{isThai ? "สถานะ" : "Status"}</th><th className="w-12 px-3 py-3 text-right">{isThai ? "ดู" : "Action"}</th></tr></thead>
              <tbody className="divide-y divide-slate-100">{complianceRows.map((record) => {
                const status = complianceStatus(record, documents);
                const insurer = canonicalInsurerName(record.insurer_en, record.insurer_th, language);
                return <tr key={record.id} className="hover:bg-slate-50"><td className="px-3 py-3"><button type="button" onClick={() => onOpenRecord(record)} className="font-bold text-slate-950 hover:underline">{record.vehicle_registration}</button><span className="block text-[11px] text-slate-400">{record.vehicle_make || (isThai ? "ไม่ได้บันทึก" : "Not recorded")}</span></td><td className="px-3 py-3 text-slate-600">{categoryLabel(getAssetCategory(record), language)}</td><td className="px-3 py-3 text-slate-700"><span className="block font-semibold">{isInsuranceNotRequired(record) ? (isThai ? "ไม่ต้องมีประกัน" : "Insurance Not Required") : date(record.insurance_expiry_date, language)}</span><span className="text-[11px] text-slate-400">{insurer || (isThai ? "ไม่ได้บันทึก" : "Not recorded")}</span></td><td className="px-3 py-3 text-slate-600">{isInsuranceNotRequired(record) ? "—" : isCompulsoryConfirmed(record) ? (record.compulsory_expiry_date ? date(record.compulsory_expiry_date, language) : (isThai ? "รวมในกรมธรรม์หลัก" : "Included in main policy")) : (isThai ? "ไม่ทราบ" : "Unknown")}</td><td className="px-3 py-3 text-slate-600">{date(record.registration_expiry_date, language)}</td><td className="px-3 py-3 text-right font-semibold text-slate-800">{money(record.insurance_premium, language)}</td><td className="px-3 py-3"><ComplianceBadge status={status} language={language} /></td><td className="px-3 py-3 text-right"><button type="button" aria-label={`${isThai ? "เปิด" : "Open"} ${record.vehicle_registration}`} onClick={() => onOpenRecord(record)} className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-violet-50 hover:text-violet-700"><ChevronRight className="h-4 w-4" /></button></td></tr>;
              })}</tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "renewals" && (
        <div className="space-y-5 p-4 sm:p-5">
          <p className="text-xs text-slate-500">{includeUnverified ? (isThai ? "รวมรายการรอตรวจตามที่ผู้ใช้เลือก" : "Includes awaiting-review records by deliberate selection.") : (isThai ? "เฉพาะรายการที่ตรวจสอบแล้ว" : "Verified records only.")}</p>
          {(
            [
              [["urgent"], isThai ? "เร่งด่วน" : "Urgent", isThai ? "หมดอายุหรือภายใน 30 วัน" : "Expired or within 30 days", "danger"],
              [["upcoming_60", "upcoming_90"], isThai ? "กำลังมาถึง" : "Upcoming", isThai ? "31–90 วัน" : "31–90 days", "warn"],
              [["later"], isThai ? "ภายหลัง" : "Later", isThai ? "มากกว่า 90 วัน" : "Over 90 days", "neutral"],
              [["unknown"], isThai ? "ไม่ทราบ" : "Unknown", isThai ? "ไม่มีวันหมดอายุ" : "Missing expiry", "unknown"]
            ] as const
          ).map(([bands, title, helper, tone]) => {
            const bandRecords = analyticsRecords
              .filter((record) => bands.includes(renewalBand(record) as never))
              .sort((a, b) => (a.days_to_insurance_expiry ?? 999999) - (b.days_to_insurance_expiry ?? 999999));
            return (
              <RenewalSection
                key={bands.join("-")}
                title={title}
                helper={helper}
                tone={tone}
                records={bandRecords}
                language={language}
                onOpenRecord={onOpenRecord}
                onReviewRecord={onReviewRecord}
              />
            );
          })}
          <details className="rounded-xl border border-slate-200 bg-slate-50/60">
            <summary className="cursor-pointer px-4 py-3 text-sm font-bold text-slate-700">
              {isThai ? "ไม่ต้องมีประกัน" : "Insurance Not Required"} ({records.filter(isInsuranceNotRequired).length})
            </summary>
            <div className="border-t border-slate-200">
              {records.filter(isInsuranceNotRequired).map((record) => (
                <button key={record.id} type="button" onClick={() => onOpenRecord(record)} className="flex w-full items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 text-left text-xs last:border-b-0 hover:bg-white">
                  <span><strong className="text-slate-900">{record.vehicle_registration}</strong><span className="ml-2 text-slate-500">{record.vehicle_make || categoryLabel(getAssetCategory(record), language)}</span></span>
                  <span className="text-slate-500">{record.insurance_requirement_reason || (isThai ? "ไม่ต้องมีประกัน" : "Not required")}</span>
                </button>
              ))}
              {!records.some(isInsuranceNotRequired) && <p className="px-4 py-3 text-xs text-slate-500">{isThai ? "ไม่มีรายการ" : "No assets classified as not required."}</p>}
            </div>
          </details>
        </div>
      )}

      {tab === "reports" && (
        <div className="space-y-5 p-4 sm:p-5">
          <FilterBar
            query={query}
            setQuery={setQuery}
            category={categoryFilter}
            setCategory={setCategoryFilter}
            status={statusFilter}
            setStatus={setStatusFilter}
            language={language}
          />
          <div className="flex flex-wrap items-center gap-2 text-xs"><span className="font-bold text-slate-600">{isThai ? "ขอบเขตรายงาน" : "Report scope"}:</span><span className="rounded-full bg-violet-50 px-2.5 py-1 font-bold text-violet-700">{isThai ? "ข้อมูลปัจจุบัน" : "Current records only"}</span><span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-400" title={isThai ? "ระบบเดิมยังไม่มีตารางประวัติหลายกรมธรรม์" : "The legacy schema does not yet store multiple policy periods."}>{isThai ? "ประวัติทั้งหมด — ยังไม่มีข้อมูลที่จัดเก็บ" : "Full history — not stored yet"}</span></div>
          <div className="rounded-2xl border border-violet-100 bg-[#faf9fd] p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-bold text-slate-950">{isThai ? "รถสำหรับรายงานรายคัน" : "Asset for vehicle detail report"}</p>
                <p className="mt-1 text-xs text-slate-500">{isThai ? "รายงานอื่นใช้ข้อมูลตามตัวกรองปัจจุบัน" : "All other reports use the current live filters."}</p>
              </div>
              <select aria-label={isThai ? "เลือกรถสำหรับรายงานรายคัน" : "Select an asset for the vehicle detail report"} className="form-input min-w-[260px]" value={selectedReportAssetId} onChange={(event) => setSelectedReportAssetId(event.target.value)}>
                <option value="">{isThai ? "เลือกรถ" : "Select an asset"}</option>
                {records.map((record) => <option key={record.id} value={record.id}>{record.vehicle_registration} — {record.vehicle_make || (isThai ? "ไม่ได้บันทึก" : "Not recorded")}</option>)}
              </select>
            </div>
          </div>
          {reportMessage && <p className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-700">{reportMessage}</p>}
          <ReportGroup title={isThai ? "รายงานหลักสำหรับผู้บริหาร" : "PRIMARY MANAGEMENT REPORTS"} types={REPORT_TYPES.slice(0, 4)} startIndex={0} primary language={language} filteredCount={filteredRecords.length} totalCount={records.length} selectedAssetId={selectedReportAssetId} generating={generating} onPdf={generatePdf} onExcel={exportExcel} />
          <details className="group rounded-2xl border border-slate-200 bg-slate-50/60">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-bold text-slate-700 hover:bg-white"><span>{isThai ? "รายงานเพิ่มเติม" : "More reports"}</span><ChevronDown className="h-4 w-4 text-slate-400 transition group-open:rotate-180" /></summary>
            <div className="border-t border-slate-200 p-4"><ReportGroup title={isThai ? "รายงานเฉพาะด้าน" : "SPECIALIST REPORTS"} types={REPORT_TYPES.slice(4)} startIndex={4} language={language} filteredCount={filteredRecords.length} totalCount={records.length} selectedAssetId={selectedReportAssetId} generating={generating} onPdf={generatePdf} onExcel={exportExcel} /></div>
          </details>
          <p className="text-xs leading-5 text-slate-500">{isThai ? "PDF ใช้แบรนด์ Expert Express Sender Co., Ltd. รูปแบบ A4 มีเลขหน้าและหมายเหตุเรื่องข้อมูลที่ไม่ครบ" : "PDF reports use Expert Express Sender Co., Ltd. branding, professional A4 layouts, page numbers, totals, and explicit incomplete-data notes."}</p>
        </div>
      )}
    </section>
  );
}

function SectionHeading({ title, note }: { title: string; note: string }) {
  return <div><h3 className="text-sm font-bold text-slate-950">{title}</h3><p className="mt-1 text-xs leading-5 text-slate-500">{note}</p></div>;
}

function SummaryFilterCard({ label, value, tone, onClick }: { label: string; value: number; tone: "neutral" | "good" | "warn" | "danger" | "review"; onClick: () => void }) {
  const classes = tone === "good" ? "text-emerald-700 border-emerald-100" : tone === "warn" ? "text-amber-700 border-amber-100" : tone === "danger" ? "text-rose-700 border-rose-100" : tone === "review" ? "text-violet-700 border-violet-100" : "text-slate-900 border-slate-200";
  return <button type="button" onClick={onClick} className={`rounded-xl border bg-white px-3 py-3 text-left transition hover:-translate-y-px hover:shadow-sm ${classes}`}><span className="block text-2xl font-bold">{value}</span><span className="mt-1 block text-[11px] font-semibold leading-4 text-slate-600">{label}</span></button>;
}

function MetricCard({ label, value, helper, strong }: { label: string; value: string; helper?: string; strong?: boolean }) {
  return <div className={`rounded-xl border p-3.5 ${strong ? "border-violet-200 bg-[#f7f5ff]" : "border-slate-200 bg-white"}`}><p className="text-xs font-semibold text-slate-500">{label}</p><p className={`mt-1.5 break-words text-lg font-bold ${strong ? "text-[#3f3168]" : "text-slate-950"}`}>{value}</p>{helper && <p className="mt-1 text-[11px] text-slate-400">{helper}</p>}</div>;
}

function FinancialLine({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center justify-between gap-3"><span className="text-slate-500">{label}</span><strong className="text-right text-slate-800">{value}</strong></div>;
}

function InsightStat({ label, primary, secondary, advisory = false, language = "en" }: { label: string; primary: string; secondary: string; advisory?: boolean; language?: "en" | "th" }) {
  return <div className="rounded-xl border border-slate-200 p-3.5"><p className="text-[11px] font-semibold text-slate-500">{label}</p><p className="mt-1.5 break-words text-base font-bold text-slate-950">{primary}</p>{secondary && <p className="mt-1 text-xs leading-5 text-slate-600">{secondary}</p>}{advisory && <span className="mt-2 inline-flex rounded-full bg-amber-50 px-2 py-1 text-[10px] font-bold text-amber-800">{language === "th" ? "ทบทวนเมื่อต่ออายุครั้งถัดไป" : "Review at next renewal"}</span>}</div>;
}

function complianceFilterLabel(filter: ComplianceFilter, language: "en" | "th") {
  const labels = language === "th" ? { all: "ทั้งหมด", compliant: "ครบถ้วน", due_soon: "ใกล้ครบกำหนด", expired: "หมดอายุ", needs_review: "ต้องตรวจสอบ", missing_information: "ข้อมูลไม่ครบ", not_required: "ไม่ต้องมีประกัน" } : { all: "All", compliant: "Compliant", due_soon: "Due soon", expired: "Expired", needs_review: "Needs review", missing_information: "Missing information", not_required: "Insurance Not Required" };
  return labels[filter];
}

function ComplianceBadge({ status, language }: { status: Exclude<ComplianceFilter, "all">; language: "en" | "th" }) {
  const classes = status === "compliant" ? "bg-emerald-50 text-emerald-700" : status === "due_soon" ? "bg-amber-50 text-amber-800" : status === "expired" ? "bg-rose-50 text-rose-700" : status === "needs_review" ? "bg-violet-50 text-violet-700" : "bg-slate-100 text-slate-600";
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold ${classes}`}>{complianceFilterLabel(status, language)}</span>;
}

function QualityGroup({ title, groups, language, onOpenRecord, action = false }: { title: string; groups: Array<{ record: InsuranceAssetRecord; findings: DataQualityFinding[] }>; language: "en" | "th"; onOpenRecord: (record: InsuranceAssetRecord) => void; action?: boolean }) {
  const isThai = language === "th";
  return <section><h4 className={`text-xs font-bold uppercase tracking-[.12em] ${action ? "text-rose-700" : "text-slate-500"}`}>{title}</h4><div className="mt-2 overflow-hidden rounded-xl border border-slate-200">{groups.length ? groups.map(({ record, findings }) => <details key={record.id} className="group border-b border-slate-100 last:border-b-0"><summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 hover:bg-slate-50"><ChevronRight className="h-4 w-4 text-slate-400 transition group-open:rotate-90" /><span className="font-bold text-slate-900">{record.vehicle_registration}</span><span className="text-xs text-slate-500">{findings.length} {isThai ? "ประเด็น" : findings.length === 1 ? "issue" : "issues"}</span></summary><div className="space-y-2 bg-slate-50/70 px-3 py-3 pl-9">{findings.map((finding) => <div key={finding.code} className="flex items-start gap-2 text-xs text-slate-700"><SeverityDot severity={finding.severity} /><span>{findingText(finding.code, finding.label, language)}</span></div>)}<button type="button" onClick={() => onOpenRecord(record)} className="text-xs font-bold text-violet-700 hover:underline">{isThai ? "เปิดข้อมูลรถ" : "Open vehicle record"}</button></div></details>) : <p className="p-3 text-xs text-slate-500">{isThai ? "ไม่มีรายการ" : "No issues in this group."}</p>}</div></section>;
}

function SeverityDot({ severity }: { severity: "critical" | "warning" | "information" }) {
  return <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${severity === "critical" ? "bg-rose-500" : severity === "warning" ? "bg-amber-400" : "bg-slate-400"}`} />;
}

function ManagementComparisons({ comparisons, language }: {
  comparisons: {
    expensive: InsuranceAssetRecord[];
    highestRatio: InsuranceAssetRecord | null;
    lowestRatio: InsuranceAssetRecord | null;
    byInsurer: InsurerSpendGroup[];
    byCategory: Array<[AssetCategory, { spend: number; premiums: number[]; insuredValue: number }]>;
    renewalExposure: number | null;
  };
  language: "en" | "th";
}) {
  const isThai = language === "th";
  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <section>
        <SectionHeading title={isThai ? "เบี้ยตามบริษัทประกัน" : "Insurer Premiums"} note={isThai ? "รวมชื่อบริษัทที่เป็นนามแฝงเดียวกันโดยไม่แก้ไขข้อมูลต้นฉบับ" : "Known aliases are grouped without changing source wording."} />
        <div className="mt-3 space-y-3 rounded-xl border border-slate-200 p-4">
          {comparisons.byInsurer.length ? comparisons.byInsurer.map((group) => (
            <div key={group.key}>
              <div className="flex items-start justify-between gap-3 text-xs">
                <span className="min-w-0 truncate font-semibold text-slate-700">{group.name}<small className="ml-1 text-slate-400">({group.recordCount})</small></span>
                <span className="shrink-0 font-bold text-slate-900">{money(group.premiumTotal, language)} · {group.percentage.toFixed(1)}%</span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-violet-400" style={{ width: `${group.percentage}%` }} /></div>
            </div>
          )) : <EmptyValue language={language} />}
        </div>
      </section>
      <section>
        <SectionHeading title={isThai ? "วิเคราะห์ตามประเภทรถ" : "Vehicle Type Analysis"} note={isThai ? "คำนวณจากค่าที่บันทึกและใช้ได้เท่านั้น" : "Calculated only from valid recorded values."} />
        <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200">
          <table className="min-w-[620px] w-full text-left text-xs"><thead className="bg-slate-50 text-slate-500"><tr><th className="px-3 py-2.5">{isThai ? "ประเภทรถ" : "Vehicle type"}</th><th className="px-3 py-2.5 text-right">{isThai ? "ค่าใช้จ่ายประกัน" : "Insurance spend"}</th><th className="px-3 py-2.5 text-right">{isThai ? "เบี้ยเฉลี่ย" : "Average premium"}</th><th className="px-3 py-2.5 text-right">{isThai ? "ทุนประกัน" : "Insured value"}</th></tr></thead><tbody className="divide-y divide-slate-100">{comparisons.byCategory.map(([category, values]) => <tr key={category}><td className="px-3 py-2.5 font-semibold text-slate-700">{categoryLabel(category, language)}</td><td className="px-3 py-2.5 text-right">{values.spend > 0 ? money(values.spend, language) : (isThai ? "ข้อมูลไม่เพียงพอ" : "Insufficient data")}</td><td className="px-3 py-2.5 text-right">{values.premiums.length ? money(values.premiums.reduce((sum, value) => sum + value, 0) / values.premiums.length, language) : (isThai ? "ข้อมูลไม่เพียงพอ" : "Insufficient data")}</td><td className="px-3 py-2.5 text-right">{values.insuredValue > 0 ? money(values.insuredValue, language) : (isThai ? "ข้อมูลไม่เพียงพอ" : "Insufficient data")}</td></tr>)}</tbody></table>
        </div>
      </section>
    </div>
  );
}

function EmptyValue({ language }: { language: "en" | "th" }) {
  return <p className="text-xs text-slate-500">{language === "th" ? "ข้อมูลไม่เพียงพอ" : "Insufficient data"}</p>;
}

function ReportGroup({ title, types, startIndex, primary = false, language, filteredCount, totalCount, selectedAssetId, generating, onPdf, onExcel }: { title: string; types: InsuranceReportType[]; startIndex: number; primary?: boolean; language: "en" | "th"; filteredCount: number; totalCount: number; selectedAssetId: string; generating: string | null; onPdf: (type: InsuranceReportType) => Promise<void>; onExcel: (type: InsuranceReportType) => Promise<void> }) {
  const isThai = language === "th";
  const descriptions: Record<InsuranceReportType, string> = {
    executive: isThai ? "สรุปผู้บริหาร A4 หนึ่งหน้า" : "One-page A4 management summary",
    fleet_summary: isThai ? "สรุปกองรถเดิม" : "Legacy fleet summary",
    renewal: isThai ? "วันหมดอายุ เบี้ยปัจจุบัน และรายการที่ต้องดำเนินการ" : "Expiry dates, current premiums and action status",
    cost: isThai ? "วิเคราะห์ค่าใช้จ่ายและทุนประกัน" : "Recorded insurance cost and insured-value analysis",
    vehicle_detail: selectedAssetId ? (isThai ? "พร้อมสร้างสำหรับรถที่เลือก" : "Ready for the selected asset") : (isThai ? "เลือกรถก่อนสร้างรายงาน" : "Select an asset before generating"),
    asset_register: isThai ? "ทะเบียนทรัพย์สินทั้งหมด" : "Complete fleet asset register",
    missing_information: isThai ? "ข้อมูลไม่ครบและข้อยกเว้น" : "Missing data and compliance exceptions",
    comparison: isThai ? "เปรียบเทียบเบี้ยและทุนประกัน" : "Premium and insured-value comparison",
    trailer: isThai ? "ข้อมูลประกันรถพ่วง" : "Trailer insurance records",
    expired: isThai ? "กรมธรรม์หมดอายุ" : "Expired insurance records"
  };
  return <section><h3 className="text-xs font-bold uppercase tracking-[.14em] text-slate-500">{title}</h3><div className={`mt-3 grid gap-3 md:grid-cols-2 ${primary ? "xl:grid-cols-4" : "xl:grid-cols-3"}`}>{types.map((type, index) => <div key={type} className={`rounded-2xl border bg-white p-4 ${primary ? "border-violet-200 shadow-[0_6px_20px_rgba(81,64,170,.07)]" : "border-slate-200"}`}><div className="flex items-start gap-3"><div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm font-bold ${primary ? "bg-[#eeeafb] text-[#5140aa]" : "bg-slate-100 text-slate-600"}`}>{startIndex + index + 1}</div><div><h4 className="text-sm font-bold text-slate-950">{reportTypeLabel(type, language)}</h4><p className="mt-1 text-xs leading-5 text-slate-500">{descriptions[type]}</p><p className="mt-1 text-[11px] font-semibold text-slate-400">{type === "vehicle_detail" ? `${selectedAssetId ? 1 : 0} ${isThai ? "จาก" : "of"} ${totalCount}` : `${filteredCount} ${isThai ? "จาก" : "of"} ${totalCount} ${isThai ? "รายการ" : "assets included"}`}</p></div></div><div className="mt-4 flex gap-2"><button type="button" disabled={generating != null || type === "vehicle_detail" && !selectedAssetId} onClick={() => void onPdf(type)} className="btn-primary min-h-9 flex-1 text-xs"><Download className="h-4 w-4" />{generating === `pdf:${type}` ? (isThai ? "กำลังสร้าง" : "Generating") : "PDF"}</button><button type="button" disabled={generating != null || type === "vehicle_detail" && !selectedAssetId} onClick={() => void onExcel(type)} className="btn-secondary min-h-9 flex-1 text-xs"><FileSpreadsheet className="h-4 w-4" />{generating === `xlsx:${type}` ? (isThai ? "กำลังสร้าง" : "Generating") : "Excel"}</button></div></div>)}</div></section>;
}

function FilterBar({ query, setQuery, category, setCategory, status, setStatus, language }: { query: string; setQuery: (value: string) => void; category: CategoryFilter; setCategory: (value: CategoryFilter) => void; status: StatusFilter; setStatus: (value: StatusFilter) => void; language: "en" | "th" }) {
  const isThai = language === "th";
  return <div className="grid gap-3 lg:grid-cols-[minmax(260px,1fr)_220px_190px]"><label className="relative"><span className="sr-only">{isThai ? "ค้นหาประกันภัย" : "Search insurance"}</span><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input type="search" className="form-input w-full pl-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={isThai ? "ทะเบียน เลขตัวถัง ยี่ห้อ บริษัท หรือกรมธรรม์" : "Registration, chassis, make, insurer or policy"} /></label><select aria-label={isThai ? "กรองตามประเภททรัพย์สิน" : "Filter by asset category"} className="form-input" value={category} onChange={(event) => setCategory(event.target.value as CategoryFilter)}>{CATEGORY_FILTERS.map((filter) => <option key={filter} value={filter}>{filterLabel(filter, language)}</option>)}</select><select aria-label={isThai ? "กรองตามสถานะประกัน" : "Filter by insurance status"} className="form-input" value={status} onChange={(event) => setStatus(event.target.value as StatusFilter)}><option value="all">{isThai ? "ทุกสถานะ" : "All statuses"}</option><option value="current">{isThai ? "ปัจจุบัน" : "Current"}</option><option value="expired">{isThai ? "หมดอายุ" : "Expired"}</option><option value="expiring">{isThai ? "ใกล้หมดอายุ" : "Expiring soon"}</option></select></div>;
}

function RenewalSection({ title, helper, tone, records, language, onOpenRecord, onReviewRecord }: { title: string; helper: string; tone: "danger" | "warn" | "neutral" | "unknown"; records: InsuranceAssetRecord[]; language: "en" | "th"; onOpenRecord: (record: InsuranceAssetRecord) => void; onReviewRecord: (record: InsuranceAssetRecord) => void }) {
  const isThai = language === "th";
  const line = tone === "danger" ? "bg-rose-500" : tone === "warn" ? "bg-amber-400" : tone === "unknown" ? "bg-slate-300" : "bg-emerald-400";
  return <section><div className="mb-2 flex items-center justify-between gap-3"><div><h3 className="text-sm font-bold text-slate-950">{title}</h3><p className="mt-0.5 text-xs text-slate-500">{helper}</p></div><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600">{records.length}</span></div><div className="overflow-hidden rounded-2xl border border-slate-200"><div className="hidden grid-cols-[100px_minmax(120px,1fr)_minmax(130px,1fr)_110px_130px_120px_100px_190px] gap-3 bg-slate-50 px-4 py-2.5 pl-5 text-[10px] font-bold uppercase tracking-wide text-slate-500 lg:grid"><span>{isThai ? "ทะเบียน" : "Registration"}</span><span>{isThai ? "รถ" : "Vehicle"}</span><span>{isThai ? "บริษัทประกัน" : "Insurer"}</span><span>{isThai ? "กรมธรรม์" : "Policy"}</span><span>{isThai ? "หมดอายุ" : "Expiry"}</span><span>{isThai ? "พ.ร.บ." : "Compulsory"}</span><span>{isThai ? "สถานะตรวจ" : "Review"}</span><span>{isThai ? "การทำงาน" : "Actions"}</span></div>{records.length ? records.map((record) => {
    const days = record.days_to_insurance_expiry;
    const timing = days == null ? (isThai ? "ไม่ทราบ" : "Unknown") : days < 0 ? (isThai ? `หมดอายุแล้ว ${Math.abs(days)} วัน` : `Expired ${Math.abs(days)} days ago`) : days === 0 ? (isThai ? "หมดอายุวันนี้" : "Expires today") : (isThai ? `เหลือ ${days} วัน` : `${days} days remaining`);
    const insurer = canonicalInsurerName(record.insurer_en, record.insurer_th, language) || (isThai ? "ไม่ได้บันทึก" : "Not recorded");
    return <div key={record.id} className="relative grid gap-3 border-b border-slate-100 bg-white px-4 py-3 pl-5 last:border-b-0 hover:bg-slate-50 lg:grid-cols-[100px_minmax(120px,1fr)_minmax(130px,1fr)_110px_130px_120px_100px_190px] lg:items-center"><span className={`absolute inset-y-0 left-0 w-1 ${line}`} /><button type="button" onClick={() => onOpenRecord(record)} className="text-left font-bold text-slate-950 underline-offset-4 hover:underline">{record.vehicle_registration}</button><span className="text-sm text-slate-600">{record.vehicle_make || (isThai ? "ไม่ได้บันทึก" : "Not recorded")}</span><span className="text-sm font-semibold text-slate-700">{insurer}</span><span className="break-all text-xs text-slate-600">{record.policy_number || (isThai ? "ไม่ได้บันทึก" : "Not recorded")}</span><span className="text-sm text-slate-600">{date(record.insurance_expiry_date, language)}<small className={`block ${days != null && days < 0 ? "font-semibold text-rose-600" : "text-slate-400"}`}>{timing}</small></span><span className="text-xs font-semibold text-slate-600">{isCompulsoryConfirmed(record) ? (isThai ? "ยืนยันแล้ว" : "Confirmed") : (isThai ? "ไม่ทราบ" : "Unknown")}</span><span className="text-xs font-bold text-slate-500">{record.verification_status === "verified" ? (isThai ? "ตรวจแล้ว" : "Verified") : (isThai ? "ต้องตรวจสอบ" : "Needs review")}</span><span className="flex gap-1.5"><button type="button" onClick={() => onOpenRecord(record)} className="btn-secondary min-h-8 px-2 text-[11px]"><Eye className="h-3.5 w-3.5" />{isThai ? "โปรไฟล์" : "View profile"}</button><button type="button" onClick={() => onReviewRecord(record)} className="btn-secondary min-h-8 px-2 text-[11px]"><PencilLine className="h-3.5 w-3.5" />{isThai ? "ตรวจประกัน" : "Review"}</button></span></div>;
  }) : <p className="p-5 text-sm text-slate-500">{isThai ? "ไม่มีรายการ" : "No assets in this section."}</p>}</div></section>;
}
