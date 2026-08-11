import { compareWeeklyMileageRows, WEEKLY_MILEAGE_REVIEW_THRESHOLD_KM, weeklyMileageComparisonGroup } from "@/lib/weekly-mileage-report";
import type { WeeklyMileageComparisonGroup, WeeklyMileageComparisonReport, WeeklyMileageComparisonRow } from "@/lib/weekly-mileage-report";

type ReportLanguage = "en" | "th";
type CanvasPage = { data: string; height: number; width: number };

const PDF_COLORS = {
  accent: "#6D28D9",
  border: "#DDD6FE",
  header: "#4C1D95",
  lavender: "#EDE9FE",
  lightCard: "#F7F5FF",
  mutedPurple: "#6B5A7E",
  text: "#172033"
} as const;

// The source image has transparent padding around the complete logo artwork.
const LOGO_SOURCE_BOUNDS = { x: 470, y: 224, width: 597, height: 503 } as const;
const LOGO_PRINTED_WIDTH_PT = 42;

const copy = {
  en: {
    company: "Expert Express Sender Co., Ltd.",
    title: "Weekly Fleet Mileage Overview",
    selectedDate: "Selected reporting date",
    generated: "Generated",
    totalActive: "Active vehicles",
    recorded: "Recorded for reporting week",
    missing: "Missing for reporting week",
    compared: "Vehicles compared",
    totalCurrent: "Reporting week distance",
    totalPrevious: "Comparable distance previous week",
    difference: "Difference between comparable weeks",
    odometerErrors: "Odometer errors",
    warning: (count: number) => `Warning: ${count} active vehicle${count === 1 ? " has" : "s have"} no mileage entry for this reporting week.`,
    vehicle: "Vehicle registration",
    driver: "Driver name",
    previousReading: "Previous weekly reading",
    currentReading: "Current weekly reading",
    currentDistance: "Reporting week distance",
    previousDistance: "Distance previous week",
    differenceKm: "Difference KM",
    status: "Status",
    page: "Page",
  },
  th: {
    company: "Expert Express Sender Co., Ltd.",
    title: "รายงานเปรียบเทียบระยะทางประจำสัปดาห์",
    selectedDate: "วันที่รายงานที่เลือก",
    generated: "สร้างเมื่อ",
    totalActive: "รถที่ใช้งาน",
    recorded: "บันทึกสัปดาห์นี้",
    missing: "ขาดข้อมูลสัปดาห์นี้",
    compared: "รถที่เปรียบเทียบได้",
    totalCurrent: "ระยะทางเปรียบเทียบสัปดาห์นี้",
    totalPrevious: "ระยะทางเปรียบเทียบสัปดาห์ก่อน",
    difference: "ผลต่างของสัปดาห์ที่เปรียบเทียบ",
    odometerErrors: "เลขไมล์ผิดปกติ",
    warning: (count: number) => `คำเตือน: รถที่ใช้งาน ${count} คันไม่มีรายการเลขไมล์สำหรับรอบรายงานนี้`,
    vehicle: "ทะเบียนรถ",
    driver: "ชื่อคนขับ",
    previousReading: "เลขไมล์สัปดาห์ก่อน",
    currentReading: "เลขไมล์สัปดาห์นี้",
    currentDistance: "ระยะทางสัปดาห์นี้",
    previousDistance: "ระยะทางสัปดาห์ก่อน",
    differenceKm: "ผลต่าง กม.",
    status: "สถานะ",
    page: "หน้า",
  }
} as const;

function binaryStringFromDataUrl(dataUrl: string) {
  return atob(dataUrl.split(",")[1] ?? "");
}

function buildImagePagesPdf(imagePages: CanvasPage[]) {
  const pageWidth = 842;
  const pageHeight = 595;
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
  for (let index = 0; index < pdf.length; index += 1) bytes[index] = pdf.charCodeAt(index) & 0xff;
  return new Blob([bytes], { type: "application/pdf" });
}

