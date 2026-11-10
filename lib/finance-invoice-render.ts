/**
 * EES INVOICE — fixed-geometry reproduction of the company's Excel invoice (source: "TRN invoice test.pdf",
 * 2026-TRN649-INTEGRA.xls printed to US Letter, 612 × 792 pt). All coordinates below are points measured from that
 * reference (top-left origin). The drawing code only needs a Canvas 2D context, so the same function runs in the browser
 * (preview / PDF / print) and in Node (visual comparison test).
 *
 * The invoice is drawn at a fixed page size: a wider browser preview scales the finished bitmap, it never re-lays-out.
 */
import { type InvoiceDocument, type InvoiceLine } from "@/lib/finance-invoice-model";

export const INVOICE_PAGE = { width: 612, height: 792 } as const;
export const INVOICE_THAI_FONT_FAMILY = "EESInvoiceThai";
const SERIF = `"Times New Roman", "Liberation Serif", "Angsana New", ${INVOICE_THAI_FONT_FAMILY}, "Leelawadee UI", Tahoma, serif`;
const SANS = `Arial, "Liberation Sans", ${INVOICE_THAI_FONT_FAMILY}, "Leelawadee UI", Tahoma, sans-serif`;

/** Header wording exactly as printed on the source invoice (kept for fidelity; see INVOICE_SOURCE_OBSERVATIONS). */
export const INVOICE_TEMPLATE_TEXT = {
  companyTh: "บริษัท เอ็กซ์เปอร์ต เอ็กซ์เพรส เซ็นเดอร์ จำกัด",
  companyEn: "EXPERT EXPRESS SENDER CO., LTD",
  addressTh: "88  ถนนแฮปปี้เพลซ  แขวงคลองสามประเวศ เขตลาดกระบัง กรุงเทพฯ 10520",
  addressEn: "88 HAPPY PLACE ROAD,KLONGSAMPRAVET, LATKRABANG,BANGKOK 10520",
  taxLabel: "เลขประจำตัวผู้เสียภาษีอากร",
  heading: "ใบแจ้งหนี้/INVOICE",
  invoiceNoLabel: "INVOICE NO.",
  customerLabel: "ชื่อลูกค้า",
  description: "รายการ (DESCRIPTION)",
  receiver: "ผู้รับบิล/RECEIVEC/วันที่ DATE",
  signature: "ลายเซ็นต์ผู้มีอำนาจ/AUTHORIZED SINGNATURE"
} as const;

/** Modern version: the two obvious form typos corrected; everything else is identical to the source wording. */
export const INVOICE_TEMPLATE_TEXT_MODERN = { receiver: "ผู้รับบิล/RECEIVED/วันที่ DATE", signature: "ลายเซ็นต์ผู้มีอำนาจ/AUTHORIZED SIGNATURE" } as const;

/** Things seen on the source that differ from the app's own records or look like typos. Reported, never silently fixed. */
export const INVOICE_SOURCE_OBSERVATIONS = [
  "Source prints the Thai company name as \"เอ็กซ์เปอร์ต\"; the app's company record (lib/ees-company.ts) spells it \"เอ็กซ์เพิร์ท\". The template keeps the source spelling.",
  "Source form wording \"RECEIVEC\" (probably RECEIVED) and \"SINGNATURE\" (probably SIGNATURE) is reproduced as printed.",
  "Source English address is upper-case with no space after the commas; reproduced as printed.",
  "Source logo is the purple EES word-mark from the Excel template, not the red EES logo used elsewhere in the app."
] as const;

const COLS = [76.33, 127.3, 172.9, 233.3, 269.7, 310.7, 338.3, 379.5, 423.7, 457, 510.3] as const;
const ROW_H = 20.667;
const ROWS_TOP = 292.67;
const BASE_SLOTS = 3;
const AMOUNT_RIGHT = 505.6;
const THIN = 0.67;
const THICK = 1.6;

/** Rows that fit on a single-page invoice (3 template slots + growth that still leaves room for the totals + signatures). */
export const ROWS_SINGLE_PAGE = 13;
export const ROWS_MIDDLE_PAGE = 22;

export type InvoiceVariant = "reference" | "modern";
export type InvoiceImages = { logo?: CanvasImageSource | null };
/** Visible area of public/ees-logo.png (1536×1024 with transparent padding) used by the modern version, untouched otherwise. */
export const MODERN_LOGO_SOURCE = { x: 470, y: 223, w: 597, h: 505 } as const;
export const INVOICE_VARIANT_NOTES = {
  reference: "Faithful reproduction of the owner example: purple word-mark logo, source wording and Thai company spelling.",
  modern: "Proposal for management review (not active): current EES logo, spelling corrected (RECEIVED / SIGNATURE), sans typography. Same structure, geometry and figures."
} as const;
export type DrawOptions = {
  variant?: InvoiceVariant;
  images?: InvoiceImages;
  /** Draft/test banner in the top margin. Off only for the reference-fidelity comparison. */
  banner?: boolean;
  pageIndex?: number;
  pageCount?: number;
};

