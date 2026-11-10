// Browser-memory-only EES Finance Centre demonstration. No remote writes or issuance.
import sourceFixture from "./finance-demo-source-data.json";
import customerRateSource from "../data/finance-customer-rates-v4.json";
import type { CustomerBillingProfile, CustomerProfileEvent } from "./finance-customer-profiles";

/** Local copy of profileRequiredGaps — kept inline so naive test loaders need no TS path resolver for this module graph. */
function profileRequiredGapsLocal(profile: CustomerBillingProfile): string[] {
  const gaps: string[] = [];
  const pendingish = (value: string | null | undefined) => !value || /pending|รอยืนยัน/i.test(value);
  if (!profile.legalNameTh.trim() || pendingish(profile.legalNameTh)) gaps.push("legalNameTh");
  if (!profile.billingAddressTh.trim() || pendingish(profile.billingAddressTh)) gaps.push("billingAddressTh");
  if (!profile.taxId.trim() || pendingish(profile.taxId) || profile.taxId.replace(/\D/g, "").length < 10) gaps.push("taxId");
  if (!profile.match.length) gaps.push("match");
  if (!profile.source.trim() || profile.source.length < 10) gaps.push("source");
  return gaps;
}
export type Role = "office" | "admin" | "management" | "finance" | "approver" | "super_admin";
export type DocKind = "green_order" | "parking" | "toll";
export type ExpenseKind = "driver_trip" | "toll" | "parking" | "overtime" | "container_pickup" | "overnight" | "other";
export type View = "overview" | "inbox" | "verification" | "management" | "expenses" | "billing" | "drafts" | "packs" | "reporting";
export type Status = "pending" | "missing_paperwork" | "discrepancy" | "needs_recheck" | "verified";
export type SourceFact = { sheet: string; row: number; historicalTrn: string; receiptRef: string; tripCharge: number | null; otherCharges: number | null; parkingFees: number | null; overtime: number | null; containerPickup: number | null; overnight: number | null; totalCollected: number; sequence: number | null };
export type CollectionRecord = { amount: number; source: "workbook"; confirmed: boolean };
export type BookingOrigin = "demo_workbook" | "fictional" | "booking_diary_local_test";
export type CustomerCharge = { adminReceiptKind?: AdminReceiptKind; category: "parking" | "toll" | "overtime" | "waiting" | "container_pickup" | "overnight" | "other"; amount: number; evidence: string };
export const ADMIN_RECEIPT_FIELDS = ["parking", "toll", "overtime", "container_pickup", "overnight", "other"] as const;
export type AdminReceiptKind = typeof ADMIN_RECEIPT_FIELDS[number];
export type AdminReceipts = { amounts: Record<AdminReceiptKind, number | null>; notes: string; customerJobNumber?: string | null; originalCustomerJobNumber?: string | null };
export function parseOptionalReceiptThb(value: string): number | null {
  const text = value.trim();
  if (!text) return null;
  if (!/^(?:0|[1-9]\d{0,8})(?:\.\d{1,2})?$/.test(text)) throw new Error("FINANCE_RECEIPT_AMOUNT_INVALID");
  const [whole, fraction = ""] = text.split(".");
  return (Number(whole) * 100 + Number(fraction.padEnd(2, "0"))) / 100;
}
export function validateAdminReceipts(receipts: AdminReceipts): AdminReceipts {
  if (!receipts || typeof receipts.notes !== "string" || receipts.notes.length > 4000) throw new Error("FINANCE_RECEIPT_AMOUNT_INVALID");
  const amounts = {} as AdminReceipts["amounts"];
  for (const kind of ADMIN_RECEIPT_FIELDS) {
    const amount = receipts.amounts?.[kind];
    if (amount !== null && (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0 || amount > 999999999.99 || Math.abs(amount * 100 - Math.round(amount * 100)) > 0.00001)) throw new Error("FINANCE_RECEIPT_AMOUNT_INVALID");
    amounts[kind] = amount;
  }
  if (receipts.customerJobNumber !== undefined && receipts.customerJobNumber !== null && typeof receipts.customerJobNumber !== "string") throw new Error("FINANCE_CUSTOMER_JOB_INVALID");
  return { amounts, notes: receipts.notes.trim(), ...(receipts.customerJobNumber !== undefined ? { customerJobNumber: receipts.customerJobNumber?.trim() || null } : {}) };
}
/** Internal references remain available for traceability, never as the operational job label. */
export function officeJobReference(value: string | null | undefined): string {
  return /^BK-/i.test((value || "").trim()) ? "" : (value || "").trim();
}
export type FuelEvidence = { jobDate: string; referenceDate: string; product: "Diesel B7"; priceThb: number; sourceUrl: string; evidence: string; recordedAt: string; method: "manual"; verified: true };
export type CustomerRateBand = { label: string; minSatang: number | null; maxSatang: number; amountThb: number; sourcePage: number };
export type CustomerRateRow = { id: string; pickup: string; delivery: string; vehicle: string; bands: CustomerRateBand[]; reviewFlags: string[] };
export type CustomerRateSchedule = { id: string; name: string; version: string; sourceFilename: string; sourceSha256: string; rules: string[]; reviewNotes?: string[]; rows: CustomerRateRow[] };
export const CUSTOMER_RATE_SCHEDULES = customerRateSource.schedules as CustomerRateSchedule[];
/** Owner-approved route matching for one rate mapping. A job matches only when its pickup, delivery and vehicle class all contain/equal what was approved. */
export type RateMatch = {
  pickup: string[]; delivery: string[]; vehicleClass: string[];
  /** Approved vehicle registrations (dashes/spaces ignored). Used when the diary does not record 4W / 6W: the owner states which plates are which class. */
  plates?: string[];
  /** How a "Fuel at 43" style column is read. "as_printed" (default) = fuel in (42.00, 43.00]; "floor_level" = fuel from 43.00 up to 43.99. Only the owner decides. */
  bandReading?: "as_printed" | "floor_level";
  note?: string;
};
export type RateMapping = {
  revokedAt?: string; revokedBy?: Role; revokeReason?: string; match?: RateMatch; id: string; scheduleId: string; sourceVersion: string; sourceSha256: string; rowId: string; clientId: string; contractReference: string; effectiveFrom: string; effectiveTo: string | null; reviewReason: string; confirmedAt: string; confirmedBy: Role;
  /** proposed = staff draft mapping (never prices jobs); approved / omitted = owner-confirmed and eligible for pricing. */
  reviewStatus?: "proposed" | "approved";
};
export type PricingSnapshot = { mapping: RateMapping; fuel: FuelEvidence; sourceFilename: string; sourcePage: number; bandLabel: string; suggestedThb: number; confirmedThb: number; overrideReason: string | null; confirmedAt: string; confirmedBy: Role };
export const DIESEL_B7_SOURCE_URL = "https://xn--42c6baaa9bl0b2fcebb3cztja2d.com/history";
export const DIESEL_B7_REGION = "Bangkok";
/**
 * Verified historical Diesel B7 reference (THB/L, Bangkok) for ONE calendar date. Append-only: a revised value
 * supersedes the earlier entry (kept for audit) and never reprices work already saved on a billing sheet.
 */
export type FuelReference = {
  id: string; date: string; product: "Diesel B7"; region: "Bangkok"; priceThb: number; sourceUrl: string;
  method: "manual" | "automatic"; evidence: string; retrievedAt: string; reviewer: Role;
  supersededAt: string | null; supersedeReason: string | null;
  /** proposed = entered but not yet confirmed against the source (never prices a job); verified = confirmed; disputed = challenged (never prices a job). Older saved entries have no status and count as verified. */
  status?: "proposed" | "verified" | "disputed"; verifiedBy?: Role | null; verifiedAt?: string | null; disputeReason?: string | null;
};
export const fuelStatusOf = (ref: FuelReference): "proposed" | "verified" | "disputed" => ref.status ?? "verified";
export type ResolvedFuel = { status?: "proposed" | "verified" | "disputed"; verifiedBy?: Role | null; verifiedAt?: string | null; priceThb: number; date: string; sourceUrl: string; evidence: string; method: "manual" | "automatic"; reviewer: Role | null; referenceId: string | null; recordedAt: string };
/** Everything needed to reconstruct why a transport charge was set. Saved on the sheet line; never recomputed. */
export type PricingProvenance = {
  jobDate: string; clientId: string; client: string; workOrder: string; route: string; vehicle: string;
  mappingId: string; contractReference: string; scheduleId: string; scheduleName: string; scheduleVersion: string; sourceSha256: string; sourceFilename: string; sourcePage: number; bandLabel: string;
  fuel: { referenceId: string | null; date: string; product: "Diesel B7"; region: "Bangkok"; priceThb: number; sourceUrl: string; method: "manual" | "automatic"; evidence: string; reviewer: Role | null };
  suggestedThb: number; appliedThb: number; overrideReason: string | null; decidedBy: Role; decidedAt: string;
};
export function exactCustomerRate(scheduleId: string, rowId: string, fuelPrice: number, reading: "as_printed" | "floor_level" = "as_printed") {
  if (!Number.isFinite(fuelPrice) || fuelPrice <= 0 || Math.abs(fuelPrice * 100 - Math.round(fuelPrice * 100)) > 0.00001) throw new Error("FINANCE_FUEL_INVALID");
  const schedule = CUSTOMER_RATE_SCHEDULES.find((item) => item.id === scheduleId);
  const row = schedule?.rows.find((item) => item.id === rowId);
  const satang = Math.round(fuelPrice * 100);
  let band = row?.bands.find((item) => (item.minSatang === null || satang >= item.minSatang) && satang <= item.maxSatang);
  if (reading === "floor_level" && row && row.bands.every((item) => /^(Up to|Fuel at) \d+$/.test(item.label))) {
    // Owner-approved alternative reading: the column label is the whole-baht level the price has reached (43.00–43.99 → "Fuel at 43").
    const level = Math.floor(satang / 100);
    band = row.bands.find((item, index) => (index === 0 ? level <= Number(item.label.split(" ").pop()) : Number(item.label.split(" ").pop()) === level));
  }
  if (!schedule || !row || !band) throw new Error("FINANCE_RATE_NOT_FOUND");
  return { schedule, row, band };
}
export function suggestCustomerRate(job: Booking, mapping: RateMapping, fuelOverride?: FuelEvidence) {
  const fuel = fuelOverride ?? job.fuelEvidence;
  if (!fuel || !fuel.verified || fuel.product !== "Diesel B7" || fuel.jobDate !== job.date || fuel.referenceDate !== job.date ||
      fuel.sourceUrl !== DIESEL_B7_SOURCE_URL || !fuel.evidence.trim() || mapping.clientId !== job.clientId || mapping.effectiveFrom > job.date ||
      (mapping.effectiveTo && mapping.effectiveTo < job.date)) throw new Error("FINANCE_RATE_EVIDENCE_REQUIRED");
  const result = exactCustomerRate(mapping.scheduleId, mapping.rowId, fuel.priceThb, mapping.match?.bandReading ?? "as_printed");
  if (mapping.sourceVersion !== result.schedule.version || mapping.sourceSha256 !== result.schedule.sourceSha256 ||
      (result.row.reviewFlags.length && mapping.reviewReason.trim().length < 10)) throw new Error("FINANCE_RATE_REVIEW_REQUIRED");
  return result;
}
export type IntakeCheck = { result: "matches" | "different"; note: string; at: string; by: Role };
export type Booking = { intakeCheck?: IntakeCheck; financeCheck?: { reason: string; at: string; by: Role }; fuelEvidence?: FuelEvidence; pricingSnapshot?: PricingSnapshot; collection?: CollectionRecord; adminReceipts?: AdminReceipts; customerCharges?: CustomerCharge[]; diarySource?: DiaryBookingSeed; handover?: { readyAt: string; receivedAt?: string; receivedBy?: Role }; id: string; clientId: string; client: string; date: string; pickupTime: string; pickup: string; delivery: string; jobNumber: string; workOrder: string; workOrderConfirmed: boolean; driver: string; vehicle: string; operationalStatus: "completed" | "source_unconfirmed"; origin?: BookingOrigin; source?: SourceFact; returned: { client?: string; jobNumber?: string; pickupTime?: string; date: string; pickup: string; delivery: string; driver: string; vehicle: string; workOrder: string }; status: Status; decision: string | null; expenses: { id: string; kind: ExpenseKind; amount: number; reference: string }[]; price: { amount: number; source: "list" | "manual" | "workbook" | "schedule"; label: string; reason: string | null; confirmed: boolean } | null };
export type Document = {
  id: string;
  kind: DocKind;
  title: string;
  suggestedJobId: string;
  matchedJobId: string | null;
  physicalRef: string;
  confirmedBy: Role | null;
  preview: string;
  attachmentFileName?: string | null;
  attachmentStoredName?: string | null;
  waivedBy?: Role | null;
  waiveReason?: string | null;
};
export type Batch = { id: string; clientId: string; week: string; jobIds: string[]; draft: boolean; approvedBy: Role | null; rejectedReason: string | null; packReady: boolean };
export type Audit = { step: number; at: string; actor: Role; subject: string; action: string; detail: string };
export type PaperStack = { id: string; clientId: string; week: string; jobIds: string[] };
/**
 * Finance desk billing sheet (local test). The paper position is the index in jobIds — it is only the order of the
 * physical green papers on the desk, never a work order, TRN or invoice number.
 */
export type SheetExtraDecision = { amount: number | null; decision: "bill" | "not_billable"; note?: string };
export type SheetTransport = { amount: number; source: "manual" | "schedule"; rateLabel?: string; mappingId?: string; fuelPriceThb?: number; suggestedThb?: number; overrideReason?: string; provenance?: PricingProvenance };
export type SheetPriceHistoryEntry = { transport: SheetTransport; replacedAt: string; replacedBy: Role; reason: string | null };
/** A work order taken off a draft batch. The original Booking Diary / green-paper record is untouched; the entered charges are kept here so it can be restored exactly. */
export type RemovedPaper = { jobId: string; index: number; line: SheetLine; removedAt: string; removedBy: Role; reason: string | null };
export type SheetLine = { transport: SheetTransport | null; extras: Partial<Record<AdminReceiptKind, SheetExtraDecision>>; /** Earlier transport decisions, kept for audit when a price is replaced. */ priceHistory?: SheetPriceHistoryEntry[] };
export type BillingSheetStage = "arrange" | "billing" | "documents";
export type BillingSheet = {
  id: string;
  /** Internal draft reference — stable for the life of the sheet; never an official TRN. */
  draftReference: string;
  /**
   * LOCAL TEST ONLY. Simulated TRN (TRN###/2026) allocated once when the batch is created, continuing the owner-stated
   * sequence (last issued TRN650/2026). Absent on batches created before this numbering existed — those keep their
   * draft reference. Never an official number and never evidence of one.
   */
  simulatedTrn?: string;
  clientId: string;
  client: string;
  /** Optional short name of this invoice group (e.g. "Sirtec"), shown beside its TRN. */
  label?: string;
  createdAt: string;
  updatedAt: string;
  stage: BillingSheetStage;
  jobIds: string[];
  lines: Record<string, SheetLine>;
  missingPapers: { workOrder: string; at: string }[];
  /** Work orders removed from this batch, restorable until reassigned. */
  removedPapers?: RemovedPaper[];
  readyForApprovalAt: string | null;
  /** Management / approver confirmation of customer billing figures. Never implies an issued tax invoice. */
  approvedAt?: string | null;
  approvedBy?: Role | null;
  approvalNote?: string | null;
  /** Always null in local testing — official TRNs are issued only by the finance-manager controlled process. */
  officialTrn: null;
};
export type State = {
  billingSheets?: BillingSheet[];
  billingSheetSeq?: number;
  /** High-water mark of simulated TRN numbers handed out (monotonic; never lowered). */
  simulatedTrnLast?: number;
  rateMappings?: RateMapping[];
  fuelReferences?: FuelReference[];
  paperStacks?: PaperStack[];
  /** Local workspace overrides / drafts of customer billing profiles (seed catalogue is not mutated). */
  customerProfiles?: CustomerBillingProfile[];
  customerProfileEvents?: CustomerProfileEvent[];
  mode: "fictional" | "source" | "owner_walkthrough";
  bookings: Booking[];
  documents: Document[];
  batches: Batch[];
  audit: Audit[];
};
export type DiaryBookingSeed = {
  id: string;
  booking_id?: string | null;
  client_id?: string | null;
  client_name?: string | null;
  booking_date: string;
  pickup_time?: string | null;
  pickup: string;
  dropoff: string;
  driver?: string | null;
  vehicle?: string | null;
  vehicle_registration?: string | null;
  job_order_number?: string | null;
  customer_job_number?: string | null;
  /** Optional Booking Diary fields for Finance picker preview only. */
  notes?: string | null;
  diary_status?: string | null;
  trailer_registration?: string | null;
};
export type ReturnedField = "client" | "jobNumber" | "pickupTime" | "date" | "pickup" | "delivery" | "driver" | "vehicle" | "workOrder";
export type FieldCompareStatus = "matched" | "mismatch" | "missing";

export type CustomerProfileDraftInput = {
  id?: string;
  match: string[];
  legalNameTh: string;
  legalNameEn: string | null;
  billingAddressTh: string;
  billingAddressEn: string | null;
  taxId: string;
  contact: string | null;
  signatureName: string | null;
  paymentTerms: string | null;
  withholdingNote: string | null;
  source: string;
  notes: string[];
  advancePaymentAllowed: boolean;
  deduction: CustomerBillingProfile["deduction"];
  effectiveFrom: string;
};

