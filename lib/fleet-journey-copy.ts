/** Bilingual wording for the journey ledger, review and summary views. [English, Thai]. */
import type { JobMatchReason, JobMatchStatus, ReconciliationReason, ReconciliationStatus } from "./fleet-journey-ledger";
import type { Provenance, SummaryIssue } from "./fleet-vehicle-day-summary";

type Lang = "en" | "th";
const pick = (pair: readonly [string, string], language: Lang) => (language === "th" ? pair[1] : pair[0]);

export const MATCH_REASON_COPY: Record<JobMatchReason, readonly [string, string]> = {
  stable_vehicle_assignment: ["Booking assigned to this vehicle ID", "สมุดจองระบุรหัสรถคันนี้"],
  registration_only_assignment: ["Booking matched by registration only", "จับคู่สมุดจองด้วยทะเบียนเท่านั้น"],
  same_booking_date: ["Same Bangkok booking date", "วันที่จองเดียวกัน (เวลาไทย)"],
  pickup_inside_journey: ["Scheduled pickup falls inside this journey", "เวลารับตามแผนอยู่ในเที่ยวนี้"],
  pickup_up_to_60_min_before_journey: ["Scheduled pickup up to 60 min before the journey starts", "เวลารับตามแผนก่อนเริ่มเที่ยวไม่เกิน 60 นาที"],
  work_order_reference: ["Has a work order reference", "มีเลขใบงาน"],
  no_pickup_time: ["No scheduled pickup time, so it cannot be placed on a journey", "ไม่มีเวลารับตามแผน จึงจับคู่กับเที่ยวไม่ได้"],
  shares_pickup_time_with_another_job: ["Conflict: another job has the same pickup time", "ขัดแย้ง: มีงานอื่นเวลารับเดียวกัน"],
  matches_multiple_journeys: ["Fits more than one journey", "ตรงกับมากกว่าหนึ่งเที่ยว"],
  journey_shared_with_other_jobs: ["Journey shared with other jobs (multi-stop or conflict); its km are counted once", "เที่ยวนี้มีหลายงาน (หลายจุดหรือขัดแย้ง) นับระยะทางครั้งเดียว"],
  journey_ambiguous: ["Journey is ambiguous (overlap or open segment)", "เที่ยวไม่ชัดเจน (ทับซ้อนหรือยังไม่ปิด)"],
  conflicting_confirmations: ["Conflict: this job is confirmed to more than one journey, so it is not counted", "ขัดแย้ง: งานนี้ถูกยืนยันกับหลายเที่ยว จึงไม่นับ"],
  confirmation_on_unsupported_journey: ["Confirmation points at a journey that is missing or ambiguous, so it is not counted", "การยืนยันชี้ไปยังเที่ยวที่ไม่มีหรือไม่ชัดเจน จึงไม่นับ"],
  location_not_compared_positions_unverified: ["Locations not compared: positions are not verified GPS", "ไม่เทียบตำแหน่ง: ตำแหน่งไม่ใช่ GPS ที่ยืนยัน"],
  driver_not_confirmed: ["Driver not confirmed", "ยังไม่ยืนยันผู้ขับ"]
};
export const CONFLICT_REASONS: readonly JobMatchReason[] = ["shares_pickup_time_with_another_job", "matches_multiple_journeys", "journey_shared_with_other_jobs", "journey_ambiguous", "conflicting_confirmations", "confirmation_on_unsupported_journey"];
export const matchReasonLabel = (r: JobMatchReason, language: Lang) => pick(MATCH_REASON_COPY[r], language);

const MATCH_STATUS: Record<JobMatchStatus, readonly [string, string]> = {
  confirmed: ["Confirmed (approved record)", "ยืนยันแล้ว (บันทึกที่อนุมัติ)"],
  candidate: ["Candidate match", "งานที่อาจตรงกัน"],
  needs_review: ["Needs review", "ต้องตรวจสอบ"],
  no_journey: ["No matching journey", "ไม่พบเที่ยวที่ตรงกัน"]
};
export const matchStatusLabel = (s: JobMatchStatus, language: Lang) => pick(MATCH_STATUS[s], language);

