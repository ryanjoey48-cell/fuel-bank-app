/**
 * V6.1 fleet-wide daily review. Pure and read-only. It ranks and summarises per-vehicle V6 day insights (lib/fleet-day-insights.ts,
 * the single definition of every insight) and drives a bounded, explicit read queue. It computes no journey or stop figures itself.
 * Missing evidence is "not requested", never zero kilometres or "no activity". Nothing here is saved or scheduled.
 */
import type { CoverageReason, CoverageState, DayActivity, InsightId, PositionCountReconciliation, Reliability } from "./fleet-day-insights";

export type ReviewInsight = { id: InsightId; reliability: Reliability; evidence: Record<string, number | string | null> };
/** What the server releases per vehicle: no coordinates, only what an authorised caller may see. */
export type VehicleDayReview = {
  coverage: CoverageState; coverageReasons: CoverageReason[]; activity: DayActivity; insights: ReviewInsight[]; positionCount: PositionCountReconciliation;
  journeyAccess: "granted" | "requires_authorisation" | "unknown";
};
export type ReviewRowInput = {
  vehicleId: string; registration: string;
  providerKm: number | null; providerReconciled: boolean; segments: number | null; capturedAt: string | null;
  review: VehicleDayReview | null;
  /** Registry state from the vehicles table. A duplicate registration cannot be matched to one Forth device, so it is shown, never read or merged. */
  registry?: "active" | "inactive" | "duplicate_registration";
};
/** Client-side state of a user-triggered read for one vehicle. */
export type ReadState = "idle" | "queued" | "loading" | "done" | "failed" | "no_device" | "rate_limited" | "unavailable";

export type EvidenceStatus = "not_requested" | "queued" | "loading" | "available" | "partial" | "failed" | "no_device" | "no_provider_data" | "rate_limited";
export type Priority = "high" | "medium" | "info" | "none";
export type ExceptionGroup = "tracking_health" | "journey_activity" | "evidence_integrity" | "operational_opportunity";
export type FleetException = { key: string; group: ExceptionGroup; priority: Exclude<Priority, "none">; insightId: InsightId | null; evidence: Record<string, number | string | null>; reliability: Reliability };

/** Deterministic mapping: no invented confidence numbers. Priority reflects evidence quality and operational impact. */
export const INSIGHT_GROUP: Record<InsightId, ExceptionGroup> = {
  unverified_positions: "tracking_health", tracking_gap: "tracking_health",
  long_distance: "journey_activity", long_stop: "journey_activity", many_stops: "journey_activity", starts_mid_journey: "journey_activity", ends_mid_journey: "journey_activity",
  provider_trail_difference: "journey_activity", engine_on_during_stop: "journey_activity", mostly_stationary: "journey_activity",
  ambiguous_segments: "evidence_integrity"
};
export const TRAIL_DIFFERENCE_HIGH_PCT = 5;
export const GAP_HIGH_MINUTES = 180;

function priorityOf(i: ReviewInsight): Exclude<Priority, "none"> {
  switch (i.id) {
    case "provider_trail_difference": return Math.abs(Number(i.evidence.differencePct ?? 0)) > TRAIL_DIFFERENCE_HIGH_PCT ? "high" : "medium";
    case "tracking_gap": return Number(i.evidence.missingMinutes ?? 0) >= GAP_HIGH_MINUTES ? "high" : "medium";
    case "unverified_positions": case "long_stop": case "ambiguous_segments": case "mostly_stationary": return "medium";
    default: return "info";
  }
}

export function evidenceStatusOf(row: ReviewRowInput, read: ReadState = "idle"): EvidenceStatus {
  if (read === "loading") return "loading";
  if (read === "queued") return "queued";
  if (read === "rate_limited") return "rate_limited";
  if (read === "no_device") return "no_device";
  if ((read === "failed" || read === "unavailable") && !row.review) return "failed";
  const r = row.review;
  if (!r || r.coverage === "not_read") return "not_requested";
  if (r.coverage === "no_positions" && (row.segments ?? 0) === 0 && row.providerKm === null) return "no_provider_data";
  if (r.coverage === "restricted" || r.coverage === "provider_distance_only" || r.coverage === "no_positions") return "partial";
  return "available";
}

