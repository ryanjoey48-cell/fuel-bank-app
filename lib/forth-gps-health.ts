/**
 * GPS health for one Forth current-position record. Pure and read-only.
 *
 * It does NOT change what counts as a verified position (that stays in isForthGpsPositionVerified: fresh, valid
 * coordinates, GPS field ON and positionSource "GPS"). It explains why a position is or is not verified, and it keeps
 * distinct conditions distinct: tracker connection (GPRS), the documented GPS field, Forth's separate positionSource
 * label, coordinate validity and freshness.
 */
import type { ForthFleetTrackingRecord } from "./forth-tracking-server";
import { getForthReportedActivity, isForthGpsPositionVerified } from "./forth-tracking-view";

export type GpsHealthLetter = "A" | "B" | "C" | "D" | "E" | "F" | "G";
export type GpsHealthCode =
  | "verified_fresh_gps"
  | "gps_signal_off_tracker_online"
  | "stale_last_known_position"
  | "coordinates_missing" | "coordinates_invalid"
  | "tracker_offline"
  | "device_or_registration_missing" | "gps_or_gprs_status_unreadable" | "position_time_unreadable"
  | "gps_on_source_no_gps" | "gps_on_source_unrecognised" | "gps_on_source_not_gps";
export type GpsHealth = { letter: GpsHealthLetter; code: GpsHealthCode; verified: boolean };

const TITLES: Record<GpsHealthLetter, { en: string; th: string }> = {
  A: { en: "Verified fresh GPS", th: "GPS ยืนยันแล้วและเป็นปัจจุบัน" },
  B: { en: "Tracker online, GPS signal unavailable", th: "ตัวติดตามออนไลน์ แต่ไม่มีสัญญาณ GPS" },
  C: { en: "Stale last-known position", th: "ตำแหน่งล่าสุดที่เก่าเกินไป" },
  D: { en: "Coordinates missing or invalid", th: "พิกัดหายหรือไม่ถูกต้อง" },
  E: { en: "Tracker offline", th: "ตัวติดตามออฟไลน์" },
  F: { en: "Mapping or reading problem", th: "ปัญหาการจับคู่หรืออ่านข้อมูล" },
  G: { en: "Provider status unresolved", th: "สถานะจากผู้ให้บริการยังไม่ชัดเจน" }
};
export const gpsHealthTitle = (letter: GpsHealthLetter, language: "en" | "th") => TITLES[letter][language];

/** Order matters: reading problems first, then offline, stale, coordinates, GPS signal, then the source label. */
export function classifyForthGpsHealth(record: ForthFleetTrackingRecord): GpsHealth {
  const done = (letter: GpsHealthLetter, code: GpsHealthCode): GpsHealth => ({ letter, code, verified: letter === "A" });
  if (!record.gpsDeviceId || !record.vehicleRegistration) return done("F", "device_or_registration_missing");
  if (record.gpsConnectivity === "unknown" || record.gprsConnectivity === "unknown") return done("F", "gps_or_gprs_status_unreadable");
  if (record.timestampStatus !== "current" && record.timestampStatus !== "stale") return done("F", "position_time_unreadable");
  if (record.gprsConnectivity === "disconnected") return done("E", "tracker_offline");
  if (record.timestampStatus === "stale") return done("C", "stale_last_known_position");
  if (record.coordinateStatus === "missing") return done("D", "coordinates_missing");
  if (record.coordinateStatus !== "valid") return done("D", "coordinates_invalid");
  if (record.gpsConnectivity === "disconnected") return done("B", "gps_signal_off_tracker_online");
  if (isForthGpsPositionVerified(record)) return done("A", "verified_fresh_gps");
  if (record.positionQuality === "no_gps") return done("G", "gps_on_source_no_gps");
  if (record.positionQuality === "unknown") return done("G", "gps_on_source_unrecognised");
  return done("G", "gps_on_source_not_gps");
}