export type Action =
  | { type: "revoke_rate_mapping"; mappingId: string; reason: string }
  | { type: "confirm_rate_mapping"; scheduleId: string; rowId: string; clientId: string; contractReference: string; effectiveFrom: string; effectiveTo: string | null; reviewReason: string; match?: RateMatch }
  | { type: "propose_rate_mapping"; scheduleId: string; rowId: string; clientId: string; contractReference: string; effectiveFrom: string; effectiveTo: string | null; reviewReason: string; match?: RateMatch }
  | { type: "approve_proposed_rate_mapping"; mappingId: string }
  | { type: "upsert_customer_profile_draft"; profile: CustomerProfileDraftInput }
  | { type: "submit_customer_profile"; profileId: string; note?: string }
  | { type: "approve_customer_profile"; profileId: string; note?: string }
  | { type: "retire_customer_profile"; profileId: string; note: string }
  | { type: "confirm_fuel_reference"; jobId: string; referenceDate: string; priceThb: number; evidence: string; sourceUrl: string }
  | { type: "record_fuel_reference"; date: string; priceThb: number; evidence: string; sourceUrl: string; revisionReason?: string; proposed?: boolean }
  | { type: "verify_fuel_reference"; date: string }
  | { type: "dispute_fuel_reference"; date: string; reason: string }
  | { type: "sheet_apply_rate"; sheetId: string; jobId: string; mappingId: string; amountThb: number; overrideReason: string; routeVehicleConfirmed: boolean; confirmOverwrite: boolean }
  | { type: "confirm_scheduled_price"; jobId: string; mappingId: string; amountThb: number; overrideReason: string; routeVehicleConfirmed: boolean }
  | { type: "add_customer_charge"; jobId: string; charge: CustomerCharge }
  | { type: "ready_handover"; jobId: string }
  | { type: "receive_paper"; jobId: string }
  | { type: "create_paper_stack"; clientId: string; week: string }
  | { type: "allocate_paper_stack"; batchId: string; stackId: string }
  | { type: "add_stack_paper"; stackId: string; jobId: string }
  | { type: "remove_stack_paper"; stackId: string; jobId: string }
  | { type: "move_stack_paper"; stackId: string; jobId: string; direction: -1 | 1 }
  | { type: "add_document"; jobId: string; kind: DocKind }
  | { type: "confirm_document"; documentId: string; jobId: string; physicalRef: string }
  | { type: "waive_document"; jobId: string; kind: DocKind; reason: string }
  | { type: "verify_job"; jobId: string }
  | { type: "resolve_discrepancy"; jobId: string; reason: string }
  | { type: "add_expense"; jobId: string; kind: ExpenseKind; amount: number; reference: string }
  | { type: "set_price"; jobId: string; source: "list" | "manual"; amount: number; reason?: string }
  | { type: "confirm_source_amount"; jobId: string }
  | { type: "create_batch"; clientId: string; week: string }
  | { type: "allocate_job"; batchId: string; jobId: string }
  | { type: "move_job"; batchId: string; jobId: string; direction: -1 | 1 }
  | { type: "create_draft"; batchId: string }
  | { type: "approve_draft"; batchId: string }
  | { type: "reject_draft"; batchId: string; reason: string }
  | { type: "prepare_pack"; batchId: string }
  | { type: "set_returned_work_order"; jobId: string; workOrder: string }
  | { type: "set_returned_details"; jobId: string; fields: Partial<Record<Exclude<ReturnedField, "workOrder">, string>> }
  | { type: "set_document_attachment"; documentId: string; jobId: string; fileName: string; storedName: string }
  | { type: "sheet_create"; clientId: string; /** Start ANOTHER invoice group (TRN) for a customer that already has an open one. */ additional?: boolean; label?: string }
  | { type: "sheet_move_to_group"; fromSheetId: string; toSheetId: string; jobId: string; reason?: string }
  | { type: "sheet_set_label"; sheetId: string; label: string }
  | { type: "sheet_add_paper"; sheetId: string; workOrder: string }
  | { type: "sheet_note_missing"; sheetId: string; workOrder: string }
  | { type: "sheet_clear_missing"; sheetId: string; workOrder: string }
  | { type: "sheet_remove_paper"; sheetId: string; jobId: string; reason?: string }
  | { type: "sheet_restore_paper"; sheetId: string; jobId: string }
  | { type: "sheet_move_paper"; sheetId: string; jobId: string; toIndex: number }
  | { type: "sheet_set_transport"; sheetId: string; jobId: string; transport: SheetTransport | null }
  | { type: "sheet_reclassify_extra"; sheetId: string; jobId: string; from: AdminReceiptKind; to: AdminReceiptKind; note?: string }
  | { type: "sheet_set_extra"; sheetId: string; jobId: string; kind: AdminReceiptKind; value: SheetExtraDecision | null }
  | { type: "sheet_set_stage"; sheetId: string; stage: BillingSheetStage }
  | { type: "sheet_mark_ready"; sheetId: string }
  | { type: "sheet_approve"; sheetId: string; note?: string }
  | { type: "sheet_reject_approval"; sheetId: string; reason: string }
  | { type: "sheet_reopen"; sheetId: string; reason: string }
  | { type: "flag_needs_checking"; jobId: string; reason: string }
  | { type: "admin_save_intake"; jobId: string; workOrder: string; receipts: AdminReceipts; check: { result: IntakeCheck["result"]; note: string } | null };
export type NextActionKey = "enter_work_order" | "match_paperwork" | "verify" | "resolve" | "reverify" | "confirm_collection" | "set_price" | "allocate" | "review_draft" | "approve" | "prepare_pack" | "complete";
export type NextAction = { key: NextActionKey; role: Role; view: View };

export const WEEKS = ["2026-01-05", "2026-01-19", "2026-01-26", "2026-10-05", "2026-10-12"] as const;
export const SOURCE_WORKBOOK_SHA256 = sourceFixture.sha256;
export const SOURCE_ROWS = sourceFixture.rows;
export const PRICE_LISTS: Record<string, { name: string; amount: number }> = { sample_a: { name: "Sample A · Standard route", amount: 2400 }, sample_b: { name: "Sample B · Standard route", amount: 1950 } };
const booking = (id: string, clientId: string, client: string, date: string, pickupTime: string, pickup: string, delivery: string, jobNumber: string, driver: string, vehicle: string, returnedDelivery = delivery): Booking => ({ id, clientId, client, date, pickupTime, pickup, delivery, jobNumber, workOrder: "", workOrderConfirmed: false, driver, vehicle, operationalStatus: "completed", returned: { date, pickup, delivery: returnedDelivery, driver, vehicle, workOrder: "" }, status: "pending", decision: null, expenses: [], price: null });

export function bookingReference(job: Booking): string {
  const diary = job.jobNumber?.trim();
  if (diary) return diary;
  if (job.source) return `BK-WB-${job.source.row}`;
  if (job.id === "manual-mass-1") return "BK-TEST-MASS-001";
  return `BK-${job.id.toUpperCase().replace(/^SOURCE-/, "SRC-")}`;
}

export function confirmedWorkOrder(job: Booking): string {
  if (!job.workOrderConfirmed) return "";
  // Prefer the green-sheet value so diary provisional numbers stay visible for comparison.
  const returned = job.returned.workOrder.trim();
  if (returned.length > 0) return returned;
  const wo = job.workOrder.trim();
  return wo.length > 0 ? wo : "";
}

/**
 * Owner-approved, job-specific transport decisions. Keyed by the CANONICAL work-order identity (confirmedWorkOrder: the Admin green-sheet
 * value, else the diary number) plus the customer's route, never by display text. The owner must still click to apply one.
 * The imported rate tables are NOT altered: the table suggestion is kept beside the applied amount for audit.
 */
export const OWNER_TRANSPORT_DECISIONS = [
  { workOrder: '6144', routeKey: 'goodyear', amountThb: 3300, suggestedThb: 3350,
    reason: 'Owner-approved job-specific transport charge for WO 6144 (imported Goodyear row suggested THB 3,350)' }
] as const;
export function ownerTransportDecision(job: Booking): (typeof OWNER_TRANSPORT_DECISIONS)[number] | null {
  const wo = confirmedWorkOrder(job);
  if (!wo) return null;
  const route = `${job.pickup} ${job.delivery}`.toLowerCase();
  return OWNER_TRANSPORT_DECISIONS.find((item) => item.workOrder === wo && route.includes(item.routeKey)) ?? null;
}

export function displayJobLabel(job: Booking, awaitingGreenSheet = "Awaiting green sheet"): string {
  const wo = confirmedWorkOrder(job);
  if (job.diarySource) return wo ? `WO ${wo}` : `${job.client} · ${job.date} · ${awaitingGreenSheet}`;
  return wo ? `${bookingReference(job)} · WO ${wo}` : `${bookingReference(job)} · ${awaitingGreenSheet}`;
}

function confirmedWoKey(job: Booking | undefined): string | null {
  if (!job?.workOrderConfirmed) return null;
  const wo = confirmedWorkOrder(job);
  return wo.length > 0 ? wo : null;
}

function duplicateConfirmedWorkOrder(state: State, jobId: string, workOrder: string): boolean {
  const normalized = workOrder.trim();
  return state.bookings.some((item) => item.id !== jobId && confirmedWoKey(item) === normalized);
}

const HISTORICAL_WO_AUDIT = "Historical reconciliation: work order entered from completed green sheet / source workbook — not assigned at booking creation.";
export function createState(): State {
  const fictionalWorkOrders: Record<string, string> = {
    b1: "SIM-WO-1001", b2: "SIM-WO-1002", b3: "SIM-WO-1003", b4: "SIM-WO-1004", b5: "SIM-WO-1005", b6: "SIM-WO-1006", b7: "SIM-WO-1007", b8: "SIM-WO-1008", b9: "SIM-WO-1009", b10: "SIM-WO-1010",
    b11: "SIM-WO-1011", b12: "SIM-WO-1012", b13: "SIM-WO-1013", b14: "SIM-WO-1014", b15: "SIM-WO-1015", b16: "SIM-WO-1016", b17: "SIM-WO-1017", b18: "SIM-WO-1018", b19: "SIM-WO-1019", b20: "SIM-WO-1020"
  };
  const bookings = [
    booking("b1", "sample_a", "Sample Customer A", "2026-10-05", "08:30", "Example Depot", "North Warehouse", "SIM-JOB-601", "Demo Driver A", "DEMO-01"),
    booking("b2", "sample_a", "Sample Customer A", "2026-10-06", "10:00", "Example Depot", "East Port", "SIM-JOB-602", "Demo Driver B", "DEMO-02"),
    booking("b3", "sample_a", "Sample Customer A", "2026-10-07", "13:15", "South Warehouse", "Example Depot", "SIM-JOB-603", "Demo Driver C", "DEMO-03", "Other Depot"),
    booking("b4", "sample_a", "Sample Customer A", "2026-10-08", "07:45", "Example Depot", "West Yard", "SIM-JOB-604", "Demo Driver D", "DEMO-04"),
    booking("b5", "sample_b", "Sample Customer B", "2026-10-13", "09:20", "Example Depot", "Central Hub", "SIM-JOB-605", "Demo Driver E", "DEMO-05")
    ,booking("b6", "sample_a", "Sample Customer A", "2026-10-05", "11:00", "North Warehouse", "East Port", "SIM-JOB-606", "Demo Driver F", "DEMO-06")
    ,booking("b7", "sample_a", "Sample Customer A", "2026-10-06", "14:20", "Example Depot", "West Yard", "SIM-JOB-607", "Demo Driver G", "DEMO-07")
    ,booking("b8", "sample_a", "Sample Customer A", "2026-10-07", "09:00", "North Warehouse", "Central Hub", "SIM-JOB-608", "Demo Driver H", "DEMO-08")
    ,booking("b9", "sample_a", "Sample Customer A", "2026-10-08", "15:10", "Example Depot", "East Port", "SIM-JOB-609", "Demo Driver I", "DEMO-09", "West Yard")
    ,booking("b10", "sample_a", "Sample Customer A", "2026-10-09", "08:10", "South Warehouse", "North Warehouse", "SIM-JOB-610", "Demo Driver J", "DEMO-10")
    ,booking("b11", "sample_a", "Sample Customer A", "2026-10-09", "12:30", "Example Depot", "Central Hub", "SIM-JOB-611", "Demo Driver K", "DEMO-11")
    ,booking("b12", "sample_a", "Sample Customer A", "2026-10-10", "07:30", "West Yard", "East Port", "SIM-JOB-612", "Demo Driver L", "DEMO-12")
    ,booking("b13", "sample_b", "Sample Customer B", "2026-10-05", "10:30", "Example Depot", "North Warehouse", "SIM-JOB-613", "Demo Driver M", "DEMO-13")
    ,booking("b14", "sample_b", "Sample Customer B", "2026-10-06", "08:50", "South Warehouse", "West Yard", "SIM-JOB-614", "Demo Driver N", "DEMO-14")
    ,booking("b15", "sample_b", "Sample Customer B", "2026-10-08", "13:40", "Example Depot", "Central Hub", "SIM-JOB-615", "Demo Driver O", "DEMO-15")
    ,booking("b16", "sample_b", "Sample Customer B", "2026-10-10", "09:10", "East Port", "Example Depot", "SIM-JOB-616", "Demo Driver P", "DEMO-16")
    ,booking("b17", "sample_b", "Sample Customer B", "2026-10-12", "11:15", "North Warehouse", "West Yard", "SIM-JOB-617", "Demo Driver Q", "DEMO-17", "East Port")
    ,booking("b18", "sample_b", "Sample Customer B", "2026-10-14", "08:20", "Example Depot", "Central Hub", "SIM-JOB-618", "Demo Driver R", "DEMO-18")
    ,booking("b19", "sample_b", "Sample Customer B", "2026-10-15", "14:00", "East Port", "Example Depot", "SIM-JOB-619", "Demo Driver S", "DEMO-19")
    ,booking("b20", "sample_b", "Sample Customer B", "2026-10-16", "07:55", "Example Depot", "South Warehouse", "SIM-JOB-620", "Demo Driver T", "DEMO-20")
  ];
  const documents: Document[] = [];
  const add = (jobId: string, kind: DocKind, index = 1) => {
    const job = bookings.find((item) => item.id === jobId)!;
    const ref = bookingReference(job);
    documents.push({ id: `SIM-DOC-${jobId}-${kind}-${index}`, kind, title: `${ref} · ${kind.replace("_", " ")}${index > 1 ? ` ${index}` : ""}`, suggestedJobId: jobId, matchedJobId: null, physicalRef: "", confirmedBy: null, preview: `FICTIONAL ${kind.replace("_", " ").toUpperCase()} · ${ref}` });
  };
  for (const job of bookings.filter((item) => !["b2", "b7", "b12", "b18"].includes(item.id))) { add(job.id, "green_order"); add(job.id, "parking"); add(job.id, "toll"); }
  add("b1", "parking", 2); add("b2", "parking");
  let state: State = { mode: "fictional", bookings, documents, batches: [], audit: [] };
  // Three source-independent walkthrough examples start at distinct finance stages.
  for (const id of ["b10", "b14", "b19"]) {
    state = applyAction(state, { type: "set_returned_work_order", jobId: id, workOrder: fictionalWorkOrders[id] }, "office");
    for (const doc of state.documents.filter((item) => item.suggestedJobId === id)) state = applyAction(state, { type: "confirm_document", documentId: doc.id, jobId: id, physicalRef: `Demo cabinet / ${id}` }, "office");
    state = applyAction(state, { type: "verify_job", jobId: id }, "office");
  }
  state = applyAction(state, { type: "set_price", jobId: "b10", source: "list", amount: PRICE_LISTS.sample_a.amount }, "finance");
  state = applyAction(state, { type: "set_price", jobId: "b14", source: "list", amount: PRICE_LISTS.sample_b.amount }, "finance");
  return state;
}
export function createManualMassTestBooking(): Booking {
  const massRow = SOURCE_ROWS[0];
  return {
    id: "manual-mass-1",
    clientId: "source-mass",
    client: "Mass",
    date: massRow.date,
    pickupTime: "08:00",
    pickup: massRow.pickup,
    delivery: massRow.delivery,
    jobNumber: "BK-TEST-MASS-001",
    workOrder: "",
    workOrderConfirmed: false,
    driver: massRow.driver,
    vehicle: massRow.vehicle,
    operationalStatus: "completed",
    returned: { date: massRow.date, pickup: massRow.pickup, delivery: massRow.delivery, driver: massRow.driver, vehicle: massRow.vehicle, workOrder: "" },
    status: "pending",
    decision: null,
    expenses: [],
    price: null
  };
}

/** Map an original Booking Diary row into the in-memory Finance workspace (no DB writes). */
export function bookingFromDiaryEntry(entry: DiaryBookingSeed): Booking {
  const clientName = (entry.client_name || "").trim() || "Client not recorded";
  const clientId = (entry.client_id || "").trim() || `diary-client-${entry.id}`;
  const jobNumber = (entry.booking_id || "").trim();
  const vehicle = (entry.vehicle_registration || entry.vehicle || "").trim();
  const driver = (entry.driver || "").trim();
  const pickup = entry.pickup || "";
  const delivery = entry.dropoff || "";
  const date = entry.booking_date || "";
  const pickupTime = (entry.pickup_time || "").trim();
  // Diary may store a provisional job order; Finance still requires green-sheet confirmation.
  // Returned side stays empty until Admin enters the green paper — never auto-match.
  const provisionalWo = (entry.job_order_number || "").trim();
  return {
    id: entry.id,
    diarySource: { ...entry },
    clientId,
    client: clientName,
    date,
    pickupTime,
    pickup,
    delivery,
    jobNumber,
    workOrder: provisionalWo,
    workOrderConfirmed: false,
    driver,
    vehicle,
    operationalStatus: "source_unconfirmed",
    origin: "booking_diary_local_test",
    returned: { date: "", pickup: "", delivery: "", driver: "", vehicle: "", workOrder: "" },
    status: "pending",
    decision: null,
    expenses: [],
    price: null
  };
}

