/**
 * Finance Records — read-only views over the saved Finance workspace (the existing local test store).
 *
 * Nothing here is stored: Work Orders and TRN Batches are two projections of the SAME saved bookings + billing sheets,
 * so no financial value is ever duplicated. Totals come from the same `sheetRowTotals` / `sheetSummary` functions the
 * Customer Billing sheet and the TRN documents use, so every screen and export agrees to the satang.
 *
 * Status semantics (never fabricated): a batch is Issued only when it carries an official TRN (never true in local
 * testing); Approved / Awaiting approval need an approval workflow that does not exist locally, so they are never
 * produced here — they are only reserved vocabulary for the future shared-storage workflow.
 */
import {
  SHEET_EXTRA_KINDS,
  bangkokDate,
  bookingReference,
  confirmedWorkOrder,
  customerJobReference,
  sheetRowTotals,
  sheetSummary,
  sheetTrnLabel,
  type AdminReceiptKind,
  type Audit,
  type BillingSheet,
  type Booking,
  type PricingProvenance,
  type SheetPriceHistoryEntry,
  type State
} from "./finance-demo-centre";
import { displayVehicle, formatPeriod } from "./finance-display";

export type SheetLifecycle = "draft" | "needs_correction" | "ready_for_review" | "awaiting_approval" | "approved" | "issued";
export type RecordStatus = SheetLifecycle | "not_batched";
/** What kind of reference a batch carries: a simulated test TRN, an official TRN (never locally), or only a draft reference. */
export type TrnKind = "simulated" | "official" | "draft_ref";
export const trnKindOf = (sheet: Pick<BillingSheet, "simulatedTrn" | "officialTrn">): TrnKind => (sheet.officialTrn ? "official" : sheet.simulatedTrn ? "simulated" : "draft_ref");
export const RECORD_STATUSES: RecordStatus[] = ["not_batched", "draft", "needs_correction", "ready_for_review", "awaiting_approval", "approved", "issued"];

/** Charges grouped into the single "Other charges" column of the records table (details stay in the record). */
export const OTHER_CHARGE_KINDS: AdminReceiptKind[] = ["other", "overtime", "container_pickup", "overnight"];

/** Lifecycle of a billing batch, derived only from what is actually saved. */
export function sheetLifecycle(state: State, sheet: BillingSheet): SheetLifecycle {
  if (sheet.officialTrn) return "issued";
  if (sheet.approvedAt) return "approved";
  if (sheetSummary(state, sheet).needsChecking.length) return "needs_correction";
  if (sheet.readyForApprovalAt) return "ready_for_review";
  // Reopened / rejected for correction and not yet confirmed again.
  const label = sheetTrnLabel(sheet);
  let last: "ready" | "reopen" | null = null;
  for (const entry of state.audit) {
    if (entry.subject !== label) continue;
    if (entry.action === "sheet_mark_ready") last = "ready";
    else if (entry.action === "sheet_reopen" || entry.action === "sheet_reject_approval") last = "reopen";
  }
  return last === "reopen" ? "needs_correction" : "draft";
}

export type WorkOrderRecord = {
  jobId: string;
  workOrder: string;
  customerJobNumber: string;
  /** Transport (business) date, YYYY-MM-DD, Asia/Bangkok calendar date as saved. */
  date: string;
  clientId: string;
  client: string;
  pickup: string;
  delivery: string;
  vehicle: string;
  driver: string;
  sheetId: string | null;
  position: number | null;
  trn: string | null;
  trnSimulated: boolean;
  trnKind: TrnKind | null;
  draftReference: string | null;
  billingPeriod: string | null;
  transportSatang: number | null;
  parkingSatang: number | null;
  tollSatang: number | null;
  otherSatang: number | null;
  extrasSatang: Record<AdminReceiptKind, number | null>;
  totalSatang: number | null;
  status: RecordStatus;
  flagged: boolean;
  missingPrice: boolean;
};

