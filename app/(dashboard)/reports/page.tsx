"use client";

import {
  BarChart3,
  BookOpenCheck,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Droplets,
  FileText,
  Gauge,
  Loader2,
  Route,
  Sparkles,
  Wrench,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  fetchBookingDiaryEntries,
  fetchClients,
  fetchDrivers,
  fetchFuelLogsForExport,
  fetchVehicleMonthlyFuelSpend,
  fetchVehicleMonthlyPerformance,
  fetchVehicles,
  fetchWeeklyMileage,
} from "@/lib/data";
import { normalizeFuelLogLocation, shouldShowFuelLogLocationOption } from "@/lib/fuel-log-location";
import {
  buildFuelSpendManagementReport,
  getFuelSpendReportLogCost,
  normalizeFuelSpendReportVehicleRegistration,
} from "@/lib/fuel-spend-report";
import { useLanguage } from "@/lib/language-provider";
import { buildPerformanceManagement } from "@/lib/vehicle-performance-management";
import { translations } from "@/lib/translations";
import { buildWeeklyMileageComparisonReport } from "@/lib/weekly-mileage-report";
import { formatDate, normalizeDisplayName, today } from "@/lib/utils";
import type { BookingDiaryEntry, Client, Driver, FuelLogWithDriver, Vehicle, WeeklyMileageEntry } from "@/types/database";

type DatePreset = "today" | "this_week" | "last_week" | "this_month" | "last_month" | "custom";

type DateRange = {
  fromDate: string;
  preset: DatePreset;
  toDate: string;
};

type FuelSpendFilters = DateRange & {
  driver: string;
  fuelType: string;
  location: string;
  vehicleReg: string;
};

type VehicleReportFilters = {
  year: number;
  month: number | "";
  vehicleReg: string;
  sort: "balance" | "revenue" | "margin" | "fuel";
};

type OperationsReportFilters = DateRange & {
  clientId: string;
  driver: string;
  vehicleReg: string;
  routeQuery: string;
};

type ReportKey = "management" | "vehicle" | "fuel" | "operations" | "maintenance";

type ReportsCopy = (typeof translations)[keyof typeof translations]["reports"];

function toDateKey(date: Date) {
  const timezoneOffsetMs = date.getTimezoneOffset() * 60 * 1000;
  return new Date(date.getTime() - timezoneOffsetMs).toISOString().slice(0, 10);
}

function getDateRange(preset: DatePreset): DateRange {
  const now = new Date();
  const day = now.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() + mondayOffset);

  if (preset === "today") return { preset, fromDate: today(), toDate: today() };

  if (preset === "this_week") {
    return { preset, fromDate: toDateKey(startOfWeek), toDate: today() };
  }

  if (preset === "last_week") {
    const from = new Date(startOfWeek);
    from.setDate(from.getDate() - 7);
    const to = new Date(startOfWeek);
    to.setDate(to.getDate() - 1);
    return { preset, fromDate: toDateKey(from), toDate: toDateKey(to) };
  }

  if (preset === "last_month") {
    const firstDay = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastDay = new Date(now.getFullYear(), now.getMonth(), 0);
    return { preset, fromDate: toDateKey(firstDay), toDate: toDateKey(lastDay) };
  }

  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
  return {
    preset: preset === "custom" ? "custom" : "this_month",
    fromDate: toDateKey(firstDay),
    toDate: today(),
  };
}

function periodLabel(fromDate: string, toDate: string, language: "en" | "th") {
  return `${fromDate ? formatDate(fromDate, language) : "-"} - ${toDate ? formatDate(toDate, language) : "-"}`;
}

function uiCopy(language: "en" | "th") {
  if (language === "th") {
    return {
      eyebrow: "REPORTS CENTRE",
      title: "ศูนย์รายงาน",
      intro: "สร้างรายงานที่พร้อมใช้สำหรับผู้บริหารจากข้อมูลจริงในระบบ EES",
      live: "ข้อมูลสดจากระบบ",
      management: "Management Report",
      managementDesc: "ภาพรวมผู้บริหารที่รวมผลการดำเนินงานของรถ น้ำมัน งานปฏิบัติการ และการบำรุงรักษาไว้ในที่เดียว",
      managementNote: "ใช้เป็นรายงานหลักสำหรับประชุมหรือทบทวนผลการดำเนินงาน",
      configure: "ตั้งค่ารายงาน",
      close: "ปิด",
      fuelLogs: "รายการน้ำมัน",
      vehicles: "รถ",
      mileageWeeks: "สัปดาห์ระยะทาง",
      quickReports: "รายงานหลัก",
      quickReportsDesc: "เลือกเฉพาะรายงานที่ตอบคำถามทางธุรกิจอย่างชัดเจน",
      vehicle: "Vehicle Performance",
      vehicleDesc: "เปรียบเทียบรายได้ ต้นทุน ยอดคงเหลือ อัตรากำไร และสัดส่วนค่าน้ำมันของรถแต่ละคัน",
      fuel: "Fuel Report",
      fuelDesc: "ดูว่าค่าน้ำมันไปอยู่ที่ไหน ทั้งรถ คนขับ สถานี ปริมาณ และคุณภาพข้อมูล",
      operations: "Operations Report",
      operationsDesc: "สรุปงานจาก Booking Diary เช่น ลูกค้า เส้นทาง งานซ้ำ ปริมาณงาน และการจัดสรรรถ",
      maintenance: "Mileage & Maintenance",
      maintenanceDesc: "ติดตามระยะทางล่าสุด การเปลี่ยนน้ำมันเครื่อง รถที่ใกล้ถึงกำหนด และรายการที่ต้องตรวจสอบ",
      openVehicle: "พิมพ์รายงาน Vehicle Performance",
      openOperations: "พิมพ์รายงาน Operations",
      openMaintenance: "พิมพ์รายงาน Mileage",
      generateFuel: "ดาวน์โหลด Fuel PDF",
      generateMileage: "ดาวน์โหลด Mileage PDF",
      managementSources: "แหล่งข้อมูลสำหรับ Management Report",
      sourceVehicle: "Vehicle Performance",
      sourceFuel: "Fuel",
      sourceOps: "Operations",
      sourceMaintenance: "Mileage & Maintenance",
      sourceReady: "พร้อมใช้งาน",
      sourceViaModule: "ใช้ข้อมูลจากโมดูล",
      featured: "รายงานแนะนำ",
      filters: "ตัวกรองรายงานน้ำมัน",
      weekEnding: "สัปดาห์สิ้นสุด",
      period: "ช่วงเวลา",
      vehicleLabel: "รถ",
      driver: "คนขับ",
      fuelType: "ประเภทน้ำมัน",
      station: "สถานี",
      allVehicles: "รถทั้งหมด",
      allDrivers: "คนขับทั้งหมด",
      allFuelTypes: "น้ำมันทั้งหมด",
      allStations: "ทุกสถานี",
      dateRange: "ช่วงวันที่",
      from: "จาก",
      to: "ถึง",
      today: "วันนี้",
      thisWeek: "สัปดาห์นี้",
      lastWeek: "สัปดาห์ก่อน",
      thisMonth: "เดือนนี้",
      lastMonth: "เดือนก่อน",
      custom: "กำหนดเอง",
      noFuelLogs: "ไม่พบรายการน้ำมันในช่วงที่เลือก",
      noMileageReports: "ยังไม่มีข้อมูลสัปดาห์ระยะทาง",
      noMileageData: "ไม่พบข้อมูลระยะทางสำหรับสัปดาห์ที่เลือก",
      generateError: "ไม่สามารถสร้างรายงานได้",
      loading: "กำลังโหลดข้อมูล...",
      working: "กำลังสร้าง...",
      directPdf: "PDF พร้อมดาวน์โหลดจากหน้านี้",
      sourceLink: "เปิดข้อมูลต้นทาง",
      dataAvailable: "ข้อมูลที่พร้อมใช้ทำรายงาน",
      managementIncludes: "สิ่งที่ Management Report จะสรุป",
      questionVehicle: "รถคันไหนสร้างผลงานทางการเงินได้ดีที่สุด?",
      questionFuel: "เงินค่าน้ำมันไปอยู่ที่ไหน และอะไรควรตรวจสอบ?",
      questionOperations: "ลูกค้า เส้นทาง และปริมาณงานใดกำลังขับเคลื่อนการดำเนินงาน?",
      questionMaintenance: "รถคันไหนวิ่งมากที่สุด และงานบำรุงรักษาใดใกล้ถึงกำหนด?",
      directReport: "สร้าง PDF ได้จากหน้านี้",
      moduleReport: "ตั้งค่าตัวกรองแล้วพิมพ์จากหน้านี้",
      vehicleReportFilters: "ตัวกรองรายงานรถ",
      operationsReportFilters: "ตัวกรองรายงานปฏิบัติการ",
      reportYear: "ปี",
      reportMonth: "เดือน",
      allMonths: "ทุกเดือน",
      reportSort: "เรียงตาม",
      sortBalance: "ยอดคงเหลือ",
      sortRevenue: "รายได้",
      sortMargin: "อัตรากำไร",
      sortFuel: "สัดส่วนน้ำมัน",
      client: "ลูกค้า",
      allClients: "ลูกค้าทั้งหมด",
      routeContains: "ค้นหาเส้นทาง",
      routePlaceholder: "เช่น Lat Krabang, Bangkok Port",
      printReport: "สร้างและพิมพ์รายงาน",
      noVehicleData: "ไม่พบข้อมูล Vehicle Performance สำหรับตัวกรองนี้",
      noBookingData: "ไม่พบงาน Booking Diary สำหรับตัวกรองนี้",
    };
  }

  return {
    eyebrow: "REPORTS CENTRE",
    title: "Reports Centre",
    intro: "Create management-ready reports from the live operational data already held inside EES.",
    live: "Live system data",
    management: "Management Report",
    managementDesc: "One executive view bringing vehicle performance, fuel, operations and maintenance together.",
    managementNote: "Designed to become the main report for management meetings and period reviews.",
    configure: "Configure report",
    close: "Close",
    fuelLogs: "fuel logs",
    vehicles: "vehicles",
    mileageWeeks: "mileage weeks",
    quickReports: "Core reports",
    quickReportsDesc: "Only reports that answer a clear business question are kept here.",
    vehicle: "Vehicle Performance",
    vehicleDesc: "Compare revenue, direct costs, recorded balance, margin and fuel share by vehicle.",
    fuel: "Fuel Report",
    fuelDesc: "Understand where fuel money is going across vehicles, drivers, stations, volume and data quality.",
    operations: "Operations Report",
    operationsDesc: "Summarise Booking Diary activity by customer, route, repeat work, workload and assignment.",
    maintenance: "Mileage & Maintenance",
    maintenanceDesc: "Review latest mileage, weekly movement, oil-service position and vehicles needing attention.",
    openVehicle: "Print Vehicle Performance Report",
    openOperations: "Print Operations Report",
    openMaintenance: "Print Mileage Report",
    generateFuel: "Download Fuel PDF",
    generateMileage: "Download Mileage PDF",
    managementSources: "Management Report data sources",
    sourceVehicle: "Vehicle Performance",
    sourceFuel: "Fuel",
    sourceOps: "Operations",
    sourceMaintenance: "Mileage & Maintenance",
    sourceReady: "Ready",
    sourceViaModule: "Uses module data",
    featured: "Featured report",
    filters: "Fuel report filters",
    weekEnding: "Week ending",
    period: "Period",
    vehicleLabel: "Vehicle",
    driver: "Driver",
    fuelType: "Fuel type",
    station: "Station",
    allVehicles: "All vehicles",
    allDrivers: "All drivers",
    allFuelTypes: "All fuel types",
    allStations: "All stations",
    dateRange: "Date range",
    from: "From",
    to: "To",
    today: "Today",
    thisWeek: "This week",
    lastWeek: "Last week",
    thisMonth: "This month",
    lastMonth: "Last month",
    custom: "Custom",
    noFuelLogs: "No fuel logs were found for the selected period.",
    noMileageReports: "No mileage weeks are available yet.",
    noMileageData: "No mileage data was found for the selected week.",
    generateError: "The report could not be generated.",
    loading: "Loading report data...",
    working: "Generating...",
    directPdf: "PDF can be downloaded directly from this page",
    sourceLink: "Open source data",
    dataAvailable: "Data available for reporting",
    managementIncludes: "What the Management Report will cover",
    questionVehicle: "Which vehicles are producing the strongest financial results?",
    questionFuel: "Where is fuel money going and what needs checking?",
    questionOperations: "Which customers, routes and workloads are driving the operation?",
    questionMaintenance: "Which vehicles are moving most and what service work is approaching?",
    directReport: "Generate the PDF directly here",
    moduleReport: "Choose filters and print directly from this page",
    vehicleReportFilters: "Vehicle report filters",
    operationsReportFilters: "Operations report filters",
    reportYear: "Year",
    reportMonth: "Month",
    allMonths: "All loaded months",
    reportSort: "Rank by",
    sortBalance: "Recorded balance",
    sortRevenue: "Revenue",
    sortMargin: "Margin",
    sortFuel: "Fuel / revenue",
    client: "Customer",
    allClients: "All customers",
    routeContains: "Route contains",
    routePlaceholder: "e.g. Lat Krabang, Bangkok Port",
    printReport: "Generate & Print Report",
    noVehicleData: "No Vehicle Performance data was found for these filters.",
    noBookingData: "No Booking Diary jobs were found for these filters.",
  };
}