export type VehicleReview = {
  vehicleId: string; registration: string; status: EvidenceStatus; priority: Priority; rank: number;
  exceptions: FleetException[]; counts: { high: number; medium: number; info: number };
  providerKm: number | null; verified: "verified" | "partly" | "unverified" | "unknown"; coverage: CoverageState | null;
};
const RANK: Record<Priority, number> = { high: 3, medium: 2, info: 1, none: 0 };

export function reviewVehicle(row: ReviewRowInput, read: ReadState = "idle"): VehicleReview {
  const status = evidenceStatusOf(row, read);
  const exceptions: FleetException[] = [];
  const add = (e: FleetException) => { if (!exceptions.some(x => x.key === e.key)) exceptions.push(e); };
  const r = row.review;
  if (row.registry === "duplicate_registration") add({ key: "registry_duplicate", group: "evidence_integrity", priority: "medium", insightId: null, evidence: {}, reliability: "unknown" });
  if (row.registry === "inactive") add({ key: "registry_inactive", group: "evidence_integrity", priority: "info", insightId: null, evidence: {}, reliability: "unknown" });
  if (status === "no_device") add({ key: "no_device", group: "tracking_health", priority: "medium", insightId: null, evidence: {}, reliability: "unknown" });
  if (status === "failed") add({ key: "read_failed", group: "tracking_health", priority: "medium", insightId: null, evidence: {}, reliability: "unknown" });
  if (r) {
    for (const i of r.insights) add({ key: i.id, group: INSIGHT_GROUP[i.id], priority: priorityOf(i), insightId: i.id, evidence: i.evidence, reliability: i.reliability });
    // A position-count difference that cannot be explained is an evidence-integrity problem to report to Forth.
    if (r.positionCount.explained === false) add({ key: "position_count_unexplained", group: "evidence_integrity", priority: "high", insightId: null, evidence: { received: r.positionCount.received, analysed: r.positionCount.analysed, duplicates: r.positionCount.exactDuplicates }, reliability: "unknown" });
    if (r.coverageReasons.includes("provider_total_not_reconciled")) add({ key: "provider_total_not_reconciled", group: "evidence_integrity", priority: "high", insightId: null, evidence: {}, reliability: "provider_reported" });
  }
  // Only the strongest evidence is ranked; the rest stay available but cannot flood the list.
  const order = (p: Priority) => RANK[p];
  exceptions.sort((a, b) => order(b.priority) - order(a.priority));
  const counts = { high: exceptions.filter(e => e.priority === "high").length, medium: exceptions.filter(e => e.priority === "medium").length, info: exceptions.filter(e => e.priority === "info").length };
  const priority: Priority = counts.high ? "high" : counts.medium ? "medium" : counts.info ? "info" : "none";
  const cov = r?.coverage ?? null;
  const verified: VehicleReview["verified"] = cov === "verified_complete" || cov === "verified_incomplete" ? "verified" : cov === "partly_verified" ? "partly" : cov === "unverified" ? "unverified" : "unknown";
  // Rank: priority first, then number of exceptions, then registration order is applied by the caller for stability.
  const rank = RANK[priority] * 1000 + counts.high * 100 + counts.medium * 10 + counts.info;
  return { vehicleId: row.vehicleId, registration: row.registration, status, priority, rank, exceptions, counts, providerKm: row.providerReconciled ? row.providerKm : null, verified, coverage: cov };
}

export function sortReviews(reviews: readonly VehicleReview[], key: "priority" | "registration" | "distance" | "evidence"): VehicleReview[] {
  const byReg = (a: VehicleReview, b: VehicleReview) => a.registration.localeCompare(b.registration);
  const copy = [...reviews];
  if (key === "registration") return copy.sort(byReg);
  if (key === "distance") return copy.sort((a, b) => (b.providerKm ?? -1) - (a.providerKm ?? -1) || byReg(a, b));
  if (key === "evidence") { const w: Record<EvidenceStatus, number> = { not_requested: 0, queued: 1, loading: 2, failed: 3, rate_limited: 3, no_device: 4, no_provider_data: 5, partial: 6, available: 7 }; return copy.sort((a, b) => w[a.status] - w[b.status] || byReg(a, b)); }
  return copy.sort((a, b) => b.rank - a.rank || byReg(a, b));
}

