"use client";

import type { FuelSpendManagementReport } from "@/lib/fuel-spend-report";
import { formatNumber } from "@/lib/utils";

type ReportLanguage = "en" | "th";
type CanvasPage = { data: string; height: number; width: number };

function formatBaht(value: number) {
  return `\u0e3f${new Intl.NumberFormat("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value || 0)}`;
}

function formatBahtWhole(value: number | null) {
  if (value == null || !Number.isFinite(value)) return "-";
  return `\u0e3f${new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 }).format(Math.abs(value))}`;
}

function formatLitresWhole(value: number, language: ReportLanguage) {
  return `${formatNumber(value, language, 0)} L`;
}

function formatPrice(value: number | null) {
  return value == null || !Number.isFinite(value) ? "-" : `${formatBaht(value)}/L`;
}

function formatPercent(value: number | null, language: ReportLanguage) {
  return value == null || !Number.isFinite(value) ? "-" : `${formatNumber(value, language, 1)}%`;
}

function formatSpendMovement(report: FuelSpendManagementReport, language: ReportLanguage) {
  if (report.spendChangeAmount == null) {
    return { amount: "-", direction: "No previous period" };
  }
  const lower = report.spendChangeAmount < 0;
  const percent = report.spendChangePercent == null ? "" : `${formatNumber(Math.abs(report.spendChangePercent), language, 1)}% ${lower ? "lower" : "higher"}`;
  return {
    amount: `${lower ? "↓" : report.spendChangeAmount > 0 ? "↑" : ""} ${formatBahtWhole(report.spendChangeAmount)}`.trim(),
    direction: percent || "No percentage comparison"
  };
}

function binaryStringFromDataUrl(dataUrl: string) {
  return atob(dataUrl.split(",")[1] ?? "");
}

