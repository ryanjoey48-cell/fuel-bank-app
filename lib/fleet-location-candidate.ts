/**
 * V6.5 candidate handoff from Fleet Intelligence to the Locations Directory. Pure helpers shared by the server routes and the UI.
 *
 * A candidate is an UNSAVED suggestion built from recurring vehicle-stop evidence. It is never a verified location, never a
 * customer, loading point or warehouse, and it carries no raw positions, device ids or user ids. The browser never supplies the
 * coordinates: the server recomputes the area from the caller's own cached days and only checks that the client meant that area.
 */
import { metersBetween } from "./fleet-job-movement";
import type { RecurringArea } from "./fleet-recurring-areas";

export const HANDOFF_TTL_MS = 10 * 60_000;
export const HANDOFF_MAX_PER_USER = 10;
export const HANDOFF_MAX_TOTAL = 200;
/** The client's expected position of the clicked area may differ from the server's by at most this much (the list may have refreshed). */
export const HANDOFF_EXPECTED_TOLERANCE_M = 50;

export const TOKEN_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const AREA_ID_PATTERN = /^RA-\d{2,3}$/;
export const isHandoffToken = (value: unknown): value is string => typeof value === "string" && TOKEN_PATTERN.test(value);
export const isAreaId = (value: unknown): value is string => typeof value === "string" && AREA_ID_PATTERN.test(value);
export const isValidCoordinate = (latitude: unknown, longitude: unknown): latitude is number =>
  typeof latitude === "number" && typeof longitude === "number" && Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180 && !(latitude === 0 && longitude === 0);

export type CandidatePayload = {
  version: 1;
  label: "suggested_from_vehicle_evidence";
  createdAt: string;
  expiresAt: string;
  area: { id: string; latitude: number; longitude: number; radiusM: number; kind: RecurringArea["kind"]; placeHint: RecurringArea["placeHint"] };
  evidence: {
    distinctDays: number; visits: number; vehicleDays: number; vehicles: string[]; days: string[]; firstSeen: string; lastSeen: string;
    stayMinutes: RecurringArea["stayMinutes"]; quality: RecurringArea["quality"]; visitsNextToGap: number; daysWithKnownMissingTracking: number;
    flags: RecurringArea["flags"]; nearestOtherAreaM: number | null;
  };
  matches: RecurringArea["matches"];
  sample: { from: string; to: string; vehicleDaysIncluded: number; vehicleDaysInRange: number };
  limits: string[];
};

const r6 = (n: number) => Math.round(n * 1e6) / 1e6;

/** Summary only: no positions, no device ids, no user ids. Coordinates are the area centre computed on the server. */
export function buildCandidatePayload(input: { area: RecurringArea; from: string; to: string; vehicleDaysIncluded: number; vehicleDaysInRange: number; limits: readonly string[]; now?: number }): CandidatePayload {
  const { area } = input; const now = input.now ?? Date.now();
  return {
    version: 1, label: "suggested_from_vehicle_evidence", createdAt: new Date(now).toISOString(), expiresAt: new Date(now + HANDOFF_TTL_MS).toISOString(),
    area: { id: area.id, latitude: r6(area.centroid.latitude), longitude: r6(area.centroid.longitude), radiusM: area.radiusM, kind: area.kind, placeHint: area.placeHint },
    evidence: { distinctDays: area.distinctDays, visits: area.visits, vehicleDays: area.vehicleDays, vehicles: [...area.vehicles], days: [...area.days], firstSeen: area.firstSeen, lastSeen: area.lastSeen, stayMinutes: area.stayMinutes, quality: area.quality, visitsNextToGap: area.visitsNextToGap, daysWithKnownMissingTracking: area.daysWithKnownMissingTracking, flags: [...area.flags], nearestOtherAreaM: area.nearestOtherAreaM },
    matches: area.matches.map(m => ({ ...m })),
    sample: { from: input.from, to: input.to, vehicleDaysIncluded: input.vehicleDaysIncluded, vehicleDaysInRange: input.vehicleDaysInRange },
    limits: [...input.limits]
  };
}

