/** V5 wording and the office review queue for job movements. Pure and bilingual: [English, Thai]. Nothing here is stored. */
import type { JobMovement, MovementEvent, MovementEventStatus, MovementReason, MovementStage } from "./fleet-job-movement";
import type { JourneyJobMatch } from "./fleet-journey-ledger";

type Lang = "en" | "th";
const pick = (pair: readonly [string, string], language: Lang) => (language === "th" ? pair[1] : pair[0]);

export const MOVEMENT_STAGE_COPY: Record<MovementStage, readonly [string, string]> = {
  pickup_arrival: ["Pickup arrival", "ถึงจุดรับ"],
  pickup_departure: ["Pickup departure", "ออกจากจุดรับ"],
  delivery_arrival: ["Delivery arrival", "ถึงจุดส่ง"],
  delivery_departure: ["Delivery departure", "ออกจากจุดส่ง"]
};
export const MOVEMENT_STATUS_COPY: Record<MovementEventStatus, readonly [string, string]> = {
  verified_gps: ["Verified GPS", "GPS ที่ยืนยันแล้ว"],
  provider_reported_unverified: ["Reported, not verified", "ผู้ให้บริการรายงาน ยังไม่ยืนยัน"],
  office_confirmed: ["Office confirmed", "สำนักงานยืนยัน"],
  estimated: ["Estimated window", "ช่วงเวลาโดยประมาณ"],
  missing: ["Missing", "ไม่มีข้อมูล"]
};
export const MOVEMENT_REASON_COPY: Record<MovementReason, readonly [string, string]> = {
  no_booked_coordinates: ["The booking has no coordinates for this location", "การจองไม่มีพิกัดของจุดนี้"],
  no_position_evidence: ["No vehicle positions were read for this day", "ยังไม่ได้อ่านตำแหน่งรถของวันนี้"],
  never_within_radius: ["The vehicle was never observed within 150 m of this location", "ไม่พบรถภายใน 150 ม. จากจุดนี้"],
  no_observation_before_arrival: ["No earlier position, so the true arrival may be before this time", "ไม่มีตำแหน่งก่อนหน้า เวลาถึงจริงอาจเร็วกว่านี้"],
  window_wider_than_reporting_interval: ["Positions around this event are more than 5 minutes apart, so the time is a window", "ตำแหน่งรอบเหตุการณ์ห่างกันเกิน 5 นาที จึงเป็นช่วงเวลา"],
  no_observation_after_departure: ["No position after the vehicle left, so the departure time is unknown", "ไม่มีตำแหน่งหลังรถออก จึงไม่ทราบเวลาออก"],
  still_at_location_at_end_of_evidence: ["The last position is still at this location", "ตำแหน่งล่าสุดยังอยู่ที่จุดนี้"],
  multiple_visits_need_office_selection: ["The vehicle visited this location more than once; the office must choose which visit belongs to this job", "รถมาที่จุดนี้หลายครั้ง สำนักงานต้องเลือกครั้งที่ตรงกับงานนี้"],
  pickup_and_delivery_locations_overlap: ["Pickup and delivery are too close to tell apart", "จุดรับและจุดส่งอยู่ใกล้กันเกินกว่าจะแยกได้"],
  pickup_not_found: ["The pickup visit was not found", "ไม่พบการมาถึงจุดรับ"],
  passed_without_stopping: ["The vehicle only drove past within 150 m (brief and moving), so no arrival is claimed; the time it passed is shown", "รถเพียงขับผ่านในระยะ 150 ม. (สั้นและเคลื่อนที่) จึงไม่ระบุว่าถึง แสดงเวลาที่ขับผ่าน"],
  later_visits_at_location: ["The vehicle returned here later; the first visit after pickup is used, which may need checking", "รถกลับมาที่จุดนี้อีกภายหลัง ใช้ครั้งแรกหลังจุดรับ อาจต้องตรวจสอบ"],
  delivery_before_pickup: ["The only delivery visit is before the pickup, so it is not used", "การมาถึงจุดส่งทั้งหมดอยู่ก่อนจุดรับ จึงไม่ใช้"],
  used_unverified_positions: ["Based on reported positions without a verified GPS fix", "อ้างอิงตำแหน่งที่รายงานซึ่งไม่มี GPS ที่ยืนยัน"],
  scheduled_time_unavailable: ["No scheduled pickup time on the booking", "การจองไม่มีเวลารับตามแผน"],
  pickup_event_missing_so_order_unchecked: ["Pickup was not found, so the delivery order could not be checked", "ไม่พบจุดรับ จึงตรวจลำดับจุดส่งไม่ได้"]
};
export const movementStageLabel = (s: MovementStage, l: Lang) => pick(MOVEMENT_STAGE_COPY[s], l);
export const movementStatusLabel = (s: MovementEventStatus, l: Lang) => pick(MOVEMENT_STATUS_COPY[s], l);
export const movementReasonLabel = (r: MovementReason, l: Lang) => pick(MOVEMENT_REASON_COPY[r], l);

