"use client";
import Link from "next/link";

import { AlertTriangle, Calculator, CheckCircle2, ChevronDown, Download, FileUp, Info, Pencil, Search, Trash2, TrendingUp, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { BusinessImpact, ActionQueue, VehicleDrillDown } from "@/components/vehicle-performance-management";
import { buildPerformanceManagement, type Direction } from "@/lib/vehicle-performance-management";
import { EmptyState } from "@/components/empty-state";
import { Header } from "@/components/header";
import {
  deleteVehicleMonthlyPerformance,
  deleteVehiclePerformanceImportReview,
  fetchFuelLogsForExport,
  fetchTripJourneys,
  fetchVehicleMonthlyFuelSpend,
  fetchVehicleMonthlyPerformance,
  fetchVehiclePerformanceImportReviews,
  fetchVehicles,
  saveVehiclePerformanceCorrectionAudit,
  saveVehiclePerformanceImportReview,
  saveVehicleMonthlyPerformance
} from "@/lib/data";
import { applyRequiredValidationMessage, clearValidationMessage } from "@/lib/form-validation";
import { useLanguage } from "@/lib/language-provider";
import { useAccountAccess } from "@/lib/use-account-access";
import { supabase } from "@/lib/supabase";
import { formatNumber, normalizeComparableText, normalizeVehicleRegistration } from "@/lib/utils";
import { knownVehicleRegistrationAliases } from "@/lib/vehicle-identity";
import { summarizeTripFinancials } from "@/lib/trip-financials";
import {
  addAppFuelToImportRows,
  applySavedVehiclePerformanceImportReviews,
  buildVehiclePerformanceSummary,
  buildVehicleMonthlyPerformanceRows,
  buildVehicleMonthlyTrend,
  buildVehiclePerformanceRows,
  calculateVehiclePerformanceMetrics,
  evaluateVehiclePerformanceImportStatus,
  parseVehiclePerformanceWorkbook,
  VEHICLE_PERFORMANCE_STATUS_RULES,
  type VehiclePerformanceMonthlyPerformanceRow,
  type VehiclePerformanceImportStatus,
  type VehiclePerformanceImportRow,
  type VehiclePerformanceRow,
  type VehiclePerformanceSummary
} from "@/lib/vehicle-performance";
import type { TripJourneyWithFuel, Vehicle, VehicleMonthlyPerformance } from "@/types/database";
import type { FuelLogWithDriver } from "@/types/database";

type MonthFilter = "" | number;
type RankingKey = "recordedBalance" | "grossRevenue" | "marginPercent" | "fuelPercent" | "fuelSpend" | "lowestRecordedBalance";
type ImportStatusFilter = "" | VehiclePerformanceImportRow["status"];
type VehicleSortKey = "vehicleRegistration" | "grossRevenue" | "fuelSpend" | "fuelPercent" | "lpgCost" | "salaryCost" | "tripIncome" | "otherExpenses" | "recordedBalance" | "marginPercent" | "status";
type TrendMetric = "grossRevenue" | "recordedBalance" | "fuelSpend" | "marginPercent";
type CoverageVehicleDetail = {
  registration: string;
  presentMonths: number[];
  missingMonths: number[];
};
type VehicleCoverageDetail = {
  registration: string;
  reasons: string[];
};
type VehiclePerformancePdfTone = "default" | "success" | "info" | "warning" | "danger";
type VehiclePerformancePdfMetric = {
  label: string;
  value: string;
  detail?: string;
  tone?: VehiclePerformancePdfTone;
};
type VehiclePerformancePdfTable = {
  columns: Array<{ label: string; width: number; align?: "left" | "right" | "center" }>;
  rows: string[][];
};
type VehiclePerformancePdfData = {
  coverageSummary: string;
  dataQuality: string[];
  disclaimer: string;
  executiveSummary: string[];
  fleetHealth: Array<VehiclePerformancePdfMetric & { count: number }>;
  generatedAt: string;
  highlights: VehiclePerformancePdfMetric[];
  kpis: VehiclePerformancePdfMetric[];
  monthlyTable: VehiclePerformancePdfTable;
  periodLabel: string;
  reconciliationStatus: string;
  reviewRows: Array<{ values: string[]; tone: VehiclePerformancePdfTone }>;
  searchQuery: string;
  title: string;
  topVehicles: VehiclePerformancePdfTable;
  trendRows: VehiclePerformanceMonthlyPerformanceRow[];
  vehicleCount: number;
  vehicleTable: VehiclePerformancePdfTable;
};
type VehiclePerformancePdfLogo = {
  dataUrl: string | null;
  height?: number;
  width?: number;
};

type PerformanceForm = {
  id: string;
  year: string;
  month: string;
  vehicle_registration: string;
  gross_revenue: string;
  salary_cost: string;
  trip_income: string;
  other_expenses: string;
  lpg_cost: string;
  notes: string;
};

type CorrectionForm = {
  grossRevenue: string;
  salaryCost: string;
  tripIncome: string;
  otherExpenses: string;
  lpgCost: string;
  reason: string;
};

const MONTH_OPTIONS = [
  { value: 1, labelKey: "january" },
  { value: 2, labelKey: "february" },
  { value: 3, labelKey: "march" },
  { value: 4, labelKey: "april" },
  { value: 5, labelKey: "may" },
  { value: 6, labelKey: "june" },
  { value: 7, labelKey: "july" },
  { value: 8, labelKey: "august" },
  { value: 9, labelKey: "september" },
  { value: 10, labelKey: "october" },
  { value: 11, labelKey: "november" },
  { value: 12, labelKey: "december" }
] as const;

const VEHICLE_PERFORMANCE_BASELINE_MONTHS = [1, 2, 3, 4, 5, 6, 7] as const;

const initialForm: PerformanceForm = {
  id: "",
  year: "2026",
  month: "1",
  vehicle_registration: "",
  gross_revenue: "",
  salary_cost: "",
  trip_income: "",
  other_expenses: "",
  lpg_cost: "",
  notes: ""
};

function numericInput(value: string) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatBaht(value: number) {
  const hasDecimals = Math.abs(value % 1) > 0.004;
  return `฿${new Intl.NumberFormat("en-GB", {
    minimumFractionDigits: hasDecimals ? 2 : 0,
    maximumFractionDigits: 2
  }).format(value || 0)}`;
}

function formatCompactBaht(value: number) {
  const absolute = Math.abs(value || 0);
  const sign = value < 0 ? "-" : "";
  if (absolute >= 1_000_000) return `${sign}฿${(absolute / 1_000_000).toFixed(2).replace(/\.00$/, "")}M`;
  if (absolute >= 1_000) return `${sign}฿${(absolute / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return formatBaht(value);
}

function formatPercent(value: number | null, language: "en" | "th") {
  if (value == null || !Number.isFinite(value)) return "-";
  return `${formatNumber(value, language, 1)}%`;
}

function compareNullableMetric(left: number | null, right: number | null, direction: "asc" | "desc") {
  const leftValue = left ?? (direction === "asc" ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY);
  const rightValue = right ?? (direction === "asc" ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY);
  return direction === "asc" ? leftValue - rightValue : rightValue - leftValue;
}

function vehicleKey(value: string) {
  return normalizeComparableText(normalizeVehicleRegistration(value));
}

function formatSignedPercent(value: number | null, language: "en" | "th") {
  if (value == null || !Number.isFinite(value)) return "-";
  const sign = value > 0 ? "+" : "";
  return `${sign}${formatPercent(value, language)}`;
}

function formatSignedPointChange(value: number | null, language: "en" | "th") {
  if (value == null || !Number.isFinite(value)) return "-";
  const sign = value > 0 ? "+" : "";
  return `${sign}${formatNumber(value, language, 1)} pp`;
}

function formatChangeSentence(value: number | null, language: "en" | "th", metric: "revenue" | "fuel" | "balance" | "margin") {
  if (value == null || !Number.isFinite(value)) return `${metric} was unchanged`;
  const direction = value > 0 ? "increased" : value < 0 ? "decreased" : "was unchanged";
  const formatted = metric === "margin"
    ? formatSignedPointChange(value, language)
    : formatSignedPercent(value, language);
  return `${metric} ${direction} ${formatted}`;
}

function pluralVehicle(count: number) {
  return `${count} ${count === 1 ? "vehicle" : "vehicles"}`;
}

function monthlyDataNote(status: VehiclePerformanceMonthlyPerformanceRow["status"]) {
  return status === "partial" ? " (Partial data)" : "";
}

function performanceStatusLabel(status: VehiclePerformanceRow["status"], labels: ReturnType<typeof useLanguage>["t"]["vehiclePerformance"]) {
  if (status === "strong") return labels.strong;
  if (status === "stable") return "Stable";
  if (status === "needsAttention") return labels.needsAttention;
  return labels.monitor;
}

function performanceStatusReason(row: VehiclePerformanceRow, language: "en" | "th") {
  if (row.statusReason) return row.statusReason;
  const margin = formatPercent(row.marginPercent, language);
  const fuel = formatPercent(row.fuelPercent, language);
  if (row.status === "needsAttention") {
    if (row.recordedBalance < 0) return "Attention because balance is negative.";
    if (row.marginPercent != null && row.marginPercent < VEHICLE_PERFORMANCE_STATUS_RULES.needsAttentionMinMarginPercent) return `Attention because margin is ${margin}.`;
    if (row.fuelPercent != null && row.fuelPercent > VEHICLE_PERFORMANCE_STATUS_RULES.needsAttentionMaxFuelPercent) return `Attention because fuel is ${fuel}.`;
    return "Attention because critical performance data is outside threshold.";
  }
  if (row.status === "strong") {
    return `Strong because margin is ${margin} and fuel is ${fuel}.`;
  }
  if (row.status === "stable") {
    if (row.marginPercent != null && row.marginPercent < VEHICLE_PERFORMANCE_STATUS_RULES.strongMarginPercent) return `Stable because margin is ${margin}.`;
    if (row.fuelPercent != null && row.fuelPercent > VEHICLE_PERFORMANCE_STATUS_RULES.strongMaxFuelPercent) return `Stable because fuel is ${fuel}.`;
    return `Stable because margin is ${margin} and fuel is ${fuel}.`;
  }
  if (row.marginPercent != null && row.marginPercent < VEHICLE_PERFORMANCE_STATUS_RULES.stableMarginPercent) return `Monitor because margin is ${margin}, below the ${VEHICLE_PERFORMANCE_STATUS_RULES.stableMarginPercent}% Stable threshold.`;
  if (row.fuelPercent != null && row.fuelPercent > VEHICLE_PERFORMANCE_STATUS_RULES.stableMaxFuelPercent) return `Monitor because fuel is ${fuel}, above the ${VEHICLE_PERFORMANCE_STATUS_RULES.stableMaxFuelPercent}% Stable threshold.`;
  return "Monitor because performance is below the Stable threshold, but not at Attention level.";
}

function monitorReason(row: VehiclePerformanceRow, language: "en" | "th") {
  if (row.statusReason) return row.statusReason;
  if (row.marginPercent != null && row.marginPercent < VEHICLE_PERFORMANCE_STATUS_RULES.stableMarginPercent) {
    return `Margin below ${VEHICLE_PERFORMANCE_STATUS_RULES.stableMarginPercent}% target`;
  }
  if (row.fuelPercent != null && row.fuelPercent > VEHICLE_PERFORMANCE_STATUS_RULES.stableMaxFuelPercent) {
    return `Fuel above ${VEHICLE_PERFORMANCE_STATUS_RULES.stableMaxFuelPercent}% target`;
  }
  return performanceStatusReason(row, language).replace(/^Monitor because /, "");
}

async function loadVehiclePerformancePdfThaiFont() {
  if (typeof document === "undefined" || typeof FontFace === "undefined") return;
  let fontAlreadyLoaded = false;
  document.fonts.forEach((font) => {
    if (font.family === "VehiclePerformancePdfThai") fontAlreadyLoaded = true;
  });
  if (fontAlreadyLoaded) return;
  const response = await fetch("/fonts/boss-pdf-thai.ttf");
  if (!response.ok) throw new Error("Unable to load Thai PDF font.");
  const font = new FontFace("VehiclePerformancePdfThai", await response.arrayBuffer(), {
    style: "normal",
    weight: "400"
  });
  await font.load();
  document.fonts.add(font);
  await document.fonts.ready;
}

function vehiclePerformancePdfFont(language: "en" | "th") {
  return language === "th" ? "VehiclePerformancePdfThai, Arial, sans-serif" : "Arial, Helvetica, sans-serif";
}

function binaryStringFromDataUrl(dataUrl: string) {
  return atob(dataUrl.split(",")[1] ?? "");
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

async function loadVehiclePerformancePdfLogo(): Promise<VehiclePerformancePdfLogo> {
  if (typeof document === "undefined") return { dataUrl: null };
  try {
    const image = await loadCanvasImage("/logo.png");
    const targetWidth = 132;
    const targetHeight = targetWidth * (image.height / image.width);
    const canvas = document.createElement("canvas");
    canvas.width = targetWidth * 2;
    canvas.height = targetHeight * 2;
    const context = canvas.getContext("2d");
    if (!context) return { dataUrl: null };
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return { dataUrl: canvas.toDataURL("image/png"), height: targetHeight, width: targetWidth };
  } catch (error) {
    console.warn("Vehicle performance PDF logo load failed:", error);
    return { dataUrl: null };
  }
}

function buildImagePagesPdf(
  imagePages: Array<{ data: string; height: number; width: number }>,
  pageSize: { height: number; width: number } = { height: 842, width: 595 }
) {
  const pageWidth = pageSize.width;
  const pageHeight = pageSize.height;
  const kids = imagePages.map((_, index) => `${3 + index * 3} 0 R`).join(" ");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${kids}] /Count ${imagePages.length} >>`
  ];

  imagePages.forEach((page, index) => {
    const imageName = `PageImage${index + 1}`;
    const contentStream = `q ${pageWidth} 0 0 ${pageHeight} 0 0 cm /${imageName} Do Q`;
    const pageObjectNumber = 3 + index * 3;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /XObject << /${imageName} ${pageObjectNumber + 2} 0 R >> >> /Contents ${pageObjectNumber + 1} 0 R >>`,
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

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function buildVehiclePerformancePdf(
  data: VehiclePerformancePdfData,
  logo: VehiclePerformancePdfLogo,
  language: "en" | "th"
) {
  if (language === "th") await loadVehiclePerformancePdfThaiFont();

  const page = { width: 595, height: 842 };
  const scale = 2;
  const margin = 34;
  const bottom = page.height - 56;
  const contentWidth = page.width - margin * 2;
  const fontFamily = vehiclePerformancePdfFont(language);
  const logoImage = logo.dataUrl ? await loadCanvasImage(logo.dataUrl) : null;
  const images: Array<{ data: string; height: number; width: number }> = [];
  const colors = {
    amber: "#f59e0b",
    blue: "#2563eb",
    border: "#d8cdef",
    green: "#059669",
    purple: "#6d28d9",
    purpleLight: "#f5f3ff",
    red: "#dc2626",
    slate: "#0f172a",
    soft: "#f8fafc",
    text: "#334155",
    muted: "#64748b"
  };
  let canvas = document.createElement("canvas");
  let context = canvas.getContext("2d")!;
  let y = margin;
  let pageNumber = 0;

  const toneColor = (tone: VehiclePerformancePdfTone = "default") => {
    if (tone === "success") return colors.green;
    if (tone === "info") return colors.blue;
    if (tone === "warning") return colors.amber;
    if (tone === "danger") return colors.red;
    return colors.purple;
  };
  const font = (size: number, weight = 500) => {
    context.font = `${weight} ${size * scale}px ${fontFamily}`;
  };
  const text = (value: string, x: number, textY: number, options?: { color?: string; size?: number; weight?: number; align?: CanvasTextAlign }) => {
    context.fillStyle = options?.color ?? colors.text;
    context.textAlign = options?.align ?? "left";
    font(options?.size ?? 8, options?.weight ?? 500);
    context.fillText(value, x * scale, textY * scale);
    context.textAlign = "left";
  };
  const rect = (x: number, rectY: number, width: number, height: number, fill: string, stroke = colors.border) => {
    context.fillStyle = fill;
    context.strokeStyle = stroke;
    context.lineWidth = 1 * scale;
    context.fillRect(x * scale, rectY * scale, width * scale, height * scale);
    context.strokeRect(x * scale, rectY * scale, width * scale, height * scale);
  };
  const measure = (value: string, size = 8, weight = 500) => {
    font(size, weight);
    return context.measureText(value).width / scale;
  };
  const fitText = (value: string, maxWidth: number, size = 8, weight = 500) => {
    if (measure(value, size, weight) <= maxWidth) return value;
    let next = value;
    while (next.length > 3 && measure(`${next}...`, size, weight) > maxWidth) {
      next = next.slice(0, -1);
    }
    return `${next}...`;
  };
  const linesFor = (value: string, maxWidth: number, size = 8, weight = 500) => {
    const words = value.split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let current = "";
    words.forEach((word) => {
      const candidate = current ? `${current} ${word}` : word;
      if (measure(candidate, size, weight) <= maxWidth) {
        current = candidate;
      } else {
        if (current) lines.push(current);
        current = word;
      }
    });
    if (current) lines.push(current);
    return lines.length ? lines : [value];
  };
  const paragraph = (value: string, x: number, width: number, size = 8, color = colors.text) => {
    const lines = linesFor(value, width, size);
    lines.forEach((line) => {
      text(line, x, y, { color, size, weight: 500 });
      y += size + 4;
    });
  };
  const finishPage = () => {
    text("Fuel Bank / Expert Express Sender", margin, page.height - 24, { color: colors.muted, size: 7, weight: 600 });
    text(`Generated ${data.generatedAt}`, page.width / 2, page.height - 24, { align: "center", color: colors.muted, size: 7 });
    text(`Page ${pageNumber}`, page.width - margin, page.height - 24, { align: "right", color: colors.muted, size: 7, weight: 600 });
    images.push({
      data: binaryStringFromDataUrl(canvas.toDataURL("image/jpeg", 0.92)),
      height: canvas.height,
      width: canvas.width
    });
  };
  const startPage = () => {
    pageNumber += 1;
    canvas = document.createElement("canvas");
    canvas.width = page.width * scale;
    canvas.height = page.height * scale;
    context = canvas.getContext("2d")!;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    y = margin;

    if (logoImage) {
      const logoWidth = Math.min(104, logo.width ?? 104);
      const logoHeight = logo.height && logo.width ? logoWidth * (logo.height / logo.width) : 30;
      context.drawImage(logoImage, margin * scale, y * scale, logoWidth * scale, logoHeight * scale);
    }
    text("Expert Express Sender Co., Ltd.", page.width - margin, y + 10, { align: "right", color: colors.slate, size: 11, weight: 800 });
    text(data.title, page.width - margin, y + 28, { align: "right", color: colors.purple, size: 13, weight: 800 });
    text(`${data.periodLabel} | ${data.vehicleCount} vehicles analysed`, page.width - margin, y + 45, { align: "right", color: colors.muted, size: 8, weight: 600 });
    y += 70;
  };
  const ensureSpace = (height: number) => {
    if (y + height <= bottom) return;
    finishPage();
    startPage();
  };
  const section = (title: string) => {
    ensureSpace(34);
    text(title, margin, y, { color: colors.slate, size: 12, weight: 800 });
    context.strokeStyle = colors.border;
    context.lineWidth = 1 * scale;
    context.beginPath();
    context.moveTo(margin * scale, (y + 8) * scale);
    context.lineTo((page.width - margin) * scale, (y + 8) * scale);
    context.stroke();
    y += 22;
  };
  const metricGrid = (metrics: VehiclePerformancePdfMetric[], columns = 4) => {
    const gap = 8;
    const width = (contentWidth - gap * (columns - 1)) / columns;
    metrics.forEach((metric, index) => {
      if (index % columns === 0) ensureSpace(60);
      const x = margin + (index % columns) * (width + gap);
      if (index > 0 && index % columns === 0) y += 66;
      rect(x, y, width, 56, metric.tone === "default" ? "#ffffff" : "#ffffff", metric.tone ? toneColor(metric.tone) : colors.border);
      text(fitText(metric.label, width - 14, 6.4, 800), x + 7, y + 15, { color: colors.muted, size: 6.4, weight: 800 });
      text(fitText(metric.value, width - 14, 9.2, 800), x + 7, y + 34, { color: toneColor(metric.tone), size: 9.2, weight: 800 });
      if (metric.detail) text(fitText(metric.detail, width - 14, 6.3), x + 7, y + 48, { color: colors.muted, size: 6.3 });
    });
    y += 66;
  };
  const drawTrend = () => {
    const usable = data.trendRows.filter((row) => row.status !== "missing");
    if (usable.length < 2) return;
    ensureSpace(154);
    const chartX = margin;
    const chartY = y;
    const chartH = 128;
    const chartW = contentWidth;
    rect(chartX, chartY, chartW, chartH, colors.soft);
    const series = [
      { key: "grossRevenue" as const, label: "Revenue", color: colors.purple },
      { key: "fuelPercent" as const, label: "Fuel %", color: colors.amber },
      { key: "marginPercent" as const, label: "Margin %", color: colors.green }
    ];
    series.forEach((item, seriesIndex) => {
      const values = usable.map((row) => Number(row[item.key] ?? 0));
      const max = Math.max(...values.map((value) => Math.abs(value)), 1);
      const points = usable.map((row, index) => ({
        x: chartX + 18 + (index / Math.max(usable.length - 1, 1)) * (chartW - 36),
        y: chartY + 18 + seriesIndex * 34 + 24 - (Number(row[item.key] ?? 0) / max) * 20
      }));
      context.strokeStyle = item.color;
      context.lineWidth = 2 * scale;
      context.beginPath();
      points.forEach((point, index) => {
        if (index === 0) context.moveTo(point.x * scale, point.y * scale);
        else context.lineTo(point.x * scale, point.y * scale);
      });
      context.stroke();
      text(item.label, chartX + chartW - 78, chartY + 28 + seriesIndex * 34, { color: item.color, size: 7, weight: 800 });
    });
    usable.forEach((row, index) => {
      if (index === 0 || index === usable.length - 1 || usable.length <= 5) {
        const x = chartX + 18 + (index / Math.max(usable.length - 1, 1)) * (chartW - 36);
        text(String(row.month), x, chartY + chartH - 10, { align: "center", color: colors.muted, size: 7, weight: 700 });
      }
    });
    y += chartH + 20;
  };
  const table = (title: string, dataTable: VehiclePerformancePdfTable, rows = dataTable.rows) => {
    section(title);
    const headerHeight = 22;
    const rowHeight = 22;
    const drawHeader = () => {
      rect(margin, y, contentWidth, headerHeight, colors.purple, colors.purple);
      let x = margin;
      dataTable.columns.forEach((column) => {
        text(fitText(column.label, column.width - 8, 6.2, 800), x + 4, y + 14, { color: "#ffffff", size: 6.2, weight: 800 });
        x += column.width;
      });
      y += headerHeight;
    };
    drawHeader();
    rows.forEach((row, index) => {
      if (y + rowHeight > bottom) {
        finishPage();
        startPage();
        drawHeader();
      }
      rect(margin, y, contentWidth, rowHeight, index % 2 === 0 ? "#ffffff" : colors.soft, "#e2e8f0");
      let x = margin;
      row.forEach((cell, columnIndex) => {
        const column = dataTable.columns[columnIndex];
        const align = column.align ?? "left";
        const textX = align === "right" ? x + column.width - 5 : align === "center" ? x + column.width / 2 : x + 5;
        text(fitText(cell, column.width - 10, 6.5), textX, y + 14, { align, color: colors.text, size: 6.5, weight: columnIndex === 0 ? 700 : 500 });
        x += column.width;
      });
      y += rowHeight;
    });
    y += 12;
  };

  startPage();
  rect(margin, y, contentWidth, 54, colors.purpleLight, colors.border);
  text(`Selected period: ${data.periodLabel}`, margin + 12, y + 18, { color: colors.slate, size: 9, weight: 800 });
  text(`Coverage: ${data.coverageSummary}`, margin + 12, y + 34, { color: colors.text, size: 8 });
  text(data.searchQuery ? `Vehicle filter: ${data.searchQuery}` : "Vehicle filter: All vehicles", margin + 12, y + 48, { color: colors.text, size: 8 });
  y += 76;

  section("Executive Summary");
  data.executiveSummary.forEach((line) => paragraph(line, margin, contentWidth, 8.1, colors.text));
  y += 6;

  section("KPI Summary");
  metricGrid(data.kpis);

  section("Monthly Trend");
  drawTrend();
  table("Monthly Performance", data.monthlyTable);

  section("Fleet Health");
  metricGrid(data.fleetHealth, 4);
  paragraph("Monitor means profitable but below normal fleet performance and worth reviewing. Attention means a serious threshold has been crossed.", margin, contentWidth, 7.5, colors.muted);
  y += 8;

  section("Management Highlights");
  metricGrid(data.highlights, 3);

  section("Vehicles to Review");
  if (!data.reviewRows.length) {
    paragraph("No vehicles currently require immediate attention.", margin, contentWidth, 8, colors.green);
  } else {
    const reviewTable: VehiclePerformancePdfTable = {
      columns: [
        { label: "Vehicle", width: 68 },
        { label: "Revenue", width: 72, align: "right" },
        { label: "Fuel %", width: 48, align: "right" },
        { label: "Recorded Balance", width: 86, align: "right" },
        { label: "Margin %", width: 54, align: "right" },
        { label: "Status", width: 56 },
        { label: "Reason", width: contentWidth - 384 }
      ],
      rows: data.reviewRows.map((row) => row.values)
    };
    table("Monitor and Attention Vehicles", reviewTable);
  }

  table("Top 5 Vehicles by Recorded Balance", data.topVehicles);
  table("Vehicle Performance Table", data.vehicleTable);

  section("Data Quality");
  data.dataQuality.forEach((line) => paragraph(line, margin, contentWidth, 7.8));
  paragraph(`Reconciliation status: ${data.reconciliationStatus}`, margin, contentWidth, 7.8, colors.purple);
  y += 8;
  section("Footer / Disclaimer");
  paragraph(data.disclaimer, margin, contentWidth, 7.8, colors.muted);

  finishPage();
  return buildImagePagesPdf(images, page);
}

export default function VehiclePerformancePage() {
  const { language, t } = useLanguage();
  const labels = t.vehiclePerformance;
  const { can } = useAccountAccess();
  const canWrite = can("business:write");
  const canDelete = can("business:delete");
  const [year, setYear] = useState(2026);
  const [month, setMonth] = useState<MonthFilter>("");
  const [searchQuery, setSearchQuery] = useState("");
  const [records, setRecords] = useState<VehicleMonthlyPerformance[]>([]);
  const [fuelRows, setFuelRows] = useState<Awaited<ReturnType<typeof fetchVehicleMonthlyFuelSpend>>>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [tripJourneys, setTripJourneys] = useState<TripJourneyWithFuel[]>([]);
  const [detailVehicle, setDetailVehicle] = useState<string | null>(null);
  const [movementFilter, setMovementFilter] = useState<Direction | null>(null);
  const [rankingKey, setRankingKey] = useState<RankingKey>("recordedBalance");
  const [form, setForm] = useState<PerformanceForm>(initialForm);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const loadSequence = useRef(0);
  const [saving, setSaving] = useState(false);
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [vehicleLoadError, setVehicleLoadError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importRows, setImportRows] = useState<VehiclePerformanceImportRow[]>([]);
  const [importing, setImporting] = useState(false);
  const [importMode, setImportMode] = useState<"skip" | "update">("skip");
  const [importSummary, setImportSummary] = useState<string | null>(null);
  const [selectedImportFileName, setSelectedImportFileName] = useState("");
  const [importStatusFilter, setImportStatusFilter] = useState<ImportStatusFilter>("");
  const [importMonthFilter, setImportMonthFilter] = useState<MonthFilter>("");
  const [importVehicleFilter, setImportVehicleFilter] = useState("");
  const [fuelDetailRowId, setFuelDetailRowId] = useState<string | null>(null);
  const [fuelDetailLogs, setFuelDetailLogs] = useState<FuelLogWithDriver[]>([]);
  const [fuelDetailLoading, setFuelDetailLoading] = useState(false);
  const [fuelDetailError, setFuelDetailError] = useState<string | null>(null);
  const [correctionRowId, setCorrectionRowId] = useState<string | null>(null);
  const [correctionForm, setCorrectionForm] = useState<CorrectionForm | null>(null);
  const [correctionSaving, setCorrectionSaving] = useState(false);
  const [correctionError, setCorrectionError] = useState<string | null>(null);
  const [dataManagementOpen, setDataManagementOpen] = useState(false);
  const [dataQualityOpen, setDataQualityOpen] = useState(false);
  const [partialMonthDetail, setPartialMonthDetail] = useState<number | null>(null);
  const [vehicleCoverageOpen, setVehicleCoverageOpen] = useState(false);
  const [coverageVehicleDetail, setCoverageVehicleDetail] = useState<CoverageVehicleDetail | null>(null);
  const [monitorDetailOpen, setMonitorDetailOpen] = useState(false);
  const [trendMetric, setTrendMetric] = useState<TrendMetric>("grossRevenue");
  const [vehicleSort, setVehicleSort] = useState<{ key: VehicleSortKey; direction: "asc" | "desc" }>({
    key: "recordedBalance",
    direction: "desc"
  });
  const importInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    setLoadError(null);
    setLoading(true);
    setError(null);
    setVehicleLoadError(null);
    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      if (!sessionData.session) throw new Error("Sign in to load vehicle performance records.");
      const [performanceRows, fuelSpendRows, tripRows] = await Promise.all([
        fetchVehicleMonthlyPerformance({ year }),
        fetchVehicleMonthlyFuelSpend({ year }),
        fetchTripJourneys()
      ]);
      if (sequence !== loadSequence.current) return;
      setRecords(performanceRows);
      setFuelRows(fuelSpendRows);
      setTripJourneys(tripRows);

      try {
        const vehicleRows = await fetchVehicles();
        if (sequence !== loadSequence.current) return;
        setVehicles(vehicleRows);
        if (!vehicleRows.length) {
          setVehicleLoadError(labels.vehicleDataUnavailable);
        }
      } catch (vehicleError) {
        if (sequence !== loadSequence.current) return;
        console.error("Vehicle performance vehicle load error:", vehicleError);
        setVehicles([]);
        setVehicleLoadError(labels.vehicleDataUnavailable);
      }
    } catch (err) {
      if (sequence !== loadSequence.current) return;
      console.error("Vehicle performance load error:", err);
      setLoadError(err && typeof err === "object" && "message" in err ? String(err.message) : labels.unableToLoad);
      setRecords([]);
      setFuelRows([]);
      setTripJourneys([]);
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }, [labels.unableToLoad, labels.vehicleDataUnavailable, year]);

  useEffect(() => {
    void load();
    return () => { loadSequence.current += 1; };
  }, [load]);

  useEffect(() => {
    const handleDataChanged = () => void load();
    window.addEventListener("fuel-bank:data-changed", handleDataChanged);
    return () => window.removeEventListener("fuel-bank:data-changed", handleDataChanged);
  }, [load]);

  const selectedMonths = useMemo(
    () => month === "" ? [...VEHICLE_PERFORMANCE_BASELINE_MONTHS] : [month],
    [month]
  );
  const selectedMonthSet = useMemo(() => new Set<number>(selectedMonths), [selectedMonths]);
  const selectedRecords = useMemo(
    () => records.filter((record) => selectedMonthSet.has(record.month) && normalizeComparableText(record.vehicle_registration).includes(normalizeComparableText(searchQuery))),
    [records, selectedMonthSet, searchQuery]
  );
  const selectedTripFinancials = useMemo(() => {
    const normalizedSearch = normalizeComparableText(searchQuery);
    return summarizeTripFinancials(tripJourneys.filter((trip) => {
      const tripDate = new Date(`${trip.trip_date || trip.date}T00:00:00`);
      return tripDate.getFullYear() === year &&
        selectedMonthSet.has(tripDate.getMonth() + 1) &&
        normalizeComparableText(trip.vehicle_reg).includes(normalizedSearch);
    }));
  }, [searchQuery, selectedMonthSet, tripJourneys, year]);
  const management = useMemo(() => buildPerformanceManagement({ records, fuelRows, months: selectedMonths }), [records, fuelRows, selectedMonths]);
  const rows = useMemo(() => management.rows.filter(row => normalizeComparableText(row.vehicleRegistration).includes(normalizeComparableText(searchQuery))), [management, searchQuery]);
  const queueManagement = useMemo(() => {
    const actionRows = management.actionRows.filter(row => normalizeComparableText(row.vehicleRegistration).includes(normalizeComparableText(searchQuery)));
    return { ...management, actionRows, totalOpportunity: actionRows.reduce((sum, row) => sum + (row.opportunity ?? 0), 0), estimatedVehicleCount: actionRows.filter(row => row.opportunity != null && row.opportunity > 0).length };
  }, [management, searchQuery]);
  const vehicleHistory = useMemo(() => detailVehicle ? [...new Set<number>([...VEHICLE_PERFORMANCE_BASELINE_MONTHS, ...records.map(record => record.month)])].sort((a, b) => a - b).map(monthNumber => {
    const model = buildPerformanceManagement({ records, fuelRows, months: [monthNumber] });
    return { month: monthNumber, row: model.rows.find(row => row.vehicleRegistration === detailVehicle), benchmark: model.benchmark };
  }) : [], [records, fuelRows, detailVehicle]);
  const openVehicle = (registration: string) => { setDetailVehicle(registration); requestAnimationFrame(() => document.getElementById("vehicle-detail")?.scrollIntoView({ behavior: "smooth", block: "start" })); };
  const summary = useMemo(() => buildVehiclePerformanceSummary(rows), [rows]);

  const monthlyTrend = useMemo(() => buildVehicleMonthlyTrend(selectedRecords, fuelRows), [fuelRows, selectedRecords]);
  const monthlyPerformanceRows = useMemo(
    () => buildVehicleMonthlyPerformanceRows({
      records: selectedRecords,
      fuelRows,
      months: selectedMonths,
      expectedVehicleCount: new Set(records.filter(record => normalizeComparableText(record.vehicle_registration).includes(normalizeComparableText(searchQuery))).map(record => vehicleKey(record.vehicle_registration))).size
    }),
    [fuelRows, records, searchQuery, selectedMonths, selectedRecords]
  );
  const monthlySummary = useMemo(() => buildVehiclePerformanceSummary(monthlyTrend), [monthlyTrend]);
  const reconciliation = useMemo(() => {
    const tolerance = 0.01;
    const vehicleFuel = rows.reduce((sum, row) => sum + row.fuelSpend, 0);
    const monthlyFuel = monthlyPerformanceRows.reduce((sum, row) => sum + row.fuelSpend, 0);
    return {
      summaryToVehicle:
        Math.abs(summary.grossRevenue - rows.reduce((sum, row) => sum + row.grossRevenue, 0)) <= tolerance &&
        Math.abs(summary.fuelSpend - vehicleFuel) <= tolerance &&
        Math.abs(summary.salaryCost - rows.reduce((sum, row) => sum + row.salaryCost, 0)) <= tolerance &&
        Math.abs(summary.tripIncome - rows.reduce((sum, row) => sum + row.tripIncome, 0)) <= tolerance &&
        Math.abs(summary.otherExpenses - rows.reduce((sum, row) => sum + row.otherExpenses, 0)) <= tolerance &&
        Math.abs(summary.recordedBalance - rows.reduce((sum, row) => sum + row.recordedBalance, 0)) <= tolerance,
      vehicleToMonthly:
        Math.abs(summary.grossRevenue - monthlySummary.grossRevenue) <= tolerance &&
        Math.abs(summary.fuelSpend - monthlySummary.fuelSpend) <= tolerance &&
        Math.abs(summary.salaryCost - monthlySummary.salaryCost) <= tolerance &&
        Math.abs(summary.tripIncome - monthlySummary.tripIncome) <= tolerance &&
        Math.abs(summary.otherExpenses - monthlySummary.otherExpenses) <= tolerance &&
        Math.abs(summary.recordedBalance - monthlySummary.recordedBalance) <= tolerance,
      fuelToVehicle: Math.abs(monthlyFuel - vehicleFuel) <= tolerance
    };
  }, [monthlyPerformanceRows, monthlySummary, rows, summary]);
  const totalsReconcile = reconciliation.summaryToVehicle && reconciliation.vehicleToMonthly && reconciliation.fuelToVehicle;

  const rankedRows = useMemo(() => {
    const sorted = [...rows].sort((left, right) => {
      if (rankingKey === "fuelPercent") {
        return (left.fuelPercent ?? Number.POSITIVE_INFINITY) - (right.fuelPercent ?? Number.POSITIVE_INFINITY);
      }
      if (rankingKey === "lowestRecordedBalance") {
        return left.recordedBalance - right.recordedBalance;
      }
      return (right[rankingKey] ?? Number.NEGATIVE_INFINITY) - (left[rankingKey] ?? Number.NEGATIVE_INFINITY);
    });
    return sorted.slice(0, 5);
  }, [rankingKey, rows]);

  const sortedRows = useMemo(() => {
    return [...rows].sort((left, right) => {
      if (vehicleSort.key === "vehicleRegistration") {
        return vehicleSort.direction === "asc"
          ? left.vehicleRegistration.localeCompare(right.vehicleRegistration)
          : right.vehicleRegistration.localeCompare(left.vehicleRegistration);
      }
      if (vehicleSort.key === "status") {
        const weight = { needsAttention: 0, monitor: 1, stable: 2, strong: 3 };
        return vehicleSort.direction === "asc"
          ? weight[left.status] - weight[right.status]
          : weight[right.status] - weight[left.status];
      }
      return compareNullableMetric(left[vehicleSort.key] as number | null, right[vehicleSort.key] as number | null, vehicleSort.direction);
    });
  }, [rows, vehicleSort]);
  const visibleTableRows = useMemo(() => sortedRows.filter(row => !movementFilter || management.changes.some(change => change.registration === row.vehicleRegistration && change.direction === movementFilter)), [sortedRows, movementFilter, management.changes]);
  const vehicleMonthCounts = useMemo(() => {
    const counts = new Map<string, Set<number>>();
    for (const record of selectedRecords) {
      const key = vehicleKey(record.vehicle_registration);
      if (!counts.has(key)) counts.set(key, new Set<number>());
      counts.get(key)?.add(record.month);
    }
    return new Map(Array.from(counts.entries()).map(([key, months]) => [key, months.size]));
  }, [selectedRecords]);
  const expectedVehicleRegistrations = useMemo(
    () => Array.from(new Set(records.filter(record => normalizeComparableText(record.vehicle_registration).includes(normalizeComparableText(searchQuery))).map((record) => normalizeVehicleRegistration(record.vehicle_registration)).filter(Boolean))).sort(),
    [records, searchQuery]
  );
  const missingVehiclesByMonth = useMemo(() => {
    const expectedKeys = new Map(expectedVehicleRegistrations.map((registration) => [vehicleKey(registration), registration]));
    const result = new Map<number, string[]>();
    for (const monthNumber of selectedMonths) {
      const present = new Set(
        selectedRecords
          .filter((record) => record.month === monthNumber)
          .map((record) => vehicleKey(record.vehicle_registration))
      );
      result.set(monthNumber, Array.from(expectedKeys.entries())
        .filter(([key]) => !present.has(key))
        .map(([, registration]) => registration));
    }
    return result;
  }, [expectedVehicleRegistrations, selectedMonths, selectedRecords]);
  const missingMonthsByVehicle = useMemo(() => {
    const result = new Map<string, number[]>();
    for (const registration of expectedVehicleRegistrations) {
      const key = vehicleKey(registration);
      const presentMonths = new Set(
        selectedRecords
          .filter((record) => vehicleKey(record.vehicle_registration) === key)
          .map((record) => record.month)
      );
      result.set(key, selectedMonths.filter((monthNumber) => !presentMonths.has(monthNumber)));
    }
    return result;
  }, [expectedVehicleRegistrations, selectedMonths, selectedRecords]);
  const monthCoverageCounts = useMemo(() => ({
    complete: monthlyPerformanceRows.filter((row) => row.status === "complete").length,
    partial: monthlyPerformanceRows.filter((row) => row.status === "partial").length
  }), [monthlyPerformanceRows]);
  const performanceStatusCounts = useMemo(() => ({
    strong: rows.filter((row) => row.status === "strong").length,
    stable: rows.filter((row) => row.status === "stable").length,
    monitor: rows.filter((row) => row.status === "monitor").length,
    attention: rows.filter((row) => row.status === "needsAttention").length
  }), [rows]);

  const attentionRows = useMemo(
    () => rows.filter((row) => row.status === "needsAttention").sort((left, right) => left.recordedBalance - right.recordedBalance),
    [rows]
  );
  const monitorRows = useMemo(
    () => rows.filter((row) => row.status === "monitor").sort((left, right) => {
      const leftMargin = left.marginPercent ?? Number.POSITIVE_INFINITY;
      const rightMargin = right.marginPercent ?? Number.POSITIVE_INFINITY;
      if (leftMargin !== rightMargin) return leftMargin - rightMargin;
      return (right.fuelPercent ?? 0) - (left.fuelPercent ?? 0);
    }),
    [rows]
  );

  const managementInsights = useMemo(() => {
    const byHighest = (metric: keyof Pick<VehiclePerformanceRow, "grossRevenue" | "recordedBalance" | "fuelSpend">) =>
      rows.length ? [...rows].sort((left, right) => right[metric] - left[metric])[0] : null;
    const byMetric = (metric: keyof Pick<VehiclePerformanceRow, "marginPercent" | "fuelPercent">, direction: "asc" | "desc") =>
      rows.filter((row) => row[metric] != null).sort((left, right) => compareNullableMetric(left[metric], right[metric], direction))[0] ?? null;
    const monthByMetric = (metric: keyof Pick<VehiclePerformanceMonthlyPerformanceRow, "grossRevenue" | "recordedBalance" | "fuelPercent">, direction: "asc" | "desc") =>
      (monthlyPerformanceRows.some((row) => row.status === "complete")
        ? monthlyPerformanceRows.filter((row) => row.status === "complete")
        : monthlyPerformanceRows.filter((row) => row.status !== "missing")
      ).filter((row) => row[metric] != null).sort((left, right) => compareNullableMetric(left[metric] as number | null, right[metric] as number | null, direction))[0] ?? null;
    const bestBenchmarkVehicle = rows
      .filter((row) => row.recordedBalance > 0 && row.marginPercent != null && row.fuelPercent != null)
      .sort((left, right) => {
        const leftCoverage = vehicleMonthCounts.get(vehicleKey(left.vehicleRegistration)) ?? 0;
        const rightCoverage = vehicleMonthCounts.get(vehicleKey(right.vehicleRegistration)) ?? 0;
        const leftFullCoverage = selectedMonths.length > 0 && leftCoverage === selectedMonths.length ? 1 : 0;
        const rightFullCoverage = selectedMonths.length > 0 && rightCoverage === selectedMonths.length ? 1 : 0;
        if (leftFullCoverage !== rightFullCoverage) return rightFullCoverage - leftFullCoverage;
        if (left.marginPercent !== right.marginPercent) return (right.marginPercent ?? 0) - (left.marginPercent ?? 0);
        if (left.fuelPercent !== right.fuelPercent) return (left.fuelPercent ?? Number.POSITIVE_INFINITY) - (right.fuelPercent ?? Number.POSITIVE_INFINITY);
        return right.recordedBalance - left.recordedBalance;
      })[0] ?? null;

    return {
      highestRevenueVehicle: byHighest("grossRevenue"),
      highestBalanceVehicle: byHighest("recordedBalance"),
      bestMarginVehicle: byMetric("marginPercent", "desc"),
      highestFuelPercentVehicle: byMetric("fuelPercent", "desc"),
      lowestMarginVehicle: byMetric("marginPercent", "asc"),
      highestRevenueMonth: monthByMetric("grossRevenue", "desc"),
      highestBalanceMonth: monthByMetric("recordedBalance", "desc"),
      highestFuelPercentMonth: monthByMetric("fuelPercent", "desc"),
      lowestFuelPercentMonth: monthByMetric("fuelPercent", "asc"),
      bestBenchmarkVehicle
    };
  }, [monthlyPerformanceRows, rows, selectedMonths.length, vehicleMonthCounts]);
  const previousMonthComparison = useMemo(() => {
    const completeLoaded = monthlyPerformanceRows.filter((row) => row.status === "complete" && (row.grossRevenue > 0 || row.fuelSpend > 0 || row.recordedBalance !== 0));
    const loaded = completeLoaded.length >= 2
      ? completeLoaded
      : monthlyPerformanceRows.filter((row) => row.status !== "missing" && (row.grossRevenue > 0 || row.fuelSpend > 0 || row.recordedBalance !== 0));
    if (loaded.length < 2) return null;
    const previous = loaded[loaded.length - 2];
    const current = loaded[loaded.length - 1];
    const percentChange = (currentValue: number, previousValue: number) =>
      previousValue === 0 ? null : ((currentValue - previousValue) / Math.abs(previousValue)) * 100;
    return {
      previous,
      current,
      revenueChange: percentChange(current.grossRevenue, previous.grossRevenue),
      fuelChange: percentChange(current.fuelSpend, previous.fuelSpend),
      balanceChange: percentChange(current.recordedBalance, previous.recordedBalance),
      marginPointChange:
        current.marginPercent == null || previous.marginPercent == null
          ? null
          : current.marginPercent - previous.marginPercent
    };
  }, [monthlyPerformanceRows]);

  const dataQuality = useMemo(() => {
    const representedMonths = Array.from(new Set(selectedRecords.map((record) => record.month))).sort((left, right) => left - right);
    const representedVehicles = new Set(selectedRecords.map((record) => normalizeComparableText(normalizeVehicleRegistration(record.vehicle_registration))));
    const monthsWithRecords = new Set(selectedRecords.map((record) => record.month));
    const missingMonths = MONTH_OPTIONS
      .filter((option) => selectedMonthSet.has(option.value) && !monthsWithRecords.has(option.value))
      .map((option) => labels.months[option.labelKey]);
    const unresolvedImportExceptions = importRows.filter((row) =>
      row.status === "Fuel warning" ||
      row.status === "Needs review" ||
      row.status === "Review required again" ||
      row.status === "Correction required"
    ).length;
    const knownTimestamps = selectedRecords
      .map((record) => record.updated_at || record.created_at)
      .map((value) => value ? new Date(value).getTime() : Number.NaN)
      .filter(Number.isFinite);
    const latestUpdate = knownTimestamps.length ? new Date(Math.max(...knownTimestamps)) : null;

    return {
      recordCount: selectedRecords.length,
      representedMonths,
      representedVehicles: representedVehicles.size,
      masterVehicles: vehicles.filter((vehicle) => normalizeVehicleRegistration(vehicle.vehicle_reg)).length,
      missingMonths,
      completeMonths: monthlyPerformanceRows.filter((row) => row.status === "complete").length,
      partialMonths: monthlyPerformanceRows.filter((row) => row.status === "partial").length,
      missingVehicleMonthRecords: Array.from(missingVehiclesByMonth.values()).reduce((sum, missingVehicles) => sum + missingVehicles.length, 0),
      lastDataUpdate: latestUpdate,
      revenueRowsWithZeroFuel: rows.filter((row) => row.grossRevenue > 0 && row.fuelSpend === 0).length,
      fuelRowsWithZeroRevenue: rows.filter((row) => row.grossRevenue === 0 && row.fuelSpend > 0).length,
      negativeBalances: rows.filter((row) => row.recordedBalance < 0).length,
      unresolvedImportExceptions
    };
  }, [importRows, labels.months, missingVehiclesByMonth, monthlyPerformanceRows, rows, selectedMonthSet, selectedRecords, vehicles]);
  const monthLabel = useCallback(
    (monthNumber: number) => labels.months[MONTH_OPTIONS[monthNumber - 1]?.labelKey ?? "january"],
    [labels.months]
  );
  const shortMonthLabel = useCallback((monthNumber: number) => monthLabel(monthNumber).slice(0, 3), [monthLabel]);
  const periodLabel = useMemo(() => {
    if (month !== "") return `${monthLabel(month)} ${year}`;
    return `${monthLabel(VEHICLE_PERFORMANCE_BASELINE_MONTHS[0])}-${monthLabel(VEHICLE_PERFORMANCE_BASELINE_MONTHS[VEHICLE_PERFORMANCE_BASELINE_MONTHS.length - 1])} ${year}`;
  }, [month, monthLabel, year]);
  const managementSnapshotInsights = useMemo(() => {
    if (!rows.length) return ["Load Vehicle Performance data to generate management insights."];
    const insights: string[] = [];
    if (managementInsights.highestRevenueMonth) {
      const balanceMonth = managementInsights.highestBalanceMonth;
      const sameMonth = balanceMonth?.month === managementInsights.highestRevenueMonth.month;
      insights.push(
        sameMonth
          ? `${monthLabel(managementInsights.highestRevenueMonth.month)} recorded the highest revenue at ${formatCompactBaht(managementInsights.highestRevenueMonth.grossRevenue)} and the highest recorded balance at ${formatCompactBaht(balanceMonth.recordedBalance)}.${monthlyDataNote(managementInsights.highestRevenueMonth.status)}`
          : `${monthLabel(managementInsights.highestRevenueMonth.month)} recorded the highest revenue at ${formatCompactBaht(managementInsights.highestRevenueMonth.grossRevenue)}.${monthlyDataNote(managementInsights.highestRevenueMonth.status)}`
      );
    }
    if (previousMonthComparison) {
      const fuelMovedDown = (previousMonthComparison.current.fuelPercent ?? 0) < (previousMonthComparison.previous.fuelPercent ?? 0);
      const marginMovedUp = (previousMonthComparison.marginPointChange ?? 0) > 0;
      insights.push(
        `Fuel % ${fuelMovedDown ? "improved" : "moved"} from ${formatPercent(previousMonthComparison.previous.fuelPercent, language)} in ${monthLabel(previousMonthComparison.previous.month)} to ${formatPercent(previousMonthComparison.current.fuelPercent, language)} in ${monthLabel(previousMonthComparison.current.month)}.${monthlyDataNote(previousMonthComparison.current.status)}`
      );
      insights.push(
        `Recorded margin ${marginMovedUp ? "improved" : "moved"} from ${formatPercent(previousMonthComparison.previous.marginPercent, language)} to ${formatPercent(previousMonthComparison.current.marginPercent, language)}.${monthlyDataNote(previousMonthComparison.current.status)}`
      );
    }
    if (managementInsights.highestBalanceVehicle) {
      insights.push(`${managementInsights.highestBalanceVehicle.vehicleRegistration} produced the highest recorded balance at ${formatBaht(managementInsights.highestBalanceVehicle.recordedBalance)} with a ${formatPercent(managementInsights.highestBalanceVehicle.marginPercent, language)} margin.`);
    }
    insights.push(
      performanceStatusCounts.attention === 0
        ? "No vehicles currently require immediate attention."
        : `${pluralVehicle(performanceStatusCounts.attention)} require attention.`
    );
    if (performanceStatusCounts.monitor > 0) {
      insights.push(`${pluralVehicle(performanceStatusCounts.monitor)} are worth monitoring because they are below normal fleet performance.`);
    }
    return insights.slice(0, 6);
  }, [language, managementInsights.highestBalanceMonth, managementInsights.highestBalanceVehicle, managementInsights.highestRevenueMonth, monthLabel, performanceStatusCounts.attention, performanceStatusCounts.monitor, previousMonthComparison, rows.length]);

  const loadedMonthCount = dataQuality.representedMonths.length;
  const selectedPeriodRecordStatus = useMemo(() => {
    if (month === "") return null;
    const row = monthlyPerformanceRows.find((item) => item.month === month);
    return row?.status ?? "missing";
  }, [month, monthlyPerformanceRows]);
  const incompletePeriodMessage = useMemo(() => {
    if (dataQuality.missingMonths.length === 0) return null;
    const missing = dataQuality.missingMonths.join(", ");
    return `Incomplete period - ${missing} ${dataQuality.missingMonths.length === 1 ? "contains" : "contain"} no vehicle performance records. Totals only include loaded months.`;
  }, [dataQuality.missingMonths]);
  const coverageRows = useMemo(
    () => monthlyPerformanceRows.map((row) => ({
      month: row.month,
      label: shortMonthLabel(row.month),
      status: row.status
    })),
    [monthlyPerformanceRows, shortMonthLabel]
  );
  const reconciliationDebug = useMemo(() => ({
    selectedPeriod: periodLabel,
    loadedMonths: dataQuality.representedMonths,
    vehicleCount: dataQuality.representedVehicles,
    vehicleMonthRecordCount: dataQuality.recordCount,
    revenueFromMonthlyRecords: selectedRecords.reduce((sum, record) => sum + Number(record.gross_revenue || 0), 0),
    revenueFromVehicleAggregation: rows.reduce((sum, row) => sum + row.grossRevenue, 0),
    summaryRevenue: summary.grossRevenue,
    fuelFromFuelLogs: monthlyPerformanceRows.reduce((sum, row) => sum + row.fuelSpend, 0),
    fuelFromVehicleAggregation: rows.reduce((sum, row) => sum + row.fuelSpend, 0),
    summaryFuel: summary.fuelSpend,
    salaryTotal: summary.salaryCost,
    tripPaymentTotal: summary.tripIncome,
    otherCostTotal: summary.otherExpenses,
    calculatedBalance: summary.grossRevenue - summary.fuelSpend - summary.salaryCost - summary.tripIncome - summary.otherExpenses,
    summaryBalance: summary.recordedBalance
  }), [dataQuality.recordCount, dataQuality.representedMonths, dataQuality.representedVehicles, monthlyPerformanceRows, periodLabel, rows, selectedRecords, summary]);

  const vehicleOptions = useMemo(
    () => Array.from(new Set(vehicles.map((vehicle) => normalizeVehicleRegistration(vehicle.vehicle_reg)).filter(Boolean))).sort(),
    [vehicles]
  );
  const vehicleByRegistration = useMemo(
    () => new Map(
      vehicles.map((vehicle) => [
        normalizeComparableText(normalizeVehicleRegistration(vehicle.vehicle_reg)),
        vehicle
      ])
    ),
    [vehicles]
  );
  const vehicleCoverageDetails = useMemo(() => {
    const performanceKeys = new Set(selectedRecords.map((record) => vehicleKey(record.vehicle_registration)));
    const withoutPerformance = vehicleOptions
      .filter((registration) => !performanceKeys.has(vehicleKey(registration)))
      .map((registration) => {
        const vehicle = vehicleByRegistration.get(vehicleKey(registration));
        const reasons = ["No monthly performance data"];
        const descriptor = `${vehicle?.vehicle_name ?? ""} ${vehicle?.vehicle_category ?? ""} ${vehicle?.vehicle_type ?? ""} ${registration}`.toLowerCase();
        if (vehicle?.active === false) reasons.unshift("Inactive");
        if (descriptor.includes("dummy") || descriptor.includes("placeholder")) reasons.unshift("Dummy / placeholder");
        return { registration, reasons };
      });
    return {
      masterCount: vehicleOptions.length,
      withPerformanceCount: vehicleOptions.length - withoutPerformance.length,
      withoutPerformance
    };
  }, [selectedRecords, vehicleByRegistration, vehicleOptions]);
  const selectedPartialMonthRow = useMemo(
    () => partialMonthDetail == null ? null : monthlyPerformanceRows.find((row) => row.month === partialMonthDetail) ?? null,
    [monthlyPerformanceRows, partialMonthDetail]
  );
  const selectedCoverageDetail = useMemo(() => {
    if (!coverageVehicleDetail) return null;
    return {
      ...coverageVehicleDetail,
      title: `Coverage ${monthLabel(selectedMonths[0])}-${monthLabel(selectedMonths[selectedMonths.length - 1])} ${year}`
    };
  }, [coverageVehicleDetail, monthLabel, selectedMonths, year]);

  const findPerformanceRecordForImportRow = useCallback((row: VehiclePerformanceImportRow) => {
    const registrationKey = normalizeComparableText(normalizeVehicleRegistration(row.canonicalVehicleRegistration || row.vehicleRegistration));
    if (!row.year || !row.month || !registrationKey) return null;
    return records.find((record) =>
      record.year === row.year &&
      record.month === row.month &&
      normalizeComparableText(normalizeVehicleRegistration(record.vehicle_registration)) === registrationKey
    ) ?? null;
  }, [records]);

  const formFuelSpend = useMemo(() => {
    const selectedVehicle = normalizeComparableText(normalizeVehicleRegistration(form.vehicle_registration));
    const selectedMonth = Number(form.month);
    if (!selectedVehicle || !selectedMonth) return 0;
    return fuelRows
      .filter((fuel) => fuel.month === selectedMonth && normalizeComparableText(normalizeVehicleRegistration(fuel.vehicleRegistration)) === selectedVehicle)
      .reduce((sum, fuel) => sum + Number(fuel.fuelSpend || 0), 0);
  }, [form.month, form.vehicle_registration, fuelRows]);

  const formBalance =
    numericInput(form.gross_revenue) -
    numericInput(form.salary_cost) -
    numericInput(form.trip_income) -
    numericInput(form.other_expenses) -
    formFuelSpend;
  const formMarginPercent = numericInput(form.gross_revenue) > 0 ? (formBalance / numericInput(form.gross_revenue)) * 100 : null;
  const duplicateFormRecord = useMemo(() => {
    const formVehicle = normalizeComparableText(normalizeVehicleRegistration(form.vehicle_registration));
    const formYear = Number(form.year);
    const formMonth = Number(form.month);
    if (!formVehicle || !formYear || !formMonth) return null;
    return records.find(
      (record) =>
        record.id !== form.id &&
        record.year === formYear &&
        record.month === formMonth &&
        normalizeComparableText(normalizeVehicleRegistration(record.vehicle_registration)) === formVehicle
    ) ?? null;
  }, [form.id, form.month, form.vehicle_registration, form.year, records]);

  const resetForm = () => {
    setForm({ ...initialForm, year: String(year), month: month ? String(month) : "1" });
    setSuccessMessage(null);
  };

  const editRecord = (record: VehicleMonthlyPerformance) => {
    setForm({
      id: record.id,
      year: String(record.year),
      month: String(record.month),
      vehicle_registration: normalizeVehicleRegistration(record.vehicle_registration),
      gross_revenue: String(Number(record.gross_revenue || 0)),
      salary_cost: String(Number(record.salary_cost || 0)),
      trip_income: String(Number(record.trip_income || 0)),
      other_expenses: String(Number(record.other_expenses || 0)),
      lpg_cost: String(Number(record.lpg_cost || 0)),
      notes: record.notes ?? ""
    });
    setSuccessMessage(null);
    setError(null);
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (duplicateFormRecord) {
      setError("A monthly record already exists for this vehicle and month. Open the existing record to edit it.");
      return;
    }
    setSaving(true);
    setError(null);
    setSuccessMessage(null);
    try {
      await saveVehicleMonthlyPerformance({
        id: form.id || undefined,
        year: Number(form.year),
        month: Number(form.month),
        vehicle_registration: form.vehicle_registration,
        gross_revenue: numericInput(form.gross_revenue),
        salary_cost: numericInput(form.salary_cost),
        trip_income: numericInput(form.trip_income),
        other_expenses: numericInput(form.other_expenses),
        lpg_cost: numericInput(form.lpg_cost),
        notes: form.notes
      });
      resetForm();
      setSuccessMessage(form.id ? labels.updateSuccess : labels.saveSuccess);
      await load();
    } catch (err) {
      console.error("Vehicle performance save error:", err);
      setError(err instanceof Error ? err.message : labels.unableToSave);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm(labels.confirmDelete)) return;
    setDeletingId(id);
    setError(null);
    try {
      await deleteVehicleMonthlyPerformance(id);
      if (form.id === id) resetForm();
      setSuccessMessage(labels.deleteSuccess);
      await load();
    } catch (err) {
      console.error("Vehicle performance delete error:", err);
      setError(err instanceof Error ? err.message : labels.unableToDelete);
    } finally {
      setDeletingId(null);
    }
  };

  const handleInvalid = (event: React.InvalidEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    applyRequiredValidationMessage(event, t.common.requiredField);
  };

  const importCounts = useMemo(() => {
    const counts = { vehicleRows: 0, ready: 0, historicalFuelDifference: 0, fuelDataMissing: 0, fuelWarning: 0, vehicleNotMatched: 0, duplicate: 0, skippedRows: 0, needsReview: 0, resolved: 0, imported: 0, existing: 0 };
    for (const row of importRows) {
      if (row.status === "Skipped") {
        counts.skippedRows += 1;
        continue;
      }

      counts.vehicleRows += 1;
      if (row.status === "Ready") counts.ready += 1;
      else if (row.status === "Historical fuel difference") counts.historicalFuelDifference += 1;
      else if (row.status === "Fuel data missing") counts.fuelDataMissing += 1;
      else if (row.status === "Fuel warning") counts.fuelWarning += 1;
      else if (row.status === "Vehicle not matched") counts.vehicleNotMatched += 1;
      else if (row.status === "Duplicate") counts.duplicate += 1;
      else if (row.status === "Needs review") counts.needsReview += 1;
      else if (row.status === "Resolved") counts.resolved += 1;
      else if (row.status === "Imported") counts.imported += 1;
      else if (row.status === "Existing") counts.existing += 1;
    }
    return counts;
  }, [importRows]);
  const exceptionCounts = useMemo(() => ({
    needsReviewRemaining: importRows.filter((row) => row.status === "Needs review" || row.status === "Review required again").length,
    fuelWarningsRemaining: importRows.filter((row) => row.status === "Fuel warning").length,
    approvedExceptions: importRows.filter((row) => row.status === "Approved").length,
    resolvedCorrections: importRows.filter((row) => row.status === "Resolved").length,
    correctionsRequired: importRows.filter((row) => row.status === "Correction required").length
  }), [importRows]);
  const readyImportCandidateCount = useMemo(
    () => importRows.filter((row) =>
      row.status === "Ready" ||
      row.status === "Historical fuel difference" ||
      row.status === "Approved" ||
      (row.status === "Duplicate" && importMode === "update" && row.existingRecordId)
    ).length,
    [importMode, importRows]
  );
  const importCandidateRows = useMemo(() => {
    const vehicleQuery = normalizeComparableText(importVehicleFilter);
    return importRows
      .filter((row) => row.status !== "Skipped")
      .filter((row) => !importStatusFilter || row.status === importStatusFilter)
      .filter((row) => !importMonthFilter || row.month === importMonthFilter)
      .filter((row) => {
        if (!vehicleQuery) return true;
        return (
          normalizeComparableText(row.vehicleRegistration).includes(vehicleQuery) ||
          normalizeComparableText(row.canonicalVehicleRegistration).includes(vehicleQuery)
        );
      });
  }, [importMonthFilter, importRows, importStatusFilter, importVehicleFilter]);
  const selectedFuelDetailRow = useMemo(
    () => importRows.find((row) => row.id === fuelDetailRowId) ?? null,
    [fuelDetailRowId, importRows]
  );
  const selectedCorrectionRow = useMemo(
    () => importRows.find((row) => row.id === correctionRowId) ?? null,
    [correctionRowId, importRows]
  );
  const importVehicleDataReady = vehicleOptions.length > 0 && !vehicleLoadError;
  const canOpenImportFilePicker = canWrite && !loading && importVehicleDataReady;

  const openImportFilePicker = () => {
    if (!canWrite) return;
    if (!importVehicleDataReady) {
      setError(labels.vehicleDataUnavailable);
      return;
    }
    if (loading) return;
    if (importInputRef.current) {
      importInputRef.current.value = "";
      importInputRef.current.click();
    }
  };

  const clearImportFile = () => {
    if (importInputRef.current) {
      importInputRef.current.value = "";
    }
    setSelectedImportFileName("");
    setImportRows([]);
    setImportOpen(false);
    setImportSummary(null);
    setImportStatusFilter("");
    setImportMonthFilter("");
    setImportVehicleFilter("");
    setFuelDetailRowId(null);
    setFuelDetailLogs([]);
    setFuelDetailError(null);
  };

  const openFuelDetails = async (row: VehiclePerformanceImportRow) => {
    if (!row.year || !row.month || !row.fuelMatchMonthStart || !row.fuelMatchMonthEnd) {
      return;
    }

    setFuelDetailRowId(row.id);
    setFuelDetailLogs([]);
    setFuelDetailError(null);
    setFuelDetailLoading(true);

    try {
      const logs = await fetchFuelLogsForExport({
        fromDate: row.fuelMatchMonthStart,
        toDate: row.fuelMatchMonthEnd
      });
      const aliases = knownVehicleRegistrationAliases(row.canonicalVehicleRegistration || row.vehicleRegistration)
        .map((registration) => normalizeComparableText(normalizeVehicleRegistration(registration)));
      const aliasSet = new Set(aliases);
      setFuelDetailLogs(
        logs.filter((log) => aliasSet.has(normalizeComparableText(normalizeVehicleRegistration(log.vehicle_reg))))
      );
    } catch (err) {
      console.error("Vehicle performance fuel details error:", err);
      setFuelDetailError(err instanceof Error ? err.message : "Unable to load fuel details.");
    } finally {
      setFuelDetailLoading(false);
    }
  };

  const closeFuelDetails = () => {
    setFuelDetailRowId(null);
    setFuelDetailLogs([]);
    setFuelDetailError(null);
  };

  const closeCorrectionEditor = () => {
    setCorrectionRowId(null);
    setCorrectionForm(null);
    setCorrectionError(null);
    setCorrectionSaving(false);
  };

  const openCorrectionEditor = (row: VehiclePerformanceImportRow) => {
    setCorrectionRowId(row.id);
    setCorrectionForm({
      grossRevenue: String(Number(row.grossRevenue || 0)),
      salaryCost: String(Number(row.salaryCost || 0)),
      tripIncome: String(Number(row.tripIncome || 0)),
      otherExpenses: String(Number(row.otherExpenses || 0)),
      lpgCost: String(Number(row.lpgCost || 0)),
      reason: row.reason || row.savedReview?.review_note || "Correction reviewed from import preview."
    });
    setCorrectionError(null);
  };

  const recalculateImportRowFromFuelLogs = async (row: VehiclePerformanceImportRow) => {
    if (!row.year || !row.month || !row.canonicalVehicleRegistration) return row;
    const fuelSpendRows = await fetchVehicleMonthlyFuelSpend({ year: row.year, month: row.month });
    const [refreshed] = addAppFuelToImportRows([
      {
        ...row,
        status: "Ready",
        savedReview: null
      }
    ], fuelSpendRows);
    const evaluated = evaluateVehiclePerformanceImportStatus(refreshed);
    return {
      ...refreshed,
      ...evaluated,
      savedReview: null
    };
  };

  const saveReviewDecision = async (
    row: VehiclePerformanceImportRow,
    reviewStatus: "approved" | "correction_required",
    reviewNote: string
  ) => {
    if (!row.year || !row.month || !row.canonicalVehicleRegistration) {
      throw new Error("This row is missing vehicle/month identity for review.");
    }

    const vehicle = vehicleByRegistration.get(
      normalizeComparableText(normalizeVehicleRegistration(row.canonicalVehicleRegistration))
    );
    return saveVehiclePerformanceImportReview({
      vehicle_id: vehicle?.id ?? null,
      canonical_vehicle_registration: row.canonicalVehicleRegistration,
      imported_vehicle_reference: row.vehicleRegistration,
      source_sheet: row.sourceSheet,
      source_row_number: row.sourceRowNumber,
      source_row_key: `${row.sourceSheet}:${row.sourceRowNumber}:${row.year}:${row.month}:${row.canonicalVehicleRegistration}`,
      year: row.year,
      month: row.month,
      review_status: reviewStatus,
      excel_fuel: row.excelFuel,
      app_fuel_at_review: Number(row.appFuel || 0),
      fuel_difference_at_review: row.fuelDifference,
      review_note: reviewNote
    });
  };

  const approveImportException = async (rowId: string) => {
    const row = importRows.find((item) => item.id === rowId);
    if (!row) return;
    const reviewNote = "Discrepancy manually reviewed and approved. Saved record uses App Fuel and app-calculated balance.";
    setError(null);
    let savedReview: VehiclePerformanceImportRow["savedReview"];
    try {
      savedReview = await saveReviewDecision(row, "approved", reviewNote);
    } catch (err) {
      console.error("Vehicle performance approve exception error:", err);
      setError(err instanceof Error ? err.message : "Unable to save import review.");
      return;
    }

    setImportRows((currentRows) =>
      currentRows.map((row) =>
        row.id === rowId && (row.status === "Fuel warning" || row.status === "Needs review" || row.status === "Review required again")
          ? {
              ...row,
              status: "Approved",
              reason: reviewNote,
              savedReview
            }
          : row
      )
    );
    setImportSummary("Review saved. This row is approved for import using App Fuel.");
  };

  const markImportCorrectionRequired = async (rowId: string) => {
    const row = importRows.find((item) => item.id === rowId);
    if (!row) return;
    const reviewNote = "Underlying Fuel Log appears wrong and must be corrected before import.";
    setError(null);
    let savedReview: VehiclePerformanceImportRow["savedReview"];
    try {
      savedReview = await saveReviewDecision(row, "correction_required", reviewNote);
    } catch (err) {
      console.error("Vehicle performance mark correction error:", err);
      setError(err instanceof Error ? err.message : "Unable to save import review.");
      return;
    }

    setImportRows((currentRows) =>
      currentRows.map((row) =>
        row.id === rowId && (row.status === "Fuel warning" || row.status === "Needs review" || row.status === "Approved" || row.status === "Review required again")
          ? {
              ...row,
              status: "Correction required",
              reason: reviewNote,
              savedReview
            }
          : row
      )
    );
    setImportSummary("Review saved. This row is marked for correction and will not import.");
  };

  const recalculateImportRow = async (rowId: string) => {
    const row = importRows.find((item) => item.id === rowId);
    if (!row?.year || !row.month || !row.canonicalVehicleRegistration) return;
    setError(null);
    try {
      const refreshed = await recalculateImportRowFromFuelLogs(row);
      await deleteVehiclePerformanceImportReview({
        year: row.year,
        month: row.month,
        canonical_vehicle_registration: row.canonicalVehicleRegistration
      });
      setImportRows((currentRows) =>
        currentRows.map((item) =>
          item.id === rowId
            ? refreshed
            : item
        )
      );
      setImportSummary(
        refreshed.status === "Ready" || refreshed.status === "Historical fuel difference"
          ? "Correction recalculated and cleared. This row is now acceptable."
          : "Correction recalculated. Review the updated status before importing."
      );
      if (correctionRowId === rowId && refreshed.status !== "Correction required") {
        closeCorrectionEditor();
      }
    } catch (err) {
      console.error("Vehicle performance recalculate review error:", err);
      setError(err instanceof Error ? err.message : "Unable to clear saved review.");
    }
  };

  const saveCorrectionEdits = async (resolveAfterSave = false) => {
    const row = selectedCorrectionRow;
    const values = correctionForm;
    if (!row?.year || !row.month || !row.canonicalVehicleRegistration || !values) return;

    setCorrectionSaving(true);
    setCorrectionError(null);
    setError(null);

    try {
      const existingRecord = findPerformanceRecordForImportRow(row);
      const nextValues = {
        gross_revenue: numericInput(values.grossRevenue),
        salary_cost: numericInput(values.salaryCost),
        trip_income: numericInput(values.tripIncome),
        other_expenses: numericInput(values.otherExpenses),
        lpg_cost: numericInput(values.lpgCost)
      };
      const savedRecord = await saveVehicleMonthlyPerformance({
        id: existingRecord?.id,
        year: row.year,
        month: row.month,
        vehicle_registration: row.canonicalVehicleRegistration,
        ...nextValues,
        notes: [
          existingRecord?.notes ?? "",
          `Import correction reviewed. Reason: ${values.reason.trim() || "No reason provided."}`
        ].filter(Boolean).join("\n")
      });

      await saveVehiclePerformanceCorrectionAudit({
        vehicle_monthly_performance_id: savedRecord.id,
        year: row.year,
        month: row.month,
        vehicle_registration: row.canonicalVehicleRegistration,
        reason: values.reason,
        changes: [
          { field_name: "gross_revenue", old_value: existingRecord ? Number(existingRecord.gross_revenue || 0) : Number(row.grossRevenue || 0), new_value: nextValues.gross_revenue },
          { field_name: "salary_cost", old_value: existingRecord ? Number(existingRecord.salary_cost || 0) : Number(row.salaryCost || 0), new_value: nextValues.salary_cost },
          { field_name: "trip_income", old_value: existingRecord ? Number(existingRecord.trip_income || 0) : Number(row.tripIncome || 0), new_value: nextValues.trip_income },
          { field_name: "other_expenses", old_value: existingRecord ? Number(existingRecord.other_expenses || 0) : Number(row.otherExpenses || 0), new_value: nextValues.other_expenses },
          { field_name: "lpg_cost", old_value: existingRecord ? Number(existingRecord.lpg_cost || 0) : Number(row.lpgCost || 0), new_value: nextValues.lpg_cost }
        ]
      });

      const rowWithEdits = {
        ...row,
        grossRevenue: nextValues.gross_revenue,
        salaryCost: nextValues.salary_cost,
        tripIncome: nextValues.trip_income,
        otherExpenses: nextValues.other_expenses,
        lpgCost: nextValues.lpg_cost,
        existingRecordId: savedRecord.id
      };
      const refreshed = await recalculateImportRowFromFuelLogs(rowWithEdits);
      const resolvedRow: VehiclePerformanceImportRow = {
        ...refreshed,
        status: resolveAfterSave || refreshed.status === "Ready" || refreshed.status === "Historical fuel difference" ? "Resolved" : refreshed.status,
        reason:
          resolveAfterSave || refreshed.status === "Ready" || refreshed.status === "Historical fuel difference"
            ? "Correction saved to the monthly Vehicle Performance record."
            : refreshed.reason,
        savedReview: null,
        existingRecordId: savedRecord.id
      };

      if (resolveAfterSave || refreshed.status === "Ready" || refreshed.status === "Historical fuel difference") {
        await deleteVehiclePerformanceImportReview({
          year: row.year,
          month: row.month,
          canonical_vehicle_registration: row.canonicalVehicleRegistration
        });
      }

      setImportRows((currentRows) => currentRows.map((item) => item.id === row.id ? resolvedRow : item));
      setImportSummary("Correction saved. The monthly Vehicle Performance record and audit history were updated.");
      await load();
      closeCorrectionEditor();
    } catch (err) {
      console.error("Vehicle performance save correction error:", err);
      setCorrectionError(err instanceof Error ? err.message : "Unable to save correction.");
    } finally {
      setCorrectionSaving(false);
    }
  };

  const resolveCorrection = async () => {
    const row = selectedCorrectionRow;
    if (!row?.year || !row.month || !row.canonicalVehicleRegistration) return;
    setCorrectionSaving(true);
    setCorrectionError(null);
    try {
      const refreshed = await recalculateImportRowFromFuelLogs(row);
      if (refreshed.status !== "Ready" && refreshed.status !== "Historical fuel difference") {
        setCorrectionError("This row is still outside the acceptable fuel threshold. Save corrected monthly fields or fix Fuel Logs, then recalculate again.");
        return;
      }
      await deleteVehiclePerformanceImportReview({
        year: row.year,
        month: row.month,
        canonical_vehicle_registration: row.canonicalVehicleRegistration
      });
      setImportRows((currentRows) => currentRows.map((item) => item.id === row.id ? refreshed : item));
      setImportSummary("Correction resolved. This row is now acceptable.");
      closeCorrectionEditor();
    } catch (err) {
      console.error("Vehicle performance resolve correction error:", err);
      setCorrectionError(err instanceof Error ? err.message : "Unable to resolve correction.");
    } finally {
      setCorrectionSaving(false);
    }
  };

  const handleImportFile = async (file: File | null) => {
    if (!file) {
      return;
    }

    setImportSummary(null);
    setError(null);
    setImportRows([]);
    setImportOpen(false);

    if (!importVehicleDataReady) {
      setSelectedImportFileName(file.name);
      setError(labels.vehicleDataUnavailable);
      return;
    }

    const isXlsx =
      file.name.toLowerCase().endsWith(".xlsx") ||
      file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

    if (!isXlsx) {
      setSelectedImportFileName(file.name);
      setError(labels.invalidExcelFile);
      return;
    }

    setSelectedImportFileName(file.name);

    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const worksheets = workbook.SheetNames.map((sheetName) => ({
        sheetName,
        rows: XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, raw: true, defval: "" }) as unknown[][]
      }));
      const existingRecordsForImport = await fetchVehicleMonthlyPerformance({ year });
      const parsedRows = parseVehiclePerformanceWorkbook({
        worksheets,
        vehicles,
        existingRecords: existingRecordsForImport,
        fallbackYear: year
      });
      if (!parsedRows.some((row) => row.status !== "Skipped")) {
        setError(labels.importFailed);
        return;
      }
      const periods = Array.from(
        new Map(
          parsedRows
            .filter((row) => row.year && row.month)
            .map((row) => [`${row.year}-${row.month}`, { year: row.year as number, month: row.month as number }])
        ).values()
      );
      const importedFuelRows = (
        await Promise.all(periods.map((period) => fetchVehicleMonthlyFuelSpend(period)))
      ).flat();
      const reviewYears = Array.from(new Set(periods.map((period) => period.year)));
      const reviews = (
        await Promise.all(reviewYears.map((reviewYear) => fetchVehiclePerformanceImportReviews({ year: reviewYear })))
      ).flat();
      const rowsWithFuel = addAppFuelToImportRows(parsedRows, importedFuelRows);
      setImportRows(applySavedVehiclePerformanceImportReviews(rowsWithFuel, reviews));
      setImportOpen(true);
    } catch (err) {
      console.error("Vehicle performance import parse error:", err);
      setError(err instanceof Error ? err.message : labels.importFailed);
    }
  };

  const refreshImportRowsWithFuelData = async (
    rowsToRefresh: VehiclePerformanceImportRow[],
    finalStatusByRowId: Map<string, VehiclePerformanceImportStatus> = new Map()
  ) => {
    const periods = Array.from(
      new Map(
        rowsToRefresh
          .filter((row) => row.year && row.month)
          .map((row) => [`${row.year}-${row.month}`, { year: row.year as number, month: row.month as number }])
      ).values()
    );
    const refreshedFuelRows = (
      await Promise.all(periods.map((period) => fetchVehicleMonthlyFuelSpend(period)))
    ).flat();

    return rowsToRefresh.map((row) => {
      const statusForRecalculation =
        row.status === "Skipped" || row.status === "Duplicate" || row.status === "Vehicle not matched"
          ? row.status
          : "Ready";
      const [refreshed] = addAppFuelToImportRows([{ ...row, status: statusForRecalculation }], refreshedFuelRows);
      const finalStatus = finalStatusByRowId.get(row.id);
      if (finalStatus === "Imported") {
        return { ...refreshed, status: "Imported" as const, reason: "Imported successfully." };
      }
      if (finalStatus === "Existing") {
        return { ...refreshed, status: "Existing" as const, reason: "Existing Vehicle Performance record updated." };
      }
      return { ...row, ...refreshed, status: row.status, reason: row.reason, savedReview: row.savedReview };
    });
  };

  const importReadyRows = async () => {
    setImporting(true);
    setImportSummary(null);
    setError(null);
    const result = { created: 0, updated: 0, skipped: 0, errors: 0 };
    const finalStatusByRowId = new Map<string, VehiclePerformanceImportStatus>();

    try {
      for (const row of importRows) {
        const canImportReady = row.status === "Ready" || row.status === "Historical fuel difference" || row.status === "Approved";
        const canUpdateDuplicate = row.status === "Duplicate" && importMode === "update" && row.existingRecordId;
        if (!canImportReady && !canUpdateDuplicate) {
          result.skipped += 1;
          continue;
        }

        try {
          await saveVehicleMonthlyPerformance({
            id: canUpdateDuplicate ? row.existingRecordId ?? undefined : undefined,
            year: row.year ?? undefined,
            month: row.month ?? undefined,
            vehicle_registration: row.canonicalVehicleRegistration,
            gross_revenue: row.grossRevenue,
            salary_cost: row.salaryCost,
            trip_income: row.tripIncome,
            other_expenses: row.otherExpenses,
            lpg_cost: row.lpgCost,
            notes:
              row.status === "Approved"
                ? `Import exception manually reviewed and approved. Excel Fuel reference: ${formatBaht(Number(row.excelFuel || 0))}. App Fuel used: ${formatBaht(Number(row.appFuel || 0))}. Difference: ${formatBaht(Number(row.fuelDifference || 0))}.`
                : undefined
          });
          if (canUpdateDuplicate) {
            result.updated += 1;
            finalStatusByRowId.set(row.id, "Existing");
          } else {
            result.created += 1;
            finalStatusByRowId.set(row.id, "Imported");
          }
        } catch (err) {
          console.error("Vehicle performance import row error:", err, row);
          result.errors += 1;
        }
      }

      setImportSummary(
        labels.importResult
          .replace("{created}", String(result.created))
          .replace("{updated}", String(result.updated))
          .replace("{skipped}", String(result.skipped))
          .replace("{errors}", String(result.errors))
      );
      setImportRows(await refreshImportRowsWithFuelData(importRows, finalStatusByRowId));
      await load();
    } finally {
      setImporting(false);
    }
  };

  const toggleVehicleSort = (key: VehicleSortKey) => {
    setVehicleSort((current) => ({
      key,
      direction: current.key === key && current.direction === "desc" ? "asc" : "desc"
    }));
  };


  const buildVehiclePerformancePdfData = (): VehiclePerformancePdfData => {
    const generatedAt = new Intl.DateTimeFormat(language === "th" ? "th-TH" : "en-GB", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Asia/Bangkok"
    }).format(new Date());
    const currency = (value: number) => formatBaht(value);
    const percent = (value: number | null) => formatPercent(value, language);
    const statusText = (row: VehiclePerformanceRow) => performanceStatusLabel(row.status, labels);
    const statusTone = (status: VehiclePerformanceRow["status"]): VehiclePerformancePdfTone =>
      status === "strong" ? "success" : status === "stable" ? "info" : status === "monitor" ? "warning" : "danger";
    const monthStatusLabel = (status: VehiclePerformanceMonthlyPerformanceRow["status"]) =>
      status === "complete" ? "Complete" : status === "partial" ? "Partial" : "Missing";
    const monthName = (monthNumber: number) => monthLabel(monthNumber);
    const strongestRevenueMonth = managementInsights.highestRevenueMonth;
    const highestBalanceMonth = managementInsights.highestBalanceMonth;
    const highestFuelPercentMonth = managementInsights.highestFuelPercentMonth;
    const executiveSummary = managementSnapshotInsights.filter((line) => !line.includes("Load Vehicle Performance data"));
    if (previousMonthComparison) {
      executiveSummary.push(
        `Latest revenue movement was ${formatSignedPercent(previousMonthComparison.revenueChange, language)} from ${monthName(previousMonthComparison.previous.month)} to ${monthName(previousMonthComparison.current.month)}.`
      );
      executiveSummary.push(
        `Latest fuel ratio movement was ${formatSignedPointChange(
          previousMonthComparison.current.fuelPercent == null || previousMonthComparison.previous.fuelPercent == null
            ? null
            : previousMonthComparison.current.fuelPercent - previousMonthComparison.previous.fuelPercent,
          language
        )}; margin movement was ${formatSignedPointChange(previousMonthComparison.marginPointChange, language)}.`
      );
    }
    if (!executiveSummary.length) {
      executiveSummary.push("No Vehicle Performance data is available for the selected filters.");
    }

    const topBalanceRows = [...rows]
      .sort((left, right) => right.recordedBalance - left.recordedBalance)
      .slice(0, 5);
    const reviewRows = [...attentionRows, ...monitorRows].map((row) => ({
      tone: statusTone(row.status),
      values: [
        row.vehicleRegistration,
        currency(row.grossRevenue),
        percent(row.fuelPercent),
        currency(row.recordedBalance),
        percent(row.marginPercent),
        statusText(row),
        performanceStatusReason(row, language)
      ]
    }));

    return {
      coverageSummary: `${monthCoverageCounts.complete} complete / ${monthCoverageCounts.partial} partial / ${dataQuality.missingMonths.length} missing months`,
      dataQuality: [
        `Eligible vehicles: ${dataQuality.representedVehicles}`,
        `Included vehicles: ${rows.length}`,
        `Excluded vehicles: ${vehicleCoverageDetails.withoutPerformance.length}${vehicleCoverageDetails.withoutPerformance.length ? ` (${vehicleCoverageDetails.withoutPerformance.map((vehicle) => `${vehicle.registration}: ${vehicle.reasons.join(", ")}`).join("; ")})` : ""}`,
        `Complete months: ${dataQuality.completeMonths}`,
        `Partial months: ${dataQuality.partialMonths}`,
        `Missing vehicle-month records: ${dataQuality.missingVehicleMonthRecords}`,
        `Missing months: ${dataQuality.missingMonths.join(", ") || "None"}`,
        `Unresolved import exceptions: ${dataQuality.unresolvedImportExceptions}`,
        `Negative balances: ${dataQuality.negativeBalances}`
      ],
      disclaimer:
        "Recorded Balance represents revenue remaining after the direct costs recorded in the Fuel Bank system. It should not automatically be treated as final accounting profit because other company overheads may not be included.",
      executiveSummary,
      fleetHealth: [
        { count: performanceStatusCounts.strong, label: "Strong", value: String(performanceStatusCounts.strong), tone: "success" },
        { count: performanceStatusCounts.stable, label: "Stable", value: String(performanceStatusCounts.stable), tone: "info" },
        { count: performanceStatusCounts.monitor, label: "Monitor", value: String(performanceStatusCounts.monitor), tone: "warning" },
        { count: performanceStatusCounts.attention, label: "Attention", value: String(performanceStatusCounts.attention), tone: "danger" }
      ],
      generatedAt,
      highlights: [
        { label: "Highest revenue vehicle", value: managementInsights.highestRevenueVehicle?.vehicleRegistration ?? "-", detail: managementInsights.highestRevenueVehicle ? currency(managementInsights.highestRevenueVehicle.grossRevenue) : "-" },
        { label: "Highest recorded balance vehicle", value: managementInsights.highestBalanceVehicle?.vehicleRegistration ?? "-", detail: managementInsights.highestBalanceVehicle ? currency(managementInsights.highestBalanceVehicle.recordedBalance) : "-" },
        { label: "Best margin vehicle", value: managementInsights.bestMarginVehicle?.vehicleRegistration ?? "-", detail: managementInsights.bestMarginVehicle ? percent(managementInsights.bestMarginVehicle.marginPercent) : "-" },
        { label: "Highest fuel % vehicle", value: managementInsights.highestFuelPercentVehicle?.vehicleRegistration ?? "-", detail: managementInsights.highestFuelPercentVehicle ? percent(managementInsights.highestFuelPercentVehicle.fuelPercent) : "-", tone: "warning" },
        { label: "Lowest margin vehicle", value: managementInsights.lowestMarginVehicle?.vehicleRegistration ?? "-", detail: managementInsights.lowestMarginVehicle ? percent(managementInsights.lowestMarginVehicle.marginPercent) : "-", tone: "danger" },
        { label: "Month with highest revenue", value: strongestRevenueMonth ? monthName(strongestRevenueMonth.month) : "-", detail: strongestRevenueMonth ? currency(strongestRevenueMonth.grossRevenue) : "-" },
        { label: "Month with highest recorded balance", value: highestBalanceMonth ? monthName(highestBalanceMonth.month) : "-", detail: highestBalanceMonth ? currency(highestBalanceMonth.recordedBalance) : "-" },
        { label: "Month with highest fuel %", value: highestFuelPercentMonth ? monthName(highestFuelPercentMonth.month) : "-", detail: highestFuelPercentMonth ? percent(highestFuelPercentMonth.fuelPercent) : "-", tone: "warning" }
      ],
      kpis: [
        { label: labels.revenue, value: currency(summary.grossRevenue) },
        { label: "Recorded Balance after recorded direct costs", value: currency(summary.recordedBalance), tone: summary.recordedBalance < 0 ? "danger" : "success" },
        { label: "Margin %", value: percent(summary.marginPercent), tone: summary.recordedBalance < 0 ? "danger" : "success" },
        { label: labels.fuelSpend, value: currency(summary.fuelSpend) },
        { label: labels.fuelPercentOfRevenue, value: percent(summary.fuelPercent) },
        { label: labels.salary, value: currency(summary.salaryCost) },
        { label: labels.tripPayments, value: currency(summary.tripIncome) },
        { label: "Other Costs", value: currency(summary.otherExpenses) }
      ],
      monthlyTable: {
        columns: [
          { label: "Month", width: 44 },
          { label: "Revenue", width: 58, align: "right" },
          { label: "Fuel", width: 50, align: "right" },
          { label: "Fuel %", width: 38, align: "right" },
          { label: "Salary", width: 48, align: "right" },
          { label: "Trip Payments", width: 54, align: "right" },
          { label: "Other Costs", width: 50, align: "right" },
          { label: "Recorded Balance", width: 62, align: "right" },
          { label: "Margin %", width: 42, align: "right" },
          { label: "Vehicles", width: 36, align: "center" },
          { label: "Data Status", width: 45 }
        ],
        rows: monthlyPerformanceRows.map((row) => [
          monthName(row.month),
          row.status === "missing" ? "-" : currency(row.grossRevenue),
          row.status === "missing" ? "-" : currency(row.fuelSpend),
          row.status === "missing" ? "-" : percent(row.fuelPercent),
          row.status === "missing" ? "-" : currency(row.salaryCost),
          row.status === "missing" ? "-" : currency(row.tripIncome),
          row.status === "missing" ? "-" : currency(row.otherExpenses),
          row.status === "missing" ? "-" : currency(row.recordedBalance),
          row.status === "missing" ? "-" : percent(row.marginPercent),
          row.status === "missing" ? "-" : `${row.vehicleCount}`,
          monthStatusLabel(row.status)
        ])
      },
      periodLabel,
      reconciliationStatus: totalsReconcile ? "Passed" : "Needs review",
      reviewRows,
      searchQuery: searchQuery.trim(),
      title: "Vehicle Performance Management Report",
      topVehicles: {
        columns: [
          { label: "Rank", width: 34, align: "center" },
          { label: "Registration", width: 72 },
          { label: "Revenue", width: 75, align: "right" },
          { label: "Recorded Balance", width: 92, align: "right" },
          { label: "Margin %", width: 55, align: "right" },
          { label: "Fuel %", width: 49, align: "right" },
          { label: "Performance Status", width: 150 }
        ],
        rows: topBalanceRows.map((row, index) => [
          String(index + 1),
          row.vehicleRegistration,
          currency(row.grossRevenue),
          currency(row.recordedBalance),
          percent(row.marginPercent),
          percent(row.fuelPercent),
          statusText(row)
        ])
      },
      trendRows: monthlyPerformanceRows,
      vehicleCount: rows.length,
      vehicleTable: {
        columns: [
          { label: "Vehicle", width: 50 },
          { label: "Months", width: 32, align: "center" },
          { label: "Revenue", width: 52, align: "right" },
          { label: "Fuel", width: 48, align: "right" },
          { label: "Fuel %", width: 36, align: "right" },
          { label: "LPG", width: 38, align: "right" },
          { label: "Salary", width: 44, align: "right" },
          { label: "Trip Payments", width: 50, align: "right" },
          { label: "Other Costs", width: 44, align: "right" },
          { label: "Recorded Balance", width: 58, align: "right" },
          { label: "Margin %", width: 36, align: "right" },
          { label: "Performance", width: 39 }
        ],
        rows: sortedRows.map((row) => [
          row.vehicleRegistration,
          `${vehicleMonthCounts.get(vehicleKey(row.vehicleRegistration)) ?? 0}/${selectedMonths.length}`,
          currency(row.grossRevenue),
          currency(row.fuelSpend),
          percent(row.fuelPercent),
          currency(row.lpgCost),
          currency(row.salaryCost),
          currency(row.tripIncome),
          currency(row.otherExpenses),
          currency(row.recordedBalance),
          percent(row.marginPercent),
          statusText(row)
        ])
      }
    };
  };

  const downloadVehiclePerformancePdf = async () => {
    if (generatingPdf) return;
    setGeneratingPdf(true);
    setError(null);
    setSuccessMessage(null);

    try {
      if (!rows.length) {
        throw new Error("No Vehicle Performance data is available for the selected filters.");
      }
      const logo = await loadVehiclePerformancePdfLogo();
      const pdf = await buildVehiclePerformancePdf(buildVehiclePerformancePdfData(), logo, language);
      const datePart = new Date().toISOString().slice(0, 10);
      const searchPart = searchQuery.trim() ? `-${normalizeVehicleRegistration(searchQuery).replace(/[^A-Z0-9ก-๙-]/gi, "")}` : "";
      downloadBlob(pdf, `Expert-Express-Vehicle-Performance-${year}-${month || "all-loaded-months"}${searchPart}-${datePart}.pdf`);
      setSuccessMessage("Vehicle Performance PDF report downloaded.");
    } catch (err) {
      console.error("Vehicle Performance PDF generation failed:", err);
      setError(err instanceof Error && err.message ? err.message : "Unable to generate Vehicle Performance PDF report.");
    } finally {
      setGeneratingPdf(false);
    }
  };

  return (
    <>
      <div className="mb-6 hidden md:block">
        <Header title={labels.title} description={labels.description} />
      </div>

      <section className="surface-card p-4 sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-brand-100 bg-brand-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-brand-700">
              <TrendingUp className="h-3.5 w-3.5" />
              {labels.title}
            </div>
            <h2 className="mt-3 text-xl font-semibold text-slate-950">{labels.title}</h2>
            <p className="mt-1 max-w-3xl text-sm text-slate-500">Revenue, recorded direct costs and vehicle performance</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Link className="btn-secondary" href="/maintenance/analytics">{t.maintenance.analytics}</Link>
            <span className="badge-muted self-start sm:self-auto">Period: {periodLabel}</span>
            <button
              type="button"
              onClick={() => void downloadVehiclePerformancePdf()}
              disabled={generatingPdf || loading || !!loadError || !rows.length}
              className="btn-primary w-full gap-2 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
            >
              <Download className="h-4 w-4" />
              {generatingPdf ? "Generating PDF..." : "Download PDF Report"}
            </button>
          </div>
        </div>

        <div className="mt-5 rounded-[0.85rem] border border-slate-200/80 bg-white/95 p-3 shadow-[0_10px_30px_rgba(15,23,42,0.04)]">
          <div className="grid gap-3 md:grid-cols-[120px_170px_minmax(220px,1fr)] md:items-end">
            <div>
              <label className="form-label">{labels.year}</label>
              <input className="form-input w-full bg-white" type="number" min="2000" max="2100" value={year} onChange={(event) => setYear(Number(event.target.value) || 2026)} />
            </div>
            <div>
              <label className="form-label">{labels.month}</label>
              <select className="form-input w-full bg-white" value={month} onChange={(event) => setMonth(event.target.value ? Number(event.target.value) : "")}>
                <option value="">All loaded months</option>
                {MONTH_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{labels.months[option.labelKey]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="form-label">{labels.searchVehicle}</label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input className="form-input w-full bg-white pl-9" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder={labels.searchPlaceholder} />
              </div>
            </div>
          </div>
          {!loading && !loadError && selectedRecords.length > 0 && <>
          <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_180px_180px] lg:items-center">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">Months loaded</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {coverageRows.map((item) => (
                  <button
                    key={item.month}
                    type="button"
                    onClick={() => item.status === "partial" ? setPartialMonthDetail(item.month) : undefined}
                    className={`rounded-md border px-2 py-1 text-xs font-semibold ${
                      item.status === "missing"
                        ? "border-slate-200 bg-slate-50 text-slate-400"
                        : item.status === "partial"
                          ? "border-amber-200 bg-amber-50 text-amber-800"
                          : "border-emerald-200 bg-emerald-50 text-emerald-700"
                    }`}
                    title={`${monthLabel(item.month)} - ${item.status === "complete" ? "Complete" : item.status === "partial" ? `Partial: ${(missingVehiclesByMonth.get(item.month) ?? []).join(", ") || "missing vehicle data"}` : "Missing"}`}
                  >
                    {item.label} {item.status === "complete" ? "Complete" : item.status === "partial" ? "Partial" : "Missing"}
                  </button>
                ))}
              </div>
            </div>
            <KpiCard label="Months With Data" value={`${loadedMonthCount} / ${selectedMonths.length}`} detail={`${monthCoverageCounts.complete} complete - ${monthCoverageCounts.partial} partial`} />
            <KpiCard
              label="Performance Vehicles"
              value={`${dataQuality.representedVehicles} analysed`}
              detail={`${dataQuality.representedVehicles} eligible; ${vehicleCoverageDetails.withoutPerformance.length} excluded`}
              helper={`${dataQuality.representedVehicles} vehicles have eligible performance records. Vehicles with performance data are counted as analysed; ${vehicleCoverageDetails.withoutPerformance.length} fleet ${vehicleCoverageDetails.withoutPerformance.length === 1 ? "vehicle has" : "vehicles have"} no eligible financial performance data for this period.`}
              tooltip={vehicleCoverageDetails.withoutPerformance.length ? `Excluded: ${vehicleCoverageDetails.withoutPerformance.map((vehicle) => `${vehicle.registration} (${vehicle.reasons.join(", ")})`).join("; ")}` : "All fleet vehicles have eligible performance data for this period."}
              onClick={() => setVehicleCoverageOpen(true)}
            />
          </div>
          {incompletePeriodMessage ? (
            <p className="mt-4 rounded-[0.85rem] border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">
              {incompletePeriodMessage}
            </p>
          ) : null}
          </>}
        </div>
      </section>

      {loading ? <p role="status" className="surface-card p-5">Loading vehicle performance records…</p> : loadError ? (
        <div role="alert" className="surface-card p-5">
          <p className="form-error">Unable to load vehicle performance: {loadError}</p>
          <button type="button" className="btn-secondary mt-3" onClick={() => void load()}>Retry</button>
        </div>
      ) : !selectedRecords.length ? <p role="status" className="surface-card p-5">No performance records found</p> : <>
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label={labels.revenue} value={formatCompactBaht(summary.grossRevenue)} detail={`${formatBaht(summary.grossRevenue)} - Across ${loadedMonthCount} loaded ${loadedMonthCount === 1 ? "month" : "months"}`} tooltip="Total revenue allocated to the selected vehicles and months." />
        <KpiCard label={labels.recordedBalance} value={formatCompactBaht(summary.recordedBalance)} detail={`${formatBaht(summary.recordedBalance)} - Across ${loadedMonthCount} loaded ${loadedMonthCount === 1 ? "month" : "months"}`} tone={summary.recordedBalance < 0 ? "danger" : "success"} tooltip="Revenue remaining after fuel, salary, trip payments and other recorded direct costs. This is not full accounting profit." />
        <KpiCard label="Margin" value={formatPercent(summary.marginPercent, language)} detail={`${labels.recordedBalance} / ${labels.revenue}`} helper={summary.marginPercent == null ? undefined : `${formatBaht(summary.marginPercent)} of every ฿100 revenue remained after recorded direct costs.`} tone={summary.recordedBalance < 0 ? "danger" : "success"} tooltip="Recorded Balance divided by Revenue." />
        <KpiCard label={labels.fuelSpend} value={formatCompactBaht(summary.fuelSpend)} detail={`${formatBaht(summary.fuelSpend)} - Across ${loadedMonthCount} loaded ${loadedMonthCount === 1 ? "month" : "months"}`} tooltip="Total recorded fuel cost." />
        <KpiCard label={labels.fuelPercentOfRevenue} value={formatPercent(summary.fuelPercent, language)} detail={`${labels.fuelSpend} / ${labels.revenue}`} helper={summary.fuelPercent == null ? undefined : `${formatBaht(summary.fuelPercent)} of every ฿100 revenue was spent on fuel.`} tooltip="How much fuel costs for every ฿100 of revenue." />
        <KpiCard label={labels.salary} value={formatCompactBaht(summary.salaryCost)} detail={`${formatBaht(summary.salaryCost)} - Across ${loadedMonthCount} loaded ${loadedMonthCount === 1 ? "month" : "months"}`} tooltip="Recorded driver salary allocated to these vehicles." />
        <KpiCard label={labels.tripPayments} value={formatCompactBaht(summary.tripIncome)} detail={`${formatBaht(summary.tripIncome)} - Across ${loadedMonthCount} loaded ${loadedMonthCount === 1 ? "month" : "months"}`} tooltip="Recorded trip-related driver payments." />
        <KpiCard label={labels.otherExpenses} value={formatCompactBaht(summary.otherExpenses)} detail={`${formatBaht(summary.otherExpenses)} - Across ${loadedMonthCount} loaded ${loadedMonthCount === 1 ? "month" : "months"}`} tooltip="Other direct costs recorded against these vehicles." />
      </section>

      <section className="surface-card p-4 sm:p-5">
        <div className="mb-4">
          <h3 className="section-title">{language === "th" ? "ประสิทธิภาพทริป: ปฏิบัติงานและการเงิน" : "Trip Performance: Operational vs Financial"}</h3>
          <p className="section-subtitle">{language === "th" ? "ระยะทางปฏิบัติงานนับทุกทริป ส่วนรายได้และระยะทางรายได้นับเฉพาะทริปที่รวมในการเงิน" : "Operational distance counts every trip; revenue and revenue distance count financially included trips only."}</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <KpiCard label={language === "th" ? "ระยะทางรวม" : "Total Distance"} value={`${formatNumber(selectedTripFinancials.operationalDistanceKm, language, 1)} km`} detail={`${selectedTripFinancials.operationalTrips} ${language === "th" ? "ทริปปฏิบัติงาน" : "operational trips"}`} />
          <KpiCard label={language === "th" ? "ระยะทางรายได้" : "Revenue Distance"} value={`${formatNumber(selectedTripFinancials.revenueDistanceKm, language, 1)} km`} detail={`${selectedTripFinancials.revenueGeneratingTrips} ${language === "th" ? "ทริปสร้างรายได้" : "revenue-generating trips"}`} />
          <KpiCard label={language === "th" ? "ระยะทางไม่คิดค่าบริการ" : "Non-chargeable Distance"} value={`${formatNumber(selectedTripFinancials.nonChargeableDistanceKm, language, 1)} km`} detail={`${selectedTripFinancials.excludedTrips} ${language === "th" ? "ทริปไม่รวมการเงิน" : "financially excluded trips"}`} />
          <KpiCard label={language === "th" ? "รายได้จากทริป" : "Trip Revenue"} value={formatBaht(selectedTripFinancials.includedRevenue)} detail={language === "th" ? "ไม่รวมราคาทริปที่ถูกยกเว้น" : "Excluded trip prices are not counted"} />
          <KpiCard label={language === "th" ? "รายได้ / กม." : "Revenue / KM"} value={selectedTripFinancials.revenuePerKm == null ? "-" : formatBaht(selectedTripFinancials.revenuePerKm)} detail={language === "th" ? "รายได้ / ระยะทางรายได้" : "Included revenue / revenue distance"} />
        </div>
      </section>

      <BusinessImpact model={management} actual={summary} onMovement={(direction) => { setMovementFilter(direction); requestAnimationFrame(() => document.getElementById("vehicle-performance-table")?.scrollIntoView({ behavior: "smooth" })); }} />

      <section className="surface-card p-4 sm:p-5">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h3 className="section-title">Monthly Performance</h3>
            <p className="section-subtitle">Missing months are shown separately from months with recorded zero values.</p>
          </div>
          <span className="badge-muted">{periodLabel}</span>
        </div>

        <MonthlyPerformanceTable
          rows={monthlyPerformanceRows}
          labels={labels}
          language={language}
          monthLabel={monthLabel}
          expectedVehicleCount={expectedVehicleRegistrations.length}
          missingVehiclesByMonth={missingVehiclesByMonth}
          onPartialClick={setPartialMonthDetail}
        />
      </section>

      <section className="surface-card p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h3 className="section-title">{labels.monthlyTrend}</h3>
            <p className="section-subtitle">Uses the same canonical monthly dataset as the table above.</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <span className={`badge-muted ${totalsReconcile ? "" : "border-rose-200 bg-rose-50 text-rose-700"}`}>
              {totalsReconcile ? "Totals reconciled" : "Totals need review"}
            </span>
            <select value={trendMetric} onChange={(event) => setTrendMetric(event.target.value as TrendMetric)} className="form-input bg-white">
              <option value="grossRevenue">{labels.revenue}</option>
              <option value="recordedBalance">{labels.recordedBalance}</option>
              <option value="fuelSpend">{labels.fuelSpend}</option>
              <option value="marginPercent">{labels.marginPercent}</option>
            </select>
          </div>
        </div>
        <MonthlyTrend rows={monthlyPerformanceRows} labels={labels} language={language} metric={trendMetric} monthLabel={shortMonthLabel} />
      </section>

      <ActionQueue model={queueManagement} onVehicle={openVehicle} />
      {detailVehicle && <div id="vehicle-detail" className="scroll-mt-6"><VehicleDrillDown registration={detailVehicle} history={vehicleHistory} onClose={() => setDetailVehicle(null)} /></div>}

      <section className="surface-card p-4 sm:p-5">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h3 id="vehicle-performance-table" className="section-title scroll-mt-6">{labels.tableTitle}</h3>
            {movementFilter && <button type="button" onClick={() => setMovementFilter(null)} className="mt-2 text-sm text-brand-700">Movement filter: {movementFilter} · {visibleTableRows.length} vehicles · Clear</button>}
            <p className="section-subtitle">
              {formatNumber(rows.length, language)} vehicles - {periodLabel} - {formatNumber(loadedMonthCount, language)} loaded {loadedMonthCount === 1 ? "month" : "months"}.
              {month === "" ? " Select a specific month to edit monthly records." : ""}
            </p>
          </div>
        </div>
        <div className="mb-4 grid gap-2 rounded-[0.85rem] border border-slate-200 bg-slate-50 p-3 text-sm lg:grid-cols-[minmax(180px,1fr)_repeat(4,minmax(90px,0.6fr))_repeat(2,minmax(120px,0.8fr))]">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">Fleet performance</p>
            <p className="mt-1 font-bold text-slate-950">{formatNumber(rows.length, language)} vehicles analysed</p>
          </div>
          <PreviewMetric label="Strong" value={String(performanceStatusCounts.strong)} tone="success" />
          <PreviewMetric label="Stable" value={String(performanceStatusCounts.stable)} tone="info" />
          <PreviewMetric label="Monitor" value={String(performanceStatusCounts.monitor)} tone="warning" />
          <PreviewMetric label="Attention" value={String(performanceStatusCounts.attention)} tone="danger" />
          <PreviewMetric label="Fleet margin" value={formatPercent(summary.marginPercent, language)} tone="default" />
          <PreviewMetric label="Fleet fuel %" value={formatPercent(summary.fuelPercent, language)} tone="default" />
        </div>
        {movementFilter && !visibleTableRows.length && <p role="status" className="mb-3 text-sm text-slate-600">No vehicles match this movement filter and registration search.</p>}
        {loading ? (
          <p className="text-sm text-slate-500">{t.common.loading}</p>
        ) : rows.length === 0 ? (
          <EmptyState title={labels.noDataTitle} description={labels.noDataDescription} />
        ) : (
          <>
            <div className="space-y-3 md:hidden">
              {visibleTableRows.map((row) => {
                const matchingRecords = records.filter(
                  (record) =>
                    (month === "" || record.month === month) &&
                    normalizeComparableText(record.vehicle_registration) ===
                      normalizeComparableText(row.vehicleRegistration)
                );
                const sourceRecord = matchingRecords.length === 1 && month !== "" ? matchingRecords[0] : null;
                return (
                  <MobilePerformanceCard
                    key={row.vehicleRegistration}
                    row={row}
                    labels={labels}
                    language={language}
                    sourceRecord={sourceRecord}
                    canWrite={canWrite}
                    canDelete={canDelete}
                    deletingId={deletingId}
                    onEdit={editRecord}
                    onDelete={handleDelete}
                    onView={openVehicle}
                    showActions={month !== ""}
                  />
                );
              })}
            </div>
            <div className="hidden md:block">
              <div className="table-shell rounded-[0.85rem]">
                <div className="table-scroll overflow-x-auto">
                  <table className="w-full min-w-[1260px] text-sm">
                    <thead className="bg-slate-50/95 text-slate-600">
                      <tr>
                        <SortHead label={labels.vehicle} sortKey="vehicleRegistration" active={vehicleSort} onSort={toggleVehicleSort} className="sticky left-0 z-20 bg-slate-50 text-left" />
                        <th className="table-head-cell text-right">Months</th>
                        <SortHead label={labels.revenue} sortKey="grossRevenue" active={vehicleSort} onSort={toggleVehicleSort} />
                        <SortHead label={labels.fuel} sortKey="fuelSpend" active={vehicleSort} onSort={toggleVehicleSort} />
                        <SortHead label={labels.fuelPercent} sortKey="fuelPercent" active={vehicleSort} onSort={toggleVehicleSort} />
                        <SortHead label={labels.lpg} sortKey="lpgCost" active={vehicleSort} onSort={toggleVehicleSort} />
                        <SortHead label={labels.salary} sortKey="salaryCost" active={vehicleSort} onSort={toggleVehicleSort} />
                        <SortHead label={labels.tripPayments} sortKey="tripIncome" active={vehicleSort} onSort={toggleVehicleSort} />
                        <SortHead label={labels.otherCosts} sortKey="otherExpenses" active={vehicleSort} onSort={toggleVehicleSort} />
                        <SortHead label={labels.recordedBalance} sortKey="recordedBalance" active={vehicleSort} onSort={toggleVehicleSort} />
                        <SortHead label={labels.marginPercent} sortKey="marginPercent" active={vehicleSort} onSort={toggleVehicleSort} />
                        <SortHead label="Performance" sortKey="status" active={vehicleSort} onSort={toggleVehicleSort} className="text-left" />
                        {month !== "" ? <th className="table-head-cell sticky right-0 z-10 min-w-[180px] bg-slate-50 text-left shadow-[-10px_0_18px_rgba(15,23,42,0.06)]">{labels.actions}</th> : null}
                      </tr>
                    </thead>
                    <tbody>
                      {visibleTableRows.map((row) => {
                        const matchingRecords = records.filter(
                          (record) =>
                            (month === "" || record.month === month) &&
                            normalizeComparableText(record.vehicle_registration) ===
                              normalizeComparableText(row.vehicleRegistration)
                        );
                        const sourceRecord = matchingRecords.length === 1 && month !== "" ? matchingRecords[0] : null;
                        const rowVehicleKey = vehicleKey(row.vehicleRegistration);
                        const presentMonths = selectedMonths.filter((monthNumber) =>
                          selectedRecords.some((record) => record.month === monthNumber && vehicleKey(record.vehicle_registration) === rowVehicleKey)
                        );
                        const missingMonths = missingMonthsByVehicle.get(rowVehicleKey) ?? [];
                        return (
                          <tr key={row.vehicleRegistration} className="enterprise-table-row">
                            <td className="table-body-cell table-driver-name sticky left-0 z-10 bg-white font-bold"><button type="button" onClick={() => openVehicle(row.vehicleRegistration)} className="text-brand-700 underline underline-offset-4">{row.vehicleRegistration}</button></td>
                            <td className="table-body-cell text-right">
                              {missingMonths.length ? (
                                <button
                                  type="button"
                                  onClick={() => setCoverageVehicleDetail({ registration: row.vehicleRegistration, presentMonths, missingMonths })}
                                  title={`Missing: ${missingMonths.map(monthLabel).join(", ")}`}
                                  className="inline-flex rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800 hover:border-amber-300 hover:bg-amber-100"
                                >
                                  {vehicleMonthCounts.get(rowVehicleKey) ?? 0} / {selectedMonths.length}
                                </button>
                              ) : (
                                <span
                                  title="Complete coverage"
                                  className="inline-flex rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-700"
                                >
                                  {vehicleMonthCounts.get(rowVehicleKey) ?? 0} / {selectedMonths.length}
                                </span>
                              )}
                            </td>
                            <td className="table-body-cell text-right font-semibold">{formatBaht(row.grossRevenue)}</td>
                            <td className="table-body-cell text-right">{formatBaht(row.fuelSpend)}</td>
                            <td className="table-body-cell text-right">{formatPercent(row.fuelPercent, language)}</td>
                            <td className="table-body-cell text-right">{formatBaht(row.lpgCost)}</td>
                            <td className="table-body-cell text-right">{formatBaht(row.salaryCost)}</td>
                            <td className="table-body-cell text-right">{formatBaht(row.tripIncome)}</td>
                            <td className="table-body-cell text-right">{formatBaht(row.otherExpenses)}</td>
                            <td className={`table-body-cell text-right font-bold ${row.recordedBalance < 0 ? "text-rose-700" : "text-emerald-700"}`}>{formatBaht(row.recordedBalance)}</td>
                            <td className="table-body-cell text-right">{formatPercent(row.marginPercent, language)}</td>
                            <td className="table-body-cell"><StatusBadge row={row} labels={labels} language={language} /></td>
                            {month !== "" ? (
                              <td className="table-body-cell sticky right-0 bg-white shadow-[-10px_0_18px_rgba(15,23,42,0.05)]">
                                {sourceRecord ? (
                                  <div className="flex items-center gap-1.5">
                                    <button type="button" onClick={() => editRecord(sourceRecord)} className="table-action-secondary gap-1.5" disabled={!canWrite}><Pencil className="h-3.5 w-3.5" />{t.common.edit}</button>
                                    <button type="button" onClick={() => void handleDelete(sourceRecord.id)} className="table-action-danger gap-1.5" disabled={!canDelete || deletingId === sourceRecord.id}><Trash2 className="h-3.5 w-3.5" />{deletingId === sourceRecord.id ? t.common.deleting : t.common.delete}</button>
                                  </div>
                                ) : "-"}
                              </td>
                            ) : null}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </>
        )}
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="surface-card p-4 sm:p-5">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h3 className="section-title">{labels.rankingsTitle}</h3>
            <select value={rankingKey} onChange={(event) => setRankingKey(event.target.value as RankingKey)} className="form-input bg-white">
              <option value="recordedBalance">{labels.highestRecordedBalance}</option>
              <option value="grossRevenue">{labels.highestRevenue}</option>
              <option value="marginPercent">{labels.bestMargin}</option>
              <option value="fuelPercent">{labels.lowestFuelPercent}</option>
              <option value="fuelSpend">{labels.highestFuelSpend}</option>
              <option value="lowestRecordedBalance">Lowest Recorded Balance</option>
            </select>
          </div>
          <RankedList rows={rankedRows} labels={labels} language={language} rankingKey={rankingKey} onView={openVehicle} />
        </div>

        <details open={dataQualityOpen} onToggle={(event) => setDataQualityOpen(event.currentTarget.open)} className="surface-card p-4 sm:p-5">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
            <div>
              <h3 className="section-title">Data Quality</h3>
              <p className={`section-subtitle font-semibold ${totalsReconcile ? "text-emerald-700" : "text-rose-700"}`}>
                {totalsReconcile ? "Data reconciled - totals reconciled" : "Data reconciliation issue"}
                <span className="mt-2 block text-xs font-normal text-slate-600">{management.benchmark.eligibleCount} benchmark-eligible · {monthCoverageCounts.complete} complete months · {monthCoverageCounts.partial} partial months · {Array.from(missingVehiclesByMonth.values()).reduce((sum, missing) => sum + missing.length, 0)} missing vehicle-month records · {management.benchmark.excludedCount} excluded from estimates · {vehicleCoverageDetails.withoutPerformance.length} fleet vehicles without performance records</span>
              </p>
            </div>
            <ChevronDown className={`h-4 w-4 text-slate-500 transition ${dataQualityOpen ? "rotate-180" : ""}`} />
          </summary>
          <div className="mt-4 space-y-4 text-sm">
            <div className={`rounded-[0.85rem] border px-3 py-2 font-semibold ${totalsReconcile ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-rose-200 bg-rose-50 text-rose-700"}`}>
              {totalsReconcile ? "OK Totals reconciled" : "! Totals do not reconcile"}
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">Data Coverage</p>
              <div className="mt-2 grid gap-2">
                <QualityLine good label={`Eligible performance vehicles: ${formatNumber(dataQuality.representedVehicles, language)}`} />
                <QualityLine good label={`Vehicles included: ${formatNumber(rows.length, language)}`} />
                <QualityLine good={vehicleCoverageDetails.withoutPerformance.length === 0} label={`Vehicles excluded: ${formatNumber(vehicleCoverageDetails.withoutPerformance.length, language)}`} detail={vehicleCoverageDetails.withoutPerformance.length ? vehicleCoverageDetails.withoutPerformance.map((vehicle) => vehicle.registration).join(", ") : "None"} />
                <QualityLine good label={`Complete months: ${formatNumber(dataQuality.completeMonths, language)}`} />
                <QualityLine good={dataQuality.partialMonths === 0} label={`Partial months: ${formatNumber(dataQuality.partialMonths, language)}`} />
                <QualityLine good={dataQuality.missingVehicleMonthRecords === 0} label={`Missing vehicle-month records: ${formatNumber(dataQuality.missingVehicleMonthRecords, language)}`} />
                {monthlyPerformanceRows.map((row) => (
                  <QualityLine key={row.month} good={row.status !== "missing"} label={`${monthLabel(row.month)} - ${row.status === "complete" ? "Complete" : row.status === "partial" ? "Partial" : "Missing"}`} detail={row.status === "missing" ? undefined : `${row.vehicleCount} vehicles`} />
                ))}
                <QualityLine good label={`Last data update: ${dataQuality.lastDataUpdate ? dataQuality.lastDataUpdate.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "Not available"}`} />
              </div>
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">Issues</p>
              <div className="mt-2 grid gap-2">
                <QualityLine good={dataQuality.negativeBalances === 0} label={`${formatNumber(dataQuality.negativeBalances, language)} negative balance${dataQuality.negativeBalances === 1 ? "" : "s"}`} />
                <QualityLine good={dataQuality.unresolvedImportExceptions === 0} label={`${formatNumber(dataQuality.unresolvedImportExceptions, language)} unresolved import${dataQuality.unresolvedImportExceptions === 1 ? "" : "s"}`} />
              </div>
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">Reconciliation</p>
              <div className="mt-2 grid gap-2">
                <QualityLine good={reconciliation.summaryToVehicle} label={`Summary ↔ vehicle table — ${reconciliation.summaryToVehicle ? "Passed" : "Failed"}`} />
                <QualityLine good={reconciliation.vehicleToMonthly} label={`Vehicle table ↔ monthly totals — ${reconciliation.vehicleToMonthly ? "Passed" : "Failed"}`} />
                <QualityLine good={reconciliation.fuelToVehicle} label={`Fuel logs ↔ vehicle totals — ${reconciliation.fuelToVehicle ? "Passed" : "Failed"}`} />
              </div>
            </div>
            <details className="rounded-[0.85rem] border border-slate-100 bg-slate-50 p-3">
              <summary className="cursor-pointer text-xs font-bold uppercase tracking-[0.12em] text-slate-500">Advanced data checks</summary>
              <pre className="mt-3 max-h-72 overflow-auto rounded-md bg-white p-3 text-[11px] text-slate-700">{JSON.stringify(reconciliationDebug, null, 2)}</pre>
            </details>
          </div>
        </details>
      </section>

      </>}

      <details open={dataManagementOpen} onToggle={(event) => setDataManagementOpen(event.currentTarget.open)} className="surface-card p-4 sm:p-5">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
          <div>
            <h3 className="section-title">Data Management</h3>
            <p className="section-subtitle">Excel import, import review and manual monthly figures.</p>
          </div>
          <ChevronDown className={`h-4 w-4 text-slate-500 transition ${dataManagementOpen ? "rotate-180" : ""}`} />
        </summary>

        <div className="mt-5 space-y-5">
          <section className="rounded-[0.85rem] border border-slate-200 bg-white p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h3 className="section-title">{labels.importExcel}</h3>
                <p className="section-subtitle">{labels.importDescription}</p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <input
                  ref={importInputRef}
                  type="file"
                  accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  className="sr-only"
                  disabled={!canOpenImportFilePicker}
                  onChange={(event) => void handleImportFile(event.target.files?.[0] ?? null)}
                />
                <button type="button" onClick={openImportFilePicker} disabled={!canOpenImportFilePicker} className="btn-primary w-full gap-2 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto">
                  <FileUp className="h-4 w-4" />
                  {selectedImportFileName ? labels.changeFile : labels.chooseExcel}
                </button>
                {selectedImportFileName ? (
                  <button type="button" onClick={clearImportFile} className="btn-secondary w-full sm:w-auto">
                    {labels.clear}
                  </button>
                ) : null}
              </div>
            </div>

            {selectedImportFileName ? (
              <p className="mt-3 text-sm font-medium text-slate-700">
                {labels.selectedFile}: <span className="font-semibold text-slate-950">{selectedImportFileName}</span>
              </p>
            ) : null}

            <div className="mt-3 rounded-[0.85rem] border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
              <p className="font-semibold text-slate-800">
                {labels.vehicleMasterLoaded}: {formatNumber(vehicleOptions.length, language)} {labels.vehicles}
              </p>
              {vehicleOptions.length ? <p className="mt-1 break-words">{vehicleOptions.join(", ")}</p> : null}
            </div>

        {vehicleLoadError ? <p className="form-error mt-3">{vehicleLoadError}</p> : null}
        {error ? <p className="form-error mt-3">{error}</p> : null}

        {importOpen && importRows.length > 0 ? (
          <div className="mt-5 rounded-[0.85rem] border border-slate-200 bg-white p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h4 className="text-sm font-bold text-slate-950">{labels.importPreview}</h4>
                <p className="mt-1 text-xs text-slate-500">{labels.importPreviewDescription}</p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <select value={importMode} onChange={(event) => setImportMode(event.target.value as "skip" | "update")} className="form-input bg-white">
                  <option value="skip">{labels.skipExisting}</option>
                  <option value="update">{labels.updateExisting}</option>
                </select>
                <button type="button" onClick={importReadyRows} disabled={!canWrite || importing || readyImportCandidateCount === 0} className="btn-primary gap-2 disabled:cursor-not-allowed disabled:opacity-50">
                  <FileUp className="h-4 w-4" />
                  {importing ? labels.importing : labels.importReadyRecords}
                </button>
              </div>
            </div>

            <p className="mt-4 rounded-[0.85rem] border border-sky-200 bg-sky-50 px-3 py-2 text-sm font-medium text-sky-900">
              {labels.historicalFuelNote}
            </p>

            <div className="mt-4 grid gap-2 sm:grid-cols-3 xl:grid-cols-9">
              <ImportCount label={labels.vehicleRows} value={importCounts.vehicleRows} />
              <ImportCount label={labels.ready} value={importCounts.ready} />
              <ImportCount label={labels.historicalFuelDifference} value={importCounts.historicalFuelDifference} />
              <ImportCount label={labels.fuelWarning} value={importCounts.fuelWarning} />
              <ImportCount label={labels.needsReview} value={importCounts.needsReview} />
              <ImportCount label={labels.duplicate} value={importCounts.duplicate} />
              <ImportCount label={labels.fuelDataMissing} value={importCounts.fuelDataMissing} />
              <ImportCount label={labels.vehicleNotMatched} value={importCounts.vehicleNotMatched} />
              <ImportCount label={labels.skippedRows} value={importCounts.skippedRows} />
            </div>

            <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
              <ImportCount label="Needs Review remaining" value={exceptionCounts.needsReviewRemaining} />
              <ImportCount label="Fuel Warnings remaining" value={exceptionCounts.fuelWarningsRemaining} />
              <ImportCount label="Approved exceptions" value={exceptionCounts.approvedExceptions} />
              <ImportCount label="Resolved corrections" value={exceptionCounts.resolvedCorrections} />
              <ImportCount label="Corrections required" value={exceptionCounts.correctionsRequired} />
            </div>

            {importSummary ? <p className="mt-3 rounded-[0.85rem] border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{importSummary}</p> : null}

            <div className="mt-4 rounded-[0.85rem] border border-slate-200 bg-slate-50 p-3">
              <div className="grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_160px_minmax(180px,0.8fr)] lg:items-end">
                <div>
                  <label className="form-label">Status</label>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { value: "", label: "All" },
                      { value: "Ready", label: labels.ready },
                      { value: "Historical fuel difference", label: labels.historicalFuelDifference },
                      { value: "Fuel warning", label: labels.fuelWarning },
                      { value: "Needs review", label: labels.needsReview },
                      { value: "Duplicate", label: labels.duplicate },
                      { value: "Approved", label: "Approved" },
                      { value: "Imported", label: "Imported" },
                      { value: "Existing", label: "Existing" },
                      { value: "Correction required", label: "Correction required" },
                      { value: "Resolved", label: "Resolved" }
                    ].map((option) => (
                      <button
                        key={option.value || "all"}
                        type="button"
                        onClick={() => setImportStatusFilter(option.value as ImportStatusFilter)}
                        className={`rounded-md border px-3 py-2 text-xs font-semibold ${importStatusFilter === option.value ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-200 bg-white text-slate-600"}`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="form-label">Month</label>
                  <select className="form-input w-full bg-white" value={importMonthFilter} onChange={(event) => setImportMonthFilter(event.target.value ? Number(event.target.value) : "")}>
                    <option value="">All</option>
                    {MONTH_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{labels.months[option.labelKey]}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="form-label">Vehicle registration</label>
                  <input className="form-input w-full bg-white" value={importVehicleFilter} onChange={(event) => setImportVehicleFilter(event.target.value)} placeholder="Search registration" />
                </div>
              </div>
            </div>

            <div className="mt-4 table-shell rounded-[0.85rem]">
              <div className="table-scroll max-h-[420px] overflow-auto">
                <table className="w-full min-w-[1660px] text-xs">
                  <thead className="sticky top-0 z-10 bg-slate-50 text-slate-600">
                    <tr>
                      <th className="table-head-cell text-left">{labels.month}</th>
                      <th className="table-head-cell text-left">{labels.vehicle}</th>
                      <th className="table-head-cell text-right">{labels.revenue}</th>
                      <th className="table-head-cell text-right">{labels.salary}</th>
                      <th className="table-head-cell text-right">{labels.tripPayments}</th>
                      <th className="table-head-cell text-right">{labels.otherExpenses}</th>
                      <th className="table-head-cell text-right">{labels.lpg}</th>
                      <th className="table-head-cell text-right">{labels.excelFuel}</th>
                      <th className="table-head-cell text-right">{labels.appFuel}</th>
                      <th className="table-head-cell text-right">{labels.fuelDifference}</th>
                      <th className="table-head-cell text-right">{labels.calculatedBalance}</th>
                      <th className="table-head-cell text-left">{labels.fuelMatch}</th>
                      <th className="table-head-cell text-left">{labels.status}</th>
                      <th className="table-head-cell text-left">Exception review</th>
                    </tr>
                  </thead>
                  <tbody>
                    {importCandidateRows.map((row) => (
                      <tr key={row.id} className="enterprise-table-row">
                        <td className="table-body-cell">{row.month ? labels.months[MONTH_OPTIONS[row.month - 1].labelKey] : "-"}</td>
                        <td className="table-body-cell font-semibold text-slate-900">{row.canonicalVehicleRegistration || row.vehicleRegistration || "-"}</td>
                        <td className="table-body-cell text-right">{formatBaht(row.grossRevenue)}</td>
                        <td className="table-body-cell text-right">{formatBaht(row.salaryCost)}</td>
                        <td className="table-body-cell text-right">{formatBaht(row.tripIncome)}</td>
                        <td className="table-body-cell text-right">{formatBaht(row.otherExpenses)}</td>
                        <td className="table-body-cell text-right">{formatBaht(row.lpgCost)}</td>
                        <td className="table-body-cell text-right">{row.excelFuel == null ? "-" : formatBaht(row.excelFuel)}</td>
                        <td className="table-body-cell text-right">{row.appFuel == null ? "-" : formatBaht(row.appFuel)}</td>
                        <td className={`table-body-cell text-right font-semibold ${Number(row.fuelDifference || 0) === 0 ? "text-slate-700" : Math.abs(Number(row.fuelDifference || 0)) <= 100 ? "text-emerald-700" : Math.abs(Number(row.fuelDifference || 0)) <= 500 ? "text-amber-700" : "text-rose-700"}`}>{row.fuelDifference == null ? "-" : formatBaht(row.fuelDifference)}</td>
                        <td className="table-body-cell text-right font-semibold text-slate-900">{row.calculatedBalance == null ? "-" : formatBaht(row.calculatedBalance)}</td>
                        <td className="table-body-cell text-slate-600">
                          <span
                            title={`${labels.vehicle}: ${row.canonicalVehicleRegistration || row.vehicleRegistration || "-"} | ${labels.monthStart}: ${row.fuelMatchMonthStart ?? "-"} 00:00:00 | ${labels.monthEnd}: ${row.fuelMatchMonthEnd ?? "-"} 23:59:59 | ${labels.matchingFuelLogs}: ${row.fuelLogCount ?? 0} | ${labels.appFuel}: ${row.appFuel == null ? "-" : formatBaht(row.appFuel)}`}
                            className="inline-flex max-w-[220px] rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-semibold text-slate-700"
                          >
                            {row.fuelLogCount ?? 0} | {row.fuelMatchMonthStart ?? "-"} - {row.fuelMatchMonthEnd ?? "-"}
                          </span>
                        </td>
                        <td className="table-body-cell">
                          <ImportStatusBadge row={row} labels={labels} />
                        </td>
                        <td className="table-body-cell">
                          {row.status === "Fuel warning" || row.status === "Needs review" || row.status === "Review required again" || row.status === "Approved" || row.status === "Correction required" ? (
                            <div className="flex flex-wrap gap-1.5">
                              <button type="button" onClick={() => void openFuelDetails(row)} className="table-action-secondary">
                                View fuel details
                              </button>
                              {row.status === "Fuel warning" || row.status === "Needs review" || row.status === "Review required again" ? (
                                <>
                                  <button type="button" onClick={() => void approveImportException(row.id)} className="table-action-secondary gap-1.5">
                                    <CheckCircle2 className="h-3.5 w-3.5" />
                                    Approve using App Fuel
                                  </button>
                                  <button type="button" onClick={() => void markImportCorrectionRequired(row.id)} className="table-action-danger">
                                    Mark for correction
                                  </button>
                                </>
                              ) : null}
                              {row.status === "Correction required" ? (
                                <>
                                  <button type="button" onClick={() => openCorrectionEditor(row)} className="table-action-secondary gap-1.5">
                                    <Pencil className="h-3.5 w-3.5" />
                                    Edit correction
                                  </button>
                                  <button type="button" onClick={() => void recalculateImportRow(row.id)} className="table-action-secondary">
                                    Recalculate Row
                                  </button>
                                </>
                              ) : null}
                              {row.savedReview ? <ReviewHistory row={row} /> : null}
                            </div>
                          ) : "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : null}
          </section>

        <form onSubmit={submit} className="rounded-[0.85rem] border border-slate-200 bg-white p-5">
          <div className="mb-5">
            <h3 className="section-title">{form.id ? labels.editRecord : labels.addRecord}</h3>
            <p className="section-subtitle mt-1.5">{labels.formDescription}</p>
          </div>
          {!canWrite ? (
            <div className="rounded-[0.85rem] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{labels.readOnlyNotice}</div>
          ) : null}
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label={labels.year} required><input required type="number" min="2000" max="2100" value={form.year} onChange={(event) => setForm((current) => ({ ...current, year: event.target.value }))} onInvalid={handleInvalid} onInput={clearValidationMessage} className="form-input w-full" /></Field>
            <Field label={labels.month} required><select required value={form.month} onChange={(event) => setForm((current) => ({ ...current, month: event.target.value }))} onInvalid={handleInvalid} onInput={clearValidationMessage} className="form-input w-full bg-white">{MONTH_OPTIONS.map((option) => <option key={option.value} value={option.value}>{labels.months[option.labelKey]}</option>)}</select></Field>
            <Field label={labels.vehicle} required full><select required value={form.vehicle_registration} onChange={(event) => setForm((current) => ({ ...current, vehicle_registration: event.target.value }))} onInvalid={handleInvalid} onInput={clearValidationMessage} className="form-input w-full bg-white"><option value="">{labels.selectVehicle}</option>{vehicleOptions.map((vehicle) => <option key={vehicle} value={vehicle}>{vehicle}</option>)}</select></Field>
            <MoneyInput label={labels.revenue} value={form.gross_revenue} onChange={(value) => setForm((current) => ({ ...current, gross_revenue: value }))} />
            <MoneyInput label={labels.salary} value={form.salary_cost} onChange={(value) => setForm((current) => ({ ...current, salary_cost: value }))} />
            <MoneyInput label={labels.tripPayments} value={form.trip_income} onChange={(value) => setForm((current) => ({ ...current, trip_income: value }))} />
            <MoneyInput label={labels.otherExpenses} value={form.other_expenses} onChange={(value) => setForm((current) => ({ ...current, other_expenses: value }))} />
            <MoneyInput label={labels.lpg} value={form.lpg_cost} onChange={(value) => setForm((current) => ({ ...current, lpg_cost: value }))} />
            <Field label={labels.notes} full><textarea value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} className="form-textarea min-h-[92px] w-full" /></Field>
          </div>
          <div className="mt-4 rounded-[0.85rem] border border-brand-100 bg-brand-50/70 p-4">
            <p className="flex items-center gap-2 text-sm font-semibold text-slate-900"><Calculator className="h-4 w-4 text-brand-700" />{labels.preview}</p>
            <div className="mt-3 grid gap-2 text-sm text-slate-700">
              <PreviewLine label={labels.revenue} value={formatBaht(numericInput(form.gross_revenue))} />
              <PreviewLine label={labels.salary} value={`-${formatBaht(numericInput(form.salary_cost))}`} />
              <PreviewLine label={labels.tripPayments} value={`-${formatBaht(numericInput(form.trip_income))}`} />
              <PreviewLine label={labels.otherExpenses} value={`-${formatBaht(numericInput(form.other_expenses))}`} />
              <PreviewLine label={labels.fuelSpend} value={`-${formatBaht(formFuelSpend)}`} />
              <PreviewLine label={labels.recordedBalance} value={formatBaht(formBalance)} strong />
              <PreviewLine label={labels.marginPercent} value={formatPercent(formMarginPercent, language)} />
              <PreviewLine label={labels.lpg} value={`${formatBaht(numericInput(form.lpg_cost))} tracked separately`} />
            </div>
          </div>
          {duplicateFormRecord ? <p className="form-error mt-3">A monthly record already exists for this vehicle and month. Open the existing record to edit it.</p> : null}
          {error ? <p className="form-error mt-3">{error}</p> : null}
          {successMessage ? <p className="mt-3 text-sm font-medium text-emerald-700">{successMessage}</p> : null}
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <button type="submit" disabled={!canWrite || saving || Boolean(duplicateFormRecord)} className="btn-primary flex-1 disabled:cursor-not-allowed disabled:opacity-50">{saving ? t.common.saving : form.id ? labels.updateRecord : labels.saveRecord}</button>
            {form.id ? <button type="button" onClick={resetForm} className="btn-secondary flex-1">{t.common.cancel}</button> : null}
          </div>
        </form>
        </div>
      </details>

      {selectedFuelDetailRow ? (
        <FuelDetailsModal
          row={selectedFuelDetailRow}
          logs={fuelDetailLogs}
          loading={fuelDetailLoading}
          error={fuelDetailError}
          labels={labels}
          onClose={closeFuelDetails}
          onApprove={approveImportException}
          onMarkCorrection={markImportCorrectionRequired}
        />
      ) : null}
      {selectedCorrectionRow && correctionForm ? (
        <CorrectionEditorModal
          row={selectedCorrectionRow}
          form={correctionForm}
          onFormChange={setCorrectionForm}
          loading={correctionSaving}
          error={correctionError}
          labels={labels}
          language={language}
          onClose={closeCorrectionEditor}
          onViewFuelLogs={() => void openFuelDetails(selectedCorrectionRow)}
          onRecalculate={() => void recalculateImportRow(selectedCorrectionRow.id)}
          onSave={() => void saveCorrectionEdits(false)}
          onResolve={() => void resolveCorrection()}
        />
      ) : null}
      {selectedPartialMonthRow ? (
        <PartialMonthDetailModal
          year={year}
          monthName={monthLabel(selectedPartialMonthRow.month)}
          expectedVehicleCount={expectedVehicleRegistrations.length}
          vehicleCount={selectedPartialMonthRow.vehicleCount}
          missingVehicles={missingVehiclesByMonth.get(selectedPartialMonthRow.month) ?? []}
          onClose={() => setPartialMonthDetail(null)}
        />
      ) : null}
      {vehicleCoverageOpen ? (
        <VehicleCoverageModal
          details={vehicleCoverageDetails}
          onClose={() => setVehicleCoverageOpen(false)}
        />
      ) : null}
      {selectedCoverageDetail ? (
        <VehicleMonthCoverageModal
          detail={selectedCoverageDetail}
          monthLabel={monthLabel}
          onClose={() => setCoverageVehicleDetail(null)}
        />
      ) : null}
      {monitorDetailOpen ? (
        <MonitorVehiclesModal
          rows={monitorRows}
          language={language}
          onClose={() => setMonitorDetailOpen(false)}
        />
      ) : null}
    </>
  );
}

function Field({ label, required, full, children }: { label: string; required?: boolean; full?: boolean; children: React.ReactNode }) {
  return <div className={`form-field ${full ? "sm:col-span-2" : ""}`}><label className={`form-label ${required ? "form-label-required" : ""}`}>{label}</label>{children}</div>;
}

function MoneyInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <Field label={label}><input type="number" min="0" step="0.01" value={value} onChange={(event) => onChange(event.target.value)} className="form-input w-full" placeholder="0.00" /></Field>;
}

function KpiCard({
  label,
  value,
  detail,
  helper,
  tone = "default",
  tooltip,
  onClick
}: {
  label: string;
  value: string;
  detail?: string;
  helper?: string;
  tone?: "default" | "success" | "danger";
  tooltip?: string;
  onClick?: () => void;
}) {
  const toneClass = tone === "success" ? "text-emerald-700" : tone === "danger" ? "text-rose-700" : "text-slate-950";
  const content = (
    <>
      <div className="flex items-center gap-1.5">
        <p className="metric-label">{label}</p>
        {tooltip ? (
          <span className="inline-flex" title={tooltip} aria-label={tooltip}>
            <Info className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
          </span>
        ) : null}
      </div>
      <p className={`mt-2 truncate text-2xl font-bold ${toneClass}`} title={tooltip ?? detail}>{value}</p>
      {detail ? <p className="mt-1 truncate text-xs text-slate-500">{detail}</p> : null}
      {helper ? <p className="mt-2 text-xs font-semibold leading-5 text-slate-700">{helper}</p> : null}
    </>
  );
  if (onClick) {
    return <button type="button" onClick={onClick} title={tooltip ?? detail} className="subtle-panel p-4 text-left transition hover:border-brand-200 hover:bg-brand-50/40 focus:outline-none focus:ring-2 focus:ring-brand-200">{content}</button>;
  }
  return <article className="subtle-panel p-4" title={tooltip}>{content}</article>;
}

function QualityLine({ good, label, detail }: { good: boolean; label: string; detail?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-[0.85rem] border border-slate-100 bg-white px-3 py-2">
      <span className="min-w-0 truncate text-slate-700">{good ? "OK" : "!"} {label}</span>
      {detail ? <span className="shrink-0 text-xs font-semibold text-slate-500">{detail}</span> : null}
    </div>
  );
}

function SortHead({
  label,
  sortKey,
  active,
  onSort,
  className = "text-right"
}: {
  label: string;
  sortKey: VehicleSortKey;
  active: { key: VehicleSortKey; direction: "asc" | "desc" };
  onSort: (key: VehicleSortKey) => void;
  className?: string;
}) {
  const isActive = active.key === sortKey;
  return (
    <th className={`table-head-cell ${className}`}>
      <button type="button" onClick={() => onSort(sortKey)} className="inline-flex w-full items-center justify-end gap-1 text-inherit">
        <span className="truncate">{label}</span>
        <span className="text-[10px] text-slate-400">{isActive ? (active.direction === "desc" ? "v" : "^") : "-"}</span>
      </button>
    </th>
  );
}

function ImportCount({ label, value }: { label: string; value: number }) {
  return <div className="rounded-[0.85rem] border border-slate-100 bg-slate-50 px-3 py-2"><p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">{label}</p><p className="mt-1 text-lg font-bold text-slate-950">{value}</p></div>;
}

function PreviewMetric({
  label,
  value,
  tone = "default"
}: {
  label: string;
  value: string;
  tone?: "default" | "success" | "info" | "warning" | "danger";
}) {
  const toneClass =
    tone === "success"
      ? "text-emerald-700"
      : tone === "info"
        ? "text-sky-700"
        : tone === "warning"
          ? "text-amber-700"
          : tone === "danger"
            ? "text-rose-700"
            : "text-slate-950";
  return (
    <div className="rounded-md border border-slate-100 bg-white px-3 py-2">
      <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">{label}</p>
      <p className={`mt-1 text-base font-bold ${toneClass}`}>{value}</p>
    </div>
  );
}

function displayMonthlyValue(row: VehiclePerformanceMonthlyPerformanceRow, value: string) {
  return row.status === "missing" ? "-" : value;
}

function MonthlyPerformanceTable({
  rows,
  labels,
  language,
  monthLabel,
  expectedVehicleCount,
  missingVehiclesByMonth,
  onPartialClick
}: {
  rows: VehiclePerformanceMonthlyPerformanceRow[];
  labels: ReturnType<typeof useLanguage>["t"]["vehiclePerformance"];
  language: "en" | "th";
  monthLabel: (month: number) => string;
  expectedVehicleCount: number;
  missingVehiclesByMonth: Map<number, string[]>;
  onPartialClick: (month: number) => void;
}) {
  return (
    <div className="table-shell rounded-[0.85rem]">
      <div className="table-scroll overflow-x-auto">
        <table className="w-full min-w-[1040px] text-sm">
          <thead className="bg-slate-50/95 text-slate-600">
            <tr>
              <th className="table-head-cell text-left">{labels.month}</th>
              <th className="table-head-cell text-right">{labels.revenue}</th>
              <th className="table-head-cell text-right">{labels.fuel}</th>
              <th className="table-head-cell text-right">{labels.fuelPercent}</th>
              <th className="table-head-cell text-right">{labels.salary}</th>
              <th className="table-head-cell text-right">{labels.tripPayments}</th>
              <th className="table-head-cell text-right">{labels.otherCosts}</th>
              <th className="table-head-cell text-right">{labels.recordedBalance}</th>
              <th className="table-head-cell text-right">{labels.marginPercent}</th>
              <th className="table-head-cell text-right">Vehicles</th>
              <th className="table-head-cell text-left">{labels.status}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.month} className="enterprise-table-row">
                <td className="table-body-cell font-semibold text-slate-950">
                  <div>{monthLabel(row.month)}</div>
                  {row.status === "partial" ? (
                    <button
                      type="button"
                      onClick={() => onPartialClick(row.month)}
                      className="mt-0.5 text-left text-xs font-semibold text-amber-700 underline decoration-amber-300 underline-offset-2 hover:text-amber-900"
                    >
                      Partial - {(missingVehiclesByMonth.get(row.month) ?? []).length} {(missingVehiclesByMonth.get(row.month) ?? []).length === 1 ? "vehicle" : "vehicles"} missing
                    </button>
                  ) : null}
                </td>
                <td className="table-body-cell text-right">{displayMonthlyValue(row, formatBaht(row.grossRevenue))}</td>
                <td className="table-body-cell text-right">{displayMonthlyValue(row, formatBaht(row.fuelSpend))}</td>
                <td className="table-body-cell text-right">{displayMonthlyValue(row, formatPercent(row.fuelPercent, language))}</td>
                <td className="table-body-cell text-right">{displayMonthlyValue(row, formatBaht(row.salaryCost))}</td>
                <td className="table-body-cell text-right">{displayMonthlyValue(row, formatBaht(row.tripIncome))}</td>
                <td className="table-body-cell text-right">{displayMonthlyValue(row, formatBaht(row.otherExpenses))}</td>
                <td className={`table-body-cell text-right font-bold ${row.recordedBalance < 0 ? "text-rose-700" : "text-slate-900"}`}>{displayMonthlyValue(row, formatBaht(row.recordedBalance))}</td>
                <td className="table-body-cell text-right">{displayMonthlyValue(row, formatPercent(row.marginPercent, language))}</td>
                <td className="table-body-cell text-right">
                  {row.status === "missing" ? "-" : row.status === "partial" ? (
                    <button
                      type="button"
                      onClick={() => onPartialClick(row.month)}
                      className="inline-flex rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800 hover:border-amber-300 hover:bg-amber-100"
                    >
                      {row.vehicleCount} / {expectedVehicleCount}
                    </button>
                  ) : `${row.vehicleCount} / ${expectedVehicleCount}`}
                </td>
                <td className="table-body-cell">
                  <MonthStatusBadge
                    status={row.status}
                    missingVehicles={missingVehiclesByMonth.get(row.month) ?? []}
                    monthLabel={monthLabel(row.month)}
                    onClick={row.status === "partial" ? () => onPartialClick(row.month) : undefined}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MonthStatusBadge({
  status,
  missingVehicles = [],
  monthLabel,
  onClick
}: {
  status: VehiclePerformanceMonthlyPerformanceRow["status"];
  missingVehicles?: string[];
  monthLabel?: string;
  onClick?: () => void;
}) {
  const classes =
    status === "complete"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : status === "partial"
        ? "border-amber-200 bg-amber-50 text-amber-800"
        : "border-slate-200 bg-slate-50 text-slate-500";
  const label = status === "complete" ? "Complete" : status === "partial" ? "Partial" : "Missing";
  const title = status === "partial"
    ? `${monthLabel ?? "Month"} missing: ${missingVehicles.join(", ") || "vehicle data"}`
    : label;
  return <button type="button" onClick={onClick} title={title} className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${classes} ${onClick ? "hover:shadow-sm" : "cursor-help"}`}>{label}</button>;
}

function PreviewLine({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return <div className={`flex items-center justify-between gap-3 ${strong ? "border-t border-brand-200 pt-2 font-bold text-slate-950" : ""}`}><span>{label}</span><span>{value}</span></div>;
}

function StatusBadge({
  row,
  labels,
  language
}: {
  row: VehiclePerformanceRow;
  labels: ReturnType<typeof useLanguage>["t"]["vehiclePerformance"];
  language: "en" | "th";
}) {
  const { status } = row;
  const classes =
    status === "strong"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : status === "stable"
        ? "border-sky-200 bg-sky-50 text-sky-700"
        : status === "needsAttention"
          ? "border-rose-200 bg-rose-50 text-rose-700"
          : "border-amber-200 bg-amber-50 text-amber-800";
  const text = performanceStatusLabel(status, labels);
  const reason = performanceStatusReason(row, language);
  const shortReason = performanceStatusShortReason(row, language);
  return (
    <span title={reason} className="inline-flex flex-col items-start gap-0.5">
      <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${classes}`}>{text}</span>
      {shortReason ? <span className={`max-w-[240px] whitespace-normal text-[11px] font-semibold ${status === "needsAttention" ? "text-rose-700" : "text-slate-500"}`}>{shortReason}</span> : null}
    </span>
  );
}

function performanceStatusShortReason(row: VehiclePerformanceRow, language: "en" | "th") {
  if (row.statusReason) return row.statusReason;
  if (row.status === "strong") return "";
  if (row.status === "needsAttention") {
    if (row.recordedBalance < 0) return "Negative balance";
    if (row.marginPercent != null && row.marginPercent < VEHICLE_PERFORMANCE_STATUS_RULES.needsAttentionMinMarginPercent) return `Margin ${formatPercent(row.marginPercent, language)}`;
    if (row.fuelPercent != null && row.fuelPercent > VEHICLE_PERFORMANCE_STATUS_RULES.needsAttentionMaxFuelPercent) return `Fuel ${formatPercent(row.fuelPercent, language)}`;
  }
  if (row.status === "stable") {
    if (row.fuelPercent != null && row.fuelPercent > VEHICLE_PERFORMANCE_STATUS_RULES.strongMaxFuelPercent) return `Fuel ${formatPercent(row.fuelPercent, language)}`;
    if (row.marginPercent != null && row.marginPercent < VEHICLE_PERFORMANCE_STATUS_RULES.strongMarginPercent) return `Margin ${formatPercent(row.marginPercent, language)}`;
  }
  if (row.status === "monitor") {
    if (row.marginPercent != null && row.marginPercent < VEHICLE_PERFORMANCE_STATUS_RULES.stableMarginPercent) return `Margin ${formatPercent(row.marginPercent, language)}`;
    if (row.fuelPercent != null && row.fuelPercent > VEHICLE_PERFORMANCE_STATUS_RULES.stableMaxFuelPercent) return `Fuel ${formatPercent(row.fuelPercent, language)}`;
  }
  return "";
}

function ImportStatusBadge({ row, labels }: { row: VehiclePerformanceImportRow; labels: ReturnType<typeof useLanguage>["t"]["vehiclePerformance"] }) {
  const statusLabel =
    row.status === "Ready" ? labels.ready :
    row.status === "Approved" ? "Approved" :
    row.status === "Imported" ? "Imported" :
    row.status === "Existing" ? "Existing" :
    row.status === "Resolved" ? "Resolved" :
    row.status === "Historical fuel difference" ? labels.historicalFuelDifference :
    row.status === "Correction required" ? "Correction required" :
    row.status === "Fuel data missing" ? labels.fuelDataMissing :
    row.status === "Fuel warning" ? labels.fuelWarning :
    row.status === "Review required again" ? "Review required again" :
    row.status === "Vehicle not matched" ? labels.vehicleNotMatched :
    row.status === "Duplicate" ? labels.duplicate :
    row.status === "Skipped" ? labels.skipped :
    labels.needsReview;
  const classes =
    row.status === "Ready" ? "border-emerald-200 bg-emerald-50 text-emerald-700" :
    row.status === "Approved" ? "border-emerald-200 bg-emerald-50 text-emerald-700" :
    row.status === "Imported" ? "border-emerald-200 bg-emerald-50 text-emerald-700" :
    row.status === "Existing" ? "border-slate-200 bg-slate-50 text-slate-700" :
    row.status === "Resolved" ? "border-emerald-200 bg-emerald-50 text-emerald-700" :
    row.status === "Historical fuel difference" ? "border-sky-200 bg-sky-50 text-sky-700" :
    row.status === "Correction required" ? "border-slate-300 bg-slate-100 text-slate-700" :
    row.status === "Fuel warning" ? "border-amber-200 bg-amber-50 text-amber-800" :
    row.status === "Review required again" ? "border-rose-200 bg-rose-50 text-rose-700" :
    row.status === "Fuel data missing" || row.status === "Needs review" ? "border-rose-200 bg-rose-50 text-rose-700" :
    row.status === "Vehicle not matched" ? "border-rose-200 bg-rose-50 text-rose-700" :
    "border-slate-200 bg-slate-100 text-slate-600";

  return <span title={row.reason} className={`inline-flex max-w-[180px] rounded-full border px-2.5 py-1 text-[11px] font-semibold ${classes}`}>{statusLabel}</span>;
}

function ReviewHistory({ row }: { row: VehiclePerformanceImportRow }) {
  if (!row.savedReview) return null;
  const reviewedAt = row.savedReview.reviewed_at ? new Date(row.savedReview.reviewed_at) : null;
  const reviewedAtText = reviewedAt && Number.isFinite(reviewedAt.getTime())
    ? reviewedAt.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })
    : "-";

  return (
    <details className="basis-full rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-slate-600">
      <summary className="cursor-pointer font-semibold text-slate-700">Review history</summary>
      <div className="mt-2 grid gap-1">
        <PreviewLine label="Decision" value={row.savedReview.review_status === "approved" ? "Approved" : "Correction required"} />
        <PreviewLine label="Reviewed" value={reviewedAtText} />
        <PreviewLine label="Reviewed by" value={row.savedReview.reviewed_by || "-"} />
        <PreviewLine label="Excel fuel at review" value={row.savedReview.excel_fuel == null ? "-" : formatBaht(row.savedReview.excel_fuel)} />
        <PreviewLine label="App fuel at review" value={formatBaht(row.savedReview.app_fuel_at_review)} />
        <PreviewLine label="Difference" value={row.savedReview.fuel_difference_at_review == null ? "-" : formatBaht(row.savedReview.fuel_difference_at_review)} />
      </div>
    </details>
  );
}

function CorrectionEditorModal({
  row,
  form,
  onFormChange,
  loading,
  error,
  labels,
  language,
  onClose,
  onViewFuelLogs,
  onRecalculate,
  onSave,
  onResolve
}: {
  row: VehiclePerformanceImportRow;
  form: CorrectionForm;
  onFormChange: (form: CorrectionForm) => void;
  loading: boolean;
  error: string | null;
  labels: ReturnType<typeof useLanguage>["t"]["vehiclePerformance"];
  language: "en" | "th";
  onClose: () => void;
  onViewFuelLogs: () => void;
  onRecalculate: () => void;
  onSave: () => void;
  onResolve: () => void;
}) {
  const revenue = numericInput(form.grossRevenue);
  const salary = numericInput(form.salaryCost);
  const tripPayments = numericInput(form.tripIncome);
  const otherExpenses = numericInput(form.otherExpenses);
  const lpg = numericInput(form.lpgCost);
  const appFuel = Number(row.appFuel || 0);
  const metrics = calculateVehiclePerformanceMetrics({
    grossRevenue: revenue,
    fuelSpend: appFuel,
    lpgCost: lpg,
    salaryCost: salary,
    tripIncome: tripPayments,
    otherExpenses
  });

  const update = (key: keyof CorrectionForm, value: string) => onFormChange({ ...form, [key]: value });

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-end bg-slate-950/35">
      <div className="flex h-full w-full max-w-3xl flex-col bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div>
            <h3 className="text-base font-bold text-slate-950">Edit correction</h3>
            <p className="mt-1 text-sm text-slate-500">
              {row.year} | {row.month ? labels.months[MONTH_OPTIONS[row.month - 1].labelKey] : "-"} | {row.canonicalVehicleRegistration || row.vehicleRegistration}
            </p>
          </div>
          <button type="button" onClick={onClose} className="icon-button" aria-label="Close correction editor">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-5">
          {error ? <p className="form-error mb-4">{error}</p> : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <PreviewLine label={labels.year} value={String(row.year ?? "-")} />
            <PreviewLine label={labels.month} value={row.month ? labels.months[MONTH_OPTIONS[row.month - 1].labelKey] : "-"} />
            <PreviewLine label={labels.vehicle} value={row.canonicalVehicleRegistration || row.vehicleRegistration || "-"} />
            <PreviewLine label={labels.excelFuel} value={row.excelFuel == null ? "-" : formatBaht(row.excelFuel)} />
            <PreviewLine label={labels.appFuel} value={row.appFuel == null ? "-" : formatBaht(row.appFuel)} />
            <PreviewLine label={labels.fuelDifference} value={row.fuelDifference == null ? "-" : formatBaht(row.fuelDifference)} />
            <PreviewLine label={labels.calculatedBalance} value={formatBaht(metrics.recordedBalance)} strong />
            <PreviewLine label={labels.marginPercent} value={formatPercent(metrics.marginPercent, language)} />
            <PreviewLine label={labels.fuelPercent} value={formatPercent(metrics.fuelPercent, language)} />
          </div>

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <MoneyInput label={labels.revenue} value={form.grossRevenue} onChange={(value) => update("grossRevenue", value)} />
            <MoneyInput label={labels.salary} value={form.salaryCost} onChange={(value) => update("salaryCost", value)} />
            <MoneyInput label={labels.tripPayments} value={form.tripIncome} onChange={(value) => update("tripIncome", value)} />
            <MoneyInput label={labels.otherExpenses} value={form.otherExpenses} onChange={(value) => update("otherExpenses", value)} />
            <MoneyInput label={labels.lpg} value={form.lpgCost} onChange={(value) => update("lpgCost", value)} />
            <Field label="Current correction reason" full>
              <textarea value={form.reason} onChange={(event) => update("reason", event.target.value)} className="form-textarea min-h-[92px] w-full" />
            </Field>
          </div>

          <div className="mt-5 rounded-[0.85rem] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Fuel is recalculated from Fuel Logs only. Use fuel details to inspect logs, then fix or reassign the Fuel Log vehicle registration where needed.
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" onClick={onViewFuelLogs} className="btn-secondary">
              View Fuel Logs
            </button>
            <button type="button" onClick={onRecalculate} className="btn-secondary">
              Recalculate from Fuel Logs
            </button>
            <button type="button" onClick={onViewFuelLogs} className="btn-secondary">
              Fix/reassign vehicle registration
            </button>
          </div>

          <div className="mt-5">
            <ReviewHistory row={row} />
          </div>
        </div>

        <div className="flex flex-col gap-2 border-t border-slate-200 bg-slate-50 px-5 py-4 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} disabled={loading} className="btn-secondary disabled:opacity-50">
            Cancel
          </button>
          <button type="button" onClick={onRecalculate} disabled={loading} className="btn-secondary disabled:opacity-50">
            Recalculate row
          </button>
          <button type="button" onClick={onSave} disabled={loading} className="btn-primary disabled:opacity-50">
            {loading ? "Saving..." : "Save correction"}
          </button>
          <button type="button" onClick={onResolve} disabled={loading} className="btn-primary disabled:opacity-50">
            Resolve correction
          </button>
        </div>
      </div>
    </div>
  );
}

function FuelDetailsModal({
  row,
  logs,
  loading,
  error,
  labels,
  onClose,
  onApprove,
  onMarkCorrection
}: {
  row: VehiclePerformanceImportRow;
  logs: FuelLogWithDriver[];
  loading: boolean;
  error: string | null;
  labels: ReturnType<typeof useLanguage>["t"]["vehiclePerformance"];
  onClose: () => void;
  onApprove: (rowId: string) => void | Promise<void>;
  onMarkCorrection: (rowId: string) => void | Promise<void>;
}) {
  const appFuelTotal = logs.reduce((sum, log) => sum + Number(log.total_cost || 0), 0);
  const canReview = row.status === "Fuel warning" || row.status === "Needs review" || row.status === "Review required again";

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-end bg-slate-950/35">
      <div className="flex h-full w-full max-w-5xl flex-col bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div>
            <h3 className="text-base font-bold text-slate-950">Fuel details</h3>
            <p className="mt-1 text-sm text-slate-500">
              {row.canonicalVehicleRegistration || row.vehicleRegistration} | {row.fuelMatchMonthStart} - {row.fuelMatchMonthEnd}
            </p>
          </div>
          <button type="button" onClick={onClose} className="icon-button" aria-label="Close fuel details">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-5">
          {error ? <p className="form-error">{error}</p> : null}
          {loading ? (
            <p className="text-sm text-slate-500">Loading fuel details...</p>
          ) : logs.length === 0 ? (
            <EmptyState title="No matching fuel logs" description="No Fuel Logs matched this vehicle registration and calendar month." />
          ) : (
            <div className="table-shell rounded-[0.85rem]">
              <div className="table-scroll overflow-x-auto">
                <table className="w-full min-w-[980px] text-xs">
                  <thead className="bg-slate-50 text-slate-600">
                    <tr>
                      <th className="table-head-cell text-left">Date</th>
                      <th className="table-head-cell text-left">Driver</th>
                      <th className="table-head-cell text-left">Vehicle registration</th>
                      <th className="table-head-cell text-left">Station</th>
                      <th className="table-head-cell text-left">Fuel type</th>
                      <th className="table-head-cell text-right">Litres</th>
                      <th className="table-head-cell text-right">Price / litre</th>
                      <th className="table-head-cell text-right">Total cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map((log) => (
                      <tr key={log.id} className="enterprise-table-row">
                        <td className="table-body-cell">{log.date}</td>
                        <td className="table-body-cell">{log.driver || "-"}</td>
                        <td className="table-body-cell font-semibold text-slate-900">{log.vehicle_reg}</td>
                        <td className="table-body-cell">{log.station || log.location || "-"}</td>
                        <td className="table-body-cell">{log.fuel_type || "-"}</td>
                        <td className="table-body-cell text-right">{formatNumber(Number(log.litres || 0), "en", 2)}</td>
                        <td className="table-body-cell text-right">{log.price_per_litre == null ? "-" : formatBaht(Number(log.price_per_litre || 0))}</td>
                        <td className="table-body-cell text-right font-semibold">{formatBaht(Number(log.total_cost || 0))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <div className="border-t border-slate-200 bg-slate-50 px-5 py-4">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <ImportCount label="Matching fuel logs" value={logs.length} />
            <div className="rounded-[0.85rem] border border-slate-100 bg-white px-3 py-2">
              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">Excel Fuel reference</p>
              <p className="mt-1 text-lg font-bold text-slate-950">{row.excelFuel == null ? "-" : formatBaht(row.excelFuel)}</p>
            </div>
            <div className="rounded-[0.85rem] border border-slate-100 bg-white px-3 py-2">
              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">App Fuel total</p>
              <p className="mt-1 text-lg font-bold text-slate-950">{formatBaht(appFuelTotal)}</p>
            </div>
            <div className="rounded-[0.85rem] border border-slate-100 bg-white px-3 py-2">
              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">Difference</p>
              <p className="mt-1 text-lg font-bold text-slate-950">{row.fuelDifference == null ? "-" : formatBaht(row.fuelDifference)}</p>
            </div>
          </div>

          {canReview ? (
            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => void onMarkCorrection(row.id)} className="btn-secondary">
                Mark for correction
              </button>
              <button type="button" onClick={() => void onApprove(row.id)} className="btn-primary gap-2">
                <CheckCircle2 className="h-4 w-4" />
                Approve using App Fuel
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function PartialMonthDetailModal({
  year,
  monthName,
  expectedVehicleCount,
  vehicleCount,
  missingVehicles,
  onClose
}: {
  year: number;
  monthName: string;
  expectedVehicleCount: number;
  vehicleCount: number;
  missingVehicles: string[];
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 p-4">
      <div className="w-full max-w-lg rounded-[0.85rem] bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div>
            <h3 className="text-base font-bold text-slate-950">{monthName} {year}</h3>
            <p className="mt-1 text-sm text-slate-500">Partial month coverage</p>
          </div>
          <button type="button" onClick={onClose} className="icon-button" aria-label="Close partial month details">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-3 p-5 text-sm">
          <PreviewLine label="Expected vehicles" value={String(expectedVehicleCount)} />
          <PreviewLine label="Records present" value={String(vehicleCount)} />
          <div className="rounded-[0.85rem] border border-amber-200 bg-amber-50 px-3 py-2">
            <p className="text-xs font-bold uppercase tracking-[0.12em] text-amber-800">{missingVehicles.length === 1 ? "Missing vehicle" : "Missing vehicles"}</p>
            <div className="mt-1 grid gap-1 font-semibold text-slate-900">
              {missingVehicles.length ? missingVehicles.map((registration) => <span key={registration}>{registration}</span>) : <span>None</span>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function VehicleCoverageModal({
  details,
  onClose
}: {
  details: { masterCount: number; withPerformanceCount: number; withoutPerformance: VehicleCoverageDetail[] };
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 p-4">
      <div className="w-full max-w-lg rounded-[0.85rem] bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-brand-700">Vehicle Coverage</p>
            <h3 className="mt-1 text-base font-bold text-slate-950">Vehicles Included</h3>
            <p className="mt-1 text-sm text-slate-500">Master records compared with Vehicle Performance data.</p>
          </div>
          <button type="button" onClick={onClose} className="icon-button" aria-label="Close vehicle coverage">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-3 p-5 text-sm">
          <PreviewLine label="Vehicle master records" value={String(details.masterCount)} />
          <PreviewLine label="With Vehicle Performance data" value={String(details.withPerformanceCount)} />
          <PreviewLine label="Without performance data" value={String(details.withoutPerformance.length)} />
          <div className="rounded-[0.85rem] border border-slate-200 bg-slate-50 px-3 py-2">
            <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">Without performance data</p>
            {details.withoutPerformance.length ? (
              <div className="mt-2 grid gap-2">
                {details.withoutPerformance.map((vehicle) => (
                  <div key={vehicle.registration} className="rounded-md border border-white bg-white px-3 py-2">
                    <p className="font-semibold text-slate-950">{vehicle.registration}</p>
                    <p className="mt-0.5 text-xs text-slate-500">{vehicle.reasons.join(" - ")}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-1 font-semibold text-slate-900">None</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function VehicleMonthCoverageModal({
  detail,
  monthLabel,
  onClose
}: {
  detail: CoverageVehicleDetail & { title: string };
  monthLabel: (month: number) => string;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 p-4">
      <div className="w-full max-w-lg rounded-[0.85rem] bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div>
            <h3 className="text-base font-bold text-slate-950">{detail.registration}</h3>
            <p className="mt-1 text-sm text-slate-500">{detail.title}</p>
          </div>
          <button type="button" onClick={onClose} className="icon-button" aria-label="Close vehicle month coverage">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="grid gap-4 p-5 text-sm sm:grid-cols-2">
          <div className="rounded-[0.85rem] border border-emerald-200 bg-emerald-50 px-3 py-2">
            <p className="text-xs font-bold uppercase tracking-[0.12em] text-emerald-700">Present</p>
            <div className="mt-2 grid gap-1 font-semibold text-slate-900">
              {detail.presentMonths.map((month) => <span key={month}>{monthLabel(month)} ✓</span>)}
            </div>
          </div>
          <div className="rounded-[0.85rem] border border-amber-200 bg-amber-50 px-3 py-2">
            <p className="text-xs font-bold uppercase tracking-[0.12em] text-amber-800">Missing</p>
            <div className="mt-2 grid gap-1 font-semibold text-slate-900">
              {detail.missingMonths.map((month) => <span key={month}>{monthLabel(month)}</span>)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MonitorVehiclesModal({
  rows,
  language,
  onClose
}: {
  rows: VehiclePerformanceRow[];
  language: "en" | "th";
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 p-4">
      <div className="w-full max-w-2xl rounded-[0.85rem] bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div>
            <h3 className="text-base font-bold text-slate-950">Monitor Vehicles</h3>
            <p className="mt-1 text-sm text-slate-500">Profitable vehicles outside Stable thresholds, but not at Attention level.</p>
          </div>
          <button type="button" onClick={onClose} className="icon-button" aria-label="Close Monitor vehicles">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-5">
          <div className="grid gap-2">
            {rows.map((row) => (
              <div key={row.vehicleRegistration} className="grid gap-2 rounded-[0.85rem] border border-amber-100 bg-amber-50/60 px-3 py-2 text-sm sm:grid-cols-[0.8fr_0.65fr_0.65fr_1.4fr] sm:items-center">
                <p className="font-bold text-slate-950">{row.vehicleRegistration}</p>
                <p className="text-slate-700">Margin {formatPercent(row.marginPercent, language)}</p>
                <p className="text-slate-700">Fuel {formatPercent(row.fuelPercent, language)}</p>
                <p className="font-semibold text-amber-800">Reason: {monitorReason(row, language)}</p>
              </div>
            ))}
            {!rows.length ? <p className="text-sm text-slate-500">No Monitor vehicles for the selected period.</p> : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function MobilePerformanceCard({
  row,
  labels,
  language,
  sourceRecord,
  canWrite,
  canDelete,
  deletingId,
  onEdit,
  onDelete,
  showActions = true,
  onView
}: {
  row: VehiclePerformanceRow;
  labels: ReturnType<typeof useLanguage>["t"]["vehiclePerformance"];
  language: "en" | "th";
  sourceRecord: VehicleMonthlyPerformance | null;
  canWrite: boolean;
  canDelete: boolean;
  deletingId: string | null;
  onEdit: (record: VehicleMonthlyPerformance) => void;
  onDelete: (id: string) => void;
  showActions?: boolean;
  onView: (registration: string) => void;
}) {
  return (
    <div className="subtle-panel p-4">
      <div className="flex items-start justify-between gap-3">
        <div><button type="button" onClick={() => onView(row.vehicleRegistration)} className="text-sm font-bold text-brand-700 underline">{row.vehicleRegistration}</button><p className="mt-1 text-xs text-slate-500">{labels.recordedBalance}: {formatBaht(row.recordedBalance)}</p></div>
        <StatusBadge row={row} labels={labels} language={language} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-600">
        <PreviewLine label={labels.revenue} value={formatBaht(row.grossRevenue)} />
        <PreviewLine label={labels.fuel} value={formatBaht(row.fuelSpend)} />
        <PreviewLine label={labels.marginPercent} value={formatPercent(row.marginPercent, language)} />
        <PreviewLine label={labels.fuelPercent} value={formatPercent(row.fuelPercent, language)} />
      </div>
      {showActions && sourceRecord ? (
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button type="button" onClick={() => onEdit(sourceRecord)} disabled={!canWrite} className="btn-secondary gap-1.5 disabled:opacity-50"><Pencil className="h-4 w-4" />{labels.edit}</button>
          <button type="button" onClick={() => onDelete(sourceRecord.id)} disabled={!canDelete || deletingId === sourceRecord.id} className="btn-danger gap-1.5 disabled:opacity-50"><Trash2 className="h-4 w-4" />{deletingId === sourceRecord.id ? labels.deleting : labels.delete}</button>
        </div>
      ) : null}
    </div>
  );
}

function RankedList({ rows, labels, language, rankingKey, onView }: { onView: (registration: string) => void; rows: VehiclePerformanceRow[]; labels: ReturnType<typeof useLanguage>["t"]["vehiclePerformance"]; language: "en" | "th"; rankingKey: RankingKey }) {
  if (!rows.length) return <div className="mt-4 flex min-h-[150px] items-center justify-center rounded-[0.85rem] border border-slate-100 bg-slate-50 text-sm text-slate-500">-</div>;
  const valueFor = (row: VehiclePerformanceRow) => {
    if (rankingKey === "fuelPercent" || rankingKey === "marginPercent") return formatPercent(row[rankingKey], language);
    if (rankingKey === "lowestRecordedBalance") return formatBaht(row.recordedBalance);
    return formatBaht(row[rankingKey]);
  };
  const secondaryFor = (row: VehiclePerformanceRow) =>
    rankingKey === "recordedBalance" || rankingKey === "lowestRecordedBalance"
      ? `${labels.marginPercent}: ${formatPercent(row.marginPercent, language)}`
      : `${labels.recordedBalance}: ${formatBaht(row.recordedBalance)}`;
  return <div className="space-y-3">{rows.map((row, index) => <div key={row.vehicleRegistration} className="flex items-center justify-between gap-3 rounded-[0.85rem] border border-slate-100 bg-white px-3 py-2"><div className="min-w-0"><button type="button" onClick={() => onView(row.vehicleRegistration)} className="truncate text-sm font-semibold text-brand-700 underline">{index + 1}. {row.vehicleRegistration}</button><p className="text-xs text-slate-500">{secondaryFor(row)}</p></div><span className="shrink-0 text-sm font-bold text-brand-700">{valueFor(row)}</span></div>)}</div>;
}

function MonthlyTrend({
  rows,
  labels,
  language,
  metric,
  monthLabel
}: {
  rows: VehiclePerformanceMonthlyPerformanceRow[];
  labels: ReturnType<typeof useLanguage>["t"]["vehiclePerformance"];
  language: "en" | "th";
  metric: TrendMetric;
  monthLabel: (month: number) => string;
}) {
  if (!rows.length) return <div className="mt-4 flex min-h-[180px] items-center justify-center rounded-[0.85rem] border border-slate-100 bg-slate-50 text-sm text-slate-500">-</div>;
  const metricLabel =
    metric === "grossRevenue" ? labels.revenue :
    metric === "recordedBalance" ? labels.recordedBalance :
    metric === "fuelSpend" ? labels.fuelSpend :
    labels.marginPercent;
  const formatValue = (value: number | null) =>
    value == null
      ? "-"
      : metric === "marginPercent"
        ? formatPercent(value, language)
        : formatBaht(value);
  const points = rows.map((row, index) => ({
    row,
    index,
    value: row.status === "missing" ? null : Number(row[metric] ?? 0)
  }));
  const values = points.map((point) => point.value).filter((value): value is number => value != null && Number.isFinite(value));
  const isMoneyMetric = metric !== "marginPercent";
  const rawMin = values.length ? (isMoneyMetric ? Math.min(...values, 0) : Math.min(...values)) : 0;
  const rawMax = values.length ? Math.max(...values, 1) : 1;
  const padding = Math.max((rawMax - rawMin) * 0.12, metric === "marginPercent" ? 2 : rawMax * 0.04, 1);
  const minValue = isMoneyMetric ? 0 : rawMin - padding;
  const maxValue = rawMax + padding;
  const chart = { width: 720, height: 250, left: 68, right: 28, top: 24, bottom: 46 };
  const plotWidth = chart.width - chart.left - chart.right;
  const plotHeight = chart.height - chart.top - chart.bottom;
  const xFor = (index: number) => chart.left + (rows.length <= 1 ? plotWidth / 2 : (index / (rows.length - 1)) * plotWidth);
  const yFor = (value: number) => chart.top + ((maxValue - value) / Math.max(maxValue - minValue, 1)) * plotHeight;
  const segments: string[][] = [];
  let activeSegment: string[] = [];
  for (const point of points) {
    if (point.value == null) {
      if (activeSegment.length) segments.push(activeSegment);
      activeSegment = [];
      continue;
    }
    const command = `${activeSegment.length ? "L" : "M"} ${xFor(point.index).toFixed(1)} ${yFor(point.value).toFixed(1)}`;
    activeSegment.push(command);
  }
  if (activeSegment.length) segments.push(activeSegment);
  const yTicks = [maxValue, (maxValue + minValue) / 2, minValue];
  return (
    <div className="mt-4 rounded-[0.85rem] border border-slate-100 bg-white p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-sm font-bold text-slate-950">{metricLabel}</p>
        <p className="text-xs font-semibold text-slate-500">Missing months render as gaps</p>
      </div>
      <svg role="img" aria-label={`${metricLabel} monthly line chart`} viewBox={`0 0 ${chart.width} ${chart.height}`} className="h-[270px] w-full">
        <rect x="0" y="0" width={chart.width} height={chart.height} rx="10" className="fill-slate-50" />
        {yTicks.map((tick) => {
          const y = yFor(tick);
          return (
            <g key={tick}>
              <line x1={chart.left} x2={chart.width - chart.right} y1={y} y2={y} className="stroke-slate-200" strokeDasharray="4 4" />
              <text x={chart.left - 10} y={y + 4} textAnchor="end" className="fill-slate-500 text-[11px]">{formatValue(tick)}</text>
            </g>
          );
        })}
        {segments.map((segment, index) => (
          <path key={index} d={segment.join(" ")} fill="none" stroke={metric === "fuelSpend" ? "#d97706" : "#2563eb"} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        ))}
        {points.map((point) => {
          const x = xFor(point.index);
          const hasValue = point.value != null;
          return (
            <g key={point.row.month}>
              <text x={x} y={chart.height - 18} textAnchor="middle" className="fill-slate-500 text-[12px]">{monthLabel(point.row.month)}</text>
              {hasValue ? (
                <circle cx={x} cy={yFor(point.value as number)} r="4.5" className={metric === "fuelSpend" ? "fill-amber-600" : "fill-blue-600"}>
                  <title>{`${monthLabel(point.row.month)}: ${formatValue(point.value)}`}</title>
                </circle>
              ) : (
                <circle cx={x} cy={chart.top + plotHeight / 2} r="4" className="fill-slate-300">
                  <title>{`${monthLabel(point.row.month)}: missing`}</title>
                </circle>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