async function loadThaiFont() {
  if (typeof FontFace === "undefined") return;
  let loaded = false;
  document.fonts.forEach((font) => {
    if (font.family === "WeeklyMileagePdfThai") loaded = true;
  });
  if (loaded) return;
  const response = await fetch("/fonts/boss-pdf-thai.ttf");
  if (!response.ok) throw new Error("Unable to load the Thai PDF font.");
  const font = new FontFace("WeeklyMileagePdfThai", await response.arrayBuffer(), { style: "normal", weight: "400" });
  await font.load();
  document.fonts.add(font);
  await document.fonts.ready;
}

async function loadLogo() {
  const image = new Image();
  return new Promise<HTMLImageElement | null>((resolve) => {
    const timeout = window.setTimeout(() => resolve(null), 5000);
    image.onload = () => {
      window.clearTimeout(timeout);
      resolve(image);
    };
    image.onerror = () => {
      window.clearTimeout(timeout);
      resolve(null);
    };
    image.src = "/logo.png";
  });
}

function formatDate(value: string | null, language: ReportLanguage) {
  if (!value) return "-";
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat(language === "th" ? "th-TH" : "en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).format(new Date(year, month - 1, day));
}

function formatKm(value: number | null, language: ReportLanguage, signed = false) {
  if (value == null || !Number.isFinite(value)) return "-";
  const formatted = new Intl.NumberFormat(language === "th" ? "th-TH" : "en-GB", { maximumFractionDigits: 0 }).format(Math.abs(value));
  return `${signed && value > 0 ? "+" : value < 0 ? "-" : ""}${formatted}`;
}

function shiftDate(value: string, days: number) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function formatShortDate(value: string, language: ReportLanguage) {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat(language === "th" ? "th-TH" : "en-GB", {
    day: "2-digit",
    month: "short"
  }).format(new Date(year, month - 1, day));
}

function formatReportingPeriod(startValue: string, endValue: string, language: ReportLanguage) {
  const [startYear, startMonth, startDay] = startValue.split("-").map(Number);
  const [endYear, endMonth, endDay] = endValue.split("-").map(Number);
  const locale = language === "th" ? "th-TH" : "en-GB";
  const startDate = new Date(startYear, startMonth - 1, startDay);
  const endDate = new Date(endYear, endMonth - 1, endDay);
  if (startYear === endYear && startMonth === endMonth) {
    const firstDay = new Intl.DateTimeFormat(locale, { day: "2-digit" }).format(startDate);
    const periodEnd = new Intl.DateTimeFormat(locale, { day: "2-digit", month: "short", year: "numeric" }).format(endDate);
    return `${firstDay}-${periodEnd}`;
  }
  return `${formatDate(startValue, language)} - ${formatDate(endValue, language)}`;
}

function rowStatusLabel(row: WeeklyMileageComparisonRow, language: ReportLanguage) {
  if (row.status === "missing_this_week") return language === "th" ? "ยังไม่ได้บันทึกเลขไมล์ปัจจุบัน" : "Current reading not entered";
  if (row.status === "missing_previous_week" || row.status === "missing_comparison_data") return language === "th" ? "เปรียบเทียบไม่ได้" : "Cannot compare";
  if (row.status === "odometer_error") return language === "th" ? "เลขไมล์ผิดพลาด" : "Odometer reading error";
  if (row.differenceKm == null) return language === "th" ? "เปรียบเทียบไม่ได้" : "Cannot compare";
  if (row.differenceKm > 0) return language === "th" ? "มากกว่าสัปดาห์ก่อนหน้า" : "More than previous week";
  if (row.differenceKm < 0) return language === "th" ? "น้อยกว่าสัปดาห์ก่อนหน้า" : "Less than previous week";
  return language === "th" ? "เท่ากับสัปดาห์ก่อนหน้า" : "Same as previous week";
}

function statusColors(row: WeeklyMileageComparisonRow) {
  if (row.status === "missing_this_week" || row.status === "missing_previous_week" || row.status === "missing_comparison_data") return { bg: "#FEF3C7", text: "#92400E" };
  if (row.status === "odometer_error") return { bg: "#FEE2E2", text: "#B91C1C" };
  if (row.differenceKm == null || row.differenceKm === 0) return { bg: "#EEF0F3", text: "#475569" };
  if (row.differenceKm >= WEEKLY_MILEAGE_REVIEW_THRESHOLD_KM) return { bg: "#DDE5FF", text: "#3730A3" };
  if (row.differenceKm > 0) return { bg: "#F0F5FF", text: "#3F5F8F" };
  if (row.differenceKm <= -WEEKLY_MILEAGE_REVIEW_THRESHOLD_KM) return { bg: "#E5D9F5", text: "#5B3478" };
  return { bg: "#F6F1FA", text: "#6B4B82" };
}

function groupPresentation(group: WeeklyMileageComparisonGroup, language: ReportLanguage) {
  const presentations = language === "th" ? {
    cannot_compare: { label: "เปรียบเทียบไม่ได้", divider: "#D6A646" },
    more: { label: "มากกว่าสัปดาห์ก่อนหน้า", divider: "#6F88D8" },
    less: { label: "น้อยกว่าสัปดาห์ก่อนหน้า", divider: "#8B67AE" },
    same: { label: "เท่ากับสัปดาห์ก่อนหน้า", divider: "#94A3B8" }
  } : {
    cannot_compare: { label: "Cannot compare", divider: "#D6A646" },
    more: { label: "More than previous week", divider: "#6F88D8" },
    less: { label: "Less than previous week", divider: "#8B67AE" },
    same: { label: "Same as previous week", divider: "#94A3B8" }
  };
  return presentations[group];
}

export async function buildWeeklyMileageComparisonPdf(
  report: WeeklyMileageComparisonReport,
  language: ReportLanguage,
  generatedAt = new Date()
) {
  if (language === "th") await loadThaiFont();
  const labels = copy[language];
  const logo = await loadLogo().catch(() => null);
  const fontFamily = language === "th" ? '"WeeklyMileagePdfThai", Tahoma, sans-serif' : 'Arial, "Helvetica Neue", sans-serif';
  const pageWidth = 842;
  const pageHeight = 595;
  const scale = 2;
  const margin = 10;
  const contentWidth = pageWidth - margin * 2;
  const tableBottom = 542;
  const rowHeight = 18;
  const closingReadingDate = report.selectedWeek;
  const openingReadingDate = shiftDate(report.selectedWeek, -7);
  const reportingWeekStart = shiftDate(report.selectedWeek, -6);
  const reportingPeriod = formatReportingPeriod(reportingWeekStart, closingReadingDate, language);
  const columns = [
    { key: "vehicle", width: 86, label: language === "en" ? "Vehicle" : labels.vehicle },
    { key: "driver", width: 100, label: language === "en" ? "Driver" : labels.driver },
    { key: "previousReading", width: 118, label: language === "en" ? "Opening reading" : "เลขไมล์เปิด", subLabel: formatDate(openingReadingDate, language) },
    { key: "currentReading", width: 118, label: language === "en" ? "Closing reading" : "เลขไมล์ปิด", subLabel: formatDate(closingReadingDate, language) },
    { key: "currentDistance", width: 80, label: language === "en" ? "Reporting week KM" : "กม. รอบรายงาน" },
    { key: "previousDistance", width: 80, label: language === "en" ? "Previous week KM" : "กม. สัปดาห์ก่อน" },
    { key: "difference", width: 110, label: language === "en" ? "Difference KM" : labels.differenceKm },
    { key: "status", width: 130, label: language === "en" ? "Weekly comparison" : labels.status }
  ];
  const pageImages: CanvasPage[] = [];
  let canvas!: HTMLCanvasElement;
  let context!: CanvasRenderingContext2D;
  let pageNumber = 0;
  let y = 0;

  const setFont = (size: number, weight = 400) => {
    context.font = `${weight} ${size}px ${fontFamily}`;
    context.fontVariantCaps = "normal";
  };
  const fitText = (value: unknown, maxWidth: number, size: number, minSize = 5.2) => {
    const text = String(value ?? "-").replace(/\s+/g, " ").trim() || "-";
    let fittedSize = size;
    setFont(fittedSize, 500);
    while (fittedSize > minSize && context.measureText(text).width > maxWidth) {
      fittedSize -= 0.2;
      setFont(fittedSize, 500);
    }
    if (context.measureText(text).width <= maxWidth) return { text, size: fittedSize };
    let clipped = text;
    while (clipped.length > 1 && context.measureText(`${clipped}...`).width > maxWidth) clipped = clipped.slice(0, -1);
    return { text: `${clipped}...`, size: fittedSize };
  };
  const drawText = (value: unknown, x: number, textY: number, maxWidth: number, options: { align?: CanvasTextAlign; color?: string; size?: number; weight?: number } = {}) => {
    const fitted = fitText(value, maxWidth, options.size ?? 6.2);
    setFont(fitted.size, options.weight ?? 500);
    context.fillStyle = options.color ?? "#0f172a";
    context.textAlign = options.align ?? "left";
    const drawX = options.align === "center" ? x + maxWidth / 2 : options.align === "right" ? x + maxWidth : x;
    context.fillText(fitted.text, drawX, textY);
    context.textAlign = "left";
  };
  const rect = (x: number, rectY: number, width: number, height: number, fill: string, stroke = "#dbe3ef") => {
    context.fillStyle = fill;
    context.fillRect(x, rectY, width, height);
    context.strokeStyle = stroke;
    context.lineWidth = 0.7;
    context.strokeRect(x + 0.35, rectY + 0.35, width - 0.7, height - 0.7);
  };
  const roundedRect = (x: number, rectY: number, width: number, height: number, radius: number, fill: string, stroke?: string) => {
    const safeRadius = Math.min(radius, width / 2, height / 2);
    context.beginPath();
    context.moveTo(x + safeRadius, rectY);
    context.lineTo(x + width - safeRadius, rectY);
    context.quadraticCurveTo(x + width, rectY, x + width, rectY + safeRadius);
    context.lineTo(x + width, rectY + height - safeRadius);
    context.quadraticCurveTo(x + width, rectY + height, x + width - safeRadius, rectY + height);
    context.lineTo(x + safeRadius, rectY + height);
    context.quadraticCurveTo(x, rectY + height, x, rectY + height - safeRadius);
    context.lineTo(x, rectY + safeRadius);
    context.quadraticCurveTo(x, rectY, x + safeRadius, rectY);
    context.closePath();
    context.fillStyle = fill;
    context.fill();
    if (stroke) {
      context.strokeStyle = stroke;
      context.lineWidth = 0.6;
      context.stroke();
    }
  };
  const drawTableHeader = () => {
    let x = margin;
    for (const column of columns) {
      rect(x, y, column.width, 22, "#F3F0FA", PDF_COLORS.border);
      if ("subLabel" in column && column.subLabel) {
        drawText(column.label, x + 4, y + 9, column.width - 8, { align: "center", color: PDF_COLORS.header, size: language === "th" ? 5.8 : 6.5, weight: 700 });
        drawText(column.subLabel, x + 4, y + 18, column.width - 8, { align: "center", color: PDF_COLORS.mutedPurple, size: language === "th" ? 5 : 5.5, weight: 600 });
      } else {
        drawText(column.label, x + 4, y + 14, column.width - 8, { align: "center", color: PDF_COLORS.header, size: language === "th" ? 6.2 : 7, weight: 700 });
      }
      x += column.width;
    }
    y += 22;
  };
  const drawFooter = () => {
    context.strokeStyle = PDF_COLORS.border;
    context.beginPath();
    context.moveTo(margin, 574.5);
    context.lineTo(pageWidth - margin, 574.5);
    context.stroke();
    drawText(`${labels.generated}: ${new Intl.DateTimeFormat(language === "th" ? "th-TH" : "en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" }).format(generatedAt)}`, margin, 587, 520, { color: PDF_COLORS.mutedPurple, size: 6.2 });
    drawText(`${labels.page} ${pageNumber}`, pageWidth - margin - 70, 587, 70, { align: "right", color: PDF_COLORS.mutedPurple, size: 6.3, weight: 700 });
  };
  const startPage = (continuation: boolean) => {
    pageNumber += 1;
    canvas = document.createElement("canvas");
    canvas.width = pageWidth * scale;
    canvas.height = pageHeight * scale;
    const nextContext = canvas.getContext("2d");
    if (!nextContext) throw new Error("Unable to prepare the weekly mileage PDF canvas.");
    context = nextContext;
    context.scale(scale, scale);
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, pageWidth, pageHeight);
    context.fillStyle = PDF_COLORS.header;
    context.fillRect(0, 0, pageWidth, continuation ? 38 : 44);
    if (!continuation && logo) {
      const logoHeight = LOGO_PRINTED_WIDTH_PT * (LOGO_SOURCE_BOUNDS.height / LOGO_SOURCE_BOUNDS.width);
      context.drawImage(
        logo,
        LOGO_SOURCE_BOUNDS.x,
        LOGO_SOURCE_BOUNDS.y,
        LOGO_SOURCE_BOUNDS.width,
        LOGO_SOURCE_BOUNDS.height,
        margin,
        (44 - logoHeight) / 2,
        LOGO_PRINTED_WIDTH_PT,
        logoHeight
      );
    }
    const headingX = !continuation && logo ? margin + LOGO_PRINTED_WIDTH_PT + 9 : margin;
    drawText(labels.company, headingX, continuation ? 14 : 14, 420, { color: "#ffffff", size: language === "th" ? 7 : 7.6, weight: 700 });
    drawText(language === "en" ? "Weekly Fleet Mileage Overview" : "ภาพรวมระยะทางรถประจำสัปดาห์", headingX, continuation ? 30 : 33, 500, { color: "#ffffff", size: language === "th" ? 10.5 : 12.5, weight: 700 });
    const reportingWeekLabel = language === "th" ? `รอบรายงาน: ${reportingPeriod}` : `Reporting week: ${reportingPeriod}`;
    drawText(reportingWeekLabel, 570, continuation ? 22 : 18, 260, { align: "right", color: PDF_COLORS.lavender, size: language === "th" ? 6.3 : 7, weight: 700 });
    if (!continuation) {
      const sundayLabel = language === "th" ? `สิ้นสุดวันอาทิตย์ ${formatDate(closingReadingDate, language)}` : `Week ending Sunday ${formatDate(closingReadingDate, language)}`;
      drawText(sundayLabel, 570, 32, 260, { align: "right", color: "#D8CCF5", size: language === "th" ? 5.3 : 5.7, weight: 500 });
    }
    if (continuation) {
      y = 43;
      drawTableHeader();
      return;
    }
    const weeklyDifferenceDetail = report.comparableDistanceDifference === 0
      ? language === "th" ? "เท่ากับสัปดาห์ก่อนหน้า" : "No change from previous week"
      : language === "th"
        ? `${formatKm(Math.abs(report.comparableDistanceDifference), language)} KM ${report.comparableDistanceDifference > 0 ? "มากขึ้น" : "น้อยลง"}`
        : `${formatKm(Math.abs(report.comparableDistanceDifference), language)} KM ${report.comparableDistanceDifference > 0 ? "more" : "less"}`;
    const summaries = language === "th" ? [
      ["ได้รับข้อมูลเลขไมล์", `${report.vehiclesRecordedThisWeek} จาก ${report.totalActiveVehicles} คัน`, "", PDF_COLORS.lightCard, "#166534"],
      ["รถที่เปรียบเทียบ", `${report.vehiclesCompared} คัน`, "เลขไมล์รายสัปดาห์ต่อเนื่อง", PDF_COLORS.lightCard, PDF_COLORS.header],
      ["ระยะทางรอบรายงาน", `${formatKm(report.comparableDistanceThisWeek, language)} KM`, `สัปดาห์ก่อนหน้า: ${formatKm(report.comparableDistancePreviousWeek, language)} KM | ${report.vehiclesCompared} คัน`, PDF_COLORS.lightCard, PDF_COLORS.header],
      ["ผลต่างจากสัปดาห์ก่อนหน้า", weeklyDifferenceDetail, "", PDF_COLORS.lavender, PDF_COLORS.accent]
    ] : [
      ["READINGS RECEIVED", `${report.vehiclesRecordedThisWeek} of ${report.totalActiveVehicles} vehicles`, "", PDF_COLORS.lightCard, "#166534"],
      ["VEHICLES COMPARED", `${report.vehiclesCompared} vehicles`, "Consecutive weekly readings", PDF_COLORS.lightCard, PDF_COLORS.header],
      ["REPORTING WEEK DISTANCE", `${formatKm(report.comparableDistanceThisWeek, language)} KM`, `Previous week: ${formatKm(report.comparableDistancePreviousWeek, language)} KM | Based on ${report.vehiclesCompared} comparable vehicles`, PDF_COLORS.lightCard, PDF_COLORS.header],
      ["DIFFERENCE FROM PREVIOUS WEEK", weeklyDifferenceDetail, "", PDF_COLORS.lavender, PDF_COLORS.accent]
    ];
    const gap = 4;
    const cardWidth = (contentWidth - gap * 3) / 4;
    summaries.forEach(([label, value, detail, background, tone], index) => {
      const cardX = margin + index * (cardWidth + gap);
      const cardY = 49;
      roundedRect(cardX, cardY, cardWidth, 38, 4, background, PDF_COLORS.border);
      drawText(label, cardX + 7, cardY + 9, cardWidth - 14, { color: PDF_COLORS.mutedPurple, size: language === "th" ? 5.4 : 5.6, weight: 700 });
      drawText(value, cardX + 7, cardY + 23, cardWidth - 14, { color: tone, size: language === "th" ? 8.5 : 9.8, weight: 700 });
      if (detail) drawText(detail, cardX + 7, cardY + 33, cardWidth - 14, { color: PDF_COLORS.mutedPurple, size: language === "th" ? 5.6 : 6, weight: 500 });
    });
    y = 93;
    roundedRect(margin, y, contentWidth, 23, 4, "#FCFBFF", PDF_COLORS.border);
    drawText(language === "th" ? "สรุปรายสัปดาห์" : "Weekly summary", margin + 8, y + 14, 100, { color: PDF_COLORS.header, size: 6.3, weight: 700 });
    const moreRows = report.rows.filter((row) => weeklyMileageComparisonGroup(row) === "more");
    const lessRows = report.rows.filter((row) => weeklyMileageComparisonGroup(row) === "less");
    const sameRows = report.rows.filter((row) => weeklyMileageComparisonGroup(row) === "same");
    const cannotCompare = report.rows.filter((row) => weeklyMileageComparisonGroup(row) === "cannot_compare");
    const higherVariations = report.rows.filter((row) => row.differenceKm != null && row.differenceKm >= WEEKLY_MILEAGE_REVIEW_THRESHOLD_KM);
    const lowerVariations = report.rows.filter((row) => row.differenceKm != null && row.differenceKm <= -WEEKLY_MILEAGE_REVIEW_THRESHOLD_KM);
    const cannotCompareRegs = cannotCompare.map((row) => row.vehicleReg).join(", ");
    const attentionBadges = [
      { text: language === "th" ? `${moreRows.length} คันมากกว่าสัปดาห์ก่อนหน้า · ${higherVariations.length} คันตั้งแต่ ${formatKm(WEEKLY_MILEAGE_REVIEW_THRESHOLD_KM, language)} KM` : `${moreRows.length} more than previous week · ${higherVariations.length} by ${formatKm(WEEKLY_MILEAGE_REVIEW_THRESHOLD_KM, language)} KM+`, bg: "#DDE5FF", color: "#3730A3" },
      { text: language === "th" ? `${lessRows.length} คันน้อยกว่าสัปดาห์ก่อนหน้า · ${lowerVariations.length} คันตั้งแต่ ${formatKm(WEEKLY_MILEAGE_REVIEW_THRESHOLD_KM, language)} KM` : `${lessRows.length} less than previous week · ${lowerVariations.length} by ${formatKm(WEEKLY_MILEAGE_REVIEW_THRESHOLD_KM, language)} KM+`, bg: "#E5D9F5", color: "#5B3478" },
      { text: language === "th" ? `${sameRows.length} คันเท่ากับสัปดาห์ก่อนหน้า` : `${sameRows.length} same as previous week`, bg: "#EEF0F3", color: "#475569" },
      { text: language === "th" ? `${cannotCompare.length} คันเปรียบเทียบไม่ได้ · ${cannotCompareRegs}` : `${cannotCompare.length} cannot compare · ${cannotCompareRegs}`, bg: "#FFF8D8", color: "#8A5B00" }
    ];
    let badgeX = margin + 110;
    const badgeWidth = (contentWidth - 110 - (attentionBadges.length - 1) * 5) / attentionBadges.length;
    for (const badge of attentionBadges) {
      roundedRect(badgeX, y + 5, badgeWidth, 13, 6.5, badge.bg);
      drawText(badge.text, badgeX + 5, y + 14, badgeWidth - 10, { align: "center", color: badge.color, size: language === "th" ? 5.2 : 5.7, weight: 700 });
      badgeX += badgeWidth + 5;
    }
    y += 29;
    drawTableHeader();
  };
  const finishPage = () => {
    drawFooter();
    pageImages.push({ data: binaryStringFromDataUrl(canvas.toDataURL("image/jpeg", 0.94)), height: canvas.height, width: canvas.width });
  };
  const rowValues = (row: WeeklyMileageComparisonRow) => [
    row.vehicleReg,
    row.driverName,
    "",
    "",
    row.currentDistance == null ? "-" : formatKm(row.currentDistance, language),
    row.previousDistance == null ? "-" : formatKm(row.previousDistance, language),
    row.differenceKm == null
      ? "-"
      : row.differenceKm === 0
        ? language === "th" ? "ไม่เปลี่ยนแปลง" : "No change"
        : language === "th"
          ? `${formatKm(Math.abs(row.differenceKm), language)} KM ${row.differenceKm > 0 ? "มากขึ้น" : "น้อยลง"}`
          : `${formatKm(Math.abs(row.differenceKm), language)} KM ${row.differenceKm > 0 ? "more" : "less"}`,
    rowStatusLabel(row, language)
  ];

  const displayRows = [...report.rows].sort(compareWeeklyMileageRows);
  let previousGroup: WeeklyMileageComparisonGroup | null = null;

  startPage(false);
  for (let index = 0; index < displayRows.length; index += 1) {
    if (y + rowHeight > tableBottom) {
      finishPage();
      startPage(true);
      previousGroup = null;
    }
    const row = displayRows[index];
    const values = rowValues(row);
    const group = weeklyMileageComparisonGroup(row);
    const isGroupStart = group !== previousGroup;
    const groupStyle = groupPresentation(group, language);
    let x = margin;
    const tone = statusColors(row);
    columns.forEach((column, columnIndex) => {
      const fill = index % 2 === 0 ? "#FFFFFF" : "#FCFBFF";
      rect(x, y, column.width, rowHeight, fill, "#E5E0EC");
      if (column.key === "previousReading" || column.key === "currentReading") {
        const odometer = column.key === "previousReading" ? row.previousOdometer : row.currentOdometer;
        const readingDate = column.key === "previousReading" ? row.previousReadingDate : row.currentReadingDate;
        const missingDate = column.key === "previousReading" ? shiftDate(report.selectedWeek, -7) : report.selectedWeek;
        const missingText = !readingDate && column.key === "currentReading" && row.status === "missing_this_week"
          ? language === "th" ? "ยังไม่ได้บันทึก" : "Not entered"
          : !readingDate && column.key === "previousReading" && row.status === "missing_previous_week"
            ? language === "th" ? `${formatShortDate(missingDate, language)} ไม่มีข้อมูล` : `${formatShortDate(missingDate, language)} reading unavailable`
            : "-";
        if (readingDate) {
          drawText(formatKm(odometer, language), x + 5, y + 8, column.width - 10, { align: "right", size: language === "th" ? 6.8 : 7.4, weight: 600 });
          drawText(formatDate(readingDate, language), x + 5, y + 16, column.width - 10, { align: "right", color: "#6b7280", size: language === "th" ? 5.8 : 6.2, weight: 500 });
        } else {
          drawText(missingText, x + 5, y + 12, column.width - 10, { align: "right", color: "#9a6700", size: language === "th" ? 6.2 : 6.7, weight: 700 });
        }
      } else if (column.key === "status") {
        const badgeWidth = column.width - 12;
        roundedRect(x + 6, y + 3, badgeWidth, rowHeight - 6, 6, tone.bg);
        drawText(values[columnIndex], x + 10, y + 12, badgeWidth - 8, { align: "center", color: tone.text, size: language === "th" ? 5.7 : 6.2, weight: 700 });
      } else {
        drawText(values[columnIndex], x + 5, y + 12, column.width - 10, {
          align: ["currentDistance", "previousDistance", "difference"].includes(column.key) ? "right" : "left",
          color: PDF_COLORS.text,
          size: language === "th" ? 6.7 : 7.2,
          weight: column.key === "vehicle" ? 700 : ["currentDistance", "previousDistance", "difference"].includes(column.key) ? 600 : 500
        });
      }
      x += column.width;
    });
    if (isGroupStart) {
      context.strokeStyle = groupStyle.divider;
      context.lineWidth = 1.6;
      context.beginPath();
      context.moveTo(margin, y + 0.8);
      context.lineTo(pageWidth - margin, y + 0.8);
      context.stroke();
    }
    previousGroup = group;
    y += rowHeight;
  }
  const managementNote = language === "th"
    ? "ระยะทางรายสัปดาห์อาจเปลี่ยนตามปริมาณงาน การลา การบำรุงรักษา หรือการจัดสรรรถ ความแตกต่างนี้แสดงเพื่อประกอบการพิจารณาและไม่ได้หมายความว่ามีปัญหา"
    : "Weekly distance may vary due to workload, leave, maintenance or vehicle allocation. Variations are shown for context and do not necessarily indicate a problem.";
  const performanceNote = language === "th"
    ? "รายงานนี้เปรียบเทียบระยะทางของรถและไม่ใช่การวัดผลงานของคนขับ"
    : "This report compares vehicle mileage and is not a measure of driver performance.";
  const reportingPeriodNote = language === "th"
    ? `รอบรายงาน: ${reportingPeriod} คำนวณระยะทางจากเลขไมล์วันอาทิตย์ที่ลงวันที่ ${formatDate(openingReadingDate, language)} และ ${formatDate(closingReadingDate, language)}`
    : `Reporting week: ${reportingPeriod}. Mileage is calculated using the Sunday odometer readings dated ${formatDate(openingReadingDate, language)} and ${formatDate(closingReadingDate, language)}.`;
  drawText(reportingPeriodNote, margin + 2, 548, contentWidth - 4, { color: PDF_COLORS.header, size: language === "th" ? 5.3 : 5.7, weight: 700 });
  drawText(managementNote, margin + 2, 557, contentWidth - 4, { color: PDF_COLORS.mutedPurple, size: language === "th" ? 5.3 : 5.7, weight: 500 });
  drawText(performanceNote, margin + 2, 566, contentWidth - 4, { color: "#81758E", size: language === "th" ? 5 : 5.3, weight: 500 });
  finishPage();
  return buildImagePagesPdf(pageImages);
}