export type FleetReviewSummary = {
  vehicles: number; withEvidence: number; notRequested: number; failed: number; noDevice: number;
  verified: number; partlyVerified: number; unverified: number; incompleteCoverage: number;
  needingReview: { high: number; medium: number };
  /** Sum of reconciled provider km over the vehicles that have it. Never a fleet total unless complete. */
  distance: { km: number | null; includedVehicles: number; totalVehicles: number; complete: boolean };
  /** Exceptions grouped by kind, each counted once per vehicle. */
  byException: Partial<Record<InsightId | "registry_duplicate" | "registry_inactive" | "no_device" | "read_failed" | "position_count_unexplained" | "provider_total_not_reconciled", number>>;
};

export function summarizeFleetReview(reviews: readonly VehicleReview[]): FleetReviewSummary {
  const has = (r: VehicleReview) => r.status === "available" || r.status === "partial" || r.status === "no_provider_data";
  const withKm = reviews.filter(r => r.providerKm !== null);
  const complete = reviews.length > 0 && withKm.length === reviews.length && reviews.every(r => r.coverage === "verified_complete");
  const byException: FleetReviewSummary["byException"] = {};
  for (const r of reviews) for (const e of r.exceptions) { const k = e.key as keyof FleetReviewSummary["byException"]; byException[k] = (byException[k] ?? 0) + 1; }
  return {
    vehicles: reviews.length, withEvidence: reviews.filter(has).length, notRequested: reviews.filter(r => r.status === "not_requested").length,
    failed: reviews.filter(r => r.status === "failed" || r.status === "rate_limited").length, noDevice: reviews.filter(r => r.status === "no_device").length,
    verified: reviews.filter(r => r.verified === "verified").length, partlyVerified: reviews.filter(r => r.verified === "partly").length, unverified: reviews.filter(r => r.verified === "unverified").length,
    incompleteCoverage: reviews.filter(r => r.coverage !== null && r.coverage !== "verified_complete" && r.coverage !== "not_read").length,
    needingReview: { high: reviews.filter(r => r.priority === "high").length, medium: reviews.filter(r => r.priority === "medium").length },
    distance: { km: withKm.length ? Math.round(withKm.reduce((n, r) => n + (r.providerKm ?? 0), 0) * 100) / 100 : null, includedVehicles: withKm.length, totalVehicles: reviews.length, complete },
    byException
  };
}

/** Which registry vehicles an explicit "read missing days" action should request: unread only, deduplicated, capped. */
export const FLEET_READ_CAP = 25;
export function vehiclesToRead(rows: readonly ReviewRowInput[], states: Readonly<Record<string, ReadState>> = {}): string[] {
  const seen = new Set<string>(); const out: string[] = [];
  for (const row of rows) {
    if (seen.has(row.vehicleId)) continue; seen.add(row.vehicleId);
    const s = states[row.vehicleId];
    // A duplicate registration cannot map to a single Forth device and an inactive record is not tracked: neither is requested.
    if (row.registry === "duplicate_registration" || row.registry === "inactive") continue;
    if (row.review && row.review.coverage !== "not_read") continue;
    if (s === "queued" || s === "loading" || s === "done" || s === "no_device") continue;
    out.push(row.vehicleId);
    if (out.length >= FLEET_READ_CAP) break;
  }
  return out;
}

export type QueueOutcome = { id: string; result: "done" | "failed" | "no_device" | "rate_limited" | "unavailable" | "aborted" };
export type QueueWorker = (id: string, signal: AbortSignal) => Promise<{ status: number }>;
/**
 * Bounded read queue. Concurrency defaults to 1 because the server allows one provider read in flight. A provider error for
 * one vehicle never blocks the rest; a rate-limit response stops the queue safely (remaining vehicles stay "not requested").
 */
