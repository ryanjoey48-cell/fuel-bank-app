/**
 * V6.3 shared, explainable live-vehicle statements. Pure and read-only. It adds NO new classification rule: every statement
 * is derived from the existing helpers (getForthReportedActivity, isForthGpsPositionVerified, classifyForthGpsHealth), so the map,
 * the Overview tab, GPS Health and Reports can never disagree. It keeps five things separate: motion, engine state, GPS
 * verification, data freshness and tracker connectivity. Speed is shown as an observation, never as a legal offence.
 */
import type { ForthFleetTrackingRecord } from "./forth-tracking-server";
import { getForthReportedActivity, isForthGpsPositionVerified } from "./forth-tracking-view";
import { classifyForthGpsHealth } from "./forth-gps-health";

export type LiveStatementId =
  | "stale_last_known" | "time_unknown" | "no_coordinates" | "tracker_offline" | "unverified_position" | "gps_signal_off"
  | "potential_idling" | "stopped_engine_unknown" | "speed_engine_conflict" | "observed_speed" | "verified_current" | "verified_reading_tracker_unconfirmed";
export type LiveTone = "ok" | "info" | "warn";
export type LiveStatement = { id: LiveStatementId; tone: LiveTone };

export type LiveFreshness = "current" | "stale" | "unknown";
export type LiveVehicleStatus = {
  freshness: LiveFreshness;
  motion: "moving" | "stationary" | "uncertain" | "unavailable";
  engine: "on" | "off" | "unknown";
  verified: boolean;
  trackerOnline: boolean | null;
  /** A map pin exists only for valid coordinates; whether it is verified is a separate question. */
  hasCoordinates: boolean;
  statements: LiveStatement[];
};

export function describeLiveVehicle(record: ForthFleetTrackingRecord): LiveVehicleStatus {
  const activity = getForthReportedActivity(record);
  const freshness: LiveFreshness = record.timestampStatus === "current" ? "current" : record.timestampStatus === "stale" ? "stale" : "unknown";
  const verified = isForthGpsPositionVerified(record);
  const hasCoordinates = record.coordinateStatus === "valid" && record.latitude !== null && record.longitude !== null;
  const motion: LiveVehicleStatus["motion"] = activity === "driving" ? "moving" : activity === "uncertain" ? "uncertain" : activity === "unavailable" ? "unavailable" : "stationary";
  const engine: LiveVehicleStatus["engine"] = record.engineOn === true ? "on" : record.engineOn === false ? "off" : "unknown";
  const trackerOnline = record.gprsConnectivity === "connected" ? true : record.gprsConnectivity === "disconnected" ? false : null;
  const statements: LiveStatement[] = [];
  const add = (id: LiveStatementId, tone: LiveTone) => statements.push({ id, tone });

  if (freshness === "stale") add("stale_last_known", "warn");
  if (freshness === "unknown") add("time_unknown", "warn");
  if (!hasCoordinates) add("no_coordinates", "warn");
  if (trackerOnline === false) add("tracker_offline", "warn");
  // An unverified position is not an offline vehicle: the pin is the last reported coordinate, labelled as such.
  if (hasCoordinates && !verified && freshness !== "stale") add("unverified_position", "info");
  if (hasCoordinates && record.gpsConnectivity === "disconnected" && trackerOnline !== false) add("gps_signal_off", "warn");
  // Idling needs the provider's engine flag AND a fresh stopped reading. Zero speed alone is never idling.
  if (activity === "stopped_engine_on") add("potential_idling", "info");
  if (activity === "stopped_engine_unknown") add("stopped_engine_unknown", "info");
  if (activity === "uncertain") add("speed_engine_conflict", "warn");
  if (freshness === "current" && typeof record.speed === "number" && record.speed > 0) add("observed_speed", "info");
  // The map rule (isForthGpsPositionVerified) does not look at the tracker connection; GPS Health ranks a tracker problem first.
  // Both are kept as they are, and the difference is stated instead of hidden.
  if (verified && trackerOnline !== true) add("verified_reading_tracker_unconfirmed", "warn");
  if (freshness === "current" && verified && trackerOnline === true) add("verified_current", "ok");
  return { freshness, motion, engine, verified, trackerOnline, hasCoordinates, statements };
}