export function normalizeCompareText(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Shipment reference, separate from the internal booking ID and green-paper WO. */
export function customerJobReference(job: Booking): string {
  return job.adminReceipts?.customerJobNumber !== undefined ? job.adminReceipts.customerJobNumber || "" : job.diarySource?.customer_job_number || "";
}

export function customerJobNumberDiffers(job: Booking): boolean {
  const original = job.adminReceipts?.originalCustomerJobNumber ?? job.diarySource?.customer_job_number;
  return !!original?.trim() && original.trim() !== customerJobReference(job).trim();
}

/** Atomic local-test selection: failed work-order validation must not leave a linked job. */
export function linkDiaryWorkOrder(state: State, seed: DiaryBookingSeed, workOrder: string, actor: Role, receipts?: AdminReceipts, check?: { result: IntakeCheck["result"]; note: string } | null): State {
  if (actor !== "admin" && actor !== "super_admin") throw new Error("DEMO_ROLE_REQUIRED");
  if (state.bookings.some((job) => job.id === seed.id)) throw new Error("DEMO_BOOKING_ALREADY_LINKED");
  const checkedReceipts = receipts ? validateAdminReceipts(receipts) : undefined;
  const linked = upsertDiaryBooking(state, seed);
  const next = !workOrder.trim() && check?.result === "different" ? linked : applyAction(linked, {
    type: "set_returned_work_order", jobId: seed.id, workOrder
  }, actor);
  if (checkedReceipts) next.bookings.find((job) => job.id === seed.id)!.adminReceipts = {
    ...checkedReceipts,
    ...(seed.customer_job_number ? { originalCustomerJobNumber: seed.customer_job_number } : {}),
    ...(checkedReceipts.customerJobNumber === undefined && seed.customer_job_number ? { customerJobNumber: seed.customer_job_number } : {})
  };
  if (check) {
    const job = next.bookings.find((item) => item.id === seed.id)!;
    const detail = applyIntakeCheck(job, check, actor);
    next.audit.push({ step: next.audit.length + 1, at: new Date().toISOString(), actor, subject: `WO ${workOrder.trim()}`, action: "admin_intake_check", detail });
  }
  return next;
}

/**
 * One simple Admin check instead of field-by-field re-typing:
 * "matches" → office-checked (verified); "different" → flagged for management review (never blocks saving the WO).
 * A flag raised by intake can be withdrawn by Admin; any other discrepancy still needs a management decision.
 */
function applyIntakeCheck(job: Booking, check: { result: IntakeCheck["result"]; note: string }, actor: Role) {
  const at = new Date().toISOString();
  const note = (check.note || "").trim();
  if (check.result === "different") {
    if (note.length < 3) fail("FINANCE_INTAKE_NOTE_REQUIRED");
    job.intakeCheck = { result: "different", note, at, by: actor };
    job.status = "discrepancy";
    job.decision = null;
    return `Flagged for management review: ${note}`;
  }
  if (check.result !== "matches") fail("FINANCE_INTAKE_CHECK_INVALID");
  if (!confirmedWorkOrder(job) || [job.client, job.date, job.pickup, job.delivery, job.vehicle, job.driver].some(value => !value?.trim() || value.trim() === "—")) fail("FINANCE_INTAKE_INCOMPLETE");
  if (job.status === "discrepancy" && !job.decision && job.intakeCheck?.result !== "different") fail("FINANCE_MANAGEMENT_REVIEW_PENDING");
  const withdrew = job.status === "discrepancy";
  job.intakeCheck = { result: "matches", note: "", at, by: actor };
  job.status = "verified";
  job.financeCheck = undefined;
  return withdrew ? "Admin withdrew the intake flag: green paper matches booking" : "Admin confirmed green paper matches booking";
}

export function nextUnlinkedDiaryBookingId<T extends { id: string }>(
  rows: readonly T[],
  linkedIds: ReadonlySet<string>,
  currentId: string
) {
  const index = rows.findIndex((row) => row.id === currentId);
  const ordered = index < 0 ? rows : [...rows.slice(index + 1), ...rows.slice(0, index)];
  return ordered.find((row) => !linkedIds.has(row.id))?.id ?? null;
}

export function fieldCompareStatus(job: Booking, field: ReturnedField): FieldCompareStatus {
  if (field === "workOrder" && !job.workOrderConfirmed) return "missing";
  const left = field === "workOrder" ? job.workOrder : String(job[field] || "");
  const right = String(job.returned[field] || "");
  if (!right.trim()) return "missing";
  // Blank diary WO + entered green-sheet WO is expected confirmation, not a mismatch.
  if (field === "workOrder" && !left.trim() && right.trim()) return "matched";
  const normalize = field === "pickupTime" ? (value: string) => /^\d{2}:\d{2}$/.test(value) ? `${value}:00` : value : normalizeCompareText;
  return normalize(left) === normalize(right) ? "matched" : "mismatch";
}

export function returnedFieldsFor(job: Booking): ReturnedField[] {
  const fields: ReturnedField[] = ["date", "pickup", "delivery", "driver", "vehicle", "workOrder"];
  if (job.adminReceipts) {
    fields.push("client");
    if (officeJobReference(job.jobNumber)) fields.push("jobNumber");
    if (job.pickupTime) fields.push("pickupTime");
  }
  return fields;
}
export function missingReturnedFields(job: Booking): ReturnedField[] {
  return returnedFieldsFor(job).filter(
    (field) => fieldCompareStatus(job, field) === "missing"
  );
}

/** Upsert a live Booking Diary record into local Finance memory without replacing progress. */
export function upsertDiaryBooking(state: State, seed: DiaryBookingSeed): State {
  const incoming = bookingFromDiaryEntry(seed);
  const existing = state.bookings.find((item) => item.id === incoming.id);
  if (existing) {
    return {
      ...state,
      bookings: state.bookings.map((item) => {
        if (item.id !== incoming.id) return item;
        const sourceChanged = (["clientId", "date", "pickupTime", "pickup", "delivery", "jobNumber", "driver", "vehicle"] as const)
          .some((field) => item[field] !== incoming[field]) || (["notes", "diary_status", "trailer_registration", "vehicle", "customer_job_number"] as const).some((field) => item.diarySource?.[field] !== seed[field]);
        return {
          ...item,
          clientId: incoming.clientId,
          client: incoming.client,
          date: incoming.date,
          pickupTime: incoming.pickupTime,
          pickup: incoming.pickup,
          delivery: incoming.delivery,
          jobNumber: incoming.jobNumber,
          driver: incoming.driver,
          vehicle: incoming.vehicle,
          origin: "booking_diary_local_test",
          diarySource: { ...seed },
          status: sourceChanged && item.status === "verified" ? "needs_recheck" : item.status,
          decision: sourceChanged ? null : item.decision,
          handover: sourceChanged ? undefined : item.handover,
          price: sourceChanged && item.price ? { ...item.price, confirmed: false } : item.price,
          // Never overwrite confirmed Finance WO / verification progress or office-entered paper values.
          workOrder: item.workOrderConfirmed ? item.workOrder : (incoming.workOrder || item.workOrder),
          returned: item.returned
        };
      })
    };
  }
  const ref = bookingReference(incoming);
  // Owner walkthrough: do not fabricate unmatched paperwork rows — show Pending/Missing until Admin adds real matches.
  const documents = [...state.documents];
  if (state.mode !== "owner_walkthrough") {
    for (const kind of ["green_order", "parking", "toll"] as DocKind[]) {
      documents.unshift({
        id: `DIARY-DOC-${incoming.id}-${kind}`,
        kind,
        title: `Booking Diary · ${ref} · ${kind.replace("_", " ")}`,
        suggestedJobId: incoming.id,
        matchedJobId: null,
        physicalRef: "",
        confirmedBy: null,
        preview: `ORIGINAL BOOKING DIARY · ${ref} · ${kind.replace("_", " ").toUpperCase()} · local finance memory only`
      });
    }
  }
  return {
    ...state,
    bookings: [incoming, ...state.bookings],
    documents,
    audit: [
      {
        step: state.audit.length + 1,
        at: new Date().toISOString(),
        actor: "office",
        subject: ref,
        action: "upsert_diary_booking",
        detail: "Original Booking Diary record linked into local Finance workspace (no database write)."
      },
      ...state.audit
    ]
  };
}

export function createSourceState(): State {
  const bookings: Booking[] = SOURCE_ROWS.map((row) => {
    const workOrder = row.workOrder;
    const returnedDelivery = row.row === 4 ? "DEMO alternate destination" : row.delivery;
    return {
      id: `source-r${row.row}`, clientId: `source-${row.client.toLowerCase().replaceAll(" ", "-")}`, client: row.client,
      date: row.date, pickupTime: "", pickup: row.pickup, delivery: row.delivery, jobNumber: row.jobNumber ?? "", workOrder, workOrderConfirmed: true,
      driver: row.driver, vehicle: row.vehicle, operationalStatus: "source_unconfirmed",
      source: { sheet: row.sheet, row: row.row, historicalTrn: row.historicalTrn, receiptRef: row.receiptRef, tripCharge: row.tripCharge, otherCharges: row.otherCharges, parkingFees: row.parkingFees, overtime: row.overtime, containerPickup: row.containerPickup, overnight: row.overnight, totalCollected: row.totalCollected, sequence: row.sequence },
      returned: { date: row.date, pickup: row.pickup, delivery: returnedDelivery, driver: row.driver, vehicle: row.vehicle, workOrder },
      status: "pending", decision: null, expenses: [],
      collection: { amount: row.totalCollected, source: "workbook", confirmed: false },
      price: null
    };
  });
  const documents: Document[] = [];
  for (const job of bookings) for (const kind of ["green_order", "parking", "toll"] as DocKind[]) {
    if (job.id === "source-r3" && kind === "toll") continue;
    const ref = bookingReference(job);
    const wo = confirmedWorkOrder(job);
    const id = `DEMO-DOC-${job.id}-${kind}`;
    documents.push({ id, kind, title: `DEMO · ${ref}${wo ? ` · WO ${wo}` : ""} · ${kind.replace("_", " ")}`, suggestedJobId: job.id, matchedJobId: null, physicalRef: "", confirmedBy: null, preview: `DEMO PAPERWORK · ${ref}${wo ? ` · WO ${wo}` : ""}` });
  }
  const historicalAudit: Audit[] = bookings.map((job, index) => ({
    step: index + 1,
    at: new Date(0).toISOString(),
    actor: "office" as Role,
    subject: bookingReference(job),
    action: "set_returned_work_order",
    detail: `${HISTORICAL_WO_AUDIT} WO ${job.workOrder}.`
  }));
  let state: State = { mode: "source", bookings, documents, batches: [], audit: historicalAudit };
  for (const id of ["source-r5", "source-r6", "source-r16"]) {
    for (const doc of state.documents.filter((item) => item.suggestedJobId === id)) state = applyAction(state, { type: "confirm_document", documentId: doc.id, jobId: id, physicalRef: `DEMO cabinet / ${doc.id}` }, "office");
    state = applyAction(state, { type: "verify_job", jobId: id }, "office");
    state = applyAction(state, { type: "confirm_source_amount", jobId: id }, "finance");
  }
  return state;
}

export function createSourceStateWithManualMass(): State {
  const manual = createManualMassTestBooking();
  let state = createSourceState();
  state = { ...state, bookings: [manual, ...state.bookings] };
  const ref = bookingReference(manual);
  for (const kind of ["green_order", "parking", "toll"] as DocKind[]) {
    state.documents.unshift({
      id: `DEMO-DOC-${manual.id}-${kind}`,
      kind,
      title: `SIMULATED LOCAL TEST · ${ref} · ${kind.replace("_", " ")}`,
      suggestedJobId: manual.id,
      matchedJobId: null,
      physicalRef: "",
      confirmedBy: null,
      preview: `MANUAL TEST BOOKING · ${ref} · ${kind.replace("_", " ").toUpperCase()} · isolated · no production`
    });
  }
  return state;
}

export function createFixtureInitialState(): State {
  if (typeof process !== "undefined" && process.env?.NEXT_PUBLIC_EES_FINANCE_MANUAL_TEST === "0") return createSourceState();
  return createSourceStateWithManualMass();
}

/** Empty owner walkthrough — Booking Diary links only; no seeded demo jobs. */
export function createEmptyOwnerState(): State {
  return { mode: "owner_walkthrough", bookings: [], documents: [], batches: [], audit: [] };
}
export function weekOf(date: string) { const stamp = Date.parse(`${date}T00:00:00Z`); if (!Number.isFinite(stamp)) return null; const day = new Date(stamp); day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7)); return day.toISOString().slice(0, 10); }
export function mismatches(job: Booking) {
  return returnedFieldsFor(job)
    .filter((field) => field !== "workOrder" || job.workOrderConfirmed)
    .filter((field) => fieldCompareStatus(job, field) === "mismatch");
}
export function docsFor(state: State, jobId: string) {
  return state.documents.filter((doc) => doc.matchedJobId === jobId || (doc.suggestedJobId === jobId && doc.waivedBy));
}
function documentSatisfied(state: State, jobId: string, kind: DocKind) {
  const verifier = state.mode === "owner_walkthrough" ? "admin" : "office";
  return state.documents.some(
    (doc) =>
      doc.kind === kind &&
      doc.suggestedJobId === jobId &&
      (((doc.confirmedBy === verifier || (state.mode === "owner_walkthrough" && doc.confirmedBy === "office")) &&
        doc.physicalRef.trim() && doc.matchedJobId === jobId) ||
        (!!doc.waivedBy && (doc.waiveReason || "").trim().length >= 3))
  );
}
export function requiredDocKinds(state: State, jobId?: string): DocKind[] {
  const job = state.bookings.find((item) => item.id === jobId);
  if (state.mode === "owner_walkthrough" && job?.adminReceipts) return ["green_order", ...(["parking", "toll"] as const).filter((kind) => (job.adminReceipts!.amounts[kind] ?? 0) > 0)];
  // Owner walkthrough from live Booking Diary: green order is mandatory; parking/toll may be waived.
  if (state.mode === "owner_walkthrough") return ["green_order", "parking", "toll"];
  return ["green_order", "parking", "toll"];
}
export function missingDocs(state: State, jobId: string): DocKind[] {
  return requiredDocKinds(state, jobId).filter((kind) => !documentSatisfied(state, jobId, kind));
}
export function ready(state: State, jobId: string) {
  const job = state.bookings.find((item) => item.id === jobId);
  return !!job && job.workOrderConfirmed && !!confirmedWorkOrder(job) && job.status === "verified" && missingDocs(state, jobId).length === 0;
}
export function expenseTotal(job: Booking) { return job.expenses.reduce((sum, item) => sum + Math.round(item.amount * 100), 0) / 100; }
export function customerTotal(job: Booking) { return (Math.round((job.price?.amount || 0) * 100) + (job.customerCharges || []).reduce((sum, item) => sum + Math.round(item.amount * 100), 0)) / 100; }
export function blockers(state: State, batch: Batch, jobId: string) {
  const job = state.bookings.find((item) => item.id === jobId);
  if (!job) return ["unknown_job"];
  const reasons: string[] = [];
  if (job.clientId !== batch.clientId) reasons.push("customer");
  if (weekOf(job.date) !== batch.week) reasons.push("week");
  if (!job.workOrderConfirmed || !confirmedWorkOrder(job)) reasons.push("verification");
  if (missingDocs(state, jobId).length) reasons.push("paperwork");
  if (!ready(state, jobId)) reasons.push("verification");
  if (!job.price?.confirmed) reasons.push("pricing");
  if (state.mode === "owner_walkthrough" && !job.handover?.receivedAt) reasons.push("paperwork");
  const wo = confirmedWoKey(job);
  if (wo && state.batches.some((other) => other.jobIds.some((id) => confirmedWoKey(state.bookings.find((item) => item.id === id)) === wo))) reasons.push("already_allocated");
  return reasons;
}
export function batchTotal(state: State, batch: Batch) { return batch.jobIds.reduce((sum, id) => { const job = state.bookings.find((item) => item.id === id); return sum + (job ? Math.round(customerTotal(job) * 100) : 0); }, 0) / 100; }
export function packManifest(state: State, batch: Batch) {
  return [{ key: "draft", jobId: null as string | null, kind: "draft", label: "Unnumbered draft TRN summary" }, ...batch.jobIds.flatMap((jobId) => {
    const job = state.bookings.find((item) => item.id === jobId)!;
    const wo = confirmedWorkOrder(job);
    const order: DocKind[] = ["green_order", "parking", "toll"];
    const docs = docsFor(state, jobId).sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
    return [{ key: `work-${jobId}`, jobId, kind: "work_order", label: `${bookingReference(job)} · WO ${wo} · returned job order` }, ...docs.map((doc) => ({ key: doc.id, jobId, kind: doc.kind, label: `${doc.title} · ${doc.id} · original ${doc.physicalRef}` }))];
  })];
}
export function hasFinalTrnNumber(_state: State) { return false; }
export function nextAction(state: State, jobId: string): NextAction {
  const job = state.bookings.find((item) => item.id === jobId);
  if (!job) throw new Error("DEMO_JOB_NOT_FOUND");
  const verifier: Role = state.mode === "owner_walkthrough" ? "admin" : "office";
  if (job.status === "discrepancy") return { key: "resolve", role: "management", view: "management" };
  if (!job.workOrderConfirmed || !confirmedWorkOrder(job)) return { key: "enter_work_order", role: verifier, view: "verification" };
  if (missingDocs(state, jobId).length) return { key: "match_paperwork", role: verifier, view: "inbox" };
  if (job.status === "needs_recheck") return { key: "reverify", role: verifier, view: "verification" };
  if (job.status !== "verified") return { key: "verify", role: verifier, view: "verification" };
  if (job.source && !job.collection?.confirmed) return { key: "confirm_collection", role: "finance", view: "expenses" };
  if (!job.price?.confirmed || job.price.source === "workbook") return { key: "set_price", role: "finance", view: "expenses" };
  const batch = state.batches.find((item) => item.jobIds.includes(jobId));
  if (!batch) return { key: "allocate", role: "finance", view: "billing" };
  if (!batch.draft) return { key: "review_draft", role: "finance", view: "billing" };
  if (!batch.approvedBy) return { key: "approve", role: "approver", view: "drafts" };
  if (!batch.packReady) return { key: "prepare_pack", role: "finance", view: "packs" };
  return { key: "complete", role: "finance", view: "reporting" };
}
export function batchIssues(state: State, batch: Batch): string[] {
  const issues: string[] = [];
  if (!batch.jobIds.length) issues.push("empty");
  if (new Set(batch.jobIds).size !== batch.jobIds.length) issues.push("duplicate");
  const workOrders = batch.jobIds.map((id) => confirmedWoKey(state.bookings.find((item) => item.id === id))).filter(Boolean);
  if (new Set(workOrders).size !== workOrders.length) issues.push("duplicate");
  for (const id of batch.jobIds) {
    const job = state.bookings.find((item) => item.id === id);
    if (!job || job.clientId !== batch.clientId || weekOf(job.date) !== batch.week) issues.push("customer_week");
    if (!ready(state, id)) issues.push("verification");
    if (!job?.price?.confirmed) issues.push("pricing");
    if (state.mode === "owner_walkthrough" && !job?.handover?.receivedAt) issues.push("paperwork");
    const wo = confirmedWoKey(job);
    if (wo && state.batches.some((other) => other.id !== batch.id && other.jobIds.some((otherId) => confirmedWoKey(state.bookings.find((item) => item.id === otherId)) === wo))) issues.push("duplicate");
  }
  return [...new Set(issues)];
}

// Prepared only from the same role-gated actions used by the interactive walkthrough.
export function createFictionalCompletedScenario(): State {
  let state = createState();
  const fictionalWorkOrders: Record<string, string> = { b1: "SIM-WO-1001", b3: "SIM-WO-1003" };
  for (const id of ["b1", "b3"]) {
    state = applyAction(state, { type: "set_returned_work_order", jobId: id, workOrder: fictionalWorkOrders[id] }, "office");
    for (const doc of state.documents.filter((item) => item.suggestedJobId === id)) state = applyAction(state, { type: "confirm_document", documentId: doc.id, jobId: id, physicalRef: `Demo cabinet / ${doc.id}` }, "office");
    state = applyAction(state, { type: "verify_job", jobId: id }, "office");
  }
  state = applyAction(state, { type: "resolve_discrepancy", jobId: "b3", reason: "Fictional management decision: original destination confirmed with dispatch" }, "management");
  state = applyAction(state, { type: "verify_job", jobId: "b3" }, "office");
  state = applyAction(state, { type: "add_expense", jobId: "b1", kind: "driver_trip", amount: 520, reference: "SIM-PAY-001" }, "finance");
  state = applyAction(state, { type: "add_expense", jobId: "b1", kind: "toll", amount: 75, reference: "SIM-TOLL-001" }, "finance");
  state = applyAction(state, { type: "set_price", jobId: "b1", source: "list", amount: PRICE_LISTS.sample_a.amount }, "finance");
  state = applyAction(state, { type: "set_price", jobId: "b3", source: "manual", amount: 2700, reason: "Fictional special route rate for demonstration" }, "finance");
  state = applyAction(state, { type: "create_batch", clientId: "sample_a", week: "2026-10-05" }, "finance");
  for (const id of ["b10", "b3", "b1"]) state = applyAction(state, { type: "allocate_job", batchId: "SIM-BATCH-1", jobId: id }, "finance");
  state = applyAction(state, { type: "move_job", batchId: "SIM-BATCH-1", jobId: "b1", direction: -1 }, "finance");
  state = applyAction(state, { type: "create_draft", batchId: "SIM-BATCH-1" }, "finance");
  state = applyAction(state, { type: "approve_draft", batchId: "SIM-BATCH-1" }, "approver");
  return applyAction(state, { type: "prepare_pack", batchId: "SIM-BATCH-1" }, "finance");
}
export function createCompletedScenario(): State {
  let state = createSourceState();
  for (const id of ["source-r2", "source-r3", "source-r4"]) {
    if (id === "source-r3") state = applyAction(state, { type: "add_document", jobId: id, kind: "toll" }, "office");
    for (const doc of state.documents.filter((item) => item.suggestedJobId === id)) state = applyAction(state, { type: "confirm_document", documentId: doc.id, jobId: id, physicalRef: `DEMO cabinet / ${doc.id}` }, "office");
    state = applyAction(state, { type: "verify_job", jobId: id }, "office");
  }
  state = applyAction(state, { type: "resolve_discrepancy", jobId: "source-r4", reason: "DEMO management decision: confirm workbook destination before recheck" }, "management");
  state = applyAction(state, { type: "verify_job", jobId: "source-r4" }, "office");
  for (const id of ["source-r2", "source-r3", "source-r4"]) state = applyAction(state, { type: "confirm_source_amount", jobId: id }, "finance");
  // Source cell I2 is a recorded trip charge. Treating it as an internal expense here is a DEMO classification.
  state = applyAction(state, { type: "add_expense", jobId: "source-r2", kind: "driver_trip", amount: 200, reference: "DEMO classification from Sheet1!I2" }, "finance");
  return state;
}

