/**
 * Finance Records exports. Every table is built from the SAME filtered records the screen shows (no second query, no
 * recalculation), so an export can never disagree with the screen. Amounts are exact THB numbers (satang / 100),
 * written as real numbers in Excel and as fixed two-decimal text in CSV. Blank stays blank — never a fake zero.
 */
import type { FinanceRecordsCopy } from "./finance-records-copy";
import { formatBangkokDateTime } from "./finance-display";
import { monthLabel, type BatchMatch, type BatchRecord, type RecordFilters, type TrnKind, type WorkOrderRecord } from "./finance-records";

export type ExportCell = string | number | null;
export type ExportKind = "current" | "work_orders" | "trn_register" | "customer_history" | "monthly_statement";
export type ExportTable = {
  fileBase: string;
  sheetName: string;
  banner: string[];
  header: string[];
  /** Zero-based indexes of columns holding THB amounts. */
  moneyColumns: number[];
  rows: ExportCell[][];
  footer: ExportCell[][];
  /** True when any exported record is not issued — the DRAFT/TEST banner and file prefix are used. */
  hasDraft: boolean;
};

/** "Simulated (local test)" / "Official" / "Draft reference (no TRN number)" — a draft reference is never labelled as a TRN type it is not. */
export const trnKindLabel = (kind: TrnKind | null, copy: FinanceRecordsCopy) => (kind === "simulated" ? copy.export.simulated : kind === "official" ? copy.export.official : kind === "draft_ref" ? copy.export.draftRefOnly : "");
const thb = (satang: number | null) => (satang === null ? null : Math.round(satang) / 100);

// ───────────── on-screen column catalogue (shared by the table and the "current table" export) ─────────────
export type WorkOrderColumnId = "workOrder" | "customerJob" | "date" | "customer" | "pickup" | "delivery" | "vehicle" | "driver" |
  "transport" | "parking" | "tolls" | "other" | "total" | "trn" | "period" | "status";
export const WORK_ORDER_COLUMNS: { id: WorkOrderColumnId; money: boolean; defaultVisible: boolean }[] = [
  { id: "workOrder", money: false, defaultVisible: true },
  { id: "customerJob", money: false, defaultVisible: true },
  { id: "date", money: false, defaultVisible: true },
  { id: "customer", money: false, defaultVisible: true },
  { id: "pickup", money: false, defaultVisible: true },
  { id: "delivery", money: false, defaultVisible: true },
  { id: "vehicle", money: false, defaultVisible: true },
  { id: "driver", money: false, defaultVisible: false },
  { id: "transport", money: true, defaultVisible: true },
  { id: "parking", money: true, defaultVisible: true },
  { id: "tolls", money: true, defaultVisible: true },
  { id: "other", money: true, defaultVisible: true },
  { id: "total", money: true, defaultVisible: true },
  { id: "trn", money: false, defaultVisible: true },
  { id: "period", money: false, defaultVisible: false },
  { id: "status", money: false, defaultVisible: true }
];

export type BatchColumnId = "trn" | "customer" | "period" | "workOrders" | "transport" | "parking" | "tolls" | "other" | "total" | "status" | "created";
export const BATCH_COLUMNS: { id: BatchColumnId; money: boolean; defaultVisible: boolean }[] = [
  { id: "trn", money: false, defaultVisible: true },
  { id: "customer", money: false, defaultVisible: true },
  { id: "period", money: false, defaultVisible: true },
  { id: "workOrders", money: false, defaultVisible: true },
  { id: "transport", money: true, defaultVisible: true },
  { id: "parking", money: true, defaultVisible: true },
  { id: "tolls", money: true, defaultVisible: true },
  { id: "other", money: true, defaultVisible: true },
  { id: "total", money: true, defaultVisible: true },
  { id: "status", money: false, defaultVisible: true },
  { id: "created", money: false, defaultVisible: false }
];

