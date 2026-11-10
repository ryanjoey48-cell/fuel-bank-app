/**
 * Fleet Tracking speed intelligence (V12).
 *
 * Uses owner-confirmed Forth device speed-alert settings when available.
 * Never invents road legal limits or sustained overspeed durations from sparse polls.
 */

import type { ForthFleetTrackingRecord } from "@/lib/forth-tracking-server";
import {
  lookupForthSpeedConfig,
  type ForthSpeedDeviceConfig
} from "@/lib/forth-speed-config";
import {
  getForthOperationalSpeedAdvisoryKmh,
  getForthReportedActivity,
  getForthTrackingVehicleIdentity,
  isForthGpsPositionVerified,
  type ForthTrackingMapVehicleClass
} from "@/lib/forth-tracking-view";

/** Classification of what the live observation supports. */
export type ForthSpeedEvidenceKind =
  | "current_reading"
  | "threshold_exceedance"
  | "confirmed_device_overspeed"
  | "legal_road_violation";

export type ForthSpeedReviewConfidence =
  | "owner_device_config"
  | "possible_concern"
  | "no_limit_context"
  | "confirmed_review";

export type ForthSpeedReviewSource =
  | "owner_forth_device_config"
  | "class_advisory_fallback"
  | "road_limit"
  | "unavailable";

export type ForthSpeedReview = {
  currentSpeedKmh: number;
  applicableLimitKmh: number | null;
  overLimitKmh: number | null;
  alertDelaySeconds: number | null;
  confidence: ForthSpeedReviewConfidence;
  source: ForthSpeedReviewSource;
  evidenceKind: ForthSpeedEvidenceKind;
  isReview: boolean;
  /** True when current GPS-verified driving meets/exceeds the configured device threshold. */
  isThresholdExceedance: boolean;
  /**
   * Confirmed Forth device overspeed event. Requires event records or equivalent
   * timestamped evidence — never inferred from a single live snapshot or poll interval.
   */
  isConfirmedDeviceOverspeed: boolean;
  /** Always false until a verified road-limit source exists. */
  isLegalRoadViolation: boolean;
  vehicleClass: ForthTrackingMapVehicleClass;
  config: ForthSpeedDeviceConfig | null;
  reasonEn: string;
  reasonTh: string;
};

export {
  FORTH_HIGH_SPEED_REVIEW_KMH,
  getForthOperationalSpeedAdvisoryKmh,
  isForthHighReportedSpeed
} from "@/lib/forth-tracking-view";

function isUsableSpeed(speed: number | null): speed is number {
  return typeof speed === "number" && Number.isFinite(speed) && speed >= 0;
}

function roundTenth(value: number) {
  return Math.round(value * 10) / 10;
}

/**
 * Evaluate a live Forth speed report for operational review.
 * Returns null when there is no usable current speed to display.
 */