export type BatchRecord = {
  sheetId: string;
  trn: string;
  trnSimulated: boolean;
  trnKind: TrnKind;
  draftReference: string;
  clientId: string;
  client: string;
  periodStart: string | null;
  periodEnd: string | null;
  billingPeriod: string;
  workOrderCount: number;
  transportSatang: number;
  parkingSatang: number;
  tollSatang: number;
  otherSatang: number;
  totalSatang: number;
  missingPrices: number;
  status: SheetLifecycle;
  createdAt: string;
  readyAt: string | null;
  workOrders: WorkOrderRecord[];
};

const sumOrNull = (values: (number | null)[]) => {
  const present = values.filter((value): value is number => value !== null);
  return present.length ? present.reduce((sum, value) => sum + value, 0) : null;
};

export function buildFinanceRecords(state: State): { workOrders: WorkOrderRecord[]; batches: BatchRecord[] } {
  const sheets = state.billingSheets || [];
  const sheetOfJob = new Map<string, BillingSheet>();
  for (const sheet of sheets) for (const id of sheet.jobIds) if (!sheetOfJob.has(id)) sheetOfJob.set(id, sheet);
  const lifecycle = new Map(sheets.map((sheet) => [sheet.id, sheetLifecycle(state, sheet)]));
  const summaries = new Map(sheets.map((sheet) => [sheet.id, sheetSummary(state, sheet)]));

  const toRecord = (job: Booking): WorkOrderRecord => {
    const sheet = sheetOfJob.get(job.id) ?? null;
    const totals = sheet ? sheetRowTotals(state, sheet, job.id) : null;
    const summary = sheet ? summaries.get(sheet.id)! : null;
    const extras = totals?.extrasSatang ?? (Object.fromEntries(SHEET_EXTRA_KINDS.map((kind) => [kind, null])) as Record<AdminReceiptKind, number | null>);
    return {
      jobId: job.id,
      workOrder: confirmedWorkOrder(job),
      customerJobNumber: customerJobReference(job),
      date: job.date,
      clientId: job.clientId,
      client: job.client,
      pickup: job.pickup,
      delivery: job.delivery,
      vehicle: displayVehicle(job.vehicle),
      driver: job.driver,
      sheetId: sheet?.id ?? null,
      position: totals && totals.position > 0 ? totals.position : null,
      trn: sheet ? sheetTrnLabel(sheet) : null,
      trnSimulated: !!sheet?.simulatedTrn,
      trnKind: sheet ? trnKindOf(sheet) : null,
      draftReference: sheet?.draftReference ?? null,
      billingPeriod: summary ? formatPeriod(summary.periodStart, summary.periodEnd, "doc") : null,
      transportSatang: totals?.transportSatang ?? null,
      parkingSatang: extras.parking,
      tollSatang: extras.toll,
      otherSatang: sumOrNull(OTHER_CHARGE_KINDS.map((kind) => extras[kind])),
      extrasSatang: extras,
      totalSatang: totals?.totalSatang ?? null,
      status: sheet ? lifecycle.get(sheet.id)! : "not_batched",
      flagged: !!job.financeCheck || job.status === "discrepancy" || job.status === "needs_recheck",
      missingPrice: !!totals && totals.missingTransport
    };
  };

  const recordByJob = new Map<string, WorkOrderRecord>();
  const workOrders: WorkOrderRecord[] = [];
  for (const job of state.bookings) {
    if (!job.workOrderConfirmed || !confirmedWorkOrder(job)) continue;
    const record = toRecord(job);
    recordByJob.set(job.id, record);
    workOrders.push(record);
  }

  const batches: BatchRecord[] = sheets.map((sheet) => {
    const summary = summaries.get(sheet.id)!;
    const rows = sheet.jobIds.map((id) => recordByJob.get(id)).filter(Boolean) as WorkOrderRecord[];
    return {
      sheetId: sheet.id,
      trn: sheetTrnLabel(sheet),
      trnSimulated: !!sheet.simulatedTrn,
      trnKind: trnKindOf(sheet),
      draftReference: sheet.draftReference,
      clientId: sheet.clientId,
      client: sheet.client,
      periodStart: summary.periodStart,
      periodEnd: summary.periodEnd,
      billingPeriod: formatPeriod(summary.periodStart, summary.periodEnd, "doc"),
      workOrderCount: summary.jobCount,
      transportSatang: summary.transportSatang,
      parkingSatang: rows.reduce((sum, row) => sum + (row.parkingSatang ?? 0), 0),
      tollSatang: rows.reduce((sum, row) => sum + (row.tollSatang ?? 0), 0),
      otherSatang: rows.reduce((sum, row) => sum + (row.otherSatang ?? 0), 0),
      totalSatang: summary.totalSatang,
      missingPrices: summary.missingPrices,
      status: lifecycle.get(sheet.id)!,
      createdAt: sheet.createdAt,
      readyAt: sheet.readyForApprovalAt,
      workOrders: rows
    };
  });

  return { workOrders, batches };
}

