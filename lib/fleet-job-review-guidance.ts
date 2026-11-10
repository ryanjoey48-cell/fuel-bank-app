/**
 * V5.5 office review guidance: what evidence is missing for a job and what a person could do next. Pure, bilingual [English, Thai].
 * It changes nothing and confirms nothing; the actions are suggestions for a person.
 */
import type { JobRecognition } from "./fleet-visit-recognition";

type Lang = "en" | "th";
const pick = (pair: readonly [string, string], language: Lang) => (language === "th" ? pair[1] : pair[0]);

export type MissingEvidence = "no_work_order" | "no_pickup_time" | "no_vehicle_id" | "no_pickup_coordinates" | "no_delivery_coordinates" | "booked_point_unreviewed" | "positions_unverified" | "vehicle_text_conflict" | "possible_duplicate_booking" | "no_delivery_evidence" | "no_pickup_evidence";
export type ReviewAction = "check_vehicle_assignment" | "check_duplicate_booking" | "choose_between_candidates" | "verify_location_pin" | "check_paperwork_or_driver" | "complete_booking_details" | "look_at_other_long_stops" | "nothing_to_review_yet";

export const MISSING_EVIDENCE_COPY: Record<MissingEvidence, readonly [string, string]> = {
  no_work_order: ["No work-order number on the booking", "การจองไม่มีเลขใบงาน"],
  no_pickup_time: ["No scheduled pickup time", "ไม่มีเวลารับตามแผน"],
  no_vehicle_id: ["Vehicle matched by registration text only (no vehicle ID)", "จับคู่รถด้วยข้อความทะเบียนเท่านั้น (ไม่มีรหัสรถ)"],
  no_pickup_coordinates: ["The booking has no pickup coordinates", "การจองไม่มีพิกัดจุดรับ"],
  no_delivery_coordinates: ["The booking has no delivery coordinates", "การจองไม่มีพิกัดจุดส่ง"],
  booked_point_unreviewed: ["The booked points have not been verified by the office", "สำนักงานยังไม่ได้ตรวจสอบจุดที่จอง"],
  positions_unverified: ["Vehicle positions are provider-reported, not verified GPS", "ตำแหน่งรถเป็นค่าที่ผู้ให้บริการรายงาน ไม่ใช่ GPS ที่ยืนยัน"],
  vehicle_text_conflict: ["The vehicle field names a different registration (it may be left over from an earlier truck on this booking)", "ช่องรถระบุทะเบียนอื่น (อาจเป็นข้อมูลเก่าของรถคันก่อนที่ค้างอยู่ในการจองนี้)"],
  possible_duplicate_booking: ["Same route, driver, vehicle text and time entered more than once: possible double entry", "เส้นทาง คนขับ ข้อความรถ และเวลาเดียวกันถูกบันทึกซ้ำ อาจเป็นการบันทึกซ้ำ"],
  no_delivery_evidence: ["No stop was found near the booked delivery point", "ไม่พบการหยุดใกล้จุดส่งที่จอง"],
  no_pickup_evidence: ["No stop was found near the booked pickup point", "ไม่พบการหยุดใกล้จุดรับที่จอง"]
};
export const REVIEW_ACTION_COPY: Record<ReviewAction, readonly [string, string]> = {
  check_vehicle_assignment: ["Check which vehicle really did this job: the vehicle field names another registration, so this vehicle may not be the one that moved", "ตรวจว่ารถคันไหนทำงานนี้จริง การจองระบุรถอีกคันด้วย และรถคันนี้อาจไม่ได้เคลื่อนที่เพื่องานนี้"],
  check_duplicate_booking: ["Check whether this booking is a duplicate entry before relying on the suggestion", "ตรวจว่าการจองนี้ซ้ำหรือไม่ ก่อนใช้คำแนะนำ"],
  choose_between_candidates: ["Choose between the competing candidates using paperwork, the driver, or the customer", "เลือกระหว่างตัวเลือกที่แข่งกันจากเอกสาร คนขับ หรือลูกค้า"],
  verify_location_pin: ["Verify the customer's loading point on the map (Locations) so future suggestions can use it", "ตรวจสอบจุดขนถ่ายของลูกค้าบนแผนที่ (สถานที่) เพื่อให้คำแนะนำครั้งต่อไปใช้ได้"],
  check_paperwork_or_driver: ["Compare with the delivery paperwork or ask the driver: positions are not verified GPS, or the stop is only near the booked point", "เทียบกับเอกสารส่งของหรือสอบถามคนขับ เพราะตำแหน่งไม่ใช่ GPS ที่ยืนยันหรือเป็นเพียงการหยุดใกล้จุดที่จอง"],
  complete_booking_details: ["Add the missing booking details (work order, pickup time, vehicle) so jobs can be matched", "เพิ่มรายละเอียดการจองที่ขาด (เลขใบงาน เวลารับ รถ) เพื่อให้จับคู่งานได้"],
  look_at_other_long_stops: ["Look at the other long stops listed: the vehicle may have used a different entrance or place", "ดูการหยุดนานอื่นที่แสดงไว้ รถอาจใช้ทางเข้าหรือสถานที่อื่น"],
  nothing_to_review_yet: ["Nothing to act on yet", "ยังไม่มีสิ่งที่ต้องดำเนินการ"]
};
export const missingEvidenceLabel = (m: MissingEvidence, l: Lang) => pick(MISSING_EVIDENCE_COPY[m], l);
export const reviewActionLabel = (a: ReviewAction, l: Lang) => pick(REVIEW_ACTION_COPY[a], l);