type Pair = readonly [string, string];
export const LIVE_STATEMENT_COPY: Record<LiveStatementId, Pair> = {
  stale_last_known: ["Last known position, not live. Do not treat it as current movement.", "ตำแหน่งล่าสุดที่ทราบ ไม่ใช่ตำแหน่งสด อย่าถือเป็นการเคลื่อนที่ปัจจุบัน"],
  time_unknown: ["The position time could not be read, so freshness is unknown.", "อ่านเวลาตำแหน่งไม่ได้ จึงไม่ทราบความสดใหม่"],
  no_coordinates: ["No usable coordinates, so this vehicle is not drawn on the map.", "ไม่มีพิกัดที่ใช้ได้ จึงไม่แสดงรถคันนี้บนแผนที่"],
  tracker_offline: ["Forth reports the tracker offline. Any position is the last one received.", "Forth รายงานว่าตัวติดตามออฟไลน์ ตำแหน่งที่แสดงเป็นค่าล่าสุดที่ได้รับ"],
  unverified_position: ["The map shows the last reported coordinates. They are not verified GPS (see GPS Health), but the tracker is not necessarily offline.", "แผนที่แสดงพิกัดล่าสุดที่รายงาน ยังไม่ใช่ GPS ที่ยืนยัน (ดูสถานะ GPS) แต่ตัวติดตามไม่จำเป็นต้องออฟไลน์"],
  gps_signal_off: ["The tracker is online but Forth reports the GPS signal OFF. The position is not a satellite fix.", "ตัวติดตามออนไลน์ แต่ Forth รายงานสัญญาณ GPS ปิด ตำแหน่งไม่ใช่ค่าจากดาวเทียม"],
  potential_idling: ["Stopped with the engine reported ON: possible idling. The engine flag is provider-reported.", "จอดและ Forth รายงานว่าเครื่องยนต์ทำงาน อาจติดเครื่องอยู่ ค่าเครื่องยนต์เป็นข้อมูลจากผู้ให้บริการ"],
  stopped_engine_unknown: ["Stopped. The engine state is unknown, so this is not evidence of idling.", "จอดอยู่ ไม่ทราบสถานะเครื่องยนต์ จึงไม่ใช่หลักฐานการติดเครื่อง"],
  speed_engine_conflict: ["A positive speed was reported with the engine OFF. The two signals conflict, so movement is uncertain.", "รายงานความเร็วมากกว่าศูนย์ขณะเครื่องยนต์ดับ สัญญาณขัดแย้ง จึงยังไม่แน่ใจว่าเคลื่อนที่"],
  observed_speed: ["Observed speed is provider-reported. No road speed limit is applied, so this is not a speeding finding.", "ความเร็วที่สังเกตได้เป็นค่าจากผู้ให้บริการ ไม่ได้เทียบกับเพดานความเร็วของถนน จึงไม่ใช่ผลการตรวจจับความเร็วเกิน"],
  verified_current: ["Current position with verified GPS.", "ตำแหน่งปัจจุบันด้วย GPS ที่ยืนยันแล้ว"],
  verified_reading_tracker_unconfirmed: ["The latest reading is labelled GPS, but Forth does not report the tracker connection as online, so GPS Health lists a tracker problem first. Treat the position with care.", "การอ่านล่าสุดระบุว่าเป็น GPS แต่ Forth ไม่ได้รายงานว่าตัวติดตามออนไลน์ สถานะ GPS จึงแสดงปัญหาตัวติดตามก่อน โปรดใช้ตำแหน่งนี้อย่างระมัดระวัง"]
};
export const liveStatementLabel = (id: LiveStatementId, language: "en" | "th") => LIVE_STATEMENT_COPY[id][language === "th" ? 1 : 0];

/** Whether the map pin and the GPS Health class tell one consistent story (used by tests and as a runtime assertion). */
export function liveAgreesWithGpsHealth(record: ForthFleetTrackingRecord): boolean {
  const status = describeLiveVehicle(record);
  const health = classifyForthGpsHealth(record);
  // GPS Health "A" implies the map rule says verified. The only allowed difference in the other direction is a reading the map rule
  // accepts while the tracker connection is not reported online; that difference has its own statement.
  if (health.verified && !status.verified) return false;
  if (status.verified && !health.verified && status.trackerOnline === true) return false;
  if (status.verified && !health.verified && !status.statements.some(x => x.id === "verified_reading_tracker_unconfirmed")) return false;
  if (status.freshness === "stale" && status.verified) return false;
  return true;
}

export type LiveFleetSummary = {
  total: number; freshVerified: number; unverified: number; stale: number; trackerOffline: number; withoutCoordinates: number;
  moving: number; stationary: number; uncertain: number; unavailable: number; potentialIdling: number;
  /** Counts must partition the fleet; false means a classification disagreement to investigate, never to hide. */
  consistent: boolean;
};