// ───────────────────────── filtering ─────────────────────────

export type RecordFilters = {
  search: string;
  client: string;
  /** Inclusive, YYYY-MM-DD (Asia/Bangkok calendar date). */
  dateFrom: string;
  dateTo: string;
  vehicle: string;
  driver: string;
  /** YYYY-MM */
  month: string;
  status: "" | RecordStatus;
};
export const EMPTY_RECORD_FILTERS: RecordFilters = { search: "", client: "", dateFrom: "", dateTo: "", vehicle: "", driver: "", month: "", status: "" };

const norm = (value: string) => value.toLowerCase().replace(/\s+/g, " ").trim();
const tokens = (search: string) => norm(search).split(" ").filter(Boolean);

function workOrderText(record: WorkOrderRecord) {
  return norm([record.workOrder, record.customerJobNumber, record.client, record.driver, record.vehicle, record.pickup, record.delivery,
    record.trn ?? "", record.draftReference ?? "", record.billingPeriod ?? ""].join(" "));
}
function batchText(batch: BatchRecord) {
  return norm([batch.trn, batch.draftReference, batch.client, batch.billingPeriod].join(" "));
}

type MatchOptions = { ignoreSearch?: boolean; ignoreStatus?: boolean };
export function workOrderMatches(record: WorkOrderRecord, filters: RecordFilters, options: MatchOptions = {}) {
  if (filters.client && record.clientId !== filters.client) return false;
  if (filters.vehicle && record.vehicle !== filters.vehicle) return false;
  if (filters.driver && record.driver !== filters.driver) return false;
  if (filters.dateFrom && record.date < filters.dateFrom) return false;
  if (filters.dateTo && record.date > filters.dateTo) return false;
  if (filters.month && !record.date.startsWith(filters.month)) return false;
  if (!options.ignoreStatus && filters.status && record.status !== filters.status) return false;
  if (!options.ignoreSearch) {
    const haystack = workOrderText(record);
    if (!tokens(filters.search).every((token) => haystack.includes(token))) return false;
  }
  return true;
}

/** Work Orders view: one row per work order. An exact work-order match is listed first. */
export function filterWorkOrders(records: WorkOrderRecord[], filters: RecordFilters) {
  const matched = records.filter((record) => workOrderMatches(record, filters));
  const wanted = norm(filters.search);
  if (!wanted) return matched;
  const exact = (record: WorkOrderRecord) => (norm(record.workOrder) === wanted ? 0 : 1);
  return [...matched].sort((a, b) => exact(a) - exact(b));
}

export type BatchMatch = { batch: BatchRecord; matched: WorkOrderRecord[] };

/**
 * TRN Batches view: one row per batch. Date / vehicle / driver / customer / month conditions are met by the batch's
 * work orders (a batch is shown when any of its work orders is in range); text search matches the batch (TRN,
 * customer, period) or any of its work orders. `matched` are the work orders to show when the row is expanded.
 */