type Ctx = CanvasRenderingContext2D;
type TextOpts = { size: number; bold?: boolean; font?: string; color?: string; align?: "left" | "right" | "center"; fitW?: number; maxW?: number; minSize?: number };

function setFont(ctx: Ctx, size: number, bold: boolean, family: string) { ctx.font = `${bold ? "700" : "400"} ${size}px ${family}`; }

/** Draws one line of text on its baseline. `fitW` scales the size so the text is exactly that wide (static labels);
 *  `maxW` only shrinks text that would overflow (dynamic values), then truncates with an ellipsis at `minSize`. */
let BODY_FONT = SERIF;
function text(ctx: Ctx, value: string, x: number, y: number, o: TextOpts) {
  if (!value) return;
  const family = o.font ?? BODY_FONT;
  let size = o.size;
  setFont(ctx, size, !!o.bold, family);
  if (o.fitW) { const w = ctx.measureText(value).width; if (w > 0) size = size * (o.fitW / w); setFont(ctx, size, !!o.bold, family); }
  let out = value;
  if (o.maxW) {
    const min = o.minSize ?? size * 0.6;
    while (ctx.measureText(out).width > o.maxW && size > min) { size = Math.max(min, size - 0.25); setFont(ctx, size, !!o.bold, family); }
    if (ctx.measureText(out).width > o.maxW) { let chars = Array.from(out); while (chars.length > 1 && ctx.measureText(`${chars.join("")}…`).width > o.maxW) chars = chars.slice(0, -1); out = `${chars.join("")}…`; }
  }
  ctx.fillStyle = o.color ?? "#000";
  ctx.textAlign = o.align ?? "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(out, x, y);
}

/**
 * Place a pickup/delivery name inside one table cell. Short names keep the reference single line (shrunk only down to
 * 7 pt). A longer name is split into two balanced lines inside the same row instead of shrinking to an unreadable size;
 * the row height, rules and column geometry are untouched. Only if two lines still do not fit does it shrink, then ellipsise.
 */
function cellText(ctx: Ctx, value: string, x: number, top: number, base: number, maxW: number) {
  if (!value) return;
  setFont(ctx, 9.5, false, BODY_FONT);
  const natural = ctx.measureText(value).width;
  if (natural <= maxW || natural * (7 / 9.5) <= maxW) { text(ctx, value, x, base, { size: 9.5, maxW, minSize: 6 }); return; }
  const words = value.split(/s+/).filter(Boolean);
  let first = "";
  let second = "";
  if (words.length > 1) {
    let best = Infinity;
    for (let i = 1; i < words.length; i += 1) {
      const a = words.slice(0, i).join(" ");
      const b = words.slice(i).join(" ");
      const score = Math.max(ctx.measureText(a).width, ctx.measureText(b).width);
      if (score < best) { best = score; first = a; second = b; }
    }
  } else {
    const chars = Array.from(value);
    const half = Math.ceil(chars.length / 2);
    first = chars.slice(0, half).join("");
    second = chars.slice(half).join("");
  }
  text(ctx, first, x, top + 8.6, { size: 8, maxW, minSize: 5.5 });
  text(ctx, second, x, top + 17.4, { size: 8, maxW, minSize: 5.5 });
}

function hline(ctx: Ctx, y: number, x0: number, x1: number, w = THIN) { ctx.fillStyle = "#000"; ctx.fillRect(x0, y, x1 - x0, w); }
function vline(ctx: Ctx, x: number, y0: number, y1: number, w = THIN) { ctx.fillStyle = "#000"; ctx.fillRect(x, y0, w, y1 - y0); }