const RECON_STATUS: Record<ReconciliationStatus, readonly [string, string]> = {
  complete_verified: ["Complete and verified", "ครบและยืนยันแล้ว"],
  partially_allocated: ["Partially allocated", "จัดสรรบางส่วน"],
  awaiting_office_review: ["Awaiting office review", "รอสำนักงานตรวจสอบ"],
  conflicting_evidence: ["Conflicting evidence", "หลักฐานขัดแย้งกัน"],
  source_incomplete: ["Source incomplete", "ข้อมูลต้นทางไม่ครบ"],
  unknown: ["Unknown", "ไม่ทราบ"]
};
export const reconciliationLabel = (s: ReconciliationStatus, language: Lang) => pick(RECON_STATUS[s], language);

const RECON_REASON: Record<ReconciliationReason, readonly [string, string]> = {
  provider_day_not_read: ["Forth report not read for this day", "ยังไม่ได้อ่านรายงาน Forth ของวันนี้"],
  provider_totals_not_reconciled: ["Forth report totals do not reconcile", "ยอดรายงาน Forth ไม่กระทบยอด"],
  provider_coverage_unverified: ["Forth report coverage is unverified (an open final segment is expected)", "ยังไม่ยืนยันความครอบคลุมของรายงาน Forth (มีช่วงสุดท้ายที่ยังไม่ปิด)"],
  log_history_missing: ["Position history is missing for part of the day", "ประวัติตำแหน่งขาดบางช่วงของวัน"],
  ambiguous_journeys: ["Some journeys overlap or are open with distance", "บางเที่ยวทับซ้อนหรือยังไม่ปิดแต่มีระยะทาง"],
  job_conflicts: ["Jobs conflict (same pickup time or several journeys)", "งานขัดแย้งกัน (เวลารับเดียวกันหรือตรงหลายเที่ยว)"],
  category_sum_mismatch: ["Categories do not add up to the provider total", "ผลรวมหมวดไม่เท่ายอดผู้ให้บริการ"],
  candidates_awaiting_review: ["Candidate journeys await office review", "เที่ยวที่อาจเป็นงานรอสำนักงานตรวจสอบ"],
  no_confirmation_source: ["No approved job-confirmation record exists", "ยังไม่มีบันทึกการยืนยันงานที่อนุมัติ"],
  unallocated_km_remain: ["Some kilometres are unallocated", "ยังมีกิโลเมตรที่ไม่ได้จัดสรร"],
  positions_not_verified_gps: ["Positions are reported, not verified GPS", "ตำแหน่งเป็นค่าที่รายงาน ไม่ใช่ GPS ที่ยืนยัน"]
};
export const reconciliationReasonLabel = (r: ReconciliationReason, language: Lang) => pick(RECON_REASON[r], language);

const PROVENANCE: Record<Provenance, readonly [string, string]> = {
  forth_parking_report: ["Forth day report (provider-reported, not independently GPS-verified)", "รายงานรายวัน Forth (ผู้ให้บริการรายงาน ไม่ได้ยืนยันด้วย GPS อิสระ)"],
  forth_log_distance: ["Forth log: sum of per-record distances from reported positions (unverified)", "บันทึก Forth: ผลรวมระยะทางรายจุดจากตำแหน่งที่รายงาน (ยังไม่ยืนยัน)"],
  forth_log_position_source: ["Forth log position-source label", "ป้ายแหล่งตำแหน่งในบันทึก Forth"],
  forth_report_segments: ["Forth report segments (journey boundaries are the provider's own)", "ช่วงในรายงาน Forth (ขอบเขตเที่ยวเป็นของผู้ให้บริการ)"],
  booking_diary: ["Booking Diary (read only)", "สมุดจอง (อ่านอย่างเดียว)"],
  approved_confirmation_record: ["Approved confirmation record", "บันทึกการยืนยันที่อนุมัติ"],
  ees_derived: ["Derived by EES from the sources above; nothing is saved", "คำนวณโดย EES จากแหล่งข้างต้น ไม่มีการบันทึก"],
  fuel_logs_purchase: ["Fuel Logs: purchased, not consumed", "บันทึกเชื้อเพลิง: ซื้อ ไม่ใช่ที่ใช้จริง"],
  fuel_log_odometer: ["Fuel Logs odometer reading", "เลขไมล์จากบันทึกเชื้อเพลิง"],
  weekly_mileage_odometer: ["Weekly Mileage odometer reading (date is a proxy)", "เลขไมล์รายสัปดาห์ (วันที่เป็นค่าอ้างอิง)"],
  source_comparison: ["Source comparison over the same period only", "เทียบแหล่งข้อมูลเฉพาะช่วงเวลาเดียวกัน"]
};
export const provenanceLabel = (p: Provenance, language: Lang) => pick(PROVENANCE[p], language);