type PremiumPdfTone = "purple" | "green" | "amber" | "blue" | "slate";
type PremiumPdfMetric = { label: string; value: string; detail?: string; tone?: PremiumPdfTone };
type PremiumPdfTable = {
  columns: Array<{ label: string; width: number; align?: "left" | "right" | "center" }>;
  rows: string[][];
};

type PremiumPdfPageSize = { width: number; height: number };

const PDF_A4_PORTRAIT: PremiumPdfPageSize = { width: 595, height: 842 };
const PDF_A4_LANDSCAPE: PremiumPdfPageSize = { width: 842, height: 595 };

function reportBinaryFromDataUrl(dataUrl: string) {
  return atob(dataUrl.split(",")[1] ?? "");
}

async function loadReportImage(src: string) {
  const image = new Image();
  const ready = new Promise<HTMLImageElement>((resolve, reject) => {
    image.onload = () => resolve(image);
    image.onerror = reject;
  });
  image.src = src;
  return ready;
}

async function ensureReportFont(language: "en" | "th") {
  if (language !== "th" || typeof FontFace === "undefined") return;
  let found = false;
  document.fonts.forEach((font) => {
    if (font.family === "EesReportThai") found = true;
  });
  if (found) return;
  try {
    const response = await fetch("/fonts/boss-pdf-thai.ttf");
    if (!response.ok) return;
    const font = new FontFace("EesReportThai", await response.arrayBuffer(), { style: "normal", weight: "400" });
    await font.load();
    document.fonts.add(font);
    await document.fonts.ready;
  } catch (error) {
    console.warn("Unable to load EES report Thai font:", error);
  }
}

function reportFontFamily(language: "en" | "th") {
  return language === "th"
    ? '"EesReportThai", Tahoma, Arial, sans-serif'
    : 'Arial, "Helvetica Neue", Helvetica, sans-serif';
}

function buildImagePdf(
  imagePages: Array<{ data: string; height: number; width: number }>,
  pageSize: PremiumPdfPageSize
) {
  const kids = imagePages.map((_, index) => `${3 + index * 3} 0 R`).join(" ");
  const objects: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${kids}] /Count ${imagePages.length} >>`,
  ];

  imagePages.forEach((page, index) => {
    const imageName = `PageImage${index + 1}`;
    const contentStream = `q ${pageSize.width} 0 0 ${pageSize.height} 0 0 cm /${imageName} Do Q`;
    const pageObject = 3 + index * 3;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageSize.width} ${pageSize.height}] /Resources << /XObject << /${imageName} ${pageObject + 2} 0 R >> >> /Contents ${pageObject + 1} 0 R >>`,
      `<< /Length ${contentStream.length} >>\nstream\n${contentStream}\nendstream`,
      `<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.data.length} >>\nstream\n${page.data}\nendstream`,
    );
  });

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;

  const bytes = new Uint8Array(pdf.length);
  for (let index = 0; index < pdf.length; index += 1) bytes[index] = pdf.charCodeAt(index) & 0xff;
  return new Blob([bytes], { type: "application/pdf" });
}