export const money2 = (satang: number) => `${(satang / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** dd-mm-yy as printed in the source (27-10-26). */
export function invoiceDate(iso: string | null) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  return m ? `${m[3]}-${m[2]}-${m[1].slice(2)}` : "";
}

/** Split lines into pages. The source is a one-page form; extra rows add pages instead of shrinking the template. */
export function paginateInvoiceLines<T>(lines: T[]): T[][] {
  if (lines.length <= ROWS_SINGLE_PAGE) return [lines];
  const pages: T[][] = [];
  let rest = lines.slice();
  while (rest.length > ROWS_SINGLE_PAGE) { const take = Math.min(ROWS_MIDDLE_PAGE, rest.length - ROWS_SINGLE_PAGE); pages.push(rest.slice(0, take)); rest = rest.slice(take); }
  if (rest.length) pages.push(rest);
  return pages;
}

export function drawInvoicePage(ctx: Ctx, doc: InvoiceDocument, pageLines: InvoiceLine[], options: DrawOptions = {}) {
  const pageIndex = options.pageIndex ?? 0;
  const pageCount = options.pageCount ?? 1;
  const last = pageIndex === pageCount - 1;
  const slots = Math.max(BASE_SLOTS, pageLines.length);
  const shift = (slots - BASE_SLOTS) * ROW_H;
  const modern = options.variant === "modern";
  BODY_FONT = modern ? SANS : SERIF;
  ctx.save();
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, INVOICE_PAGE.width, INVOICE_PAGE.height);

  // ── Header ──────────────────────────────────────────────────────────────
  const logo = options.images?.logo;
  if (logo) {
    if (modern) ctx.drawImage(logo, MODERN_LOGO_SOURCE.x, MODERN_LOGO_SOURCE.y, MODERN_LOGO_SOURCE.w, MODERN_LOGO_SOURCE.h, 33, 56, 43, 36.4);
    else ctx.drawImage(logo, 38, 48, 41, 72);
  }
  const navy = "#002060";
  text(ctx, INVOICE_TEMPLATE_TEXT.companyTh, 78.5, 58, { size: 12, bold: true, color: navy, fitW: 205.3 });
  text(ctx, INVOICE_TEMPLATE_TEXT.companyEn, 79.2, 80.9, { size: 16, bold: true, color: navy, fitW: 292.6 });
  text(ctx, INVOICE_TEMPLATE_TEXT.addressTh, 78.5, 101.4, { size: 11, bold: true, color: navy, fitW: 340.5 });
  text(ctx, INVOICE_TEMPLATE_TEXT.addressEn, 78.5, 125.2, { size: 11, bold: true, fitW: 413.6 });
  text(ctx, INVOICE_TEMPLATE_TEXT.taxLabel, 79.1, 149.5, { size: 13, font: SANS, fitW: 166.9 });
  text(ctx, doc.seller.taxId, 250.3, 149.5, { size: 13, font: SANS, fitW: 106 });
  ctx.fillStyle = "#cc99ff"; ctx.fillRect(127.2, 153.3, 142.2, 29.7);
  text(ctx, INVOICE_TEMPLATE_TEXT.heading, 140.3, 174.2, { size: 17, bold: true, fitW: 126.8 });

  // ── Box frame, invoice number, customer ────────────────────────────────
  text(ctx, INVOICE_TEMPLATE_TEXT.invoiceNoLabel, 342.7, 196.6, { size: 9, fitW: 51.7 });
  text(ctx, doc.invoiceNo, 428.5, 196.6, { size: 11, bold: true, maxW: 78 });
  text(ctx, INVOICE_TEMPLATE_TEXT.customerLabel, 78.1, 214.7, { size: 10, bold: true, fitW: 28.4 });
  text(ctx, doc.customer.nameTh, 129.1, 214.7, { size: 9.3, bold: true, maxW: 320 });
  text(ctx, invoiceDate(doc.invoiceDate), 458.6, 214.7, { size: 10, font: SANS, maxW: 48 });
  text(ctx, doc.customer.addressTh, 128.9, 232.2, { size: 9, maxW: 380 });
  text(ctx, INVOICE_TEMPLATE_TEXT.taxLabel, 78.1, 249.7, { size: 9.5, fitW: 96.1 });
  text(ctx, doc.customer.taxId, 183, 249.7, { size: 9.5, fitW: doc.customer.taxId.length === 13 ? 56 : undefined });
  text(ctx, INVOICE_TEMPLATE_TEXT.description, 105.8, 267.4, { size: 9.5, fitW: 89.5 });
  const headers: [string, number, number | undefined, number?][] = [["วันที่", 78.1, 16.3], ["สถานที่รับ", 128.9, 36.8], ["สถานที่ส่ง", 174.6, 36.4], ["ใบงาน", 312.2, 23.5], ["ค่าจอด", 349.2, 20.2], ["OT", 397.1, 9.7], ["เรทน้ำมัน", 426.5, 27.8]];
  for (const [label, x, w] of headers) text(ctx, label, x, 287.4, { size: 9.5, fitW: w });
  text(ctx, "AMOUNT", 468.1, 285.6, { size: 8, fitW: 31.9 });

  // ── Table rows ───────────────────────────────────────────────────────────
  const tableBottom = ROWS_TOP + slots * ROW_H;
  hline(ctx, 183, COLS[0], 511);
  hline(ctx, ROWS_TOP, COLS[0], 511);
  for (let i = 1; i <= slots; i += 1) hline(ctx, ROWS_TOP + i * ROW_H, COLS[0], 511);
  vline(ctx, COLS[0], 183, last ? 471.67 + shift : tableBottom);
  for (let r = 0; r < slots; r += 1) {
    const top = ROWS_TOP + r * ROW_H;
    const line = pageLines[r];
    const isExtra = line?.kind === "extra";
    for (const [index, x] of COLS.entries()) {
      if (index === 0 || index === COLS.length - 1) continue;
      if (isExtra && (x === 379.5 || x === 423.7)) continue; // description spans the Parking→Fuel-rate columns
      vline(ctx, x, top, top + ROW_H);
    }
    if (!line) continue;
    const base = top + 15.35;
    if (line.kind === "trip") {
      text(ctx, invoiceDate(line.date), 78.1, base, { size: 9.5, maxW: 47 });
      cellText(ctx, line.pickup, 128.9, top, base, 43);
      cellText(ctx, line.delivery, 174.6, top, base, 94);
      text(ctx, line.vehicle, 271.1, base, { size: 9.5, maxW: 38, minSize: 6.5 });
      text(ctx, line.workOrder, 312.2, base, { size: 9.5, maxW: 25, minSize: 6.5 });
      // Parking and Overtime have their own columns (owner-confirmed); blank stays blank, never a printed zero.
      if (line.parkingSatang) text(ctx, money2(line.parkingSatang), 376.5, base, { size: 9.5, align: "right", maxW: 36, minSize: 6.5 });
      if (line.overtimeSatang) text(ctx, money2(line.overtimeSatang), 421, base, { size: 9.5, align: "right", maxW: 40, minSize: 6.5 });
      if (line.fuelRate !== null) text(ctx, line.fuelRate.toFixed(2), 440.4, base, { size: 9.5, align: "center", maxW: 31 });
    } else text(ctx, line.description, 339.8, base, { size: 9.5, maxW: 115 });
    if (line.unpriced) text(ctx, "—", AMOUNT_RIGHT, base, { size: 9.5, align: "right", maxW: 48 });
    else text(ctx, money2(line.amountSatang), AMOUNT_RIGHT, base, { size: 9.5, align: "right", maxW: 48 });
    if (line.kind === "trip") text(ctx, String(pageLines.slice(0, r + 1).filter((l) => l.kind === "trip").length + pageIndexOffset(options)), 74.7, base, { size: 7, align: "right" });
  }

  // ── Totals ───────────────────────────────────────────────────────────────
  if (last) {
    const t = doc.totals;
    const y0 = tableBottom;
    // per-column mini totals box (Parking | OT | Fuel | Amount)
    hline(ctx, y0 + 17.33, 338.3, 511);
    for (const x of [338.3, 379.5, 423.7, 457, 510.3]) vline(ctx, x, y0 - ROW_H + ROW_H, y0 + 18);
    if (t.parkingSatang) text(ctx, money2(t.parkingSatang), 376.5, y0 + 10.93, { size: 9.5, align: "right", maxW: 36, minSize: 6.5 }); else text(ctx, "-", 363.5, y0 + 10.93, { size: 10, fitW: 2.8 });
    if (t.overtimeSatang) text(ctx, money2(t.overtimeSatang), 421, y0 + 10.93, { size: 9.5, align: "right", maxW: 40, minSize: 6.5 }); else text(ctx, "-", 407.5, y0 + 10.93, { size: 10, fitW: 2.8 });
    text(ctx, money2(t.amountColumnSatang), 505.4, y0 + 10.93, { size: 10.2, align: "right" });
    text(ctx, money2(t.subtotalSatang), 505.4, y0 + 28.3, { size: 10.2, align: "right" });
    if (doc.deductionLabel !== null && t.deductionBasisPoints !== null) {
      text(ctx, "หัก", 298, y0 + 48.4, { size: 9.5, fitW: 11.2 });
      text(ctx, doc.deductionLabel, 319.2, y0 + 48.4, { size: 9.5 });
    }
    text(ctx, t.deductionSatang ? money2(t.deductionSatang) : "-", 505.4, y0 + 48.4, { size: 10.2, align: "right" });
    text(ctx, "ADVANCED PAYMENT", 224, y0 + 68.4, { size: 8.5, fitW: 85 });
    text(ctx, t.advanceSatang ? money2(t.advanceSatang) : "-", t.advanceSatang ? 505.4 : 495.6, y0 + 68.4, { size: 10.2, align: "right" });
    text(ctx, money2(t.netSatang), 505.4, y0 + 88.5, { size: 10.2, align: "right" });
    hline(ctx, y0 + 95, COLS[0], 511);
    ctx.fillStyle = "#33cccc"; ctx.fillRect(77.3, y0 + 96, 432, 17.4);
    hline(ctx, y0 + 114.65, COLS[0], 511);
    hline(ctx, y0 + 116.3, COLS[0], 511);
    text(ctx, doc.amountInWordsTh, 78.4, y0 + 109.5, { size: 11, bold: true, maxW: 428, minSize: 8 });
    vline(ctx, 510.33, 183, 514.33 + shift);
    text(ctx, doc.signatureName ?? "", 271.6, 504 + shift, { size: 12.5, maxW: 230 });
    hline(ctx, 512.7 + shift, 269.7, 511, THICK);
    hline(ctx, 512.7 + shift, 32.7, 127.3, THICK);
    text(ctx, modern ? INVOICE_TEMPLATE_TEXT_MODERN.receiver : INVOICE_TEMPLATE_TEXT.receiver, 34.1, 524.8 + shift, { size: 10, fitW: 114.6 });
    text(ctx, modern ? INVOICE_TEMPLATE_TEXT_MODERN.signature : INVOICE_TEMPLATE_TEXT.signature, 270.8, 524.8 + shift, { size: 7.5, fitW: 140 });
  } else {
    vline(ctx, 510.33, 183, tableBottom);
    hline(ctx, tableBottom, COLS[0], 511);
    text(ctx, `Continued on next page · มีต่อหน้าถัดไป (${pageIndex + 1}/${pageCount})`, 506, tableBottom + 14, { size: 8, align: "right", color: "#475569" });
  }

  // ── Draft / test safeguards (top and bottom margins, outside the source form) ───────────────────────────
  if (options.banner !== false && doc.draft) {
    ctx.strokeStyle = "#67288f"; ctx.lineWidth = 1; ctx.strokeRect(76.33, 14, 434.7, 20);
    text(ctx, "DRAFT / TEST — NOT AN ISSUED INVOICE · ร่าง / ทดสอบ — ไม่ใช่ใบแจ้งหนี้ที่ออกจริง", 293.7, 27, { size: 8.5, bold: true, color: "#5b238e", align: "center", font: SANS, maxW: 424 });
    const notes = [...(modern ? ["Modern layout proposal — registered Thai company name pending verification (source: เอ็กซ์เปอร์ต, app record: เอ็กซ์เพิร์ท)"] : []), doc.invoiceNoKind === "simulated_trn" ? "Simulated TRN for local testing — not an official number" : "Draft reference — no official TRN assigned", ...doc.warnings].slice(0, 4);
    notes.forEach((note, index) => text(ctx, note, 76.33, 772 - (notes.length - 1 - index) * 10, { size: 7, color: "#9f1239", font: SANS, maxW: 434 }));
  }
  if (pageCount > 1) text(ctx, `Page ${pageIndex + 1} of ${pageCount}`, 511, 780, { size: 7.5, align: "right", font: SANS, color: "#475569" });
  ctx.restore();
}

function pageIndexOffset(options: DrawOptions) { return (options as DrawOptions & { tripOffset?: number }).tripOffset ?? 0; }

/** Draw every page onto fresh canvases made by `makeCanvas`; returns them. Works with DOM and @napi-rs/canvas. */
export function drawInvoice<C extends { width: number; height: number; getContext(type: "2d"): unknown }>(makeCanvas: (width: number, height: number) => C, scale: number, doc: InvoiceDocument, options: Omit<DrawOptions, "pageIndex" | "pageCount"> = {}): C[] {
  const pages = paginateInvoiceLines(doc.lines);
  let tripsBefore = 0;
  return pages.map((lines, index) => {
    const canvas = makeCanvas(Math.round(INVOICE_PAGE.width * scale), Math.round(INVOICE_PAGE.height * scale));
    const ctx = canvas.getContext("2d") as Ctx;
    ctx.scale(scale, scale);
    drawInvoicePage(ctx, doc, lines, { ...options, pageIndex: index, pageCount: pages.length, tripOffset: tripsBefore } as DrawOptions);
    tripsBefore += lines.filter((line) => line.kind === "trip").length;
    return canvas;
  });
}