const ISSUE: Record<SummaryIssue, readonly [string, string]> = {
  provider_day_not_read: ["Forth report not read for this day: distance unknown", "ยังไม่ได้อ่านรายงาน Forth ของวันนี้: ไม่ทราบระยะทาง"],
  provider_totals_not_reconciled: ["Forth report totals do not reconcile: distance withheld", "ยอดรายงาน Forth ไม่กระทบยอด: ไม่แสดงระยะทาง"],
  open_final_segment_coverage_unverified: ["Coverage is unverified (open final segment); this is not complete daily mileage", "ยังไม่ยืนยันความครอบคลุม (มีช่วงสุดท้ายที่ยังไม่ปิด) ไม่ใช่ระยะทางรายวันที่ครบ"],
  positions_not_verified_gps: ["Positions are reported, not verified GPS", "ตำแหน่งเป็นค่าที่รายงาน ไม่ใช่ GPS ที่ยืนยัน"],
  job_matches_need_office_review: ["Job matches need office review", "การจับคู่งานต้องให้สำนักงานตรวจสอบ"],
  no_booking_found_not_proof_of_no_work: ["No booking found; this does not mean no work was done", "ไม่พบงานในสมุดจอง ไม่ได้หมายความว่าไม่มีการทำงาน"],
  booking_source_unavailable: ["Booking Diary could not be read", "อ่านสมุดจองไม่ได้"],
  journey_detail_restricted: ["Journey detail needs administrator authorisation for historical journeys", "รายละเอียดเที่ยวรถต้องได้รับอนุญาตจากผู้ดูแลระบบ"],
  log_distance_outside_report_segments: ["Log distance exists outside report segments (not allocated)", "มีระยะทางในบันทึกนอกช่วงรายงาน (ไม่จัดสรร)"],
  provider_trail_difference: ["Provider km and trail km differ by more than 1%", "กม. ผู้ให้บริการกับกม. ตามเส้นทางต่างกันเกิน 1%"],
  odometer_source_disagrees: ["Odometer sources disagree for the same period", "เลขไมล์จากแหล่งต่างกันไม่ตรงกันในช่วงเดียวกัน"],
  odometer_repeated_reading: ["Repeated odometer reading: no distance is derived from it", "เลขไมล์ซ้ำ: ไม่คำนวณระยะทางจากค่านี้"],
  odometer_unknown_interval: ["Odometer interval is unknown (single reading or no baseline)", "ไม่ทราบช่วงเลขไมล์ (อ่านค่าเดียวหรือไม่มีจุดเริ่ม)"],
  fuel_purchase_not_consumption: ["Fuel shown is purchased, not consumed", "เชื้อเพลิงที่แสดงคือที่ซื้อ ไม่ใช่ที่ใช้จริง"]
};
export const issueLabel = (i: SummaryIssue, language: Lang) => pick(ISSUE[i], language);

export const POSITION_SOURCE_COPY: Record<string, readonly [string, string]> = {
  gps: ["GPS-verified positions", "ตำแหน่ง GPS ที่ยืนยัน"],
  no_gps: ["Reported positions, No GPS (amber)", "ตำแหน่งที่รายงาน ไม่ใช่ GPS (สีส้ม)"],
  mixed: ["Mixed position sources", "แหล่งตำแหน่งผสม"],
  none: ["No log records", "ไม่มีบันทึก"],
  unknown: ["Unknown (log not read)", "ไม่ทราบ (ยังไม่ได้อ่านบันทึก)"]
};
export const positionSourceLabel = (s: string, language: Lang) => pick(POSITION_SOURCE_COPY[s] ?? POSITION_SOURCE_COPY.unknown, language);
