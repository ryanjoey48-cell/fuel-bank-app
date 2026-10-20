// Existing EES PDF renderers shared by Weekly Mileage and Maintenance.
import type {OilChangeStatus} from './operations';
export type OilServicePdfLanguage = "en" | "th";
export type OilServicePdfLogo = {
  dataUrl: string | null;
  height?: number;
  width?: number;
};
export type WeeklyDistanceHistoryPdfRow = {
  changePercent: string;
  distance: string;
  missing: string;
  rawDistance: number;
  vehicleEntries: string;
  weekEnding: string;
};
export type WeeklyDistanceHistoryPdfData = {
  generatedAt: string;
  rangeLabel: string;
  rows: WeeklyDistanceHistoryPdfRow[];
  summary: {
    averageWeeklyDistance: string;
    highestWeek: string;
    lowestWeek: string;
    totalDistance: string;
  };
  title: string;
};
export type OilServicePdfRow = {
  currentOdometer: string;
  driverName: string;
  lastOilChangeDate: string;
  nextServiceDue: string;
  priorityKm: number;
  serviceDelta: string;
  vehicleReg: string;
  vehicleType: string;
};
export type OilServicePdfData = {
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
export type LastOilChangesPdfRow = {
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
export type LastOilChangesPdfData = {
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
export type OilServicePdfCopy = {
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
export type LastOilChangesPdfCopy = {
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

export const getOilServicePdfCopy = (language: OilServicePdfLanguage): OilServicePdfCopy =>
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

export const getLastOilChangesPdfCopy = (language: OilServicePdfLanguage): LastOilChangesPdfCopy =>
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

export async function loadOilServicePdfThaiFont() {
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

export function binaryStringFromDataUrl(dataUrl: string) {
  return atob(dataUrl.split(",")[1] ?? "");
}

export async function loadCanvasImage(dataUrl: string) {
  const image = new Image();
  const loaded = new Promise<HTMLImageElement>((resolve, reject) => {
    image.onload = () => resolve(image);
    image.onerror = reject;
  });
  image.src = dataUrl;
  return loaded;
}

export async function loadOilServicePdfLogo(): Promise<OilServicePdfLogo> {
  if (typeof document === "undefined") return { dataUrl: null };
  try {
    const response = await fetch("/ees-logo.png");
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

export function buildImagePagesPdf(
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

export function downloadBlob(blob: Blob, fileName: string) {
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

export async function buildWeeklyDistanceHistoryPdf(
  data: WeeklyDistanceHistoryPdfData,
  logo: OilServicePdfLogo,
  language: OilServicePdfLanguage
) {
  if (language === "th") {
    await loadOilServicePdfThaiFont();
  }

  const pageWidth = 595;
  const pageHeight = 842;
  const scale = 2;
  const margin = 38;
  const contentWidth = pageWidth - margin * 2;
  const fontFamily = getOilServicePdfFontFamily(language);
  const isThai = language === "th";
  const color = {
    border: "#cbd5e1",
    header: "#0f172a",
    muted: "#64748b",
    primary: "#2563eb",
    primaryLight: "#dbeafe",
    tableStripe: "#f8fafc",
    text: "#1e293b"
  };
  const pageImages: Array<{ data: string; height: number; width: number }> = [];
  const logoImage = logo.dataUrl ? await loadCanvasImage(logo.dataUrl) : null;
  let canvas = document.createElement("canvas");
  let context = canvas.getContext("2d")!;
  let y = margin;

  const setFont = (size: number, weight = 500) => {
    context.font = `${weight} ${size * scale}px ${fontFamily}`;
  };
  const fillText = (text: string, x: number, lineY: number, options?: { color?: string; size?: number; weight?: number }) => {
    context.fillStyle = options?.color ?? color.text;
    setFont(options?.size ?? 8.5, options?.weight ?? 500);
    context.fillText(text, x * scale, lineY * scale);
  };
  const rect = (x: number, rectY: number, width: number, height: number, fill: string, stroke = color.border) => {
    context.fillStyle = fill;
    context.strokeStyle = stroke;
    context.lineWidth = 1 * scale;
    context.fillRect(x * scale, rectY * scale, width * scale, height * scale);
    context.strokeRect(x * scale, rectY * scale, width * scale, height * scale);
  };
  const finishPage = () => {
    pageImages.push({
      data: binaryStringFromDataUrl(canvas.toDataURL("image/jpeg", 0.92)),
      height: canvas.height,
      width: canvas.width
    });
  };
  const startPage = () => {
    canvas = document.createElement("canvas");
    canvas.width = pageWidth * scale;
    canvas.height = pageHeight * scale;
    context = canvas.getContext("2d")!;
    context.scale(scale, scale);
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, pageWidth, pageHeight);
    context.scale(1 / scale, 1 / scale);
    y = margin;

    if (logoImage) {
      const logoWidth = Math.min(110, logo.width ?? 110);
      const logoHeight = logo.height && logo.width ? logoWidth * (logo.height / logo.width) : 32;
      context.drawImage(logoImage, margin * scale, y * scale, logoWidth * scale, logoHeight * scale);
    }

    fillText("EXPERT EXPRESS", pageWidth - margin - 142, y + 11, { color: color.header, size: 12, weight: 800 });
    fillText(data.title, margin, y + 54, { color: color.header, size: isThai ? 15 : 17, weight: 800 });
    fillText(data.rangeLabel, margin, y + 73, { color: color.muted, size: 8.5, weight: 600 });
    fillText(data.generatedAt, pageWidth - margin - 150, y + 73, { color: color.muted, size: 7.5, weight: 500 });
    y += 92;
  };

  startPage();

  const summaryCards = [
    ["Total Distance", data.summary.totalDistance],
    ["Average Weekly Distance", data.summary.averageWeeklyDistance],
    ["Highest Week", data.summary.highestWeek],
    ["Lowest Week", data.summary.lowestWeek]
  ];
  const cardWidth = (contentWidth - 18) / 4;
  summaryCards.forEach(([label, value], index) => {
    const x = margin + index * (cardWidth + 6);
    rect(x, y, cardWidth, 54, index === 0 ? color.primaryLight : "#ffffff");
    fillText(label, x + 8, y + 17, { color: color.muted, size: 6.7, weight: 700 });
    fillText(value, x + 8, y + 38, { color: color.header, size: index === 0 ? 10.5 : 8.2, weight: 800 });
  });
  y += 76;

  if (data.rows.length > 1) {
    const chartHeight = 144;
    const chartX = margin;
    const chartY = y;
    const chartW = contentWidth;
    const chartH = chartHeight;
    const chartRows = [...data.rows].reverse();
    const maxDistance = Math.max(...chartRows.map((row) => row.rawDistance), 1);
    rect(chartX, chartY, chartW, chartH, "#ffffff");
    context.strokeStyle = "#e2e8f0";
    context.lineWidth = 1 * scale;
    for (let step = 1; step < 4; step += 1) {
      const gridY = chartY + (chartH / 4) * step;
      context.beginPath();
      context.moveTo((chartX + 12) * scale, gridY * scale);
      context.lineTo((chartX + chartW - 12) * scale, gridY * scale);
      context.stroke();
    }
    const points = chartRows.map((row, index) => {
      const x = chartRows.length === 1 ? chartX + chartW / 2 : chartX + 18 + (index / (chartRows.length - 1)) * (chartW - 36);
      const yPoint = chartY + chartH - 22 - (row.rawDistance / maxDistance) * (chartH - 44);
      return { x, y: yPoint };
    });
    const averageDistance = chartRows.reduce((sum, row) => sum + row.rawDistance, 0) / chartRows.length;
    const averageY = chartY + chartH - 22 - (averageDistance / maxDistance) * (chartH - 44);
    context.setLineDash([4 * scale, 4 * scale]);
    context.strokeStyle = "#94a3b8";
    context.lineWidth = 1 * scale;
    context.beginPath();
    context.moveTo((chartX + 12) * scale, averageY * scale);
    context.lineTo((chartX + chartW - 12) * scale, averageY * scale);
    context.stroke();
    context.setLineDash([]);
    fillText(`Average ${Math.round(averageDistance).toLocaleString("en-GB")} km`, chartX + chartW - 130, averageY - 5, {
      color: color.muted,
      size: 6.5,
      weight: 700
    });
    context.strokeStyle = color.primary;
    context.lineWidth = 2.4 * scale;
    context.beginPath();
    points.forEach((point, index) => {
      if (index === 0) context.moveTo(point.x * scale, point.y * scale);
      else context.lineTo(point.x * scale, point.y * scale);
    });
    context.stroke();
    points.forEach((point) => {
      context.fillStyle = color.primary;
      context.beginPath();
      context.arc(point.x * scale, point.y * scale, 3.2 * scale, 0, Math.PI * 2);
      context.fill();
    });
    fillText(chartRows[0]?.weekEnding ?? "", chartX + 10, chartY + chartH - 7, { color: color.muted, size: 6.5 });
    fillText(chartRows[chartRows.length - 1]?.weekEnding ?? "", chartX + chartW - 78, chartY + chartH - 7, { color: color.muted, size: 6.5 });
    y += chartHeight + 24;
  }

  const columns = [
    { label: "Week", width: 118 },
    { label: "Entries", width: 104 },
    { label: "Missing", width: 78 },
    { label: "Distance", width: 116 },
    { label: "Change %", width: contentWidth - 416 }
  ];
  const drawTableHeader = () => {
    rect(margin, y, contentWidth, 24, color.header, color.header);
    let x = margin;
    columns.forEach((column) => {
      fillText(column.label, x + 8, y + 16, { color: "#ffffff", size: 6.8, weight: 800 });
      x += column.width;
    });
    y += 24;
  };
  const ensureTableSpace = () => {
    if (y <= pageHeight - margin - 28) return;
    finishPage();
    startPage();
    drawTableHeader();
  };

  drawTableHeader();
  data.rows.forEach((row, index) => {
    ensureTableSpace();
    const incomplete = row.missing !== "-";
    rect(margin, y, contentWidth, 24, incomplete ? "#fff7ed" : index % 2 === 0 ? "#ffffff" : color.tableStripe);
    const values = [row.weekEnding, row.vehicleEntries, row.missing, row.distance, row.changePercent];
    let x = margin;
    values.forEach((value, columnIndex) => {
      fillText(value, x + 8, y + 16, {
        color: columnIndex === 2 ? color.header : color.text,
        size: 7.2,
        weight: columnIndex === 2 ? 800 : 600
      });
      x += columns[columnIndex].width;
    });
    y += 24;
  });

  finishPage();
  return buildImagePagesPdf(pageImages, { height: pageHeight, width: pageWidth });
}

export async function buildOilServicePdf(data: OilServicePdfData, logo: OilServicePdfLogo, language: OilServicePdfLanguage) {
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

export async function buildLastOilChangesPdf(data: LastOilChangesPdfData, logo: OilServicePdfLogo, language: OilServicePdfLanguage) {
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