const owner: Record<Action["type"], Role> = {
  add_document: "admin",
  confirm_rate_mapping: "approver",
  propose_rate_mapping: "finance",
  approve_proposed_rate_mapping: "approver",
  upsert_customer_profile_draft: "admin",
  submit_customer_profile: "admin",
  approve_customer_profile: "approver",
  retire_customer_profile: "approver",
  revoke_rate_mapping: "approver",
  confirm_fuel_reference: "finance",
  record_fuel_reference: "finance",
  verify_fuel_reference: "finance",
  dispute_fuel_reference: "finance",
  sheet_apply_rate: "finance",
  confirm_scheduled_price: "finance",
  add_customer_charge: "finance",
  ready_handover: "admin",
  receive_paper: "finance",
  create_paper_stack: "finance",
  allocate_paper_stack: "finance",
  add_stack_paper: "finance",
  remove_stack_paper: "finance",
  move_stack_paper: "finance",
  confirm_document: "admin",
  waive_document: "admin",
  verify_job: "admin",
  resolve_discrepancy: "management",
  add_expense: "admin",
  set_price: "finance",
  confirm_source_amount: "finance",
  create_batch: "finance",
  allocate_job: "finance",
  move_job: "finance",
  create_draft: "finance",
  approve_draft: "approver",
  reject_draft: "approver",
  prepare_pack: "finance",
  set_returned_work_order: "admin",
  set_returned_details: "admin",
  set_document_attachment: "admin",
  sheet_create: "finance",
  sheet_move_to_group: "finance",
  sheet_set_label: "finance",
  sheet_add_paper: "finance",
  sheet_note_missing: "finance",
  sheet_clear_missing: "finance",
  sheet_remove_paper: "finance",
  sheet_restore_paper: "finance",
  sheet_move_paper: "finance",
  sheet_set_transport: "finance",
  sheet_set_extra: "finance",
  sheet_reclassify_extra: "finance",
  sheet_set_stage: "finance",
  sheet_mark_ready: "finance",
  sheet_approve: "approver",
  sheet_reject_approval: "approver",
  sheet_reopen: "finance",
  flag_needs_checking: "finance",
  admin_save_intake: "admin"
};
/** Finance-desk actions an authenticated Admin may also perform (recorded truthfully as "admin" in the audit). */
export const FINANCE_DESK_ACTIONS: ReadonlySet<Action["type"]> = new Set<Action["type"]>([
  "sheet_create", "sheet_move_to_group", "sheet_set_label", "sheet_add_paper", "sheet_note_missing", "sheet_clear_missing", "sheet_remove_paper", "sheet_restore_paper", "sheet_move_paper",
  "sheet_set_transport", "sheet_apply_rate", "record_fuel_reference", "verify_fuel_reference", "dispute_fuel_reference", "sheet_set_extra", "sheet_reclassify_extra", "sheet_set_stage", "sheet_mark_ready", "sheet_reopen", "flag_needs_checking",
  "propose_rate_mapping", "upsert_customer_profile_draft", "submit_customer_profile"
]);
function validRateMatch(match: RateMatch | undefined): boolean {
  if (match === undefined) return true;
  if (!match || !Array.isArray(match.pickup) || !Array.isArray(match.delivery) || !Array.isArray(match.vehicleClass)) return false;
  const okList = (list: string[]) => list.length <= 12 && list.every((item) => typeof item === "string" && item.trim().length >= 2 && item.length <= 60);
  if (!okList(match.pickup) || !okList(match.delivery) || match.vehicleClass.length > 4 || !match.vehicleClass.every((item) => ["4W", "6W", "40", "TRAILER"].includes(item))) return false;
  if (match.plates !== undefined && !okList(match.plates)) return false;
  if (match.bandReading !== undefined && match.bandReading !== "as_printed" && match.bandReading !== "floor_level") return false;
  return match.pickup.length + match.delivery.length + match.vehicleClass.length + (match.plates?.length ?? 0) > 0;
}
function fail(code: string): never { throw new Error(code); }
function assertActor(state: State, action: Action, actor: Role) {
  if (actor === "super_admin") return;
  // Local test only: the authenticated owner (Admin) may approve rate mappings / profiles without switching simulated roles.
  if ((action.type === "confirm_rate_mapping" || action.type === "approve_proposed_rate_mapping" || action.type === "revoke_rate_mapping" || action.type === "approve_customer_profile" || action.type === "retire_customer_profile") && actor === "admin") return;
  // Management approval of customer billing figures — never issuance. Admin / management / approver only.
  if (action.type === "sheet_approve" || action.type === "sheet_reject_approval") {
    if (actor !== "approver" && actor !== "management" && actor !== "admin") fail("DEMO_ROLE_REQUIRED");
    return;
  }
  if (FINANCE_DESK_ACTIONS.has(action.type)) {
    if (actor !== "finance" && actor !== "admin") fail("DEMO_ROLE_REQUIRED");
    return;
  }
  if (action.type === "add_expense") {
    if (actor !== "admin" && actor !== "finance" && !(state.mode !== "owner_walkthrough" && actor === "office")) fail("DEMO_ROLE_REQUIRED");
    return;
  }
  const legacyDemoOffice = state.mode !== "owner_walkthrough" && owner[action.type] === "admin" && actor === "office";
  if (owner[action.type] !== actor && !legacyDemoOffice) fail("DEMO_ROLE_REQUIRED");
}
/** Extra read-only context for actions. `siblingStates` = the other local workspace(s), so simulated TRN numbers stay unique across them. */
export type ApplyContext = { siblingStates?: readonly State[] };
export function applyAction(state: State, action: Action, actor: Role, context: ApplyContext = {}): State {
  assertActor(state, action, actor);
  const next: State = {
    ...state,
    billingSheets: (state.billingSheets || []).map(cloneSheet),
    rateMappings: [...(state.rateMappings || [])],
    fuelReferences: (state.fuelReferences || []).map((item) => ({ ...item })),
    customerProfiles: (state.customerProfiles || []).map((item) => ({ ...item, match: [...item.match], notes: [...item.notes], supportingDocuments: [...item.supportingDocuments], deduction: item.deduction ? { ...item.deduction } : null })),
    customerProfileEvents: [...(state.customerProfileEvents || [])],
    paperStacks: (state.paperStacks || []).map((stack) => ({ ...stack, jobIds: [...stack.jobIds] })),
    mode: state.mode,
    bookings: state.bookings.map((job) => ({ ...job, returned: { ...job.returned }, expenses: [...job.expenses], customerCharges: [...(job.customerCharges || [])], collection: job.collection ? { ...job.collection } : undefined, price: job.price ? { ...job.price } : null })),
    documents: state.documents.map((doc) => ({ ...doc })),
    batches: state.batches.map((batch) => ({ ...batch, jobIds: [...batch.jobIds] })),
    audit: [...state.audit]
  };
  const job = "jobId" in action ? next.bookings.find((item) => item.id === action.jobId) : undefined;
  const batch = "batchId" in action ? next.batches.find((item) => item.id === action.batchId) : undefined;
  if ("jobId" in action && !job) fail("DEMO_JOB_NOT_FOUND");
  if ("batchId" in action && !batch) fail("DEMO_BATCH_NOT_FOUND");
  if (job && next.batches.some((item) => item.draft && item.jobIds.includes(job.id)) &&
      ["set_returned_work_order", "set_returned_details", "add_expense", "add_document", "confirm_document", "waive_document", "set_document_attachment", "admin_save_intake"].includes(action.type)) fail("DEMO_DRAFT_FROZEN");
  let subject = job ? bookingReference(job) : batch?.id ?? "inbox";
  let detail = "";
  switch (action.type) {
    case "confirm_rate_mapping":
    case "propose_rate_mapping": {
      const schedule = CUSTOMER_RATE_SCHEDULES.find((item) => item.id === action.scheduleId);
      const row = schedule?.rows.find((item) => item.id === action.rowId);
      const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0,10) === value;
      const asProposed = action.type === "propose_rate_mapping";
      if (!schedule || !row || !next.bookings.some((item) => item.clientId === action.clientId) || !validDate(action.effectiveFrom) ||
          (action.effectiveTo && (!validDate(action.effectiveTo) || action.effectiveTo < action.effectiveFrom)) || action.contractReference.trim().length < 3 ||
          (row.reviewFlags.length && action.reviewReason.trim().length < 10) || !validRateMatch(action.match) || next.rateMappings!.some((item) => !item.revokedAt && (item.reviewStatus ?? "approved") === (asProposed ? "proposed" : "approved") && item.scheduleId === action.scheduleId &&
            item.rowId === action.rowId && item.clientId === action.clientId && item.sourceVersion === schedule.version && JSON.stringify(item.match ?? null) === JSON.stringify(action.match ?? null) &&
            item.effectiveFrom <= (action.effectiveTo || "9999-12-31") && action.effectiveFrom <= (item.effectiveTo || "9999-12-31"))) fail("FINANCE_RATE_MAPPING_GATE");
      const mapping: RateMapping = { id: `TEST-RATE-${next.audit.length + 1}`, scheduleId: schedule.id, rowId: row.id, clientId: action.clientId,
        sourceVersion: schedule.version, sourceSha256: schedule.sourceSha256, contractReference: action.contractReference.trim(),
        effectiveFrom: action.effectiveFrom, effectiveTo: action.effectiveTo, reviewReason: action.reviewReason.trim(), reviewStatus: asProposed ? "proposed" : "approved", ...(action.match ? { match: { pickup: action.match.pickup.map((x) => x.trim()), delivery: action.match.delivery.map((x) => x.trim()), vehicleClass: [...action.match.vehicleClass], ...(action.match.plates?.length ? { plates: action.match.plates.map((x) => x.trim()) } : {}), ...(action.match.bandReading ? { bandReading: action.match.bandReading } : {}), ...(action.match.note?.trim() ? { note: action.match.note.trim() } : {}) } } : {}), confirmedAt: new Date().toISOString(), confirmedBy: actor };
      next.rateMappings!.push(mapping); subject = mapping.id;
      detail = asProposed
        ? `PROPOSED rate mapping (does not price jobs until owner-approved): ${JSON.stringify(mapping)}`
        : `Local test rate mapping confirmation only: ${JSON.stringify(mapping)}`; break;
    }
    case "approve_proposed_rate_mapping": {
      const target = next.rateMappings!.find((item) => item.id === action.mappingId && !item.revokedAt);
      if (!target || (target.reviewStatus ?? "approved") !== "proposed") fail("FINANCE_RATE_MAPPING_GATE");
      if (next.rateMappings!.some((item) => !item.revokedAt && item.id !== target.id && (item.reviewStatus ?? "approved") === "approved" && item.scheduleId === target.scheduleId &&
          item.rowId === target.rowId && item.clientId === target.clientId && item.sourceVersion === target.sourceVersion && JSON.stringify(item.match ?? null) === JSON.stringify(target.match ?? null) &&
          item.effectiveFrom <= (target.effectiveTo || "9999-12-31") && target.effectiveFrom <= (item.effectiveTo || "9999-12-31"))) fail("FINANCE_RATE_MAPPING_GATE");
      target.reviewStatus = "approved";
      target.confirmedAt = new Date().toISOString();
      target.confirmedBy = actor;
      subject = target.id;
      detail = `Proposed rate mapping promoted to owner-approved: ${target.id}`; break;
    }
    case "upsert_customer_profile_draft": {
      const input = action.profile;
      const id = (input.id || `profile-${(input.match[0] || "customer").toLowerCase().replace(/[^a-z0-9ก-๙]+/g, "-")}`).trim();
      if (!id || !input.match.length || !input.source.trim() || input.source.trim().length < 10) fail("FINANCE_PROFILE_GATE");
      const list = (next.customerProfiles ||= []);
      const existing = list.find((item) => item.id === id);
      if (existing && existing.reviewStatus === "approved") fail("FINANCE_PROFILE_LOCKED");
      const nowIso = new Date().toISOString();
      const draft: CustomerBillingProfile = {
        id,
        version: existing ? existing.version + (existing.reviewStatus === "draft" ? 0 : 1) : 1,
        effectiveFrom: /^\d{4}-\d{2}-\d{2}$/.test(input.effectiveFrom) ? input.effectiveFrom : bangkokDate(nowIso),
        reviewStatus: "draft",
        source: input.source.trim(),
        match: input.match.map((m) => m.trim()).filter(Boolean),
        legalNameTh: input.legalNameTh.trim(),
        legalNameEn: input.legalNameEn?.trim() || null,
        billingAddressTh: input.billingAddressTh.trim(),
        billingAddressEn: input.billingAddressEn?.trim() || null,
        taxId: input.taxId.trim(),
        contact: input.contact?.trim() || null,
        invoiceTemplate: "ees-xls-invoice-v1",
        trnStatementTemplate: "ees-trn-statement-v1",
        signatureName: input.signatureName?.trim() || null,
        deduction: input.deduction ? { ...input.deduction, reviewStatus: "draft" } : null,
        advancePaymentAllowed: !!input.advancePaymentAllowed,
        parkingOvertime: "own_columns",
        fuelRateDisplay: "per_line",
        paymentTerms: input.paymentTerms?.trim() || null,
        supportingDocuments: existing?.supportingDocuments ? [...existing.supportingDocuments] : [],
        notes: [...(input.notes || [])],
        updatedBy: actor,
        updatedAt: nowIso,
        withholdingNote: input.withholdingNote?.trim() || null
      };
      if (existing) Object.assign(existing, draft);
      else list.push(draft);
      (next.customerProfileEvents ||= []).push({ id: `CPE-${(next.customerProfileEvents?.length || 0) + 1}`, profileId: id, at: nowIso, by: actor, action: "upsert_draft", fromStatus: existing?.reviewStatus ?? null, toStatus: "draft", note: "Local draft save — pending verification" });
      subject = id;
      detail = `Customer billing profile draft saved (${id}); remains unapproved until explicit owner confirmation.`; break;
    }
    case "submit_customer_profile": {
      const profile = (next.customerProfiles || []).find((item) => item.id === action.profileId);
      if (!profile || (profile.reviewStatus !== "draft" && profile.reviewStatus !== "pending_owner_approval")) fail("FINANCE_PROFILE_GATE");
      const gaps = profileRequiredGapsLocal(profile);
      if (gaps.length) fail(`FINANCE_PROFILE_INCOMPLETE:${gaps.join(",")}`);
      const from = profile.reviewStatus;
      profile.reviewStatus = "pending_owner_approval";
      if (profile.deduction) profile.deduction = { ...profile.deduction, reviewStatus: "pending_owner_approval" };
      profile.updatedBy = actor;
      profile.updatedAt = new Date().toISOString();
      (next.customerProfileEvents ||= []).push({ id: `CPE-${(next.customerProfileEvents?.length || 0) + 1}`, profileId: profile.id, at: profile.updatedAt, by: actor, action: "submit", fromStatus: from, toStatus: "pending_owner_approval", note: (action.note || "").trim() || "Submitted for owner approval" });
      subject = profile.id;
      detail = `Customer billing profile submitted for owner approval (${profile.id}).`; break;
    }
    case "approve_customer_profile": {
      const profile = (next.customerProfiles || []).find((item) => item.id === action.profileId);
      if (!profile || profile.reviewStatus !== "pending_owner_approval") fail("FINANCE_PROFILE_GATE");
      const gaps = profileRequiredGapsLocal(profile);
      if (gaps.length) fail(`FINANCE_PROFILE_INCOMPLETE:${gaps.join(",")}`);
      const from = profile.reviewStatus;
      profile.reviewStatus = "approved";
      if (profile.deduction) profile.deduction = { ...profile.deduction, reviewStatus: "approved" };
      profile.updatedBy = actor;
      profile.updatedAt = new Date().toISOString();
      (next.customerProfileEvents ||= []).push({ id: `CPE-${(next.customerProfileEvents?.length || 0) + 1}`, profileId: profile.id, at: profile.updatedAt, by: actor, action: "approve", fromStatus: from, toStatus: "approved", note: (action.note || "").trim() || "Owner-approved billing profile" });
      subject = profile.id;
      detail = `Customer billing profile APPROVED (${profile.id}). Historical invoice snapshots are not rewritten.`; break;
    }
    case "retire_customer_profile": {
      const profile = (next.customerProfiles || []).find((item) => item.id === action.profileId);
      if (!profile || action.note.trim().length < 5) fail("FINANCE_PROFILE_GATE");
      const from = profile.reviewStatus;
      profile.reviewStatus = "retired";
      profile.updatedBy = actor;
      profile.updatedAt = new Date().toISOString();
      (next.customerProfileEvents ||= []).push({ id: `CPE-${(next.customerProfileEvents?.length || 0) + 1}`, profileId: profile.id, at: profile.updatedAt, by: actor, action: "retire", fromStatus: from, toStatus: "retired", note: action.note.trim() });
      subject = profile.id;
      detail = `Customer billing profile retired (${profile.id}): ${action.note.trim()}`; break;
    }
    case "confirm_fuel_reference": {
      if (!ready(next, action.jobId) || (next.mode === "owner_walkthrough" && !job!.handover?.receivedAt) ||
          next.batches.some((item) => item.jobIds.includes(action.jobId)) || action.referenceDate !== job!.date ||
          action.sourceUrl !== DIESEL_B7_SOURCE_URL || action.evidence.trim().length < 10 ||
          parseOptionalReceiptThb(String(action.priceThb)) === null || action.priceThb <= 0) fail("FINANCE_FUEL_EVIDENCE_GATE");
      job!.fuelEvidence = { jobDate: job!.date, referenceDate: action.referenceDate, product: "Diesel B7", priceThb: action.priceThb,
        sourceUrl: action.sourceUrl, evidence: action.evidence.trim(), recordedAt: new Date().toISOString(), method: "manual", verified: true };
      if (job!.price) job!.price = { ...job!.price, confirmed: false };
      detail = `Local test manual Diesel B7 evidence confirmation: ${JSON.stringify(job!.fuelEvidence)}`; break;
    }
    case "revoke_rate_mapping": {
      const target = next.rateMappings!.find((item) => item.id === action.mappingId && !item.revokedAt);
      if (!target || action.reason.trim().length < 5) fail("FINANCE_RATE_MAPPING_GATE");
      next.rateMappings = next.rateMappings!.map((item) => item.id === action.mappingId ? { ...item, revokedAt: new Date().toISOString(), revokedBy: actor, revokeReason: action.reason.trim() } : item);
      subject = action.mappingId;
      detail = `Rate mapping withdrawn: ${action.reason.trim()}. Prices already applied to saved sheets are not changed.`; break;
    }
    case "verify_fuel_reference": {
      const ref = (next.fuelReferences || []).find((item) => item.date === action.date && !item.supersededAt);
      if (!ref || fuelStatusOf(ref) === "verified") fail("FINANCE_FUEL_EVIDENCE_GATE");
      ref!.status = "verified"; ref!.verifiedBy = actor; ref!.verifiedAt = new Date().toISOString(); ref!.disputeReason = null;
      subject = `Diesel B7 ${action.date}`;
      detail = `Diesel B7 THB ${ref!.priceThb.toFixed(2)}/L for ${action.date} VERIFIED against the source (evidence: ${ref!.evidence}). Prices already applied are not changed.`; break;
    }
    case "dispute_fuel_reference": {
      const ref = (next.fuelReferences || []).find((item) => item.date === action.date && !item.supersededAt);
      if (!ref || action.reason.trim().length < 10) fail("FINANCE_FUEL_EVIDENCE_GATE");
      const was = fuelStatusOf(ref!);
      ref!.status = "disputed"; ref!.disputeReason = action.reason.trim(); ref!.verifiedBy = null; ref!.verifiedAt = null;
      subject = `Diesel B7 ${action.date}`;
      detail = `Diesel B7 THB ${ref!.priceThb.toFixed(2)}/L for ${action.date} DISPUTED (was ${was}): ${action.reason.trim()}. It no longer prices new jobs; applied prices are not changed.`; break;
    }
    case "record_fuel_reference": {
      const validDate = /^\d{4}-\d{2}-\d{2}$/.test(action.date) && Number.isFinite(Date.parse(`${action.date}T00:00:00Z`)) && new Date(`${action.date}T00:00:00Z`).toISOString().slice(0, 10) === action.date;
      const today = bangkokDate(new Date().toISOString());
      if (!validDate || action.date > today || action.sourceUrl !== DIESEL_B7_SOURCE_URL || action.evidence.trim().length < 10 ||
          !Number.isFinite(action.priceThb) || action.priceThb <= 0 || action.priceThb >= 200 || Math.abs(action.priceThb * 100 - Math.round(action.priceThb * 100)) > 0.00001) fail("FINANCE_FUEL_EVIDENCE_GATE");
      const list = (next.fuelReferences ||= []);
      const active = list.find((item) => item.date === action.date && !item.supersededAt);
      const nowIso = new Date().toISOString();
      if (active) {
        if (toSatang(active.priceThb) === toSatang(action.priceThb)) fail("FINANCE_FUEL_DUPLICATE");
        if ((action.revisionReason || "").trim().length < 10) fail("FINANCE_FUEL_REVISION_REASON_REQUIRED");
        active.supersededAt = nowIso; active.supersedeReason = action.revisionReason!.trim();
      }
      list.push({ id: `FUEL-${action.date}-${list.filter((item) => item.date === action.date).length + 1}`, date: action.date, product: "Diesel B7", region: DIESEL_B7_REGION,
        priceThb: action.priceThb, sourceUrl: action.sourceUrl, method: "manual", evidence: action.evidence.trim(), retrievedAt: nowIso, reviewer: actor, supersededAt: null, supersedeReason: null,
        status: action.proposed ? "proposed" : "verified", verifiedBy: action.proposed ? null : actor, verifiedAt: action.proposed ? null : nowIso, disputeReason: null });
      subject = `Diesel B7 ${action.date}`;
      detail = `${action.proposed ? "PROPOSED (not yet verified) " : ""}Manual Diesel B7 (${DIESEL_B7_REGION}) reference THB ${action.priceThb.toFixed(2)}/L for ${action.date}; evidence: ${action.evidence.trim()}${active ? `; replaces THB ${active.priceThb.toFixed(2)} — ${active.supersedeReason}` : ""}. Saved sheets are not repriced.`; break;
    }
    case "confirm_scheduled_price": {
      const mapping = next.rateMappings!.find((item) => item.id === action.mappingId && !item.revokedAt);
      if (!mapping || !ready(next, action.jobId) || (next.mode === "owner_walkthrough" && !job!.handover?.receivedAt) ||
          next.batches.some((item) => item.jobIds.includes(action.jobId)) || !action.routeVehicleConfirmed ||
          parseOptionalReceiptThb(String(action.amountThb)) === null || action.amountThb <= 0) fail("FINANCE_PRICE_GATE");
      const result = suggestCustomerRate(job!, mapping);
      const override = action.amountThb !== result.band.amountThb;
      if (override && action.overrideReason.trim().length < 10) fail("DEMO_PRICE_REASON_REQUIRED");
      const previous = job!.price?.amount;
      job!.price = { amount: action.amountThb, source: "schedule", label: `${result.schedule.name} · ${result.row.pickup} → ${result.row.delivery} · ${result.row.vehicle} · ${result.band.label}`,
        reason: override ? action.overrideReason.trim() : null, confirmed: true };
      job!.pricingSnapshot = JSON.parse(JSON.stringify({ mapping, fuel: job!.fuelEvidence!, sourceFilename: result.schedule.sourceFilename,
        sourcePage: result.band.sourcePage, bandLabel: result.band.label, suggestedThb: result.band.amountThb, confirmedThb: action.amountThb,
        overrideReason: job!.price.reason, confirmedAt: new Date().toISOString(), confirmedBy: actor })) as PricingSnapshot;
      detail = `Local test price confirmation; previous ${previous ?? "unset"}; snapshot ${JSON.stringify(job!.pricingSnapshot)}`; break;
    }
    case "add_customer_charge": {
      const charge = action.charge;
      if (!ready(next, action.jobId) || !job!.price?.confirmed ||
          (next.mode === "owner_walkthrough" && !job!.handover?.receivedAt) ||
          next.batches.some((item) => item.jobIds.includes(action.jobId)) ||
          !["parking", "toll", "overtime", "waiting", "container_pickup", "overnight", "other"].includes(charge.category) ||
          !Number.isFinite(charge.amount) || charge.amount <= 0 || charge.amount > 1e9 ||
          Math.abs(charge.amount * 100 - Math.round(charge.amount * 100)) > 0.00001 ||
          charge.evidence.trim().length < 3 ||
          job!.customerCharges!.some((item) => normalizeCompareText(item.evidence) === normalizeCompareText(charge.evidence) || (charge.adminReceiptKind !== undefined && item.adminReceiptKind === charge.adminReceiptKind))) fail("FINANCE_CHARGE_GATE");
      if (charge.adminReceiptKind !== undefined && (!ADMIN_RECEIPT_FIELDS.includes(charge.adminReceiptKind) || job!.adminReceipts?.amounts[charge.adminReceiptKind] == null)) fail("FINANCE_CHARGE_GATE");
      job!.customerCharges!.push({ ...charge, evidence: charge.evidence.trim() });
      detail = `Local test customer ${charge.category} THB ${charge.amount.toFixed(2)}; evidence ${charge.evidence.trim()}`; break;
    }
    case "allocate_paper_stack": {
      const stack = next.paperStacks!.find((item) => item.id === action.stackId);
      if (!stack || !stack.jobIds.length || batch!.draft || batch!.jobIds.length ||
          stack.clientId !== batch!.clientId || stack.week !== batch!.week) fail("FINANCE_STACK_GATE");
      for (const id of stack.jobIds) {
        if (blockers(next, batch!, id).length || !next.bookings.find((item) => item.id === id)?.handover?.receivedAt) fail("FINANCE_STACK_GATE");
        batch!.jobIds.push(id);
      }
      detail = `Local test draft allocation follows saved physical sequence ${stack.id}`; break;
    }
    case "ready_handover":
      if (!ready(next, action.jobId) || job!.handover) fail("FINANCE_HANDOVER_GATE");
      job!.handover = { readyAt: new Date().toISOString() };
      detail = "Local test: office marked originals ready for physical handover"; break;
    case "receive_paper":
      if (!ready(next, action.jobId) || !job!.handover || job!.handover.receivedAt) fail("FINANCE_RECEIPT_GATE");
      job!.handover = { ...job!.handover, receivedAt: new Date().toISOString(), receivedBy: actor };
      detail = "Local test: Finance explicitly confirmed physical originals received"; break;
    case "create_paper_stack": {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(action.week) || weekOf(action.week) !== action.week ||
          !next.bookings.some((item) => item.clientId === action.clientId) ||
          next.paperStacks!.some((item) => item.clientId === action.clientId && item.week === action.week)) fail("FINANCE_STACK_GATE");
      const stack = { id: `TEST-STACK-${next.audit.length + 1}`, clientId: action.clientId, week: action.week, jobIds: [] };
      next.paperStacks!.push(stack); subject = stack.id; detail = "Local test customer paper arrangement created"; break;
    }
    case "add_stack_paper":
    case "remove_stack_paper":
    case "move_stack_paper": {
      const stack = next.paperStacks!.find((item) => item.id === action.stackId);
      if (!stack || stack.clientId !== job!.clientId || weekOf(job!.date) !== stack.week) fail("FINANCE_STACK_GATE");
      const index = stack.jobIds.indexOf(action.jobId);
      if (action.type === "add_stack_paper") {
        if (!ready(next, action.jobId) || !job!.handover?.receivedAt || index !== -1 ||
            next.paperStacks!.some((other) => other.jobIds.includes(action.jobId))) fail("FINANCE_STACK_GATE");
        stack.jobIds.push(action.jobId);
      } else if (action.type === "remove_stack_paper") {
        if (index < 0) fail("FINANCE_STACK_GATE");
        stack.jobIds.splice(index, 1);
      } else {
        const to = index + action.direction;
        if (index < 0 || to < 0 || to >= stack.jobIds.length) fail("FINANCE_STACK_GATE");
        [stack.jobIds[index], stack.jobIds[to]] = [stack.jobIds[to], stack.jobIds[index]];
      }
      detail = `Local test physical sequence updated in ${stack.id}`; break;
    }
    case "set_returned_work_order": {
      // Preserve exact formatting (e.g. 3628 vs 3628.1) — uniqueness is exact trimmed match.
      const workOrder = action.workOrder.trim();
      if (workOrder.length < 3) fail("DEMO_WO_REQUIRED");
      if (duplicateConfirmedWorkOrder(next, action.jobId, workOrder)) fail("DEMO_DUPLICATE_WO");
      if (job!.returned.workOrder !== workOrder && next.mode === "owner_walkthrough") {
        job!.decision = null; job!.handover = undefined;
        if (job!.price) job!.price = { ...job!.price, confirmed: false };
      }
      // Do not overwrite the Booking Diary provisional WO on the left; store paper value on returned.
      if (job!.origin !== "booking_diary_local_test") {
        job!.workOrder = workOrder;
      } else if (!job!.workOrder.trim()) {
        // Diary blank: keep left blank so office can see paper-only assignment.
      }
      job!.returned.workOrder = workOrder;
      job!.workOrderConfirmed = true;
      if (job!.status === "verified") job!.status = "needs_recheck";
      subject = bookingReference(job!);
      detail = `Green sheet work order ${workOrder} confirmed for ${subject}`;
      break;
    }
    case "set_returned_details": {
      const allowed = ["client", "jobNumber", "pickupTime", "date", "pickup", "delivery", "driver", "vehicle"] as const;
      let changed = 0;
      for (const field of allowed) {
        if (!(field in action.fields) || action.fields[field] === undefined) continue;
        if (job!.returned[field] !== String(action.fields[field] ?? "") && next.mode === "owner_walkthrough") {
          job!.decision = null; job!.handover = undefined;
          if (job!.price) job!.price = { ...job!.price, confirmed: false };
        }
        job!.returned[field] = String(action.fields[field] ?? "");
        changed += 1;
      }
      if (!changed) fail("DEMO_MATCH_REQUIRED");
      if (job!.status === "verified") job!.status = "needs_recheck";
      subject = bookingReference(job!);
      detail = `Returned green-sheet details updated (${changed} field(s)) — original Booking Diary unchanged`;
      break;
    }
    case "add_document": {
      const index = next.documents.filter((doc) => doc.suggestedJobId === action.jobId && doc.kind === action.kind).length + 1;
      const id = `SIM-DOC-${action.jobId}-${action.kind}-${index}`;
      const ref = bookingReference(job!);
      next.documents.push({ id, kind: action.kind, title: `DEMO · ${ref} · ${action.kind.replace("_", " ")} ${index}`, suggestedJobId: action.jobId, matchedJobId: null, physicalRef: "", confirmedBy: null, preview: `DEMO ${action.kind.replace("_", " ").toUpperCase()} · ${ref}` });
      detail = `DEMO document ${id} added to inbox`; break;
    }
    case "confirm_document": {
      const doc = next.documents.find((item) => item.id === action.documentId);
      if (!doc || doc.confirmedBy || doc.waivedBy || doc.suggestedJobId !== action.jobId || action.physicalRef.trim().length < 3) fail("DEMO_MATCH_REQUIRED");
      doc.matchedJobId = action.jobId; doc.confirmedBy = actor; doc.physicalRef = action.physicalRef.trim();
      doc.waivedBy = null; doc.waiveReason = null;
      subject = bookingReference(job!); detail = `${doc.title}; physical original ${doc.physicalRef}`; break;
    }
    case "waive_document": {
      if (action.kind === "green_order") fail("DEMO_MATCH_REQUIRED");
      const reason = action.reason.trim();
      if (reason.length < 3) fail("DEMO_MATCH_REQUIRED");
      let doc = next.documents.find((item) => item.suggestedJobId === action.jobId && item.kind === action.kind && !item.confirmedBy);
      if (!doc) {
        const index = next.documents.filter((item) => item.suggestedJobId === action.jobId && item.kind === action.kind).length + 1;
        const id = `SIM-DOC-${action.jobId}-${action.kind}-${index}`;
        const ref = bookingReference(job!);
        doc = {
          id,
          kind: action.kind,
          title: `N/A · ${ref} · ${action.kind.replace("_", " ")}`,
          suggestedJobId: action.jobId,
          matchedJobId: action.jobId,
          physicalRef: "",
          confirmedBy: null,
          preview: `NOT APPLICABLE · ${ref} · ${action.kind}`,
          waivedBy: null,
          waiveReason: null
        };
        next.documents.push(doc);
      }
      if (doc.confirmedBy) fail("DEMO_MATCH_REQUIRED");
      doc.waivedBy = actor;
      doc.waiveReason = reason;
      doc.matchedJobId = action.jobId;
      subject = bookingReference(job!);
      detail = `${action.kind} marked not applicable: ${reason}`;
      break;
    }
    case "verify_job": {
      if (!job!.workOrderConfirmed || !confirmedWorkOrder(job!)) fail("DEMO_WO_REQUIRED");
      if (job!.status === "verified" || job!.status === "discrepancy") fail("DEMO_VERIFICATION_HOLD");
      const missingReturned = missingReturnedFields(job!).filter((field) => field !== "workOrder");
      if (missingReturned.length) fail(`DEMO_RETURNED_REQUIRED:${missingReturned.join(",")}`);
      const missing = missingDocs(next, action.jobId);
      if (missing.length) { job!.status = "missing_paperwork"; detail = `Blocked: missing ${missing.join(", ")}`; }
      else if ((mismatches(job!).length || customerJobNumberDiffers(job!)) && !job!.decision) { job!.status = "discrepancy"; detail = `Escalated: ${[...mismatches(job!), ...(customerJobNumberDiffers(job!) ? ["Customer Job Number"] : [])].join(", ")}`; }
      else { job!.status = "verified"; job!.financeCheck = undefined; detail = job!.decision ? `DEMO reverified after management decision: ${job!.decision}` : next.mode === "source" ? "Workbook facts matched to DEMO returned order; live Booking Diary not checked" : next.mode === "owner_walkthrough" ? "Booking Diary and returned green order matched" : "DEMO diary and returned order matched"; }
      break;
    }
    case "resolve_discrepancy":
      if (job!.status !== "discrepancy" || action.reason.trim().length < 10) fail("DEMO_MANAGEMENT_HOLD");
      job!.decision = action.reason.trim(); job!.status = "needs_recheck"; detail = job!.decision; break;
    case "add_expense":
      // Admin records parking/toll during green-sheet matching once WO is confirmed — before pricing.
      // Management discrepancy / office recheck hold blocks further ledger changes until resolved.
      if (
        !job!.workOrderConfirmed ||
        !confirmedWorkOrder(job!) ||
        job!.status === "discrepancy" ||
        job!.status === "needs_recheck" ||
        !Number.isFinite(action.amount) ||
        action.amount <= 0 ||
        !action.reference.trim()
      ) {
        fail("DEMO_EXPENSE_GATE");
      }
      job!.expenses.push({ id: `SIM-EXP-${next.audit.length + 1}`, kind: action.kind, amount: action.amount, reference: action.reference.trim() });
      detail = `${action.kind} THB ${action.amount.toFixed(2)}; ${action.reference.trim()}`; break;
    case "admin_save_intake": {
      if (next.mode !== "owner_walkthrough" || job!.origin !== "booking_diary_local_test") fail("DEMO_ROLE_REQUIRED");
      if ((next.billingSheets || []).some((sheet) => (sheet.readyForApprovalAt || sheet.approvedAt || sheet.officialTrn) && sheet.jobIds.includes(job!.id))) fail("FINANCE_SHEET_LOCKED");
      const workOrder = action.workOrder.trim();
      const flagWithoutNumber = !workOrder && !confirmedWorkOrder(job!) && action.check?.result === "different";
      if (workOrder.length < 3 && !flagWithoutNumber) fail("DEMO_WO_REQUIRED");
      if (workOrder && duplicateConfirmedWorkOrder(next, job!.id, workOrder)) fail("DEMO_DUPLICATE_WO");
      const receipts = validateAdminReceipts(action.receipts);
      const changes: string[] = [];
      if (confirmedWorkOrder(job!) !== workOrder) {
        changes.push(`WO ${confirmedWorkOrder(job!) || "—"} → ${workOrder}`);
        job!.returned.workOrder = workOrder;
        job!.workOrderConfirmed = true;
        job!.handover = undefined;
        if (job!.status === "verified") job!.status = "needs_recheck";
      }
      const beforeReceipts = JSON.stringify(job!.adminReceipts || null);
      const original = job!.adminReceipts?.originalCustomerJobNumber ?? job!.diarySource?.customer_job_number ?? undefined;
      job!.adminReceipts = { ...receipts, ...(original ? { originalCustomerJobNumber: original } : {}) };
      const afterReceipts = JSON.stringify(job!.adminReceipts);
      if (beforeReceipts !== afterReceipts) {
        changes.push(`receipt evidence before ${beforeReceipts}; after ${afterReceipts}`);
        if (job!.status === "verified") job!.status = "needs_recheck";
      }
      if (action.check) changes.push(applyIntakeCheck(job!, action.check, actor));
      subject = `WO ${workOrder}`;
      detail = `Admin intake (Booking Diary unchanged): ${changes.join("; ")}`;
      break;
    }
    case "set_document_attachment": {
      const doc = next.documents.find((item) => item.id === action.documentId);
      if (!doc || doc.suggestedJobId !== action.jobId) fail("DEMO_MATCH_REQUIRED");
      const fileName = action.fileName.trim();
      const storedName = action.storedName.trim();
      if (!fileName || !storedName || storedName.includes("..") || storedName.includes("/") || storedName.includes("\\")) fail("DEMO_MATCH_REQUIRED");
      doc.attachmentFileName = fileName;
      doc.attachmentStoredName = storedName;
      doc.preview = `${doc.preview} · local test file ${fileName}`;
      subject = bookingReference(job!);
      detail = `Local test attachment ${fileName} linked to ${doc.id} (not a production document store)`;
      break;
    }
    case "set_price": {
      if (!ready(next, action.jobId) || next.batches.some((item) => item.jobIds.includes(action.jobId))) fail("DEMO_PRICE_GATE");
      if (next.mode === "owner_walkthrough" && !job!.handover?.receivedAt) fail("FINANCE_RECEIPT_GATE");
      const list = PRICE_LISTS[job!.clientId];
      if (!Number.isFinite(action.amount) || action.amount <= 0 || (action.source === "list" && (!list || action.amount !== list.amount)) || (action.source === "manual" && (action.reason?.trim().length ?? 0) < 10)) fail("DEMO_PRICE_REASON_REQUIRED");
      const previous = job!.price?.amount;
      job!.price = { amount: action.amount, source: action.source, label: action.source === "list" ? list.name : "Manual customer price", reason: action.source === "manual" ? action.reason!.trim() : null, confirmed: true };
      detail = `${job!.price.label}: THB ${action.amount.toFixed(2)}${previous === undefined ? "" : `; previous THB ${previous.toFixed(2)}`}${job!.price.reason ? `; reason ${job!.price.reason}` : ""}`; break;
    }
    case "confirm_source_amount":
      if (!ready(next, action.jobId) || !job!.source || !job!.collection || job!.collection.source !== "workbook" ||
          job!.collection.confirmed || job!.collection.amount !== job!.source.totalCollected) fail("DEMO_COLLECTION_GATE");
      job!.collection.confirmed = true;
      detail = `DEMO finance reconciliation of recorded historical collected amount ${job!.source.sheet}!O${job!.source.row}: THB ${job!.collection.amount.toFixed(2)}; not proof of payment`;
      break;
    case "create_batch":
      if (!next.bookings.some((item) => item.clientId === action.clientId && weekOf(item.date) === action.week) || next.batches.some((item) => item.clientId === action.clientId && item.week === action.week)) fail("DEMO_BATCH_GATE");
      subject = `SIM-BATCH-${next.batches.length + 1}`;
      next.batches.push({ id: subject, clientId: action.clientId, week: action.week, jobIds: [], draft: false, approvedBy: null, rejectedReason: null, packReady: false });
      detail = `${action.clientId} week ${action.week}`; break;
    case "allocate_job": {
      if (batch!.draft) fail("DEMO_DRAFT_FROZEN");
      const reasons = blockers(next, batch!, action.jobId);
      if (reasons.length) fail(`DEMO_ALLOCATION_BLOCKED:${reasons.join(",")}`);
      batch!.jobIds.push(action.jobId); detail = `Allocated ${displayJobLabel(job!)} in sequence ${batch!.jobIds.length}`; break;
    }
    case "move_job": {
      if (batch!.draft) fail("DEMO_DRAFT_FROZEN");
      const from = batch!.jobIds.indexOf(action.jobId), to = from + action.direction;
      if (from < 0 || to < 0 || to >= batch!.jobIds.length) fail("DEMO_ORDER_GATE");
      [batch!.jobIds[from], batch!.jobIds[to]] = [batch!.jobIds[to], batch!.jobIds[from]];
      detail = `Moved ${displayJobLabel(job!)} to sequence ${to + 1}`; break;
    }
    case "create_draft":
      if (batch!.draft || batchIssues(next, batch!).length) fail("DEMO_DRAFT_GATE");
      batch!.draft = true; detail = `Unnumbered draft; THB ${batchTotal(next, batch!).toFixed(2)}`; break;
    case "approve_draft":
      if (!batch!.draft || batch!.approvedBy || batchIssues(next, batch!).length) fail("DEMO_APPROVAL_GATE");
      batch!.rejectedReason = null; batch!.approvedBy = actor; detail = "Simulated approval only; no issuance or final TRN number"; break;
    case "reject_draft":
      if (!batch!.draft || batch!.approvedBy || action.reason.trim().length < 10) fail("DEMO_APPROVAL_GATE");
      batch!.draft = false; batch!.rejectedReason = action.reason.trim(); batch!.approvedBy = null;
      detail = `Draft rejected: ${batch!.rejectedReason}`; break;
    case "prepare_pack":
      if (!batch!.approvedBy || batch!.packReady || batchIssues(next, batch!).length) fail("DEMO_PACK_GATE");
      batch!.packReady = true; detail = `Prepared ${packManifest(next, batch!).length} ordered sample items`; break;
  }
  let skipAudit = false;
  if (action.type.startsWith("sheet_") || action.type === "flag_needs_checking") {
    const result = applySheetAction(next, action, actor, context);
    subject = result.subject; detail = result.detail; skipAudit = !!result.skipAudit;
  }
  if (!skipAudit) next.audit.push({ step: next.audit.length + 1, at: new Date().toISOString(), actor, subject, action: action.type, detail });
  return next;
}

