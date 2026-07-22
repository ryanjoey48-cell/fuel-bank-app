"use client";

import { AlertTriangle, CheckCircle2, CircleCheck, Copy, Download, History, Pencil, Plus, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EmptyState } from "@/components/empty-state";
import { Header } from "@/components/header";
import {
  deleteWeeklyMileage,
  fetchDrivers,
  fetchOilChangeBaselinesForVehicles,
  fetchOilChangeHistory,
  clearDataReadCache,
  fetchVehicles,
  fetchWeeklyMileage,
  applyOilChangeBaselinesToVehicles,
  saveOilChangeService,
  saveWeeklyMileage
} from "@/lib/data";
import { exportToCsv } from "@/lib/export";
import { applyRequiredValidationMessage, clearValidationMessage } from "@/lib/form-validation";
import { useLanguage } from "@/lib/language-provider";
import { getEffectiveOilChangeIntervalForVehicleType, getOilChangeIntervalForVehicleType } from "@/lib/oil-change-service";
import { supabase } from "@/lib/supabase";
import {
  buildDriverWeeklyComparisons,
  buildOilChangeAlertRows,
  buildWeeklyMileageSummary,
  computeWeeklyMileageByVehicle
} from "@/lib/operations";
import { formatDate, formatNumber } from "@/lib/utils";
import type { Driver, OilChangeBaseline, Vehicle, VehicleServiceLog, WeeklyMileageEntry } from "@/types/database";
import type { OilChangeAlertRow, OilChangeStatus } from "@/lib/operations";