function downloadReportFile(blob: Blob, fileName: string) {
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

class PremiumReportCanvas {
  readonly scale = 2;
  readonly margin = 34;
  readonly bottomMargin = 40;
  readonly pages: Array<{ data: string; height: number; width: number }> = [];
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private y = 0;
  private pageNumber = 0;
  private readonly colors = {
    purple: "#6d28d9",
    purpleDark: "#4c1d95",
    purpleSoft: "#f5f3ff",
    green: "#047857",
    greenSoft: "#ecfdf5",
    amber: "#b45309",
    amberSoft: "#fffbeb",
    blue: "#0369a1",
    blueSoft: "#f0f9ff",
    slate: "#0f172a",
    text: "#334155",
    muted: "#64748b",
    border: "#e2e8f0",
    soft: "#f8fafc",
    white: "#ffffff",
  };

  constructor(
    private readonly title: string,
    private readonly period: string,
    private readonly language: "en" | "th",
    private readonly pageSize: PremiumPdfPageSize,
    private readonly logo: HTMLImageElement | null,
    private readonly filterSummary = "",
  ) {}

  private font(size: number, weight = 500) {
    this.ctx.font = `${weight} ${size * this.scale}px ${reportFontFamily(this.language)}`;
  }

  private measure(value: string, size = 8, weight = 500) {
    this.font(size, weight);
    return this.ctx.measureText(value).width / this.scale;
  }

  private wrap(value: string, maxWidth: number, size = 8, weight = 500) {
    const words = String(value ?? "").split(/\s+/).filter(Boolean);
    if (!words.length) return [""];
    const lines: string[] = [];
    let current = "";
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (this.measure(candidate, size, weight) <= maxWidth) current = candidate;
      else {
        if (current) lines.push(current);
        current = word;
      }
    }
    if (current) lines.push(current);
    return lines;
  }

  text(
    value: string,
    x: number,
    y: number,
    options: { size?: number; weight?: number; color?: string; align?: CanvasTextAlign } = {},
  ) {
    const size = options.size ?? 8;
    this.font(size, options.weight ?? 500);
    this.ctx.fillStyle = options.color ?? this.colors.text;
    this.ctx.textAlign = options.align ?? "left";
    this.ctx.textBaseline = "alphabetic";
    this.ctx.fillText(String(value ?? ""), x * this.scale, y * this.scale);
    this.ctx.textAlign = "left";
  }

  private roundedRect(x: number, y: number, width: number, height: number, radius: number, fill: string, stroke?: string) {
    const ctx = this.ctx;
    const s = this.scale;
    const r = Math.min(radius, width / 2, height / 2) * s;
    const px = x * s, py = y * s, pw = width * s, ph = height * s;
    ctx.beginPath();
    ctx.moveTo(px + r, py);
    ctx.arcTo(px + pw, py, px + pw, py + ph, r);
    ctx.arcTo(px + pw, py + ph, px, py + ph, r);
    ctx.arcTo(px, py + ph, px, py, r);
    ctx.arcTo(px, py, px + pw, py, r);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 0.8 * s;
      ctx.stroke();
    }
  }

  private header() {
    const top = this.margin;
    if (this.logo) {
      const maxWidth = 118;
      const ratio = this.logo.height / this.logo.width;
      const h = Math.min(44, maxWidth * ratio);
      this.ctx.drawImage(this.logo, this.margin * this.scale, top * this.scale, maxWidth * this.scale, h * this.scale);
    } else {
      this.text("EES", this.margin, top + 20, { size: 21, weight: 800, color: this.colors.purpleDark });
    }

    this.text(this.language === "th" ? "รายงานเพื่อการบริหาร" : "MANAGEMENT REPORT", this.margin, top + 55, { size: 6.5, weight: 800, color: this.colors.purpleDark });

    const right = this.pageSize.width - this.margin;
    const generated = new Intl.DateTimeFormat(this.language === "th" ? "th-TH" : "en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date());
    this.text("EXPERT EXPRESS SENDER CO., LTD.", right, top + 8, { align: "right", size: 7, weight: 700, color: this.colors.muted });
    this.text(this.title, right, top + 27, { align: "right", size: 16, weight: 800, color: this.colors.slate });
    this.text(this.period, right, top + 42, { align: "right", size: 8, color: this.colors.muted });
    this.text(`${this.language === "th" ? "สร้างเมื่อ" : "Generated"} ${generated}`, right, top + 54, { align: "right", size: 6.5, color: this.colors.muted });
    if (this.filterSummary) this.text(this.filterSummary, right, top + 64, { align: "right", size: 6.3, color: this.colors.muted });

    this.ctx.fillStyle = this.colors.purple;
    this.ctx.fillRect(this.margin * this.scale, (top + 73) * this.scale, (this.pageSize.width - this.margin * 2) * this.scale, 2.5 * this.scale);
    this.y = top + 90;
  }

  newPage() {
    if (this.pageNumber) this.finishPage();
    this.pageNumber += 1;
    this.canvas = document.createElement("canvas");
    this.canvas.width = this.pageSize.width * this.scale;
    this.canvas.height = this.pageSize.height * this.scale;
    const context = this.canvas.getContext("2d");
    if (!context) throw new Error("Unable to create PDF canvas.");
    this.ctx = context;
    this.ctx.fillStyle = this.colors.white;
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.header();
  }

  private finishPage() {
    const y = this.pageSize.height - 20;
    this.ctx.strokeStyle = this.colors.border;
    this.ctx.lineWidth = 0.5 * this.scale;
    this.ctx.beginPath();
    this.ctx.moveTo(this.margin * this.scale, (y - 10) * this.scale);
    this.ctx.lineTo((this.pageSize.width - this.margin) * this.scale, (y - 10) * this.scale);
    this.ctx.stroke();

    const confidential = this.language === "th"
      ? "Expert Express Sender Co., Ltd. · รายงานเพื่อการบริหารภายใน"
      : "Expert Express Sender Co., Ltd. · Confidential management report";
    this.text(confidential, this.margin, y, { size: 6.5, color: this.colors.muted });
    this.text(`Page ${this.pageNumber}`, this.pageSize.width - this.margin, y, { size: 6.5, color: this.colors.muted, align: "right" });

    this.pages.push({
      data: reportBinaryFromDataUrl(this.canvas.toDataURL("image/jpeg", 0.94)),
      height: this.canvas.height,
      width: this.canvas.width,
    });
  }

  ensureSpace(height: number) {
    if (this.y + height > this.pageSize.height - this.bottomMargin) this.newPage();
  }

  section(title: string, subtitle?: string) {
    this.ensureSpace(subtitle ? 40 : 28);
    this.text(title, this.margin, this.y, { size: 11, weight: 800, color: this.colors.slate });
    this.y += 10;
    if (subtitle) {
      const lines = this.wrap(subtitle, this.pageSize.width - this.margin * 2, 7);
      lines.forEach((line) => {
        this.text(line, this.margin, this.y + 8, { size: 7, color: this.colors.muted });
        this.y += 9;
      });
    }
    this.y += 12;
  }

  metrics(metrics: PremiumPdfMetric[]) {
    const count = metrics.length;
    const gap = 8;
    const width = (this.pageSize.width - this.margin * 2 - gap * (count - 1)) / count;
    const h = 62;
    this.ensureSpace(h + 10);
    metrics.forEach((metric, index) => {
      const x = this.margin + index * (width + gap);
      const tone = metric.tone ?? "purple";
      const fill =
        tone === "green" ? this.colors.greenSoft :
        tone === "amber" ? this.colors.amberSoft :
        tone === "blue" ? this.colors.blueSoft :
        tone === "slate" ? this.colors.soft : this.colors.purpleSoft;
      const accent =
        tone === "green" ? this.colors.green :
        tone === "amber" ? this.colors.amber :
        tone === "blue" ? this.colors.blue :
        tone === "slate" ? this.colors.slate : this.colors.purple;
      this.roundedRect(x, this.y, width, h, 7, fill, this.colors.border);
      this.ctx.fillStyle = accent;
      this.ctx.fillRect(x * this.scale, this.y * this.scale, 3 * this.scale, h * this.scale);
      this.text(metric.label.toUpperCase(), x + 10, this.y + 16, { size: 6.5, weight: 700, color: this.colors.muted });
      this.text(metric.value, x + 10, this.y + 38, { size: 15, weight: 800, color: this.colors.slate });
      if (metric.detail) this.text(metric.detail, x + 10, this.y + 53, { size: 6.5, color: this.colors.muted });
    });
    this.y += h + 14;
  }

  insightBox(title: string, body: string, tone: PremiumPdfTone = "purple") {
    const width = this.pageSize.width - this.margin * 2;
    const lines = this.wrap(body, width - 24, 7.2);
    const h = 30 + lines.length * 10;
    this.ensureSpace(h + 8);
    const fill =
      tone === "green" ? this.colors.greenSoft :
      tone === "amber" ? this.colors.amberSoft :
      tone === "blue" ? this.colors.blueSoft :
      tone === "slate" ? this.colors.soft : this.colors.purpleSoft;
    const accent =
      tone === "green" ? this.colors.green :
      tone === "amber" ? this.colors.amber :
      tone === "blue" ? this.colors.blue :
      tone === "slate" ? this.colors.slate : this.colors.purple;
    this.roundedRect(this.margin, this.y, width, h, 7, fill, this.colors.border);
    this.text(title, this.margin + 12, this.y + 16, { size: 7, weight: 800, color: accent });
    lines.forEach((line, index) => this.text(line, this.margin + 12, this.y + 31 + index * 10, { size: 7.2, color: this.colors.text }));
    this.y += h + 12;
  }

  twoColumnLists(
    left: { title: string; rows: Array<[string, string]> },
    right: { title: string; rows: Array<[string, string]> },
  ) {
    const gap = 12;
    const width = (this.pageSize.width - this.margin * 2 - gap) / 2;
    const maxRows = Math.max(left.rows.length, right.rows.length);
    const h = 34 + maxRows * 22;
    this.ensureSpace(h + 8);

    [left, right].forEach((section, index) => {
      const x = this.margin + index * (width + gap);
      this.roundedRect(x, this.y, width, h, 7, this.colors.white, this.colors.border);
      this.text(section.title, x + 10, this.y + 18, { size: 8, weight: 800, color: this.colors.slate });
      section.rows.forEach(([label, value], rowIndex) => {
        const rowY = this.y + 38 + rowIndex * 22;
        const labelLines = this.wrap(label, width - 70, 7);
        this.text(labelLines[0] ?? "", x + 10, rowY, { size: 7, color: this.colors.text });
        this.text(value, x + width - 10, rowY, { size: 7, weight: 800, color: this.colors.purpleDark, align: "right" });
        if (rowIndex < section.rows.length - 1) {
          this.ctx.strokeStyle = this.colors.border;
          this.ctx.lineWidth = 0.4 * this.scale;
          this.ctx.beginPath();
          this.ctx.moveTo((x + 10) * this.scale, (rowY + 8) * this.scale);
          this.ctx.lineTo((x + width - 10) * this.scale, (rowY + 8) * this.scale);
          this.ctx.stroke();
        }
      });
    });
    this.y += h + 14;
  }

  barList(title: string, rows: Array<{ label: string; value: number; display: string }>, tone: PremiumPdfTone = "purple") {
    this.section(title);
    const max = Math.max(...rows.map((row) => row.value), 1);
    const available = this.pageSize.width - this.margin * 2;
    const labelWidth = Math.min(150, available * 0.32);
    rows.forEach((row) => {
      this.ensureSpace(24);
      this.text(row.label, this.margin, this.y + 8, { size: 7, weight: 600, color: this.colors.text });
      const barX = this.margin + labelWidth;
      const barWidth = available - labelWidth - 70;
      this.roundedRect(barX, this.y, barWidth, 10, 5, this.colors.soft);
      const fill =
        tone === "green" ? this.colors.green :
        tone === "amber" ? this.colors.amber :
        tone === "blue" ? this.colors.blue :
        tone === "slate" ? this.colors.slate : this.colors.purple;
      this.roundedRect(barX, this.y, Math.max(3, barWidth * row.value / max), 10, 5, fill);
      this.text(row.display, this.pageSize.width - this.margin, this.y + 8, { size: 7, weight: 800, align: "right", color: this.colors.slate });
      this.y += 18;
    });
    this.y += 6;
  }

  table(table: PremiumPdfTable, options: { fontSize?: number; rowHeight?: number; maxRows?: number; compact?: boolean } = {}) {
    const fontSize = options.fontSize ?? 7;
    const baseRowHeight = options.rowHeight ?? 19;
    const maxRows = options.maxRows ?? table.rows.length;
    const compact = options.compact ?? false;
    const totalWidth = table.columns.reduce((sum, column) => sum + column.width, 0);
    const scaleWidth = (this.pageSize.width - this.margin * 2) / totalWidth;
    const headerHeight = compact ? 18 : 24;

    const drawHeader = () => {
      let x = this.margin;
      this.ctx.fillStyle = this.colors.purpleSoft;
      this.ctx.fillRect(this.margin * this.scale, this.y * this.scale, (this.pageSize.width - this.margin * 2) * this.scale, headerHeight * this.scale);
      table.columns.forEach((column) => {
        const width = column.width * scaleWidth;
        const align = column.align ?? "left";
        const tx = align === "right" ? x + width - 5 : align === "center" ? x + width / 2 : x + 5;
        this.text(column.label.toUpperCase(), tx, this.y + (compact ? 12 : 15), { size: compact ? 5.5 : 6, weight: 800, color: this.colors.purpleDark, align });
        x += width;
      });
      this.y += headerHeight;
    };

    drawHeader();

    table.rows.slice(0, maxRows).forEach((row, rowIndex) => {
      const cellLines = table.columns.map((column, columnIndex) => {
        const width = column.width * scaleWidth;
        return this.wrap(String(row[columnIndex] ?? ""), Math.max(20, width - 10), fontSize, columnIndex === 0 ? 700 : 500);
      });
      const lineCount = Math.max(1, ...cellLines.map((lines) => Math.min(lines.length, compact ? 1 : 2)));
      const lineGap = compact ? fontSize + 1.5 : fontSize + 3;
      const rowHeight = Math.max(baseRowHeight, (compact ? 4 : 8) + lineCount * lineGap);

      if (this.y + rowHeight > this.pageSize.height - this.bottomMargin) {
        this.newPage();
        drawHeader();
      }

      if (rowIndex % 2 === 1) {
        this.ctx.fillStyle = this.colors.soft;
        this.ctx.fillRect(this.margin * this.scale, this.y * this.scale, (this.pageSize.width - this.margin * 2) * this.scale, rowHeight * this.scale);
      }

      let x = this.margin;
      table.columns.forEach((column, columnIndex) => {
        const width = column.width * scaleWidth;
        const align = column.align ?? "left";
        const lines = cellLines[columnIndex].slice(0, compact ? 1 : 2);
        lines.forEach((line, lineIndex) => {
          const tx = align === "right" ? x + width - 5 : align === "center" ? x + width / 2 : x + 5;
          this.text(line, tx, this.y + (compact ? 10 : 13) + lineIndex * lineGap, {
            size: fontSize,
            weight: columnIndex === 0 ? 700 : 500,
            color: columnIndex === 0 ? this.colors.slate : this.colors.text,
            align,
          });
        });
        x += width;
      });

      this.ctx.strokeStyle = this.colors.border;
      this.ctx.lineWidth = 0.35 * this.scale;
      this.ctx.beginPath();
      this.ctx.moveTo(this.margin * this.scale, (this.y + rowHeight) * this.scale);
      this.ctx.lineTo((this.pageSize.width - this.margin) * this.scale, (this.y + rowHeight) * this.scale);
      this.ctx.stroke();
      this.y += rowHeight;
    });

    this.y += 10;
  }

  finish() {
    this.finishPage();
    return buildImagePdf(this.pages, this.pageSize);
  }
}

async function createPremiumReport(
  options: {
    title: string;
    period: string;
    filterSummary?: string;
    language: "en" | "th";
    pageSize?: PremiumPdfPageSize;
    render: (doc: PremiumReportCanvas) => void | Promise<void>;
  }
) {
  await ensureReportFont(options.language);
  let logo: HTMLImageElement | null = null;
  try {
    logo = await loadReportImage("/ees-logo.png");
  } catch (error) {
    console.warn("Unable to load EES logo for report:", error);
  }
  const doc = new PremiumReportCanvas(
    options.title,
    options.period,
    options.language,
    options.pageSize ?? PDF_A4_PORTRAIT,
    logo,
    options.filterSummary ?? "",
  );
  doc.newPage();
  await options.render(doc);
  return doc.finish();
}