export function dashboardMetrics(state: State) {
  const totalJobs = state.bookings.length;
  const readyForFinance = state.bookings.filter((item) => ready(state, item.id)).length;
  const missingPaperwork = state.bookings.filter((item) => missingDocs(state, item.id).length > 0).length;
  const managementHolds = state.bookings.filter((item) => item.status === "discrepancy").length;
  const awaitingPricing = state.bookings.filter((item) => item.status === "verified" && missingDocs(state, item.id).length === 0 && !item.price?.confirmed).length;
  const draftBatches = state.batches.filter((item) => item.draft).length;
  const awaitingApproval = state.batches.filter((item) => item.draft && !item.approvedBy).length;
  const approvedPacks = state.batches.filter((item) => !!item.approvedBy).length;
  const weeklyTotalsMap = new Map<string, { client: string; week: string; total: number }>();
  for (const item of state.bookings) {
    const week = weekOf(item.date);
    if (!week || !item.price?.confirmed) continue;
    const key = `${item.clientId}|${week}`;
    const row = weeklyTotalsMap.get(key) ?? { client: item.client, week, total: 0 };
    row.total += item.price.amount;
    weeklyTotalsMap.set(key, row);
  }
  const weeklyTotals = [...weeklyTotalsMap.values()].sort((a, b) => a.week.localeCompare(b.week) || a.client.localeCompare(b.client));
  const nextActions = state.bookings.flatMap((item) => {
    const step = nextAction(state, item.id);
    if (step.key === "complete") return [];
    return [{ jobId: item.id, bookingReference: bookingReference(item), workOrder: confirmedWorkOrder(item), displayLabel: displayJobLabel(item), client: item.client, key: step.key, role: step.role, view: step.view }];
  });
  return { totalJobs, readyForFinance, missingPaperwork, managementHolds, awaitingPricing, draftBatches, awaitingApproval, approvedPacks, weeklyTotals, nextActions };
}