export function workOrderCell(record: WorkOrderRecord, id: WorkOrderColumnId, copy: FinanceRecordsCopy): ExportCell {
  switch (id) {
    case "workOrder": return record.workOrder;
    case "customerJob": return record.customerJobNumber;
    case "date": return record.date;
    case "customer": return record.client;
    case "pickup": return record.pickup;
    case "delivery": return record.delivery;
    case "vehicle": return record.vehicle;
    case "driver": return record.driver;
    case "transport": return thb(record.transportSatang);
    case "parking": return thb(record.parkingSatang);
    case "tolls": return thb(record.tollSatang);
    case "other": return thb(record.otherSatang);
    case "total": return thb(record.totalSatang);
    case "trn": return record.trn ?? "";
    case "period": return record.billingPeriod ?? "";
    case "status": return copy.status[record.status];
  }
}
export function batchCell(batch: BatchRecord, id: BatchColumnId, copy: FinanceRecordsCopy): ExportCell {
  switch (id) {
    case "trn": return batch.trn;
    case "customer": return batch.client;
    case "period": return batch.billingPeriod;
    case "workOrders": return batch.workOrderCount;
    case "transport": return thb(batch.transportSatang);
    case "parking": return thb(batch.parkingSatang);
    case "tolls": return thb(batch.tollSatang);
    case "other": return thb(batch.otherSatang);
    case "total": return thb(batch.totalSatang);
    case "status": return copy.status[batch.status];
    case "created": return batch.createdAt.slice(0, 10);
  }
}

export type ExportContext = {
  copy: FinanceRecordsCopy;
  language: "en" | "th";
  filters: RecordFilters;
  clientName: (clientId: string) => string;
  now?: Date;
  month?: string;
  /** Visible column ids for the "current table" export. */
  workOrderColumns?: WorkOrderColumnId[];
  batchColumns?: BatchColumnId[];
  view?: "workOrders" | "batches";
};

function filtersSummary(ctx: ExportContext) {
  const { copy, filters } = ctx;
  const parts: string[] = [];
  if (filters.search) parts.push(`${copy.search.label}: ${filters.search}`);
  if (filters.client) parts.push(`${copy.filters.customer}: ${ctx.clientName(filters.client)}`);
  if (filters.dateFrom) parts.push(`${copy.filters.dateFrom}: ${filters.dateFrom}`);
  if (filters.dateTo) parts.push(`${copy.filters.dateTo}: ${filters.dateTo}`);
  if (filters.month) parts.push(`${copy.filters.month}: ${monthLabel(filters.month, ctx.language)}`);
  if (filters.vehicle) parts.push(`${copy.filters.vehicle}: ${filters.vehicle}`);
  if (filters.driver) parts.push(`${copy.filters.driver}: ${filters.driver}`);
  if (filters.status) parts.push(`${copy.filters.status}: ${copy.status[filters.status]}`);
  return parts.length ? parts.join(" · ") : "—";
}

function banner(ctx: ExportContext, hasDraft: boolean, extra: string[] = []) {
  const stamp = formatBangkokDateTime(ctx.now ?? new Date());
  return [
    ...(hasDraft ? [ctx.copy.export.banner] : []),
    ...extra,
    `${ctx.copy.export.exportedAt}: ${stamp} · ${ctx.copy.export.filtersApplied}: ${filtersSummary(ctx)}`
  ];
}

const stampDate = (now: Date) => now.toISOString().slice(0, 10).replaceAll("-", "");
const fileName = (hasDraft: boolean, slug: string, now: Date, suffix = "") => `${hasDraft ? "DRAFT-" : ""}EES-finance-${slug}${suffix}-${stampDate(now)}`;

const sumMoney = (rows: WorkOrderRecord[], pick: (row: WorkOrderRecord) => number | null) => {
  const present = rows.map(pick).filter((value): value is number => value !== null);
  return present.length ? thb(present.reduce((sum, value) => sum + value, 0)) : null;
};
const WO_TOTAL_PICKS: ((row: WorkOrderRecord) => number | null)[] = [
  (row) => row.transportSatang, (row) => row.parkingSatang, (row) => row.tollSatang, (row) => row.otherSatang, (row) => row.totalSatang
];

function noPriceNote(rows: WorkOrderRecord[], copy: FinanceRecordsCopy, language: "en" | "th"): ExportCell[][] {
  const missing = rows.filter((row) => row.missingPrice).length;
  if (!missing) return [];
  return [[language === "th" ? `มีใบงาน ${missing} รายการที่ยังไม่ใส่ราคา — ไม่รวมในยอดรวม` : `${missing} work order(s) have no price yet — excluded from the totals`]];
}

// ───────────── the five exports ─────────────