export function evaluateForthSpeedReview(record: ForthFleetTrackingRecord): ForthSpeedReview | null {
  if (!isUsableSpeed(record.speed)) return null;
  const vehicleClass = getForthTrackingVehicleIdentity(record.vehicleRegistration).vehicleClass;
  const config = lookupForthSpeedConfig(record.vehicleRegistration);
  const gpsVerified = isForthGpsPositionVerified(record);
  const driving = getForthReportedActivity(record) === "driving";
  const threshold = config?.speedAlertKmh ?? null;
  const delaySeconds = config ? config.alertDelaySeconds : null;
  const exceeds = Boolean(
    gpsVerified && driving && threshold !== null && record.speed >= threshold
  );

  // Confirmed device overspeed / legal road violation require separate event evidence.
  const isConfirmedDeviceOverspeed = false;
  const isLegalRoadViolation = false;

  if (config && exceeds) {
    const over = roundTenth(record.speed - config.speedAlertKmh);
    const delayNoteEn = config.alertDelaySeconds > 0
      ? `Configured delay is ${config.alertDelaySeconds}s — a single GPS snapshot does not prove the delay elapsed.`
      : "Configured delay is 0s — still does not prove a Forth alert event was recorded without the event API.";
    const delayNoteTh = config.alertDelaySeconds > 0
      ? `หน่วงที่ตั้งไว้ ${config.alertDelaySeconds} วินาที — สแนปช็อต GPS ครั้งเดียวไม่พิสูจน์ว่าหน่วงครบแล้ว`
      : "หน่วงที่ตั้งไว้ 0 วินาที — ยังไม่พิสูจน์ว่ามีเหตุการณ์แจ้งเตือนจาก Forth โดยไม่มี API เหตุการณ์";

    return {
      currentSpeedKmh: record.speed,
      applicableLimitKmh: config.speedAlertKmh,
      overLimitKmh: over,
      alertDelaySeconds: config.alertDelaySeconds,
      confidence: "owner_device_config",
      source: "owner_forth_device_config",
      evidenceKind: "threshold_exceedance",
      isReview: true,
      isThresholdExceedance: true,
      isConfirmedDeviceOverspeed,
      isLegalRoadViolation,
      vehicleClass,
      config,
      reasonEn: `Owner-reported Forth device alert ${config.speedAlertKmh} km/h · +${over} km/h. ${delayNoteEn} Not a legal road-limit finding.`,
      reasonTh: `เกณฑ์แจ้งเตือนอุปกรณ์ Forth ที่เจ้าของรายงาน ${config.speedAlertKmh} กม./ชม. · +${over} กม./ชม. ${delayNoteTh} ไม่ใช่การฝ่าฝืนขีดจำกัดถนน`
    };
  }

  if (config) {
    const delta = roundTenth(record.speed - config.speedAlertKmh);
    return {
      currentSpeedKmh: record.speed,
      applicableLimitKmh: config.speedAlertKmh,
      overLimitKmh: delta,
      alertDelaySeconds: config.alertDelaySeconds,
      confidence: "owner_device_config",
      source: "owner_forth_device_config",
      evidenceKind: "current_reading",
      isReview: false,
      isThresholdExceedance: false,
      isConfirmedDeviceOverspeed,
      isLegalRoadViolation,
      vehicleClass,
      config,
      reasonEn: `Current Forth speed vs owner-reported device alert ${config.speedAlertKmh} km/h (delay ${config.alertDelaySeconds}s). Road legal limits unavailable.`,
      reasonTh: `ความเร็ว Forth ปัจจุบันเทียบเกณฑ์แจ้งเตือนอุปกรณ์ที่เจ้าของรายงาน ${config.speedAlertKmh} กม./ชม. (หน่วง ${config.alertDelaySeconds} วินาที) ไม่มีขีดจำกัดถนน`
    };
  }

  // No device config — fall back to class advisory for unknown plates only.
  const advisory = getForthOperationalSpeedAdvisoryKmh(vehicleClass);
  const flagged = gpsVerified && driving && record.speed >= advisory;
  if (flagged) {
    const over = roundTenth(record.speed - advisory);
    return {
      currentSpeedKmh: record.speed,
      applicableLimitKmh: advisory,
      overLimitKmh: over,
      alertDelaySeconds: null,
      confidence: "possible_concern",
      source: "class_advisory_fallback",
      evidenceKind: "threshold_exceedance",
      isReview: true,
      isThresholdExceedance: true,
      isConfirmedDeviceOverspeed,
      isLegalRoadViolation,
      vehicleClass,
      config: null,
      reasonEn: `No owner Forth device setting matched. Class advisory ${advisory} km/h used as fallback only (+${over}). Not a device alert or legal finding.`,
      reasonTh: `ไม่พบการตั้งค่าอุปกรณ์ Forth ที่เจ้าของรายงาน ใช้เกณฑ์ตามประเภทรถ ${advisory} กม./ชม. เป็นทางเลือกชั่วคราว (+${over}) ไม่ใช่การแจ้งเตือนอุปกรณ์หรือความผิดทางกฎหมาย`
    };
  }

  return {
    currentSpeedKmh: record.speed,
    applicableLimitKmh: null,
    overLimitKmh: null,
    alertDelaySeconds: null,
    confidence: "no_limit_context",
    source: "unavailable",
    evidenceKind: "current_reading",
    isReview: false,
    isThresholdExceedance: false,
    isConfirmedDeviceOverspeed,
    isLegalRoadViolation,
    vehicleClass,
    config: null,
    reasonEn: "No matched Forth device speed-alert setting. Current speed shown from Forth only. Road limits unavailable.",
    reasonTh: "ไม่พบการตั้งค่าแจ้งเตือนความเร็วอุปกรณ์ Forth ความเร็วปัจจุบันมาจาก Forth เท่านั้น ไม่มีขีดจำกัดถนน"
  };
}