export async function runReadQueue(ids: readonly string[], worker: QueueWorker, options: { concurrency?: number; signal?: AbortSignal; onState?: (id: string, state: ReadState) => void } = {}): Promise<QueueOutcome[]> {
  const unique = [...new Set(ids)].slice(0, FLEET_READ_CAP);
  const concurrency = Math.max(1, Math.min(2, options.concurrency ?? 1));
  const controller = new AbortController();
  const stop = () => controller.abort();
  options.signal?.addEventListener("abort", stop, { once: true });
  const outcomes: QueueOutcome[] = []; let next = 0; let halted = false;
  unique.forEach(id => options.onState?.(id, "queued"));
  async function lane() {
    while (!halted && !controller.signal.aborted) {
      const index = next++; if (index >= unique.length) return;
      const id = unique[index]; options.onState?.(id, "loading");
      try {
        const { status } = await worker(id, controller.signal);
        const result: QueueOutcome["result"] = status >= 200 && status < 300 ? "done" : status === 409 ? "no_device" : status === 429 ? "rate_limited" : status === 503 || status === 401 || status === 403 ? "unavailable" : "failed";
        outcomes.push({ id, result });
        options.onState?.(id, result === "done" ? "done" : result);
        if (result === "rate_limited" || result === "unavailable") halted = true;
      } catch {
        if (controller.signal.aborted) { outcomes.push({ id, result: "aborted" }); options.onState?.(id, "idle"); return; }
        outcomes.push({ id, result: "failed" }); options.onState?.(id, "failed");
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, lane));
  // Anything never started returns to "not requested".
  for (const id of unique) if (!outcomes.some(o => o.id === id)) options.onState?.(id, "idle");
  options.signal?.removeEventListener("abort", stop);
  return outcomes;
}

/** Previous Bangkok calendar day as YYYY-MM-DD. The live tracking state is never mixed with this historical day. */
export function previousBangkokDay(now: Date = new Date()): string {
  const bangkok = new Date(now.getTime() + 7 * 3_600_000);
  bangkok.setUTCDate(bangkok.getUTCDate() - 1);
  return bangkok.toISOString().slice(0, 10);
}

type Pair = readonly [string, string];
export const GROUP_COPY: Record<ExceptionGroup, Pair> = {
  tracking_health: ["Tracking health", "สุขภาพการติดตาม"], journey_activity: ["Journey activity", "กิจกรรมการเดินทาง"],
  evidence_integrity: ["Evidence integrity", "ความสมบูรณ์ของหลักฐาน"], operational_opportunity: ["Operational opportunities", "โอกาสเชิงปฏิบัติการ"]
};
export const PRIORITY_COPY: Record<Priority, Pair> = { high: ["High", "สูง"], medium: ["Medium", "กลาง"], info: ["Info", "ข้อมูล"], none: ["None", "ไม่มี"] };
export const STATUS_COPY: Record<EvidenceStatus, Pair> = {
  not_requested: ["Not requested", "ยังไม่ได้ขอข้อมูล"], queued: ["Queued", "รอคิว"], loading: ["Loading", "กำลังโหลด"], available: ["Available", "พร้อมใช้"],
  partial: ["Partial", "บางส่วน"], failed: ["Failed", "ล้มเหลว"], no_device: ["No unique Forth device", "ไม่พบอุปกรณ์ Forth ที่ตรงกัน"],
  no_provider_data: ["No provider data", "ไม่มีข้อมูลจากผู้ให้บริการ"], rate_limited: ["Rate limited, resume later", "ถึงขีดจำกัด ลองต่อภายหลัง"]
};
export const EXCEPTION_COPY: Record<string, { title: Pair; unknown: Pair; action: Pair }> = {
  registry_duplicate: { title: ["Two vehicle records share this registration", "มีรถสองรายการใช้ทะเบียนเดียวกัน"], unknown: ["Which record is the real vehicle", "รายการใดคือรถจริง"], action: ["Decide which record is correct in the vehicle registry. Nothing is merged or read automatically.", "ตัดสินใจว่ารายการใดถูกต้องในทะเบียนรถ ระบบไม่รวมหรืออ่านข้อมูลให้อัตโนมัติ"] },
  registry_inactive: { title: ["Inactive registry record", "รายการรถที่ไม่ใช้งาน"], unknown: ["Whether this vehicle is still tracked", "ยังติดตามรถคันนี้อยู่หรือไม่"], action: ["No action unless this vehicle should be active again.", "ไม่ต้องดำเนินการ เว้นแต่รถคันนี้ควรกลับมาใช้งาน"] },
  no_device: { title: ["No unique Forth device match", "ไม่พบอุปกรณ์ Forth ที่ตรงกันเพียงเครื่องเดียว"], unknown: ["Whether this vehicle is tracked at all", "ไม่ทราบว่ารถคันนี้มีการติดตามหรือไม่"], action: ["Check the registration and device mapping with Forth if this vehicle should be tracked.", "ตรวจสอบทะเบียนและการจับคู่อุปกรณ์กับ Forth หากรถคันนี้ควรถูกติดตาม"] },
  read_failed: { title: ["Provider read failed", "อ่านข้อมูลผู้ให้บริการไม่สำเร็จ"], unknown: ["Everything about this day", "ข้อมูลทั้งหมดของวันนี้"], action: ["Retry this vehicle later; the rest of the fleet is unaffected.", "ลองรถคันนี้อีกครั้งภายหลัง รถคันอื่นไม่ได้รับผลกระทบ"] },
  position_count_unexplained: { title: ["Position count difference not explained", "ส่วนต่างจำนวนตำแหน่งที่อธิบายไม่ได้"], unknown: ["Why rows were dropped", "สาเหตุที่แถวหายไป"], action: ["Report the vehicle and date to Forth support.", "แจ้งรถและวันที่ให้ฝ่ายสนับสนุน Forth"] },
  provider_total_not_reconciled: { title: ["Provider total does not reconcile", "ยอดรวมผู้ให้บริการไม่ตรงกับรายช่วง"], unknown: ["Which figure is right", "ไม่ทราบว่าตัวเลขใดถูกต้อง"], action: ["Do not rely on this day's distance; report the difference to Forth.", "อย่าใช้ระยะทางของวันนี้ และแจ้งความต่างให้ Forth"] }
};
export const statusLabel = (s: EvidenceStatus, l: "en" | "th") => STATUS_COPY[s][l === "th" ? 1 : 0];
export const priorityLabel = (p: Priority, l: "en" | "th") => PRIORITY_COPY[p][l === "th" ? 1 : 0];
export const groupLabel = (g: ExceptionGroup, l: "en" | "th") => GROUP_COPY[g][l === "th" ? 1 : 0];

/** What remains unknown for each V6 insight, so no exception reads as proof of an outcome. */
export const INSIGHT_UNKNOWN: Record<InsightId, Pair> = {
  long_distance: ["Why the vehicle travelled that far", "เหตุผลที่รถเดินทางไกลขนาดนี้"], long_stop: ["Why the vehicle stayed, and whether it was a customer site", "สาเหตุที่จอดนาน และเป็นสถานที่ลูกค้าหรือไม่"],
  many_stops: ["What each stop was for", "แต่ละจุดจอดเพื่ออะไร"], starts_mid_journey: ["The real departure time", "เวลาออกเดินทางจริง"], ends_mid_journey: ["Where and when the journey ended", "จุดและเวลาที่เดินทางสิ้นสุด"],
  provider_trail_difference: ["Which of the two distances is closer to reality", "ระยะทางใดใกล้เคียงความจริงกว่า"], engine_on_during_stop: ["Whether the engine was really idling", "เครื่องยนต์ติดเครื่องจริงหรือไม่"],
  mostly_stationary: ["Why the vehicle was not used", "เหตุผลที่รถไม่ได้ใช้งาน"], ambiguous_segments: ["What the vehicle did in the excluded segments", "รถทำอะไรในช่วงที่ถูกตัดออก"],
  unverified_positions: ["Whether the positions were real satellite fixes", "ตำแหน่งเป็นค่าจากดาวเทียมจริงหรือไม่"], tracking_gap: ["What the vehicle did during the gap", "รถทำอะไรในช่วงที่ไม่มีข้อมูล"]
};

/* ---------------------------------------------------------------------------------------------------------------------------------
 * V7.7 management attention queue. Pure and read-only, derived only from the per-vehicle reviews above (no new analysis, no new reads).
 * Repeated warnings of the same kind are grouped; "info" findings stay in the vehicle list; unreviewed vehicles are never counted as clean.
 * ------------------------------------------------------------------------------------------------------------------------------- */
export type AttentionVehicle = { vehicleId: string; registration: string; priority: Exclude<Priority, "none">; reliability: Reliability; evidence: Record<string, number | string | null> };
export type AttentionGroup = { key: string; group: ExceptionGroup; insightId: InsightId | null; priority: Exclude<Priority, "none" | "info">; vehicles: AttentionVehicle[] };

export function buildAttentionQueue(reviews: readonly VehicleReview[]): AttentionGroup[] {
  const groups = new Map<string, AttentionGroup>();
  for (const r of reviews) for (const e of r.exceptions) {
    if (e.priority === "info") continue;
    const g = groups.get(e.key) ?? { key: e.key, group: e.group, insightId: e.insightId, priority: e.priority, vehicles: [] };
    if (RANK[e.priority] > RANK[g.priority]) g.priority = e.priority;
    g.vehicles.push({ vehicleId: r.vehicleId, registration: r.registration, priority: e.priority, reliability: e.reliability, evidence: e.evidence });
    groups.set(e.key, g);
  }
  const list = [...groups.values()];
  for (const g of list) g.vehicles.sort((a, b) => RANK[b.priority] - RANK[a.priority] || a.registration.localeCompare(b.registration));
  return list.sort((a, b) => RANK[b.priority] - RANK[a.priority] || b.vehicles.length - a.vehicles.length || a.key.localeCompare(b.key));
}

/** The management questions a day review can answer. Each is a count of REVIEWED vehicles only, with the reviewed total beside it. */
export type ManagementQuestion = { id: "gps_unverified" | "tracking_gaps" | "distance_disagreement" | "prolonged_stays" | "unusable_tracking"; vehicles: number };
export function managementQuestions(summary: FleetReviewSummary): { reviewed: number; total: number; questions: ManagementQuestion[] } {
  const k = summary.byException;
  return {
    reviewed: summary.withEvidence, total: summary.vehicles,
    questions: [
      { id: "gps_unverified", vehicles: k.unverified_positions ?? 0 },
      { id: "tracking_gaps", vehicles: k.tracking_gap ?? 0 },
      { id: "distance_disagreement", vehicles: (k.provider_trail_difference ?? 0) + (k.provider_total_not_reconciled ?? 0) },
      { id: "prolonged_stays", vehicles: k.long_stop ?? 0 },
      { id: "unusable_tracking", vehicles: (k.no_device ?? 0) + (k.read_failed ?? 0) + (k.position_count_unexplained ?? 0) }
    ]
  };
}
export const QUESTION_COPY: Record<ManagementQuestion["id"], Pair> = {
  gps_unverified: ["Positions not GPS-verified", "ตำแหน่งที่ไม่ยืนยันด้วย GPS"],
  tracking_gaps: ["Large tracking gaps", "ช่วงที่ขาดข้อมูลการติดตามนาน"],
  distance_disagreement: ["Distance sources disagree or do not reconcile", "แหล่งระยะทางไม่ตรงกันหรือกระทบยอดไม่ได้"],
  prolonged_stays: ["Long stops deserving a look", "การจอดนานที่ควรตรวจดู"],
  unusable_tracking: ["Tracking unusable (no device, failed read, unexplained positions)", "ติดตามใช้ไม่ได้ (ไม่มีอุปกรณ์ อ่านไม่สำเร็จ ตำแหน่งอธิบายไม่ได้)"]
};