/** Exactly what the screen shows: the active view, the visible columns, the filtered rows. */
export function buildCurrentTableExport(ctx: ExportContext, workOrders: WorkOrderRecord[], matches: BatchMatch[]): ExportTable {
  const now = ctx.now ?? new Date();
  const { copy } = ctx;
  if (ctx.view === "batches") {
    const ids = ctx.batchColumns ?? BATCH_COLUMNS.filter((column) => column.defaultVisible).map((column) => column.id);
    const columns = BATCH_COLUMNS.filter((column) => ids.includes(column.id));
    const hasDraft = matches.some(({ batch }) => batch.status !== "issued");
    return {
      fileBase: fileName(hasDraft, "trn-batches", now), sheetName: copy.views.batches, banner: banner(ctx, hasDraft), hasDraft,
      header: columns.map((column) => copy.columns[column.id === "workOrders" ? "workOrders" : column.id]),
      moneyColumns: columns.flatMap((column, index) => (column.money ? [index] : [])),
      rows: matches.map(({ batch }) => columns.map((column) => batchCell(batch, column.id, copy))),
      footer: []
    };
  }
  const ids = ctx.workOrderColumns ?? WORK_ORDER_COLUMNS.filter((column) => column.defaultVisible).map((column) => column.id);
  const columns = WORK_ORDER_COLUMNS.filter((column) => ids.includes(column.id));
  const hasDraft = workOrders.some((row) => row.status !== "issued");
  const footer: ExportCell[][] = [];
  const moneyIndexes = columns.flatMap((column, index) => (column.money ? [index] : []));
  if (workOrders.length && moneyIndexes.length) {
    const totalRow: ExportCell[] = columns.map(() => null);
    totalRow[0] = copy.export.grandTotal;
    columns.forEach((column, index) => {
      const pick = column.id === "transport" ? WO_TOTAL_PICKS[0] : column.id === "parking" ? WO_TOTAL_PICKS[1] : column.id === "tolls" ? WO_TOTAL_PICKS[2]
        : column.id === "other" ? WO_TOTAL_PICKS[3] : column.id === "total" ? WO_TOTAL_PICKS[4] : null;
      if (pick) totalRow[index] = sumMoney(workOrders, pick);
    });
    footer.push(totalRow, ...noPriceNote(workOrders, copy, ctx.language));
  }
  return {
    fileBase: fileName(hasDraft, "work-orders", now), sheetName: copy.views.workOrders, banner: banner(ctx, hasDraft), hasDraft,
    header: columns.map((column) => copy.columns[column.id === "customerJob" ? "customerJob" : column.id === "tolls" ? "tolls" : column.id]),
    moneyColumns: moneyIndexes,
    rows: workOrders.map((row) => columns.map((column) => workOrderCell(row, column.id, copy))),
    footer
  };
}

/** One row per work order with every financial column — the "Work-order financial report". */
export function buildWorkOrderReport(ctx: ExportContext, workOrders: WorkOrderRecord[]): ExportTable {
  const now = ctx.now ?? new Date();
  const { copy } = ctx;
  const hasDraft = workOrders.some((row) => row.status !== "issued");
  const header = [copy.columns.workOrder, copy.columns.customerJob, copy.columns.date, copy.columns.customer, copy.columns.pickup, copy.columns.delivery,
    copy.columns.vehicle, copy.columns.driver, copy.columns.transport, copy.columns.parking, copy.columns.tolls, copy.columns.other, copy.columns.total,
    copy.columns.trn, copy.detailHeaders.numbering, copy.columns.period, copy.columns.status];
  const rows = workOrders.map((row): ExportCell[] => [row.workOrder, row.customerJobNumber, row.date, row.client, row.pickup, row.delivery, row.vehicle, row.driver,
    thb(row.transportSatang), thb(row.parkingSatang), thb(row.tollSatang), thb(row.otherSatang), thb(row.totalSatang), row.trn ?? "",
    trnKindLabel(row.trnKind, copy), row.billingPeriod ?? "", copy.status[row.status]]);
  const footer: ExportCell[][] = workOrders.length ? [
    [copy.export.grandTotal, null, null, null, null, null, null, null, ...WO_TOTAL_PICKS.map((pick) => sumMoney(workOrders, pick)), null, null, null, null],
    ...noPriceNote(workOrders, copy, ctx.language)
  ] : [];
  return { fileBase: fileName(hasDraft, "work-order-report", now), sheetName: copy.export.workOrderReport, banner: banner(ctx, hasDraft), hasDraft, header,
    moneyColumns: [8, 9, 10, 11, 12], rows, footer };
}

