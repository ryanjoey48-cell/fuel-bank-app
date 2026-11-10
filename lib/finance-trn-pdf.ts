/**
 * Draft TRN statement → A4 landscape PDF, drawn on canvas with the same figures the billing sheet shows.
 * Reuses the existing EES image-page PDF writer and logo loader (lib/oil-service-pdf.ts); no new dependency.
 */
import { buildImagePagesPdf, downloadBlob, loadCanvasImage, loadOilServicePdfLogo } from "@/lib/oil-service-pdf";
import { EES_COMPANY } from "@/lib/ees-company";

export type TrnPdfRow = {
  position: number; date: string; customerJob: string; workOrder: string; pickup: string; delivery: string; vehicle: string; driver: string;
  trip: string; extras: string[]; total: string;
};
export type TrnPdfInput = {
  title: string; customer: string; period: string; draftReference: string; /** Local-test simulated TRN (TRN###/2026), else null. Never an official number. */ simulatedTrn?: string | null; preparedDate: string;
  extraHeaders: string[]; rows: TrnPdfRow[]; totals: { trip: string; extras: string[]; total: string }; jobCount: number; warning?: string;
};

const FONT = `"Sarabun", "Leelawadee UI", "Noto Sans Thai", Tahoma, sans-serif`;
const SCALE = 2; // px per pt
const PAGE_W = 842, PAGE_H = 595, MARGIN = 28;

function wrap(ctx: CanvasRenderingContext2D, text: string, width: number, maxLines: number) {
  const words = String(text || "").split(/(\s+)/);
  const lines: string[] = [];
  let current = "";
  const push = (line: string) => lines.push(line.trim());
  for (const word of words) {
    const candidate = current + word;
    if (ctx.measureText(candidate).width <= width || !current) { current = candidate; continue; }
    push(current); current = word.trimStart();
  }
  if (current) push(current);
  // Very long single tokens (Thai has no spaces): break by characters.
  const out: string[] = [];
  for (const line of lines) {
    if (ctx.measureText(line).width <= width) { out.push(line); continue; }
    let chunk = "";
    for (const ch of Array.from(line)) {
      if (ctx.measureText(chunk + ch).width > width && chunk) { out.push(chunk); chunk = ch; } else chunk += ch;
    }
    if (chunk) out.push(chunk);
  }
  if (out.length > maxLines) {
    const kept = out.slice(0, maxLines);
    let last = kept[maxLines - 1];
    while (last && ctx.measureText(`${last}…`).width > width) last = Array.from(last).slice(0, -1).join("");
    kept[maxLines - 1] = `${last}…`;
    return kept;
  }
  return out.length ? out : [""];
}