function buildImagePagesPdf(imagePages: CanvasPage[]) {
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

export function downloadReportBlob(blob: Blob, fileName: string) {
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

async function loadFuelSpendPdfLogo(): Promise<HTMLImageElement | null> {
  const image = new Image();
  return new Promise((resolve) => {
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

export async function buildFuelSpendPdf(report: FuelSpendManagementReport, options: { full: boolean; language: ReportLanguage; periodLabel: string }) {
  const page = { width: 595, height: 842 };
  const scale = 2;
  const margin = 34;
  const bottom = 770;
  const contentWidth = page.width - margin * 2;
  const colors = { amber: "#d97706", border: "#e2e8f0", purple: "#6d28d9", purpleLight: "#f5f3ff", slate: "#0f172a", soft: "#f8fafc", text: "#334155", muted: "#64748b" };
  const images: CanvasPage[] = [];
  const logo = await loadFuelSpendPdfLogo();
  let canvas!: HTMLCanvasElement;
  let context!: CanvasRenderingContext2D;
  let y = margin;
  let pageNumber = 0;

  const text = (value: string, x: number, textY: number, opts: { align?: CanvasTextAlign; color?: string; maxWidth?: number; size?: number; weight?: number } = {}) => {
    context.fillStyle = opts.color ?? colors.text;
    context.textAlign = opts.align ?? "left";
    context.font = `${opts.weight ?? 500} ${(opts.size ?? 8) * scale}px Arial, Helvetica, sans-serif`;
    context.fillText(value, x * scale, textY * scale, opts.maxWidth ? opts.maxWidth * scale : undefined);
    context.textAlign = "left";
  };
  const rect = (x: number, rectY: number, width: number, height: number, fill: string, stroke = colors.border) => {
    context.fillStyle = fill;
    context.strokeStyle = stroke;
    context.lineWidth = scale;
    context.fillRect(x * scale, rectY * scale, width * scale, height * scale);
    context.strokeRect(x * scale, rectY * scale, width * scale, height * scale);
  };
  const wrap = (value: string, maxWidth: number, size = 8) => {
    context.font = `500 ${size * scale}px Arial, Helvetica, sans-serif`;
    const words = String(value || "-").split(/\s+/);
    const lines: string[] = [];
    let current = "";
    for (const word of words) {
      const next = current ? `${current} ${word}` : word;
      if (context.measureText(next).width / scale <= maxWidth || !current) current = next;
      else {
        lines.push(current);
        current = word;
      }
    }
    if (current) lines.push(current);
    return lines;
  };
  const startPage = (title: string, subtitle?: string) => {
    pageNumber += 1;
    canvas = document.createElement("canvas");
    canvas.width = page.width * scale;
    canvas.height = page.height * scale;
    context = canvas.getContext("2d")!;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    y = margin;
    if (logo) {
      const logoHeight = 34;
      const logoWidth = Math.min(96, (logo.naturalWidth / Math.max(logo.naturalHeight, 1)) * logoHeight);
      context.drawImage(logo, margin * scale, y * scale, logoWidth * scale, logoHeight * scale);
    }
    text("Expert Express Sender Co., Ltd.", page.width - margin, y + 12, { align: "right", color: colors.slate, size: 11, weight: 800 });
    text(title, page.width - margin, y + 31, { align: "right", color: colors.purple, maxWidth: 360, size: 14, weight: 800 });
    text(subtitle ?? `${options.periodLabel} | ${report.totalFillUps} fuel logs analysed`, page.width - margin, y + 49, { align: "right", color: colors.muted, maxWidth: 380, size: 8, weight: 600 });
    y += 86;
  };
  const finishPage = () => {
    text(`Generated ${new Date().toLocaleString("en-GB")} | ${options.periodLabel}`, margin, page.height - 24, { color: colors.muted, maxWidth: 400, size: 7, weight: 600 });
    text(`Page ${pageNumber}`, page.width - margin, page.height - 24, { align: "right", color: colors.muted, size: 7, weight: 600 });
    images.push({ data: binaryStringFromDataUrl(canvas.toDataURL("image/jpeg", 0.92)), height: canvas.height, width: canvas.width });
  };
  const ensure = (height: number) => {
    if (y + height <= bottom) return;
    finishPage();
    startPage(options.full ? "Fuel Spend Management Report" : "Fuel Spend Manager Summary", "Continued");
  };
  const section = (label: string) => {
    ensure(42);
    text(label, margin, y, { color: colors.slate, size: 12, weight: 800 });
    context.strokeStyle = "#c4b5fd";
    context.lineWidth = 1.5 * scale;
    context.beginPath();
    context.moveTo(margin * scale, (y + 8) * scale);
    context.lineTo((margin + contentWidth) * scale, (y + 8) * scale);
    context.stroke();
    y += 24;
  };
  const paragraph = (line: string) => {
    const lines = wrap(line, contentWidth, 8.2);
    ensure(lines.length * 12 + 4);
    lines.forEach((wrappedLine) => {
      text(wrappedLine, margin, y, { color: colors.text, size: 8.2 });
      y += 12;
    });
    y += 2;
  };
  const metrics = (items: Array<[string, string, string?]>, columns = 4) => {
    const gap = 8;
    const width = (contentWidth - gap * (columns - 1)) / columns;
    items.forEach((item, index) => {
      if (index % columns === 0) ensure(60);
      if (index > 0 && index % columns === 0) y += 64;
      const x = margin + (index % columns) * (width + gap);
      rect(x, y, width, 56, index === 0 ? colors.purpleLight : "#ffffff");
      text(item[0], x + 8, y + 15, { color: colors.muted, maxWidth: width - 16, size: 6.6, weight: 800 });
      text(item[1], x + 8, y + 36, { color: index === 0 ? colors.purple : colors.slate, maxWidth: width - 16, size: 11, weight: 800 });
      if (item[2]) text(item[2], x + 8, y + 49, { color: colors.muted, maxWidth: width - 16, size: 6.5 });
    });
    y += 66;
  };
  const issueLabel = (issue: string) =>
    ({
      cost_litre_mismatch: "Cost/litre mismatch",
      decreasing_mileage: "Decreasing mileage",
      missing_driver: "Missing driver",
      missing_litres: "Missing litres",
      missing_mileage: "Missing mileage",
      missing_price_per_litre: "Missing price/litre",
      missing_registration: "Missing registration",
      missing_total_cost: "Missing total cost",
      non_bangchak_regular_fuel: "Non-Bangchak regular fuel",
      possible_duplicate: "Possible duplicate",
      unchecked_receipt: "Unchecked receipt",
      unusual_price: "Unusual fuel price"
    })[issue] ?? issue;
  const compactInsightCards = () => {
    const movement = formatSpendMovement(report, options.language);
    metrics([
      ["Fuel Spend vs Previous Period", movement.amount, movement.direction],
      ["Highest Spend Vehicle", report.highestSpendVehicle?.vehicleReg ?? "-", report.highestSpendVehicle ? formatBahtWhole(report.highestSpendVehicle.spend) : "-"],
      ["Bangchak Usage", formatPercent(report.bangchakRegularFuelUsagePercent, options.language), report.mostUsedStation ? `Most-used station: ${report.mostUsedStation.station}` : undefined]
    ], 3);
  };
  const tableRows = (rows: string[][], columns: Array<{ label: string; width: number }>, maxRows?: number) => {
    const drawHeader = () => {
      rect(margin, y, contentWidth, 22, colors.slate, colors.slate);
      let x = margin;
      columns.forEach((column) => {
        text(column.label, x + 5, y + 14, { color: "#ffffff", maxWidth: column.width - 10, size: 6.5, weight: 800 });
        x += column.width;
      });
      y += 22;
    };
    drawHeader();
    rows.slice(0, maxRows ?? rows.length).forEach((row, rowIndex) => {
      const lineCounts = row.map((cell, index) => wrap(cell, columns[index].width - 10, 6.5).length);
      const rowHeight = Math.max(22, Math.max(...lineCounts) * 9 + 10);
      if (y + rowHeight > bottom) {
        finishPage();
        startPage(options.full ? "Fuel Spend Management Report" : "Fuel Spend Manager Summary", "Continued");
        drawHeader();
      }
      rect(margin, y, contentWidth, rowHeight, rowIndex % 2 ? colors.soft : "#ffffff", "#e2e8f0");
      let x = margin;
      row.forEach((cell, index) => {
        wrap(cell, columns[index].width - 10, 6.5).forEach((line, lineIndex) => {
          text(line, x + 5, y + 13 + lineIndex * 9, { color: colors.text, maxWidth: columns[index].width - 10, size: 6.5, weight: index === 0 ? 700 : 500 });
        });
        x += columns[index].width;
      });
      y += rowHeight;
    });
    y += 12;
  };
  const table = (title: string, columns: Array<{ label: string; width: number }>, rows: string[][], maxRows?: number) => {
    section(title);
    tableRows(rows, columns, maxRows);
  };
  const trendChart = () => {
    section("Trend");
    if (report.trendRows.length <= 1) {
      const movement = formatSpendMovement(report, options.language);
      tableRows([
        ["This Period", formatBahtWhole(report.totalSpend)],
        ["Previous Period", formatBahtWhole(report.previousTotalSpend)],
        ["Difference", movement.amount],
        ["Percentage Change", movement.direction]
      ], [{ label: "Measure", width: 230 }, { label: "Value", width: contentWidth - 230 }]);
      return;
    }
    const rows = report.trendRows.slice(-8);
    const chartHeight = 112;
    const maxSpend = Math.max(...rows.map((row) => row.spend), 1);
    const maxLitres = Math.max(...rows.map((row) => row.litres), 1);
    rect(margin, y, contentWidth, chartHeight, "#ffffff", "#e2e8f0");
    const barGap = 6;
    const chartPadding = 18;
    const availableWidth = contentWidth - chartPadding * 2;
    const barWidth = Math.max(12, (availableWidth - barGap * (rows.length - 1)) / Math.max(rows.length, 1));
    rows.forEach((row, index) => {
      const x = margin + chartPadding + index * (barWidth + barGap);
      const spendHeight = Math.max(3, (row.spend / maxSpend) * 62);
      const litreHeight = Math.max(3, (row.litres / maxLitres) * 62);
      context.fillStyle = colors.purple;
      context.fillRect(x * scale, (y + 80 - spendHeight) * scale, (barWidth * 0.46) * scale, spendHeight * scale);
      context.fillStyle = colors.amber;
      context.fillRect((x + barWidth * 0.52) * scale, (y + 80 - litreHeight) * scale, (barWidth * 0.46) * scale, litreHeight * scale);
      text(row.period, x, y + 98, { color: colors.muted, maxWidth: barWidth, size: 5.6, weight: 700 });
    });
    text("Spend", margin + contentWidth - 72, y + 14, { color: colors.purple, size: 6.5, weight: 800 });
    text("Litres", margin + contentWidth - 34, y + 14, { color: colors.amber, size: 6.5, weight: 800 });
    y += chartHeight + 18;
  };

  const drawSummary = () => {
    startPage("Fuel Spend Manager Summary", `${options.periodLabel} | Latest log: ${report.latestFuelLogDate ?? "-"} | ${report.totalFillUps} fuel logs analysed`);
    metrics([
      ["Total Fuel Spend", formatBahtWhole(report.totalSpend)],
      ["Total Litres", formatLitresWhole(report.totalLitres, options.language)],
      ["Fill-ups", String(report.totalFillUps)],
      ["Weighted Avg ฿/L", formatPrice(report.weightedAveragePrice)]
    ]);
    compactInsightCards();
    section("Needs Attention");
    const topIssueRows = Object.entries(report.qualityCounts).filter(([, count]) => count > 0).map(([issue, count]) => [issueLabel(issue), String(count)]);
    if (topIssueRows.length) {
      const boxHeight = Math.min(112, topIssueRows.length * 20 + 16);
      rect(margin, y, contentWidth, boxHeight, "#fffbeb", "#fde68a");
      topIssueRows.slice(0, 5).forEach(([label, count], index) => {
        text(count, margin + 12, y + 22 + index * 18, { color: colors.amber, size: 9, weight: 800 });
        text(label, margin + 48, y + 22 + index * 18, { color: colors.slate, maxWidth: contentWidth - 68, size: 8.2, weight: 700 });
      });
      y += boxHeight + 16;
    } else {
      paragraph("No fuel-record issues require review for this selection.");
    }
    table("Top Vehicles", [
      { label: "Vehicle", width: 82 },
      { label: "Driver", width: 126 },
      { label: "Fill-ups", width: 56 },
      { label: "Litres", width: 76 },
      { label: "Spend", width: 90 },
      { label: "Avg ฿/L", width: contentWidth - 430 }
    ], report.vehicleRows.map((row) => [row.vehicleReg, row.driver, String(row.fuelLogs), row.litres.toFixed(1), formatBahtWhole(row.spend), formatPrice(row.weightedAveragePrice)]), 5);
    finishPage();
  };

  const drawFull = () => {
    startPage("Fuel Spend Management Report", `${options.periodLabel} | ${report.totalFillUps} fuel logs analysed`);
    metrics([
      ["Total Fuel Spend", formatBahtWhole(report.totalSpend)],
      ["Total Litres", formatLitresWhole(report.totalLitres, options.language)],
      ["Fill-ups", String(report.totalFillUps)],
      ["Weighted Avg ฿/L", formatPrice(report.weightedAveragePrice)]
    ]);
    compactInsightCards();
    section("Executive Summary");
    report.executiveSummary.slice(0, 3).forEach((item) => paragraph(`• ${item}`));
    trendChart();
    finishPage();

    startPage("Vehicle Fuel Performance", `${options.periodLabel} | Registration-led vehicle performance`);
    tableRows(report.vehicleRows.map((row) => [
      row.vehicleReg,
      row.driver,
      String(row.fuelLogs),
      row.litres.toFixed(1),
      formatBahtWhole(row.spend),
      row.distanceTravelled == null ? "Insufficient mileage data" : `${row.distanceTravelled.toLocaleString("en-GB")} km`,
      row.kmPerLitre == null ? "-" : row.kmPerLitre.toFixed(2),
      row.fuelCostPerKm == null ? "-" : formatBaht(row.fuelCostPerKm)
    ]), [
      { label: "Vehicle", width: 72 },
      { label: "Driver", width: 108 },
      { label: "Logs", width: 42 },
      { label: "Litres", width: 58 },
      { label: "Spend", width: 74 },
      { label: "Distance", width: 86 },
      { label: "km/L", width: 44 },
      { label: "Cost/km", width: contentWidth - 484 }
    ]);
    finishPage();

    startPage("Station Performance", `${options.periodLabel} | Station usage and regular-fuel compliance`);
    tableRows(report.stationRows.map((row) => [
      row.station,
      String(row.fillUps),
      row.litres.toFixed(1),
      formatBahtWhole(row.spend),
      formatPrice(row.weightedAveragePrice),
      formatPercent(row.spendPercent, options.language)
    ]), [
      { label: "Station", width: 116 },
      { label: "Fill-ups", width: 64 },
      { label: "Litres", width: 84 },
      { label: "Spend", width: 96 },
      { label: "Weighted Avg ฿/L", width: 96 },
      { label: "% Spend", width: contentWidth - 456 }
    ]);
    section("Bangchak Regular-Fuel Usage");
    paragraph(`${formatPercent(report.bangchakRegularFuelUsagePercent, options.language)} of regular fuel fill-ups used Bangchak. LPG is excluded from this compliance percentage.`);
    const exceptions = report.logs.filter((log) => log.issues.includes("non_bangchak_regular_fuel"));
    if (exceptions.length) {
      tableRows(exceptions.map((log) => [log.date, log.canonicalVehicleReg, log.driver || "-", log.location || log.canonicalLocationGroup, formatBahtWhole(log.costAmount)]), [
        { label: "Date", width: 72 },
        { label: "Vehicle", width: 84 },
        { label: "Driver", width: 128 },
        { label: "Station", width: 150 },
        { label: "Spend", width: contentWidth - 434 }
      ], 12);
    } else {
      paragraph("No non-Bangchak regular-fuel exceptions were found for this selection.");
    }
    finishPage();

    startPage("Needs Attention / Data Quality", `${options.periodLabel} | Records requiring action`);
    const actionRows = report.needsAttention.map((log) => [log.date, log.canonicalVehicleReg, log.driver || "-", log.location || log.canonicalLocationGroup, formatBahtWhole(log.costAmount), log.issues.map(issueLabel).join(", ")]);
    if (actionRows.length) {
      tableRows(actionRows, [
        { label: "Date", width: 62 },
        { label: "Vehicle", width: 76 },
        { label: "Driver", width: 104 },
        { label: "Station", width: 112 },
        { label: "Spend", width: 72 },
        { label: "Issue", width: contentWidth - 426 }
      ]);
    } else {
      paragraph("No records require action for this selection.");
    }
    section("Data Quality Summary");
    tableRows([
      ["Eligible Logs", String(report.totalFillUps)],
      ["Included Logs", String(report.totalFillUps)],
      ["Issues Requiring Review", String(report.needsAttention.length)],
      ["Reconciliation", report.reconciliationStatus === "Passed" ? "Passed" : "Review Required"]
    ], [{ label: "Measure", width: 240 }, { label: "Value", width: contentWidth - 240 }]);
    finishPage();
  };

  if (options.full) drawFull();
  else drawSummary();
  return buildImagePagesPdf(images);
}