/** Does the area the server found match the one the person clicked? Used only as a consistency check, never as a source of coordinates. */
export function expectedAreaMatches(expected: { latitude?: unknown; longitude?: unknown } | null | undefined, area: { centroid: { latitude: number; longitude: number } }): boolean {
  if (!expected || !isValidCoordinate(expected.latitude, expected.longitude)) return false;
  return metersBetween({ latitude: expected.latitude as number, longitude: expected.longitude as number }, area.centroid) <= HANDOFF_EXPECTED_TOLERANCE_M;
}

export type KnownLocation = { id: string; name: string; category?: string | null; latitude: number; longitude: number; verifiedPin: boolean };
export type NearbyKnown = { id: string; name: string; category: string | null; distanceM: number; verifiedPin: boolean };
/** Existing directory records near the candidate, nearest first. Compared only; nothing is associated, merged or edited. */
export function nearbyKnownLocations(point: { latitude: number; longitude: number }, known: readonly KnownLocation[], radiusM = 500, limit = 5): NearbyKnown[] {
  if (!isValidCoordinate(point.latitude, point.longitude)) return [];
  return known.filter(k => isValidCoordinate(k.latitude, k.longitude)).map(k => ({ id: k.id, name: k.name, category: k.category ?? null, distanceM: Math.round(metersBetween(point, k)), verifiedPin: k.verifiedPin }))
    .filter(k => k.distanceM <= radiusM).sort((a, b) => a.distanceM - b.distanceM || (a.id < b.id ? -1 : 1)).slice(0, limit);
}

