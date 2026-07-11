"use client";

import {
  AlertTriangle,
  ArrowUpDown,
  ChevronRight,
  Clock3,
  Download,
  Droplets,
  Gauge,
  Info,
  ReceiptText,
  TrendingUp,
  Wallet,
  X
} from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
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
  fetchTripFuelLogLinks,
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
  FuelLogWithDriver,
  TripFuelLogLink
} from "@/types/database";

const PAGE_SIZE = 25;
const DEFAULT_FUEL_TYPE = "diesel";
const DEFAULT_PAYMENT_METHOD = "company_card";
const DEFAULT_ENTRY_SOURCE: FuelLogEntrySource = "line_message";
const FILTER_STORAGE_KEY = "fuel-bank:fuel-logs-filters";
const LANGUAGE_STORAGE_KEY = "fuel-bank-language";
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
  | "multiple_vehicles"
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
  vehicleCount: number;
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
    return checked ? "เธ•เธฃเธงเธเนเธฅเนเธง" : "เธขเธฑเธเนเธกเนเธ•เธฃเธงเธ";
  }

  return checked ? "Checked" : "Not checked";
}

function getReceiptCheckBadgeClass(checked: boolean) {
  return checked
    ? "border-emerald-100 bg-emerald-50/70 text-emerald-700"
    : "border-slate-200 bg-slate-50 text-slate-500";
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

function formatMileageValue(value: number | null | undefined, language: "en" | "th") {
  if (value == null || Number(value) <= 0) return "-";
  return `${formatNumber(Number(value), language, 0)} km`;
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

type BossPdfReportData = {
  actualCalculation: string;
  dataStatus: "ready" | "warning";
  dataStatusDetail: string;
  dataStatusTitle: string;
  dateRange: string;
  driver: string;
  fuelLogs: BossPdfFuelLogRow[];
  fuelEfficiency: string;
  generatedAt: string;
  mileageRange: {
    distanceTravelled: string;
    endMileage: string;
    startMileage: string;
  };
  totalFuelLogCount: number;
  totalFuelCost: string;
  totalLitres: string;
  tripKm: string;
  vehicleReg: string;
};

type BossPdfFuelLogRow = {
  checkedStatus: string;
  cost: string;
  date: string;
  litres: string;
  mileage: string;
  vehicle: string;
};

type PdfLogo = {
  data: string;
  dataUrl: string;
  height: number;
  width: number;
} | null;

function toPdfSafeText(value: unknown) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function escapePdfText(value: unknown) {
  const divideMarker = "__PDF_DIVIDE__";
  const safe = String(value ?? "")
    .normalize("NFKD")
    .replace(/รท/g, divideMarker)
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return safe
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replaceAll(divideMarker, "\\367");
}

function formatReportNumber(value: number | null | undefined, decimals = 0) {
  if (value == null || !Number.isFinite(Number(value))) return "-";
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: decimals,
    minimumFractionDigits: decimals
  }).format(Number(value));
}

function formatReportCurrency(value: number | null | undefined) {
  if (value == null || !Number.isFinite(Number(value))) return "-";
  return `THB ${formatReportNumber(Number(value), 2)}`;
}

function formatReportDate(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(date);
}

function formatFileDate(value: string | null | undefined) {
  if (!value) return "NoDate";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "NoDate";
  return `${String(date.getDate()).padStart(2, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}-${date.getFullYear()}`;
}

function getPdfFileSafePart(value: string) {
  const safe = toPdfSafeText(value).replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return safe || "All";
}

async function loadPdfLogo(): Promise<PdfLogo> {
  try {
    const response = await fetch("/logo.png");
    if (!response.ok) return null;
    const blob = await response.blob();
    const imageUrl = URL.createObjectURL(blob);
    const image = new Image();
    const loaded = new Promise<HTMLImageElement>((resolve, reject) => {
      image.onload = () => resolve(image);
      image.onerror = reject;
    });
    image.src = imageUrl;
    await loaded;

    const canvas = document.createElement("canvas");
    const maxSize = 220;
    const scale = Math.min(1, maxSize / Math.max(image.naturalWidth, image.naturalHeight));
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(imageUrl);

    const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
    const base64 = dataUrl.split(",")[1] ?? "";
    return {
      data: atob(base64),
      dataUrl,
      height: canvas.height,
      width: canvas.width
    };
  } catch (error) {
    console.warn("Unable to load PDF logo:", error);
    return null;
  }
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

type BossPdfCopy = {
  actual: string;
  checked: string;
  checkedStatus: string;
  companyName: string;
  cost: string;
  dataStatus: string;
  date: string;
  dateRange: string;
  distanceTravelled: string;
  driver: string;
  endMileage: string;
  footer: string;
  formula: string;
  formulaText: string;
  fuelCost: string;
  fuelEfficiency: string;
  fuelLogsMayCoverMultipleJobs: string;
  fuelLogsUsed: string;
  fuelUsed: string;
  generated: string;
  howCalculated: string;
  keySummary: string;
  litres: string;
  mileage: string;
  mileageRange: string;
  needsReceiptCheck: string;
  notChecked: string;
  periodFuelEfficiency: string;
  readyToReview: string;
  receiptWarning: string;
  reportSentence: string;
  reportTitle: string;
  reportType: string;
  selectedFilters: string;
  startMileage: string;
  status: string;
  subtitle: string;
  totalLitres: string;
  vehicle: string;
  vehicleReg: string;
};

function getBossPdfCopy(language: "en" | "th"): BossPdfCopy {
  if (language === "th") {
    return {
      actual: "เธเธณเธเธงเธ“เธเธฃเธดเธ",
      checked: "เธ•เธฃเธงเธเนเธฅเนเธง",
      checkedStatus: "เธชเธ–เธฒเธเธฐเธ•เธฃเธงเธเธชเธญเธ",
      companyName: "Expert Express Sender Co., Ltd.",
      cost: "เธเนเธฒเนเธเนเธเนเธฒเธข",
      dataStatus: "เธชเธ–เธฒเธเธฐเธเนเธญเธกเธนเธฅ",
      date: "เธงเธฑเธเธ—เธตเน",
      dateRange: "เธเนเธงเธเธงเธฑเธเธ—เธตเน",
      distanceTravelled: "เธฃเธฐเธขเธฐเธ—เธฒเธเธฃเธงเธก",
      driver: "เธเธเธเธฑเธ",
      endMileage: "เน€เธฅเธเนเธกเธฅเนเธชเธดเนเธเธชเธธเธ”",
      footer: "เธฃเธฒเธขเธเธฒเธเธเธฃเธฐเธชเธดเธ—เธเธดเธ เธฒเธเธเนเธณเธกเธฑเธเธ•เธฒเธกเธเนเธงเธเธงเธฑเธเธ—เธตเน เธฃเธฒเธขเธเธฒเธฃเน€เธ•เธดเธกเธเนเธณเธกเธฑเธเธญเธฒเธเธเธฃเธญเธเธเธฅเธธเธกเธซเธฅเธฒเธขเธเธฒเธ",
      formula: "เธชเธนเธ•เธฃ",
      formulaText: "เธฃเธฐเธขเธฐเธ—เธฒเธเธฃเธงเธก รท เธฅเธดเธ•เธฃเธ—เธฑเนเธเธซเธกเธ” = เธเธก./เธฅเธดเธ•เธฃ",
      fuelCost: "เธเนเธฒเธเนเธณเธกเธฑเธเธ—เธฑเนเธเธซเธกเธ”",
      fuelEfficiency: "เธเธก./เธฅเธดเธ•เธฃ",
      fuelLogsMayCoverMultipleJobs: "เธฃเธฒเธขเธเธฒเธฃเน€เธ•เธดเธกเธเนเธณเธกเธฑเธเธญเธฒเธเธเธฃเธญเธเธเธฅเธธเธกเธซเธฅเธฒเธขเธเธฒเธ",
      fuelLogsUsed: "เธฃเธฒเธขเธเธฒเธฃเน€เธ•เธดเธกเธเนเธณเธกเธฑเธเธ—เธตเนเนเธเนเธเธณเธเธงเธ“",
      fuelUsed: "เธเนเธณเธกเธฑเธเธ—เธตเนเนเธเน",
      generated: "เธชเธฃเนเธฒเธเน€เธกเธทเนเธญ",
      howCalculated: "เธงเธดเธเธตเธเธณเธเธงเธ“",
      keySummary: "เธชเธฃเธธเธเธชเธณเธเธฑเธ",
      litres: "เธฅเธดเธ•เธฃ",
      mileage: "เน€เธฅเธเนเธกเธฅเน",
      mileageRange: "เธเนเธงเธเน€เธฅเธเนเธกเธฅเน",
      needsReceiptCheck: "เธ•เนเธญเธเธ•เธฃเธงเธเนเธเน€เธชเธฃเนเธ",
      notChecked: "เธขเธฑเธเนเธกเนเธ•เธฃเธงเธ",
      periodFuelEfficiency: "เธเธฃเธฐเธชเธดเธ—เธเธดเธ เธฒเธเธเนเธณเธกเธฑเธเธ•เธฒเธกเธเนเธงเธเธงเธฑเธเธ—เธตเน",
      readyToReview: "เธเธฃเนเธญเธกเธ•เธฃเธงเธเธชเธญเธ",
      receiptWarning: "เธกเธตเธเธฒเธเนเธเน€เธชเธฃเนเธเธ—เธตเนเธขเธฑเธเนเธกเนเนเธ”เนเธ•เธฃเธงเธ เธเธฃเธธเธ“เธฒเธ•เธฃเธงเธเธฃเธฒเธขเธเธฒเธฃเธเนเธณเธกเธฑเธเธเนเธญเธเนเธเนเธฃเธฒเธขเธเธฒเธเธเธตเนเน€เธเนเธเธเนเธญเธกเธนเธฅเธชเธฃเธธเธ",
      reportSentence: "เธเธณเธเธงเธ“เธเธฃเธฐเธชเธดเธ—เธเธดเธ เธฒเธเธเนเธณเธกเธฑเธเธ•เธฒเธกเธเนเธงเธเธงเธฑเธเธ—เธตเนเธ—เธตเนเน€เธฅเธทเธญเธ เธฃเธฒเธขเธเธฒเธฃเน€เธ•เธดเธกเธเนเธณเธกเธฑเธเธญเธฒเธเธเธฃเธญเธเธเธฅเธธเธกเธซเธฅเธฒเธขเธเธฒเธ",
      reportTitle: "เธฃเธฒเธขเธเธฒเธเธเธฃเธฐเธชเธดเธ—เธเธดเธ เธฒเธเธเธฒเธฃเนเธเนเธเนเธณเธกเธฑเธ",
      reportType: "เธเธฃเธฐเน€เธ เธ—เธฃเธฒเธขเธเธฒเธ",
      selectedFilters: "เธ•เธฑเธงเธเธฃเธญเธเธ—เธตเนเน€เธฅเธทเธญเธ",
      startMileage: "เน€เธฅเธเนเธกเธฅเนเน€เธฃเธดเนเธกเธ•เนเธ",
      status: "เธชเธ–เธฒเธเธฐ",
      subtitle: "เธฃเธฒเธขเธเธฒเธเธเธฃเธฐเธชเธดเธ—เธเธดเธ เธฒเธเธเนเธณเธกเธฑเธเธ•เธฒเธกเธเนเธงเธเธงเธฑเธเธ—เธตเน",
      totalLitres: "เธฅเธดเธ•เธฃเธ—เธฑเนเธเธซเธกเธ”",
      vehicle: "เธฃเธ–",
      vehicleReg: "เธ—เธฐเน€เธเธตเธขเธเธฃเธ–"
    };
  }

  return {
    actual: "Actual",
    checked: "Checked",
    checkedStatus: "Checked status",
    companyName: "Expert Express Sender Co., Ltd.",
    cost: "Cost",
    dataStatus: "Data status",
    date: "Date",
    dateRange: "Date range",
    distanceTravelled: "Distance travelled",
    driver: "Driver",
    endMileage: "End mileage",
    footer: "Generated automatically from verified mileage and fuel log data.",
    formula: "Formula",
    formulaText: `Distance travelled ${String.fromCharCode(247)} Total litres = km/L`,
    fuelCost: "Fuel cost",
    fuelEfficiency: "Fuel efficiency",
    fuelLogsMayCoverMultipleJobs: "Fuel logs may cover multiple jobs.",
    fuelLogsUsed: "Fuel receipts included in this calculation",
    fuelUsed: "Fuel used",
    generated: "Generated",
    howCalculated: "How this result was calculated",
    keySummary: "Key summary",
    litres: "Litres",
    mileage: "Mileage",
    mileageRange: "Mileage range",
    needsReceiptCheck: "Needs receipt check",
    notChecked: "Not checked",
    periodFuelEfficiency: "Period fuel efficiency",
    readyToReview: "Ready to review",
    receiptWarning: "Some receipts are not checked yet.",
    reportSentence:
      "Fuel efficiency is calculated across the selected period. Fuel logs may cover multiple jobs, so this is a period-based report.",
    reportTitle: "Fuel Efficiency Analysis",
    reportType: "Report type",
    selectedFilters: "Selected filters",
    startMileage: "Start mileage",
    status: "Status",
    subtitle: "Period fuel efficiency report",
    totalLitres: "Total litres",
    vehicle: "Vehicle",
    vehicleReg: "Vehicle reg"
  };
}

function repairPossiblyMojibakeThai(value: string) {
  if (!/[\u0080-\u009f]|เธ|เน/.test(value)) return value;
  const bytes: number[] = [];
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 0xff) {
      bytes.push(code);
    } else if (code >= 0x0e01 && code <= 0x0e5b) {
      bytes.push(code - 0x0d60);
    } else {
      bytes.push(...new TextEncoder().encode(character));
    }
  }
  return new TextDecoder("utf-8").decode(new Uint8Array(bytes));
}