export function isForthSpeedReviewCandidate(record: ForthFleetTrackingRecord) {
  return Boolean(evaluateForthSpeedReview(record)?.isReview);
}

/**
 * Evidence helper: a single snapshot never proves a delayed Forth alert fired.
 * Confirmed device overspeed stays false until event records are integrated.
 */
export function assessForthSpeedDelayEvidence(input: {
  alertDelaySeconds: number | null;
  isThresholdExceedance: boolean;
  hasForthOverspeedEventRecord: boolean;
}) {
  if (input.hasForthOverspeedEventRecord) {
    return {
      evidenceKind: "confirmed_device_overspeed" as const,
      delaySatisfied: true as const,
      reasonEn: "Supported by a Forth overspeed event record.",
      reasonTh: "มีบันทึกเหตุการณ์ความเร็วเกินจาก Forth"
    };
  }
  if (!input.isThresholdExceedance) {
    return {
      evidenceKind: "current_reading" as const,
      delaySatisfied: false as const,
      reasonEn: "Current reading only.",
      reasonTh: "เป็นเพียงค่าความเร็วปัจจุบัน"
    };
  }
  if (input.alertDelaySeconds !== null && input.alertDelaySeconds > 0) {
    return {
      evidenceKind: "threshold_exceedance" as const,
      delaySatisfied: false as const,
      reasonEn: `Threshold exceedance only — ${input.alertDelaySeconds}s configured delay is not evidenced by this snapshot.`,
      reasonTh: `เกินเกณฑ์เท่านั้น — หน่วง ${input.alertDelaySeconds} วินาทีที่ตั้งไว้ยังไม่มีหลักฐานจากสแนปช็อตนี้`
    };
  }
  return {
    evidenceKind: "threshold_exceedance" as const,
    delaySatisfied: false as const,
    reasonEn: "Threshold exceedance only — zero configured delay still does not confirm a recorded Forth alert without the event API.",
    reasonTh: "เกินเกณฑ์เท่านั้น — หน่วง 0 วินาทียังไม่ยืนยันเหตุการณ์แจ้งเตือนจาก Forth โดยไม่มี API เหตุการณ์"
  };
}

export function forthSpeedReviewConfidenceLabel(confidence: ForthSpeedReviewConfidence, language: "en" | "th") {
  if (confidence === "confirmed_review") {
    return language === "th" ? "ยืนยันการตรวจสอบ" : "Confirmed review";
  }
  if (confidence === "owner_device_config") {
    return language === "th" ? "ตั้งค่าอุปกรณ์ (เจ้าของรายงาน)" : "Device setting (owner-reported)";
  }
  if (confidence === "possible_concern") {
    return language === "th" ? "อาจต้องตรวจสอบ" : "Possible concern";
  }
  return language === "th" ? "ไม่มีขีดจำกัดถนน" : "Limit unavailable";
}

export function forthSpeedEvidenceLabel(kind: ForthSpeedEvidenceKind, language: "en" | "th") {
  if (kind === "confirmed_device_overspeed") {
    return language === "th" ? "เหตุการณ์ความเร็วเกินที่ยืนยันแล้ว" : "Confirmed device overspeed";
  }
  if (kind === "threshold_exceedance") {
    return language === "th" ? "เกินเกณฑ์อุปกรณ์ปัจจุบัน" : "Current threshold exceedance";
  }
  if (kind === "legal_road_violation") {
    return language === "th" ? "ฝ่าฝืนขีดจำกัดถนน" : "Legal road-limit violation";
  }
  return language === "th" ? "ความเร็วปัจจุบัน" : "Current reading";
}