/** One row per billing batch — the "TRN register". Simulated numbers are labelled; draft amounts stay draft. */
export function buildTrnRegister(ctx: ExportContext, matches: BatchMatch[]): ExportTable {
  const now = ctx.now ?? new Date();
  const { copy } = ctx;
  const hasDraft = matches.some(({ batch }) => batch.status !== "issued");
  const header = [copy.columns.trn, copy.detailHeaders.numbering, copy.detailHeaders.draftRef, copy.columns.customer, copy.columns.period, copy.columns.workOrders,
    copy.columns.transport, copy.columns.parking, copy.columns.tolls, copy.columns.other, copy.columns.total, copy.columns.status, copy.columns.created, copy.detailHeaders.readyAt];
  const rows = matches.map(({ batch }): ExportCell[] => [batch.trn, trnKindLabel(batch.trnKind, copy), batch.draftReference, batch.client,
    batch.billingPeriod, batch.workOrderCount, thb(batch.transportSatang), thb(batch.parkingSatang), thb(batch.tollSatang), thb(batch.otherSatang), thb(batch.totalSatang),
    copy.status[batch.status], batch.createdAt.slice(0, 10), batch.readyAt ? formatBangkokDateTime(batch.readyAt) : ""]);
  const sum = (pick: (batch: BatchRecord) => number) => thb(matches.reduce((total, { batch }) => total + pick(batch), 0));
  const footer: ExportCell[][] = matches.length ? [[copy.export.grandTotal, null, null, null, null, matches.reduce((n, { batch }) => n + batch.workOrderCount, 0),
    sum((b) => b.transportSatang), sum((b) => b.parkingSatang), sum((b) => b.tollSatang), sum((b) => b.otherSatang), sum((b) => b.totalSatang), null, null, null]] : [];
  return { fileBase: fileName(hasDraft, "trn-register", now), sheetName: copy.export.trnRegister, banner: banner(ctx, hasDraft), hasDraft, header,
    moneyColumns: [6, 7, 8, 9, 10], rows, footer };
}

/** Work orders by customer, oldest first — the "Customer billing history". */
export function buildCustomerHistory(ctx: ExportContext, workOrders: WorkOrderRecord[]): ExportTable {
  const now = ctx.now ?? new Date();
  const { copy } = ctx;
  const sorted = [...workOrders].sort((a, b) => a.client.localeCompare(b.client) || a.date.localeCompare(b.date) || a.workOrder.localeCompare(b.workOrder, undefined, { numeric: true }));
  const hasDraft = sorted.some((row) => row.status !== "issued");
  const header = [copy.columns.customer, copy.columns.date, copy.columns.workOrder, copy.columns.customerJob, copy.columns.trn, copy.columns.status, copy.columns.pickup,
    copy.columns.delivery, copy.columns.vehicle, copy.columns.driver, copy.columns.transport, copy.columns.parking, copy.columns.tolls, copy.columns.other, copy.columns.total, copy.columns.period];
  const rows = sorted.map((row): ExportCell[] => [row.client, row.date, row.workOrder, row.customerJobNumber, row.trn ?? "", copy.status[row.status], row.pickup, row.delivery,
    row.vehicle, row.driver, thb(row.transportSatang), thb(row.parkingSatang), thb(row.tollSatang), thb(row.otherSatang), thb(row.totalSatang), row.billingPeriod ?? ""]);
  const footer: ExportCell[][] = sorted.length ? [[copy.export.grandTotal, null, null, null, null, null, null, null, null, null, ...WO_TOTAL_PICKS.map((pick) => sumMoney(sorted, pick)), null],
    ...noPriceNote(sorted, copy, ctx.language)] : [];
  return { fileBase: fileName(hasDraft, "customer-billing-history", now), sheetName: copy.export.customerHistory, banner: banner(ctx, hasDraft), hasDraft, header,
    moneyColumns: [10, 11, 12, 13, 14], rows, footer };
}

