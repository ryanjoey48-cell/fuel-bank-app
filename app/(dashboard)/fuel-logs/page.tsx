"use client";

import {
  AlertTriangle,
  ArrowUpDown,
  Clock3,
  Download,
  Droplets,
  Gauge,
  Info,
  ReceiptText,
  TrendingUp,
  Wallet
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState } from "@/components/empty-state";
import { FuelStatementImporter } from "@/components/fuel-statement-importer";
import { Header } from "@/components/header";
import { StatCard } from "@/components/stat-card";
import {
  FUEL_TYPE_KEYS,
  getFuelTypeLabel,
  getPaymentMethodLabel,
  normalizeFuelTypeKey,
  normalizePaymentMethodKey,
  PAYMENT_METHOD_KEYS
} from "@/lib/localized-values";
import {
  deleteFuelLog,
  fetchDrivers,
  fetchFuelLogComparisonEntry,
  fetchFuelLogDuplicateMatches,
  fetchFuelLogReceiptSummary,
  fetchFuelLogsForExport,
  fetchFuelLogRecentDaySummaries,
  fetchFuelLogTodayRows,
  fetchFuelLogsPage,
  saveFuelLog,
  updateFuelLogReceiptCheck
} from "@/lib/data";
import { exportToCsv } from "@/lib/export";
import { applyRequiredValidationMessage, clearValidationMessage } from "@/lib/form-validation";
import { normalizeFuelLogLocation, shouldShowFuelLogLocationOption } from "@/lib/fuel-log-location";
import { useLanguage } from "@/lib/language-provider";
import { calculateFuelFields } from "@/lib/operations";
import { formatCurrency, formatDate, formatNumber, normalizeVehicleRegistration, today } from "@/lib/utils";
import type {
  Driver,
  FuelLogDaySummary,
  FuelLogEntrySource,
  FuelLogFilters,
  FuelLogReceiptSummary,
  FuelLogSortDirection,
  FuelLogSortKey,
  FuelLogWithDriver
} from "@/types/database";

const PAGE_SIZE = 25;
const EFFICIENCY_PREVIEW_PAGE_SIZE = 25;
const MISSING_MILEAGE_PREVIEW_LIMIT = 8;
const DEFAULT_FUEL_TYPE = "diesel";
const DEFAULT_PAYMENT_METHOD = "company_card";
const DEFAULT_ENTRY_SOURCE: FuelLogEntrySource = "line_message";
const FILTER_STORAGE_KEY = "fuel-bank:fuel-logs-filters";
const efficiencyThresholds = {
  minReliableKmDriven: 100,
  longTripKmDriven: 1200,
  longRefillGapDays: 4,
  lowKmPerLitre: 2.0,
  highKmPerLitre: 5.5
};

type FuelLogForm = {
  id: string;
  date: string;
  driver_id: string;
  vehicle_reg: string;
  mileage: string;
  litres: string;
  total_cost: string;
  price_per_litre: string;
  location: string;
  fuel_type: string;
  payment_method: string;
  entry_source: FuelLogEntrySource;
  notes: string;
};

const initialForm: FuelLogForm = {
  id: "",
  date: today(),
  driver_id: "",
  vehicle_reg: "",
  mileage: "",
  litres: "",
  total_cost: "",
  price_per_litre: "",
  location: "",
  fuel_type: DEFAULT_FUEL_TYPE,
  payment_method: DEFAULT_PAYMENT_METHOD,
  entry_source: DEFAULT_ENTRY_SOURCE,
  notes: ""
};

const initialFilters: FuelLogFilters = {
  fromDate: "",
  toDate: "",
  driverId: "",
  vehicleReg: "",
  location: "",
  paymentMethod: "",
  entrySource: "",
  receiptCheckedStatus: "",
  totalCostMin: "",
  totalCostMax: ""
};

type FuelDraft = {
  id?: string;
  date: string;
  driver_id?: string;
  driver?: string;
  vehicle_reg: string;
  odometer: number | null;
  litres: number;
  total_cost: number;
  price_per_litre: number | null;
  station: string;
  fuel_type: string | null;
  payment_method: string | null;
  entry_source: FuelLogEntrySource;
  notes: string | null;
};

type EfficiencyFilters = {
  driverId: string;
  vehicleReg: string;
  fromDate: string;
  toDate: string;
  specificDate: string;
  onlyWithMileage: boolean;
  receiptCheckedStatus: "" | "checked" | "not_checked";
};

type EfficiencyCalculationMode = "per_fill" | "trip_summary";

type EfficiencyStatus =
  | "missing_mileage"
  | "not_enough_data"
  | "check_mileage"
  | "normal"
  | "too_short_to_judge"
  | "needs_review"
  | "long_trip_check"
  | "check_receipt";

type EfficiencyNoteKey =
  | "missing_mileage"
  | "not_enough_data"
  | "check_mileage"
  | "too_short_to_judge"
  | "long_trip_check"
  | "km_l_high"
  | "km_l_low"
  | "receipt_not_checked_verify"
  | "reliable_calculation";

type EfficiencyRow = {
  log: FuelLogWithDriver;
  previousEntry: FuelLogWithDriver | null;
  previousFuelDate: string | null;
  daysSincePreviousFill: number | null;
  previousMileage: number | null;
  currentMileage: number | null;
  kmDriven: number | null;
  litres: number | null;
  kmPerLitre: number | null;
  status: EfficiencyStatus;
  resultReason: EfficiencyNoteKey;
  dataQualityNotes: EfficiencyNoteKey[];
  includedInKpiAverage: boolean;
};

type TripSummaryStatus =
  | "calculated"
  | "check_receipts"
  | "missing_mileage"
  | "check_mileage"
  | "not_enough_data";

type TripSummary = {
  logs: FuelLogWithDriver[];
  startMileage: number | null;
  endMileage: number | null;
  tripKm: number | null;
  totalLitres: number;
  totalFuelCost: number;
  tripKmPerLitre: number | null;
  averagePricePerLitre: number | null;
  fuelLogCount: number;
  receiptCheckedCount: number;
  receiptUncheckedCount: number;
  missingMileageCount: number;
  mileageRecordCount: number;
  status: TripSummaryStatus;
  reason: string;
};

const initialEfficiencyFilters: EfficiencyFilters = {
  driverId: "",
  vehicleReg: "",
  fromDate: "",
  toDate: "",
  specificDate: "",
  onlyWithMileage: true,
  receiptCheckedStatus: ""
};

function getReceiptCheckLabel(checked: boolean, language: "en" | "th") {
  if (language === "th") {
    return checked ? "ตรวจแล้ว" : "ยังไม่ตรวจ";
  }

  return checked ? "Checked" : "Not checked";
}

function getReceiptCheckBadgeClass(checked: boolean) {
  return checked
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : "border-slate-200 bg-slate-100 text-slate-600";
}

function normalizeEntrySource(value: unknown): FuelLogEntrySource {
  if (value === "direct_receipt") {
    return "direct_from_receipt";
  }

  return value === "direct_from_receipt" ||
    value === "statement_manual" ||
    value === "other" ||
    value === "line_message" ||
    value === "statement_import"
    ? value
    : DEFAULT_ENTRY_SOURCE;
}

function getEntrySourceBadgeClass(source: FuelLogEntrySource) {
  if (source === "direct_from_receipt") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]";
  }

  if (source === "other") {
    return "border-slate-200 bg-slate-100 text-slate-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]";
  }

  if (source === "statement_import" || source === "statement_manual") {
    return "border-violet-200 bg-violet-50 text-violet-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]";
  }

  return "border-sky-200 bg-sky-50 text-sky-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]";
}

function findDuplicates(logs: FuelLogWithDriver[], draft: FuelDraft, excludeId?: string) {
  if (!draft.date || !draft.driver_id) return [];
  return logs.filter((log) => {
    if (excludeId && String(log.id) === String(excludeId)) return false;
    if (log.date !== draft.date) return false;
    if (String(log.driver_id || "") !== String(draft.driver_id)) return false;
    if (Number(log.total_cost || 0) !== Number(draft.total_cost || 0)) return false;
    if (Number(log.litres || 0) !== Number(draft.litres || 0)) return false;
    return true;
  });
}

function getFuelLogDuplicateKey(log: Pick<FuelLogWithDriver, "date" | "driver_id" | "litres" | "total_cost">) {
  return [
    String(log.driver_id || ""),
    log.date,
    Number(log.litres || 0).toFixed(2),
    Number(log.total_cost || 0).toFixed(2)
  ].join("::");
}

function isMissingMileage(log: Pick<FuelLogWithDriver, "mileage">) {
  return log.mileage == null || Number(log.mileage) <= 0;
}

function getMileageValue(value: number | null | undefined) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : null;
}

function compareFuelLogsByMileageOrder(a: FuelLogWithDriver, b: FuelLogWithDriver) {
  const dateComparison = a.date.localeCompare(b.date);
  if (dateComparison !== 0) return dateComparison;

  const createdAtComparison = (a.created_at || "").localeCompare(b.created_at || "");
  if (createdAtComparison !== 0) return createdAtComparison;

  return String(a.id).localeCompare(String(b.id));
}

function getDaysBetweenFuelDates(previousDate: string | null | undefined, currentDate: string | null | undefined) {
  if (!previousDate || !currentDate) return null;
  const previous = new Date(`${previousDate}T00:00:00`);
  const current = new Date(`${currentDate}T00:00:00`);
  if (Number.isNaN(previous.getTime()) || Number.isNaN(current.getTime())) return null;
  return Math.max(0, Math.round((current.getTime() - previous.getTime()) / (24 * 60 * 60 * 1000)));
}

function getInclusiveDaysBetweenDates(startDate: string | null | undefined, endDate: string | null | undefined) {
  if (!startDate || !endDate) return null;
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return null;
  return Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)) + 1;
}

function buildEfficiencyRows(logs: FuelLogWithDriver[]) {
  const previousByVehicle = new Map<string, FuelLogWithDriver>();
  const rows = [...logs]
    .sort(compareFuelLogsByMileageOrder)
    .map((log) => {
      const vehicleKey = normalizeVehicleRegistration(log.vehicle_reg);
      const currentMileage = getMileageValue(log.mileage);
      const litres = Number.isFinite(Number(log.litres)) && Number(log.litres) > 0 ? Number(log.litres) : null;
      const previousEntry = vehicleKey ? previousByVehicle.get(vehicleKey) ?? null : null;
      const previousFuelDate = previousEntry?.date ?? null;
      const daysSincePreviousFill = getDaysBetweenFuelDates(previousFuelDate, log.date);
      const previousMileage = getMileageValue(previousEntry?.mileage);

      let kmDriven: number | null = null;
      let kmPerLitre: number | null = null;
      let status: EfficiencyStatus = "not_enough_data";
      let resultReason: EfficiencyNoteKey = "not_enough_data";
      const dataQualityNotes: EfficiencyNoteKey[] = [];

      if (currentMileage == null) {
        status = "missing_mileage";
        resultReason = "missing_mileage";
        dataQualityNotes.push("missing_mileage");
      } else if (previousMileage == null || litres == null) {
        status = "not_enough_data";
        resultReason = "not_enough_data";
        dataQualityNotes.push("not_enough_data");
      } else if (currentMileage <= previousMileage) {
        status = "check_mileage";
        resultReason = "check_mileage";
        dataQualityNotes.push("check_mileage");
      } else {
        kmDriven = currentMileage - previousMileage;
        kmPerLitre = litres > 0 ? kmDriven / litres : null;
        if (kmPerLitre == null || !Number.isFinite(kmPerLitre)) {
          status = "not_enough_data";
          resultReason = "not_enough_data";
          dataQualityNotes.push("not_enough_data");
        } else {
          const tooShortToJudge = kmDriven < efficiencyThresholds.minReliableKmDriven;
          const longTripCheck =
            kmDriven > efficiencyThresholds.longTripKmDriven ||
            (daysSincePreviousFill != null && daysSincePreviousFill >= efficiencyThresholds.longRefillGapDays);
          const lowerThanExpected = kmPerLitre < efficiencyThresholds.lowKmPerLitre;
          const higherThanExpected = kmPerLitre > efficiencyThresholds.highKmPerLitre;
          const receiptNotChecked = !log.receipt_checked;

          if (receiptNotChecked) dataQualityNotes.push("receipt_not_checked_verify");
          if (tooShortToJudge) dataQualityNotes.push("too_short_to_judge");
          if (longTripCheck) dataQualityNotes.push("long_trip_check");
          if (lowerThanExpected) dataQualityNotes.push("km_l_low");
          if (higherThanExpected) dataQualityNotes.push("km_l_high");

          if (receiptNotChecked) {
            status = "check_receipt";
            resultReason = "receipt_not_checked_verify";
          } else if (tooShortToJudge) {
            status = "too_short_to_judge";
            resultReason = "too_short_to_judge";
          } else if (longTripCheck) {
            status = "long_trip_check";
            resultReason = "long_trip_check";
          } else if (lowerThanExpected) {
            status = "needs_review";
            resultReason = "km_l_low";
          } else if (higherThanExpected) {
            status = "needs_review";
            resultReason = "km_l_high";
          } else {
            status = "normal";
            resultReason = "reliable_calculation";
            dataQualityNotes.push("reliable_calculation");
          }
        }
      }

      const includedInKpiAverage = status === "normal";

      if (!dataQualityNotes.length) {
        dataQualityNotes.push("reliable_calculation");
      }

      if (vehicleKey && currentMileage != null) {
        previousByVehicle.set(vehicleKey, log);
      }

      return {
        log,
        previousEntry,
        previousFuelDate,
        daysSincePreviousFill,
        previousMileage,
        currentMileage,
        kmDriven,
        litres,
        kmPerLitre,
        status,
        resultReason,
        dataQualityNotes,
        includedInKpiAverage
      } satisfies EfficiencyRow;
    });

  return rows.sort((a, b) => compareFuelLogsByMileageOrder(b.log, a.log));
}

function getNumericValue(value: number | null | undefined) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : 0;
}