function getThaiBossPdfCopy(): BossPdfCopy {
  return {
    actual: "คำนวณจริง",
    checked: "ตรวจแล้ว",
    checkedStatus: "สถานะ",
    companyName: "Expert Express Sender Co., Ltd.",
    cost: "ค่าใช้จ่าย",
    dataStatus: "สถานะข้อมูล",
    date: "วันที่",
    dateRange: "ช่วงวันที่",
    distanceTravelled: "ระยะทางรวม",
    driver: "คนขับ",
    endMileage: "เลขไมล์สิ้นสุด",
    footer: "สร้างอัตโนมัติจากข้อมูลเลขไมล์และรายการเติมน้ำมันที่ตรวจสอบแล้ว",
    formula: "สูตร",
    formulaText: `ระยะทางรวม ${String.fromCharCode(247)} ลิตรทั้งหมด = กม./ลิตร`,
    fuelCost: "ค่าน้ำมันทั้งหมด",
    fuelEfficiency: "กม./ลิตร",
    fuelLogsMayCoverMultipleJobs: "รายการเติมน้ำมันอาจครอบคลุมหลายงาน",
    fuelLogsUsed: "ใบเสร็จเติมน้ำมันที่ใช้ในการคำนวณ",
    fuelUsed: "น้ำมันที่ใช้",
    generated: "สร้างเมื่อ",
    howCalculated: "วิธีคำนวณผลลัพธ์นี้",
    keySummary: "สรุปสำคัญ",
    litres: "ลิตร",
    mileage: "เลขไมล์",
    mileageRange: "ช่วงเลขไมล์",
    needsReceiptCheck: "ต้องตรวจใบเสร็จ",
    notChecked: "ยังไม่ตรวจ",
    periodFuelEfficiency: "ประสิทธิภาพน้ำมันตามช่วงวันที่",
    readyToReview: "พร้อมตรวจสอบ",
    receiptWarning: "มีใบเสร็จเติมน้ำมันรอตรวจสอบ",
    reportSentence: "",
    reportTitle: "รายงานประสิทธิภาพการใช้น้ำมัน",
    reportType: "ประเภทรายงาน",
    selectedFilters: "ตัวกรองที่เลือก",
    startMileage: "เลขไมล์เริ่มต้น",
    status: "สถานะ",
    subtitle: "รายงานประสิทธิภาพน้ำมันตามช่วงวันที่",
    totalLitres: "ลิตรทั้งหมด",
    vehicle: "รถ",
    vehicleReg: "ทะเบียนรถ"
  };
}

function normalizeBossPdfCopy(copy: BossPdfCopy, language: "en" | "th"): BossPdfCopy {
  return language === "th" ? getThaiBossPdfCopy() : copy;
}

function getPdfFontFamily(language: "en" | "th") {
  return language === "th"
    ? '"BossPdfThai", Tahoma, sans-serif'
    : 'Arial, "Helvetica Neue", Helvetica, sans-serif';
}

async function loadBossPdfThaiFont() {
  if (typeof document === "undefined" || typeof FontFace === "undefined") return;
  const fonts = document.fonts;
  let fontAlreadyLoaded = false;
  fonts.forEach((font) => {
    if (font.family === "BossPdfThai") fontAlreadyLoaded = true;
  });
  if (fontAlreadyLoaded) return;
  const response = await fetch("/fonts/boss-pdf-thai.ttf");
  if (!response.ok) {
    throw new Error("Unable to load Thai PDF font.");
  }
  const fontData = await response.arrayBuffer();
  const font = new FontFace("BossPdfThai", fontData, {
    style: "normal",
    weight: "400"
  });
  await font.load();
  fonts.add(font);
  await fonts.ready;
}

function getCurrentPdfLanguage(fallback: "en" | "th") {
  if (typeof window === "undefined") return fallback;
  const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
  return stored === "en" || stored === "th" ? stored : fallback;
}

function normalizeFormulaSpacing(value: string) {
  return value.replace(/\s*÷\s*/g, " ÷ ").replace(/\s+/g, " ").trim();
}

async function loadCanvasImage(dataUrl: string) {
  const image = new Image();
  const loaded = new Promise<HTMLImageElement>((resolve, reject) => {
    image.onload = () => resolve(image);
    image.onerror = reject;
  });
  image.src = dataUrl;
  return loaded;
}

function binaryStringFromDataUrl(dataUrl: string) {
  return atob(dataUrl.split(",")[1] ?? "");
}

function buildImagePagesPdf(imagePages: Array<{ data: string; height: number; width: number }>) {
  const pageWidth = 595;
  const pageHeight = 842;
  const kids = imagePages.map((_, index) => `${3 + index * 3} 0 R`).join(" ");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${kids}] /Count ${imagePages.length} >>`
  ];

  imagePages.forEach((page, index) => {
    const imageName = `PageImage${index + 1}`;
    const contentStream = `q ${pageWidth} 0 0 ${pageHeight} 0 0 cm /${imageName} Do Q`;
    const pageObjectNumber = 3 + index * 3;
    const contentObjectNumber = pageObjectNumber + 1;
    const imageObjectNumber = pageObjectNumber + 2;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /XObject << /${imageName} ${imageObjectNumber} 0 R >> >> /Contents ${contentObjectNumber} 0 R >>`,
      `<< /Length ${contentStream.length} >>\nstream\n${contentStream}\nendstream`,
      `<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.data.length} >>\nstream\n${page.data}\nendstream`
    );
  });

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  const bytes = new Uint8Array(pdf.length);
  for (let index = 0; index < pdf.length; index += 1) {
    bytes[index] = pdf.charCodeAt(index) & 0xff;
  }
  return new Blob([bytes], { type: "application/pdf" });
}