const REASONS: Record<GpsHealthCode, { en: string; th: string }> = {
  verified_fresh_gps: { en: "Forth reports GPS signal ON, labels the position source “GPS”, and the position is recent with valid coordinates.", th: "Forth รายงานสัญญาณ GPS เปิด ระบุแหล่งตำแหน่งเป็น GPS ตำแหน่งเป็นปัจจุบันและพิกัดถูกต้อง" },
  gps_signal_off_tracker_online: { en: "The tracker is online but Forth reports the GPS signal OFF. The position shown is not a satellite fix.", th: "ตัวติดตามออนไลน์ แต่ Forth รายงานว่าสัญญาณ GPS ปิด ตำแหน่งที่แสดงไม่ใช่ค่าจากดาวเทียม" },
  stale_last_known_position: { en: "The last position is older than the 15-minute freshness window. Treat it as the last known position, not the current one.", th: "ตำแหน่งล่าสุดเก่ากว่า 15 นาที ให้ถือเป็นตำแหน่งล่าสุดที่ทราบ ไม่ใช่ตำแหน่งปัจจุบัน" },
  coordinates_missing: { en: "Forth sent no coordinates for this vehicle, so it cannot be placed on the map.", th: "Forth ไม่ส่งพิกัดของรถคันนี้ จึงแสดงบนแผนที่ไม่ได้" },
  coordinates_invalid: { en: "The coordinates Forth sent are not valid numbers, so no position is shown.", th: "พิกัดที่ Forth ส่งมาไม่ถูกต้อง จึงไม่แสดงตำแหน่ง" },
  tracker_offline: { en: "Forth reports the tracker offline (GPRS OFF). Any position shown is the last one received.", th: "Forth รายงานว่าตัวติดตามออฟไลน์ (GPRS ปิด) ตำแหน่งที่แสดงเป็นค่าล่าสุดที่ได้รับ" },
  device_or_registration_missing: { en: "The device ID or registration is missing in the Forth response, so this record cannot be matched to a vehicle.", th: "ไม่มีรหัสอุปกรณ์หรือทะเบียนในข้อมูล Forth จึงจับคู่กับรถไม่ได้" },
  gps_or_gprs_status_unreadable: { en: "The GPS or GPRS value from Forth could not be read as ON or OFF.", th: "อ่านค่า GPS หรือ GPRS จาก Forth เป็นเปิดหรือปิดไม่ได้" },
  position_time_unreadable: { en: "The position time from Forth is missing or could not be interpreted, so freshness is unknown.", th: "ไม่มีเวลาตำแหน่งจาก Forth หรือแปลผลไม่ได้ จึงไม่ทราบความสดใหม่" },
  gps_on_source_no_gps: { en: "Forth reports the GPS signal ON but labels this position’s source “No GPS”. The position, speed and time are current, yet EES cannot confirm the position came from a satellite fix, so it is shown as unverified. Use it as indicative only.", th: "Forth รายงานสัญญาณ GPS เปิด แต่ระบุแหล่งตำแหน่งว่า “No GPS” ตำแหน่ง ความเร็ว และเวลาเป็นปัจจุบัน แต่ EES ยืนยันไม่ได้ว่าตำแหน่งมาจากดาวเทียม จึงแสดงว่ายังไม่ยืนยัน ใช้เป็นข้อมูลโดยประมาณเท่านั้น" },
  gps_on_source_unrecognised: { en: "Forth reports GPS ON but the position source label is missing or not recognised, so the position stays unverified.", th: "Forth รายงาน GPS เปิด แต่ไม่มีหรือไม่รู้จักป้ายแหล่งตำแหน่ง จึงยังไม่ยืนยัน" },
  gps_on_source_not_gps: { en: "Forth reports GPS ON but says the position came from a non-GPS source such as Wi-Fi, mobile-cell or another method, so it stays unverified.", th: "Forth รายงาน GPS เปิด แต่ระบุว่าตำแหน่งมาจากแหล่งอื่น เช่น Wi-Fi หรือเสาสัญญาณ จึงยังไม่ยืนยัน" }
};
export const gpsHealthReason = (code: GpsHealthCode, language: "en" | "th") => REASONS[code][language];

const MOTION: Record<ReturnType<typeof getForthReportedActivity>, { en: string; th: string }> = {
  driving: { en: "Vehicle moving", th: "รถกำลังเคลื่อนที่" },
  uncertain: { en: "Motion uncertain (speed and engine disagree)", th: "สถานะการเคลื่อนที่ไม่แน่ชัด (ความเร็วกับเครื่องยนต์ขัดแย้ง)" },
  stopped_engine_on: { en: "Stopped, engine on", th: "จอด เครื่องยนต์ติด" },
  stopped_engine_off: { en: "Stopped, engine off", th: "จอด เครื่องยนต์ดับ" },
  stopped_engine_unknown: { en: "Stopped", th: "จอด" },
  unavailable: { en: "Motion not available", th: "ไม่มีข้อมูลการเคลื่อนที่" }
};

/** One management line with the independent parts kept separate, plus the reason and the exact source time. */
export function describeForthGpsHealth(record: ForthFleetTrackingRecord, language: "en" | "th") {
  const health = classifyForthGpsHealth(record);
  const connection = record.gprsConnectivity === "connected" ? { en: "Tracker online", th: "ตัวติดตามออนไลน์" } : record.gprsConnectivity === "disconnected" ? { en: "Tracker offline", th: "ตัวติดตามออฟไลน์" } : { en: "Tracker status unknown", th: "ไม่ทราบสถานะตัวติดตาม" };
  const gpsSignal = record.gpsConnectivity === "connected" ? "ON" : record.gpsConnectivity === "disconnected" ? "OFF" : "?";
  const source = record.positionSource ?? (language === "th" ? "ไม่ระบุ" : "not reported");
  const position = health.verified ? { en: "GPS position verified", th: "ตำแหน่ง GPS ยืนยันแล้ว" } : { en: "GPS position unverified", th: "ตำแหน่ง GPS ยังไม่ยืนยัน" };
  return {
    ...health,
    title: gpsHealthTitle(health.letter, language),
    line: [connection[language], MOTION[getForthReportedActivity(record)][language], position[language]].join(" · "),
    reason: gpsHealthReason(health.code, language),
    // Kept apart on purpose: the documented GPS field, and Forth's separate position-source label.
    signalSummary: language === "th" ? `สัญญาณ GPS (Forth): ${gpsSignal} · แหล่งตำแหน่ง (Forth): ${source}` : `GPS signal (Forth): ${gpsSignal} · Position source (Forth): ${source}`,
    positionTime: record.sourceTimestampRaw
  };
}

/** Counts per category and code across the fleet; nothing is merged into one status. */
export function summarizeForthGpsHealth(records: readonly ForthFleetTrackingRecord[]) {
  const letters: Record<GpsHealthLetter, number> = { A: 0, B: 0, C: 0, D: 0, E: 0, F: 0, G: 0 }; const codes: Partial<Record<GpsHealthCode, number>> = {};
  for (const record of records) { const h = classifyForthGpsHealth(record); letters[h.letter]++; codes[h.code] = (codes[h.code] ?? 0) + 1; }
  return { total: records.length, letters, codes };
}