function getStoredFilters(): FuelLogFilters {
  if (typeof window === "undefined") return initialFilters;
  try {
    const stored = window.sessionStorage.getItem(FILTER_STORAGE_KEY);
    const parsed = stored ? JSON.parse(stored) : {};
    return {
      ...initialFilters,
      fromDate: parsed.fromDate ?? "",
      toDate: parsed.toDate ?? "",
      driverId: parsed.driverId ?? "",
      vehicleReg: parsed.vehicleReg ?? "",
      location: normalizeFuelLogLocation(parsed.location ?? ""),
      paymentMethod: parsed.paymentMethod ?? "",
      entrySource: parsed.entrySource ? normalizeEntrySource(parsed.entrySource) : "",
      receiptCheckedStatus: parsed.receiptCheckedStatus ?? "",
      totalCostMin: parsed.totalCostMin ?? "",
      totalCostMax: parsed.totalCostMax ?? ""
    };
  } catch {
    return initialFilters;
  }
}
function SortButton({
  label,
  active,
  direction,
  onClick,
  align = "left"
}: {
  label: string;
  active: boolean;
  direction: FuelLogSortDirection;
  onClick: () => void;
  align?: "left" | "right";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 font-semibold ${align === "right" ? "justify-end" : "justify-start"}`}
    >
      <span>{label}</span>
      <ArrowUpDown className={`h-3.5 w-3.5 ${active ? "text-brand-700" : "text-slate-400"}`} />
      {active ? <span className="text-[11px] uppercase">{direction}</span> : null}
    </button>
  );
}

function getFuelTypeLabelWithFallback(t: ReturnType<typeof useLanguage>["t"], value: string | null | undefined) {
  return getFuelTypeLabel(t, normalizeFuelTypeKey(value) ?? DEFAULT_FUEL_TYPE);
}

function getPaymentMethodLabelWithFallback(t: ReturnType<typeof useLanguage>["t"], value: string | null | undefined) {
  return getPaymentMethodLabel(t, normalizePaymentMethodKey(value) ?? DEFAULT_PAYMENT_METHOD);
}

export default function FuelLogsPage() {
  const { language, t } = useLanguage();
  const copy = {
    dateRange: language === "th" ? "ช่วงวันที่" : "Date range",
    driver: language === "th" ? "คนขับ" : "Driver",
    vehicle: language === "th" ? "ทะเบียนรถ" : "Vehicle reg",
    payment: language === "th" ? "วิธีชำระเงิน" : "Payment method",
    totalCostRange: language === "th" ? "ช่วงยอดเงิน" : "Total cost range",
    min: language === "th" ? "ต่ำสุด" : "Min",
    max: language === "th" ? "สูงสุด" : "Max",
    clear: language === "th" ? "ล้างตัวกรอง" : "Clear filters",
    matches: language === "th" ? "รายการ" : "entries",
    duplicateTitle: language === "th" ? "พบรายการที่อาจซ้ำกัน" : "Possible duplicate found",
    duplicateHint:
      language === "th"
        ? "วันที่ ทะเบียนรถ ยอดเงิน และลิตรใกล้เคียงกับรายการที่มีอยู่แล้ว"
        : "This entry is close to an existing record on the same date and vehicle.",
    saveAnyway: language === "th" ? "บันทึกต่อ" : "Save anyway",
    cancel: language === "th" ? "ยกเลิก" : "Cancel",
    deleteConfirm: language === "th" ? "ลบรายการนี้ใช่หรือไม่" : "Delete this fuel entry?",
    filters: language === "th" ? "ตัวกรอง" : "Filters",
    all: language === "th" ? "ทั้งหมด" : "All",
    noResultsTitle: language === "th" ? "ไม่พบผลลัพธ์" : "No results",
    noResultsDescription:
      language === "th"
        ? "ไม่พบรายการที่ตรงกับตัวกรองนี้"
        : "No fuel entries match the current filters.",
    deleteError:
      language === "th" ? "ไม่สามารถลบบันทึกรายการน้ำมันได้" : "Unable to delete fuel log.",
    deleteSuccess:
      language === "th" ? "ลบบันทึกรายการน้ำมันเรียบร้อยแล้ว" : "Fuel entry deleted successfully.",
    autoFillLabel:
      language === "th"
        ? "กรอกจากคนขับอัตโนมัติ และยังแก้ไขได้"
        : "Auto-filled based on driver and can still be changed",
    noVehicleAssignedLabel:
      language === "th"
        ? "คนขับยังไม่มีรถที่ผูกไว้ โปรดเลือกเอง"
        : "No vehicle assigned. Please select one manually.",
    previousEntryHelper:
      language === "th"
        ? "ยังไม่มีรายการก่อนหน้านี้สำหรับรถคันนี้ในวันที่เลือกหรือน้อยกว่า"
        : "No earlier entry for this vehicle on or before this date.",
    entrySeparator: " - ",
    previousPage: language === "th" ? "ก่อนหน้า" : "Previous",
    nextPage: language === "th" ? "ถัดไป" : "Next",
    pageLabel: language === "th" ? "หน้า" : "Page",
    ofLabel: language === "th" ? "จาก" : "of",
    possibleDuplicate: language === "th" ? "อาจเป็นรายการซ้ำ" : "Possible duplicate entry",
    missingOdometer: language === "th" ? "ไม่มีเลขไมล์" : "Missing mileage"
  };

  const exportButtonLabel = language === "th" ? "กำลังส่งออก..." : "Exporting...";
  const exportSuccessMessage =
    language === "th"
      ? "ส่งออกรายการเติมน้ำมันสำเร็จ"
      : "Fuel logs exported successfully.";
  const exportErrorMessage =
    language === "th"
      ? "ไม่สามารถส่งออกรายการเติมน้ำมันได้"
      : "Unable to export fuel logs.";

  const statementEntryCopy = {
    keepDetails: "Keep details for next entry",
    statementModeHelper:
      "Statement mode: Save and add another keeps driver, vehicle, station and payment details."
  };

  const receiptCopy = {
    filterLabel: language === "th" ? "สถานะตรวจใบเสร็จ" : "Receipt check",
    checked: language === "th" ? "ตรวจแล้ว" : "Checked",
    notChecked: language === "th" ? "ยังไม่ตรวจ" : "Not checked",
    markChecked: language === "th" ? "ทำเครื่องหมายว่าตรวจแล้ว" : "Mark checked",
    markUnchecked: language === "th" ? "ยกเลิกเครื่องหมายตรวจแล้ว" : "Mark unchecked",
    updated: language === "th" ? "อัปเดตสถานะตรวจใบเสร็จแล้ว" : "Receipt check status updated.",
    error:
      language === "th" ? "ไม่สามารถอัปเดตสถานะตรวจใบเสร็จได้" : "Unable to update receipt check status.",
    totalCount: language === "th" ? "รายการเติมน้ำมันทั้งหมด" : "Total fuel logs",
    checkedCount: language === "th" ? "ตรวจแล้ว" : "Checked",
    notCheckedCount: language === "th" ? "ยังไม่ตรวจ" : "Not checked"
  };

  const fuelTypeOptions = FUEL_TYPE_KEYS.map((value) => ({ value, label: t.fuel.type[value] }));
  const paymentMethodOptions = PAYMENT_METHOD_KEYS.map((value) => ({
    value,
    label: t.payment.method[value]
  }));
  const sourceCopy = {
    label: language === "th" ? "แหล่งที่มา" : "Entry source",
    filterLabel: language === "th" ? "แหล่งที่มารายการ" : "Log source",
    all: language === "th" ? "ทุกแหล่งที่มา" : "All sources",
    quickSelect: language === "th" ? "เลือกเร็ว" : "Quick select",
    auditHint:
      language === "th"
        ? "รายการนี้เพิ่มจากใบเสร็จจริง เหมาะสำหรับตรวจสอบย้อนหลัง"
        : "Added from a physical receipt for audit/reconciliation.",
    options: {
      line_message: language === "th" ? "ข้อความ LINE" : "Line message",
      direct_from_receipt: language === "th" ? "จากใบเสร็จโดยตรง" : "Direct from receipt",
      statement_manual: "Direct from statement",
      statement_import: language === "th" ? "Statement import" : "Statement import",
      other: language === "th" ? "อื่นๆ" : "Other"
    } satisfies Record<FuelLogEntrySource, string>
  };
  const manualEntrySourceOptions = ([
    "line_message",
    "direct_from_receipt",
    "statement_manual"
  ] as FuelLogEntrySource[]).map((value) => ({
    value,
    label: sourceCopy.options[value]
  }));
  const filterEntrySourceOptions = ([
    "line_message",
    "direct_from_receipt",
    "statement_manual",
    "statement_import",
    "other"
  ] as FuelLogEntrySource[]).map((value) => ({
    value,
    label: sourceCopy.options[value]
  }));

  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [fuelLogs, setFuelLogs] = useState<FuelLogWithDriver[]>([]);
  const [efficiencySourceLogs, setEfficiencySourceLogs] = useState<FuelLogWithDriver[]>([]);
  const [todayLogs, setTodayLogs] = useState<FuelLogWithDriver[]>([]);
  const [last7DayRows, setLast7DayRows] = useState<FuelLogDaySummary[]>([]);
  const [form, setForm] = useState(initialForm);
  const [filters, setFilters] = useState<FuelLogFilters>(() => getStoredFilters());
  const [efficiencyFilters, setEfficiencyFilters] = useState<EfficiencyFilters>(initialEfficiencyFilters);
  const [efficiencyCalculationMode, setEfficiencyCalculationMode] = useState<EfficiencyCalculationMode>("per_fill");
  const [efficiencyPreviewCount, setEfficiencyPreviewCount] = useState(EFFICIENCY_PREVIEW_PAGE_SIZE);
  const [tripPreviewCount, setTripPreviewCount] = useState(EFFICIENCY_PREVIEW_PAGE_SIZE);
  const [missingMileageExpanded, setMissingMileageExpanded] = useState(false);
  const [sortKey, setSortKey] = useState<FuelLogSortKey>("date");
  const [sortDirection, setSortDirection] = useState<FuelLogSortDirection>("desc");
  const [currentPage, setCurrentPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [togglingReceiptId, setTogglingReceiptId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [submitMode, setSubmitMode] = useState<"save" | "addAnother">("save");
  const [keepDetailsForNextEntry, setKeepDetailsForNextEntry] = useState(true);
  const [lastEditedFuelField, setLastEditedFuelField] = useState<"litres" | "total_cost" | "price_per_litre">("total_cost");
  const [pendingDraft, setPendingDraft] = useState<FuelDraft | null>(null);
  const [duplicateMatches, setDuplicateMatches] = useState<FuelLogWithDriver[]>([]);
  const [highlightedFuelLogId, setHighlightedFuelLogId] = useState<string | null>(null);
  const [comparisonEntry, setComparisonEntry] = useState<FuelLogWithDriver | null>(null);
  const [receiptSummary, setReceiptSummary] = useState<FuelLogReceiptSummary>({
    total: 0,
    checked: 0,
    notChecked: 0
  });

  const isEditing = Boolean(form.id);
  const todayValue = today();
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const selectedDriver = useMemo(
    () => drivers.find((driver) => String(driver.id) === String(form.driver_id)),
    [drivers, form.driver_id]
  );

  const stats = {
    fuelSpendToday: todayLogs.reduce((sum, log) => sum + Number(log.total_cost || 0), 0),
    litresToday: todayLogs.reduce((sum, log) => sum + Number(log.litres || 0), 0),
    entriesToday: todayLogs.length
  };

  const vehicleOptions = useMemo(
    () =>
      Array.from(
        new Set(
          [
            ...fuelLogs.map((log) => log.vehicle_reg),
            ...efficiencySourceLogs.map((log) => log.vehicle_reg),
            ...drivers.map((driver) => driver.vehicle_reg)
          ]
            .filter(Boolean)
            .map((value) => value.trim())
        )
      ).sort(),
    [drivers, efficiencySourceLogs, fuelLogs]
  );

  const locationOptions = useMemo(() => {
    const locationsByKey = new Map<string, string>();
    [...fuelLogs, ...efficiencySourceLogs].forEach((log) => {
      const location = log.location?.trim();
      if (!location) return;
      if (!shouldShowFuelLogLocationOption(location)) return;
      const key = location.toLocaleLowerCase();
      if (!locationsByKey.has(key)) {
        locationsByKey.set(key, location);
      }
    });

    return Array.from(locationsByKey.values()).sort((a, b) =>
      a.localeCompare(b, language === "th" ? "th" : "en", { sensitivity: "base" })
    );
  }, [efficiencySourceLogs, fuelLogs, language]);
  const duplicateKeyCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const log of fuelLogs) {
      const key = getFuelLogDuplicateKey(log);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [fuelLogs]);

  const efficiencyRows = useMemo(() => buildEfficiencyRows(efficiencySourceLogs), [efficiencySourceLogs]);

  const scopedEfficiencyRows = useMemo(
    () =>
      efficiencyRows.filter((row) => {
        if (efficiencyFilters.driverId && String(row.log.driver_id || "") !== efficiencyFilters.driverId) return false;
        if (efficiencyFilters.vehicleReg && row.log.vehicle_reg !== efficiencyFilters.vehicleReg) return false;
        if (efficiencyFilters.specificDate && row.log.date !== efficiencyFilters.specificDate) return false;
        if (!efficiencyFilters.specificDate && efficiencyFilters.fromDate && row.log.date < efficiencyFilters.fromDate) return false;
        if (!efficiencyFilters.specificDate && efficiencyFilters.toDate && row.log.date > efficiencyFilters.toDate) return false;
        if (efficiencyFilters.receiptCheckedStatus === "checked" && !row.log.receipt_checked) return false;
        if (efficiencyFilters.receiptCheckedStatus === "not_checked" && row.log.receipt_checked) return false;
        return true;
      }),
    [efficiencyFilters, efficiencyRows]
  );

  const filteredEfficiencyRows = useMemo(
    () =>
      efficiencyFilters.onlyWithMileage
        ? scopedEfficiencyRows.filter((row) => row.currentMileage != null)
        : scopedEfficiencyRows,
    [efficiencyFilters.onlyWithMileage, scopedEfficiencyRows]
  );

  const efficiencySummary = useMemo(() => {
    const calculatedRows = filteredEfficiencyRows.filter((row) => row.kmPerLitre != null && row.kmDriven != null);
    const reliableRows = calculatedRows.filter((row) => row.includedInKpiAverage);
    const totalKm = calculatedRows.reduce((sum, row) => sum + Number(row.kmDriven || 0), 0);
    const totalLitres = calculatedRows.reduce((sum, row) => sum + Number(row.litres || 0), 0);
    const reliableKm = reliableRows.reduce((sum, row) => sum + Number(row.kmDriven || 0), 0);
    const reliableLitres = reliableRows.reduce((sum, row) => sum + Number(row.litres || 0), 0);
    const kmPerLitreValues = reliableRows.map((row) => Number(row.kmPerLitre)).filter(Number.isFinite);
    const reviewStatuses: EfficiencyStatus[] = [
      "needs_review",
      "long_trip_check",
      "too_short_to_judge",
      "check_mileage",
      "check_receipt"
    ];

    return {
      averageKmPerLitre: reliableLitres > 0 ? reliableKm / reliableLitres : null,
      bestKmPerLitre: kmPerLitreValues.length ? Math.max(...kmPerLitreValues) : null,
      worstKmPerLitre: kmPerLitreValues.length ? Math.min(...kmPerLitreValues) : null,
      totalKm,
      totalLitres,
      mileageCompliance:
        scopedEfficiencyRows.length > 0
          ? (scopedEfficiencyRows.filter((row) => row.currentMileage != null).length / scopedEfficiencyRows.length) * 100
          : null,
      reviewNeededEntries: filteredEfficiencyRows.filter((row) => reviewStatuses.includes(row.status)).length,
      missingMileageEntries: scopedEfficiencyRows.filter((row) => row.status === "missing_mileage").length
    };
  }, [filteredEfficiencyRows, scopedEfficiencyRows]);

  const missingMileageRows = useMemo(
    () => scopedEfficiencyRows.filter((row) => row.status === "missing_mileage"),
    [scopedEfficiencyRows]
  );

  const displayedEfficiencyRows = useMemo(
    () => filteredEfficiencyRows.slice(0, efficiencyPreviewCount),
    [efficiencyPreviewCount, filteredEfficiencyRows]
  );

  const missingMileagePreviewRows = useMemo(
    () => missingMileageRows.slice(0, MISSING_MILEAGE_PREVIEW_LIMIT),
    [missingMileageRows]
  );

  const tripSummaryLogs = useMemo(
    () =>
      [...efficiencySourceLogs]
        .filter((log) => {
          if (efficiencyFilters.driverId && String(log.driver_id || "") !== efficiencyFilters.driverId) return false;
          if (efficiencyFilters.vehicleReg && log.vehicle_reg !== efficiencyFilters.vehicleReg) return false;
          if (efficiencyFilters.fromDate && log.date < efficiencyFilters.fromDate) return false;
          if (efficiencyFilters.toDate && log.date > efficiencyFilters.toDate) return false;
          if (efficiencyFilters.receiptCheckedStatus === "checked" && !log.receipt_checked) return false;
          if (efficiencyFilters.receiptCheckedStatus === "not_checked" && log.receipt_checked) return false;
          return true;
        })
        .sort(compareFuelLogsByMileageOrder),
    [
      efficiencyFilters.driverId,
      efficiencyFilters.fromDate,
      efficiencyFilters.receiptCheckedStatus,
      efficiencyFilters.toDate,
      efficiencyFilters.vehicleReg,
      efficiencySourceLogs
    ]
  );

  const tripSummary = useMemo<TripSummary>(() => {
    const logs = tripSummaryLogs;
    const mileageLogs = logs.filter((log) => getMileageValue(log.mileage) != null);
    const startMileage = mileageLogs.length ? getMileageValue(mileageLogs[0].mileage) : null;
    const endMileage = mileageLogs.length ? getMileageValue(mileageLogs[mileageLogs.length - 1].mileage) : null;
    const totalLitres = logs.reduce((sum, log) => sum + getNumericValue(log.litres), 0);
    const totalFuelCost = logs.reduce((sum, log) => sum + getNumericValue(log.total_cost), 0);
    const receiptCheckedCount = logs.filter((log) => log.receipt_checked).length;
    const receiptUncheckedCount = logs.length - receiptCheckedCount;
    const missingMileageCount = logs.filter((log) => getMileageValue(log.mileage) == null).length;

    let status: TripSummaryStatus = "not_enough_data";
    let reason: string = t.fuelLogs.efficiency.tripNeedTwoMileageRecords;
    let tripKm: number | null = null;
    let tripKmPerLitre: number | null = null;

    if (mileageLogs.length < 2 || startMileage == null || endMileage == null) {
      status = "not_enough_data";
      reason = t.fuelLogs.efficiency.tripNeedTwoMileageRecords;
    } else if (endMileage <= startMileage) {
      status = "check_mileage";
      reason = t.fuelLogs.efficiency.tripEndMileageMustBeHigher;
    } else if (totalLitres <= 0) {
      status = "not_enough_data";
      reason = t.fuelLogs.efficiency.tripNotEnoughLitres;
    } else {
      tripKm = endMileage - startMileage;
      tripKmPerLitre = tripKm / totalLitres;
      if (receiptUncheckedCount > 0) {
        status = "check_receipts";
        reason = t.fuelLogs.efficiency.tripReceiptsTooltip;
      } else if (missingMileageCount > 0) {
        status = "missing_mileage";
        reason = t.fuelLogs.efficiency.tripMissingMileageWarning;
      } else {
        status = "calculated";
        reason = t.fuelLogs.efficiency.tripCalculatedTooltip;
      }
    }

    return {
      logs,
      startMileage,
      endMileage,
      tripKm,
      totalLitres,
      totalFuelCost,
      tripKmPerLitre,
      averagePricePerLitre: totalLitres > 0 ? totalFuelCost / totalLitres : null,
      fuelLogCount: logs.length,
      receiptCheckedCount,
      receiptUncheckedCount,
      missingMileageCount,
      mileageRecordCount: mileageLogs.length,
      status,
      reason
    };
  }, [t.fuelLogs.efficiency, tripSummaryLogs]);

  const displayedTripSummaryLogs = useMemo(
    () => tripSummary.logs.slice(0, tripPreviewCount),
    [tripPreviewCount, tripSummary.logs]
  );

  useEffect(() => {
    setEfficiencyPreviewCount(EFFICIENCY_PREVIEW_PAGE_SIZE);
    setTripPreviewCount(EFFICIENCY_PREVIEW_PAGE_SIZE);
  }, [efficiencyCalculationMode, efficiencyFilters]);

  useEffect(() => {
    setMissingMileageExpanded(missingMileageRows.length > 0 && missingMileageRows.length <= MISSING_MILEAGE_PREVIEW_LIMIT);
  }, [missingMileageRows.length]);

  const statusLabels: Record<EfficiencyStatus, string> = {
    missing_mileage: t.fuelLogs.efficiency.statusMissingMileage,
    not_enough_data: t.fuelLogs.efficiency.statusNotEnoughData,
    check_mileage: t.fuelLogs.efficiency.statusCheckMileage,
    normal: t.fuelLogs.efficiency.statusNormal,
    too_short_to_judge: t.fuelLogs.efficiency.statusTooShortToJudge,
    needs_review: t.fuelLogs.efficiency.statusNeedsReview,
    long_trip_check: t.fuelLogs.efficiency.statusLongTripCheck,
    check_receipt: t.fuelLogs.efficiency.statusCheckReceipt
  };

  const tripStatusLabels: Record<TripSummaryStatus, string> = {
    calculated: t.fuelLogs.efficiency.statusCalculated,
    check_receipts: t.fuelLogs.efficiency.statusCheckReceipts,
    missing_mileage: t.fuelLogs.efficiency.statusMissingMileage,
    check_mileage: t.fuelLogs.efficiency.statusCheckMileage,
    not_enough_data: t.fuelLogs.efficiency.statusNotEnoughData
  };

  const tripStatusTooltips: Record<TripSummaryStatus, string> = {
    calculated: t.fuelLogs.efficiency.tripStatusCalculatedTooltip,
    check_receipts: t.fuelLogs.efficiency.tripStatusCheckReceiptsTooltip,
    missing_mileage: t.fuelLogs.efficiency.tripStatusMissingMileageTooltip,
    check_mileage: t.fuelLogs.efficiency.tripStatusCheckMileageTooltip,
    not_enough_data: t.fuelLogs.efficiency.tripStatusNotEnoughDataTooltip
  };

  const tripPeriodDays = getInclusiveDaysBetweenDates(efficiencyFilters.fromDate, efficiencyFilters.toDate);
  const tripPeriodLabel =
    efficiencyFilters.fromDate || efficiencyFilters.toDate
      ? `${efficiencyFilters.fromDate ? formatDate(efficiencyFilters.fromDate, language) : "-"} -> ${
          efficiencyFilters.toDate ? formatDate(efficiencyFilters.toDate, language) : "-"
        }`
      : "-";
  const receiptsSummaryLabel = `${formatNumber(tripSummary.receiptCheckedCount, language)} ${t.fuelLogs.efficiency.of} ${formatNumber(
    tripSummary.fuelLogCount,
    language
  )} ${t.fuelLogs.efficiency.checkedLower}`;
  const missingMileageSummaryLabel =
    tripSummary.missingMileageCount === 0
      ? `0 ${t.fuelLogs.efficiency.missingLower}`
      : `${formatNumber(tripSummary.missingMileageCount, language)} ${t.fuelLogs.efficiency.missingLower}`;
  const mileageClarityMessage =
    tripSummary.mileageRecordCount < 2
      ? t.fuelLogs.efficiency.tripNeedTwoMileageRecordsDateRange
      : tripSummary.missingMileageCount > 0
        ? t.fuelLogs.efficiency.tripMissingMileageCanStillCalculate
        : t.fuelLogs.efficiency.tripAllKeyMileageAvailable;

  const noteLabels: Record<EfficiencyNoteKey, string> = {
    missing_mileage: t.fuelLogs.efficiency.noteMissingMileage,
    not_enough_data: t.fuelLogs.efficiency.noteNotEnoughData,
    check_mileage: t.fuelLogs.efficiency.noteCheckMileage,
    too_short_to_judge: t.fuelLogs.efficiency.noteTooShortToJudge,
    long_trip_check: t.fuelLogs.efficiency.noteLongTripCheck,
    km_l_high: t.fuelLogs.efficiency.noteKmLHigh,
    km_l_low: t.fuelLogs.efficiency.noteKmLLow,
    receipt_not_checked_verify: t.fuelLogs.efficiency.noteReceiptNotCheckedVerify,
    reliable_calculation: t.fuelLogs.efficiency.noteReliableCalculation
  };

  const getEfficiencyStatusClass = (status: EfficiencyStatus) => {
    if (status === "normal") return "border-emerald-200 bg-emerald-50 text-emerald-700";
    if (status === "needs_review" || status === "long_trip_check" || status === "too_short_to_judge" || status === "check_mileage" || status === "check_receipt") {
      return "border-amber-200 bg-amber-50 text-amber-800";
    }
    return "border-slate-200 bg-slate-100 text-slate-600";
  };

  const getTripStatusClass = (status: TripSummaryStatus) => {
    if (status === "calculated") return "border-emerald-200 bg-emerald-50 text-emerald-700";
    if (status === "check_receipts" || status === "missing_mileage" || status === "check_mileage") {
      return "border-amber-200 bg-amber-50 text-amber-800";
    }
    return "border-slate-200 bg-slate-100 text-slate-600";
  };

  const getEfficiencyNoteText = (row: EfficiencyRow) =>
    row.dataQualityNotes.map((note) => noteLabels[note]).filter(Boolean).join(" ");

  const getEfficiencyTooltipText = (row: EfficiencyRow) => {
    const calculated = row.kmPerLitre != null ? `${formatNumber(row.kmPerLitre, language, 2)} ${t.fuelLogs.efficiency.kmPerLitre}` : "-";
    const reason =
      row.resultReason === "too_short_to_judge" && row.kmDriven != null
        ? `${t.fuelLogs.efficiency.onlyDrivenPrefix} ${formatNumber(row.kmDriven, language, 0)} ${t.fuelLogs.efficiency.onlyDrivenSuffix}`
        : noteLabels[row.resultReason];
    return [
      `${t.fuelLogs.efficiency.calculated}: ${calculated}`,
      `${t.fuelLogs.efficiency.reason}: ${reason}`,
      `${t.fuelLogs.efficiency.receipt}: ${getReceiptCheckLabel(row.log.receipt_checked, language)}`,
      `${t.fuelLogs.efficiency.includedInAverage}: ${row.includedInKpiAverage ? t.fuelLogs.efficiency.yes : t.fuelLogs.efficiency.no}`
    ].join("\n");
  };

  const getFuelLogWarnings = (log: FuelLogWithDriver) => {
    const warnings: string[] = [];
    const duplicateKey = getFuelLogDuplicateKey(log);
    if ((duplicateKeyCounts.get(duplicateKey) ?? 0) > 1) warnings.push(copy.possibleDuplicate);
    if (isMissingMileage(log)) warnings.push(copy.missingOdometer);
    return warnings;
  };

  const loadDrivers = useCallback(async () => {
    try {
      const driverRows = await fetchDrivers();
      console.log("Fuel logs drivers load success", { drivers: driverRows.length });
      setDrivers(driverRows);
    } catch (err) {
      console.error("Fuel logs loadDrivers error:", err);
      setError(t.fuelLogs.unableToLoadFuelData);
    }
  }, [t.fuelLogs.unableToLoadFuelData]);

  const loadSummaryData = useCallback(async () => {
    const [todayRows, recentDayRows, receiptSummaryRows, efficiencyRowsForAnalysis] = await Promise.all([
      fetchFuelLogTodayRows(todayValue),
      fetchFuelLogRecentDaySummaries(7),
      fetchFuelLogReceiptSummary(filters),
      fetchFuelLogsForExport({})
    ]);
    setTodayLogs(todayRows);
    setLast7DayRows(recentDayRows);
    setReceiptSummary(receiptSummaryRows);
    setEfficiencySourceLogs(efficiencyRowsForAnalysis);
  }, [filters, todayValue]);

  const loadFuelLogPage = useCallback(
    async (page = currentPage) => {
      setLoading(true);
      setError(null);
      try {
      const [{ rows, totalCount: nextTotalCount }] = await Promise.all([
        fetchFuelLogsPage({
          page,
            pageSize: PAGE_SIZE,
            sortKey,
            sortDirection,
          filters
        }),
        loadSummaryData()
      ]);
      console.log("Fuel logs page load success", {
        rows: rows.length,
        totalCount: nextTotalCount,
        page
      });

      const nextTotalPages = Math.max(1, Math.ceil(nextTotalCount / PAGE_SIZE));
        if (page > nextTotalPages) {
          setCurrentPage(nextTotalPages);
          return;
        }

        setFuelLogs(rows);
        setTotalCount(nextTotalCount);
      } catch (err) {
        console.error("Fuel logs loadFuelLogPage error:", err);
        setError(t.fuelLogs.unableToLoadFuelData);
      } finally {
        setLoading(false);
      }
    },
    [currentPage, filters, loadSummaryData, sortDirection, sortKey, t.fuelLogs.unableToLoadFuelData]
  );

  useEffect(() => {
    void loadDrivers();
  }, [loadDrivers]);

  useEffect(() => {
    try {
      window.sessionStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(filters));
    } catch {
      // Filter persistence is helpful, but it should never block daily entry work.
    }
  }, [filters]);

  useEffect(() => {
    void loadFuelLogPage(currentPage);
  }, [currentPage, loadFuelLogPage]);

  useEffect(() => {
    const handleDataChanged = () => {
      void loadFuelLogPage(currentPage);
    };
    window.addEventListener("fuel-bank:data-changed", handleDataChanged);
    return () => window.removeEventListener("fuel-bank:data-changed", handleDataChanged);
  }, [currentPage, loadFuelLogPage]);

  useEffect(() => {
    const nextCalculated = calculateFuelFields({
      litres: form.litres,
      total_cost: form.total_cost,
      price_per_litre: form.price_per_litre,
      lastEditedField: lastEditedFuelField
    });

    setForm((current) =>
      current.total_cost === nextCalculated.total_cost &&
      current.price_per_litre === nextCalculated.price_per_litre
        ? current
        : {
            ...current,
            total_cost: nextCalculated.total_cost,
            price_per_litre: nextCalculated.price_per_litre
          }
    );
  }, [form.litres, form.price_per_litre, form.total_cost, lastEditedFuelField]);

  useEffect(() => {
    setPendingDraft(null);
    setDuplicateMatches([]);
  }, [form.date, form.vehicle_reg, form.litres, form.total_cost, form.id]);

  useEffect(() => {
    if (!form.vehicle_reg.trim() || !form.date) {
      setComparisonEntry(null);
      return;
    }

    let active = true;
    const loadComparisonEntry = async () => {
      try {
        const entry = await fetchFuelLogComparisonEntry({
          vehicleReg: form.vehicle_reg,
          date: form.date,
          excludeId: form.id || undefined
        });
        if (active) setComparisonEntry(entry);
      } catch (err) {
        console.error("Fuel logs comparison entry error:", err);
        if (active) setComparisonEntry(null);
      }
    };

    void loadComparisonEntry();
    return () => {
      active = false;
    };
  }, [form.date, form.id, form.vehicle_reg]);

  const resetForm = () => {
    setForm(initialForm);
    setLastEditedFuelField("total_cost");
    setError(null);
    setSuccessMessage(null);
    setSubmitMode("save");
    setPendingDraft(null);
    setDuplicateMatches([]);
    setHighlightedFuelLogId(null);
  };

  const populateForm = (log: FuelLogWithDriver) => {
    setForm({
      id: String(log.id),
      date: log.date,
      driver_id: log.driver_id != null ? String(log.driver_id) : "",
      vehicle_reg: log.vehicle_reg,
      mileage: log.mileage != null ? String(log.mileage) : "",
      litres: log.litres != null ? String(log.litres) : "",
      total_cost: log.total_cost != null ? String(log.total_cost) : "",
      price_per_litre: log.price_per_litre != null ? String(log.price_per_litre) : "",
      location: log.location || "",
      fuel_type: normalizeFuelTypeKey(log.fuel_type) ?? DEFAULT_FUEL_TYPE,
      payment_method: normalizePaymentMethodKey(log.payment_method) ?? DEFAULT_PAYMENT_METHOD,
      entry_source: normalizeEntrySource(log.entry_source),
      notes: log.notes || ""
    });
    setLastEditedFuelField("total_cost");
    setError(null);
    setSuccessMessage(null);
    setPendingDraft(null);
    setDuplicateMatches([]);
    setHighlightedFuelLogId(String(log.id));
  };

  const handleDriverChange = (driverId: string) => {
    const nextDriver = drivers.find((driver) => String(driver.id) === String(driverId));
    setForm((current) => ({
      ...current,
      driver_id: driverId,
      vehicle_reg: nextDriver?.vehicle_reg?.trim() ? nextDriver.vehicle_reg : current.vehicle_reg
    }));
  };

  const updateFuelField = (field: "litres" | "total_cost" | "price_per_litre", value: string) => {
    setLastEditedFuelField(field);
    setForm((current) => ({ ...current, [field]: value }));
  };

  const updateFilters = (updater: FuelLogFilters | ((current: FuelLogFilters) => FuelLogFilters)) => {
    setFilters((current) => (typeof updater === "function" ? updater(current) : updater));
    setCurrentPage(1);
  };

  const updateEfficiencyFilters = (
    updater: EfficiencyFilters | ((current: EfficiencyFilters) => EfficiencyFilters)
  ) => {
    setEfficiencyFilters((current) => (typeof updater === "function" ? updater(current) : updater));
  };

  const handleSortChange = (nextKey: FuelLogSortKey) => {
    setSortDirection((current) =>
      sortKey === nextKey ? (current === "desc" ? "asc" : "desc") : "desc"
    );
    setSortKey(nextKey);
    setCurrentPage(1);
  };

  const handleInvalid = (
    event: React.InvalidEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => applyRequiredValidationMessage(event, t.common.requiredField);

  const nextForm = useCallback(
    (mode: "save" | "addAnother") => {
      if (mode !== "addAnother") return { ...initialForm, date: form.date };
      if (!keepDetailsForNextEntry) return { ...initialForm };

      return {
        ...initialForm,
        date: form.date,
        driver_id: form.driver_id,
        vehicle_reg: form.vehicle_reg,
        location: form.location,
        fuel_type: form.fuel_type,
        payment_method: form.payment_method,
        entry_source: form.entry_source
      };
    },
    [
      form.date,
      form.driver_id,
      form.entry_source,
      form.fuel_type,
      form.location,
      form.payment_method,
      form.vehicle_reg,
      keepDetailsForNextEntry
    ]
  );

  const buildDraft = useCallback(
    (): FuelDraft => ({
      id: form.id || undefined,
      date: form.date,
      driver_id: form.driver_id || undefined,
      driver: selectedDriver?.name ?? "",
      vehicle_reg: form.vehicle_reg.trim(),
      odometer: form.mileage ? Number(form.mileage) : null,
      litres: Number(form.litres),
      total_cost: Number(form.total_cost),
      price_per_litre: form.price_per_litre ? Number(form.price_per_litre) : null,
      station: form.location.trim(),
      fuel_type: form.fuel_type || null,
      payment_method: form.payment_method || null,
      entry_source: normalizeEntrySource(form.entry_source),
      notes: form.notes.trim() || null
    }),
    [form, selectedDriver]
  );

  const refreshCurrentPage = useCallback(
    async (targetPage = currentPage) => {
      await loadFuelLogPage(targetPage);
    },
    [currentPage, loadFuelLogPage]
  );

  const saveDraft = useCallback(
    async (draft: FuelDraft, mode: "save" | "addAnother") => {
      await saveFuelLog(draft);
      setForm(nextForm(mode));
      setLastEditedFuelField("total_cost");
      setSubmitMode("save");
      setPendingDraft(null);
      setDuplicateMatches([]);
      setSuccessMessage(
        isEditing
          ? t.fuelLogs.updateSuccessMessage
          : mode === "addAnother"
            ? t.fuelLogs.saveAndAddAnotherSuccessMessage
            : t.fuelLogs.saveSuccessMessage
      );
      await refreshCurrentPage(mode === "addAnother" ? 1 : currentPage);
    },
    [
      currentPage,
      isEditing,
      nextForm,
      refreshCurrentPage,
      t.fuelLogs.saveAndAddAnotherSuccessMessage,
      t.fuelLogs.saveSuccessMessage,
      t.fuelLogs.updateSuccessMessage
    ]
  );

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setSuccessMessage(null);
    try {
      if (
        form.mileage &&
        comparisonEntry?.mileage != null &&
        Number(form.mileage) < Number(comparisonEntry.mileage) &&
        !window.confirm(
          language === "th"
            ? "เลขไมล์ต่ำกว่ารายการก่อนหน้า ต้องการบันทึกต่อหรือไม่"
            : "Mileage is lower than the previous reading. Save anyway?"
        )
      ) {
        setError(t.fuelLogs.mileageValidationError);
        return;
      }

      const draft = buildDraft();

      if (!isEditing) {
        const nearbyRows = await fetchFuelLogDuplicateMatches({
          date: draft.date,
          driverId: draft.driver_id,
          vehicleReg: draft.vehicle_reg
        });
        const matches = findDuplicates(nearbyRows, draft);
        if (matches.length > 0) {
          setPendingDraft(draft);
          setDuplicateMatches(matches);
          return;
        }
      }

      await saveDraft(draft, submitMode);
    } catch (err) {
      console.error("Fuel logs handleSubmit error:", err);
      setError(err instanceof Error && err.message ? err.message : t.fuelLogs.unableToSaveFuelLog);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm(copy.deleteConfirm)) return;
    try {
      setDeletingId(id);
      setError(null);
      setSuccessMessage(null);
      await deleteFuelLog(id);
      if (form.id === id) resetForm();

      const targetPage = fuelLogs.length === 1 && currentPage > 1 ? currentPage - 1 : currentPage;
      if (targetPage !== currentPage) {
        setCurrentPage(targetPage);
      } else {
        await refreshCurrentPage(targetPage);
      }

      setSuccessMessage(copy.deleteSuccess);
    } catch (err) {
      console.error("Fuel logs handleDelete error:", err);
      setError(err instanceof Error && err.message ? err.message : copy.deleteError);
    } finally {
      setDeletingId(null);
    }
  };

  const handleExportFuelLogs = async () => {
    setExporting(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const exportRows = await fetchFuelLogsForExport(filters);

      exportToCsv(
        exportRows.map((log) => ({
          [t.fuelLogs.date]: formatDate(log.date, language),
          [t.fuelLogs.driver]: log.driver,
          [t.fuelLogs.vehicleReg]: log.vehicle_reg,
          [t.fuelLogs.mileage]: log.mileage ?? "",
          [t.fuelLogs.litres]: log.litres,
          [t.fuelLogs.totalCost]: log.total_cost,
          [t.fuelLogs.pricePerLitre]: log.price_per_litre ?? "",
          [t.fuelLogs.location]: log.location,
          [t.fuelLogs.fuelType]: getFuelTypeLabelWithFallback(t, log.fuel_type),
          [t.fuelLogs.paymentMethod]: getPaymentMethodLabelWithFallback(t, log.payment_method),
          [sourceCopy.label]: sourceCopy.options[normalizeEntrySource(log.entry_source)],
          entry_source: normalizeEntrySource(log.entry_source),
          [receiptCopy.filterLabel]: getReceiptCheckLabel(log.receipt_checked, language),
          receipt_checked: log.receipt_checked ? "true" : "false",
          receipt_checked_at: log.receipt_checked_at ?? "",
          [t.fuelLogs.notes]: log.notes ?? ""
        })),
        "fuel-logs-report"
      );

      setSuccessMessage(
        `${exportSuccessMessage} (${formatNumber(exportRows.length, language)} ${copy.matches})`
      );
    } catch (err) {
      console.error("Fuel logs handleExportFuelLogs error:", err);
      setError(err instanceof Error && err.message ? err.message : exportErrorMessage);
    } finally {
      setExporting(false);
    }
  };

  const handleExportEfficiencyReport = () => {
    if (efficiencyCalculationMode === "trip_summary") {
      const selectedDriverLabel =
        drivers.find((driver) => String(driver.id) === String(efficiencyFilters.driverId))?.name ||
        t.fuelLogs.efficiency.allDrivers;

      exportToCsv(
        [
          {
            [t.fuelLogs.efficiency.reportSection]: t.fuelLogs.efficiency.tripSummaryReport,
            [t.fuelLogs.efficiency.field]: "",
            [t.fuelLogs.efficiency.value]: ""
          },
          {
            [t.fuelLogs.efficiency.reportSection]: t.fuelLogs.efficiency.summary,
            [t.fuelLogs.efficiency.field]: t.fuelLogs.efficiency.driver,
            [t.fuelLogs.efficiency.value]: selectedDriverLabel
          },
          {
            [t.fuelLogs.efficiency.reportSection]: t.fuelLogs.efficiency.summary,
            [t.fuelLogs.efficiency.field]: t.fuelLogs.efficiency.vehicleReg,
            [t.fuelLogs.efficiency.value]: efficiencyFilters.vehicleReg || t.fuelLogs.efficiency.allVehicles
          },
          {
            [t.fuelLogs.efficiency.reportSection]: t.fuelLogs.efficiency.summary,
            [t.fuelLogs.efficiency.field]: t.fuelLogs.efficiency.tripPeriod,
            [t.fuelLogs.efficiency.value]: tripPeriodLabel
          },
          {
            [t.fuelLogs.efficiency.reportSection]: t.fuelLogs.efficiency.summary,
            [t.fuelLogs.efficiency.field]: t.fuelLogs.efficiency.startMileage,
            [t.fuelLogs.efficiency.value]: tripSummary.startMileage ?? ""
          },
          {
            [t.fuelLogs.efficiency.reportSection]: t.fuelLogs.efficiency.summary,
            [t.fuelLogs.efficiency.field]: t.fuelLogs.efficiency.endMileage,
            [t.fuelLogs.efficiency.value]: tripSummary.endMileage ?? ""
          },
          {
            [t.fuelLogs.efficiency.reportSection]: t.fuelLogs.efficiency.summary,
            [t.fuelLogs.efficiency.field]: t.fuelLogs.efficiency.tripKm,
            [t.fuelLogs.efficiency.value]: tripSummary.tripKm != null ? Number(tripSummary.tripKm.toFixed(2)) : ""
          },
          {
            [t.fuelLogs.efficiency.reportSection]: t.fuelLogs.efficiency.summary,
            [t.fuelLogs.efficiency.field]: t.fuelLogs.efficiency.totalLitres,
            [t.fuelLogs.efficiency.value]: Number(tripSummary.totalLitres.toFixed(2))
          },
          {
            [t.fuelLogs.efficiency.reportSection]: t.fuelLogs.efficiency.summary,
            [t.fuelLogs.efficiency.field]: t.fuelLogs.efficiency.tripKmPerLitre,
            [t.fuelLogs.efficiency.value]: tripSummary.tripKmPerLitre != null ? Number(tripSummary.tripKmPerLitre.toFixed(2)) : ""
          },
          {
            [t.fuelLogs.efficiency.reportSection]: t.fuelLogs.efficiency.summary,
            [t.fuelLogs.efficiency.field]: t.fuelLogs.efficiency.totalFuelCost,
            [t.fuelLogs.efficiency.value]: Number(tripSummary.totalFuelCost.toFixed(2))
          },
          {
            [t.fuelLogs.efficiency.reportSection]: t.fuelLogs.efficiency.summary,
            [t.fuelLogs.efficiency.field]: t.fuelLogs.efficiency.averagePricePerLitre,
            [t.fuelLogs.efficiency.value]:
              tripSummary.averagePricePerLitre != null ? Number(tripSummary.averagePricePerLitre.toFixed(2)) : ""
          },
          {
            [t.fuelLogs.efficiency.reportSection]: t.fuelLogs.efficiency.summary,
            [t.fuelLogs.efficiency.field]: t.fuelLogs.efficiency.fuelLogCount,
            [t.fuelLogs.efficiency.value]: tripSummary.fuelLogCount
          },
          {
            [t.fuelLogs.efficiency.reportSection]: t.fuelLogs.efficiency.summary,
            [t.fuelLogs.efficiency.field]: t.fuelLogs.efficiency.receiptsChecked,
            [t.fuelLogs.efficiency.value]: receiptsSummaryLabel
          },
          {
            [t.fuelLogs.efficiency.reportSection]: t.fuelLogs.efficiency.summary,
            [t.fuelLogs.efficiency.field]: t.fuelLogs.efficiency.missingMileageCount,
            [t.fuelLogs.efficiency.value]: tripSummary.missingMileageCount
          },
          {
            [t.fuelLogs.efficiency.reportSection]: t.fuelLogs.efficiency.summary,
            [t.fuelLogs.efficiency.field]: t.fuelLogs.efficiency.result,
            [t.fuelLogs.efficiency.value]: tripStatusLabels[tripSummary.status]
          },
          ...tripSummary.logs.map((log) => ({
            [t.fuelLogs.efficiency.reportSection]: t.fuelLogs.efficiency.includedFuelLogs,
            [t.fuelLogs.efficiency.date]: formatDate(log.date, language),
            [t.fuelLogs.efficiency.driver]: log.driver || "",
            [t.fuelLogs.efficiency.vehicleReg]: log.vehicle_reg || "",
            [t.fuelLogs.efficiency.mileage]: log.mileage ?? "",
            [t.fuelLogs.efficiency.litres]: log.litres ?? "",
            [t.fuelLogs.efficiency.totalCost]: log.total_cost ?? "",
            [t.fuelLogs.efficiency.pricePerLitre]: log.price_per_litre ?? "",
            [t.fuelLogs.efficiency.receiptCheck]: getReceiptCheckLabel(log.receipt_checked, language),
            [t.fuelLogs.efficiency.entrySource]: sourceCopy.options[normalizeEntrySource(log.entry_source)],
            [t.fuelLogs.efficiency.notes]: log.notes ?? ""
          }))
        ],
        "fuel-efficiency-trip-summary"
      );
      return;
    }

    exportToCsv(
      filteredEfficiencyRows.map((row) => ({
        [t.fuelLogs.efficiency.date]: formatDate(row.log.date, language),
        [t.fuelLogs.efficiency.driver]: row.log.driver || "",
        [t.fuelLogs.efficiency.vehicleReg]: row.log.vehicle_reg || "",
        [t.fuelLogs.efficiency.previousFuelDate]: row.previousFuelDate ? formatDate(row.previousFuelDate, language) : "",
        [t.fuelLogs.efficiency.daysSincePreviousFill]: row.daysSincePreviousFill ?? "",
        [t.fuelLogs.efficiency.previousMileage]: row.previousMileage ?? "",
        [t.fuelLogs.efficiency.currentMileage]: row.currentMileage ?? "",
        [t.fuelLogs.efficiency.kmDriven]: row.kmDriven != null ? Number(row.kmDriven.toFixed(2)) : "",
        [t.fuelLogs.efficiency.litres]: row.litres ?? "",
        [t.fuelLogs.efficiency.kmPerLitre]: row.kmPerLitre != null ? Number(row.kmPerLitre.toFixed(2)) : "",
        [t.fuelLogs.efficiency.receiptCheck]: getReceiptCheckLabel(row.log.receipt_checked, language),
        [t.fuelLogs.efficiency.result]: statusLabels[row.status],
        [t.fuelLogs.efficiency.tooltipReason]: noteLabels[row.resultReason],
        [t.fuelLogs.efficiency.includedInKpiAverage]: row.includedInKpiAverage
          ? t.fuelLogs.efficiency.yes
          : t.fuelLogs.efficiency.no
      })),
      "fuel-efficiency-report"
    );
  };

  const avgPriceToday = stats.litresToday > 0 ? stats.fuelSpendToday / stats.litresToday : 0;

  const handleReceiptToggle = useCallback(
    async (log: FuelLogWithDriver, checked: boolean) => {
      const logId = String(log.id);
      const optimisticTimestamp = checked ? new Date().toISOString() : null;

      setTogglingReceiptId(logId);
      setError(null);
      setSuccessMessage(null);

      setFuelLogs((current) =>
        current.map((row) =>
          String(row.id) === logId
            ? {
                ...row,
                receipt_checked: checked,
                receipt_checked_at: optimisticTimestamp
              }
            : row
        )
      );

      try {
        const updated = await updateFuelLogReceiptCheck(logId, checked);
        setFuelLogs((current) =>
          current.map((row) =>
            String(row.id) === logId
              ? {
                  ...row,
                  receipt_checked: updated.receipt_checked,
                  receipt_checked_at: updated.receipt_checked_at
                }
              : row
          )
        );
        setSuccessMessage(receiptCopy.updated);
        await refreshCurrentPage(currentPage);
      } catch (err) {
        console.error("Fuel logs handleReceiptToggle error:", err);
        setFuelLogs((current) =>
          current.map((row) =>
            String(row.id) === logId
              ? {
                  ...row,
                  receipt_checked: log.receipt_checked,
                  receipt_checked_at: log.receipt_checked_at
                }
              : row
          )
        );
        await refreshCurrentPage(currentPage);
        setError(err instanceof Error && err.message ? err.message : receiptCopy.error);
      } finally {
        setTogglingReceiptId(null);
      }
    },
    [currentPage, receiptCopy.error, receiptCopy.updated, refreshCurrentPage]
  );

  return (
    <>
      <div className="mb-6 hidden md:block">
        <Header title={t.fuelLogs.title} description={t.fuelLogs.description} />
      </div>

      <section className="mb-4.5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label={t.fuelLogs.fuelSpendToday} value={formatCurrency(stats.fuelSpendToday, language)} helper={t.fuelLogs.fuelSpendTodayHelper} icon={<Wallet className="h-5 w-5" />} />
        <StatCard label={t.fuelLogs.litresToday} value={formatNumber(stats.litresToday, language, 2)} helper={t.fuelLogs.litresTodayHelper} icon={<Droplets className="h-5 w-5" />} />
        <StatCard label={t.fuelLogs.entriesToday} value={formatNumber(stats.entriesToday, language)} helper={t.fuelLogs.entriesTodayHelper} icon={<ReceiptText className="h-5 w-5" />} />
        <StatCard label={t.fuelLogs.averagePricePerLitreToday} value={stats.litresToday > 0 ? formatCurrency(avgPriceToday, language) : "-"} helper={stats.litresToday > 0 ? t.fuelLogs.averagePricePerLitreTodayHelper : t.fuelLogs.noTodayFuelDescription} icon={<TrendingUp className="h-5 w-5" />} />
      </section>

      <section className="surface-card mb-4.5 overflow-hidden p-4 sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-brand-100 bg-brand-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-brand-700">
              <Gauge className="h-3.5 w-3.5" />
              {t.fuelLogs.efficiency.badge}
            </div>
            <h3 className="mt-3 text-xl font-semibold text-slate-950">{t.fuelLogs.efficiency.title}</h3>
            <p className="mt-1 max-w-3xl text-sm text-slate-500">{t.fuelLogs.efficiency.subtitle}</p>
          </div>
          <button
            type="button"
            onClick={handleExportEfficiencyReport}
            disabled={efficiencyCalculationMode === "per_fill" ? !filteredEfficiencyRows.length : !tripSummary.logs.length}
            className="btn-secondary w-full gap-2 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
          >
            <Download className="h-4 w-4" />
            {t.fuelLogs.efficiency.exportReport}
          </button>
        </div>

        <div className="mt-5 rounded-[1.25rem] border border-brand-100 bg-brand-50/50 p-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-brand-700">
            {t.fuelLogs.efficiency.calculationMode}
          </p>
          <div className="grid grid-cols-2 gap-2 rounded-2xl bg-white p-1 shadow-[inset_0_0_0_1px_rgba(124,58,237,0.08)] sm:inline-grid sm:min-w-[320px]">
            {([
              ["per_fill", t.fuelLogs.efficiency.perFill],
              ["trip_summary", t.fuelLogs.efficiency.tripSummary]
            ] as [EfficiencyCalculationMode, string][]).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                onClick={() => setEfficiencyCalculationMode(mode)}
                className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
                  efficiencyCalculationMode === mode
                    ? "bg-brand-700 text-white shadow-sm"
                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-950"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-5 rounded-[1.5rem] border border-slate-200/80 bg-white/95 p-4 shadow-[0_10px_30px_rgba(15,23,42,0.04)] sm:p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-slate-900">{t.fuelLogs.efficiency.filters}</p>
            <button type="button" onClick={() => setEfficiencyFilters(initialEfficiencyFilters)} className="text-sm font-medium text-slate-500 hover:text-slate-900">{t.fuelLogs.efficiency.clearFilters}</button>
          </div>
          <div className="grid gap-3 md:grid-cols-12">
            <div className="md:col-span-3">
              <label className="form-label">{t.fuelLogs.efficiency.driver}</label>
              <select value={efficiencyFilters.driverId} onChange={(event) => updateEfficiencyFilters((current) => ({ ...current, driverId: event.target.value }))} className="form-input bg-white">
                <option value="">{t.fuelLogs.efficiency.allDrivers}</option>
                {drivers.map((driver) => <option key={driver.id} value={String(driver.id)}>{driver.name}</option>)}
              </select>
            </div>
            <div className="md:col-span-3">
              <label className="form-label">{t.fuelLogs.efficiency.vehicleReg}</label>
              <select value={efficiencyFilters.vehicleReg} onChange={(event) => updateEfficiencyFilters((current) => ({ ...current, vehicleReg: event.target.value }))} className="form-input bg-white">
                <option value="">{t.fuelLogs.efficiency.allVehicles}</option>
                {vehicleOptions.map((vehicleReg) => <option key={vehicleReg} value={vehicleReg}>{vehicleReg}</option>)}
              </select>
            </div>
            <div className="md:col-span-3">
              <label className="form-label">{t.fuelLogs.efficiency.dateRange}</label>
              <div className="grid grid-cols-2 gap-2">
                <input type="date" value={efficiencyFilters.fromDate} onChange={(event) => updateEfficiencyFilters((current) => ({ ...current, fromDate: event.target.value, specificDate: "" }))} className="form-input bg-white" />
                <input type="date" value={efficiencyFilters.toDate} onChange={(event) => updateEfficiencyFilters((current) => ({ ...current, toDate: event.target.value, specificDate: "" }))} className="form-input bg-white" />
              </div>
            </div>
            {efficiencyCalculationMode === "per_fill" ? (
              <div className="md:col-span-3">
                <label className="form-label">{t.fuelLogs.efficiency.specificDate}</label>
                <input type="date" value={efficiencyFilters.specificDate} onChange={(event) => updateEfficiencyFilters((current) => ({ ...current, specificDate: event.target.value, fromDate: event.target.value ? "" : current.fromDate, toDate: event.target.value ? "" : current.toDate }))} className="form-input bg-white" />
              </div>
            ) : null}
            <div className="md:col-span-3">
              <label className="form-label">{t.fuelLogs.efficiency.receiptCheck}</label>
              <select value={efficiencyFilters.receiptCheckedStatus} onChange={(event) => updateEfficiencyFilters((current) => ({ ...current, receiptCheckedStatus: event.target.value as EfficiencyFilters["receiptCheckedStatus"] }))} className="form-input bg-white">
                <option value="">{copy.all}</option>
                <option value="checked">{t.fuelLogs.efficiency.receiptChecked}</option>
                <option value="not_checked">{t.fuelLogs.efficiency.receiptNotChecked}</option>
              </select>
            </div>
            {efficiencyCalculationMode === "per_fill" ? (
              <label className="md:col-span-9 flex min-h-[44px] items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-700">
                <input type="checkbox" checked={efficiencyFilters.onlyWithMileage} onChange={(event) => updateEfficiencyFilters((current) => ({ ...current, onlyWithMileage: event.target.checked }))} className="h-4 w-4 accent-brand-700" />
                {t.fuelLogs.efficiency.onlyWithMileage}
              </label>
            ) : null}
          </div>
        </div>

        {efficiencyCalculationMode === "per_fill" ? (
          <>
        <div className="mt-5 flex items-start gap-3 rounded-2xl border border-sky-100 bg-sky-50/70 px-4 py-3 text-sm text-slate-700">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-sky-700" />
          <div>
            <p className="font-semibold text-slate-900">{t.fuelLogs.efficiency.howCalculatedTitle}</p>
            <p className="mt-1">{t.fuelLogs.efficiency.howCalculatedDescription}</p>
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-8">
          <div className="subtle-panel p-4"><p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{t.fuelLogs.efficiency.averageKmPerLitre}</p><p className="mt-2 text-xl font-bold text-slate-950">{efficiencySummary.averageKmPerLitre != null ? formatNumber(efficiencySummary.averageKmPerLitre, language, 2) : "-"}</p></div>
          <div className="subtle-panel p-4"><p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{t.fuelLogs.efficiency.bestKmPerLitre}</p><p className="mt-2 text-xl font-bold text-emerald-700">{efficiencySummary.bestKmPerLitre != null ? formatNumber(efficiencySummary.bestKmPerLitre, language, 2) : "-"}</p></div>
          <div className="subtle-panel p-4"><p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{t.fuelLogs.efficiency.worstKmPerLitre}</p><p className="mt-2 text-xl font-bold text-amber-700">{efficiencySummary.worstKmPerLitre != null ? formatNumber(efficiencySummary.worstKmPerLitre, language, 2) : "-"}</p></div>
          <div className="subtle-panel p-4"><p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{t.fuelLogs.efficiency.totalKmCalculated}</p><p className="mt-2 text-xl font-bold text-slate-950">{formatNumber(efficiencySummary.totalKm, language, 0)}</p></div>
          <div className="subtle-panel p-4"><p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{t.fuelLogs.efficiency.totalLitresUsed}</p><p className="mt-2 text-xl font-bold text-slate-950">{formatNumber(efficiencySummary.totalLitres, language, 2)}</p></div>
          <div className="subtle-panel p-4"><p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{t.fuelLogs.efficiency.missingMileageEntries}</p><p className="mt-2 text-xl font-bold text-rose-700">{formatNumber(efficiencySummary.missingMileageEntries, language)}</p></div>
          <div className="subtle-panel p-4"><p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{t.fuelLogs.efficiency.mileageCompliance}</p><p className="mt-2 text-xl font-bold text-brand-700">{efficiencySummary.mileageCompliance != null ? `${formatNumber(efficiencySummary.mileageCompliance, language, 0)}%` : "—"}</p><p className="mt-1 text-xs font-medium text-slate-500">{t.fuelLogs.efficiency.mileageProvided}</p></div>
          <div className="subtle-panel p-4"><p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{t.fuelLogs.efficiency.reviewNeeded}</p><p className="mt-2 text-xl font-bold text-amber-700">{formatNumber(efficiencySummary.reviewNeededEntries, language)}</p></div>
        </div>

        {missingMileageRows.length > 0 ? (
          <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50/90 p-3 text-sm text-amber-900 shadow-[0_8px_22px_rgba(180,83,9,0.06)] sm:p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <p className="font-semibold text-amber-950">
                    {formatNumber(missingMileageRows.length, language)} {t.fuelLogs.efficiency.missingMileageSummarySuffix}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-amber-800">{t.fuelLogs.efficiency.missingMileageWarning}</p>
                </div>
              </div>
              <button type="button" onClick={() => setMissingMileageExpanded((current) => !current)} className="btn-secondary min-h-[38px] border-amber-200 px-3 py-2 text-xs text-amber-900 hover:border-amber-300 hover:text-amber-950">
                {missingMileageExpanded ? t.fuelLogs.efficiency.hideMissingEntries : t.fuelLogs.efficiency.viewMissingEntries}
              </button>
            </div>
            {missingMileageExpanded ? (
            <div className="mt-3 rounded-2xl border border-amber-200 bg-white/85 p-3">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-800">{t.fuelLogs.efficiency.missingMileageEntries}</p>
              <div className="mt-3 space-y-2 md:hidden">
                {missingMileagePreviewRows.map((row) => (
                  <div key={row.log.id} className="rounded-xl border border-amber-100 bg-white px-3 py-2">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-slate-900">{row.log.driver || "-"}</p>
                        <p className="mt-0.5 text-xs text-slate-500">{formatDate(row.log.date, language)} · {row.log.vehicle_reg || "-"}</p>
                      </div>
                      <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800">{t.fuelLogs.efficiency.needsMileage}</span>
                    </div>
                    <p className="mt-2 text-xs text-slate-500">{formatNumber(Number(row.log.litres || 0), language, 2)} {t.fuelLogs.efficiency.litres} · {formatCurrency(Number(row.log.total_cost || 0), language)}</p>
                  </div>
                ))}
              </div>
              <div className="mt-3 hidden overflow-x-auto md:block">
                <table className="min-w-[760px] w-full text-xs">
                  <thead className="text-slate-500">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold">{t.fuelLogs.efficiency.date}</th>
                      <th className="px-3 py-2 text-left font-semibold">{t.fuelLogs.efficiency.driver}</th>
                      <th className="px-3 py-2 text-left font-semibold">{t.fuelLogs.efficiency.vehicleReg}</th>
                      <th className="px-3 py-2 text-right font-semibold">{t.fuelLogs.efficiency.litres}</th>
                      <th className="px-3 py-2 text-right font-semibold">{t.fuelLogs.totalCost}</th>
                      <th className="px-3 py-2 text-left font-semibold">{t.fuelLogs.efficiency.status}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {missingMileagePreviewRows.map((row) => (
                      <tr key={row.log.id} className="border-t border-amber-100 text-slate-700">
                        <td className="px-3 py-2 font-medium">{formatDate(row.log.date, language)}</td>
                        <td className="px-3 py-2">{row.log.driver || "-"}</td>
                        <td className="px-3 py-2">{row.log.vehicle_reg || "-"}</td>
                        <td className="px-3 py-2 text-right">{formatNumber(Number(row.log.litres || 0), language, 2)}</td>
                        <td className="px-3 py-2 text-right">{formatCurrency(Number(row.log.total_cost || 0), language)}</td>
                        <td className="px-3 py-2"><span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800">{t.fuelLogs.efficiency.needsMileage}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {missingMileageRows.length > 8 ? (
                <p className="mt-3 text-xs text-amber-800">{t.fuelLogs.efficiency.missingMileageListLimit}</p>
              ) : null}
            </div>
            ) : null}
          </div>
        ) : null}

        <div className="mt-5">
          {loading ? (
            <p className="text-sm text-slate-500">{t.fuelLogs.loadingFuelLogs}</p>
          ) : filteredEfficiencyRows.length === 0 ? (
            <EmptyState title={t.fuelLogs.efficiency.noResultsTitle} description={t.fuelLogs.efficiency.noResultsDescription} />
          ) : (
            <>
              <div className="space-y-3 md:hidden">
                {displayedEfficiencyRows.map((row) => (
                  <div key={row.log.id} className="subtle-panel p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{formatDate(row.log.date, language)}</p>
                        <p className="mt-2 text-sm font-semibold text-slate-900">{row.log.driver || "-"}</p>
                        <p className="mt-1 text-sm text-slate-500">{row.log.vehicle_reg || "-"}</p>
                      </div>
                      <button type="button" title={getEfficiencyTooltipText(row)} className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold ${getEfficiencyStatusClass(row.status)}`}>{statusLabels[row.status]}</button>
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                      <div><p className="text-xs text-slate-500">{t.fuelLogs.efficiency.previousMileage}</p><p className="font-semibold text-slate-900">{row.previousMileage ?? "-"}</p></div>
                      <div><p className="text-xs text-slate-500">{t.fuelLogs.efficiency.currentMileage}</p><p className="font-semibold text-slate-900">{row.currentMileage ?? "-"}</p></div>
                      <div><p className="text-xs text-slate-500">{t.fuelLogs.efficiency.kmDriven}</p><p className="font-semibold text-slate-900">{row.kmDriven != null ? formatNumber(row.kmDriven, language, 0) : "-"}</p></div>
                      <div><p className="text-xs text-slate-500">{t.fuelLogs.efficiency.kmPerLitre}</p><p className="font-semibold text-slate-900">{row.kmPerLitre != null ? formatNumber(row.kmPerLitre, language, 2) : "-"}</p></div>
                      <div><p className="text-xs text-slate-500">{t.fuelLogs.efficiency.daysSincePreviousFill}</p><p className="font-semibold text-slate-900">{row.daysSincePreviousFill ?? "-"}</p></div>
                      <div><p className="text-xs text-slate-500">{t.fuelLogs.efficiency.receiptCheck}</p><span className={`mt-1 inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold ${getReceiptCheckBadgeClass(row.log.receipt_checked)}`}>{getReceiptCheckLabel(row.log.receipt_checked, language)}</span></div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="hidden md:block">
                <div className="table-shell rounded-2xl">
                  <div className="table-scroll overflow-x-auto">
                    <table className="min-w-[1220px] w-full text-sm [&_.table-body-cell]:py-2.5 [&_.table-head-cell]:py-2.5">
                      <thead className="sticky top-0 z-10 bg-slate-100/95 text-slate-700 shadow-[inset_0_-1px_0_rgba(226,232,240,0.9)] backdrop-blur">
                        <tr>
                          <th className="table-head-cell text-left">{t.fuelLogs.efficiency.date}</th>
                          <th className="table-head-cell text-left">{t.fuelLogs.efficiency.driver}</th>
                          <th className="table-head-cell text-left">{t.fuelLogs.efficiency.vehicleReg}</th>
                          <th className="table-head-cell text-right">{t.fuelLogs.efficiency.daysSincePreviousFill}</th>
                          <th className="table-head-cell text-right">{t.fuelLogs.efficiency.previousMileage}</th>
                          <th className="table-head-cell text-right">{t.fuelLogs.efficiency.currentMileage}</th>
                          <th className="table-head-cell text-right">{t.fuelLogs.efficiency.kmDriven}</th>
                          <th className="table-head-cell text-right">{t.fuelLogs.efficiency.litres}</th>
                          <th className="table-head-cell text-right">{t.fuelLogs.efficiency.kmPerLitre}</th>
                          <th className="table-head-cell text-left">{t.fuelLogs.efficiency.receiptCheck}</th>
                          <th className="table-head-cell text-left">{t.fuelLogs.efficiency.result}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {displayedEfficiencyRows.map((row) => (
                          <tr key={row.log.id} className="enterprise-table-row">
                            <td className="table-body-cell whitespace-nowrap font-medium text-slate-700">{formatDate(row.log.date, language)}</td>
                            <td className="table-body-cell whitespace-nowrap table-driver-name">{row.log.driver || "-"}</td>
                            <td className="table-body-cell whitespace-nowrap text-slate-700">{row.log.vehicle_reg || "-"}</td>
                            <td className="table-body-cell whitespace-nowrap text-right font-medium text-slate-800">{row.daysSincePreviousFill ?? "-"}</td>
                            <td className="table-body-cell whitespace-nowrap text-right font-medium text-slate-800">{row.previousMileage ?? "-"}</td>
                            <td className="table-body-cell whitespace-nowrap text-right font-medium text-slate-800">{row.currentMileage ?? "-"}</td>
                            <td className="table-body-cell whitespace-nowrap text-right font-medium text-slate-800">{row.kmDriven != null ? formatNumber(row.kmDriven, language, 0) : "-"}</td>
                            <td className="table-body-cell whitespace-nowrap text-right font-medium text-slate-800">{row.litres != null ? formatNumber(row.litres, language, 2) : "-"}</td>
                            <td className="table-body-cell whitespace-nowrap text-right text-base font-bold text-slate-950">{row.kmPerLitre != null ? formatNumber(row.kmPerLitre, language, 2) : "-"}</td>
                            <td className="table-body-cell"><span className={`inline-flex whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-semibold ${getReceiptCheckBadgeClass(row.log.receipt_checked)}`}>{getReceiptCheckLabel(row.log.receipt_checked, language)}</span></td>
                            <td className="table-body-cell"><button type="button" title={getEfficiencyTooltipText(row)} className={`inline-flex whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-semibold ${getEfficiencyStatusClass(row.status)}`}>{statusLabels[row.status]}</button></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
              {filteredEfficiencyRows.length > EFFICIENCY_PREVIEW_PAGE_SIZE ? (
                <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-xs text-slate-500">
                    {efficiencyPreviewCount === EFFICIENCY_PREVIEW_PAGE_SIZE
                      ? t.fuelLogs.efficiency.previewLimit
                      : `${formatNumber(displayedEfficiencyRows.length, language)} ${t.fuelLogs.efficiency.of} ${formatNumber(filteredEfficiencyRows.length, language)} ${t.common.entries}`}
                  </p>
                  {filteredEfficiencyRows.length > displayedEfficiencyRows.length ? (
                    <button type="button" onClick={() => setEfficiencyPreviewCount((count) => count + EFFICIENCY_PREVIEW_PAGE_SIZE)} className="btn-secondary min-h-[38px] px-3 py-2 text-xs">
                      {t.fuelLogs.efficiency.showMore}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </>
          )}
        </div>
          </>
        ) : (
          <>
            <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-7">
              <div className="subtle-panel p-4"><p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{t.fuelLogs.efficiency.tripKm}</p><p className="mt-2 text-xl font-bold text-slate-950">{tripSummary.tripKm != null ? formatNumber(tripSummary.tripKm, language, 0) : "-"}</p></div>
              <div className="subtle-panel p-4"><p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{t.fuelLogs.efficiency.totalLitres}</p><p className="mt-2 text-xl font-bold text-slate-950">{formatNumber(tripSummary.totalLitres, language, 2)}</p></div>
              <div className="subtle-panel p-4"><p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{t.fuelLogs.efficiency.tripKmPerLitre}</p><p className="mt-2 text-xl font-bold text-brand-700">{tripSummary.tripKmPerLitre != null ? formatNumber(tripSummary.tripKmPerLitre, language, 2) : "-"}</p></div>
              <div className="subtle-panel p-4"><p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{t.fuelLogs.efficiency.totalFuelCost}</p><p className="mt-2 text-xl font-bold text-slate-950">{formatCurrency(tripSummary.totalFuelCost, language)}</p></div>
              <div className="subtle-panel p-4"><p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{t.fuelLogs.efficiency.averagePricePerLitre}</p><p className="mt-2 text-xl font-bold text-slate-950">{tripSummary.averagePricePerLitre != null ? formatCurrency(tripSummary.averagePricePerLitre, language) : "-"}</p></div>
              <div className="subtle-panel p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{t.fuelLogs.efficiency.receiptsChecked}</p>
                <p className="mt-2 text-lg font-bold text-emerald-700">{receiptsSummaryLabel}</p>
                <p className="mt-1 text-xs text-slate-500">{tripSummary.receiptUncheckedCount === 0 ? t.fuelLogs.efficiency.allReceiptsChecked : t.fuelLogs.efficiency.tripReceiptsTooltip}</p>
              </div>
              <div className="subtle-panel p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{t.fuelLogs.efficiency.missingMileage}</p>
                <p className="mt-2 text-lg font-bold text-amber-700">{missingMileageSummaryLabel}</p>
                <p className="mt-1 text-xs text-slate-500">{mileageClarityMessage}</p>
              </div>
            </div>

            <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_10px_30px_rgba(15,23,42,0.04)]">
              <div className="flex items-start gap-3">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-brand-700" />
                <div>
                  <p className="font-semibold text-slate-950">{t.fuelLogs.efficiency.tripSummaryCalculation}</p>
                  <p className="mt-1 max-w-4xl text-sm text-slate-600">{t.fuelLogs.efficiency.tripSummaryCalculationDescription}</p>
                </div>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-3">
                <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{t.fuelLogs.efficiency.step} 1</p>
                  <p className="mt-2 text-sm font-semibold text-slate-900">{t.fuelLogs.efficiency.startMileage} {"->"} {t.fuelLogs.efficiency.endMileage}</p>
                </div>
                <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{t.fuelLogs.efficiency.step} 2</p>
                  <p className="mt-2 text-sm font-semibold text-slate-900">{t.fuelLogs.efficiency.endMileage} - {t.fuelLogs.efficiency.startMileage} = {t.fuelLogs.efficiency.tripKm}</p>
                </div>
                <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{t.fuelLogs.efficiency.step} 3</p>
                  <p className="mt-2 text-sm font-semibold text-slate-900">{t.fuelLogs.efficiency.tripKm} ÷ {t.fuelLogs.efficiency.totalLitres} = {t.fuelLogs.efficiency.tripKmPerLitre}</p>
                </div>
              </div>
            </div>

            <div className="mt-5 rounded-2xl border border-brand-100 bg-brand-50/60 p-4 text-sm text-slate-700">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="flex items-start gap-3">
                  <Info className="mt-0.5 h-4 w-4 shrink-0 text-brand-700" />
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-950">{t.fuelLogs.efficiency.tripFormulaTitle}</p>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                      <div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{t.fuelLogs.efficiency.tripPeriod}</p><p className="mt-1 font-semibold text-slate-900">{tripPeriodLabel}</p>{tripPeriodDays != null ? <p className="mt-0.5 text-xs text-slate-500">{t.fuelLogs.efficiency.numberOfDays}: {formatNumber(tripPeriodDays, language)} {t.fuelLogs.efficiency.days}</p> : null}</div>
                      <div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{t.fuelLogs.efficiency.mileage}</p><p className="mt-1 font-semibold text-slate-900">{tripSummary.startMileage != null ? formatNumber(tripSummary.startMileage, language, 0) : "-"} {"->"} {tripSummary.endMileage != null ? formatNumber(tripSummary.endMileage, language, 0) : "-"}</p></div>
                      <div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{t.fuelLogs.efficiency.tripDistance}</p><p className="mt-1 font-semibold text-slate-900">{tripSummary.endMileage != null ? formatNumber(tripSummary.endMileage, language, 0) : "-"} - {tripSummary.startMileage != null ? formatNumber(tripSummary.startMileage, language, 0) : "-"} = {tripSummary.tripKm != null ? formatNumber(tripSummary.tripKm, language, 0) : "-"} km</p></div>
                      <div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{t.fuelLogs.efficiency.fuelUsed}</p><p className="mt-1 font-semibold text-slate-900">{formatNumber(tripSummary.totalLitres, language, 2)} {t.fuelLogs.efficiency.litres}</p></div>
                    </div>
                    <div className="mt-4 rounded-2xl border border-brand-100 bg-white/80 px-4 py-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-700">{t.fuelLogs.efficiency.finalResult}</p>
                      <p className="mt-2 text-lg font-bold text-slate-950">{tripSummary.tripKm != null ? formatNumber(tripSummary.tripKm, language, 0) : "-"} km ÷ {formatNumber(tripSummary.totalLitres, language, 2)}L = {tripSummary.tripKmPerLitre != null ? formatNumber(tripSummary.tripKmPerLitre, language, 2) : "-"} KM/L</p>
                      {tripSummary.tripKmPerLitre != null ? <p className="mt-2 text-sm text-slate-600">{t.fuelLogs.efficiency.thisMeansVehicleTravelled} {formatNumber(tripSummary.tripKmPerLitre, language, 2)} km {t.fuelLogs.efficiency.forEveryOneLitre}</p> : null}
                    </div>
                  </div>
                </div>
                <button type="button" title={tripStatusTooltips[tripSummary.status]} className={`inline-flex w-fit shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold ${getTripStatusClass(tripSummary.status)}`}>
                  {tripStatusLabels[tripSummary.status]}
                </button>
              </div>
            </div>

            <div className="mt-5 grid gap-3 lg:grid-cols-2">
              <div className={`flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm ${tripSummary.receiptUncheckedCount > 0 ? "border-amber-200 bg-amber-50 text-amber-900" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>
                {tripSummary.receiptUncheckedCount > 0 ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> : <ReceiptText className="mt-0.5 h-4 w-4 shrink-0" />}
                <div><p className="font-semibold">{tripSummary.receiptUncheckedCount > 0 ? t.fuelLogs.efficiency.statusCheckReceipts : t.fuelLogs.efficiency.allReceiptsChecked}</p><p className="mt-1">{tripSummary.receiptUncheckedCount > 0 ? t.fuelLogs.efficiency.tripReceiptsTooltip : t.fuelLogs.efficiency.allReceiptsChecked}</p></div>
              </div>
              <div className={`flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm ${tripSummary.mileageRecordCount < 2 || tripSummary.missingMileageCount > 0 ? "border-amber-200 bg-amber-50 text-amber-900" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>
                {tripSummary.mileageRecordCount < 2 || tripSummary.missingMileageCount > 0 ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> : <Gauge className="mt-0.5 h-4 w-4 shrink-0" />}
                <div><p className="font-semibold">{tripSummary.mileageRecordCount < 2 ? t.fuelLogs.efficiency.statusNotEnoughData : tripSummary.missingMileageCount > 0 ? t.fuelLogs.efficiency.statusMissingMileage : t.fuelLogs.efficiency.tripAllKeyMileageAvailable}</p><p className="mt-1">{mileageClarityMessage}</p></div>
              </div>
            </div>

            <div className="mt-5">
              <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h4 className="text-base font-semibold text-slate-950">{t.fuelLogs.efficiency.includedFuelLogs}</h4>
                  <p className="mt-1 text-sm text-slate-500">{t.fuelLogs.efficiency.includedFuelLogsHelper}</p>
                  <p className="mt-1 text-xs font-medium text-slate-500">{formatNumber(tripSummary.fuelLogCount, language)} {t.common.entries}</p>
                </div>
                <button type="button" title={tripStatusTooltips[tripSummary.status]} className={`inline-flex w-fit rounded-full border px-2.5 py-1 text-[11px] font-semibold ${getTripStatusClass(tripSummary.status)}`}>
                  {tripStatusLabels[tripSummary.status]}
                </button>
              </div>
              {loading ? (
                <p className="text-sm text-slate-500">{t.fuelLogs.loadingFuelLogs}</p>
              ) : tripSummary.logs.length === 0 ? (
                <EmptyState title={t.fuelLogs.efficiency.noResultsTitle} description={t.fuelLogs.efficiency.noResultsDescription} />
              ) : (
                <>
                  <div className="space-y-3 md:hidden">
                    {displayedTripSummaryLogs.map((log) => (
                      <div key={log.id} className="subtle-panel p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{formatDate(log.date, language)}</p>
                            <p className="mt-2 text-sm font-semibold text-slate-900">{log.driver || "-"}</p>
                            <p className="mt-1 text-sm text-slate-500">{log.vehicle_reg || "-"}</p>
                          </div>
                          <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold ${getReceiptCheckBadgeClass(log.receipt_checked)}`}>{getReceiptCheckLabel(log.receipt_checked, language)}</span>
                        </div>
                        <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                          <div><p className="text-xs text-slate-500">{t.fuelLogs.efficiency.mileage}</p><p className="font-semibold text-slate-900">{getMileageValue(log.mileage) != null ? formatNumber(Number(log.mileage), language, 0) : "-"}</p></div>
                          <div><p className="text-xs text-slate-500">{t.fuelLogs.efficiency.litres}</p><p className="font-semibold text-slate-900">{formatNumber(Number(log.litres || 0), language, 2)}</p></div>
                          <div><p className="text-xs text-slate-500">{t.fuelLogs.efficiency.totalCost}</p><p className="font-semibold text-slate-900">{formatCurrency(Number(log.total_cost || 0), language)}</p></div>
                          <div><p className="text-xs text-slate-500">{t.fuelLogs.efficiency.pricePerLitre}</p><p className="font-semibold text-slate-900">{log.price_per_litre != null ? formatCurrency(Number(log.price_per_litre), language) : "-"}</p></div>
                          <div className="col-span-2"><p className="text-xs text-slate-500">{t.fuelLogs.efficiency.entrySource}</p><p className="font-semibold text-slate-900">{sourceCopy.options[normalizeEntrySource(log.entry_source)]}</p></div>
                          {log.notes ? <div className="col-span-2"><p className="text-xs text-slate-500">{t.fuelLogs.efficiency.notes}</p><p className="font-medium text-slate-700">{log.notes}</p></div> : null}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="hidden md:block">
                    <div className="table-shell rounded-2xl">
                      <div className="table-scroll overflow-x-auto">
                        <table className="min-w-[1280px] w-full text-sm [&_.table-body-cell]:py-2.5 [&_.table-head-cell]:py-2.5">
                          <thead className="sticky top-0 z-10 bg-slate-100/95 text-slate-700 shadow-[inset_0_-1px_0_rgba(226,232,240,0.9)] backdrop-blur">
                            <tr>
                              <th className="table-head-cell text-left">{t.fuelLogs.efficiency.date}</th>
                              <th className="table-head-cell text-left">{t.fuelLogs.efficiency.driver}</th>
                              <th className="table-head-cell text-left">{t.fuelLogs.efficiency.vehicleReg}</th>
                              <th className="table-head-cell text-right">{t.fuelLogs.efficiency.mileage}</th>
                              <th className="table-head-cell text-right">{t.fuelLogs.efficiency.litres}</th>
                              <th className="table-head-cell text-right">{t.fuelLogs.efficiency.totalCost}</th>
                              <th className="table-head-cell text-right">{t.fuelLogs.efficiency.pricePerLitre}</th>
                              <th className="table-head-cell text-left">{t.fuelLogs.efficiency.receiptCheck}</th>
                              <th className="table-head-cell text-left">{t.fuelLogs.efficiency.entrySource}</th>
                              <th className="table-head-cell text-left">{t.fuelLogs.efficiency.notes}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {displayedTripSummaryLogs.map((log) => (
                              <tr key={log.id} className="enterprise-table-row">
                                <td className="table-body-cell whitespace-nowrap font-medium text-slate-700">{formatDate(log.date, language)}</td>
                                <td className="table-body-cell whitespace-nowrap table-driver-name">{log.driver || "-"}</td>
                                <td className="table-body-cell whitespace-nowrap text-slate-700">{log.vehicle_reg || "-"}</td>
                                <td className="table-body-cell whitespace-nowrap text-right font-medium text-slate-800">{getMileageValue(log.mileage) != null ? formatNumber(Number(log.mileage), language, 0) : "-"}</td>
                                <td className="table-body-cell whitespace-nowrap text-right font-medium text-slate-800">{formatNumber(Number(log.litres || 0), language, 2)}</td>
                                <td className="table-body-cell whitespace-nowrap text-right font-medium text-slate-800">{formatCurrency(Number(log.total_cost || 0), language)}</td>
                                <td className="table-body-cell whitespace-nowrap text-right font-medium text-slate-800">{log.price_per_litre != null ? formatCurrency(Number(log.price_per_litre), language) : "-"}</td>
                                <td className="table-body-cell"><span className={`inline-flex whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-semibold ${getReceiptCheckBadgeClass(log.receipt_checked)}`}>{getReceiptCheckLabel(log.receipt_checked, language)}</span></td>
                                <td className="table-body-cell"><span className={`inline-flex whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-semibold ${getEntrySourceBadgeClass(normalizeEntrySource(log.entry_source))}`}>{sourceCopy.options[normalizeEntrySource(log.entry_source)]}</span></td>
                                <td className="table-body-cell max-w-[260px] truncate text-slate-600" title={log.notes || ""}>{log.notes || "-"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                  {tripSummary.logs.length > EFFICIENCY_PREVIEW_PAGE_SIZE ? (
                    <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <p className="text-xs text-slate-500">
                        {tripPreviewCount === EFFICIENCY_PREVIEW_PAGE_SIZE
                          ? t.fuelLogs.efficiency.previewLimit
                          : `${formatNumber(displayedTripSummaryLogs.length, language)} ${t.fuelLogs.efficiency.of} ${formatNumber(tripSummary.logs.length, language)} ${t.common.entries}`}
                      </p>
                      {tripSummary.logs.length > displayedTripSummaryLogs.length ? (
                        <button type="button" onClick={() => setTripPreviewCount((count) => count + EFFICIENCY_PREVIEW_PAGE_SIZE)} className="btn-secondary min-h-[38px] px-3 py-2 text-xs">
                          {t.fuelLogs.efficiency.showMore}
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </>
              )}
            </div>
          </>
        )}
      </section>

      <section className="surface-card mb-4.5 p-4 sm:p-5">
        <div className="mb-3.5">
          <h3 className="text-base font-semibold text-slate-900">{t.fuelLogs.spendByDayTitle}</h3>
          <p className="mt-1 text-sm text-slate-500">{t.fuelLogs.spendByDayDescription}</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {last7DayRows.map((row) => (
            <div key={row.date} className="subtle-panel p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-slate-700">{formatDate(row.date, language)}</p>
                <Clock3 className="h-4 w-4 text-slate-400" />
              </div>
              <p className="mt-2.5 text-base font-semibold text-slate-950">{formatCurrency(row.spend, language)}</p>
              <div className="mt-2 flex items-center justify-between gap-3 text-sm text-slate-500">
                <span>{formatNumber(row.litres, language, 2)} {t.fuelLogs.litres}</span>
                <span>{formatNumber(row.entries, language)} {t.common.entries}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="mb-4.5 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          label={receiptCopy.totalCount}
          value={formatNumber(receiptSummary.total, language)}
          helper={language === "th" ? "รวมตามตัวกรองปัจจุบัน" : "Based on the current filters."}
          icon={<ReceiptText className="h-5 w-5" />}
        />
        <StatCard
          label={receiptCopy.checkedCount}
          value={formatNumber(receiptSummary.checked, language)}
          helper={language === "th" ? "ตรวจเทียบใบเสร็จแล้ว" : "Marked as checked against receipt."}
          icon={<TrendingUp className="h-5 w-5" />}
        />
        <StatCard
          label={receiptCopy.notCheckedCount}
          value={formatNumber(receiptSummary.notChecked, language)}
          helper={language === "th" ? "ยังรอตรวจเทียบใบเสร็จ" : "Still pending receipt check."}
          icon={<AlertTriangle className="h-5 w-5" />}
        />
      </section>

      <section className="mt-5 grid gap-5">
        <section className="surface-card p-3 sm:p-4">
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <h3 className="section-title">{isEditing ? t.fuelLogs.editFuelEntry : t.fuelLogs.addFuelEntry}</h3>
              <p className="section-subtitle">{t.fuelLogs.description}</p>
            </div>
            {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}
            {successMessage ? <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{successMessage}</div> : null}
            {duplicateMatches.length > 0 && pendingDraft ? (
              <div className="rounded-3xl border border-amber-300 bg-amber-50/90 p-4">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-amber-900">{copy.duplicateTitle}</p>
                    <p className="mt-1 text-sm text-amber-800">{copy.duplicateHint}</p>
                  </div>
                </div>
                <div className="mt-4 space-y-3">
                  {duplicateMatches.map((log) => (
                    <div key={log.id} className="rounded-2xl border border-amber-200 bg-white/85 px-4 py-3 text-sm text-slate-700">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p className="font-semibold text-slate-900">{log.vehicle_reg}</p>
                          <p className="mt-1 text-slate-500">{formatDate(log.date, language)}{copy.entrySeparator}{log.driver || "-"}{copy.entrySeparator}{log.location || "-"}</p>
                        </div>
                        <div className="text-left sm:text-right">
                          <p className="font-semibold text-slate-950">{formatCurrency(Number(log.total_cost || 0), language)}</p>
                          <p className="text-slate-500">{formatNumber(Number(log.litres || 0), language, 2)}L</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-4 flex flex-col gap-2.5 sm:flex-row">
                  <button type="button" onClick={() => void saveDraft(pendingDraft, submitMode)} disabled={saving} className="btn-primary w-full sm:w-auto">{copy.saveAnyway}</button>
                  <button type="button" onClick={() => { setPendingDraft(null); setDuplicateMatches([]); }} className="btn-secondary w-full sm:w-auto">{copy.cancel}</button>
                </div>
              </div>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="form-field"><label className="form-label form-label-required">{t.fuelLogs.logDate}</label><input type="date" required max={todayValue} value={form.date} onInvalid={handleInvalid} onInput={clearValidationMessage} onChange={(event) => setForm((current) => ({ ...current, date: event.target.value }))} className="form-input bg-white" /></div>
              <div className="form-field"><label className="form-label form-label-required">{t.fuelLogs.driver}</label><select required value={form.driver_id} onInvalid={handleInvalid} onInput={clearValidationMessage} onChange={(event) => handleDriverChange(event.target.value)} className="form-input bg-white"><option value="">{t.fuelLogs.selectDriver}</option>{drivers.map((driver) => <option key={driver.id} value={String(driver.id)}>{driver.name}</option>)}</select></div>
              <div className="form-field sm:col-span-2">
                <label className="form-label">{sourceCopy.label}</label>
                <div className="flex flex-wrap gap-1.5">
                  {manualEntrySourceOptions.map((option) => (
                    <button key={option.value} type="button" onClick={() => setForm((current) => ({ ...current, entry_source: option.value }))} className={`inline-flex min-h-8 items-center rounded-full border px-3 py-1 text-xs font-semibold transition ${form.entry_source === option.value ? getEntrySourceBadgeClass(option.value) : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"}`}>
                      {option.label}
                    </button>
                  ))}
                </div>
                {form.entry_source === "direct_from_receipt" ? <p className="form-helper text-emerald-700">{sourceCopy.auditHint}</p> : null}
                {form.entry_source === "statement_manual" ? <p className="mt-1 text-xs text-sky-700">{statementEntryCopy.statementModeHelper}</p> : null}
              </div>
              <div className="form-field"><label className="form-label form-label-required">{t.fuelLogs.vehicleReg}</label><input required list="fuel-log-vehicle-options" value={form.vehicle_reg} onInvalid={handleInvalid} onInput={clearValidationMessage} onChange={(event) => setForm((current) => ({ ...current, vehicle_reg: event.target.value }))} placeholder={t.fuelLogs.vehiclePlaceholder} className="form-input bg-white" /><p className="form-helper">{selectedDriver?.vehicle_reg?.trim() ? copy.autoFillLabel : copy.noVehicleAssignedLabel}</p></div>
              <div className="form-field"><label className="form-label">{t.fuelLogs.mileage}</label><input type="number" min="0" step="1" value={form.mileage} onChange={(event) => setForm((current) => ({ ...current, mileage: event.target.value }))} placeholder={t.fuelLogs.currentMileage} className="form-input bg-white" /><p className="form-helper">{comparisonEntry ? `${comparisonEntry.vehicle_reg} | ${formatDate(comparisonEntry.date, language)} | ${comparisonEntry.mileage ?? "-"}` : copy.previousEntryHelper}</p>{form.mileage && comparisonEntry?.mileage != null && Number(form.mileage) < Number(comparisonEntry.mileage) ? <div className="mt-2 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{t.fuelLogs.mileageValidationError}</div> : null}</div>
              <div className="form-field">
                <label className="form-label form-label-required">{t.fuelLogs.fuelStationLocation}</label>
                <div className="flex flex-wrap items-center gap-1.5">
                  {["Shell", "Bangchak"].map((station) => (
                    <button key={station} type="button" onClick={() => setForm((current) => ({ ...current, location: station }))} className={`min-h-8 rounded-full border px-3 py-1 text-xs font-semibold transition ${form.location.trim().toLowerCase() === station.toLowerCase() ? "border-sky-300 bg-sky-50 text-sky-800" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"}`}>{station}</button>
                  ))}
                  <input required value={form.location} onInvalid={handleInvalid} onInput={clearValidationMessage} onChange={(event) => setForm((current) => ({ ...current, location: event.target.value }))} placeholder="Custom location" autoComplete="off" className="form-input min-w-[180px] flex-1 bg-white" />
                </div>
              </div>
              <div className="form-field"><label className="form-label form-label-required">{t.fuelLogs.litres}</label><input type="number" min="0" step="0.01" required value={form.litres} onInvalid={handleInvalid} onInput={clearValidationMessage} onChange={(event) => updateFuelField("litres", event.target.value)} className="form-input bg-white" /></div>
              <div className="form-field"><label className="form-label form-label-required">{t.fuelLogs.totalCost}</label><input type="number" min="0" step="0.01" required value={form.total_cost} onInvalid={handleInvalid} onInput={clearValidationMessage} onChange={(event) => updateFuelField("total_cost", event.target.value)} className="form-input bg-white" /></div>
              <div className="form-field"><label className="form-label">{t.fuelLogs.pricePerLitre}</label><input type="number" min="0" step="0.01" value={form.price_per_litre} onChange={(event) => updateFuelField("price_per_litre", event.target.value)} placeholder={t.fuelLogs.pricePerLitrePlaceholder} className="form-input bg-white" /><p className="form-helper">{t.fuelLogs.pricePerLitreHelper}</p></div>
              <div className="form-field"><label className="form-label">{t.fuelLogs.fuelType}</label><select value={form.fuel_type} onChange={(event) => setForm((current) => ({ ...current, fuel_type: event.target.value }))} className="form-input bg-white"><option value="">{t.fuelLogs.fuelTypeSelect}</option>{fuelTypeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div>
              <div className="form-field"><label className="form-label">{t.fuelLogs.paymentMethod}</label><select value={form.payment_method} onChange={(event) => setForm((current) => ({ ...current, payment_method: event.target.value }))} className="form-input bg-white"><option value="">{t.fuelLogs.paymentMethodSelect}</option>{paymentMethodOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div>
            </div>

            <div className="form-field">
              <label className="form-label">{t.fuelLogs.notes}</label>
              <textarea rows={2} value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} placeholder={t.fuelLogs.optionalNotes} className="form-textarea bg-white" />
            </div>

            <datalist id="fuel-log-vehicle-options">
              {vehicleOptions.map((vehicleReg) => (
                <option key={vehicleReg} value={vehicleReg} />
              ))}
            </datalist>
            <div className="sticky bottom-2 z-10 flex flex-col gap-2 rounded-lg border border-slate-200/80 bg-white/95 p-2.5 shadow-[0_8px_24px_rgba(15,23,42,0.08)] backdrop-blur sm:static sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none sm:flex-row sm:items-center">
              {!isEditing ? (
                <label className="flex min-h-10 cursor-pointer items-center gap-2.5 text-sm font-medium text-slate-700 sm:mr-auto">
                  <input type="checkbox" checked={keepDetailsForNextEntry} onChange={(event) => setKeepDetailsForNextEntry(event.target.checked)} className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500" />
                  <span>{statementEntryCopy.keepDetails}</span>
                </label>
              ) : null}
              {!isEditing ? <button type="submit" disabled={saving} onClick={() => setSubmitMode("addAnother")} className="btn-secondary min-w-[180px] flex-1 sm:flex-none disabled:opacity-70">{saving && submitMode === "addAnother" ? t.common.saving : t.fuelLogs.saveAndAddAnother}</button> : null}
              <button type="submit" disabled={saving} onClick={() => setSubmitMode("save")} className="btn-primary min-w-[180px] flex-1 sm:flex-none disabled:opacity-70">{saving && submitMode === "save" ? t.common.saving : isEditing ? t.fuelLogs.updateFuelEntry : t.fuelLogs.saveFuelEntry}</button>
              {isEditing ? <button type="button" onClick={resetForm} className="btn-secondary w-full sm:w-auto">{t.common.cancel}</button> : null}
            </div>
          </form>
        </section>
      </section>

      <section className="mt-5">
        <section className="surface-card min-w-0 p-5 sm:p-6">
          <div className="mb-4 flex flex-col gap-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <h3 className="section-title">{t.fuelLogs.fuelEntries}</h3>
                <p className="section-subtitle">{t.fuelLogs.tableDescription}</p>
              </div>
              <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
                <div className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-slate-600">{formatNumber(totalCount, language)} {copy.matches}</div>
                <FuelStatementImporter drivers={drivers} existingLogs={efficiencySourceLogs} onImported={() => refreshCurrentPage(1)} />
                <button type="button" onClick={() => void handleExportFuelLogs()} disabled={!totalCount || exporting || loading} className="btn-secondary w-full gap-2 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"><Download className="h-4 w-4" />{exporting ? exportButtonLabel : t.common.export}</button>
              </div>
            </div>
          </div>
          <div className="mb-5 rounded-[1.5rem] border border-slate-200/80 bg-white/95 p-4 shadow-[0_10px_30px_rgba(15,23,42,0.04)] backdrop-blur sm:p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-slate-900">{copy.filters}</p>
              <button type="button" onClick={() => updateFilters(initialFilters)} className="text-sm font-medium text-slate-500 hover:text-slate-900">{copy.clear}</button>
            </div>
            <div className="space-y-3.5">
              <div className="grid gap-3 md:grid-cols-12">
                <div className="md:col-span-5 lg:col-span-4"><label className="form-label">{copy.dateRange}</label><div className="grid grid-cols-2 gap-2"><input type="date" value={filters.fromDate ?? ""} onChange={(event) => updateFilters((current) => ({ ...current, fromDate: event.target.value }))} className="form-input bg-white" /><input type="date" value={filters.toDate ?? ""} onChange={(event) => updateFilters((current) => ({ ...current, toDate: event.target.value }))} className="form-input bg-white" /></div></div>
                <div className="md:col-span-3 lg:col-span-4"><label className="form-label">{copy.driver}</label><select value={filters.driverId ?? ""} onChange={(event) => updateFilters((current) => ({ ...current, driverId: event.target.value }))} className="form-input bg-white"><option value="">{copy.all}</option>{drivers.map((driver) => <option key={driver.id} value={String(driver.id)}>{driver.name}</option>)}</select></div>
                <div className="md:col-span-4 lg:col-span-4"><label className="form-label">{copy.vehicle}</label><select value={filters.vehicleReg ?? ""} onChange={(event) => updateFilters((current) => ({ ...current, vehicleReg: event.target.value }))} className="form-input bg-white"><option value="">{copy.all}</option>{vehicleOptions.map((vehicleReg) => <option key={vehicleReg} value={vehicleReg}>{vehicleReg}</option>)}</select></div>
              </div>
              <div className="grid gap-3 md:grid-cols-12">
                <div className="md:col-span-3"><label className="form-label">{t.fuelLogs.location}</label><select value={filters.location ?? ""} onChange={(event) => updateFilters((current) => ({ ...current, location: event.target.value }))} className="form-input bg-white"><option value="">{t.fuelLogs.allLocations}</option>{locationOptions.map((location) => <option key={location} value={location}>{location}</option>)}</select></div>
                <div className="md:col-span-3"><label className="form-label">{copy.payment}</label><select value={filters.paymentMethod ?? ""} onChange={(event) => updateFilters((current) => ({ ...current, paymentMethod: event.target.value }))} className="form-input bg-white"><option value="">{copy.all}</option>{paymentMethodOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div>
                <div className="md:col-span-3"><label className="form-label">{sourceCopy.filterLabel}</label><select value={filters.entrySource ?? ""} onChange={(event) => updateFilters((current) => ({ ...current, entrySource: event.target.value as FuelLogFilters["entrySource"] }))} className="form-input bg-white"><option value="">{sourceCopy.all}</option>{filterEntrySourceOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div>
                <div className="md:col-span-3"><label className="form-label">{receiptCopy.filterLabel}</label><select value={filters.receiptCheckedStatus ?? ""} onChange={(event) => updateFilters((current) => ({ ...current, receiptCheckedStatus: event.target.value as FuelLogFilters["receiptCheckedStatus"] }))} className="form-input bg-white"><option value="">{copy.all}</option><option value="checked">{receiptCopy.checked}</option><option value="not_checked">{receiptCopy.notChecked}</option></select></div>
                <div className="md:col-span-3"><label className="form-label">{copy.totalCostRange}</label><div className="grid grid-cols-2 gap-2"><input type="number" min="0" step="0.01" value={filters.totalCostMin ?? ""} onChange={(event) => updateFilters((current) => ({ ...current, totalCostMin: event.target.value }))} placeholder={copy.min} className="form-input bg-white" /><input type="number" min="0" step="0.01" value={filters.totalCostMax ?? ""} onChange={(event) => updateFilters((current) => ({ ...current, totalCostMax: event.target.value }))} placeholder={copy.max} className="form-input bg-white" /></div></div>
              </div>
            </div>
          </div>

          {loading ? (
            <p className="text-sm text-slate-500">{t.fuelLogs.loadingFuelLogs}</p>
          ) : totalCount === 0 ? (
            <EmptyState title={copy.noResultsTitle} description={copy.noResultsDescription} />
          ) : (
            <>
              <div className="space-y-3.5 md:hidden">
                {fuelLogs.map((log) => (
                  <div key={log.id} className="subtle-panel border-slate-200/80 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{formatDate(log.date, language)}</p>
                        <p className="mt-2 text-sm font-semibold text-slate-900">{log.driver}</p>
                        <span className={`mt-2 inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold ${getEntrySourceBadgeClass(normalizeEntrySource(log.entry_source))}`}>{sourceCopy.options[normalizeEntrySource(log.entry_source)]}</span>
                        <p className="mt-1 text-sm text-slate-500">{log.vehicle_reg}</p>
                      </div>
                      <p className="whitespace-nowrap rounded-full bg-slate-100 px-3 py-1 text-base font-bold text-slate-900">{formatCurrency(Number(log.total_cost || 0), language)}</p>
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-3">
                      <div><p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{t.fuelLogs.litres}</p><p className="mt-1 text-sm font-medium text-slate-900">{formatNumber(Number(log.litres || 0), language, 2)}</p></div>
                      <div><p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{t.fuelLogs.pricePerLitre}</p><p className="mt-1 text-sm font-medium text-slate-900">{log.price_per_litre != null ? formatCurrency(Number(log.price_per_litre), language) : "-"}</p></div>
                      <div><p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{t.fuelLogs.mileage}</p><p className="mt-1 text-sm font-medium text-slate-900">{log.mileage ?? "-"}</p></div>
                      <div><p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{t.fuelLogs.location}</p><p className="mt-1 text-sm font-medium text-slate-900">{log.location || "-"}</p></div>
                      <div><p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{receiptCopy.filterLabel}</p><span className={`mt-1 inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold ${getReceiptCheckBadgeClass(log.receipt_checked)}`}>{getReceiptCheckLabel(log.receipt_checked, language)}</span></div>
                    </div>
                    {getFuelLogWarnings(log).length ? (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {getFuelLogWarnings(log).map((warning) => (
                          <span key={warning} className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-800">{warning}</span>
                        ))}
                      </div>
                    ) : null}
                    <div className="mt-4 flex gap-2">
                      <button type="button" onClick={() => void handleReceiptToggle(log, !log.receipt_checked)} disabled={togglingReceiptId === String(log.id)} className="btn-secondary min-h-[46px] flex-1 px-4 py-2.5 disabled:opacity-50">{togglingReceiptId === String(log.id) ? t.common.saving : log.receipt_checked ? receiptCopy.markUnchecked : receiptCopy.markChecked}</button>
                      <button type="button" onClick={() => populateForm(log)} className="btn-secondary min-h-[46px] flex-1 px-4 py-2.5">{t.common.edit}</button>
                      <button type="button" onClick={() => void handleDelete(String(log.id))} disabled={deletingId === String(log.id)} className="btn-danger min-h-[46px] flex-1 px-4 py-2.5 disabled:opacity-50">{deletingId === String(log.id) ? t.common.deleting : t.common.delete}</button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="hidden md:block">
                <div className="table-shell rounded-2xl">
                  <div className="table-scroll overflow-x-auto overflow-y-auto">
                    <table className="min-w-[1240px] w-full text-sm">
                      <thead className="sticky top-0 z-10 bg-slate-50/95 text-slate-600 backdrop-blur">
                        <tr>
                          <th className="table-head-cell text-left"><SortButton label={t.fuelLogs.date} active={sortKey === "date"} direction={sortDirection} onClick={() => handleSortChange("date")} /></th>
                          <th className="table-head-cell text-left">{t.fuelLogs.driver}</th>
                          <th className="table-head-cell text-left">{t.fuelLogs.vehicleReg}</th>
                          <th className="table-head-cell text-right"><SortButton label={t.fuelLogs.litres} active={sortKey === "litres"} direction={sortDirection} align="right" onClick={() => handleSortChange("litres")} /></th>
                          <th className="table-head-cell text-right"><SortButton label={t.fuelLogs.totalCost} active={sortKey === "total_cost"} direction={sortDirection} align="right" onClick={() => handleSortChange("total_cost")} /></th>
                          <th className="table-head-cell text-right">{t.fuelLogs.pricePerLitre}</th>
                          <th className="table-head-cell text-right">{t.fuelLogs.mileage}</th>
                          <th className="table-head-cell text-left">{t.fuelLogs.location}</th>
                          <th className="table-head-cell text-left">{sourceCopy.label}</th>
                          <th className="table-head-cell text-left">{receiptCopy.filterLabel}</th>
                          <th className="table-head-cell text-left">{t.common.action}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {fuelLogs.map((log) => {
                          const warnings = getFuelLogWarnings(log);
                          return (
                          <tr key={log.id} className={`enterprise-table-row ${highlightedFuelLogId === String(log.id) || warnings.length ? "bg-amber-50/70" : ""}`}>
                            <td className="table-body-cell whitespace-nowrap font-medium text-slate-700">{formatDate(log.date, language)}</td>
                            <td className="table-body-cell whitespace-nowrap table-driver-name">{log.driver}</td>
                            <td className="table-body-cell whitespace-nowrap text-slate-700">
                              {log.vehicle_reg}
                              {warnings.length ? (
                                <div className="mt-1 flex flex-wrap gap-1">
                                  {warnings.map((warning) => (
                                    <span key={warning} className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800">{warning}</span>
                                  ))}
                                </div>
                              ) : null}
                            </td>
                            <td className="table-body-cell whitespace-nowrap text-right font-medium text-slate-800">{formatNumber(Number(log.litres || 0), language, 2)}</td>
                            <td className="table-body-cell whitespace-nowrap text-right text-base font-bold text-slate-950">{formatCurrency(Number(log.total_cost || 0), language)}</td>
                            <td className="table-body-cell whitespace-nowrap text-right font-medium text-slate-800">{log.price_per_litre != null ? formatCurrency(Number(log.price_per_litre), language) : "-"}</td>
                            <td className="table-body-cell whitespace-nowrap text-right font-medium text-slate-800">{log.mileage ?? "-"}</td>
                            <td className="table-body-cell min-w-[140px] text-slate-700">{log.location || "-"}</td>
                            <td className="table-body-cell"><span className={`inline-flex whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-semibold ${getEntrySourceBadgeClass(normalizeEntrySource(log.entry_source))}`}>{sourceCopy.options[normalizeEntrySource(log.entry_source)]}</span></td>
                            <td className="table-body-cell"><span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold ${getReceiptCheckBadgeClass(log.receipt_checked)}`}>{getReceiptCheckLabel(log.receipt_checked, language)}</span></td>
                            <td className="table-body-cell"><div className="flex gap-1.5"><button type="button" onClick={() => void handleReceiptToggle(log, !log.receipt_checked)} disabled={togglingReceiptId === String(log.id)} className="table-action-secondary min-w-[104px] disabled:opacity-50">{togglingReceiptId === String(log.id) ? t.common.saving : log.receipt_checked ? receiptCopy.markUnchecked : receiptCopy.markChecked}</button><button type="button" onClick={() => populateForm(log)} className="table-action-secondary min-w-[68px]">{t.common.edit}</button><button type="button" onClick={() => void handleDelete(String(log.id))} disabled={deletingId === String(log.id)} className="table-action-danger min-w-[68px] disabled:opacity-50">{deletingId === String(log.id) ? t.common.deleting : t.common.delete}</button></div></td>
                          </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
              <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-slate-500">{copy.pageLabel} {formatNumber(currentPage, language)} {copy.ofLabel} {formatNumber(totalPages, language)}</p>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setCurrentPage((page) => Math.max(1, page - 1))} disabled={currentPage === 1 || loading} className="btn-secondary disabled:opacity-50">{copy.previousPage}</button>
                  <button type="button" onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))} disabled={currentPage === totalPages || loading} className="btn-secondary disabled:opacity-50">{copy.nextPage}</button>
                </div>
              </div>
            </>
          )}
        </section>
      </section>
    </>
  );
}