const PAGE_SIZE = 25;
const WEEKLY_MILEAGE_SELECTED_WEEK_KEY = "weekly-mileage-selected-week";
const isValidDateKey = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);
const getStoredWeekEnding = () => {
  if (typeof window === "undefined") return "";
  const stored = window.localStorage.getItem(WEEKLY_MILEAGE_SELECTED_WEEK_KEY) ?? "";
  return isValidDateKey(stored) ? stored : "";
};
const createInitialForm = (weekEnding = "") => ({ id: "", week_ending: weekEnding, driver_id: "", vehicle_reg: "", mileage: "" });
const normalizeReg = (value: unknown) =>
  String(value ?? "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/-/g, "")
    .toUpperCase();
const CURRENT_ODOMETER_BELOW_SERVICE_REASON =
  "Current odometer is lower than the last oil change mileage. Please check mileage data.";

const getServiceLogSortTime = (log: VehicleServiceLog) => {
  const serviceDateTime = log.service_date ? new Date(log.service_date).getTime() : Number.NEGATIVE_INFINITY;
  const createdAtTime = log.created_at ? new Date(log.created_at).getTime() : Number.NEGATIVE_INFINITY;
  return {
    serviceDateTime: Number.isNaN(serviceDateTime) ? Number.NEGATIVE_INFINITY : serviceDateTime,
    createdAtTime: Number.isNaN(createdAtTime) ? Number.NEGATIVE_INFINITY : createdAtTime
  };
};

const compareServiceLogsByLatest = (left: VehicleServiceLog, right: VehicleServiceLog) => {
  const leftTime = getServiceLogSortTime(left);
  const rightTime = getServiceLogSortTime(right);
  const serviceDateDiff = rightTime.serviceDateTime - leftTime.serviceDateTime;
  if (serviceDateDiff !== 0) return serviceDateDiff;
  const createdAtDiff = rightTime.createdAtTime - leftTime.createdAtTime;
  if (createdAtDiff !== 0) return createdAtDiff;
  return String(right.id).localeCompare(String(left.id));
};

type OilActionMode = "set" | "edit" | "mark";
type OilFilter = "all" | "overdue" | "urgent" | "due_soon" | "review_required" | "not_set" | "ok";
type WeeklyMileageUpdateFilter = "all" | "updated_this_week" | "not_updated_this_week";
type OilReportScope = "all" | "overdue" | "urgent_overdue" | "due_soon" | "review_required";
type WeeklyMileageDebugInfo = {
  userEmail: string | null;
  userId: string | null;
  supabaseUrl: string;
  tables: {
    vehicles: string;
    weeklyMileage: string;
    oilChangeBaselines: string;
    serviceHistory: string;
  };
  filters: Record<string, string>;
  rowCounts: Record<string, number | "failed" | null>;
  errors: Record<string, string | null>;
};
type OilServicePdfLanguage = "en" | "th";
type OilServicePdfLogo = {
  dataUrl: string | null;
  height?: number;
  width?: number;
};
type OilServicePdfRow = {
  currentOdometer: string;
  driverName: string;
  lastOilChangeDate: string;
  nextServiceDue: string;
  priorityKm: number;
  serviceDelta: string;
  vehicleReg: string;
  vehicleType: string;
};
type OilServicePdfData = {
  dueSoonRows: OilServicePdfRow[];
  generatedAt: string;
  okCount: string;
  overdueRows: OilServicePdfRow[];
  summary: {
    dueSoon: string;
    ok: string;
    overdue: string;
  };
  weekEnding: string;
};
type LastOilChangesPdfRow = {
  currentOdometer: string;
  currentOdometerDate: string;
  currentOdometerDateTone: "muted" | "stale";
  currentOdometerWarning: string | null;
  driverName: string;
  hasServiceRecord: boolean;
  kmDrivenSinceOilChange: string;
  kmRemaining: string;
  kmRemainingSort: number;
  lastOilChangeDate: string;
  lastOilChangeOdometer: string;
  lastOilChangeTime: number;
  status: OilChangeStatus;
  statusLabel: string;
  vehicleReg: string;
  vehicleType: string;
};
type LastOilChangesPdfData = {
  generatedAt: string;
  rows: LastOilChangesPdfRow[];
  summary: {
    dueSoon: string;
    noRecord: string;
    ok: string;
    overdue: string;
    total: string;
    urgent: string;
  };
};
type OilServicePdfCopy = {
  companyName: string;
  currentOdometer: string;
  driver: string;
  dueSoon: string;
  dueSoonCount: (count: string) => string;
  dueSoonEmpty: string;
  footer: string;
  generated: string;
  generating: string;
  lastOilChange: string;
  nextServiceDue: string;
  ok: string;
  overdue: string;
  overdueBy: string;
  overdueCount: (count: string) => string;
  overdueEmpty: string;
  overdueHeading: string;
  reportTitle: string;
  vehicleReg: string;
  vehicleType: string;
  weekEnding: string;
};
type LastOilChangesPdfCopy = {
  asOf: (date: string) => string;
  companyName: string;
  currentOdometer: string;
  currentStatus: string;
  driverName: string;
  footer: string;
  generated: string;
  kmRemaining: string;
  kmDrivenSinceOilChange: string;
  lastOilChangeDate: string;
  lastOilChangeOdometer: string;
  no: string;
  noCurrentMileage: string;
  noMileage: string;
  noServiceRecord: string;
  notUpdatedThisWeek: string;
  notAvailable: string;
  overdueSuffix: string;
  reportTitle: string;
  mileageNote: string;
  sortingNote: string;
  summaryDueSoon: string;
  summaryNoRecord: string;
  summaryOk: string;
  summaryOverdue: string;
  summaryTotal: string;
  summaryUrgent: string;
  vehicleReg: string;
  vehicleType: string;
};

function describeLoadError(error: unknown) {
  if (!error || typeof error !== "object") {
    return error == null ? null : String(error);
  }

  const record = error as Record<string, unknown>;
  const parts = [
    record.message,
    record.code ? `code=${record.code}` : "",
    record.details ? `details=${record.details}` : "",
    record.hint ? `hint=${record.hint}` : "",
    record.query ? `query=${record.query}` : "",
    record.supabaseError ? `supabase=${JSON.stringify(record.supabaseError)}` : ""
  ]
    .map((part) => String(part ?? "").trim())
    .filter(Boolean);

  return parts.length ? parts.join(" | ") : String(error);
}

const getOilServicePdfCopy = (language: OilServicePdfLanguage): OilServicePdfCopy =>
  language === "th"
    ? {
        companyName: "Expert Express Sender Co., Ltd.",
        currentOdometer: "เลขไมล์ปัจจุบัน",
        driver: "คนขับ",
        dueSoon: "ใกล้ถึงกำหนด",
        dueSoonCount: (count) => `ใกล้ถึงกำหนด ${count} คัน`,
        dueSoonEmpty: "ไม่มีรถที่ใกล้ถึงกำหนดในขณะนี้",
        footer: "สร้างจาก Expert Express Sender Fleet Management",
        generated: "สร้างเมื่อ",
        generating: "กำลังสร้าง PDF...",
        lastOilChange: "เปลี่ยนน้ำมันล่าสุด",
        nextServiceDue: "กำหนดบริการครั้งถัดไป",
        ok: "ปกติ",
        overdue: "เกินกำหนด",
        overdueBy: "เกินกำหนด",
        overdueCount: (count) => `เกินกำหนด ${count} คัน`,
        overdueEmpty: "ไม่มีรถที่เกินกำหนดในขณะนี้",
        overdueHeading: "เกินกำหนด - ต้องดำเนินการทันที",
        reportTitle: "รายงานบริการเปลี่ยนน้ำมันเครื่อง",
        vehicleReg: "ทะเบียนรถ",
        vehicleType: "ประเภทรถ",
        weekEnding: "สัปดาห์สิ้นสุด"
      }
    : {
        companyName: "Expert Express Sender Co., Ltd.",
        currentOdometer: "Current odometer",
        driver: "Driver",
        dueSoon: "Due Soon",
        dueSoonCount: (count) => `${count} vehicles due soon`,
        dueSoonEmpty: "No vehicles are currently due soon.",
        footer: "Generated from Expert Express Sender Fleet Management",
        generated: "Generated",
        generating: "Generating PDF...",
        lastOilChange: "Last oil change",
        nextServiceDue: "Next service due",
        ok: "OK",
        overdue: "Overdue",
        overdueBy: "Overdue by",
        overdueCount: (count) => `${count} vehicles overdue`,
        overdueEmpty: "No vehicles are currently overdue.",
        overdueHeading: "OVERDUE - IMMEDIATE ACTION REQUIRED",
        reportTitle: "Oil Change Service Report",
        vehicleReg: "Vehicle Registration",
        vehicleType: "Vehicle Type",
        weekEnding: "Week Ending"
      };

const getOilServicePdfFontFamily = (language: OilServicePdfLanguage) =>
  language === "th" ? '"OilServicePdfThai", Tahoma, sans-serif' : 'Arial, "Helvetica Neue", Helvetica, sans-serif';

const getLastOilChangesPdfCopy = (language: OilServicePdfLanguage): LastOilChangesPdfCopy =>
  language === "th"
    ? {
        asOf: (date) => `ณ ${date}`,
        companyName: "Expert Express Sender Co., Ltd.",
        currentOdometer: "เลขไมล์ปัจจุบัน",
        currentStatus: "สถานะ",
        driverName: "คนขับ",
        footer: "สร้างจาก Expert Express Sender Fleet Management",
        generated: "สร้างเมื่อ",
        kmDrivenSinceOilChange: "กม. ใช้แล้ว",
        kmRemaining: "กม. คงเหลือ",
        lastOilChangeDate: "เปลี่ยนน้ำมัน",
        lastOilChangeOdometer: "เลขไมล์ตอนเปลี่ยน",
        no: "ลำดับ",
        noCurrentMileage: "ไม่มีเลขไมล์ปัจจุบัน",
        noServiceRecord: "ไม่มีประวัติบริการ",
        notAvailable: "ไม่มีข้อมูล",
        overdueSuffix: "กม. เกินกำหนด",
        reportTitle: "รายงานการเปลี่ยนน้ำมันล่าสุด",
        mileageNote: "เลขไมล์ปัจจุบันและกม. คงเหลืออ้างอิงจาก Weekly Mileage ล่าสุดของรถแต่ละคัน",
        noMileage: "ไม่มีเลขไมล์",
        notUpdatedThisWeek: "ยังไม่อัปเดตสัปดาห์นี้",
        sortingNote: "เรียงรถตามความสำคัญของบริการและกม. คงเหลือ",
        summaryDueSoon: "ใกล้ถึงกำหนด",
        summaryNoRecord: "ไม่มีประวัติ",
        summaryOk: "ปกติ",
        summaryOverdue: "เกินกำหนด",
        summaryTotal: "รถทั้งหมด",
        summaryUrgent: "เร่งด่วน",
        vehicleReg: "ทะเบียนรถ",
        vehicleType: "ประเภทรถ"
      }
    : {
        asOf: (date) => `As of ${date}`,
        companyName: "Expert Express Sender Co., Ltd.",
        currentOdometer: "Current Odo.",
        currentStatus: "Status",
        driverName: "Driver",
        footer: "Generated from Expert Express Sender Fleet Management",
        generated: "Generated",
        kmDrivenSinceOilChange: "KM Used",
        kmRemaining: "KM Remaining",
        lastOilChangeDate: "Oil Changed",
        lastOilChangeOdometer: "Oil Change Odo.",
        mileageNote: "Current odometer values and KM remaining are based on each vehicle's latest Weekly Mileage entry.",
        no: "No.",
        noCurrentMileage: "No current mileage",
        noMileage: "No mileage",
        noServiceRecord: "No Service Record",
        notUpdatedThisWeek: "Not updated this week",
        notAvailable: "Not available",
        overdueSuffix: "KM OVERDUE",
        reportTitle: "Last Oil Change Report",
        sortingNote: "Vehicles are ordered by service priority and KM remaining.",
        summaryDueSoon: "Due Soon",
        summaryNoRecord: "No Record",
        summaryOk: "OK",
        summaryOverdue: "Overdue",
        summaryTotal: "Total Vehicles",
        summaryUrgent: "Urgent",
        vehicleReg: "Vehicle Registration",
        vehicleType: "Vehicle Type"
      };

async function loadOilServicePdfThaiFont() {
  if (typeof document === "undefined" || typeof FontFace === "undefined") return;
  let fontAlreadyLoaded = false;
  document.fonts.forEach((font) => {
    if (font.family === "OilServicePdfThai") fontAlreadyLoaded = true;
  });
  if (fontAlreadyLoaded) return;
  const response = await fetch("/fonts/boss-pdf-thai.ttf");
  if (!response.ok) {
    throw new Error("Unable to load Thai PDF font.");
  }
  const fontData = await response.arrayBuffer();
  const font = new FontFace("OilServicePdfThai", fontData, { style: "normal", weight: "400" });
  await font.load();
  document.fonts.add(font);
  await document.fonts.ready;
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

async function loadOilServicePdfLogo(): Promise<OilServicePdfLogo> {
  if (typeof document === "undefined") return { dataUrl: null };
  try {
    const response = await fetch("/logo.png");
    if (!response.ok) return { dataUrl: null };
    const blob = await response.blob();
    const imageUrl = URL.createObjectURL(blob);
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const nextImage = new Image();
      nextImage.onload = () => resolve(nextImage);
      nextImage.onerror = reject;
      nextImage.src = imageUrl;
    });
    const canvas = document.createElement("canvas");
    const targetHeight = 256;
    const targetWidth = Math.max(1, Math.round((image.width / image.height) * targetHeight));
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const context = canvas.getContext("2d");
    if (!context) return { dataUrl: null };
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, targetWidth, targetHeight);
    context.drawImage(image, 0, 0, targetWidth, targetHeight);
    URL.revokeObjectURL(imageUrl);
    return { dataUrl: canvas.toDataURL("image/png"), height: targetHeight, width: targetWidth };
  } catch (error) {
    console.warn("Oil service PDF logo load failed:", error);
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

async function buildOilServicePdf(data: OilServicePdfData, logo: OilServicePdfLogo, language: OilServicePdfLanguage) {
  if (language === "th") {
    await loadOilServicePdfThaiFont();
  }

  const pageWidth = 595;
  const pageHeight = 842;
  const scale = 2;
  const margin = 38;
  const contentWidth = pageWidth - margin * 2;
  const tableBottom = 774;
  const copy = getOilServicePdfCopy(language);
  const fontFamily = getOilServicePdfFontFamily(language);
  const isThai = language === "th";
  const color = {
    amber: "#92400e",
    amberBg: "#fffbeb",
    amberBorder: "#fcd34d",
    border: "#e2e8f0",
    green: "#047857",
    greenBg: "#ecfdf5",
    greenBorder: "#86efac",
    muted: "#64748b",
    purple: "#5b21b6",
    red: "#b91c1c",
    redBg: "#fff1f2",
    redBorder: "#fecdd3",
    soft: "#f8fafc",
    text: "#0f172a"
  };
  const pageImages: Array<{ data: string; height: number; width: number }> = [];
  let canvas!: HTMLCanvasElement;
  let context!: CanvasRenderingContext2D;
  let pageNumber = 0;
  let y = 0;

  const setFont = (size: number, weight: 400 | 500 | 600 | 700 = 400) => {
    context.font = `${weight} ${size}px ${fontFamily}`;
  };
  const drawText = (
    value: unknown,
    x: number,
    textY: number,
    options: { color?: string; maxWidth?: number; size?: number; weight?: 400 | 500 | 600 | 700 } = {}
  ) => {
    const size = options.size ?? 8;
    setFont(size, options.weight ?? 400);
    context.fillStyle = options.color ?? color.text;
    let textValue = String(value ?? "-").replace(/\s+/g, " ").trim() || "-";
    if (options.maxWidth && context.measureText(textValue).width > options.maxWidth) {
      while (textValue.length > 1 && context.measureText(`${textValue}...`).width > options.maxWidth) {
        textValue = textValue.slice(0, -1);
      }
      textValue = `${textValue}...`;
    }
    context.fillText(textValue, x, textY);
  };
  const fillRect = (x: number, rectY: number, width: number, height: number, fill: string, stroke?: string) => {
    context.fillStyle = fill;
    context.fillRect(x, rectY, width, height);
    if (stroke) {
      context.strokeStyle = stroke;
      context.lineWidth = 1;
      context.strokeRect(x + 0.5, rectY + 0.5, width - 1, height - 1);
    }
  };
  const line = (x1: number, lineY: number, x2: number, stroke = color.border) => {
    context.strokeStyle = stroke;
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(x1, lineY + 0.5);
    context.lineTo(x2, lineY + 0.5);
    context.stroke();
  };
  const drawFooter = () => {
    line(margin, 798, pageWidth - margin);
    drawText(copy.footer, margin, 817, { color: color.muted, maxWidth: contentWidth - 70, size: isThai ? 6.8 : 7.4 });
    drawText(String(pageNumber), pageWidth - margin - 8, 817, { color: color.muted, size: 7, weight: 700 });
  };
  const startPage = async (continuation = false) => {
    pageNumber += 1;
    canvas = document.createElement("canvas");
    canvas.width = pageWidth * scale;
    canvas.height = pageHeight * scale;
    const nextContext = canvas.getContext("2d");
    if (!nextContext) throw new Error("Unable to prepare oil service PDF canvas.");
    context = nextContext;
    context.scale(scale, scale);
    fillRect(0, 0, pageWidth, pageHeight, "#ffffff");
    fillRect(0, 0, 8, pageHeight, color.purple);
    fillRect(0, 0, pageWidth, continuation ? 56 : 72, color.soft);

    if (!continuation && logo.dataUrl) {
      try {
        const logoImage = await loadCanvasImage(logo.dataUrl);
        const logoBox = 34;
        const logoScale = Math.min(logoBox / logoImage.width, logoBox / logoImage.height);
        const logoWidth = logoImage.width * logoScale;
        const logoHeight = logoImage.height * logoScale;
        context.drawImage(logoImage, margin + (logoBox - logoWidth) / 2, 16 + (logoBox - logoHeight) / 2, logoWidth, logoHeight);
      } catch {
        fillRect(margin, 16, 34, 34, "#ede9fe", "#c4b5fd");
        drawText("EES", margin + 8, 37, { color: color.purple, size: 8, weight: 700 });
      }
    } else if (!continuation) {
      fillRect(margin, 16, 34, 34, "#ede9fe", "#c4b5fd");
      drawText("EES", margin + 8, 37, { color: color.purple, size: 8, weight: 700 });
    }

    drawText(copy.companyName, continuation ? margin : 82, continuation ? 23 : 28, {
      size: isThai ? 8 : 9,
      weight: 700
    });
    drawText(copy.reportTitle, continuation ? margin : 82, continuation ? 42 : 49, {
      color: color.purple,
      maxWidth: continuation ? 270 : 285,
      size: isThai ? 12 : 15,
      weight: 700
    });
    drawText(`${copy.generated}: ${data.generatedAt}`, 350, continuation ? 31 : 30, {
      color: color.muted,
      maxWidth: 205,
      size: isThai ? 7 : 7.6,
      weight: 600
    });
    if (!continuation) {
      drawText(`${copy.weekEnding}: ${data.weekEnding}`, 350, 49, {
        color: color.muted,
        maxWidth: 205,
        size: isThai ? 7 : 7.6,
        weight: 600
      });
    }
    y = continuation ? 78 : 94;
  };
  const finishPage = () => {
    drawFooter();
    pageImages.push({
      data: binaryStringFromDataUrl(canvas.toDataURL("image/jpeg", 0.92)),
      height: canvas.height,
      width: canvas.width
    });
  };
  const ensureSpace = async (height: number, continuationHeader?: string) => {
    if (y + height <= tableBottom) return;
    finishPage();
    await startPage(true);
    if (continuationHeader) {
      drawSectionHeading(continuationHeader, color.purple);
    }
  };
  const drawSectionHeading = (title: string, titleColor = color.text) => {
    drawText(title, margin, y, { color: titleColor, maxWidth: contentWidth, size: isThai ? 10 : 11.5, weight: 700 });
    y += 14;
  };
  const drawSummary = () => {
    const gap = 10;
    const cardWidth = (contentWidth - gap * 2) / 3;
    const cards = [
      { bg: color.redBg, border: color.redBorder, label: copy.overdue, text: data.summary.overdue, tone: color.red },
      { bg: color.amberBg, border: color.amberBorder, label: copy.dueSoon, text: data.summary.dueSoon, tone: color.amber },
      { bg: color.greenBg, border: color.greenBorder, label: copy.ok, text: data.summary.ok, tone: color.green }
    ];
    cards.forEach((card, index) => {
      const x = margin + index * (cardWidth + gap);
      fillRect(x, y, cardWidth, 50, card.bg, card.border);
      drawText(card.label, x + 10, y + 16, { color: color.muted, maxWidth: cardWidth - 20, size: isThai ? 7.2 : 8, weight: 700 });
      drawText(card.text, x + 10, y + 39, { color: card.tone, maxWidth: cardWidth - 20, size: isThai ? 16 : 18, weight: 700 });
    });
    y += 72;
  };
  const drawEmpty = async (message: string, sectionTitle: string) => {
    await ensureSpace(34, sectionTitle);
    fillRect(margin, y, contentWidth, 30, "#ffffff", color.border);
    drawText(message, margin + 10, y + 19, { color: color.muted, maxWidth: contentWidth - 20, size: isThai ? 7.4 : 8.2, weight: 600 });
    y += 42;
  };
  const drawVehicleRow = async (
    row: OilServicePdfRow,
    options: { accent: string; bg: string; border: string; deltaLabel: string; sectionTitle: string }
  ) => {
    await ensureSpace(58, options.sectionTitle);
    fillRect(margin, y, contentWidth, 52, options.bg, options.border);
    drawText(row.driverName, margin + 10, y + 16, {
      color: color.text,
      maxWidth: 145,
      size: isThai ? 8.8 : 9.6,
      weight: 700
    });
    drawText(`${copy.vehicleReg}: ${row.vehicleReg}`, margin + 10, y + 34, {
      color: color.muted,
      maxWidth: 145,
      size: isThai ? 6.7 : 7.5,
      weight: 700
    });
    drawText(`${copy.vehicleType}: ${row.vehicleType}`, margin + 10, y + 46, {
      color: color.muted,
      maxWidth: 145,
      size: isThai ? 6.5 : 7.2
    });

    const detailX = margin + 170;
    const detailWidth = contentWidth - 180;
    const details = [
      [`${copy.currentOdometer}:`, row.currentOdometer],
      [`${copy.nextServiceDue}:`, row.nextServiceDue],
      [`${options.deltaLabel}:`, row.serviceDelta],
      [`${copy.lastOilChange}:`, row.lastOilChangeDate]
    ];
    details.forEach(([label, value], index) => {
      const rowX = detailX + (index % 2) * 175;
      const rowY = y + 17 + Math.floor(index / 2) * 22;
      drawText(label, rowX, rowY, { color: color.muted, maxWidth: 78, size: isThai ? 6.4 : 7, weight: 700 });
      drawText(value, rowX + 83, rowY, {
        color: index === 2 ? options.accent : color.text,
        maxWidth: detailWidth / 2 - 88,
        size: isThai ? 7.1 : 7.8,
        weight: 700
      });
    });
    y += 60;
  };
  const drawDetailedSection = async (
    title: string,
    countText: string,
    rows: OilServicePdfRow[],
    emptyText: string,
    options: { accent: string; bg: string; border: string; deltaLabel: string }
  ) => {
    await ensureSpace(72, title);
    drawSectionHeading(title, options.accent);
    drawText(countText, margin, y, { color: color.muted, maxWidth: contentWidth, size: isThai ? 7.3 : 8.1, weight: 700 });
    y += 16;

    if (!rows.length) {
      await drawEmpty(emptyText, title);
      return;
    }

    for (const row of rows) {
      await drawVehicleRow(row, { ...options, sectionTitle: title });
    }
    y += 6;
  };

  await startPage(false);
  drawSummary();
  await drawDetailedSection(copy.overdueHeading, copy.overdueCount(data.summary.overdue), data.overdueRows, copy.overdueEmpty, {
    accent: color.red,
    bg: color.redBg,
    border: color.redBorder,
    deltaLabel: copy.overdueBy
  });
  await drawDetailedSection(copy.dueSoon, copy.dueSoonCount(data.summary.dueSoon), data.dueSoonRows, copy.dueSoonEmpty, {
    accent: color.amber,
    bg: color.amberBg,
    border: color.amberBorder,
    deltaLabel: language === "th" ? "เหลืออีก" : "KM remaining"
  });
  finishPage();

  return buildImagePagesPdf(pageImages);
}

async function buildLastOilChangesPdf(data: LastOilChangesPdfData, logo: OilServicePdfLogo, language: OilServicePdfLanguage) {
  if (language === "th") {
    await loadOilServicePdfThaiFont();
  }

  const pageWidth = 842;
  const pageHeight = 595;
  const scale = 2;
  const margin = 16;
  const contentWidth = pageWidth - margin * 2;
  const tableBottom = 552;
  const copy = getLastOilChangesPdfCopy(language);
  const fontFamily = getOilServicePdfFontFamily(language);
  const isThai = language === "th";
  const color = {
    amber: "#92400e",
    amberBg: "#fffbeb",
    border: "#dbe3ef",
    green: "#047857",
    greenBg: "#ecfdf5",
    header: "#eef2f7",
    muted: "#64748b",
    orange: "#c2410c",
    orangeBg: "#fff7ed",
    red: "#b91c1c",
    redBg: "#fff1f2",
    sky: "#0369a1",
    skyBg: "#eff6ff",
    slateBg: "#f8fafc",
    text: "#0f172a"
  };
  const pageImages: Array<{ data: string; height: number; width: number }> = [];
  let canvas!: HTMLCanvasElement;
  let context!: CanvasRenderingContext2D;
  let pageNumber = 0;
  let y = 0;

  const columns = [
    { key: "no", label: copy.no, width: 28 },
    { key: "vehicleReg", label: copy.vehicleReg, width: 86 },
    { key: "driverName", label: copy.driverName, width: 94 },
    { key: "vehicleType", label: copy.vehicleType, width: 86 },
    { key: "lastOilChangeDate", label: copy.lastOilChangeDate, width: 72 },
    { key: "lastOilChangeOdometer", label: copy.lastOilChangeOdometer, width: 82 },
    { key: "currentOdometer", label: copy.currentOdometer, width: 88 },
    { key: "kmDrivenSinceOilChange", label: copy.kmDrivenSinceOilChange, width: 72 },
    { key: "kmRemaining", label: copy.kmRemaining, width: 92 },
    { key: "statusLabel", label: copy.currentStatus, width: 110 }
  ] as const;

  const setFont = (size: number, weight: 400 | 500 | 600 | 700 = 400) => {
    context.font = `${weight} ${size}px ${fontFamily}`;
  };
  const wrapText = (value: unknown, maxWidth: number, size: number, weight: 400 | 500 | 600 | 700, maxLines: number) => {
    setFont(size, weight);
    const text = String(value ?? "-").replace(/\s+/g, " ").trim() || "-";
    const words = text.split(" ");
    const lines: string[] = [];
    let current = "";
    const pushBrokenWord = (word: string) => {
      let chunk = "";
      for (const character of Array.from(word)) {
        const nextChunk = `${chunk}${character}`;
        if (chunk && context.measureText(nextChunk).width > maxWidth) {
          lines.push(chunk);
          chunk = character;
        } else {
          chunk = nextChunk;
        }
      }
      current = chunk;
    };

    for (const word of words) {
      if (!current) {
        if (context.measureText(word).width <= maxWidth) {
          current = word;
        } else {
          pushBrokenWord(word);
        }
        continue;
      }
      const candidate = `${current} ${word}`;
      if (context.measureText(candidate).width <= maxWidth) {
        current = candidate;
      } else {
        lines.push(current);
        if (context.measureText(word).width <= maxWidth) {
          current = word;
        } else {
          pushBrokenWord(word);
        }
      }
    }
    if (current) lines.push(current);
    return lines.slice(0, maxLines);
  };
  const getCellLines = (
    value: unknown,
    maxWidth: number,
    options: { maxLines?: number; minSize?: number; size: number; weight?: 400 | 500 | 600 | 700 }
  ) => {
    const maxLines = options.maxLines ?? 1;
    const minSize = options.minSize ?? 5.2;
    const weight = options.weight ?? 400;
    for (let size = options.size; size >= minSize; size -= 0.2) {
      const lines = wrapText(value, maxWidth, size, weight, maxLines);
      if (lines.length <= maxLines && lines.every((lineText) => context.measureText(lineText).width <= maxWidth)) {
        return { lines, size };
      }
    }
    return { lines: wrapText(value, maxWidth, minSize, weight, maxLines), size: minSize };
  };
  const drawText = (
    value: unknown,
    x: number,
    textY: number,
    options: { align?: CanvasTextAlign; color?: string; size?: number; weight?: 400 | 500 | 600 | 700 } = {}
  ) => {
    const size = options.size ?? 7;
    const weight = options.weight ?? 400;
    setFont(size, weight);
    context.textAlign = options.align ?? "left";
    context.fillStyle = options.color ?? color.text;
    context.fillText(String(value ?? "-"), x, textY);
    context.textAlign = "left";
  };
  const drawCellText = (
    value: unknown,
    x: number,
    cellY: number,
    width: number,
    height: number,
    options: { align?: CanvasTextAlign; color?: string; maxLines?: number; minSize?: number; padding?: number; size?: number; weight?: 400 | 500 | 600 | 700 } = {}
  ) => {
    const padding = options.padding ?? 4;
    const size = options.size ?? 6.4;
    const weight = options.weight ?? 400;
    const maxWidth = width - padding * 2;
    const { lines, size: fittedSize } = getCellLines(value, maxWidth, {
      maxLines: options.maxLines ?? 1,
      minSize: options.minSize,
      size,
      weight
    });
    const lineHeight = fittedSize + 1.5;
    const blockHeight = lineHeight * lines.length;
    let textY = cellY + (height - blockHeight) / 2 + fittedSize;
    const align = options.align ?? "left";
    const textX = align === "right" ? x + width - padding : align === "center" ? x + width / 2 : x + padding;
    setFont(fittedSize, weight);
    context.textAlign = align;
    context.fillStyle = options.color ?? color.text;
    for (const lineText of lines) {
      context.fillText(lineText, textX, textY);
      textY += lineHeight;
    }
    context.textAlign = "left";
  };
  const drawCurrentOdometerCell = (row: LastOilChangesPdfRow, x: number, cellY: number, width: number, height: number) => {
    const padding = 4;
    const textX = x + padding;
    const mainSize = isThai ? 5.7 : 6.2;
    const subSize = isThai ? 4.8 : 5.1;
    const warningSize = isThai ? 4.5 : 4.7;
    const hasWarning = Boolean(row.currentOdometerWarning);
    const totalHeight = hasWarning ? 16.2 : 12.2;
    let textY = cellY + (height - totalHeight) / 2 + mainSize;

    setFont(mainSize, 700);
    context.fillStyle = color.text;
    context.textAlign = "left";
    context.fillText(getCellLines(row.currentOdometer, width - padding * 2, { maxLines: 1, minSize: 5.1, size: mainSize, weight: 700 }).lines[0] ?? "-", textX, textY);

    textY += subSize + 1.5;
    setFont(subSize, 600);
    context.fillStyle = row.currentOdometerDateTone === "stale" ? color.amber : color.muted;
    context.fillText(getCellLines(row.currentOdometerDate, width - padding * 2, { maxLines: 1, minSize: 4.4, size: subSize, weight: 600 }).lines[0] ?? "-", textX, textY);

    if (row.currentOdometerWarning) {
      textY += warningSize + 0.9;
      setFont(warningSize, 700);
      context.fillStyle = color.amber;
      context.fillText(getCellLines(row.currentOdometerWarning, width - padding * 2, { maxLines: 1, minSize: 4.1, size: warningSize, weight: 700 }).lines[0] ?? "", textX, textY);
    }
    context.textAlign = "left";
  };
  const fillRect = (x: number, rectY: number, width: number, height: number, fill: string, stroke?: string) => {
    context.fillStyle = fill;
    context.fillRect(x, rectY, width, height);
    if (stroke) {
      context.strokeStyle = stroke;
      context.lineWidth = 1;
      context.strokeRect(x + 0.5, rectY + 0.5, width - 1, height - 1);
    }
  };
  const line = (x1: number, lineY: number, x2: number, stroke = color.border) => {
    context.strokeStyle = stroke;
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(x1, lineY + 0.5);
    context.lineTo(x2, lineY + 0.5);
    context.stroke();
  };
  const vLine = (lineX: number, y1: number, y2: number, stroke = color.border) => {
    context.strokeStyle = stroke;
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(lineX + 0.5, y1);
    context.lineTo(lineX + 0.5, y2);
    context.stroke();
  };
  const statusTone = (row: LastOilChangesPdfRow) => {
    if (!row.hasServiceRecord) return { bg: color.slateBg, text: color.muted };
    if (row.status === "overdue") return { bg: color.redBg, text: color.red };
    if (row.status === "urgent") return { bg: color.orangeBg, text: color.orange };
    if (row.status === "due_soon") return { bg: color.amberBg, text: color.amber };
    if (row.status === "review_required" || row.status === "no_odometer" || row.status === "not_set") {
      return { bg: color.skyBg, text: color.sky };
    }
    return { bg: color.greenBg, text: color.green };
  };
  const drawFooter = () => {
    line(margin, 570, pageWidth - margin);
    drawCellText(copy.mileageNote, margin, 571, contentWidth - 70, 8, { color: color.muted, maxLines: 1, size: isThai ? 5.1 : 5.5, weight: 600 });
    drawCellText(copy.footer, margin, 579, contentWidth - 70, 8, { color: color.muted, maxLines: 1, size: isThai ? 5.1 : 5.5 });
    drawText(String(pageNumber), pageWidth - margin - 6, 583, { align: "right", color: color.muted, size: 6.8, weight: 700 });
  };
  const drawTableHeader = () => {
    let x = margin;
    const headerHeight = 24;
    fillRect(margin, y, contentWidth, headerHeight, color.header, color.border);
    columns.forEach((column) => {
      drawCellText(column.label, x, y, column.width, headerHeight, {
        align: column.key === "no" ? "center" : "left",
        color: color.text,
        maxLines: 2,
        minSize: 5.6,
        size: isThai ? 6 : 6.8,
        weight: 700
      });
      x += column.width;
      if (x < pageWidth - margin) vLine(x, y, y + headerHeight, color.border);
    });
    y += headerHeight;
  };
  const startPage = async (continuation = false) => {
    pageNumber += 1;
    canvas = document.createElement("canvas");
    canvas.width = pageWidth * scale;
    canvas.height = pageHeight * scale;
    const nextContext = canvas.getContext("2d");
    if (!nextContext) throw new Error("Unable to prepare last oil changes PDF canvas.");
    context = nextContext;
    context.scale(scale, scale);
    fillRect(0, 0, pageWidth, pageHeight, "#ffffff");
    fillRect(0, 0, pageWidth, continuation ? 54 : 82, color.slateBg);

    if (!continuation && logo.dataUrl) {
      try {
        const logoImage = await loadCanvasImage(logo.dataUrl);
        const logoHeight = 58;
        const logoWidth = Math.min(88, (logoImage.width / logoImage.height) * logoHeight);
        context.drawImage(logoImage, margin, 10, logoWidth, logoHeight);
      } catch {
        fillRect(margin, 10, 58, 58, "#ffffff", color.border);
        drawText("EES", margin + 15, 44, { color: color.text, size: 11, weight: 700 });
      }
    } else if (!continuation) {
      fillRect(margin, 10, 58, 58, "#ffffff", color.border);
      drawText("EES", margin + 15, 44, { color: color.text, size: 11, weight: 700 });
    }

    drawCellText(copy.companyName, continuation ? margin : 116, continuation ? 10 : 12, continuation ? 320 : 330, 16, {
      maxLines: 1,
      size: isThai ? 8 : 9,
      weight: 700
    });
    drawCellText(copy.reportTitle, continuation ? margin : 116, continuation ? 27 : 29, continuation ? 360 : 330, 20, {
      color: color.text,
      maxLines: 1,
      size: isThai ? 13 : 16,
      weight: 700
    });
    if (!continuation) {
      drawCellText(copy.sortingNote, 116, 52, 430, 14, {
        color: color.muted,
        maxLines: 1,
        size: isThai ? 6.3 : 6.8,
        weight: 600
      });
    }
    drawCellText(`${copy.generated}: ${data.generatedAt}`, pageWidth - margin - 260, continuation ? 20 : 22, 260, 18, {
      align: "right",
      color: color.muted,
      maxLines: 1,
      size: isThai ? 6.8 : 7.4,
      weight: 600
    });

    if (!continuation) {
      const cards = [
        [copy.summaryTotal, data.summary.total, color.text],
        [copy.summaryOverdue, data.summary.overdue, color.red],
        [copy.summaryUrgent, data.summary.urgent, color.orange],
        [copy.summaryDueSoon, data.summary.dueSoon, color.amber],
        [copy.summaryNoRecord, data.summary.noRecord, color.muted],
        [copy.summaryOk, data.summary.ok, color.green]
      ];
      const cardGap = 8;
      const cardWidth = (contentWidth - cardGap * (cards.length - 1)) / cards.length;
      cards.forEach(([label, value, tone], index) => {
        const cardX = margin + index * (cardWidth + cardGap);
        fillRect(cardX, 82, cardWidth, 28, "#ffffff", color.border);
        drawCellText(label, cardX + 5, 85, cardWidth - 10, 8, { color: color.muted, maxLines: 1, padding: 0, size: isThai ? 5.5 : 6, weight: 700 });
        drawCellText(value, cardX + 5, 94, cardWidth - 10, 13, { color: tone, maxLines: 1, padding: 0, size: 12.5, weight: 700 });
      });
      y = 118;
    } else {
      y = 68;
    }
    drawTableHeader();
  };
  const finishPage = () => {
    drawFooter();
    pageImages.push({
      data: binaryStringFromDataUrl(canvas.toDataURL("image/jpeg", 0.92)),
      height: canvas.height,
      width: canvas.width
    });
  };
  const ensureRowSpace = async () => {
    if (y + 18 <= tableBottom) return;
    finishPage();
    await startPage(true);
  };
  const drawRow = async (row: LastOilChangesPdfRow, index: number) => {
    await ensureRowSpace();
    const rowHeight = 18;
    const bg = index % 2 === 0 ? "#ffffff" : "#fbfdff";
    fillRect(margin, y, contentWidth, rowHeight, bg, color.border);
    const tone = statusTone(row);
    const rowValues = [
      String(index + 1),
      row.vehicleReg,
      row.driverName,
      row.vehicleType,
      row.lastOilChangeDate,
      row.lastOilChangeOdometer,
      row.currentOdometer,
      row.kmDrivenSinceOilChange,
      row.kmRemaining,
      row.statusLabel
    ];
    let x = margin;
    columns.forEach((column, columnIndex) => {
      if (column.key === "statusLabel") {
        fillRect(x + 3, y + 3, column.width - 6, rowHeight - 6, tone.bg);
      }
      if (column.key === "currentOdometer") {
        drawCurrentOdometerCell(row, x, y, column.width, rowHeight);
      } else {
        drawCellText(rowValues[columnIndex], x, y, column.width, rowHeight, {
          align: column.key === "no" ? "center" : "left",
          color: column.key === "statusLabel" || column.key === "kmRemaining" ? tone.text : color.text,
          maxLines: column.key === "driverName" || column.key === "vehicleType" || column.key === "statusLabel" ? 2 : 1,
          minSize: 5.1,
          size: columnIndex === 0 ? 6.2 : isThai ? 5.7 : 6.2,
          weight: columnIndex === 1 || column.key === "statusLabel" || column.key === "kmRemaining" ? 700 : 500
        });
      }
      x += column.width;
      if (x < pageWidth - margin) vLine(x, y, y + rowHeight, color.border);
    });
    y += rowHeight;
  };

  await startPage(false);
  for (let index = 0; index < data.rows.length; index += 1) {
    await drawRow(data.rows[index], index);
  }
  finishPage();

  return buildImagePagesPdf(pageImages, { height: pageHeight, width: pageWidth });
}

export default function WeeklyMileagePage() {
  const { language, t } = useLanguage();
  const driverSelectRef = useRef<HTMLSelectElement | null>(null);
  const odometerInputRef = useRef<HTMLInputElement | null>(null);
  const vehicleInputRef = useRef<HTMLInputElement | null>(null);
  const submitActionRef = useRef<"save" | "next">("save");
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [oilChangeBaselines, setOilChangeBaselines] = useState<OilChangeBaseline[]>([]);
  const [serviceLogs, setServiceLogs] = useState<VehicleServiceLog[]>([]);
  const [entries, setEntries] = useState<WeeklyMileageEntry[]>([]);
  const [form, setForm] = useState(() => createInitialForm());
  const [multiEntryMode, setMultiEntryMode] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generatingOilServicePdf, setGeneratingOilServicePdf] = useState(false);
  const [generatingLastOilChangesPdf, setGeneratingLastOilChangesPdf] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [savingService, setSavingService] = useState(false);
  const [oilFilter, setOilFilter] = useState<OilFilter>("all");
  const [weeklyMileageUpdateFilter, setWeeklyMileageUpdateFilter] = useState<WeeklyMileageUpdateFilter>("all");
  const [serviceModal, setServiceModal] = useState<{
    mode: OilActionMode;
    vehicleId: string | null;
    registration: string;
    vehicleName: string;
    vehicleType: string | null;
    currentOdometer: number | null;
    serviceLogId?: string | null;
  } | null>(null);
  const [serviceForm, setServiceForm] = useState({
    serviceDate: "",
    serviceOdometer: "",
    intervalKm: "",
    notes: ""
  });
  const [historyVehicleReg, setHistoryVehicleReg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [assignmentLoadError, setAssignmentLoadError] = useState<string | null>(null);
  const [oilBaselineError, setOilBaselineError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [selectedWeek, setSelectedWeek] = useState("");
  const [comparisonDriverId, setComparisonDriverId] = useState("");
  const [tablePage, setTablePage] = useState(1);
  const [debugInfo, setDebugInfo] = useState<WeeklyMileageDebugInfo | null>(null);
  const isEditing = Boolean(form.id);
  const showWeeklyMileageDebug = process.env.NEXT_PUBLIC_SHOW_DEBUG === "true";
  const fastEntryCopy = language === "th"
    ? {
        multiEntryMode: "กรอกหลายคนขับสำหรับสัปดาห์นี้",
        dateWillRemain: "วันที่จะคงเป็น {date} สำหรับรายการถัดไป",
        saveAndAddNext: "บันทึกและเพิ่มคนขับถัดไป",
        duplicateWarning: "มีรายการระยะทางรายสัปดาห์ของ {driver} วันที่ {date} แล้ว กรุณาแก้ไขรายการเดิมแทนการสร้างซ้ำ",
        saveSuccessForDriver: "บันทึกระยะทางรายสัปดาห์ของ {driver} - {date} แล้ว"
      }
    : {
        multiEntryMode: "Enter multiple drivers for this week",
        dateWillRemain: "Date will remain as {date} for the next entry.",
        saveAndAddNext: "Save & add next driver",
        duplicateWarning: "A weekly mileage entry already exists for {driver} on {date}. Edit the existing record instead of creating a duplicate.",
        saveSuccessForDriver: "Weekly mileage saved for {driver} - {date}."
      };
  const assignmentCopy = useMemo(
    () =>
      language === "th"
        ? {
            selectVehicle: "เลือกรถ",
            searchRegistration: "ค้นหาทะเบียนรถ",
            noDriverAssigned: "ยังไม่มีคนขับที่ผูกกับรถคันนี้",
            assignmentMismatch: "คนขับและรถไม่ตรงกับการผูกประจำ",
            multipleDriversAssigned: "มีคนขับหลายคนผูกกับรถคันนี้ กรุณาเลือกคนขับ",
            unableToLoadAssignments: "ไม่สามารถโหลดข้อมูลการผูกคนขับและรถได้",
            manualVehicleEntry: "พิมพ์ทะเบียนรถเองได้ หากรถยังไม่มีในรายการ",
            vehicleType: "ประเภทรถ"
          }
        : {
            selectVehicle: "Select vehicle",
            searchRegistration: "Search registration",
            noDriverAssigned: "No driver is currently assigned to this vehicle.",
            assignmentMismatch: "Driver and vehicle differ from the normal assignment.",
            multipleDriversAssigned: "Multiple drivers are assigned to this vehicle. Please select one.",
            unableToLoadAssignments: "Unable to load driver and vehicle assignments.",
            manualVehicleEntry: "Manual registration entry is still available when needed.",
            vehicleType: "Vehicle type"
          },
    [language]
  );

  const selectedDriver = useMemo(
    () => drivers.find((driver) => String(driver.id) === String(form.driver_id)),
    [drivers, form.driver_id]
  );

  const activeVehicles = useMemo(
    () =>
      vehicles
        .filter((vehicle) => vehicle.active !== false)
        .filter((vehicle) => normalizeReg(vehicle.vehicle_reg || vehicle.registration))
        .sort((left, right) =>
          String(left.vehicle_reg || left.registration || "").localeCompare(String(right.vehicle_reg || right.registration || ""))
        ),
    [vehicles]
  );
  const vehiclesById = useMemo(
    () => new Map(activeVehicles.map((vehicle) => [String(vehicle.id), vehicle])),
    [activeVehicles]
  );
  const vehiclesByReg = useMemo(() => {
    const map = new Map<string, Vehicle>();
    for (const vehicle of activeVehicles) {
      const key = normalizeReg(vehicle.vehicle_reg || vehicle.registration);
      if (key && !map.has(key)) {
        map.set(key, vehicle);
      }
    }
    return map;
  }, [activeVehicles]);
  const getAssignedVehicleForDriver = useCallback(
    (driver: Driver | undefined) => {
      if (!driver) return null;
      if (driver.assigned_vehicle_id) {
        const assignedVehicle = vehiclesById.get(String(driver.assigned_vehicle_id));
        if (assignedVehicle) return assignedVehicle;
      }
      const fallbackKey = normalizeReg(driver.vehicle_reg);
      return fallbackKey ? vehiclesByReg.get(fallbackKey) ?? null : null;
    },
    [vehiclesById, vehiclesByReg]
  );
  const getAssignedVehicleRegForDriver = useCallback(
    (driver: Driver | undefined) => {
      const assignedVehicle = getAssignedVehicleForDriver(driver);
      return assignedVehicle?.vehicle_reg || assignedVehicle?.registration || driver?.vehicle_reg || "";
    },
    [getAssignedVehicleForDriver]
  );
  const selectedVehicle = useMemo(
    () => vehiclesByReg.get(normalizeReg(form.vehicle_reg)) ?? null,
    [form.vehicle_reg, vehiclesByReg]
  );
  const assignedDriversForSelectedVehicle = useMemo(() => {
    const vehicleKey = normalizeReg(form.vehicle_reg);
    if (!vehicleKey) return [];
    return drivers.filter((driver) => {
      if (driver.active === false) return false;
      if (selectedVehicle?.id && driver.assigned_vehicle_id) {
        return String(driver.assigned_vehicle_id) === String(selectedVehicle.id);
      }
      if (driver.assigned_vehicle_id) return false;
      return normalizeReg(driver.vehicle_reg) === vehicleKey;
    });
  }, [drivers, form.vehicle_reg, selectedVehicle]);
  const selectedDriverAssignedVehicleReg = getAssignedVehicleRegForDriver(selectedDriver);
  const hasManualAssignmentMismatch =
    Boolean(selectedDriver && form.vehicle_reg && selectedDriverAssignedVehicleReg) &&
    normalizeReg(selectedDriverAssignedVehicleReg) !== normalizeReg(form.vehicle_reg);
  const showNoAssignedDriver =
    Boolean(form.vehicle_reg && selectedVehicle && !form.driver_id && assignedDriversForSelectedVehicle.length === 0);
  const showMultipleAssignedDrivers =
    Boolean(form.vehicle_reg && !form.driver_id && assignedDriversForSelectedVehicle.length > 1);

  useEffect(() => {
    const storedWeekEnding = getStoredWeekEnding();
    if (storedWeekEnding) {
      setForm((current) => (current.week_ending ? current : { ...current, week_ending: storedWeekEnding }));
    }
  }, []);

  const sortedEntries = useMemo(
    () =>
      [...entries].sort((a, b) => {
        const dateDiff = new Date(b.week_ending).getTime() - new Date(a.week_ending).getTime();
        if (dateDiff !== 0) return dateDiff;
        return String(b.id).localeCompare(String(a.id));
      }),
    [entries]
  );

  const weeklyVehicleRows = useMemo(() => computeWeeklyMileageByVehicle(sortedEntries), [sortedEntries]);
  const weeklySummaryRows = useMemo(() => buildWeeklyMileageSummary(sortedEntries), [sortedEntries]);
  const driverComparisonRows = useMemo(
    () => buildDriverWeeklyComparisons(sortedEntries),
    [sortedEntries]
  );
  const oilChangeRows = useMemo(() => {
    const hasReal701Mileage = sortedEntries.some((entry) => normalizeReg(entry.vehicle_reg) === "7015145");
    const latestServiceByVehicle = new Map<string, VehicleServiceLog>();

    for (const log of serviceLogs) {
      const key = normalizeReg(log.vehicle_reg);
      if (!key) continue;
      const existing = latestServiceByVehicle.get(key);
      if (!existing || compareServiceLogsByLatest(log, existing) < 0) {
        latestServiceByVehicle.set(key, log);
      }
    }

    const vehiclesWithBaselines = applyOilChangeBaselinesToVehicles(vehicles, oilChangeBaselines)
      .map((vehicle) => {
        const key = normalizeReg(vehicle.vehicle_reg || vehicle.registration);
        const latestLog = latestServiceByVehicle.get(key);

        if (!latestLog) {
          return vehicle;
        }

        const oilChangeOdometer = Number(latestLog.oil_change_odometer ?? latestLog.odometer);
        const intervalKm = Number(latestLog.interval_km);

        return {
          ...vehicle,
          vehicle_reg: vehicle.vehicle_reg || latestLog.vehicle_reg,
          registration: vehicle.registration || latestLog.vehicle_reg,
          vehicle_type: vehicle.vehicle_type || latestLog.vehicle_type_snapshot || null,
          last_oil_change_date: latestLog.service_date || vehicle.last_oil_change_date,
          last_oil_change_odometer: Number.isFinite(oilChangeOdometer)
            ? Math.trunc(oilChangeOdometer)
            : vehicle.last_oil_change_odometer,
          oil_change_interval_km: Number.isFinite(intervalKm) && intervalKm > 0
            ? Math.trunc(intervalKm)
            : vehicle.oil_change_interval_km
        };
      })
      .filter((vehicle) => !(hasReal701Mileage && normalizeReg(vehicle.vehicle_reg || vehicle.registration) === "12345"));

    return buildOilChangeAlertRows({ vehicles: vehiclesWithBaselines, weeklyMileage: sortedEntries, drivers });
  }, [drivers, oilChangeBaselines, serviceLogs, sortedEntries, vehicles]);
  const oilSummary = useMemo(
    () => ({
      overdue: oilChangeRows.filter((row) => row.status === "overdue").length,
      urgent: oilChangeRows.filter((row) => row.status === "urgent").length,
      due_soon: oilChangeRows.filter((row) => row.status === "due_soon").length,
      ok: oilChangeRows.filter((row) => row.status === "ok").length,
      not_set: oilChangeRows.filter((row) => row.status === "not_set").length,
      review_required: oilChangeRows.filter((row) => row.status === "review_required").length
    }),
    [oilChangeRows]
  );
  const oilReportSummary = useMemo(
    () => ({
      overdue: oilChangeRows.filter((row) => row.status === "overdue").length,
      urgent: oilChangeRows.filter((row) => row.status === "urgent").length,
      dueSoon: oilChangeRows.filter((row) => row.status === "due_soon").length,
      reviewRequired: oilChangeRows.filter((row) => row.status === "review_required" || row.status === "not_set" || row.status === "no_odometer").length,
      ok: oilChangeRows.filter((row) => row.status === "ok").length
    }),
    [oilChangeRows]
  );
  const weeklyMileageUpdateSummary = useMemo(
    () => ({
      total: oilChangeRows.length,
      updatedThisWeek: oilChangeRows.filter(
        (row) => row.lastWeeklyMileageDate && row.weeklyMileageUpdatedThisWeek
      ).length,
      notUpdatedThisWeek: oilChangeRows.filter(
        (row) => row.lastWeeklyMileageDate && !row.weeklyMileageUpdatedThisWeek
      ).length
    }),
    [oilChangeRows]
  );
  const filteredOilChangeRows = useMemo(
    () => {
      const statusFilteredRows =
        oilFilter === "all"
          ? oilChangeRows
          : oilChangeRows.filter((row) => row.status === oilFilter);

      if (weeklyMileageUpdateFilter === "updated_this_week") {
        return statusFilteredRows.filter(
          (row) => row.lastWeeklyMileageDate && row.weeklyMileageUpdatedThisWeek
        );
      }

      if (weeklyMileageUpdateFilter === "not_updated_this_week") {
        return statusFilteredRows.filter(
          (row) => row.lastWeeklyMileageDate && !row.weeklyMileageUpdatedThisWeek
        );
      }

      return statusFilteredRows;
    },
    [oilChangeRows, oilFilter, weeklyMileageUpdateFilter]
  );
  const serviceLogsByVehicle = useMemo(() => {
    const map = new Map<string, VehicleServiceLog[]>();
    for (const log of serviceLogs) {
      const key = normalizeReg(log.vehicle_reg);
      if (!key) continue;
      map.set(key, [...(map.get(key) ?? []), log]);
    }
    for (const [key, logs] of map.entries()) {
      map.set(key, [...logs].sort(compareServiceLogsByLatest));
    }
    return map;
  }, [serviceLogs]);

  const availableWeeks = useMemo(
    () => Array.from(new Set(sortedEntries.map((entry) => entry.week_ending))),
    [sortedEntries]
  );
  const selectedWeekValue = selectedWeek || availableWeeks[0] || "";
  const selectedWeekEntries = useMemo(
    () => sortedEntries.filter((entry) => entry.week_ending === selectedWeekValue),
    [selectedWeekValue, sortedEntries]
  );
  const selectedWeekSummary =
    weeklySummaryRows.find((row) => row.weekEnding === selectedWeekValue) ?? weeklySummaryRows[0] ?? null;
  const selectedWeekTotalPages = Math.max(1, Math.ceil(selectedWeekEntries.length / PAGE_SIZE));
  const pagedEntries = useMemo(() => {
    const safePage = Math.min(tablePage, selectedWeekTotalPages);
    const startIndex = (safePage - 1) * PAGE_SIZE;
    return selectedWeekEntries.slice(startIndex, startIndex + PAGE_SIZE);
  }, [selectedWeekEntries, selectedWeekTotalPages, tablePage]);
  const selectedWeekIndex = availableWeeks.findIndex((week) => week === selectedWeekValue);
  const previousWeekValue =
    selectedWeekIndex >= 0 && selectedWeekIndex < availableWeeks.length - 1
      ? availableWeeks[selectedWeekIndex + 1]
      : null;
  const nextWeekValue = selectedWeekIndex > 0 ? availableWeeks[selectedWeekIndex - 1] : null;

  const comparisonDrivers = useMemo(
    () =>
      drivers
        .filter((driver) =>
          driverComparisonRows.some((row) => String(row.driverId) === String(driver.id))
        )
        .sort((a, b) => a.name.localeCompare(b.name)),
    [driverComparisonRows, drivers]
  );
  const weeklyDistanceByDriverRows = useMemo(
    () =>
      driverComparisonRows
        .filter((row) => row.latestWeekEnding === selectedWeekValue)
        .filter((row) => row.previousWeekEnding && row.weeklyDistance != null)
        .sort((a, b) => Number(b.weeklyDistance) - Number(a.weeklyDistance)),
    [driverComparisonRows, selectedWeekValue]
  );
  const selectedComparison = useMemo(
    () =>
      comparisonDriverId
        ? driverComparisonRows.find((row) => String(row.driverId) === String(comparisonDriverId)) ?? null
        : null,
    [comparisonDriverId, driverComparisonRows]
  );
  const selectedComparisonHistory = selectedComparison?.history.slice(0, 5) ?? [];

  const previousVehicleEntry = useMemo(() => {
    if (!form.vehicle_reg || !form.week_ending) return null;
    return (
      weeklyVehicleRows.find(
        (row) => row.vehicleReg === form.vehicle_reg && row.weekEnding < form.week_ending
      )?.latestEntry ?? null
    );
  }, [form.vehicle_reg, form.week_ending, weeklyVehicleRows]);

  const weeklyDifference =
    previousVehicleEntry && form.mileage && Number.isFinite(Number(form.mileage))
      ? Number(form.mileage) - Number(previousVehicleEntry.mileage || 0)
      : null;

  const loadData = useCallback(async () => {
    clearDataReadCache();
    setLoading(true);
    setError(null);
    setLoadError(null);
    setAssignmentLoadError(null);
    setOilBaselineError(null);
    setDebugInfo(null);
    const authResult = showWeeklyMileageDebug ? await supabase.auth.getUser() : null;
    const queryFilters = {
      vehicles: "select * from vehicles order by vehicle_reg; no client user_id/company_id filter",
      weeklyMileage:
        "select id, week_ending, driver_id, vehicle_reg, odometer_reading, created_at, user_id from weekly_mileage; no client user_id/company_id filter",
      oilChangeBaselines: "select * from oil_change_baselines; merged into cards by normalizeReg(vehicle_reg); no client user_id/company_id filter",
      serviceHistory: "select * from vehicle_service_logs where service_type is null or service_type = oil_change, plus legacy oil_change_history; newest service_date wins; no client user_id/company_id filter"
    };

    const [driverResult, vehicleResult, mileageResult, serviceLogResult] = await Promise.allSettled([
      fetchDrivers(),
      fetchVehicles(),
      fetchWeeklyMileage(),
      fetchOilChangeHistory()
    ]);
    const baselineResult =
      vehicleResult.status === "fulfilled"
        ? await fetchOilChangeBaselinesForVehicles(vehicleResult.value)
            .then((value) => ({ status: "fulfilled" as const, value }))
            .catch((reason) => ({ status: "rejected" as const, reason }))
        : ({ status: "rejected" as const, reason: new Error("Skipped oil baseline lookup because vehicles failed to load.") });

    if (driverResult.status === "fulfilled") {
      setDrivers(driverResult.value);
    } else {
      console.error("Weekly mileage drivers query failed:", driverResult.reason);
      setDrivers([]);
    }

    if (vehicleResult.status === "fulfilled") {
      setVehicles(vehicleResult.value);
    } else {
      console.error("Weekly mileage vehicles query failed:", vehicleResult.reason);
      setVehicles([]);
      setAssignmentLoadError(assignmentCopy.unableToLoadAssignments);
    }

    if (baselineResult.status === "fulfilled") {
      setOilChangeBaselines(baselineResult.value);
    } else {
      setOilChangeBaselines([]);
    }

    if (baselineResult.status === "rejected") {
      console.error("Weekly mileage oil baselines query failed:", baselineResult.reason);
      setOilBaselineError(
        t.weeklyMileage.notifications.loadFailed.replace(
          "{items}",
          language === "th" ? "ข้อมูลพื้นฐานการเปลี่ยนน้ำมัน" : "oil baselines"
        )
      );
    }

    if (mileageResult.status === "fulfilled") {
      setEntries(mileageResult.value);
    } else {
      console.error("Weekly mileage records query failed:", mileageResult.reason);
      setEntries([]);
    }

    if (serviceLogResult.status === "fulfilled") {
      setServiceLogs(serviceLogResult.value);
    } else {
      console.error("Weekly mileage service logs query failed:", serviceLogResult.reason);
      setServiceLogs([]);
    }

    const criticalFailures = [
      driverResult.status === "rejected" ? t.nav.drivers : "",
      mileageResult.status === "rejected" ? t.weeklyMileage.title : "",
      serviceLogResult.status === "rejected" ? (language === "th" ? "ประวัติการบริการ" : "service history") : ""
    ].filter(Boolean);

    if (criticalFailures.length) {
      setLoadError(t.weeklyMileage.notifications.loadFailed.replace("{items}", criticalFailures.join(language === "th" ? " และ " : " and ")));
    }

    if (showWeeklyMileageDebug) {
      setDebugInfo({
        userEmail: authResult?.data.user?.email ?? null,
        userId: authResult?.data.user?.id ?? null,
        supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "missing",
        tables: {
          vehicles: "public.vehicles",
          weeklyMileage: "public.weekly_mileage",
          oilChangeBaselines: "public.oil_change_baselines",
          serviceHistory: "public.vehicle_service_logs + public.oil_change_history"
        },
        filters: queryFilters,
        rowCounts: {
          drivers: driverResult.status === "fulfilled" ? driverResult.value.length : "failed",
          vehicles: vehicleResult.status === "fulfilled" ? vehicleResult.value.length : "failed",
          weeklyMileage: mileageResult.status === "fulfilled" ? mileageResult.value.length : "failed",
          oilChangeBaselines: baselineResult.status === "fulfilled" ? baselineResult.value.length : "failed",
          serviceHistory: serviceLogResult.status === "fulfilled" ? serviceLogResult.value.length : "failed"
        },
        errors: {
          auth: authResult?.error?.message ?? null,
          drivers: driverResult.status === "rejected" ? describeLoadError(driverResult.reason) : null,
          vehicles: vehicleResult.status === "rejected" ? describeLoadError(vehicleResult.reason) : null,
          weeklyMileage: mileageResult.status === "rejected" ? describeLoadError(mileageResult.reason) : null,
          oilChangeBaselines: baselineResult.status === "rejected" ? describeLoadError(baselineResult.reason) : null,
          serviceHistory: serviceLogResult.status === "rejected" ? describeLoadError(serviceLogResult.reason) : null
        }
      });
    }

    setLoading(false);
  }, [assignmentCopy.unableToLoadAssignments, language, showWeeklyMileageDebug, t.nav.drivers, t.weeklyMileage.notifications.loadFailed, t.weeklyMileage.title]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    const handleDataChanged = () => void loadData();
    window.addEventListener("fuel-bank:data-changed", handleDataChanged);
    return () => window.removeEventListener("fuel-bank:data-changed", handleDataChanged);
  }, [loadData]);

  useEffect(() => {
    if (!availableWeeks.length) {
      setSelectedWeek("");
      return;
    }
    if (!selectedWeek || !availableWeeks.includes(selectedWeek)) {
      setSelectedWeek(availableWeeks[0]);
    }
  }, [availableWeeks, selectedWeek]);

  useEffect(() => {
    setTablePage(1);
  }, [selectedWeekValue]);

  const rememberWeekEnding = (weekEnding: string) => {
    if (typeof window === "undefined") return;
    if (isValidDateKey(weekEnding)) {
      window.localStorage.setItem(WEEKLY_MILEAGE_SELECTED_WEEK_KEY, weekEnding);
    }
  };

  const focusDriverSelect = () => {
    window.setTimeout(() => driverSelectRef.current?.focus(), 0);
  };

  const resetForm = (clearMessages = true, options?: { keepWeekEnding?: boolean; weekEnding?: string; focusDriver?: boolean }) => {
    const nextWeekEnding = options?.keepWeekEnding ? options.weekEnding ?? form.week_ending : "";
    setForm(createInitialForm(nextWeekEnding));
    setError(null);
    if (clearMessages) setSuccessMessage(null);
    if (options?.focusDriver) {
      focusDriverSelect();
    }
  };

  const handleInvalid = (
    event: React.InvalidEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => applyRequiredValidationMessage(event, t.common.requiredField);

  const getDriversAssignedToVehicle = useCallback(
    (vehicleReg: string) => {
      const selectedKey = normalizeReg(vehicleReg);
      if (!selectedKey) return [];
      const matchedVehicle = vehiclesByReg.get(selectedKey) ?? null;

      return drivers.filter((driver) => {
        if (driver.active === false) return false;
        if (matchedVehicle?.id && driver.assigned_vehicle_id) {
          return String(driver.assigned_vehicle_id) === String(matchedVehicle.id);
        }
        if (driver.assigned_vehicle_id) return false;
        return normalizeReg(driver.vehicle_reg) === selectedKey;
      });
    },
    [drivers, vehiclesByReg]
  );

  const handleDriverChange = (driverId: string) => {
    const nextDriver = drivers.find((driver) => String(driver.id) === String(driverId));
    const assignedVehicleReg = getAssignedVehicleRegForDriver(nextDriver);

    setForm((current) => ({
      ...current,
      driver_id: driverId,
      vehicle_reg: driverId ? assignedVehicleReg : current.vehicle_reg
    }));

    window.setTimeout(() => {
      if (driverId && assignedVehicleReg) {
        odometerInputRef.current?.focus();
      } else if (driverId) {
        vehicleInputRef.current?.focus();
      }
    }, 0);
  };

  const handleVehicleRegChange = (vehicleReg: string) => {
    const assignedDrivers = getDriversAssignedToVehicle(vehicleReg);

    setForm((current) => {
      if (!normalizeReg(vehicleReg)) {
        return { ...current, vehicle_reg: vehicleReg };
      }

      if (current.driver_id) {
        return { ...current, vehicle_reg: vehicleReg };
      }

      return {
        ...current,
        vehicle_reg: vehicleReg,
        driver_id: assignedDrivers.length === 1 ? String(assignedDrivers[0].id) : ""
      };
    });
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    const shouldAddNext = !isEditing && (submitActionRef.current === "next" || multiEntryMode);
    setSaving(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const mileage = Number(form.mileage);
      if (!form.driver_id || !form.vehicle_reg || !form.week_ending || !Number.isFinite(mileage)) {
        throw new Error(t.common.requiredField);
      }
      if (
        previousVehicleEntry?.mileage != null &&
        mileage < Number(previousVehicleEntry.mileage) &&
        !window.confirm(t.weeklyMileage.mileageValidationError)
      ) {
        throw new Error(t.weeklyMileage.mileageValidationError);
      }
      const duplicateEntry = entries.find((entry) => {
        if (form.id && String(entry.id) === String(form.id)) return false;
        if (entry.week_ending !== form.week_ending) return false;
        const sameDriver = String(entry.driver_id) === String(form.driver_id);
        const sameVehicle = normalizeReg(entry.vehicle_reg) === normalizeReg(form.vehicle_reg);
        return sameDriver || sameVehicle;
      });

      if (duplicateEntry) {
        const duplicateDriver = drivers.find((driver) => String(driver.id) === String(duplicateEntry.driver_id));
        const duplicateName = duplicateDriver?.name || duplicateEntry.driver || selectedDriver?.name || t.weeklyMileage.driver;
        throw new Error(
          fastEntryCopy.duplicateWarning
            .replace("{driver}", duplicateName)
            .replace("{date}", formatDate(form.week_ending, language))
        );
      }

      const savedEntry = await saveWeeklyMileage({
        id: form.id || undefined,
        week_ending: form.week_ending,
        driver_id: form.driver_id,
        vehicle_reg: form.vehicle_reg,
        odometer_reading: mileage
      });

      setSelectedWeek(savedEntry.week_ending ?? form.week_ending);
      rememberWeekEnding(savedEntry.week_ending ?? form.week_ending);
      resetForm(false, {
        keepWeekEnding: shouldAddNext,
        weekEnding: savedEntry.week_ending ?? form.week_ending,
        focusDriver: shouldAddNext && !isEditing
      });
      setSuccessMessage(
        isEditing
          ? t.weeklyMileage.notifications.updateSuccess
          : fastEntryCopy.saveSuccessForDriver
              .replace("{driver}", savedEntry.driver || selectedDriver?.name || "")
              .replace("{date}", formatDate(savedEntry.week_ending ?? form.week_ending, language))
      );
      await loadData();
    } catch (err) {
      console.error("Weekly mileage save error:", err);
      setError(err instanceof Error && err.message ? err.message : t.weeklyMileage.errorSave);
    } finally {
      submitActionRef.current = "save";
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm(t.weeklyMileage.deleteConfirm)) return;
    try {
      setDeletingId(id);
      setError(null);
      setSuccessMessage(null);
      await deleteWeeklyMileage(id);
      if (form.id === id) resetForm();
      setSuccessMessage(t.weeklyMileage.notifications.deleteSuccess);
      await loadData();
    } catch (err) {
      console.error("Weekly mileage delete error:", err);
      setError(err instanceof Error && err.message ? err.message : t.weeklyMileage.deleteError);
    } finally {
      setDeletingId(null);
    }
  };

  const oilStatusLabel = (status: string) => {
    if (status === "ok") return oilReportCopy.ok;
    if (status === "due_soon") return oilReportCopy.dueSoon;
    if (status === "urgent") return oilReportCopy.urgent;
    if (status === "overdue") return oilReportCopy.overdue;
    if (status === "review_required" || status === "no_odometer") return oilReportCopy.reviewRequired;
    return oilReportCopy.notSet;
  };

  const hasMileageDataIssue = (row: OilChangeAlertRow) =>
    row.reviewReasons.includes(CURRENT_ODOMETER_BELOW_SERVICE_REASON);

  const oilStatusLabelForRow = (row: OilChangeAlertRow) =>
    hasMileageDataIssue(row) ? oilReportCopy.mileageDataIssue : oilStatusLabel(row.status);

  const OilStatusIcon = ({ status, className = "h-3.5 w-3.5" }: { status: string; className?: string }) =>
    status === "ok" ? (
      <CircleCheck aria-hidden="true" className={className} />
    ) : status === "overdue" || status === "urgent" || status === "due_soon" ? (
      <AlertTriangle aria-hidden="true" className={className} />
    ) : (
      <span aria-hidden="true" className={`inline-block rounded-full bg-current ${className}`} />
    );

  const oilStatusClass = (status: string) => {
    if (status === "ok") return "border-emerald-200 bg-emerald-50 text-emerald-700";
    if (status === "due_soon") return "border-amber-200 bg-amber-50 text-amber-800";
    if (status === "urgent") return "border-orange-200 bg-orange-50 text-orange-800";
    if (status === "overdue") return "border-rose-200 bg-rose-50 text-rose-700";
    if (status === "review_required") return "border-sky-200 bg-sky-50 text-sky-800";
    return "border-slate-200 bg-slate-50 text-slate-600";
  };

  const oilCardClass = (status: string) => {
    if (status === "overdue") return "border-rose-400 bg-rose-50/80 shadow-[0_16px_45px_rgba(225,29,72,0.12)]";
    if (status === "urgent") return "border-orange-300 bg-orange-50/80 shadow-[0_14px_38px_rgba(234,88,12,0.10)]";
    if (status === "due_soon") return "border-amber-300 bg-amber-50/70";
    if (status === "ok") return "border-emerald-100 bg-white";
    return "border-slate-200 bg-white";
  };

  const progressBarClass = (status: string) => {
    if (status === "overdue") return "bg-rose-600";
    if (status === "urgent") return "bg-orange-500";
    if (status === "due_soon") return "bg-amber-400";
    if (status === "ok") return "bg-emerald-500";
    return "bg-slate-300";
  };

  const kmRemainingClass = (kmRemaining: number | null) => {
    if (kmRemaining == null) return "text-slate-400";
    if (kmRemaining < 0) return "text-rose-700";
    if (kmRemaining <= 1000) return "text-orange-700";
    return "text-slate-950";
  };

  const getServiceProgress = (row: (typeof oilChangeRows)[number]) => {
    if (
      row.lastOilChangeOdometer == null ||
      row.currentOdometer == null ||
      row.nextOilChangeDueOdometer == null ||
      row.oilChangeIntervalKm == null ||
      row.oilChangeIntervalKm <= 0
    ) {
      return null;
    }

    const usedKm = row.currentOdometer - row.lastOilChangeOdometer;
    const safeUsedKm = Math.max(0, usedKm);
    const realPercent = (safeUsedKm / row.oilChangeIntervalKm) * 100;
    const displayPercent =
      safeUsedKm === 0
        ? "0"
        : realPercent < 1
          ? (Math.ceil(realPercent * 10) / 10).toFixed(1)
          : (Math.round(realPercent * 10) / 10).toFixed(realPercent >= 10 && Number.isInteger(Math.round(realPercent * 10) / 10) ? 0 : 1);
    const barPercent = safeUsedKm > 0 ? Math.max(Math.min(realPercent, 100), 1) : 0;

    return {
      realPercent,
      displayPercent,
      barPercent
    };
  };

  const actionLine = (row: (typeof oilChangeRows)[number]) => {
    if (row.status === "overdue" && row.overdueKm != null) {
      return `${oilReportCopy.overdueBy} ${formatKmValue(row.overdueKm)}`;
    }
    if (row.kmRemaining === 0) {
      return t.weeklyMileage.oil.actionDueNow;
    }
    if (row.status === "urgent" && row.kmRemaining != null) {
      return oilReportCopy.actionDueIn.replace("{km}", formatKmValue(row.kmRemaining));
    }
    if (row.status === "due_soon" && row.kmRemaining != null) {
      return oilReportCopy.actionDueIn.replace("{km}", formatKmValue(row.kmRemaining));
    }
    if (row.status === "ok") {
      return oilReportCopy.ok;
    }
    return oilStatusLabelForRow(row);
  };

  const reviewReasonLabel = (reason: string) => {
    if (reason === "Missing vehicle type") return t.weeklyMileage.oil.missingVehicleType;
    if (reason === "Missing oil change interval") return t.weeklyMileage.oil.missingOilChangeInterval;
    if (reason === CURRENT_ODOMETER_BELOW_SERVICE_REASON) {
      return t.weeklyMileage.oil.currentLowerThanLastOilChange;
    }
    return reason;
  };

  const vehicleTypeLabel = (vehicleType: string | null) => {
    if (!vehicleType) return t.weeklyMileage.oil.missingVehicleType;
    return (
      t.weeklyMileage.oil.vehicleTypes[
        vehicleType as keyof typeof t.weeklyMileage.oil.vehicleTypes
      ] ?? vehicleType
    );
  };

  const formatKmValue = (value: number | null) =>
    value != null && Number.isFinite(value) ? formatNumber(value, language) : "-";

  const parseDateValue = (value: string | null | undefined) => {
    if (!value) return null;
    const isoDateMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const parsed = isoDateMatch
      ? new Date(Number(isoDateMatch[1]), Number(isoDateMatch[2]) - 1, Number(isoDateMatch[3]))
      : new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  };

  const getDaysSinceWeeklyMileageAdded = (addedAt: string | null) => {
    const parsed = parseDateValue(addedAt);
    if (!parsed) return null;
    const now = new Date();
    const diff = now.getTime() - parsed.getTime();
    return Math.max(0, Math.floor(diff / (24 * 60 * 60 * 1000)));
  };

  const formatWeeklyMileageAddedAge = (addedAt: string | null) => {
    const days = getDaysSinceWeeklyMileageAdded(addedAt);
    if (days == null) return "";
    if (days === 0) return t.weeklyMileage.oil.addedToday;
    if (days === 1) return t.weeklyMileage.oil.addedOneDayAgo;
    return t.weeklyMileage.oil.addedDaysAgo.replace("{days}", formatNumber(days, language));
  };

  const todayKey = () => new Date().toISOString().slice(0, 10);
  const getLatestServiceLog = (registration: string) =>
    serviceLogsByVehicle.get(normalizeReg(registration))?.[0] ?? null;
  const getVehicleBaselineHistoryLog = (registration: string): VehicleServiceLog | null => {
    const key = normalizeReg(registration);
    const vehicle = vehicles.find((item) => normalizeReg(item.vehicle_reg || item.registration) === key);
    if (!vehicle?.last_oil_change_date || vehicle.last_oil_change_odometer == null) {
      return null;
    }

    const odometer = Number(vehicle.last_oil_change_odometer);
    const intervalKm =
      vehicle.oil_change_interval_km != null && Number.isFinite(Number(vehicle.oil_change_interval_km))
        ? Number(vehicle.oil_change_interval_km)
        : null;

    return {
      id: `vehicle-baseline-${key}-${vehicle.last_oil_change_date}`,
      vehicle_id: vehicle.id,
      vehicle_reg: vehicle.vehicle_reg || registration,
      service_type: "oil_change",
      service_date: vehicle.last_oil_change_date,
      odometer,
      oil_change_odometer: odometer,
      service_odometer: odometer,
      interval_km: intervalKm,
      next_service_due_odometer: intervalKm != null ? Math.trunc(odometer + intervalKm) : null,
      vehicle_type_snapshot: vehicle.vehicle_type ?? null,
      notes: t.weeklyMileage.oil.oilChangedNote,
      created_at: vehicle.last_oil_change_date
    };
  };

  const appendBaselineHistoryLog = (registration: string, logs: VehicleServiceLog[]) => {
    const baselineLog = getVehicleBaselineHistoryLog(registration);
    if (!baselineLog) {
      return logs;
    }

    const baselineOdometer = Number(baselineLog.oil_change_odometer ?? baselineLog.odometer);
    const alreadyIncluded = logs.some((log) => {
      const logOdometer = Number(log.oil_change_odometer ?? log.odometer);
      return log.service_date === baselineLog.service_date && logOdometer === baselineOdometer;
    });

    return alreadyIncluded
      ? logs
      : [...logs, baselineLog].sort(compareServiceLogsByLatest);
  };

  const openServiceModal = (mode: OilActionMode, row: (typeof oilChangeRows)[number]) => {
    const latestLog = getLatestServiceLog(row.registration);
    const defaultInterval =
      getEffectiveOilChangeIntervalForVehicleType(
        row.vehicleType,
        row.oilChangeIntervalKm ?? latestLog?.interval_km ?? getOilChangeIntervalForVehicleType(row.vehicleType)
      );
    const defaultDate =
      mode === "mark" ? todayKey() : row.lastOilChangeDate ?? latestLog?.service_date ?? todayKey();
    const defaultOdometer =
      mode === "mark"
        ? row.currentOdometer ?? row.lastOilChangeOdometer ?? ""
        : row.lastOilChangeOdometer ?? latestLog?.odometer ?? row.currentOdometer ?? "";

    setError(null);
    setSuccessMessage(null);
    setServiceForm({
      serviceDate: defaultDate,
      serviceOdometer: defaultOdometer === "" ? "" : String(defaultOdometer),
      intervalKm: defaultInterval != null ? String(defaultInterval) : "",
      notes: ""
    });
    setServiceModal({
      mode,
      vehicleId: row.vehicleId,
      registration: row.registration,
      vehicleName: row.vehicleName,
      vehicleType: row.vehicleType,
      currentOdometer: row.currentOdometer,
      serviceLogId: mode === "edit" ? latestLog?.id ?? null : null
    });
  };

  const closeServiceModal = () => {
    if (savingService) return;
    setServiceModal(null);
    setServiceForm({ serviceDate: "", serviceOdometer: "", intervalKm: "", notes: "" });
  };

  const handleSaveService = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!serviceModal) return;

    try {
      setSavingService(true);
      setError(null);
      setSuccessMessage(null);
      const serviceOdometer = Number(serviceForm.serviceOdometer);
      const isLowerThanCurrent =
        serviceModal.currentOdometer != null &&
        Number.isFinite(serviceOdometer) &&
        serviceOdometer < serviceModal.currentOdometer;
      if (isLowerThanCurrent) {
        const confirmed = window.confirm(t.weeklyMileage.oil.confirmLowerOilChangeOdometer);
        if (!confirmed) {
          return;
        }
      }
      const notes = [
        serviceForm.notes.trim(),
        isLowerThanCurrent ? t.weeklyMileage.oil.lowerThanCurrentConfirmed : ""
      ].filter(Boolean).join(" | ");
      const servicePayload = {
        vehicleId: serviceModal.vehicleId,
        vehicleReg: serviceModal.registration,
        vehicleName: serviceModal.vehicleName,
        vehicleType: serviceModal.vehicleType,
        serviceDate: serviceForm.serviceDate,
        serviceOdometer,
        intervalKm: Number(serviceForm.intervalKm),
        notes,
        serviceLogId: serviceModal.serviceLogId,
        updateExistingLog: serviceModal.mode === "edit",
        recordHistory: serviceModal.mode === "mark"
      };
      await saveOilChangeService(servicePayload);

      await loadData();
      setSuccessMessage(
        serviceModal.mode === "mark"
          ? t.weeklyMileage.notifications.oilChangeSaved
          : serviceModal.mode === "edit"
            ? t.weeklyMileage.notifications.serviceUpdated
            : t.weeklyMileage.notifications.oilBaselineSaved
      );
      setServiceModal(null);
      setServiceForm({ serviceDate: "", serviceOdometer: "", intervalKm: "", notes: "" });
    } catch (err) {
      console.error("Oil service save error:", err);
      setError(err instanceof Error && err.message ? err.message : t.weeklyMileage.notifications.serviceSaveFailed);
    } finally {
      setSavingService(false);
    }
  };

  const openServiceHistory = async (registration: string) => {
    setHistoryVehicleReg(registration);
    await loadData();
  };

  const selectedHistoryRow = historyVehicleReg
    ? oilChangeRows.find((row) => normalizeReg(row.registration) === normalizeReg(historyVehicleReg)) ?? null
    : null;
  const selectedHistoryLogs = (() => {
    const logs = historyVehicleReg
      ? appendBaselineHistoryLog(historyVehicleReg, serviceLogsByVehicle.get(normalizeReg(historyVehicleReg)) ?? [])
      : [];
    if (logs.length || !selectedHistoryRow?.lastOilChangeDate || selectedHistoryRow.lastOilChangeOdometer == null) {
      return logs;
    }

    return [
      {
        id: `baseline-${normalizeReg(selectedHistoryRow.registration)}`,
        vehicle_id: selectedHistoryRow.vehicleId,
        vehicle_reg: selectedHistoryRow.registration,
        service_type: "oil_change",
        service_date: selectedHistoryRow.lastOilChangeDate,
        odometer: selectedHistoryRow.lastOilChangeOdometer,
        oil_change_odometer: selectedHistoryRow.lastOilChangeOdometer,
        service_odometer: selectedHistoryRow.lastOilChangeOdometer,
        interval_km: selectedHistoryRow.oilChangeIntervalKm,
        next_service_due_odometer: selectedHistoryRow.nextOilChangeDueOdometer,
        vehicle_type_snapshot: selectedHistoryRow.vehicleType,
        notes: t.weeklyMileage.oil.oilChangedNote,
        created_at: selectedHistoryRow.lastOilChangeDate
      } satisfies VehicleServiceLog
    ];
  })();

  const exportWeeklyMileage = () =>
    exportToCsv(
      sortedEntries.map((entry) => ({
        [t.weeklyMileage.weekEnding]: formatDate(entry.week_ending, language),
        [t.weeklyMileage.driver]: entry.driver,
        [t.weeklyMileage.vehicleReg]: entry.vehicle_reg,
        [t.weeklyMileage.mileage]: entry.mileage
      })),
      "weekly-mileage-report"
    );

  const oilReportStatusLabel = (status: OilChangeStatus) => {
    if (status === "overdue") return oilReportCopy.overdue;
    if (status === "urgent") return oilReportCopy.urgent;
    if (status === "due_soon") return oilReportCopy.dueSoon;
    if (status === "review_required" || status === "no_odometer") return oilReportCopy.reviewRequired;
    if (status === "not_set") return oilReportCopy.notSet;
    return oilReportCopy.ok;
  };

  const oilReportPriority = (row: OilChangeAlertRow) => {
    if (row.status === "overdue") return "Immediate service required";
    if (row.status === "urgent") return "Book service soon";
    if (row.status === "due_soon") return "Monitor";
    if (row.status === "review_required" || row.status === "not_set" || row.status === "no_odometer") {
      return "Missing service baseline";
    }
    return "No action needed";
  };

  const oilReportRank = (status: OilChangeStatus) => {
    if (status === "overdue") return 1;
    if (status === "urgent") return 2;
    if (status === "due_soon") return 3;
    if (status === "review_required" || status === "not_set" || status === "no_odometer") return 4;
    return 5;
  };

  const sortOilReportRows = (rows: OilChangeAlertRow[]) =>
    [...rows].sort((left, right) => {
      const rankDiff = oilReportRank(left.status) - oilReportRank(right.status);
      if (rankDiff !== 0) return rankDiff;

      const leftRemaining = left.kmRemaining ?? Number.POSITIVE_INFINITY;
      const rightRemaining = right.kmRemaining ?? Number.POSITIVE_INFINITY;
      if (leftRemaining !== rightRemaining) return leftRemaining - rightRemaining;

      return left.registration.localeCompare(right.registration);
    });

  const getOilReportRows = (scope: OilReportScope) => {
    if (scope === "overdue") {
      return sortOilReportRows(oilChangeRows.filter((row) => row.status === "overdue"));
    }
    if (scope === "urgent_overdue") {
      return sortOilReportRows(oilChangeRows.filter((row) => row.status === "overdue" || row.status === "urgent"));
    }
    if (scope === "due_soon") {
      return sortOilReportRows(oilChangeRows.filter((row) => row.status === "due_soon"));
    }
    if (scope === "review_required") {
      return sortOilReportRows(
        oilChangeRows.filter((row) => row.status === "review_required" || row.status === "not_set" || row.status === "no_odometer")
      );
    }
    return sortOilReportRows(oilChangeRows);
  };

  const buildOilReportExportRows = (rows: OilChangeAlertRow[]) =>
    rows.map((row) => ({
      "Vehicle Registration": row.registration,
      "Driver Name": row.driverName ?? "",
      "Vehicle Type": row.vehicleType ? vehicleTypeLabel(row.vehicleType) : "",
      "Current Odometer": row.currentOdometer ?? "",
      "Last Weekly Mileage Date": row.lastWeeklyMileageDate ?? "",
      "Last Weekly Mileage Odometer": row.lastWeeklyMileageOdometer ?? "",
      "Days Since Weekly Mileage Added": row.daysSinceWeeklyMileage ?? "",
      "Weekly Mileage Updated This Week": row.weeklyMileageUpdatedThisWeek ? "Yes" : "No",
      "Last Oil Change Date": row.lastOilChangeDate ?? "",
      "Last Oil Change Odometer": row.lastOilChangeOdometer ?? "",
      "Service Interval KM": row.oilChangeIntervalKm ?? "",
      "Next Service Due KM": row.nextOilChangeDueOdometer ?? "",
      "KM Remaining": row.kmRemaining ?? "",
      Status: oilReportStatusLabel(row.status),
      Priority: oilReportPriority(row),
      Notes: row.reviewReasons.length ? row.reviewReasons.map(reviewReasonLabel).join("; ") : actionLine(row)
    }));

  const exportOilServiceReport = (scope: OilReportScope, fileSuffix: string) => {
    exportToCsv(buildOilReportExportRows(getOilReportRows(scope)), `oil-change-service-report-${fileSuffix}`);
  };

  const oilReportCopy = t.weeklyMileage.oil.report;

  const oilServicePdfButtonCopy = language === "th"
    ? {
        download: "ดาวน์โหลด PDF รายงานบริการน้ำมันเครื่อง",
        error: "ไม่สามารถสร้าง PDF รายงานบริการน้ำมันเครื่องได้",
        generated: "ดาวน์โหลด PDF รายงานบริการน้ำมันเครื่องแล้ว",
        generating: "กำลังสร้าง PDF...",
        okFallbackWeek: "ไม่ระบุ",
        unassigned: "ยังไม่ระบุคนขับ"
      }
    : {
        download: "Download Oil Service PDF",
        error: "Unable to generate oil service PDF.",
        generated: "Oil service PDF downloaded.",
        generating: "Generating PDF...",
        okFallbackWeek: "Not available",
        unassigned: "Unassigned"
      };

  const lastOilChangesPdfButtonCopy = language === "th"
    ? {
        download: "ดาวน์โหลด PDF รายงานการเปลี่ยนน้ำมันเครื่องล่าสุด",
        error: "ไม่สามารถสร้าง PDF รายงานการเปลี่ยนน้ำมันล่าสุดได้",
        generated: "ดาวน์โหลด PDF รายงานการเปลี่ยนน้ำมันล่าสุดแล้ว"
      }
    : {
        download: "Download Last Oil Changes PDF",
        error: "Unable to generate last oil changes PDF.",
        generated: "Last oil changes PDF downloaded."
      };

  const formatOilPdfKm = (value: number | null | undefined) =>
    value == null || !Number.isFinite(Number(value)) ? "-" : `${formatNumber(Number(value), language, 0)} KM`;

  const formatLastOilReportKm = (value: number | null | undefined) =>
    value == null || !Number.isFinite(Number(value)) ? getLastOilChangesPdfCopy(language === "th" ? "th" : "en").notAvailable : `${formatNumber(Number(value), language, 0)} KM`;

  const toOilServicePdfRow = (row: OilChangeAlertRow, serviceDelta: number | null | undefined): OilServicePdfRow => ({
    currentOdometer: formatOilPdfKm(row.currentOdometer),
    driverName: row.driverName?.trim() || oilServicePdfButtonCopy.unassigned,
    lastOilChangeDate: row.lastOilChangeDate ? formatDate(row.lastOilChangeDate, language) : "-",
    nextServiceDue: formatOilPdfKm(row.nextOilChangeDueOdometer),
    priorityKm: Number(serviceDelta ?? Number.POSITIVE_INFINITY),
    serviceDelta: formatOilPdfKm(serviceDelta),
    vehicleReg: row.registration || "-",
    vehicleType: row.vehicleType ? vehicleTypeLabel(row.vehicleType) : row.vehicleTypeLabel || "-"
  });

  const buildOilServicePdfData = (): OilServicePdfData => {
    const overdueRows = oilChangeRows
      .filter((row) => row.status === "overdue")
      .map((row) => toOilServicePdfRow(row, row.overdueKm))
      .sort((left, right) => {
        const priorityDiff =
          (Number.isFinite(right.priorityKm) ? right.priorityKm : -1) -
          (Number.isFinite(left.priorityKm) ? left.priorityKm : -1);
        return priorityDiff !== 0 ? priorityDiff : left.vehicleReg.localeCompare(right.vehicleReg);
      });
    const dueSoonRows = oilChangeRows
      .filter((row) => row.status === "urgent" || row.status === "due_soon")
      .map((row) => toOilServicePdfRow(row, row.kmRemaining))
      .sort((left, right) => {
        const priorityDiff =
          (Number.isFinite(left.priorityKm) ? left.priorityKm : Number.POSITIVE_INFINITY) -
          (Number.isFinite(right.priorityKm) ? right.priorityKm : Number.POSITIVE_INFINITY);
        return priorityDiff !== 0 ? priorityDiff : left.vehicleReg.localeCompare(right.vehicleReg);
      });
    const pdfLanguage = language === "th" ? "th" : "en";
    const generatedAt = new Intl.DateTimeFormat(pdfLanguage === "th" ? "th-TH" : "en-GB", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Asia/Bangkok"
    }).format(new Date());

    return {
      dueSoonRows,
      generatedAt,
      okCount: formatNumber(oilReportSummary.ok, language, 0),
      overdueRows,
      summary: {
        dueSoon: formatNumber(oilReportSummary.urgent + oilReportSummary.dueSoon, language, 0),
        ok: formatNumber(oilReportSummary.ok, language, 0),
        overdue: formatNumber(oilReportSummary.overdue, language, 0)
      },
      weekEnding: selectedWeekSummary?.weekEnding ? formatDate(selectedWeekSummary.weekEnding, language) : oilServicePdfButtonCopy.okFallbackWeek
    };
  };

  const lastOilChangeReportRank = (row: LastOilChangesPdfRow) => {
    if (!row.hasServiceRecord) return 0;
    if (row.status === "overdue") return 1;
    if (row.status === "urgent") return 2;
    if (row.status === "due_soon") return 3;
    if (row.status === "review_required" || row.status === "no_odometer") return 4;
    if (row.status === "not_set") return 5;
    return 6;
  };

  const toLastOilChangesPdfRow = (row: OilChangeAlertRow): LastOilChangesPdfRow => {
    const latestLog = getLatestServiceLog(row.registration);
    const copy = getLastOilChangesPdfCopy(language === "th" ? "th" : "en");
    const serviceOdometer = latestLog
      ? Number(latestLog.oil_change_odometer ?? latestLog.odometer ?? latestLog.service_odometer)
      : null;
    const normalizedServiceOdometer =
      serviceOdometer != null && Number.isFinite(serviceOdometer) ? Math.trunc(serviceOdometer) : null;
    const kmDriven =
      row.currentOdometer != null && normalizedServiceOdometer != null
        ? Math.trunc(row.currentOdometer - normalizedServiceOdometer)
        : null;
    const hasServiceRecord = Boolean(latestLog);
    const hasNegativeKmUsed = kmDriven != null && kmDriven < 0;
    const kmRemaining =
      hasServiceRecord && row.nextOilChangeDueOdometer != null && row.currentOdometer != null
        ? Math.trunc(row.nextOilChangeDueOdometer - row.currentOdometer)
        : null;
    const hasCurrentMileage = row.currentOdometer != null && row.lastWeeklyMileageDate != null;
    const displayStatus: OilChangeStatus = !hasCurrentMileage || hasNegativeKmUsed ? "review_required" : row.status;
    const statusLabel = !hasCurrentMileage
      ? oilReportStatusLabel("review_required")
      : !hasServiceRecord
        ? copy.noServiceRecord
        : oilReportStatusLabel(displayStatus);
    const currentOdometerDate = row.lastWeeklyMileageDate
      ? copy.asOf(formatDate(row.lastWeeklyMileageDate, language))
      : copy.notAvailable;
    const staleMileage = Boolean(row.lastWeeklyMileageDate && !row.weeklyMileageUpdatedThisWeek);

    return {
      currentOdometer: row.currentOdometer == null ? copy.noMileage : formatOilPdfKm(row.currentOdometer),
      currentOdometerDate,
      currentOdometerDateTone: staleMileage ? "stale" : "muted",
      currentOdometerWarning: staleMileage ? copy.notUpdatedThisWeek : null,
      driverName: row.driverName?.trim() || oilServicePdfButtonCopy.unassigned,
      hasServiceRecord,
      kmDrivenSinceOilChange: !hasCurrentMileage || !hasServiceRecord
        ? copy.notAvailable
        : hasNegativeKmUsed
          ? oilReportStatusLabel("review_required")
          : formatLastOilReportKm(kmDriven),
      kmRemaining: !hasCurrentMileage || kmRemaining == null
        ? copy.notAvailable
        : kmRemaining < 0
          ? `${formatNumber(Math.abs(kmRemaining), language, 0)} ${copy.overdueSuffix}`
          : formatLastOilReportKm(kmRemaining),
      kmRemainingSort: kmRemaining ?? Number.POSITIVE_INFINITY,
      lastOilChangeDate: hasServiceRecord && latestLog?.service_date
        ? formatDate(latestLog.service_date, language)
        : copy.noServiceRecord,
      lastOilChangeOdometer: hasServiceRecord ? formatLastOilReportKm(normalizedServiceOdometer) : copy.notAvailable,
      lastOilChangeTime: latestLog?.service_date ? parseDateValue(latestLog.service_date)?.getTime() ?? Number.POSITIVE_INFINITY : Number.POSITIVE_INFINITY,
      status: displayStatus,
      statusLabel,
      vehicleReg: row.registration || "-",
      vehicleType: row.vehicleType ? vehicleTypeLabel(row.vehicleType) : row.vehicleTypeLabel || "-"
    };
  };

  const buildLastOilChangesPdfData = (): LastOilChangesPdfData => {
    const pdfLanguage = language === "th" ? "th" : "en";
    const generatedAt = new Intl.DateTimeFormat(pdfLanguage === "th" ? "th-TH" : "en-GB", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Asia/Bangkok"
    }).format(new Date());
    const rows = oilChangeRows
      .map(toLastOilChangesPdfRow)
      .sort((left, right) => {
        const rankDiff = lastOilChangeReportRank(left) - lastOilChangeReportRank(right);
        if (rankDiff !== 0) return rankDiff;

        if (left.kmRemainingSort !== right.kmRemainingSort) return left.kmRemainingSort - right.kmRemainingSort;

        if (left.lastOilChangeTime !== right.lastOilChangeTime) return left.lastOilChangeTime - right.lastOilChangeTime;

        return left.vehicleReg.localeCompare(right.vehicleReg);
      });
    const noRecord = rows.filter((row) => !row.hasServiceRecord).length;
    const countStatus = (status: OilChangeStatus) =>
      rows.filter((row) => row.hasServiceRecord && row.status === status).length;

    return {
      generatedAt,
      rows,
      summary: {
        dueSoon: formatNumber(countStatus("due_soon"), language, 0),
        noRecord: formatNumber(noRecord, language, 0),
        ok: formatNumber(countStatus("ok"), language, 0),
        overdue: formatNumber(countStatus("overdue"), language, 0),
        total: formatNumber(rows.length, language, 0),
        urgent: formatNumber(countStatus("urgent"), language, 0)
      }
    };
  };

  const downloadOilServicePdf = async () => {
    if (generatingOilServicePdf) return;
    setGeneratingOilServicePdf(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const pdfLanguage = language === "th" ? "th" : "en";
      const pdfData = buildOilServicePdfData();
      const logo = await loadOilServicePdfLogo();
      const pdf = await buildOilServicePdf(pdfData, logo, pdfLanguage);
      const datePart = new Date().toISOString().slice(0, 10);
      downloadBlob(pdf, `Expert-Express-Oil-Service-Report-${datePart}.pdf`);
      setSuccessMessage(oilServicePdfButtonCopy.generated);
    } catch (err) {
      console.error("Oil service PDF generation failed:", err);
      setError(err instanceof Error && err.message ? err.message : oilServicePdfButtonCopy.error);
    } finally {
      setGeneratingOilServicePdf(false);
    }
  };

  const downloadLastOilChangesPdf = async () => {
    if (generatingLastOilChangesPdf) return;
    setGeneratingLastOilChangesPdf(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const pdfLanguage = language === "th" ? "th" : "en";
      const pdfData = buildLastOilChangesPdfData();
      const logo = await loadOilServicePdfLogo();
      const pdf = await buildLastOilChangesPdf(pdfData, logo, pdfLanguage);
      const datePart = new Date().toISOString().slice(0, 10);
      downloadBlob(pdf, `Expert-Express-Last-Oil-Changes-${datePart}.pdf`);
      setSuccessMessage(lastOilChangesPdfButtonCopy.generated);
    } catch (err) {
      console.error("Last oil changes PDF generation failed:", err);
      setError(err instanceof Error && err.message ? err.message : lastOilChangesPdfButtonCopy.error);
    } finally {
      setGeneratingLastOilChangesPdf(false);
    }
  };

  const copyOilReportSummary = async () => {
    const immediateRows = sortOilReportRows(
      oilChangeRows.filter((row) => row.status === "overdue" || row.status === "urgent")
    ).slice(0, 8);
    const message = [
      oilReportCopy.title,
      "",
      `${oilReportCopy.overdueVehicles}: ${oilReportSummary.overdue}`,
      `${oilReportCopy.urgentVehicles}: ${oilReportSummary.urgent}`,
      `${oilReportCopy.dueSoonVehicles}: ${oilReportSummary.dueSoon}`,
      `${oilReportCopy.reviewRequired}: ${oilReportSummary.reviewRequired}`,
      `${oilReportCopy.okVehicles}: ${oilReportSummary.ok}`,
      "",
      `${oilReportCopy.requiresImmediateService}:`,
      ...(immediateRows.length
        ? immediateRows.map((row) => {
            const detail =
              row.status === "overdue" && row.overdueKm != null
                ? `${oilReportCopy.overdueBy} ${formatNumber(row.overdueKm, language)} KM`
                : row.kmRemaining != null
                  ? oilReportCopy.actionDueIn.replace("{km}", `${formatNumber(row.kmRemaining, language)} KM`)
                  : oilReportStatusLabel(row.status);
            return `- ${row.registration} - ${detail}`;
          })
        : [`- ${language === "th" ? "ไม่มี" : "None"}`])
    ].join("\n");

    try {
      await navigator.clipboard.writeText(message);
      setError(null);
      setSuccessMessage(oilReportCopy.copiedSummary);
    } catch (err) {
      console.error("Oil change report copy failed:", err);
      setError(oilReportCopy.copySummaryError);
    }
  };

  return (
    <>
      <div className="mb-6 hidden md:block">
        <Header title={t.weeklyMileage.title} description={t.weeklyMileage.description} />
      </div>

      {loadError ? (
        <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {loadError}
        </div>
      ) : null}

      {showWeeklyMileageDebug && debugInfo ? (
        <section className="mb-4 rounded-2xl border border-amber-200 bg-amber-50/80 p-4 text-xs text-amber-950">
          <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <h3 className="text-sm font-bold text-amber-950">Weekly Mileage Debug</h3>
            <span className="rounded-full border border-amber-300 bg-white/70 px-2.5 py-1 font-semibold">
              development/admin diagnostics
            </span>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div>
              <p className="font-bold uppercase tracking-[0.12em] text-amber-700">User</p>
              <p className="mt-1 break-all">Email: {debugInfo.userEmail ?? "missing"}</p>
              <p className="break-all">ID: {debugInfo.userId ?? "missing"}</p>
              <p className="mt-1 break-all">Supabase: {debugInfo.supabaseUrl}</p>
            </div>
            <div>
              <p className="font-bold uppercase tracking-[0.12em] text-amber-700">Tables</p>
              {Object.entries(debugInfo.tables).map(([label, table]) => (
                <p key={label} className="break-all">{label}: {table}</p>
              ))}
            </div>
            <div>
              <p className="font-bold uppercase tracking-[0.12em] text-amber-700">Row Counts</p>
              {Object.entries(debugInfo.rowCounts).map(([label, count]) => (
                <p key={label}>{label}: {count ?? "not loaded"}</p>
              ))}
            </div>
            <div>
              <p className="font-bold uppercase tracking-[0.12em] text-amber-700">Errors</p>
              {Object.entries(debugInfo.errors).map(([label, message]) => (
                <p key={label} className="break-words">{label}: {message ?? "none"}</p>
              ))}
            </div>
          </div>
          <div className="mt-3 rounded-xl border border-amber-200 bg-white/65 p-3">
            <p className="font-bold uppercase tracking-[0.12em] text-amber-700">Exact Query Filters</p>
            {Object.entries(debugInfo.filters).map(([label, filter]) => (
              <p key={label} className="mt-1 break-words">{label}: {filter}</p>
            ))}
          </div>
        </section>
      ) : null}

      <section className="surface-card mb-4 p-4 sm:p-5">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h3 className="section-title">{t.weeklyMileage.reportingWeekSummary}</h3>
            <p className="section-subtitle">{t.weeklyMileage.reportingWeekSummaryDescription}</p>
          </div>
          {selectedWeekSummary ? (
            <span className="badge-muted">{formatDate(selectedWeekSummary.weekEnding, language)}</span>
          ) : null}
        </div>

        {loading ? (
          <EmptyState title={t.common.loading} description={t.weeklyMileage.loading} />
        ) : loadError ? (
          <EmptyState title={t.weeklyMileage.errorLoad} description={loadError} />
        ) : !selectedWeekSummary ? (
          <EmptyState title={t.weeklyMileage.noDataTitle} description={t.weeklyMileage.noDataDescription} />
        ) : (
          <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-4">
            <div className="subtle-panel p-4 sm:col-span-3 xl:col-span-1">
              <p className="metric-label">{t.weeklyMileage.weeklyDistanceCovered}</p>
              <p className="mt-2 text-[2rem] font-semibold tracking-[-0.05em] text-slate-950">
                {selectedWeekSummary.comparableVehicles > 0
                  ? formatNumber(selectedWeekSummary.weeklyDistance, language)
                  : t.weeklyMileage.weeklyDistanceCoveredUnavailable}
              </p>
            </div>
            <div className="subtle-panel p-4">
              <p className="metric-label">{t.weeklyMileage.highestOdometerThisWeek}</p>
              <p className="mt-2 text-[1.45rem] font-semibold tracking-[-0.04em] text-slate-950">
                {selectedWeekSummary.highestOdometer != null
                  ? formatNumber(selectedWeekSummary.highestOdometer, language)
                  : "-"}
              </p>
            </div>
            <div className="subtle-panel p-4">
              <p className="metric-label">{t.weeklyMileage.lowestOdometerThisWeek}</p>
              <p className="mt-2 text-[1.45rem] font-semibold tracking-[-0.04em] text-slate-950">
                {selectedWeekSummary.lowestOdometer != null
                  ? formatNumber(selectedWeekSummary.lowestOdometer, language)
                  : "-"}
              </p>
            </div>
            <div className="subtle-panel p-4">
              <p className="metric-label">{t.common.entries}</p>
              <p className="mt-2 text-[1.45rem] font-semibold tracking-[-0.04em] text-slate-950">
                {formatNumber(selectedWeekEntries.length, language)}
              </p>
            </div>
          </div>
        )}
      </section>

      <section className="surface-card mb-4 p-4 sm:p-5">
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h3 className="section-title">{oilReportCopy.title}</h3>
            <p className="section-subtitle">{oilReportCopy.description}</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <button
              type="button"
              onClick={() => void downloadOilServicePdf()}
              disabled={generatingOilServicePdf}
              className="btn-primary w-full gap-2 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
            >
              <Download className="h-4 w-4" />
              {generatingOilServicePdf ? oilServicePdfButtonCopy.generating : oilServicePdfButtonCopy.download}
            </button>
            <button
              type="button"
              onClick={() => void downloadLastOilChangesPdf()}
              disabled={generatingLastOilChangesPdf || !oilChangeRows.length}
              className="btn-secondary w-full gap-2 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
            >
              <Download className="h-4 w-4" />
              {generatingLastOilChangesPdf ? oilServicePdfButtonCopy.generating : lastOilChangesPdfButtonCopy.download}
            </button>
            <button
              type="button"
              onClick={() => void copyOilReportSummary()}
              disabled={!oilChangeRows.length}
              className="btn-secondary w-full gap-2 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
            >
              <Copy className="h-4 w-4" />
              {oilReportCopy.copyReportSummary}
            </button>
          </div>
        </div>

        {oilBaselineError ? (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
            {oilBaselineError}
            <span className="mt-1 block font-normal text-amber-700">
              {language === "th"
                ? "ข้อมูลระยะทางรายสัปดาห์ยังโหลดได้ตามปกติ แต่รายงานน้ำมันอาจไม่มีข้อมูลพื้นฐานล่าสุดจนกว่าจะซ่อมตารางหรือสิทธิ์ Supabase"
                : "Weekly mileage records are still loaded. Oil service reporting may miss saved baselines until the Supabase table or policy is repaired."}
            </span>
          </div>
        ) : null}

        <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {[
            { label: oilReportCopy.overdueVehicles, value: oilReportSummary.overdue, className: "text-rose-700" },
            { label: oilReportCopy.urgentVehicles, value: oilReportSummary.urgent, className: "text-orange-700" },
            { label: oilReportCopy.dueSoonVehicles, value: oilReportSummary.dueSoon, className: "text-amber-700" },
            { label: oilReportCopy.reviewRequired, value: oilReportSummary.reviewRequired, className: "text-sky-700" },
            { label: oilReportCopy.okVehicles, value: oilReportSummary.ok, className: "text-emerald-700" }
          ].map((item) => (
            <div key={item.label} className="rounded-[0.85rem] border border-slate-200 bg-white/85 px-3 py-3">
              <p className="metric-label">{item.label}</p>
              <p className={`mt-1 text-2xl font-bold tracking-normal ${item.className}`}>
                {formatNumber(item.value, language)}
              </p>
            </div>
          ))}
        </div>

        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
          {[
            { label: oilReportCopy.exportAll, scope: "all", suffix: "all" },
            { label: oilReportCopy.exportOverdue, scope: "overdue", suffix: "overdue" },
            { label: oilReportCopy.exportUrgentOverdue, scope: "urgent_overdue", suffix: "urgent-overdue" },
            { label: oilReportCopy.exportDueSoon, scope: "due_soon", suffix: "due-soon" },
            { label: oilReportCopy.exportReview, scope: "review_required", suffix: "review-required" }
          ].map((option) => (
            <button
              key={option.scope}
              type="button"
              onClick={() => exportOilServiceReport(option.scope as OilReportScope, option.suffix)}
              disabled={!getOilReportRows(option.scope as OilReportScope).length}
              className="btn-secondary min-h-[44px] justify-center gap-2 px-3 text-xs disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Download className="h-4 w-4" />
              {option.label}
            </button>
          ))}
        </div>
      </section>

      <section className="surface-card mb-4 p-4 sm:p-5">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h3 className="section-title">{t.weeklyMileage.oil.title}</h3>
            <p className="section-subtitle">{t.weeklyMileage.oil.description}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {(["all", "overdue", "urgent", "due_soon", "review_required", "not_set", "ok"] as OilFilter[]).map((filter) => (
              <button
                key={filter}
                type="button"
                onClick={() => setOilFilter(filter)}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                  oilFilter === filter
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                }`}
              >
                {filter === "all" ? oilReportCopy.all : oilStatusLabel(filter)}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <EmptyState title={t.common.loading} description={t.weeklyMileage.loading} />
        ) : loadError ? (
          <EmptyState title={t.weeklyMileage.errorLoad} description={loadError} />
        ) : oilChangeRows.length === 0 ? (
          <EmptyState title={t.weeklyMileage.oil.noVehiclesTitle} description={t.weeklyMileage.oil.noVehiclesDescription} />
        ) : (
          <>
            <div className="mb-5 grid gap-3 md:grid-cols-3">
              {[
                {
                  key: "overdue",
                  label: oilReportCopy.overdueVehicles,
                  value: oilSummary.overdue,
                  helper: oilReportCopy.requiresImmediateService,
                  className: "border-rose-300 bg-rose-50 text-rose-800 hover:border-rose-400"
                },
                {
                  key: "urgent",
                  label: oilReportCopy.urgentVehicles,
                  value: oilSummary.urgent,
                  helper: oilReportCopy.dueWithin1000,
                  className: "border-orange-300 bg-orange-50 text-orange-800 hover:border-orange-400"
                },
                {
                  key: "due_soon",
                  label: oilReportCopy.dueSoonVehicles,
                  value: oilSummary.due_soon,
                  helper: oilReportCopy.dueWithin3000,
                  className: "border-amber-300 bg-amber-50 text-amber-800 hover:border-amber-400"
                }
              ].map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setOilFilter(item.key as OilFilter)}
                  className={`rounded-lg border px-4 py-4 text-left transition duration-200 hover:-translate-y-0.5 hover:shadow-lg ${item.className}`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-xs font-bold uppercase text-current/70">{item.label}</p>
                      <p className="mt-1 text-sm font-medium text-current/75">{item.helper}</p>
                    </div>
                    <AlertTriangle aria-hidden="true" className="h-5 w-5 shrink-0 text-current" />
                  </div>
                  <p className="mt-4 text-4xl font-bold tracking-normal text-current">{formatNumber(item.value, language)}</p>
                </button>
              ))}
            </div>

            <div className="mb-5 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <h4 className="text-sm font-bold uppercase tracking-normal text-slate-900">
                    {oilReportCopy.weeklyMileageUpdateStatus}
                  </h4>
                  <p className="mt-1 text-sm font-semibold text-slate-500">
                    {oilReportCopy.vehiclesChecked}: {formatNumber(weeklyMileageUpdateSummary.total, language)}
                  </p>
                </div>
                <div className="grid gap-2 sm:grid-cols-2 lg:min-w-[420px]">
                  {[
                    {
                      key: "updated",
                      label: oilReportCopy.updatedThisWeek,
                      value: weeklyMileageUpdateSummary.updatedThisWeek,
                      className: "border-emerald-200 bg-emerald-50 text-emerald-800"
                    },
                    {
                      key: "not-updated",
                      label: oilReportCopy.notUpdatedThisWeek,
                      value: weeklyMileageUpdateSummary.notUpdatedThisWeek,
                      className: "border-amber-200 bg-amber-50 text-amber-800"
                    }
                  ].map((item) => (
                    <div key={item.key} className={`rounded-lg border px-3 py-2 ${item.className}`}>
                      <p className="text-xs font-bold uppercase leading-4 tracking-normal text-current/70">{item.label}</p>
                      <p className="mt-1 text-2xl font-bold tracking-normal text-current">
                        {formatNumber(item.value, language)}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {[
                  {
                    key: "all",
                    label: oilReportCopy.all
                  },
                  {
                    key: "updated_this_week",
                    label: oilReportCopy.updatedThisWeek
                  },
                  {
                    key: "not_updated_this_week",
                    label: oilReportCopy.notUpdatedThisWeek
                  }
                ].map((filter) => (
                  <button
                    key={filter.key}
                    type="button"
                    onClick={() => setWeeklyMileageUpdateFilter(filter.key as WeeklyMileageUpdateFilter)}
                    className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                      weeklyMileageUpdateFilter === filter.key
                        ? "border-slate-900 bg-slate-900 text-white"
                        : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                    }`}
                  >
                    {filter.label}
                  </button>
                ))}
              </div>
            </div>

            {filteredOilChangeRows.length === 0 ? (
              <EmptyState title={t.weeklyMileage.oil.noVehiclesInStatusTitle} description={t.weeklyMileage.oil.noVehiclesInStatusDescription} />
            ) : (
              <div className="space-y-4">
                {filteredOilChangeRows.map((row) => {
                  const vehicleLogs = appendBaselineHistoryLog(
                    row.registration,
                    serviceLogsByVehicle.get(normalizeReg(row.registration)) ?? []
                  );
                  const primaryAction =
                    row.status === "not_set"
                      ? oilReportCopy.setBaseline
                      : oilReportCopy.markOilChanged;
                  const progress = getServiceProgress(row);
                  const serviceHistoryCount =
                    vehicleLogs.length ||
                    (row.lastOilChangeDate && row.lastOilChangeOdometer != null ? 1 : 0);
                  const weeklyMileageUpdatedThisWeek = row.weeklyMileageUpdatedThisWeek;
                  const weeklyMileageAddedAge = formatWeeklyMileageAddedAge(row.lastWeeklyMileageAddedAt);
                  const oilCardMetricBoxes = [
                    {
                      key: "current-odometer",
                      className: "border-white/80 bg-white/70",
                      content: (
                        <>
                          <p className="metric-label">{oilReportCopy.currentOdometer}</p>
                          <p className="mt-1 text-lg font-bold text-slate-950">
                            {row.currentOdometer == null ? oilReportCopy.noData : formatKmValue(row.currentOdometer)}
                          </p>
                        </>
                      )
                    },
                    {
                      key: "next-service-due",
                      className: "border-white/80 bg-white/70",
                      content: (
                        <>
                          <p className="metric-label">{oilReportCopy.nextServiceDue}</p>
                          <p className="mt-1 text-lg font-bold text-slate-950">{formatKmValue(row.nextOilChangeDueOdometer)}</p>
                        </>
                      )
                    },
                    {
                      key: "km-remaining",
                      className: "border-white/80 bg-white/70",
                      content: (
                        <>
                          <p className="metric-label">{oilReportCopy.kmRemaining}</p>
                          <p className={`mt-1 text-2xl font-bold tracking-normal ${kmRemainingClass(row.kmRemaining)}`}>
                            {row.kmRemaining == null ? "-" : formatKmValue(row.kmRemaining)}
                          </p>
                        </>
                      )
                    },
                    {
                      key: "last-weekly-mileage",
                      className:
                        row.lastWeeklyMileageDate && !weeklyMileageUpdatedThisWeek
                          ? "border-amber-300 bg-amber-50"
                          : "border-white/80 bg-white/70",
                      content: (
                        <>
                          <p className="mt-1.5 text-[10px] font-bold uppercase leading-4 tracking-normal text-slate-500">
                            {oilReportCopy.lastWeeklyMileageAdded}
                          </p>
                          {row.lastWeeklyMileageDate ? (
                            <>
                              <p className="mt-1 text-base font-bold text-slate-950">
                                {formatDate(row.lastWeeklyMileageDate, language)}
                              </p>
                              <p className="mt-1 text-xs font-semibold text-slate-600">
                                {oilReportCopy.odometer}: {formatKmValue(row.lastWeeklyMileageOdometer)}
                              </p>
                              <div className="mt-2 flex flex-wrap items-center gap-2">
                                <span
                                  className={`inline-flex rounded-full px-2 py-0.5 text-xs font-bold ${
                                    weeklyMileageUpdatedThisWeek
                                      ? "bg-emerald-100 text-emerald-700"
                                      : "bg-amber-100 text-amber-800"
                                  }`}
                                >
                                  {weeklyMileageUpdatedThisWeek
                                    ? oilReportCopy.updatedThisWeek
                                    : oilReportCopy.notUpdatedThisWeek}
                                </span>
                                {weeklyMileageAddedAge ? (
                                  <span className="text-xs font-semibold text-slate-500">
                                    {weeklyMileageAddedAge}
                                  </span>
                                ) : null}
                              </div>
                            </>
                          ) : (
                            <p className="mt-1 text-sm font-semibold text-slate-500">
                              {oilReportCopy.noWeeklyMileageFound}
                            </p>
                          )}
                        </>
                      )
                    }
                  ];

                  return (
                    <article
                      key={row.registration}
                      className={`rounded-lg border p-4 transition duration-200 hover:-translate-y-0.5 hover:shadow-xl sm:p-5 ${oilCardClass(row.status)}`}
                    >
                      <div className="grid gap-4 xl:grid-cols-[minmax(190px,0.68fr)_minmax(0,1.8fr)_minmax(190px,0.52fr)] xl:items-start">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h4 className="text-2xl font-bold tracking-normal text-slate-950">{row.registration}</h4>
                            <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-bold ${oilStatusClass(row.status)}`}>
                              <OilStatusIcon status={row.status} />
                              {oilStatusLabelForRow(row)}
                            </span>
                          </div>
                          <p className="mt-2 text-sm font-medium text-slate-600">
                            {row.driverName || oilReportCopy.noDriverAssigned} | {vehicleTypeLabel(row.vehicleType)}
                          </p>
                          <p className="mt-3 text-base font-bold uppercase text-slate-900">
                            {actionLine(row)}
                          </p>
                          {row.reviewReasons.length ? (
                            <p className="mt-2 text-xs font-semibold text-sky-700">{row.reviewReasons.map(reviewReasonLabel).join("; ")}</p>
                          ) : null}
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                          {oilCardMetricBoxes.map((box) => (
                            <div key={box.key} className={`min-h-[116px] rounded-lg border p-3 ${box.className}`}>
                              {box.content}
                            </div>
                          ))}
                        </div>

                        <div className="flex flex-col gap-2 sm:flex-row xl:flex-col">
                          <button type="button" onClick={() => openServiceModal(row.status === "not_set" ? "set" : "mark", row)} className="btn-primary w-full justify-center gap-2 shadow-lg shadow-slate-900/10">
                            {row.status === "not_set" ? <Plus className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
                            {primaryAction}
                          </button>
                          <button type="button" onClick={() => openServiceModal(row.status === "not_set" ? "set" : "edit", row)} className="btn-secondary w-full justify-center gap-2">
                            <Pencil className="h-4 w-4" />
                            {row.status === "not_set" ? oilReportCopy.setBaseline : oilReportCopy.edit}
                          </button>
                          <button type="button" onClick={() => void openServiceHistory(row.registration)} className="btn-secondary w-full justify-center gap-2">
                            <History className="h-4 w-4" />
                            {oilReportCopy.serviceHistory}
                          </button>
                        </div>
                      </div>

                      <div className="mt-4">
                        <div className="mb-2 flex items-center justify-between gap-3 text-xs font-semibold text-slate-500">
                          <span>{oilReportCopy.oilServiceUsage}</span>
                          <span>{progress == null ? oilReportCopy.waitingForBaseline : oilReportCopy.percentUsed.replace("{percent}", progress.displayPercent)}</span>
                        </div>
                        <div className="h-2.5 overflow-hidden rounded-full bg-white/80 ring-1 ring-slate-200/70">
                          <div
                            className={`h-full rounded-full transition-all duration-500 ${progressBarClass(row.status)}`}
                            style={{ width: `${progress?.barPercent ?? 0}%` }}
                          />
                        </div>
                      </div>

                      <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-5">
                        <div>
                          <p className="metric-label">{oilReportCopy.lastOilChange}</p>
                          <p className="mt-1 font-semibold text-slate-900">{row.lastOilChangeDate ? formatDate(row.lastOilChangeDate, language) : oilReportCopy.notSet}</p>
                        </div>
                        <div>
                          <p className="metric-label">{oilReportCopy.lastOdometer}</p>
                          <p className="mt-1 font-semibold text-slate-900">{formatKmValue(row.lastOilChangeOdometer)}</p>
                        </div>
                        <div>
                          <p className="metric-label">{oilReportCopy.interval}</p>
                          <p className="mt-1 font-semibold text-slate-900">{formatKmValue(row.oilChangeIntervalKm)} KM</p>
                        </div>
                        <div>
                          <p className="metric-label">{oilReportCopy.overdueBy}</p>
                          <p className="mt-1 font-semibold text-rose-700">{row.overdueKm == null ? "-" : formatKmValue(row.overdueKm)}</p>
                        </div>
                        <div>
                          <p className="metric-label">{oilReportCopy.history}</p>
                          <p className="mt-1 font-semibold text-slate-900">{serviceHistoryCount ? `${formatNumber(serviceHistoryCount, language)} ${oilReportCopy.records}` : oilReportCopy.noRecords}</p>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </>
        )}
      </section>

      <section className="surface-card p-5 sm:p-6">
        <form onSubmit={handleSubmit} className="max-w-[780px]">
          <div className="mb-4">
            <h3 className="section-title">
              {isEditing ? t.weeklyMileage.editEntry : t.weeklyMileage.addEntry}
            </h3>
            <p className="section-subtitle">
              {isEditing ? t.weeklyMileage.helperEdit : t.weeklyMileage.helperAdd}
            </p>
          </div>

          <div className="form-section">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="form-field">
                <label className="form-label form-label-required">{t.weeklyMileage.weekEnding}</label>
                <input
                  type="date"
                  required
                  value={form.week_ending}
                  onChange={(event) => {
                    const nextWeekEnding = event.target.value;
                    setForm((current) => ({ ...current, week_ending: nextWeekEnding }));
                    rememberWeekEnding(nextWeekEnding);
                  }}
                  onInvalid={handleInvalid}
                  onInput={clearValidationMessage}
                  className="form-input bg-white"
                />
                <label className="mt-3 flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700">
                  <input
                    type="checkbox"
                    checked={multiEntryMode}
                    onChange={(event) => setMultiEntryMode(event.target.checked)}
                    className="mt-1 h-4 w-4 rounded border-slate-300 text-brand-600"
                  />
                  <span>
                    <span className="block">{fastEntryCopy.multiEntryMode}</span>
                    {multiEntryMode && form.week_ending ? (
                      <span className="mt-1 block text-xs font-normal text-slate-500">
                        {fastEntryCopy.dateWillRemain.replace("{date}", formatDate(form.week_ending, language))}
                      </span>
                    ) : null}
                  </span>
                </label>
              </div>

              <div className="form-field">
                <label className="form-label form-label-required">{t.weeklyMileage.driver}</label>
                <select
                  ref={driverSelectRef}
                  required
                  value={form.driver_id}
                  onChange={(event) => {
                    clearValidationMessage(event);
                    handleDriverChange(event.target.value);
                  }}
                  onInvalid={handleInvalid}
                  className="form-input bg-white"
                >
                  <option value="">{t.weeklyMileage.selectDriver}</option>
                  {drivers.map((driver) => (
                    <option key={driver.id} value={String(driver.id)}>
                      {driver.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-field">
                <label className="form-label form-label-required">{t.weeklyMileage.vehicleReg}</label>
                <input
                  ref={vehicleInputRef}
                  list="weekly-mileage-vehicle-options"
                  required
                  placeholder={assignmentCopy.searchRegistration}
                  value={form.vehicle_reg}
                  onChange={(event) => handleVehicleRegChange(event.target.value)}
                  onInvalid={handleInvalid}
                  onInput={clearValidationMessage}
                  className="form-input bg-white"
                />
                <datalist id="weekly-mileage-vehicle-options">
                  {activeVehicles.map((vehicle) => {
                    const registration = vehicle.vehicle_reg || vehicle.registration || "";
                    const vehicleType = vehicle.vehicle_type ? ` - ${vehicle.vehicle_type}` : "";
                    return (
                      <option key={vehicle.id || registration} value={registration}>
                        {registration}{vehicleType}
                      </option>
                    );
                  })}
                </datalist>
                <p className="form-helper">
                  {assignmentLoadError
                    ? assignmentLoadError
                    : showMultipleAssignedDrivers
                      ? assignmentCopy.multipleDriversAssigned
                      : showNoAssignedDriver
                        ? assignmentCopy.noDriverAssigned
                        : hasManualAssignmentMismatch
                          ? assignmentCopy.assignmentMismatch
                          : selectedDriverAssignedVehicleReg?.trim()
                    ? t.weeklyMileage.autoFilledVehicle
                    : t.weeklyMileage.noVehicleAssigned}
                </p>
                {selectedVehicle?.vehicle_type ? (
                  <p className="mt-1 text-xs text-slate-500">
                    {assignmentCopy.vehicleType}: {selectedVehicle.vehicle_type}
                  </p>
                ) : null}
                {!selectedVehicle && form.vehicle_reg ? (
                  <p className="mt-1 text-xs text-slate-500">{assignmentCopy.manualVehicleEntry}</p>
                ) : null}
              </div>

              <div className="form-field">
                <label className="form-label form-label-required">{t.weeklyMileage.mileage}</label>
                <input
                  ref={odometerInputRef}
                  type="number"
                  min="0"
                  step="1"
                  required
                  value={form.mileage}
                  onChange={(event) => setForm((current) => ({ ...current, mileage: event.target.value }))}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && multiEntryMode) {
                      submitActionRef.current = "next";
                    }
                  }}
                  onInvalid={handleInvalid}
                  onInput={clearValidationMessage}
                  className="form-input bg-white"
                />
                <p className="form-helper">
                  {previousVehicleEntry
                    ? `${formatDate(previousVehicleEntry.week_ending, language)} | ${formatNumber(previousVehicleEntry.mileage, language)}`
                    : t.weeklyMileage.noDataDescription}
                </p>
                {weeklyDifference != null && weeklyDifference < 0 ? (
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    {t.weeklyMileage.mileageValidationError}
                  </div>
                ) : null}
              </div>
            </div>

            {error ? <p className="form-error mt-3">{error}</p> : null}
            {successMessage ? <p className="mt-3 text-sm text-emerald-600">{successMessage}</p> : null}

            <div className="sticky bottom-3 z-10 mt-4 flex flex-col gap-2.5 rounded-[1.5rem] border border-slate-200/80 bg-white/95 p-3 shadow-[0_10px_30px_rgba(15,23,42,0.08)] backdrop-blur sm:static sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none sm:flex-row sm:items-center">
              <button type="submit" onClick={() => { submitActionRef.current = "save"; }} disabled={saving} className="btn-primary w-full sm:w-auto disabled:opacity-70">
                {saving ? t.common.saving : isEditing ? t.weeklyMileage.updateEntry : t.weeklyMileage.saveEntry}
              </button>
              {!isEditing ? (
                <button
                  type="submit"
                  onClick={() => {
                    submitActionRef.current = "next";
                  }}
                  disabled={saving}
                  className="btn-secondary w-full sm:w-auto disabled:opacity-70"
                >
                  {saving ? t.common.saving : fastEntryCopy.saveAndAddNext}
                </button>
              ) : null}
              {isEditing ? (
                <button type="button" onClick={() => resetForm()} className="btn-secondary w-full sm:w-auto">
                  {t.common.cancel}
                </button>
              ) : null}
            </div>
          </div>
        </form>
      </section>

      <section className="surface-card mt-4 p-4 sm:p-5">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h3 className="section-title">{t.weeklyMileage.recordsForWeek}</h3>
            <p className="section-subtitle">{t.weeklyMileage.recordsForWeekDescription}</p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <button type="button" onClick={() => previousWeekValue && setSelectedWeek(previousWeekValue)} disabled={!previousWeekValue} className="btn-secondary disabled:opacity-50">
              {t.weeklyMileage.previousWeek}
            </button>
            <select value={selectedWeekValue} onChange={(event) => setSelectedWeek(event.target.value)} className="form-input bg-white sm:min-w-[220px]">
              {availableWeeks.map((week) => (
                <option key={week} value={week}>
                  {formatDate(week, language)}
                </option>
              ))}
            </select>
            <button type="button" onClick={() => nextWeekValue && setSelectedWeek(nextWeekValue)} disabled={!nextWeekValue} className="btn-secondary disabled:opacity-50">
              {t.weeklyMileage.nextWeek}
            </button>
            <button type="button" onClick={exportWeeklyMileage} disabled={!sortedEntries.length} className="btn-secondary gap-2 disabled:opacity-50">
              <Download className="h-4 w-4" />
              {t.common.export}
            </button>
          </div>
        </div>

        {loading ? (
          <EmptyState title={t.common.loading} description={t.weeklyMileage.loading} />
        ) : loadError ? (
          <EmptyState title={t.weeklyMileage.errorLoad} description={loadError} />
        ) : selectedWeekEntries.length === 0 ? (
          <EmptyState title={t.weeklyMileage.noDataTitle} description={t.weeklyMileage.noDataDescription} />
        ) : (
          <>
            <div className="mb-4 flex items-center gap-3 text-sm text-slate-500">
              <span className="badge-muted">{t.weeklyMileage.showingWeek}</span>
              <span>{formatDate(selectedWeekValue, language)}</span>
              <span>{formatNumber(selectedWeekEntries.length, language)} {t.common.entries}</span>
            </div>

            <div className="space-y-3.5 md:hidden">
              {pagedEntries.map((entry) => (
                <div key={entry.id} className="subtle-panel p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="table-driver-name">{entry.driver || "-"}</p>
                      <p className="mt-1 text-sm text-slate-500">{entry.vehicle_reg || "-"}</p>
                    </div>
                    <p className="supporting-date-strong">{formatDate(entry.week_ending, language)}</p>
                  </div>
                  <p className="mt-3 text-base font-semibold text-slate-950">
                    {formatNumber(entry.mileage, language)}
                  </p>
                  <div className="mt-3 flex gap-2">
                    <button type="button" onClick={() => setForm({ id: String(entry.id), week_ending: entry.week_ending, driver_id: String(entry.driver_id), vehicle_reg: entry.vehicle_reg, mileage: String(entry.mileage) })} className="btn-secondary flex-1">
                      {t.common.edit}
                    </button>
                    <button type="button" onClick={() => void handleDelete(String(entry.id))} disabled={deletingId === String(entry.id)} className="btn-danger flex-1 gap-2 disabled:opacity-50">
                      <Trash2 className="h-4 w-4" />
                      {deletingId === String(entry.id) ? t.common.deleting : t.common.delete}
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="hidden md:block">
              <div className="table-shell rounded-2xl">
                <div className="table-scroll">
                  <table className="w-full min-w-[760px] text-sm">
                    <thead>
                      <tr className="bg-slate-50/70 text-slate-600">
                        <th className="table-head-cell text-left">{t.weeklyMileage.table.weekEnding}</th>
                        <th className="table-head-cell text-left">{t.weeklyMileage.table.driver}</th>
                        <th className="table-head-cell text-left">{t.weeklyMileage.table.vehicleReg}</th>
                        <th className="table-head-cell text-right">{t.weeklyMileage.table.mileage}</th>
                        <th className="table-head-cell text-left">{t.weeklyMileage.table.action}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pagedEntries.map((entry) => (
                        <tr key={entry.id} className="enterprise-table-row">
                          <td className="table-body-cell supporting-date-strong">{formatDate(entry.week_ending, language)}</td>
                          <td className="table-body-cell table-driver-name">{entry.driver || "-"}</td>
                          <td className="table-body-cell">{entry.vehicle_reg || "-"}</td>
                          <td className="table-body-cell text-right font-medium text-slate-800">{formatNumber(entry.mileage, language)}</td>
                          <td className="table-body-cell">
                            <div className="flex items-center gap-1.5 whitespace-nowrap">
                              <button type="button" onClick={() => setForm({ id: String(entry.id), week_ending: entry.week_ending, driver_id: String(entry.driver_id), vehicle_reg: entry.vehicle_reg, mileage: String(entry.mileage) })} className="table-action-secondary">
                                {t.common.edit}
                              </button>
                              <button type="button" onClick={() => void handleDelete(String(entry.id))} disabled={deletingId === String(entry.id)} className="table-action-danger disabled:opacity-50">
                                {deletingId === String(entry.id) ? t.common.deleting : t.common.delete}
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="mt-4 flex items-center justify-between gap-3">
              <p className="text-sm text-slate-500">
                {t.common.page} {formatNumber(Math.min(tablePage, selectedWeekTotalPages), language)} {t.common.of} {formatNumber(selectedWeekTotalPages, language)}
              </p>
              <div className="flex gap-2">
                <button type="button" onClick={() => setTablePage((current) => Math.max(1, current - 1))} disabled={tablePage === 1} className="btn-secondary disabled:opacity-50">
                  {t.common.previous}
                </button>
                <button type="button" onClick={() => setTablePage((current) => Math.min(selectedWeekTotalPages, current + 1))} disabled={tablePage >= selectedWeekTotalPages} className="btn-secondary disabled:opacity-50">
                  {t.common.next}
                </button>
              </div>
            </div>
          </>
        )}
      </section>

      <section className="surface-card mt-4 p-4 sm:p-5">
        <details>
          <summary className="cursor-pointer list-none">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="section-title">{t.weeklyMileage.weeklyDistanceByDriver}</h3>
                <p className="section-subtitle">{t.weeklyMileage.weeklyDistanceByDriverDescription}</p>
              </div>
              <span className="badge-muted">{formatNumber(weeklyDistanceByDriverRows.length, language)} {t.common.entries}</span>
            </div>
          </summary>

          {loading ? (
            <div className="mt-4">
              <EmptyState title={t.common.loading} description={t.weeklyMileage.loading} />
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              <div className="grid gap-3.5 lg:grid-cols-[minmax(240px,280px)_minmax(0,1fr)]">
                <div className="form-field">
                  <label className="form-label">{t.weeklyMileage.compareDriver}</label>
                  <select value={comparisonDriverId} onChange={(event) => setComparisonDriverId(event.target.value)} className="form-input bg-white">
                    <option value="">{t.weeklyMileage.selectDriver}</option>
                    {comparisonDrivers.map((driver) => (
                      <option key={driver.id} value={String(driver.id)}>
                        {driver.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="subtle-panel p-4">
                  <p className="text-sm font-semibold text-slate-900">{t.weeklyMileage.weeklyDistanceCovered}</p>
                  {weeklyDistanceByDriverRows.length === 0 ? (
                    <p className="mt-3 text-sm text-slate-500">{t.weeklyMileage.weeklyDistanceCoveredUnavailable}</p>
                  ) : (
                    <div className="mt-3 space-y-2">
                      {weeklyDistanceByDriverRows.slice(0, 3).map((row) => (
                        <div key={`${row.driverId}-${row.latestWeekEnding}`} className="flex items-center justify-between gap-3 border-b border-slate-100/70 pb-2 last:border-b-0 last:pb-0">
                          <div className="min-w-0">
                            <p className="table-driver-name truncate">{row.driver}</p>
                            <p className="mt-0.5 text-xs text-slate-400">{row.vehicleReg}</p>
                          </div>
                          <p className="text-sm font-semibold text-slate-950">{formatNumber(row.weeklyDistance!, language)}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {!selectedComparison ? (
                <div className="subtle-panel flex min-h-[180px] items-center justify-center p-5">
                  <EmptyState title={t.weeklyMileage.compareDriver} description={t.weeklyMileage.selectDriverToCompare} />
                </div>
              ) : selectedComparison.unusual || !selectedComparison.previousWeekEnding ? (
                <div className="subtle-panel flex min-h-[180px] items-center justify-center p-5">
                  <EmptyState title={t.weeklyMileage.weeklyDistanceCovered} description={t.weeklyMileage.weeklyComparisonHistoryDescription} />
                </div>
              ) : (
                <div className="grid gap-3.5 xl:grid-cols-[minmax(0,1.05fr)_minmax(260px,0.95fr)]">
                  <div className="subtle-panel p-4">
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                      <div>
                        <p className="metric-label">{t.weeklyMileage.currentReportingWeek}</p>
                        <p className="mt-1 font-semibold text-slate-950">{formatDate(selectedComparison.latestWeekEnding, language)}</p>
                      </div>
                      <div>
                        <p className="metric-label">{t.weeklyMileage.currentOdometer}</p>
                        <p className="mt-1 font-semibold text-slate-950">{formatNumber(selectedComparison.latestOdometer, language)}</p>
                      </div>
                      <div>
                        <p className="metric-label">{t.weeklyMileage.selectedVehicleReg}</p>
                        <p className="mt-1 font-semibold text-slate-950">{selectedComparison.vehicleReg || "-"}</p>
                      </div>
                      <div>
                        <p className="metric-label">{t.weeklyMileage.previousReportingWeek}</p>
                        <p className="mt-1 font-semibold text-slate-950">{formatDate(selectedComparison.previousWeekEnding!, language)}</p>
                      </div>
                      <div>
                        <p className="metric-label">{t.weeklyMileage.previousOdometer}</p>
                        <p className="mt-1 font-semibold text-slate-950">{formatNumber(selectedComparison.previousOdometer!, language)}</p>
                      </div>
                      <div>
                        <p className="metric-label">{t.weeklyMileage.weeklyDistanceCovered}</p>
                        <p className="mt-1 font-semibold text-slate-950">{formatNumber(selectedComparison.weeklyDistance!, language)}</p>
                      </div>
                    </div>
                  </div>

                  <div className="subtle-panel p-4">
                    <p className="text-sm font-semibold text-slate-900">{t.weeklyMileage.weeklyComparisonHistory}</p>
                    <div className="mt-3 space-y-2">
                      {selectedComparisonHistory.map((entry) => (
                        <div key={entry.id} className="flex items-center justify-between gap-3 border-b border-slate-100/70 pb-2 last:border-b-0 last:pb-0">
                          <div>
                            <p className="supporting-date-strong text-slate-800">{formatDate(entry.week_ending, language)}</p>
                            <p className="mt-0.5 text-xs text-slate-400">{entry.vehicle_reg || "-"}</p>
                          </div>
                          <p className="text-sm font-semibold text-slate-950">{formatNumber(entry.mileage, language)}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </details>
      </section>

      {serviceModal ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/45 p-3 sm:items-center">
          <div className="max-h-[92vh] w-full max-w-[620px] overflow-y-auto rounded-lg bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
              <div>
                <h3 className="text-lg font-semibold text-slate-950">
                  {serviceModal.mode === "mark"
                    ? t.weeklyMileage.oil.markOilChanged
                    : serviceModal.mode === "edit"
                      ? t.weeklyMileage.oil.editBaseline
                      : t.weeklyMileage.oil.setOilChangeBaseline}
                </h3>
                <p className="mt-1 text-sm text-slate-500">{serviceModal.registration} | {serviceModal.vehicleName}</p>
              </div>
              <button type="button" onClick={closeServiceModal} className="table-action-secondary" aria-label={t.weeklyMileage.oil.closeServiceForm}>
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSaveService} className="p-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="form-field">
                  <label className="form-label form-label-required">{t.weeklyMileage.oil.lastOilChangeDate}</label>
                  <input
                    type="date"
                    required
                    value={serviceForm.serviceDate}
                    onChange={(event) => setServiceForm((current) => ({ ...current, serviceDate: event.target.value }))}
                    className="form-input bg-white"
                  />
                </div>
                <div className="form-field">
                  <label className="form-label form-label-required">{t.weeklyMileage.oil.lastOilChangeOdometer}</label>
                  <input
                    type="number"
                    required
                    min="0"
                    step="1"
                    value={serviceForm.serviceOdometer}
                    onChange={(event) => setServiceForm((current) => ({ ...current, serviceOdometer: event.target.value }))}
                    className="form-input bg-white"
                  />
                  <p className="form-helper">{t.weeklyMileage.oil.oilChangeOdometerHelper}</p>
                </div>
                <div className="form-field">
                  <label className="form-label form-label-required">{t.weeklyMileage.oil.intervalKm}</label>
                  <input
                    type="number"
                    required
                    min="1"
                    step="1"
                    value={serviceForm.intervalKm}
                    onChange={(event) => setServiceForm((current) => ({ ...current, intervalKm: event.target.value }))}
                    className="form-input bg-white"
                  />
                </div>
                <div className="form-field">
                  <label className="form-label">{t.weeklyMileage.notes}</label>
                  <input
                    value={serviceForm.notes}
                    onChange={(event) => setServiceForm((current) => ({ ...current, notes: event.target.value }))}
                    placeholder={t.weeklyMileage.oil.optionalServiceNote}
                    className="form-input bg-white"
                  />
                </div>
              </div>

              {error ? <p className="form-error mt-4">{error}</p> : null}

              <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button type="button" onClick={closeServiceModal} disabled={savingService} className="btn-secondary disabled:opacity-50">
                  {t.common.cancel}
                </button>
                <button type="submit" disabled={savingService} className="btn-primary disabled:opacity-60">
                  {savingService ? t.common.saving : serviceModal.mode === "mark" ? t.weeklyMileage.oil.saveOilChange : t.common.save}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {historyVehicleReg ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/45 p-3 sm:items-center">
          <div className="max-h-[92vh] w-full max-w-[720px] overflow-y-auto rounded-lg bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
              <div>
                <h3 className="text-lg font-semibold text-slate-950">{t.weeklyMileage.oil.serviceHistory}</h3>
                <p className="mt-1 text-sm text-slate-500">{historyVehicleReg}</p>
              </div>
              <button type="button" onClick={() => setHistoryVehicleReg(null)} className="table-action-secondary" aria-label={t.weeklyMileage.oil.closeServiceHistory}>
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-5">
              {selectedHistoryLogs.length === 0 ? (
                <EmptyState title={t.weeklyMileage.oil.noServiceHistoryTitle} description={t.weeklyMileage.oil.noServiceHistoryDescription} />
              ) : (
                <div className="space-y-3">
                  {selectedHistoryLogs.map((log) => (
                    <div key={log.id} className="subtle-panel p-4">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <p className="font-semibold text-slate-950">{formatDate(log.service_date, language)}</p>
                          <p className="mt-1 text-sm text-slate-500">{log.notes || t.weeklyMileage.oil.oilChangedNote}</p>
                        </div>
                        <span className="badge-muted">{log.service_type === "oil_change" ? t.weeklyMileage.oil.oilChange : log.service_type}</span>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
                        <div>
                          <p className="metric-label">{t.weeklyMileage.oil.serviceOdometer}</p>
                          <p className="mt-1 font-semibold text-slate-900">{formatKmValue(log.odometer)}</p>
                        </div>
                        <div>
                          <p className="metric-label">{t.weeklyMileage.oil.intervalKm}</p>
                          <p className="mt-1 font-semibold text-slate-900">{formatKmValue(log.interval_km)}</p>
                        </div>
                        <div>
                          <p className="metric-label">{t.weeklyMileage.nextServiceDue}</p>
                          <p className="mt-1 font-semibold text-slate-900">{formatKmValue(log.next_service_due_odometer ?? (log.interval_km != null ? log.odometer + log.interval_km : null))}</p>
                        </div>
                        <div>
                          <p className="metric-label">{t.weeklyMileage.oil.recordedAt}</p>
                          <p className="mt-1 font-semibold text-slate-900">{log.created_at ? formatDate(log.created_at.slice(0, 10), language) : "-"}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