/** One month, grouped by customer with subtotals — the "Monthly billing statement". Issued and draft amounts are split. */
export function buildMonthlyStatement(ctx: ExportContext, workOrders: WorkOrderRecord[], month: string): ExportTable {
  const now = ctx.now ?? new Date();
  const { copy } = ctx;
  const inMonth = workOrders.filter((row) => row.date.startsWith(month));
  const hasDraft = inMonth.some((row) => row.status !== "issued");
  const header = [copy.columns.customer, copy.columns.trn, copy.columns.workOrder, copy.columns.customerJob, copy.columns.date, copy.columns.vehicle, copy.columns.pickup,
    copy.columns.delivery, copy.columns.transport, copy.columns.parking, copy.columns.tolls, copy.columns.other, copy.columns.total, copy.columns.status];
  const byClient = new Map<string, WorkOrderRecord[]>();
  for (const row of [...inMonth].sort((a, b) => a.client.localeCompare(b.client) || (a.trn ?? "").localeCompare(b.trn ?? "") || a.date.localeCompare(b.date)
    || a.workOrder.localeCompare(b.workOrder, undefined, { numeric: true }))) {
    byClient.set(row.client, [...(byClient.get(row.client) ?? []), row]);
  }
  const rows: ExportCell[][] = [];
  for (const [client, list] of byClient) {
    for (const row of list) rows.push([client, row.trn ?? "", row.workOrder, row.customerJobNumber, row.date, row.vehicle, row.pickup, row.delivery,
      thb(row.transportSatang), thb(row.parkingSatang), thb(row.tollSatang), thb(row.otherSatang), thb(row.totalSatang), copy.status[row.status]]);
    rows.push([`${copy.export.subtotal} — ${client}`, null, null, null, null, null, null, null, ...WO_TOTAL_PICKS.map((pick) => sumMoney(list, pick)), null]);
  }
  const issued = inMonth.filter((row) => row.status === "issued");
  const notIssued = inMonth.filter((row) => row.status !== "issued");
  const footer: ExportCell[][] = inMonth.length ? [
    [copy.export.grandTotal, null, null, null, null, null, null, null, ...WO_TOTAL_PICKS.map((pick) => sumMoney(inMonth, pick)), null],
    [copy.export.issuedPart, null, null, null, null, null, null, null, null, null, null, null, sumMoney(issued, (row) => row.totalSatang) ?? 0, null],
    [copy.export.draftPart, null, null, null, null, null, null, null, null, null, null, null, sumMoney(notIssued, (row) => row.totalSatang) ?? 0, null],
    ...noPriceNote(inMonth, copy, ctx.language)
  ] : [];
  return { fileBase: fileName(hasDraft, "monthly-statement", now, `-${month}`), sheetName: month, hasDraft, header,
    banner: banner(ctx, hasDraft, [`${copy.export.monthlyStatement}: ${monthLabel(month, ctx.language)}`]), moneyColumns: [8, 9, 10, 11, 12], rows, footer };
}

// ───────────── writers ─────────────

const csvText = (cell: ExportCell, money: boolean) => (cell === null ? "" : typeof cell === "number" ? (money ? cell.toFixed(2) : String(cell)) : cell);

/** Rows for the existing Excel-friendly CSV writer (UTF-8 BOM, formula-injection safe). */
export function tableToCsvRows(table: ExportTable): string[][] {
  const money = new Set(table.moneyColumns);
  const body = (row: ExportCell[]) => row.map((cell, index) => csvText(cell, money.has(index)));
  return [...table.banner.map((text) => [text]), [], table.header, ...table.rows.map(body), ...table.footer.map(body)];
}

type XlsxLike = {
  utils: {
    aoa_to_sheet(data: unknown[][]): Record<string, { v?: unknown; t?: string; z?: string } | unknown>;
    book_new(): unknown;
    book_append_sheet(workbook: unknown, sheet: unknown, name: string): void;
    encode_cell(cell: { r: number; c: number }): string;
  };
};

/** Real .xlsx workbook: amounts are numeric cells (#,##0.00), so Excel can sum and sort them. */
export function tableToWorkbook(XLSX: XlsxLike, table: ExportTable) {
  const aoa: ExportCell[][] = [...table.banner.map((text) => [text]), [], table.header, ...table.rows, ...table.footer];
  const sheet = XLSX.utils.aoa_to_sheet(aoa) as Record<string, { v?: unknown; z?: string } | unknown>;
  const firstDataRow = table.banner.length + 2; // banner rows, one blank row, then the header row
  const last = aoa.length - 1;
  for (let r = firstDataRow; r <= last; r += 1) {
    for (const c of table.moneyColumns) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })] as { v?: unknown; z?: string } | undefined;
      if (cell && typeof cell.v === "number") cell.z = "#,##0.00";
    }
  }
  const widths = table.header.map((title, c) => ({
    wch: Math.min(48, Math.max(String(title).length, ...[...table.rows, ...table.footer].map((row) => String(row[c] ?? "").length)) + 2)
  }));
  (sheet as Record<string, unknown>)["!cols"] = widths;
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, table.sheetName.replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || "Records");
  return workbook;
}