type GuidanceJob = { bookingAssignment: string; pickupTime: string | null; workOrder: string | null; scheduledPickup: unknown; scheduledDelivery: unknown; bookingVehicleConflict?: string | null; possibleDuplicateBooking?: boolean; visitRecognition: JobRecognition | null };

export function buildReviewGuidance(job: GuidanceJob): { missing: MissingEvidence[]; actions: ReviewAction[] } {
  const missing: MissingEvidence[] = [];
  if (!job.workOrder) missing.push("no_work_order");
  if (!job.pickupTime) missing.push("no_pickup_time");
  if (job.bookingAssignment !== "stable_vehicle_id") missing.push("no_vehicle_id");
  if (!job.scheduledPickup) missing.push("no_pickup_coordinates");
  if (!job.scheduledDelivery) missing.push("no_delivery_coordinates");
  if (job.bookingVehicleConflict) missing.push("vehicle_text_conflict");
  if (job.possibleDuplicateBooking) missing.push("possible_duplicate_booking");
  const actions: ReviewAction[] = [];
  if (job.bookingVehicleConflict) actions.push("check_vehicle_assignment");
  if (job.possibleDuplicateBooking) actions.push("check_duplicate_booking");
  const r = job.visitRecognition;
  if (r) {
    const roles = [r.pickup, r.delivery];
    const candidates = roles.flatMap(x => x.candidates);
    const anyUnverified = candidates.some(c => c.sourceQuality !== "verified_gps");
    if (candidates.length > 0 && candidates.every(c => c.sourceQuality === "unverified")) missing.push("positions_unverified");
    if (candidates.some(c => c.reasons.includes("unreviewed_booking_point"))) missing.push("booked_point_unreviewed");
    if (job.scheduledPickup && r.pickup.candidates.length === 0) missing.push("no_pickup_evidence");
    if (job.scheduledDelivery && r.delivery.candidates.length === 0) missing.push("no_delivery_evidence");
    if (roles.some(x => x.summary === "competing_candidates")) actions.push("choose_between_candidates");
    const inSearchZone = roles.some(x => x.candidates.length > 0 && x.candidates[0].zone === "search");
    if (inSearchZone) actions.push("verify_location_pin");
    if (anyUnverified || inSearchZone) actions.push("check_paperwork_or_driver");
    if (roles.some(x => x.candidates.length === 0 && x.otherLongStops.length > 0)) actions.push("look_at_other_long_stops");
  }
  if (!job.workOrder || !job.pickupTime || job.bookingAssignment !== "stable_vehicle_id" || !job.scheduledPickup || !job.scheduledDelivery) actions.push("complete_booking_details");
  const unique = [...new Set(actions)].slice(0, 4);
  return { missing: [...new Set(missing)], actions: unique.length ? unique : ["nothing_to_review_yet"] };
}