export function filterBatches(batches: BatchRecord[], filters: RecordFilters): BatchMatch[] {
  const out: BatchMatch[] = [];
  const searchTokens = tokens(filters.search);
  for (const batch of batches) {
    if (filters.status && batch.status !== filters.status) continue;
    if (filters.client && batch.clientId !== filters.client) continue;
    const inScope = batch.workOrders.filter((record) => workOrderMatches(record, filters, { ignoreSearch: true, ignoreStatus: true }));
    if (!inScope.length && (batch.workOrders.length || filters.dateFrom || filters.dateTo || filters.vehicle || filters.driver || filters.month)) continue;
    if (!searchTokens.length) { out.push({ batch, matched: inScope }); continue; }
    const text = batchText(batch);
    if (searchTokens.every((token) => text.includes(token))) { out.push({ batch, matched: inScope }); continue; }
    const hits = inScope.filter((record) => {
      const haystack = `${workOrderText(record)} ${text}`;
      return searchTokens.every((token) => haystack.includes(token));
    });
    if (hits.length) out.push({ batch, matched: hits });
  }
  return out;
}

// ───────────────────────── facets & summary ─────────────────────────

export function recordFacets(records: WorkOrderRecord[]) {
  const clients = new Map<string, string>();
  const vehicles = new Set<string>();
  const drivers = new Set<string>();
  const months = new Set<string>();
  for (const record of records) {
    clients.set(record.clientId, record.client);
    if (record.vehicle) vehicles.add(record.vehicle);
    if (record.driver) drivers.add(record.driver);
    if (/^\d{4}-\d{2}/.test(record.date)) months.add(record.date.slice(0, 7));
  }
  return {
    clients: [...clients.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
    vehicles: [...vehicles].sort(),
    drivers: [...drivers].sort((a, b) => a.localeCompare(b)),
    months: [...months].sort().reverse()
  };
}

export function monthLabel(month: string, language: "en" | "th") {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return month;
  return new Intl.DateTimeFormat(language === "th" ? "th-TH-u-ca-gregory" : "en-GB", { month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1)));
}

export type RecordsSummary = {
  workOrders: number;
  draftBatches: number;
  awaitingApproval: number;
  approvedBatches: number;
  issuedTrns: number;
  /** Only issued TRNs count as billed. */
  billedSatang: number;
  /** Everything else with a price — draft / review / approved-but-unissued. Never invoiced revenue. */
  draftValueSatang: number;
  needsAttention: number;
};

/** KPIs over the work orders currently shown (and the batches they belong to). Amounts are the matched work orders'. */
export function summarizeRecords(workOrders: WorkOrderRecord[], matches: BatchMatch[]): RecordsSummary {
  const summary: RecordsSummary = { workOrders: workOrders.length, draftBatches: 0, awaitingApproval: 0, approvedBatches: 0, issuedTrns: 0, billedSatang: 0, draftValueSatang: 0, needsAttention: 0 };
  for (const { batch } of matches) {
    if (batch.status === "draft" || batch.status === "needs_correction" || batch.status === "ready_for_review") summary.draftBatches += 1;
    else if (batch.status === "awaiting_approval") summary.awaitingApproval += 1;
    else if (batch.status === "approved") summary.approvedBatches += 1;
    else if (batch.status === "issued") summary.issuedTrns += 1;
  }
  for (const record of workOrders) {
    if (record.flagged || record.missingPrice) summary.needsAttention += 1;
    if (record.totalSatang === null) continue;
    if (record.status === "issued") summary.billedSatang += record.totalSatang;
    else summary.draftValueSatang += record.totalSatang;
  }
  return summary;
}

// ───────────────────────── activity history ─────────────────────────

/** Audit entries of one batch: its own events plus the intake / flag events of the work orders in it. */
export function batchActivity(state: State, sheet: BillingSheet): Audit[] {
  const labels = new Set([sheetTrnLabel(sheet), sheet.draftReference, ...(sheet.simulatedTrn ? [sheet.simulatedTrn] : [])]);
  const subjects = new Set<string>();
  for (const id of sheet.jobIds) {
    const job = state.bookings.find((item) => item.id === id);
    const wo = job ? confirmedWorkOrder(job) : "";
    if (wo) subjects.add(`WO ${wo}`);
  }
  return state.audit.filter((entry) => labels.has(entry.subject) || subjects.has(entry.subject)).sort((a, b) => a.step - b.step);
}