export function summarizeLiveFleet(records: readonly ForthFleetTrackingRecord[]): LiveFleetSummary {
  const s: LiveFleetSummary = { total: records.length, freshVerified: 0, unverified: 0, stale: 0, trackerOffline: 0, withoutCoordinates: 0, moving: 0, stationary: 0, uncertain: 0, unavailable: 0, potentialIdling: 0, consistent: true };
  for (const record of records) {
    const v = describeLiveVehicle(record);
    if (v.freshness === "current" && v.verified && v.trackerOnline === true) s.freshVerified++;
    if (!v.verified) s.unverified++;
    if (v.freshness === "stale") s.stale++;
    if (v.trackerOnline === false) s.trackerOffline++;
    if (!v.hasCoordinates) s.withoutCoordinates++;
    s[v.motion]++;
    if (v.statements.some(x => x.id === "potential_idling")) s.potentialIdling++;
  }
  s.consistent = s.moving + s.stationary + s.uncertain + s.unavailable === s.total && records.every(liveAgreesWithGpsHealth);
  return s;
}

/**
 * V6.7 plain-language GPS Health headline for office staff. It only RESTATES the existing health class (A to G) from
 * classifyForthGpsHealth; it adds no rule and never upgrades a class. The technical details stay below it.
 */
export type GpsSummaryTone = "ok" | "warn" | "bad";
export const GPS_SUMMARY_COPY: Record<string, { tone: GpsSummaryTone; title: Pair; meaning: Pair }> = {
  A: { tone: "ok", title: ["GPS position verified", "ตำแหน่ง GPS ที่ยืนยันแล้ว"], meaning: ["Forth reports GPS on, labels the position as GPS, and the position is recent. This is the strongest evidence EES has.", "Forth รายงานว่า GPS เปิด ระบุว่าตำแหน่งมาจาก GPS และเป็นข้อมูลล่าสุด นี่เป็นหลักฐานที่น่าเชื่อถือที่สุดที่ EES มี"] },
  B: { tone: "warn", title: ["GPS signal is off", "สัญญาณ GPS ปิดอยู่"], meaning: ["The tracker is online but is not reporting a satellite fix, so the position is not verified.", "ตัวติดตามออนไลน์แต่ไม่ได้รายงานตำแหน่งจากดาวเทียม จึงยังไม่ยืนยันตำแหน่ง"] },
  C: { tone: "warn", title: ["Tracking data is stale", "ข้อมูลติดตามเก่าแล้ว"], meaning: ["This is the last known position, not where the vehicle is now.", "นี่คือตำแหน่งล่าสุดที่ทราบ ไม่ใช่ตำแหน่งปัจจุบันของรถ"] },
  D: { tone: "bad", title: ["No usable position", "ไม่มีตำแหน่งที่ใช้ได้"], meaning: ["Forth did not send valid coordinates, so the vehicle cannot be placed on the map.", "Forth ไม่ได้ส่งพิกัดที่ถูกต้อง จึงแสดงรถบนแผนที่ไม่ได้"] },
  E: { tone: "bad", title: ["Tracker connection unavailable", "ไม่มีการเชื่อมต่อของตัวติดตาม"], meaning: ["Forth reports the tracker offline. Any position shown is the last one received.", "Forth รายงานว่าตัวติดตามออฟไลน์ ตำแหน่งที่แสดงเป็นค่าล่าสุดที่ได้รับ"] },
  F: { tone: "bad", title: ["Tracking data could not be read", "อ่านข้อมูลติดตามไม่ได้"], meaning: ["A device, registration, time or status field from Forth is missing or unreadable.", "ข้อมูลอุปกรณ์ ทะเบียน เวลา หรือสถานะจาก Forth ขาดหรืออ่านไม่ได้"] },
  G: { tone: "warn", title: ["Provider coordinates available but not verified", "มีพิกัดจากผู้ให้บริการแต่ยังไม่ยืนยัน"], meaning: ["Forth sends a current position but does not label it as a GPS fix. The tracker is not necessarily faulty. Use the position as a guide only.", "Forth ส่งตำแหน่งปัจจุบันแต่ไม่ได้ระบุว่าเป็นค่า GPS ตัวติดตามไม่จำเป็นต้องเสีย ใช้ตำแหน่งนี้เป็นแนวทางเท่านั้น"] }
};
export function gpsSummaryFor(letter: string, language: "en" | "th") {
  const entry = GPS_SUMMARY_COPY[letter]; if (!entry) return null;
  const i = language === "th" ? 1 : 0; return { tone: entry.tone, title: entry.title[i], meaning: entry.meaning[i] };
}