async function buildBossFuelEfficiencyCanvasPdf(data: BossPdfReportData, logo: PdfLogo, language: "en" | "th") {
  if (language === "th") {
    await loadBossPdfThaiFont();
  }

  const pageWidth = 595;
  const pageHeight = 842;
  const scale = 2;
  const copy = normalizeBossPdfCopy(getBossPdfCopy(language), language);
  const fontFamily = getPdfFontFamily(language);
  const margin = 42;
  const contentWidth = pageWidth - margin * 2;
  const isThai = language === "th";
  const tableBottom = 746;
  const pageImages: Array<{ data: string; height: number; width: number }> = [];

  const color = {
    border: "#e2e8f0",
    green: "#047857",
    greenBg: "#ecfdf5",
    greenBorder: "#86efac",
    muted: "#64748b",
    orange: "#9a3412",
    orangeBg: "#fff7ed",
    orangeBorder: "#fdba74",
    purple: "#5b21b6",
    soft: "#f8fafc",
    text: "#0f172a"
  };
  const totalFuelLogsLabel = isThai ? "\u0e08\u0e33\u0e19\u0e27\u0e19\u0e43\u0e1a\u0e40\u0e2a\u0e23\u0e47\u0e08\u0e17\u0e31\u0e49\u0e07\u0e2b\u0e21\u0e14" : "Total fuel logs";
  let canvas!: HTMLCanvasElement;
  let context!: CanvasRenderingContext2D;
  let pageNumber = 0;

  const setFont = (size: number, weight: 400 | 500 | 600 | 700 = 400) => {
    context.font = `${weight} ${size}px ${fontFamily}`;
  };
  const drawText = (
    value: unknown,
    x: number,
    y: number,
    options: { color?: string; maxWidth?: number; size?: number; weight?: 400 | 500 | 600 | 700 } = {}
  ) => {
    const size = options.size ?? 9;
    setFont(size, options.weight ?? 400);
    context.fillStyle = options.color ?? color.text;
    let textValue = String(value ?? "-").replace(/\s+/g, " ").trim();
    if (options.maxWidth && context.measureText(textValue).width > options.maxWidth) {
      while (textValue.length > 1 && context.measureText(`${textValue}...`).width > options.maxWidth) {
        textValue = textValue.slice(0, -1);
      }
      textValue = `${textValue}...`;
    }
    context.fillText(textValue, x, y);
  };
  const fillRect = (x: number, y: number, width: number, height: number, fill: string, stroke?: string) => {
    context.fillStyle = fill;
    context.fillRect(x, y, width, height);
    if (stroke) {
      context.strokeStyle = stroke;
      context.lineWidth = 1;
      context.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);
    }
  };
  const line = (x1: number, y1: number, x2: number, y2: number, stroke = color.border) => {
    context.strokeStyle = stroke;
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(x1, y1 + 0.5);
    context.lineTo(x2, y2 + 0.5);
    context.stroke();
  };
  const drawSectionTitle = (title: string, y: number) => {
    drawText(title, margin, y, { size: isThai ? 9.5 : 10, weight: 700 });
  };
  const drawFooter = () => {
    drawText(copy.companyName, margin, 786, { color: color.text, maxWidth: contentWidth, size: isThai ? 7 : 7.6, weight: 700 });
    drawText("Fuel Efficiency Analysis Report", margin, 799, { color: color.muted, maxWidth: contentWidth, size: isThai ? 6.6 : 7.4, weight: 700 });
    drawText(copy.footer, margin, 812, { color: color.muted, maxWidth: contentWidth - 40, size: isThai ? 6.2 : 7 });
    drawText(String(pageNumber), pageWidth - margin - 8, 812, { color: color.muted, size: 7, weight: 700 });
  };
  const startPage = (continuation = false) => {
    pageNumber += 1;
    canvas = document.createElement("canvas");
    canvas.width = pageWidth * scale;
    canvas.height = pageHeight * scale;
    const nextContext = canvas.getContext("2d");
    if (!nextContext) {
      throw new Error("Unable to prepare PDF canvas.");
    }
    context = nextContext;
    context.scale(scale, scale);
    fillRect(0, 0, pageWidth, pageHeight, "#ffffff");
    fillRect(0, 0, 8, pageHeight, "#6d28d9");

    if (continuation) {
      fillRect(0, 0, pageWidth, 52, color.soft);
      drawText(copy.companyName, margin, 22, { size: isThai ? 8 : 8.7, weight: 700 });
      drawText(copy.reportTitle, margin, 39, { color: color.purple, size: isThai ? 10.5 : 12, weight: 700, maxWidth: 280 });
      drawText(`${copy.generated}: ${data.generatedAt}`, 340, 30, { color: color.muted, size: isThai ? 6.8 : 7.4, maxWidth: 210 });
      return 76;
    }

    fillRect(0, 0, pageWidth, 62, color.soft);
    return 84;
  };
  const finishPage = () => {
    drawFooter();
    const pageImage = canvas.toDataURL("image/jpeg", 0.92);
    pageImages.push({
      data: binaryStringFromDataUrl(pageImage),
      height: canvas.height,
      width: canvas.width
    });
  };

  let y = startPage(false);

  if (logo?.dataUrl) {
    try {
      const logoImage = await loadCanvasImage(logo.dataUrl);
      context.drawImage(logoImage, margin, 18, 28, 28);
    } catch {
      fillRect(margin, 18, 28, 28, "#ede9fe", "#c4b5fd");
      drawText("EES", margin + 6, 36, { color: color.purple, size: 8, weight: 700 });
    }
  } else {
    fillRect(margin, 18, 28, 28, "#ede9fe", "#c4b5fd");
    drawText("EES", margin + 6, 36, { color: color.purple, size: 8, weight: 700 });
  }

  drawText(copy.companyName, 82, 27, { size: isThai ? 8.2 : 9, weight: 700 });
  drawText(copy.reportTitle, 82, 44, { color: color.purple, size: isThai ? 13 : 15, weight: 700, maxWidth: 275 });
  drawText(copy.subtitle, 340, 31, { color: color.muted, size: isThai ? 7.4 : 8, maxWidth: 210, weight: 600 });
  drawText(`${copy.generated}: ${data.generatedAt}`, 340, 46, { color: color.muted, size: isThai ? 7.2 : 7.6, maxWidth: 210 });

  drawSectionTitle(copy.selectedFilters, y);
  y += 9;
  const filterCards = [
    [copy.driver, data.driver],
    [copy.vehicleReg, data.vehicleReg],
    [copy.dateRange, data.dateRange],
    [copy.reportType, copy.periodFuelEfficiency]
  ];
  const filterWidths = [118, 100, 152, 120];
  let x = margin;
  filterCards.forEach(([label, value], index) => {
    const width = filterWidths[index];
    fillRect(x, y, width, 26, color.soft, color.border);
    drawText(label, x + 7, y + 10, { color: color.muted, maxWidth: width - 14, size: isThai ? 6.4 : 6.8, weight: 700 });
    drawText(value, x + 7, y + 21, { maxWidth: width - 14, size: isThai ? 7.1 : 7.8, weight: 700 });
    x += width + 7;
  });
  y += 48;

  drawSectionTitle(copy.keySummary, y);
  y += 10;
  const summaryCards = [
    [copy.distanceTravelled, data.tripKm],
    [copy.totalLitres, data.totalLitres],
    [copy.fuelCost, data.totalFuelCost],
    [copy.fuelEfficiency, data.fuelEfficiency]
  ];
  const summaryWidth = (contentWidth - 24) / 4;
  summaryCards.forEach(([label, value], index) => {
    const cardX = margin + index * (summaryWidth + 8);
    const isEfficiency = index === 3;
    fillRect(cardX, y, summaryWidth, 38, isEfficiency ? color.greenBg : "#ffffff", isEfficiency ? color.greenBorder : color.border);
    drawText(label, cardX + 7, y + 12, { color: color.muted, maxWidth: summaryWidth - 14, size: isThai ? 6.2 : 6.8, weight: 700 });
    drawText(value, cardX + 7, y + 29, {
      color: isEfficiency ? color.green : color.text,
      maxWidth: summaryWidth - 14,
      size: isEfficiency ? (isThai ? 10.3 : 11.5) : isThai ? 9.2 : 10.4,
      weight: 700
    });
  });
  y += 60;

  drawSectionTitle(copy.fuelLogsUsed, y);
  y += 9;
  const tableColumns = [
    [copy.date, 69],
    [copy.vehicle, 73],
    [copy.mileage, 88],
    [copy.litres, 65],
    [copy.cost, 92],
    [copy.checkedStatus, 82]
  ] as [string, number][];
  const tableWidth = tableColumns.reduce((sum, [, width]) => sum + width, 0);
  const rowHeight = 20;
  const totalRowHeight = 24;
  const drawTableHeader = (headerY: number) => {
    fillRect(margin, headerY, tableWidth, 20, color.soft, color.border);
    x = margin;
    tableColumns.forEach(([label, width], index) => {
      drawText(label, x + 5, headerY + 13, { color: color.muted, maxWidth: width - 8, size: isThai ? 6.2 : 6.8, weight: 700 });
      if (index > 0) line(x, headerY, x, headerY + 20, "#edf2f7");
      x += width;
    });
    return headerY + 20;
  };
  const continueTableOnNewPage = () => {
    finishPage();
    y = startPage(true);
    drawSectionTitle(copy.fuelLogsUsed, y);
    y += 9;
    y = drawTableHeader(y);
  };

  y = drawTableHeader(y);
  if (data.fuelLogs.length) {
    data.fuelLogs.forEach((row) => {
      if (y + rowHeight > tableBottom) {
        continueTableOnNewPage();
      }
      fillRect(margin, y, tableWidth, rowHeight, "#ffffff", color.border);
      const values = [row.date, row.vehicle, row.mileage, row.litres, row.cost, row.checkedStatus];
      x = margin;
      values.forEach((value, index) => {
        const width = tableColumns[index][1];
        const isUnchecked = index === 5 && value === copy.notChecked;
        drawText(value, x + 5, y + 13, {
          color: isUnchecked ? color.orange : color.text,
          maxWidth: width - 8,
          size: isThai ? 6.6 : 7.4,
          weight: index === 5 ? 700 : 400
        });
        x += width;
      });
      y += rowHeight;
    });
  } else {
    fillRect(margin, y, tableWidth, rowHeight, "#ffffff", color.border);
    drawText("-", margin + 5, y + 13, { color: color.muted, size: 7.4 });
    y += rowHeight;
  }
  if (y + totalRowHeight > tableBottom) {
    continueTableOnNewPage();
  }
  fillRect(margin, y, tableWidth, totalRowHeight, "#f8fafc", color.border);
  drawText(`${totalFuelLogsLabel}: ${data.totalFuelLogCount}`, margin + 7, y + 15, {
    color: color.text,
    maxWidth: 130,
    size: isThai ? 6.8 : 7.5,
    weight: 700
  });
  drawText(`${copy.totalLitres}: ${data.totalLitres}`, margin + 155, y + 15, {
    color: color.text,
    maxWidth: 140,
    size: isThai ? 6.8 : 7.5,
    weight: 700
  });
  drawText(`${copy.fuelCost}: ${data.totalFuelCost}`, margin + 310, y + 15, {
    color: color.text,
    maxWidth: 180,
    size: isThai ? 6.8 : 7.5,
    weight: 700
  });
  y += totalRowHeight + 21;

  if (y + 150 > tableBottom) {
    finishPage();
    y = startPage(true);
  }

  drawSectionTitle(copy.howCalculated, y);
  y += 9;
  fillRect(margin, y, contentWidth, 86, color.soft, color.border);
  const calculationRows = [
    [copy.mileageRange, `${data.mileageRange.startMileage} ${String.fromCharCode(8594)} ${data.mileageRange.endMileage}`],
    [copy.distanceTravelled, data.mileageRange.distanceTravelled],
    [copy.fuelUsed, data.totalLitres],
    [copy.fuelEfficiency, data.actualCalculation]
  ];
  calculationRows.forEach(([label, value], index) => {
    const rowY = y + 18 + index * 18;
    drawText(label, margin + 12, rowY, {
      color: color.muted,
      maxWidth: 135,
      size: isThai ? 7.1 : 7.8,
      weight: 700
    });
    drawText(value, margin + 162, rowY, {
      color: index === 3 ? color.green : color.text,
      maxWidth: contentWidth - 178,
      size: index === 3 ? (isThai ? 8.6 : 9.8) : isThai ? 7.8 : 8.8,
      weight: 700
    });
  });
  y += 106;

  const isWarning = data.dataStatus === "warning";
  const statusIcon = isWarning ? String.fromCharCode(9888) : String.fromCharCode(10003);
  const statusText = isWarning ? data.dataStatusDetail : data.dataStatusTitle;
  fillRect(margin, y, contentWidth, 28, isWarning ? color.orangeBg : color.greenBg, isWarning ? color.orangeBorder : color.greenBorder);
  drawText(`${statusIcon} ${statusText}`, margin + 10, y + 18, {
    color: isWarning ? color.orange : color.green,
    maxWidth: contentWidth - 20,
    size: isThai ? 7.4 : 8.4,
    weight: 700
  });

  finishPage();
  return buildImagePagesPdf(pageImages);
}

async function buildBossFuelEfficiencyPdf(data: BossPdfReportData, logo: PdfLogo, language: "en" | "th") {
  return buildBossFuelEfficiencyCanvasPdf(data, logo, language);
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

function getFuelLogPricePerLitre(log: Pick<FuelLogWithDriver, "litres" | "total_cost">) {
  const litres = Number(log.litres || 0);
  const totalCost = Number(log.total_cost || 0);
  return litres > 0 && Number.isFinite(totalCost) ? totalCost / litres : null;
}

function formatPricePerLitre(value: number | null | undefined, language: "en" | "th") {
  return value != null && Number.isFinite(value)
    ? `THB ${formatNumber(value, language, 2)}/L`
    : "—";
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
function getFuelTypeLabelWithFallback(t: ReturnType<typeof useLanguage>["t"], value: string | null | undefined) {
  return getFuelTypeLabel(t, normalizeFuelTypeKey(value) ?? DEFAULT_FUEL_TYPE);
}

function getPaymentMethodLabelWithFallback(t: ReturnType<typeof useLanguage>["t"], value: string | null | undefined) {
  return getPaymentMethodLabel(t, normalizePaymentMethodKey(value) ?? DEFAULT_PAYMENT_METHOD);
}

function toDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getWeekStart(date: Date) {
  const next = new Date(date);
  const day = next.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  next.setDate(next.getDate() + diff);
  return next;
}

function formatFuelDateHeading(value: string, language: "en" | "th") {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const parsed = match
    ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
    : new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return formatDate(value, language);
  }

  return new Intl.DateTimeFormat(language === "th" ? "th-TH" : "en-GB", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric"
  }).format(parsed);
}