// ───────────────────────── Finance desk billing sheets (local test) ─────────────────────────
// Arrange Work Orders → Customer Billing Sheet → TRN & Documents.
// All money is handled in satang integers. Blank never means an approved zero.

export const SHEET_EXTRA_KINDS = ADMIN_RECEIPT_FIELDS;
export const TRN_PATTERN = /^TRN(\d{3,})\/(\d{4})$/;

/**
 * ───── SIMULATED TRN NUMBERING — LOCAL FINANCE TEST ONLY — NOT AN OFFICIAL NUMBER ALLOCATOR ─────
 * The owner stated, for this local test exercise, that the last TRN EES issued is TRN650/2026. New local test billing
 * batches therefore continue that sequence (TRN651/2026, TRN652/2026, …) so documents look like the real convention.
 * - It is NOT verified against the authoritative issued-TRN register and must never be used as one.
 * - A real allocator needs verified history, authenticated approval and concurrency-safe allocation (database side).
 * - Documents carrying a simulated number are always marked DRAFT/TEST; `officialTrn` stays null.
 * - The allocation is disabled in production deployments (same boundary as the local Finance workspace).
 */
export const SIMULATED_TRN_SERIES = { year: 2026, lastIssued: 650 } as const;

/** Same boundary as the local Finance workspace: a production deployment never allocates simulated TRNs. */
export function simulatedTrnAllowed() {
  return process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_EES_FINANCE_LOCAL_WORKSPACE === "1";
}

export function formatSimulatedTrn(number: number) {
  return `TRN${String(number).padStart(3, "0")}/${SIMULATED_TRN_SERIES.year}`;
}

/** Number part of a simulated TRN of this series (TRN###/2026), else null. */
export function simulatedTrnNumber(value: string | null | undefined): number | null {
  const match = TRN_PATTERN.exec(String(value || "").trim());
  return match && Number(match[2]) === SIMULATED_TRN_SERIES.year ? Number(match[1]) : null;
}

/**
 * Next simulated number: strictly above the owner-stated last issued number, the stored high-water mark and every
 * simulated number already on any batch (this workspace and its siblings) — so a number is never handed out twice,
 * and never reused after a draft is removed (the high-water mark does not go down).
 */
export function nextSimulatedTrnNumber(state: State, siblingStates: readonly State[] = []) {
  let highest: number = SIMULATED_TRN_SERIES.lastIssued;
  for (const item of [state, ...siblingStates]) {
    if (Number.isSafeInteger(item.simulatedTrnLast) && item.simulatedTrnLast! > highest) highest = item.simulatedTrnLast!;
    for (const sheet of item.billingSheets || []) {
      const number = simulatedTrnNumber(sheet.simulatedTrn);
      if (number !== null && number > highest) highest = number;
    }
  }
  return highest + 1;
}

/** What the next new batch will be numbered (read-only — allocates nothing). */
export function peekNextSimulatedTrn(state: State, siblingStates: readonly State[] = []) {
  return formatSimulatedTrn(nextSimulatedTrnNumber(state, siblingStates));
}

/** The reference shown for a batch: its simulated TRN when it has one, otherwise its original draft reference. */
export function sheetTrnLabel(sheet: Pick<BillingSheet, "simulatedTrn" | "draftReference">) {
  return sheet.simulatedTrn || sheet.draftReference;
}

/** Safe file-name fragment for a batch reference (TRN651/2026 → TRN651-2026). */
export function sheetFileReference(sheet: Pick<BillingSheet, "simulatedTrn" | "draftReference">) {
  return sheetTrnLabel(sheet).replace(/[^A-Za-z0-9._-]+/g, "-");
}

function cloneSheet(sheet: BillingSheet): BillingSheet {
  return {
    ...sheet,
    jobIds: [...sheet.jobIds],
    missingPapers: sheet.missingPapers.map((item) => ({ ...item })),
    ...(sheet.removedPapers ? { removedPapers: sheet.removedPapers.map((item) => ({ ...item, line: JSON.parse(JSON.stringify(item.line)) as SheetLine })) } : {}),
    lines: Object.fromEntries(Object.entries(sheet.lines).map(([id, line]) => [id, {
      transport: line.transport ? { ...line.transport } : null,
      ...(line.priceHistory ? { priceHistory: line.priceHistory.map((entry) => ({ ...entry })) } : {}),
      extras: Object.fromEntries(Object.entries(line.extras).map(([kind, value]) => [kind, value ? { ...value } : value]))
    }]))
  };
}

const toSatang = (amount: number) => Math.round(amount * 100);
const fromSatang = (satang: number) => satang / 100;
function validThb(amount: number, allowZero: boolean) {
  return Number.isFinite(amount) && (allowZero ? amount >= 0 : amount > 0) && amount <= 999999999.99 &&
    Math.abs(amount * 100 - Math.round(amount * 100)) <= 0.00001;
}