function reportPercentChange(current: number, previous: number) {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

function reportSignedPercent(value: number | null) {
  if (value == null || !Number.isFinite(value)) return "No comparison";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function reportMoney(value: number) {
  return `฿${new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 }).format(value || 0)}`;
}

function reportNumber(value: number, digits = 0) {
  return new Intl.NumberFormat("en-GB", { maximumFractionDigits: digits }).format(value || 0);
}

function reportPreviousRange(fromDate: string, toDate: string) {
  const from = new Date(`${fromDate}T00:00:00`);
  const to = new Date(`${toDate}T00:00:00`);
  if (!fromDate || !toDate || Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) return null;
  const day = 24 * 60 * 60 * 1000;
  const days = Math.floor((to.getTime() - from.getTime()) / day) + 1;
  const previousTo = new Date(from.getTime() - day);
  const previousFrom = new Date(previousTo.getTime() - (days - 1) * day);
  return { fromDate: toDateKey(previousFrom), toDate: toDateKey(previousTo) };
}


export default function ReportsPage() {
  const { language, t } = useLanguage();
  const languageKey = language === "th" ? "th" : "en";
  const c = t.reports as ReportsCopy;
  const copy = uiCopy(languageKey);

  const [expandedReport, setExpandedReport] = useState<ReportKey | null>(null);
  const [fuelLogs, setFuelLogs] = useState<FuelLogWithDriver[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [weeklyMileage, setWeeklyMileage] = useState<WeeklyMileageEntry[]>([]);
  const [bookings, setBookings] = useState<BookingDiaryEntry[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [generatingReport, setGeneratingReport] = useState<"vehicle" | "fuel" | "operations" | "maintenance" | null>(null);
  const [pageError, setPageError] = useState("");
  const [fuelError, setFuelError] = useState("");
  const [mileageError, setMileageError] = useState("");
  const [fuelSpendFilters, setFuelSpendFilters] = useState<FuelSpendFilters>({
    ...getDateRange("this_month"),
    driver: "",
    fuelType: "",
    location: "",
    vehicleReg: "",
  });
  const [weeklyMileageWeek, setWeeklyMileageWeek] = useState("");
  const [vehicleReportFilters, setVehicleReportFilters] = useState<VehicleReportFilters>({
    year: new Date().getFullYear(),
    month: "",
    vehicleReg: "",
    sort: "balance",
  });
  const [operationsFilters, setOperationsFilters] = useState<OperationsReportFilters>({
    ...getDateRange("this_month"),
    clientId: "",
    driver: "",
    vehicleReg: "",
    routeQuery: "",
  });
  const [vehicleReportError, setVehicleReportError] = useState("");
  const [operationsError, setOperationsError] = useState("");

  useEffect(() => {
    let active = true;
    setLoadingData(true);

    Promise.all([fetchFuelLogsForExport(), fetchDrivers(), fetchVehicles(), fetchWeeklyMileage(), fetchBookingDiaryEntries(), fetchClients()])
      .then(([fuelRows, driverRows, vehicleRows, mileageRows, bookingRows, clientRows]) => {
        if (!active) return;
        setFuelLogs(fuelRows);
        setDrivers(driverRows);
        setVehicles(vehicleRows);
        setWeeklyMileage(mileageRows);
        setBookings(bookingRows);
        setClients(clientRows);

        const latestWeek =
          Array.from(new Set(mileageRows.map((row) => row.week_ending).filter(Boolean)))
            .sort()
            .at(-1) ?? "";

        setWeeklyMileageWeek((current) => current || latestWeek);
      })
      .catch((error) => {
        console.error("Reports Centre data load failed:", error);
        if (active) setPageError(c.loadError || copy.generateError);
      })
      .finally(() => {
        if (active) setLoadingData(false);
      });

    return () => {
      active = false;
    };
  }, [c.loadError, copy.generateError]);

  const normalizedFuelLogs = useMemo(
    () =>
      fuelLogs.map((log) => ({
        ...log,
        driver: normalizeDisplayName(log.driver) || c.unknownDriver,
        location: normalizeFuelLogLocation(log.location) || c.unknownStation,
        vehicle_reg: normalizeFuelSpendReportVehicleRegistration(log.vehicle_reg),
      })),
    [c.unknownDriver, c.unknownStation, fuelLogs],
  );

  const driverOptions = useMemo(
    () =>
      Array.from(new Set(normalizedFuelLogs.map((log) => log.driver).filter(Boolean))).sort((a, b) =>
        a.localeCompare(b),
      ),
    [normalizedFuelLogs],
  );

  const vehicleOptions = useMemo(
    () =>
      Array.from(new Set(normalizedFuelLogs.map((log) => log.vehicle_reg).filter(Boolean))).sort((a, b) =>
        a.localeCompare(b),
      ),
    [normalizedFuelLogs],
  );

  const fuelTypeOptions = useMemo(
    () =>
      Array.from(
        new Set(
          normalizedFuelLogs
            .map((log) => String(log.fuel_type || "").trim())
            .filter(Boolean),
        ),
      ).sort((a, b) => a.localeCompare(b)),
    [normalizedFuelLogs],
  );

  const stationOptions = useMemo(
    () =>
      Array.from(
        new Set(
          normalizedFuelLogs
            .map((log) => log.location)
            .filter(shouldShowFuelLogLocationOption),
        ),
      )
        .filter((location) => !["Bangchak", "Shell", "Best LPG", "Other"].includes(location))
        .sort((a, b) => a.localeCompare(b)),
    [normalizedFuelLogs],
  );

  const weekOptions = useMemo(
    () =>
      Array.from(new Set(weeklyMileage.map((row) => row.week_ending).filter(Boolean))).sort((a, b) =>
        b.localeCompare(a),
      ),
    [weeklyMileage],
  );

  const bookingDriverOptions = useMemo(
    () => Array.from(new Set(bookings.map((row) => String(row.driver || "").trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [bookings],
  );

  const bookingVehicleOptions = useMemo(
    () => Array.from(new Set(bookings.map((row) => String(row.vehicle_registration || row.vehicle || "").trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [bookings],
  );

  const clientOptions = useMemo(
    () => [...clients].filter((client) => client.active !== false).sort((a, b) => a.name.localeCompare(b.name)),
    [clients],
  );

  const fuelVehicleCount = useMemo(
    () => new Set(normalizedFuelLogs.map((log) => log.vehicle_reg).filter(Boolean)).size,
    [normalizedFuelLogs],
  );

  async function generateVehicleReport() {
    setGeneratingReport("vehicle");
    setVehicleReportError("");
    try {
      const { year, month, vehicleReg, sort } = vehicleReportFilters;
      const [performanceRows, fuelRows] = await Promise.all([
        fetchVehicleMonthlyPerformance({ year }),
        fetchVehicleMonthlyFuelSpend({ year }),
      ]);

      const loadedMonths = Array.from(new Set(performanceRows.map((row) => row.month))).sort((a, b) => a - b);
      const months = month === "" ? loadedMonths : [month];
      const management = buildPerformanceManagement({ records: performanceRows, fuelRows, months });
      let rows = management.rows.filter((row) => !vehicleReg || row.vehicleRegistration === vehicleReg);

      const sortValue = (row: (typeof rows)[number]) =>
        sort === "revenue" ? row.grossRevenue :
        sort === "margin" ? (row.marginPercent ?? Number.NEGATIVE_INFINITY) :
        sort === "fuel" ? (row.fuelPercent ?? Number.NEGATIVE_INFINITY) :
        row.recordedBalance;

      rows = [...rows].sort((a, b) => sortValue(b) - sortValue(a));
      if (!rows.length) throw new Error(copy.noVehicleData);

      const totals = rows.reduce(
        (acc, row) => ({
          revenue: acc.revenue + row.grossRevenue,
          fuel: acc.fuel + row.fuelSpend,
          balance: acc.balance + row.recordedBalance,
          costs: acc.costs + (row.grossRevenue - row.recordedBalance),
        }),
        { revenue: 0, fuel: 0, balance: 0, costs: 0 },
      );
      const margin = totals.revenue > 0 ? (totals.balance / totals.revenue) * 100 : 0;
      const fuelShare = totals.revenue > 0 ? (totals.fuel / totals.revenue) * 100 : 0;

      const monthName =
        month === ""
          ? (languageKey === "th" ? "ทุกเดือนที่มีข้อมูล" : "All loaded months")
          : new Intl.DateTimeFormat(languageKey === "th" ? "th-TH" : "en-GB", { month: "long" }).format(new Date(year, month - 1, 1));

      const monthlyRows = months.map((monthNumber) => {
        const model = buildPerformanceManagement({ records: performanceRows, fuelRows, months: [monthNumber] });
        const scoped = model.rows.filter((row) => !vehicleReg || row.vehicleRegistration === vehicleReg);
        const revenue = scoped.reduce((sum, row) => sum + row.grossRevenue, 0);
        const balance = scoped.reduce((sum, row) => sum + row.recordedBalance, 0);
        const fuel = scoped.reduce((sum, row) => sum + row.fuelSpend, 0);
        return {
          month: monthNumber,
          revenue,
          balance,
          margin: revenue > 0 ? balance / revenue * 100 : 0,
          fuelShare: revenue > 0 ? fuel / revenue * 100 : 0,
        };
      }).filter((row) => row.revenue || row.balance);

      const topBalance = [...rows].sort((a, b) => b.recordedBalance - a.recordedBalance)[0];
      const topRevenue = [...rows].sort((a, b) => b.grossRevenue - a.grossRevenue)[0];
      const topMargin = [...rows].filter((row) => row.marginPercent != null).sort((a, b) => (b.marginPercent ?? 0) - (a.marginPercent ?? 0))[0];
      const topFuelShare = [...rows].filter((row) => row.fuelPercent != null).sort((a, b) => (b.fuelPercent ?? 0) - (a.fuelPercent ?? 0))[0];

      const pdf = await createPremiumReport({
        title: languageKey === "th" ? "รายงานประสิทธิภาพรถ" : "Vehicle Performance Report",
        period: `${year} · ${monthName}`,
        filterSummary: vehicleReg ? `${copy.vehicleLabel}: ${vehicleReg}` : `${rows.length} ${copy.vehicles}`,
        language: languageKey,
        pageSize: PDF_A4_LANDSCAPE,
        render: (doc) => {
          doc.metrics([
            { label: languageKey === "th" ? "รายได้" : "Revenue", value: reportMoney(totals.revenue), tone: "purple" },
            { label: languageKey === "th" ? "ยอดคงเหลือ" : "Recorded balance", value: reportMoney(totals.balance), tone: "green" },
            { label: "Margin", value: `${margin.toFixed(1)}%`, detail: languageKey === "th" ? "ยอดคงเหลือ ÷ รายได้" : "Balance ÷ revenue", tone: "blue" },
            { label: languageKey === "th" ? "น้ำมัน / รายได้" : "Fuel / revenue", value: `${fuelShare.toFixed(1)}%`, detail: reportMoney(totals.fuel), tone: "amber" },
          ]);

          doc.insightBox(
            languageKey === "th" ? "สรุปผู้บริหาร" : "Management summary",
            languageKey === "th"
              ? `ยอดคงเหลือสูงสุด ${topBalance?.vehicleRegistration ?? "-"} ${topBalance ? reportMoney(topBalance.recordedBalance) : "-"} · รายได้สูงสุด ${topRevenue?.vehicleRegistration ?? "-"} ${topRevenue ? reportMoney(topRevenue.grossRevenue) : "-"} · Margin สูงสุด ${topMargin?.vehicleRegistration ?? "-"} ${(topMargin?.marginPercent ?? 0).toFixed(1)}% · Fuel/Revenue สูงสุด ${topFuelShare?.vehicleRegistration ?? "-"} ${(topFuelShare?.fuelPercent ?? 0).toFixed(1)}%`
              : `Highest recorded balance: ${topBalance?.vehicleRegistration ?? "-"} ${topBalance ? reportMoney(topBalance.recordedBalance) : "-"} · Highest revenue: ${topRevenue?.vehicleRegistration ?? "-"} ${topRevenue ? reportMoney(topRevenue.grossRevenue) : "-"} · Best retained margin: ${topMargin?.vehicleRegistration ?? "-"} ${(topMargin?.marginPercent ?? 0).toFixed(1)}% · Highest fuel share: ${topFuelShare?.vehicleRegistration ?? "-"} ${(topFuelShare?.fuelPercent ?? 0).toFixed(1)}%`,
            "purple",
          );

          doc.section(languageKey === "th" ? "อันดับรถ" : "Vehicle ranking", languageKey === "th" ? "เรียงตามตัวกรองที่เลือกจาก Reports Centre" : "Ranked using the selected Reports Centre sort.");
          doc.table({
            columns: [
              { label: "#", width: 28, align: "center" },
              { label: languageKey === "th" ? "ทะเบียน" : "Vehicle", width: 74 },
              { label: "Revenue", width: 92, align: "right" },
              { label: languageKey === "th" ? "ต้นทุนตรง" : "Direct costs", width: 92, align: "right" },
              { label: languageKey === "th" ? "ยอดคงเหลือ" : "Balance", width: 92, align: "right" },
              { label: "Margin", width: 60, align: "right" },
              { label: "Fuel / Rev", width: 62, align: "right" },
            ],
            rows: rows.map((row, index) => [
              String(index + 1),
              row.vehicleRegistration,
              reportMoney(row.grossRevenue),
              reportMoney(row.grossRevenue - row.recordedBalance),
              reportMoney(row.recordedBalance),
              row.marginPercent == null ? "-" : `${row.marginPercent.toFixed(1)}%`,
              row.fuelPercent == null ? "-" : `${row.fuelPercent.toFixed(1)}%`,
            ]),
          }, { fontSize: 5.2, rowHeight: 10.5, compact: true });

          if (monthlyRows.length > 1) {
            const latest = monthlyRows[monthlyRows.length - 1];
            const previous = monthlyRows[monthlyRows.length - 2];
            const revenueChange = reportPercentChange(latest.revenue, previous.revenue);
            const balanceChange = reportPercentChange(latest.balance, previous.balance);
            const marginChange = latest.margin - previous.margin;
            const fuelShareChange = latest.fuelShare - previous.fuelShare;
            const latestLabel = new Intl.DateTimeFormat(languageKey === "th" ? "th-TH" : "en-GB", { month: "long" }).format(new Date(year, latest.month - 1, 1));

            doc.newPage();
            doc.metrics([
              { label: `${latestLabel} ${languageKey === "th" ? "รายได้" : "Revenue"}`, value: reportMoney(latest.revenue), detail: revenueChange == null ? undefined : `${reportSignedPercent(revenueChange)} vs previous month`, tone: "purple" },
              { label: languageKey === "th" ? "ยอดคงเหลือ" : "Recorded balance", value: reportMoney(latest.balance), detail: balanceChange == null ? undefined : `${reportSignedPercent(balanceChange)} vs previous month`, tone: "green" },
              { label: "Margin", value: `${latest.margin.toFixed(1)}%`, detail: `${marginChange >= 0 ? "+" : ""}${marginChange.toFixed(1)} pp vs previous month`, tone: "blue" },
              { label: languageKey === "th" ? "น้ำมัน / รายได้" : "Fuel / revenue", value: `${latest.fuelShare.toFixed(1)}%`, detail: `${fuelShareChange >= 0 ? "+" : ""}${fuelShareChange.toFixed(1)} pp vs previous month`, tone: "amber" },
            ]);

            doc.section(languageKey === "th" ? "ผลรายเดือน" : "Monthly performance", languageKey === "th" ? "แสดงทิศทางของรายได้ ยอดคงเหลือ Margin และสัดส่วนน้ำมัน" : "Shows how revenue, recorded balance, retained margin and fuel share moved through the loaded period.");
            doc.table({
              columns: [
                { label: languageKey === "th" ? "เดือน" : "Month", width: 82 },
                { label: "Revenue", width: 110, align: "right" },
                { label: languageKey === "th" ? "ยอดคงเหลือ" : "Balance", width: 110, align: "right" },
                { label: "Margin", width: 80, align: "right" },
                { label: "Fuel / Rev", width: 80, align: "right" },
              ],
              rows: monthlyRows.map((row) => [
                new Intl.DateTimeFormat(languageKey === "th" ? "th-TH" : "en-GB", { month: "short" }).format(new Date(year, row.month - 1, 1)),
                reportMoney(row.revenue),
                reportMoney(row.balance),
                `${row.margin.toFixed(1)}%`,
                `${row.fuelShare.toFixed(1)}%`,
              ]),
            }, { fontSize: 7, rowHeight: 17 });
          }

          doc.insightBox(
            languageKey === "th" ? "หมายเหตุการคำนวณ" : "Calculation note",
            languageKey === "th"
              ? "ยอดคงเหลือ = รายได้ - ต้นทุนตรงที่บันทึกในระบบ รายงานนี้ไม่ใช่กำไรสุทธิทางบัญชี"
              : "Recorded balance equals revenue less direct costs recorded in EES. It is a management measure, not accounting net profit.",
            "slate",
          );
        },
      });

      downloadReportFile(pdf, `EES-Vehicle-Performance-${year}-${month === "" ? "all-months" : String(month).padStart(2, "0")}.pdf`);
    } catch (error) {
      setVehicleReportError(error instanceof Error && error.message ? error.message : copy.generateError);
    } finally {
      setGeneratingReport(null);
    }
  }

  async function generateOperationsReport() {
    setGeneratingReport("operations");
    setOperationsError("");
    try {
      const q = operationsFilters.routeQuery.trim().toLowerCase();
      const clientById = new Map(clients.map((client) => [String(client.id), client.name]));
      const rows = bookings.filter((row) => {
        const reg = String(row.vehicle_registration || row.vehicle || "").trim();
        const route = `${row.pickup || ""} ${row.pickup_address || ""} ${row.dropoff || ""} ${row.dropoff_address || ""}`.toLowerCase();
        return (!operationsFilters.fromDate || row.booking_date >= operationsFilters.fromDate) &&
          (!operationsFilters.toDate || row.booking_date <= operationsFilters.toDate) &&
          (!operationsFilters.clientId || String(row.client_id || "") === operationsFilters.clientId) &&
          (!operationsFilters.driver || String(row.driver || "") === operationsFilters.driver) &&
          (!operationsFilters.vehicleReg || reg === operationsFilters.vehicleReg) &&
          (!q || route.includes(q));
      }).sort((a, b) => a.booking_date.localeCompare(b.booking_date));

      if (!rows.length) throw new Error(copy.noBookingData);

      const assigned = rows.filter((row) => String(row.driver || "").trim() && String(row.vehicle_registration || row.vehicle || "").trim()).length;
      const distance = rows.reduce((sum, row) => sum + (Number(row.estimated_distance_km) || 0), 0);
      const customerCounts = new Map<string, number>();
      const routeCounts = new Map<string, number>();
      const vehicleCounts = new Map<string, number>();
      const driverCounts = new Map<string, number>();

      for (const row of rows) {
        const customer = clientById.get(String(row.client_id || "")) || row.client?.name || (languageKey === "th" ? "ไม่ระบุลูกค้า" : "Unassigned customer");
        customerCounts.set(customer, (customerCounts.get(customer) || 0) + 1);
        const pickup = String(row.pickup || row.pickup_address || "-").trim();
        const dropoff = String(row.dropoff || row.dropoff_address || "-").trim();
        const route = `${pickup} → ${dropoff}`;
        routeCounts.set(route, (routeCounts.get(route) || 0) + 1);
        const vehicle = String(row.vehicle_registration || row.vehicle || "").trim();
        const driver = String(row.driver || "").trim();
        if (vehicle) vehicleCounts.set(vehicle, (vehicleCounts.get(vehicle) || 0) + 1);
        if (driver) driverCounts.set(driver, (driverCounts.get(driver) || 0) + 1);
      }

      const topCustomers = [...customerCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
      const topRoutes = [...routeCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
      const topVehicles = [...vehicleCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
      const topDrivers = [...driverCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
      const repeatJobs = [...routeCounts.values()].reduce((sum, count) => sum + (count > 1 ? count : 0), 0);
      const repeatShare = rows.length ? repeatJobs / rows.length * 100 : 0;
      const assignedShare = rows.length ? assigned / rows.length * 100 : 0;

      const previousRange = reportPreviousRange(operationsFilters.fromDate, operationsFilters.toDate);
      const previousRows = previousRange
        ? bookings.filter((row) =>
            row.booking_date >= previousRange.fromDate &&
            row.booking_date <= previousRange.toDate &&
            (!operationsFilters.clientId || String(row.client_id || "") === operationsFilters.clientId) &&
            (!operationsFilters.driver || String(row.driver || "") === operationsFilters.driver) &&
            (!operationsFilters.vehicleReg || String(row.vehicle_registration || row.vehicle || "").trim() === operationsFilters.vehicleReg)
          )
        : [];
      const jobChange = previousRows.length ? reportPercentChange(rows.length, previousRows.length) : null;

      const pdf = await createPremiumReport({
        title: languageKey === "th" ? "รายงานปฏิบัติการ" : "Operations Report",
        period: periodLabel(operationsFilters.fromDate, operationsFilters.toDate, languageKey),
        filterSummary: [
          operationsFilters.clientId ? `${copy.client}: ${clientById.get(operationsFilters.clientId) ?? operationsFilters.clientId}` : "",
          operationsFilters.vehicleReg ? `${copy.vehicleLabel}: ${operationsFilters.vehicleReg}` : "",
          operationsFilters.driver ? `${copy.driver}: ${operationsFilters.driver}` : "",
        ].filter(Boolean).join(" · "),
        language: languageKey,
        pageSize: PDF_A4_LANDSCAPE,
        render: (doc) => {
          doc.metrics([
            { label: languageKey === "th" ? "งานทั้งหมด" : "Total jobs", value: reportNumber(rows.length), detail: jobChange == null ? undefined : `${reportSignedPercent(jobChange)} vs prior period`, tone: "purple" },
            { label: languageKey === "th" ? "มอบหมายแล้ว" : "Assigned", value: `${assignedShare.toFixed(0)}%`, detail: `${assigned}/${rows.length}`, tone: "green" },
            { label: languageKey === "th" ? "งานเส้นทางซ้ำ" : "Repeat-route jobs", value: `${repeatShare.toFixed(0)}%`, detail: `${repeatJobs} jobs`, tone: "blue" },
            { label: languageKey === "th" ? "ระยะทางประมาณ" : "Estimated distance", value: `${reportNumber(distance)} km`, tone: "amber" },
          ]);

          const topCustomer = topCustomers[0];
          const topRoute = topRoutes[0];
          doc.insightBox(
            languageKey === "th" ? "Operational summary" : "Operational summary",
            languageKey === "th"
              ? `${topCustomer?.[0] ?? "-"} เป็นลูกค้าที่มีงานมากที่สุด ${topCustomer?.[1] ?? 0} งาน และเส้นทาง ${topRoute?.[0] ?? "-"} ถูกใช้งานมากที่สุด ${topRoute?.[1] ?? 0} งาน`
              : `${topCustomer?.[0] ?? "-"} generated the most work with ${topCustomer?.[1] ?? 0} jobs. The most-used route was ${topRoute?.[0] ?? "-"} with ${topRoute?.[1] ?? 0} jobs.`,
            "purple",
          );

          doc.twoColumnLists(
            {
              title: languageKey === "th" ? "ลูกค้าหลัก" : "Top customers",
              rows: topCustomers.map(([name, count]) => [name, `${count} · ${(count / rows.length * 100).toFixed(1)}%`]),
            },
            {
              title: languageKey === "th" ? "เส้นทางหลัก" : "Top routes",
              rows: topRoutes.map(([name, count]) => [name, `${count}`]),
            },
          );

          doc.twoColumnLists(
            {
              title: languageKey === "th" ? "รถที่ใช้งานมาก" : "Vehicle workload",
              rows: topVehicles.map(([name, count]) => [name, `${count} jobs`]),
            },
            {
              title: languageKey === "th" ? "คนขับที่มีงานมาก" : "Driver workload",
              rows: topDrivers.map(([name, count]) => [name, `${count} jobs`]),
            },
          );

          doc.newPage();
          doc.section(languageKey === "th" ? "ภาคผนวก · รายละเอียดงาน" : "Appendix · Job detail", languageKey === "th" ? "รายการงานตามตัวกรองที่เลือกสำหรับการตรวจสอบ" : "The underlying jobs for the selected period, kept separate from the management summary.");
          doc.table({
            columns: [
              { label: "Date", width: 70 },
              { label: "Time", width: 48 },
              { label: languageKey === "th" ? "ลูกค้า" : "Customer", width: 88 },
              { label: languageKey === "th" ? "เส้นทาง" : "Route", width: 220 },
              { label: languageKey === "th" ? "รถ" : "Vehicle", width: 72 },
              { label: languageKey === "th" ? "คนขับ" : "Driver", width: 72 },
              { label: "KM", width: 58, align: "right" },
            ],
            rows: rows.map((row) => {
              const customer = clientById.get(String(row.client_id || "")) || row.client?.name || "-";
              const reg = String(row.vehicle_registration || row.vehicle || "-");
              return [
                formatDate(row.booking_date, languageKey),
                row.pickup_time || "TBC",
                customer,
                `${String(row.pickup || row.pickup_address || "-")} → ${String(row.dropoff || row.dropoff_address || "-")}`,
                reg,
                String(row.driver || "-"),
                Number(row.estimated_distance_km) ? Number(row.estimated_distance_km).toFixed(1) : "-",
              ];
            }),
          }, { fontSize: 5.5, rowHeight: 10.8, compact: true });
        },
      });

      downloadReportFile(pdf, `EES-Operations-${operationsFilters.fromDate}-${operationsFilters.toDate}.pdf`);
    } catch (error) {
      setOperationsError(error instanceof Error && error.message ? error.message : copy.generateError);
    } finally {
      setGeneratingReport(null);
    }
  }

  async function generateFuelReport() {
    setGeneratingReport("fuel");
    setFuelError("");
    try {
      const reportData = buildFuelSpendManagementReport(normalizedFuelLogs, fuelSpendFilters);
      if (!reportData.logs.length) throw new Error(copy.noFuelLogs);

      const previousRange = reportPreviousRange(fuelSpendFilters.fromDate, fuelSpendFilters.toDate);
      const previous = previousRange
        ? buildFuelSpendManagementReport(normalizedFuelLogs, {
            ...fuelSpendFilters,
            fromDate: previousRange.fromDate,
            toDate: previousRange.toDate,
          })
        : null;

      const spendChange = previous ? reportPercentChange(reportData.totalSpend, previous.totalSpend) : null;
      const litresChange = previous ? reportPercentChange(reportData.totalLitres, previous.totalLitres) : null;

      const stationRows = [...reportData.stationRows].sort((a, b) => b.spend - a.spend);
      const vehicleRows = [...reportData.vehicleRows].sort((a, b) => b.spend - a.spend);

      const fuelTypeGroups = new Map<string, { litres: number; spend: number; fills: number }>();
      for (const log of reportData.logs) {
        const raw = String(log.fuel_type || "").trim();
        const key = /lpg/i.test(raw) ? "LPG" : (raw || (languageKey === "th" ? "น้ำมันทั่วไป" : "Regular / other"));
        const current = fuelTypeGroups.get(key) ?? { litres: 0, spend: 0, fills: 0 };
        const litres = Number(log.litres || 0);
        const spend = getFuelSpendReportLogCost(log);
        current.litres += Number.isFinite(litres) ? litres : 0;
        current.spend += Number.isFinite(spend) ? spend : 0;
        current.fills += 1;
        fuelTypeGroups.set(key, current);
      }

      const typeRows = [...fuelTypeGroups.entries()]
        .map(([type, value]) => ({
          type,
          ...value,
          average: value.litres > 0 ? value.spend / value.litres : null,
        }))
        .sort((a, b) => b.spend - a.spend);

      const pdf = await createPremiumReport({
        title: languageKey === "th" ? "รายงานการใช้น้ำมัน" : "Fuel Management Report",
        period: periodLabel(fuelSpendFilters.fromDate, fuelSpendFilters.toDate, languageKey),
        filterSummary: [
          fuelSpendFilters.vehicleReg ? `${copy.vehicleLabel}: ${fuelSpendFilters.vehicleReg}` : "",
          fuelSpendFilters.driver ? `${copy.driver}: ${fuelSpendFilters.driver}` : "",
          fuelSpendFilters.location ? `${copy.station}: ${fuelSpendFilters.location}` : "",
          fuelSpendFilters.fuelType ? `${copy.fuelType}: ${fuelSpendFilters.fuelType}` : "",
        ].filter(Boolean).join(" · "),
        language: languageKey,
        pageSize: PDF_A4_LANDSCAPE,
        render: (doc) => {
          doc.metrics([
            { label: languageKey === "th" ? "ค่าใช้จ่ายน้ำมัน" : "Fuel spend", value: reportMoney(reportData.totalSpend), detail: spendChange == null ? undefined : `${reportSignedPercent(spendChange)} vs prior period`, tone: "purple" },
            { label: languageKey === "th" ? "ลิตรทั้งหมด" : "Total litres", value: `${reportNumber(reportData.totalLitres, 1)} L`, detail: litresChange == null ? undefined : `${reportSignedPercent(litresChange)} vs prior period`, tone: "blue" },
            { label: languageKey === "th" ? "รายการเติม" : "Fuel logs", value: reportNumber(reportData.totalFillUps), detail: `${reportData.vehicleRows.length} ${languageKey === "th" ? "รถ" : "vehicles"}`, tone: "green" },
            { label: languageKey === "th" ? "สถานีที่ใช้มาก" : "Most-used station", value: reportData.mostUsedStation?.station ?? "-", detail: reportData.mostUsedStation ? `${reportData.mostUsedStation.fillUps} fills` : undefined, tone: "amber" },
          ]);

          const topVehicle = vehicleRows[0];
          const topFiveSpend = vehicleRows.slice(0, 5).reduce((sum, row) => sum + row.spend, 0);
          const topFiveShare = reportData.totalSpend > 0 ? topFiveSpend / reportData.totalSpend * 100 : 0;

          doc.twoColumnLists(
            {
              title: languageKey === "th" ? "ราคาและปริมาณตามประเภทน้ำมัน" : "Fuel type breakdown",
              rows: typeRows.slice(0, 4).map((row) => [
                row.type,
                `${row.fills} fills · ${reportNumber(row.litres, 1)} L · ${reportMoney(row.spend)}${row.average == null ? "" : ` · ฿${row.average.toFixed(2)}/L`}`,
              ]),
            },
            {
              title: languageKey === "th" ? "สัดส่วนค่าใช้จ่ายตามสถานี" : "Station spend",
              rows: stationRows.slice(0, 5).map((row) => [
                row.station,
                `${reportMoney(row.spend)} · ${row.spendPercent.toFixed(1)}%`,
              ]),
            },
          );

          doc.section(
            languageKey === "th" ? "รถที่ใช้ค่าน้ำมัน" : "Vehicle fuel spend",
            languageKey === "th"
              ? `${topVehicle?.vehicleReg ?? "-"} ใช้ค่าน้ำมันสูงสุด ${topVehicle ? reportMoney(topVehicle.spend) : "-"} · รถ 5 อันดับแรกคิดเป็น ${topFiveShare.toFixed(1)}% ของค่าใช้จ่ายทั้งหมด`
              : `${topVehicle?.vehicleReg ?? "-"} recorded the highest spend at ${topVehicle ? reportMoney(topVehicle.spend) : "-"}; the top five vehicles account for ${topFiveShare.toFixed(1)}% of total fuel spend.`,
          );
          doc.table({
            columns: [
              { label: "#", width: 30, align: "center" },
              { label: languageKey === "th" ? "รถ" : "Vehicle", width: 80 },
              { label: languageKey === "th" ? "คนขับ" : "Driver", width: 92 },
              { label: "Spend", width: 95, align: "right" },
              { label: "Litres", width: 78, align: "right" },
              { label: languageKey === "th" ? "รายการ" : "Fills", width: 55, align: "right" },
              { label: "% Total", width: 65, align: "right" },
            ],
            rows: vehicleRows.map((row, index) => [
              String(index + 1),
              row.vehicleReg,
              row.driver || "-",
              reportMoney(row.spend),
              reportNumber(row.litres, 1),
              String(row.fuelLogs),
              `${(reportData.totalSpend > 0 ? row.spend / reportData.totalSpend * 100 : 0).toFixed(1)}%`,
            ]),
          }, { fontSize: 5.3, rowHeight: 10.5, compact: true });

        },
      });

      downloadReportFile(pdf, `EES-Fuel-Management-${fuelSpendFilters.fromDate}-${fuelSpendFilters.toDate}.pdf`);
    } catch (error) {
      setFuelError(error instanceof Error && error.message ? error.message : copy.generateError);
    } finally {
      setGeneratingReport(null);
    }
  }

  async function generateMileageReport() {
    setGeneratingReport("maintenance");
    setMileageError("");
    try {
      if (!weeklyMileageWeek) throw new Error(copy.noMileageReports);

      const selectedEntries = weeklyMileage.filter((entry) => entry.week_ending === weeklyMileageWeek);
      if (!selectedEntries.length) throw new Error(copy.noMileageData);

      const allWeeks = Array.from(new Set(weeklyMileage.map((entry) => entry.week_ending).filter(Boolean))).sort();
      const selectedIndex = allWeeks.indexOf(weeklyMileageWeek);
      const previousWeek = selectedIndex > 0 ? allWeeks[selectedIndex - 1] : "";
      const previousPreviousWeek = selectedIndex > 1 ? allWeeks[selectedIndex - 2] : "";

      const driverById = new Map(drivers.map((driver) => [String(driver.id), normalizeDisplayName(driver.name) || "-"]));
      const regKey = (value: unknown) => String(value ?? "").replace(/\s+/g, "").replace(/-/g, "").toUpperCase();

      const entriesByWeekAndReg = new Map<string, WeeklyMileageEntry>();
      for (const entry of weeklyMileage) entriesByWeekAndReg.set(`${entry.week_ending}|${regKey(entry.vehicle_reg)}`, entry);

      const rows = selectedEntries.map((entry) => {
        const key = regKey(entry.vehicle_reg);
        const previous = previousWeek ? entriesByWeekAndReg.get(`${previousWeek}|${key}`) : undefined;
        const previousPrevious = previousPreviousWeek ? entriesByWeekAndReg.get(`${previousPreviousWeek}|${key}`) : undefined;
        const currentMileage = Number(entry.mileage);
        const previousMileage = previous ? Number(previous.mileage) : NaN;
        const previousPreviousMileage = previousPrevious ? Number(previousPrevious.mileage) : NaN;
        const baseline = Boolean(entry.is_odometer_baseline);
        const currentDistance = !baseline && Number.isFinite(currentMileage) && Number.isFinite(previousMileage) && currentMileage >= previousMileage
          ? currentMileage - previousMileage
          : null;
        const previousDistance = previous && !previous.is_odometer_baseline && Number.isFinite(previousMileage) && Number.isFinite(previousPreviousMileage) && previousMileage >= previousPreviousMileage
          ? previousMileage - previousPreviousMileage
          : null;
        const change = currentDistance != null && previousDistance != null ? currentDistance - previousDistance : null;
        const driver = driverById.get(String(entry.driver_id || "")) || "-";
        return {
          vehicleReg: String(entry.vehicle_reg || "-"),
          driver,
          currentMileage: Number.isFinite(currentMileage) ? currentMileage : null,
          previousMileage: Number.isFinite(previousMileage) ? previousMileage : null,
          distance: currentDistance,
          previousDistance,
          change,
          baseline,
        };
      }).sort((a, b) => (b.distance ?? -1) - (a.distance ?? -1));

      const validRows = rows.filter((row) => row.distance != null);
      const totalDistance = validRows.reduce((sum, row) => sum + (row.distance ?? 0), 0);
      const previousTotal = rows.reduce((sum, row) => sum + (row.previousDistance ?? 0), 0);
      const fleetChange = previousTotal > 0 ? totalDistance - previousTotal : null;
      const increases = rows.filter((row) => row.change != null && row.change > 0).sort((a, b) => (b.change ?? 0) - (a.change ?? 0));
      const decreases = rows.filter((row) => row.change != null && row.change < 0).sort((a, b) => (a.change ?? 0) - (b.change ?? 0));
      const missing = Math.max(0, vehicles.length - selectedEntries.length);

      const pdf = await createPremiumReport({
        title: languageKey === "th" ? "รายงานระยะทางประจำสัปดาห์" : "Weekly Fleet Mileage Report",
        period: `${languageKey === "th" ? "สัปดาห์สิ้นสุด" : "Week ending"} ${formatDate(weeklyMileageWeek, languageKey)}`,
        filterSummary: previousWeek ? `${languageKey === "th" ? "เทียบกับ" : "Compared with"} ${formatDate(previousWeek, languageKey)}` : "",
        language: languageKey,
        pageSize: PDF_A4_LANDSCAPE,
        render: (doc) => {
          doc.metrics([
            { label: languageKey === "th" ? "รับเลขไมล์" : "Readings received", value: `${selectedEntries.length}/${vehicles.length || selectedEntries.length}`, detail: missing ? `${missing} missing` : "Complete", tone: missing ? "amber" : "green" },
            { label: languageKey === "th" ? "ระยะทางรวม" : "Fleet distance", value: `${reportNumber(totalDistance)} km`, detail: fleetChange == null ? undefined : `${fleetChange >= 0 ? "+" : ""}${reportNumber(fleetChange)} km vs prior week`, tone: "purple" },
            { label: languageKey === "th" ? "วิ่งมากขึ้น" : "Travelled more", value: String(increases.length), detail: previousWeek ? "vs prior week" : undefined, tone: "blue" },
            { label: languageKey === "th" ? "วิ่งน้อยลง" : "Travelled less", value: String(decreases.length), detail: previousWeek ? "vs prior week" : undefined, tone: "slate" },
          ]);

          const movementHighlights = [
            increases[0] ? `${languageKey === "th" ? "เพิ่มสูงสุด" : "Largest increase"}: ${increases[0].vehicleReg} +${reportNumber(increases[0].change ?? 0)} km` : "",
            decreases[0] ? `${languageKey === "th" ? "ลดสูงสุด" : "Largest decrease"}: ${decreases[0].vehicleReg} ${reportNumber(decreases[0].change ?? 0)} km` : "",
            missing ? `${languageKey === "th" ? "ยังขาดเลขไมล์" : "Missing readings"}: ${missing}` : `${languageKey === "th" ? "เลขไมล์ครบ" : "All readings received"}`,
          ].filter(Boolean).join(" · ");
          doc.insightBox(languageKey === "th" ? "สรุปการเคลื่อนไหว" : "Movement summary", movementHighlights, missing ? "amber" : "green");

          doc.section(languageKey === "th" ? "รายละเอียดรถ" : "Vehicle detail", languageKey === "th" ? "เลขไมล์ปัจจุบัน ระยะทางสัปดาห์นี้ และการเปรียบเทียบกับสัปดาห์ก่อน" : "Current odometer, weekly distance and movement versus the prior week.");
          doc.table({
            columns: [
              { label: languageKey === "th" ? "รถ" : "Vehicle", width: 75 },
              { label: languageKey === "th" ? "คนขับ" : "Driver", width: 92 },
              { label: languageKey === "th" ? "เลขไมล์ปัจจุบัน" : "Current odo", width: 86, align: "right" },
              { label: languageKey === "th" ? "เลขไมล์ก่อนหน้า" : "Previous odo", width: 86, align: "right" },
              { label: languageKey === "th" ? "ระยะทาง" : "Distance", width: 72, align: "right" },
              { label: languageKey === "th" ? "สัปดาห์ก่อน" : "Prior distance", width: 78, align: "right" },
              { label: languageKey === "th" ? "เปลี่ยนแปลง" : "Change", width: 72, align: "right" },
              { label: languageKey === "th" ? "สถานะ" : "Status", width: 75 },
            ],
            rows: rows.map((row) => [
              row.vehicleReg,
              row.driver,
              row.currentMileage == null ? "-" : reportNumber(row.currentMileage),
              row.previousMileage == null ? "-" : reportNumber(row.previousMileage),
              row.distance == null ? "-" : reportNumber(row.distance),
              row.previousDistance == null ? "-" : reportNumber(row.previousDistance),
              row.change == null ? "-" : `${row.change > 0 ? "+" : ""}${reportNumber(row.change)}`,
              row.baseline ? (languageKey === "th" ? "ค่าเริ่มใหม่" : "New baseline") : row.distance == null ? (languageKey === "th" ? "ตรวจสอบ" : "Review") : (languageKey === "th" ? "ครบ" : "Complete"),
            ]),
          }, { fontSize: 5.2, rowHeight: 10.5, compact: true });

        },
      });

      downloadReportFile(pdf, `EES-Weekly-Mileage-${weeklyMileageWeek}.pdf`);
    } catch (error) {
      setMileageError(error instanceof Error && error.message ? error.message : copy.generateError);
    } finally {
      setGeneratingReport(null);
    }
  }

  return (
    <div className="space-y-5 pb-10">
      <section className="overflow-hidden rounded-[28px] border border-brand-100 bg-gradient-to-br from-white via-white to-brand-50/80 shadow-[0_18px_60px_rgba(70,45,120,0.08)]">
        <div className="flex flex-col gap-6 px-5 py-6 sm:px-7 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-brand-100 bg-white px-3 py-1 text-[11px] font-bold uppercase tracking-[0.16em] text-brand-700 shadow-sm">
              <BarChart3 className="h-3.5 w-3.5" />
              {copy.eyebrow}
            </div>
            <h1 className="mt-4 text-3xl font-semibold tracking-tight text-slate-950">{copy.title}</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">{copy.intro}</p>
          </div>

          <div className="min-w-[320px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-4 py-2.5 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
              {copy.dataAvailable}
            </div>
            <div className="grid grid-cols-3">
              <DataMini value={loadingData ? "—" : normalizedFuelLogs.length.toLocaleString()} label={copy.fuelLogs} />
              <DataMini value={loadingData ? "—" : String(Math.max(vehicles.length, fuelVehicleCount))} label={copy.vehicles} />
              <DataMini value={loadingData ? "—" : String(weekOptions.length)} label={copy.mileageWeeks} />
            </div>
          </div>
        </div>

        {pageError ? (
          <div className="border-t border-rose-100 bg-rose-50 px-6 py-3 text-sm font-semibold text-rose-700">
            {pageError}
          </div>
        ) : null}
      </section>

      <section>
        <article className="relative overflow-hidden rounded-[28px] border border-brand-100 bg-[#211336] px-6 py-7 text-white shadow-[0_20px_70px_rgba(32,20,60,0.16)] sm:px-7">
          <div className="absolute -right-14 -top-16 h-56 w-56 rounded-full bg-brand-500/20 blur-3xl" />
          <div className="absolute -bottom-20 left-1/3 h-52 w-52 rounded-full bg-violet-400/10 blur-3xl" />

          <div className="relative grid gap-7 xl:grid-cols-[0.82fr_1.18fr] xl:items-end">
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/8 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.16em] text-violet-100">
                  <Sparkles className="h-3.5 w-3.5" />
                  {copy.featured}
                </div>
                <div className="inline-flex items-center gap-2 text-xs text-slate-300">
                  <span className="h-2 w-2 rounded-full bg-emerald-400" />
                  {copy.live}
                </div>
              </div>

              <h2 className="mt-5 text-2xl font-semibold">{copy.management}</h2>
              <p className="mt-2 max-w-xl text-sm leading-6 text-slate-300">{copy.managementDesc}</p>
              <p className="mt-3 max-w-xl text-xs leading-5 text-slate-400">{copy.managementNote}</p>

              <button
                type="button"
                onClick={() => setExpandedReport(expandedReport === "management" ? null : "management")}
                className="mt-5 inline-flex min-h-11 items-center justify-center rounded-xl bg-white px-4 text-sm font-semibold text-slate-950 shadow-sm transition hover:bg-slate-100"
              >
                {expandedReport === "management" ? copy.close : copy.configure}
              </button>
            </div>

            <div>
              <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.16em] text-violet-200">
                {copy.managementIncludes}
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                <SourcePill icon={Gauge} label={copy.sourceVehicle} status={languageKey === "th" ? "รายได้ · ต้นทุน · กำไร" : "Revenue · cost · margin"} />
                <SourcePill icon={Droplets} label={copy.sourceFuel} status={languageKey === "th" ? "ค่าใช้จ่าย · ปริมาณ · สถานี" : "Spend · volume · stations"} />
                <SourcePill icon={BookOpenCheck} label={copy.sourceOps} status={languageKey === "th" ? "ลูกค้า · เส้นทาง · ปริมาณงาน" : "Customers · routes · workload"} />
                <SourcePill icon={Wrench} label={copy.sourceMaintenance} status={languageKey === "th" ? "ระยะทาง · เซอร์วิส · กำหนด" : "Mileage · service · due work"} />
              </div>
            </div>
          </div>

          {expandedReport === "management" ? (
            <div className="relative mt-6 rounded-2xl border border-white/10 bg-white/7 p-4 sm:p-5">
              <div className="grid gap-5 lg:grid-cols-[1fr_auto] lg:items-end">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.14em] text-violet-200">{copy.managementSources}</p>
                  <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
                    {languageKey === "th"
                      ? "Management Report จะดึงตัวเลขที่ตรวจสอบแล้วจากแต่ละโมดูลมาสรุปเป็นชุดเดียวสำหรับประชุมผู้บริหาร โดยไม่สร้างคะแนนใหม่หรือทำซ้ำรายงานต้นทาง"
                      : "The Management Report will bring together the verified figures already held in each module into one management pack for period reviews, without inventing new scores or duplicating the source reports."}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => setExpandedReport("vehicle")} className="rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-xs font-semibold text-white hover:bg-white/15">
                    {copy.vehicle}
                  </button>
                  <button type="button" onClick={() => setExpandedReport("fuel")} className="rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-xs font-semibold text-white hover:bg-white/15">
                    {copy.fuel}
                  </button>
                  <button type="button" onClick={() => setExpandedReport("operations")} className="rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-xs font-semibold text-white hover:bg-white/15">
                    {copy.operations}
                  </button>
                  <button type="button" onClick={() => setExpandedReport("maintenance")} className="rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-xs font-semibold text-white hover:bg-white/15">
                    {copy.maintenance}
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </article>
      </section>

      <section className="rounded-[28px] border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-2 border-b border-slate-100 px-5 py-5 sm:px-7 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-700">{copy.quickReports}</p>
            <h2 className="mt-1 text-xl font-semibold text-slate-950">
              {languageKey === "th" ? "เลือกคำถามที่ต้องการตอบ" : "Choose the business question"}
            </h2>
            <p className="mt-1 text-sm text-slate-500">{copy.quickReportsDesc}</p>
          </div>
          {loadingData ? <p className="text-xs font-semibold text-slate-400">{copy.loading}</p> : null}
        </div>

        <div className="grid gap-px bg-slate-100 lg:grid-cols-2">
          <ReportPanel
            icon={Gauge}
            title={copy.vehicle}
            description={copy.vehicleDesc}
            accent="emerald"
            expanded={expandedReport === "vehicle"}
            onToggle={() => setExpandedReport(expandedReport === "vehicle" ? null : "vehicle")}
          >
            <div className="space-y-4">
              <p className="text-sm font-medium text-slate-700">{copy.questionVehicle}</p>
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">{copy.vehicleReportFilters}</p>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <label><span className="form-label">{copy.reportYear}</span><input type="number" min="2020" max="2100" value={vehicleReportFilters.year} onChange={(event) => setVehicleReportFilters({ ...vehicleReportFilters, year: Number(event.target.value) || new Date().getFullYear() })} className="form-input bg-white" /></label>
                <label><span className="form-label">{copy.reportMonth}</span><select value={vehicleReportFilters.month} onChange={(event) => setVehicleReportFilters({ ...vehicleReportFilters, month: event.target.value ? Number(event.target.value) : "" })} className="form-input bg-white"><option value="">{copy.allMonths}</option>{Array.from({ length: 12 }, (_, index) => index + 1).map((month) => <option key={month} value={month}>{new Intl.DateTimeFormat(languageKey === "th" ? "th-TH" : "en-GB", { month: "long" }).format(new Date(2026, month - 1, 1))}</option>)}</select></label>
                <SelectField label={copy.vehicleLabel} value={vehicleReportFilters.vehicleReg} onChange={(vehicleReg) => setVehicleReportFilters({ ...vehicleReportFilters, vehicleReg })} options={Array.from(new Set(vehicles.map((vehicle) => vehicle.vehicle_reg).filter(Boolean))).sort()} allLabel={copy.allVehicles} />
                <label><span className="form-label">{copy.reportSort}</span><select value={vehicleReportFilters.sort} onChange={(event) => setVehicleReportFilters({ ...vehicleReportFilters, sort: event.target.value as VehicleReportFilters["sort"] })} className="form-input bg-white"><option value="balance">{copy.sortBalance}</option><option value="revenue">{copy.sortRevenue}</option><option value="margin">{copy.sortMargin}</option><option value="fuel">{copy.sortFuel}</option></select></label>
              </div>
              {vehicleReportError ? <InlineError message={vehicleReportError} /> : null}
              <div className="flex flex-wrap items-center gap-3"><button type="button" onClick={() => void generateVehicleReport()} disabled={generatingReport === "vehicle"} className="btn-primary min-h-10 gap-2 px-4 py-2 text-sm disabled:opacity-50">{generatingReport === "vehicle" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}{generatingReport === "vehicle" ? copy.working : copy.printReport}</button><span className="text-xs text-slate-500">{copy.moduleReport}</span></div>
            </div>
          </ReportPanel>

          <ReportPanel
            icon={Droplets}
            title={copy.fuel}
            description={copy.fuelDesc}
            accent="violet"
            expanded={expandedReport === "fuel"}
            onToggle={() => setExpandedReport(expandedReport === "fuel" ? null : "fuel")}
          >
            <div className="space-y-4">
              <p className="text-sm font-medium text-slate-700">{copy.questionFuel}</p>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                <DateRangeFields filters={fuelSpendFilters} onChange={setFuelSpendFilters} copy={copy} />
                <SelectField
                  label={copy.vehicleLabel}
                  value={fuelSpendFilters.vehicleReg}
                  onChange={(vehicleReg) => setFuelSpendFilters({ ...fuelSpendFilters, vehicleReg })}
                  options={vehicleOptions}
                  allLabel={copy.allVehicles}
                />
                <SelectField
                  label={copy.driver}
                  value={fuelSpendFilters.driver}
                  onChange={(driver) => setFuelSpendFilters({ ...fuelSpendFilters, driver })}
                  options={driverOptions}
                  allLabel={copy.allDrivers}
                />
                <SelectField
                  label={copy.fuelType}
                  value={fuelSpendFilters.fuelType}
                  onChange={(fuelType) => setFuelSpendFilters({ ...fuelSpendFilters, fuelType })}
                  options={fuelTypeOptions}
                  allLabel={copy.allFuelTypes}
                />
                <SelectField
                  label={copy.station}
                  value={fuelSpendFilters.location}
                  onChange={(location) => setFuelSpendFilters({ ...fuelSpendFilters, location })}
                  options={["Bangchak", "Shell", "Best LPG", "Other", ...stationOptions]}
                  allLabel={copy.allStations}
                />
              </div>

              {fuelError ? <InlineError message={fuelError} /> : null}

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => void generateFuelReport()}
                  disabled={loadingData || generatingReport === "fuel"}
                  className="btn-primary min-h-10 gap-2 px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {generatingReport === "fuel" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                  {generatingReport === "fuel" ? copy.working : copy.generateFuel}
                </button>
                <span className="text-xs text-slate-500">{copy.directReport}</span>
              </div>
            </div>
          </ReportPanel>

          <ReportPanel
            icon={BookOpenCheck}
            title={copy.operations}
            description={copy.operationsDesc}
            accent="amber"
            expanded={expandedReport === "operations"}
            onToggle={() => setExpandedReport(expandedReport === "operations" ? null : "operations")}
          >
            <div className="space-y-4">
              <p className="text-sm font-medium text-slate-700">{copy.questionOperations}</p>
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">{copy.operationsReportFilters}</p>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                <DateRangeFields filters={operationsFilters} onChange={setOperationsFilters} copy={copy} />
                <label><span className="form-label">{copy.client}</span><select value={operationsFilters.clientId} onChange={(event) => setOperationsFilters({ ...operationsFilters, clientId: event.target.value })} className="form-input bg-white"><option value="">{copy.allClients}</option>{clientOptions.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label>
                <SelectField label={copy.vehicleLabel} value={operationsFilters.vehicleReg} onChange={(vehicleReg) => setOperationsFilters({ ...operationsFilters, vehicleReg })} options={bookingVehicleOptions} allLabel={copy.allVehicles} />
                <SelectField label={copy.driver} value={operationsFilters.driver} onChange={(driver) => setOperationsFilters({ ...operationsFilters, driver })} options={bookingDriverOptions} allLabel={copy.allDrivers} />
                <label><span className="form-label">{copy.routeContains}</span><input value={operationsFilters.routeQuery} onChange={(event) => setOperationsFilters({ ...operationsFilters, routeQuery: event.target.value })} placeholder={copy.routePlaceholder} className="form-input bg-white" /></label>
              </div>
              {operationsError ? <InlineError message={operationsError} /> : null}
              <div className="flex flex-wrap items-center gap-3"><button type="button" onClick={() => void generateOperationsReport()} disabled={loadingData || generatingReport === "operations"} className="btn-primary min-h-10 gap-2 px-4 py-2 text-sm disabled:opacity-50">{generatingReport === "operations" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}{generatingReport === "operations" ? copy.working : copy.printReport}</button><span className="text-xs text-slate-500">{copy.moduleReport}</span></div>
            </div>
          </ReportPanel>

          <ReportPanel
            icon={Route}
            title={copy.maintenance}
            description={copy.maintenanceDesc}
            accent="blue"
            expanded={expandedReport === "maintenance"}
            onToggle={() => setExpandedReport(expandedReport === "maintenance" ? null : "maintenance")}
          >
            <div className="space-y-4">
              <p className="text-sm font-medium text-slate-700">{copy.questionMaintenance}</p>
              <label className="block max-w-sm">
                <span className="form-label">{copy.weekEnding}</span>
                <select
                  value={weeklyMileageWeek}
                  onChange={(event) => setWeeklyMileageWeek(event.target.value)}
                  className="form-input bg-white"
                >
                  {weekOptions.length ? (
                    weekOptions.map((week) => (
                      <option key={week} value={week}>
                        {formatDate(week, languageKey)}
                      </option>
                    ))
                  ) : (
                    <option value="">{copy.noMileageReports}</option>
                  )}
                </select>
              </label>

              {mileageError ? <InlineError message={mileageError} /> : null}

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => void generateMileageReport()}
                  disabled={loadingData || generatingReport === "maintenance" || !weeklyMileageWeek}
                  className="btn-primary min-h-10 gap-2 px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {generatingReport === "maintenance" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                  {generatingReport === "maintenance" ? copy.working : copy.generateMileage}
                </button>

              </div>
            </div>
          </ReportPanel>
        </div>
      </section>
    </div>
  );
}

function escapeHtml(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[character] || character));
}

function formatMoney(value: number) {
  return `฿${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function formatPercent(value: number | null | undefined) {
  return value == null || !Number.isFinite(value) ? "-" : `${value.toFixed(1)}%`;
}

function DataMini({ value, label }: { value: string; label: string }) {
  return (
    <div className="border-r border-slate-100 px-3 py-3 text-center last:border-r-0">
      <div className="text-lg font-semibold text-slate-950">{value}</div>
      <div className="mt-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">{label}</div>
    </div>
  );
}

function SourcePill({
  icon: Icon,
  label,
  status,
}: {
  icon: typeof Gauge;
  label: string;
  status: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/6 px-3 py-3">
      <div className="flex items-center gap-2.5">
        <Icon className="h-4 w-4 text-violet-200" />
        <span className="text-sm font-medium text-white">{label}</span>
      </div>
      <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-300">
        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
        {status}
      </span>
    </div>
  );
}

function ReportPanel({
  icon: Icon,
  title,
  description,
  accent,
  expanded,
  onToggle,
  children,
}: {
  icon: typeof Gauge;
  title: string;
  description: string;
  accent: "emerald" | "violet" | "amber" | "blue";
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  const accentClasses = {
    emerald: "bg-emerald-50 text-emerald-700 border-emerald-100",
    violet: "bg-violet-50 text-violet-700 border-violet-100",
    amber: "bg-amber-50 text-amber-700 border-amber-100",
    blue: "bg-sky-50 text-sky-700 border-sky-100",
  }[accent];

  return (
    <article className="bg-white p-5 transition-colors hover:bg-slate-50/40 sm:p-5">
      <button type="button" onClick={onToggle} className="flex w-full items-start justify-between gap-4 text-left">
        <div className="flex min-w-0 items-start gap-4">
          <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border ${accentClasses}`}>
            <Icon className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-slate-950">{title}</h3>
            <p className="mt-1 max-w-xl text-sm leading-6 text-slate-500">{description}</p>
          </div>
        </div>
        <ChevronDown className={`mt-1 h-5 w-5 shrink-0 text-slate-400 transition ${expanded ? "rotate-180" : ""}`} />
      </button>

      {expanded ? <div className="mt-5 border-t border-slate-100 pt-5">{children}</div> : null}
    </article>
  );
}

function DateRangeFields<T extends DateRange>({
  filters,
  onChange,
  copy,
}: {
  filters: T;
  onChange: (filters: T) => void;
  copy: ReturnType<typeof uiCopy>;
}) {
  const updatePreset = (preset: DatePreset) => {
    if (preset === "custom") onChange({ ...filters, preset });
    else onChange({ ...filters, ...getDateRange(preset) });
  };

  return (
    <>
      <label>
        <span className="form-label">{copy.dateRange}</span>
        <select
          value={filters.preset}
          onChange={(event) => updatePreset(event.target.value as DatePreset)}
          className="form-input bg-white"
        >
          <option value="today">{copy.today}</option>
          <option value="this_week">{copy.thisWeek}</option>
          <option value="last_week">{copy.lastWeek}</option>
          <option value="this_month">{copy.thisMonth}</option>
          <option value="last_month">{copy.lastMonth}</option>
          <option value="custom">{copy.custom}</option>
        </select>
      </label>

      {filters.preset === "custom" ? (
        <>
          <label>
            <span className="form-label">{copy.from}</span>
            <input
              type="date"
              value={filters.fromDate}
              onChange={(event) => onChange({ ...filters, fromDate: event.target.value })}
              className="form-input bg-white"
            />
          </label>
          <label>
            <span className="form-label">{copy.to}</span>
            <input
              type="date"
              value={filters.toDate}
              onChange={(event) => onChange({ ...filters, toDate: event.target.value })}
              className="form-input bg-white"
            />
          </label>
        </>
      ) : null}
    </>
  );
}

function SelectField({
  allLabel,
  label,
  onChange,
  options,
  value,
}: {
  allLabel: string;
  label: string;
  onChange: (value: string) => void;
  options: string[];
  value: string;
}) {
  return (
    <label>
      <span className="form-label">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} className="form-input bg-white">
        <option value="">{allLabel}</option>
        {options.map((option) => (
          <option key={`${label}-${option}`} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function InlineError({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-rose-100 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">
      {message}
    </div>
  );
}