/** Audit entries of one work order: its own events plus batch events that name it. */
export function workOrderActivity(state: State, record: WorkOrderRecord): Audit[] {
  const own = `WO ${record.workOrder}`;
  const sheet = (state.billingSheets || []).find((item) => item.id === record.sheetId);
  const labels = new Set<string>(sheet ? [sheetTrnLabel(sheet), sheet.draftReference, ...(sheet.simulatedTrn ? [sheet.simulatedTrn] : [])] : []);
  return state.audit
    .filter((entry) => entry.subject === own || (labels.has(entry.subject) && (entry.detail.includes(own) || entry.action === "sheet_create" || entry.action === "sheet_mark_ready" || entry.action === "sheet_reopen")))
    .sort((a, b) => a.step - b.step);
}

// ───────────────────────── original booking + receipts (for the detail view) ─────────────────────────

export type WorkOrderDetail = {
  job: Booking;
  record: WorkOrderRecord;
  bookingReference: string;
  original: { date: string; pickupTime: string; pickup: string; delivery: string; driver: string; vehicle: string; customerJobNumber: string; notes: string };
  receipts: { kind: AdminReceiptKind; satang: number | null }[];
  billable: { kind: AdminReceiptKind; decision: "billed" | "not_billable" | "needs_decision" | "none"; satang: number | null; note: string }[];
  transport: { satang: number | null; source: "manual" | "schedule" | null; rateLabel: string; provenance: PricingProvenance | null; history: SheetPriceHistoryEntry[] };
  batch: BatchRecord | null;
};

export function workOrderDetail(state: State, jobId: string): WorkOrderDetail | null {
  const { workOrders, batches } = buildFinanceRecords(state);
  const record = workOrders.find((item) => item.jobId === jobId);
  const job = state.bookings.find((item) => item.id === jobId);
  if (!record || !job) return null;
  const sheet = (state.billingSheets || []).find((item) => item.id === record.sheetId) ?? null;
  const line = sheet?.lines[jobId];
  const source = job.diarySource;
  const toSatang = (amount: number | null | undefined) => (amount == null ? null : Math.round(amount * 100));
  const receipts = SHEET_EXTRA_KINDS.map((kind) => ({ kind, satang: toSatang(job.adminReceipts?.amounts[kind]) }));
  const billable = SHEET_EXTRA_KINDS.map((kind) => {
    const decision = line?.extras[kind];
    const recorded = receipts.find((item) => item.kind === kind)?.satang ?? null;
    if (decision?.decision === "bill") return { kind, decision: "billed" as const, satang: toSatang(decision.amount), note: decision.note || "" };
    if (decision?.decision === "not_billable") return { kind, decision: "not_billable" as const, satang: null, note: decision.note || "" };
    if (sheet && recorded !== null) return { kind, decision: "needs_decision" as const, satang: null, note: "" };
    return { kind, decision: "none" as const, satang: null, note: "" };
  });
  return {
    job,
    record,
    bookingReference: bookingReference(job),
    original: {
      date: source?.booking_date ?? job.date,
      pickupTime: source?.pickup_time ?? job.pickupTime,
      pickup: source?.pickup ?? job.pickup,
      delivery: source?.dropoff ?? job.delivery,
      driver: source?.driver ?? job.driver,
      vehicle: displayVehicle(source?.vehicle_registration || source?.vehicle || job.vehicle),
      customerJobNumber: source?.customer_job_number ?? "",
      notes: source?.notes ?? ""
    },
    receipts,
    billable,
    transport: { satang: record.transportSatang, source: line?.transport?.source ?? null, rateLabel: line?.transport?.rateLabel ?? "", provenance: line?.transport?.provenance ?? null, history: line?.priceHistory ?? [] },
    batch: batches.find((item) => item.sheetId === record.sheetId) ?? null
  };
}

export const ACTIVITY_VIEW_ACTIONS = new Set(["sheet_set_stage"]);

/** Asia/Bangkok calendar date of a saved timestamp (used for the batch "created" business date). */
export function recordBusinessDate(iso: string | null | undefined) {
  return iso ? bangkokDate(iso) : "";
}