export default function FuelLogsPage() {
  const { language, t } = useLanguage();
  const searchParams = useSearchParams();
  const copy = {
    dateRange: language === "th" ? "เธเนเธงเธเธงเธฑเธเธ—เธตเน" : "Date range",
    driver: language === "th" ? "เธเธเธเธฑเธ" : "Driver",
    vehicle: language === "th" ? "เธ—เธฐเน€เธเธตเธขเธเธฃเธ–" : "Vehicle reg",
    payment: language === "th" ? "เธงเธดเธเธตเธเธณเธฃเธฐเน€เธเธดเธ" : "Payment method",
    totalCostRange: language === "th" ? "เธเนเธงเธเธขเธญเธ”เน€เธเธดเธ" : "Total cost range",
    min: language === "th" ? "เธ•เนเธณเธชเธธเธ”" : "Min",
    max: language === "th" ? "เธชเธนเธเธชเธธเธ”" : "Max",
    clear: language === "th" ? "เธฅเนเธฒเธเธ•เธฑเธงเธเธฃเธญเธ" : "Clear filters",
    matches: language === "th" ? "เธฃเธฒเธขเธเธฒเธฃ" : "entries",
    duplicateTitle: language === "th" ? "เธเธเธฃเธฒเธขเธเธฒเธฃเธ—เธตเนเธญเธฒเธเธเนเธณเธเธฑเธ" : "Possible duplicate found",
    duplicateHint:
      language === "th"
        ? "เธงเธฑเธเธ—เธตเน เธ—เธฐเน€เธเธตเธขเธเธฃเธ– เธขเธญเธ”เน€เธเธดเธ เนเธฅเธฐเธฅเธดเธ•เธฃเนเธเธฅเนเน€เธเธตเธขเธเธเธฑเธเธฃเธฒเธขเธเธฒเธฃเธ—เธตเนเธกเธตเธญเธขเธนเนเนเธฅเนเธง"
        : "This entry is close to an existing record on the same date and vehicle.",
    saveAnyway: language === "th" ? "เธเธฑเธเธ—เธถเธเธ•เนเธญ" : "Save anyway",
    cancel: language === "th" ? "เธขเธเน€เธฅเธดเธ" : "Cancel",
    deleteConfirm: language === "th" ? "เธฅเธเธฃเธฒเธขเธเธฒเธฃเธเธตเนเนเธเนเธซเธฃเธทเธญเนเธกเน" : "Delete this fuel entry?",
    filters: language === "th" ? "เธ•เธฑเธงเธเธฃเธญเธ" : "Filters",
    all: language === "th" ? "เธ—เธฑเนเธเธซเธกเธ”" : "All",
    noResultsTitle: language === "th" ? "เนเธกเนเธเธเธเธฅเธฅเธฑเธเธเน" : "No results",
    noResultsDescription:
      language === "th"
        ? "เนเธกเนเธเธเธฃเธฒเธขเธเธฒเธฃเธ—เธตเนเธ•เธฃเธเธเธฑเธเธ•เธฑเธงเธเธฃเธญเธเธเธตเน"
        : "No fuel entries match the current filters.",
    deleteError:
      language === "th" ? "เนเธกเนเธชเธฒเธกเธฒเธฃเธ–เธฅเธเธเธฑเธเธ—เธถเธเธฃเธฒเธขเธเธฒเธฃเธเนเธณเธกเธฑเธเนเธ”เน" : "Unable to delete fuel log.",
    deleteSuccess:
      language === "th" ? "เธฅเธเธเธฑเธเธ—เธถเธเธฃเธฒเธขเธเธฒเธฃเธเนเธณเธกเธฑเธเน€เธฃเธตเธขเธเธฃเนเธญเธขเนเธฅเนเธง" : "Fuel entry deleted successfully.",
    autoFillLabel:
      language === "th"
        ? "เธเธฃเธญเธเธเธฒเธเธเธเธเธฑเธเธญเธฑเธ•เนเธเธกเธฑเธ•เธด เนเธฅเธฐเธขเธฑเธเนเธเนเนเธเนเธ”เน"
        : "Auto-filled based on driver and can still be changed",
    noVehicleAssignedLabel:
      language === "th"
        ? "เธเธเธเธฑเธเธขเธฑเธเนเธกเนเธกเธตเธฃเธ–เธ—เธตเนเธเธนเธเนเธงเน เนเธเธฃเธ”เน€เธฅเธทเธญเธเน€เธญเธ"
        : "No vehicle assigned. Please select one manually.",
    previousEntryHelper:
      language === "th"
        ? "เธขเธฑเธเนเธกเนเธกเธตเธฃเธฒเธขเธเธฒเธฃเธเนเธญเธเธซเธเนเธฒเธเธตเนเธชเธณเธซเธฃเธฑเธเธฃเธ–เธเธฑเธเธเธตเนเนเธเธงเธฑเธเธ—เธตเนเน€เธฅเธทเธญเธเธซเธฃเธทเธญเธเนเธญเธขเธเธงเนเธฒ"
        : "No earlier entry for this vehicle on or before this date.",
    entrySeparator: " - ",
    previousPage: language === "th" ? "เธเนเธญเธเธซเธเนเธฒ" : "Previous",
    nextPage: language === "th" ? "เธ–เธฑเธ”เนเธ" : "Next",
    pageLabel: language === "th" ? "เธซเธเนเธฒ" : "Page",
    ofLabel: language === "th" ? "เธเธฒเธ" : "of",
    possibleDuplicate: language === "th" ? "เธญเธฒเธเน€เธเนเธเธฃเธฒเธขเธเธฒเธฃเธเนเธณ" : "Possible duplicate entry",
    missingOdometer: language === "th" ? "เนเธกเนเธกเธตเน€เธฅเธเนเธกเธฅเน" : "Missing mileage",
    pricePerLitreThb: language === "th" ? "ราคาต่อลิตร (THB/L)" : "Price per litre (THB/L)",
    averagePricePerLitreShort: language === "th" ? "เฉลี่ย THB/L" : "Avg THB/L",
    sortAscending: language === "th" ? "เรียงจากต่ำไปสูง" : "Lowest to highest",
    sortDescending: language === "th" ? "เรียงจากสูงไปต่ำ" : "Highest to lowest"
  };

  const uxCopy = {
    openAnalysis: language === "th" ? "เน€เธเธดเธ”เธเธฒเธฃเธงเธดเน€เธเธฃเธฒเธฐเธซเน" : "Open analysis",
    hideAnalysis: language === "th" ? "เธเนเธญเธเธเธฒเธฃเธงเธดเน€เธเธฃเธฒเธฐเธซเน" : "Hide analysis",
    last7DaysSummary: language === "th" ? "เธชเธฃเธธเธ 7 เธงเธฑเธเธฅเนเธฒเธชเธธเธ”" : "Last 7 Days Summary",
    totalSpend: language === "th" ? "เธขเธญเธ”เนเธเนเธเนเธฒเธขเธฃเธงเธก" : "Total spend",
    totalLitres: language === "th" ? "เธฅเธดเธ•เธฃเธฃเธงเธก" : "Total litres",
    averagePriceLitre: language === "th" ? "เธฃเธฒเธเธฒเน€เธเธฅเธตเนเธข/เธฅเธดเธ•เธฃ" : "Average price/L",
    highestDay: language === "th" ? "เธงเธฑเธเธ—เธตเนเนเธเนเธเนเธฒเธขเธชเธนเธเธชเธธเธ”" : "Highest day",
    viewDay: language === "th" ? "เธ”เธนเธงเธฑเธเธเธตเน" : "View day",
    quickFilters: language === "th" ? "เธ•เธฑเธงเธเธฃเธญเธเน€เธฃเนเธง" : "Quick filters",
    today: language === "th" ? "เธงเธฑเธเธเธตเน" : "Today",
    yesterday: language === "th" ? "เน€เธกเธทเนเธญเธงเธฒเธ" : "Yesterday",
    thisWeek: language === "th" ? "เธชเธฑเธเธ”เธฒเธซเนเธเธตเน" : "This week",
    thisMonth: language === "th" ? "เน€เธ”เธทเธญเธเธเธตเน" : "This month",
    notChecked: language === "th" ? "เธขเธฑเธเนเธกเนเธ•เธฃเธงเธ" : "Not checked",
    checked: language === "th" ? "เธ•เธฃเธงเธเนเธฅเนเธง" : "Checked",
    viewMissingMileage: language === "th" ? "เธ”เธนเธฃเธฒเธขเธเธฒเธฃเธเธฒเธ”เน€เธฅเธเนเธกเธฅเน" : "View missing mileage",
    advancedFilters: language === "th" ? "เธ•เธฑเธงเธเธฃเธญเธเธเธฑเนเธเธชเธนเธ" : "Advanced filters",
    moreDetails: language === "th" ? "เธฃเธฒเธขเธฅเธฐเน€เธญเธตเธขเธ”" : "Details",
    hideDetails: language === "th" ? "เธเนเธญเธเธฃเธฒเธขเธฅเธฐเน€เธญเธตเธขเธ”" : "Hide details",
    trip: language === "th" ? "เธ—เธฃเธดเธ" : "Trip",
    notes: language === "th" ? "เธซเธกเธฒเธขเน€เธซเธ•เธธ" : "Notes",
    receiptSource: language === "th" ? "เนเธซเธฅเนเธเนเธเน€เธชเธฃเนเธ" : "Receipt source",
    pendingCheck: language === "th" ? "เธฃเธญเธ•เธฃเธงเธ" : "Pending check",
    expandAll: language === "th" ? "เธเธขเธฒเธขเธ—เธฑเนเธเธซเธกเธ”" : "Expand all",
    collapseAll: language === "th" ? "เธขเนเธญเธ—เธฑเนเธเธซเธกเธ”" : "Collapse all",
    expand: language === "th" ? "เน€เธเธดเธ”" : "Expand",
    collapse: language === "th" ? "เธขเนเธญ" : "Collapse"
  };

  const exportButtonLabel = language === "th" ? "เธเธณเธฅเธฑเธเธชเนเธเธญเธญเธ..." : "Exporting...";
  const exportSuccessMessage =
    language === "th"
      ? "เธชเนเธเธญเธญเธเธฃเธฒเธขเธเธฒเธฃเน€เธ•เธดเธกเธเนเธณเธกเธฑเธเธชเธณเน€เธฃเนเธ"
      : "Fuel logs exported successfully.";
  const exportErrorMessage =
    language === "th"
      ? "เนเธกเนเธชเธฒเธกเธฒเธฃเธ–เธชเนเธเธญเธญเธเธฃเธฒเธขเธเธฒเธฃเน€เธ•เธดเธกเธเนเธณเธกเธฑเธเนเธ”เน"
      : "Unable to export fuel logs.";

  const statementEntryCopy = {
    keepDetails: "Keep details for next entry",
    statementModeHelper:
      "Statement mode: Save and add another keeps driver, vehicle, station and payment details."
  };

  const receiptCopy = {
    filterLabel: language === "th" ? "เธชเธ–เธฒเธเธฐเธ•เธฃเธงเธเนเธเน€เธชเธฃเนเธ" : "Receipt check",
    checked: language === "th" ? "เธ•เธฃเธงเธเนเธฅเนเธง" : "Checked",
    notChecked: language === "th" ? "เธขเธฑเธเนเธกเนเธ•เธฃเธงเธ" : "Not checked",
    markShort: language === "th" ? "เธ—เธณเน€เธเธฃเธทเนเธญเธเธซเธกเธฒเธข" : "Mark",
    markChecked: language === "th" ? "เธ—เธณเน€เธเธฃเธทเนเธญเธเธซเธกเธฒเธขเธงเนเธฒเธ•เธฃเธงเธเนเธฅเนเธง" : "Mark checked",
    markUnchecked: language === "th" ? "เธขเธเน€เธฅเธดเธเน€เธเธฃเธทเนเธญเธเธซเธกเธฒเธขเธ•เธฃเธงเธเนเธฅเนเธง" : "Mark unchecked",
    updated: language === "th" ? "เธญเธฑเธเน€เธ”เธ•เธชเธ–เธฒเธเธฐเธ•เธฃเธงเธเนเธเน€เธชเธฃเนเธเนเธฅเนเธง" : "Receipt check status updated.",
    error:
      language === "th" ? "เนเธกเนเธชเธฒเธกเธฒเธฃเธ–เธญเธฑเธเน€เธ”เธ•เธชเธ–เธฒเธเธฐเธ•เธฃเธงเธเนเธเน€เธชเธฃเนเธเนเธ”เน" : "Unable to update receipt check status.",
    totalCount: language === "th" ? "เธฃเธฒเธขเธเธฒเธฃเน€เธ•เธดเธกเธเนเธณเธกเธฑเธเธ—เธฑเนเธเธซเธกเธ”" : "Total fuel logs",
    checkedCount: language === "th" ? "เธ•เธฃเธงเธเนเธฅเนเธง" : "Checked",
    notCheckedCount: language === "th" ? "เธขเธฑเธเนเธกเนเธ•เธฃเธงเธ" : "Not checked"
  };

  const fuelTypeOptions = FUEL_TYPE_KEYS.map((value) => ({ value, label: t.fuel.type[value] }));
  const paymentMethodOptions = PAYMENT_METHOD_KEYS.map((value) => ({
    value,
    label: t.payment.method[value]
  }));
  const sourceCopy = {
    label: language === "th" ? "เนเธซเธฅเนเธเธ—เธตเนเธกเธฒ" : "Entry source",
    filterLabel: language === "th" ? "เนเธซเธฅเนเธเธ—เธตเนเธกเธฒเธฃเธฒเธขเธเธฒเธฃ" : "Log source",
    all: language === "th" ? "เธ—เธธเธเนเธซเธฅเนเธเธ—เธตเนเธกเธฒ" : "All sources",
    quickSelect: language === "th" ? "เน€เธฅเธทเธญเธเน€เธฃเนเธง" : "Quick select",
    auditHint:
      language === "th"
        ? "เธฃเธฒเธขเธเธฒเธฃเธเธตเนเน€เธเธดเนเธกเธเธฒเธเนเธเน€เธชเธฃเนเธเธเธฃเธดเธ เน€เธซเธกเธฒเธฐเธชเธณเธซเธฃเธฑเธเธ•เธฃเธงเธเธชเธญเธเธขเนเธญเธเธซเธฅเธฑเธ"
        : "Added from a physical receipt for audit/reconciliation.",
    options: {
      line_message: language === "th" ? "เธเนเธญเธเธงเธฒเธก LINE" : "Line message",
      direct_from_receipt: language === "th" ? "เธเธฒเธเนเธเน€เธชเธฃเนเธเนเธ”เธขเธ•เธฃเธ" : "Direct from receipt",
      statement_manual: "Direct from statement",
      statement_import: language === "th" ? "Statement import" : "Statement import",
      other: language === "th" ? "เธญเธทเนเธเน" : "Other"
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
  const [tripFuelLinks, setTripFuelLinks] = useState<TripFuelLogLink[]>([]);
  const [last7DayRows, setLast7DayRows] = useState<FuelLogDaySummary[]>([]);
  const [form, setForm] = useState(initialForm);
  const [filters, setFilters] = useState<FuelLogFilters>(() => getStoredFilters());
  const [efficiencyFilters, setEfficiencyFilters] = useState<EfficiencyFilters>(initialEfficiencyFilters);
  const [efficiencyCalculationMode, setEfficiencyCalculationMode] = useState<EfficiencyCalculationMode>("per_fill");
  const [efficiencyAnalysisOpen, setEfficiencyAnalysisOpen] = useState(false);
  const [advancedFiltersOpen, setAdvancedFiltersOpen] = useState(false);
  const [missingMileageExpanded, setMissingMileageExpanded] = useState(false);
  const [missingMileageEntryFilter, setMissingMileageEntryFilter] = useState(false);
  const [expandedFuelDates, setExpandedFuelDates] = useState<Set<string>>(new Set());
  const [expandedFuelEntryDetails, setExpandedFuelEntryDetails] = useState<Set<string>>(new Set());
  const [sortKey, setSortKey] = useState<FuelLogSortKey>("date");
  const [sortDirection, setSortDirection] = useState<FuelLogSortDirection>("desc");
  const [currentPage, setCurrentPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportingBossPdf, setExportingBossPdf] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [togglingReceiptId, setTogglingReceiptId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [submitMode, setSubmitMode] = useState<"save" | "addAnother">("save");
  const [keepDetailsForNextEntry, setKeepDetailsForNextEntry] = useState(true);
  const [lastEditedFuelField, setLastEditedFuelField] = useState<"litres" | "total_cost" | "price_per_litre">("total_cost");
  const [pendingDraft, setPendingDraft] = useState<FuelDraft | null>(null);
  const [duplicateMatches, setDuplicateMatches] = useState<FuelLogWithDriver[]>([]);
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
  const last7DaysSummary = useMemo(() => {
    const totalSpend = last7DayRows.reduce((sum, row) => sum + Number(row.spend || 0), 0);
    const totalLitres = last7DayRows.reduce((sum, row) => sum + Number(row.litres || 0), 0);
    const totalEntries = last7DayRows.reduce((sum, row) => sum + Number(row.entries || 0), 0);
    const highestDay = [...last7DayRows].sort((a, b) => Number(b.spend || 0) - Number(a.spend || 0))[0] ?? null;

    return {
      totalSpend,
      totalLitres,
      totalEntries,
      averagePricePerLitre: totalLitres > 0 ? totalSpend / totalLitres : null,
      highestDay
    };
  }, [last7DayRows]);

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
  const tripLinkCountByFuelLogId = useMemo(
    () =>
      tripFuelLinks.reduce((map, link) => {
        const id = String(link.fuel_log_id);
        map.set(id, (map.get(id) ?? 0) + 1);
        return map;
      }, new Map<string, number>()),
    [tripFuelLinks]
  );
  const getFuelTripLinkCount = (log: FuelLogWithDriver) => tripLinkCountByFuelLogId.get(String(log.id)) ?? 0;
  const getFuelTripLabel = (log: FuelLogWithDriver) => {
    const count = getFuelTripLinkCount(log);
    if (count <= 0) return language === "th" ? "ยังไม่เชื่อมกับทริป" : "Not linked to trip";
    const tripText = language === "th"
      ? `เชื่อมกับ ${formatNumber(count, language)} ทริป`
      : count === 1 ? "Linked to 1 trip" : `Linked to ${count} trips`;
    const cycleText = language === "th" ? "ใช้ในรอบน้ำมัน" : "Used in fuel cycle";
    return `${tripText} · ${cycleText}`;
  };
  const getFuelTripBadgeClass = (log: FuelLogWithDriver) =>
    getFuelTripLinkCount(log) > 0
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : "border-slate-200 bg-slate-50 text-slate-600";
  const getPricePerLitreClass = (pricePerLitre: number | null, averagePricePerLitre: number | null) => {
    if (pricePerLitre == null || averagePricePerLitre == null || averagePricePerLitre <= 0) {
      return "text-slate-600";
    }
    if (pricePerLitre >= averagePricePerLitre * 1.1) return "text-rose-700";
    if (pricePerLitre > averagePricePerLitre) return "text-amber-700";
    if (pricePerLitre <= averagePricePerLitre * 0.9) return "text-emerald-700";
    return "text-slate-700";
  };
  const toggleFuelLogSort = (nextSortKey: FuelLogSortKey) => {
    setCurrentPage(1);
    setSortKey((currentKey) => {
      if (currentKey !== nextSortKey) {
        setSortDirection(nextSortKey === "price_per_litre" ? "asc" : "desc");
        return nextSortKey;
      }
      setSortDirection((currentDirection) => (currentDirection === "asc" ? "desc" : "asc"));
      return currentKey;
    });
  };
  const getSortLabel = (targetSortKey: FuelLogSortKey) =>
    sortKey === targetSortKey
      ? sortDirection === "asc"
        ? copy.sortAscending
        : copy.sortDescending
      : "";

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
    const vehicleKeys = new Set(
      logs
        .map((log) => normalizeVehicleRegistration(log.vehicle_reg))
        .filter((vehicleReg): vehicleReg is string => Boolean(vehicleReg))
    );
    const mileageVehicleKeys = new Set(
      mileageLogs
        .map((log) => normalizeVehicleRegistration(log.vehicle_reg))
        .filter((vehicleReg): vehicleReg is string => Boolean(vehicleReg))
    );
    const hasMultipleVehicles = vehicleKeys.size > 1 || mileageVehicleKeys.size > 1;
    const canUseMileageRange = !hasMultipleVehicles;
    const startMileage = canUseMileageRange && mileageLogs.length ? getMileageValue(mileageLogs[0].mileage) : null;
    const endMileage =
      canUseMileageRange && mileageLogs.length ? getMileageValue(mileageLogs[mileageLogs.length - 1].mileage) : null;
    const totalLitres = logs.reduce((sum, log) => sum + getNumericValue(log.litres), 0);
    const totalFuelCost = logs.reduce((sum, log) => sum + getNumericValue(log.total_cost), 0);
    const receiptCheckedCount = logs.filter((log) => log.receipt_checked).length;
    const receiptUncheckedCount = logs.length - receiptCheckedCount;
    const missingMileageCount = logs.filter((log) => getMileageValue(log.mileage) == null).length;

    let status: TripSummaryStatus = "not_enough_data";
    let reason: string = t.fuelLogs.efficiency.tripNeedTwoMileageRecords;
    let tripKm: number | null = null;
    let tripKmPerLitre: number | null = null;

    if (hasMultipleVehicles) {
      status = "multiple_vehicles";
      reason = "Select one vehicle for accurate mileage-based efficiency.";
    } else if (mileageLogs.length < 2 || startMileage == null || endMileage == null) {
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
      vehicleCount: vehicleKeys.size,
      status,
      reason
    };
  }, [t.fuelLogs.efficiency, tripSummaryLogs]);

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
    multiple_vehicles: language === "th" ? "เลือกรถหนึ่งคัน" : "Select one vehicle",
    not_enough_data: t.fuelLogs.efficiency.statusNotEnoughData
  };

  const tripStatusTooltips: Record<TripSummaryStatus, string> = {
    calculated: t.fuelLogs.efficiency.tripStatusCalculatedTooltip,
    check_receipts: t.fuelLogs.efficiency.tripStatusCheckReceiptsTooltip,
    missing_mileage: t.fuelLogs.efficiency.tripStatusMissingMileageTooltip,
    check_mileage: t.fuelLogs.efficiency.tripStatusCheckMileageTooltip,
    multiple_vehicles:
      language === "th"
        ? "กรุณาเลือกรถหนึ่งคันเพื่อคำนวณประสิทธิภาพจากเลขไมล์อย่างถูกต้อง"
        : "Select one vehicle for accurate mileage-based efficiency.",
    not_enough_data: t.fuelLogs.efficiency.tripStatusNotEnoughDataTooltip
  };

  const tripPeriodDays = getInclusiveDaysBetweenDates(efficiencyFilters.fromDate, efficiencyFilters.toDate);
  const tripPeriodLabel =
    efficiencyFilters.fromDate || efficiencyFilters.toDate
      ? `${efficiencyFilters.fromDate ? formatDate(efficiencyFilters.fromDate, language) : "-"} -> ${
          efficiencyFilters.toDate ? formatDate(efficiencyFilters.toDate, language) : "-"
        }`
      : "-";
  const selectedEfficiencyDriverLabel =
    drivers.find((driver) => String(driver.id) === String(efficiencyFilters.driverId))?.name ||
    t.fuelLogs.efficiency.allDrivers;
  const selectedEfficiencyVehicleLabel = efficiencyFilters.vehicleReg || t.fuelLogs.efficiency.allVehicles;
  const distanceTravelledLabel = language === "th" ? "ระยะทางรวม" : "Distance travelled";
  const fuelEfficiencyLabel = language === "th" ? "ประสิทธิภาพน้ำมัน" : "Fuel efficiency";
  const selectedPeriodLabel = language === "th" ? "ช่วงวันที่ที่เลือก" : "Selected period";
  const divideSymbol = String.fromCharCode(247);
  const receiptsSummaryLabel = `${formatNumber(tripSummary.receiptCheckedCount, language)} ${t.fuelLogs.efficiency.of} ${formatNumber(
    tripSummary.fuelLogCount,
    language
  )} ${t.fuelLogs.efficiency.checkedLower}`;
  const missingMileageSummaryLabel =
    tripSummary.missingMileageCount === 0
      ? `0 ${t.fuelLogs.efficiency.missingLower}`
      : `${formatNumber(tripSummary.missingMileageCount, language)} ${t.fuelLogs.efficiency.missingLower}`;
  const mileageClarityMessage =
    tripSummary.status === "multiple_vehicles"
      ? tripSummary.reason
      : tripSummary.mileageRecordCount < 2
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

  const getTripStatusClass = (status: TripSummaryStatus) => {
    if (status === "calculated") return "border-emerald-200 bg-emerald-50 text-emerald-700";
    if (status === "check_receipts" || status === "missing_mileage" || status === "check_mileage" || status === "multiple_vehicles") {
      return "border-amber-200 bg-amber-50 text-amber-800";
    }
    return "border-slate-200 bg-slate-100 text-slate-600";
  };

  const getEfficiencyNoteText = (row: EfficiencyRow) =>
    row.dataQualityNotes.map((note) => noteLabels[note]).filter(Boolean).join(" ");

  const visibleFuelLogs = useMemo(
    () => (missingMileageEntryFilter ? fuelLogs.filter((log) => isMissingMileage(log)) : fuelLogs),
    [fuelLogs, missingMileageEntryFilter]
  );

  const groupedFuelLogs = useMemo(() => {
    const groups = new Map<
      string,
      {
        date: string;
        logs: FuelLogWithDriver[];
        totalCost: number;
        totalLitres: number;
        checked: number;
        notChecked: number;
        missingMileage: number;
        averagePricePerLitre: number | null;
      }
    >();

    visibleFuelLogs.forEach((log) => {
      const group = groups.get(log.date) ?? {
        date: log.date,
        logs: [],
        totalCost: 0,
        totalLitres: 0,
        checked: 0,
        notChecked: 0,
        missingMileage: 0,
        averagePricePerLitre: null
      };
      group.logs.push(log);
      group.totalCost += Number(log.total_cost || 0);
      group.totalLitres += Number(log.litres || 0);
      if (log.receipt_checked) {
        group.checked += 1;
      } else {
        group.notChecked += 1;
      }
      if (isMissingMileage(log)) {
        group.missingMileage += 1;
      }
      groups.set(log.date, group);
    });

    groups.forEach((group) => {
      group.averagePricePerLitre = group.totalLitres > 0 ? group.totalCost / group.totalLitres : null;
    });

    const groupedRows = Array.from(groups.values());
    return sortKey === "price_per_litre"
      ? groupedRows
      : groupedRows.sort((left, right) => right.date.localeCompare(left.date));
  }, [sortKey, visibleFuelLogs]);
  const visibleFuelDateKeys = useMemo(() => groupedFuelLogs.map((group) => group.date), [groupedFuelLogs]);
  const allFuelDateGroupsExpanded =
    visibleFuelDateKeys.length > 0 && visibleFuelDateKeys.every((date) => expandedFuelDates.has(date));
  const fuelDateGroupControlLabel = allFuelDateGroupsExpanded ? uxCopy.collapseAll : uxCopy.expandAll;

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
    const [todayRows, recentDayRows, receiptSummaryRows, efficiencyRowsForAnalysis, tripLinks] = await Promise.all([
      fetchFuelLogTodayRows(todayValue),
      fetchFuelLogRecentDaySummaries(7),
      fetchFuelLogReceiptSummary(filters),
      fetchFuelLogsForExport({}),
      fetchTripFuelLogLinks().catch((tripLinkError) => {
        console.warn("Fuel logs trip links unavailable:", tripLinkError);
        return [] as TripFuelLogLink[];
      })
    ]);
    setTodayLogs(todayRows);
    setLast7DayRows(recentDayRows);
    setReceiptSummary(receiptSummaryRows);
    setEfficiencySourceLogs(efficiencyRowsForAnalysis);
    setTripFuelLinks(tripLinks);
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
    if (!groupedFuelLogs.length) return;
    setExpandedFuelDates((current) => {
      if (current.size > 0) return current;
      return new Set([groupedFuelLogs[0].date]);
    });
  }, [groupedFuelLogs]);

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

  const applyQuickFilter = (
    filter:
      | "today"
      | "yesterday"
      | "week"
      | "month"
      | "missing_mileage"
      | "not_checked"
      | "checked"
      | "shell"
      | "bangchak"
      | "na"
  ) => {
    setMissingMileageEntryFilter(false);
    const now = new Date();
    if (filter === "today") {
      const date = toDateKey(now);
      updateFilters((current) => ({ ...current, fromDate: date, toDate: date }));
      return;
    }
    if (filter === "yesterday") {
      const date = new Date(now);
      date.setDate(now.getDate() - 1);
      const key = toDateKey(date);
      updateFilters((current) => ({ ...current, fromDate: key, toDate: key }));
      return;
    }
    if (filter === "week") {
      updateFilters((current) => ({ ...current, fromDate: toDateKey(getWeekStart(now)), toDate: toDateKey(now) }));
      return;
    }
    if (filter === "month") {
      updateFilters((current) => ({ ...current, fromDate: toDateKey(new Date(now.getFullYear(), now.getMonth(), 1)), toDate: toDateKey(now) }));
      return;
    }
    if (filter === "not_checked" || filter === "checked") {
      updateFilters((current) => ({ ...current, receiptCheckedStatus: filter }));
      return;
    }
    if (filter === "shell") {
      updateFilters((current) => ({ ...current, location: "Shell" }));
      return;
    }
    if (filter === "bangchak") {
      updateFilters((current) => ({ ...current, location: "Bangchak" }));
      return;
    }
    if (filter === "na") {
      updateFilters((current) => ({ ...current, location: "N/A" }));
      return;
    }
    setMissingMileageEntryFilter(true);
    setCurrentPage(1);
  };

  useEffect(() => {
    const review = searchParams.get("review");
    if (review === "missing_mileage") {
      applyQuickFilter("missing_mileage");
    }
    if (review === "not_checked") {
      applyQuickFilter("not_checked");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const updateEfficiencyFilters = (
    updater: EfficiencyFilters | ((current: EfficiencyFilters) => EfficiencyFilters)
  ) => {
    setEfficiencyFilters((current) => (typeof updater === "function" ? updater(current) : updater));
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
            ? "เน€เธฅเธเนเธกเธฅเนเธ•เนเธณเธเธงเนเธฒเธฃเธฒเธขเธเธฒเธฃเธเนเธญเธเธซเธเนเธฒ เธ•เนเธญเธเธเธฒเธฃเธเธฑเธเธ—เธถเธเธ•เนเธญเธซเธฃเธทเธญเนเธกเน"
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
          [copy.pricePerLitreThb]: getFuelLogPricePerLitre(log)?.toFixed(2) ?? "",
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
            [t.fuelLogs.efficiency.value]: selectedEfficiencyDriverLabel
          },
          {
            [t.fuelLogs.efficiency.reportSection]: t.fuelLogs.efficiency.summary,
            [t.fuelLogs.efficiency.field]: t.fuelLogs.efficiency.vehicleReg,
            [t.fuelLogs.efficiency.value]: selectedEfficiencyVehicleLabel
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

  const handleDownloadBossPdf = async () => {
    if (!tripSummary.logs.length) return;

    setExportingBossPdf(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const pdfLanguage = getCurrentPdfLanguage(language);
      const bossPdfCopy = normalizeBossPdfCopy(getBossPdfCopy(pdfLanguage), pdfLanguage);
      const sortedLogs = [...tripSummary.logs].sort(compareFuelLogsByMileageOrder);
      const firstLogDate = sortedLogs[0]?.date ?? "";
      const lastLogDate = sortedLogs[sortedLogs.length - 1]?.date ?? firstLogDate;
      const reportStartDate = efficiencyFilters.fromDate || firstLogDate;
      const reportEndDate = efficiencyFilters.toDate || lastLogDate;
      const reportDateRange =
        reportStartDate || reportEndDate
          ? `${formatDate(reportStartDate, pdfLanguage)} - ${formatDate(reportEndDate, pdfLanguage)}`
          : pdfLanguage === "th"
            ? "-"
            : "All dates";
      const needsReceiptCheck = tripSummary.receiptUncheckedCount > 0;
      const distanceTravelled = tripSummary.tripKm != null ? `${formatNumber(tripSummary.tripKm, pdfLanguage, 0)} km` : "-";
      const totalLitres = `${formatNumber(tripSummary.totalLitres, pdfLanguage, 2)} L`;
      const distanceForCalculation = tripSummary.tripKm != null ? formatNumber(tripSummary.tripKm, pdfLanguage, 0) : "-";
      const litresForCalculation = formatNumber(tripSummary.totalLitres, pdfLanguage, 2);
      const fuelEfficiency =
        tripSummary.tripKmPerLitre != null ? `${formatNumber(tripSummary.tripKmPerLitre, pdfLanguage, 2)} km/L` : "-";
      const fuelLogsForPdf = sortedLogs.map((log) => {
        const mileageValue = getMileageValue(log.mileage);
        return {
          checkedStatus: log.receipt_checked ? bossPdfCopy.checked : bossPdfCopy.notChecked,
          cost: formatCurrency(Number(log.total_cost || 0), pdfLanguage),
          date: formatDate(log.date, pdfLanguage),
          litres: `${formatNumber(Number(log.litres || 0), pdfLanguage, 2)} L`,
          mileage: mileageValue != null ? `${formatNumber(mileageValue, pdfLanguage, 0)} km` : "-",
          vehicle: log.vehicle_reg || "-"
        };
      });
      const fileName = `Fuel_Efficiency_Report_${getPdfFileSafePart(selectedEfficiencyDriverLabel)}_${getPdfFileSafePart(
        selectedEfficiencyVehicleLabel
      )}_${formatFileDate(reportStartDate)}_to_${formatFileDate(reportEndDate)}.pdf`;
      const needsVehicleSelection = tripSummary.status === "multiple_vehicles";
      const needsDataReview = needsReceiptCheck || needsVehicleSelection;
      const vehicleSelectionWarning =
        pdfLanguage === "th"
          ? "กรุณาเลือกรถหนึ่งคันเพื่อคำนวณประสิทธิภาพจากเลขไมล์อย่างถูกต้อง"
          : "Select one vehicle for accurate mileage-based efficiency.";
      const receiptVerificationWarning =
        pdfLanguage === "th" ? "มีใบเสร็จเติมน้ำมันรอตรวจสอบ" : "Some fuel receipts are awaiting verification.";

      const logo = await loadPdfLogo();
      const pdf = await buildBossFuelEfficiencyPdf(
        {
          actualCalculation: normalizeFormulaSpacing(`${distanceForCalculation} ${String.fromCharCode(247)} ${litresForCalculation} = ${fuelEfficiency}`),
          dataStatus: needsDataReview ? "warning" : "ready",
          dataStatusDetail: needsVehicleSelection
            ? vehicleSelectionWarning
            : needsReceiptCheck
              ? receiptVerificationWarning
              : bossPdfCopy.fuelLogsMayCoverMultipleJobs,
          dataStatusTitle: needsVehicleSelection ? tripStatusLabels.multiple_vehicles : needsReceiptCheck ? bossPdfCopy.needsReceiptCheck : bossPdfCopy.readyToReview,
          dateRange: reportDateRange,
          driver: selectedEfficiencyDriverLabel,
          fuelLogs: fuelLogsForPdf,
          fuelEfficiency,
          generatedAt: new Intl.DateTimeFormat(pdfLanguage === "th" ? "th-TH" : "en-GB", {
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            month: "short",
            year: "numeric"
          }).format(new Date()),
          mileageRange: {
            distanceTravelled,
            endMileage: tripSummary.endMileage != null ? `${formatNumber(tripSummary.endMileage, pdfLanguage, 0)} km` : "-",
            startMileage: tripSummary.startMileage != null ? `${formatNumber(tripSummary.startMileage, pdfLanguage, 0)} km` : "-"
          },
          totalFuelLogCount: sortedLogs.length,
          totalFuelCost: formatCurrency(tripSummary.totalFuelCost, pdfLanguage),
          totalLitres,
          tripKm: distanceTravelled,
          vehicleReg: selectedEfficiencyVehicleLabel
        },
        logo,
        pdfLanguage
      );

      downloadBlob(pdf, fileName);
      setSuccessMessage(t.fuelLogs.efficiency.pdfDownloaded);
    } catch (err) {
      console.error("Fuel logs handleDownloadBossPdf error:", err);
      setError(err instanceof Error && err.message ? err.message : t.fuelLogs.efficiency.pdfError);
    } finally {
      setExportingBossPdf(false);
    }
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
            onClick={() => setEfficiencyAnalysisOpen((current) => !current)}
            className="btn-secondary w-full gap-2 sm:w-auto"
          >
            {efficiencyAnalysisOpen ? uxCopy.hideAnalysis : uxCopy.openAnalysis}
          </button>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
            <p className="text-xs font-semibold text-slate-500">{t.fuelLogs.efficiency.averageKmPerLitre}</p>
            <p className="mt-1 text-lg font-bold text-slate-950">{efficiencySummary.averageKmPerLitre != null ? formatNumber(efficiencySummary.averageKmPerLitre, language, 2) : "-"}</p>
          </div>
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
            <p className="text-xs font-semibold text-amber-700">{t.fuelLogs.efficiency.missingMileageEntries}</p>
            <p className="mt-1 text-lg font-bold text-amber-900">{formatNumber(efficiencySummary.missingMileageEntries, language)}</p>
          </div>
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2">
            <p className="text-xs font-semibold text-rose-700">{t.fuelLogs.efficiency.reviewNeeded}</p>
            <p className="mt-1 text-lg font-bold text-rose-900">{formatNumber(efficiencySummary.reviewNeededEntries, language)}</p>
          </div>
          <button type="button" onClick={() => setEfficiencyAnalysisOpen((current) => !current)} className="btn-secondary min-h-[58px]">
            {efficiencyAnalysisOpen ? uxCopy.collapse : uxCopy.openAnalysis}
          </button>
        </div>

        {efficiencyAnalysisOpen ? (
          <>
        <div className="mt-4 flex flex-col justify-end gap-2 sm:flex-row">
          {efficiencyCalculationMode === "trip_summary" ? (
            <button
              type="button"
              onClick={() => void handleDownloadBossPdf()}
              disabled={!tripSummary.logs.length || exportingBossPdf}
              className="btn-primary w-full gap-2 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
            >
              <Download className="h-4 w-4" />
              {exportingBossPdf ? t.common.loading : t.fuelLogs.efficiency.downloadBossPdf}
            </button>
          ) : null}
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
          <div className="subtle-panel p-4"><p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{t.fuelLogs.efficiency.mileageCompliance}</p><p className="mt-2 text-xl font-bold text-brand-700">{efficiencySummary.mileageCompliance != null ? `${formatNumber(efficiencySummary.mileageCompliance, language, 0)}%` : "โ€”"}</p><p className="mt-1 text-xs font-medium text-slate-500">{t.fuelLogs.efficiency.mileageProvided}</p></div>
          <div className="subtle-panel p-4"><p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{t.fuelLogs.efficiency.reviewNeeded}</p><p className="mt-2 text-xl font-bold text-amber-700">{formatNumber(efficiencySummary.reviewNeededEntries, language)}</p></div>
        </div>

        {missingMileageRows.length > 0 ? (
          <div className="mt-4 flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <p className="font-medium">
                {t.fuelLogs.efficiency.missingMileageEntries}: {formatNumber(missingMileageRows.length, language)}
              </p>
            </div>
            <button type="button" onClick={() => setMissingMileageExpanded(true)} className="btn-secondary min-h-[34px] border-amber-200 px-3 py-1.5 text-xs text-amber-900 hover:border-amber-300 hover:text-amber-950">
              {t.fuelLogs.efficiency.viewMissingEntries}
            </button>
            {missingMileageExpanded ? (
            <div role="dialog" aria-modal="true" aria-labelledby="missing-mileage-title" className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/45 p-3 sm:flex sm:items-center sm:justify-center sm:p-6">
              <div className="mx-auto max-h-[calc(100vh-1.5rem)] w-full max-w-5xl overflow-y-auto rounded-lg border border-slate-200 bg-white p-4 shadow-2xl sm:max-h-[90vh] sm:p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p id="missing-mileage-title" className="font-semibold text-slate-950">{t.fuelLogs.efficiency.missingMileageEntries}</p>
                  <p className="mt-1 text-xs text-slate-500">{formatNumber(missingMileageRows.length, language)} {t.common.entries}</p>
                </div>
                <button type="button" onClick={() => setMissingMileageExpanded(false)} className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-slate-900" aria-label="Close">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-3 space-y-2 md:hidden">
                {missingMileageRows.map((row) => (
                  <div key={row.log.id} className="rounded-xl border border-amber-100 bg-white px-3 py-2">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-slate-900">{row.log.driver || "-"}</p>
                        <p className="mt-0.5 text-xs text-slate-500">{formatDate(row.log.date, language)} ยท {row.log.vehicle_reg || "-"}</p>
                      </div>
                      <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800">{t.fuelLogs.efficiency.needsMileage}</span>
                    </div>
                    <p className="mt-2 text-xs text-slate-500">{formatNumber(Number(row.log.litres || 0), language, 2)} {t.fuelLogs.efficiency.litres} ยท {formatCurrency(Number(row.log.total_cost || 0), language)}</p>
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
                    {missingMileageRows.map((row) => (
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
              </div>
            </div>
            ) : null}
          </div>
        ) : null}

          </>
        ) : (
          <>
            <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-7">
              <div className="subtle-panel p-4"><p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{distanceTravelledLabel}</p><p className="mt-2 text-xl font-bold text-slate-950">{tripSummary.tripKm != null ? formatNumber(tripSummary.tripKm, language, 0) : "-"}</p></div>
              <div className="subtle-panel p-4"><p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{t.fuelLogs.efficiency.totalLitres}</p><p className="mt-2 text-xl font-bold text-slate-950">{formatNumber(tripSummary.totalLitres, language, 2)}</p></div>
              <div className="subtle-panel p-4"><p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{fuelEfficiencyLabel}</p><p className="mt-2 text-xl font-bold text-brand-700">{tripSummary.tripKmPerLitre != null ? formatNumber(tripSummary.tripKmPerLitre, language, 2) : "-"}</p></div>
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
                  <p className="mt-2 text-sm font-semibold text-slate-900">{t.fuelLogs.efficiency.endMileage} - {t.fuelLogs.efficiency.startMileage} = {distanceTravelledLabel}</p>
                </div>
                <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{t.fuelLogs.efficiency.step} 3</p>
                  <p className="mt-2 text-sm font-semibold text-slate-900">{distanceTravelledLabel} {divideSymbol} {t.fuelLogs.efficiency.totalLitres} = {fuelEfficiencyLabel}</p>
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
                      <div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{selectedPeriodLabel}</p><p className="mt-1 font-semibold text-slate-900">{tripPeriodLabel}</p>{tripPeriodDays != null ? <p className="mt-0.5 text-xs text-slate-500">{t.fuelLogs.efficiency.numberOfDays}: {formatNumber(tripPeriodDays, language)} {t.fuelLogs.efficiency.days}</p> : null}</div>
                      <div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{t.fuelLogs.efficiency.mileage}</p><p className="mt-1 font-semibold text-slate-900">{tripSummary.startMileage != null ? formatNumber(tripSummary.startMileage, language, 0) : "-"} {"->"} {tripSummary.endMileage != null ? formatNumber(tripSummary.endMileage, language, 0) : "-"}</p></div>
                      <div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{t.fuelLogs.efficiency.tripDistance}</p><p className="mt-1 font-semibold text-slate-900">{tripSummary.endMileage != null ? formatNumber(tripSummary.endMileage, language, 0) : "-"} - {tripSummary.startMileage != null ? formatNumber(tripSummary.startMileage, language, 0) : "-"} = {tripSummary.tripKm != null ? formatNumber(tripSummary.tripKm, language, 0) : "-"} km</p></div>
                      <div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{t.fuelLogs.efficiency.fuelUsed}</p><p className="mt-1 font-semibold text-slate-900">{formatNumber(tripSummary.totalLitres, language, 2)} {t.fuelLogs.efficiency.litres}</p></div>
                    </div>
                    <div className="mt-4 rounded-2xl border border-brand-100 bg-white/80 px-4 py-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-700">{t.fuelLogs.efficiency.finalResult}</p>
                      <p className="mt-2 text-lg font-bold text-slate-950">{tripSummary.tripKm != null ? formatNumber(tripSummary.tripKm, language, 0) : "-"} km {divideSymbol} {formatNumber(tripSummary.totalLitres, language, 2)} L = {tripSummary.tripKmPerLitre != null ? formatNumber(tripSummary.tripKmPerLitre, language, 2) : "-"} KM/L</p>
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

          </>
        )}

          </>
        ) : null}
      </section>

      <section className="surface-card mb-4.5 p-4 sm:p-5">
        <div className="mb-3.5">
          <h3 className="text-base font-semibold text-slate-900">{t.fuelLogs.spendByDayTitle}</h3>
          <p className="mt-1 text-sm text-slate-500">{t.fuelLogs.spendByDayDescription}</p>
        </div>
        <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <div className="subtle-panel p-3"><p className="text-xs font-semibold text-slate-500">{uxCopy.totalSpend}</p><p className="mt-1 text-lg font-bold text-slate-950">{formatCurrency(last7DaysSummary.totalSpend, language)}</p></div>
          <div className="subtle-panel p-3"><p className="text-xs font-semibold text-slate-500">{uxCopy.totalLitres}</p><p className="mt-1 text-lg font-bold text-slate-950">{formatNumber(last7DaysSummary.totalLitres, language, 2)}</p></div>
          <div className="subtle-panel p-3"><p className="text-xs font-semibold text-slate-500">{uxCopy.averagePriceLitre}</p><p className="mt-1 text-lg font-bold text-slate-950">{last7DaysSummary.averagePricePerLitre != null ? formatCurrency(last7DaysSummary.averagePricePerLitre, language) : "-"}</p></div>
          <div className="subtle-panel p-3"><p className="text-xs font-semibold text-slate-500">{uxCopy.highestDay}</p><p className="mt-1 text-lg font-bold text-slate-950">{last7DaysSummary.highestDay ? formatDate(last7DaysSummary.highestDay.date, language) : "-"}</p></div>
          <div className="subtle-panel p-3"><p className="text-xs font-semibold text-slate-500">{t.common.entries}</p><p className="mt-1 text-lg font-bold text-slate-950">{formatNumber(last7DaysSummary.totalEntries, language)}</p></div>
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
              <button type="button" onClick={() => updateFilters((current) => ({ ...current, fromDate: row.date, toDate: row.date }))} className="btn-secondary mt-3 min-h-8 px-3 py-1 text-xs">
                {uxCopy.viewDay}
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="mb-4.5 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          label={receiptCopy.totalCount}
          value={formatNumber(receiptSummary.total, language)}
          helper={language === "th" ? "เธฃเธงเธกเธ•เธฒเธกเธ•เธฑเธงเธเธฃเธญเธเธเธฑเธเธเธธเธเธฑเธ" : "Based on the current filters."}
          icon={<ReceiptText className="h-5 w-5" />}
        />
        <StatCard
          label={receiptCopy.checkedCount}
          value={formatNumber(receiptSummary.checked, language)}
          helper={language === "th" ? "เธ•เธฃเธงเธเน€เธ—เธตเธขเธเนเธเน€เธชเธฃเนเธเนเธฅเนเธง" : "Marked as checked against receipt."}
          icon={<TrendingUp className="h-5 w-5" />}
        />
        <StatCard
          label={receiptCopy.notCheckedCount}
          value={formatNumber(receiptSummary.notChecked, language)}
          helper={language === "th" ? "เธขเธฑเธเธฃเธญเธ•เธฃเธงเธเน€เธ—เธตเธขเธเนเธเน€เธชเธฃเนเธ" : "Still pending receipt check."}
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
        <section className="surface-card min-w-0 p-4 sm:p-5">
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
              <button type="button" onClick={() => { setMissingMileageEntryFilter(false); updateFilters(initialFilters); }} className="text-sm font-medium text-slate-500 hover:text-slate-900">{copy.clear}</button>
            </div>
            <div className="mb-4">
              <p className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-slate-500">{uxCopy.quickFilters}</p>
              <div className="flex flex-wrap gap-2">
                {[
                  ["today", uxCopy.today],
                  ["yesterday", uxCopy.yesterday],
                  ["week", uxCopy.thisWeek],
                  ["month", uxCopy.thisMonth],
                  ["missing_mileage", copy.missingOdometer],
                  ["not_checked", uxCopy.notChecked],
                  ["checked", uxCopy.checked],
                  ["shell", "Shell"],
                  ["bangchak", "Bangchak"],
                  ["na", "N/A"]
                ].map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => applyQuickFilter(key as Parameters<typeof applyQuickFilter>[0])}
                    className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-700 transition hover:border-brand-200 hover:bg-brand-50 hover:text-brand-700"
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-3.5">
              <div className="grid gap-3 md:grid-cols-12">
                <div className="md:col-span-5 lg:col-span-4"><label className="form-label">{copy.dateRange}</label><div className="grid grid-cols-2 gap-2"><input type="date" value={filters.fromDate ?? ""} onChange={(event) => updateFilters((current) => ({ ...current, fromDate: event.target.value }))} className="form-input bg-white" /><input type="date" value={filters.toDate ?? ""} onChange={(event) => updateFilters((current) => ({ ...current, toDate: event.target.value }))} className="form-input bg-white" /></div></div>
                <div className="md:col-span-3 lg:col-span-4"><label className="form-label">{copy.driver}</label><select value={filters.driverId ?? ""} onChange={(event) => updateFilters((current) => ({ ...current, driverId: event.target.value }))} className="form-input bg-white"><option value="">{copy.all}</option>{drivers.map((driver) => <option key={driver.id} value={String(driver.id)}>{driver.name}</option>)}</select></div>
                <div className="md:col-span-4 lg:col-span-4"><label className="form-label">{copy.vehicle}</label><select value={filters.vehicleReg ?? ""} onChange={(event) => updateFilters((current) => ({ ...current, vehicleReg: event.target.value }))} className="form-input bg-white"><option value="">{copy.all}</option>{vehicleOptions.map((vehicleReg) => <option key={vehicleReg} value={vehicleReg}>{vehicleReg}</option>)}</select></div>
                <div className="md:col-span-4 lg:col-span-3"><label className="form-label">{receiptCopy.filterLabel}</label><select value={filters.receiptCheckedStatus ?? ""} onChange={(event) => updateFilters((current) => ({ ...current, receiptCheckedStatus: event.target.value as FuelLogFilters["receiptCheckedStatus"] }))} className="form-input bg-white"><option value="">{copy.all}</option><option value="checked">{receiptCopy.checked}</option><option value="not_checked">{receiptCopy.notChecked}</option></select></div>
              </div>
              <button type="button" onClick={() => setAdvancedFiltersOpen((current) => !current)} className="btn-secondary min-h-9 px-3 py-1.5 text-xs">
                {advancedFiltersOpen ? uxCopy.collapse : uxCopy.advancedFilters}
              </button>
              {advancedFiltersOpen ? (
              <div className="grid gap-3 md:grid-cols-12">
                <div className="md:col-span-3"><label className="form-label">{t.fuelLogs.location}</label><select value={filters.location ?? ""} onChange={(event) => updateFilters((current) => ({ ...current, location: event.target.value }))} className="form-input bg-white"><option value="">{t.fuelLogs.allLocations}</option>{locationOptions.map((location) => <option key={location} value={location}>{location}</option>)}</select></div>
                <div className="md:col-span-3"><label className="form-label">{copy.payment}</label><select value={filters.paymentMethod ?? ""} onChange={(event) => updateFilters((current) => ({ ...current, paymentMethod: event.target.value }))} className="form-input bg-white"><option value="">{copy.all}</option>{paymentMethodOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div>
                <div className="md:col-span-3"><label className="form-label">{sourceCopy.filterLabel}</label><select value={filters.entrySource ?? ""} onChange={(event) => updateFilters((current) => ({ ...current, entrySource: event.target.value as FuelLogFilters["entrySource"] }))} className="form-input bg-white"><option value="">{sourceCopy.all}</option>{filterEntrySourceOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div>
                <div className="md:col-span-3"><label className="form-label">{copy.totalCostRange}</label><div className="grid grid-cols-2 gap-2"><input type="number" min="0" step="0.01" value={filters.totalCostMin ?? ""} onChange={(event) => updateFilters((current) => ({ ...current, totalCostMin: event.target.value }))} placeholder={copy.min} className="form-input bg-white" /><input type="number" min="0" step="0.01" value={filters.totalCostMax ?? ""} onChange={(event) => updateFilters((current) => ({ ...current, totalCostMax: event.target.value }))} placeholder={copy.max} className="form-input bg-white" /></div></div>
              </div>
              ) : null}
            </div>
          </div>

          {loading ? (
            <p className="text-sm text-slate-500">{t.fuelLogs.loadingFuelLogs}</p>
          ) : totalCount === 0 || groupedFuelLogs.length === 0 ? (
            <EmptyState title={copy.noResultsTitle} description={copy.noResultsDescription} />
          ) : (
            <>
              <div className="mb-2 flex justify-end">
                <button
                  type="button"
                  onClick={() =>
                    setExpandedFuelDates(
                      allFuelDateGroupsExpanded ? new Set() : new Set(visibleFuelDateKeys)
                    )
                  }
                  disabled={visibleFuelDateKeys.length === 0}
                  className="booking-section-toggle min-h-[32px] px-2.5 text-[11px] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {fuelDateGroupControlLabel}
                </button>
              </div>

              <div className="space-y-3 md:hidden">
                {groupedFuelLogs.map((group) => {
                  const isExpanded = expandedFuelDates.has(group.date);
                  return (
                    <section key={group.date} className="rounded-[1rem] border border-slate-200 bg-white/90 p-3 shadow-sm">
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedFuelDates((current) => {
                            const next = new Set(current);
                            if (next.has(group.date)) next.delete(group.date);
                            else next.add(group.date);
                            return next;
                          })
                        }
                        className="flex w-full items-center justify-between gap-3 text-left"
                        aria-expanded={isExpanded}
                      >
                        <span className="min-w-0">
                          <span className="block text-xs font-bold uppercase tracking-[0.14em] text-brand-800">{formatFuelDateHeading(group.date, language)}</span>
                          <span className="mt-1 block text-[11px] font-semibold text-slate-500">
                            {formatNumber(group.logs.length, language)} {t.common.entries} | {formatCurrency(group.totalCost, language)} | {formatNumber(group.totalLitres, language, 2)} {t.fuelLogs.litres} | {copy.averagePricePerLitreShort} {group.averagePricePerLitre != null ? formatNumber(group.averagePricePerLitre, language, 2) : "—"}
                          </span>
                        </span>
                        <span className="booking-date-chevron">
                          <ChevronRight className={`h-3.5 w-3.5 transition-transform duration-200 ${isExpanded ? "rotate-90" : ""}`} />
                        </span>
                      </button>
                      {isExpanded ? (
                        <div className="mt-3 space-y-2">
                          {group.logs.map((log) => {
                            const detailsExpanded = expandedFuelEntryDetails.has(String(log.id));
                            const missingMileage = isMissingMileage(log);
                            const pricePerLitre = getFuelLogPricePerLitre(log);
                            return (
                              <article key={log.id} className={`rounded-[0.9rem] border p-3 ${missingMileage ? "border-amber-200 bg-amber-50/50" : "border-slate-200 bg-white/85"}`}>
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">{formatDate(log.date, language)}</p>
                                    <p className="mt-1 truncate text-sm font-bold text-slate-950">{log.driver || "-"}</p>
                                    <p className="truncate text-xs font-semibold text-slate-500">{log.vehicle_reg || "-"} | {log.location || log.station || "-"}</p>
                                  </div>
                                  <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${getReceiptCheckBadgeClass(log.receipt_checked)}`}>{getReceiptCheckLabel(log.receipt_checked, language)}</span>
                                </div>
                                <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                                  <div className="rounded-lg bg-slate-50 px-2 py-2">
                                    <p className="font-semibold text-slate-500">{t.fuelLogs.litres}</p>
                                    <p className="font-bold text-slate-950">{formatNumber(Number(log.litres || 0), language, 2)}</p>
                                  </div>
                                  <div className="rounded-lg bg-slate-50 px-2 py-2">
                                    <p className="font-semibold text-slate-500">{t.fuelLogs.totalCost}</p>
                                    <p className="font-bold text-slate-950">{formatCurrency(Number(log.total_cost || 0), language)}</p>
                                  </div>
                                  <div className="rounded-lg bg-slate-50 px-2 py-2">
                                    <p className="font-semibold text-slate-500">{copy.pricePerLitreThb}</p>
                                    <p className={`font-bold ${getPricePerLitreClass(pricePerLitre, group.averagePricePerLitre)}`}>{formatPricePerLitre(pricePerLitre, language)}</p>
                                  </div>
                                  <div className="rounded-lg bg-slate-50 px-2 py-2">
                                    <p className="font-semibold text-slate-500">{t.fuelLogs.mileage}</p>
                                    <p className={`font-bold ${missingMileage ? "text-amber-700" : "text-slate-950"}`}>{missingMileage ? copy.missingOdometer : formatMileageValue(log.mileage, language)}</p>
                                  </div>
                                </div>
                                <div className="mt-3 flex flex-wrap gap-1.5">
                                  <button type="button" onClick={() => void handleReceiptToggle(log, !log.receipt_checked)} disabled={togglingReceiptId === String(log.id)} className="table-action-secondary min-h-7 px-2 text-[11px] disabled:opacity-50">{togglingReceiptId === String(log.id) ? t.common.saving : receiptCopy.markShort}</button>
                                  <button type="button" onClick={() => populateForm(log)} className="table-action-secondary min-h-7 px-2 text-[11px]">{t.common.edit}</button>
                                  <button type="button" onClick={() => void handleDelete(String(log.id))} disabled={deletingId === String(log.id)} className="table-action-danger min-h-7 px-2 text-[11px] disabled:opacity-50">{deletingId === String(log.id) ? t.common.deleting : t.common.delete}</button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setExpandedFuelEntryDetails((current) => {
                                        const next = new Set(current);
                                        const id = String(log.id);
                                        if (next.has(id)) next.delete(id);
                                        else next.add(id);
                                        return next;
                                      })
                                    }
                                    className="table-action-secondary min-h-7 px-2 text-[11px]"
                                  >
                                    {detailsExpanded ? uxCopy.hideDetails : uxCopy.moreDetails}
                                  </button>
                                </div>
                                {detailsExpanded ? (
                                  <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">
                                    <p>{copy.pricePerLitreThb}: {formatPricePerLitre(pricePerLitre, language)}</p>
                                    <p>{uxCopy.trip}: {getFuelTripLabel(log)}</p>
                                    <p>{sourceCopy.label}: {sourceCopy.options[normalizeEntrySource(log.entry_source)]}</p>
                                    <p>{uxCopy.notes}: {log.notes || "-"}</p>
                                  </div>
                                ) : null}
                              </article>
                            );
                          })}
                        </div>
                      ) : null}
                    </section>
                  );
                })}
              </div>

              <div className="table-shell booking-desktop-table hidden w-full md:block">
                <div className="table-scroll w-full overflow-x-auto">
                  <table className="w-full min-w-[1060px]">
                    <thead>
                      <tr>
                        <th className="booking-desktop-head-cell w-[8%]">{t.fuelLogs.date}</th>
                        <th className="booking-desktop-head-cell w-[15%]">{t.fuelLogs.driver}</th>
                        <th className="booking-desktop-head-cell w-[10%]">{t.fuelLogs.vehicleReg}</th>
                        <th className="booking-desktop-head-cell w-[8%] text-right">{t.fuelLogs.litres}</th>
                        <th className="booking-desktop-head-cell w-[11%] text-right">{t.fuelLogs.totalCost}</th>
                        <th className="booking-desktop-head-cell w-[12%] text-right">
                          <button
                            type="button"
                            onClick={() => toggleFuelLogSort("price_per_litre")}
                            className="inline-flex items-center justify-end gap-1 text-right font-semibold text-slate-600 transition hover:text-slate-950"
                            title={getSortLabel("price_per_litre") || copy.pricePerLitreThb}
                          >
                            <span>{copy.pricePerLitreThb}</span>
                            <ArrowUpDown className="h-3.5 w-3.5" />
                          </button>
                        </th>
                        <th className="booking-desktop-head-cell w-[10%] text-right">{t.fuelLogs.mileage}</th>
                        <th className="booking-desktop-head-cell">{t.fuelLogs.location}</th>
                        <th className="booking-desktop-head-cell w-[10%]">{receiptCopy.filterLabel}</th>
                        <th className="booking-desktop-head-cell w-[148px] text-right">{t.common.action}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {groupedFuelLogs.map((group) => {
                        const isExpanded = expandedFuelDates.has(group.date);
                        return (
                          <Fragment key={group.date}>
                            <tr className="booking-desktop-date-row sticky top-0 z-20">
                              <td colSpan={10}>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setExpandedFuelDates((current) => {
                                      const next = new Set(current);
                                      if (next.has(group.date)) next.delete(group.date);
                                      else next.add(group.date);
                                      return next;
                                    })
                                  }
                                  className={`booking-desktop-date-heading ${isExpanded ? "booking-desktop-date-heading-open" : ""}`}
                                  aria-expanded={isExpanded}
                                >
                                  <span className="booking-desktop-date-heading-main">
                                    <span className="booking-date-chevron">
                                      <ChevronRight className={`h-3.5 w-3.5 transition-transform duration-200 ${isExpanded ? "rotate-90" : ""}`} />
                                    </span>
                                    <span className="min-w-0">
                                      <span className="block">{formatFuelDateHeading(group.date, language)}</span>
                                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] font-semibold normal-case tracking-normal text-slate-500">
                                        <span>{formatNumber(group.logs.length, language)} {t.common.entries}</span>
                                        <span>{formatCurrency(group.totalCost, language)}</span>
                                        <span>{formatNumber(group.totalLitres, language, 2)} {t.fuelLogs.litres}</span>
                                        <span>{copy.averagePricePerLitreShort} {group.averagePricePerLitre != null ? formatNumber(group.averagePricePerLitre, language, 2) : "—"}</span>
                                        <span>{formatNumber(group.missingMileage, language)} {copy.missingOdometer}</span>
                                        <span>{formatNumber(group.notChecked, language)} {uxCopy.pendingCheck}</span>
                                      </div>
                                    </span>
                                  </span>
                                  <strong>{isExpanded ? uxCopy.collapse : uxCopy.expand}</strong>
                                </button>
                              </td>
                            </tr>
                            {isExpanded ? group.logs.map((log) => {
                              const detailsExpanded = expandedFuelEntryDetails.has(String(log.id));
                              const missingMileage = isMissingMileage(log);
                              const pricePerLitre = getFuelLogPricePerLitre(log);
                              return (
                                <Fragment key={log.id}>
                                  <tr className="enterprise-table-row">
                                    <td className="booking-desktop-cell whitespace-nowrap py-2 font-medium text-slate-600">{formatDate(log.date, language)}</td>
                                    <td className="booking-desktop-cell whitespace-nowrap py-2 font-semibold text-slate-950">{log.driver}</td>
                                    <td className="booking-desktop-cell whitespace-nowrap py-2 font-medium text-slate-500">{log.vehicle_reg}</td>
                                    <td className="booking-desktop-cell whitespace-nowrap py-2 text-right text-[13.5px] font-bold tabular-nums text-slate-950">{formatNumber(Number(log.litres || 0), language, 2)}</td>
                                    <td className="booking-desktop-cell whitespace-nowrap py-2 text-right text-[13.5px] font-bold tabular-nums text-slate-950">{formatCurrency(Number(log.total_cost || 0), language)}</td>
                                    <td className={`booking-desktop-cell whitespace-nowrap py-2 text-right text-[13px] font-bold tabular-nums ${getPricePerLitreClass(pricePerLitre, group.averagePricePerLitre)}`}>
                                      {formatPricePerLitre(pricePerLitre, language)}
                                    </td>
                                    <td className="booking-desktop-cell whitespace-nowrap py-2 text-right text-[12.5px] tabular-nums text-slate-500">
                                      {missingMileage ? (
                                        <span className="inline-flex items-center justify-end gap-1.5">
                                          <span>-</span>
                                          <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800">{copy.missingOdometer}</span>
                                        </span>
                                      ) : formatMileageValue(log.mileage, language)}
                                    </td>
                                    <td className="booking-desktop-cell max-w-[220px] py-2 text-slate-400" title={log.location || ""}>
                                      <span className="block truncate">{log.location || "-"}</span>
                                    </td>
                                    <td className="booking-desktop-cell whitespace-nowrap py-2">
                                      <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold ${getReceiptCheckBadgeClass(log.receipt_checked)}`}>{getReceiptCheckLabel(log.receipt_checked, language)}</span>
                                    </td>
                                    <td className="booking-desktop-cell py-2 text-right">
                                      <div className="flex items-center justify-end gap-px whitespace-nowrap">
                                        <button type="button" onClick={() => void handleReceiptToggle(log, !log.receipt_checked)} disabled={togglingReceiptId === String(log.id)} className="table-action-secondary min-h-6 px-1.5 text-[10px] disabled:opacity-50">{togglingReceiptId === String(log.id) ? t.common.saving : receiptCopy.markShort}</button>
                                        <button type="button" onClick={() => populateForm(log)} className="table-action-secondary min-h-6 px-1.5 text-[10px]">{t.common.edit}</button>
                                        <button type="button" onClick={() => void handleDelete(String(log.id))} disabled={deletingId === String(log.id)} className="table-action-danger min-h-6 px-1.5 text-[10px] disabled:opacity-50">{deletingId === String(log.id) ? t.common.deleting : t.common.delete}</button>
                                        <button
                                          type="button"
                                          onClick={() =>
                                            setExpandedFuelEntryDetails((current) => {
                                              const next = new Set(current);
                                              const id = String(log.id);
                                              if (next.has(id)) next.delete(id);
                                              else next.add(id);
                                              return next;
                                            })
                                          }
                                          className="inline-flex min-h-6 items-center gap-0.5 px-1 text-[10px] font-semibold text-slate-500 hover:text-slate-900"
                                        >
                                          <ChevronRight className={`h-3 w-3 transition-transform ${detailsExpanded ? "rotate-90" : ""}`} />
                                          {detailsExpanded ? uxCopy.hideDetails : uxCopy.moreDetails}
                                        </button>
                                      </div>
                                    </td>
                                  </tr>
                                  {detailsExpanded ? (
                                    <tr className="bg-slate-50/80">
                                      <td colSpan={10} className="px-4 py-2 text-xs text-slate-600">
                                        {copy.pricePerLitreThb}: {formatPricePerLitre(pricePerLitre, language)} | {uxCopy.trip}: {getFuelTripLabel(log)} | {sourceCopy.label}: {sourceCopy.options[normalizeEntrySource(log.entry_source)]} | {uxCopy.receiptSource}: {sourceCopy.options[normalizeEntrySource(log.entry_source)]} | {uxCopy.notes}: {log.notes || "-"}
                                      </td>
                                    </tr>
                                  ) : null}
                                </Fragment>
                              );
                            }) : null}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
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
