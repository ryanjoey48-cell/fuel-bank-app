import {
  annualInsuranceCost,
  buildDataQualityFindings,
  categoryLabel,
  getAssetCategory,
  insuranceHistoryStatus,
  insuranceRequirement,
  isCompulsoryConfirmed,
  isInsuranceNotRequired,
  normalizeInsuranceRegistration,
  premiumToInsuredValue,
  renewalBand,
  summarizeInsurance,
  type InsuranceAssetRecord,
  type InsuranceDocumentRecord
} from "@/lib/insurance-intelligence";
import { canonicalInsurerName } from "@/lib/insurance-providers";

export type InsuranceReportLanguage = "en" | "th";
export type InsuranceReportType =
  | "fleet_summary"
  | "renewal"
  | "cost"
  | "vehicle_detail"
  | "asset_register"
  | "missing_information"
  | "comparison"
  | "trailer"
  | "expired"
  | "executive";

type CellValue = string | number | null | undefined;
type ReportColumn = {
  key: string;
  label: string;
  width: number;
  value: (record: InsuranceAssetRecord) => CellValue;
  align?: "left" | "right";
};
type CanvasPage = { data: string; height: number; width: number };

export type InsuranceReportHistoryRecord = {
  id: string;
  insurance_record_id: string;
  insurer_th: string | null;
  insurer_en: string | null;
  policy_number: string | null;
  insurance_class: string | null;
  policy_issue_date: string | null;
  insurance_start_date: string | null;
  insurance_expiry_date: string | null;
  insured_value: number | null;
  insurance_premium: number | null;
  archived_at: string;
};

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const MARGIN = 34;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const COLORS = {
  ink: "#172033",
  muted: "#64748B",
  violet: "#4C3A78",
  violetLight: "#F0EDFA",
  border: "#DDE2EA",
  panel: "#F7F7FA",
  green: "#047857",
  amber: "#B45309",
  rose: "#BE123C",
  white: "#FFFFFF"
} as const;

const reportTitles: Record<InsuranceReportType, { en: string; th: string }> = {
  fleet_summary: { en: "Fleet Insurance Summary", th: "สรุปประกันภัยยานพาหนะ" },
  renewal: { en: "Insurance Renewal Report", th: "รายงานการต่ออายุประกันภัย" },
  cost: { en: "Insurance Cost Report", th: "รายงานค่าใช้จ่ายประกันภัย" },
  vehicle_detail: { en: "Vehicle Insurance Profile", th: "ประวัติประกันภัยรายคัน" },
  asset_register: { en: "Fleet Asset Register", th: "ทะเบียนทรัพย์สินยานพาหนะ" },
  missing_information: { en: "Missing Information / Compliance Report", th: "รายงานข้อมูลไม่ครบ / การปฏิบัติตามข้อกำหนด" },
  comparison: { en: "Insurance Comparison Report", th: "รายงานเปรียบเทียบประกันภัย" },
  trailer: { en: "Trailer Insurance Report", th: "รายงานประกันภัยรถพ่วง" },
  expired: { en: "Expired Insurance Report", th: "รายงานประกันภัยหมดอายุ" },
  executive: { en: "Management Summary", th: "สรุปสำหรับผู้บริหาร" }
};

function reportStatus(record: InsuranceAssetRecord, language: InsuranceReportLanguage) {
  if (isInsuranceNotRequired(record)) return language === "th" ? "ไม่ต้องมีประกัน" : "Insurance Not Required";
  if (record.verification_status !== "verified") return language === "th" ? "ต้องตรวจสอบ" : "Needs review";
  const status = insuranceHistoryStatus(record);
  if (status === "EXPIRED") return language === "th" ? "หมดอายุ" : "Expired";
  if (record.days_to_insurance_expiry != null && record.days_to_insurance_expiry <= 30) return language === "th" ? "ใกล้ครบกำหนด" : "Due soon";
  if (status === "CURRENT") return language === "th" ? "ครบถ้วน" : "Compliant";
  return language === "th" ? "ข้อมูลไม่ครบ" : "Missing information";
}

function binaryStringFromDataUrl(dataUrl: string) {
  return atob(dataUrl.split(",")[1] ?? "");
}