export async function downloadTrnStatementPdf(input: TrnPdfInput, fileName: string) {
  if (typeof document !== "undefined" && document.fonts) await document.fonts.ready;
  const logo = await loadOilServicePdfLogo();
  const logoImage = logo.dataUrl ? await loadCanvasImage(logo.dataUrl) : null;
  const columns = [
    { key: "position", label: "No.", w: 22, align: "center" },
    { key: "date", label: "Date", w: 50 },
    { key: "customerJob", label: "Cust. Job", w: 48 },
    { key: "workOrder", label: "W/O", w: 44, bold: true },
    { key: "pickup", label: "Pickup", w: 92 },
    { key: "delivery", label: "Delivery", w: 92 },
    { key: "vehicle", label: "Vehicle", w: 46 },
    { key: "driver", label: "Driver", w: 52 },
    { key: "trip", label: "Trip", w: 50, align: "right" },
    ...input.extraHeaders.map((label, index) => ({ key: `extra${index}`, label, w: 40, align: "right" })),
    { key: "total", label: "Total", w: 0, align: "right", bold: true }
  ] as { key: string; label: string; w: number; align?: "left" | "right" | "center"; bold?: boolean }[];
  const used = columns.reduce((sum, column) => sum + column.w, 0);
  columns[columns.length - 1].w = PAGE_W - MARGIN * 2 - used;

  const pages: { data: string; height: number; width: number }[] = [];
  const canvases: HTMLCanvasElement[] = [];
  let canvas!: HTMLCanvasElement; let ctx!: CanvasRenderingContext2D; let y = 0;
  const font = (size: number, weight = 400) => { ctx.font = `${weight} ${size}px ${FONT}`; };
  const text = (value: string, x: number, yy: number, align: CanvasTextAlign = "left") => { ctx.textAlign = align; ctx.fillText(value, x, yy); };

  const newPage = () => {
    canvas = document.createElement("canvas");
    canvas.width = PAGE_W * SCALE; canvas.height = PAGE_H * SCALE;
    ctx = canvas.getContext("2d")!;
    ctx.scale(SCALE, SCALE);
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, PAGE_W, PAGE_H);
    ctx.textBaseline = "alphabetic";
    canvases.push(canvas);
    // Draft banner
    ctx.strokeStyle = "#67288f"; ctx.lineWidth = 1.5; ctx.strokeRect(MARGIN, MARGIN - 6, PAGE_W - MARGIN * 2, 16);
    ctx.fillStyle = "#5b238e"; font(8, 700); text("DRAFT / TEST — NOT AN ISSUED DOCUMENT · ร่าง / ทดสอบ — ไม่ใช่เอกสารที่ออกจริง", PAGE_W / 2, MARGIN + 5, "center");
    y = MARGIN + 22;
    if (canvases.length === 1) {
      if (logoImage) ctx.drawImage(logoImage, MARGIN, y, 40, 40);
      const left = MARGIN + (logoImage ? 48 : 0);
      ctx.fillStyle = "#0f172a"; font(11, 700); text(EES_COMPANY.nameTh, left, y + 11);
      font(9, 600); text(EES_COMPANY.nameEn, left, y + 23);
      font(7.5); text(`${EES_COMPANY.addressTh} · ${EES_COMPANY.addressEn}`, left, y + 33);
      text(`เลขประจำตัวผู้เสียภาษีอากร / Tax ID ${EES_COMPANY.taxId}${EES_COMPANY.phone ? ` · Tel ${EES_COMPANY.phone}` : ""}`, left, y + 42);
      ctx.fillStyle = "#3b0764"; font(12, 700); text(input.title, PAGE_W - MARGIN, y + 11, "right");
      if (input.simulatedTrn) {
        ctx.fillStyle = "#3b0764"; font(11, 800); text(`TRN: ${input.simulatedTrn}`, PAGE_W - MARGIN, y + 25, "right");
        ctx.fillStyle = "#9f1239"; font(7.5, 700); text("จำลองเพื่อทดสอบ / Simulated for testing — not issued · official TRN pending", PAGE_W - MARGIN, y + 35, "right");
        ctx.fillStyle = "#0f172a"; font(7.5); text(`Draft ref / เลขอ้างอิงร่าง: ${input.draftReference}`, PAGE_W - MARGIN, y + 44, "right");
      } else {
        ctx.fillStyle = "#0f172a"; font(8.5); text("TRN: Official TRN pending confirmation · รอยืนยันเลข TRN", PAGE_W - MARGIN, y + 24, "right");
        text(`Draft ref / เลขอ้างอิงร่าง: ${input.draftReference}`, PAGE_W - MARGIN, y + 35, "right");
      }
      y += 50;
      ctx.strokeStyle = "#5b238e"; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(MARGIN, y); ctx.lineTo(PAGE_W - MARGIN, y); ctx.stroke();
      y += 13;
      const info = [["ลูกค้า / Customer", input.customer], ["รอบวางบิล / Billing period", input.period], ["วันที่จัดทำร่าง / Draft prepared", input.preparedDate], ["วันที่วางบิล / Billing date", "Not issued · ยังไม่ออก"]];
      info.forEach(([label, value], index) => {
        const x = MARGIN + index * ((PAGE_W - MARGIN * 2) / 4);
        ctx.fillStyle = "#64748b"; font(7); text(label, x, y);
        ctx.fillStyle = "#0f172a"; font(9.5, 700); text(value, x, y + 12);
      });
      y += 24;
    }
    drawHeaderRow();
  };
  const drawHeaderRow = () => {
    ctx.fillStyle = "#f3e8ff"; ctx.fillRect(MARGIN, y, PAGE_W - MARGIN * 2, 16);
    ctx.fillStyle = "#3b0764"; font(7.5, 700);
    let x = MARGIN;
    for (const column of columns) {
      const ax = column.align === "right" ? x + column.w - 3 : column.align === "center" ? x + column.w / 2 : x + 3;
      text(column.label, ax, y + 11, column.align === "right" ? "right" : column.align === "center" ? "center" : "left");
      x += column.w;
    }
    y += 16;
  };
  const footerSpace = 30;

  newPage();
  for (const row of input.rows) {
    font(7.5);
    const values: Record<string, string> = { ...row, position: String(row.position), ...Object.fromEntries(row.extras.map((value, index) => [`extra${index}`, value])) } as unknown as Record<string, string>;
    const cells = columns.map((column) => wrap(ctx, values[column.key] ?? "", column.w - 6, 2));
    const height = Math.max(...cells.map((lines) => lines.length)) * 9.5 + 6;
    if (y + height > PAGE_H - MARGIN - footerSpace) newPage();
    let x = MARGIN;
    columns.forEach((column, index) => {
      ctx.fillStyle = "#0f172a"; font(7.5, column.bold ? 700 : 400);
      cells[index].forEach((line, lineIndex) => {
        const ax = column.align === "right" ? x + column.w - 3 : column.align === "center" ? x + column.w / 2 : x + 3;
        text(line, ax, y + 10 + lineIndex * 9.5, column.align === "right" ? "right" : column.align === "center" ? "center" : "left");
      });
      x += column.w;
    });
    y += height;
    ctx.strokeStyle = "#e2e8f0"; ctx.lineWidth = 0.6; ctx.beginPath(); ctx.moveTo(MARGIN, y); ctx.lineTo(PAGE_W - MARGIN, y); ctx.stroke();
  }
  if (y + 40 > PAGE_H - MARGIN - footerSpace) newPage();
  ctx.fillStyle = "#faf5ff"; ctx.fillRect(MARGIN, y, PAGE_W - MARGIN * 2, 16);
  ctx.fillStyle = "#0f172a"; font(8, 700);
  let x = MARGIN;
  for (const column of columns) {
    const value = column.key === "driver" ? `TOTAL (${input.jobCount})` : column.key === "trip" ? input.totals.trip
      : column.key.startsWith("extra") ? input.totals.extras[Number(column.key.slice(5))] : column.key === "total" ? input.totals.total : "";
    if (value) text(value, x + column.w - 3, y + 11, "right");
    x += column.w;
  }
  y += 24;
  if (input.warning) { ctx.fillStyle = "#9f1239"; font(8, 700); text(input.warning, MARGIN, y); }

  canvases.forEach((page, index) => {
    const c = page.getContext("2d")!;
    c.fillStyle = "#5b238e"; c.font = `400 ${7.5 * SCALE}px ${FONT}`; c.textAlign = "left";
    c.fillText(input.simulatedTrn ? `EES · Draft/Test · ${input.simulatedTrn} (simulated, not issued)` : "EES · Draft/Test", MARGIN * SCALE, (PAGE_H - 14) * SCALE);
    c.textAlign = "right";
    c.fillText(`Page ${index + 1} of ${canvases.length}`, (PAGE_W - MARGIN) * SCALE, (PAGE_H - 14) * SCALE);
    const dataUrl = page.toDataURL("image/jpeg", 0.92);
    pages.push({ data: atob(dataUrl.split(",")[1] ?? ""), width: page.width, height: page.height });
  });
  downloadBlob(buildImagePagesPdf(pages, { width: PAGE_W, height: PAGE_H }), fileName);
}