type Pair = readonly [string, string];
export const CANDIDATE_COPY = {
  heading: ["Suggested from vehicle evidence", "ข้อเสนอจากหลักฐานของรถ"],
  notSaved: ["Suggested location — not saved or verified.", "ตำแหน่งที่เสนอ — ยังไม่ได้บันทึกหรือยืนยัน"],
  notCustomer: ["This is a place where vehicles stopped. It is not a confirmed customer, loading bay, warehouse or delivery location.", "นี่คือจุดที่รถจอด ยังไม่ใช่ลูกค้า จุดขนถ่าย คลังสินค้า หรือจุดส่งที่ยืนยันแล้ว"],
  reviewLocation: ["Review location", "ตรวจสอบสถานที่"],
  opening: ["Opening…", "กำลังเปิด…"],
  reviewedDays: ["Reviewed days", "วันที่ตรวจสอบ"], vehicles: ["Vehicles observed", "รถที่พบ"], visits: ["Visits", "จำนวนครั้ง"],
  firstLast: ["First and last observed visit", "การจอดครั้งแรกและครั้งล่าสุดที่พบ"], stay: ["Observed stay (shortest, typical, longest supported)", "เวลาจอดที่สังเกตได้ (สั้นสุด ปกติ นานสุดที่รองรับ)"],
  gps: ["GPS verification of the stops", "การยืนยัน GPS ของจุดจอด"], minutes: ["min", "นาที"],
  verified: ["verified GPS", "GPS ที่ยืนยัน"], mixed: ["partly verified", "ยืนยันบางส่วน"], unverified: ["not verified GPS", "ไม่ใช่ GPS ที่ยืนยัน"],
  provenance: ["Provenance", "ที่มา"],
  provenanceText: ["Built from repeated spatial evidence of vehicle stops. Repetition does not verify unverified positions. It is a user-reviewed, unsaved candidate until an authorised person saves a pin with the existing workflow.", "สร้างจากหลักฐานเชิงพื้นที่ที่จอดซ้ำของรถ การเกิดซ้ำไม่ได้ทำให้ตำแหน่งที่ไม่ยืนยันกลายเป็นยืนยัน เป็นตัวเลือกที่ยังไม่บันทึกจนกว่าผู้มีสิทธิ์จะบันทึกหมุดตามขั้นตอนเดิม"],
  nearby: ["Nearby locations in the directory", "สถานที่ใกล้เคียงในสมุดรายชื่อ"],
  nearbyNone: ["Unknown stopping area: no directory location is near enough to explain it.", "ไม่ทราบจุดจอด: ไม่มีสถานที่ในสมุดรายชื่ออยู่ใกล้พอที่จะอธิบายได้"],
  nearbyMany: ["Several nearby locations could explain this stop; none is chosen automatically.", "มีหลายสถานที่ใกล้เคียงที่อาจอธิบายจุดจอดนี้ ระบบไม่เลือกให้โดยอัตโนมัติ"],
  verifiedPin: ["office-verified pin", "หมุดที่สำนักงานยืนยัน"], noVerifiedPin: ["no verified pin", "ไม่มีหมุดที่ยืนยัน"],
  keepUnsaved: ["Keep unsaved", "เก็บไว้โดยไม่บันทึก"], dismiss: ["Dismiss", "ปิดข้อเสนอ"], copy: ["Copy coordinates", "คัดลอกพิกัด"], copied: ["Copied", "คัดลอกแล้ว"],
  useCandidate: ["Use as unsaved candidate position", "ใช้เป็นตำแหน่งตัวเลือกที่ยังไม่บันทึก"], compare: ["Compare with an existing location", "เปรียบเทียบกับสถานที่ที่มีอยู่"], comparePick: ["Choose a location", "เลือกสถานที่"],
  back: ["Back to Fleet Tracking", "กลับไปติดตามรถ"], uncertainty: ["What is uncertain", "สิ่งที่ยังไม่แน่ใจ"],
  limitedSample: ["Based only on vehicle-days read in that session; other days are unknown.", "อิงเฉพาะวันที่อ่านไว้ในเซสชันนั้น วันอื่นไม่ทราบ"],
  expired: ["This suggestion has expired. Open it again from Fleet Tracking Reports.", "ข้อเสนอนี้หมดอายุแล้ว โปรดเปิดใหม่จากรายงานในหน้าติดตามรถ"],
  forbidden: ["Candidate locations use historical journeys and need administrator authorisation.", "ตำแหน่งที่เสนอใช้ประวัติการเดินทาง ต้องได้รับอนุญาตจากผู้ดูแลระบบ"],
  failed: ["The suggestion could not be opened.", "เปิดข้อเสนอไม่ได้"],
  readOnly: ["Your account can view this suggestion but cannot save pins.", "บัญชีของคุณดูข้อเสนอได้แต่บันทึกหมุดไม่ได้"],
  dismissed: ["The suggestion was dismissed for this review. Nothing was saved.", "ปิดข้อเสนอแล้ว ไม่มีการบันทึกใดๆ"],
  transient: ["This suggestion is held in server memory for a few minutes only. It is lost after it expires, on a server restart or if you dismiss it, and a browser refresh within that time reopens nothing because the link is cleared.", "ข้อเสนอนี้อยู่ในหน่วยความจำของเซิร์ฟเวอร์เพียงไม่กี่นาที จะหายเมื่อหมดอายุ เมื่อรีสตาร์ตเซิร์ฟเวอร์ หรือเมื่อปิดข้อเสนอ และการรีเฟรชหน้าจะไม่เปิดซ้ำเพราะล้างลิงก์แล้ว"],
  markerLabel: ["Suggested from vehicle evidence (not saved)", "ข้อเสนอจากหลักฐานของรถ (ยังไม่บันทึก)"]
} as const satisfies Record<string, Pair>;
export type CandidateCopyKey = keyof typeof CANDIDATE_COPY;
export const candidateText = (key: CandidateCopyKey, language: "en" | "th") => CANDIDATE_COPY[key][language === "th" ? 1 : 0];