function buildImagePagesPdf(imagePages: CanvasPage[]) {
  const kids = imagePages.map((_, index) => `${3 + index * 3} 0 R`).join(" ");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${kids}] /Count ${imagePages.length} >>`
  ];
  imagePages.forEach((page, index) => {
    const imageName = `PageImage${index + 1}`;
    const contentStream = `q ${PAGE_WIDTH} 0 0 ${PAGE_HEIGHT} 0 0 cm /${imageName} Do Q`;
    const pageObjectNumber = 3 + index * 3;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /XObject << /${imageName} ${pageObjectNumber + 2} 0 R >> >> /Contents ${pageObjectNumber + 1} 0 R >>`,
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

async function loadReportFont(language: InsuranceReportLanguage) {
  const family = "InsuranceReportFont";
  if (typeof FontFace === "undefined") return "Arial";
  let loaded = false;
  document.fonts.forEach((font) => {
    if (font.family === family) loaded = true;
  });
  if (!loaded) {
    const response = await fetch("/fonts/boss-pdf-thai.ttf");
    if (!response.ok) throw new Error("Unable to load the Insurance report font.");
    const font = new FontFace(family, await response.arrayBuffer(), {
      style: "normal",
      weight: "400"
    });
    await font.load();
    document.fonts.add(font);
    await document.fonts.ready;
  }
  return language === "th" ? family : `${family}, Arial`;
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

function money(value: number | null | undefined, language: InsuranceReportLanguage) {
  if (value == null || !Number.isFinite(value)) return "Insufficient data";
  return new Intl.NumberFormat(language === "th" ? "th-TH" : "en-GB", {
    style: "currency",
    currency: "THB",
    maximumFractionDigits: 2
  }).format(value);
}

function number(value: number, language: InsuranceReportLanguage) {
  return new Intl.NumberFormat(language === "th" ? "th-TH" : "en-GB", {
    maximumFractionDigits: 2
  }).format(value);
}

function date(value: string | null, language: InsuranceReportLanguage) {
  if (!value) return language === "th" ? "ไม่ได้บันทึก" : "Not recorded";
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat(language === "th" ? "th-TH" : "en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).format(new Date(year, month - 1, day));
}

function text(value: CellValue, language: InsuranceReportLanguage) {
  if (value == null || value === "") return language === "th" ? "ไม่ได้บันทึก" : "Not recorded";
  return String(value);
}

function truncate(context: CanvasRenderingContext2D, value: string, width: number) {
  if (context.measureText(value).width <= width) return value;
  let result = value;
  while (result.length > 1 && context.measureText(`${result}...`).width > width) {
    result = result.slice(0, -1);
  }
  return `${result}...`;
}

function downloadName(type: InsuranceReportType, registration?: string) {
  const datePart = new Date().toISOString().slice(0, 10);
  const assetPart = registration
    ? `-${normalizeInsuranceRegistration(registration).replace(/[^\p{L}\p{N}]/gu, "")}`
    : "";
  return `Expert-Express-${type.replace(/_/g, "-")}${assetPart}-${datePart}.pdf`;
}

export function downloadInsuranceReport(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export type InsurancePdfResult = { blob: Blob; fileName: string };

export async function buildInsurancePdf(options: {
  type: InsuranceReportType;
  records: InsuranceAssetRecord[];
  totalAssetCount?: number;
  documents: InsuranceDocumentRecord[];
  historyRecords?: InsuranceReportHistoryRecord[];
  language: InsuranceReportLanguage;
  selectedRecord?: InsuranceAssetRecord | null;
}): Promise<InsurancePdfResult> {
  const { type, records, totalAssetCount = records.length, documents, historyRecords = [], language, selectedRecord } = options;
  const includedAssetCount = type === "vehicle_detail" && selectedRecord ? 1 : records.length;
  const fontFamily = await loadReportFont(language);
  const logo = await loadLogo().catch(() => null);
  const pages: HTMLCanvasElement[] = [];
  const title = reportTitles[type][language];
  const generatedAt = new Intl.DateTimeFormat(language === "th" ? "th-TH" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date());
  const contextData = { records, documents };
  const summary = summarizeInsurance(contextData);
  let canvas: HTMLCanvasElement;
  let context: CanvasRenderingContext2D;
  let y = 0;
  const scale = 2;

  const newPage = (continuation = false) => {
    canvas = document.createElement("canvas");
    canvas.width = PAGE_WIDTH * scale;
    canvas.height = PAGE_HEIGHT * scale;
    context = canvas.getContext("2d") as CanvasRenderingContext2D;
    context.scale(scale, scale);
    context.fillStyle = COLORS.white;
    context.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT);
    context.fillStyle = COLORS.violet;
    context.fillRect(0, 0, 8, PAGE_HEIGHT);
    if (logo && !continuation) {
      const targetHeight = 38;
      const targetWidth = Math.min(78, (logo.naturalWidth / Math.max(logo.naturalHeight, 1)) * targetHeight);
      context.drawImage(logo, MARGIN, 27, targetWidth, targetHeight);
    }
    const headingX = logo && !continuation ? 122 : MARGIN;
    context.fillStyle = COLORS.violet;
    context.font = `700 9px ${fontFamily}`;
    context.fillText("EXPERT EXPRESS SENDER CO., LTD.", headingX, 38);
    context.fillStyle = COLORS.ink;
    context.font = `700 19px ${fontFamily}`;
    context.fillText(continuation ? `${title} - continued` : title, headingX, 59);
    context.fillStyle = COLORS.muted;
    context.font = `400 8px ${fontFamily}`;
    context.fillText(
      `${language === "th" ? "สร้างเมื่อ" : "Generated"}: ${generatedAt} | ${includedAssetCount} ${language === "th" ? "จาก" : "of"} ${totalAssetCount} ${language === "th" ? "รายการ" : "assets included"}${includedAssetCount === totalAssetCount ? "" : language === "th" ? " (กรองแล้ว)" : " (filtered)"}`,
      headingX,
      75
    );
    context.strokeStyle = COLORS.border;
    context.beginPath();
    context.moveTo(MARGIN, 88);
    context.lineTo(PAGE_WIDTH - MARGIN, 88);
    context.stroke();
    y = 105;
    pages.push(canvas);
  };

  const ensure = (height: number) => {
    if (y + height > PAGE_HEIGHT - 48) newPage(true);
  };

  const section = (label: string) => {
    ensure(30);
    context.fillStyle = COLORS.violet;
    context.font = `700 10px ${fontFamily}`;
    context.fillText(label.toLocaleUpperCase(), MARGIN, y + 11);
    y += 23;
  };

  const cards = (items: Array<[string, string, ("neutral" | "good" | "warn" | "danger")?]>) => {
    const gap = 7;
    const width = (CONTENT_WIDTH - gap * 3) / 4;
    items.forEach(([label, value, tone = "neutral"], index) => {
      const column = index % 4;
      const row = Math.floor(index / 4);
      const x = MARGIN + column * (width + gap);
      const cardY = y + row * 52;
      context.fillStyle = tone === "danger" ? "#FFF1F2" : tone === "warn" ? "#FFFBEB" : tone === "good" ? "#ECFDF5" : COLORS.panel;
      context.fillRect(x, cardY, width, 44);
      context.fillStyle = tone === "danger" ? COLORS.rose : tone === "warn" ? COLORS.amber : tone === "good" ? COLORS.green : COLORS.violet;
      context.font = `700 15px ${fontFamily}`;
      context.fillText(truncate(context, value, width - 14), x + 7, cardY + 19);
      context.fillStyle = COLORS.muted;
      context.font = `400 7px ${fontFamily}`;
      context.fillText(truncate(context, label, width - 14), x + 7, cardY + 34);
    });
    y += Math.ceil(items.length / 4) * 52 + 8;
  };

  const paragraph = (value: string, color: string = COLORS.muted) => {
    ensure(24);
    context.fillStyle = color;
    context.font = `400 8px ${fontFamily}`;
    const words = value.split(/\s+/);
    let line = "";
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (context.measureText(test).width > CONTENT_WIDTH && line) {
        context.fillText(line, MARGIN, y + 9);
        y += 12;
        line = word;
      } else {
        line = test;
      }
    }
    if (line) {
      context.fillText(line, MARGIN, y + 9);
      y += 15;
    }
  };

  const table = (rows: InsuranceAssetRecord[], columns: ReportColumn[], limit?: number) => {
    const selectedRows = typeof limit === "number" ? rows.slice(0, limit) : rows;
    const totalWidth = columns.reduce((sum, column) => sum + column.width, 0);
    const ratio = CONTENT_WIDTH / totalWidth;
    const header = () => {
      ensure(32);
      context.fillStyle = COLORS.violet;
      context.fillRect(MARGIN, y, CONTENT_WIDTH, 23);
      let x = MARGIN;
      context.fillStyle = COLORS.white;
      context.font = `700 7px ${fontFamily}`;
      for (const column of columns) {
        const width = column.width * ratio;
        context.fillText(truncate(context, column.label, width - 8), x + 4, y + 15);
        x += width;
      }
      y += 23;
    };
    header();
    selectedRows.forEach((record, rowIndex) => {
      if (y + 24 > PAGE_HEIGHT - 48) {
        newPage(true);
        header();
      }
      context.fillStyle = rowIndex % 2 ? COLORS.panel : COLORS.white;
      context.fillRect(MARGIN, y, CONTENT_WIDTH, 22);
      let x = MARGIN;
      context.font = `400 6.5px ${fontFamily}`;
      columns.forEach((column) => {
        const width = column.width * ratio;
        const value = text(column.value(record), language);
        context.fillStyle = COLORS.ink;
        const display = truncate(context, value, width - 8);
        const textX = column.align === "right" ? x + width - 4 - context.measureText(display).width : x + 4;
        context.fillText(display, textX, y + 14);
        x += width;
      });
      context.strokeStyle = COLORS.border;
      context.beginPath();
      context.moveTo(MARGIN, y + 22);
      context.lineTo(PAGE_WIDTH - MARGIN, y + 22);
      context.stroke();
      y += 22;
    });
    y += 10;
  };

  const basicColumns: ReportColumn[] = [
    { key: "registration", label: language === "th" ? "ทะเบียน" : "Registration", width: 76, value: (record) => record.vehicle_registration },
    { key: "category", label: language === "th" ? "ประเภท" : "Category", width: 95, value: (record) => categoryLabel(getAssetCategory(record), language) },
    { key: "insurer", label: language === "th" ? "บริษัทประกัน" : "Insurer", width: 116, value: (record) => canonicalInsurerName(record.insurer_en, record.insurer_th, language) },
    { key: "policy", label: language === "th" ? "กรมธรรม์" : "Policy", width: 90, value: (record) => record.policy_number },
    { key: "expiry", label: language === "th" ? "หมดอายุ" : "Expiry", width: 72, value: (record) => date(record.insurance_expiry_date, language) },
    { key: "state", label: language === "th" ? "สถานะ" : "Status", width: 58, value: (record) => reportStatus(record, language) }
  ];

  const drawExecutive = () => {
    const insuredRecords = records.filter((record) => !isInsuranceNotRequired(record));
    const compliant = insuredRecords.filter((record) => reportStatus(record, "en") === "Compliant").length;
    const dueSoon = insuredRecords.filter((record) => reportStatus(record, "en") === "Due soon").length;
    const renewalRecords = insuredRecords.filter((record) => record.days_to_insurance_expiry != null && record.days_to_insurance_expiry >= 0 && record.days_to_insurance_expiry <= 90);
    const renewalPremiums = renewalRecords.map((record) => record.insurance_premium).filter((value): value is number => value != null);
    const renewalExposure = renewalPremiums.length || renewalRecords.length === 0 ? renewalPremiums.reduce((sum, value) => sum + value, 0) : null;
    section(language === "th" ? "ภาพรวมกองรถ" : "Fleet overview");
    cards([
      [language === "th" ? "ทรัพย์สินทั้งหมด" : "Total assets", String(summary.fleet.total)],
      [language === "th" ? "มีประกันปัจจุบัน" : "Insured/current", String(summary.insurance.currentlyInsured), "good"],
      [language === "th" ? "ไม่ต้องมีประกัน" : "Insurance Not Required", String(summary.fleet.insuranceNotRequired)],
      [language === "th" ? "ครบถ้วน" : "Compliant", String(compliant), "good"],
      [language === "th" ? "หมดอายุ" : "Expired", String(summary.insurance.expired), "danger"],
      [language === "th" ? "ใกล้ครบกำหนด" : "Due soon", String(dueSoon), "warn"],
      [language === "th" ? "รอตรวจ" : "Incomplete", String(summary.fleet.awaitingReview), "warn"],
      [language === "th" ? "คำเตือนสำคัญ" : "Critical findings", String(summary.quality.critical), "danger"]
    ]);
    section(language === "th" ? "ค่าใช้จ่ายและมูลค่า" : "Cost and value");
    cards([
      [language === "th" ? "เบี้ยประกัน" : "Confirmed premiums", money(summary.financial.premiumTotal, language)],
      [language === "th" ? "เบี้ยปัจจุบันหมดอายุใน 90 วัน" : "Current premiums expiring within 90 days", money(renewalExposure, language)],
      [language === "th" ? "ค่าใช้จ่ายรวม" : "Overall spend", money(summary.financial.totalSpend, language)],
      [language === "th" ? "ทุนประกันรวม" : "Insured fleet value", money(summary.financial.insuredValueTotal, language)],
      [language === "th" ? "เบี้ยเฉลี่ย" : "Average premium", money(summary.financial.averagePremium, language)],
      [language === "th" ? "เบี้ย / ทุนประกัน" : "Premium / value", summary.financial.premiumToValuePercent == null ? "Insufficient data" : `${number(summary.financial.premiumToValuePercent, language)}%`],
      [language === "th" ? "ไม่มีข้อมูลเบี้ยใน 90 วัน" : "90-day policies missing premium", String(renewalRecords.length - renewalPremiums.length), renewalRecords.length - renewalPremiums.length ? "warn" : "good"],
      [language === "th" ? "เอกสารที่ขาด" : "Missing required documents", String(summary.insurance.missingRequiredDocuments), "warn"]
    ]);
    section(language === "th" ? "รายการที่ต้องดำเนินการ" : "Attention");
    const attention = [...records]
      .filter((record) => !isInsuranceNotRequired(record) && (renewalBand(record) === "urgent" || !record.insurance_expiry_date))
      .sort((a, b) => (a.days_to_insurance_expiry ?? 999999) - (b.days_to_insurance_expiry ?? 999999));
    table(attention, basicColumns, 8);
    paragraph(language === "th" ? "หมายเหตุ: ยอดรวมรวมเฉพาะค่าที่บันทึกและยืนยันแล้ว ค่า NULL ไม่ถูกนับเป็นศูนย์" : "Note: Totals include only confirmed recorded values from verified records. NULL values are not treated as zero.");
  };

  const drawVehicleDetail = (record: InsuranceAssetRecord) => {
    const findings = buildDataQualityFindings(record, contextData);
    section(language === "th" ? "ข้อมูลประจำรถ" : "Asset identity");
    cards([
      [language === "th" ? "ทะเบียน" : "Registration", record.vehicle_registration],
      [language === "th" ? "ทะเบียนสำหรับจับคู่" : "Normalized registration", normalizeInsuranceRegistration(record.vehicle_registration)],
      [language === "th" ? "ประเภท" : "Category", categoryLabel(getAssetCategory(record), language)],
      [language === "th" ? "ข้อกำหนดประกัน" : "Insurance requirement", insuranceRequirement(record)],
      [language === "th" ? "เหตุผล" : "Reason", record.insurance_requirement_reason ?? ""],
      [language === "th" ? "สถานะประวัติ" : "History status", reportStatus(record, language)]
    ]);
    const details: Array<[string, CellValue]> = [
      [language === "th" ? "ยี่ห้อ" : "Make", record.vehicle_make],
      [language === "th" ? "รุ่น" : "Model", null],
      [language === "th" ? "ปี" : "Year", record.vehicle_year],
      [language === "th" ? "เลขตัวถัง" : "Chassis", record.chassis_number],
      [language === "th" ? "บริษัทประกัน" : "Insurer", canonicalInsurerName(record.insurer_en, record.insurer_th, language)],
      [language === "th" ? "กรมธรรม์" : "Policy", record.policy_number],
      [language === "th" ? "ประเภทประกัน" : "Class", record.insurance_class],
      [language === "th" ? "การซ่อม" : "Repair type", record.repair_type],
      [language === "th" ? "วันที่ออกกรมธรรม์" : "Policy issue date", date(record.policy_issue_date, language)],
      [language === "th" ? "เริ่มคุ้มครอง" : "Cover start", date(record.insurance_start_date, language)],
      [language === "th" ? "หมดอายุ" : "Cover expiry", date(record.insurance_expiry_date, language)],
      [language === "th" ? "ทุนประกัน" : "Insured value", money(record.insured_value, language)],
      [language === "th" ? "เบี้ยประกัน" : "Premium", money(record.insurance_premium, language)],
      [language === "th" ? "พ.ร.บ." : "Compulsory status", isInsuranceNotRequired(record) ? (language === "th" ? "ไม่ต้องมีประกัน" : "Not Required") : isCompulsoryConfirmed(record) ? (language === "th" ? "ยืนยันแล้ว" : "Confirmed") : (language === "th" ? "ไม่ทราบ" : "Unknown")],
      [language === "th" ? "กรมธรรม์ พ.ร.บ." : "Compulsory policy", record.compulsory_policy_number],
      [language === "th" ? "พ.ร.บ. หมดอายุ" : "Compulsory expiry", date(record.compulsory_expiry_date, language)],
      [language === "th" ? "ค่า พ.ร.บ." : "Compulsory cost", money(record.compulsory_insurance_premium, language)],
      [language === "th" ? "ภาษีหมดอายุ" : "Vehicle tax expiry", date(record.registration_expiry_date, language)],
      [language === "th" ? "ภาษีรถ" : "Vehicle tax", money(record.vehicle_tax, language)],
      [language === "th" ? "เบี้ยเพิ่ม" : "Additional premium", money(record.additional_premium, language)],
      [language === "th" ? "เอกสาร" : "Documents", `${documents.filter((document) => document.insurance_record_id === record.id).length}`]
    ];
    ensure(details.length * 20 + 35);
    details.forEach(([label, value], index) => {
      const rowY = y + index * 20;
      context.fillStyle = index % 2 ? COLORS.panel : COLORS.white;
      context.fillRect(MARGIN, rowY, CONTENT_WIDTH, 20);
      context.fillStyle = COLORS.muted;
      context.font = `700 7px ${fontFamily}`;
      context.fillText(label, MARGIN + 6, rowY + 13);
      context.fillStyle = COLORS.ink;
      context.font = `400 7px ${fontFamily}`;
      context.fillText(truncate(context, text(value, language), CONTENT_WIDTH - 190), MARGIN + 180, rowY + 13);
    });
    y += details.length * 20 + 12;
    section(language === "th" ? "ข้อสังเกตคุณภาพข้อมูล" : "Data-quality warnings");
    if (!findings.length) paragraph(language === "th" ? "ไม่พบข้อสังเกต" : "No findings.", COLORS.green);
    findings.slice(0, 12).forEach((finding) => paragraph(`${finding.severity.toLocaleUpperCase()}: ${finding.label} - ${finding.detail}`, finding.severity === "critical" ? COLORS.rose : finding.severity === "warning" ? COLORS.amber : COLORS.muted));
    if (record.notes) {
      section(language === "th" ? "หมายเหตุ" : "Notes");
      paragraph(record.notes, COLORS.ink);
    }
    section(language === "th" ? "ประวัติกรมธรรม์" : "Historical policies");
    const recordHistory = historyRecords.filter((item) => item.insurance_record_id === record.id);
    if (!recordHistory.length) {
      paragraph(language === "th" ? "ยังไม่มีประวัติกรมธรรม์เก่า" : "No previous policies recorded.");
    } else {
      recordHistory.forEach((item) => paragraph(
        `${date(item.insurance_start_date, language)} – ${date(item.insurance_expiry_date, language)} | ${text(item.policy_number, language)} | ${canonicalInsurerName(item.insurer_en, item.insurer_th, language) || text(null, language)} | ${money(item.insurance_premium, language)}`,
        COLORS.ink
      ));
    }
  };

  newPage();
  if (type === "executive") {
    drawExecutive();
  } else if (type === "vehicle_detail") {
    if (!selectedRecord) throw new Error("Select an asset for the vehicle detail report.");
    drawVehicleDetail(selectedRecord);
  } else {
    const annualCosts = records
      .map(annualInsuranceCost)
      .filter((value): value is number => value != null);
    section(language === "th" ? "สรุป" : "Summary");
    cards([
      [language === "th" ? "ทรัพย์สิน" : "Assets", String(records.length)],
      [language === "th" ? "ตรวจสอบแล้ว" : "Verified", String(records.filter((record) => record.verification_status === "verified").length), "good"],
      [language === "th" ? "หมดอายุ" : "Expired", String(records.filter((record) => insuranceHistoryStatus(record) === "EXPIRED").length), "danger"],
      [language === "th" ? "ค่าใช้จ่ายที่บันทึก" : "Recorded annual cost", money(annualCosts.length ? annualCosts.reduce((sum, value) => sum + value, 0) : null, language)]
    ]);
    section(title);
    if (type === "renewal") {
      const ordered = records
        .filter((record) => !isInsuranceNotRequired(record))
        .sort((a, b) => (a.days_to_insurance_expiry ?? 999999) - (b.days_to_insurance_expiry ?? 999999));
      table(ordered, [
        basicColumns[0],
        { key: "make", label: language === "th" ? "ยี่ห้อ/ปี" : "Make/year", width: 82, value: (record) => `${record.vehicle_make ?? ""} ${record.vehicle_year ?? ""}`.trim() },
        { key: "policy", label: language === "th" ? "กรมธรรม์" : "Policy", width: 82, value: (record) => record.policy_number },
        { key: "insurer", label: language === "th" ? "บริษัท" : "Insurer", width: 100, value: (record) => canonicalInsurerName(record.insurer_en, record.insurer_th, language) },
        { key: "class", label: language === "th" ? "ประเภท" : "Class", width: 52, value: (record) => record.insurance_class },
        { key: "premium", label: language === "th" ? "เบี้ยปัจจุบัน" : "Current premium", width: 78, value: (record) => money(record.insurance_premium, language), align: "right" },
        { key: "expiry", label: language === "th" ? "หมดอายุ" : "Expiry", width: 66, value: (record) => date(record.insurance_expiry_date, language) },
        { key: "days", label: language === "th" ? "เหลือวัน" : "Days", width: 42, value: (record) => record.days_to_insurance_expiry },
        { key: "status", label: language === "th" ? "สถานะ" : "Status", width: 64, value: (record) => reportStatus(record, language) }
      ]);
    } else if (type === "fleet_summary") {
      table(records, [
        { key: "registration", label: language === "th" ? "ทะเบียน" : "Registration", width: 68, value: (record) => record.vehicle_registration },
        { key: "category", label: language === "th" ? "ประเภทรถ" : "Vehicle type", width: 84, value: (record) => categoryLabel(getAssetCategory(record), language) },
        { key: "insurer", label: language === "th" ? "บริษัทประกัน" : "Insurer", width: 96, value: (record) => canonicalInsurerName(record.insurer_en, record.insurer_th, language) },
        { key: "policy", label: language === "th" ? "กรมธรรม์" : "Policy", width: 78, value: (record) => record.policy_number },
        { key: "start", label: language === "th" ? "เริ่ม" : "Start", width: 60, value: (record) => date(record.insurance_start_date, language) },
        { key: "expiry", label: language === "th" ? "หมดอายุ" : "Expiry", width: 60, value: (record) => date(record.insurance_expiry_date, language) },
        { key: "premium", label: language === "th" ? "เบี้ย" : "Premium", width: 70, value: (record) => money(record.insurance_premium, language), align: "right" },
        { key: "value", label: language === "th" ? "ทุนประกัน" : "Insured value", width: 72, value: (record) => money(record.insured_value, language), align: "right" }
      ]);
      section(language === "th" ? "พ.ร.บ. ภาษี และสถานะปัจจุบัน" : "Compulsory, tax and current status");
      table(records, [
        basicColumns[0],
        { key: "compulsoryExpiry", label: language === "th" ? "พ.ร.บ. หมดอายุ" : "Compulsory expiry", width: 94, value: (record) => date(record.compulsory_expiry_date, language) },
        { key: "compulsoryCost", label: language === "th" ? "ค่า พ.ร.บ." : "Compulsory cost", width: 90, value: (record) => money(record.compulsory_insurance_premium, language), align: "right" },
        { key: "taxExpiry", label: language === "th" ? "ภาษีหมดอายุ" : "Tax expiry", width: 88, value: (record) => date(record.registration_expiry_date, language) },
        { key: "taxCost", label: language === "th" ? "ค่าภาษี" : "Tax cost", width: 82, value: (record) => money(record.vehicle_tax, language), align: "right" },
        { key: "status", label: language === "th" ? "สถานะ" : "Current status", width: 88, value: (record) => reportStatus(record, language) }
      ]);
    } else if (type === "cost") {
      table(records, [
        basicColumns[0],
        basicColumns[1],
        { key: "make", label: language === "th" ? "ยี่ห้อ/ปี" : "Make/year", width: 70, value: (record) => `${record.vehicle_make ?? ""} ${record.vehicle_year ?? ""}`.trim() },
        { key: "insurer", label: language === "th" ? "บริษัท" : "Insurer", width: 82, value: (record) => canonicalInsurerName(record.insurer_en, record.insurer_th, language) },
        { key: "value", label: language === "th" ? "ทุน" : "Insured value", width: 72, value: (record) => money(record.insured_value, language), align: "right" },
        { key: "premium", label: language === "th" ? "เบี้ย" : "Premium", width: 68, value: (record) => money(record.insurance_premium, language), align: "right" },
        { key: "compulsory", label: language === "th" ? "พ.ร.บ." : "Compulsory", width: 62, value: (record) => money(record.compulsory_insurance_premium, language), align: "right" },
        { key: "additional", label: language === "th" ? "เพิ่ม" : "Additional", width: 58, value: (record) => money(record.additional_premium, language), align: "right" },
        { key: "tax", label: language === "th" ? "ภาษี" : "Tax", width: 58, value: (record) => money(record.vehicle_tax, language), align: "right" },
        { key: "total", label: language === "th" ? "รวม" : "Total", width: 68, value: (record) => money(annualInsuranceCost(record), language), align: "right" },
        { key: "ratio", label: language === "th" ? "%" : "Premium/value", width: 55, value: (record) => premiumToInsuredValue(record) == null ? "Insufficient data" : `${number(premiumToInsuredValue(record) as number, language)}%`, align: "right" }
      ]);
    } else if (type === "asset_register") {
      table(records, [
        basicColumns[0],
        basicColumns[1],
        { key: "make", label: language === "th" ? "ยี่ห้อ" : "Make", width: 100, value: (record) => record.vehicle_make },
        { key: "year", label: language === "th" ? "ปี" : "Year", width: 48, value: (record) => record.vehicle_year },
        { key: "chassis", label: language === "th" ? "เลขตัวถัง" : "Chassis", width: 140, value: (record) => record.chassis_number },
        { key: "requirement", label: language === "th" ? "ข้อกำหนดประกัน" : "Insurance requirement", width: 100, value: (record) => reportStatus(record, language) },
        { key: "review", label: language === "th" ? "การตรวจ" : "Review", width: 80, value: (record) => record.verification_status }
      ]);
    } else if (type === "missing_information") {
      table(records.filter((record) => buildDataQualityFindings(record, contextData).length > 0), [
        basicColumns[0],
        basicColumns[1],
        { key: "critical", label: language === "th" ? "วิกฤต" : "Critical", width: 58, value: (record) => buildDataQualityFindings(record, contextData).filter((finding) => finding.severity === "critical").length },
        { key: "warning", label: language === "th" ? "เตือน" : "Warning", width: 58, value: (record) => buildDataQualityFindings(record, contextData).filter((finding) => finding.severity === "warning").length },
        { key: "issues", label: language === "th" ? "ข้อสังเกต" : "Findings", width: 300, value: (record) => buildDataQualityFindings(record, contextData).map((finding) => finding.label).join(", ") }
      ]);
    } else if (type === "comparison") {
      table(records, [
        basicColumns[0],
        basicColumns[1],
        { key: "make", label: language === "th" ? "ยี่ห้อ/ปี" : "Make/year", width: 92, value: (record) => `${record.vehicle_make ?? "-"} ${record.vehicle_year ?? ""}`.trim() },
        { key: "insurer", label: language === "th" ? "บริษัท" : "Insurer", width: 105, value: (record) => canonicalInsurerName(record.insurer_en, record.insurer_th, language) },
        { key: "premium", label: language === "th" ? "เบี้ย" : "Premium", width: 76, value: (record) => money(record.insurance_premium, language), align: "right" },
        { key: "value", label: language === "th" ? "ทุน" : "Value", width: 82, value: (record) => money(record.insured_value, language), align: "right" },
        { key: "ratio", label: language === "th" ? "%" : "Premium/value", width: 72, value: (record) => premiumToInsuredValue(record) == null ? "Insufficient data" : `${number(premiumToInsuredValue(record) as number, language)}%`, align: "right" }
      ]);
    } else {
      const sourceRows = type === "trailer"
        ? records.filter((record) => getAssetCategory(record) === "trailer")
        : type === "expired"
          ? records.filter((record) => insuranceHistoryStatus(record) === "EXPIRED")
          : records;
      table(sourceRows, basicColumns);
    }
    paragraph(language === "th" ? "หมายเหตุ: ค่าไม่ครบจะแสดงว่าไม่ได้บันทึกหรือข้อมูลไม่เพียงพอ และจะไม่ถูกแทนด้วยศูนย์" : "Note: Missing values are shown as Not recorded or Insufficient data and are not treated as zero.");
  }

  pages.forEach((page, index) => {
    const pageContext = page.getContext("2d") as CanvasRenderingContext2D;
    pageContext.fillStyle = COLORS.muted;
    pageContext.font = `400 7px ${fontFamily}`;
    pageContext.fillText("Expert Express Sender Co., Ltd.", MARGIN, PAGE_HEIGHT - 22);
    const pageLabel = `${language === "th" ? "หน้า" : "Page"} ${index + 1} / ${pages.length}`;
    pageContext.fillText(pageLabel, PAGE_WIDTH - MARGIN - pageContext.measureText(pageLabel).width, PAGE_HEIGHT - 22);
  });

  const imagePages = pages.map((page) => ({
    data: binaryStringFromDataUrl(page.toDataURL("image/jpeg", 0.92)),
    width: page.width,
    height: page.height
  }));
  return {
    blob: buildImagePagesPdf(imagePages),
    fileName: downloadName(type, selectedRecord?.vehicle_registration)
  };
}

export function reportTypeLabel(type: InsuranceReportType, language: InsuranceReportLanguage) {
  return reportTitles[type][language];
}