/** Calendar date in Asia/Bangkok for a timestamp. */
export function bangkokDate(at: Date | string = new Date()) {
  const date = typeof at === "string" ? new Date(at) : at;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

export function normalizeWorkOrderInput(value: string) {
  return value.trim().replace(/^WO\s*[:#-]?\s*/i, "").trim();
}

/** Exact (trimmed) work-order match against Admin-confirmed green-paper numbers. */
export function findWorkOrder(state: State, workOrder: string): Booking | undefined {
  const wanted = normalizeWorkOrderInput(workOrder);
  if (!wanted) return undefined;
  return state.bookings.find((job) => job.workOrderConfirmed && confirmedWorkOrder(job) === wanted);
}

export type WorkOrderLookup =
  | { kind: "match"; job: Booking }
  | { kind: "empty" }
  | { kind: "not_found"; workOrder: string }
  | { kind: "ambiguous"; candidates: Booking[] }
  | { kind: "other_customer"; job: Booking }
  | { kind: "already_in_list"; job: Booking; position: number }
  | { kind: "in_other_sheet"; job: Booking; sheet: BillingSheet };

export function lookupWorkOrderForSheet(state: State, sheet: BillingSheet, workOrder: string): WorkOrderLookup {
  const wanted = normalizeWorkOrderInput(workOrder);
  if (!wanted) return { kind: "empty" };
  const candidates = state.bookings.filter(job => normalizeWorkOrderInput(confirmedWorkOrder(job)) === wanted);
  if (candidates.length > 1) return { kind: "ambiguous", candidates };
  const job = candidates[0];
  if (!job) return { kind: "not_found", workOrder: wanted };
  if (job.clientId !== sheet.clientId) return { kind: "other_customer", job };
  const position = sheet.jobIds.indexOf(job.id);
  if (position >= 0) return { kind: "already_in_list", job, position: position + 1 };
  const other = (state.billingSheets || []).find((item) => item.id !== sheet.id && item.jobIds.includes(job.id));
  if (other) return { kind: "in_other_sheet", job, sheet: other };
  return { kind: "match", job };
}

/** Customers that have at least one Admin-linked green-paper work order. */
export function sheetCustomers(state: State) {
  const map = new Map<string, { clientId: string; client: string; workOrders: number }>();
  for (const job of state.bookings) {
    if (!job.workOrderConfirmed || !confirmedWorkOrder(job)) continue;
    const row = map.get(job.clientId) ?? { clientId: job.clientId, client: job.client, workOrders: 0 };
    row.workOrders += 1;
    map.set(job.clientId, row);
  }
  return [...map.values()].sort((a, b) => a.client.localeCompare(b.client));
}

export function openSheetFor(state: State, clientId: string) {
  return (state.billingSheets || []).find((sheet) => sheet.clientId === clientId && !sheet.readyForApprovalAt);
}

export type ExtraStatus = "none" | "billed" | "not_billable" | "needs_decision";
export function extraStatus(job: Booking, line: SheetLine | undefined, kind: AdminReceiptKind): ExtraStatus {
  const decision = line?.extras[kind];
  if (decision?.decision === "bill" && decision.amount !== null) return "billed";
  if (decision?.decision === "not_billable") return "not_billable";
  return job.adminReceipts?.amounts[kind] != null ? "needs_decision" : "none";
}

export type SheetRowTotals = {
  jobId: string;
  position: number;
  transportSatang: number | null;
  extrasSatang: Record<AdminReceiptKind, number | null>;
  approvedExtrasSatang: number;
  totalSatang: number | null;
  missingTransport: boolean;
  pendingExtras: AdminReceiptKind[];
};

export function sheetRowTotals(state: State, sheet: BillingSheet, jobId: string): SheetRowTotals {
  const job = state.bookings.find((item) => item.id === jobId);
  const line = sheet.lines[jobId];
  const extrasSatang = Object.fromEntries(SHEET_EXTRA_KINDS.map((kind) => {
    const value = line?.extras[kind];
    return [kind, value?.decision === "bill" && value.amount !== null ? toSatang(value.amount) : null];
  })) as Record<AdminReceiptKind, number | null>;
  const approvedExtrasSatang = SHEET_EXTRA_KINDS.reduce((sum, kind) => sum + (extrasSatang[kind] ?? 0), 0);
  const transportSatang = line?.transport ? toSatang(line.transport.amount) : null;
  return {
    jobId,
    position: sheet.jobIds.indexOf(jobId) + 1,
    transportSatang,
    extrasSatang,
    approvedExtrasSatang,
    totalSatang: transportSatang === null ? null : transportSatang + approvedExtrasSatang,
    missingTransport: transportSatang === null,
    pendingExtras: job ? SHEET_EXTRA_KINDS.filter((kind) => extraStatus(job, line, kind) === "needs_decision") : []
  };
}

export type SheetSummary = {
  jobCount: number;
  transportSatang: number;
  approvedExtrasSatang: number;
  totalSatang: number;
  missingPrices: number;
  pendingExtras: number;
  notVerified: string[];
  needsChecking: string[];
  missingPapers: number;
  periodStart: string | null;
  periodEnd: string | null;
  blockers: ("empty" | "missing_prices" | "needs_checking" | "missing_papers")[];
  /** Advisory only: Admin-recorded receipts nobody has decided to bill or not bill yet. Never counted as billed. */
  warnings: "pending_extras"[];
};

export function sheetSummary(state: State, sheet: BillingSheet): SheetSummary {
  const rows = sheet.jobIds.map((id) => sheetRowTotals(state, sheet, id));
  const jobs = sheet.jobIds.map((id) => state.bookings.find((item) => item.id === id)).filter(Boolean) as Booking[];
  const dates = jobs.map((job) => job.date).filter(Boolean).sort();
  const notVerified = jobs.filter((job) => job.status !== "verified").map((job) => job.id);
  const needsChecking = jobs.filter((job) => job.financeCheck || job.status === "discrepancy" || job.status === "needs_recheck").map((job) => job.id);
  const summary: SheetSummary = {
    jobCount: sheet.jobIds.length,
    transportSatang: rows.reduce((sum, row) => sum + (row.transportSatang ?? 0), 0),
    approvedExtrasSatang: rows.reduce((sum, row) => sum + row.approvedExtrasSatang, 0),
    totalSatang: rows.reduce((sum, row) => sum + (row.totalSatang ?? 0), 0),
    missingPrices: rows.filter((row) => row.missingTransport).length,
    pendingExtras: rows.reduce((sum, row) => sum + row.pendingExtras.length, 0),
    notVerified,
    needsChecking,
    missingPapers: sheet.missingPapers.length,
    periodStart: dates[0] ?? null,
    periodEnd: dates[dates.length - 1] ?? null,
    blockers: [],
    warnings: []
  };
  if (!summary.jobCount) summary.blockers.push("empty");
  if (summary.missingPrices) summary.blockers.push("missing_prices");
  if (summary.pendingExtras) summary.warnings.push("pending_extras");
  // No separate "office has not checked" blocker: the owner reviews and confirms the sheet once (sheet_mark_ready).
  // Real problems — flagged / discrepancy / needs-recheck jobs, missing prices or papers — still block.
  if (summary.needsChecking.length) summary.blockers.push("needs_checking");
  if (summary.missingPapers) summary.blockers.push("missing_papers");
  return summary;
}

export function satangToThb(satang: number | null) {
  return satang === null ? null : fromSatang(satang);
}

/** Highest TRN seen in local test records only (historical workbook facts). Informational — never authoritative. */
export function highestLocalTrn(states: State[]) {
  let best: { number: number; year: number; text: string } | null = null;
  for (const state of states) for (const job of state.bookings) {
    const match = TRN_PATTERN.exec(job.source?.historicalTrn || "");
    if (!match) continue;
    const candidate = { number: Number(match[1]), year: Number(match[2]), text: match[0] };
    if (!best || candidate.year > best.year || (candidate.year === best.year && candidate.number > best.number)) best = candidate;
  }
  return best?.text ?? null;
}

/**
 * Proposes the next official TRN ONLY from an authoritative issued-TRN register.
 * Without one (null) the result is always "pending confirmation" — no MAX+1 guess from partial data.
 */
export function proposeOfficialTrn(authoritativeIssued: readonly string[] | null, year: number):
  { status: "pending_confirmation" } | { status: "proposed"; trn: string } {
  if (!authoritativeIssued) return { status: "pending_confirmation" };
  let max = 0;
  for (const value of authoritativeIssued) {
    const match = TRN_PATTERN.exec(value.trim());
    if (match && Number(match[2]) === year) max = Math.max(max, Number(match[1]));
  }
  return { status: "proposed", trn: `TRN${String(max + 1).padStart(3, "0")}/${year}` };
}

/** Vehicle class of a Booking Diary vehicle description ("6ล้อ", "กระบะ", "40", …). Unknown text returns null — never guessed. */
export function vehicleClassOf(text: string | null | undefined): string | null {
  const v = (text || "").toLowerCase().replace(/[\s'"”’]/g, "");
  if (!v) return null;
  if (/^40/.test(v)) return "40";
  if (/6ล้อ|6w|6-?wheel/.test(v)) return "6W";
  if (/กระบะ|4ล้อ|4w|4-?wheel|pickup/.test(v)) return "4W";
  if (/พ่วง|trailer/.test(v)) return "TRAILER";
  return null;
}
const aliasKey = (value: string | null | undefined) => (value || "").toLowerCase().replace(/[\s.\-_'"()+]/g, "");
/** Does the job's saved route and vehicle class match what the owner approved for this mapping? (Unrestricted legacy mappings match every job of the customer.) */
/** Owner-approved mappings only — proposed drafts never price jobs. */
export const activeRateMappings = (state: State) => (state.rateMappings || []).filter((item) => !item.revokedAt && (item.reviewStatus ?? "approved") === "approved");
export function jobMatchesMapping(job: Booking, mapping: RateMapping): { ok: boolean; why: string } {
  const m = mapping.match;
  if (!m) return { ok: true, why: "" };
  const pickup = aliasKey(job.pickup);
  const delivery = aliasKey(job.delivery);
  if (m.pickup.length && !m.pickup.some((alias) => aliasKey(alias) && pickup.includes(aliasKey(alias)))) return { ok: false, why: `pickup "${job.pickup}" is not an approved pickup for this rate` };
  if (m.delivery.length && !m.delivery.some((alias) => aliasKey(alias) && delivery.includes(aliasKey(alias)))) return { ok: false, why: `delivery "${job.delivery}" is not an approved delivery for this rate` };
  if (m.plates?.length) {
    const plate = aliasKey(job.diarySource?.vehicle_registration || job.vehicle);
    if (!m.plates.some((p) => aliasKey(p) && aliasKey(p) === plate)) return { ok: false, why: `registration ${job.diarySource?.vehicle_registration || job.vehicle} is not an approved vehicle for this rate` };
  }
  if (m.vehicleClass.length) {
    const cls = vehicleClassOf(job.diarySource?.vehicle) ?? vehicleClassOf(job.vehicle);
    if (!cls) return { ok: false, why: "the vehicle class (4W / 6W / 40') could not be read from the booking" };
    if (!m.vehicleClass.includes(cls)) return { ok: false, why: `vehicle class ${cls} is not approved for this rate` };
  }
  return { ok: true, why: "" };
}

/** The fuel reference that governs a job: the verified cache entry for the job's own transport date, else the job-level evidence. Never another date. */
export function resolveJobFuel(state: State, job: Booking): ResolvedFuel | null {
  const cached = (state.fuelReferences || []).find((item) => item.date === job.date && !item.supersededAt && item.product === "Diesel B7" && item.region === DIESEL_B7_REGION && fuelStatusOf(item) === "verified");
  if (cached) return { status: "verified", verifiedBy: cached.verifiedBy ?? cached.reviewer, verifiedAt: cached.verifiedAt ?? cached.retrievedAt, priceThb: cached.priceThb, date: cached.date, sourceUrl: cached.sourceUrl, evidence: cached.evidence, method: cached.method, reviewer: cached.reviewer, referenceId: cached.id, recordedAt: cached.retrievedAt };
  const own = job.fuelEvidence;
  if (own?.verified && own.jobDate === job.date && own.referenceDate === job.date && own.product === "Diesel B7")
    return { priceThb: own.priceThb, date: own.referenceDate, sourceUrl: own.sourceUrl, evidence: own.evidence, method: own.method, reviewer: null, referenceId: null, recordedAt: own.recordedAt };
  return null;
}
/** The current (non-superseded) reference for a date in ANY status — used to show proposals, disputes and provisional calculations. */
export function fuelReferenceFor(state: State, date: string): FuelReference | null {
  return (state.fuelReferences || []).find((item) => item.date === date && !item.supersededAt && item.product === "Diesel B7") ?? null;
}
const fuelAsEvidence = (fuel: ResolvedFuel, job: Booking): FuelEvidence => ({ jobDate: job.date, referenceDate: fuel.date, product: "Diesel B7", priceThb: fuel.priceThb, sourceUrl: fuel.sourceUrl, evidence: fuel.evidence, recordedAt: fuel.recordedAt, method: "manual", verified: true });

export type RateUnavailableCode = "fuel_proposed" | "fuel_disputed" | "route_mismatch" | "no_mapping" | "mapping_not_effective" | "needs_fuel" | "ambiguous" | "out_of_band" | "review_required";
export type RateSuggested = {
  kind: "suggested"; mappingId: string; amountThb: number; label: string; fuelPriceThb: number; fuel: ResolvedFuel; bandLabel: string; sourcePage: number;
  scheduleName: string; scheduleVersion: string; sourceFilename: string; route: string; vehicle: string; reviewFlags: string[]; contractReference: string;
};
export type RateDiagnosis = RateSuggested | { kind: "unavailable"; code: RateUnavailableCode; mappings: number; candidates: RateSuggested[]; /** A calculation using a PROPOSED (unverified) fuel value, shown for review only. */ provisional?: RateSuggested; en: string; th: string };

/** Rate for one mapping using a given fuel reference (verified or provisional). */
function evaluateWithFuel(job: Booking, mapping: RateMapping, fuel: ResolvedFuel): RateSuggested | { kind: "unavailable"; code: RateUnavailableCode; en: string; th: string } {
  try {
    const result = suggestCustomerRate(job, mapping, fuelAsEvidence(fuel, job));
    return {
      kind: "suggested", mappingId: mapping.id, amountThb: result.band.amountThb, fuelPriceThb: fuel.priceThb, fuel, bandLabel: result.band.label, sourcePage: result.band.sourcePage,
      scheduleName: result.schedule.name, scheduleVersion: result.schedule.version, sourceFilename: result.schedule.sourceFilename, route: `${result.row.pickup.replace(/\s+/g, " ")} → ${result.row.delivery.replace(/\s+/g, " ")}`,
      vehicle: result.row.vehicle, reviewFlags: result.row.reviewFlags, contractReference: mapping.contractReference,
      label: `${result.schedule.name} · ${result.row.pickup} → ${result.row.delivery} · ${result.row.vehicle} · ${result.band.label}`
    };
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "";
    if (message === "FINANCE_RATE_NOT_FOUND") return { kind: "unavailable", code: "out_of_band", en: `Diesel B7 THB ${fuel.priceThb.toFixed(2)}/L is outside this schedule's fuel bands. No rate is extrapolated.`, th: `ราคาดีเซล B7 ${fuel.priceThb.toFixed(2)} บาท/ลิตร อยู่นอกช่วงราคาของตาราง ระบบไม่คาดเดาราคา` };
    if (message === "FINANCE_RATE_REVIEW_REQUIRED") return { kind: "unavailable", code: "review_required", en: "The source schedule changed or a source anomaly needs a recorded review reason.", th: "ตารางต้นทางเปลี่ยน หรือมีจุดผิดปกติที่ต้องบันทึกเหตุผลทบทวน" };
    return { kind: "unavailable", code: "review_required", en: "The rate could not be verified against the approved source.", th: "ตรวจสอบราคากับต้นทางที่อนุมัติไม่ได้" };
  }
}

/** Evaluate ONE approved mapping for a job. Exact quoted amount only; any mismatch is a clear no-match, never a fictional price. */
export function evaluateMapping(state: State, job: Booking, mapping: RateMapping): RateSuggested | { kind: "unavailable"; code: RateUnavailableCode; provisional?: RateSuggested; en: string; th: string } {
  if (mapping.clientId !== job.clientId) return { kind: "unavailable", code: "no_mapping", en: "This mapping belongs to another customer.", th: "การผูกสัญญานี้เป็นของลูกค้ารายอื่น" };
  if (mapping.effectiveFrom > job.date || (mapping.effectiveTo && mapping.effectiveTo < job.date))
    return { kind: "unavailable", code: "mapping_not_effective", en: `The approved contract is not effective on the job date ${job.date} (${mapping.effectiveFrom} to ${mapping.effectiveTo ?? "open"}).`, th: `สัญญาที่อนุมัติไม่มีผลในวันงาน ${job.date}` };
  const routeCheck = jobMatchesMapping(job, mapping);
  if (!routeCheck.ok) return { kind: "unavailable", code: "route_mismatch", en: `Not this rate: ${routeCheck.why}.`, th: `ไม่ตรงกับตารางราคานี้: ${routeCheck.why}` };
  let fuel = resolveJobFuel(state, job);
  if (!fuel) {
    const ref = fuelReferenceFor(state, job.date);
    if (ref && fuelStatusOf(ref) === "proposed") {
      const provisionalFuel: ResolvedFuel = { status: "proposed", verifiedBy: null, verifiedAt: null, priceThb: ref.priceThb, date: ref.date, sourceUrl: ref.sourceUrl, evidence: ref.evidence, method: ref.method, reviewer: ref.reviewer, referenceId: ref.id, recordedAt: ref.retrievedAt };
      const provisional = evaluateWithFuel(job, mapping, provisionalFuel);
      return { kind: "unavailable", code: "fuel_proposed", ...(provisional.kind === "suggested" ? { provisional } : {}), en: `Diesel B7 THB ${ref.priceThb.toFixed(2)}/L for ${job.date} is proposed and awaiting owner verification. It does not price this job yet.`, th: `ราคาดีเซล B7 ${ref.priceThb.toFixed(2)} บาท/ลิตร ของ ${job.date} เป็นค่าที่เสนอ รอเจ้าของยืนยัน ยังไม่ใช้คิดราคา` };
    }
    if (ref && fuelStatusOf(ref) === "disputed") return { kind: "unavailable", code: "fuel_disputed", en: `The Diesel B7 value for ${job.date} is disputed (${ref.disputeReason}). Fuel price needs verification.`, th: `ราคาดีเซล B7 ของ ${job.date} ถูกโต้แย้ง ต้องยืนยันราคาน้ำมัน` };
  }
  if (!fuel) return { kind: "unavailable", code: "needs_fuel", en: `Fuel price needs verification: no verified Diesel B7 price for the transport date ${job.date}.`, th: `ต้องยืนยันราคาน้ำมัน: ยังไม่มีราคาดีเซล B7 ที่ยืนยันสำหรับวันขนส่ง ${job.date}` };
  return evaluateWithFuel(job, mapping, fuel);
}

/** Customer + contract + job date + route + vehicle + historical Diesel B7 → one proposed charge, or a precise reason there is none. */
export function diagnoseRate(state: State, job: Booking): RateDiagnosis {
  const all = activeRateMappings(state).filter((item) => item.clientId === job.clientId);
  if (!all.length) return { kind: "unavailable", code: "no_mapping", mappings: 0, candidates: [], en: "No approved customer contract / route mapping for this customer. Automatic price unavailable — review required.", th: "ยังไม่มีการอนุมัติสัญญา/เส้นทางของลูกค้ารายนี้ ราคาอัตโนมัติไม่พร้อมใช้ — ต้องตรวจสอบ" };
  const current = all.filter((item) => item.effectiveFrom <= job.date && (!item.effectiveTo || item.effectiveTo >= job.date));
  if (!current.length) return { kind: "unavailable", code: "mapping_not_effective", mappings: all.length, candidates: [], en: `Approved contracts exist but none is effective on the job date ${job.date}. Automatic price unavailable — review required.`, th: `มีสัญญาที่อนุมัติแต่ไม่มีผลในวันงาน ${job.date} ราคาอัตโนมัติไม่พร้อมใช้ — ต้องตรวจสอบ` };
  const evaluated = current.map((mapping) => evaluateMapping(state, job, mapping));
  const ok = evaluated.filter((item): item is RateSuggested => item.kind === "suggested");
  if (ok.length === 1) return ok[0];
  if (ok.length > 1) return { kind: "unavailable", code: "ambiguous", mappings: current.length, candidates: ok, en: "Several approved routes match this customer and date. Choose the correct route manually.", th: "มีหลายเส้นทางที่ตรงกัน กรุณาเลือกเส้นทางที่ถูกต้องเอง" };
  const real = evaluated.filter((item) => item.kind === "unavailable" && item.code !== "route_mismatch") as { code: RateUnavailableCode; provisional?: RateSuggested; en: string; th: string }[];
  if (!real.length) return { kind: "unavailable", code: "route_mismatch", mappings: current.length, candidates: [], en: "Approved rates exist for this customer, but none matches this job's route and vehicle class. Automatic price unavailable — review required.", th: "มีราคาที่อนุมัติของลูกค้ารายนี้ แต่ไม่มีรายการที่ตรงกับเส้นทางและประเภทรถของงานนี้ ราคาอัตโนมัติไม่พร้อมใช้ — ต้องตรวจสอบ" };
  const first = real[0];
  return { kind: "unavailable", code: first.code, mappings: current.length, candidates: [], ...(first.provisional ? { provisional: first.provisional } : {}), en: `${first.en} Automatic price unavailable — review required.`, th: `${first.th} ราคาอัตโนมัติไม่พร้อมใช้ — ต้องตรวจสอบ` };
}

/** One approved rate suggestion when exactly one confirmed customer mapping + verified exact-date Diesel B7 apply. */
export function sheetRateSuggestion(state: State, job: Booking):
  { kind: "suggested"; amountThb: number; label: string; mappingId: string; fuelPriceThb: number } |
  { kind: "none" } | { kind: "needs_fuel"; mappings: number } | { kind: "ambiguous"; mappings: number } {
  const diagnosis = diagnoseRate(state, job);
  if (diagnosis.kind === "suggested") return { kind: "suggested", amountThb: diagnosis.amountThb, label: diagnosis.label, mappingId: diagnosis.mappingId, fuelPriceThb: diagnosis.fuelPriceThb };
  if (diagnosis.code === "needs_fuel") return { kind: "needs_fuel", mappings: diagnosis.mappings };
  if (diagnosis.code === "ambiguous") return { kind: "ambiguous", mappings: diagnosis.mappings };
  return { kind: "none" };
}

function buildProvenance(state: State, job: Booking, mapping: RateMapping, rate: RateSuggested, applied: number, overrideReason: string | null, actor: Role, at: string): PricingProvenance {
  return {
    jobDate: job.date, clientId: job.clientId, client: job.client, workOrder: confirmedWorkOrder(job), route: rate.route, vehicle: rate.vehicle,
    mappingId: mapping.id, contractReference: mapping.contractReference, scheduleId: mapping.scheduleId, scheduleName: rate.scheduleName, scheduleVersion: rate.scheduleVersion, sourceSha256: mapping.sourceSha256, sourceFilename: rate.sourceFilename, sourcePage: rate.sourcePage, bandLabel: rate.bandLabel,
    fuel: { referenceId: rate.fuel.referenceId, date: rate.fuel.date, product: "Diesel B7", region: DIESEL_B7_REGION, priceThb: rate.fuel.priceThb, sourceUrl: rate.fuel.sourceUrl, method: rate.fuel.method, evidence: rate.fuel.evidence, reviewer: rate.fuel.reviewer },
    suggestedThb: rate.amountThb, appliedThb: applied, overrideReason, decidedBy: actor, decidedAt: at
  };
}

function applySheetAction(next: State, action: Action, actor: Role, context: ApplyContext = {}): { subject: string; detail: string; skipAudit?: boolean } {
  const now = new Date().toISOString();
  if (action.type === "flag_needs_checking") {
    const job = next.bookings.find((item) => item.id === action.jobId)!;
    const reason = action.reason.trim();
    if (reason.length < 3) fail("FINANCE_CHECK_REASON_REQUIRED");
    job.financeCheck = { reason, at: now, by: actor };
    if (job.status === "verified") job.status = "needs_recheck";
    return { subject: confirmedWorkOrder(job) ? `WO ${confirmedWorkOrder(job)}` : job.id, detail: `Returned to office checking: ${reason}` };
  }
  if (action.type === "sheet_create") {
    const customer = sheetCustomers(next).find((item) => item.clientId === action.clientId);
    if (!customer) fail("FINANCE_SHEET_CUSTOMER_REQUIRED");
    if (openSheetFor(next, action.clientId) && !action.additional) fail("FINANCE_SHEET_ALREADY_OPEN");
    if (action.label !== undefined && (typeof action.label !== "string" || action.label.trim().length > 40)) fail("FINANCE_GROUP_LABEL");
    const seq = (next.billingSheetSeq || (next.billingSheets || []).length) + 1;
    next.billingSheetSeq = seq;
    const sheet: BillingSheet = {
      id: `SHEET-${seq}`,
      draftReference: `DRAFT-${bangkokDate(now).slice(0, 4)}-${String(seq).padStart(3, "0")}`,
      clientId: customer.clientId, client: customer.client, ...(action.label?.trim() ? { label: action.label.trim() } : {}), createdAt: now, updatedAt: now, stage: "arrange",
      jobIds: [], lines: {}, missingPapers: [], readyForApprovalAt: null, approvedAt: null, approvedBy: null, approvalNote: null, officialTrn: null
    };
    // The one and only place a simulated TRN is allocated: creating a new batch. Stage changes, saving, reopening and
    // editing never touch it, so the same number stays attached to the same batch.
    if (simulatedTrnAllowed()) {
      const number = nextSimulatedTrnNumber(next, context.siblingStates);
      next.simulatedTrnLast = number;
      sheet.simulatedTrn = formatSimulatedTrn(number);
    }
    next.billingSheets!.push(sheet);
    return {
      subject: sheetTrnLabel(sheet),
      detail: sheet.simulatedTrn
        ? `Customer billing sheet started for ${customer.client} · simulated ${sheet.simulatedTrn} (local test only — not an issued TRN; draft ref ${sheet.draftReference})`
        : `Customer billing sheet started for ${customer.client} (local test, no TRN issued)`
    };
  }
  if (action.type === "sheet_move_to_group") {
    const from = next.billingSheets!.find((item) => item.id === action.fromSheetId);
    const to = next.billingSheets!.find((item) => item.id === action.toSheetId);
    if (!from || !to || from.id === to.id) fail("FINANCE_SHEET_NOT_FOUND");
    if (from!.readyForApprovalAt || to!.readyForApprovalAt) fail("FINANCE_SHEET_LOCKED");
    if (from!.clientId !== to!.clientId) fail(`FINANCE_WO_OTHER_CUSTOMER:${to!.client}`);
    const index = from!.jobIds.indexOf(action.jobId);
    if (index < 0) fail("FINANCE_SHEET_PAPER_NOT_FOUND");
    if (to!.jobIds.includes(action.jobId) || (next.billingSheets || []).some((item) => item.id !== from!.id && item.jobIds.includes(action.jobId))) fail("FINANCE_WO_ALREADY_IN_GROUP");
    const moved = next.bookings.find((item) => item.id === action.jobId);
    const line = from!.lines[action.jobId] ?? { transport: null, extras: {} };
    from!.jobIds.splice(index, 1); delete from!.lines[action.jobId];
    to!.jobIds.push(action.jobId); to!.lines[action.jobId] = line;
    from!.updatedAt = now; to!.updatedAt = now;
    const wo = moved ? confirmedWorkOrder(moved) : action.jobId;
    const why = (action.reason || "").trim();
    const detailText = `WO ${wo} moved from ${sheetTrnLabel(from!)} to ${sheetTrnLabel(to!)} with its transport charge, extra charges and price history (Booking Diary and green-paper records unchanged)${why ? `: ${why}` : ""}`;
    next.audit.push({ step: next.audit.length + 1, at: now, actor, subject: sheetTrnLabel(from!), action: "sheet_move_out", detail: detailText });
    return { subject: sheetTrnLabel(to!), detail: detailText };
  }
  if (action.type === "sheet_set_label") {
    const target = next.billingSheets!.find((item) => item.id === action.sheetId);
    if (!target || typeof action.label !== "string" || action.label.trim().length > 40) fail("FINANCE_GROUP_LABEL");
    if (target!.readyForApprovalAt) fail("FINANCE_SHEET_LOCKED");
    target!.label = action.label.trim() || undefined; target!.updatedAt = now;
    return { subject: sheetTrnLabel(target!), detail: `Invoice group name set to "${action.label.trim()}"` };
  }
  const sheet = next.billingSheets!.find((item) => item.id === (action as { sheetId: string }).sheetId);
  if (!sheet) fail("FINANCE_SHEET_NOT_FOUND");
  const editable = !sheet.readyForApprovalAt;
  const requireEditable = () => { if (!editable) fail("FINANCE_SHEET_LOCKED"); };
  const priorUpdatedAt = sheet.updatedAt;
  sheet.updatedAt = now;
  const subject = sheetTrnLabel(sheet);
  switch (action.type) {
    case "sheet_add_paper": {
      requireEditable();
      const lookup = lookupWorkOrderForSheet(next, sheet, action.workOrder);
      if (lookup.kind === "empty") fail("FINANCE_WO_REQUIRED");
      if (lookup.kind === "not_found") fail("FINANCE_WO_NOT_FOUND");
      if (lookup.kind === "ambiguous") fail("FINANCE_WO_AMBIGUOUS");
      if (lookup.kind === "other_customer") fail(`FINANCE_WO_OTHER_CUSTOMER:${lookup.job.client}`);
      if (lookup.kind === "already_in_list") fail(`FINANCE_WO_ALREADY_IN_LIST:${lookup.position}`);
      if (lookup.kind === "in_other_sheet") fail(`FINANCE_WO_IN_OTHER_SHEET:${sheetTrnLabel(lookup.sheet)}`);
      const job = lookup.job;
      sheet.jobIds.push(job.id);
      sheet.lines[job.id] = sheet.lines[job.id] || { transport: null, extras: {} };
      if (sheet.removedPapers) sheet.removedPapers = sheet.removedPapers.filter((item) => item.jobId !== job.id);
      sheet.missingPapers = sheet.missingPapers.filter((item) => item.workOrder !== confirmedWorkOrder(job));
      return { subject, detail: `Paper position ${sheet.jobIds.length}: WO ${confirmedWorkOrder(job)}` };
    }
    case "sheet_note_missing": {
      requireEditable();
      const workOrder = normalizeWorkOrderInput(action.workOrder);
      if (!workOrder || findWorkOrder(next, workOrder)) fail("FINANCE_WO_REQUIRED");
      if (!sheet.missingPapers.some((item) => item.workOrder === workOrder)) sheet.missingPapers.push({ workOrder, at: now });
      return { subject, detail: `Green paper WO ${workOrder} on desk has no linked Finance record — flagged for office` };
    }
    case "sheet_clear_missing": {
      sheet.missingPapers = sheet.missingPapers.filter((item) => item.workOrder !== normalizeWorkOrderInput(action.workOrder));
      return { subject, detail: `Missing-record flag cleared for WO ${action.workOrder}` };
    }
    case "sheet_remove_paper": {
      requireEditable();
      const index = sheet.jobIds.indexOf(action.jobId);
      if (index < 0) fail("FINANCE_SHEET_PAPER_NOT_FOUND");
      sheet.jobIds.splice(index, 1);
      const removedJob = next.bookings.find((item) => item.id === action.jobId);
      (sheet.removedPapers ||= []).push({ jobId: action.jobId, index, line: JSON.parse(JSON.stringify(sheet.lines[action.jobId] ?? { transport: null, extras: {} })) as SheetLine, removedAt: now, removedBy: actor, reason: (action.reason || "").trim() || null });
      delete sheet.lines[action.jobId];
      return { subject, detail: `Removed WO ${removedJob ? confirmedWorkOrder(removedJob) : action.jobId} from position ${index + 1} (Booking Diary and green-paper record unchanged; entered charges kept so it can be restored)${action.reason?.trim() ? `: ${action.reason.trim()}` : ""}` };
    }
    case "sheet_restore_paper": {
      requireEditable();
      const entry = (sheet.removedPapers || []).find((item) => item.jobId === action.jobId);
      if (!entry) fail("FINANCE_SHEET_PAPER_NOT_FOUND");
      const job = next.bookings.find((item) => item.id === action.jobId);
      if (!job) fail("FINANCE_SHEET_PAPER_NOT_FOUND");
      const lookup = lookupWorkOrderForSheet(next, sheet, confirmedWorkOrder(job!));
      if (lookup.kind === "in_other_sheet") fail(`FINANCE_WO_IN_OTHER_SHEET:${sheetTrnLabel(lookup.sheet)}`);
      if (lookup.kind === "already_in_list") fail(`FINANCE_WO_ALREADY_IN_LIST:${lookup.position}`);
      if (lookup.kind !== "match") fail("FINANCE_WO_NOT_FOUND");
      const at = Math.min(entry!.index, sheet.jobIds.length);
      sheet.jobIds.splice(at, 0, action.jobId);
      sheet.lines[action.jobId] = JSON.parse(JSON.stringify(entry!.line)) as SheetLine;
      sheet.removedPapers = (sheet.removedPapers || []).filter((item) => item.jobId !== action.jobId);
      return { subject, detail: `Restored WO ${confirmedWorkOrder(job!)} at position ${at + 1} with its saved charges` };
    }
    case "sheet_move_paper": {
      requireEditable();
      const from = sheet.jobIds.indexOf(action.jobId);
      if (from < 0 || !Number.isInteger(action.toIndex) || action.toIndex < 0 || action.toIndex >= sheet.jobIds.length) fail("FINANCE_SHEET_ORDER");
      const [moved] = sheet.jobIds.splice(from, 1);
      sheet.jobIds.splice(action.toIndex, 0, moved);
      return { subject, detail: `Moved paper from position ${from + 1} to ${action.toIndex + 1}` };
    }
    case "sheet_set_transport": {
      requireEditable();
      if (!sheet.jobIds.includes(action.jobId)) fail("FINANCE_SHEET_PAPER_NOT_FOUND");
      const transport = action.transport;
      if (transport && (!validThb(transport.amount, false) || (transport.source !== "manual" && transport.source !== "schedule"))) fail("FINANCE_AMOUNT_INVALID");
      const line = sheet.lines[action.jobId];
      const existing = line.transport;
      const changed = !!existing && (!transport || toSatang(existing.amount) !== toSatang(transport.amount) || existing.source !== transport.source);
      const reason = (transport?.overrideReason || "").trim();
      if (existing?.provenance && changed && reason.length < 10) fail("FINANCE_OVERRIDE_REASON_REQUIRED");
      if (transport?.source === "schedule") {
        const job = next.bookings.find((item) => item.id === action.jobId)!;
        const suggestion = sheetRateSuggestion(next, job);
        if (suggestion.kind !== "suggested" || suggestion.mappingId !== transport.mappingId || toSatang(suggestion.amountThb) !== toSatang(transport.amount)) fail("FINANCE_RATE_SUGGESTION_STALE");
        const mapping = next.rateMappings!.find((item) => item.id === suggestion.mappingId && !item.revokedAt)!;
        const evaluated = evaluateMapping(next, job, mapping);
        if (evaluated.kind !== "suggested") fail("FINANCE_RATE_SUGGESTION_STALE");
        if (existing && changed) (line.priceHistory ||= []).push({ transport: existing, replacedAt: now, replacedBy: actor, reason: null });
        line.transport = { amount: suggestion.amountThb, source: "schedule", rateLabel: suggestion.label, mappingId: suggestion.mappingId, fuelPriceThb: suggestion.fuelPriceThb, suggestedThb: suggestion.amountThb,
          provenance: buildProvenance(next, job, mapping, evaluated, suggestion.amountThb, null, actor, now) };
      } else {
        if (existing && changed) (line.priceHistory ||= []).push({ transport: existing, replacedAt: now, replacedBy: actor, reason: reason || null });
        if (!transport) line.transport = null;
        else if (existing?.provenance) line.transport = { amount: transport.amount, source: "manual", suggestedThb: existing.provenance.suggestedThb, overrideReason: reason,
          provenance: { ...existing.provenance, appliedThb: transport.amount, overrideReason: reason, decidedBy: actor, decidedAt: now } };
        else line.transport = { amount: transport.amount, source: "manual", ...(reason ? { overrideReason: reason } : {}) };
      }
      return { subject, detail: transport ? `Transport charge THB ${transport.amount.toFixed(2)} (${transport.source})${reason ? `; override reason: ${reason}` : ""}` : "Transport charge cleared" };
    }
    case "sheet_apply_rate": {
      requireEditable();
      if (!sheet.jobIds.includes(action.jobId)) fail("FINANCE_SHEET_PAPER_NOT_FOUND");
      if (!action.routeVehicleConfirmed) fail("FINANCE_ROUTE_CONFIRM_REQUIRED");
      const job = next.bookings.find((item) => item.id === action.jobId)!;
      const mapping = (next.rateMappings || []).find((item) => item.id === action.mappingId && !item.revokedAt);
      if (!mapping) fail("FINANCE_RATE_UNAVAILABLE");
      const evaluated = evaluateMapping(next, job, mapping!);
      if (evaluated.kind !== "suggested") fail("FINANCE_RATE_UNAVAILABLE");
      if (!validThb(action.amountThb, false)) fail("FINANCE_AMOUNT_INVALID");
      const suggested = (evaluated as RateSuggested).amountThb;
      const override = toSatang(action.amountThb) !== toSatang(suggested);
      const reason = (action.overrideReason || "").trim();
      if (override && reason.length < 10) fail("FINANCE_OVERRIDE_REASON_REQUIRED");
      const line = sheet.lines[action.jobId];
      const existing = line.transport;
      if (existing && !action.confirmOverwrite) fail("FINANCE_PRICE_OVERWRITE_CONFIRM");
      if (existing) (line.priceHistory ||= []).push({ transport: existing, replacedAt: now, replacedBy: actor, reason: override ? reason : "Replaced by approved source rate" });
      const provenance = buildProvenance(next, job, mapping!, evaluated as RateSuggested, action.amountThb, override ? reason : null, actor, now);
      line.transport = { amount: action.amountThb, source: override ? "manual" : "schedule", rateLabel: (evaluated as RateSuggested).label, mappingId: mapping!.id, fuelPriceThb: (evaluated as RateSuggested).fuelPriceThb,
        suggestedThb: suggested, ...(override ? { overrideReason: reason } : {}), provenance };
      return { subject, detail: `Transport charge THB ${action.amountThb.toFixed(2)} from ${(evaluated as RateSuggested).label}; Diesel B7 THB ${(evaluated as RateSuggested).fuelPriceThb.toFixed(2)}/L on ${job.date}${override ? `; OVERRIDE of suggested THB ${suggested.toFixed(2)}: ${reason}` : ""}${existing ? `; replaced earlier THB ${existing.amount.toFixed(2)}` : ""}` };
    }
    case "sheet_reclassify_extra": {
      requireEditable();
      const target = next.bookings.find((item) => item.id === action.jobId);
      if (!target || !sheet.jobIds.includes(action.jobId) || !SHEET_EXTRA_KINDS.includes(action.from) || !SHEET_EXTRA_KINDS.includes(action.to) || action.from === action.to) fail("FINANCE_SHEET_PAPER_NOT_FOUND");
      const line = sheet.lines[action.jobId];
      if (line.extras[action.to] || target!.adminReceipts?.amounts[action.to] != null) fail("FINANCE_EXTRA_EXISTS");
      const fromDecision = line.extras[action.from];
      const amount = fromDecision?.decision === "bill" ? fromDecision.amount : target!.adminReceipts?.amounts[action.from] ?? null;
      if (amount === null || !validThb(amount, false)) fail("FINANCE_AMOUNT_INVALID");
      line.extras[action.to] = { decision: "bill", amount, note: (action.note || "").trim() || `Admin receipt recorded under ${action.from}; verified as ${action.to}` };
      line.extras[action.from] = { decision: "not_billable", amount: null, note: `Reclassified to ${action.to}; billed once there` };
      return { subject, detail: `WO ${confirmedWorkOrder(target!)}: THB ${amount.toFixed(2)} billed as ${action.to} (Admin receipt was recorded under ${action.from}); the ${action.from} line is marked not billable so the amount is counted once` };
    }
    case "sheet_set_extra": {
      requireEditable();
      if (!sheet.jobIds.includes(action.jobId) || !SHEET_EXTRA_KINDS.includes(action.kind)) fail("FINANCE_SHEET_PAPER_NOT_FOUND");
      const value = action.value;
      if (value && (value.decision === "bill" ? value.amount === null || !validThb(value.amount, false) : value.decision !== "not_billable")) fail("FINANCE_AMOUNT_INVALID");
      if (value?.note !== undefined && (typeof value.note !== "string" || value.note.length > 200)) fail("FINANCE_AMOUNT_INVALID");
      const previousExtra = sheet.lines[action.jobId].extras[action.kind];
      const before = previousExtra ? (previousExtra.decision === "bill" ? `bill THB ${previousExtra.amount?.toFixed(2)}` : "not billable") : "no decision";
      if (value) sheet.lines[action.jobId].extras[action.kind] = { decision: value.decision, amount: value.decision === "bill" ? value.amount : null, ...(value.note?.trim() ? { note: value.note.trim() } : {}) };
      else delete sheet.lines[action.jobId].extras[action.kind];
      return { subject, detail: value ? `${action.kind}: ${before} → ${value.decision === "bill" ? `bill THB ${value.amount!.toFixed(2)}` : "not billable to customer"}` : `${action.kind}: ${before} → decision cleared` };
    }
    case "sheet_set_stage": {
      if (!["arrange", "billing", "documents"].includes(action.stage)) fail("FINANCE_SHEET_STAGE");
      if (action.stage !== "arrange" && !sheet.jobIds.length) fail("FINANCE_SHEET_EMPTY");
      sheet.stage = action.stage;
      return { subject, detail: `Stage ${action.stage}` };
    }
    case "sheet_mark_ready": {
      requireEditable();
      const summary = sheetSummary(next, sheet);
      if (summary.blockers.length) fail(`FINANCE_SHEET_NOT_READY:${summary.blockers.join(",")}`);
      sheet.readyForApprovalAt = now;
      sheet.approvedAt = null;
      sheet.approvedBy = null;
      sheet.approvalNote = null;
      sheet.stage = "documents";
      return { subject, detail: `Owner confirmed ${summary.jobCount} work orders (${summary.notVerified.length} without a separate office check) · THB ${fromSatang(summary.totalSatang).toFixed(2)} · draft ready for review · no TRN issued` };
    }
    case "sheet_approve": {
      if (!sheet.readyForApprovalAt) fail("FINANCE_SHEET_NOT_READY:not_submitted");
      if (sheet.officialTrn) fail("FINANCE_SHEET_LOCKED");
      // Idempotent: a second click / delayed retry after success must not re-audit or change amounts.
      if (sheet.approvedAt) {
        sheet.updatedAt = priorUpdatedAt;
        return { subject, detail: `Already approved at ${sheet.approvedAt} by ${sheet.approvedBy} · amounts unchanged · still not issued`, skipAudit: true };
      }
      const summary = sheetSummary(next, sheet);
      if (summary.blockers.length) fail(`FINANCE_SHEET_NOT_READY:${summary.blockers.join(",")}`);
      const note = (action.note || "").trim();
      if (note.length > 200) fail("FINANCE_APPROVAL_NOTE");
      sheet.approvedAt = now;
      sheet.approvedBy = actor;
      sheet.approvalNote = note || null;
      sheet.stage = "documents";
      return { subject, detail: `Management approved customer billing figures · THB ${fromSatang(summary.totalSatang).toFixed(2)} · ${summary.jobCount} work orders · actor ${actor}${note ? ` · note: ${note}` : ""} · DRAFT/TEST only — no official TRN or tax invoice issued` };
    }
    case "sheet_reject_approval": {
      if (!sheet.readyForApprovalAt) fail("FINANCE_SHEET_REOPEN");
      if (sheet.officialTrn) fail("FINANCE_SHEET_LOCKED");
      if (sheet.approvedAt) fail("FINANCE_SHEET_LOCKED");
      const reason = action.reason.trim();
      if (reason.length < 10) fail("FINANCE_REJECT_REASON_REQUIRED");
      sheet.readyForApprovalAt = null;
      sheet.approvedAt = null;
      sheet.approvedBy = null;
      sheet.approvalNote = null;
      sheet.stage = "billing";
      return { subject, detail: `Returned for correction before approval: ${reason}` };
    }
    case "sheet_reopen": {
      if ((!sheet.readyForApprovalAt && !sheet.approvedAt) || action.reason.trim().length < 3) fail("FINANCE_SHEET_REOPEN");
      if (sheet.officialTrn) fail("FINANCE_SHEET_LOCKED");
      // Material edits after management approval require a clearer reason and force re-review.
      if (sheet.approvedAt && action.reason.trim().length < 10) fail("FINANCE_REOPEN_AFTER_APPROVAL");
      const wasApproved = !!sheet.approvedAt;
      sheet.readyForApprovalAt = null;
      sheet.approvedAt = null;
      sheet.approvedBy = null;
      sheet.approvalNote = null;
      sheet.stage = "billing";
      return { subject, detail: wasApproved
        ? `Reopened after management approval — amounts remain as saved until edited; re-review required: ${action.reason.trim()}`
        : `Reopened for correction before approval: ${action.reason.trim()}` };
    }
  }
  return { subject, detail: "" };
}