export function formatBangkokTime(iso: string | null, language: Lang): string | null {
  if (!iso || !Number.isFinite(Date.parse(iso))) return null;
  return new Intl.DateTimeFormat(language === "th" ? "th-TH" : "en-GB", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
}
/** "between 10:05 and 10:15", "at or before 10:15", or null. */
export function describeWindow(event: MovementEvent, language: Lang): string | null {
  if (!event.window) return null;
  const from = formatBangkokTime(event.window.from, language), to = formatBangkokTime(event.window.to, language);
  if (from && to) return language === "th" ? `ระหว่าง ${from} และ ${to}` : `between ${from} and ${to}`;
  if (to) return language === "th" ? `ไม่เกิน ${to}` : `at or before ${to}`;
  if (from) return language === "th" ? `หลัง ${from}` : `after ${from}`;
  return null;
}

/* ------------------------------------------------------------------------------------------ review queue */

export type ReviewReason = "match_ambiguous" | "no_journey_found" | "candidate_not_confirmed" | "movement_missing" | "movement_estimated" | "movement_unverified" | "no_coordinates" | "no_pickup_time" | "movement_not_read";
export type ReviewItem = { jobId: string; label: string; priority: 1 | 2 | 3; reasons: ReviewReason[] };

/**
 * Builds the office review queue from the existing match result and the movement timeline. Highest priority first:
 * 1 = needs a person to decide (ambiguous or conflicting), 2 = evidence missing, 3 = evidence is usable but not confirmed.
 * A job with nothing to review is left out. Reading this list changes nothing.
 */
export function buildReviewQueue(jobs: readonly { jobId: string; workOrder: string | null; pickupTime: string | null; scheduledPickup: unknown; scheduledDelivery: unknown; movement: JobMovement | null }[], matches: readonly JourneyJobMatch[]): ReviewItem[] {
  const byId = new Map(matches.map(m => [m.jobId, m]));
  const items: ReviewItem[] = [];
  for (const job of jobs) {
    const m = byId.get(job.jobId); const reasons: ReviewReason[] = [];
    if (m?.status === "needs_review") reasons.push("match_ambiguous");
    if (m?.status === "no_journey") reasons.push("no_journey_found");
    if (m?.status === "candidate") reasons.push("candidate_not_confirmed");
    if (!job.pickupTime) reasons.push("no_pickup_time");
    if (!job.scheduledPickup || !job.scheduledDelivery) reasons.push("no_coordinates");
    if (!job.movement) reasons.push("movement_not_read");
    else {
      const events = job.movement.events;
      if (events.some(e => e.status === "missing" && e.reasons.includes("multiple_visits_need_office_selection"))) reasons.push("match_ambiguous");
      if (events.some(e => e.status === "missing")) reasons.push("movement_missing");
      if (events.some(e => e.status === "estimated")) reasons.push("movement_estimated");
      if (events.some(e => e.status === "provider_reported_unverified")) reasons.push("movement_unverified");
    }
    const unique = [...new Set(reasons)];
    if (!unique.length) continue;
    const priority: ReviewItem["priority"] = unique.includes("match_ambiguous") ? 1 : unique.some(r => r === "no_journey_found" || r === "movement_missing" || r === "no_coordinates" || r === "no_pickup_time" || r === "movement_not_read") ? 2 : 3;
    items.push({ jobId: job.jobId, label: job.workOrder ?? job.jobId, priority, reasons: unique });
  }
  return items.sort((a, b) => a.priority - b.priority || a.label.localeCompare(b.label));
}

export const REVIEW_REASON_COPY: Record<ReviewReason, readonly [string, string]> = {
  match_ambiguous: ["Ambiguous: the office must choose", "ไม่ชัดเจน: สำนักงานต้องเลือก"],
  no_journey_found: ["No journey matches this booking", "ไม่พบเที่ยวที่ตรงกับการจองนี้"],
  candidate_not_confirmed: ["Candidate match, not confirmed", "งานที่อาจตรงกัน ยังไม่ยืนยัน"],
  movement_missing: ["Some arrival or departure times are missing", "ขาดเวลาถึงหรือออกบางรายการ"],
  movement_estimated: ["Some times are estimated windows", "บางเวลาเป็นช่วงโดยประมาณ"],
  movement_unverified: ["Some times use unverified positions", "บางเวลาใช้ตำแหน่งที่ยังไม่ยืนยัน"],
  no_coordinates: ["Booking lacks pickup or delivery coordinates", "การจองไม่มีพิกัดจุดรับหรือจุดส่ง"],
  no_pickup_time: ["No scheduled pickup time", "ไม่มีเวลารับตามแผน"],
  movement_not_read: ["Read the Forth day to derive times", "อ่านรายงาน Forth ของวันนี้เพื่อหาเวลา"]
};
export const reviewReasonLabel = (r: ReviewReason, l: Lang) => pick(REVIEW_REASON_COPY[r], l);

/* ------------------------------------------------------------------------------------------ V5.1 / V5.2 wording */
import type { SiteClass, SiteReason } from "./fleet-stop-intelligence";
import type { PointProvenance } from "./fleet-location-priority";

export const SITE_CLASS_COPY: Record<SiteClass, readonly [string, string]> = {
  A_office_confirmed: ["A · Office-confirmed visit", "A · สำนักงานยืนยันการเข้าพื้นที่"],
  B_gps_supported_probable: ["B · Probable visit, supported by verified GPS (algorithmic, not confirmed)", "B · น่าจะเข้าพื้นที่ มี GPS ที่ยืนยันสนับสนุน (คำนวณโดยระบบ ยังไม่ยืนยัน)"],
  C_provider_reported_probable: ["C · Probable visit from provider-reported, unverified positions (not confirmed)", "C · น่าจะเข้าพื้นที่ จากตำแหน่งที่ผู้ให้บริการรายงานและยังไม่ยืนยัน (ยังไม่ยืนยัน)"],
  D_possible_incomplete_telemetry: ["D · Possible visit, telemetry incomplete", "D · อาจเข้าพื้นที่ ข้อมูลติดตามไม่ครบ"],
  E_drive_by: ["E · Drive-by: passed without stopping", "E · ขับผ่านโดยไม่จอด"],
  F_ambiguous_multiple: ["F · Ambiguous: several candidate visits", "F · ไม่ชัดเจน: มีหลายครั้งที่อาจเป็นการเข้าพื้นที่"],
  G_no_usable_evidence: ["G · No usable evidence", "G · ไม่มีหลักฐานที่ใช้ได้"]
};
export const SITE_REASON_COPY: Record<SiteReason, readonly [string, string]> = {
  office_confirmed_input: ["The office confirmed this visit", "สำนักงานยืนยันการเข้าพื้นที่นี้"],
  stop_near_site_verified_positions: ["A stop of two or more verified positions lies inside the boundary", "มีการหยุดอย่างน้อยสองตำแหน่งที่ยืนยันแล้วภายในขอบเขต"],
  stop_near_site_unverified_positions: ["The stop rests on positions without a verified GPS fix", "การหยุดอ้างอิงตำแหน่งที่ไม่มี GPS ที่ยืนยัน"],
  stop_next_to_telemetry_gap: ["The stop begins or ends beside a gap in tracking, so the visit is incomplete", "การหยุดเริ่มหรือจบถัดจากช่วงที่ข้อมูลติดตามขาด จึงไม่สมบูรณ์"],
  stop_windows_wider_than_tolerance: ["Positions around the stop are more than 6 minutes apart, so the windows are wide", "ตำแหน่งรอบการหยุดห่างกันเกิน 6 นาที ช่วงเวลาจึงกว้าง"],
  single_observation_only: ["Only one position lies inside the boundary, which cannot prove a stop", "มีเพียงหนึ่งตำแหน่งในขอบเขต ไม่พอพิสูจน์การหยุด"],
  slow_movement_not_a_stop: ["Slow, still-travelling movement (traffic or manoeuvring) is not a stop", "การเคลื่อนที่ช้าที่ยังเดินทางอยู่ (รถติดหรือกลับรถ) ไม่ใช่การหยุด"],
  drove_past_at_speed: ["The vehicle drove past the boundary at speed", "รถขับผ่านขอบเขตด้วยความเร็ว"],
  several_stops_near_site: ["More than one stop lies near the site; the office must choose", "มีการหยุดหลายครั้งใกล้จุดนี้ สำนักงานต้องเลือก"],
  no_positions_near_site: ["No positions near the site", "ไม่มีตำแหน่งใกล้จุดนี้"],
  no_observations_at_all: ["No positions were read for this day", "ไม่ได้อ่านตำแหน่งของวันนี้"],
  never_within_search_radius: ["The vehicle never came near this point", "รถไม่เคยเข้าใกล้จุดนี้"],
  booked_point_unverified: ["The point comes from the booking and has not been verified by the office", "จุดนี้มาจากการจองและสำนักงานยังไม่ตรวจสอบ"],
  mixed_source_quality: ["Some positions are verified and some are not, so it cannot count as GPS supported", "บางตำแหน่งยืนยันแล้วและบางตำแหน่งยังไม่ยืนยัน จึงนับว่า GPS สนับสนุนไม่ได้"]
};
export const POINT_PROVENANCE_COPY: Record<PointProvenance, readonly [string, string]> = {
  office_verified_loading_point: ["Office-verified loading point", "จุดขนถ่ายที่สำนักงานยืนยัน"],
  office_verified_entrance: ["Office-verified vehicle entrance", "ทางเข้ารถที่สำนักงานยืนยัน"],
  office_verified_site_location: ["Office-verified site location", "ตำแหน่งสถานที่ที่สำนักงานยืนยัน"],
  booking_coordinate_unverified: ["Booking coordinate, not verified", "พิกัดจากการจอง ยังไม่ตรวจสอบ"],
  missing: ["No location available", "ไม่มีตำแหน่ง"]
};
export const siteClassLabel = (c: SiteClass, l: Lang) => pick(SITE_CLASS_COPY[c], l);
export const siteReasonLabel = (r: SiteReason, l: Lang) => pick(SITE_REASON_COPY[r], l);
export const pointProvenanceLabel = (p: PointProvenance, l: Lang) => pick(POINT_PROVENANCE_COPY[p], l);
export function formatDwell(minMs: number, maxMs: number | null, language: Lang): string {
  const m = (v: number) => Math.round(v / 60_000);
  return maxMs === null ? (language === "th" ? `อย่างน้อย ${m(minMs)} นาที (ไม่ทราบค่าสูงสุด)` : `at least ${m(minMs)} min (upper bound unknown)`) : (language === "th" ? `${m(minMs)} ถึง ${m(maxMs)} นาที` : `${m(minMs)} to ${m(maxMs)} min`);
}

/* ------------------------------------------------------------------------------------------ V5.4 visit recognition wording */
import type { VisitAlternative, VisitConfidence, VisitReason, VisitSummaryClass } from "./fleet-visit-recognition";

export const VISIT_SUMMARY_COPY: Record<VisitSummaryClass, readonly [string, string]> = {
  probable_visit: ["Probable visit (suggested by EES, not confirmed)", "น่าจะเข้าพื้นที่ (ระบบแนะนำ ยังไม่ยืนยัน)"],
  possible_visit: ["Possible visit (suggested, weaker evidence, not confirmed)", "อาจเข้าพื้นที่ (ระบบแนะนำ หลักฐานอ่อนกว่า ยังไม่ยืนยัน)"],
  competing_candidates: ["Several competing candidates: the office must choose", "มีหลายตัวเลือกที่แข่งกัน สำนักงานต้องเลือก"],
  drive_by_rejected: ["Drive-by rejected: the vehicle only passed", "ปฏิเสธ: รถเพียงขับผ่าน"],
  no_reliable_evidence: ["No reliable evidence", "ไม่มีหลักฐานที่เชื่อถือได้"]
};
export const VISIT_CONFIDENCE_COPY: Record<VisitConfidence, readonly [string, string]> = { high: ["high", "สูง"], medium: ["medium", "ปานกลาง"], low: ["low", "ต่ำ"] };
export const VISIT_REASON_COPY: Record<VisitReason, readonly [string, string]> = {
  direct_boundary_stop: ["Stopped inside the site boundary", "จอดภายในขอบเขตสถานที่"],
  found_in_search_zone_only: ["Found only in the wider search area around an unreviewed point, so it is near the booked point, not proven at it", "พบเฉพาะในพื้นที่ค้นหาที่กว้างกว่า รอบจุดที่ยังไม่ตรวจสอบ จึงอยู่ใกล้จุดที่จอง ไม่ใช่หลักฐานว่าอยู่ที่จุดนั้น"],
  long_stay: ["Long stay (20 minutes or more observed)", "อยู่นาน (สังเกตได้ 20 นาทีขึ้นไป)"],
  moderate_stay: ["Moderate stay (5 to 20 minutes observed)", "อยู่ปานกลาง (สังเกตได้ 5 ถึง 20 นาที)"],
  short_stay: ["Short stay (under 5 minutes observed)", "อยู่สั้น (สังเกตได้ไม่ถึง 5 นาที)"],
  verified_gps_positions: ["Verified GPS positions", "ตำแหน่ง GPS ที่ยืนยันแล้ว"],
  mixed_positions: ["Some positions are not verified GPS", "บางตำแหน่งไม่ใช่ GPS ที่ยืนยัน"],
  provider_reported_unverified_positions: ["Positions are provider-reported and not verified GPS", "ตำแหน่งเป็นค่าที่ผู้ให้บริการรายงานและไม่ได้ยืนยัน GPS"],
  windows_tight: ["Arrival and departure windows are narrow", "ช่วงเวลาถึงและออกแคบ"],
  arrival_or_departure_unknown: ["Arrival or departure is unknown (edge of the day's data)", "ไม่ทราบเวลาถึงหรือออก (ชายขอบของข้อมูลวันนี้)"],
  next_to_tracking_gap: ["Next to a gap in tracking; the gap is not counted as time on site", "ติดกับช่วงที่ข้อมูลติดตามขาด ไม่นับช่วงนั้นเป็นเวลาอยู่ที่จุด"],
  touches_edge_of_day_data: ["Touches the start or end of the day's data", "ชนต้นหรือท้ายของข้อมูลวันนี้"],
  merged_adjacent_stops: ["Adjacent stops at the same place merged into one visit (short interruption, continuous tracking)", "รวมการหยุดที่ติดกันในที่เดียวกันเป็นการเข้าพื้นที่ครั้งเดียว (หยุดชะงักสั้น ข้อมูลต่อเนื่อง)"],
  fits_scheduled_time: ["Arrival fits the scheduled pickup time", "เวลาถึงสอดคล้องกับเวลารับตามแผน"],
  outside_scheduled_time: ["Arrival is far from the scheduled pickup time", "เวลาถึงห่างจากเวลารับตามแผนมาก"],
  no_scheduled_time: ["The booking has no scheduled pickup time, so timing was not used", "การจองไม่มีเวลารับตามแผน จึงไม่ใช้เวลาประกอบ"],
  unreviewed_booking_point: ["The booked point has not been reviewed by the office", "สำนักงานยังไม่ได้ตรวจสอบจุดที่จอง"],
  may_belong_to_neighbouring_site: ["May belong to a neighbouring site", "อาจเป็นของสถานที่ข้างเคียง"],
  competing_candidate: ["Another candidate scores almost the same", "มีตัวเลือกอื่นคะแนนใกล้เคียงกัน"],
  shared_with_another_job: ["The same visit is the best match for another job that day", "การเข้าพื้นที่เดียวกันเป็นตัวเลือกที่ดีที่สุดของอีกงานหนึ่งในวันนั้น"],
  follows_pickup: ["Comes after the pickup candidate", "เกิดหลังตัวเลือกจุดรับ"],
  before_pickup: ["Happens before the pickup candidate, so it is down-weighted", "เกิดก่อนตัวเลือกจุดรับ จึงลดน้ำหนัก"],
  confidence_capped_unverified: ["Confidence is capped because the positions are not all verified GPS", "จำกัดระดับความเชื่อมั่น เพราะตำแหน่งไม่ได้ยืนยัน GPS ทั้งหมด"],
  confidence_capped_search_zone: ["Confidence is capped because it was found in the search area, not at a verified point", "จำกัดระดับความเชื่อมั่น เพราะพบในพื้นที่ค้นหา ไม่ใช่ที่จุดที่ยืนยัน"]
};
export const VISIT_ALTERNATIVE_COPY: Record<VisitAlternative, readonly [string, string]> = {
  loading_or_unloading_not_proven: ["Time on site is not loading or unloading time", "เวลาที่อยู่ไม่ใช่เวลาขนถ่าย"],
  queueing_or_waiting_outside_gate: ["Could be queueing or waiting outside the gate", "อาจเป็นการต่อคิวหรือรอหน้าประตู"],
  rest_or_break: ["Could be a rest or break", "อาจเป็นการพัก"],
  neighbouring_site: ["Could be a neighbouring site", "อาจเป็นสถานที่ข้างเคียง"],
  fuel_or_service_stop: ["Could be a fuel or service stop", "อาจเป็นการเติมน้ำมันหรือบริการ"],
  unrelated_stop_on_route: ["Could be an unrelated stop on the route", "อาจเป็นการหยุดอื่นระหว่างเส้นทาง"]
};
export const visitSummaryLabel = (c: VisitSummaryClass, l: Lang) => pick(VISIT_SUMMARY_COPY[c], l);
export const visitConfidenceLabel = (c: VisitConfidence, l: Lang) => pick(VISIT_CONFIDENCE_COPY[c], l);
export const visitReasonLabel = (r: VisitReason, l: Lang) => pick(VISIT_REASON_COPY[r], l);
export const visitAlternativeLabel = (a: VisitAlternative, l: Lang) => pick(VISIT_ALTERNATIVE_COPY[a], l);
